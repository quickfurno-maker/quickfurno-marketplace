# QF — Meta Callback Identity (Phase 8B-1A)

Uncommitted implementation. **No** deployment, **no** provider activation, **no** SQL/migration,
**no** `communicationService.ts` change, **no** `provider_account_id`, **no** package/lockfile change.

## 1. Purpose

Phase 8B-1A adds a **callback-identity gate** to the Meta WhatsApp Cloud webhook so that a
signature-verified but **foreign, mixed, malformed or unprovable** callback produces **zero effects**.
It hardens the raw-body reader to operate on **exact bytes**, tightens the signature grammar to an
exact form, and proves an inbound webhook belongs to **this** QuickFurno tenant **before** any database
call, receipt write, message mutation, inbound persistence, consent processing, response-intent enqueue,
provider-state effect, or provider/network call.

The security invariant it enforces:

```
VALID META HMAC
  + (FOREIGN | MIXED | MALFORMED | UNPROVABLE callback identity)
  = ZERO db calls / receipt writes / message mutations / inbound persistence
    / consent processing / response-intent enqueue / provider-state / network
```

No rejection receipts are created in Phase 8B-1A (deliberately — see §7).

## 2. Actual raw-byte verification

`lib/communication/providers/metaWebhookRawBody.ts` reads the request body under a strict
**`META_MAX_WEBHOOK_BODY_BYTES = 16 * 1024` (16 KiB)** byte ceiling and returns the **exact `Uint8Array`**
— it **never decodes** the bytes. This matters because Meta computes the `X-Hub-Signature-256` HMAC over
the exact bytes on the wire; a decode-then-reencode round trip is lossy for non-UTF-8 input and would break
verification. The ceiling is enforced *before* unbounded buffering: a Content-Length pre-check (rejected
before the stream is consumed), then a streaming byte count that cancels the moment the cap is exceeded
(exactly 16,384 bytes accepted, 16,385 rejected). The route (`app/api/webhooks/whatsapp/meta/route.ts`)
reads bytes with this reader and enters the byte pipeline; it never decodes on the way in and stays generic
on the way out.

## 3. Exact signature grammar

`verifyMetaWebhookSignatureBytes(rawBytes, signature, appSecret)` in
`lib/communication/providers/metaWhatsAppWebhook.ts`:

- rejects any header that does not match the **exact grammar** `META_SIGNATURE_PATTERN = /^sha256=[0-9a-f]{64}$/`
  (uppercase hex, wrong length, or a missing prefix are rejected **before** any crypto);
- computes `HMAC-SHA256` over the **exact `Uint8Array` bytes**;
- compares the two **raw 32-byte digests** with `crypto.timingSafeEqual`;
- fails closed on a non-`Uint8Array` body or an empty secret.

**One grammar, one comparison authority (correction).** The string helper `verifyMetaWebhookSignature(rawBody: string, …)`
no longer has its own `startsWith("sha256=")` check or its own HMAC comparison. It is now a thin wrapper that
encodes the string to its exact UTF-8 bytes (`Buffer.from(rawBody, "utf8")`) and **delegates to
`verifyMetaWebhookSignatureBytes`**. So both functions share the single grammar `^sha256=[0-9a-f]{64}$` and
the single `timingSafeEqual` authority: the string verifier can never accept a signature the byte verifier
rejects (proven behaviourally over a battery — uppercase prefix, uppercase digest, non-hex, short, long,
whitespace, comma-joined, wrong algorithm — and structurally: the string verifier contains no independent
`startsWith` / HMAC / `digest`).

## 4. Field-specific callback identity (pure closed union)

`lib/communication/providers/metaCallbackIdentity.ts` is a **pure** authority — no I/O, clock,
randomness, DB, or network. `decideCallbackIdentity(payload, expected)` returns a **closed union**:

```
{ kind: "authorized"; classes } | { kind: "rejected"; reason } | { kind: "unsupported" }
```

Field-specific rules:

