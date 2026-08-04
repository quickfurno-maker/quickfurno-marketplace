# QF-MVP-20.2C2 — Staging Baseline Application Results

**STATUS: `COMPLETE` — APPLIED AND VERIFIED** (resolved by QF-MVP-20.2C2R).

| Stage | Outcome |
|---|---|
| **Migration application** | **SUCCESS** — single `npx supabase db push --linked`, exit 0, one history row. |
| **Initial verifier** (`e82b757f…`) | **FAILED** — 24 PASS / 6 FAIL, caused entirely by **verification-artifact defects** (catalog semantics), not by any schema, privilege, data or migration defect. |
| **Corrected verifier** (`7ba9792f…`) | **PASS — 40/40 rows**, after correcting function matching to exact `to_regprocedure` OID resolution and index counting to `conindid`-based classification. |
| **Staging during correction** | **UNMODIFIED** — correction was offline (SQL artifact + validator only); only SELECT-only reads were issued afterwards. |
| **Baseline reapplication** | **NONE** — no `db push`, no reset, no repair, no history change, no patching. |

Baseline SQL remained byte-identical (`920a4aa0…`) throughout.

## Checksum provenance correction — QF-MVP-50.2C-S2-G1

The original report recorded `920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81` as the repository and external copied-migration checksum. The later L3 forensic audit proved that the immutable repository baseline has one Git content revision and hashes to `101ac82c7840eec8802155fec4d4a18cba445447b7d773aaf168417f737aa33c`. The `920a4aa0…` value was not reproduced by the Git source or tested LF, CRLF, BOM, and final-newline representations. The old repository-source checksum claim is therefore a documentation error and is withdrawn as a source-integrity assertion.

The external apply workspace is no longer retained, so the exact historical external-file byte identity cannot now be re-proven. This correction does not invalidate the exact remote ledger version/name/statement identity or the successful corrected **40/40** staging verification. G1 made no database mutation and did not rerun or rewrite the historical command output below.

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

**Conclusion:** all six failures were incorrect *expectations inside the verification artifact*. The applied schema matched the reviewed inventory on every independently-measured dimension.

### ✅ Corrected verification (QF-MVP-20.2C2R) — **40/40 PASS**

The verification artifact was corrected **offline** (staging untouched) and re-executed. Corrections:
- **Functions:** each expected signature is now resolved to an exact catalog OID via `to_regprocedure(format('%I.%I(%s)', schema, name, type_args))`; the OID is the comparison key. `pg_get_function_identity_arguments()` output is used **only** for human-readable details, never string-compared.
- **Indexes:** indexes are classified via `pg_constraint.conindid`; the reviewed 180/32 now correctly measure **standalone** (non-constraint-backed) indexes, with catalog totals (257/109) retained as supporting checks.

| Check | Expected | Actual | Status |
|---|---|---|---|
| `03a_quickfurno_function_count` | 39 | **39** | PASS |
| `03b_quickfurno_function_missing` | 0 | **0** | PASS |
| `03c_quickfurno_function_duplicate_or_unresolved` | 0 | **0** | PASS |
| `03d_quickfurno_security_definer_count` | 33 | **33** | PASS |
| `03e_allowed_managed_public_function_count` | 1 | **1** | PASS |
| `03f_unexpected_public_function_count` | 0 | **0** | PASS |
| `03g_total_public_function_count` (supporting) | 40 | **40** | PASS |
| `06a_primary_key_constraint_count` | 62 | **62** | PASS |
| `06c_unique_constraint_count` | 15 | **15** | PASS |
| `06d_check_constraint_count` | 169 | **169** | PASS |
| `07a_constraint_backed_index_count` | 77 | **77** | PASS |
| `07b_standalone_index_count` | 180 | **180** | PASS |
| `07c_standalone_unique_index_count` | 32 | **32** | PASS |
| `07d_combined_uniqueness_mechanism_count` | 47 | **47** | PASS |
| `07e_total_public_table_catalog_index_count` (supporting) | 257 | **257** | PASS |
| `07f_total_catalog_unique_index_count` (supporting) | 109 | **109** | PASS |

