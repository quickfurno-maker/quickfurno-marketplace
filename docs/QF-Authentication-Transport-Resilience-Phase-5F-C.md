# QuickFurno — Authentication Transport Resilience (Phase 5F-C)

**Subphase 5F-C1 — Transport Decision Engine & Atomic Attempt Ledger Foundation**

> **SMS is not live.** Phase 5F-C1 builds decision authority and attempt-ledger safety only.
> No SMS vendor has been chosen, no SMS credential exists, no SMS message can be sent, and
> every fallback is blocked by construction. Migration
> `20260710000100_auth_transport_resilience_decision_foundation.sql` is **NOT applied**.

---

## 1. Authority boundaries

These never merge, and nothing in this phase moves them.

| Concern | Authority |
|---|---|
| Client login OTP + session | **Supabase Auth** |
| `vendor_whatsapp_verify` challenge state | **`verification_challenges`** |
| `vendor_password_reset` challenge state | **`verification_challenges`** |
| Business communication authorization | **Phase 4 Policy Engine** |
| Communication message ledger + dispatch | **CommunicationService** |
| Channel selection | Transport policy — *never* an authentication authority |
| Provider selection | Infrastructure policy — *never* an authentication authority |

**n8n is never** an OTP authority, a password-reset authority, a session authority, an
identity authority, or a fallback decision authority. It does not appear anywhere in this
phase. Neither does Jarvis.

A provider being technically configured, ready, or healthy **never** authorizes a
communication, and it never makes a fallback eligible.

## 2. One OTP authority — the same OTP, reused in memory

A fallback is a **second transport attempt for one OTP**, never a second OTP.

- The OTP is generated exactly once, by the existing authority (Supabase Auth, or the
  Phase 5E challenge issuer).
- If a fallback is ever executed in a later subphase, it re-sends **the same value**,
  carried in **request memory only**.
- The OTP value is never persisted, never logged, never hashed into audit metadata,
  never written to `authentication_delivery_attempts`, and never written to
  `communication_messages.variables` on the authentication lane.

Nothing in this phase accepts an OTP argument. The claim RPC, the finalize RPC, the pure
decision engine, and both services are OTP-free by construction, and the harness proves it
by scanning the migration, the RPC signatures, and the source.

## 2b. Authentication ACTION vs authentication REFERENCE

The two-attempt budget belongs to **one authentication action**, never to a long-lived
identity. Confusing the two would mean the first login a user ever performs permanently
consumes that user's attempt-1 slot.

| Concept | Column(s) | Meaning |
|---|---|---|
| **Auth reference** | `auth_reference_type` + `auth_reference_id` | *Who/what* is being authenticated. Long-lived. |
| **Auth action** | `auth_action_id` | *This specific* OTP issuance/delivery operation. |

`auth_action_id` is stored as a **deterministic, domain-separated SHA-256 digest** —
exactly 64 lowercase hex characters. The raw authoritative identifier is **never stored**.

> An earlier revision stored the raw identifier behind `^[A-Za-z0-9_.:-]{1,128}$`. That
> pattern accepts `483920` and `919876543210`, so it never structurally prevented an OTP or
> a phone number from being persisted as the action identity. A blacklist cannot prove that
> negative. A 64-character lowercase hex digest can: it is, by construction, not a one-time
> code, not an MSISDN, and not a raw payload.

```
auth_action_id = SHA256( "qf-auth-action:v1" | NUL | authFlow | NUL | sourceKind | NUL | authoritativeActionId )
```

Derived by `deriveAuthenticationActionId` in
`lib/communication/authenticationActionIdentity.ts`. No salt, no clock, no environment
variable, no HMAC key: this is stable identifier derivation, not authentication and not
confidentiality. The fields are NUL-separated and the authoritative id may contain no
control character, so no two distinct triples can collide by concatenation ambiguity.

The digest is **non-secret**. It is **not** an OTP hash, **not** a phone hash, **not** a
destination identity, **not** an authentication proof, and **not** a password-reset token.
Possessing it authorizes nothing.

The derivation input is **never** an OTP, a phone number, a destination hash, a password, a
session token, an access token, a provider credential, or a raw request body — and it is
**never browser-supplied**.

