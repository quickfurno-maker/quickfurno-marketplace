# QuickFurno Migration Review — AOS + CRM/Analytics Foundation

**Phase:** 4 — CRM + AOS Database Migration Review and Supabase Planning
**Status:** Review only. **No migrations were applied. No live database changes were made.**
**Reviewed on:** 2026-06-27

This document reviews the AOS and CRM/Analytics migration SQL files created in Phases 2 and 3.
It is a planning and safety document. Migrations remain **suggestions only** and must be applied
manually by a human with database access, after a backup.

---

## 1. Migration files reviewed

| File | Phase | Purpose | Tables |
|------|-------|---------|--------|
| `supabase/migrations/20260627000012_aos_management_foundation.sql` | 2 | AOS Control Center foundation | 12 AOS tables |
| `supabase/migrations/20260627000013_crm_analytics_foundation.sql` | 3 | CRM + Analytics foundation | 10 CRM/analytics tables |

Supporting/dependency files (already live, **not modified**):

- `20260620000002_rls_policies.sql` — defines `public.is_admin()` (`security definer`, `stable`, `search_path = public`, checks `profiles.role = 'admin'`). Both new migrations depend on this function.
- `20260621000006_superadmin_foundation.sql` — defines `public.profiles.admin_role`, extends `public.leads` with UTM/follow-up columns, and creates `audit_logs`, `ai_agents`, etc. The new migrations reference `public.profiles` and coexist with these.

**Migration files modified in this phase:** `20260627000013_crm_analytics_foundation.sql`
(removed a redundant, misleadingly-named `crm_followups_future_date` CHECK constraint that only
asserted `scheduled_date is not null` — already guaranteed by the column's `NOT NULL`. Replaced
with a clarifying comment. No structural/behavioral change.) `20260627000012` needed **no changes**.

---

## 2. Tables proposed

### AOS (migration 012) — 12 tables, all `public.aos_*`
1. `aos_agents` — agent registry (15 seeded agents)
2. `aos_agent_versions` — version history
3. `aos_agent_prompts` — prompt versions (no secrets stored)
4. `aos_agent_rules` — business rule versions
5. `aos_agent_permissions` — per-agent permission matrix
6. `aos_agent_logs` — agent run logs (auditable)
7. `aos_agent_memory` — agent memory (sensitive masking flag)
8. `aos_agent_tests` — test-lab comparison runs
9. `aos_approval_queue` — pending dangerous-action approvals
10. `aos_failures` — failure center
11. `aos_cost_logs` — token/cost tracking (AI usage ready)
12. `aos_audit_logs` — AOS audit history

### CRM + Analytics (migration 013) — 10 tables, all `public.crm_*` / attribution
1. `crm_leads` — CRM overlay (masked phone only)
2. `crm_lead_notes`
3. `crm_lead_tasks`
4. `crm_activities` — activity timeline
5. `crm_followups` — follow-up + nurture schedule
6. `crm_calendar_events` — internal calendar (Google Calendar-ready)
7. `crm_sources`
8. `lead_attribution` — UTM/marketing attribution
9. `campaign_performance` — campaign analytics (spend/CPL placeholders)
10. `crm_funnel_events` — funnel transition log

---

## 3. Security notes

- **No `anon` / public policies are created by either migration.** Every policy is
  `for all to authenticated using (public.is_admin()) with check (public.is_admin())`.
  This makes all 22 new tables **admin-only**.
- `is_admin()` is `security definer` with a pinned `search_path = public`, so it cannot be
  hijacked via search-path manipulation. ✅
- **Service role** (used by trusted server actions) bypasses RLS by design in Supabase, so admin
  server reads/writes continue to work without an explicit service-role policy. No service-role key
  is referenced in any migration. ✅
- **Phone protection:** `crm_leads` stores **`phone_masked` only** (and `email_masked`). The table
  comment explicitly states the full client phone stays in the source lead row. The CRM UI masks
  phone in every list/table/card view (`maskPhone` util). ✅
- **No secrets in schema:** prompt bodies (`aos_agent_prompts.prompt_logic`), cost logs, and memory
  rows carry table comments instructing that no secrets / unmasked phones be stored. ✅
- **No AI keys, WhatsApp tokens, or n8n secrets** appear in any migration. ✅

---

## 4. RLS notes

- RLS is **enabled** (`alter table … enable row level security`) on all 12 AOS tables and all 10
  CRM/analytics tables. ✅
