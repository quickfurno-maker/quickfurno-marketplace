# QF-MVP-20.2A — Staging Schema Baseline Plan

**Branch:** `mvp/qf-mvp-20-marketplace-engine-v1` · **Type:** DESIGN ONLY. No SQL baseline is created here; no DB/staging/production access; no SQL executed; raw dump not committed.
**Companion:** [`QF-MVP-20-STAGING-BASELINE-AUDIT.md`](QF-MVP-20-STAGING-BASELINE-AUDIT.md). This plan defines how QF-MVP-20.2B will *generate and apply* a reviewed staging-only baseline from the production public-schema dump (SHA256 `269c9265…`).

## Goal

Reconstruct the **current required public schema** on the empty staging project (`uckafzuochmbvtiodmcl`) as a single reviewed baseline — **without** production data, secrets, production ownership/grants, unsafe PUBLIC/anon authority, migration-history falsification, provider activation, or arbitrary replay of the 68 repository migrations. Compatibility structure is reproduced; unsafe authority is **not**.

## 20.2B generation record — ✅ BASELINE GENERATED, NOT APPLIED

The deterministic generator, validator, grant manifest, baseline SQL, and verification SQL are produced (offline; no DB access). Details in [`QF-MVP-20-STAGING-BASELINE-REVIEW.md`](QF-MVP-20-STAGING-BASELINE-REVIEW.md).

