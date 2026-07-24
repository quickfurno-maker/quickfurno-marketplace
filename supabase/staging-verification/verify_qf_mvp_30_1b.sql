-- ============================================================================
-- QuickFurno — QF-MVP-30.1B — POST-APPLICATION VERIFICATION (SELECT-ONLY)
--
-- Verifies the Vendor CRM foundation after applying:
--   20260723001100_qf_mvp_vendor_crm_foundation.sql
-- on top of the applied Marketplace Engine (A/A2/B1/G/B2/C/D/E/20.4C/20.5A).
--
-- SELECT-ONLY BY CONSTRUCTION: one read-only SELECT ... UNION ALL statement.
-- No INSERT/UPDATE/DELETE/MERGE/TRUNCATE/CREATE/ALTER/DROP/GRANT/REVOKE/CALL/DO;
-- invokes no mutating function. Every check is a catalog/privilege fact.
--
-- LOCKED POLICIES: no lexical assertion over pg_get_functiondef()/prosrc; catalog
-- name values compared as text; set comparisons normalise both sides.
-- OUTPUT: seq | check_name | expected | actual | status | details
-- ============================================================================

select 1 as seq, 'W01_migration_history_once' as check_name, '1' as expected,
       (select count(*)::text from supabase_migrations.schema_migrations where version='20260723001100') as actual,
       case when (select count(*) from supabase_migrations.schema_migrations where version='20260723001100')=1
            then 'PASS' else 'FAIL' end as status,
       '30.1B recorded exactly once' as details

union all
select 2, 'W02_six_foundation_tables_present', '6',
       (select count(*)::text from unnest(array['public.vendor_crm_profiles','public.vendor_contacts',
          'public.vendor_tags','public.vendor_tag_assignments','public.vendor_tasks','public.vendor_internal_notes']) s(t)
         where to_regclass(s.t) is not null),
       case when (select count(*) from unnest(array['public.vendor_crm_profiles','public.vendor_contacts',
          'public.vendor_tags','public.vendor_tag_assignments','public.vendor_tasks','public.vendor_internal_notes']) s(t)
         where to_regclass(s.t) is not null)=6 then 'PASS' else 'FAIL' end,
       'all six CRM foundation tables exist'

union all
select 3, 'W03_no_rival_vendor_notes', '0',
       (select case when to_regclass('public.vendor_notes') is null then '0' else '1' end),
       case when to_regclass('public.vendor_notes') is null then 'PASS' else 'FAIL' end,
       'vendor_internal_notes is the sole notes authority (no rival vendor_notes)'

union all
select 4, 'W04_rls_enabled_all_six', '6',
       (select count(*)::text from unnest(array['public.vendor_crm_profiles','public.vendor_contacts',
          'public.vendor_tags','public.vendor_tag_assignments','public.vendor_tasks','public.vendor_internal_notes']) s(t)
         join pg_catalog.pg_class c on c.oid=to_regclass(s.t) where c.relrowsecurity),
       case when (select count(*) from unnest(array['public.vendor_crm_profiles','public.vendor_contacts',
          'public.vendor_tags','public.vendor_tag_assignments','public.vendor_tasks','public.vendor_internal_notes']) s(t)
         join pg_catalog.pg_class c on c.oid=to_regclass(s.t) where c.relrowsecurity)=6 then 'PASS' else 'FAIL' end,
       'RLS enabled on all six foundation tables'

union all
select 5, 'W05_untrusted_roles_zero_privilege', '0',
       (select count(*)::text from unnest(array['public.vendor_crm_profiles','public.vendor_contacts',
          'public.vendor_tags','public.vendor_tag_assignments','public.vendor_tasks','public.vendor_internal_notes']) s(t)
          cross join unnest(array['public','anon','authenticated']) r(role_name)
          cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
         where has_table_privilege(r.role_name, to_regclass(s.t), p.priv)),
       case when (select count(*) from unnest(array['public.vendor_crm_profiles','public.vendor_contacts',
          'public.vendor_tags','public.vendor_tag_assignments','public.vendor_tasks','public.vendor_internal_notes']) s(t)
          cross join unnest(array['public','anon','authenticated']) r(role_name)
          cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
         where has_table_privilege(r.role_name, to_regclass(s.t), p.priv))=0 then 'PASS' else 'FAIL' end,
       'PUBLIC/anon/authenticated hold ZERO privilege on every CRM foundation table (server-only)'

