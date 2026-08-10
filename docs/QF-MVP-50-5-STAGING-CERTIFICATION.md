# QF-MVP-50.5 — staging deployment gate and recovery certification

Target project: **`uckafzuochmbvtiodmcl`** (staging).
Migration: **`20260812000000_qf_mvp_50_5_automation_recovery_reconciliation.sql`**
Canonical SHA-256: `25a142009bc389ae9e6f1fae95b873e0858c74b4a5792cbf3217dfb4e3af189b`
Source commit at time of apply: `9f0298fa469486c9c590c9162908ff69abbcbd40`, working tree clean.

No production database, no Meta send, and no deployment of any kind was performed.
`production`, `jarvis` and `onedecore` remained forbidden targets throughout, and the
connection string was asserted to contain the staging ref before every invocation.

---

## 1. Preflight (read-only)

| Check | Result |
| --- | --- |
| Repository HEAD | `9f0298f`, tree clean |
| Connection target | staging ref `uckafzuochmbvtiodmcl`, IPv4 pooler, session mode |
| Server | PostgreSQL 17.6, `current_database()` = `postgres` |
| Remote migration history | **exactly 29 rows**, newest `20260811000000` |
| `20260812000000` present remotely | **no** |
| On-disk migration SHA-256 | matches the manifest pin exactly |
| Local migration count | 97, with 50.5 newest |

## 2. Exact-one dry run

The manifest sets `ordinaryFullRepositoryDbPushAuthorizedForTarget: false` and
`targetRequiresExactOneTargetDryRun: true`. A repository-wide `db push` was therefore
never run — it would have attempted to replay 68 pre-baseline migrations, which
`preBaselineReplayForbidden` prohibits.

Instead a fresh temporary Supabase project was created **outside every repository**,
remote history was fetched into it, exactly one file was copied in, and the plan was
proven before any write:

```
fetched local stub count : 29 (expected 29)
target absent remotely   : PASS
post-copy sha256         : PASS (25a1420…f189b)
local file count         : 30
seed/roles               : absent
rows=30 remote=29 localOnly=1 remoteOnly=0
localOnly list: 20260812000000
PASS: no remote-only migrations (no divergence)
PASS: exactly one local-only migration
PASS: the local-only migration is the target 20260812000000
PASS: remote count is 29
PASS: target 20260812000000 absent remotely

DRY RUN
{"upToDate":false,"dryRun":true,
 "migrations":["20260812000000_qf_mvp_50_5_automation_recovery_reconciliation.sql"],
 "seeds":[],"roles":[]}
PASS: exactly one migration in plan
PASS: seeds list is empty
PASS: roles list is empty
```

## 3. The single apply, and independent re-verification

One `db push`, then a **separately issued** `migration list` — not a re-read of the
push output:

```
Applying migration 20260812000000_qf_mvp_50_5_automation_recovery_reconciliation.sql...
{"dryRun":false,"migrations":["20260812000000_…sql"],"seeds":[],"roles":[]}

INDEPENDENT RE-LIST
rows=30 remote=30 localOnly=0 remoteOnly=0
PASS: zero local-only migrations after apply
PASS: remote count is 30
PASS: target 20260812000000 now present remotely
PASS: target 20260812000000 is the newest remote version
```

Remote migration history: **29 → 30**. Applied exactly once.

## 4. Catalog verification (before/after diff, not self-assertion)

A full catalog snapshot was taken **before** the apply and re-taken after, then
diffed. The entire difference is the designed surface and nothing else:

* **Four new functions**, all `SECURITY DEFINER`:
  `qf_recover_automation_job_v1`, `qf_recover_automation_job_transport_v1`,
  `qf_select_stale_automation_attempt_v1`,
  `qf_reconcile_automation_attempt_transport_v1`.
* **Two guard functions replaced** in place — insert guard 825 → 892 bytes,
  update guard 1587 → 2064 bytes.
