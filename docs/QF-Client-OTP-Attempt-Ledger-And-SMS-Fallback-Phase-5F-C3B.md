# QuickFurno — Client OTP Attempt Ledger + Optional SMS Fallback (Phase 5F-C3-B)

> **This phase ships operationally disabled.** It wires `client_login_otp` to the Phase
> 5F-C1 attempt ledger and adds an *optional* SMS fallback path. In production nothing
> changes: the transport policy is not operationally enabled,
> `authentication_transport_failure_rules` is **empty** (default deny), and no Exotel
> runtime policy, provider account, template mapping or canary row exists.
>
> **No SMS is sent. No provider is activated. No fallback is enabled. No migration was
> created.** India DLT registration remains external and pending (Phase 5F-C3-C), and the
> Exotel adapter still refuses to send without an approved, DLT-registered template.

---

## 0. What this phase does NOT do

| Not done | Still true after this phase |
|---|---|
| No migration, no SQL | Newest migration is still C1's `20260710000100_…` |
| No `.env` change | No new variable is read or written |
| No fallback enablement | Policy rows stay `is_operationally_enabled = false` |
| No change to the C1 decision engine | `authenticationTransportDecision.ts` is byte-for-byte unchanged |
| No change to the Exotel adapter internals | `exotelSmsProvider.ts` is byte-for-byte unchanged |
| No second OTP, ever | The fallback re-sends the **same** value from request memory |
| No OTP persistence, no plaintext phone persistence | Only a SHA-256 destination hash reaches the ledger |
| No retry loop, no queue, no n8n | At most two transport attempts per authentication action |
| `vendor_whatsapp_verify` / `vendor_password_reset` untouched | Structurally forbidden from ever reaching SMS |
| No UI change | — |

## 1. Authority boundaries

Restated unchanged. Nothing in this phase moves them.

| Concern | Authority |
|---|---|
| `client_login_otp` OTP + session | **Supabase Auth** — it generates the OTP; we only transport it |
| Challenge state for the vendor flows | **`verification_challenges`** |
| Business communication authorization | **Phase 4 Policy Engine** |
| Message ledger + dispatch | **CommunicationService** |
| Fallback decision | **Phase 5F-C1** `evaluateAuthenticationFallback` |
| Attempt race safety | **Phase 5F-C1** atomic RPCs — never this orchestrator |
| Channel / provider selection | Transport + infrastructure policy — *never* an authentication authority |

The orchestrator in `services/clientLoginOtpDeliveryOrchestrator.ts` is a **coordinator**.
It decides nothing. Every gate it consults can only say *no*.

## 2. The flow

Signature verification and payload parsing are unchanged and happen before any of this.

1. verified hook received (signature verification **unchanged**)
2. parse `authUserId`, `phoneE164`, `otp`
3. derive the auth action id from the **verified** `webhook-id` (`deriveClientLoginActionId`)
4. hash the destination (`hashPhoneE164`)
5. claim attempt 1 atomically — `auth_flow = client_login_otp`,
   `auth_reference_type = auth_user`, `auth_reference_id = <Supabase auth user id>`,
   `destination_hash = <phone hash>`, `provider_key = <runtime WhatsApp provider>`
6. send WhatsApp with the **same OTP** from request memory
7. finalize attempt 1 from the WhatsApp outcome
8. `accepted` → success, **no fallback**
9. `unknown_outcome` → `delivery_uncertain`, **no fallback**
10. `definitive_failure` → evaluate the C1 fallback decision
11. decision blocked → `delivery_failed`
12. decision allowed → evaluate the C2 SMS runtime gate
13. verify the runtime SMS provider identity **equals** the provider the decision allowed
14. check the remaining budget, then claim the fallback attempt atomically
15. claim fails → **do not send SMS**
16. send the **same OTP** over SMS
17. finalize attempt 2
18. hook response comes from attempt 2's outcome

Step 9 is the one that matters most. An `unknown_outcome` may already have reached the
handset; falling back would deliver a **second** OTP. It is parked, never retried.

