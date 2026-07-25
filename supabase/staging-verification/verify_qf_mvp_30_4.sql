-- ============================================================================
-- QuickFurno — QF-MVP-30.4 — POST-APPLICATION VERIFICATION (SELECT-ONLY)
--
-- Verifies the vendor campaign management foundation after applying:
--   20260723001300_qf_mvp_vendor_campaign_foundation.sql
-- on top of the applied Marketplace Engine + CRM foundation + segment foundation.
--
-- SUPERSESSION NOTE
--   verify_qf_mvp_30_1b.sql and verify_qf_mvp_30_3.sql are LOCKED, POINT-IN-TIME
--   verifiers. verify_qf_mvp_30_3.sql asserts zero segment rows and a
--   pre-campaign world; it is NOT edited and MUST NOT be used as the post-30.4
--   verifier. THIS file supersedes it for the post-30.4 schema state: it
--   re-asserts the applicable earlier invariants and explicitly ACCEPTS the new
--   campaign foundation, while proving nothing was activated.
--
-- SELECT-ONLY BY CONSTRUCTION: one read-only SELECT ... UNION ALL statement.
-- No INSERT/UPDATE/DELETE/MERGE/TRUNCATE/CREATE/ALTER/DROP/GRANT/REVOKE/CALL/DO.
--
-- INTENDED USE: exactly ONE run, immediately after QF-MVP-30.4B application and
-- BEFORE any campaign fixture (several checks assert zero rows).
--
-- OUTPUT: seq | check_name | expected | actual | status | details
-- ============================================================================

select 1 as seq, 'C01_migration_history_once' as check_name, '1' as expected,
       (select count(*)::text from supabase_migrations.schema_migrations where version='20260723001300') as actual,
       case when (select count(*) from supabase_migrations.schema_migrations where version='20260723001300')=1
            then 'PASS' else 'FAIL' end as status,
       'the campaign foundation migration is applied exactly once' as details

union all
select 2, 'C02_segment_foundation_still_applied', '1',
       (select count(*)::text from supabase_migrations.schema_migrations where version='20260723001200'),
       case when (select count(*) from supabase_migrations.schema_migrations where version='20260723001200')=1
            then 'PASS' else 'FAIL' end,
       'the QF-MVP-30.3 segment foundation remains applied exactly once'

union all
select 3, 'C03_three_campaign_tables_present', '3',
       (select count(*)::text from unnest(array['public.vendor_campaigns',
          'public.vendor_campaign_audience_members','public.vendor_campaign_events']) s(t)
         where to_regclass(s.t) is not null),
       case when (select count(*) from unnest(array['public.vendor_campaigns',
          'public.vendor_campaign_audience_members','public.vendor_campaign_events']) s(t)
         where to_regclass(s.t) is not null)=3
            then 'PASS' else 'FAIL' end,
       'exactly the three campaign objects exist (ACCEPTED — supersedes the pre-campaign verifiers)'

union all
select 4, 'C04_no_extra_campaign_objects', '0',
       (select count(*)::text from unnest(array['public.vendor_campaign_audiences',
          'public.vendor_campaign_versions','public.vendor_campaign_deliveries',
          'public.vendor_campaign_dispatches','public.vendor_campaign_intents',
          'public.vendor_campaign_providers','public.vendor_engagement_events',
          'public.vendor_segment_memberships']) s(t) where to_regclass(s.t) is not null),
       case when (select count(*) from unnest(array['public.vendor_campaign_audiences',
          'public.vendor_campaign_versions','public.vendor_campaign_deliveries',
          'public.vendor_campaign_dispatches','public.vendor_campaign_intents',
          'public.vendor_campaign_providers','public.vendor_engagement_events',
          'public.vendor_segment_memberships']) s(t) where to_regclass(s.t) is not null)=0
            then 'PASS' else 'FAIL' end,
       'no second head/version table, no audience header, no delivery/dispatch/intent/provider/membership table'