union all
select 6, 'W06_notes_service_role_select_insert_only', '1',
       (select case when has_table_privilege('service_role', to_regclass('public.vendor_internal_notes'),'SELECT')
                     and has_table_privilege('service_role', to_regclass('public.vendor_internal_notes'),'INSERT')
                     and not has_table_privilege('service_role', to_regclass('public.vendor_internal_notes'),'UPDATE')
                     and not has_table_privilege('service_role', to_regclass('public.vendor_internal_notes'),'DELETE')
                     and not has_table_privilege('service_role', to_regclass('public.vendor_internal_notes'),'TRUNCATE')
                    then '1' else '0' end),
       case when has_table_privilege('service_role', to_regclass('public.vendor_internal_notes'),'SELECT')
             and has_table_privilege('service_role', to_regclass('public.vendor_internal_notes'),'INSERT')
             and not has_table_privilege('service_role', to_regclass('public.vendor_internal_notes'),'UPDATE')
             and not has_table_privilege('service_role', to_regclass('public.vendor_internal_notes'),'DELETE')
             and not has_table_privilege('service_role', to_regclass('public.vendor_internal_notes'),'TRUNCATE')
            then 'PASS' else 'FAIL' end,
       'notes authority: service_role SELECT+INSERT only (append-only)'

union all
select 7, 'W07_lifecycle_service_role_siu_no_delete', '5',
       (select count(*)::text from unnest(array['public.vendor_crm_profiles','public.vendor_contacts',
          'public.vendor_tags','public.vendor_tag_assignments','public.vendor_tasks']) s(t)
         where has_table_privilege('service_role', to_regclass(s.t),'SELECT')
           and has_table_privilege('service_role', to_regclass(s.t),'INSERT')
           and has_table_privilege('service_role', to_regclass(s.t),'UPDATE')
           and not has_table_privilege('service_role', to_regclass(s.t),'DELETE')
           and not has_table_privilege('service_role', to_regclass(s.t),'TRUNCATE')),
       case when (select count(*) from unnest(array['public.vendor_crm_profiles','public.vendor_contacts',
          'public.vendor_tags','public.vendor_tag_assignments','public.vendor_tasks']) s(t)
         where has_table_privilege('service_role', to_regclass(s.t),'SELECT')
           and has_table_privilege('service_role', to_regclass(s.t),'INSERT')
           and has_table_privilege('service_role', to_regclass(s.t),'UPDATE')
           and not has_table_privilege('service_role', to_regclass(s.t),'DELETE')
           and not has_table_privilege('service_role', to_regclass(s.t),'TRUNCATE'))=5 then 'PASS' else 'FAIL' end,
       'lifecycle tables: service_role SELECT+INSERT+UPDATE, no DELETE/TRUNCATE'

union all
select 8, 'W08_no_app_role_delete_truncate', '0',
       (select count(*)::text from unnest(array['public.vendor_crm_profiles','public.vendor_contacts',
          'public.vendor_tags','public.vendor_tag_assignments','public.vendor_tasks','public.vendor_internal_notes']) s(t)
          cross join unnest(array['public','anon','authenticated','service_role']) r(role_name)
          cross join unnest(array['DELETE','TRUNCATE']) p(priv)
         where has_table_privilege(r.role_name, to_regclass(s.t), p.priv)),
       case when (select count(*) from unnest(array['public.vendor_crm_profiles','public.vendor_contacts',
          'public.vendor_tags','public.vendor_tag_assignments','public.vendor_tasks','public.vendor_internal_notes']) s(t)
          cross join unnest(array['public','anon','authenticated','service_role']) r(role_name)
          cross join unnest(array['DELETE','TRUNCATE']) p(priv)
         where has_table_privilege(r.role_name, to_regclass(s.t), p.priv))=0 then 'PASS' else 'FAIL' end,
       'no application role holds DELETE/TRUNCATE on any CRM foundation table'

