# QF-MVP-50.6 — Orphan / Certification Queue Governance

**Status: SOURCE ONLY.** Nothing in this phase was deployed, applied or executed.

- **NO STAGING MUTATION PERFORMED**
- **NO PRODUCTION MUTATION PERFORMED**
- **NO META/WHATSAPP SEND PERFORMED**

The migration is registered as SOURCE-PENDING in the staging-history manifest and
requires its own separate deployment gate.

---

## 1. The problem

An automation job can outlive the business entity it was created for. The lead is
deleted, the assignment is removed, the certification identity never existed — but
the job row is still `pending` or `retry_scheduled` and still **due**.

Nothing in the queue distinguishes *due* from *still meaningful*. So:

- `claim_v1` keeps offering the job to an executor,
- the executor fails to resolve a recipient and finalizes a failure,
- the retry policy schedules it again,
- `recover_v1` picks it back up,

and the job cycles forever. The staging audit found 20 such rows — 11 client, 9
vendor — against 46 entity-backed jobs.

## 2. What was added

One governed way to move such a job to the **existing** terminal state
`cancelled`, and nothing else.

| Surface | File |
| --- | --- |
| Migration (forward-only) | `supabase/migrations/20260905000000_qf_mvp_50_6_automation_orphan_cancellation.sql` |
| Pure contract | `lib/automation/orphanCancellationContract.ts` |
| Core service | `services/automationOrphanCancellationService.ts` |
| Signed route | `app/api/internal/automation/n8n/cancel-orphan/route.ts` |
| n8n supervisor (`active: false`) | `automation/n8n/QF-MVP-50-06-Orphan-Cancellation-Supervisor.workflow.json` |
| Gate | `scripts/mvp/automation/validate-qf-mvp-50-6.mjs` (`npm run test:mvp:50-6`) |

Three RPCs, all `security definer`, all `search_path`-fixed, all revoked from
`public`/`anon`/`authenticated` and executable only by `service_role`:

```
public.qf_automation_entity_state_v1(p_entity_type text, p_entity_id text)
  returns text                     -- 'present' | 'missing' | 'unmapped'   (STABLE)

public.qf_cancel_orphan_automation_job_v1(p_worker_id text)
  returns table (job_id uuid, action_request_id uuid, entity_type text, safe_code text)

public.qf_cancel_orphan_automation_job_transport_v1(
  p_request_id uuid, p_worker_id text, p_body_sha256 text)
  returns table (request_id uuid, route_key text, state text, is_replay boolean,
                 job_id uuid, action_request_id uuid, entity_type text, safe_code text)
```

## 3. Decisions, and why

### 3.1 `cancelled`, not `quarantined`

The brief allowed a second terminal state only if the repository proved one was
necessary. It does not.

`automation_jobs.status` has included `cancelled` since the original persistence
migration. The job update guard has **always** permitted `pending -> cancelled`
and `retry_scheduled -> cancelled`. The result-shape constraint already places
`cancelled` in the group that requires no classification, and the completion-shape
constraint already requires `completed_at` on it.

So the schema was already correct and complete. What was missing was an
*application authority* allowed to make a transition the database already blessed.
Adding `quarantined` would have introduced a state every existing reader — admin
surfaces, gates, future reconciliation — would have had to learn, in exchange for
nothing.

### 3.2 Core establishes orphan truth; the caller cannot

The request body is an **exact** three-key set: `transportVersion`, `requestId`,
`workerId`. Not "these keys are required" — these keys and no others. A body
carrying `jobId`, `entityId`, `entityType`, `reason`, `safeCode`, `status`,
`force`, `limit` or `entityMissing` is **rejected**, not ignored.

That is deliberately stronger than accepting-and-discarding: a reader of
`parseCancelOrphanRequestBody` can see that Core could not have been told which
job to cancel, rather than having to trust that it wasn't.