The `sourceKind` vocabulary is closed:

| Auth flow | `sourceKind` | authoritative action id (never stored) | `auth_reference_type` | `auth_reference_id` |
|---|---|---|---|---|
| `client_login_otp` | `supabase_webhook` | the signature-**verified** Supabase Standard Webhooks `webhook-id` | `auth_user` | the Supabase Auth user id |
| `vendor_whatsapp_verify` | `verification_challenge` | the server-created `verification_challenges.id` | `verification_challenge` | challenge id |
| `vendor_password_reset` | `verification_challenge` | the server-created `verification_challenges.id` | `verification_challenge` | challenge id |

The `webhook-id` must come from the **signature-verified** server-side hook context — the
same header whose Standard Webhooks signature already validated, and which is already the
correlation and idempotency key on the communication path. An arbitrary browser-supplied
webhook id is never authority.

Because `authFlow` and `sourceKind` are part of the digest, one
`verification_challenges.id` derives **different** action identities under
`vendor_whatsapp_verify` and `vendor_password_reset`. Each server-created verification or
reset challenge is its own authentication action.

The identity is enforced at three independent layers: a branded TypeScript type plus a
runtime `^[0-9a-f]{64}$` guard in the attempt service (which fails closed **before** the
database), the same pattern re-checked inside the claim RPC before any ledger mutation, and
`chk_auth_attempt_action_id_shape` on the table itself.

A Supabase Auth user legitimately performs **many OTP logins** over its lifetime. Each is a
new action and legally begins a fresh `attempt 1 [, attempt 2]` sequence — repeated login
actions for one auth user are fully supported:

```
user-123 + hook-A  →  attempt 1 (whatsapp)  [, attempt 2 (sms)]
user-123 + hook-B  →  attempt 1 (whatsapp)  [, attempt 2 (sms)]   ← independent
user-123 + hook-A  →  idempotent: the SAME attempt 1 is returned
```

Reusing an action id under a **different** flow, reference, or destination hash is a
lineage error (`action_identity_conflict`), never idempotency. And one action can never
fall back from another action's primary — `hook-B` cannot use `hook-A`'s failed WhatsApp
attempt, even though both belong to `user-123`.

`auth_reference_type` and `auth_reference_id` are **preserved**: a fallback must still
match them, so an action id alone can never re-target a different account.

A later integration service must derive `auth_action_id` only from the authoritative
server-side auth action described above. Nothing in this phase reads it from a request
body, a query string, or a cookie.

## 3. The transport model

Maximum two transport attempts per authentication action.

```
attempt 1 — WhatsApp primary
   |
   +-- accepted            -> stop. No fallback.
   |
   +-- unknown_outcome     -> park. NO fallback, ever.
   |
   +-- definitive_failure  -> fallback decision engine
                                -> policy check
                                -> explicit failure-rule eligibility check
                                -> (later) SMS readiness check
                                -> atomic fallback claim
                                -> attempt 2 — SMS fallback
```

Structurally impossible, at the database level as well as in the engine:

- `WhatsApp → SMS → WhatsApp`
- `WhatsApp → SMS → SMS retry`
- concurrent SMS fallback attempts
- a fallback after `outcome_unknown`
- a fallback after `accepted` / `sent` / `delivered` / `read`
- **any** SMS fallback for `vendor_whatsapp_verify`

RCS is **never** an authentication channel — not primary, not fallback. There is no RCS
auth path in this phase and the policy table's CHECK constraint forbids one.

## 4. `accepted` → no fallback. `unknown_outcome` → no fallback.

`unknown_outcome` means the provider outcome could be **neither proven nor disproven**: a
timeout, an aborted request, an ambiguous network error, an ambiguous 5xx, or a 2xx with no
usable message id. The OTP may already have arrived on the user's phone.

Falling back here would deliver a **second copy of the same OTP over a second channel**,
double the cost, and confuse the user — for a message that very likely succeeded. So an
unknown outcome is *parked*: it is a terminal state for this phase, it can never be
rewritten, and it can never anchor a fallback.

Only a **proven** `definitive_failure` — a certainty *and* a terminal status that agree —
may even be considered.

## 5. Default-deny failure rules

A definitive failure is **not** automatically fallback-eligible.

