# QuickFurno — Phase 5F-C3-C-1

## Pure DLT Authentication Body Renderer + Resolved SMS Send Contract + Provider-Neutral Orchestrator Wiring

**Status: CODE-ONLY. SHIPPED OPERATIONALLY DISABLED. No live SMS is sent.**

This subphase closes the one code gap C3-B recorded as technical debt: the client-OTP
orchestrator called the Exotel adapter's bare `sendAuthenticationMessage`, which the adapter
deliberately refuses (`EXOTEL_RESOLVED_TEMPLATE_REQUIRED`). It adds the pieces required to
produce and deliver a *resolved* authentication SMS, while keeping everything disabled.

It changes **no** database schema, **no** SQL, **no** `.env`, **no** runtime/policy/account/
template-mapping/canary row, **no** failure rule, and **no** Meta activation.

---

## What this phase does NOT do

- It does **not** claim any India DLT template is registered or approved — DLT registration is
  external and still pending (reconciled in Phase 5F-C3-C-3).
- It does **not** create an Exotel account, provider-account row, runtime policy, template
  mapping, or canary row.
- It does **not** enable the SMS fallback, enable any authentication transport policy, or
  create a failure rule (the failure-rule table stays empty / default-deny).
- It does **not** run a canary or put any production SMS on the wire.
- It does **not** enable Meta.

In production, every path still terminates at the WhatsApp primary exactly as it does today.

---

## Why the authentication SMS body is REVIEWED CODE, not operator-editable SQL

WhatsApp/Meta renders an approved template **provider-side** from named variables — QuickFurno
sends only the variable values, never a body. An SMS provider (Exotel) is different: its send
API takes a raw `Body` string, so the OTP must be rendered into the approved content
**locally**.

That content is an **authentication surface**. If it lived in an operator-editable database
column, anyone with write access to that row could weaken or redirect an OTP message (change
the wording, strip the "do not share" warning, add a phishing link). So the body lives in
**reviewed source code** (`lib/communication/authSmsBodyRenderer.ts`), and there is
deliberately **no** `message_body` / SMS-content column in any table. `communication_templates`
remains WhatsApp-only by its CHECK constraint; nothing here changes that.

The reviewed body is a **placeholder pending DLT approval**. Before any live send (Phase
5F-C3-C-3), it MUST be reconciled to byte-match the DLT-registered content template that the
runtime mapping's `providerTemplateId` refers to. Its presence in code is NOT a claim that a
DLT template is approved.

---

## Renderer purity

`resolveAuthenticationSmsContent(input)` is pure and deterministic: no database, environment,
network, clock, randomness, provider import, or Exotel literal, and no `console`. The same
input always yields the same body. The OTP is accepted only in memory, is validated by a
defensive shape check (`/^[0-9]{4,10}$/`), is never logged or persisted, and never appears in
any returned object other than inside the rendered body it belongs in. Any failure returns a
stable identifier-shaped code and **no** body.

The renderer is intentionally narrow: one reviewed entry (`client_login_otp` / `en`), a fixed
`render(otp) => body` function. There is no template language, no placeholder engine, and no
`eval`.

---

## Template identity cross-check (the boundary)

- The **renderer** owns: the message body + the reviewed QuickFurno template key.
- The runtime provider **mapping** owns: the provider template name / id and approval state (a
  readiness fact resolved by the C2 SMS runtime gate).

The renderer proves four things and then carries the mapping's provider template name/id
**through** into the resolved descriptor:

```
reviewed QuickFurno template key   ==  runtime mapping template key   (AUTH_SMS_TEMPLATE_IDENTITY_MISMATCH)
reviewed language                  ==  runtime mapping language        (AUTH_SMS_TEMPLATE_IDENTITY_MISMATCH)
runtime mapping category           ==  'authentication'                (AUTH_SMS_CATEGORY_NOT_AUTHENTICATION)
runtime mapping provider template name is present                      (AUTH_SMS_PROVIDER_TEMPLATE_NAME_MISSING)
runtime mapping provider template id  is present & non-empty           (AUTH_SMS_PROVIDER_TEMPLATE_ID_MISSING)
```

It never fabricates DLT approval and never treats "a provider template id string exists" as
proof the template is approved — approval remains external (DLT) and readiness remains a
runtime fact (the C2 gate).

