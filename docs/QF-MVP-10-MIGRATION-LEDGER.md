# QF-MVP-10.3 — Migration Ledger

**Branch:** `mvp/qf-mvp-10-core-data-truth-v1` · **HEAD:** `cda20fd` · **Status:** evidence map (no DB access)
**Source of truth:** `supabase/migrations/*.sql` (68 files) → parsed into [`docs/generated/qf-mvp-migration-ledger.json`](generated/qf-mvp-migration-ledger.json) by `scripts/mvp/inventory/run.mjs`.

## Method & evidence rule

- Object lists are **regex-extracted from committed SQL** — repository evidence of what the SQL *declares*, not a full parser. See the JSON for the exact per-migration object arrays.
- **No database access occurred.** Therefore **every migration's `staging` and `production` applied-status is `UNKNOWN_UNVERIFIED`** and is *not* inferred from filename or repository presence. Applied status is resolved by the read-only procedure in [`QF-MVP-10-DATABASE-RECONCILIATION.md`](QF-MVP-10-DATABASE-RECONCILIATION.md).
- **QF-MVP-10.7 status vocabulary** (to be filled per migration *once the reconciliation tool runs with credentials*): `STAGING_MATCHED` · `STAGING_DRIFT` · `STAGING_NOT_PRESENT` · `PRODUCTION_MATCHED` · `PRODUCTION_DRIFT` · `PRODUCTION_NOT_PRESENT` · `UNKNOWN_UNVERIFIED`. **A migration is never marked applied merely because a similarly-named object exists.** The reconciliation tool (`scripts/mvp/reconciliation/**`) is built and self-tested, but **has not been executed** (no read-only credentials / `psql` in the working environment) — so **all rows remain `UNKNOWN_UNVERIFIED`**. See [`QF-MVP-10-RECONCILIATION-RESULTS.md`](QF-MVP-10-RECONCILIATION-RESULTS.md).
- **No migration is deleted, edited, or reordered by this task.**

> ¹ **Classification correction (QF-MVP-10.7):** the workflow-kernel migrations (49–52) are reclassified `KEEP_DISABLED` (was `KEEP_AS_BUILT`) — the kernel is **not runtime-referenced** (zero live imports; migration DO-NOT-AUTO-APPLY). Per the locked rule, workflow-kernel infrastructure is `KEEP_AS_BUILT` **only when runtime-referenced**, otherwise `KEEP_DISABLED`.

## Counts (repository declarations)

| Migrations | Tables created | Functions | Triggers | Enums | Policies | Tables w/ RLS enabled |
|---|---|---|---|---|---|---|
| 68 | 100 (unique names) | 50 (unique) | 2 | 0 | 77 | 89 |

> Enums = 0 (the schema uses `text` + `CHECK` constraints, not Postgres enums). Triggers = 2 (`on_auth_user_created`, `trg_automation_policy_configs_immutable`).

---

## ⚠️ CRITICAL — "GENERATED FOR REVIEW — DO NOT AUTO-APPLY" set (12 migrations)

These migrations carry the literal header `-- ADDITIVE. GENERATED FOR REVIEW — DO NOT AUTO-APPLY.` They are the **highest-uncertainty** for applied status and **must be verified before QF-MVP-20/40 rely on them**. They are the canonical **credit wallet**, the **workflow kernel**, the **automation-policy config**, and the **consent-command writer** — i.e. the ledger-backed money path and the idempotency/automation infra.

| # | Migration | Provides |
|---|---|---|
| 43 | `20260706000140_vendor_accepting_leads.sql` | `vendors.accepting_leads` |
| 44 | `20260706000141_vendor_credit_wallet_rpc.sql` | `qf_apply_vendor_credit_delta` + `uq_vendor_credit_logs_reference` |
| 45 | `20260706000142_credit_wallet_assignment_rpc.sql` | ledger-backed `assign_lead_to_paid_vendors_phase26a` |
| 46 | `20260706000143_preferred_assignment_accepting_leads.sql` | ledger-backed `assign_lead_to_preferred_vendor` |
| 47 | `20260706000144_manual_assignment_accepting_leads.sql` | ledger-backed `assign_lead_to_vendors` |
| 48 | `20260706000145_package_purchase_idempotent_grant.sql` | idempotent `assign_package_to_vendor` |
| 49 | `20260706000146_create_qf_workflow_kernel_foundation.sql` | `domain_events`, `outbox_events`, `idempotency_records`, `workflow_*` |
| 50 | `20260706000147_workflow_kernel_atomic_step.sql` | `qf_apply_workflow_step`, `qf_acquire_domain_event` |
| 51 | `20260706000148_workflow_kernel_safety_hardening.sql` | dead-letter / retry fns |
| 52 | `20260706000149_workflow_kernel_retry_consistency.sql` | retry consistency fns |
| 53 | `20260706000150_automation_policy_config_foundation.sql` | `automation_policy_configs` + immutability trigger |
| 64 | `20260712000300_communication_consent_command_writer_rpc.sql` | `apply_communication_consent_command` (STOP/START writer RPC) |

