# QF-MVP-20.2C1 — Staging Baseline Application Preflight

**Branch:** `mvp/qf-mvp-20-marketplace-engine-v1` · **HEAD:** `61f18c11c4641aafcdc050c896c9c4e39a4d751f` · **Type:** SELECT-only staging access + `db push --dry-run`. **No baseline applied, no staging mutation, no production access, no deployment.**

## 1. Branch & commit baseline

Branch and HEAD match the required baseline; tracked tree clean; `.claude/`, `.mcp.json`, `skills-lock.json` ignored; `supabase/migrations/**` unchanged; raw production dump absent from Git.

## 2. Environment identity

| Role | Name | Ref | Region | Status |
|---|---|---|---|---|
| **Staging (only permitted target)** | QuickFurno Staging | `uckafzuochmbvtiodmcl` | ap-southeast-1 | ACTIVE_HEALTHY |
| **Production (PROHIBITED)** | QuickFurno | `yqpgcsduqbxulrlzwzap` | ap-southeast-1 | (never accessed) |

Also present in the org (not touched): `coilipywdvxklewquqvv` (QF-Jarvis). Production `yqpgcsduqbxulrlzwzap` was **never linked and never queried**.

## 3. Artifact hashes (recomputed; all match)

| Artifact | SHA256 | Required | Match |
|---|---|---|---|
| Source dump (external, not committed) | `269c9265…` | `269c9265…` | ✅ |
| Generated baseline | `920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81` | `920a4aa0…` | ✅ |
| Verification SQL (at preflight time) | `89362a35ea5ef503df4c06aa6782a5a084e29cfa1ffb8b13df5d4436a6cd7777` | `89362a35…` | ✅ (superseded by QF-MVP-20.2C1R → `e82b757f…`) |

- **Offline validator:** PASS. **Deterministic regeneration:** YES (regenerated == committed `920a4aa0…`).
- Baseline is **outside** `supabase/migrations/` (0 matches there); `supabase/migrations/**` unchanged; raw dump not in Git.

## 4. Corrected catalog expectations (verify SQL inspected)

The generated `verify_qf_mvp_staging_baseline.sql` uses the **corrected** catalog counts and does **not** assert the text-pattern artifacts:

