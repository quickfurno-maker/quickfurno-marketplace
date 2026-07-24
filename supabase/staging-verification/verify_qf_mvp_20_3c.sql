-- ============================================================================
-- QuickFurno — QF-MVP-20.3C — POST-APPLICATION VERIFICATION (SELECT-ONLY)
--
-- SCOPE
--   Verifies the expected database state AFTER applying:
--     20260723000600_qf_mvp_public_projection_privilege_hardening.sql   (C)
--   on top of the already-applied, immutable A / A2 / B1 / G / B2.
--
-- SELECT-ONLY BY CONSTRUCTION
--   One read-only statement: a chain of SELECT ... UNION ALL branches. No
--   INSERT/UPDATE/DELETE/MERGE/TRUNCATE/CREATE/ALTER/DROP/GRANT/REVOKE/CALL/DO/
--   SET. Every acceptance row produces PASS/FAIL without executing any DML, so
--   the privilege posture is proved STRUCTURALLY from catalog facts.
--
-- LOCKED POLICY (QF-MVP-20.3B1R2 / B2R1)
--   No lexical assertion over pg_get_functiondef()/prosrc/routine_definition.
--   Every catalog `name` array is cast to text (attname::text = array[...]::text[])
--   so the query itself is runtime type-safe (the name[] = text[] defect).
--
-- LOCKED POLICY (QF-MVP-20.3CVR1) — SYMMETRIC SET NORMALIZATION
--   A column-name SET comparison must NEVER compare a DB-sorted aggregate against
--   a raw hand-ordered ARRAY literal: the expected literal's typed order then
--   silently becomes part of the assertion, and a transposed pair yields a FALSE
--   NEGATIVE (that is exactly how C03 failed after Migration C applied correctly).
--   BOTH sides must be aggregated by PostgreSQL under the SAME `order by`, so the
--   comparison is over sets and is independent of how the literal was typed.
--   Membership tests (`attname::text = any(array[...])`) are inherently
--   order-insensitive and are unaffected.
--
-- VIEW SECURITY MODEL
--   vendor_public_v is a deliberate OWNER-RIGHTS projection (security_invoker
--   OFF). A Supabase security_definer_view advisor notice on it is EXPECTED and
--   ACCEPTED: its safety is the explicit column allowlist + row filter + the full
--   base-table revocation from anon, not the invoker mode. Row 6 asserts
--   security_invoker is NOT enabled.
--
-- OUTPUT: seq | check_name | expected | actual | status | details
-- ============================================================================

select 1 as seq, 'C01_migration_history_c_once' as check_name,
       '1' as expected,
       (select count(*)::text from supabase_migrations.schema_migrations where version = '20260723000600') as actual,
       case when (select count(*) from supabase_migrations.schema_migrations where version = '20260723000600') = 1
            then 'PASS' else 'FAIL' end as status,
       'C recorded exactly once' as details

union all
select 2, 'C02_vendor_public_v_exists_once', '1',
       (select count(*)::text from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relname='vendor_public_v' and c.relkind='v'),
       case when (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relname='vendor_public_v' and c.relkind='v')=1
            then 'PASS' else 'FAIL' end,
       'the safe projection exists exactly once, as a view'

union all
select 3, 'C03_view_columns_match_allowlist', '21',
       (select count(*)::text from pg_catalog.pg_attribute a
         where a.attrelid='public.vendor_public_v'::regclass and a.attnum>0 and not a.attisdropped),
       -- SYMMETRIC NORMALIZATION (QF-MVP-20.3CVR1). BOTH sides are aggregated by
       -- PostgreSQL under the SAME `order by`, so this compares SETS and can never
       -- depend on how the expected literal happens to be hand-typed. The previous
       -- form compared a DB-sorted array against a raw hand-ordered literal, whose
       -- 'cover_image_url'/'covers_full_city' pair was transposed — a false negative
       -- that failed C03 even though the view held exactly the right 21 columns.
       case when (select array_agg(a.attname::text order by a.attname::text)
                    from pg_catalog.pg_attribute a
                   where a.attrelid='public.vendor_public_v'::regclass
                     and a.attnum>0 and not a.attisdropped)
                 = (select array_agg(x order by x) from unnest(
                      array['areas_covered','business_name','business_type','city','completed_projects',
                            'covers_full_city','cover_image_url','experience','id','office_city',
                            'portfolio_urls','profile_image_url','public_business_hours','public_description',
                            'public_service_area_summary','rating','selected_category','selected_subcategories',
                            'service_categories','starting_price','years_experience']::text[]) x)
            then 'PASS' else 'FAIL' end,
       'view columns are EXACTLY the reviewed 21-field allowlist (both sides sorted by PostgreSQL)'

