# Phase 00 — Scale Baseline, SLOs & Capacity Model

Observed: 2026-10-04 (Asia/Kolkata)

This document is the evidence baseline for the QuickFurno + Jarvis scale-readiness program. It is **not** a claim that the current single-VPS topology can sustain the future certification tiers below.

## Source baselines

- QuickFurno: `e5451bf2c6a0bbdd0e38702935c11f503f2c6eef`
- QF Jarvis repository head observed: `7101b3c7cae2cfe384c416ad870cc1dbe4458253`
- Supabase project: production QuickFurno project
- Phase 00 implementation branch: `feat/scale-phase00-baseline`

## Current QuickFurno production host

- 2 vCPU, AMD EPYC virtual CPU
- 7.8 GiB RAM
- no swap
- 96 GiB root disk, ~32% used at observation
- Node v20.20.2
- npm 10.8.2
- nginx 1.24.0
- PM2 7.0.1
- Docker not active/installed as a production runtime
- live release symlink: `qf-prod-release-e5451bf2-20261003111830`

Primary PM2 roles:
- QuickFurno web
- native automation worker
- conversation transport worker

Two staging PM2 applications are also present on the production host.

### Host isolation finding — P0 before scale-out

At observation time nginx routed:
- public QuickFurno → localhost:3000
- staging hostname → localhost:3001

However additional Next.js listeners existed on ports 3002, 3099, 3101 and 3103. The latter three were detached processes from old releases; one working directory was already deleted.

External TCP probing from the authorized workstation showed:
- 3000 reachable
- 3001 not reachable
- 3002 reachable
- 3099 reachable
- 3101 reachable
- 3103 reachable

UFW was inactive on the host.

**Required disposition before launch hardening is considered complete:** verify ownership/necessity of every non-nginx listener, terminate obsolete processes, bind internal-only services to loopback/private networks, and enforce provider/host firewall policy so application ports are not directly exposed. Phase 00 intentionally did not alter production.

## Current Jarvis staging/runtime host

- 2 vCPU
- 7.8 GiB RAM
- 96 GiB disk, ~37% used
- Docker 29.6.1
- Docker Compose 5.3.0
- Traefik edge
- repository checkout at Jarvis head observed above

Observed containers included:
- Jarvis OS — healthy, ~178 MiB / 1 GiB limit
- WhatsApp worker — ~145 MiB / 2 GiB limit
- Jarvis gateway — healthy, ~31 MiB / 256 MiB limit
- QuickFurno core staging
- n8n
- Traefik

Jarvis already demonstrates several controls that QuickFurno should reuse: immutable image identity, resource limits, container health, non-root/read-only hardening, private pre-ingress proof and exact rollback discipline.

## Production PostgreSQL baseline

Observed production PostgreSQL:
- PostgreSQL 17.6
- database size ~49 MB
- `max_connections` ~60
- ~15 total connections at an observation point
- 0 waiting locks at the sampled point
- PostGIS installed
- all 139 public tables observed with RLS enabled

Performance-advisor baseline:
- 73 unindexed foreign-key warnings
- 34 multiple-permissive-RLS-policy performance warnings
- many currently unused indexes; these must **not** be deleted blindly before representative traffic exists

### Polling/query amplification finding

Cumulative `pg_stat_statements` counts included approximately:
- conversation outbox selector: 1.43M calls
- Jarvis-turn outbox selector: 1.42M calls
- marketplace runtime settings common read: 840k calls
- automation worker-family claim path: ~799k calls

A separate 10-second current sample observed approximately:
- conversation outbox selector: 7.8 calls/sec
- Jarvis-turn outbox selector: 7.9 calls/sec
- runtime-settings common read: ~1.0 calls/sec
- single runtime-setting read: ~0.3 calls/sec
- automation family-claim path: ~0.9 calls/sec

That is roughly **18 known coordination/poll queries/sec during a low-business-traffic observation window**.

The existing conversation transport configuration was observed at approximately:
- idle poll: 100 ms
- busy poll: 10 ms
- max drain: 50

**Architecture consequence:** PostgreSQL/outbox remains durable truth, but Redis/Valkey wake-up plus adaptive/jittered DB fallback is required before horizontal worker scale. Buying larger VPS capacity must not be used to hide unnecessary polling.

## Low-impact HTTP baseline

The committed `scripts/scale/http-baseline.mjs` harness uses GET only, bounded concurrency and explicit remote/high-load opt-ins.

### Public path — authorized workstation → quickfurno.in

30 measured requests/path, concurrency 2, 2 warmups:

| Path | p50 | p95 | p99 | Errors |
| --- | ---: | ---: | ---: | ---: |
| `/` | 46.19 ms | 120.76 ms | 122.43 ms | 0% |
| `/vendors` | 38.42 ms | 76.12 ms | 77.02 ms | 0% |
| `/api/public/google-maps-config` | 16.68 ms | 25.23 ms | 42.74 ms | 0% |

Jarvis public login baseline, 30 requests, concurrency 2:
- p50 31.35 ms
- p95 96.61 ms
- p99 96.83 ms
- 0% errors

