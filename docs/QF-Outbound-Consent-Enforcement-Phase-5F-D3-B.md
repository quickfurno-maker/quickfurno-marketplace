# QuickFurno — Phase 5F-D3-B

## Outbound Consent Enforcement Coordinator

D3-B makes D2-C's consent decisions **binding on outbound sends**. It creates **no second consent
authority**: D2-C remains the sole read-only consent/suppression decision authority, and this phase only
*adapts* and *enforces* it.

```
CommunicationService.dispatchMessage        clientLoginOtpDeliveryOrchestrator (SMS fallback)
            │                                              │
            └──────────────► outboundConsentEnforcementService ◄──────────────┘
                                        │   (the ONE coordinator)
                                        ▼
                          decideCommunicationConsent  (D2-C — sole authority)
```

`CommunicationService`, provider adapters, Meta, SMS, n8n and Jarvis consume **only a closed
authorization outcome**. None of them ever sees a disposition, a preference row, or a suppression row.

---

## Founder-approved rulings (final)

1. `client_nurture_followup` is **marketing**.
2. `dormant_requirement_reactivation` is **marketing**.
3. Unknown or mismatched message types are **blocked**.
4. An ephemeral authentication destination **always** uses `identityConfidence: "unknown"` and
   `principal: null`.
5. **No** new consent audit table, column or migration.
6. **One** provider-neutral coordinator covers WhatsApp (through `CommunicationService`) and the direct
   SMS authentication fallback.
7. **RCS is excluded.**
8. **Exactly one** authoritative consent check per dispatch attempt — after destination resolution and
   before the claim/provider call. **No pre-insert consent read.**

---

## The scope registry (`lib/communication/outboundConsentScope.ts`)

The ledger's `lane` vocabulary is only `('authentication', 'business')` — it **cannot** distinguish
transactional from marketing. Deriving a scope from the lane alone would let a marketing message be judged
under transactional rules, which is precisely how marketing default-deny gets bypassed. So the scope comes
from an **exact, closed, per-message-type registry**.

| Scope | Lane | Message types |
|---|---|---|
| **authentication** | authentication | `client_login_otp`, `vendor_whatsapp_verify`, `vendor_password_reset` |
| **transactional** | business | `lead_received`, `vendor_new_lead`, `clarification_request`, `clarification_reminder`, `lead_assignment_alert`, `low_credit_warning`, `recharge_reminder`, `admin_policy_block_alert`, `admin_assignment_failure_alert`, `admin_provider_outage_alert`, `admin_automation_failure_alert` |
| **marketing** | business | `client_nurture_followup`, `dormant_requirement_reactivation` |

**All three of (message type, template key, lane) must match the approved entry.** Matching on the type
alone would let a template swap or a lane swap inherit another message's consent scope.

**Fail closed, always:**
- an **unknown** message type is **blocked** — never "probably transactional", never "probably marketing";
- a known type with a **different template key** is blocked;
- a known type under the **wrong lane** is blocked;
- there is **no wildcard and no prefix rule**. Each `admin_*` alert is written out explicitly, so a future
  `admin_`-prefixed type cannot be silently classified without review.

An unclassified or mismatched message **never reaches the database at all** — there is nothing to ask the
authority about an unreviewed send.

---

## The coordinator (`services/outboundConsentEnforcementService.ts`)

The only module permitted to interpret a D2-C disposition.

**Input** — the minimum facts, and nothing that could be abused: `channel`, `messageType`, `templateKey`,
`lane`, `destinationHash`, `destinationSource`, `recipientType`, `recipientId`.

It **never** accepts a plaintext phone, an OTP, a message body, a webhook payload, or — critically — a
**caller-selected scope, identity confidence, principal or policy version**. A caller that could choose its
own scope or claim its own identity would be interpreting consent. All of those are **derived**.

**Output** — a closed authorization outcome:

