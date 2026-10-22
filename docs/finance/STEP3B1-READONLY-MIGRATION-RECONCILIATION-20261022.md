# Step 3B-1 — Read-only migration reconciliation, QuickFurno / VOX

**Date:** 22 October 2026 · **decision:** RECONCILIATION EVIDENCE READY, NOT DEPLOYMENT APPROVAL.

## Verified sources

- First-party connected Supabase migration inventories: QuickFurno Staging `uckafzuochmbvtiodmcl` and separate Production `yqpgcsduqbxulrlzwzap`, fetched read-only.
- Current runnable Git worktree `supabase/migrations`; the existing post-G1 ledger `supabase/staging-history/qf-post-g1-migration-ledger-20260929.json`.
- Seven old VOX SQL sources deliberately outside the runnable tree, `ops/vox/quarantined-migrations/legacy-20261014/`.
- Captured per-version manifests, names and exact diff sets: `ops/vox/certification/STEP3B1-LIVE-MIGRATION-LEDGER-20261022.json`. No credentials or personal information.
- Reproducible read-only integrity check: `node scripts/scale/validate-vox-migration-reconciliation-step3b1.mjs`; checks counts, exact version sets, all 7 pinned normalized SHA-256 values and release HOLD.

## Version-set reconciliation (counts, **not** semantic schema-drift certification)

| Comparison | Observed |
|---|---:|
| Staging recorded applied versions | 86 |
| Production recorded applied versions | 86 |
| Staging and Production common version IDs | 34 |
| Staging-only version IDs | 52 |
| Production-only version IDs | 52 |
| Runnable SQL files in this worktree | 162 |
| Runnable source IDs shared with Staging history | 55 |
| Runnable source IDs absent in Staging recorded history | 107 |
| Staging historical IDs absent from runnable sources | 31 |
| Runnable source IDs shared with Production history | 45 |
| Runnable source IDs absent in Production recorded history | 117 |
| Production historical IDs absent from runnable sources | 41 |
| Old VOX candidate SQLs quarantined and unapplied in BOTH environments | 7 |
| Phase22 `20261006113720` identity migration applied in either managed environment | **No** |

Do not interpret 107 repository versions not individually recorded by Staging as 107 pending migrations. Historical baselines, consolidated DDL, environment-specific forward migrations, retired code, source pin versions and real schema state MUST be independently mapped before any individual installation. Two environments each having 86 migrations is **not parity**, nor is the old Phase-1 169-file expected source count a valid reason to mutate the live ledger.

The existing canonical tree validator currently **FAILS** deliberately: 169 expected runnable SQL files, 162 present; exact source-set mismatch; and 7 missing source check failures for the seven quarantined October 14 VOX migrations. `scripts/mvp/migration/currentMigrationTruth.mjs` was previously fixed to enumerate those missing files without ENOENT; it remains not green.

## Quarantine integrity and dependent execution order

All seven old VOX sources have matching canonical SHA-256 pins in the post-G1 manifest. All seven are outside runnable `supabase/migrations`, and none of their migration versions appear in either managed history. The source sequence is a dependency chain, not seven independent forward migrations:

1. `20261014010000` — staff teams, memberships, object scopes, append-only grant audit. References Core `profiles` and `cities`.
2. `20261014020000` — staff access requests and review decisions; references VOX teams from #1.
3. `20261014030000` — reviewed permission activation, dependent on request + grant tables from #1 and #2.
4. `20261014040000` — emergency revocation helper on the original grant/audit schema.
5. `20261014050000` — Team Leader review policy and revised reviewed-grant finalizer; supersedes functions defined earlier.
6. `20261014060000` — separate operational intents/review and audit, dependent on teams, profiles, cities and existing review authority.
7. `20261014070000` — approved Aarohi follow-up executor with `aarohi_tasks` and `aarohi_events` dependencies, plus operational intents from #6.

Staging read-only `to_regclass` confirms Core `profiles`, `cities`, `aarohi_tasks`, `aarohi_events` objects exist, while there are **0 installed VOX tables** and Phase22 identity tables are absent. This is existence-only, not a column, grant, constraint or transactional precondition certification. Do not unquarantine these files without DBA lineage/behavior review. They may be superseded by newer VOX candidate plans.

## Phase22 identity separation

`20261006113720_phase22_identity_portability.sql` is an **independent earlier source migration** (source SHA-256 `6F53E1781E4D2BD277645ED17B2EB635BE70F1D2C4DF7525CD176DFB0C2F28BA`). In Step 3A, its own isolated PostgreSQL17 full schema, RLS, idempotence, and post-migration restore passed; source contract 19/19 passed. **It is NOT recorded as applied in either managed environment.** Installing only Phase22 later requires exact live-catalog and historical dependency review, an actual authorized Staging backup/restore/rollback, and Owner authorization.

Legacy `scripts/grant-superadmin.mjs` currently writes Auth app_metadata and `profiles.role` **before** checking durable Phase22 identity role tables, which are missing. It must NOT be run on Staging as-is. `quickfurno@gmail.com` remains unprivileged with no verified MFA.

## Next explicit human/operational barriers

1. DBA/AppSec: review the canonical source pin/record vs Staging/Production 86-version histories, including 52/52 historical asymmetry and 31/41 live-version-without-current-source IDs, actual managed schema and owner/grant/RLS object definitions; classify each baseline, staged-only, superseded or intended future change. Resolve seven quarantined VOX files without copying or fake marking versions as applied.
2. Operator: capture fresh actual protected Staging backup and **test restore** (do not mistake isolated PG17 post-install restore for a managed pre-change rollback). Obtain independent sign-off on exact Phase22 SHA, dependencies, execution ordering, privileges and rollback.
3. Owner: approve a narrowly scoped TEST-only Staging identity migration only after the above. No Finance tables, VOX staff tables, Auth claims or remote roles are authorized here.
4. After approved managed Phase22 installation and catalog readback, prepare separately authorized atomic Owner/bootstrap path, enroll real TOTP/AAL2, and verify full staff scopes and revocation. Production Finance remains **HOLD**.

**Never execute broad `db push`, migration repair, manual ledger edits or unaudited SQL on either managed database.** This report contains read-only evidence and source/test artifacts, not an independent reviewer signature or launch permission.