* **Route vocabulary widened 3 → 5**: `claim_v1, complete_v1, execute_v1` gains
  `recover_v1, reconcile_v1`.
* **State vocabulary widened 5 → 7**: gains `recovered, reconciled`.
* **`shape_check`** gains a `recovered`/`recover_v1` branch and a
  `reconciled`/`reconcile_v1` branch, and widens the `empty` state to the three
  selector routes.
* **One new index**:
  `uq_automation_transport_requests_recover_generation` — unique on
  `(job_id, attempt_number)` where `route_key = 'recover_v1'`.
* **No uniqueness index for `reconcile_v1`** — deliberate, so a deferral stays
  re-examinable.

Unchanged and verified unchanged: every pre-existing constraint, index and trigger,
the `claim_v1` uniqueness index, and all `claim_v1` / `complete_v1` / `execute_v1`
function bodies. **No table, column or type was added; no data row was modified.**

## 5. Behavioural certification against the real staging database

**65 of 65 assertions PASS.** Executed inside a single transaction that was
**always rolled back**; a post-run catalog snapshot was byte-identical to the
post-apply snapshot, so staging carries **zero residue**. The frozen QF-MVP-50.2B
mid-flight evidence (1 action / 1 job / 1 attempt) was never completed, mutated or
cleaned up.

Fixtures were built through the **real** QF-MVP-50.1B state machine
(`requested → authorized → pending → processing → attempt → completed →
retry_scheduled`). Every shortcut is refused by a guard trigger; the harness obeys
the guards rather than weakening them.

### Due-retry recovery (17 assertions)
`recover_v1` selects the oldest due `retry_scheduled` job, opens the **next**
generation (attempt 2), increments `attempt_count` exactly once, clears
`next_retry_at`, locks the job to the recovering worker, and returns the canonical
`workflowFamily` read from durable action truth. Replaying the same signed request
id returns `is_replay=true`, echoes the same attempt identity and creates **no**
additional attempt. A same-id/different-body replay is refused
(`AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT`). A second `recover_v1` row for the
same retry generation is impossible — the new unique index rejects it.

### Negative selection (6 assertions)
Proven against a genuinely drained queue: **13 real staging due-retry jobs were
recovered in sequence until the lane returned `empty`**, so every "empty" assertion
below is true rather than assumed.

* A retry whose `next_retry_at` is still in the future is **not** recovered, and is
  left completely untouched.
* An attempt-exhausted job (`attempt_count = max_attempts`) is **not** recovered.
* `claim_v1` never takes `retry_scheduled` work, even when due — the lanes share no
  selector, so neither can starve the other.

### Stale reconciliation (21 assertions)
The selector returns the most-abandoned current attempt with its canonical family,
action type and `execute_v1` reservation age. Thresholds of `0` and `999999` are both
refused in SQL. `defer` records a durable `reconciled` transport row and mutates
**nothing** — job and attempt are bit-for-bit unchanged — and a second, different
request id may defer the same attempt again, confirming reconciliation is
deliberately re-examinable. Every guard fires: `CANDIDATE_NOT_STALE`,
`JOB_NOT_FOUND`, `ATTEMPT_NOT_CURRENT`, `DISPOSITION_INVALID`, `RULING_REQUIRED`,
`EMPTY_ARGUMENTS_INVALID`. A `finalize` completes the attempt through the frozen
completion authority, returns the job to `retry_scheduled`, releases the worker lock
and records the Core-derived safe code.

### Dead-letter boundary (6 assertions)
A `retryable_failure` finalize at the retry ceiling becomes **`dead_letter`**, not
another retry. The job schedules no further retry, is terminal, is never recovered
afterwards, and cannot be reconciled again. The boundary stays inside the frozen
`qf_complete_automation_attempt_v1` — it is not forked.

### Execute-reservation evidence (3 assertions)
A **fresh** `execute_v1` reservation is reported not-yet-stale, so case B defers; an
**aged** one is reported stale, so case B may finalize. Attempting to age a finalized
transport row in place is refused — finalized transport history is immutable.