- **Baseline generation:** complete. **Baseline application:** NOT STARTED (20.2C).
- **Source SHA256:** `269c9265d32a9f85488d76bfcf9dd528bd9b6b915bafb09ebb024a6bde182a2f`
- **Generated baseline SHA256:** `920a4aa0143b7c91231a3c83d01452e49b8b9a829c322f15c7df4fe9f07ecc81` (byte-identical across two runs — deterministic).
- **Verification SQL SHA256:** `e82b757fd618983d91acdd80822daee8b64cd4e0bfbeaa16ea456af83e353d90` (current; SELECT-only; identity-scoped function parity, QF-MVP-20.2C1R). Superseded pre-correction: `89362a35ea5ef503df4c06aa6782a5a084e29cfa1ffb8b13df5d4436a6cd7777`.
- **Location:** `supabase/staging-baseline/` — intentionally OUTSIDE `supabase/migrations/` so `supabase db push` cannot apply it. Raw dump not committed.
- **Grant policy:** default-deny; service_role operational; anon = EXECUTE on `get_public_eligible_vendors` only + no table access; authenticated = EXECUTE on `is_admin`/`owns_vendor`; the four blockers + legacy credit primitives + `qf_apply_vendor_credit_delta` are service_role-only. No `ALTER DEFAULT PRIVILEGES` for anon/authenticated.
- **Counts (catalog):** 62 tables / 39 functions / 33 SD / 67 policies / 62 RLS / 62 PK / 69 FK / 15 unique-constraints (+32 unique indexes = the audit's 47) / 169 check-constraints / 180 indexes / 0 triggers / 0 views.
- **FK-cycle:** resolved — all 69 FKs added via `ALTER TABLE` after table creation, so cycles are apply-safe; 5 reference `auth.users`.
- **Rollback:** staging is empty → drop-and-recreate staging (or `drop schema public cascade` on staging only); never production.
- **Remaining application prerequisites:** confirm target ref `uckafzuochmbvtiodmcl`; preflight requires an empty project + managed prereqs; recreate the `auth.users` new-user trigger separately (not in the public dump); add authenticated dashboard grants as forward remediation; all rows of the verify SQL must be `PASS` in 20.2C.

## 1. Sanitization rules (applied when generating the baseline SQL in 20.2B)

1. **Ownership:** strip every `OWNER TO "postgres"` (101×) / `pg_database_owner`; regenerate ownership for the staging migration role. Ownership is **explicitly generated for staging**, never copied.
2. **Blocker grants — DROP:** never emit the 8 anon/authenticated grants on the four blockers (audit lines 6059-6060, 6070-6071, 6081-6082, 6097-6098). The four functions exist (compatibility) but are **inaccessible to PUBLIC, anon, and ordinary authenticated users** — EXECUTE granted only to a controlled service context.
3. **Monetization grant — RESTRICT:** do not emit `GRANT ALL ON vendors TO anon` (6571); staging `anon` gets no direct monetization access (public reads go through the QF-MVP-20 safe projection / server DTO). Same restriction for `vendor_credit_logs`, `vendor_packages`, `payments`.
4. **Default privileges — REWRITE:** do not copy `ALTER DEFAULT PRIVILEGES … GRANT ALL ON FUNCTIONS TO anon/authenticated` (6598-6599). Set restrictive defaults so new functions are **not** anon-executable by default (fixes the root cause).
5. **Session preamble — REGENERATE:** replace the pg_dump preamble (lines 4-13) with a controlled, reviewed header; do not blindly carry `row_security=off` / `set_config('search_path','')` / `check_function_bodies=false` into an idempotent apply.
6. **Secrets:** none present (audit §8) — nothing to redact; a generation-time scan (`https://`, token/secret/key/PEM) must re-confirm **0** before apply.
7. **Managed schema:** never emit `auth`/`storage`/`realtime`/`extensions` object creation; keep only the `public` FKs that *reference* `auth.users`.
8. **Destructive:** none present; the generator must reject any `DROP`/`TRUNCATE`/top-level `INSERT`/`COPY` if introduced.
9. **Enforcement/remediation deferred:** do NOT invent 3-active/6-lifetime triggers, ledger rewrites, or the monetization projection *in the baseline* — those enter staging via the separate **QF-MVP-20 remediation migration** (forward-only, after the baseline).

## 2. Deterministic generation process (20.2B)

1. Parse the external dump (SHA256-pinned) into typed object sets (tables, constraints, indexes, functions, policies, grants).
2. Emit objects in the fixed dependency order (§3), each idempotent (`IF NOT EXISTS` where safe), **excluding** the EXCLUDE_UNSAFE set and rewriting the BASELINE_REQUIRED_WITH_REWRITE set.
3. Emit an **explicitly authored grant block** (least-privilege, §4) — not the dump's grants.
4. Output is **deterministic**: same dump + same generator ⇒ byte-identical baseline; record the baseline SQL's own SHA256. The generated `.sql` lives in the external staging workspace (or `supabase/migrations/` **only** as the single reviewed baseline in 20.2B) — **never** the raw dump.
5. A human review diff (dump → baseline) enumerates every dropped/rewritten statement before any apply.

## 3. Staging application order (NOT the raw pg_dump order)

1. **Managed prerequisites** (verify present; do not create): `extensions`/`gen_random_uuid`, `auth` schema + `auth.users`/`auth.uid()`.
2. Reviewed session header (§1.5).
3. Types/domains/enums — none.
4. Sequences — none.
5. **Tables** (62).
6. **PK / UNIQUE / CHECK** constraints.
7. **Foreign keys** (69) — after all tables; the 5 `auth.users` FKs after confirming the managed schema; run the **FK-cycle scan** first (§audit unknown 1).
8. **Indexes** (180).
9. **Non-mutating helper functions** (`qf_norm_text`, category helpers, `get_setting_int`, `is_admin`, `owns_vendor`) — before policies and mutating fns.
10. **Mutating functions** (assignment/credit/consent RPCs, legacy primitives) — after helpers.
11. **Triggers** — none.
12. **Views** — none.
13. **RLS enablement** (62 tables).
14. **Policies** (67) — after `is_admin`/`owns_vendor` exist.
15. **Grants** — the explicitly-authored least-privilege block (§4), not the dump's.
16. **Compatibility objects** — the 6 legacy RPCs remain, grant-restricted.
17. **Verification queries** (§6, designed in 20.2B; read-only).

## 4. Ownership & grants strategy (explicitly generated for staging)

| Principal | Staging baseline policy |
|---|---|
| **object owner** | the staging migration/owner role (regenerated) — never production `postgres` copied |
| **postgres / authenticator** | platform-managed; not asserted by the baseline |
| **anon** | least-privilege: only what current public compatibility needs (e.g. `get_public_eligible_vendors` EXECUTE, `is_admin`/`owns_vendor` for RLS). **No** `ALL` on `vendors`/monetization tables; **no** EXECUTE on any mutation RPC |
| **authenticated** | only owner/admin-scoped reads via RLS; **no** EXECUTE on the four blockers or credit/assignment mutators |
| **service_role** | retains EXECUTE on the canonical mutation RPCs (as production) |
| **PUBLIC** | **no** EXECUTE on any mutation function; no blanket table `ALL` |
| **default privileges** | restrictive — new functions are **not** anon/authenticated-executable by default |

**The four blockers, if present for compatibility, must be:** inaccessible to PUBLIC, inaccessible to anon, inaccessible to ordinary authenticated users, and **callable only from an explicitly controlled service context** until consumers migrate to `qf_assign_lead_vendors_v2`.

## 5. Truthful migration-history strategy

Production has **4** recorded migration rows + material `HISTORY_DRIFT`; staging has **0**. Keep four concepts strictly separate:

1. **Staging baseline migration identity:** the baseline applies as **one** reviewed migration (e.g. `…_staging_baseline_from_prod_public_schema`) recorded as **one** row in staging `supabase_migrations.schema_migrations`, whose name/comment cites the dump SHA256. This is the honest statement "staging schema was reconstructed from the production public-schema dump on <date>."
2. **Production historical evidence:** production's 4 rows + the QF-MVP-10 §D/§F MD5s are **documentation only** — never inserted into staging history.
3. **Future forward-only QF-MVP migrations:** all subsequent QF-MVP-20 remediation (authority repair, ledger authority, projection, enforcement triggers) are **new** forward-only migrations numbered *after* the baseline.
4. **Production repair/baseline decision:** production's HISTORY_DRIFT is a **separate**, still-open decision (QF-MVP-10) — staging's baseline does **not** repair or replicate it.

**Prohibited:** inserting 68 fake rows; inserting the 4 production rows; marking any migration "applied" merely to silence the CLI; any claim that the repository migration chain reconstructed production.

## 6. Parity-verification plan (read-only; queries designed in 20.2B)

Post-apply, staging is verified against the production QF-MVP-10 evidence. Expected values (from audit §2, all sourced — none invented):

| Check | Expected | Source |
|---|---|---|
| public base tables | 62 | audit §2 / QF-MVP-10 |
| functions | 39 | audit §2 |
| SECURITY DEFINER functions | 33 | audit §2 |
| RLS-enabled tables | 62 | audit §2 |
| policies | 67 | audit §2 |
| PK / FK / UNIQUE / CHECK | 62 / 69 / 47 / 178 | audit §2 |
| indexes | 180 (incl. `uq_vendor_credit_logs_reference`) | audit §2 |
| triggers | 0 | audit §2 |
| function-definition hashes | match QF-MVP-10 §D/§F MD5s (6 assign RPCs, `qf_apply_vendor_credit_delta`, `apply_communication_consent_command`) | QF-MVP-10 |
| **prohibited public authority** | **no** anon/authenticated/PUBLIC EXECUTE on the 4 blockers or any credit/assignment mutator | audit §6 |
| **monetization exposure** | anon **cannot** SELECT `vendors` monetization columns | audit §6 |
| production rows | every table row-count = **0** | staging EMPTY |
| provider accounts / runtime | `communication_provider_accounts` = 0; runtime policy not `active`/`canary` (Meta disabled) | QF-MVP-10 §H |
| communication sends | `communication_messages` / `delivery_events` / `webhook_receipts` = 0 | QF-MVP-10 §H |
| secrets / URLs | baseline SQL scan = 0 `https://`/token/secret/PEM | audit §8 |

Any parity failure blocks the baseline from being accepted.

## 7. Rollback strategy

- The baseline applies to an **empty** project, so rollback = **drop-and-recreate the staging project** (or `drop schema public cascade` on staging only) — no data loss risk (staging has none). No production path is touched.
- Each later remediation migration is additive + independently reversible (per [`QF-MVP-20-MIGRATION-PLAN.md`](QF-MVP-20-MIGRATION-PLAN.md) §K.13).
- The baseline SQL is version-pinned (its own SHA256) so a re-apply is reproducible.

## 8. Explicit production non-impact controls

- All 20.2A work is read-only over an **external file**; no production/staging network access; no SQL executed.
- 20.2B generation is offline (parse file → emit SQL); the **only** DB touch is applying the reviewed baseline to the **empty staging** project — never production.
- The generator hard-fails on any statement targeting the production ref `yqpgcsduqbxulrlzwzap`, any `auth`/`storage`/`realtime` mutation, or any destructive statement.
- No provider activation; Meta stays disabled; no communication send.

## 9. Prerequisites to generate the baseline SQL (20.2B entry gate)

1. This audit + plan reviewed and accepted.
2. Resolve audit §10 unknowns: FK-cycle scan; `gen_random_uuid` availability; the 6 unpinned-`search_path` functions; `refresh_requirement_group_counters` anon need; per-policy signatures; MD5 parity list.
3. Confirm the staging owner/migration role and the "controlled service context" identity for the four compatibility RPCs.
4. Freeze the least-privilege grant block (§4) for review.
5. Confirm the baseline migration identity/name and that no repository migration chain is replayed.
6. Staging remains EMPTY until the reviewed baseline is applied; production untouched.
