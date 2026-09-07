# QF-MVP-50.7 — Governed Stale-Business Job Terminalization

**Status: SOURCE ONLY.** Nothing in this phase was deployed, applied or executed.

- **NO STAGING MUTATION PERFORMED**
- **NO PRODUCTION MUTATION PERFORMED**
- **NO META/WHATSAPP SEND PERFORMED**

The migration is registered SOURCE-PENDING in the staging-history manifest and
requires its own separate deployment gate.

---

## 0. What this lane is actually for — stated precisely

An earlier draft of this document and of the migration header claimed that a
stale-business job "retries forever". **That is false**, and the correction
matters because it changes the justification for the whole phase.

Repository truth:

| step | what happens |
| --- | --- |
| executor refuses | `QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE` (pre-communication, no send) |
| `lib/automation/clientExecutionContract.ts` rules it | `classification: definitive_failure` |
| `qf_complete_automation_attempt_v1` maps it | job status **`failed`** |
| retry timestamp | **none** — a terminal classification carrying one is rejected with `AUTOMATION_TERMINAL_RESULT_NEXT_RETRY_FORBIDDEN` |

So a stale job does **not** requeue and does **not** cycle. If it is claimed and
executed, normal execution already terminalizes it safely, without sending
anything. These rows sit in the queue only because nothing has executed them yet.

**QF-MVP-50.7 is governed pre-execution queue hygiene, not an infinite-retry
fix.** Its value is that it removes provably stale work:

- **without opening an execution attempt** — no attempt row, no `attempt_count`
  movement, no consumed claim slot;
- **without recording an attempt outcome** for a send that was never going to
  happen;
- **without forcing normal execution** merely to discover a business state Core
  can already prove beforehand.

It is the difference between "the queue learns this by running it" and "Core
knew, so it never ran".

## 1. Entity orphan vs business stale

QF-MVP-50.6 solved jobs whose business **entity** had been deleted. This phase
solves a different failure with the same symptom.

| | QF-MVP-50.6 `cancel_orphan_v1` | QF-MVP-50.7 `cancel_stale_v1` |
| --- | --- | --- |
| Entity | **missing** | **present** |
| Why terminal | there is nobody to talk to | there is nothing left to say |
| Reason code | `QF_AUTOMATION_ORPHAN_ENTITY_MISSING` | `QF_AUTOMATION_BUSINESS_STATE_NO_LONGER_ELIGIBLE` |

Both lanes call the **same** entity authority `qf_automation_entity_state_v1`,
one requiring `missing` and the other requiring `present`. They are therefore
**mutually exclusive by construction**: no job can qualify for both, and none
falls between them by accident.

A stale job's vendor still exists, still has a phone number, still has a healthy
account. Cancelling it through the orphan lane would record a reason that is
simply false.

## 2. Why `cancelled` is reused again

For the same reason 50.6 reused it: `automation_jobs.status` has included
`cancelled` since the original persistence migration, the job update guard has
always permitted `pending -> cancelled` and `retry_scheduled -> cancelled`, and
the shape constraints already handle it. A third terminal state would be a new
word every existing reader would have to learn, in exchange for nothing — the
`last_safe_code` already distinguishes *why*.

`last_result_classification` stays **null**. Writing `definitive_failure` would
fabricate the outcome of an attempt that never ran.

## 3. The closed v1 vocabulary

Four actions, each paired to exactly one entity type:

| action | entity_type |
| --- | --- |
| `vendor.response_reminder` | `lead_assignment` |
| `vendor.onboarding_reminder` | `vendor` |
| `vendor.package_expiry_warning` | `vendor` |
| `vendor.low_credit_warning` | `vendor` |

A wrong pairing is `unmapped` and is never terminalized.

**`vendor.lead_offer` is deliberately excluded.** Its only refusal is that the
assignment vanished or changed owner — that is entity truth, and it belongs to
the orphan lane. No client action and no campaign action is in scope.

## 4. The exact predicates

Stated once in `lib/automation/vendorBusinessEligibility.ts`:

- **response_reminder** — the durable source identity must end `:resp2h` or
  `:resp24h`; the assignment must exist, still belong to the resolved vendor, and
  its `vendor_status` must be exactly `New`.
- **onboarding_reminder** — a `vendor_crm_profiles` row must exist and its
  `onboarding_stage` must be exactly `new`.
- **package_expiry_warning** — the source identity's tail must be a 14-digit
  `YYYYMMDDHH24MISS` stamp; `package_status` must be `active`,
  `package_expires_at` non-null, and its formatted stamp must equal the bound one.
