# QF-MVP-20.2C2 — Staging Baseline Application Results

**STATUS: `FAILED_REQUIRES_REVIEW`** — the baseline **applied successfully (exit 0)**, but the reviewed verification SQL returned **6 FAIL rows out of 30**. Per the task rule ("do not treat a partial PASS as success"), this phase is **not** marked complete. Staging was **not** patched, `db push` was **not** re-run, and no reset/repair was performed.

## 1. Branch & commit baseline

Branch `mvp/qf-mvp-20-marketplace-engine-v1` @ `b72308ae20cc0dbbccb1f1523ae3a6ed1fb1bfe5`; tracked tree clean; secrets/skills excluded; `supabase/migrations/**` unchanged.

## 2. Staging project identity (only permitted target)

QuickFurno Staging · ref `uckafzuochmbvtiodmcl` · ap-southeast-1 · ACTIVE_HEALTHY. Link marker `supabase/.temp/project-ref` = `uckafzuochmbvtiodmcl`; every ref-bearing `.temp` file contained only the staging ref.

## 3. Prohibited production identity

QuickFurno · ref `yqpgcsduqbxulrlzwzap` — **never linked, never queried, never mutated**. No production reference appeared in any CLI marker, temp file, or command.

## 4. Artifact hashes (all matched before any remote action)

| Artifact | SHA256 | Result |
|---|---|---|
| Source schema evidence | `269c9265…a2a2f` | ✅ locked |
| Repo baseline SQL | `920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81` | ✅ locked |
| External copied migration | `920a4aa0…ecc81` | ✅ byte-identical to repo |
| Repo verification SQL | `e82b757fd618983d91acdd80822daee8b64cd4e0bfbeaa16ea456af83e353d90` | ✅ corrected artifact |

External workspace held exactly **one** `.sql` migration, **no seed**, and no repository migration. Offline validator: **PASS**.

## 5. Pre-application staging state (SELECT-only)

PG **17.6** · public base tables **0** · total public functions **1** (exactly the managed `public.rls_auto_enable()`, no args, SECURITY DEFINER, no production reference) · **QuickFurno functions 0** · policies **0** · indexes **0** · views/matviews **0** · migration-history table **absent** (0 rows) · `auth.users` present · `gen_random_uuid()` present · provider-account table absent · no production reference in public objects. Staging was empty as required.

## 6. Final dry-run

`migration list --linked` → local **1** (`20260722000100`) / remote **0**. `db push --linked --dry-run` → "DRY RUN: migrations will *not* be pushed"; proposed exactly `20260722000100_qf_mvp_staging_baseline_269c9265.sql`; **no** seed, Edge Function, config deploy, repair, reset, repository migration, or production access.

## 7. Exact db-push command

```
npx supabase db push --linked
```
Single invocation from the external apply workspace (confirmation `y` supplied on stdin). Not used: `--include-seed`, `--include-all`, `db reset`, `migration repair`, `migration squash`, psql restore, dashboard SQL editor, or any retry.

## 8. Exit code

**0** (success). Output: `Applying migration 20260722000100_qf_mvp_staging_baseline_269c9265.sql...` → `Finished supabase db push.`

**Non-fatal deviation:** the CLI emitted `Warning: failed to cache migrations catalog … Docker Desktop is a prerequisite for local development`. This is a **local pg-delta catalog cache** feature requiring Docker; it does not affect the remote apply. The migration applied and exit code was 0.

## 9. Migration-history result

`migration list --linked` → local `20260722000100` / remote `20260722000100`. SELECT-only inspection of `supabase_migrations.schema_migrations` returned **exactly one row**:

| version | name (as Supabase stored it) | statements |
|---|---|---|
| `20260722000100` | `qf_mvp_staging_baseline_269c9265` | 821 |

No other QuickFurno version, no production historical versions, no fabricated 68-version history. Migration history was not modified by hand.

## 10. Post-application catalog counts

public base tables **62** · RLS-enabled **62** · policies **67** · primary keys **62** · foreign keys **69** · UNIQUE constraints **15** · CHECK constraints **169** · public-table triggers **0** · views **0** · matviews **0** · total public functions **40** (39 QuickFurno + 1 managed) · standalone indexes **180** · standalone unique indexes **32**.

## 11. Verification results — 24 PASS / 6 FAIL

**PASS (24):** `01_pg_version_and_db` (17.6) · `02_public_base_tables` 62 · `03c_allowed_managed_public_function_count` 1 · `03e_total_public_function_count` 40 · `05_rls_enabled_tables` 62 · `06_policies` 67 · `07_primary_keys` 62 · `08_foreign_keys` 69 · `09_unique_constraints` 15 · `10_check_constraints` 169 · `12_triggers` 0 · `13_views` 0 · `14_materialized_views` 0 · `15_all_tables_zero_rows` 0 · `16_auth_users_exists` · `17_gen_random_uuid_exists` · `18_six_assignment_rpcs_exist` 6 · `19_blockers_not_public_anon_auth` 0 · `20_legacy_credit_not_public_anon_auth` 0 · `21_credit_delta_service_role_only` (sr=true, anon=false, auth=false) · `22_anon_no_monetization_columns` (all false) · `23_anon_no_vendor_credit_logs` false · `24_anon_no_vendor_packages` false · `25_anon_no_payments` false · `26/27/28` provider+communication tables 0 · `29_provider_runtime_disabled` 0 · `30_no_false_migration_history` 1.

**FAIL (6):**

