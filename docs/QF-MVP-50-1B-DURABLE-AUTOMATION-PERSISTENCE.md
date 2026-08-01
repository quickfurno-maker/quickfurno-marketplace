# QF-MVP-50.1B — Durable Automation Persistence

**Status:** IMPLEMENTATION CANDIDATE  
**Depends on:** QF-MVP-50.1A (`4372b10266188b0febb6dc8abe254aa3719a65e4`)  
**Migration:** `20260801110000_qf_mvp_automation_action_persistence.sql`  
**Database application in this task:** NONE  
**n8n activation:** NONE  
**Meta activation:** NONE  
**Jarvis runtime integration:** NONE

## 1. Decision

QF-MVP-50 will **not replay** the historical generic workflow-kernel migration.

The reviewed staging and reconciled production schemas were measured before this implementation. In both environments the old workflow-kernel tables (`workflow_instances`, `workflow_tasks`, `domain_events`, `outbox_events`, `workflow_failures`, `idempotency_records`) are absent. The new migration aborts if any of those tables appears, because two durable orchestration authorities would be unsafe.

Instead, 50.1B introduces the smallest persistence model needed by the locked action contract:

```text
automation_action_requests
        │ 1
        │
        │ 0..1
        ▼
automation_jobs
        │ 1
        │
        │ 0..N
        ▼
automation_execution_attempts
```

## 2. Authority model

```text
Jarvis/Riya/Anisha ──request──┐
Core/Admin/System ───request──┤
                              ▼
                   automation_action_requests
                              │
                       Core decision only
                     ┌────────┴────────┐
                     │                 │
                  rejected          authorized
                     │                 │
                    STOP               ▼
                              automation_jobs
                                      │
                               Core worker claim
                                      ▼
                           execution attempt row
                                      │
                              executor / n8n later
                                      │
                              Core classification
                                      ▼
                        success / retryable_failure
                     definitive_failure / uncertain
```

`source` remains provenance only. It grants nothing.

## 3. Why service_role is READ-only on the tables

All three tables have RLS enabled.

`service_role` receives only `SELECT` on the tables. It receives **no direct INSERT, UPDATE, DELETE or TRUNCATE**.

Five narrow `SECURITY DEFINER` RPCs are the only application mutation surface:

1. `qf_create_automation_action_request_v1`
2. `qf_decide_automation_action_request_v1`
3. `qf_create_automation_job_v1`
4. `qf_claim_automation_job_v1`
5. `qf_complete_automation_attempt_v1`

Every RPC has a fixed `search_path`, and only `service_role` receives `EXECUTE`.

This is deliberately stricter than the historical workflow-kernel design. A future backend bug cannot directly update a job to `succeeded`, and n8n/Jarvis never hold database credentials at all.

## 4. Action requests

The request row freezes:

- contract version;
- action type;
- entity identity;
- source;
- request actor;
- request timestamp;
- idempotency key;
- correlation ID;
- safe context.

A request may move exactly once:

```text
requested → authorized
requested → rejected
```

There is no transition out of `authorized` or `rejected`.

The database repeats the 50.1A source/action scope:

- all six sources can request client communication actions;
- only Jarvis (plus Core/admin/system) can request the three selected vendor reminder classes;
- AI sources cannot request vendor lead offers, package/credit warnings, or campaign execution.

Authorization/rejection can be recorded only with a `core_service` or `admin_user` decision actor.

## 5. Safe context

The executor context is limited to safe evidence/identifiers.

A recursive database constraint independently rejects keys representing:

- recipients/destinations/phones/WhatsApp;
- arbitrary templates;
- provider-account overrides;
- secrets/tokens/authorization/password/API keys;
- credit changes;
- vendor-assignment overrides;
- consent/suppression bypasses;
- forced send / forced retry / validation bypass.

The JSON object is capped at 16 KiB.

This duplicates the TypeScript fence intentionally. Persistence must remain safe even if a later caller forgets to invoke the pure 50.1A validator.

## 6. Request idempotency

`idempotency_key` is unique.

`qf_create_automation_action_request_v1` uses insert-first `ON CONFLICT DO NOTHING`.

On a duplicate key it re-reads the existing request and returns it only when **all immutable request evidence is identical**. A changed request ID, action, entity, source, actor, timestamp, correlation ID or context returns:

```text
AUTOMATION_ACTION_REQUEST_IDEMPOTENCY_CONFLICT
```

A duplicate key therefore cannot be reused for a different Jarvis/Core action.

## 7. Core decision idempotency

A request is locked before decision.

An exact replay of the same decision ID, decision, Core/admin actor and reason returns the existing row.

A different replay after the request has already been decided returns:

```text
AUTOMATION_ACTION_REQUEST_DECISION_CONFLICT
```

