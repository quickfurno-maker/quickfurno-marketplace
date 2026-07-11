# QuickFurno — Phase 5F-C3-C-2

## Dormant Isolated SMS Provider Canary Readiness + Health Probe Infrastructure

**Status: CODE-ONLY. SHIPPED OPERATIONALLY DISABLED. THIS PHASE SENDS NO SMS.**

C3-C-2 adds a single server-only service, `services/smsProviderCanaryProbeService.ts`
(`probeSmsProviderCanaryReadiness`), that answers one question — *"is the SMS transport
infrastructure ready for a future, controlled, founder-hash canary send?"* — and then **stops**.
It performs **no send**, **no DB writes**, and has **no public route**. It is reachable only as a
server-side function.

---

## An isolated infrastructure probe

The canary probe is **not** an authentication action, an auth fallback, a C1 decision, an auth
attempt, a Supabase OTP event, a business communication, a campaign, or an n8n workflow. It is an
**isolated infrastructure readiness probe**.

### Why it bypasses C1 / auth

A real authentication send is orchestrated by C1 (fallback decision → attempt ledger →
policy/failure-rule) because it carries a **real client OTP** tied to a **user session**. The
canary carries neither: it uses a **synthetic numeric test code** that is not a Supabase OTP,
never an authentication authority, and never linked to a session. Routing it through the auth
orchestration would (a) require a live failure rule / enabled policy we deliberately do not have,
and (b) risk entangling an infrastructure test with real authentication state. So the probe
**imports and calls none** of: `decideAuthenticationFallback` / `evaluateAuthenticationFallback`,
`claimPrimaryAttempt` / `claimFallbackAttempt` / `finalizeAttempt`, the
`authentication_delivery_attempts` ledger, `authentication_transport_failure_rules`,
`verification_challenges`, the Supabase Send-SMS hook, or Supabase OTP generation.

### Why bypassing auth does NOT mean bypassing runtime safety

Bypassing authentication does **not** relax infrastructure safety. The probe still requires the
full Phase 5F-C2 SMS runtime gate to be ready, and — because it is a canary — it adds a stricter
constraint on top. It fences the provider identity three ways, honours the runtime policy's
health-check toggle, demands a fully healthy provider, and proves the reviewed content boundary
resolves. Everything below is enforced before the probe reports readiness.

---

## Exact destination hash handling

The founder phone enters only in request memory. It is validated with the existing canonical
`normalizePhoneE164`/`isNormalizablePhone` and hashed **immediately** with the existing
`hashPhoneE164` (SHA-256). Only the non-reversible **`destinationHash`** enters the runtime
readiness query, the canary allowlist lookup, and any sanitized result. The plaintext founder
phone is never persisted, logged, returned, or passed into a provider — and since C3-C-2 sends
nothing, it never reaches a provider send method at all.

## Exact canary activation requirement

The probe requires `evaluateSmsRuntimeReadiness` to return `SMS_RUNTIME_READY` **and** the runtime
**activation to be exactly `canary`**. Full production `active` is **not** acceptable here: a
canary probe must never silently operate under full production activation. This is the one place
the canary readiness rule is *stricter* than the general send gate.

## Provider identity fence

Three independent fences, none derived from another: the runtime decision's `providerKey`; the
Phase 5F-C2 `createRuntimeSmsProvider` fence (adapter must equal the selected candidate); and the
probe's own check that `adapter.providerKey === decision.providerKey && adapter.channel === "sms"`.
No aliasing, trim-repair, case-folding, provider-family matching, or silent substitution — and a
mock adapter can never substitute for a live provider.

## Provider health check

A health check runs **only** when the runtime policy has `health_check_enabled = true` (reusing the
existing runtime-policy authority — parity with the Meta health service; no second toggle). When
eligible, the probe performs **exactly one** read-only `healthCheck()`. The health result must
carry the exact provider identity and `sms` channel, and must be `configured === true`,
`reachable === true`, `status === "healthy"`. A thrown check fails closed as a sanitized
`HEALTH_CHECK_FAILED` — no raw provider error, exception text, or secret leaks. The health check is
advisory observation only: it authorizes no fallback, creates no failure rule, enables no policy,
marks no row healthy, and mutates nothing.

> To expose the policy's health-check flag to this probe, `SmsRuntimePolicyRow` gained a
> `health_check_enabled` projection (parity with `MetaRuntimePolicyRow`). **The send gate
> (`evaluateSmsRuntimeGate`) does not consult it** — outbound eligibility is still decided only by
> `outbound_enabled` + `activation_status`. This projection changes nothing about who may send.

## Reviewed content resolution

The probe reuses the C3-C-1 renderer `resolveAuthenticationSmsContent` (there is no second
renderer). It proves the **exact runtime mapping** resolves through the reviewed QuickFurno content
boundary: reviewed key == mapping template key, language match, category `authentication`, provider
template name present, provider template id present, and a valid synthetic code. The rendered body
is **readiness evidence only** — it stays in the stack frame and is never returned, logged, or
persisted. Health readiness is not message authorization.