union all
select 9, 'W09_notes_append_only_triggers', '2',
       (select count(*)::text from pg_catalog.pg_trigger t
         where t.tgrelid=to_regclass('public.vendor_internal_notes') and not t.tgisinternal
           and t.tgname::text in ('trg_vin_immutable','trg_vin_no_truncate')),
       case when (select count(*) from pg_catalog.pg_trigger t
         where t.tgrelid=to_regclass('public.vendor_internal_notes') and not t.tgisinternal
           and t.tgname::text in ('trg_vin_immutable','trg_vin_no_truncate'))=2 then 'PASS' else 'FAIL' end,
       'vendor_internal_notes carries BEFORE UPDATE|DELETE + BEFORE TRUNCATE immutability triggers'

union all
select 10, 'W10_crm_vendor_fks_restrict', '0',
       (select count(*)::text from pg_catalog.pg_constraint con
         where con.contype='f' and con.confrelid=to_regclass('public.vendors')
           and con.conrelid in (to_regclass('public.vendor_crm_profiles'), to_regclass('public.vendor_contacts'),
             to_regclass('public.vendor_tag_assignments'), to_regclass('public.vendor_tasks'), to_regclass('public.vendor_internal_notes'))
           and con.confdeltype not in ('r','a')),
       case when (select count(*) from pg_catalog.pg_constraint con
         where con.contype='f' and con.confrelid=to_regclass('public.vendors')
           and con.conrelid in (to_regclass('public.vendor_crm_profiles'), to_regclass('public.vendor_contacts'),
             to_regclass('public.vendor_tag_assignments'), to_regclass('public.vendor_tasks'), to_regclass('public.vendor_internal_notes'))
           and con.confdeltype not in ('r','a'))=0 then 'PASS' else 'FAIL' end,
       'every CRM->vendors FK is ON DELETE RESTRICT/NO ACTION (history-preserving)'

union all
select 11, 'W11_profile_one_per_vendor', '1',
       (select case when exists (select 1 from pg_catalog.pg_constraint con
                                  where con.conrelid=to_regclass('public.vendor_crm_profiles') and con.contype='p'
                                    and (select array_agg(att.attname::text order by att.attname::text)
                                           from unnest(con.conkey) k join pg_attribute att
                                             on att.attrelid=con.conrelid and att.attnum=k) = array['vendor_id'])
                    then '1' else '0' end),
       case when exists (select 1 from pg_catalog.pg_constraint con
                          where con.conrelid=to_regclass('public.vendor_crm_profiles') and con.contype='p'
                            and (select array_agg(att.attname::text order by att.attname::text)
                                   from unnest(con.conkey) k join pg_attribute att
                                     on att.attrelid=con.conrelid and att.attnum=k) = array['vendor_id'])
            then 'PASS' else 'FAIL' end,
       'vendor_crm_profiles PK is vendor_id (one profile per vendor)'

union all
select 12, 'W12_tag_normalized_unique', '1',
       (select count(*)::text from pg_catalog.pg_constraint con
         where con.conrelid=to_regclass('public.vendor_tags') and con.contype='u' and con.conname::text='vtg_normalized_unique'),
       case when (select count(*) from pg_catalog.pg_constraint con
         where con.conrelid=to_regclass('public.vendor_tags') and con.contype='u' and con.conname::text='vtg_normalized_unique')=1
            then 'PASS' else 'FAIL' end,
       'vendor_tags.normalized_name is UNIQUE'

union all
select 13, 'W13_active_tag_assignment_unique', '1',
       (select count(*)::text from pg_catalog.pg_class where relname='uq_vendor_tag_active' and relkind='i'),
       case when (select count(*) from pg_catalog.pg_class where relname='uq_vendor_tag_active' and relkind='i')=1
            then 'PASS' else 'FAIL' end,
       'one active tag assignment per (vendor,tag) via partial unique index'

