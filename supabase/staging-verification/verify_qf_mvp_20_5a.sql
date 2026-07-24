-- ============================================================================
-- QuickFurno — QF-MVP-20.5A — POST-APPLICATION VERIFICATION (SELECT-ONLY)
--
-- SCOPE
--   Verifies the expected database state AFTER applying:
--     20260723001000_qf_mvp_profiles_privilege_admin_role_cleanup.sql
--   on top of the already-applied, immutable A/A2/B1/G/B2/C/D/E + 20.4C register.
--
-- SELECT-ONLY BY CONSTRUCTION
--   One read-only statement: a chain of SELECT ... UNION ALL branches. No
--   INSERT/UPDATE/DELETE/MERGE/TRUNCATE/CREATE/ALTER/DROP/GRANT/REVOKE/CALL/DO.
--   Every check is a catalog/privilege fact; it mutates nothing.
--
-- LOCKED POLICIES CARRIED FORWARD
--   * QF-MVP-20.3B1R2 — no lexical assertion over pg_get_functiondef()/prosrc.
--   * QF-MVP-20.3B2R1 — every catalog `name` value is compared as text.
--   * QF-MVP-20.3CVR1 — any set comparison normalises BOTH sides.
--
-- OUTPUT: seq | check_name | expected | actual | status | details
-- ============================================================================

select 1 as seq, 'Y01_migration_history_once' as check_name, '1' as expected,
       (select count(*)::text from supabase_migrations.schema_migrations where version = '20260723001000') as actual,
       case when (select count(*) from supabase_migrations.schema_migrations where version = '20260723001000') = 1
            then 'PASS' else 'FAIL' end as status,
       '20.5A recorded exactly once' as details

union all
select 2, 'Y02_profiles_table_present', '1',
       (select count(*)::text from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
         where n.nspname::text='public' and c.relname::text='profiles' and c.relkind='r'),
       case when (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
                   where n.nspname::text='public' and c.relname::text='profiles' and c.relkind='r')=1
            then 'PASS' else 'FAIL' end,
       'public.profiles exists'

union all
select 3, 'Y03_rls_enabled', '1',
       (select case when c.relrowsecurity then '1' else '0' end from pg_catalog.pg_class c
         where c.oid = to_regclass('public.profiles')),
       case when (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = to_regclass('public.profiles'))
            then 'PASS' else 'FAIL' end,
       'RLS is enabled on public.profiles'

union all
select 4, 'Y04_authenticated_has_select', '1',
       (select case when has_table_privilege('authenticated', to_regclass('public.profiles'), 'SELECT') then '1' else '0' end),
       case when has_table_privilege('authenticated', to_regclass('public.profiles'), 'SELECT') then 'PASS' else 'FAIL' end,
       'authenticated holds SELECT (own row via the "profiles self read" policy)'

union all
select 5, 'Y05_authenticated_no_write_or_ddl', '0',
       (select count(*)::text from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
         where has_table_privilege('authenticated', to_regclass('public.profiles'), p.priv)),
       case when (select count(*) from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
                   where has_table_privilege('authenticated', to_regclass('public.profiles'), p.priv))=0
            then 'PASS' else 'FAIL' end,
       'authenticated holds NO INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on profiles'

union all
select 6, 'Y06_role_escalation_prevented_no_update', '1',
       (select case when not has_table_privilege('authenticated', to_regclass('public.profiles'), 'UPDATE') then '1' else '0' end),
       case when not has_table_privilege('authenticated', to_regclass('public.profiles'), 'UPDATE') then 'PASS' else 'FAIL' end,
       'authenticated cannot UPDATE profiles, so it cannot set role=admin on its own row (escalation closed at the grant layer)'

union all
select 7, 'Y07_anon_zero_privilege', '0',
       (select count(*)::text from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
         where has_table_privilege('anon', to_regclass('public.profiles'), p.priv)),
       case when (select count(*) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
                   where has_table_privilege('anon', to_regclass('public.profiles'), p.priv))=0
            then 'PASS' else 'FAIL' end,
       'anon holds ZERO privilege on profiles'