union all
select 4, 'C04_view_has_no_forbidden_column', '0',
       (select count(*)::text from pg_catalog.pg_attribute a
         where a.attrelid='public.vendor_public_v'::regclass and a.attnum>0 and not a.attisdropped
           and a.attname::text = any(array['remaining_credits','total_credits','package_name','package_status',
                'package_expires_at','paid_status','verification_status','gst_number','phone','email',
                'whatsapp_number','user_id','owner_name','message','last_assigned_at','office_address_line1',
                'office_pincode','latitude','longitude','formatted_address','accepting_leads']::text[])),
       case when (select count(*) from pg_catalog.pg_attribute a
                   where a.attrelid='public.vendor_public_v'::regclass and a.attnum>0 and not a.attisdropped
                     and a.attname::text = any(array['remaining_credits','total_credits','package_name','package_status',
                          'package_expires_at','paid_status','verification_status','gst_number','phone','email',
                          'whatsapp_number','user_id','owner_name','message','last_assigned_at','office_address_line1',
                          'office_pincode','latitude','longitude','formatted_address','accepting_leads']::text[]))=0
            then 'PASS' else 'FAIL' end,
       'no monetization / PII / internal column is exposed by the view'

union all
select 5, 'C05_view_grants_narrow', '3',
       (select count(*)::text from unnest(array['anon','authenticated','service_role']) r(role_name)
         where has_table_privilege(r.role_name,'public.vendor_public_v','SELECT')),
       case when (select count(*) from unnest(array['anon','authenticated','service_role']) r(role_name)
                   where has_table_privilege(r.role_name,'public.vendor_public_v','SELECT'))=3
                 and not has_table_privilege('public','public.vendor_public_v','SELECT')
            then 'PASS' else 'FAIL' end,
       'anon + authenticated + service_role read the view; PUBLIC does not'

union all
select 6, 'C06_view_not_security_invoker', '1',
       (select case when coalesce((
                 select array_to_string(c.reloptions,',') from pg_catalog.pg_class c
                  where c.oid='public.vendor_public_v'::regclass),'') not like '%security_invoker=true%'
              then '1' else '0' end),
       case when coalesce((select array_to_string(c.reloptions,',') from pg_catalog.pg_class c
                            where c.oid='public.vendor_public_v'::regclass),'') not like '%security_invoker=true%'
            then 'PASS' else 'FAIL' end,
       'owner-rights projection (security_invoker OFF), by design'

union all
select 7, 'C07_vendors_public_anon_no_privilege', '0',
       (select count(*)::text from unnest(array['public','anon']) r(role_name)
          cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
         where has_table_privilege(r.role_name,'public.vendors',p.priv)),
       case when (select count(*) from unnest(array['public','anon']) r(role_name)
                    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
                   where has_table_privilege(r.role_name,'public.vendors',p.priv))=0
            then 'PASS' else 'FAIL' end,
       'PUBLIC and anon hold NO direct privilege on vendors'

union all
select 8, 'C08_vendors_authenticated_read_only', '1',
       (select case when has_table_privilege('authenticated','public.vendors','SELECT')
                      and not has_table_privilege('authenticated','public.vendors','INSERT')
                      and not has_table_privilege('authenticated','public.vendors','UPDATE')
                      and not has_table_privilege('authenticated','public.vendors','DELETE')
                     then '1' else '0' end),
       case when has_table_privilege('authenticated','public.vendors','SELECT')
              and not has_table_privilege('authenticated','public.vendors','INSERT')
              and not has_table_privilege('authenticated','public.vendors','UPDATE')
              and not has_table_privilege('authenticated','public.vendors','DELETE')
            then 'PASS' else 'FAIL' end,
       'authenticated keeps vendors SELECT (dashboard/admin RLS) but no writes'