All remaining rows (`01`, `02` tables 62, `04` RLS 62, `05` policies 67, `06b` FK 69, `08` triggers 0, `09/10` views 0, `11` zero-rows, `12/13`, `14` six RPCs, `15–17` privilege lockdowns, `18–21` anon lockouts, `22–25` provider/communication empty + Meta disabled, `26` one truthful history row) also **PASS**. **Total: 40 PASS / 0 FAIL.**

## 12. Zero-data proof (extended, QF-MVP-20.2C2R)

`11_all_tables_zero_rows` → max row count across all public tables = **0**. Independent per-table enumeration: **tables containing ≥1 row = 0** (all 62 empty). `auth.users` = **0**. Entity spot-checks all **0**: `vendors`, `leads`, `lead_assignments`, `payments`, `vendor_packages`, `vendor_credit_logs`. Communication/provider spot-checks all **0**: `communication_provider_accounts`, `communication_provider_template_mappings`, `communication_messages`, `communication_webhook_receipts`, `communication_inbound_messages`, `communication_delivery_events`, `communication_consent_events`, `communication_suppressions`. No synthetic application row was created.

**Production-reference scan:** function bodies containing the production ref = **0**; function bodies containing any URL = **0**; column defaults containing production ref/URL = **0**; comments containing production ref/URL = **0**; configuration rows = none exist (all tables empty).

## 13. Privilege proof

Four blocker RPCs: **0** EXECUTE grants across PUBLIC/anon/authenticated. Legacy credit primitives (`deduct_vendor_credit`, `restore_vendor_credit`, `increment_vendor_credits`): **0** such grants. `qf_apply_vendor_credit_delta`: service_role **true**, anon **false**, authenticated **false**. anon has **no** SELECT on any `vendors` monetization column and **no** access to `vendor_credit_logs`, `vendor_packages`, or `payments`. All privilege checks **PASS**.

## 14. Provider-inactive proof

`communication_provider_accounts` **0** · `communication_provider_template_mappings` **0** · `communication_messages` **0** · provider runtime policies with a non-`disabled` activation or `outbound_enabled` **0**. Meta remains inactive; no provider was activated.

## 15. Auth-trigger limitation

SELECT-only catalog inspection: `auth.users` has **NO** non-internal triggers; `on_auth_user_created` is **absent**; the `public.handle_new_user` function **exists** (created by the baseline) but is unwired. Recorded as **`OPEN_FORWARD_MIGRATION_PREREQUISITE`**. No Auth user was created, no signup or profile-provisioning test was run, and **full Auth parity is not claimed**.

## 16. Advisor findings (staging only — collected in QF-MVP-20.2C2R after full PASS)

**Security advisors**

| Category | Level | Count | Affected | Classification |
|---|---|---|---|---|
| `rls_enabled_no_policy` | INFO | 32 | `auth_security_events`, `authentication_*`, 13× `communication_*`, `lead_assignment_queue`, `lead_auto_assignment_logs`, `lead_clarification_*`, `lead_scores`, `marketplace_runtime_settings`, `password_reset_grants`, `vendor_mobile_auth_provisions`, `vendor_package_orders`, `vendor_package_purchase_requests`, `verification_challenges`, `free_vendor_profile_interests` | **Expected & correct** — RLS on with no policy = **fail-closed** for anon/authenticated; these are service_role-only tables. **Non-blocking.** |
| `rls_policy_always_true` | WARN | 1 | `public.leads` policy `leads public insert` (INSERT, `WITH CHECK true`, roles anon+authenticated) | Inherited production policy (public enquiry intake). **Mitigated here:** anon holds **no table grant** on `leads`, so the policy is unreachable by anon (object privilege is the outer gate). **QF-MVP-20.3A remediation**; non-blocking for the baseline. |
| `anon_security_definer_function_executable` | WARN | 2 | `get_public_eligible_vendors(...)`; `rls_auto_enable()` | First is **intentional** (evidence-backed public listing, grant manifest); second is **Supabase platform-managed**. **Non-blocking.** |
| `authenticated_security_definer_function_executable` | WARN | 4 | `get_public_eligible_vendors(...)`, `is_admin()`, `owns_vendor(uuid)`, `rls_auto_enable()` | First three are **intentional** per the reviewed grant manifest (public listing + RLS predicates); last is **platform-managed**. **Non-blocking.** |