## Synthetic code handling

The input field is named `syntheticCanaryCode` — **not** `otp` — to make clear it is not a Supabase
OTP. It is mapped onto the renderer's only accepted field name at the renderer boundary. It exists
only in request memory and is never persisted, logged, returned, written to any ledger, linked to a
session, or treated as authentication authority.

## Result vocabulary

`SMS_CANARY_PROBE_READY` (with `readiness = READY_FOR_CONTROLLED_CANARY`) or
`SMS_CANARY_PROBE_BLOCKED` with a stable identifier-shaped reason: `INVALID_INPUT`,
`RUNTIME_NOT_READY`, `ACTIVATION_NOT_CANARY`, `PROVIDER_UNAVAILABLE`, `PROVIDER_IDENTITY_MISMATCH`,
`HEALTH_CHECK_DISABLED`, `HEALTH_CHECK_FAILED`, `HEALTH_IDENTITY_MISMATCH`, `PROVIDER_UNHEALTHY`,
`RESOLVED_CONTENT_UNAVAILABLE`. The result carries only non-secret facts (status, reason, provider
key, a destination **hash**, activation, boolean readiness flags) — never a phone, synthetic code,
rendered body, raw provider response, or credential.

---

## No SMS send in C3-C-2

This is the load-bearing guarantee. The probe **never** calls `sendResolvedAuthenticationSms`,
`sendAuthenticationMessage`, `CommunicationService.send`, or any provider send/transport endpoint.
The only provider method it invokes is the read-only `healthCheck()`. A harness statically proves
there is **zero** send call site in the service, and a mutation proves an introduced send is caught.

## No public route

C3-C-2 adds no `app/api` route, `pages/api` route, admin action button, public server action,
webhook route, cron, queue consumer, n8n webhook, or CLI that sends SMS. A server-only service
module and its tests are the entire surface.

## No DB writes, no activation

Every collaborator is a **read-only** projection. The probe never marks a provider healthy, never
changes `readiness_status` / `configuration_status` / `activation_status` / `outbound_enabled`,
never activates a canary destination, never creates or updates a template mapping, never creates a
failure rule, and never enables authentication transport or Meta. There is no migration, no SQL, and
no `.env` change in this phase.

---

## The current canary table is an allowlist, not a one-shot consumption ledger

`communication_provider_canary_destinations` is a **hash allowlist** (`provider_key`, `channel`,
`destination_hash`, `is_active`, `approved_by_*`, `reason_sanitized`, `expires_at`). It is **not a
durable one-shot consumption ledger**: it has no `consumed_at`, no `consumed_by`, no atomic claim, no
send count, and no one-time token.

Therefore C3-C-2 **does not claim** that the current table guarantees exactly one send, and it
**does not** fake an in-memory one-shot guarantee or build a reusable live-send endpoint. Readiness
is readiness; it is not a consumption record. **The one-shot execution guarantee is an explicit open
concern for C3-C-3C** and must be designed there (e.g. a durable atomic claim / one-time token /
consumption ledger) before any real canary send is permitted.

## The real one-shot send is deferred

No real provider canary SMS may be sent until, at minimum:

- **C3-C-3A** — external Exotel account readiness + India DLT registration + approved sender/header +
  approved OTP content template.
- **C3-C-3B** — body/runtime/secrets reconciliation: the reviewed placeholder body is reconciled to
  byte-match the externally registered DLT content; reviewed runtime rows (provider account / runtime policy with
  `activation_status='canary'` + `health_check_enabled=true` / template mapping / a single founder-hash
  canary row) are prepared and applied under review; VPS secrets are set.
- **C3-C-3C** — the controlled founder-hash **real** canary: a durable one-shot/replay-control
  procedure plus explicit approval, then a single observed send.
- **C3-D** — the final activation audit before authentication SMS fallback is enabled for real users.

Until then, everything here remains dormant and disabled.

---

## Tests

`npm run test:phase5f:c3c2` — input/secrecy, runtime-gate reuse (via the **real** C2 gate:
not-allowlisted / inactive / expired / provider / channel / active-blocked / canary-continues),
provider identity fence, health-toggle + single health call + identity + unhealthy handling +
sanitized failure, reviewed content resolution, the authority boundaries, the no-send guarantees,
and no-activation/no-route — plus mutation tests A–G proving each critical guard is load-bearing
(remove canary-activation check, remove adapter identity fence, remove health identity fence, allow
unhealthy, remove content guard, replace the hash with the plaintext phone, and introduce a send
call).

The `SmsRuntimePolicyRow` projection widening is the only change to a prior module; it is additive
and the send gate ignores it, so all earlier harnesses remain unchanged and green.

---

## What this phase does NOT claim

It makes **no** claim of: DLT registration approval, an operational Exotel account, a configured
provider, a healthy provider, an existing canary row, any real canary delivery, or an active SMS
fallback. Those remain future, external, and gated behind the C3-C-3 steps and the C3-D activation
audit.