> Softer "do not apply / placeholder" phrasing also appears in migrations **12, 13, 14, 15** (AOS/CRM foundations), **60** (`whatsapp_cloud_api_runtime_control`), and **61** (`auth_transport_resilience`). Verify all in reconciliation. Core foundation (1–3) and `unified_communication_core` (55) are **not** marked for-review.

**Consequence (from Packages/Credits analysis):** if 141–145 are *not* applied to production, the live system may still run the **legacy** un-ledgered `deduct_vendor_credit` and a **non-idempotent** `assign_package_to_vendor`. This is a launch gate, not a documentation nicety.

---

## Migration families (by order)

| Family | Migrations | Notes |
|---|---|---|
| **Core foundation** | 1–5, 7–11, 21 | leads/vendors/packages/assignments/profiles/cities/categories + core RPCs + vendor columns |
| **RLS & security** | 2, 41, 56, 63 | policies; `lead_scores` + auth hardening |
| **Superadmin/admin/audit** | 6 | admin_notifications, audit_logs, automations, ai_agents/ai_suggestions (AI tables → KEEP_DISABLED) |
| **AOS agent management** | 12, 14, 16, 53 | `aos_*` tables + runtime settings + automation policy (12 & 14 re-declare same tables) |
| **Vendor CRM foundation** | 13, 15 | `crm_*` + `lead_attribution` (13 & 15 re-declare same tables) |
| **Marketplace assignment engine** | 17–19, 22, 26–36, 42–48 | approvals, ledger snapshots, phase25a/26a matching, requirement groups, preferred vendor, credit-gated assign RPCs |
| **Lead quality** | 37, 38, 40, 41 | `lead_scores` (rule-based), clarification flow, status constraints |
| **Workflow kernel (AOS)** | 49–52 | domain events / outbox / idempotency / workflow tasks |
| **Identity & auth** | 54, 56, 57, 58 | client_accounts, verification_challenges, vendor_dashboard_users, OTP/reset RPCs |
| **Communication / consent / Meta** | 55, 59–68 | messages/templates/delivery, provider accounts, consent events + writer + ack intents, provider-account binding |
| **Geo / location** | 39 | google area/location fields |

---

## Full per-migration ledger

Legend — **Rv** = for-review/do-not-auto-apply header. **Class**: MVP_REQUIRED (MR) · KEEP_AS_BUILT (KB) · KEEP_DISABLED (KD) · POST_MVP (PM) · UNKNOWN_REQUIRES_AUDIT (UA). `staging`/`production` = **UNKNOWN_UNVERIFIED** for **all** rows (omitted from the table for brevity).

