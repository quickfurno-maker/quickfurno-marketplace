# QF-MVP-20.2B — Staging Baseline Review

**Branch:** `mvp/qf-mvp-20-marketplace-engine-v1` · **Type:** offline SQL generation + review. No DB/staging/production access; no SQL executed; raw dump not committed.
**Artifacts:** generator `scripts/mvp/staging/generate-staging-baseline.mjs`, validator `scripts/mvp/staging/validate-staging-baseline.mjs`, grant manifest `scripts/mvp/staging/staging-baseline-grants.json`, baseline `supabase/staging-baseline/20260722000100_qf_mvp_staging_baseline_269c9265.sql`, verify `supabase/staging-baseline/verify_qf_mvp_staging_baseline.sql`.

## 1. Source evidence identity

| Item | Value |
|---|---|
| Source (external, not committed) | production public schema, schema-only |
| Source SHA256 | `269c9265d32a9f85488d76bfcf9dd528bd9b6b915bafb09ebb024a6bde182a2f` (300,426 bytes / 6,617 lines) |
| Generated baseline SHA256 | `920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81` |
| Verification SQL SHA256 | `89362a35ea5ef503df4c06aa6782a5a084e29cfa1ffb8b13df5d4436a6cd7777` |
| Baseline identity | `qf_mvp_staging_baseline_269c9265` · fixed instant `2026-07-22T00:00:00Z` |
| Production ref (PROHIBITED) | `yqpgcsduqbxulrlzwzap` · Staging ref (ONLY target) | `uckafzuochmbvtiodmcl` |

## 2. Transformation rules

- **Preserve** all schema-definition statements (schema, tables, constraints, indexes, functions, RLS enablement, policies, comments) and the restore-necessary session preamble (`check_function_bodies = false` — functions precede their referenced tables).
- **Remove** every top-level `ALTER … OWNER TO` (102), `GRANT` (201), `REVOKE` (28), `ALTER DEFAULT PRIVILEGES` (12), and any `SET ROLE`/`SESSION AUTHORIZATION` (0 present).
- **Reject (hard stop)** any top-level `COPY/INSERT/UPDATE/DELETE/MERGE/TRUNCATE`, `DROP DATABASE/SCHEMA/TABLE/FUNCTION/POLICY/ROLE`, `CREATE/ALTER/DROP ROLE`, `CREATE EXTENSION/SERVER`, or dblink/fdw. (None present — the source is clean.)
- **Inject** a safe `SET "search_path" TO 'pg_catalog', 'public'` into the six SECURITY INVOKER helpers that lack one.
- **Append** an explicit least-privilege grant block generated from the manifest + signatures derived from the source. No default privileges for anon/authenticated.

## 3. Statement-tokenizer design

A SQL-aware, top-level statement tokenizer (never a naïve `;` split) handles: single-quoted strings (`''` doubling + `E''` backslash), double-quoted identifiers (`""` doubling), **dollar-quoted bodies with arbitrary/tagged delimiters** (`$$`, `$tag$`), line comments (`--`), and **nested** block comments (`/* /* */ */`). Statements terminate only on a semicolon encountered at top level (outside every string/quote/comment/body). Stored-routine bodies (23 embedded `INSERT`s) are correctly retained inside function definitions and never mistaken for top-level data mutation.

## 4. Excluded statements (removed from the source)

| Class | Count | Note |
|---|---|---|
| `ALTER … OWNER TO` | 102 | 101×`postgres`, 1×`pg_database_owner`; incl. long-signature `ALTER FUNCTION … OWNER TO` (verified full-statement scan, 0 residual `OWNER TO` in output) |
| `GRANT` | 201 | replaced by the reviewed least-privilege block |
| `REVOKE` | 28 | replaced by explicit default-deny |
| `ALTER DEFAULT PRIVILEGES` | 12 | incl. the anon/authenticated function-default that was the root cause of anon-executable functions — NOT reproduced |
| `SET ROLE` / `SESSION AUTHORIZATION` | 0 | none present |
| destructive / data mutation | 0 | none present (the sole "TRUNCATE" token is inside a COMMENT) |

## 5. Rewritten statements

