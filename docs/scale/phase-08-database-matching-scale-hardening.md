# Phase 08 — Database & Matching Scale Hardening

## Production audit — 2026-10-04

QuickFurno production was audited read-only before implementation.

- PostgreSQL database size: **49 MB**
- `max_connections`: **60**
- observed at audit: **14 total / 1 active**
- Supabase performance advisor: **73 unindexed foreign keys**
- existing vendor PostGIS GiST index: present
- existing lead PostGIS GiST index: present
- existing conversation outbox dispatch index: present
- existing Jarvis-turn outbox dispatch index: present
- existing automation job claim index: present

The 73 FK warnings were **not** converted into 73 indexes. Phase 08 adds indexes only where the measured matching query needs them. Blanket indexing would increase write amplification and maintenance cost without evidence.

The historical outbox scan counts are dominated by the polling behavior addressed in Phase 07; the relevant dispatch indexes already exist.

## Correctness defect removed

Before Phase 08, `evaluateVendorsForLead()` paged the vendors table in UUID order and stopped after 5,000 rows. At 100k/1M vendors, an eligible vendor outside that arbitrary prefix could never be considered.

Phase 08 changes the normal path to:

1. PostgreSQL static automatic-eligibility prefilter
2. service-zone/city scope filter
3. indexed category tier discovery
4. straight-line distance + current fair-opportunity ordering
5. bounded candidate window (default 512, absolute max 2,048)
6. canonical TypeScript eligibility/ranking re-evaluation
7. existing transactional `qf_assign_lead_vendors_v2`

The database prefilter cannot assign a lead, debit credits, or replace Core authority.

## Indexes added

- `vendors.matching_terms` generated normalized category vocabulary + GIN
- `vendors.matching_city_key` generated city fallback key
- partial `idx_vendors_auto_match_scope`
- partial covering `idx_vendor_opportunity_events_delivered_scope_recent`

No duplicate outbox indexes are added.

## Geography policy

Business policy is unchanged: **straight-line distance**. No Google Routes dependency is introduced.

PostGIS is used for indexed geography storage/access; the SQL prefilter uses the same canonical coordinate priority and a Haversine helper rounded to 3 decimals to mirror the TypeScript audit/ranking contract.

## Scale certification

Local certification uses PostgreSQL 17 + PostGIS and applies the actual Phase 08 migration.

Synthetic topology models 20 service zones/cities.

### 100k vendors

- rows: **100,001**
- warm runs: **267.8 / 237.6 / 259.3 ms**
- worst warm latency: **267.8 ms**
- index probe: **4.7 ms**
- returned window: 512
- high-ID vendor beyond the historical first-5k scan: found
- SLO: **< 1.5 s — PASS**

### 1M vendors

- rows: **1,000,001**
- warm runs: **2,429.3 / 2,179.3 / 2,335.8 ms**
- worst warm latency: **2,429.3 ms**
- index probe: **135.1 ms**
- returned window: 512
- high-ID vendor beyond the historical first-5k scan: found
- SLO: **< 3.5 s — PASS**

These are certification-machine timings, not a production capacity guarantee. Phase 18 will perform production-like load/soak/chaos testing.

## Concurrent assignment certification

The contention harness extracts and executes the repository's real canonical `qf_assign_lead_vendors_v2` and real canonical credit mutation function against a PostgreSQL fixture.

Twelve simultaneous leads share six vendors with deliberately rotated fair rank order:

- 3 assignments per lead
- 6 assignments per vendor
- 36 total assignments
- 36 exact credit debits
- 0 duplicate lead/vendor pairs
- replay adds 0 effects
- 10 concurrent operations for one lead still end at exactly 3 assignments

This proves the canonical lock pass does not leak UUID lock order into business rank order, and confirms max-3 / credit / duplicate invariants under contention.

## RLS, bloat and maintenance decisions

- Existing overlapping permissive RLS findings are **not** rewritten in Phase 08 without query-specific proof; security semantics outrank speculative micro-optimization.
- Current hot tables are small. Dead-row ratios are observed, but no emergency bloat rewrite is justified.
- Phase 09 owns pool budgets and lifecycle/retention controls.
- Phase 18 owns high-concurrency production-like soak testing.

## Release state

The Phase 08 migration is additive and forward-only. Phase completion certifies source/CI behavior; remote staging/production application remains a release/deployment action, not an implicit side effect of the scale-hardening phase.
