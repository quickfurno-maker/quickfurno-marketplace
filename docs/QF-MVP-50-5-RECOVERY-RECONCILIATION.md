# QF-MVP-50.5 — Automation recovery and reconciliation

**Status: SOURCE READY.** The migration `20260812000000` is **PENDING** — it has not been
applied to QuickFurno Staging, and no runtime certification against a real n8n instance
has been performed. Nothing here authorizes any production change.

Gate: `npm run test:mvp:50-5`.

---

## 1. What this phase owns

Every migration in this lineage since QF-MVP-50.1B deferred the same thing in the same
words: *"governed retry recovery — due sweep, `retry_scheduled` reclaim, stale leases,
dead-letter handling — remains owned by QF-MVP-50.5"*. This is that phase.

Before it, two durable states were legal but inert:

| State | How it is reached | What used to happen next |
| --- | --- | --- |
| `retry_scheduled` | a `retryable_failure` with retry budget left | **nothing, ever** — the fresh claim deliberately excludes it |
| `processing` with a dead executor | a claim committed and the executor never returned | **nothing, ever** — a processing job is never blindly reclaimed |

Both are now serviced, by two deliberately separate mechanisms.

## 2. Two routes, never one

| | `recover_v1` | `reconcile_v1` |
| --- | --- | --- |
| Selects | one **due `retry_scheduled`** job | one **stale current attempt** |
| Authority | **creates** the next attempt | **finalizes** the current one, or nothing |
| Job transition | `retry_scheduled → processing` | `processing → retry_scheduled / succeeded / failed / uncertain / dead_letter`, or none |
| `attempt_count` | `+1`, exactly once | unchanged |
| Replay identity | unique per **retry generation** — one recovery per `(job, attempt_number)`, ever | deliberately **repeatable** |
| Terminal transport states | `recovered`, `empty` | `reconciled`, `empty` |
| Follow-up call by n8n | forwards the new attempt to the family execute boundary | **none, ever** |

They are not two spellings of one operation. They differ in authority, replay identity,
uniqueness and legal state transitions. A single shared route would have to weaken its
constraint to the union of the two, which is precisely how an auditable ledger stops
being auditable.

Each has its own exact HTTP path, and the path is a canonical HMAC field — so a
`recover` signature cannot authenticate a `reconcile` request, and neither can
authenticate a claim, an execute or a completion.

## 3. `claim_v1` is completely preserved

Fresh `pending` work only. `retry_scheduled` stays excluded. Exactly one `claim_v1` row
per job. `uq_automation_transport_requests_claim_job` is not dropped, recreated or
relaxed; no claim row is deleted; `claim_v1` is never reused for a retry. The
`complete_v1` and `execute_v1` uniqueness rules are likewise untouched.

### Why the recovery lane cannot wedge the queue

QF-MVP-50.2 hit a starvation: a stranded job outranked every fresh job forever and each
claim violated a unique index (SQLSTATE 23505 → Core 500). The recovery lane cannot
repeat it, for three independent reasons:

1. recovery uniqueness is the **retry generation** `(job_id, attempt_number)`, and
   `attempt_count` only ever increases, so each generation is reachable exactly once;
2. the selector **skips** any job whose next generation already holds a `recover_v1`
   row, so a duplicate is unreachable rather than merely unlikely;
3. ordering is by `next_retry_at`, and each failure pushes that further into the future
   through the frozen backoff — a repeatedly-failing job loses priority rather than
   monopolising the lane.

## 4. Fairness: three lanes, never a union

There is deliberately **no** SQL selector that unions `retry_scheduled` and stale
`processing` rows.

| Lane | Selector | Driven by |
| --- | --- | --- |
| fresh work | `status = 'pending' and available_at <= now()` | the certified client / vendor / campaign executors |
| due retry | `status = 'retry_scheduled' and next_retry_at <= now()` | the recovery supervisor's **recover** trigger |
| stale reconciliation | `status = 'processing' and locked_at <= cutoff` | the recovery supervisor's **reconcile** trigger |

The two recovery lanes have **separate n8n schedule triggers**, so they run as separate
executions. A failure, a rejection or a slow response in one cannot starve the other —
which a single fan-out branch could not guarantee. Each lane does at most one unit of
work per cycle.

## 5. The stale threshold is derived, not invented

| Input | Value | Where it is proven |
| --- | --- | --- |
| n8n → Core HTTP timeout | 10 s | `timeout: 10000`, hard-coded in every signed POST node of every shipped workflow |
| signed calls per attempt | 3 | claim/recover, execute, complete |
| provider call ceiling | 30 s | `BUSINESS_TIMEOUT_MAX_MS` in `metaCloudWhatsAppConfig.ts`, enforced by a real `AbortController` |
| signed-request window | 300 s | `AUTOMATION_TRANSPORT_MAX_CLOCK_SKEW_SECONDS` — the real bound on how late a signed request may still arrive and start work |
| safety margin | 60 s | `RECOVERY_SAFETY_MARGIN_MS` — reused from the already-reviewed communication-lane recovery constant rather than re-chosen |

Maximum legitimate in-flight lifetime = 300 + 30 + 3×10 + 60 = **420 s**.

**Versioned threshold v1 = 900 s.** The smallest round value at more than double the
derived ceiling, and coincident with the third step of the frozen retry schedule
(60/300/900) so the two timing vocabularies stay coherent. It is a fixed repository
constant — no environment variable, no admin setting, no n8n input — asserted at module
load, and bounded again in SQL to `[300, 86400]` so a caller can never pass `0`.

## 6. The closed stale-evidence decision table