- **low_credit_warning** — the threshold comes from the active policy
  `vendor_low_credit_warning_threshold`; there is **no numeric fallback**, so an
  unconfigured threshold is a definitive refusal. The warning is stale once
  `remaining_credits > threshold` — note the comparison is strictly greater-than,
  so a balance *equal to* the threshold is still **eligible**.

Verdicts are closed: `eligible | stale | unmapped`. `unmapped` is not a soft
`stale`; the maintenance lane terminalizes only on a proven `stale`.

## 5. How predicate drift is prevented

This was the central design requirement, and it is solved structurally rather
than by discipline.

0. **Be honest about the shape.** This is *not* one executable predicate in both
   places. The maintenance lane's re-proof must run inside the mutating SQL
   transaction, where TypeScript cannot reach, so the migration carries a SQL
   **mirror** of the four maintenance predicates. What the phase guarantees is
   **one rule definition plus a transaction-bound mirror, guarded against drift**
   — not a single implementation everywhere.
1. The executor's rules live in **one pure module**, `vendorBusinessEligibility.ts`.
2. `automationVendorExecutionService` **no longer contains any rule**. It gathers
   facts with exactly the same queries as before and calls
   `decideVendorBusinessState`. There is nothing left in the executor to edit, so
   a rule change made "just in the executor" is impossible.
3. The SQL authority `qf_automation_vendor_business_state_v1` mirrors the module
   branch for branch, and the gate pins each predicate on **both** sides — change
   one alone and `M06` fails.
4. The gate **executes** the pure module over a case matrix (sections A–E) rather
   than grepping it, so a behaviour change fails even if the wording is identical.

**Where a failed read goes — precisely.** Every *direct business-row* PostgREST
error inside `gatherVendorBusinessFacts` returns `QF_EXEC_LEAD_LOOKUP_FAILED` and
never reaches the decider. There is one deliberate exception, and it **predates
this phase**: `readLowCreditThreshold` collapses a policy-config read error to
`null` (`if (error || !data) return null`), and the predicate then treats a null
threshold as a refusal. QF-MVP-50.7 does **not** change that, because doing so
would be a behaviour change smuggled into a refactor. If policy-read failures
should become infrastructure-transient, that is its own phase.

The SQL maintenance authority is *more* conservative than the executor here: a
genuine SQL query error aborts the cancellation transaction outright and is never
interpreted as staleness. That asymmetry is fail-closed in the direction that
matters, and it is stated rather than hidden.

The executor's observable behaviour is unchanged: it still distinguishes an
infrastructure lookup failure (`QF_EXEC_LEAD_LOOKUP_FAILED`) from a business fact,
and it still collapses both `stale` and `unmapped` to its pre-existing
`QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE`. Only the maintenance lane distinguishes
those two, which is exactly why it can be stricter than the executor.

## 6. How TOCTOU is prevented

Selection and mutation are a **single statement**: the candidate is chosen by a
sub-select under `for update skip locked` inside the `UPDATE`. After the write,
and inside the same transaction, both the entity state and the business state are
**re-derived**. If either has moved, the function raises
`AUTOMATION_STALE_BUSINESS_STATE_CHANGED` and the whole statement rolls back.

That error is never caught or reinterpreted as a successful cancellation — there
is no `when others` handler anywhere in the function.

## 7. No attempt, no send

The job UPDATE's `set` list mentions no attempt column, and the frozen job update
guard independently permits `attempt_count` to change only while
`new.status = 'processing'`. The transport shape constraint requires
`attempt_id`, `attempt_number` and `max_attempts` to be **null** on this route.
No communication row is written, no provider is constructed, no Meta credential is
read, and no automation history is deleted.

## 8. Replay and caller control

`insert ... on conflict (id) do nothing`; a duplicate request re-reads **its own**
durable row and answers from it, having verified transport version, direction,
route, worker and body hash — a mismatch is
`AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT`. The early return sits strictly
above the call to the terminalization authority, so a replay can never select a
second job. A partial unique index makes one-terminalization-per-job structural,
route-scoped so it cannot collide with the orphan lane's identical guarantee.

The request body is an **exact three-key set**. Seventeen named fields —
`jobId`, `actionRequestId`, `entityId`, `entityType`, `actionType`,
`workflowFamily`, `stale`, `eligible`, `businessState`, `reason`, `safeCode`,
`status`, `force`, `limit`, `batchSize`, `sourceEventKey`, `expectedState` — are
each **rejected**, not ignored. The terminalization RPC takes only a worker id.

## 9. What the response says

`cancel_stale_cancelled` carries only a closed-vocabulary `actionType` and the
fixed `safeCode`. No job id, action request id, entity id, vendor id, lead or
assignment id, recipient, destination, template variable, provider message id,
raw database error or environment value ever leaves Core. The exact job identity
is durable audit evidence in the ledger, not orchestration payload.