Most definitive failures are *local configuration problems*:

- template mapping missing
- runtime gate disabled
- provider account not ready
- outbound configuration missing
- template render failure
- provider identity mismatch

Silently falling back to SMS would hide every one of these behind a second channel and a
second bill, forever, while the WhatsApp integration stays broken.

So eligibility lives in `authentication_transport_failure_rules`, which **ships EMPTY**:

| Column | Meaning |
|---|---|
| `auth_flow` | `NULL` = provider-wide rule; otherwise an exact flow |
| `primary_channel` | `whatsapp` only in Phase 5F-C |
| `primary_provider_key` | the provider whose failure this is |
| `failure_code` | sanitized, identifier-shaped |
| `failure_classification` | sanitized, identifier-shaped |
| `automatic_fallback_eligible` | default **false** |
| `user_requested_fallback_eligible` | default **false** |
| `is_active` | default **false** |

Behaviour:

- **no rule → blocked**
- **inactive rule → blocked** (and it never falls through to a broader tier: a deliberately
  de-activated specific rule must not be replaced by a permissive provider-wide one)
- **ambiguous active rules → blocked** (eligibility must never depend on row order)
- `automatic_fallback_eligible = false` → the automatic path is blocked
- `user_requested_fallback_eligible = false` → the user-requested path is blocked

### Precedence

An **exact `auth_flow` rule always beats a provider-wide rule.** Within a tier, more than
one active candidate is ambiguous and fails closed. Two partial unique indexes make that
ambiguity impossible at rest:

- `uq_auth_failure_rule_active_flow` — one active rule per `(auth_flow, channel, provider, failure_code)`
- `uq_auth_failure_rule_active_provider_wide` — one active rule per `(channel, provider, failure_code)` where `auth_flow is null`

A CHECK constraint additionally forbids any rule that would make `vendor_whatsapp_verify`
eligible, whatever an operator types.

## 6. Automatic vs user-requested fallback

They are **separate authorities**. Neither implies the other, and each is evaluated
independently by the pure engine.

**AUTOMATIC** requires *all* of:

1. a policy exists for this exact auth flow
2. the flow is not `vendor_whatsapp_verify`
3. `is_operationally_enabled = true`
4. `primary_channel = 'whatsapp'`, `fallback_channel = 'sms'`, a fallback provider is declared
5. `fallback_policy_status = 'automatic_ready'`
6. `automatic_fallback_enabled = true`
7. `hard_failure_only = true`
8. a primary attempt exists with legal lineage, the same auth reference and the same destination hash
9. the primary outcome certainty is exactly `definitive_failure`, with a terminal status
10. fewer than two attempts recorded, and no fallback attempt yet
11. an explicit, active, unambiguous rule sets `automatic_fallback_eligible = true`

**USER-REQUESTED** requires *all* of:

1. a policy exists for this exact auth flow
2. the flow is not `vendor_whatsapp_verify`
3. `is_operationally_enabled = true`
4. the same legal transport shape
5. `fallback_policy_status ∈ { 'manual_only', 'automatic_ready' }`
6. `user_requested_fallback_enabled = true`
7. the primary outcome is still safely **known**: never after `unknown_outcome`, never after `accepted`
8. legal lineage, matching auth reference and destination hash
9. fewer than two attempts recorded
10. an explicit, active, unambiguous rule sets `user_requested_fallback_eligible = true`

Phase 5F-C1 builds **only the decision capability**. There is no UI, no API endpoint, and
no dispatch path for a user-requested fallback.

## 7. `vendor_whatsapp_verify` is WhatsApp-only

That flow exists to prove **possession of the WhatsApp destination**. SMS possession is a
different claim. Allowing an SMS fallback would let an attacker who controls the SIM but
not the WhatsApp account complete a WhatsApp verification.

It is forbidden in four independent places:

1. the pure engine checks it *before* every operator toggle, so no flag can reach it;
2. the claim RPC refuses `attempt_number = 2` for that flow;
3. `chk_auth_attempt_whatsapp_verify_no_fallback` makes attempt 2 structurally impossible;
4. `chk_auth_failure_rule_whatsapp_verify_never_eligible` forbids an eligible rule for it;