union all
select 14, 'W14_active_primary_contact_unique', '1',
       (select count(*)::text from pg_catalog.pg_class where relname='uq_vendor_contacts_active_primary' and relkind='i'),
       case when (select count(*) from pg_catalog.pg_class where relname='uq_vendor_contacts_active_primary' and relkind='i')=1
            then 'PASS' else 'FAIL' end,
       'one active primary contact per vendor via partial unique index'

union all
select 15, 'W15_task_idempotency_unique', '1',
       (select count(*)::text from pg_catalog.pg_class where relname='uq_vendor_tasks_idempotency' and relkind='i'),
       case when (select count(*) from pg_catalog.pg_class where relname='uq_vendor_tasks_idempotency' and relkind='i')=1
            then 'PASS' else 'FAIL' end,
       'vendor_tasks idempotency_key partial unique index present'

union all
select 16, 'W16_task_type_status_checks', '4',
       (select count(*)::text from pg_catalog.pg_constraint con
         where con.conrelid=to_regclass('public.vendor_tasks') and con.contype='c'
           and con.conname::text in ('vtk_type_check','vtk_priority_check','vtk_status_check','vtk_source_check')),
       case when (select count(*) from pg_catalog.pg_constraint con
         where con.conrelid=to_regclass('public.vendor_tasks') and con.contype='c'
           and con.conname::text in ('vtk_type_check','vtk_priority_check','vtk_status_check','vtk_source_check'))=4
            then 'PASS' else 'FAIL' end,
       'vendor_tasks type/priority/status/source CHECK constraints present'

union all
select 17, 'W17_no_core_truth_duplicate_columns', '0',
       (select count(*)::text from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relname in ('vendor_crm_profiles','vendor_contacts','vendor_tags','vendor_tag_assignments','vendor_tasks','vendor_internal_notes')
           and a.attnum>0 and not a.attisdropped
           and a.attname::text = any(array['is_verified','verification_status','verified','is_enabled','city','service_area','service_areas','areas_covered','service_categories','categories','package','package_name','package_status','package_expires_at','plan','credits','total_credits','remaining_credits','credit_balance','eligibility','is_eligible','assignment_eligibility','consent','consent_status','is_suppressed','suppression','suppressed','communication_authorization']::text[])),
       case when (select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relname in ('vendor_crm_profiles','vendor_contacts','vendor_tags','vendor_tag_assignments','vendor_tasks','vendor_internal_notes')
           and a.attnum>0 and not a.attisdropped
           and a.attname::text = any(array['is_verified','verification_status','verified','is_enabled','city','service_area','service_areas','areas_covered','service_categories','categories','package','package_name','package_status','package_expires_at','plan','credits','total_credits','remaining_credits','credit_balance','eligibility','is_eligible','assignment_eligibility','consent','consent_status','is_suppressed','suppression','suppressed','communication_authorization']::text[]))=0
            then 'PASS' else 'FAIL' end,
       'no CRM foundation table duplicates an authoritative Core-truth column'

union all
select 18, 'W18_no_segment_or_campaign_tables', '0',
       (select count(*)::text from unnest(array['public.vendor_segments','public.vendor_campaigns',
          'public.vendor_campaign_audiences','public.vendor_campaign_events','public.vendor_engagement_events']) s(t)
         where to_regclass(s.t) is not null),
       case when (select count(*) from unnest(array['public.vendor_segments','public.vendor_campaigns',
          'public.vendor_campaign_audiences','public.vendor_campaign_events','public.vendor_engagement_events']) s(t)
         where to_regclass(s.t) is not null)=0 then 'PASS' else 'FAIL' end,
       'no segment/campaign tables (out of foundation scope)'

union all
select 19, 'W19_vendor_public_v_present_no_crm_cols', '1',
       (select case when exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                                  where n.nspname='public' and c.relname='vendor_public_v' and c.relkind='v')
                     and not exists (select 1 from information_schema.columns
                                      where table_schema='public' and table_name='vendor_public_v'
                                        and column_name = any(array['onboarding_stage','relationship_status','account_manager_profile_id','campaign_notes','capability_notes']::text[]))
                    then '1' else '0' end),
       case when exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                          where n.nspname='public' and c.relname='vendor_public_v' and c.relkind='v')
             and not exists (select 1 from information_schema.columns
                              where table_schema='public' and table_name='vendor_public_v'
                                and column_name = any(array['onboarding_stage','relationship_status','account_manager_profile_id','campaign_notes','capability_notes']::text[]))
            then 'PASS' else 'FAIL' end,
       'vendor_public_v is intact and exposes no CRM columns'

