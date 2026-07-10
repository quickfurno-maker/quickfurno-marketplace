# QuickFurno — SMS Provider & Runtime Foundation (Phase 5F-C2)

> **SMS is not live.** Phase 5F-C2 builds the provider-neutral SMS runtime foundation only.
> No commercial provider has been chosen or connected, no credential exists, no real send
> path exists, no SMS webhook exists, no fallback is enabled, and **no migration was
> created** — the generic Phase 5F-A/5F-B registries already support `sms`.
>
> India DLT / regulatory readiness remains **external and pending**. No DLT approval is
> claimed.

---

## 1. Authority boundaries

Unchanged, and nothing in this phase moves them.

| Concern | Authority |
|---|---|
| `client_login_otp` OTP + session | **Supabase Auth** |
| `vendor_whatsapp_verify` challenge state | **`verification_challenges`** |
| `vendor_password_reset` challenge state | **`verification_challenges`** |
| Business communication authorization | **Phase 4 Policy Engine** |
| Communication message ledger + dispatch | **CommunicationService** |
| Authentication fallback decision | **Phase 5F-C1** decision engine + attempt ledger |
| Channel selection | Transport policy — *never* an authentication authority |
| Provider selection | Infrastructure policy — *never* an authentication authority |

**QuickFurno Core** holds truth, policy and state. **Jarvis** offers intelligence and
recommendations. **n8n** is an approved execution fabric and is **never** an OTP,
password-reset, session, identity, or fallback-decision authority. **Providers** are
external delivery infrastructure and nothing more.

**Provider readiness never authorizes a fallback.** A provider that is technically
configured, healthy and approved has been granted nothing.

## 2. The locked transport model (owned by C1, restated)

One auth action. One OTP authority. One OTP value.

```
attempt 1 — WhatsApp
attempt 2 — SMS (optional)         maximum: 2 transport attempts per auth action
```

Never `WhatsApp → SMS → WhatsApp`. Never `WhatsApp → SMS → SMS retry`. Never a fallback
after `accepted`. Never a fallback after `unknown_outcome`. Only a proven
`definitive_failure` may even be *considered* by the C1 decision engine — and even then it
additionally requires an operational transport policy, an explicit active failure rule,
provider readiness, a runtime infrastructure gate, an attempt budget, and an atomic attempt
claim.

`vendor_whatsapp_verify` remains **WhatsApp-only, forever**.

## 3. What already existed and is REUSED (no duplicate tables)

Phase 5F-C2 creates **no migration**. The generic registries already carry SMS:

| Table | What C2 uses |
|---|---|
| `communication_provider_runtime_policies` | `channel = 'sms'`, `activation_status`, `outbound_enabled` |
| `communication_provider_accounts` | `channel = 'sms'`, `readiness_status`, `configuration_status`, `health_status` |
| `communication_provider_template_mappings` | `channel = 'sms'`, `provider_category`, `approval_status`, `is_active`, `language` |
| `communication_provider_canary_destinations` | `channel = 'sms'`, `destination_hash`, `is_active`, `expires_at` |

Also reused: the provider-neutral `SmsProvider` contract, `MockSmsProvider`, and the
abortable `HttpTransport`. There is **no** SMS-specific template table, account table, or
runtime table, and none will be created.

## 4. Provider-neutral approach — no commercial provider selected

C2 names **no** commercial vendor. Not MSG91, Exotel, Twilio, Gupshup, Kaleyra, Plivo,
Vonage, or AWS SNS. The provider-mode vocabulary is **closed** and contains exactly one
value:

```
SMS_PROVIDER_MODE = mock        // the deterministic test/dev adapter
```

No real adapter, no credential, no HTTP endpoint, and no webhook route exists. The runtime
resolution boundary does not even *name* an adapter: it takes a caller-injected factory and
applies a provider-identity fence to whatever that factory returns.

## 5. Production fail-closed selection

`services/smsProviderSelection.ts` is **lazy** — resolved per request, never at import time,
so a missing environment variable can never break the build.

| Environment | `SMS_PROVIDER_MODE` | Result |
|---|---|---|
| non-production | absent | controlled **mock** |
| non-production | `mock` | controlled **mock** |
| non-production | anything else | **fail closed** — `unsupported_provider_mode` |
| **production** | absent | **fail closed** — `mode_required_in_production` |
| **production** | `mock` | **fail closed** — `mock_forbidden_in_production` |
| **production** | anything else | **fail closed** — `unsupported_provider_mode` |

