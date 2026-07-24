-- ============================================================================
-- QuickFurno — QF-MVP-20.3E — POST-APPLICATION VERIFICATION (SELECT-ONLY)
--
-- SCOPE
--   Verifies the expected database state AFTER applying:
--     20260723000800_qf_mvp_legacy_assignment_rpc_execute_revocation.sql   (E)
--   on top of the already-applied, immutable A / A2 / B1 / G / B2 / C / D.
--
-- SELECT-ONLY BY CONSTRUCTION
--   One read-only statement: a chain of SELECT ... UNION ALL branches. No
--   INSERT/UPDATE/DELETE/MERGE/TRUNCATE/CREATE/ALTER/DROP/GRANT/REVOKE/CALL/DO.
--   It NEVER invokes any assignment RPC — every check is a catalog fact.
--
-- LOCKED POLICIES CARRIED FORWARD
--   * QF-MVP-20.3B1R2 — no lexical assertion over pg_get_functiondef()/prosrc.
--   * QF-MVP-20.3B2R1 — every catalog `name` value is compared as text.
--   * QF-MVP-20.3CVR1 — any set comparison normalises BOTH sides in PostgreSQL.
--
--   E changes ACLs ONLY. The six targets' DEFINITIONS are proved unchanged at
--   the catalog level (still present, SECURITY DEFINER, jsonb result); a body
--   hash lives in the offline manifest (scripts/mvp/staging/qf-mvp-20-3e-manifest.json),
--   graded by the offline validator — the correct place for a source assertion.
--
-- OUTPUT: seq | check_name | expected | actual | status | details
-- ============================================================================

select 1 as seq, 'E01_migration_history_e_once' as check_name,
       '1' as expected,
       (select count(*)::text from supabase_migrations.schema_migrations where version = '20260723000800') as actual,
       case when (select count(*) from supabase_migrations.schema_migrations where version = '20260723000800') = 1
            then 'PASS' else 'FAIL' end as status,
       'E recorded exactly once' as details

union all
select 2, 'E02_six_targets_present', '6',
       (select count(*)::text from unnest(array[
          'public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)',
          'public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)',
          'public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])',
          'public.assign_lead_to_preferred_vendor(uuid, uuid)',
          'public.assign_lead_to_vendors(uuid, uuid[], boolean, text)',
          'public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)']) s(sig)
         where to_regprocedure(s.sig) is not null),
       case when (select count(*) from unnest(array[
                    'public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)',
                    'public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)',
                    'public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])',
                    'public.assign_lead_to_preferred_vendor(uuid, uuid)',
                    'public.assign_lead_to_vendors(uuid, uuid[], boolean, text)',
                    'public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)']) s(sig)
                   where to_regprocedure(s.sig) is not null)=6
            then 'PASS' else 'FAIL' end,
       'all six legacy assignment RPCs remain present (E drops nothing)'

-- E03..E08 — per-target posture: exists, SECURITY DEFINER jsonb, no untrusted
-- EXECUTE, service_role retained. One row per overload so a single missed
-- signature cannot hide behind an aggregate.
union all
select 3, 'E03_admin_smart_assign_server_only', 'server_only',
       (select case when to_regprocedure('public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)') is null then 'MISSING'
                    when has_function_privilege('public','public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)','EXECUTE')
                      or has_function_privilege('anon','public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)','EXECUTE')
                      or has_function_privilege('authenticated','public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)','EXECUTE') then 'untrusted_execute'
                    when not has_function_privilege('service_role','public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)','EXECUTE') then 'service_role_missing'
                    else 'server_only' end),
       case when to_regprocedure('public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)') is not null
             and not has_function_privilege('public','public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)','EXECUTE')
             and not has_function_privilege('anon','public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)','EXECUTE')
             and not has_function_privilege('authenticated','public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)','EXECUTE')
             and has_function_privilege('service_role','public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)','EXECUTE')
            then 'PASS' else 'FAIL' end,
       'admin_smart_assign_lead_to_vendors: PUBLIC/anon/authenticated no EXECUTE, service_role retained'