## 3. Deadline — one budget, both attempts

`AUTH_HOOK_TOTAL_BUDGET_MS` (5000 ms) is started once, at the route's POST entry, before the
bounded body read. Both attempts spend from it.

Before claiming the fallback attempt the orchestrator re-reads
`deadline.remainingNetworkBudgetMs()`. If it is below
`MIN_VIABLE_AUTH_NETWORK_BUDGET_MS` (500 ms) it **does not claim and does not send**: a
request started with no time left would abort mid-flight and park as `outcome_unknown` — a
possible silent second OTP. The remaining budget is then passed to the SMS adapter as a
**ceiling**, which can only shorten its abortable timeout, never extend it. The total budget
is never exceeded.

This is not a `Promise.race`. The ceiling drives the adapter's `AbortController`, so a
timed-out request is genuinely cancelled rather than merely abandoned.

## 4. Failure-rule safety — default deny, and a deny-only local guard

A `definitive_failure` is **not** automatically fallback-eligible. Many definitive failures
are *local*: a missing credential, an unrendered template, a spent hook budget, a provider
identity mismatch. Falling back would hide the misconfiguration behind a second channel and
a second bill, forever.

Two independent defences:

* **Default deny (authoritative).** Fallback requires an explicit, active, unambiguous row
  in `authentication_transport_failure_rules`, scoped to the provider that *actually* owned
  attempt 1. **The table is empty.** No code path can create one.
* **Local/preflight deny-list (belt and braces).** `isLocalPreflightFailureCode` refuses to
  even *ask* for a fallback on codes like `AUTH_NETWORK_DEADLINE_EXHAUSTED`,
  `META_OUTBOUND_CONFIG_MISSING`, `EXOTEL_RESOLVED_TEMPLATE_REQUIRED`,
  `SMS_PROVIDER_IDENTITY_MISMATCH`, or `VALIDATION`. It is **deny-only**: returning `false`
  grants nothing, and an absent or unsanitizable code fails closed as local.

## 5. Identity fence

Two fences, neither derived from the other:

* `createRuntimeSmsProvider` (Phase 5F-C2) checks the adapter against the **selected
  candidate**;
* the orchestrator independently checks `adapter.providerKey` against the provider the **C1
  decision allowed**, and `adapter.channel === "sms"`.

A mismatch blocks **before** the fallback attempt is claimed and **before** any send.
`services/runtimeSmsAdapterFactory.ts` is the only file that constructs an SMS adapter, and
it never constructs the mock — a mock may never carry a live OTP.

## 6. The ledger is best-effort for the primary, authoritative for the fallback

**The Phase 5F-C1 ledger is live.** `public.authentication_delivery_attempts` and
`public.authentication_transport_failure_rules` exist, and both RPCs
(`qf_claim_auth_delivery_attempt`, `qf_finalize_auth_delivery_attempt`) exist. On a healthy
database a claim always resolves, so the degraded path below **cannot occur** — the harness
proves it (§7a). The `client_login_otp` transport policy is `is_operationally_enabled =
false`, so the hook returns `service_unavailable` and this orchestrator does not run in
production at all yet.

Best-effort is therefore an availability decision, not a schema-readiness one — an
availability guarantee, nothing more. A
*transient* database fault — a dropped connection, a statement timeout, a failover — must
never deny a legitimate user their login. So if a claim cannot be recorded, the WhatsApp
primary **still goes out**, and the degraded state is **made observable**: a sanitized
`ledger_unavailable` security event is emitted (§6a). A fallback then becomes **impossible**:
without a claimed, finalized attempt 1 there is no lineage to fall back from, and the
orchestrator refuses to synthesize one. `ledgerUnavailable` and a claimed fallback attempt
can never both be true in the same action.

A *structural* claim refusal (attempt limit, lineage mismatch, invalid request) is different:
the OTP is **not dispatched at all**, because a second delivery is the one thing this design
forbids. An `ALREADY_EXISTS` replay of the same verified action re-enters the idempotent
CommunicationService dispatch, which observes the same row and re-sends nothing.

