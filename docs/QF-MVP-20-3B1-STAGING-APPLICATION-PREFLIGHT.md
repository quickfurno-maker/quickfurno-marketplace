# QF-MVP-20.3B1P — Marketplace Authority Migrations Staging Application Preflight

**Status: `COMPLETE` — every preflight check passed. Staging application (QF-MVP-20.3B1A) was authorized and has since been attempted.**

> **OUTCOME UPDATE (QF-MVP-20.3B1A):** application ran and produced a **partial result** — A and A2 committed, **B1 failed and rolled back completely**. The preflight was sound: every gate it checked held true at application time. The failure came from a defect the preflight could not see — a false positive inside **B1's own in-database verification block**, where a negative regex over `pg_get_functiondef()` matched the function's own explanatory comments. Full analysis: [`QF-MVP-20-3B1-STAGING-APPLICATION-RESULTS.md`](QF-MVP-20-3B1-STAGING-APPLICATION-RESULTS.md).
>
> **Preflight gap to close:** neither the dry-run nor either validator can execute a migration's in-database `DO` block. A dry-run proves *which* migrations would run, never that their internal assertions will pass. Future preflights should treat in-migration verification blocks as unverified until applied.

**Type:** target verification · SELECT-only staging inspection · external-workspace preparation · one migration dry-run.
**No staging write. No real `db push`. No migration applied. No migration-history change. No production access. No QF-Jarvis access.**

---

## 1. Repository baseline

| Item | Value |
|---|---|
| Branch | `mvp/qf-mvp-20-marketplace-engine-v1` |
| Starting HEAD (complete) | `19e9c834cfa70e74217198200e8cc88bdd3a223c` |
| Commit subject | `fix(mvp): close canonical authority migration contracts` |
| `git status --short` | empty — tracked tree clean |
| Uncommitted changes under `supabase/` or `scripts/` | none |
| `.claude/`, `.mcp.json`, `skills-lock.json` | excluded via `.git/info/exclude`, zero tracked files |
| External staging workspaces | zero tracked files |
| Raw production schema in Git | absent from the index (confirmed) |

## 2. Environment identities

| Role | Name | Reference | Access in this task |
|---|---|---|---|
| **Staging (only permitted target)** | QuickFurno Staging | `uckafzuochmbvtiodmcl` | **SELECT-only** + one dry-run |
| Production — **PROHIBITED** | QuickFurno | `yqpgcsduqbxulrlzwzap` | **NONE** |
| QF-Jarvis — **PROHIBITED** | QF-Jarvis | `coilipywdvxklewquqvv` | **NONE** |

Target proven before every remote operation. `get_project('uckafzuochmbvtiodmcl')` returned **QuickFurno Staging**, `ap-southeast-1`, `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.147`. Every SQL statement was issued with `project_id = uckafzuochmbvtiodmcl` explicitly.

No password, database URL, API key, access token, service-role key, connection string or private row content appears in this document or was printed at any point. The workspace `pooler-url` marker was scanned by match-count only; its contents were never read out.

## 3. Locked artifact hashes — all verified before remote access

| Artifact | Required SHA256 | Result |
|---|---|---|
| `supabase/staging-baseline/20260722000100_qf_mvp_staging_baseline_269c9265.sql` | `920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81` | **OK** |
| `supabase/staging-baseline/verify_qf_mvp_staging_baseline.sql` | `7ba9792f300119b7c1aa84a4c02394186116a507c9097bd6f95f23f55e504193` | **OK** |
| `supabase/migrations/20260723000100_qf_mvp_marketplace_authority_foundation.sql` | `b6307094715a102fa0cfccc1533cb8089e5b26fbe1e80a294c127b81e29f2b83` | **OK** |
| `supabase/migrations/20260723000200_qf_mvp_assignment_lineage_backfill.sql` | `9d77f4460701caa1caf172b50886b681f4b7e86849172ca2a7af1ece70eb3d60` | **OK** |
| `supabase/migrations/20260723000300_qf_mvp_canonical_assignment_authority.sql` | `a4b5c3783afc6ed82598035afeff60d0e0e84a0c8cdaa08d874e7b2832b842db` | **OK** |
| `supabase/staging-verification/verify_qf_mvp_20_3b1.sql` | `688ab439efac077d8868078875cd501d3221a62c8682c63df6223296f3144cf7` | **OK** |
| `scripts/mvp/staging/validate-qf-mvp-20-3b1.mjs` | `4497a3c0f5b36e061ce4a1d4d4977bd831b194fa4ea2335f3dd92f728b5f4795` | **OK** |
| External production-schema evidence (outside Git) | `269c9265d32a9f85488d76bfcf9dd528bd9b6b915bafb09ebb024a6bde182a2f` | **OK** |