union all
select 4, 'E04_client_selected_group_server_only', 'server_only',
       (select case when to_regprocedure('public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)') is null then 'MISSING'
                    when has_function_privilege('public','public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)','EXECUTE')
                      or has_function_privilege('anon','public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)','EXECUTE')
                      or has_function_privilege('authenticated','public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)','EXECUTE') then 'untrusted_execute'
                    when not has_function_privilege('service_role','public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)','EXECUTE') then 'service_role_missing'
                    else 'server_only' end),
       case when to_regprocedure('public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)') is not null
             and not has_function_privilege('public','public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)','EXECUTE')
             and not has_function_privilege('anon','public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)','EXECUTE')
             and not has_function_privilege('authenticated','public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)','EXECUTE')
             and has_function_privilege('service_role','public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)','EXECUTE')
            then 'PASS' else 'FAIL' end,
       'assign_client_selected_vendor_to_group: server_role-only EXECUTE'

union all
select 5, 'E05_paid_vendors_phase26a_server_only', 'server_only',
       (select case when to_regprocedure('public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])') is null then 'MISSING'
                    when has_function_privilege('public','public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])','EXECUTE')
                      or has_function_privilege('anon','public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])','EXECUTE')
                      or has_function_privilege('authenticated','public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])','EXECUTE') then 'untrusted_execute'
                    when not has_function_privilege('service_role','public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])','EXECUTE') then 'service_role_missing'
                    else 'server_only' end),
       case when to_regprocedure('public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])') is not null
             and not has_function_privilege('public','public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])','EXECUTE')
             and not has_function_privilege('anon','public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])','EXECUTE')
             and not has_function_privilege('authenticated','public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])','EXECUTE')
             and has_function_privilege('service_role','public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])','EXECUTE')
            then 'PASS' else 'FAIL' end,
       'assign_lead_to_paid_vendors_phase26a: server_role-only EXECUTE'

union all
select 6, 'E06_preferred_vendor_server_only', 'server_only',
       (select case when to_regprocedure('public.assign_lead_to_preferred_vendor(uuid, uuid)') is null then 'MISSING'
                    when has_function_privilege('public','public.assign_lead_to_preferred_vendor(uuid, uuid)','EXECUTE')
                      or has_function_privilege('anon','public.assign_lead_to_preferred_vendor(uuid, uuid)','EXECUTE')
                      or has_function_privilege('authenticated','public.assign_lead_to_preferred_vendor(uuid, uuid)','EXECUTE') then 'untrusted_execute'
                    when not has_function_privilege('service_role','public.assign_lead_to_preferred_vendor(uuid, uuid)','EXECUTE') then 'service_role_missing'
                    else 'server_only' end),
       case when to_regprocedure('public.assign_lead_to_preferred_vendor(uuid, uuid)') is not null
             and not has_function_privilege('public','public.assign_lead_to_preferred_vendor(uuid, uuid)','EXECUTE')
             and not has_function_privilege('anon','public.assign_lead_to_preferred_vendor(uuid, uuid)','EXECUTE')
             and not has_function_privilege('authenticated','public.assign_lead_to_preferred_vendor(uuid, uuid)','EXECUTE')
             and has_function_privilege('service_role','public.assign_lead_to_preferred_vendor(uuid, uuid)','EXECUTE')
            then 'PASS' else 'FAIL' end,
       'assign_lead_to_preferred_vendor: server_role-only EXECUTE'

union all
select 7, 'E07_assign_lead_to_vendors_server_only', 'server_only',
       (select case when to_regprocedure('public.assign_lead_to_vendors(uuid, uuid[], boolean, text)') is null then 'MISSING'
                    when has_function_privilege('public','public.assign_lead_to_vendors(uuid, uuid[], boolean, text)','EXECUTE')
                      or has_function_privilege('anon','public.assign_lead_to_vendors(uuid, uuid[], boolean, text)','EXECUTE')
                      or has_function_privilege('authenticated','public.assign_lead_to_vendors(uuid, uuid[], boolean, text)','EXECUTE') then 'untrusted_execute'
                    when not has_function_privilege('service_role','public.assign_lead_to_vendors(uuid, uuid[], boolean, text)','EXECUTE') then 'service_role_missing'
                    else 'server_only' end),
       case when to_regprocedure('public.assign_lead_to_vendors(uuid, uuid[], boolean, text)') is not null
             and not has_function_privilege('public','public.assign_lead_to_vendors(uuid, uuid[], boolean, text)','EXECUTE')
             and not has_function_privilege('anon','public.assign_lead_to_vendors(uuid, uuid[], boolean, text)','EXECUTE')
             and not has_function_privilege('authenticated','public.assign_lead_to_vendors(uuid, uuid[], boolean, text)','EXECUTE')
             and has_function_privilege('service_role','public.assign_lead_to_vendors(uuid, uuid[], boolean, text)','EXECUTE')
            then 'PASS' else 'FAIL' end,
       'assign_lead_to_vendors: server_role-only EXECUTE'

