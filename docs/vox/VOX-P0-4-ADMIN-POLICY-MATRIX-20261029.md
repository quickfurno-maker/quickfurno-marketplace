# VOX P0-4 — `is_admin()` / `owns_vendor()` source-derived policy matrix (SOURCE-ONLY)

Branch `feat/vox-claude-p0-4-rls-20261029`, base PR #422 SHA `de8f533e7f6a8880d4d72189c285bead8c6ab443`. This document is read-only analysis. It adds no migration, changes no helper function, and is not applied to any managed database.

## 0. Methodology and hard caveat

This matrix was built by reading every file under `supabase/migrations/*.sql` in this worktree and extracting every `create policy` statement (including ones generated at migration-apply time inside `do $$ ... execute format(...) $$` loops) that references `public.is_admin()` and/or `public.owns_vendor(uuid)`.

**This is a source checkout snapshot, not a live-database read.** It does **not** query `pg_policies` on any managed environment, and Claude's execution limits for this task forbid any DB/Docker/Bash tool that could do so. The task brief states the *verified managed Staging catalog* counts are **59** policies depending on `is_admin()` and **22** depending on `owns_vendor()`. The counts below are a **separate, source-only** figure and are **not reconciled** against that catalog. Do not treat the source-only numbers as confirmation, contradiction, or a refinement of the 59/22 Staging figures — they are a different measurement on a different artifact (migration files in this checkout vs. applied state in Staging). Plausible reasons they diverge in either direction: migrations present in this checkout that were never applied to Staging; migrations applied to Staging from a different branch/history not present here; policies dropped or renamed live after being created by one of these files; this checkout missing migrations that exist only in Staging's history.

Policies that enable RLS but use **no** admin/vendor helper (pure self-row checks like `id = auth.uid()`, public-visibility flags, `anon` insert gates) are out of scope and excluded from the table below.

## 1. Source-only summary counts

| Metric | Source-only count (this checkout) | Verified managed Staging catalog |
|---|---|---|
| Distinct named policies referencing `is_admin()` (alone or combined with `owns_vendor()`) | **103** | 59 |
| Distinct named policies referencing `owns_vendor()` (alone or combined with `is_admin()`) | **21** | 22 |
| Distinct named policies referencing either helper (union) | **111** | not given as a union figure |
| Of the above, `FOR ALL` policies (single policy covering SELECT+INSERT+UPDATE+DELETE) | **70** | not given |

The `owns_vendor()` figure (21) sits close to Staging's 22 — this is noted only as a coincidence worth a human operator's attention, **not** as evidence the two are the same set; one plausible single-row gap is a migration this checkout doesn't have, or a Staging-side manual policy. The corrected `is_admin()` figure (103) is far above Staging's 59, most plausibly because several newer foundation/placeholder migrations in this checkout (AOS, CRM analytics, lead-fairness) generate large batches of admin-only policies per table via loops, and some or all of those may not have been applied to Staging yet, or Staging's catalog predates them. **Neither gap is resolved here** — resolving it requires a live Staging `pg_policies` read, which is out of scope for this task.

## 2. Full matrix — explicit (non-generated) `create policy` statements

Grouped by source migration file, in the order encountered. "Helper" columns mark which of the two helpers the policy's `USING`/`WITH CHECK` clauses invoke anywhere in their expression (`OR` and `AND` combinations are both marked Y; see the Condition column for the actual logic — Y does not imply "only").

### 2.1 `supabase/migrations/20260620000002_rls_policies.sql` (the migration the P0-2 candidate targets)