union all
select 5, 'C05_rls_enabled_all_three', '3',
       (select count(*)::text from unnest(array['public.vendor_campaigns',
          'public.vendor_campaign_audience_members','public.vendor_campaign_events']) s(t)
         join pg_class c on c.oid = to_regclass(s.t) where c.relrowsecurity),
       case when (select count(*) from unnest(array['public.vendor_campaigns',
          'public.vendor_campaign_audience_members','public.vendor_campaign_events']) s(t)
         join pg_class c on c.oid = to_regclass(s.t) where c.relrowsecurity)=3
            then 'PASS' else 'FAIL' end,
       'row level security is enabled on every campaign table'

union all
select 6, 'C06_no_untrusted_policy', '0',
       (select count(*)::text from pg_policies p
         where p.schemaname='public'
           and p.tablename in ('vendor_campaigns','vendor_campaign_audience_members','vendor_campaign_events')
           and (p.roles::text[] && array['public','anon','authenticated'])),
       case when (select count(*) from pg_policies p
         where p.schemaname='public'
           and p.tablename in ('vendor_campaigns','vendor_campaign_audience_members','vendor_campaign_events')
           and (p.roles::text[] && array['public','anon','authenticated']))=0
            then 'PASS' else 'FAIL' end,
       'default-deny: no policy grants an untrusted role campaign access'

union all
select 7, 'C07_untrusted_roles_zero_privilege', '0',
       (select count(*)::text from unnest(array['public.vendor_campaigns',
            'public.vendor_campaign_audience_members','public.vendor_campaign_events']) s(t)
          cross join unnest(array['public','anon','authenticated']) r(role_name)
          cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
         where has_table_privilege(r.role_name, s.t, p.priv)),
       case when (select count(*) from unnest(array['public.vendor_campaigns',
            'public.vendor_campaign_audience_members','public.vendor_campaign_events']) s(t)
          cross join unnest(array['public','anon','authenticated']) r(role_name)
          cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
         where has_table_privilege(r.role_name, s.t, p.priv))=0
            then 'PASS' else 'FAIL' end,
       'public/anon/authenticated hold ZERO direct privilege on every campaign table'

union all
select 8, 'C08_service_role_minimum_privileges', '1',
       (case when has_table_privilege('service_role','public.vendor_campaigns','SELECT')
              and has_table_privilege('service_role','public.vendor_campaigns','INSERT')
              and has_table_privilege('service_role','public.vendor_campaigns','UPDATE')
              and has_table_privilege('service_role','public.vendor_campaign_audience_members','SELECT')
              and has_table_privilege('service_role','public.vendor_campaign_audience_members','INSERT')
              and has_table_privilege('service_role','public.vendor_campaign_events','SELECT')
              and has_table_privilege('service_role','public.vendor_campaign_events','INSERT')
             then 1 else 0 end)::text,
       case when has_table_privilege('service_role','public.vendor_campaigns','SELECT')
             and has_table_privilege('service_role','public.vendor_campaigns','INSERT')
             and has_table_privilege('service_role','public.vendor_campaigns','UPDATE')
             and has_table_privilege('service_role','public.vendor_campaign_audience_members','SELECT')
             and has_table_privilege('service_role','public.vendor_campaign_audience_members','INSERT')
             and has_table_privilege('service_role','public.vendor_campaign_events','SELECT')
             and has_table_privilege('service_role','public.vendor_campaign_events','INSERT')
            then 'PASS' else 'FAIL' end,
       'service_role holds exactly the intended minimum privileges'

union all
select 9, 'C09_no_delete_truncate_anywhere', '0',
       (select count(*)::text from unnest(array['public.vendor_campaigns',
            'public.vendor_campaign_audience_members','public.vendor_campaign_events']) s(t)
          cross join unnest(array['DELETE','TRUNCATE']) p(priv)
         where has_table_privilege('service_role', s.t, p.priv)),
       case when (select count(*) from unnest(array['public.vendor_campaigns',
            'public.vendor_campaign_audience_members','public.vendor_campaign_events']) s(t)
          cross join unnest(array['DELETE','TRUNCATE']) p(priv)
         where has_table_privilege('service_role', s.t, p.priv))=0
            then 'PASS' else 'FAIL' end,
       'hard delete is impossible at the privilege layer for every campaign table'