- **search_path injected (6):** `communication_consent_receipt_results_valid`, `communication_consent_receipt_scope_result_valid`, `qf_lead_vendor_parent_group_compatible`, `qf_norm_text`, `qf_normalize_category_label`, `qf_parent_category_group`. All are SECURITY INVOKER helpers; injection adds `SET "search_path" TO 'pg_catalog', 'public'` (writable schemas never precede `pg_catalog`/`public`). All 33 SECURITY DEFINER functions already carried a safe `search_path` (kept unchanged).
- **Header/preflight/grant block** prepended/appended (generated, deterministic).

## 6. Object counts (generated baseline == reviewed inventory)

| Object | Count | Object | Count |
|---|---|---|---|
| base tables | 62 | functions | 39 |
| SECURITY DEFINER | 33 | policies | 67 |
| RLS-enabled tables | 62 | indexes | 180 (148 + 32 unique) |
| primary keys | 62 | foreign keys | 69 |
| unique constraints | 15 | check constraints | 169 |
| triggers | 0 | views / matviews | 0 / 0 |

**Reconciliation with QF-MVP-20.2A:** the audit's "47 unique / 178 check" were `grep` line-count artifacts. Catalog-accurate values: **unique constraints = 15** and **unique indexes = 32** (15 + 32 = 47); **check constraints = 169** (the "178" counted text patterns incl. `WITH CHECK` and multi-line forms). The baseline drops **no** constraint/index/policy/function — parity is structural.

## 7. FK dependency & cycle result

- **All 69 FKs are added via `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY`; 0 are inline in `CREATE TABLE`.** 64 reference public tables, 5 reference `auth.users`.
- **Cycle-safety proof:** because pg_dump creates all 62 tables first (no inline FKs) and adds every FK afterward, any FK cycle among public tables is irrelevant — each referenced table already exists when its FK is applied. No deferral is required. The 5 `auth.users` FKs require the managed `auth` schema (present on a fresh Supabase project; the preflight asserts `auth.users`). **Preserving pg_dump statement order is therefore proven-safe** — this resolves the QF-MVP-20.2A FK-cycle unknown.

## 8. search_path remediation

Resolved the 20.2A unknown: exactly the 6 SECURITY INVOKER helpers lacked an explicit `search_path`; the generator injects a safe one into each (asserted count = 6). No SECURITY DEFINER function needed remediation. No writable schema precedes `pg_catalog`/`public` in any pinned or injected path.

## 9. Least-privilege grant matrix (summary)

| Principal | Functions | Tables |
|---|---|---|
| **service_role** | EXECUTE on all 39 (REVOKE from PUBLIC first) | ALL on all 62 |
| **anon** | EXECUTE on **`get_public_eligible_vendors` only** | **none** |
| **authenticated** | EXECUTE on `is_admin`, `owns_vendor` (RLS predicates) | none (deferred to remediation) |
| **PUBLIC** | none (revoked on every function) | none |
| **default privileges** | not added for anon/authenticated (root-cause fix) | not added for anon/authenticated |

**The four blockers + legacy credit primitives + `qf_apply_vendor_credit_delta` are service_role-only** (validator-verified: 0 anon/authenticated/PUBLIC EXECUTE). anon has **no** table access and **no** monetization-column reads.

## 10. Helper-function grant decisions (repository evidence)

| Function | Decision | Evidence |
|---|---|---|
| `get_public_eligible_vendors` | anon + authenticated + service_role | `services/leadService.ts:347` — `publicClient().rpc(...)` (public listing via anon) |
| `is_admin` | authenticated + service_role | dump RLS policies `TO authenticated` @5586/5593/5597 |
| `owns_vendor` | authenticated + service_role | dump RLS policy `TO authenticated` @5597 |
| `check_duplicate_lead` | service_role only | `services/leadService.ts:50→61` — `adminClient()` (service-role) |
| `get_setting_int` | service_role only | `services/vendorService.ts:342→352` — `adminClient()`; also called inside SD RPCs |
| `refresh_requirement_group_counters` | **service_role only (deny anon)** | **no direct repository consumer** (grep empty); invoked only inside requirement-group SD RPCs → resolves the 20.2A unknown |
| `handle_new_user` | service_role only | auth new-user handler; its trigger lives on `auth.users` (managed schema, not in this public baseline) |