### DLT identity ownership — ONE authority per domain, NO fallback

The authentication resolved-send path has exactly one authority for each identity domain, and
**no identity ever falls back across domains**:

| Identity | Sole authority |
|---|---|
| **DLT entity id** | the Exotel/account **server configuration** (`config.dltEntityId`) |
| **DLT template id** | the **approved runtime template mapping**, carried through the resolved descriptor as `providerTemplateId` |
| **authentication body** | the **reviewed QuickFurno code** renderer |

The DLT content-template identity follows exactly one chain:

```
reviewed QuickFurno template → runtime mapping → providerTemplateId → resolved descriptor → Exotel DltTemplateId
```

There is **no** fallback, **no** substitution, **no** config repair, and **no** aliasing between
these domains. In particular, `config.dltTemplateId` is **never** read on this path: a server
config value must never substitute for a missing mapping template id. `providerTemplateId` is
therefore a **required, non-empty** field on `ResolvedAuthenticationSms`, and the renderer
**fails closed** (`AUTH_SMS_PROVIDER_TEMPLATE_ID_MISSING`) — before the attempt-2 claim and
before any provider send — when the runtime mapping lacks a usable id.

---

## The `sendResolvedAuthenticationSms` contract

`SmsProvider` is widened with a provider-neutral method that carries **delivery facts only**:

```ts
interface ResolvedAuthenticationSms {
  readonly messageBody: string;            // reviewed, code-rendered, OTP already substituted
  readonly providerTemplateName: string;   // approved provider template identity (readiness fact)
  readonly providerTemplateId: string;     // REQUIRED, non-empty — the sole DLT template authority
}

sendResolvedAuthenticationSms(
  to: string,
  resolved: ResolvedAuthenticationSms,
  options?: SmsAuthenticationSendOptions
): Promise<SmsSendResult>;
```

QuickFurno — never the provider — decides the message content. The existing certainty
vocabulary (`accepted` / `definitive_failure` / `unknown_outcome`) and `SmsSendResult` are
unchanged; no new outcome model is introduced. Account-level registry ids (e.g. a DLT **entity**
id) are the provider's own config, not part of this neutral contract.

### Three layers guard the DLT template id

The DLT content-template id is protected in depth, so a missing/empty id can never reach a
provider request from any caller:

1. **Renderer** — rejects a `null` / `undefined` / `""` / `"   "` runtime-mapping id
   (`AUTH_SMS_PROVIDER_TEMPLATE_ID_MISSING`), before the attempt-2 claim and before any send.
2. **Neutral type** — `ResolvedAuthenticationSms.providerTemplateId` is a **required** `string`,
   so a compliant TypeScript caller cannot even express a missing id.
3. **Exotel adapter** — **independently runtime-validates** `resolved.providerTemplateId` before
   constructing or sending the request. A missing/empty id is a **definitive local preflight
   failure** (`EXOTEL_DLT_TEMPLATE_ID_MISSING`, `outcomeCertainty = definitive_failure`,
   `retryable = false`, `providerMessageId = null`) with **zero transport calls**. This is
   defense-in-depth for a direct adapter caller, a future canary path, JavaScript misuse, or
   malformed boundary data. `config.dltTemplateId` **cannot repair or substitute** it.

- **MockSmsProvider**: implements a deterministic, **no-wire** version — zero network calls. It
  retains only the non-secret provider template name; never the body or the OTP. Widening the
  contract does not weaken the production mock prohibition (the runtime factory still never
  constructs the mock).
- **ExotelSmsProvider**: formats the transport request only. `Body = messageBody`;
  `DltTemplateId = resolved.providerTemplateId` (the descriptor is the **sole** template-id
  authority, runtime-validated non-empty — `config.dltTemplateId` is deliberately **not** read,
  so a config value can never substitute for or rescue a missing mapping id);
  `DltEntityId = config.dltEntityId` (account-level, config-owned). All transport invariants are
  preserved: one request, `AbortController` timeout, bounded response read, certainty
  classification, no `Promise.race`, no retry/loop, no secret/OTP/body leak. The bare
  `sendAuthenticationMessage` still refuses.

---

## Provider-neutral orchestrator