### Mixed queue (10 assertions)
With a fresh `pending` (client), a due `retry_scheduled` (vendor) and an abandoned
`processing` (campaign) job present simultaneously: `claim_v1` took only the pending
job, `recover_v1` took only the due retry and reported *its* family, and the stale
selector took only the abandoned job. Each lane left the other two rows untouched,
and all three route identities were recorded distinctly.

### Claim lane preserved (2 assertions)
`qf_claim_automation_job_transport_for_family_v1` is byte-identical to its
pre-50.5 definition (`md5 f1755a1bffa14c584d21cabb0f0a3839`), and
`uq_automation_transport_requests_claim_job` is intact.

---

## 6. Honest scope statement

What this document certifies is the **database layer** against the real staging
database: the SQL selectors, transport RPCs, uniqueness, replay identity, guards,
state machine and dead-letter boundary.

The signed HTTP layer (`/api/internal/automation/n8n/recover` and `…/reconcile`)
and the n8n Recovery Supervisor graph are certified separately in
§7; until that section records a result, they remain source-verified only.

`QF_N8N_TRANSPORT_MODE` stays `off` for staging Core unless a certification run is
explicitly in progress, and no Meta send is possible in any of it.

## 7. Signed HTTP + n8n certification — PASSED

Real n8n **1.108.2** in a local container, driving **local Core bound to staging**, over
real HTTPS with real HMAC signing in both directions. The shipped workflow
`QF-MVP-50-05-Recovery-Supervisor` was imported unmodified and left `active: false`.

**Staging binding was proven, not assumed.** `.env.local` in this repository holds a
PRODUCTION `service_role` key, so Core was started with the staging values exported
first and the effective `@next/env` resolution asserted before Next booted. The build was
then re-made with the staging values so that no `NEXT_PUBLIC_*` value inlined at build
time could point at production: the production project ref appears in **0** files of the
server build, the staging ref in 4.

The graph refuses any non-HTTPS base URL (`/^https:\/\//`), so a local TLS terminator
forwards verbatim to Core — method, path, headers and raw body pass through byte-for-byte,
because each is a canonical signing field.

### Recover lane — 32 nodes executed, full chain
Preconditions `configured=true` → exact three-key body → SHA-256 → canonical → HMAC →
signed POST → **Core 200 `recovery_claimed`** → response SHA-256 → response canonical →
response HMAC → **`verified=true`** → branch on Core's state.

Core's answer carried `workflowFamily: "client_whatsapp"`, `replayed: false` and the NEW
attempt identity (`attemptNumber: 2`). Verified in the staging database: a `recover_v1`
transport row in state `recovered` written by worker `qf-50-5-cert-n8n`, the job moved
`retry_scheduled → processing`, `attempt_count` 1 → 2, and a new attempt owned by that
worker.

The lane then forwarded the recovered identity to `execute_v1`, which Core refused with
**409 `AUTOMATION_EXECUTION_ENTITY_IDENTITY_INVALID`** for the synthetic fixture, because
Core rebuilds business facts from its own ledgers and the fixture's entity is not a real
lead. That is correct fail-closed behaviour and a second independent reason no provider
call was possible.

### Reconcile lane — 17 nodes executed, full chain
Same signing discipline, ending at **Core 200 `reconcile_finalized`** with
`jobStatus: "retry_scheduled"`, `classification: "retryable_failure"`,
`safeCode: "QF_RECOVER_PRE_EXECUTION_ABANDONED"` — evidence case A — and response
signature `verified=true`. Verified in the database: the attempt was completed through the
FROZEN `qf_complete_automation_attempt_v1` while **preserving the original owner's
worker id**, the job's lock was released, and Core set `next_retry_at` from the frozen
backoff. Exactly one `reconcile_v1` row was recorded.