union all
select 8, 'Y08_public_zero_privilege', '0',
       (select count(*)::text from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
         where has_table_privilege('public', to_regclass('public.profiles'), p.priv)),
       case when (select count(*) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
                   where has_table_privilege('public', to_regclass('public.profiles'), p.priv))=0
            then 'PASS' else 'FAIL' end,
       'PUBLIC holds ZERO privilege on profiles'

union all
select 9, 'Y09_own_row_select_policy_present', '1',
       (select count(*)::text from pg_catalog.pg_policy pol
         where pol.polrelid=to_regclass('public.profiles') and pol.polname::text='profiles self read' and pol.polcmd='r'),
       case when (select count(*) from pg_catalog.pg_policy pol
                   where pol.polrelid=to_regclass('public.profiles') and pol.polname::text='profiles self read' and pol.polcmd='r')=1
            then 'PASS' else 'FAIL' end,
       'the own-row SELECT policy "profiles self read" is present'

union all
select 10, 'Y10_own_row_update_and_admin_policies_present', '2',
       (select count(*)::text from pg_catalog.pg_policy pol
         where pol.polrelid=to_regclass('public.profiles') and pol.polname::text in ('profiles self update','profiles admin all')),
       case when (select count(*) from pg_catalog.pg_policy pol
                   where pol.polrelid=to_regclass('public.profiles') and pol.polname::text in ('profiles self update','profiles admin all'))=2
            then 'PASS' else 'FAIL' end,
       'the own-row UPDATE policy and admin policy are preserved (inert for authenticated without an UPDATE grant)'

union all
select 11, 'Y11_no_profiles_policy_targets_anon', '0',
       (select count(*)::text from pg_catalog.pg_policy pol
         where pol.polrelid=to_regclass('public.profiles')
           and exists (select 1 from unnest(coalesce(pol.polroles,'{}')) rid where pg_catalog.pg_get_userbyid(rid)::text='anon')),
       case when (select count(*) from pg_catalog.pg_policy pol
                   where pol.polrelid=to_regclass('public.profiles')
                     and exists (select 1 from unnest(coalesce(pol.polroles,'{}')) rid where pg_catalog.pg_get_userbyid(rid)::text='anon'))=0
            then 'PASS' else 'FAIL' end,
       'no profiles policy grants anon access'

union all
select 12, 'Y12_admin_role_column_absent', '0',
       (select count(*)::text from pg_catalog.pg_attribute
         where attrelid=to_regclass('public.profiles') and not attisdropped and attname::text='admin_role'),
       case when (select count(*) from pg_catalog.pg_attribute
                   where attrelid=to_regclass('public.profiles') and not attisdropped and attname::text='admin_role')=0
            then 'PASS' else 'FAIL' end,
       'the drifted profiles.admin_role column is gone'

union all
select 13, 'Y13_role_authority_column_present', '1',
       (select count(*)::text from pg_catalog.pg_attribute
         where attrelid=to_regclass('public.profiles') and not attisdropped and attname::text='role'),
       case when (select count(*) from pg_catalog.pg_attribute
                   where attrelid=to_regclass('public.profiles') and not attisdropped and attname::text='role')=1
            then 'PASS' else 'FAIL' end,
       'the canonical profiles.role authority column is preserved'

union all
select 14, 'Y14_is_admin_authority_fn_present', '1',
       (select case when to_regprocedure('public.is_admin()') is not null then '1' else '0' end),
       case when to_regprocedure('public.is_admin()') is not null then 'PASS' else 'FAIL' end,
       'the public.is_admin() authority function (reads profiles.role) is intact'