| Policy | Table | Cmd | `is_admin()` | `owns_vendor()` | FOR ALL | USING / WITH CHECK condition |
|---|---|---|---|---|---|---|
| `profiles self read` | profiles | SELECT | Y | N | N | `id = auth.uid() OR is_admin()` |
| `profiles admin all` | profiles | ALL | Y | N | **Y** | `is_admin()` (both) |
| `vendors owner read` | vendors | SELECT | Y | N | N | `user_id = auth.uid() OR is_admin()` |
| `vendors owner update` | vendors | UPDATE | Y | N | N | `user_id = auth.uid() OR is_admin()` (both) |
| `vendors admin all` | vendors | ALL | Y | N | **Y** | `is_admin()` (both) |
| `leads admin all` | leads | ALL | Y | N | **Y** | `is_admin()` (both) |
| `packages public read` | packages | SELECT | Y | N | N | `is_active OR is_admin()` |
| `packages admin write` | packages | ALL | Y | N | **Y** | `is_admin()` (both) |
| `vendor_pkgs owner read` | vendor_packages | SELECT | Y | Y | N | `owns_vendor(vendor_id) OR is_admin()` |
| `vendor_pkgs admin all` | vendor_packages | ALL | Y | N | **Y** | `is_admin()` (both) |
| `payments owner read` | payments | SELECT | Y | Y | N | `owns_vendor(vendor_id) OR is_admin()` |
| `payments admin all` | payments | ALL | Y | N | **Y** | `is_admin()` (both) |
| `assign owner read` | lead_assignments | SELECT | Y | Y | N | `owns_vendor(vendor_id) OR is_admin()` |
| `assign owner update` | lead_assignments | UPDATE | **N** | Y | N | `owns_vendor(vendor_id)` only — **no admin fallback**, both sides |
| `assign admin all` | lead_assignments | ALL | Y | N | **Y** | `is_admin()` (both) |
| `status owner rw` | lead_status_updates | ALL | Y | Y | **Y** | `owns_vendor(vendor_id) OR is_admin()` (both); single `FOR ALL` covers read+write together, not split |
| `reports owner read` | bad_lead_reports | SELECT | Y | Y | N | `owns_vendor(vendor_id) OR is_admin()` |
| `reports owner insert` | bad_lead_reports | INSERT | **N** | Y | N | `owns_vendor(vendor_id) AND exists(lead_assignments match)` — no admin fallback |
| `reports admin all` | bad_lead_reports | ALL | Y | N | **Y** | `is_admin()` (both) |
| `wa admin all` | whatsapp_logs | ALL | Y | N | **Y** | `is_admin()` (both) |
| `wa vendor read` | whatsapp_logs | SELECT | **N** | Y | N | `recipient_type = 'vendor' AND owns_vendor(recipient_id)` — no admin fallback |
| `categories public read` | service_categories | SELECT | Y | N | N | `is_active OR is_admin()` |
| `categories admin write` | service_categories | ALL | Y | N | **Y** | `is_admin()` (both) |
| `cities public read` | cities | SELECT | Y | N | N | `is_active OR is_admin()` |
| `cities admin write` | cities | ALL | Y | N | **Y** | `is_admin()` (both) |
| `settings admin write` | app_settings | ALL | Y | N | **Y** | `is_admin()` (both) |

26 rows (of 32 total policies in this file; 6 excluded as helper-free: `profiles self update`, `vendors public listing`, `vendors public register`, `leads public insert`, `leads vendor read`, `settings public read`). 13 of the 26 are `FOR ALL`.

**Notable:** `leads vendor read` implements vendor-ownership logic by hand (`join lead_assignments ... where v.user_id = auth.uid()`) instead of calling `owns_vendor()` — it is excluded from the owns_vendor count above because it never calls the helper, even though it is semantically the same kind of check. Not something this task changes; flagged only so a future `owns_vendor()` change doesn't assume this policy would inherit it.

### 2.2 `supabase/migrations/20260621000006_superadmin_foundation.sql`