## 10. n8n

`QF-MVP-50-07-Stale-Business-Supervisor` ships `active: false`, holds no Supabase
or Meta credential, queries no table, and its allowed-path set contains exactly
one entry. It generates a request UUID, builds the exact three-key body, signs it,
calls Core once, verifies the signed response, branches on the Core-declared
orchestration state, and stops. Every outcome is a STOP. Core decides the job.

## 11. Out of scope, recorded not fixed

- **Lead destination normalization parity.** `resolveLead` uses
  `normalizeResolvedDestination(leads.phone)` while `resolveVendor` uses
  `normalizeStoredVendorDestination`, whose QF-MVP-80.16B adapter maps a bare
  ten-digit Indian mobile to `+91`. That adapter is **vendor-only**, so 4 client
  jobs with bare national lead numbers are destination-unresolved. Recommended
  next source phase: **QF-MVP-50.8 — lead destination normalization parity**,
  which must independently decide whether an exact Indian 10-digit lead format can
  safely adapt to `+91` without widening global normalization or causing
  wrong-country inference.
- `client.requirement_collection` and `client.missing_information_reminder` have
  no proven Core source for `outstandingItem`.
- The staging provider is deliberately disarmed (no `WHATSAPP_PROVIDER_MODE`
  under `NODE_ENV=production`, runtime policy disabled, 0 active mappings, 0
  active canary destinations).
- Campaign consent / frequency / destination readiness.

## 12. Correction to the QF-MVP-50.6-S3 audit

S3 reported 11 `BUSINESS_STATE_NO_LONGER_ELIGIBLE` jobs. That count was **wrong
by three**. The S3 script queried the low-credit threshold under the policy key
`vendor.low_credit_threshold`, but the repository constant
(`VENDOR_LOW_CREDIT_THRESHOLD_POLICY_KEY`) is
**`vendor_low_credit_warning_threshold`**, which *is* configured on staging with
`thresholdCredits: 3`. All three low-credit vendors hold exactly 3 credits, and
the rule is strictly greater-than, so those jobs are **business-ELIGIBLE**, not
stale.

The true stale set is **8**: 2 onboarding_reminder, 4 package_expiry_warning,
2 response_reminder. The 3 low-credit jobs are blocked only by the provider
runtime, like the other 29.

### The 8 stale certification evidence rows

These are **evidence only**. They appear in no migration, contract, service,
route, workflow or selector, and the gate asserts their absence from runtime
surfaces.

| action | job id |
| --- | --- |
| `vendor.onboarding_reminder` | `2e1f8999-6b33-4bc9-b8b2-f34cc7d25b09` |
| `vendor.onboarding_reminder` | `6bcf9d90-ff2d-43be-b992-0af8768c3fae` |
| `vendor.package_expiry_warning` | `11c3f572-d08c-4e0e-a99f-b279a3ab374c` |
| `vendor.package_expiry_warning` | `48c10e01-613a-459c-8efc-d963d6088df5` |
| `vendor.package_expiry_warning` | `b04f135f-6985-4b8d-a0f4-bcc803896e74` |
| `vendor.package_expiry_warning` | `f41348f4-2c77-4f1a-bacb-14505be91459` |
| `vendor.response_reminder` | `06ac0afa-cc67-4b83-aef8-730283ab3c04` |
| `vendor.response_reminder` | `5ac40d60-356f-4a42-b97f-b295af238955` |

### The 3 low-credit rows that MUST NOT be terminalized

`1e8e82ee-387f-4a9d-9edf-9a802c0eeeda`, `5c26f321-e6e3-4bb5-a998-95218fb8fde3`,
`eed762b8-1c13-4429-bd27-88021e46e6ff` — all hold exactly 3 credits against a
threshold of 3, and the rule is strictly greater-than, so all three are
**business-ELIGIBLE**. Any certification run that terminalizes one of these has
found a real defect and must stop.

## 13. Staging certification plan (after merge and deploy)

1. Apply the migration to staging only; verify the three functions, the index and
   the widened route/shape constraints; confirm the 50.6 objects are untouched.
2. Read-only: confirm the stale candidate set is exactly the **8** jobs above and
   that the deterministic first candidate matches.
3. One signed `cancel-stale` call; prove exactly one job moved, `attempt_count`
   unchanged, attempt ids unchanged, zero communication rows.
4. Byte-identical replay; prove `replayed=true` and that `updated_at` did not move.
5. Drain the remaining 7 one at a time with per-iteration verification.
6. A final call must return `cancel_stale_empty`.
7. Prove the 3 low-credit jobs and all other eligible jobs are **still queued**.

Production activation remains a separate, later decision.
