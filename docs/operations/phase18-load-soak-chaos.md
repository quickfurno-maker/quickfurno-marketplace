# Phase 18 — Load, Soak, Chaos & Failure Certification

Status: implementation + isolated certification.

Phase 18 composes earlier real database, worker, network and host-loss proofs rather than replacing them with a toy benchmark. The canonical policy is `qfj.phase18.cert.v1`.

## Certified workload envelope

The gate covers public browsing, enquiry bursts, vendor registration/login, concurrent matching, vendor dashboard activity, payment/webhook retries, WhatsApp storms, Jarvis bursts, campaigns and admin operations. D1 and D2 explicitly retain the 100k and 1M vendor tiers from Phase 00.

## Correctness is stronger than throughput

Overload may return bounded 429/503 responses. It may never create duplicate payments, credits, assignments or provider sends; never exceed three vendors per lead; never bypass authorization; and never convert Redis/Valkey into business truth.

## Evidence composition

- Phase 08 real PostgreSQL/PostGIS discovery at 100k and 1M vendors.
- Phase 08 canonical concurrent assignment proof, including same-lead contention.
- Phase 12 durable job and horizontal-worker recovery.
- Phase 16 real two-container HAProxy host-loss drill.
- Phase 11 bounded QuickFurno/Jarvis timeout/circuit behavior.
- Phase 18 sustained bounded queue/pool/idempotency soak with duplicate/reordered work and provider failure injection.

## Audit-driven scenarios

Phase 18 explicitly covers identical scheduler races, 10+ idle workers, Redis notification loss/outage with DB fallback, N/N-1 rolling compatibility, DB pool pressure, runtime-settings invalidation storms, concentrated city/category matching, Realtime reconnect storms, object-storage failure, and mass duplicate/reordered webhooks.

## Safety

All destructive/load tests are isolated. Production load testing, production DB mutation, traffic cutover, paid provider activity and AGNI authority expansion are forbidden in this phase.

## Exit gate

No correctness violation. SLO/overload behavior remains bounded according to Phase 00. The automated soak runs for at least 60 seconds and must drain queues, respect DB concurrency bounds, avoid unbounded heap growth, and preserve idempotency.
