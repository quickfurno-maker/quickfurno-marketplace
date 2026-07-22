# QF-MVP-20.2A — Staging Schema Baseline Audit

**Branch:** `mvp/qf-mvp-20-marketplace-engine-v1` · **Type:** READ-ONLY schema audit + documentation. **No** DB/staging/production/network access, **no** SQL executed, **no** migration created, **no** SQL committed to Git.
**Companion:** [`QF-MVP-20-STAGING-BASELINE-PLAN.md`](QF-MVP-20-STAGING-BASELINE-PLAN.md). **Evidence baseline:** QF-MVP-10 reconciliation + QF-MVP-20.0/20.1 docs.

## 1. External evidence identity & hash

| Item | Value |
|---|---|
| SQL dump | `C:\Users\KESHAV SHARMA\Desktop\qf-staging-workspace\production-public-schema.sql` |
| SQL SHA256 | `269c9265d32a9f85488d76bfcf9dd528bd9b6b915bafb09ebb024a6bde182a2f` |
| SQL size / lines | 300,426 bytes · 6,617 lines |
| Evidence note | `…\production-public-schema-evidence.txt` |
| Note SHA256 | `10ec986da01b180b0212c3f7b1cc7e3f6ae31b2cecac17c2331f1cd501bb1aab` |
| Captured | 2026-07-22T06:13:41Z · production ref `yqpgcsduqbxulrlzwzap` · scope: `public` schema only |
| Evidence-note attestations | Top-level public COPY/INSERT = **0**; stored-routine bodies contain SQL INSERTs = **YES** (expected, not table data); production mutation performed = **NO** |

The dump is **schema-only** (no `--data-only`). It carries **no production table data**. Raw SQL is **not** copied into the repo; only line-range references appear below.

**Environment facts (user-provided, not re-verified):** Staging = `QuickFurno Staging` / ref `uckafzuochmbvtiodmcl` / `ap-southeast-1` / `ACTIVE_HEALTHY`; current staging public tables = **0**, migration-history rows = **0**; production data copied = **NO**.

## 2. Raw schema inventory (dump-wide counts)

| Object | Count | Cross-check (QF-MVP-10) |
|---|---|---|
| Base tables (`CREATE TABLE`) | **62** | ✅ 62 |
| Columns / types | text + CHECK model; `CREATE TYPE/DOMAIN` = **0** (no enums) | ✅ enums 0 |
| Primary keys | 62 | — |
| Foreign keys | 69 (5 → `auth.users`) | — |
| Unique constraints | 47 | — |
| Check constraints | 178 | — |
| Indexes (`CREATE [UNIQUE] INDEX`) | 180 (incl. `uq_vendor_credit_logs_reference` @ 5190) | ✅ ledger idempotency index present |
| Sequences | 0 (uuid PKs via `gen_random_uuid()`) | — |
| Views / matviews | 0 | — |
| Functions | **39** | ✅ 39 |
| SECURITY DEFINER functions | **33** | ✅ 33 |
| Triggers | **0** | ✅ §I "no reviewed enforcement trigger" |
| RLS-enabled tables | **62** (all) | ✅ fail-closed posture |
| RLS policies | 67 | — |
| `GRANT` / `REVOKE` | 201 / 28 | — |
| `OWNER TO` | 102 (101×`postgres`, 1×`pg_database_owner`) | — |
| `CREATE EXTENSION` | 0 (relies on managed `extensions`) | — |
| Destructive (`DROP`/`TRUNCATE`/top-level `INSERT`/`COPY`) | **0** (the sole "TRUNCATE" token is inside a COMMENT @ 2900) | ✅ |
| `schema_migrations` references | 0 (dump does not touch migration history) | — |
| `SET ROLE` / `SET SESSION AUTHORIZATION` | 0 | — |

Functions in scope (39): the six assignment RPCs, `deduct_vendor_credit`/`restore_vendor_credit`/`increment_vendor_credits`/`qf_apply_vendor_credit_delta`, `assign_package_to_vendor`, `update_vendor_visibility`, `expire_vendor_packages`, `check_duplicate_lead`, `get_public_eligible_vendors`, `get_setting_int`, `handle_new_user`, `is_admin`, `owns_vendor`, `refresh_requirement_group_counters`, `apply_communication_consent_command`, the `qf_*` consent-ack/auth-transport/category helpers, and the `vendor_auth_*` challenge functions.

## 3. Dependency findings (application order is NOT the raw pg_dump order)