| # | File | Domain | Purpose / key new objects | Rv | Class | Conf |
|---|---|---|---|---|---|---|
| 1 | `…0001_create_tables` | foundation | leads, vendors, packages, vendor_packages, lead_assignments, profiles, cities, service_categories, payments, whatsapp_logs, app_settings, bad_lead_reports, lead_status_updates | | MR | high |
| 2 | `…0002_rls_policies` | security | 32 policies, RLS on 13 tables; `is_admin`, `owns_vendor` | | MR | high |
| 3 | `…0003_functions` | foundation | core RPCs: assign_lead_to_vendors, deduct_vendor_credit, restore_vendor_credit, increment_vendor_credits, check_duplicate_lead, get_public_eligible_vendors, assign_package_to_vendor, update_vendor_visibility, expire_vendor_packages, handle_new_user | | MR | high |
| 4 | `…0004_seed_data` | foundation | seed cities/categories/settings | | KB | med |
| 5 | `…0005_homepage_alignment` | foundation | leads/vendors column alignment | | MR | med |
| 6 | `…0007_superadmin_foundation` | admin/audit | audit_logs, admin_notifications, lead_timeline_events, localities, reviews, **ai_agents/ai_suggestions/automations/automation_logs** | | MR (audit) / KD (AI tables) | med |
| 7 | `…0007_vendor_location` | foundation | vendors location cols | | MR | high |
| 8 | `…0008_lead_capture_consent` | leads | leads consent cols | | MR | high |
| 9–11 | `…0009/0010/0011_vendor_*` | vendors | vendor onboarding/exact/office-address cols | | MR | high |
| 12 | `…0012_aos_management_foundation` | AOS | aos_agents, aos_agent_*, aos_approval_queue, aos_audit_logs, aos_cost_logs, aos_failures | soft | KD | med |
| 13 | `…0013_crm_analytics_foundation` | CRM | crm_leads, crm_activities, crm_followups, crm_lead_tasks, campaign_performance, lead_attribution | soft | MR (CRM prereq) | med |
| 14 | `…0014_aos_control_center_foundation` | AOS | **re-declares 12's aos_* tables** | soft | UA (dup of 12) | med |
| 15 | `…0015_crm_analytics_foundation_safe_placeholders` | CRM | **re-declares 13's crm_* tables** | soft | UA (dup of 13) | med |
| 16 | `…0016_aos_runtime_settings` | AOS | aos_runtime_settings | | KD | high |
| 17 | `…0017_lead_assignment_approvals` | marketplace | lead_assignment_approvals | | MR | high |
| 18 | `…0018_vendor_actions_credits_package_sync` | credits | vendor_credit_logs | | MR | high |
| 19 | `…0019_assignment_ledger_snapshots` | marketplace | approvals snapshot cols | | MR | high |
| 20 | `…0020_align_active_cities` | geo | city activation data | | KB | med |
| 21 | `…0021_category_governance` | foundation | service_categories governance | | MR | high |
| 22 | `…0022_phase_25a_paid_only_auto_match_free_vendor_interest` | marketplace | free_vendor_profile_interests, lead_assignment_queue, lead_auto_assignment_logs, marketplace_runtime_settings | | MR | high |
| 23 | `…0023_vendor_package_orders` | packages | vendor_package_orders | | MR | high |
| 24 | `…0024_vendor_profile_change_requests` | vendors | vendor_profile_change_requests | | MR | high |
| 25 | `…0025_vendor_notifications_support` | vendors | vendor_notifications, vendor_support_threads/messages | | MR | high |
| 26 | `…0026_bad_lead_report_safety_fields` | marketplace | bad_lead_reports cols | | MR | high |
| 27 | `…0027_phase26a_auto_lead_matching_foundation` | marketplace | client_notification_logs, lead_delivery_logs, lead_matching_runs, `assign_lead_to_paid_vendors_phase26a` | | MR (superseded by 45) | high |
| 28 | `…0028_phase26a_live_schema_repair` | marketplace | **live schema-drift repair** of 27 (known drift) | | MR | high |
| 29 | `…0029_phase26a2_admin_audit_hardening` | marketplace | bad_lead_report_comments | | MR | high |
| 30 | `…0030_phase26a2c_smart_override_assignment` | marketplace | `admin_smart_assign_lead_to_vendors` | | MR | high |
| 31 | `…0031_phase26a2c_recovery_fallback_reporting` | marketplace | `admin_smart_assign_lead_to_vendors` (⚠ un-ledgered debit — see Authority Audit HIGH) | | MR | high |
| 32 | `…0032_phase26a2d_client_requirement_groups` | marketplace | client_requirement_groups, `assign_vendor_to_requirement_group`, `refresh_requirement_group_counters` | | MR | high |
| 33 | `…0033_phase26a2e_preferred_vendor_recharge_window` | marketplace | `assign_client_selected_vendor_to_group` | | MR | high |
| 34 | `…0037_fix_auto_match_category_mapping` | marketplace | qf_category_* fns + phase26a redef | | MR | high |
| 35 | `…0035_preferred_vendor_lead_intent` | marketplace | `assign_lead_to_preferred_vendor` | | MR | high |
| 36 | `…0037_fix_preferred_vendor_credit_direct_assignment` | marketplace | `assign_lead_to_preferred_vendor` redef | | MR | high |
| 37 | `…0038_lead_quality_engine_phase1` | lead-quality | `lead_scores` (**rule-based**, not AI) | | MR | high |
| 38 | `…0039_b_lead_clarification_flow` | lead-quality | lead_clarification_requests/responses | | MR | high |
| 39 | `…0040_google_area_location_foundation` | geo | leads/vendors area fields | | KB | med |
| 40 | `…0100_align_lead_quality_status_constraints` | lead-quality | leads status constraints | | MR | high |
| 41 | `…0110_lead_scores_security_hardening` | security | lead_scores RLS | | MR | high |
| 42 | `…0130_distance_category_matching_rpc` | marketplace | qf distance/category RPCs + phase26a redef | | MR | high |
| 43 | `…0140_vendor_accepting_leads` | vendors | vendors.accepting_leads | **Y** | MR | high |
| 44 | `…0141_vendor_credit_wallet_rpc` | credits | `qf_apply_vendor_credit_delta`, `uq_vendor_credit_logs_reference` | **Y** | MR | high |
| 45 | `…0142_credit_wallet_assignment_rpc` | credits | ledger-backed `assign_lead_to_paid_vendors_phase26a` | **Y** | MR | high |
| 46 | `…0143_preferred_assignment_accepting_leads` | credits | ledger-backed `assign_lead_to_preferred_vendor` | **Y** | MR | high |
| 47 | `…0144_manual_assignment_accepting_leads` | credits | ledger-backed `assign_lead_to_vendors` | **Y** | MR | high |
| 48 | `…0145_package_purchase_idempotent_grant` | packages | idempotent `assign_package_to_vendor` | **Y** | MR | high |
| 49 | `…0146_create_qf_workflow_kernel_foundation` | workflow-kernel | domain_events, outbox_events, idempotency_records, workflow_* | **Y** | KD¹ | high |
| 50 | `…0147_workflow_kernel_atomic_step` | workflow-kernel | `qf_apply_workflow_step`, `qf_acquire_domain_event` | **Y** | KD¹ | high |
| 51 | `…0148_workflow_kernel_safety_hardening` | workflow-kernel | dead-letter/retry fns | **Y** | KD¹ | high |
| 52 | `…0149_workflow_kernel_retry_consistency` | workflow-kernel | retry-consistency fns | **Y** | KD¹ | high |
| 53 | `…0150_automation_policy_config_foundation` | AOS | automation_policy_configs + immutability trigger | **Y** | KD | high |
| 54 | `…0160_identity_security_foundation` | identity | auth_security_events, client_accounts, password_reset_grants, verification_challenges | | MR | high |
| 55 | `…0170_unified_communication_core` | communication | communication_messages/templates/delivery_events/webhook_receipts/automation_catalog | | MR | high |
| 56 | `…0180_vendor_authentication_foundation` | identity | vendor_dashboard_users | | MR | high |
| 57 | `…0190_client_whatsapp_otp_login_readiness` | identity | client_accounts OTP cols | | MR | high |
| 58 | `…0200_vendor_whatsapp_verification_password_reset` | identity | vendor_auth_* RPCs | | MR | high |
| 59 | `…0100_messaging_channel_provider_foundation` | communication | provider_accounts, provider_template_mappings, suppressions, preferences, channel_capabilities, authentication_transport_policies/delivery_attempts | | MR + KB (multi-channel) | high |
| 60 | `…0200_whatsapp_cloud_api_runtime_control` | communication | provider_runtime_policies, provider_canary_destinations | soft | MR | high |
| 61 | `…0100_auth_transport_resilience_decision_foundation` | communication | authentication_transport_failure_rules, qf_claim/finalize_auth_delivery_attempt | soft | KB | high |
| 62 | `…0100_whatsapp_inbound_message_foundation` | communication | communication_inbound_messages | | MR | high |
| 63 | `…0200_communication_consent_evidence_and_state_hardening` | consent | communication_consent_events | | MR | high |
| 64 | `…0300_communication_consent_command_writer_rpc` | consent | `apply_communication_consent_command` (STOP/START writer) | **Y** | MR | high |
| 65 | `…0100_communication_consent_ack_intents` | consent | communication_consent_ack_intents + qf_* ack fns | | MR | high |
| 66 | `…0100_communication_provider_account_binding` | communication | provider-account binding cols on 5 comms tables | | MR | high |
| 67 | `…0100_communication_delivery_event_provider_account_required` | communication | delivery-event provider-account NOT NULL | | MR | high |
| 68 | `…0100_communication_consent_ack_intent_provider_account_required` | consent | ack-intent provider-account NOT NULL | | MR | high |