**Phase validator** `validate-qf-mvp-20-3b1.mjs` → **PASS, 105/105**.

## 4. External baseline-validator result

`scripts/mvp/staging/validate-staging-baseline.mjs`, run offline with its documented arguments against the external production-schema evidence → **PASS**.

Reported counts: 62 tables · 39 functions · 33 SECURITY DEFINER · 67 policies · 62 RLS · 62 PK · 69 FK · 15 UNIQUE · 169 CHECK · 180 indexes · 0 triggers · 0 views. `anon` executes only `get_public_eligible_vendors`; 10 mutation RPCs verified not reachable by anon/authenticated/PUBLIC; `anon` holds no table grant; baseline SHA confirmed locked and unmodified.

The raw production schema was **not** copied into Git and **not** modified.

## 5. External apply workspace

Workspace: `Desktop\qf-staging-apply` — intentionally **not** a Git repository (verified: no `.git` directory). No Git command was run there and nothing from it was committed.

**Pre-change inventory:** `supabase/config.toml` present; `supabase/migrations/` contained exactly one file, the already-applied baseline, hashing to `920a4aa0…`. No unexpected SQL migration existed, so no file needed deleting. No seed file present.

**After copying A, A2 and B1 from the reviewed repository:**

| # | File | SHA256 | Byte-identical to repo |
|---|---|---|---|
| 1 | `20260722000100_qf_mvp_staging_baseline_269c9265.sql` | `920a4aa0…` | yes (pre-existing, unchanged) |
| 2 | `20260723000100_qf_mvp_marketplace_authority_foundation.sql` | `b6307094…` | yes |
| 3 | `20260723000200_qf_mvp_assignment_lineage_backfill.sql` | `9d77f446…` | yes |
| 4 | `20260723000300_qf_mvp_canonical_assignment_authority.sql` | `a4b5c378…` | yes |

Exactly **four** `.sql` migrations · zero non-SQL files in the migrations directory · zero seed files · none of the other 68 repository migrations copied · no repo config, environment file, provider configuration, Edge Function or verification SQL copied. Ordering is **baseline → A → A2 → B1**.

## 6. Linked-project proof

`npx supabase projects list` (CLI 2.109.1) from the workspace:

| Project | Reference | `linked` |
|---|---|---|
| QF-Jarvis | `coilipywdvxklewquqvv` | **false** |
| **QuickFurno Staging** | `uckafzuochmbvtiodmcl` | **true** |
| QuickFurno (production) | `yqpgcsduqbxulrlzwzap` | **false** |

`supabase/.temp/project-ref` = `uckafzuochmbvtiodmcl`. A scan of every file under `supabase/.temp/` found **3** files referencing staging, **0** referencing production and **0** referencing QF-Jarvis. Exactly one project is linked and it is staging. No relink was required or performed.

## 7. SELECT-only staging precheck — 20/20 as expected