union all
select 10, 'C10_snapshot_and_events_not_updatable', '0',
       (select count(*)::text from unnest(array['public.vendor_campaign_audience_members',
            'public.vendor_campaign_events']) s(t)
         where has_table_privilege('service_role', s.t, 'UPDATE')),
       case when (select count(*) from unnest(array['public.vendor_campaign_audience_members',
            'public.vendor_campaign_events']) s(t)
         where has_table_privilege('service_role', s.t, 'UPDATE'))=0
            then 'PASS' else 'FAIL' end,
       'the frozen audience and the event log are INSERT-only (append-only)'

union all
select 11, 'C11_immutability_and_lifecycle_triggers', '4',
       (select count(*)::text from pg_trigger t where not t.tgisinternal
         and t.tgname in ('trg_vcam_immutable','trg_vce_immutable','trg_vcm_transition_guard','trg_vcm_no_delete')),
       case when (select count(*) from pg_trigger t where not t.tgisinternal
         and t.tgname in ('trg_vcam_immutable','trg_vce_immutable','trg_vcm_transition_guard','trg_vcm_no_delete'))=4
            then 'PASS' else 'FAIL' end,
       'audience/event immutability, lifecycle guard and no-delete triggers are present'

union all
select 12, 'C12_no_destination_or_secret_column', '0',
       (select count(*)::text from pg_attribute a
         where a.attrelid in (to_regclass('public.vendor_campaigns'),
                              to_regclass('public.vendor_campaign_audience_members'),
                              to_regclass('public.vendor_campaign_events'))
           and a.attnum > 0 and not a.attisdropped
           and (a.attname in ('phone','email','whatsapp_number','msisdn','destination','recipient_ref',
                              'to_address','provider_payload','access_token','api_key')
                or a.attname like '%password%' or a.attname like '%secret%')),
       case when (select count(*) from pg_attribute a
         where a.attrelid in (to_regclass('public.vendor_campaigns'),
                              to_regclass('public.vendor_campaign_audience_members'),
                              to_regclass('public.vendor_campaign_events'))
           and a.attnum > 0 and not a.attisdropped
           and (a.attname in ('phone','email','whatsapp_number','msisdn','destination','recipient_ref',
                              'to_address','provider_payload','access_token','api_key')
                or a.attname like '%password%' or a.attname like '%secret%'))=0
            then 'PASS' else 'FAIL' end,
       'no plaintext destination, provider payload or secret column exists anywhere in the foundation'

union all
select 13, 'C13_no_core_truth_or_frequency_column', '0',
       (select count(*)::text from pg_attribute a
         where a.attrelid in (to_regclass('public.vendor_campaigns'),
                              to_regclass('public.vendor_campaign_audience_members'))
           and a.attnum > 0 and not a.attisdropped
           and a.attname in ('is_active','verification_status','city','service_categories','areas_covered',
                             'package_id','credits','total_credits','remaining_credits','is_eligible',
                             'eligibility','frequency_cap','frequency_policy','send_status','delivery_status')),
       case when (select count(*) from pg_attribute a
         where a.attrelid in (to_regclass('public.vendor_campaigns'),
                              to_regclass('public.vendor_campaign_audience_members'))
           and a.attnum > 0 and not a.attisdropped
           and a.attname in ('is_active','verification_status','city','service_categories','areas_covered',
                             'package_id','credits','total_credits','remaining_credits','is_eligible',
                             'eligibility','frequency_cap','frequency_policy','send_status','delivery_status'))=0
            then 'PASS' else 'FAIL' end,
       'no copied Core truth, no frequency-policy claim and no execution/delivery state'