**No advisor flags any of the four blocker RPCs, the legacy credit primitives, or `qf_apply_vendor_credit_delta` as anon/authenticated-executable** — independently corroborating the lockdown.

**Performance advisors** (212 findings)

| Category | Level | Count | Affected | Classification |
|---|---|---|---|---|
| `unused_index` | INFO | 147 | all public indexes | **Expected artifact** — zero rows and zero query traffic on a freshly-applied empty baseline. **Non-blocking.** |
| `multiple_permissive_policies` | WARN | 36 | `app_settings`, `leads`, `vendors`, `payments`, `lead_assignments`, `profiles`, `vendor_*`, `bad_lead_report*`, `cities`, `packages`, `service_categories`, … | Inherited from the reproduced 67-policy production set. Performance-only. **QF-MVP-20.3A remediation candidate**; non-blocking. |
| `unindexed_foreign_keys` | INFO | 18 | `client_requirement_groups`, `communication_*`, `leads`, `payments`, `vendors`, `vendor_packages`, `verification_challenges`, … | Inherited production schema characteristic. **QF-MVP-20.3A candidate**; non-blocking. |
| `auth_rls_initplan` | WARN | 7 | `client_accounts`, `leads`, `profiles`, `vendor_dashboard_users`, `vendors` | Policies re-evaluate `auth.<fn>()` per row (inherited). Performance-only. **QF-MVP-20.3A candidate**; non-blocking. |
| `duplicate_index` | WARN | 3 | `vendor_dashboard_users{idx_..._vendor, idx_..._vendor_id}`; `vendors{idx_vendors_city, vendors_city_idx}`; `vendors{idx_vendors_status, vendors_status_idx}` | Inherited production duplicates. **QF-MVP-20.3A cleanup candidate**; non-blocking. |
| `auth_db_connections_absolute` | INFO | 1 | Auth server connection strategy | **Supabase platform-managed** config. **Non-blocking.** |

**No advisor finding is blocking for QF-MVP-20.3A.** No remediation was applied.

## 17. Failures and deviations

1. Six initial verification FAIL rows (§11) — verification-artifact expectation defects, root-caused above and **RESOLVED** in QF-MVP-20.2C2R (now 40/40 PASS). No schema, privilege, data, or migration defect was ever present.
2. Non-fatal CLI warning about the local pg-delta/Docker migration-catalog cache (§8) — no effect on the remote apply.
3. During 20.2C2R the Supabase connector rejected two query shapes using `pg_get_functiondef` (wrapper-side `array_agg` error); the equivalent read was obtained via `pg_proc.prosrc`. No effect on results — both are read-only metadata reads.

## 18. Rollback / transaction status

**No rollback was required or performed.** The single `db push` completed with exit code 0 and recorded exactly one history row; there is **no partial or interrupted apply**. Staging currently holds the complete reviewed baseline with zero application data. Staging was deliberately left in this applied state rather than reset, because the failure is in the verification expectations, not in the applied schema — and the task forbids reset/repair/manual patching.

## 19. Production non-impact proof

Production `yqpgcsduqbxulrlzwzap` was never linked, never queried (not even SELECT), and never mutated. The linked marker resolved to `uckafzuochmbvtiodmcl` before and immediately prior to the push; a scan of every file under `supabase/.temp/` found **no** production reference. Every database call was explicitly scoped to the staging project id.

## 20. Next-phase prerequisites

1. ✅ **Verification artifact corrected** (QF-MVP-20.2C2R) — exact `to_regprocedure` OID resolution + `conindid` index classification; validator extended; **40/40 PASS**.
2. ✅ **Advisors collected** (§16) — none blocking; `multiple_permissive_policies`, `unindexed_foreign_keys`, `auth_rls_initplan`, `duplicate_index` and the permissive `leads public insert` policy are **QF-MVP-20.3A remediation candidates**.
3. **`auth.users → handle_new_user` trigger remains OPEN_FORWARD_MIGRATION_PREREQUISITE** — do not create Auth users or test signup until it is designed as a forward migration.
4. Staging remains the only permitted database target; production stays untouched. The four blocker RPCs remain service_role-only compatibility objects pending the canonical engine.
5. Proceed to **QF-MVP-20.3A — Marketplace Authority Remediation Migration Design**.