*(Filenames abbreviated to the trailing token; full names + full object arrays in the generated JSON.)*

---

## Migrations required by capability

- **Marketplace Core (intake→qualify→eligible→assign→replace→close):** 1, 3, 5, 8, 17–19, 21, 22, 26–36, 37–42, 43–47.
- **Packages & credits:** 1 (packages/vendor_packages), 3 (legacy credit fns), 18 (vendor_credit_logs), 23, 44 (wallet RPC), 45–47 (ledger-backed debit), 48 (idempotent grant). **All of 44–48 are DO-NOT-AUTO-APPLY.**
- **Assignments & replacements:** 1 (lead_assignments), 17, 19, 27–33, 42, 45–47.
- **Communication:** 55, 59, 62, 66–68.
- **Meta provider accounts:** 59 (provider_accounts + template_mappings), 60 (runtime policies + canary), 66 (binding).
- **Consent:** 63 (events), 64 (writer RPC — DO-NOT-AUTO-APPLY), 66, 68.
- **Acknowledgement workers:** 65 (ack intents + qf_* fns), 68.
- **Vendor CRM prerequisites:** 13/15 (crm_* tables), 6 (lead_internal_notes, reviews).
- **Auth transport / SMS resilience (KEEP_AS_BUILT):** 59, 61.

