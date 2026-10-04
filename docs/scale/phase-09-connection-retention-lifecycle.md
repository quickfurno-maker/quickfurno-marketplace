# Phase 09 — Connection Pooling, Retention & Data Lifecycle

Status: implementation/certification evidence for the Phase 09 scale gate.

## Live baseline — 2026-10-04

QuickFurno production Supabase:
- PostgreSQL `max_connections = 60`
- 14 total connections / 1 active at the audit point
- database size: 49 MB
- application runtime: Supabase Data API clients; no production `pg.Pool` is created by QuickFurno web/API replicas
- largest measured lifecycle hotspot: `automation_transport_requests`, approximately 32k rows / 14 MB
- `communication_webhook_receipts`: approximately 425 processed + 2 ignored rows

This phase does not change the current Supabase compute tier and does not apply its migration to staging/production. The migration is source-pinned and certified locally/CI first.

## Connection strategy

QuickFurno web/API containers stay on the Supabase Data API. Horizontal web scaling therefore does not create one independent PostgreSQL pool per container.

Direct SQL is limited to controlled migration/maintenance/certification tooling. If a future stateless runtime needs direct SQL:
- short-lived/session-state-free traffic may use Supavisor transaction mode;
- prepared statements must be disabled for transaction mode;
- migrations, backup/restore, advisory/session-state work use direct or session mode;
- connection-count changes require a measured global budget rather than per-container defaults.

The live 60-connection ceiling is not treated as application capacity. Supabase/Auth/Storage/Realtime/health/admin connections and incident headroom remain reserved.

## Data lifecycle

| Relation | Class | Hot | Retained | Auto-delete | Archive before delete |
| --- | --- | ---: | ---: | --- | --- |
| `automation_transport_requests` | operational | 7d | 30d | yes, finalized only | no |
| `communication_webhook_receipts` | operational | 30d | 365d | yes, processed/ignored only | no |
| `communication_conversation_events` | business evidence | 30d | 365d | no | yes |
| `communication_delivery_events` | business evidence | 30d | 730d | no | yes |
| `automation_execution_attempts` | audit | 30d | 365d | no | yes |
| `audit_logs` | audit | 90d | 2555d | no | yes |
| `lead_matching_runs` | business evidence | 30d | 365d | no | yes |
| `vendor_campaign_events` | business evidence | 90d | 730d | no | yes |
| `aos_agent_logs` | telemetry | 7d | 30d | no in Phase 09 | yes |

Credits, payments, assignments, consent/suppression, idempotency/effect ledgers and other Core truth are deliberately absent from the prune authority.

The pruning RPC:
- has exactly two hardcoded target relations;
- refuses cutoffs newer than 24 hours;
- caps every call at 1,000 rows;
- orders by age/id and uses `FOR UPDATE SKIP LOCKED`;
- is service-role only;
- uses a five-second statement timeout.

## Partitioning

No table is partitioned in Phase 09. Current measured sizes do not justify the migration/operational complexity.

Policies carry partition-review thresholds so partitioning is triggered by measured growth, not architecture fashion:
- operational/telemetry review threshold: 1 GiB
- business/audit review threshold: 5 GiB

Append-only/time-ordered relations receive retention-friendly indexes now; physical partitioning remains a future measured decision.

## Read replicas

No replica endpoint is enabled in Phase 09.

Future replicas are opt-in only for eventually consistent reads such as analytics, historical reports, telemetry and public catalog reads.

The following remain primary/strong:
- lead assignment
- credit balance
- payment state
- consent state
- idempotency replay
- durable job claim
- any post-write confirmation/read-after-write path

## Certification gate

Phase 09 requires:
- runtime contract proving QuickFurno production code creates no `pg.Pool`;
- exact source pin for migration `20261004190002_scale_phase09_data_lifecycle.sql`;
- concurrent bounded-prune certification;
- near-live cutoff rejection;
- protected audit/business evidence preservation;
- migration-history guard, typecheck, lint and production build.