Core then selects the candidate itself and re-derives absence from the
authoritative tables **inside the same transaction that writes the cancellation**,
with a defensive second proof after the write that rolls the statement back if the
answer ever disagreed.

### 3.3 Unmapped fails closed

`qf_automation_entity_state_v1` returns one of three words, and only one of them
cancels:

| Verdict | Meaning | Effect |
| --- | --- | --- |
| `present` | the authoritative row exists | never cancelled |
| `missing` | the type is mapped **and** no row can exist for that id | cancellable |
| `unmapped` | this authority does not know the type | **never cancelled** |

The closed map is `lead`, `lead_assignment`, `vendor`, `communication_intent`,
resolving against `public.leads`, `public.lead_assignments`, `public.vendors`,
`public.communication_intents`. The identical map is stated in the pure contract,
and the gate compares the two.

A future action pointing at a table this authority does not know is therefore
*invisible* to the lane rather than silently terminalized. The failure mode is
"the orphan stays queued and a human notices" — never "a live job was cancelled
because Core did not recognise its entity type".

### 3.4 A non-UUID entity id is `missing`, and that is a proof

`automation_action_requests.entity_id` is **text**. The mapped tables are all
uuid-keyed. So a non-UUID entity id — the `qf505cert` certification identities —
cannot match a row, now or ever.

That is a proof about the schema, not a guess about the data, which is why it is
`missing` rather than an error. It is also what makes the certification-queue rows
safely cancellable while an unrecognised entity *type* stays untouchable: the two
look superficially similar and are treated very differently on purpose.

### 3.5 One unit per call, deterministic order

The selector takes `order by j.created_at asc, j.id asc ... for update skip locked
limit 1`. Oldest first, so a growing orphan set drains deterministically and no
job is starved by newer arrivals; `skip locked` so concurrent workers take
different rows instead of blocking.

### 3.6 Replay safety

`insert ... on conflict (id) do nothing`. If the row already existed, the wrapper
re-reads **its own** durable row, verifies transport version / direction / route /
worker / body hash, and answers from what that request already did. The
cancellation authority is never reached on a replay — the early return sits
strictly above the call, which the gate asserts by source position, not by reading
the comment.

A partial unique index makes one-cancellation-per-job structural:

```sql
create unique index uq_automation_transport_requests_cancel_orphan_job
  on public.automation_transport_requests(job_id)
  where route_key = 'cancel_orphan_v1' and job_id is not null;
```

and the selector's `not exists` clause means that index is unreachable in normal
operation rather than merely unlikely to fire.

Unlike `claim_v1` and `recover_v1`, a replay here is answered **in full** rather
than suppressed. Those routes suppress because their response hands out executable
work and a second copy could produce a second send. This response hands out
nothing, so the honest answer to "what did my earlier request do?" is simply what
it did.

### 3.7 No attempt, ever

Cancellation runs no attempt, so the transport shape constraint for this route
requires `attempt_id`, `attempt_number` and `max_attempts` to be **null**. The job
UPDATE's `set` list mentions no attempt column, and the frozen job update guard
independently permits `attempt_count` to change only while `new.status =
'processing'` — so even a future edit to this migration could not increment it.

The written shape is exactly:

```
status                     = 'cancelled'
completed_at               = now()
next_retry_at              = null
locked_at                  = null
locked_by                  = null
last_result_classification = null      -- nothing executed, so nothing to classify
last_safe_code             = 'QF_AUTOMATION_ORPHAN_ENTITY_MISSING'
```

`attempt_count`, `max_attempts`, `action_request_id`, `available_at`, historical
attempts and all automation history are untouched.

### 3.8 Future prevention — the narrowest correct defense

The brief asked for the *narrowest* defense that stops an orphan reaching a
provider side effect, and explicitly warned against casually changing claim or
recovery ordering and fairness.

The defense already exists and is load-bearing today:

- `automationClientExecutionService` calls `buildClientCommunicationIntent`
  (→ `readLeadFacts` → `QF_EXEC_LEAD_NOT_FOUND`) **before** `service.send(...)`,
  and when preparation fails the send branch is never entered.