| # | Check | Expected | Actual |
|---|---|---|---|
| 1 | PostgreSQL version | 17.x | **17.6** |
| 2 | public application tables | 62 | **62** |
| 3 | QuickFurno functions | 39 | **39** |
| 4 | managed `rls_auto_enable` | 1 | **1** |
| 5 | total public functions | 40 | **40** |
| 6 | RLS-enabled application tables | 62 | **62** |
| 7 | public policies | 67 | **67** |
| 8 | migration-history rows | 1 | **1** |
| 9 | migration-history version | `20260722000100` | **`20260722000100`** |
| 10 | migration-history name | `qf_mvp_staging_baseline_269c9265` | **match** |
| 11 | all 62 tables zero rows | 0 rows total | **62 scanned, 0 with rows, 0 total rows** |
| 12 | `auth.users` | 0 | **0** |
| 13 | provider accounts | 0 | **0** |
| 14 | provider template mappings | 0 | **0** |
| 15 | communication messages | 0 | **0** |
| 16 | A foundation tables present | 0 of 5 | **0** |
| 17 | `qf_assign_lead_vendors_v2` | absent | **absent** |
| 18 | `qf_apply_credit_mutation_v2` | absent | **absent** |
| 19 | production reference in public object definitions | 0 | **0** (bodies, defaults and comments) |
| 20 | QF-Jarvis reference in public object definitions | 0 | **0** (bodies, defaults and comments) |

Supporting: 0 public-table triggers, 0 views, 0 `20260723*` history versions. No QuickFurno application function was invoked; no DDL, DML, grant, revoke, comment or migration repair was executed.

## 8. Baseline reverification — 40 PASS / 0 FAIL

The locked verifier was re-hashed to `7ba9792f300119b7c1aa84a4c02394186116a507c9097bd6f95f23f55e504193` **immediately before execution**, then executed verbatim and unmodified against staging.

**Result: 40 rows, 40 PASS, 0 FAIL.** Highlights: 62 base tables · function parity by exact `to_regprocedure` OID (39 found / 0 missing / 0 duplicate-or-unresolved / 33 SECURITY DEFINER / 1 managed / 0 unexpected / 40 total) · 62 RLS · 67 policies · 62 PK / 69 FK / 15 UNIQUE / 169 CHECK · index classification 77 constraint-backed / 180 standalone / 32 standalone-unique / 47 combined / 257 / 109 · 0 public-table triggers · 0 views · 0 materialized views · all tables zero rows · `auth.users` present · 6 legacy assignment RPCs resolve · 0 PUBLIC/anon/authenticated EXECUTE on the 4 blockers and the 3 legacy credit primitives · `qf_apply_vendor_credit_delta` service_role-only · anon has no monetization column, ledger, package or payment access · providers empty and disabled · exactly one truthful baseline history row.

The QF-MVP-20.3B1 phase verifier was **deliberately not executed** — A/A2/B1 are not applied, so its expectations do not yet hold.

## 9. Migration list

`npx supabase migration list --linked`:

| Version | Local | Remote | State |
|---|---|---|---|
| `20260722000100` | present | **present** | applied baseline |
| `20260723000100` | present | *(empty)* | **pending** |
| `20260723000200` | present | *(empty)* | **pending** |
| `20260723000300` | present | *(empty)* | **pending** |

Exactly **one** remote QuickFurno migration version · exactly **four** local versions · exactly **three** pending. No repository-history replay, no production migration-history versions, no fabricated 68-version history. `migration repair` was not run.

## 10–12. Dry-run

**Command (run exactly once):**

```
npx supabase db push --linked --dry-run
```

**Exit code: 0.** Neither `--include-all` nor `--include-seed` was used. No real `npx supabase db push --linked` was run.

The CLI printed `DRY RUN: migrations will *not* be pushed to the database.` and proposed **exactly these three migrations, in this order**:

1. `20260723000100_qf_mvp_marketplace_authority_foundation.sql`
2. `20260723000200_qf_mvp_assignment_lineage_backfill.sql`
3. `20260723000300_qf_mvp_canonical_assignment_authority.sql`

None of the failure conditions occurred: the baseline was **not** re-proposed; not fewer and not more than three migrations; none of the other 68 repository migrations; no seed execution; no migration repair; no reset; no config deployment; no Edge Function deployment; no production access; no QF-Jarvis access.

Sanitized stdout, stderr and exit code were captured to `_evidence/` inside the external workspace, outside Git.

## 13. Post-dry-run non-mutation proof