union all
select 15, 'Y15_d_auth_trigger_and_fn_preserved', '1',
       (select case when exists (select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
                                  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
                                 where not t.tgisinternal and t.tgname::text='on_auth_user_created'
                                   and n.nspname::text='auth' and c.relname::text='users')
                     and to_regprocedure('public.handle_new_user()') is not null
                    then '1' else '0' end),
       case when exists (select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
                          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
                         where not t.tgisinternal and t.tgname::text='on_auth_user_created'
                           and n.nspname::text='auth' and c.relname::text='users')
             and to_regprocedure('public.handle_new_user()') is not null
            then 'PASS' else 'FAIL' end,
       'the Migration D auth trigger + handle_new_user() are preserved (trusted-marker contract; body remains the 20.3D verifier''s scope)'

union all
select 16, 'Y16_service_role_bootstrap_authority', '1',
       (select case when has_table_privilege('service_role', to_regclass('public.profiles'),'SELECT')
                     and has_table_privilege('service_role', to_regclass('public.profiles'),'INSERT')
                     and has_table_privilege('service_role', to_regclass('public.profiles'),'UPDATE')
                    then '1' else '0' end),
       case when has_table_privilege('service_role', to_regclass('public.profiles'),'SELECT')
             and has_table_privilege('service_role', to_regclass('public.profiles'),'INSERT')
             and has_table_privilege('service_role', to_regclass('public.profiles'),'UPDATE')
            then 'PASS' else 'FAIL' end,
       'service_role keeps SELECT+INSERT+UPDATE so the explicit admin bootstrap still works'

union all
select 17, 'Y17_register_20_4c_present_and_empty', '1',
       (select case when to_regclass('public.credit_ledger_reconciliation_exceptions') is not null
                     and (select count(*) from public.credit_ledger_reconciliation_exceptions)=0
                    then '1' else '0' end),
       case when to_regclass('public.credit_ledger_reconciliation_exceptions') is not null
             and (select count(*) from public.credit_ledger_reconciliation_exceptions)=0
            then 'PASS' else 'FAIL' end,
       'the 20.4C exception register is intact and still empty (no historical exceptions inserted)'

union all
select 18, 'Y18_b1_authority_intact', '1',
       (select case when to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is not null then '1' else '0' end),
       case when to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is not null
            then 'PASS' else 'FAIL' end,
       'the canonical B1 assignment authority is intact'

union all
select 19, 'Y19_b2_triggers_intact', '4',
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
select 20, 'Y20_c_projection_intact', '1',
       (select case when exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
                                  where n.nspname='public' and c.relname='vendor_public_v' and c.relkind='v') then '1' else '0' end),
       case when exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
                          where n.nspname='public' and c.relname='vendor_public_v' and c.relkind='v') then 'PASS' else 'FAIL' end,
       'the Migration C public projection is intact'

union all
select 21, 'Y21_e_posture_intact', '0',
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
       'Migration E posture intact: the six legacy assignment RPCs remain non-executable by PUBLIC/anon/authenticated'

union all
select 22, 'Y22_owner_binding_still_deferred', '0',
       (select count(*)::text from pg_catalog.pg_attribute
         where attrelid='public.leads'::regclass and not attisdropped
           and attname::text = any(array['client_account_id','user_id','created_by']::text[])),
       case when (select count(*) from pg_catalog.pg_attribute
                   where attrelid='public.leads'::regclass and not attisdropped
                     and attname::text = any(array['client_account_id','user_id','created_by']::text[]))=0
            then 'PASS' else 'FAIL' end,
       'R1_BLOCKED_PENDING_OWNER_BINDING remains unresolved; 20.5A implements no owner binding'

union all
select 23, 'Y23_marketplace_core_tables_present', '4',
       (select count(*)::text from unnest(array['public.vendors','public.vendor_packages','public.lead_assignments','public.vendor_credit_logs']) s(t)
         where to_regclass(s.t) is not null),
       case when (select count(*) from unnest(array['public.vendors','public.vendor_packages','public.lead_assignments','public.vendor_credit_logs']) s(t)
                   where to_regclass(s.t) is not null)=4
            then 'PASS' else 'FAIL' end,
       'vendors / vendor_packages / lead_assignments / vendor_credit_logs are untouched by this ACL/cleanup migration'

order by seq;