| check_name | expected | actual |
|---|---|---|
| `03a_quickfurno_function_count` | 39 | **3** |
| `03b_quickfurno_function_missing` | 0 | **36** |
| `03d_unexpected_public_function_count` | 0 | **36** |
| `04_quickfurno_security_definer_count` | 33 | **3** |
| `09b_unique_indexes` | 32 | **109** |
| `11_indexes` | 180 | **257** |

### Root-cause analysis (verification-artifact expectation defects, not baseline defects)

**A. Function-identity format (checks 03a / 03b / 03d / 04).** `pg_get_function_identity_arguments()` returns **argument NAME + type**, not type-only — confirmed live: for `deduct_vendor_credit` it returns `p_vendor_id uuid`. The `expected_fn` CTE in the verification artifact encodes **type-only** strings (`'uuid'`), so 36 of 39 identities failed to join; only the **3 zero-argument** functions (`expire_vendor_packages`, `handle_new_user`, `is_admin`) matched on both sides (`''`), which is exactly why 03a/04 report 3. The 36 rows listed as "unexpected" are byte-for-byte the same 36 QuickFurno functions, printed in the name+type form. Corroborating evidence that the schema is correct: `03e_total_public_function_count` = **40 PASS** (39 QuickFurno + 1 managed) and `18_six_assignment_rpcs_exist` = **6 PASS**.

**B. Index population (checks 09b / 11).** `pg_indexes` and `pg_index.indisunique` count **constraint-backed** indexes in addition to standalone ones. Live breakdown: total indexes **257** = standalone **180** + constraint-backed **77** (62 PK + 15 UNIQUE); unique indexes **109** = standalone unique **32** + the same 77. The standalone figures are **exactly** the reviewed expectations (180 / 32). The checks compared the reviewed "CREATE INDEX statement" population against a catalog population that includes constraint-backed indexes.

**Conclusion:** all six failures are incorrect *expectations inside the verification artifact*. The applied schema matches the reviewed inventory on every independently-measured dimension. **This task is not authorized to modify the verification SQL**, so the correction belongs to a follow-up reconciliation task.

## 12. Zero-data proof

`15_all_tables_zero_rows` → max row count across all 62 public tables = **0**. `auth.users` row count = **0**. No synthetic application row was created. (The extended per-table enumeration in the "additional read-only safety proof" section is gated on a full verification pass and was therefore not executed; the aggregate max-row check covers all 62 tables.)

## 13. Privilege proof

Four blocker RPCs: **0** EXECUTE grants across PUBLIC/anon/authenticated. Legacy credit primitives (`deduct_vendor_credit`, `restore_vendor_credit`, `increment_vendor_credits`): **0** such grants. `qf_apply_vendor_credit_delta`: service_role **true**, anon **false**, authenticated **false**. anon has **no** SELECT on any `vendors` monetization column and **no** access to `vendor_credit_logs`, `vendor_packages`, or `payments`. All privilege checks **PASS**.

## 14. Provider-inactive proof

`communication_provider_accounts` **0** · `communication_provider_template_mappings` **0** · `communication_messages` **0** · provider runtime policies with a non-`disabled` activation or `outbound_enabled` **0**. Meta remains inactive; no provider was activated.

## 15. Auth-trigger limitation

SELECT-only catalog inspection: `auth.users` has **NO** non-internal triggers; `on_auth_user_created` is **absent**; the `public.handle_new_user` function **exists** (created by the baseline) but is unwired. Recorded as **`OPEN_FORWARD_MIGRATION_PREREQUISITE`**. No Auth user was created, no signup or profile-provisioning test was run, and **full Auth parity is not claimed**.

## 16. Advisor findings

**NOT RUN.** Security and performance advisors are gated on "after successful application **and verification**"; because verification did not fully pass, advisors were deliberately not read. They should be collected in the follow-up once verification passes.

## 17. Failures and deviations

1. Six verification FAIL rows (§11) — verification-artifact expectation defects, root-caused above.
2. Non-fatal CLI warning about the local pg-delta/Docker migration-catalog cache (§8) — no effect on the remote apply.

## 18. Rollback / transaction status

**No rollback was required or performed.** The single `db push` completed with exit code 0 and recorded exactly one history row; there is **no partial or interrupted apply**. Staging currently holds the complete reviewed baseline with zero application data. Staging was deliberately left in this applied state rather than reset, because the failure is in the verification expectations, not in the applied schema — and the task forbids reset/repair/manual patching.

## 19. Production non-impact proof

Production `yqpgcsduqbxulrlzwzap` was never linked, never queried (not even SELECT), and never mutated. The linked marker resolved to `uckafzuochmbvtiodmcl` before and immediately prior to the push; a scan of every file under `supabase/.temp/` found **no** production reference. Every database call was explicitly scoped to the staging project id.

## 20. Next-phase prerequisites

1. **Correct the verification artifact** (follow-up task): encode `expected_fn` identities in the real `pg_get_function_identity_arguments` form (`argname type`, e.g. `p_vendor_id uuid`) — or compare on a normalised type-only projection — and re-scope `09b`/`11` to **standalone (non-constraint-backed)** indexes (expected 32 / 180). Update the validator accordingly.
2. Re-run the corrected verification against staging and require **all rows PASS** before declaring 20.2C2 complete.
3. Collect security + performance advisors once verification passes.
4. `auth.users → handle_new_user` trigger remains an open forward-migration prerequisite; do not create Auth users until it is designed.
5. Only then proceed to **QF-MVP-20.3A — Marketplace Authority Remediation Migration**.