- **Managed prerequisites:** `gen_random_uuid()` (~62 column defaults) resolves from the platform `extensions`/core — **no `CREATE EXTENSION` in the dump**, so the baseline depends on the staging project already providing it (fresh Supabase does). `auth.uid()` used in 2 helper bodies (1318 `is_admin`, 1329 `owns_vendor`); `auth.users` referenced by **5 FKs** (client_accounts @ 5269, password_reset_grants @ 5439, profiles @ 5464, vendor_dashboard_users @ 5469, verification_challenges @ 5569). These require the managed `auth` schema to exist first (it does on a fresh project).
- **No enums/domains/sequences** to order.
- **FKs:** 69, **0 DEFERRABLE**. Tables must all exist before FKs; FKs to `auth.users` require the managed schema. No FK cycle observed in the sampled set, but a **cycle scan is a 20.2B prerequisite** before fixing apply order.
- **Function call graph:** mutating RPCs call non-mutating helpers (`qf_norm_text`, `qf_parent_category_group`, `qf_lead_vendor_parent_group_compatible`, `get_setting_int`) and the legacy credit primitives — helpers must be created first.
- **RLS/policies:** enable RLS (62) before policies (67); policies reference `is_admin`/`owns_vendor` → those helper functions must exist first.

## 4. Ownership & grant findings

- **Ownership:** every object `OWNER TO "postgres"` (101×) + 1× `pg_database_owner`. This is production-role-specific and **must be regenerated for staging**, not copied verbatim.
- **Role grant tallies:** function/table grants target `service_role` (102), `authenticated` (50), `anon` (48), `postgres` (1). **No column-level grants** anywhere (`GRANT (col) ON` = 0) — so table grants are whole-row.
- **Broad table grants:** `GRANT ALL ON TABLE … TO anon`/`authenticated`/`service_role` on **~35 core tables** including `vendors` (6571-6573), `vendor_credit_logs`, `vendor_packages`, `payments`, `leads`, `lead_assignments`, `whatsapp_logs`. RLS (62 tables) is the row boundary; the grant itself is `ALL`. This is the "broad grant + RLS boundary" posture from QF-MVP-10 §I.
- **`ALTER DEFAULT PRIVILEGES` (6587-6608):** `FOR ROLE postgres IN SCHEMA public GRANT ALL ON {SEQUENCES,FUNCTIONS,TABLES} TO {postgres,anon,authenticated,service_role}`. The **`GRANT ALL ON FUNCTIONS TO anon`/`authenticated`** default (6598-6599) is the **root cause** of anon-executable new functions — it must NOT be copied blindly, or every baseline function becomes anon-callable.
- **`search_path` hardening:** 33 function definitions pin `SET search_path` (e.g. `TO 'public'` @ 28, `TO 'pg_catalog','public'` @ 146) — good; keep. (6 of 39 functions lack an explicit pin → per-function review in 20.2B.)
- **No `SET ROLE`/session-authorization** ownership tricks; ownership is via `ALTER … OWNER TO`.

## 5. SECURITY DEFINER findings (33 functions)

- **Locked-down (service_role EXECUTE only, not anon):** 28 functions incl. `assign_lead_to_paid_vendors_phase26a`, `assign_lead_to_vendors`, `qf_apply_vendor_credit_delta`, `deduct_/restore_/increment_vendor_credit(s)`, `assign_package_to_vendor`, `update_vendor_visibility`, `expire_vendor_packages`, `apply_communication_consent_command`, all `qf_*` consent-ack/auth-transport, `vendor_auth_*`. These carry `REVOKE ALL … FROM PUBLIC` + `GRANT … TO service_role` (e.g. phase26a REVOKE @ 6076, assign_lead_to_vendors REVOKE @ 6087).
- **anon/authenticated-EXECUTE surface (11 functions):** the **4 blockers** (below) + 7 legitimate helpers — `get_public_eligible_vendors` (public listing), `is_admin`/`owns_vendor` (RLS predicates), `get_setting_int`, `check_duplicate_lead` (public lead dedup), `handle_new_user` (auth new-user handler), `refresh_requirement_group_counters` (⚠ a mutating counter helper granted to anon — review in 20.2B).
- **Live-body credit/comms mechanism (from the dump, definitive current production):**

| Function | Lines | Legacy debit/restore | Writes `vendor_credit_logs` | Writes `whatsapp_logs` | Verdict |
|---|---|---|---|---|---|
| `admin_smart_assign_lead_to_vendors` | 26-391 | **yes** | **NO** | no | **un-ledgered** |
| `assign_client_selected_vendor_to_group` | 392-487 | **yes** | **NO** | no | **un-ledgered** |
| `assign_vendor_to_requirement_group` | 971-1183 | **yes** | **NO** | no | **un-ledgered** |
| `assign_lead_to_preferred_vendor` | 629-739 | restore (rollback) | **yes** | no | ledgered |
| `assign_lead_to_paid_vendors_phase26a` | 488-628 | no | **yes** | no | ledgered (canonical) |
| `assign_lead_to_vendors` | 740-970 | restore (rollback) | **yes** | **yes** (877, 893) | ledgered + **comms coupling** |