| Callback class (`change.field`)            | Required identity                                   |
|--------------------------------------------|-----------------------------------------------------|
| `messages`                                 | exact WABA id (`entry.id`) **AND** exact `value.metadata.phone_number_id` |
| `message_template_status_update`           | exact WABA id (`entry.id`) only                     |
| account fields (`account_update`, …)       | exact WABA id (`entry.id`) only                     |
| anything else                              | not identity-bearing → contributes nothing          |

- **`display_phone_number` is never trusted.** The only phone identity is the opaque `phone_number_id`.
- Ids must match the exact grammar `^[0-9]{1,64}$`; a present-but-malformed id is `malformed_*`, an
  absent id on a supported change is `unprovable_*`, a valid-but-different id is `foreign_*`.
- The authority never trusts its caller: a malformed **expected** identity authorizes nothing
  (`malformed_expected_identity`).

## 5. Whole-payload availability debt

The interim policy is **whole-payload fail-closed**: if **any** supported change in the payload carries a
foreign / malformed / unprovable identity, the **entire payload** is rejected. A payload with a valid
change **and** a foreign change is rejected wholesale. This is an intentional **availability debt** — a
legitimate change riding alongside a bad one is dropped. **Per-change isolation** (processing the good
changes and discarding only the bad ones) is **deferred to Phase 8B-2**.

A payload that carries **no** supported identity-bearing change at all is `unsupported`, never
`authorized` — it is safely acknowledged with zero effects (§7).

## 6. Zero-DB foreign path & production chokepoint ordering

The single authoritative pipeline lives in `services/metaWhatsAppWebhookService.ts` as
`handleMetaWhatsAppWebhookPostBytes` (production **byte entry point**). The **historical public symbol**
`handleMetaWhatsAppWebhookPost` is now the **gated compatibility string wrapper** (correction): it encodes
the raw string to its exact UTF-8 bytes and delegates **directly** to `handleMetaWhatsAppWebhookPostBytes`,
holding no independent verification, decode, parse, identity, or downstream path. So every existing importer
of the historical symbol is now gated — there is no identity-exempt legacy path. Order:

1. signature header presence
2. signature configuration (app secret only)
3. exact byte grammar + HMAC over the **exact bytes**
4. fatal UTF-8 decode (**only after** the signature is proven)
5. JSON parse
6. identity configuration (WABA id + phone-number id only)
7. pure identity authority
8. **identity rejection OR unsupported acknowledgement — terminal, zero effects**
9. runtime webhook-processing DB gate
10. existing downstream classification / processing

The identity gate (steps 6–8) runs **before** the runtime DB gate (step 9) and before every downstream
effect. A `rejected` decision returns `200 rejected_foreign_identity`; an `unsupported` decision returns
`200 acknowledged_unsupported_identity_shape`. Both terminate at step 8 with **zero** database calls,
receipt writes, message mutations, inbound persistence, consent processing, response-intent enqueue,
provider-state effects, or provider/network calls. The public HTTP response stays generic (`{ ok: true }`,
200) and never leaks the identity decision.

The downstream stage (runtime gate → classify → process, behaviour-identical to Phase 5F-B/8A) now lives in
the **non-exported** `processVerifiedExpectedMetaWebhook` (correction). It is **not exported** and **not
route-reachable**; the byte entry calls it **only after** the identity gate authorizes, and it receives the
already-verified signature + already-parsed payload. There is therefore **no exported or route-accessible
function** that can invoke the downstream without the identity authority: the route calls the byte entry, the
historical `handleMetaWhatsAppWebhookPost` symbol is the gated wrapper over the byte entry, and both reach the
downstream only for an authorized callback.

## 7. Unsupported-only zero-DB acknowledgement; no rejection receipt

An unsupported-only callback (no actionable identity-bearing class) is acknowledged with **zero DB
calls** and **no receipt** (`acknowledged_unsupported_identity_shape`). Phase 8B-1A deliberately creates
**no rejection receipt** on the foreign path either — a rejection receipt would itself be a database write
on a path that must have zero effects, and recording one for every misrouted/foreign callback is an
un-audited write amplification. Receipt design for rejected callbacks is out of scope here.

## 8. Byte / string shared-pipeline equivalence