**0 policies apply `TO anon`** in the dump, so anon needs no RLS-predicate EXECUTE — hence anon's function surface is a single proven entry.

## 11. Legacy compatibility objects (`LEGACY_COMPATIBILITY_TEMPORARY`)

The six assignment RPCs and `deduct_/restore_/increment_vendor_credit(s)` are retained for current-consumer compatibility **but are unreachable by untrusted roles** (service_role-only). They are documented as temporary; the QF-MVP-20 canonical transaction engine is **not** created here. Live-body facts carried by the source (confirming QF-MVP-20.1): `admin_smart_assign`, `assign_client_selected_vendor_to_group`, `assign_vendor_to_requirement_group` are **un-ledgered** (deduct_vendor_credit, no `vendor_credit_logs`); `assign_lead_to_paid_vendors_phase26a`/`assign_lead_to_vendors`/`assign_lead_to_preferred_vendor` are **ledgered**; `assign_lead_to_vendors` also writes `whatsapp_logs` (comms coupling).

## 12. Offline validator results — **PASS**

`validate-staging-baseline.mjs` tokenizes the baseline and asserts: source SHA present; no top-level mutation/destructive/role/owner statements; no `ALTER DEFAULT PRIVILEGES` for anon/authenticated; no broad `GRANT ALL` to anon/authenticated; the 4 blockers + legacy credit primitives + `qf_apply_vendor_credit_delta` not EXECUTE-able by PUBLIC/anon/authenticated and each `REVOKE … FROM PUBLIC`; `get_public_eligible_vendors` has anon EXECUTE; anon has **no** table grant and **no** vendors/credit-logs/packages/payments access; preflight guards present (`auth.users`, `gen_random_uuid`, roles); production ref only in comments; no URLs/secret-like literals in executable text; fixed instant (no wall-clock); no `OWNER TO "postgres"` leaked in. Counts: 62/39/33/67/62/62/69/15/169/180/0/0.

## 13–14. Generated SQL SHA256 & determinism

- Baseline SHA256 `920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81`, produced **byte-identical across two runs** (deterministic; fixed identity/instant, no wall-clock, sorted grant enumeration).
- Verify SQL SHA256 `89362a35ea5ef503df4c06aa6782a5a084e29cfa1ffb8b13df5d4436a6cd7777` (SELECT-only; 30 checks).

## 15. Remaining unknowns

1. **Live `auth` trigger `on_auth_user_created`** wiring `handle_new_user` is **not** in the public dump (it lives on `auth.users`) — 20.2C/forward migration must recreate the auth→profiles trigger separately if new-user provisioning is exercised on staging.
2. **authenticated table grants** for owner/admin dashboard flows are intentionally deferred to QF-MVP-20 forward remediation — some `serverClient` (authenticated) reads (e.g. `getMyVendor` on `vendors`) will need explicit RLS-gated grants then.
3. **`gen_random_uuid` provisioning** on the fresh staging project is asserted by the preflight, not proven offline.
4. Exact **catalog check-constraint total on the live DB** is expected to equal 169; confirmed only when the verify SQL runs in 20.2C.

## 16. QF-MVP-20.2C application prerequisites

1. Confirm target project ref = `uckafzuochmbvtiodmcl` (abort on `yqpgcsduqbxulrlzwzap`).
2. Staging is EMPTY; the preflight will hard-abort otherwise.
3. Apply under the single identity `qf_mvp_staging_baseline_269c9265`; do **not** push the repo migration chain, do **not** insert the 68 versions into history.
4. Run `verify_qf_mvp_staging_baseline.sql`; require all rows `PASS`.
5. Decide the follow-ups in §15 (auth trigger, authenticated grants) as forward-only migrations after the baseline.

## 17. Rollback plan

Staging is empty, so baseline rollback is low-risk: (1) verify the target ref is staging; (2) if apply fails, do **not** proceed to partial testing; (3) inspect transaction status; (4) if left partially initialized, `drop schema public cascade` on **staging only** or delete+recreate the staging project; (5) never run rollback against production; (6) never merge staging history into production. No rollback is executed in this task.