and, from Phase 5F-A, `chk_auth_transport_whatsapp_verify_whatsapp_only` forbids the policy
row from declaring a fallback channel at all.

## 8. Attempt lineage

`authentication_delivery_attempts` records one row per transport attempt. It carries **no
OTP** and **no plaintext destination** — only `destination_hash`, the same non-reversible
hash `communication_messages` uses.

| Attempt | channel | `fallback_from_attempt_id` |
|---|---|---|
| 1 | `whatsapp` | `NULL` |
| 2 | `sms` | must reference attempt 1 |

Attempt 2 must carry the **same** `auth_flow`, `auth_action_id`, `auth_reference_type`,
`auth_reference_id` and `destination_hash` as attempt 1.

Enforced by:

- `chk_auth_attempt_number_max_two` — `attempt_number in (1, 2)`
- `chk_auth_attempt_shape` — the table above, as a single CHECK
- `chk_auth_attempt_whatsapp_verify_no_fallback`
- `chk_auth_attempt_status_certainty` — status and certainty may never contradict
- `chk_auth_attempt_action_id_shape` — `^[0-9a-f]{64}$` (a SHA-256 action identity)
- `chk_auth_attempt_sanitized_codes` — identifier-shaped codes only, so a raw provider
  payload (which could contain a phone number) cannot be stored
- `uq_auth_delivery_attempt_action_number` — no duplicate attempt number **per action**
- `uq_auth_delivery_attempt_fallback_lineage` — one fallback per primary
- `uq_auth_delivery_attempt_single_fallback` — one fallback **per action**

### The uniqueness authority moved from the reference to the action

Phase 5F-A made `(auth_reference_type, auth_reference_id, attempt_number)` unique. For
`client_login_otp` the reference is the Supabase Auth **user**, so that index would have
permanently blocked every login after the user's first. Phase 5F-C1 retires it:

1. read `pg_get_indexdef('uq_auth_delivery_attempt_number')`;
2. **fail loud** if it is missing, or if it has drifted from the exact 5F-A definition;
3. only then `drop index if exists public.uq_auth_delivery_attempt_number` — the *index*,
   never any row;
4. create `uq_auth_delivery_attempt_action_number (auth_flow, auth_action_id, attempt_number)`.

`auth_action_id` is added as nullable, and the migration **fails loud** rather than
backfill it: a pre-existing row cannot be given a trustworthy action id. Deriving one from
`auth_reference_id` would silently recreate the collision; from `destination_hash` it would
group attempts by phone number (and would even slip past the 64-hex CHECK); from
`communication_message_id` or a one-time code it would be meaningless or dangerous. Only
once every row carries a properly derived identity does the column become `NOT NULL`. No
historical data is ever deleted.

Cross-row lineage cannot be expressed safely by a CHECK alone, so it is enforced inside an
atomic database function.

### `qf_claim_auth_delivery_attempt`

`SECURITY DEFINER`, `search_path = public, pg_temp`, revoked from `public` / `anon` /
`authenticated`, executable **only** by `service_role`.

It takes no OTP, no plaintext phone, and no provider credential. It never decides
authentication success and never enables a policy. **The application decision engine must
run first** — the RPC is the *race-safety boundary*, not the business policy authority, and
it independently re-checks every structural property.

Concurrency is handled by a transaction-scoped advisory lock keyed on the **action** —
`pg_advisory_xact_lock(hashtextextended(auth_flow || ':' || auth_action_id, 0))` — plus
`FOR UPDATE` row locks. Two racing callers **for one action** can never both observe an
empty ledger, so a SELECT-then-INSERT race cannot produce two primaries or two fallbacks.
Two **distinct** login actions by the same auth user take different locks and never
collide. Including `auth_flow` keeps unrelated flows out of one another's lock namespace.
The unique indexes are the last line of defence.

Primary claim (attempt 1): requires `channel = 'whatsapp'` and a well-formed
`auth_action_id`; an identical replay of the same action returns `already_exists` with the
same attempt id; the same action id under a different flow, reference, or destination hash
returns `lineage_mismatch` / `action_identity_conflict`; a **different** action id for the
same auth user starts a new attempt 1.