Core reads two durable facts before deciding: whether an `execute_v1` reservation exists
for this exact attempt (and how old it is), and the persisted
`communication_messages.status` for the Core-derived key `qf_auto_v1:{jobId}:{attemptId}`.

| Case | Evidence | Ruling |
| --- | --- | --- |
| **A** | no `execute_v1` reservation | **safe pre-execution retry** — `retryable_failure`, `QF_RECOVER_PRE_EXECUTION_ABANDONED` |
| **B** | reservation exists, **stale**, no communication row | **safe pre-communication retry** — `retryable_failure`, `QF_RECOVER_PRE_COMMUNICATION_ABANDONED` |
| **B2** | reservation exists but is **not yet stale** | **defer** — the executor may still be running |
| **C** | communication `queued` / `dispatching` / `retry_scheduled` | **defer** — the communication lane owns that row |
| **D** | communication `accepted` / `sent` / `delivered` / `read` | reconcile to terminal **success** |
| **E** | communication `failed` / `dead_letter` / `cancelled` | reconcile to **definitive failure** |
| **F** | communication `outcome_unknown` | **uncertain** — terminal, never retried |
| **G** | anything unrecognised or self-contradictory | **anomaly** — fail closed, mutate nothing, consume no durable identity |

### Why case B is safe, and not an assumption

`services/communicationService.ts` resolves template, recipient, consent, provider
mapping and runtime gate and **returns before any persistence** on every failure path;
it then persists the `communication_messages` row, claims it with a compare-and-set, and
only then calls the provider. A provider call therefore cannot precede durable
communication persistence. "Reserved, and still no row after the threshold" consequently
means the send never began.

**Residual risk, stated plainly:** a process wedged for longer than 900 s strictly
between reserving and persisting would be misread as abandoned. The threshold is derived
to more than double the maximum legitimate in-flight window precisely to make that
window vanishingly small, and case B2 refuses to act before it elapses.

### No communication status can produce an automation retry

`resolveCompletionEvidenceRuling` never returns `retryable_failure`. Automation retry is
reachable **only** from cases A and B, where no communication row exists at all — so
recovery can never stand up a second retry mechanism over one logical send.

## 7. The dead-letter boundary does not move

Reconciliation **calls** `qf_complete_automation_attempt_v1` rather than reimplementing
it, passing the original owner's worker id (truthful: that worker did start the attempt,
and the attempt row keeps its `worker_id`). Who reconciled is recorded separately and
durably, as the `worker_id` of the `reconcile_v1` transport row.

Consequently `attempt_count >= max_attempts → dead_letter` still lives in exactly one
place in the database, and every terminal-state rule and retry-shape constraint is
inherited rather than duplicated.

## 8. Honest limits

- **There is no live provider communication due-sweep, and this phase does not add one.**
  The provider communication due-sweep is not live in this repository:
  `dispatchPersistedMessage` still has no production caller, and the only internal worker
  route remains `app/api/internal/process-consent-ack-intents`. A `pending` communication
  row is therefore **not** reconcilable by 50.5 and is **not** made reconcilable by it —
  case C defers and changes nothing. Inventing a sweep here would mint a second
  communication row under a new idempotency key and deliver a duplicate message.
  Provider and channel operational readiness remains with the applicable QF-MVP-40 and
  QF-MVP-80 work.
- **No blind reclaim.** `automation_jobs` has always carried the comment "A processing job
  is never automatically reclaimed after a stale lock because external outcome may be
  uncertain." That remains true: reconciliation acts only on durable evidence, and where
  the evidence is unresolved, contradictory or owned by another lane it changes nothing.
- **An anomaly consumes no durable request identity.** Core refuses before calling SQL,
  so the ledger never records "handled" for a state Core cannot explain.
- **No cross-system atomicity is claimed.** Recovery's own transaction is all-or-nothing,
  but the provider execution that follows is an external network action in the
  application layer, exactly as QF-MVP-50.2E already documented.
- **The migration is PENDING.** Staging application and real n8n retry / dead-letter /
  stale / mixed-queue certification are separate gates that have not run.

## 9. Surface added

| Kind | Path |
| --- | --- |
| migration | `supabase/migrations/20260812000000_qf_mvp_50_5_automation_recovery_reconciliation.sql` |
| pure contract | `lib/automation/recoveryContract.ts` |
| service | `services/automationRecoveryService.ts` |
| signed routes | `app/api/internal/automation/n8n/{recover,reconcile}/route.ts` |
| n8n candidate | `automation/n8n/QF-MVP-50-05-Recovery-Supervisor.workflow.json` (`active: false`) |
| gate | `scripts/mvp/automation/validate-qf-mvp-50-5.mjs` |

SQL added: `qf_recover_automation_job_v1`, `qf_recover_automation_job_transport_v1`,
`qf_select_stale_automation_attempt_v1`,
`qf_reconcile_automation_attempt_transport_v1`, and the
`uq_automation_transport_requests_recover_generation` index. No table, column or type.
`reconcile_v1` deliberately has **no** uniqueness index — a deferral must stay
re-examinable, and double finalization is already impossible because an attempt may go
`started → completed` exactly once.

## 10. Coordinated re-pin

One new migration moved the repository from 96 to 97 files. Fourteen harnesses assert
that count and eight assert the pending-set size, so all of them were re-pinned to the
new **exact** values in the same change: G1, 50.2D, 50.2E, 50.2-FINAL, 50.3, 50.4, the
policy-config bridge, the staging forensic reconciliation, the staging orchestration
certification, and five admin phase-scope guards.

Every one remains an exact equality. No `>=`, no wildcard, no membership test and no
"anything newer is fine" allowance was introduced anywhere.
