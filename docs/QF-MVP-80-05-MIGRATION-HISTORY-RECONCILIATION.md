# QF-MVP-80.05 — Migration / history governance reconciliation

**Status:** complete. **ZERO migrations applied.** No migration file was added, removed,
renamed or edited. Migration count remains **102**.

## What was wrong

The staging-history manifest and the harnesses that consume it pinned five migrations as
`SOURCE-PENDING` / `NOT_PROVEN_OFFLINE`:

| Version | Name | Phase |
| --- | --- | --- |
| `20260813000000` | `qf_mvp_40_13b_canary_activation_authority` | QF-MVP-40.13B |
| `20260814000000` | `qf_mvp_40_marketing_consent_writer` | QF-MVP-40 |
| `20260815000000` | `qf_mvp_75_01_matchcore_binding_rank_order` | QF-MVP-75.01 |
| `20260816000000` | `qf_mvp_75_02_geo_postgis_shortlist` | QF-MVP-75.02 |
| `20260817000000` | `qf_mvp_80_03_audit_logs_forward_repair` | QF-MVP-80.03 |

All five are **already applied to both staging and production**. The claim was stale
documentary state, never a schema-application problem: each was applied by its own gate,
and the manifest was simply never brought forward afterwards.

## Evidence (read-only)

Both environments return the same six rows from `supabase_migrations.schema_migrations`
for `version >= '20260812000000'`:

```
20260812000000  qf_mvp_50_5_automation_recovery_reconciliation
20260813000000  qf_mvp_40_13b_canary_activation_authority
20260814000000  qf_mvp_40_marketing_consent_writer
20260815000000  qf_mvp_75_01_matchcore_binding_rank_order
20260816000000  qf_mvp_75_02_geo_postgis_shortlist
20260817000000  qf_mvp_80_03_audit_logs_forward_repair
```

**Production (`yqpgcsduqbxulrlzwzap`)** — read first-party by this phase over a direct
read-only connection. 37 total history rows; newest version `20260817000000`.

**Staging (`uckafzuochmbvtiodmcl`)** — **owner-certified**. This phase could not open its
own direct connection: the pooler rejected the credential with `28P01` on both attempts,
and no password reset was performed to get past it, because that is not this phase's
business. The owner-supplied read-only result above is used verbatim; nothing was
invented. It is independently corroborated by three SELECT-only object probes against
staging, each naming an object that only one of the disputed migrations creates:

- `public.audit_logs` exists — created only by `20260817000000`
- `public.vendors.geo_point` exists — created only by `20260816000000`
- `public.leads.geo_point` exists — created only by `20260816000000`

## What changed in source

The manifest keeps `appliedPostAnchorMigrations` frozen at its original ten. Those ten
mean something specific — *applied with a first-party or owner-reviewed apply record and
an **observed** remote-history count (21 through 30)* — and no such record exists for the
five reconciled here. Promoting them into that array would have forced one of two bad
outcomes: fabricating remote-history counts nobody observed, or loosening the marker and
count rules that guard the original ten. Both were rejected.

Instead:

- `reconciledPostAnchorMigrations` (new) holds the five, each `operationalStatus:
  "APPLIED"`, `appliedToStaging: true`, `appliedToProduction: true`, with its own
  evidence type `DIRECT_READ_ONLY_REMOTE_HISTORY_CERTIFICATION`, its own distinct
  marker, and **no** `remoteHistoryCountAfterApply` key at all.
- `pendingPostAnchorMigrations` is now `[]`. The key is kept, not deleted, so a future
  slice cannot quietly reintroduce an unpinned pending entry by recreating the array.
- `historyReconciliation` (new) records the certified interval, the provenance of each
  environment's evidence, and that this slice authorizes no database mutation and no
  production apply.

The full applied truth is the **union** of `appliedPostAnchorMigrations` and
`reconciledPostAnchorMigrations` — fifteen post-anchor migrations, zero pending.

## What prevents this recurring

G1 (`test:mvp:50-2c-s2-g1`) now proves, deterministically and offline:

1. the five reconciled versions are `APPLIED` and appear in no pending list;
2. every pinned applied-history version maps to a real migration source file whose name,
   path and canonical SHA match the pin;
3. the pending set is present and **empty**;
4. migration versions stay unique and the count stays 102;
5. the reconciled five carry no fabricated remote-history count;
6. the reconciled five cannot borrow the applied ten's markers or evidence type;
7. the certified interval matches both remote histories exactly;
8. `20260817000000` is represented as applied;
9. the reconciliation authorizes no database mutation and no production apply.

Mutants reject re-marking the set `SOURCE-PENDING`, demoting any single entry, moving one
back to the pending list, deleting either list, forging or borrowing markers, fabricating
counts, claiming one environment but not the other, and overstating staging as a
first-party read.

G1 still performs **no database access of its own**, and CI carries no database
credential. The remote evidence is imported into the manifest and pinned there.