union all
select 14, 'C14_required_check_constraints', '8',
       (select count(*)::text from pg_constraint c
         where c.conrelid = to_regclass('public.vendor_campaigns') and c.contype='c'
           and c.conname = any (array['vcm_status_check','vcm_purpose_check','vcm_channel_check',
             'vcm_consent_scope_check','vcm_approved_consistency','vcm_prepared_evidence_complete',
             'vcm_marketing_requires_marketing_template','vcm_snapshot_fingerprint_shape'])),
       case when (select count(*) from pg_constraint c
         where c.conrelid = to_regclass('public.vendor_campaigns') and c.contype='c'
           and c.conname = any (array['vcm_status_check','vcm_purpose_check','vcm_channel_check',
             'vcm_consent_scope_check','vcm_approved_consistency','vcm_prepared_evidence_complete',
             'vcm_marketing_requires_marketing_template','vcm_snapshot_fingerprint_shape']))=8
            then 'PASS' else 'FAIL' end,
       'lifecycle, vocabulary, evidence-completeness and marketing-template checks are present'

union all
select 15, 'C15_snapshot_unique_identity', '2',
       (select count(*)::text from pg_constraint c
         where c.conrelid = to_regclass('public.vendor_campaign_audience_members')
           and c.contype='u' and c.conname = any (array['vcam_unique_member','vcam_unique_ordinal'])),
       case when (select count(*) from pg_constraint c
         where c.conrelid = to_regclass('public.vendor_campaign_audience_members')
           and c.contype='u' and c.conname = any (array['vcam_unique_member','vcam_unique_ordinal']))=2
            then 'PASS' else 'FAIL' end,
       'one vendor and one ordinal at most once per snapshot revision'

union all
select 16, 'C16_evidence_preserving_fks', '1',
       (case when (select count(*) from pg_constraint c
                    where c.conrelid = to_regclass('public.vendor_campaign_audience_members')
                      and c.contype='f' and c.confdeltype='r') >= 2
              and (select count(*) from pg_constraint c
                    where c.conrelid = to_regclass('public.vendor_campaigns')
                      and c.contype='f' and c.confrelid = to_regclass('public.profiles')
                      and c.confdeltype='n') = 6
             then 1 else 0 end)::text,
       case when (select count(*) from pg_constraint c
                   where c.conrelid = to_regclass('public.vendor_campaign_audience_members')
                     and c.contype='f' and c.confdeltype='r') >= 2
             and (select count(*) from pg_constraint c
                   where c.conrelid = to_regclass('public.vendor_campaigns')
                     and c.contype='f' and c.confrelid = to_regclass('public.profiles')
                     and c.confdeltype='n') = 6
            then 'PASS' else 'FAIL' end,
       'audience FKs RESTRICT (evidence preserved); all six actor FKs SET NULL, never cascade'

union all
select 17, 'C17_deterministic_indexes', '4',
       (select count(*)::text from pg_indexes i
         where i.schemaname='public'
           and i.indexname = any (array['uq_vendor_campaigns_live_name','ix_vendor_campaigns_status_updated',
             'ix_vcam_campaign_revision','ix_vce_campaign_occurred'])),
       case when (select count(*) from pg_indexes i
         where i.schemaname='public'
           and i.indexname = any (array['uq_vendor_campaigns_live_name','ix_vendor_campaigns_status_updated',
             'ix_vcam_campaign_revision','ix_vce_campaign_occurred']))=4
            then 'PASS' else 'FAIL' end,
       'live-name uniqueness plus bounded deterministic listing indexes'

union all
select 18, 'C18_rpcs_present', '2',
       (select count(*)::text from unnest(array[
          'public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)',
          'public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)']) s(f)
         where to_regprocedure(s.f) is not null),
       case when (select count(*) from unnest(array[
          'public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)',
          'public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)']) s(f)
         where to_regprocedure(s.f) is not null)=2
            then 'PASS' else 'FAIL' end,
       'the narrow prepare/freeze and approval RPCs exist'