union all
select 8, 'E08_requirement_group_server_only', 'server_only',
       (select case when to_regprocedure('public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)') is null then 'MISSING'
                    when has_function_privilege('public','public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)','EXECUTE')
                      or has_function_privilege('anon','public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)','EXECUTE')
                      or has_function_privilege('authenticated','public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)','EXECUTE') then 'untrusted_execute'
                    when not has_function_privilege('service_role','public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)','EXECUTE') then 'service_role_missing'
                    else 'server_only' end),
       case when to_regprocedure('public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)') is not null
             and not has_function_privilege('public','public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)','EXECUTE')
             and not has_function_privilege('anon','public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)','EXECUTE')
             and not has_function_privilege('authenticated','public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)','EXECUTE')
             and has_function_privilege('service_role','public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)','EXECUTE')
            then 'PASS' else 'FAIL' end,
       'assign_vendor_to_requirement_group: server_role-only EXECUTE'

-- E09 aggregate cross-check: across ALL six, untrusted EXECUTE grants total 0.
union all
select 9, 'E09_no_untrusted_execute_any_target', '0',
       (select count(*)::text
          from unnest(array[
            'public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)',
            'public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)',
            'public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])',
            'public.assign_lead_to_preferred_vendor(uuid, uuid)',
            'public.assign_lead_to_vendors(uuid, uuid[], boolean, text)',
            'public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)']) s(sig)
          cross join unnest(array['public','anon','authenticated']) r(role_name)
         where has_function_privilege(r.role_name, to_regprocedure(s.sig), 'EXECUTE')),
       case when (select count(*)
                    from unnest(array[
                      'public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)',
                      'public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)',
                      'public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])',
                      'public.assign_lead_to_preferred_vendor(uuid, uuid)',
                      'public.assign_lead_to_vendors(uuid, uuid[], boolean, text)',
                      'public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)']) s(sig)
                    cross join unnest(array['public','anon','authenticated']) r(role_name)
                   where has_function_privilege(r.role_name, to_regprocedure(s.sig), 'EXECUTE'))=0
            then 'PASS' else 'FAIL' end,
       'across all six targets, PUBLIC/anon/authenticated hold ZERO EXECUTE grants'

-- E10 aggregate: all six remain SECURITY DEFINER jsonb (definition-equivalent).
union all
select 10, 'E10_targets_still_secdef_jsonb', '6',
       (select count(*)::text from unnest(array[
          'public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)',
          'public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)',
          'public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])',
          'public.assign_lead_to_preferred_vendor(uuid, uuid)',
          'public.assign_lead_to_vendors(uuid, uuid[], boolean, text)',
          'public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)']) s(sig)
          join pg_proc p on p.oid = to_regprocedure(s.sig)
         where p.prosecdef and pg_get_function_result(p.oid) = 'jsonb'),
       case when (select count(*) from unnest(array[
                    'public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)',
                    'public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)',
                    'public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])',
                    'public.assign_lead_to_preferred_vendor(uuid, uuid)',
                    'public.assign_lead_to_vendors(uuid, uuid[], boolean, text)',
                    'public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)']) s(sig)
                    join pg_proc p on p.oid = to_regprocedure(s.sig)
                   where p.prosecdef and pg_get_function_result(p.oid) = 'jsonb')=6
            then 'PASS' else 'FAIL' end,
       'E changed ACLs only: all six remain SECURITY DEFINER, jsonb-returning'