Production is **unconditionally closed**: there is no implicit mock fallback, an unknown
mode never silently becomes mock, and a mock may never carry a live OTP.

## 6. Outcome-certainty rules (one definition, every channel)

`lib/communication/providers/providerOutcome.ts` now holds the single definition.
`whatsappProvider.ts` re-exports the type and both helpers under their historical names, so
every existing WhatsApp import keeps working unchanged and Phase 5F-B semantics are
preserved exactly.

| Rule | |
|---|---|
| `accepted` | ⟺ `accepted === true`. Nothing else may claim acceptance. |
| `accepted = false` with certainty `accepted` | contradictory → effective `unknown_outcome` |
| `accepted = true` with certainty `definitive_failure` | contradictory → effective `unknown_outcome` |
| missing certainty at an unsafe boundary | effective `unknown_outcome` |
| invalid certainty | effective `unknown_outcome` |
| `unknown_outcome` | **never** retry authorization |

Certainty is **never** inferred from `accepted === false`, from `retryable === true`, from
the existence of an HTTP error, from the existence of a timeout, or from the existence of a
provider exception. Those facts say nothing about whether the provider accepted the request.

## 7. Timeout semantics

- A real adapter **must** use the repository's abortable `HttpTransport`. The
  `AbortController` cancels the **actual** request.
- **`Promise.race` is forbidden.** A race rejects the waiter while the request keeps
  running — that is a duplicate-OTP hazard.
- `SmsAuthenticationSendOptions.maxNetworkTimeoutMs` is a **ceiling**. It may only
  **shorten** the adapter's configured timeout; it can never extend it
  (`resolveSmsNetworkTimeoutMs` = `min(configured, ceiling)`).

## 8. Transport certainty semantics

| Transport fact | Certainty | Retryable |
|---|---|---|
| aborted request (timeout) | `unknown_outcome` | never |
| ambiguous network failure (`ECONNRESET`, `EPIPE`, unclassified, …) | `unknown_outcome` | never |
| ambiguous 5xx response | `unknown_outcome` | never |
| 2xx **without** a usable provider message id | `unknown_outcome` | never |
| 2xx **with** a usable provider message id | `accepted` | n/a |
| explicit provider rejection (4xx) | `definitive_failure` | no |
| **proven** pre-connect failure (`ENOTFOUND`, `ECONNREFUSED`, …) | `definitive_failure` | yes, at transport level |

`classifyTransportCertainty` covers **provider-independent** HTTP/socket facts only. It
deliberately does **not** interpret any provider's response body, error codes, or API-level
semantics. A real adapter added in C3/C4 **must** classify its own provider's payload
explicitly; generic code cannot guess it, and pretending otherwise would silently mislabel a
delivered message as a proven failure.

## 9. No SMS retry loop

Even where a low-level result marks a **proven** pre-connect failure as technically
retryable, **Phase 5F-C1's attempt budget remains authoritative: a maximum of two transport
attempts per authentication action, ever.**

Phase 5F-C2 introduces **no** resend loop, no scheduler, no `setTimeout`/`setInterval`, and
calls `permitsAutomaticRetry` nowhere. The only `sendAuthenticationMessage` implementation
in C2 is the mock adapter's, and no C2 service calls it.

## 10. Runtime readiness gate

`lib/communication/providers/smsRuntimeGate.ts` is **pure**: no database, no environment, no
network, no provider call, and no clock (`now` is supplied when expiry matters). It fails
closed on the first failing condition.

Its vocabulary is deliberately infrastructural:

```
SMS_RUNTIME_READY  |  SMS_RUNTIME_BLOCKED
```

There is **no** `FALLBACK_ALLOWED` and there never will be.

### Provider account requirements

- exists, unique for `(provider, sms)` — **ambiguity fails closed**
- `provider_key` matches the candidate; `channel = 'sms'`
- `readiness_status = 'provider_ready'` — `account_ready` is **not** enough, and
  `not_configured`, `credentials_pending`, `webhook_pending`, `template_mapping_pending`
  and `disabled` all block
- `configuration_status = 'complete'`

### Health readiness requirements

`health_status = 'healthy'`. An **authentication** transport refuses `degraded` as well as
`unhealthy` and `unknown`: an OTP that arrives late is an OTP that has already expired.

### Authentication template mapping requirements

An SMS authentication mapping is usable **only** when all hold:

- `channel = 'sms'`
- `provider_key` matches the candidate provider
- `template_key` matches
- `language` matches
- `approval_status = 'approved'`
- `is_active = true`
- `provider_category = 'authentication'`
- a non-empty registered `provider_template_name` (the DLT content template) — **never
  fabricated**

C2 **evaluates** readiness; it never fabricates it. No approved SMS template mapping is
seeded. **No DLT approval is claimed.**

### Ambiguity handling

More than one active provider account, or more than one approved+active mapping, **fails
closed**. Readiness must never depend on which row a query happened to return first — which
is also why the read service queries broadly and lets the pure gate discriminate.

### Canary semantics

`activation_status = 'canary'` requires **one active, unexpired canary row** whose
`(provider_key, channel = 'sms', destination_hash)` matches exactly. A wrong hash, an
inactive row, an expired row, an unparseable expiry, or a row belonging to another provider
or channel all block. Destinations are compared **hash to hash**; a plaintext number never
enters the gate.

### Active semantics

`activation_status = 'active'` requires **no** canary row. Every other check still applies.
`disabled`, `readiness_only`, `shadow` and `paused` never permit outbound, and
`outbound_enabled = false` blocks even under `active`.

## 11. Runtime readiness ≠ fallback authorization

This is the single most important boundary in the phase.

`SMS_RUNTIME_READY` means only: *"the infrastructure could carry an SMS right now."*

It is **not** permission to send, and it is **not** a fallback authorization. Whether an
authentication action may fall back to SMS is decided **only** by Phase 5F-C1's
`evaluateAuthenticationFallback`, which additionally requires an operational transport
policy, an explicit **active** failure rule (default-deny), a **proven** `definitive_failure`
primary outcome, an unspent attempt budget, legal attempt lineage, and an **atomic attempt
claim** — and which forbids `vendor_whatsapp_verify` outright.

`services/smsProviderRuntimeService.ts` is **read-only**: no insert, no update, no upsert,
no delete, no RPC. `services/runtimeSmsProviderService.ts` sends nothing, claims no attempt,
calls no C1 decision, and touches no ledger.

## 12. No policy activation

After C2:

- `authentication_transport_failure_rules` remains **empty**.
- `client_login_otp` — `automatic_fallback_enabled = false`, `user_requested_fallback_enabled = false`, `fallback_policy_status = 'disabled'`, `is_operationally_enabled = false`, `fallback_provider_key = null`.
- `vendor_password_reset` — the same disabled state.
- `vendor_whatsapp_verify` — no fallback channel at all.
- No SMS provider account, SMS runtime policy, SMS template mapping, or SMS canary row is created.
- Meta remains inactive.

Nothing in C2's sources contains an `insert into`, an `outbound_enabled = true`, or any
reference to `authentication_transport_policies`.

## 13. C3 integration boundary

Phase 5F-C3 may:

1. choose a commercial SMS provider **after review** and add its mode to the closed
   vocabulary in `smsProviderSelection.ts`;
2. add a real adapter implementing `SmsProvider`, using the abortable `HttpTransport`, that
   classifies **its own** provider payload into `accepted` / `definitive_failure` /
   `unknown_outcome` explicitly;
3. add server-only credentials as environment variables (never committed);
4. create the provider account row and drive it to `provider_ready` + `complete` + `healthy`;
5. register DLT content templates and record the approved mappings with
   `provider_category = 'authentication'`.

C3 may **not** enable a fallback, seed a failure rule, or change an authentication authority.

## 14. C4 integration boundary

Phase 5F-C4 may wire the actual attempt-2 dispatch, and only in this order:

```
C1 decision engine says ALLOWED
  → C2 SMS runtime gate says SMS_RUNTIME_READY
    → C1 atomic fallback attempt claim succeeds
      → the SAME OTP, from request memory, is re-sent over SMS
        → C1 finalizes the attempt outcome
```

It must reuse the **same OTP value** from request memory (never generate a second one),
never persist an OTP, never persist a plaintext destination, and never exceed two transport
attempts per authentication action. `vendor_whatsapp_verify` never enters this path.

## 15. India DLT readiness — external and pending

Entity onboarding, sender/header registration, OTP content-template registration, the
approved content-template mapping, the delivery-receipt webhook, cost monitoring, abuse
controls, the outage runbook, and test-number validation all remain **outstanding**. See
`docs/QF-SMS-Authentication-Fallback-Readiness.md`. **Do not claim DLT approval exists. Do
not activate SMS.**