### QuickFurno origin — localhost:3000 on production host

30 sequential requests/path:

| Path | p50 | p95 | p99 | Errors |
| --- | ---: | ---: | ---: | ---: |
| `/` | 8.32 ms | 14.66 ms | 25.95 ms | 0% |
| `/vendors` | 8.14 ms | 11.67 ms | 16.69 ms | 0% |
| `/api/public/google-maps-config` | 5.45 ms | 8.32 ms | 10.10 ms | 0% |

These figures show healthy low-load web latency. They do **not** establish maximum throughput.

## Target service-level objectives

These are certification targets. Provider-dependent latency is measured separately from QuickFurno/Jarvis overhead.

| Workload | p95 target | p99 target | Other gate |
| --- | ---: | ---: | --- |
| Public page/server response | <= 500 ms | <= 1,000 ms | <0.5% request failures |
| Core read API | <= 300 ms | <= 750 ms | >=99.9% success under certified load |
| Core write acknowledgement | <= 500 ms | <= 1,000 ms | external provider work must be async |
| Lead match + authoritative assignment | <= 750 ms | <= 1,500 ms | no fairness/credit/assignment violation |
| Webhook acknowledgement | <= 250 ms | <= 500 ms | durable work recorded before async processing |
| QF ↔ Jarvis platform overhead, excluding model/provider | <= 300 ms | <= 750 ms | signed/versioned/idempotent |
| Jarvis user-visible reply with healthy provider | <= 6 s | <= 12 s | provider/model time reported separately |
| Critical transactional queue age | <= 2 s | <= 5 s | no starvation by bulk traffic |
| Bulk/campaign queue age | <= 60 s | <= 5 min | never starves transactional lane |

Resource gates:
- DB connections: <=70% of safe global budget steady-state; <=85% transient burst
- app CPU: <=70% sustained target; <=85% short burst before scaling
- app memory: <=75% sustained target with no unbounded growth
- disk: warning at 70%, urgent at 80%
- no waiting DB locks attributable to application design at steady state
- no correctness violation is ever an acceptable overload mode

Availability:
- single-VPS launch topology must **not** be advertised as highly available
- after multi-host Phase 16, platform availability target is >=99.9% excluding declared upstream-provider outages

## Synthetic certification tiers

These are stress envelopes, **not traffic forecasts** and must not be run against production.

| Tier | Public RPS | Concurrent clients | Core writes/sec | Worker jobs/sec | Jarvis turns/sec | Webhook events/sec |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| L1 Launch | 50 | 100 | 5 | 10 | 5 | 20 |
| L2 Growth VPS / multi-process | 200 | 500 | 20 | 50 | 20 | 100 |
| L3 Multi-host / managed containers | 1,000 | 2,000 | 50 | 200 | 50 | 500 |
| L4 Long-term runway | 5,000 | 10,000 | 200 | 1,000 | 200 | 2,000 |

Dataset tiers:
- D1: 100k vendors + 1M leads + 5M communication/automation events
- D2: 1M vendors + 10M leads + 50M communication/automation events
- D3: 5M vendors + 50M leads + 250M communication/automation events

Phase 18 must certify the relevant workload/data tier in an isolated environment before infrastructure is promoted based on those numbers.

## Overload behavior contract

When capacity is reached:
- rate-limited traffic returns 429 with bounded retry guidance
- unavailable/saturated internal capacity returns controlled 503 rather than hanging indefinitely
- provider outages trip bounded retries/circuit breakers
- transactional work is prioritized over campaigns/background jobs
- no duplicate payment, credit, lead assignment or provider send
- no unbounded queue/connection/thread growth
- Core remains fail-closed for authorization and business invariants

## Phase 00 conclusion

The current low-load web path is fast. The primary scale risks are:
1. worker polling/query amplification
2. single-host availability
3. production/staging/orphan process isolation
4. finite PostgreSQL connection budget
5. database index/RLS performance debt
6. lack of QuickFurno container runtime parity with Jarvis

These findings determine the order of Phases 01–10.

## Revalidation snapshot — 2026-10-04

A second authorized low-impact public benchmark used 40 requests/path, concurrency 4 and 3 warmups:

| Path | p50 | p95 | p99 | Approx throughput | Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/` | 64.38 ms | 126.49 ms | 151.95 ms | 54.64 req/s | 0% |
| `/vendors` | 55.99 ms | 83.58 ms | 100.67 ms | 66.78 req/s | 0% |

This remains a low-impact baseline, not a production capacity claim.

The production listener/isolation finding was independently reverified:
- 3000 externally reachable — current production Next.js.
- 3001 loopback-only / not externally reachable — staging webhook.
- 3002 externally reachable — staging Next.js process.
- 3099 externally reachable — detached old Next.js release; working directory already deleted.
- 3101 externally reachable — detached old production release.
- 3103 externally reachable — detached old production release.
- UFW is inactive.

The stale/exposed listeners are therefore a confirmed P0 hardening input for Phase 01/02. Phase 00 remains measurement-only and intentionally performs no production cleanup.