- Policies are created idempotently via a `pg_policies` existence check inside a `do $$ … $$` block,
  so re-running the migration will not error on duplicate policies. ✅
- Policy naming is consistent: `'<table> admin all'`.
- Because RLS is enabled but only admin policies exist, **non-admin authenticated users and anon
  users receive zero rows** from these tables (deny-by-default). ✅

---

## 5. Indexes included

### AOS (012)
- Every table indexed on `agent_key`, `status`, and `created_at desc`.
- Entity-linked tables (`aos_agent_logs`, `aos_agent_memory`, `aos_agent_tests`,
  `aos_approval_queue`, `aos_failures`, `aos_cost_logs`, `aos_audit_logs`) additionally indexed on
  `entity_type` and `entity_id` (test table uses `sample_entity_type` / `sample_entity_id`). ✅

### CRM/Analytics (013)
- `crm_leads`: `lead_id`, `phone_masked`, `source`, `status`, `priority`, `created_at desc`,
  `next_follow_up_date`, `nurture_follow_up_date`, `assigned_to` — **all required indexes present**. ✅
- Child tables indexed on `lead_id`, `status`, relevant date columns, and `owner` where applicable.
- `lead_attribution` indexed on `lead_id`, `source`, `utm_campaign`, `created_at`.
- `campaign_performance` indexed on `campaign`, `source`, `created_at`.
- `crm_funnel_events` indexed on `lead_id`, `stage`, `created_at`.

---

## 6. Checklist verification

| Check | AOS (012) | CRM/Analytics (013) |
|-------|-----------|----------------------|
| RLS enabled | ✅ all 12 | ✅ all 10 |
| No unsafe public policies | ✅ | ✅ |
| Admin-only comments present | ✅ | ✅ |
| Correct indexes exist | ✅ | ✅ |
| Existing lead tables not renamed/deleted | ✅ (creates new only) | ✅ (overlay only, `public.leads` untouched) |
| Phone data protected | n/a (no phone) | ✅ `phone_masked` only |
| Source tracking fields correct | n/a | ✅ source, utm_*, gclid, fbclid, landing_page, referrer, device_type |
| Nurture dates beyond 2 months | n/a | ✅ `timestamptz`, no upper bound; presets up to 1 year + custom |
| Calendar supports future Google sync | n/a | ✅ `google_calendar_event_id` column reserved |
| Agent logs auditable | ✅ `aos_agent_logs` + `aos_audit_logs` | n/a |
| Approval queue supports dangerous actions | ✅ `aos_approval_queue` (risk levels, status) | n/a |
| Cost logs support AI usage tracking | ✅ `aos_cost_logs` (token_estimate, cost_estimate, monthly_estimate) | n/a |
| Idempotent / re-runnable | ✅ `if not exists` + seed `on conflict do nothing` | ✅ `if not exists` |

---

## 7. Assumptions

1. **`public.profiles` and `public.is_admin()` already exist** on the target database (they do, from
   migrations 002 and 006). Both new migrations will fail fast if `is_admin()` is missing — apply
   the base migrations first.
2. **`crm_leads.lead_id` and other `*.lead_id` columns are intentionally NOT foreign-keyed** to
   `public.leads`. This is a deliberate decoupling: the CRM overlay must not break if a source lead
   is removed, and it avoids cascade surprises on a live table. Referential integrity is handled in
   application code. If a hard FK is later desired, add it in a separate, reviewed migration.
3. **`pgcrypto`** is available (used for `gen_random_uuid()`); both migrations `create extension if
   not exists "pgcrypto"`.
4. **Costs/spend/revenue are placeholders** — `campaign_performance.spend/cpl` and AOS cost values
   stay null/zero until real ad-spend and AI providers are connected.
5. **Seed data is AOS-only** (15 agents + permissions). No CRM/lead/vendor seed rows are inserted, so
   no production data is fabricated.

---

## 8. Manual Supabase application steps

> Run these by hand in the Supabase SQL editor (or via `supabase db push` against a reviewed
> branch). **Do not** wire these into the app or any automated deploy step.

1. **Back up** the database (Supabase dashboard → Database → Backups, or `pg_dump`).
2. **Confirm prerequisites:** verify `public.is_admin()` and `public.profiles` exist
   (`select public.is_admin();` as an admin; `select count(*) from public.profiles;`).
