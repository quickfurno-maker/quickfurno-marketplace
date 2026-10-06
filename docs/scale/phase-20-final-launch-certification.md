# Phase 20 — Final Scale Launch Certification

Status: implementation and reproducible certification evidence.

## Final launch position

QuickFurno remains the Core business authority and durable transactional source of truth. Launch compute remains Docker on the dedicated QuickFurno VPS. AWS and Kubernetes are not launch dependencies.

Phase 20 adds no business feature, no production traffic cutover and no production schema migration. It certifies that the architecture already built in Phases 5–19 meets the final launch-scale gate and records explicit dispositions for remaining provider/external controls.

## Polling gate

Phase 0 measured roughly 18 known coordination/poll queries per second during a low-business-traffic window, including the old 10 ms busy / 100 ms idle conversation transport loop.

Current source:
- conversation transport prefers Redis/Valkey wake-up;
- durable PostgreSQL polling remains the recovery fallback;
- default idle fallback is 1,000 ms with jitter;
- native automation default idle poll is 5,000 ms;
- old 10 ms busy / 100 ms idle defaults are removed.

Live production `pg_stat_statements` sample on 2026-10-06:
- window: 33.041376 seconds;
- tracked query delta: 266;
- measured combined rate: **8.05 qps**;
- Phase 20 threshold: **<= 10 qps**;
- reduction versus Phase 0 baseline: approximately **55.3%**;
- automation tracked-query delta in the window: **0**.

This is a read-only observation, not a production load test.

## Distributed scheduling and effects

The Phase 07 PostgreSQL concurrency certificate is re-run by the Phase 20 workflow. It proves concurrent scheduler replicas converge to exactly one owner/effect, crash lease recovery, monotonic fencing and stale-owner rejection. Durable idempotency remains the second fence.

## Database connection budget

QuickFurno web/API continues to use the Supabase Data API and does not create a per-replica `pg.Pool`. Direct SQL remains maintenance/certification only. Jarvis independently re-certifies its 16-connection application ceiling.

## Container baseline

Phase 20 revalidates the existing hardened container contract:
- immutable exact-source OCI identity;
- non-root runtime;
- read-only root at runtime;
- all capabilities dropped;
- no-new-privileges;
- bounded CPU/RAM/PIDs;
- externalized secrets;
- no business-critical host disk.

## Supabase security-advisor disposition

The live advisor snapshot is recorded in `phase20-supabase-advisor-disposition.json`.

No advisor ERROR/WARN is left unreviewed. The owner-rights `vendor_public_v` view remains an explicit accepted exception because the public projection is structurally allowlisted and base-table access stays revoked. `is_admin()` and `owns_vendor(uuid)` remain authenticated-only RLS helpers. At Phase 20 closeout, the live security advisor no longer reports the leaked-password-protection warning; broader password-strength, reauthentication and MFA hardening remains governed by the later Auth-security phase.

## Expand / contract rehearsal

A disposable PostgreSQL rehearsal proves:
1. old schema + old writer;
2. additive nullable expansion;
3. old/new writer coexistence;
4. bounded backfill;
5. new-reader cutover after completeness proof;
6. contract only after old-writer drain;
7. old writer fails after contract, new writer succeeds;
8. all business rows survive.

No production table is touched.

## Provider portability prerequisites

- Phase 21 Supabase exit inventory exists at `docs/scale/phase21-supabase-exit-inventory.md`.
- The identity/provider decision is locked in `docs/decisions/ADR-0200-identity-auth-provider-portability.md`.
- Full Supabase exit rehearsal remains Phase 21.
- Test identity-provider adapter remains Phase 22.

## Exit gate

Phase 20 is complete only when:
- this contract validates at exact reviewed heads;
- the disposable expand/contract rehearsal passes;
- distributed scheduler ownership is re-certified;
- previous scale contracts remain present;
- full repository quality/supply-chain gates are green after merge;
- final signed image digests and merged SHAs are recorded in Notion.