`services/clientLoginOtpDeliveryOrchestrator.ts` imports only the pure renderer. It never
imports an Exotel class, endpoint, credential scheme, or response shape, and never names a
provider literal. It calls only `sendResolvedAuthenticationSms`.

### Render / claim / send ordering

```
C1 ALLOWED
  → SMS runtime readiness (C2 gate → ResolvedSmsTemplateMapping)
  → exact provider identity fence
  → RESOLVE the reviewed body (PURE)          ← step 13b, BEFORE the claim
  → remaining network budget check
  → atomic attempt-2 claim (mandatory)        ← step 14
  → sendResolvedAuthenticationSms             ← step 16, ONLY after a CLAIMED attempt-2
  → finalize attempt 2
  → stop
```

**Why render before the claim.** Rendering is pure and has no external side effect, so a render
or template-identity failure fails closed **without** consuming the single fallback attempt
budget and **without** leaving a claimed-but-unsent attempt-2 row. This deviates from the
literal step order in the phase brief on purpose (the brief's "IMPORTANT ORDERING QUESTION"
asks for exactly this: prefer deterministic validation/rendering before the claim). The send at
step 16 still occurs **only** after a `CLAIMED` atomic attempt-2 — the claim remains mandatory
and immediately precedes the send.

### Same OTP, once

The SAME Supabase OTP from request memory (`input.otp`) is rendered into the body; it is read
exactly once, never regenerated, never persisted. There is no second OTP, no third attempt, no
retry loop, no queue, and no n8n.

### Local-failure safety

A render / template-identity / OTP-shape failure maps to a fallback **BLOCK**
(`RESOLVED_BODY_UNAVAILABLE`) → `delivery_failed`, with no claim, no send, and no attempt 3.
Deny-only: a local content failure never authorizes a fallback, a retry, or another channel.

---

## No activation state

At the end of C3-C-1: the authentication transport policy is still disabled; the failure-rule
table is still empty (default deny); there is no SMS runtime activation, no provider-account
row, no template-mapping row, and no canary row; no DLT approval is claimed; no live SMS is
sent; Meta is not enabled; and there is no SQL, migration, or `.env` change.

---

## Tests

`npm run test:phase5f:c3c1` — renderer purity/determinism/fail-closed, contract exposure, mock
+ Exotel implementations, the orchestrator no-SMS gates (including **render failure → no claim
and no send**), the allowed path (exactly one resolved send carrying the same OTP in the body),
render→claim→send ordering, secrecy, and phase safety, plus mutation tests that prove each
critical guard is load-bearing.

Two previous-phase harnesses received **compatibility updates** (documented, invariant-
preserving), because the resolved-send contract they exercised evolved:
- `phase5f-c3b-...`: the injected fake SMS provider now implements `sendResolvedAuthenticationSms`;
  the "same OTP" assertion checks the OTP is inside the rendered body; the render step is added
  to the build and deps. The same-OTP and single-send invariants are preserved.
- `phase5f-c3a-...`: the resolved fixture uses `providerTemplateId`; the DLT passthrough test
  asserts the **template** id comes from the descriptor and the **entity** id from account
  config — a stronger, more correct ownership model.

---

## Known technical debt (deferred)

- **Phase 5F-C3-C-2:** an isolated provider canary probe (health check + one founder-hash send),
  bypassing C1/auth. The canary mechanism **may be implemented in code while disabled**, but
  **no real provider canary SMS may be sent** until the exact reviewed body is reconciled with
  the externally approved DLT content during the later C3-C-3 readiness step — a placeholder body
  would be rejected by the carrier and must never reach a real handset.
  The future canary must use the same path — reviewed renderer → resolved descriptor → provider
  adapter — and, crucially, **even if a future canary caller is malformed, the Exotel adapter
  independently refuses to send without a valid resolved `providerTemplateId`** (zero transport
  calls). The adapter's runtime preflight (added in this correction) is what makes that boundary
  safe regardless of how the canary is wired. (Not implemented in this correction.)
- **Phase 5F-C3-C-3:** reconcile the reviewed body to the DLT-registered content; prepare the
  reviewed runtime rows; external Exotel/DLT registration.
- Full activation (enable policy, add a failure rule, enable Meta) remains behind the later
  C3-D activation audit.