| # | Check | Expected | Actual |
|---|---|---|---|
| 1 | migration-history rows | 1 | **1** (`20260722000100`) |
| 2 | A/A2/B1 versions present remotely | 0 | **0** |
| 3 | five foundation tables present | 0 | **0** |
| 4 | canonical functions present (all 5) | 0 | **0** |
| — | `lead_assignments` new columns present | 0 | **0** |
| — | public tables / total functions | 62 / 40 | **62 / 40** |
| 5 | tables with rows / total rows | 0 / 0 | **0 / 0** |
| 6 | `auth.users` | 0 | **0** |
| 7 | provider accounts / active runtime policies | 0 / 0 | **0 / 0** |
| — | public-table triggers | 0 | **0** |

The dry-run produced **no schema change and no data change**. Staging is byte-for-byte in the same state as before this task.

## 14. Known capability boundary

**`client_selected` mode: `R1_BLOCKED_PENDING_OWNER_BINDING`.**

Current B1 behaviour: **fails closed** — returns `unauthorized` before the operation claim, so not even an `assignment_operations` row is created. The function is unavailable to `PUBLIC`, to `anon` and to `authenticated` in every mode. No runtime client-selected activation is authorized.

This is deliberately withheld authority, not a defect, and **does not block staging installation of B1**. Client ownership was not investigated or solved during this preflight.

## 15. Deviations

None. Every check produced the expected result on the first attempt. No relink was needed, no unexpected workspace file was found, and nothing had to be deleted or repaired.

## 16. Blockers

**None.** The `BLOCKED_EXTERNAL_EVIDENCE` status carried by QF-MVP-20.3B1 was already closed in 20.3B1R and remains closed: the external production-schema evidence is present, hash-matched, and the baseline validator passes.

Open items that do **not** block this application: `client_selected` needs an R1 ownership binding; the `public.audit_logs` repository drift (non-blocking, tracked separately); the 27-row historical ledger gap (QF-MVP-20.4).

## 17. QF-MVP-20.3B1A application prerequisites

Before applying, re-confirm in this order:

1. Repository is at a clean tree on `mvp/qf-mvp-20-marketplace-engine-v1`, and the seven locked artifact hashes still match §3 exactly.
2. Phase validator still returns **105/105 PASS**; baseline validator still returns **PASS** against the external evidence.
3. Target proof: `linked = true` for `uckafzuochmbvtiodmcl` only; `supabase/.temp/` contains **zero** production and **zero** QF-Jarvis references.
4. Workspace still contains exactly the four `.sql` migrations at the hashes in §5, no seed, and no other repository migration.
5. `migration list --linked` still shows 1 remote / 4 local / 3 pending.
6. Staging is still empty (0 rows across 62 tables, `auth.users` = 0, providers inactive) and the history still holds exactly the one baseline row.

Then apply **once**:

```
npx supabase db push --linked
```

from `Desktop\qf-staging-apply` — no `--include-all`, no `--include-seed`, no `db reset`, no `migration repair`.

Immediately after application:

7. Require exit code 0 and exactly three newly recorded versions: `20260723000100`, `20260723000200`, `20260723000300` — history must then hold exactly **four** rows.
8. Run `supabase/staging-verification/verify_qf_mvp_20_3b1.sql` (SHA256 `688ab439…`) and require **all-PASS** across its 58 checks.
9. Re-run the locked baseline verifier (`7ba9792f…`) and confirm it still passes unchanged where its expectations remain valid; record any expectation that the additive A/A2/B1 delta legitimately changes rather than silently editing the locked file.
10. Confirm A2 on empty staging created **zero** backfill operations and **zero** lineage events (`T44`), and that `vendor_credit_logs` and `communication_intents` remain at zero.
11. Confirm **zero** enforcement triggers exist on `lead_assignments` and `lead_assignment_events` — B2 is not part of this release.
12. Confirm all six legacy assignment RPCs remain present and no legacy grant was broadened or revoked.
13. Do **not** create an Auth user, do **not** activate a provider, and do **not** create synthetic fixtures. The T43–T67 behavioural matrix runs in a later, separately authorized phase.

Rollback boundary if application fails mid-way: the migrations are transactional per file; do **not** hand-patch and do **not** retry blindly. Inspect SELECT-only, fix the file in the repository, and re-apply to a rebuilt staging if the schema is left partial.
