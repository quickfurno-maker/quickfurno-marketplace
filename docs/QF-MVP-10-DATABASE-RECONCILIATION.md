# QF-MVP-10.7 — Database Reconciliation Plan (PLAN ONLY)

**Branch:** `mvp/qf-mvp-10-core-data-truth-v1` · **HEAD:** `cda20fd`

> **This document performs NO database access.** It defines a **later, read-only** procedure to reconcile the committed schema (`supabase/migrations/*` → [`generated ledger JSON`](generated/qf-mvp-migration-ledger.json)) against **staging** and **production**. **No write, `db push`, `db reset`, `migration up`, or `migration repair` is planned as automatic remediation.** Managed-DB history is assumed **possibly drifted**; nothing is applied automatically.

## 0. Why this is the pre-QF-MVP-20 gate

The runtime map + agent audits established that the highest-value facts are **DB-state, not code**:
- **12 migrations are `GENERATED FOR REVIEW — DO NOT AUTO-APPLY`** (credit wallet 140–145, workflow kernel 146–150, automation policy 150, consent-command writer 300) — applied state unknown.
- The **live body of `assign_lead_to_paid_vendors_phase26a`** (and the credit-debit RPCs) is one of 3–4 committed versions — which one is live is unknown (A6/V6).
- The **`admin_smart_assign` debit** may be running un-ledgered in production (A7).
- Meta/SMS/consent gates fail closed on missing rows — so "applied vs not" changes behaviour.

Until these are verified read-only, QF-MVP-20/40 must not assume the ledger-backed wallet or any specific RPC body.

## 1. Access & safety preconditions

- **Read-only role required.** Use a dedicated `readonly` Postgres role (or Supabase read replica) with `SELECT` on `information_schema`, `pg_catalog`, `public`, and `supabase_migrations`. **No `INSERT/UPDATE/DELETE/DDL` grant.**
- Credentials supplied out-of-band (never committed; never in `.env` read by tooling). Prefer a session-scoped, expiring credential.
- Run **staging first**, then production, in a maintenance-safe window. Log every query + result to the external review folder (never the repo).
- **Prohibited during reconciliation:** `supabase db push`, `db reset`, `migration up`, `migration repair`, any `psql -c "…"` that mutates, any service-role write.

## 2. Procedure (all queries read-only)

### 2.1 Migration-history comparison
```sql
select version, name from supabase_migrations.schema_migrations order by version;
```
Compare the applied `version` list against the 68 committed timestamp prefixes. Classify each:
- present both → aligned; committed-not-applied → **REPOSITORY_ONLY**; applied-not-committed → **DATABASE_ONLY**; out-of-order/missing-middle → **HISTORY_DRIFT**.

### 2.2 Object existence (tables / functions / triggers / indexes)
```sql
select table_name from information_schema.tables where table_schema='public' order by 1;
select p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid) args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1;
select tgname, tgrelid::regclass from pg_trigger where not tgisinternal order by 1;
select indexname, tablename from pg_indexes where schemaname='public' order by 1;
```
Compare against `ledger.aggregate` (100 tables, 50 functions, 2 triggers) + per-migration objects. Missing committed object → **REPOSITORY_ONLY**; extra live object → **DATABASE_ONLY**.

### 2.3 Ledger-backed wallet liveness (targeted — A6/A7)
```sql
-- Is the idempotent ledger index live? (migration 141)
select indexname from pg_indexes where schemaname='public' and indexname='uq_vendor_credit_logs_reference';
-- Which assign_* / credit RPC bodies are live? (hash the definition)
select proname, md5(pg_get_functiondef(oid)) body_hash, prosecdef
  from pg_proc where proname in
  ('assign_lead_to_paid_vendors_phase26a','assign_lead_to_vendors','assign_lead_to_preferred_vendor',
   'assign_package_to_vendor','qf_apply_vendor_credit_delta','admin_smart_assign_lead_to_vendors','deduct_vendor_credit')
  order by 1;
-- Does the live assign RPC write to vendor_credit_logs? (read the body text, do not execute)
select proname, pg_get_functiondef(oid) as body
  from pg_proc where proname='admin_smart_assign_lead_to_vendors';
```
Compare `body_hash` against a hash computed from the committed migration file bodies (compute offline). If the live body lacks the `insert into vendor_credit_logs … reference_type/reference_id` block → confirm **A7** in production and schedule the ledger rewrite. Absent `uq_vendor_credit_logs_reference` → the idempotent wallet (141) is **REPOSITORY_ONLY** (not applied).