### HTTP transport fence — 10/10
Proofs the graph cannot produce on its own, using the graph's canonical scheme verbatim:

| # | Proof |
| --- | --- |
| H01 | a correctly signed recover request is accepted (200) |
| H02 | Core signs its response; version, request id, body hash and signature all verify |
| H03 | the first answer is not a replay |
| H04 | a recovered answer carries the new attempt identity and canonical family |
| H05 | a recovery replay is **suppressed** — 409 `AUTOMATION_RECOVERY_REPLAY_EXECUTION_SUPPRESSED` |
| H06 | the suppression leaks no attempt identity or family whatsoever |
| H07 | the suppression answer is itself signed and verifies |
| H08 | a tampered request signature is refused, 401 `TRANSPORT_SIGNATURE_INVALID` |
| H09 | an unauthenticated refusal is **not** signed — no signing oracle |
| H10 | a signature bound to another route cannot authenticate here |

H05 is worth stating precisely, because the service layer is deliberately **stricter than
SQL**. SQL answers a duplicate request identity with `is_replay=true`; the service refuses
to convert that into a second executable envelope at all. Across the whole run, duplicated
`(job_id, attempt_number)` pairs: **0**.

### No provider effect
`communication_messages` in the entire staging database: **0**, before and after.
`communication_provider_runtime_policies`: 0 rows. ACTIVE provider template mappings: 0.
No Meta call occurred or could occur.

## 8. Unintended staging impact — stated in full

The database-layer certification in §5 rolled back and left zero residue. **This
signed-HTTP certification could not roll back**, because Core and n8n commit in their own
transactions. It therefore left real state, and more of it than intended.

**What happened.** Recovery selects the globally-oldest due job. The intended protocol was
to seed a guaranteed-oldest synthetic fixture before *every* run so the selector could
only ever reach the fixture. That held for the seeded runs, but twice I misread the
harness: an n8n execution that had genuinely run was reported by my own polling as "0 nodes
executed", and an activation experiment that I concluded "never fired" had in fact fired
once a minute for roughly seven minutes. During those unseeded runs the selector correctly
reached **real** staging jobs.

**Exact impact — 9 real client jobs:**

* **8** moved `retry_scheduled → failed` (terminal), each `definitive_failure /
  QF_EXEC_LEAD_NOT_FOUND`. These referenced leads that do not exist, so they could never
  have succeeded; the transition is what any real execution would have produced. Terminal
  automation jobs are immutable by design, so this is **not reversible**.
* **1** (`ba0c368b…`) moved `processing → retry_scheduled` via reconciliation, which is the
  correct treatment of a genuinely abandoned attempt.

**What was NOT touched, verified explicitly rather than inferred:**

* All four QF-MVP-50.3/50.4 **PASS-B delayed jobs** — still `pending 0/5` with
  `available_at` unchanged: `182813d1…`, `a9dcbaaf…`, `fb354493…`, `6bcf9d90…`.
* Both **frozen mid-flight processing locks** — still `processing`, `locked_at` unchanged:
  `98251bf3…` (`qf-cert-50-2-…`, the QF-MVP-50.2B evidence) and `5673ba62…`
  (`qf-cert-50-3-50-4-isolated`).
* The parked QF-MVP-50.2 evidence `cf27f3da…`.
* **Any vendor or campaign job.** Every transport row this certification wrote belongs to
  the `client_whatsapp` family; vendor and campaign families were never selected.
* Any business row — no lead, vendor, assignment or communication row was created,
  modified or deleted, and `communication_messages` remains 0.

**Fixtures left behind**, all tagged `qf505cert-n8n-*`: 7 jobs (6 `processing` at attempt
2, 1 `retry_scheduled`) plus their action requests and attempts. They are append-only
history and are deliberately not cleaned up.

**The rule this establishes for any future non-rollbackable staging run:** seed the
guaranteed-oldest fixture before *every* invocation, and never infer from a harness's own
"nothing happened" that nothing happened — confirm against the database.