| Policy | Table | Cmd | `is_admin()` | `owns_vendor()` | FOR ALL | Condition |
|---|---|---|---|---|---|---|
| `localities public read` | localities | SELECT | Y | N | N | `is_active OR is_admin()` |
| `localities admin all` | localities | ALL | Y | N | **Y** | `is_admin()` (both) |
| `reviews public approved read` | reviews | SELECT | Y | N | N | `status = 'Approved' OR is_admin()` |
| `reviews admin all` | reviews | ALL | Y | N | **Y** | `is_admin()` (both) |
| `lead timeline admin all` | lead_timeline_events | ALL | Y | N | **Y** | `is_admin()` (both) |
| `lead notes admin all` | lead_internal_notes | ALL | Y | N | **Y** | `is_admin()` (both) |
| `vendor notes admin all` | vendor_internal_notes | ALL | Y | N | **Y** | `is_admin()` (both) |
| `audit admin read` | audit_logs | SELECT | Y | N | N | `is_admin()` — later **redefined with an identical predicate** by `drop policy if exists` + `create policy` in `20260817000000_qf_mvp_80_03_audit_logs_forward_repair.sql`; no behavior change, not double-counted |
| `audit admin insert` | audit_logs | INSERT | Y | N | N | `is_admin()` — same redefinition note as above |
| `notifications admin all` | admin_notifications | ALL | Y | N | **Y** | `is_admin()` (both) |
| `ai agents admin all` | ai_agents | ALL | Y | N | **Y** | `is_admin()` (both) |
| `ai runs admin all` | ai_agent_runs | ALL | Y | N | **Y** | `is_admin()` (both) |
| `ai suggestions admin all` | ai_suggestions | ALL | Y | N | **Y** | `is_admin()` (both) |
| `automations admin all` | automations | ALL | Y | N | **Y** | `is_admin()` (both) |
| `automation logs admin all` | automation_logs | ALL | Y | N | **Y** | `is_admin()` (both) |

15 rows, 11 `FOR ALL`. The prior draft incorrectly stated 14; the table itself contains 15 policies.

### 2.3 Single-table admin-only migrations (one `FOR ALL` policy each, `is_admin()` only, idempotency-guarded with `if not exists ... pg_policies`)

| File | Policy | Table |
|---|---|---|
| `20260630000016_aos_runtime_settings.sql` | `aos_runtime_settings admin all` | aos_runtime_settings |
| `20260630000018_vendor_actions_credits_package_sync.sql` | `vendor_credit_logs admin all` | vendor_credit_logs |
| `20260630000017_lead_assignment_approvals.sql` | `lead_assignment_approvals admin all` | lead_assignment_approvals |
| `20260701000032_phase26a2d_client_requirement_groups.sql` | `client_requirement_groups admin all` | client_requirement_groups |

4 rows, all `FOR ALL`, all `is_admin()` only.

### 2.4 `supabase/migrations/20260701000023_vendor_package_orders.sql`

| Policy | Table | Cmd | `is_admin()` | `owns_vendor()` | FOR ALL | Condition |
|---|---|---|---|---|---|---|
| `vendor_package_orders owner read` | vendor_package_orders | SELECT | Y | Y | N | `owns_vendor(vendor_id) OR is_admin()` |
| `vendor_package_orders owner insert` | vendor_package_orders | INSERT | **N** | Y | N | `owns_vendor(vendor_id)` only |
| `vendor_package_orders admin all` | vendor_package_orders | ALL | Y | N | **Y** | `is_admin()` (both) |

### 2.5 `supabase/migrations/20260701000024_vendor_profile_change_requests.sql`

| Policy | Table | Cmd | `is_admin()` | `owns_vendor()` | FOR ALL | Condition |
|---|---|---|---|---|---|---|
| `vendor_profile_change_requests owner read` | vendor_profile_change_requests | SELECT | Y | Y | N | `owns_vendor(vendor_id) OR is_admin()` |
| `vendor_profile_change_requests owner insert` | vendor_profile_change_requests | INSERT | **N** | Y | N | `owns_vendor(vendor_id)` only |
| `vendor_profile_change_requests admin all` | vendor_profile_change_requests | ALL | Y | N | **Y** | `is_admin()` (both) |

### 2.6 `supabase/migrations/20260701000025_vendor_notifications_support.sql`