### 2.4 Constraint definitions
```sql
select conname, conrelid::regclass tbl, pg_get_constraintdef(oid) def
  from pg_constraint where connamespace='public'::regnamespace order by 2,1;
```
Compare CHECK/UNIQUE/FK defs (e.g. `lead_assignments_max_three_vendors`, per-(lead,vendor) unique, provider-account NOT-NULL from migrations 67/68). Text mismatch → **DEFINITION_DRIFT**.

### 2.5 RLS & grants
```sql
select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' order by 1;
select tablename, policyname, cmd, roles from pg_policies where schemaname='public' order by 1,2;
select grantee, table_name, privilege_type from information_schema.role_table_grants
  where table_schema='public' order by 2,1;
```
Compare against 89 RLS-enabled tables + 77 policies. Missing RLS on a consent/credit table → **DEFINITION_DRIFT** (security). Unexpected `anon`/`authenticated` write grant on a consent/credit table → escalate.

### 2.6 Communication activation seed (targeted — QF-MVP-40)
```sql
select provider_key, channel, outbound_enabled, activation_status, webhook_processing_enabled
  from communication_provider_runtime_policies;              -- expect disabled
select count(*) from communication_provider_accounts;         -- expect 0 pre-activation
select count(*) from communication_provider_template_mappings where approval_status='approved' and is_active;
```
Any already-`active`/`canary` policy or seeded account/mapping pre-QF-MVP-40 → **UNKNOWN_REQUIRES_REVIEW**.

### 2.7 Row-count safety (only where needed, bounded)
```sql
select 'lead_assignments' t, count(*) from lead_assignments
union all select 'vendor_credit_logs', count(*) from vendor_credit_logs
union all select 'communication_messages', count(*) from communication_messages;
```
Used only to gauge production usage before any later corrective migration; never to infer schema.

## 3. Drift classification vocabulary

| Class | Meaning | Default handling |
|---|---|---|
| `REPOSITORY_ONLY` | Committed, not applied (e.g. a DO-NOT-AUTO-APPLY migration) | Plan a **reviewed, manual** apply; never auto-push |
| `DATABASE_ONLY` | Live object with no committed migration | Capture as a new committed migration (reconcile forward); investigate origin |
| `DEFINITION_DRIFT` | Same object, different definition (function body / constraint / policy) | Diff, decide canonical, plan a reviewed corrective migration |
| `HISTORY_DRIFT` | Applied history diverges from committed order/set | **Do not** `repair`/`reset` automatically; founder-approved manual reconciliation |
| `EXPECTED_ENVIRONMENT_DIFFERENCE` | Legitimate staging≠prod (seed/canary/feature rows) | Document; no action |
| `UNKNOWN_REQUIRES_REVIEW` | Cannot classify safely | Escalate to founder before any change |

## 4. Remediation approval process (no automatic writes)

1. Reconciliation produces a **read-only drift report** (per object: class + evidence) in the external review folder.
2. Founder/admin reviews; each corrective action becomes a **narrowly-scoped, reviewed migration** (one concern each) applied via the normal reviewed path — **never** an automatic `db push`/`reset`/`repair`.
3. Money-path corrections (credit wallet, un-ledgered debit) require explicit founder sign-off and a staging rehearsal (QF-MVP-80.1) before production.
4. Re-run this read-only procedure after each corrective apply to confirm convergence.

## 5. Priority checklist (what to verify first)
- [ ] Applied set vs the **12 DO-NOT-AUTO-APPLY** migrations (140–150, 300).
- [ ] Live body of `assign_lead_to_paid_vendors_phase26a` + presence of `uq_vendor_credit_logs_reference` (A6).
- [ ] `admin_smart_assign_lead_to_vendors` body writes a `vendor_credit_logs` row (A7).
- [ ] `lead_assignments` per-(lead,vendor) unique + max-3 CHECK present.
- [ ] Communication runtime policy = disabled; no seeded provider account/mapping (pre-QF-MVP-40).
- [ ] RLS enabled on every consent/credit/assignment table; no anon/authenticated write grants there.