Fallback claim (attempt 2): requires `channel = 'sms'` and an existing attempt 1 **for the
same action**, matching on flow, action id, reference and destination hash, with
`outcome_certainty = 'definitive_failure'` **and** a terminal status. It refuses
`accepted`, refuses `unknown_outcome`, refuses `vendor_whatsapp_verify`, refuses a second
fallback for that action, and links `fallback_from_attempt_id` to attempt 1. A fallback for
an action with no primary of its own returns `primary_required` — no cross-action fallback
is ever possible.

### `qf_finalize_auth_delivery_attempt`

Same security posture. Non-secret inputs only.

| Provider outcome | status | certainty |
|---|---|---|
| accepted | `accepted` / `sent` / `delivered` / `read` | `accepted` |
| definitive provider failure | `failed` / `cancelled` | `definitive_failure` |
| unknown provider outcome | `outcome_unknown` | `unknown_outcome` |

It refuses:

- contradictory pairs (`accepted` + `definitive_failure`, `failed` + `accepted`,
  `outcome_unknown` + `definitive_failure`, …)
- a terminal `accepted` attempt regressing to `failed`
- a proven `definitive_failure` regressing to an acceptance
- **any** rewrite of `outcome_unknown` — this is exactly how a bug (or an attacker) would
  manufacture fallback eligibility for an OTP that may already have been delivered

Verified provider-event reconciliation of a parked `outcome_unknown` is deliberately **not**
invented here; it belongs to a later, controlled integration.

## 9. Future SMS provider integration boundary

Phase 5F-C1 **chooses no SMS vendor**. There is no Twilio, MSG91, Exotel, AWS SNS, Plivo,
Kaleyra, Gupshup, Vonage, or any other SDK, credential, HTTP call, or webhook.

The intended later shape, for when an SMS provider is chosen:

```
CommunicationOutboundProvider      // common outbound capability
  ├── WhatsAppProvider             // + channel = whatsapp, + webhook capabilities
  └── SmsProvider                  // + channel = sms
```

That refactor is deliberately **not** performed in 5F-C1. Provider selection remains
infrastructure policy: a configured, ready SMS provider will still authorize nothing.

## 10. Activation checklist (do not perform now)

1. Apply `20260710000100_auth_transport_resilience_decision_foundation.sql` manually in the
   Supabase SQL editor. Verify the two RPCs are executable only by `service_role`.
2. Confirm `authentication_transport_failure_rules` is **empty** after apply.
3. Choose an SMS provider (a later subphase). Add credentials as server-only env vars.
   Create its `communication_provider_accounts` row and drive it to `provider_ready`.
4. Register and get approval for the SMS templates. Create the template mappings.
5. Set `authentication_transport_policies.fallback_provider_key` for
   `client_login_otp` and `vendor_password_reset`. Never for `vendor_whatsapp_verify`.
6. Insert **narrow** failure rules — one `failure_code` at a time, `is_active = false`
   first. Never a provider-wide `ANY_FAILURE` rule. Never a rule for a local configuration
   failure (missing mapping, disabled gate, unready account, render failure, identity
   mismatch): those must be fixed, not hidden.
7. Advance `fallback_policy_status` to `manual_only` and enable **user-requested** fallback
   first. Observe.
8. Only then advance to `automatic_ready`, set `automatic_fallback_enabled = true`, and
   confirm `hard_failure_only = true`.
9. Finally set `is_operationally_enabled = true` for one flow at a time.

## 11. Emergency disable path

Any **one** of these blocks every fallback immediately, with no deploy:

- `update authentication_transport_policies set is_operationally_enabled = false;`
  — the standing kill-switch for a flow.
- `update authentication_transport_policies set automatic_fallback_enabled = false;`
  — stops automatic fallback only; user-requested keeps working.
- `update authentication_transport_policies set user_requested_fallback_enabled = false;`
  — the mirror image.
- `update authentication_transport_policies set fallback_policy_status = 'disabled';`
  — blocks both modes at once.
- `update authentication_transport_failure_rules set is_active = false;`
  — default-deny reasserts itself for every failure code.

None of these touch the primary WhatsApp path: authentication keeps working, it simply
stops falling back. Because the decision engine is pure and reads the policy on every
evaluation, the change takes effect on the next request.