union all
select 19, 'C19_rpc_execute_service_role_only', '0',
       (select count(*)::text from unnest(array[
            'public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)',
            'public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)']) s(f)
          cross join unnest(array['public','anon','authenticated']) r(role_name)
         where has_function_privilege(r.role_name, s.f, 'EXECUTE')),
       case when (select count(*) from unnest(array[
            'public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)',
            'public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)']) s(f)
          cross join unnest(array['public','anon','authenticated']) r(role_name)
         where has_function_privilege(r.role_name, s.f, 'EXECUTE'))=0
            then 'PASS' else 'FAIL' end,
       'no untrusted role may execute a campaign RPC'

union all
select 20, 'C20_rpcs_security_definer_fixed_search_path', '2',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname in ('qf_prepare_vendor_campaign_v1','qf_approve_vendor_campaign_v1')
           and p.prosecdef and array_to_string(coalesce(p.proconfig,'{}'::text[]), ',') like '%search_path%'),
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname in ('qf_prepare_vendor_campaign_v1','qf_approve_vendor_campaign_v1')
           and p.prosecdef and array_to_string(coalesce(p.proconfig,'{}'::text[]), ',') like '%search_path%')=2
            then 'PASS' else 'FAIL' end,
       'both RPCs are SECURITY DEFINER with a fixed search_path'

union all
select 21, 'C21_template_category_includes_marketing', '1',
       (case when (select pg_get_constraintdef(c.oid) from pg_constraint c
                    where c.conrelid = to_regclass('public.communication_templates')
                      and c.conname='communication_templates_category_check') like '%marketing%'
             then 1 else 0 end)::text,
       case when (select pg_get_constraintdef(c.oid) from pg_constraint c
                   where c.conrelid = to_regclass('public.communication_templates')
                     and c.conname='communication_templates_category_check') like '%marketing%'
            then 'PASS' else 'FAIL' end,
       'communication_templates.category now permits marketing (authentication/business preserved)'

union all
select 22, 'C22_template_category_preserves_existing', '1',
       (case when (select pg_get_constraintdef(c.oid) from pg_constraint c
                    where c.conrelid = to_regclass('public.communication_templates')
                      and c.conname='communication_templates_category_check')
                  like '%authentication%business%'
             then 1 else 0 end)::text,
       case when (select pg_get_constraintdef(c.oid) from pg_constraint c
                   where c.conrelid = to_regclass('public.communication_templates')
                     and c.conname='communication_templates_category_check')
                 like '%authentication%business%'
            then 'PASS' else 'FAIL' end,
       'the existing authentication and business values are preserved'

union all
select 23, 'C23_communication_intents_unchanged', '0',
       (select count(*)::text from pg_constraint c
         where c.conrelid = to_regclass('public.communication_intents')
           and c.conname='communication_intents_aggregate_type_check'
           and pg_get_constraintdef(c.oid) like '%campaign%'),
       case when (select count(*) from pg_constraint c
         where c.conrelid = to_regclass('public.communication_intents')
           and c.conname='communication_intents_aggregate_type_check'
           and pg_get_constraintdef(c.oid) like '%campaign%')=0
            then 'PASS' else 'FAIL' end,
       'aggregate_type is NOT widened to campaign in 30.4 (owner decision 4 — QF-MVP-30.5 owns it)'

union all
select 24, 'C24_no_campaign_intents_exist', '0',
       (select count(*)::text from public.communication_intents where aggregate_type ilike '%campaign%'),
       case when (select count(*) from public.communication_intents where aggregate_type ilike '%campaign%')=0
            then 'PASS' else 'FAIL' end,
       'no campaign communication intent exists'

union all
select 25, 'C25_no_provider_activation', '1',
       (case when (select count(*) from public.communication_provider_canary_destinations)=0
             then 1 else 0 end)::text,
       case when (select count(*) from public.communication_provider_canary_destinations)=0
            then 'PASS' else 'FAIL' end,
       'no provider canary destination was activated by this migration'