| Kind | Codes | Retryable |
|---|---|---|
| `allow` | *(carries the resolved scope)* | — |
| `deny` | `CONSENT_SUPPRESSED`, `CONSENT_NOT_GRANTED`, `UNCLASSIFIED_MESSAGE_TYPE`, `MESSAGE_TYPE_TEMPLATE_MISMATCH`, `MESSAGE_LANE_SCOPE_MISMATCH` | **no** |
| `unavailable` | `CONSENT_AUTHORITY_UNAVAILABLE` | **yes** |
| `invalid` | `CONSENT_ENFORCEMENT_INVALID`, `CONSENT_AUTHORITY_INTEGRITY` | **no** |

An `allow` means **the consent layer passed and nothing more**. The authentication action, transport policy,
auth deadline, transactional basis, template/mapping gate, provider runtime gate and canary all remain
separate authorities that must *also* pass.

The outcome carries **no** destination hash, plaintext destination, principal id, matched preference or
suppression id, raw D2-C row, database error, SQLSTATE, stack, OTP or message body.

### Disposition mapping

| Scope | Allows | Denies | Anything else |
|---|---|---|---|
| **authentication** | `no_consent_objection` | `blocked` → `CONSENT_SUPPRESSED` | **fail closed** (`invalid`) |
| **transactional** | `no_consent_objection` | `blocked` → `CONSENT_SUPPRESSED` | **fail closed** (`invalid`) |
| **marketing** | **only** `marketing_opted_in` | `blocked` → `CONSENT_SUPPRESSED`; `unknown` → `CONSENT_NOT_GRANTED` | **fail closed** (`invalid`) |

**Marketing default-deny.** Absence of consent is never consent. A stale (policy-version-mismatched)
preference returns `unknown` from D2-C and is therefore a **deny** — it can never authorize marketing.

### D2-C failure mapping

| D2-C result | Outcome | Retryable |
|---|---|---|
| `INVALID_DECISION_INPUT` | `invalid` / `CONSENT_ENFORCEMENT_INVALID` | no |
| `AUTHORITY_LOOKUP_FAILED` | `unavailable` / `CONSENT_AUTHORITY_UNAVAILABLE` | **yes** |
| `AUTHORITY_INTEGRITY_VIOLATION` | `invalid` / `CONSENT_AUTHORITY_INTEGRITY` | no |
| a thrown dependency | `unavailable` / `CONSENT_AUTHORITY_UNAVAILABLE` | **yes** |

A failure is **never** an allow.

---

## Identity derivation (the caller can never upgrade it)

**A. `ephemeral_auth_destination` → always `unknown` / `null`.**

The destination was *supplied by the caller* — a first-time client login OTP, a vendor typing the number
they want verified, a password-reset number, the SMS fallback. It is **not proven** to belong to the
recipient. **The presence of `recipient_id` must never upgrade it to `exact`**: doing so would consult
vendor A's consent record for a destination that may belong to somebody else entirely — a wrong-subject
decision, and for marketing a consent-laundering hole.

**B. `recipient_reference` → `exact`, but only when the binding is genuinely provable:** the destination
was *resolved from* the canonical recipient record, the recipient type is a real consent principal
(`client`/`vendor`/`admin`), and the id is a well-formed UUID. Anything else — a missing id, a malformed id,
an `integration`/`system` recipient — stays `unknown`. Never guessed, never a first match.

`unknown` is always **safe**: suppressions are destination-hash scoped, so they still apply in full, and
marketing still default-denies (an unknown identity can never produce `marketing_opted_in`).

---

## The single gate in `CommunicationService`

```
dispatchMessage:
  1. foreign-channel guard          (fail closed, zero provider calls)
  2. foreign-provider identity fence
  3. auth-lane redispatch guard
  4. resolveDispatchDestination      ← destination + hash verified
  5. ★ D3-B CONSENT ENFORCEMENT ★    ← the ONE authoritative check
  6. terminalize (deny/invalid) or continue
  7. claimMessageForDispatch         ← atomic claim
  8. approved-mapping / runtime / template gates
  9. invokeProvider                  ← the network call
```