| Policy | Table | Cmd | `is_admin()` | `owns_vendor()` | FOR ALL | Condition |
|---|---|---|---|---|---|---|
| `vendor_notifications owner read` | vendor_notifications | SELECT | Y | Y | N | `owns_vendor(vendor_id) OR is_admin()` |
| `vendor_notifications owner update` | vendor_notifications | UPDATE | Y | Y | N | `owns_vendor(vendor_id) OR is_admin()` (both) |
| `vendor_notifications admin all` | vendor_notifications | ALL | Y | N | **Y** | `is_admin()` (both) |
| `vendor_support_threads owner read` | vendor_support_threads | SELECT | Y | Y | N | `owns_vendor(vendor_id) OR is_admin()` |
| `vendor_support_threads owner insert` | vendor_support_threads | INSERT | **N** | Y | N | `owns_vendor(vendor_id)` only |
| `vendor_support_threads owner update` | vendor_support_threads | UPDATE | Y | Y | N | `owns_vendor(vendor_id) OR is_admin()` (both) |
| `vendor_support_threads admin all` | vendor_support_threads | ALL | Y | N | **Y** | `is_admin()` (both) |
| `vendor_support_messages owner read` | vendor_support_messages | SELECT | Y | Y | N | `exists(thread t: owns_vendor(t.vendor_id) OR is_admin())` |
| `vendor_support_messages owner insert` | vendor_support_messages | INSERT | **N** | Y | N | `sender_type = 'vendor' AND exists(thread t: owns_vendor(t.vendor_id))` |
| `vendor_support_messages admin all` | vendor_support_messages | ALL | Y | N | **Y** | `is_admin()` (both) |

10 rows, 3 `FOR ALL`.

### 2.7 `supabase/migrations/20260701000027_phase26a_auto_lead_matching_foundation.sql` and `20260701000028_phase26a_live_schema_repair.sql`