- `automationVendorExecutionService` calls `resolveVendorFacts` (→
  `QF_EXEC_VENDOR_NOT_FOUND`) before touching the communication lane, and
  documents that refusal as "a PRE-COMMUNICATION no-send: no communication row, no
  provider contact".

So the invariant *no authoritative entity → no provider call → no communication
send* holds already. What did **not** exist was any way for such a job to leave
the queue — it just failed, retried and came back.

The correct narrow fix is therefore to add the missing exit, not to add a
redundant second entity check to the claim and recovery selectors, which would
have changed ordering and fairness for every job in order to re-prove something
the executors already prove. The gate pins the existing ordering (by source
position, so a reordering fails it) rather than duplicating it.

### 3.9 n8n stays an orchestrator

The supervisor workflow ships `active: false`, holds no Supabase credential and no
Meta token, queries no table, and its allowed-path set contains exactly **one**
entry — it cannot reach claim, execute, complete, recover or reconcile. It
generates a request UUID, builds the exact three-key body, signs it, calls Core,
verifies the signed response, branches on the Core-declared orchestration state,
and stops.

Every outcome is a STOP. There is no branch that forwards work onward, because a
cancelled job has no executable work by definition:

| `orchestrationState` | Meaning |
| --- | --- |
| `cancel_orphan_empty` | nothing eligible — the ordinary resting state once drained |
| `cancel_orphan_cancelled` | exactly one orphan terminalized; no attempt, no send |
| `rejected` | authentication or an invariant unproven; nothing was mutated |

No new environment variable is introduced. The certified 50.2E / 50.3 / 50.4 /
50.5 workflows are not modified.

## 4. What this lane cannot do

- cancel a `processing` job (that belongs to execution and reconciliation)
- cancel any terminal job
- cancel a job whose entity still exists
- cancel a job whose entity type it does not recognise
- cancel the same job twice, or cancel twice from one request id
- open an attempt, consume attempt budget, or touch `attempt_count`
- write, re-dispatch or cancel a `communication_messages` row
- construct a provider, read a Meta credential, or send anything
- delete or truncate automation history
- gain, or grant, direct table `UPDATE` on any automation table

## 5. Governance impact

Adding a migration re-pins the whole exact-equality governance set.

- migration tree **104 → 105**; `20260905000000` is the newest file
- G1 `MIGRATION_COUNT` **104 → 105**; `RECONCILIATION_MIGRATION_COUNT` stays
  **102** (a frozen QF-MVP-80.05 historical fact that must never track the live
  count)
- post-anchor migrations **17 → 18** (G1 and `appliedAnchor.postAnchorMigrationCount`)
- `pendingPostAnchorMigrations` **1 → 2** (80.14A activation authority + this)
- APPLIED stays **10**, RECONCILED stays **5**, STAGING-APPLIED stays **1**
- pending-accounting invariant holds: `105 − 102 = 3 = 2 pending + 1 staging-applied`
- `AUTOMATION_TRANSPORT_ROUTE_KEYS` **five → six**, re-pinned by exact ordered
  equality in 50-2D, 50-2E and 50-5 — never relaxed to a length bound or a
  membership test
- n8n workflow allowlist **six → seven**, still an exact sorted list

G1's post-anchor order is now **derived by sorting on version** rather than by
concatenating the four category blocks. Until this phase those coincided; 50.6's
pending `20260905000000` sorts after R0's staging-applied `20260904000000`, so
they no longer do. Deriving the order is strictly stronger — the on-disk sequence
is compared against a sorted pin instead of against a block layout a future phase
could silently invalidate again.

## 6. Certification set

The 20 orphan job ids from the brief are **evidence for a later staging-only
certification**, not code constants. They appear in no migration, contract,
service, route, workflow or gate logic, and the validator asserts their absence.
None was mutated by this phase.