-- E11 the SAFE read-only public discovery RPC is UNCHANGED.
union all
select 11, 'E11_public_discovery_rpc_preserved', '1',
       (select case when to_regprocedure('public.get_public_eligible_vendors(text, text, text)') is not null
                     and has_function_privilege('anon','public.get_public_eligible_vendors(text, text, text)','EXECUTE')
                     and has_function_privilege('authenticated','public.get_public_eligible_vendors(text, text, text)','EXECUTE')
                     and has_function_privilege('service_role','public.get_public_eligible_vendors(text, text, text)','EXECUTE')
                    then '1' else '0' end),
       case when to_regprocedure('public.get_public_eligible_vendors(text, text, text)') is not null
             and has_function_privilege('anon','public.get_public_eligible_vendors(text, text, text)','EXECUTE')
             and has_function_privilege('authenticated','public.get_public_eligible_vendors(text, text, text)','EXECUTE')
             and has_function_privilege('service_role','public.get_public_eligible_vendors(text, text, text)','EXECUTE')
            then 'PASS' else 'FAIL' end,
       'get_public_eligible_vendors keeps anon/authenticated/service_role EXECUTE (E must never revoke it)'

-- E12 the CANONICAL authority: server-executable, not exposed to untrusted roles.
union all
select 12, 'E12_canonical_authority_server_only', '1',
       (select case when to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is not null
                     and has_function_privilege('service_role','public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)','EXECUTE')
                     and not has_function_privilege('anon','public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)','EXECUTE')
                     and not has_function_privilege('authenticated','public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)','EXECUTE')
                    then '1' else '0' end),
       case when to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is not null
             and has_function_privilege('service_role','public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)','EXECUTE')
             and not has_function_privilege('anon','public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)','EXECUTE')
             and not has_function_privilege('authenticated','public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)','EXECUTE')
            then 'PASS' else 'FAIL' end,
       'canonical qf_assign_lead_vendors_v2 remains service_role-usable and never anon/authenticated-executable'

-- E13..E18 preservation of A/A2/B1/G/B2/C/D.
union all
select 13, 'E13_b1_functions_intact', '5',
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
       'the five canonical B1 functions are intact'

union all
select 14, 'E14_b2_triggers_intact', '4',
       (select count(*)::text from pg_trigger t join pg_class c on c.oid=t.tgrelid
          join pg_namespace n on n.oid=c.relnamespace
         where not t.tgisinternal and n.nspname='public'
           and t.tgname in ('trg_lead_assignments_active_cap','trg_lead_assignment_events_lifetime_cap',
                            'trg_lead_assignment_events_immutable','trg_lead_assignment_events_no_truncate')),
       case when (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
                    join pg_namespace n on n.oid=c.relnamespace
                   where not t.tgisinternal and n.nspname='public'
                     and t.tgname in ('trg_lead_assignments_active_cap','trg_lead_assignment_events_lifetime_cap',
                                      'trg_lead_assignment_events_immutable','trg_lead_assignment_events_no_truncate'))=4
            then 'PASS' else 'FAIL' end,
       'the four B2 enforcement triggers are intact'

union all
select 15, 'E15_g_lineage_boundary_intact', '0',
       (select count(*)::text from unnest(array['public','anon','authenticated']) r(role_name)
          cross join unnest(array['UPDATE','DELETE','TRUNCATE']) p(priv)
         where has_table_privilege(r.role_name,'public.lead_assignment_events',p.priv)),
       case when (select count(*) from unnest(array['public','anon','authenticated']) r(role_name)
                    cross join unnest(array['UPDATE','DELETE','TRUNCATE']) p(priv)
                   where has_table_privilege(r.role_name,'public.lead_assignment_events',p.priv))=0
            then 'PASS' else 'FAIL' end,
       'Migration G lineage append-only boundary unchanged by E'