union all
select 9, 'C09_leads_all_untrusted_no_privilege', '0',
       (select count(*)::text from unnest(array['public','anon','authenticated']) r(role_name)
          cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
         where has_table_privilege(r.role_name,'public.leads',p.priv)),
       case when (select count(*) from unnest(array['public','anon','authenticated']) r(role_name)
                    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
                   where has_table_privilege(r.role_name,'public.leads',p.priv))=0
            then 'PASS' else 'FAIL' end,
       'PUBLIC, anon and authenticated hold NO direct privilege on leads'

union all
select 10, 'C10_service_role_retains_access', '2',
       (select count(*)::text from unnest(array['public.vendors','public.leads']) t(tbl)
         where has_table_privilege('service_role',t.tbl,'SELECT')
           and has_table_privilege('service_role',t.tbl,'INSERT')),
       case when (select count(*) from unnest(array['public.vendors','public.leads']) t(tbl)
                   where has_table_privilege('service_role',t.tbl,'SELECT')
                     and has_table_privilege('service_role',t.tbl,'INSERT'))=2
            then 'PASS' else 'FAIL' end,
       'service_role retains full server-owned access to vendors and leads'

union all
select 11, 'C11_unsafe_policies_absent', '0',
       (select count(*)::text from pg_policies
         where schemaname='public'
           and ((tablename='vendors' and policyname in ('vendors public listing','vendors public register'))
             or (tablename='leads' and policyname='leads public insert'))),
       case when (select count(*) from pg_policies
                   where schemaname='public'
                     and ((tablename='vendors' and policyname in ('vendors public listing','vendors public register'))
                       or (tablename='leads' and policyname='leads public insert')))=0
            then 'PASS' else 'FAIL' end,
       'the always-true leads INSERT and anon vendors listing/register policies are gone'

union all
select 12, 'C12_safe_policies_remain', '2',
       (select count(*)::text from pg_policies
         where schemaname='public'
           and ((tablename='vendors' and policyname='vendors owner read')
             or (tablename='leads' and policyname='leads admin all'))),
       case when (select count(*) from pg_policies
                   where schemaname='public'
                     and ((tablename='vendors' and policyname='vendors owner read')
                       or (tablename='leads' and policyname='leads admin all')))=2
            then 'PASS' else 'FAIL' end,
       'the safe vendor-own and admin RLS policies are preserved'

union all
select 13, 'C13_rls_still_enabled', '2',
       (select count(*)::text from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relrowsecurity and c.relname in ('vendors','leads')),
       case when (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relrowsecurity and c.relname in ('vendors','leads'))=2
            then 'PASS' else 'FAIL' end,
       'RLS remains enabled on vendors and leads'

union all
select 14, 'C14_get_public_eligible_vendors_anon_exec', '1',
       (select case when has_function_privilege('anon',
                 to_regprocedure('public.get_public_eligible_vendors(text, text, text)'),'EXECUTE')
              then '1' else '0' end),
       case when has_function_privilege('anon',
              to_regprocedure('public.get_public_eligible_vendors(text, text, text)'),'EXECUTE')
            then 'PASS' else 'FAIL' end,
       'the existing safe enquiry-matching RPC remains anon-executable'

union all
select 15, 'C15_canonical_b1_functions_intact', '5',
       (select count(*)::text from unnest(array[
              'public.qf_vendor_assignment_eligible(uuid, uuid, integer)',
              'public.qf_apply_credit_mutation_v2(uuid, integer, text, text, text, text, text, uuid, text, boolean)',
              'public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)',
              'public.qf_request_replacement_v2(uuid, uuid, text, text, uuid)',
              'public.qf_approve_credit_restoration_v2(uuid, uuid, text)']) s(sig)
         where to_regprocedure(s.sig) is not null),
       case when (select count(*) from unnest(array[
                       'public.qf_vendor_assignment_eligible(uuid, uuid, integer)',
                       'public.qf_apply_credit_mutation_v2(uuid, integer, text, text, text, text, text, uuid, text, boolean)',
                       'public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)',
                       'public.qf_request_replacement_v2(uuid, uuid, text, text, uuid)',
                       'public.qf_approve_credit_restoration_v2(uuid, uuid, text)']) s(sig)
                   where to_regprocedure(s.sig) is not null)=5
            then 'PASS' else 'FAIL' end,
       'C changed no canonical B1 signature'