union all
select 20, 'W20_marketplace_authority_intact', '1',
       (select case when to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is not null
                     and to_regclass('public.credit_ledger_reconciliation_exceptions') is not null
                    then '1' else '0' end),
       case when to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is not null
             and to_regclass('public.credit_ledger_reconciliation_exceptions') is not null
            then 'PASS' else 'FAIL' end,
       'canonical assignment authority + 20.4C register intact'

union all
select 21, 'W21_b2_triggers_intact', '4',
       (select count(*)::text from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
         where not t.tgisinternal and n.nspname='public'
           and t.tgname in ('trg_lead_assignments_active_cap','trg_lead_assignment_events_lifetime_cap',
                            'trg_lead_assignment_events_immutable','trg_lead_assignment_events_no_truncate')),
       case when (select count(*) from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
         where not t.tgisinternal and n.nspname='public'
           and t.tgname in ('trg_lead_assignments_active_cap','trg_lead_assignment_events_lifetime_cap',
                            'trg_lead_assignment_events_immutable','trg_lead_assignment_events_no_truncate'))=4
            then 'PASS' else 'FAIL' end,
       'the four B2 enforcement triggers are intact'

union all
select 22, 'W22_profiles_admin_role_absent_and_siu', '1',
       (select case when not exists (select 1 from pg_attribute where attrelid=to_regclass('public.profiles') and not attisdropped and attname::text='admin_role')
                     and has_table_privilege('authenticated', to_regclass('public.profiles'),'SELECT')
                     and not has_table_privilege('authenticated', to_regclass('public.profiles'),'UPDATE')
                    then '1' else '0' end),
       case when not exists (select 1 from pg_attribute where attrelid=to_regclass('public.profiles') and not attisdropped and attname::text='admin_role')
             and has_table_privilege('authenticated', to_regclass('public.profiles'),'SELECT')
             and not has_table_privilege('authenticated', to_regclass('public.profiles'),'UPDATE')
            then 'PASS' else 'FAIL' end,
       '20.5A posture preserved: profiles.admin_role absent, authenticated SELECT-only'

union all
select 23, 'W23_e_posture_intact', '0',
       (select count(*)::text from unnest(array[
          'public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)',
          'public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)',
          'public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])',
          'public.assign_lead_to_preferred_vendor(uuid, uuid)',
          'public.assign_lead_to_vendors(uuid, uuid[], boolean, text)',
          'public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)']) s(sig)
          cross join unnest(array['public','anon','authenticated']) r(role_name)
         where has_function_privilege(r.role_name, to_regprocedure(s.sig), 'EXECUTE')),
       case when (select count(*) from unnest(array[
          'public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)',
          'public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)',
          'public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])',
          'public.assign_lead_to_preferred_vendor(uuid, uuid)',
          'public.assign_lead_to_vendors(uuid, uuid[], boolean, text)',
          'public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)']) s(sig)
          cross join unnest(array['public','anon','authenticated']) r(role_name)
         where has_function_privilege(r.role_name, to_regprocedure(s.sig), 'EXECUTE'))=0
            then 'PASS' else 'FAIL' end,
       'Migration E posture intact: six legacy RPCs non-executable by untrusted roles'

union all
select 24, 'W24_owner_binding_still_deferred', '0',
       (select count(*)::text from pg_catalog.pg_attribute
         where attrelid='public.leads'::regclass and not attisdropped
           and attname::text = any(array['client_account_id','user_id','created_by']::text[])),
       case when (select count(*) from pg_catalog.pg_attribute
                   where attrelid='public.leads'::regclass and not attisdropped
                     and attname::text = any(array['client_account_id','user_id','created_by']::text[]))=0
            then 'PASS' else 'FAIL' end,
       'owner binding remains deferred (no owner-binding columns on leads)'

order by seq;