### 6a. The degraded path is observable, never silent — two signals, DB-independent first

`ledgerUnavailable` fires precisely when the database cannot be reached. Since
`auth_security_events` lives in **that same database**, a security-event write would fail in
the exact outage this safeguard exists for. So the orchestrator emits **two** best-effort
signals, in this order:

1. **A DB-independent server log line, FIRST.** A single `console.error` under a fixed,
   greppable prefix `[auth.client_login_otp.ledger_unavailable]`, carrying the `auth_flow`, a
   `reason` of `ledger_unavailable`, and the sanitized failure classification. It touches no
   database, so it is the **only** degraded-path signal that survives a total DB outage.
2. **The richer `auth_security_events` row, SECOND.** `recordAuthSecurityEvent`, event type
   `client.otp_request_failed`, with the same sanitized fields plus the SHA-256 destination
   hash. Useless when the database is down, but valuable in the narrower case where the RPC
   is broken while the database is healthy.

Neither signal ever carries the OTP, the plaintext phone, the destination-hash pre-image, or
any raw database error text. The classification is derived only from the claim's
already-sanitized structural detail (an identifier or nothing); the Phase 5A sanitizer drops
secret-looking keys and rejects raw identifiers on the event path.

Both emits are **best-effort** and both run *after* the OTP has already been dispatched. Each
is wrapped in its own `try/catch`, so a throw from either — a broken logger, a rejected
promise, an unreachable table — is swallowed. The OTP send always proceeds; observability can
never gate or delay a login.

## 7. What is never persisted, logged, or returned

The OTP; the plaintext phone number; the raw provider response; the hook secret or
signature; the raw `webhook-id`. The destination reaches the ledger only as a non-reversible
SHA-256 hash, and the authentication action only as its derived 64-character SHA-256
identity. Neither the orchestrator nor the outcome-mapping module contains a single
`console` call, and only allowlisted identifier-shaped failure codes reach the ledger.

## 8. Vendor flows

`vendor_whatsapp_verify` proves possession of a WhatsApp destination; an SMS cannot. The
orchestrator serves exactly one hardcoded flow, `client_login_otp`, and names no vendor flow.
The pure C1 engine refuses the vendor flow before any enable flag is read, and the claim RPC
refuses it again under a table CHECK. Three independent refusals.

## 9. Known technical debt — the bare SMS send method

On the (currently unreachable) allowed path, the orchestrator calls the SMS adapter's **bare**
`sendAuthenticationMessage(to, templateKey, variables, options)`. For the Exotel adapter that
method is a deliberate preflight refusal: it always returns a definitive
`EXOTEL_RESOLVED_TEMPLATE_REQUIRED` failure and **never puts a message on the wire**, because
Exotel requires an approved, DLT-registered *resolved* template descriptor that does not exist
yet.

Switching the orchestrator to `sendResolvedAuthenticationSms(...)` — building that resolved,
DLT-registered descriptor from the runtime gate's mapping — is **deferred to Phase 5F-C3-C**,
which provisions the Exotel account and completes India DLT registration. Until then this is
an additional, structural reason no SMS can be sent: even with every gate forced open, the
send preflight-fails. It is recorded here as known technical debt.

## 10. What comes next

| Phase | Scope |
|---|---|
| **5F-C3-C** | Exotel account provisioning + India **DLT** registration; switch to `sendResolvedAuthenticationSms` — external, pending |
| **5F-C4** | SMS runtime activation, canary, and the first real fallback enablement |

## 11. Tests

```
npm run test:phase5f:c3b     # this phase — functional + mutation
npm run test:phase5f:c3a     # Exotel adapter (unchanged internals)
npm run test:phase5f:c2      # SMS runtime foundation
npm run test:phase5f:c       # C1 decision engine + attempt ledger (unchanged)
npm run test:phase5d         # client WhatsApp OTP hook (behaviour preserved)
```

The C3-B harness drives the orchestrator with injected fake collaborators: no database, no
network, no real provider, no real credential, and no SMS.