## 8. Job creation

Exactly one job can exist per action request.

The insert trigger and job-creation RPC both verify:

```text
decision_status = authorized
```

Therefore:

```text
requested → job   IMPOSSIBLE
rejected  → job   IMPOSSIBLE
authorized → job  ALLOWED
```

`max_attempts` is 1–10, default 5.

Job creation is idempotent by `action_request_id`. A retry-budget change on replay is rejected rather than silently widening execution authority.

## 9. Claiming

`qf_claim_automation_job_v1(worker_id)` uses:

```text
FOR UPDATE SKIP LOCKED
```

and can claim only:

```text
pending + available_at <= now
retry_scheduled + next_retry_at <= now
```

It atomically:

```text
job → processing
attempt_count += 1
lock owner/time set
execution-attempt row inserted as started
```

The returned claim contains:

- job ID;
- action-request ID;
- attempt ID;
- attempt number;
- max attempts.

### Critical rule: no stale-processing reclaim

The claim query contains **no `processing` eligibility**.

A worker can crash after an external system accepted work but before Core received the response. Automatically reclaiming that processing row could duplicate an action.

Stale processing reconciliation belongs to QF-MVP-50.5 and must move through an uncertainty-aware recovery path, never a blind resend.

## 10. Completion

The currently owning worker must provide the exact job ID + attempt ID + worker ID.

The database locks both rows and proves:

- job is `processing`;
- lock belongs to that worker;
- attempt belongs to that job;
- attempt number equals the current job attempt count;
- attempt is still `started`.

Closed classification:

```text
success
retryable_failure
definitive_failure
uncertain
```

Mapping:

```text
success             → succeeded
definitive_failure  → failed
uncertain           → uncertain
retryable_failure   → retry_scheduled
retryable_failure on final attempt → dead_letter
```

Only `retryable_failure` may carry `next_retry_at`.

`success`, `definitive_failure`, and especially `uncertain` reject a retry timestamp.

This means:

```text
UNCERTAIN ≠ FAILED
UNCERTAIN ≠ RETRY
UNCERTAIN = TERMINAL EXECUTION STATE
```

Later verified provider evidence can reconcile canonical Core communication state without resending the action.

## 11. Universal integrity triggers

The migration adds insert/update guards in addition to RPC security:

- a job insert universally requires an authorized request;
- an attempt insert must match the current processing job/worker/attempt count;
- job state cannot leave `processing` until the matching attempt is completed with the same classification;
- request identity/provenance is immutable;
- job identity/schedule/retry budget is immutable;
- terminal jobs are immutable;
- attempts complete once;
- DELETE/TRUNCATE is blocked on all three audit-bearing tables, including owner-level accidental mutations.

## 12. TypeScript service

`services/automationPersistenceService.ts` is server-only and performs no HTTP/provider/n8n call.

It provides:

- `createAutomationActionRequest`
- `authorizeAutomationActionRequest`
- `rejectAutomationActionRequest`
- `createAutomationJob`
- `claimAutomationJob`
- `completeAutomationAttempt`
- read helpers
- reconstruction of the 50.1A `CoreAuthorizedAction`
- reconstruction of the immutable `AutomationJobEnvelope` **only for the exact currently claimed processing job/worker/attempt evidence**

Knowing a job UUID alone is not sufficient to obtain executable work.

Before request persistence it again verifies:

- the 50.1A request envelope;
- registered action type;
- source/action requestability.

## 13. Jarvis provision retained

Nothing in 50.1B directly connects Jarvis.

Future QF-MVP-60 can submit a request through Core with:

```text
source = jarvis | riya | anisha
requested_by_type = jarvis_agent
```

That request is persisted as provenance, then separately accepted/rejected by Core.

Jarvis does not:

- create jobs;
- claim jobs;
- complete attempts;
- write the database;
- call n8n;
- call Meta.

That separation means QuickFurno continues to operate when Jarvis is offline.

## 14. Environment application order

This task only creates/reviews the migration.

Later:

```text
offline validation
      ↓
staging controlled preflight
      ↓
staging exact migration application
      ↓
staging DB verification + concurrency tests
      ↓
50.1C authenticated Core↔n8n transport
```

Production application requires its own explicit reviewed cutover after staging proof. Do not use a blind production `db push` because production migration history contains the controlled baseline-reconciliation versions.

## 15. Explicit non-actions

50.1B does not:

- activate n8n;
- create/import n8n production workflows;
- call any n8n webhook;
- activate Meta;
- call Meta;
- send WhatsApp;
- create provider accounts/mappings;
- modify consent;
- change lead assignments;
- modify credits/packages;
- call Jarvis;
- deploy to VPS;
- apply this migration to any database during implementation.