| Expectation | Value in verify SQL |
|---|---|
| UNIQUE constraints | **15** (not 47) |
| unique indexes | 32 (32 + 15 = the audit's 47, noted in `details`) |
| CHECK constraints | **169** (not 178; the "178" reconciled in `details` as a text-pattern count) |
| indexes | 180 · tables 62 · functions 39 · SECURITY DEFINER 33 · policies 67 · RLS 62 · PK 62 · FK 69 · triggers 0 · views 0 |

No count in the verify SQL is inconsistent with the corrected expectations. **The verify SQL was not modified in this task.**

## 5. External apply workspace

Path (outside the repo, **not committed**): `C:\Users\KESHAV SHARMA\Desktop\qf-staging-apply`

- `supabase/config.toml` (from `npx supabase init`), `supabase/migrations/20260722000100_qf_mvp_staging_baseline_269c9265.sql`.
- **Exactly one** `.sql` migration; **no seed file**; no repository migration copied.
- Not tracked by the QuickFurno repo git.

## 6. Copied migration hash

`920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81` — identical to the reviewed baseline (hash preserved through the copy).

## 7. Linked-project proof

- `npx supabase link --project-ref uckafzuochmbvtiodmcl` → `{"project_ref":"uckafzuochmbvtiodmcl"}`.
- `supabase/.temp/project-ref` = **`uckafzuochmbvtiodmcl`** (STAGING). Not `yqpgcsduqbxulrlzwzap`.
- Scan of all `supabase/.temp/*` files: **no production reference present**.
- No passwords/tokens/keys/connection strings were printed or stored in this document.

## 8. SELECT-only staging state (project `uckafzuochmbvtiodmcl`)

All checks were read-only (`pg_catalog`/`information_schema`); no function that mutates data was invoked. Values captured **after** the dry-run, so they also prove nothing was applied.

| # | Check | Result | Verdict |
|---|---|---|---|
| 1 | database reachable | yes | ✅ |
| 2 | PostgreSQL version | **17.6** | ✅ 17.x |
| 3 | public base tables | **0** | ✅ |
| 4 | public functions | **1** | ⚠ **finding** — see below |
| 5 | public policies | **0** | ✅ |
| 6 | migration-history rows | **0** (`supabase_migrations.schema_migrations` absent) | ✅ |
| 7 | `auth.users` exists | true | ✅ |
| 8 | `gen_random_uuid()` available | true | ✅ |
| 9 | provider accounts | **0** (`public.communication_provider_accounts` absent) | ✅ |
| 10 | production ref in public objects | **0** | ✅ |
| + | public indexes / views / matviews | 0 / 0 / 0 | ✅ |
| + | RLS-enabled public tables · triggers on public tables | 0 · 0 | ✅ |

**Check 4 finding — Supabase-managed platform default (not empty-as-assumed):** the public schema already contains **one managed function `rls_auto_enable()`** (plpgsql, SECURITY DEFINER, not extension-owned, no comment), invoked by the managed event trigger **`ensure_rls`** (`ddl_command_end`). The project also carries 6 other managed event triggers in non-public schemas (`pgrst_ddl_watch`, `pgrst_drop_watch`, `issue_pg_cron_access`, `issue_pg_net_access`, `issue_pg_graphql_access`, `issue_graphql_placeholder`). These are Supabase/org platform defaults, **not QuickFurno objects**, and the `rls_auto_enable` body does **not** reference the production ref. Consequences for 20.2C2 in §13.

## 9. Migration-history preflight (`migration list --linked`)

Output: `[{"local":"20260722000100","remote":"","time":"2026-07-22 00:01:00"}]`

- **Local migration count = 1**; **remote migration count = 0** (`remote` empty).
- The only local pending version is **`20260722000100`**.
- No repository migration version appears locally; no production historical migration row appears remotely.

## 10. Dry-run result (`db push --linked --dry-run`, captured externally)

```
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20260722000100_qf_mvp_staging_baseline_269c9265.sql
Finished supabase db push.
```

- Proposes **exactly one** migration; **no** seed execution, Edge Function, config deployment, migration repair, database reset, repository migration, or production access.
- `db push` was **never** run without `--dry-run`.

## 11. Proposed migration identity

`20260722000100_qf_mvp_staging_baseline_269c9265.sql` — the single reviewed baseline (identity `qf_mvp_staging_baseline_269c9265`).

## 12. Known missing Auth trigger

The production public-schema dump does **not** include the managed-schema trigger connecting `auth.users` → `handle_new_user`. Therefore, in staging: **do not create Auth users, do not run signup / auth-profile provisioning tests, and do not claim complete Auth parity.** Recreating `on_auth_user_created` (on `auth.users`) is a **forward-migration prerequisite**, not part of the public baseline.

## 13. Blockers / findings for QF-MVP-20.2C2

1. **Managed function delta (parity):** staging already has `public.rls_auto_enable()`. After the baseline applies its 39 functions, the public function count will be **40**, so the old total-only verify check (expected **39**) would read **40** and FAIL. **Do not drop `rls_auto_enable`** (it is a managed RLS security default). **✅ RESOLVED in QF-MVP-20.2C1R:** the verification SQL is now **identity-scoped** — it checks the exact 39 QuickFurno function identities (`03a`=39, `03b` missing=0, `04` SD scoped=33), allows exactly one managed `public.rls_auto_enable()` (`03c`=1), rejects any other unexpected public function (`03d`=0), and keeps `total_public_function_count`=**40** only as a supporting check. Superseded verify hash `89362a35…` → current `e82b757f…`.
2. **`ensure_rls` fires during apply:** the event trigger auto-enables RLS on each `CREATE TABLE`. The baseline also explicitly enables RLS on all 62 tables → **idempotent/aligned, harmless**; note only.
3. **Auth new-user trigger absent** (§12) — forward migration.
4. **authenticated dashboard grants deferred** (from 20.2B) — forward remediation; the baseline grants authenticated only `is_admin`/`owns_vendor` EXECUTE.
5. **Real-push credential:** `link` / `migration list` / `dry-run` succeeded via the CLI's stored access token (the DB was reachable). 20.2C2 must confirm the real `db push` credential/DB-password path before applying.

## 14. Exact QF-MVP-20.2C2 application prerequisites

1. Confirm linked ref = `uckafzuochmbvtiodmcl` (abort on `yqpgcsduqbxulrlzwzap`) immediately before applying.
2. Resolve the function-count parity reconciliation (blocker §13.1) — decide the verify approach for the +1 managed function; do not drop managed defaults.
3. Apply the single migration `20260722000100_qf_mvp_staging_baseline_269c9265.sql` (identity `qf_mvp_staging_baseline_269c9265`) with `npx supabase db push --linked` from the external workspace — **no** `db reset`, **no** repo-chain replay, **no** history fabrication.
4. Run `verify_qf_mvp_staging_baseline.sql` (SELECT-only); require all rows `PASS` (with the §13.1 reconciliation applied).
5. Recreate the `auth.users` → `handle_new_user` trigger as a forward migration only if signup is to be exercised.
6. Never touch production; never merge staging history into production.