union all
select 16, 'E16_c_projection_and_revocation_intact', '1',
       (select case when exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                                  where n.nspname='public' and c.relname='vendor_public_v' and c.relkind='v')
                     and not has_table_privilege('anon','public.vendors','SELECT')
                     and not has_table_privilege('anon','public.leads','SELECT')
                    then '1' else '0' end),
       case when exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                          where n.nspname='public' and c.relname='vendor_public_v' and c.relkind='v')
             and not has_table_privilege('anon','public.vendors','SELECT')
             and not has_table_privilege('anon','public.leads','SELECT')
            then 'PASS' else 'FAIL' end,
       'Migration C public projection present and anon revocation on vendors/leads intact'

union all
select 17, 'E17_d_trigger_and_function_intact', '1',
       (select case when (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
                            where not t.tgisinternal and t.tgname='on_auth_user_created'
                              and n.nspname='auth' and c.relname='users' and t.tgtype=5 and t.tgenabled='O')=1
                     and to_regprocedure('public.handle_new_user()') is not null
                     and exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.handle_new_user()') and p.prosecdef)
                    then '1' else '0' end),
       case when (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
                    where not t.tgisinternal and t.tgname='on_auth_user_created'
                      and n.nspname='auth' and c.relname='users' and t.tgtype=5 and t.tgenabled='O')=1
             and to_regprocedure('public.handle_new_user()') is not null
             and exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.handle_new_user()') and p.prosecdef)
            then 'PASS' else 'FAIL' end,
       'Migration D onboarding trigger (auth.users, tgtype 5, enabled) and SECURITY DEFINER function intact'

union all
select 18, 'E18_legacy_rpcs_retained', 'RETAINED',
       (select case when count(*)=6 then 'RETAINED' else 'MISSING' end
          from unnest(array[
            'public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)',
            'public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)',
            'public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])',
            'public.assign_lead_to_preferred_vendor(uuid, uuid)',
            'public.assign_lead_to_vendors(uuid, uuid[], boolean, text)',
            'public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)']) s(sig)
         where to_regprocedure(s.sig) is not null),
       case when (select count(*) from unnest(array[
                    'public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)',
                    'public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)',
                    'public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])',
                    'public.assign_lead_to_preferred_vendor(uuid, uuid)',
                    'public.assign_lead_to_vendors(uuid, uuid[], boolean, text)',
                    'public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)']) s(sig)
                   where to_regprocedure(s.sig) is not null)=6
            then 'PASS' else 'FAIL' end,
       'E revokes ACLs only; the six legacy RPCs remain callable by server-owned authority'

-- E19 SCOPE FENCE — owner binding still deferred.
union all
select 19, 'E19_owner_binding_still_deferred', '0',
       (select count(*)::text from pg_attribute
         where attrelid='public.leads'::regclass and not attisdropped
           and attname::text = any(array['client_account_id','user_id','created_by']::text[])),
       case when (select count(*) from pg_attribute
                   where attrelid='public.leads'::regclass and not attisdropped
                     and attname::text = any(array['client_account_id','user_id','created_by']::text[]))=0
            then 'PASS' else 'FAIL' end,
       'R1_BLOCKED_PENDING_OWNER_BINDING remains unresolved; E does no owner binding'

-- E20 owner posture — informational (E must not have changed owners).
union all
select 20, 'E20_target_owners_information', 'INFORMATIONAL',
       (select string_agg(distinct pg_get_userbyid(p.proowner)::text, ',' order by pg_get_userbyid(p.proowner)::text)
          from unnest(array[
            'public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)',
            'public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)',
            'public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[])',
            'public.assign_lead_to_preferred_vendor(uuid, uuid)',
            'public.assign_lead_to_vendors(uuid, uuid[], boolean, text)',
            'public.assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)']) s(sig)
          join pg_proc p on p.oid = to_regprocedure(s.sig)),
       'PASS',
       'owners of the six targets (E changes ACLs only and no owner); informational, non-blocking'

-- E21 SCOPE FENCE — QF-MVP-20.4 historical reconciliation NOT performed.
union all
select 21, 'E21_20_4_not_started', 'INFORMATIONAL',
       (select concat('lead_assignment_events=', (select count(*) from public.lead_assignment_events),
                      ' lead_assignments=', (select count(*) from public.lead_assignments))),
       'PASS',
       'E writes no ledger row and performs no historical credit-ledger reconciliation (QF-MVP-20.4 is a later phase)'

order by seq;