For equivalent **valid UTF-8** input, the byte entry point and the compatibility string wrapper produce
the **same identity-authority decision and the same downstream branch** (the wrapper encodes the string to
its exact UTF-8 bytes, and Node's `HMAC.update(string)` over UTF-8 equals `HMAC.update(bytes)`). The
dedicated harness proves this equivalence and proves the wrapper is **not** a bypass (a foreign identity is
rejected through the wrapper with zero DB + zero network).

## 9. Why Phase 5F-B required a controlled fixture transfer

The Phase 5F-B webhook behavioural check (`40-49`) previously drove the downstream directly with
identity-less fixtures. Once the identity gate exists, that behaviour must be exercised **through** the
gate. The 5F-B compatibility block was therefore transferred (and **only** that block, plus the minimum
supporting `setMetaEnv()`/fixture constants): `setMetaEnv()` now sets grammar-valid test `WHATSAPP_WABA_ID`
+ `WHATSAPP_PHONE_NUMBER_ID` (fixed numeric test ids; **no** access token); the inbound/template/account
fixtures carry their real callback identity so identity-valid callbacks reach the existing downstream; the
unknown fixture stays unsupported and now asserts `acknowledged_unsupported_identity_shape` with a
before/after **receipt-count proof of zero writes**. The registration structure is preserved exactly
(functional 60, mutation 63, total 123/123); no mutation was deleted, disabled, skipped, or given the
compile-rejection false-pass pattern.

## 10. Governance: the D3-B freeze remains intact

Phase 5F-B is intentionally modified while still **pinned** to its Phase 8B-0 blob in the D3-B byte-freeze.
D3-B is therefore **expected to fail** at exactly that byte-freeze authority boundary, naming
`scripts/phase5f-b-whatsapp-cloud-api-harness.mjs` and requiring an authority transfer / re-pin. The freeze
is **not** weakened or bypassed here. The controlled commit structure (not authorized yet) will later:
Commit 1 = the nine Phase 8B-1A files (including the reviewed 5F-B fixture update); Commit 2 = D3-B only,
with a fixed 8B-1A historical range and a new current 5F-B byte baseline pinned to Commit 1.

## 10b. Governance: the D4-B webhook harness needs a controlled stub update

The correction that gates the **historical** `handleMetaWhatsAppWebhookPost` symbol has a knock-on effect on
the D4-B consent-command-response harness (`scripts/phase5f-d4b-consent-command-response-harness.mjs`, **not**
in the authorized Phase 8B-1A scope). D4-B white-box-drives `handleMetaWhatsAppWebhookPost` from an **isolated
single-file build** with a **fixed stub set frozen to the pre-8B-1A function surface**: it stubs
`verifyMetaWebhookSignature` / `classifyMetaWebhook` but not `verifyMetaWebhookSignatureBytes`,
`decideCallbackIdentity`, or `resolveWebhookIdentityConfig`, and its inbound fixture carries a non-numeric
`entry.id` (`"WABA"`) with no identity env set. Now that the historical symbol routes through the gated byte
pipeline, D4-B's six `W-*` webhook behavioural checks throw `TypeError: verifyMetaWebhookSignatureBytes is not
a function` (D4-B → 44/50). This is a **test-infrastructure gap in a frozen harness, not a production
regression** — production is strictly *safer* (no ungated path). The clean resolution is a **controlled D4-B
webhook-stub + fixture update** (add the three new stubbed symbols, set a grammar-valid identity env, use a
numeric WABA), which is a **tenth file** outside this authorization — exactly the D3-B-style deferred
authority transfer. It is recorded here for the follow-up.

## 11. Deferred / out of scope

- **Provider-account binding** (binding a callback to an approved `communication_provider_accounts`
  row / `provider_account_id`) is **deferred to Phase 8B-1B**. Phase 8B-1A does not add
  `provider_account_id` and does not narrow `identity.classes` into a message binding.
- **Per-change isolation** (replacing the whole-payload fail-closed policy) is **deferred to Phase 8B-2**.
- No CommunicationService modification; no migration/SQL; no rejection-receipt schema.
- **No deployment and no provider activation.** Sending stays disabled; Meta/WhatsApp/n8n/MCP are not
  configured or invoked; no real network endpoint is called.