### WhatsApp enforcement order

```
destination resolution
→ destination integrity check
→ message scope resolution
→ consent authorization
→ compare-and-set terminalization when blocked
→ dispatch claim
→ provider/runtime/template/canary gates
→ provider invocation
```

The **destination integrity check** is the hash comparison inside `resolveDispatchDestination`
(`DESTINATION_HASH_MISMATCH` for a pre-resolved destination; `RECIPIENT_DESTINATION_CHANGED` when the
recipient's number changed after enqueue — the message is never silently re-routed). **Message scope
resolution** happens inside the coordinator, from the closed registry, *before* D2-C is consulted — so an
unclassified or mismatched message never reaches the database at all.

### Channel handling is a closed map, never a coercion

`toEnforcementChannel` maps `whatsapp → whatsapp` and `sms → sms`, and **nothing else**. An `rcs` row — or
any future channel added to the ledger vocabulary — returns `null` and **fails closed** *before* consent
authorization, *before* the claim and *before* any provider invocation. It is **never** coerced to
WhatsApp: a channel we cannot ask D2-C about must not inherit another channel's consent decision. There is
no fallback-to-WhatsApp path.

### Why the gate sits before the claim

This is forced by the state machine, not by taste:

```
queued          → dispatching, failed, cancelled   ✅
retry_scheduled → dispatching, failed, …, cancelled ✅
dispatching     → accepted, sent, failed, …          ❌ NO edge to cancelled
```

Checking consent *after* the claim would leave the row in `dispatching`, where a denial **cannot** be
recorded as `cancelled` without a new transition — i.e. a migration. Checking before the claim keeps the
row in `queued`/`retry_scheduled`, where `→ cancelled` already exists. **This single ordering constraint is
what makes a no-migration D3-B possible.**

### Why there is no pre-insert consent read

A pre-insert check would be a *second* decision that the dispatch-time check must re-take anyway, and its
result would already be stale by the time the message is dispatched. Founder rule 8 fixes **exactly one**
authoritative check, at dispatch. That one check automatically re-evaluates consent for **immediate sends,
future scheduled sends and every retry** — so a STOP created after enqueue but before dispatch **is
observed**.

### Ledger handling

| Outcome | Provider call | Ledger action | `failed_at` | Caller |
|---|---|---|---|---|
| `allow` | yes | normal lifecycle | — | success |
| `deny` (suppressed / not granted / registry) | **none** | compare-and-set `queued`\|`retry_scheduled` → **`cancelled`**, `next_retry_at = null`, sanitized closed code | **not set** — nothing failed; we declined to send | the cancelled message |
| `invalid` / integrity | **none** | compare-and-set → **`failed`**, `next_retry_at = null` | set | the failed message |
| `unavailable`, **authentication** | **none** | compare-and-set `queued` → **`failed`** | set | the failed message |
| `unavailable`, **business** | **none** | **status unchanged** | — | a sanitized **retryable** failure |

The two `unavailable` lanes diverge deliberately. An **authentication** row can never be re-dispatched (the
OTP is never persisted), so leaving it queued would leak a permanently undeliverable row; it becomes
`failed`, and the user simply requests a fresh OTP. A **business** row *is* re-dispatchable, so a transient
authority blip must never destroy a legitimate message — it is left untouched for a future dispatch to
re-evaluate.

### Compare-and-set terminalization

Cancellation and failure update by **`id` AND the exact status we read**. If another worker claimed or moved
the row in between, **zero rows match**: we return the existing safe `MESSAGE_ALREADY_CLAIMED` outcome and —
critically — **the provider is never called on either side**. An unconditional update would clobber a row
another worker is already dispatching.

---

## The runtime factory is the production enforcement boundary

`createRuntimeCommunicationService` now constructs `CommunicationService` with the runtime-selected
provider, the active recipient resolver, the Meta outbound coordinator **and the real consent enforcer** —
the enforcer parameter is defaulted, so production can never build a service without it.

The enforcer is *optional* on the `CommunicationService` constructor purely so the many historical harnesses
that construct it directly stay source-compatible. That is a deliberate, guarded trade-off: the D3-B harness
**statically proves that every production send path builds its service through the runtime factory**, and it
would catch a future production direct construction that omits consent enforcement. (The only other
permitted direct construction is the webhook service, which processes delivery receipts and never sends.)

---

## The SMS bypass, closed

The SMS authentication fallback was **the one real direct-provider bypass** in the repository: it reached the
SMS provider with a plaintext phone and **no consent check at all**.

It now gets its **own `channel: "sms"` decision**, in this order:

```
1. fallback transport policy allows SMS
2. SMS runtime gate succeeds
3. SMS provider identity matches
4. reviewed SMS body resolves
5. ★ D3-B SMS CONSENT DECISION ★     ← before the deadline check and before the claim
6. remaining auth deadline is checked
7. fallback attempt 2 is claimed
8. provider call
9. attempt finalized
```

The ordering is fixed and load-bearing:

```
consent → deadline → fallback claim → provider → finalize
```

**A WhatsApp consent decision never authorizes SMS.** An sms-scoped or global suppression blocks the OTP here
even when WhatsApp would have been allowed.

### Absence is never authorization

The enforcer is an **injectable dependency**, but a **missing dependency never means an allow**. There is
**no implicit-allow branch anywhere in production code**:

- when the enforcer is **not injected**, the orchestrator **lazily loads and calls the real outbound consent
  coordinator** (`await import("./outboundConsentEnforcementService")`) — it does not fabricate a decision.
  The import is lazy only so an isolated build that never runs this path need not resolve the module;
- a **dynamic-import failure** or a **coordinator exception** is treated as **consent authority unavailable**
  (`SMS_CONSENT_AUTHORITY_UNAVAILABLE`) and **blocks the SMS**. There is **no catch-to-allow path**;
- **denied**, **unavailable**, **invalid** and **authority-integrity** outcomes all **block before the
  fallback claim and before any SMS provider invocation**.

On any non-allow — including an unobtainable decision: **no fallback claim, no SMS provider call, no OTP
regeneration, no OTP persistence** — just a sanitized closed block reason (`SMS_CONSENT_DENIED`,
`SMS_CONSENT_AUTHORITY_UNAVAILABLE`, `SMS_CONSENT_ENFORCEMENT_INVALID`). The phone, hash, OTP, D2-C reason,
suppression id, preference id and any raw error are **never** in the result or the log.

**No D2-C disposition is reinterpreted inside the OTP orchestrator.** It consumes only the coordinator's
closed outcome (`allow` / `deny` / `unavailable` / `invalid`) and never sees a disposition, a preference row
or a suppression row.

### Test harnesses may inject an allow; production cannot

The isolated legacy SMS harnesses (`phase5f-c3b`, `phase5f-c3c1`) build their own dependency objects and do
not contain the coordinator module. They therefore **explicitly inject a deterministic test enforcer** that
returns an `allow` outcome for the successful-fallback scenarios. That `allow` exists **only inside the
harness dependency object** — it is a test double. **Production has no implicit allow branch at all**, which
the D3-B harness proves as an absolute (the orchestrator source contains no `{ kind: "allow" }` literal), and
which two load-bearing mutations lock shut: reintroducing an implicit allow on an absent dependency, or
turning the `catch` into a catch-to-allow, each make the D3-B suite fail.

---

## Authentication safety

A user STOP can never block an OTP: D2-D's locked policy writes only `marketing` and `transactional`
suppressions — never `global` and never `authentication` — and D2-C queries only `global` + the exact scope
(authentication has no exact suppression scope). **A global suppression, however, does block authentication**,
which is correct and intended.

Absence of a preference is never an opt-in, and never blocks a valid auth attempt: the authentication scope
returns `no_consent_objection` when no preference row exists.

---

## The unavoidable race window (stated honestly)

**There is no transaction spanning the Supabase consent read and the external provider request, and D3-B does
not claim one.** A STOP committed inside the window `consent read → claim → provider call` can still be
followed by **one** in-flight send. The gate makes that window as small as it can be — the read is the last
thing before the claim, and the claim is the last thing before the network call — but it **cannot** eliminate
it. Any design that claimed otherwise would be claiming atomicity across an external HTTP boundary, which is
not achievable.

---

## What D3-B does not do

- **No migration**, no new column, no new message status. Every outcome is representable with the existing
  status vocabulary (`cancelled` and `failed` already exist, with legal edges from `queued` and
  `retry_scheduled`).
- **No reuse of `policy_decision_id`** — that field belongs to the Phase 4 policy engine, and conflating the
  two would corrupt its audit trail.
- **No durable consent-result storage.** Nothing is written to `metadata`; the coordinator writes nothing at
  all.
- **No provider activation** (Meta, Exotel, SMS, RCS all remain exactly as they were), no n8n, no RCS send
  path, no environment change, no route change.
- **No modification of D2-C, D2-D or D2-E.**

---

## Verified test results

| Harness | Result |
|---|---|
| `test:phase5f:d3b` | **62 / 62** (functional 45, mutation 17) |
| `test:phase5f:b` | **123 / 123** — unchanged from its base-commit count |
| `test:phase5f:c3c1` | **44 / 44** |

The two legacy SMS harnesses were extended, never weakened: the D3-B harness asserts that no `check(` or
`assert(` line was removed from either, and that their check/assertion counts only grew.

### Known baseline-equivalent failures

The following harnesses report a failure that is **not** a behavioural or security failure, and **none was
introduced by D3-B**. They must not be "fixed" by weakening a test.

| Harness | Failure | Nature |
|---|---|---|
| `phase5f:c2` | stale newest-migration pin | Present at the base commit. The harness pins a "newest migration" from before D2-D, so D2-D's `20260712000300` trips it. |
| `phase5f:c3a` | stale newest-migration pin / dirty authority-file guard interaction | Present at the base commit. With D3-B uncommitted, a dirty-worktree guard on `communicationService.ts` trips first; once committed that clears and the same pre-existing migration pin fires. |
| `phase5f:c3b` | stale newest-migration pin | Present at the base commit. |
| `phase5f:d1a` | dirty-worktree guard before commit | Asserts `communicationService.ts` is not dirty. Clears on commit. |
| `phase5f:d1b` | dirty-worktree guard before commit | Same guard. Clears on commit. |

The first three were verified against a temporary worktree at the base commit `27eb59f` and fail there
identically. They need their own harness-stabilisation phase — the same drift class already corrected for
D2-D and D2-E.

### Mandatory debt

> **The optional CommunicationService consent enforcer must be removed or made fail-closed before Meta
> production provider activation.**

This debt is **not resolved**. Today the enforcer is optional on the `CommunicationService` constructor
(`null` ⇒ the gate is skipped) purely so the historical harnesses that construct the service directly stay
source-compatible. It is unreachable in production — every send-capable path builds through
`createRuntimeCommunicationService`, which always injects the real enforcer, and the D3-B harness proves
this statically — but that proof is a **grep-based fence, not a structural impossibility**. Before any real
provider is activated it must become structurally impossible to construct a send-capable
`CommunicationService` without consent enforcement.

---

## Rollback

Plain code revert. There is no migration, no schema change, no data written, and no provider or environment
change to unwind. Reverting the D3-B commit restores the previous behaviour exactly: the consent enforcer
becomes unbound, `dispatchMessage` skips the gate, and the SMS fallback returns to its pre-D3-B path. No
message is left in an inconsistent state, because a denial only ever writes an already-legal status
(`cancelled` / `failed`).