Both files create the **same four policy names on the same three tables**, each independently guarded with `if not exists ... pg_policies`. Counted once (the second file's guard makes it a no-op if the first already ran):

| Policy | Table | Cmd | `is_admin()` | `owns_vendor()` | FOR ALL | Condition |
|---|---|---|---|---|---|---|
| `lead_matching_runs admin all` | lead_matching_runs | ALL | Y | N | **Y** | `is_admin()` (both) |
| `lead_delivery_logs vendor read` | lead_delivery_logs | SELECT | Y | Y | N | `owns_vendor(vendor_id) OR is_admin()` |
| `lead_delivery_logs admin all` | lead_delivery_logs | ALL | Y | N | **Y** | `is_admin()` (both) |
| `client_notification_logs admin all` | client_notification_logs | ALL | Y | N | **Y** | `is_admin()` (both) |

### 2.8 `supabase/migrations/20260701000029_phase26a2_admin_audit_hardening.sql`

| Policy | Table | Cmd | `is_admin()` | `owns_vendor()` | FOR ALL | Condition |
|---|---|---|---|---|---|---|
| `bad_lead_report_comments admin all` | bad_lead_report_comments | ALL | Y | N | **Y** | `is_admin()` (both) |
| `bad_lead_report_comments vendor read own` | bad_lead_report_comments | SELECT | **N** | Y | N | `coalesce(is_internal,false)=false AND exists(report r: owns_vendor(r.vendor_id))` — no admin fallback |

### 2.9 `supabase/migrations/20260708000160_identity_security_foundation.sql`

| Policy | Table | Cmd | `is_admin()` | `owns_vendor()` | FOR ALL | Condition |
|---|---|---|---|---|---|---|
| `client_accounts owner read` | client_accounts | SELECT | Y | N | N | `auth.uid() = user_id OR is_admin()` |
| `client_accounts admin manage` | client_accounts | ALL | Y | N | **Y** | `is_admin()` (both) |

### 2.10 `supabase/migrations/20260708000180_vendor_authentication_foundation.sql`

| Policy | Table | Cmd | `is_admin()` | `owns_vendor()` | FOR ALL | Condition |
|---|---|---|---|---|---|---|
| `vendor_dashboard_users admin read` | vendor_dashboard_users | SELECT | Y | N | N | `is_admin()` |

(`vendor_dashboard_users self read` in the same file is excluded — `auth.uid() = user_id` only, no helper.)

### 2.11 `supabase/migrations/20261002071500_vendor_fair_opportunity_distribution.sql` (+ idempotent re-assertion of one row in `20261002090000_vendor_fair_opportunity_group_reconcile.sql`)

| Policy | Table | Cmd | `is_admin()` | `owns_vendor()` | FOR ALL | Condition |
|---|---|---|---|---|---|---|
| `lead_fairness_opportunities admin read` | lead_fairness_opportunities | SELECT | Y | N | N | `is_admin()` |
| `lead_fairness_candidates admin read` | lead_fairness_candidates | SELECT | Y | N | N | `is_admin()` |
| `vendor_opportunity_fairness admin read` | vendor_opportunity_fairness | SELECT | Y | N | N | `is_admin()` |
| `vendor_opportunity_events admin read` | vendor_opportunity_events | SELECT | Y | N | N | `is_admin()` |

## 3. Dynamically generated policies (`foreach target_table in array[...] ... execute format(...)`)

These are not literal `create policy` lines in the file; the file contains one loop whose body runs once per array element at migration-apply time. Each is individually guarded with `if not exists (select 1 from pg_policies where ...)`, so re-running the same migration is a no-op.

| File | Policy name pattern | Cmd | Tables (array literal, in source order) | Count |
|---|---|---|---|---|
| `20260627000012_aos_management_foundation.sql` | `<table> admin all` | ALL, `is_admin()` both sides | aos_agents, aos_agent_versions, aos_agent_prompts, aos_agent_rules, aos_agent_permissions, aos_agent_logs, aos_agent_memory, aos_agent_tests, aos_approval_queue, aos_failures, aos_cost_logs, aos_audit_logs | 12 |
| `20260628000014_aos_control_center_foundation.sql` | `<table> admin all` | ALL, `is_admin()` both sides | **identical table list and identical policy name** to the row above | 0 net new — guard prevents duplicate creation; same 12 policies |
| `20260627000013_crm_analytics_foundation.sql` | `<table> admin all` | ALL, `is_admin()` both sides | crm_leads, crm_lead_notes, crm_lead_tasks, crm_activities, crm_followups, crm_calendar_events, crm_sources, lead_attribution, campaign_performance, crm_funnel_events | 10 |
| `20260628000015_crm_analytics_foundation_safe_placeholders.sql` | `<table> admin placeholder all` | ALL, `is_admin()` both sides | **same 10 tables as the row above**, but a **different policy name** (`... admin placeholder all` vs `... admin all`) | 10 — **see finding 4.1, this is a genuine duplicate, not a guard no-op** |
| `20260912040000_qf_aos_v2_intelligence.sql` | `<table> admin read` | SELECT only, `is_admin()` | aos_runs, aos_agent_logs, aos_recommendations, aos_agent_memory, aos_audit_logs | 5 — **see finding 4.2, overlaps 2 of the 12 tables above with a redundant SELECT-only policy** |

Dynamic total: 12 + 10 + 10 + 5 = **37** policies, all counted in the section-1 totals.

## 4. Findings / follow-up risks (not fixed by this task — surfaced only)

1. **Genuine duplicate admin policy objects on the 10 `crm_*`/`lead_attribution`/`campaign_performance` tables.** `crm_analytics_foundation.sql` creates `"<table> admin all"` and `crm_analytics_foundation_safe_placeholders.sql` creates `"<table> admin placeholder all"` on the exact same 10 tables. The two policy names differ, so the `if not exists` idempotency guard in the second migration does **not** see the first migration's policy and creates a second, functionally identical (`is_admin()`-gated `FOR ALL`) policy alongside it. If both migrations have been applied to an environment, that environment carries 20 policy objects doing the work of 10. This is not a security bug (both policies gate on the same `is_admin()` predicate, and Postgres `OR`s multiple permissive policies for the same command), but it is dead weight and a confusing artifact for anyone reading `pg_policies` later. **Follow-up: a human should decide whether to drop the `... admin placeholder all` set in a real migration — out of scope here, no migration was written.**
2. **Redundant SELECT-only policy on 2 already-fully-covered tables.** `qf_aos_v2_intelligence.sql` adds `"aos_agent_logs admin read"` and `"aos_agent_memory admin read"` (SELECT-only, `is_admin()`) on two tables that already carry `"aos_agent_logs admin all"` / `"aos_agent_memory admin all"` (`FOR ALL`, `is_admin()`) from the AOS foundation migrations. The `FOR ALL` policy already permits admin SELECT; the second policy is a no-op in practice. Not a bug, just noise. **No migration written to remove it.**
3. **Eight write-path policies have no `is_admin()` fallback at all**: `assign owner update`, `reports owner insert`, `wa vendor read`, `vendor_package_orders owner insert`, `vendor_profile_change_requests owner insert`, `vendor_support_threads owner insert`, `vendor_support_messages owner insert`, `bad_lead_report_comments vendor read own`. These depend solely on `owns_vendor()`. **This means the P0-2 `is_admin()` active-profile fix has zero effect on these eight** — disabling an admin's `is_active` flag does not change their access here, because these policies never call `is_admin()` to begin with. This is expected and correct (the candidate is scoped to `is_admin()` only), but it means **an operator should not assume the candidate "covers" every admin-adjacent policy** — it covers exactly the 103 source-snapshot policies that call `is_admin()`, not the full 111-policy source union.
4. **`leads vendor read`** implements ownership logic inline (`join lead_assignments ... v.user_id = auth.uid()`) instead of calling `owns_vendor()`. It is excluded from both helper counts. If `owns_vendor()` is ever hardened (per the deferred decision in `docs/vox/VOX-P0-2-RLS-CANDIDATE-20261029.md` §2), this policy would **not** automatically inherit that change, because it never calls the helper. Flagged for whoever eventually scopes that work.
5. **`audit admin read` / `audit admin insert`** are defined in `20260621000006_superadmin_foundation.sql` and then unconditionally `drop policy if exists` + recreated with an **identical** predicate in `20260817000000_qf_mvp_80_03_audit_logs_forward_repair.sql`. No behavior change across the two, confirmed by direct comparison of the `USING`/`WITH CHECK` text in both files. Counted once in section 1, not twice.
6. **No other migration in this checkout redefines the body of `public.is_admin()` or `public.owns_vendor(uuid)`.** Several later migrations (`20260723000700`, `20260723001000`, `20260911000000`, `20260921054654`) reference the functions only in comments, `to_regprocedure(...)` existence checks, or `grant`/`revoke execute` statements — none alter the function body. This supports (but, per the methodology caveat above, does not by itself *prove* for the live Staging database) the P0-2 candidate's claim that it is changing an otherwise-unmodified function.

## 5. Relationship to the P0-2 candidate

`ops/security/sql-candidates/vox_p0_2_is_admin_active_candidate.sql` changes only the body of `public.is_admin()`, adding `and is_active is true`. Because every one of the 103 source-only policies in section 1 that reference `is_admin()` call the same zero-argument function, the fix is still a single-point change for all of them, mechanically — this matches the single-point-change property already documented in `docs/vox/VOX-P0-2-RLS-CANDIDATE-20261029.md` §3, now enumerated concretely rather than asserted. **This matrix does not add new validation of that property** — it is a static read of the `USING`/`WITH CHECK` text, not a live test against each of the 103 source-snapshot policies. The regression coverage added in this task (`ops/security/tests/vox_p0_4_admin_rls_session_transitions_pg17.sql`) exercises the `is_admin()` function and one representative `FOR ALL` policy shape (the majority shape — 70 of 111 — per section 1), not all 102 individually; doing the latter would require per-table synthetic fixtures for every one of those tables, which is out of scope here and would still not substitute for the real Staging regression testing called for in the P0-2 doc's Release HOLD section.

No source files outside `docs/vox/` were read for interpretation purposes beyond `supabase/migrations/*.sql`, `ops/security/sql-candidates/`, and `ops/security/tests/`. No shell commands were run against any database. No credentials were accessed or required. This document and its counts are **not** a substitute for a live `pg_policies` read of managed Staging, which remains outstanding per the P0-2 doc's Release HOLD.