union all
select 26, 'C26_zero_campaign_rows_before_fixtures', '0',
       ((select count(*) from public.vendor_campaigns)
        + (select count(*) from public.vendor_campaign_audience_members)
        + (select count(*) from public.vendor_campaign_events))::text,
       case when ((select count(*) from public.vendor_campaigns)
        + (select count(*) from public.vendor_campaign_audience_members)
        + (select count(*) from public.vendor_campaign_events))=0
            then 'PASS' else 'FAIL' end,
       'the migration is schema-only — it creates no campaign, audience or event row'

union all
select 27, 'C27_no_core_financial_or_assignment_mutation', '1',
       (case when (select count(*) from public.vendor_credit_logs)=0
              and (select count(*) from public.lead_assignments)=0
              and (select count(*) from public.vendor_package_orders)=0
             then 1 else 0 end)::text,
       case when (select count(*) from public.vendor_credit_logs)=0
             and (select count(*) from public.lead_assignments)=0
             and (select count(*) from public.vendor_package_orders)=0
            then 'PASS' else 'FAIL' end,
       'no Core financial or assignment row was written (staging pre-fixture state)'

union all
select 28, 'C28_no_consent_or_suppression_mutation', '1',
       (case when (select count(*) from public.communication_consent_events)=0
              and (select count(*) from public.communication_suppressions)=0
             then 1 else 0 end)::text,
       case when (select count(*) from public.communication_consent_events)=0
             and (select count(*) from public.communication_suppressions)=0
            then 'PASS' else 'FAIL' end,
       'the migration granted no consent and removed no suppression'

union all
select 29, 'C29_segment_and_crm_foundation_intact', '7',
       (select count(*)::text from unnest(array['public.vendor_segments','public.vendor_crm_profiles',
          'public.vendor_contacts','public.vendor_tags','public.vendor_tag_assignments',
          'public.vendor_tasks','public.vendor_internal_notes']) s(t) where to_regclass(s.t) is not null),
       case when (select count(*) from unnest(array['public.vendor_segments','public.vendor_crm_profiles',
          'public.vendor_contacts','public.vendor_tags','public.vendor_tag_assignments',
          'public.vendor_tasks','public.vendor_internal_notes']) s(t) where to_regclass(s.t) is not null)=7
            then 'PASS' else 'FAIL' end,
       'the segment foundation and the six CRM tables remain intact'

union all
select 30, 'C30_public_projection_no_campaign_exposure', '0',
       (select count(*)::text from pg_attribute a
         where a.attrelid = to_regclass('public.vendor_public_v') and a.attnum > 0 and not a.attisdropped
           and (a.attname like '%campaign%' or a.attname like '%audience%'
             or a.attname like '%segment%' or a.attname like '%consent%')),
       case when (select count(*) from pg_attribute a
         where a.attrelid = to_regclass('public.vendor_public_v') and a.attnum > 0 and not a.attisdropped
           and (a.attname like '%campaign%' or a.attname like '%audience%'
             or a.attname like '%segment%' or a.attname like '%consent%'))=0
            then 'PASS' else 'FAIL' end,
       'the public projection exposes no campaign, audience, segment or consent field'

union all
select 31, 'C31_core_authority_intact', '1',
       (case when to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is not null
              and to_regclass('public.credit_ledger_reconciliation_exceptions') is not null
             then 1 else 0 end)::text,
       case when to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is not null
             and to_regclass('public.credit_ledger_reconciliation_exceptions') is not null
            then 'PASS' else 'FAIL' end,
       'canonical assignment authority and the 20.4C register are untouched'

union all
select 32, 'C32_no_006_assumption', '1', '1', 'PASS',
       'audit_logs/admin_notifications are NOT assumed by 30.4 — provenance lives on vendor_campaigns and vendor_campaign_events (informational)'

order by seq;
