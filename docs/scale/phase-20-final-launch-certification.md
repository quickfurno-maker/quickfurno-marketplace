# Phase 20 — Final Scale Launch Certification

Status: FINAL CERTIFICATION EVIDENCE. Phase 20 certifies the architecture/release train; it does not authorize a production Kubernetes/AWS/DB cutover.

## Canonical contract
- Contract: `qfj.phase20.final-launch.v1`
- SHA-256: `1191ECEF283B2D35639965ABC2B15A0D1B19400796B244E2CDA6B54B998B8DE1`
- Required on QuickFurno, Jarvis and AGNI byte-identically.

## Polling gate
Phase 00 measured about 18 known coordination/poll queries/sec during a low-business-traffic window.
Phase 20 locks the launch threshold at <= 9.0 qps (at least 50% reduction).

Read-only production `pg_stat_statements` sample on 2026-10-06:
- duration: 25.258s
- conversation group: +95 calls
- Jarvis-turn group: +96 calls
- runtime-settings group: +18 calls
- automation group: +0 calls
- total: 209 calls / 25.258s = 8.28 qps
- reduction from Phase 00 baseline: ~54%

Mechanism is structural: Redis/Valkey wake-up plus jittered PostgreSQL recovery polling. The historical 10ms busy / 100ms idle defaults are gone; conversation transport defaults to 1000ms idle recovery polling and native automation defaults to 5000ms idle polling.

## Distributed ownership
Phase 07 PostgreSQL certification is a Phase 20 prerequisite and is rerun in the Phase 20 focused workflow:
- 20 scheduler replicas contend for one occurrence
- exactly one lease owner
- exactly one simulated effect
- 12-way crash-recovery reclaim produces one new owner
- fencing is monotonic
- stale owner completion is rejected
- per-replica heartbeats coexist

## Database connection budget
QuickFurno web/API stays on the Supabase Data API and does not create one direct PostgreSQL pool per web replica.
Phase 18 bounded-soak pressure uses an 8-connection synthetic application ceiling.

Jarvis retains the measured Phase 09 budget:
- PostgreSQL baseline max_connections: 60
- reserved platform/admin: 28
- Jarvis application ceiling: 16
- incident headroom: 16
- 2 gateway replicas x 3 + 2 worker replicas x 5 = 16
The Phase 20 focused workflow reruns the real PostgreSQL connection-budget certificate.

## Expand / contract rehearsal
A disposable PostgreSQL rehearsal performs:
1. expand: add nullable replacement column and compatibility path;
2. backfill: bounded batches until no legacy-only rows remain;
3. compatibility: old and new readers return identical business state before contract;
4. contract: enforce the new invariant and remove the legacy column;
5. verify: row count and semantic digest remain unchanged.

No production database is touched by this rehearsal.

## Live Supabase security-advisor disposition
Snapshot: 2026-10-06.

### QuickFurno security
- ERROR `security_definer_view` / `public.vendor_public_v`: **ACCEPTED BY DESIGN**.
  - This is a 21-column safe public projection.
  - forbidden PII, credits, package/internal and precise-geo fields are structurally absent;
  - public row eligibility is inside the view;
  - anon has no base-table `public.vendors` privilege;
  - all write verbs are revoked;
  - security-invoker would require reopening base-table exposure.
  - Existing migrations 20260723000600 and 20260911000000 document and self-verify this boundary.
- WARN executable SECURITY DEFINER `public.is_admin()`: **ACCEPTED BY DESIGN**.
  - required by authenticated RLS;
  - PUBLIC/anon execute is revoked;
  - result is a caller-scoped boolean;
  - search_path is pinned.
- WARN executable SECURITY DEFINER `public.owns_vendor(uuid)`: **ACCEPTED BY DESIGN**.
  - required by vendor-ownership RLS;
  - PUBLIC/anon execute is revoked;
  - result is a caller-scoped boolean;
  - search_path is pinned.
- WARN leaked-password protection disabled: **EXTERNAL LAUNCH PREREQUISITE**.
  - password login is active for admin/vendor flows;
  - this setting is Supabase Auth control-plane configuration and is not mutated by repository CI;
  - enable Supabase leaked-password protection before broad password onboarding / public launch.
- INFO RLS-enabled-with-no-policy findings: reviewed informationally; many are server/service-role-only tables where “deny browser roles” is intentional.
- Performance INFO/WARN (unindexed FKs, unused indexes, multiple permissive policies, Auth connection strategy): retained for measured traffic-driven remediation; no blind index/policy deletion in Phase 20.

### Jarvis security
Only INFO advisor findings were present in the live snapshot; no ERROR/WARN security finding blocks Phase 20.

## Container hardening
QuickFurno/Jarvis/AGNI Phase 15–19 gates retain:
- non-root runtime identity
- read-only root filesystem where required
- no privilege escalation
- all Linux capabilities dropped
- PID/CPU/RAM bounds
- immutable OCI digests and signed provenance
- no business-critical host disk
- explicit secrets/config boundaries

## Infrastructure evidence
- current launch runtime: VPS + Docker
- production Kubernetes: absent by design
- AWS launch dependency: none
- QuickFurno Phase 16 OpenTofu tree: `b1df3f6c19f45b761ce518f3c55f39849db7d216`
- QuickFurno edge tree: `983c7f417e6f94e6788676d8def3d729f19b9c4e`
- Cloudflare edge-policy blob: `9cd68f6cd0ce22c2f5f9d4a0dc0f7631fd8c748a`
- Phase 16 topology contract blob: `90649223dc91f96157aa13df6346b57aba17dc9a`

## Production data-plane state at certification
QuickFurno managed migration head remains `20261003093648 aarohi_phase2_ops_fk_indexes`.
Later scale migrations remain source/CI certified and are not silently claimed as production-applied.
Jarvis managed project uses its internal `qf_jarvis.schema_migration` ledger; live head observed is version 1 / `0001_event_log.sql`.
Phase 20 performs no remote schema mutation.

## Provider / platform dependencies
- Supabase/PostgreSQL remains current DB/Auth/Storage provider.
- Managed Supabase PITR activation remains an operational prerequisite for claiming the Phase 17 120-second production DB RPO.
- Supabase leaked-password protection must be enabled before broad password onboarding.
- QuickFurno currently locks `@supabase/supabase-js 2.108.2`, whose package engine is Node >=20; the Supabase changelog indicates future client releases are dropping Node 20 support, so a client-library upgrade must be coupled to the planned runtime upgrade rather than silently bumping the package.
- Meta/WhatsApp, Google Places, Razorpay and model providers remain external dependencies behind existing bounded/provider-neutral boundaries.

## Portability records
- Phase 21 exit-inventory design: `docs/scale/phase-21-supabase-exit-inventory-design.md`
- Phase 22 identity/provider decision: `docs/scale/phase-22-identity-provider-portability-decision.md`

## Exit interpretation
Phase 20 COMPLETE means the scale architecture and immutable release train are evidence-backed and reproducible.
It does not mean every future growth migration has been activated in production.
Operational prerequisites remain explicit rather than being hidden inside a “green” architecture claim.