> This **resolves QF-MVP-20.1 §16.1** for these functions: the live bodies of `phase26a`/`assign_lead_to_vendors`/`preferred` are the **ledgered** versions, while the three group/smart RPCs remain **un-ledgered** — matching the 27/46 ledger gap (the un-ledgered debits produced no evidence rows). Cross-check function MD5s against QF-MVP-10 §D in 20.2B.

## 6. Dangerous public-authority findings (CRITICAL — must not be reproduced unchanged)

The four QF-MVP-10 PV-1 blockers carry **`GRANT ALL … TO anon` AND `TO authenticated`** with **no `REVOKE FROM PUBLIC`**:

| Blocker RPC | `CREATE` line | anon grant | authenticated grant | Signature note |
|---|---|---|---|---|
| `admin_smart_assign_lead_to_vendors` | 26 | **6059** | **6060** | `p_total_limit int DEFAULT 3` (caller-supplied; clamps 1–9) |
| `assign_client_selected_vendor_to_group` | 392 | **6070** | **6071** | `p_total_limit int DEFAULT 3` |
| `assign_lead_to_preferred_vendor` | 629 | **6081** | **6082** | no total/lifetime check |
| `assign_vendor_to_requirement_group` | 971 | **6097** | **6098** | `p_total_limit int DEFAULT 3` |

Other reproduced hazards:
- **Monetization exposure:** `GRANT ALL ON TABLE "public"."vendors" TO "anon"` (6571) with no column grants → anon can SELECT `total_credits`/`remaining_credits`/`paid_status`/`package_*` (QF-MVP-10 PV-5 HIGH). Same broad `ALL` grant on `vendor_credit_logs`, `vendor_packages`, `payments`.
- **Root-cause default:** `ALTER DEFAULT PRIVILEGES … GRANT ALL ON FUNCTIONS TO anon/authenticated` (6598-6599).
- **No enforcement triggers:** 0 triggers → nothing enforces 3-active / 6-lifetime / mandatory ledger. `p_total_limit` caller ceiling (default 3, up to 9) unbounded by DB.
- **Comms coupling:** `assign_lead_to_vendors` writes `whatsapp_logs` inside the assignment transaction (877, 893).

These are **current-state compatibility facts**, not the target design. The baseline must reproduce the **structure** where consumers need it, but must **not** reproduce these grants/exposures as-is (§ classification + plan).

## 7. Managed-schema dependencies

- `auth` (EXCLUDE_PLATFORM_MANAGED): `auth.uid()` (1318, 1329), `auth.users` FK targets (5 FKs). Do **not** recreate; rely on the fresh Supabase `auth` schema.
- `extensions`/core: `gen_random_uuid()` PK defaults (~62). Ensure available before table creation; do not `CREATE EXTENSION` manually unless the fresh project lacks it (verify in 20.2B).
- `storage`, `realtime`, `vault`, `graphql`, `supabase_*`: **0 references** — none to reconcile.

## 8. Production-configuration findings

- **No config/data rows** in the schema-only dump (0 top-level INSERT/COPY). Production's live rows (1 provider runtime policy `meta_whatsapp_cloud`/`disabled`, app_settings, cities/categories seeds) are **DATA**, not in this dump → **staging starts empty**, which is the desired posture (no provider accounts, Meta inactive).
- Provider tables ship **fail-closed by column default**: `communication_provider_runtime_policies.activation_status DEFAULT 'disabled'` (3128), `outbound_enabled DEFAULT false` (3129); a second `activation_status DEFAULT 'not_activated'` (3874).
- `meta_whatsapp` token (3 occurrences @ 188, 1641, 2832) appears only as a provider-key string in CHECK/comment/body context — **not** a credential.
- **No secrets:** `https://` = 0; `access_token`/`bearer`/`api_key`/`phone_number_id`/`waba`/PEM blocks = 0. The 9 "secret" and 26 "webhook" tokens are **structural** (column names, CHECK values, and the consent-ledger immutability COMMENT @ 2900 that literally forbids storing tokens/secrets). No value redaction was needed because no values are present.

## 9. Object classification matrix

