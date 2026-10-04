# Phase 07 — Durable Jobs, Outbox & Idempotency

## Authority

QuickFurno Core/PostgreSQL remains the durable source of job intent and business effects.

Redis/Valkey is advisory coordination only. A wake-up may be missed, duplicated or unavailable without losing durable work.

## Existing durable foundations retained

Phase 07 hardens the existing system rather than introducing a second queue framework.

| Path | Durable identity / arbitration | Replay safety |
| --- | --- | --- |
| Automation actions/jobs | PostgreSQL action request + job rows; `FOR UPDATE SKIP LOCKED`; one execution-attempt claim per job | bounded attempts, retry schedule, `uncertain`, `dead_letter`, recovery/reconciliation |
| Lead assignment / fair turn | transactional PostgreSQL matching/assignment authority | locked/atomic Core mutation |
| Credits/package purchase | payment row lock + canonical `qf_apply_vendor_credit_delta` reference | `(package_purchase, payment_id)` returns `already_applied` on replay |
| Conversation outbound | `communication_conversation_outbox.idempotency_key` | exact replay reconciles conversation/source/proposal/revision/body digest |
| Jarvis turn dispatch | inbound message ID + durable outbox row | bounded exponential retry; duplicates converge |
| Aarohi discovery/follow-up | deterministic schedule/prospect identity + upsert | Phase 07 adds cross-replica schedule-occurrence ownership before producers run |

## Phase 07 additions

### Distributed schedule occurrence identity

`scale_scheduler_occurrences` is a durable PostgreSQL ownership/fencing record:

- primary key `(scheduler_key, occurrence_key)`;
- one active owner token;
- monotonic fence;
- bounded lease;
- expired incomplete occurrences may be reclaimed;
- stale token/fence completion is rejected;
- completed occurrences never run again.

This prevents multiple Aarohi scheduler replicas from duplicating the same schedule bucket while preserving downstream producer idempotency as a second fence.

### Per-replica worker heartbeat/drain

`scale_worker_heartbeats` is keyed by `(worker_role, worker_id)`, so multiple replicas coexist instead of overwriting a singleton heartbeat.

It records only operational state: starting/running/idle/degraded/draining/stopped, accepting-work, in-flight count, heartbeat/drain timestamps and a bounded safe code. It does not carry business truth.

### Queue depth and age

`qf_scale_queue_health_v1()` exposes read-only backpressure evidence: ready/retry/processing/dead-letter automation jobs, conversation outbox depth/age, Jarvis turn outbox depth/age, and fresh/draining worker replica counts.

### Event-driven wake-up

After a durable PostgreSQL write/replay convergence, hot conversation lanes publish a best-effort Redis/Valkey wake-up. The transport worker drains bounded durable work, waits on a wake-up while idle, then falls back to jittered bounded PostgreSQL polling if Redis is unavailable or the wait times out.

The previous 10 ms busy / 100 ms idle defaults are removed.

### Graceful drain

On SIGINT/SIGTERM the worker stops entering new loop cycles, lets the current awaited operation finish, marks `draining` with `accepting_work=false`, closes the coordination subscriber, and finally records `stopped`.

## Priority / fairness

The native automation engine keeps separate bounded family lanes for client journey / transactional client WhatsApp, vendor journey / transactional vendor WhatsApp, and campaigns / bulk execution. Bulk work cannot consume an unbounded cycle and starve transactional lanes.

## Failure semantics

- Redis outage cannot remove durable jobs.
- Scheduler crash leaves the occurrence owned until lease expiry.
- Reclaim gives the new owner a higher fence.
- Old owners cannot complete after reclaim.
- Provider uncertainty is not converted into automatic replay.
- Retry-exhausted or poison automation jobs remain in durable dead-letter/uncertain recovery paths for operator review.

## Certification

The Phase 07 PostgreSQL harness proves 20 concurrent scheduler replicas racing one occurrence produce exactly one owner and one simulated effect. It also proves wrong-owner rejection, completed replay convergence, single-owner crash recovery among 12 concurrent reclaimers, monotonic fencing, stale-owner rejection, multi-replica heartbeats, and queue depth/dead-letter/age observability.

Production migration application remains part of the normal release process; Phase 07 certification does not directly mutate production.