3. **Apply AOS first:** run `20260627000012_aos_management_foundation.sql`.
4. **Apply CRM/Analytics second:** run `20260627000013_crm_analytics_foundation.sql`.
5. **Verify tables created:**
   `select table_name from information_schema.tables where table_schema='public' and (table_name like 'aos_%' or table_name like 'crm_%' or table_name in ('lead_attribution','campaign_performance'));`
6. **Verify RLS is on:**
   `select relname, relrowsecurity from pg_class where relname like 'aos_%' or relname like 'crm_%';`
   (every row should show `relrowsecurity = true`.)
7. **Verify only admin policies exist:**
   `select tablename, policyname, roles from pg_policies where tablename like 'aos_%' or tablename like 'crm_%';`
   (every policy should target `{authenticated}` and use `is_admin()`; none should target `anon`.)
8. **Verify AOS seed:** `select agent_key, status from public.aos_agents order by agent_key;`
   (expect 15 rows: 7 `testing`, 8 `future/inactive`.)
9. **Smoke test with dummy data** (see checklist below), then roll back the dummy rows.

---

## 9. Risks before applying

| Risk | Severity | Mitigation |
|------|----------|------------|
| `is_admin()` missing on target DB | High (migration aborts) | Apply base migrations 002/006 first; verify in step 2 |
| Applying without a backup | High | Mandatory backup in step 1 |
| Name collision with an existing `aos_*`/`crm_*` table | Low | `create table if not exists` won't overwrite; diff schema first |
| Admin server actions rely on service role | Low | Service role bypasses RLS; confirm admin reads still work post-apply |
| Future hard FK on `crm_leads.lead_id` desired | Low | Add later in a separate reviewed migration |
| Re-running migration | Low | Both are idempotent; seeds use `on conflict do nothing` |
| Time-zone expectations on `timestamptz` follow-up dates | Low | UI computes future dates in local time; DB stores UTC — acceptable |

**No destructive operations** (`drop table`, `drop column`, `rename`, `delete from <production>`,
`truncate`) exist in either migration. The only `drop policy if exists` statements are in the
pre-existing base migration, not in 012/013.

---

## 10. Recommended order to apply migrations later

```
1. (prerequisite, already live) 20260620000002_rls_policies.sql      -- provides is_admin()
2. (prerequisite, already live) 20260621000006_superadmin_foundation.sql -- provides profiles.admin_role
3. 20260627000012_aos_management_foundation.sql                      -- AOS tables + 15-agent seed
4. 20260627000013_crm_analytics_foundation.sql                       -- CRM + analytics tables
```

Within the project's broader migration timeline, 012 and 013 are the **last two** files by timestamp,
so a standard ordered apply (`supabase db push`) already runs them after all prerequisites.

---

## 11. Manual application checklist

- [ ] **Back up Supabase** (full backup / `pg_dump`).
- [ ] **Check current schema** — confirm no existing `aos_*` / `crm_*` tables; confirm `is_admin()` and `profiles` exist.
- [ ] **Apply AOS tables first** (`…012…`).
- [ ] **Apply CRM tables second** (`…013…`).
- [ ] **Apply analytics tables third** — included in `…013…` (`campaign_performance`, `crm_funnel_events`, `lead_attribution`); confirm they were created.
- [ ] **Verify RLS** is enabled on all 22 new tables.
- [ ] **Verify admin access** — an admin user can read/write; a non-admin/anon gets zero rows.
- [ ] **Test with dummy data** — insert a throwaway `aos_agents`/`crm_leads` row as admin, confirm visibility rules, then delete it.

---

## 12. Confirmations

- ✅ **No `.env` / `.env.local` files were touched** in this phase.
- ✅ **No live database changes were made.** This phase only reviewed SQL files and edited one
  migration file (removed a redundant CHECK constraint + added a comment).
- ✅ **No production tables were renamed, dropped, or altered.** The CRM overlay references existing
  leads by id without a hard FK and does not modify `public.leads`.

---

## 13. Recommended next phase

**Phase 5 — Controlled migration apply + read-only data binding (staging first).**

1. Apply migrations 012 and 013 on a **staging / branch database** using the checklist above.
2. Add **read-only** Supabase queries that bind the AOS Control Center and CRM/Analytics dashboards
   to real `aos_*` / `crm_*` rows (replacing derived mock rows), still with no writes, no AI, no
   WhatsApp, no distribution, no credit deduction.
3. Only after staging verification, schedule the production apply (backup + checklist), then enable
   **write** flows (notes, tasks, nurture scheduling) behind the approval queue.