| Category | Objects (with line anchors) |
|---|---|
| **BASELINE_REQUIRED** | 62 tables + columns; 62 PK; 69 FK; 47 UNIQUE; 178 CHECK; 180 indexes (incl. `uq_vendor_credit_logs_reference` @5190); 62 RLS-enable; 67 policies; non-mutating helpers (`qf_norm_text`, `qf_normalize_category_label`, `qf_parent_category_group`, `qf_lead_vendor_parent_group_compatible`, `get_setting_int`, `is_admin`@1301, `owns_vendor`@1323); legit anon fns (`get_public_eligible_vendors`, `check_duplicate_lead`); consent/auth SECURITY DEFINER fns (service_role-only) |
| **BASELINE_REQUIRED_WITH_REWRITE** | All `OWNER TO` (101×, →staging owner); `ALTER DEFAULT PRIVILEGES` (6587-6608, →restrictive); pg_dump session preamble (lines 4-13, esp. `row_security=off`, `set_config search_path ''`, `check_function_bodies=false`); broad table grants on 35 tables (→least-privilege + RLS); keep `search_path` pins |
| **QF_MVP_20_REMEDIATION** | 3-active/6-lifetime enforcement (0 triggers today); `p_total_limit` caller ceiling removal; ledger-backed credit authority replacing B1/B3/B4 un-ledgered bodies; `assign_lead_to_vendors` `whatsapp_logs` decoupling (877,893); `vendors` monetization-safe projection (vs 6571 anon ALL) |
| **LEGACY_COMPATIBILITY_TEMPORARY** | The 6 assignment RPCs (26/392/488/629/740/971) + `deduct_/restore_/increment_vendor_credit(s)` (1184/2140/1298) + `assign_package_to_vendor` — kept so current consumers work, **with grants restricted** (no anon/authenticated/PUBLIC) |
| **KEEP_DISABLED** | `aos_runtime_settings`, `marketplace_runtime_settings`, `communication_provider_runtime_policies` (activation `disabled` @3128), automation/consent-ack scaffolding tables — structure kept, no activation rows |
| **EXCLUDE_PLATFORM_MANAGED** | `auth` schema + `auth.users` + `auth.uid()`; `extensions`/`gen_random_uuid`; `storage`/`realtime`/`vault` (0 refs) — never recreate |
| **EXCLUDE_PRODUCTION_CONFIGURATION** | No config rows exist in the schema-only dump (nothing to strip); production provider/runtime rows are DATA and stay out |
| **EXCLUDE_UNSAFE** | The 8 blocker anon/authenticated grants (6059-6060, 6070-6071, 6081-6082, 6097-6098); `GRANT ALL ON vendors TO anon` (6571) + same on `vendor_credit_logs`/`vendor_packages`/`payments`; `ALTER DEFAULT PRIVILEGES … GRANT ALL ON FUNCTIONS TO anon/authenticated` (6598-6599) |
| **UNKNOWN_REQUIRES_PROOF** | §10 |

## 10. Unknowns requiring proof (resolve in 20.2B)

1. **FK cycle scan** — confirm no `public↔public` FK cycle needs deferral before fixing apply order (0 DEFERRABLE today).
2. **`gen_random_uuid` availability** on the fresh staging project without an explicit `CREATE EXTENSION` (expected present; verify at apply-design time, no execution).
3. **Per-function `search_path`** for the 6 functions lacking an explicit pin (of 39) — identify and decide whether the baseline pins them.
4. **`refresh_requirement_group_counters` anon grant** — confirm whether any current consumer needs anon execute, else restrict.
5. **Per-policy semantics (67 policies)** — full signature capture for the parity plan (this audit counts them; 20.2B enumerates each).
6. **Function-definition MD5 parity** — match the 6 assignment RPCs + `qf_apply_vendor_credit_delta` + `apply_communication_consent_command` to QF-MVP-10 §D/§F hashes.

## 11. Line-reference appendix (external SQL, NOT copied into Git)

- Session preamble: 4-13. Function defs (10 named): admin_smart_assign 26; assign_client_selected 392; phase26a 488; preferred 629; assign_lead_to_vendors 740; assign_vendor_req_group 971; deduct 1184; increment 1298; qf_apply_vendor_credit_delta 1336; restore 2140. RLS helpers: is_admin ~1301 (auth.uid @1318), owns_vendor ~1323 (auth.uid @1329).
- Live-body credit/comms: assign_lead_to_vendors inserts lead_assignments 857 / vendor_credit_logs 868 / whatsapp_logs 877,893 / vendor_packages 948.
- Idempotency index: uq_vendor_credit_logs_reference 5190.
- Provider defaults: activation_status 'disabled' 3128; outbound_enabled false 3129; 'not_activated' 3874.
- auth.users FKs: 5269, 5439, 5464, 5469, 5569.
- REVOKE FROM PUBLIC (locked fns): apply_communication_consent_command 6065; phase26a 6076; assign_lead_to_vendors 6087; assign_package_to_vendor 6092.
- Blocker anon/auth grants: 6059-6060, 6070-6071, 6081-6082, 6097-6098.
- vendors anon grant: 6571-6573.
- Default privileges: 6587-6608 (anon/auth function default 6598-6599).
- COMMENT holding the sole "TRUNCATE" token: 2900.