## Apparently superseded / re-declared (⚠ never delete without DB proof)

| Item | Evidence | Disposition |
|---|---|---|
| 14 re-declares 12's `aos_*` tables | identical table set | `UNKNOWN_REQUIRES_AUDIT` — verify idempotency + live state before any consolidation |
| 15 ("safe_placeholders") re-declares 13's `crm_*` tables | identical table set | `UNKNOWN_REQUIRES_AUDIT` — likely defensive idempotent re-declaration |
| 27 → 28 (`live_schema_repair`) | 28 repairs 27's drift | keep both; 28 is the reconciled truth |
| `assign_lead_to_paid_vendors_phase26a` defined in 27, 34, 42, 45 | 4 `CREATE OR REPLACE` | **live definition = last applied**; unverifiable here → reconciliation |
| `assign_lead_to_preferred_vendor` (35, 36, 46); `assign_lead_to_vendors` (3, 47); `assign_package_to_vendor` (3, 48) | multiple redefs | same — apply-order-dependent |

## Never-delete-without-DB-proof (hard rule)

Every migration file is retained. **No migration may be deleted or edited** until read-only reconciliation (10.7) proves (a) it is not the live definition of any applied object and (b) no runtime consumer depends on it. This especially covers the 12 DO-NOT-AUTO-APPLY files (their applied state is unknown) and all superseded RPC redefinitions.

## Verification SQL (for QF-MVP-10.7 reconciliation — read-only)

Run with a **read-only** role against staging first, then production. Do **not** `db push`/`reset`/`migration up`.

```sql
-- 1. Applied migration history (Supabase CLI ledger)
select version, name, statements is not null as has_body
from supabase_migrations.schema_migrations order by version;

-- 2. Does an object exist? (tables)
select table_schema, table_name from information_schema.tables
where table_schema='public' order by table_name;

-- 3. Functions (RPCs) present + SECURITY DEFINER
select p.proname, p.prosecdef as security_definer, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' order by p.proname;

-- 4. Is the ledger-backed wallet live? (does the unique index exist?)
select indexname from pg_indexes where schemaname='public' and indexname='uq_vendor_credit_logs_reference';

-- 5. RLS + policies per table
select c.relname, c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies pol where pol.tablename=c.relname) as policy_count
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' order by c.relname;

-- 6. Confirm which assign_* RPC body is live (spot-check text) — read-only
select proname, md5(pg_get_functiondef(oid)) as body_hash
from pg_proc where proname like 'assign_lead%' or proname='qf_apply_vendor_credit_delta';
```

Compare each result against the committed declarations in the generated ledger JSON and classify drift per [`QF-MVP-10-DATABASE-RECONCILIATION.md`](QF-MVP-10-DATABASE-RECONCILIATION.md) (`REPOSITORY_ONLY` / `DATABASE_ONLY` / `DEFINITION_DRIFT` / `HISTORY_DRIFT` / `EXPECTED_ENVIRONMENT_DIFFERENCE` / `UNKNOWN_REQUIRES_REVIEW`).