union all
select 16, 'C16_b2_triggers_intact', '4',
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
       'the four B2 enforcement triggers remain'

union all
select 17, 'C17_g_lineage_boundary_intact', '0',
       (select count(*)::text from unnest(array['public','anon','authenticated']) r(role_name)
          cross join unnest(array['UPDATE','DELETE','TRUNCATE']) p(priv)
         where has_table_privilege(r.role_name,'public.lead_assignment_events',p.priv)),
       case when (select count(*) from unnest(array['public','anon','authenticated']) r(role_name)
                    cross join unnest(array['UPDATE','DELETE','TRUNCATE']) p(priv)
                   where has_table_privilege(r.role_name,'public.lead_assignment_events',p.priv))=0
            then 'PASS' else 'FAIL' end,
       'Migration G lineage append-only boundary is unchanged by C'

union all
select 18, 'C18_legacy_rpcs_retained', 'RETAINED',
       (select case when count(*)>0 then 'RETAINED' else 'MISSING' end
          from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public'
           and p.proname in ('assign_lead_to_vendors','admin_smart_assign_lead_to_vendors',
                             'assign_lead_to_paid_vendors_phase26a','assign_lead_to_preferred_vendor',
                             'assign_client_selected_vendor_to_group','assign_vendor_to_requirement_group')),
       case when (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
                   where n.nspname='public'
                     and p.proname in ('assign_lead_to_vendors','admin_smart_assign_lead_to_vendors',
                                       'assign_lead_to_paid_vendors_phase26a','assign_lead_to_preferred_vendor',
                                       'assign_client_selected_vendor_to_group','assign_vendor_to_requirement_group'))>0
            then 'PASS' else 'FAIL' end,
       'E is a LATER phase: C must not drop a legacy assignment RPC'

union all
select 19, 'C19_legacy_rpc_execute_not_revoked', '1',
       (select case when has_function_privilege('service_role',
                 to_regprocedure('public.assign_lead_to_vendors(uuid, uuid[], boolean, text)'),'EXECUTE')
              then '1' else '0' end),
       case when has_function_privilege('service_role',
              to_regprocedure('public.assign_lead_to_vendors(uuid, uuid[], boolean, text)'),'EXECUTE')
            then 'PASS' else 'FAIL' end,
       'legacy RPC EXECUTE posture is untouched (revocation is Migration E)'

union all
select 20, 'C20_migration_d_auth_trigger_absent', '0',
       (select count(*)::text from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
         where not t.tgisinternal and n.nspname='auth' and c.relname='users'),
       case when (select count(*) from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
                    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
                   where not t.tgisinternal and n.nspname='auth' and c.relname='users')=0
            then 'PASS' else 'FAIL' end,
       'Migration D not started'

union all
select 21, 'C21_owner_binding_still_deferred', '0',
       (select count(*)::text from pg_catalog.pg_attribute
         where attrelid='public.leads'::regclass and not attisdropped
           and attname::text = any(array['client_account_id','user_id','created_by']::text[])),
       case when (select count(*) from pg_catalog.pg_attribute
                   where attrelid='public.leads'::regclass and not attisdropped
                     and attname::text = any(array['client_account_id','user_id','created_by']::text[]))=0
            then 'PASS' else 'FAIL' end,
       'R1_BLOCKED_PENDING_OWNER_BINDING remains unresolved and out of scope for C'

union all
select 22, 'C22_owner_break_glass_information', 'INFORMATIONAL',
       (select coalesce(max(pg_catalog.pg_get_userbyid(c.relowner)),'unknown')
          from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relname='vendor_public_v'),
       'PASS',
       'the projection owner is a privileged role (owner-rights view); informational, non-blocking'

union all
select 23, 'C23_application_data_unchanged_by_c', 'INFORMATIONAL',
       (select concat('vendors=', (select count(*) from public.vendors),
                      ' leads=', (select count(*) from public.leads))),
       'PASS',
       'C creates only a view and changes privileges/policies; it writes no application row'

order by seq;
