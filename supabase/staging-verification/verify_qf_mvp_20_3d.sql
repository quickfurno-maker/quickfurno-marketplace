-- ============================================================================
-- QuickFurno — QF-MVP-20.3D — POST-APPLICATION VERIFICATION (SELECT-ONLY)
--
-- SCOPE
--   Verifies the expected database state AFTER applying:
--     20260723000700_qf_mvp_auth_user_onboarding_trigger.sql   (D)
--   on top of the already-applied, immutable A / A2 / B1 / G / B2 / C.
--
-- SELECT-ONLY BY CONSTRUCTION
--   One read-only statement: a chain of SELECT ... UNION ALL branches. No
--   INSERT/UPDATE/DELETE/MERGE/TRUNCATE/CREATE/ALTER/DROP/GRANT/REVOKE/CALL/DO.
--   In particular it NEVER inserts a test auth user: the trigger is proved
--   STRUCTURALLY from catalog facts, never by exercising it.
--
-- LOCKED POLICIES CARRIED FORWARD
--   * QF-MVP-20.3B1R2 — no lexical assertion over pg_get_functiondef(),
--     pg_proc.prosrc or information_schema routine-definition text.
--   * QF-MVP-20.3B2R1 — every catalog `name` value is compared as text.
--   * QF-MVP-20.3CVR1 — any set comparison normalises BOTH sides in PostgreSQL;
--     a DB-sorted aggregate is never compared with a hand-ordered literal.
--
--   Consequence: the source-level guarantee that the profile role is classified
--   ONLY from the server-set app_metadata marker `qf_principal` — never from
--   raw_user_meta_data, and never as a blanket constant — is enforced by the
--   OFFLINE VALIDATOR, which grades the migration text with a comment-aware
--   tokenizer. It CANNOT be asserted here: pg_proc.prosrc retains the function's
--   own inline comments, which legitimately name `raw_user_meta_data` and
--   'admin' while describing what is forbidden, so a negative lexical assertion
--   would produce a false FAIL. Proving the behaviour in-database would instead
--   require inserting a test auth user, which this phase forbids.
--
--   Rows 26-28 add the catalog-decidable half of the corrected contract: the
--   neutral role remains storable, the applied function DECLARES its trusted
--   source (via the COMMENT catalog object, not source text), and the client
--   principal model is intact.
--
-- TRIGGER TYPE BITS (pg_trigger.tgtype)
--   1 ROW · 2 BEFORE · 4 INSERT · 8 DELETE · 16 UPDATE · 32 TRUNCATE
--     5 = ROW|INSERT with the BEFORE bit UNSET  =>  AFTER INSERT FOR EACH ROW
--
-- OUTPUT: seq | check_name | expected | actual | status | details
-- ============================================================================

select 1 as seq, 'D01_migration_history_d_once' as check_name,
       '1' as expected,
       (select count(*)::text from supabase_migrations.schema_migrations where version = '20260723000700') as actual,
       case when (select count(*) from supabase_migrations.schema_migrations where version = '20260723000700') = 1
            then 'PASS' else 'FAIL' end as status,
       'D recorded exactly once' as details

union all
select 2, 'D02_onboarding_function_exists_once', '1',
       (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='handle_new_user' and p.pronargs=0),
       case when (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
                   where n.nspname='public' and p.proname='handle_new_user' and p.pronargs=0)=1
            then 'PASS' else 'FAIL' end,
       'public.handle_new_user() exists exactly once, zero-argument'

union all
select 3, 'D03_function_security_definer', '1',
       (select case when p.prosecdef then '1' else '0' end from pg_catalog.pg_proc p
         where p.oid = to_regprocedure('public.handle_new_user()')),
       case when (select p.prosecdef from pg_catalog.pg_proc p
                   where p.oid = to_regprocedure('public.handle_new_user()'))
            then 'PASS' else 'FAIL' end,
       'SECURITY DEFINER is required: the auth service holds no rights on public.profiles'

union all
select 4, 'D04_function_search_path_pinned', '1',
       (select case when exists (
                 select 1 from pg_catalog.pg_proc p,
                      unnest(coalesce(p.proconfig,'{}'::text[])) cfg
                  where p.oid = to_regprocedure('public.handle_new_user()')
                    and cfg like 'search_path=%' and cfg like '%pg_catalog%')
              then '1' else '0' end),
       case when exists (
              select 1 from pg_catalog.pg_proc p,
                   unnest(coalesce(p.proconfig,'{}'::text[])) cfg
               where p.oid = to_regprocedure('public.handle_new_user()')
                 and cfg like 'search_path=%' and cfg like '%pg_catalog%')
            then 'PASS' else 'FAIL' end,
       'structural proconfig check (never exact string equality)'

union all
select 5, 'D05_function_not_untrusted_executable', '0',
       (select count(*)::text from unnest(array['public','anon','authenticated']) r(role_name)
         where has_function_privilege(r.role_name, to_regprocedure('public.handle_new_user()'), 'EXECUTE')),
       case when (select count(*) from unnest(array['public','anon','authenticated']) r(role_name)
                   where has_function_privilege(r.role_name, to_regprocedure('public.handle_new_user()'), 'EXECUTE'))=0
            then 'PASS' else 'FAIL' end,
       'not a callable escalation API: PUBLIC/anon/authenticated hold no EXECUTE'

union all
select 6, 'D06_function_service_role_execute', '1',
       (select case when has_function_privilege('service_role', to_regprocedure('public.handle_new_user()'), 'EXECUTE')
              then '1' else '0' end),
       case when has_function_privilege('service_role', to_regprocedure('public.handle_new_user()'), 'EXECUTE')
            then 'PASS' else 'FAIL' end,
       'service_role EXECUTE preserved, matching the applied baseline posture'

union all
select 7, 'D07_auth_trigger_exists_once', '1',
       (select count(*)::text from pg_catalog.pg_trigger t
         where t.tgname='on_auth_user_created' and not t.tgisinternal),
       case when (select count(*) from pg_catalog.pg_trigger t
                   where t.tgname='on_auth_user_created' and not t.tgisinternal)=1
            then 'PASS' else 'FAIL' end,
       'exactly one live on_auth_user_created trigger'

union all
select 8, 'D08_auth_trigger_wiring', '1',
       (select count(*)::text from pg_catalog.pg_trigger t
          join pg_catalog.pg_class c on c.oid=t.tgrelid
          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
         where not t.tgisinternal and t.tgname='on_auth_user_created'
           and n.nspname='auth' and c.relname='users'
           and t.tgtype=5 and t.tgenabled='O'),
       case when (select count(*) from pg_catalog.pg_trigger t
                    join pg_catalog.pg_class c on c.oid=t.tgrelid
                    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
                   where not t.tgisinternal and t.tgname='on_auth_user_created'
                     and n.nspname='auth' and c.relname='users'
                     and t.tgtype=5 and t.tgenabled='O')=1
            then 'PASS' else 'FAIL' end,
       'AFTER INSERT FOR EACH ROW on auth.users (tgtype 5), enabled'

union all
select 9, 'D09_auth_trigger_bound_to_function', '1',
       (select count(*)::text from pg_catalog.pg_trigger t
         where not t.tgisinternal and t.tgname='on_auth_user_created'
           and t.tgfoid = to_regprocedure('public.handle_new_user()')),
       case when (select count(*) from pg_catalog.pg_trigger t
                   where not t.tgisinternal and t.tgname='on_auth_user_created'
                     and t.tgfoid = to_regprocedure('public.handle_new_user()'))=1
            then 'PASS' else 'FAIL' end,
       'the trigger executes exactly public.handle_new_user()'

union all
select 10, 'D10_no_other_auth_users_trigger', '0',
       (select count(*)::text from pg_catalog.pg_trigger t
          join pg_catalog.pg_class c on c.oid=t.tgrelid
          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
         where not t.tgisinternal and n.nspname='auth' and c.relname='users'
           and t.tgname <> 'on_auth_user_created'),
       case when (select count(*) from pg_catalog.pg_trigger t
                    join pg_catalog.pg_class c on c.oid=t.tgrelid
                    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
                   where not t.tgisinternal and n.nspname='auth' and c.relname='users'
                     and t.tgname <> 'on_auth_user_created')=0
            then 'PASS' else 'FAIL' end,
       'scope fence: D declared one auth trigger and installed no others'

union all
select 11, 'D11_onboarding_target_fk_intact', '1',
       (select count(*)::text from pg_catalog.pg_constraint
         where conname='profiles_id_fkey' and contype='f'),
       case when (select count(*) from pg_catalog.pg_constraint
                   where conname='profiles_id_fkey' and contype='f')=1
            then 'PASS' else 'FAIL' end,
       'profiles.id -> auth.users(id) FK intact (why the trigger must be AFTER INSERT)'

union all
select 12, 'D12_profiles_role_vocabulary_unchanged', '1',
       (select count(*)::text from pg_catalog.pg_constraint
         where conname='profiles_role_check' and contype='c'
           and pg_catalog.pg_get_constraintdef(oid) like '%admin%'
           and pg_catalog.pg_get_constraintdef(oid) like '%vendor%'),
       case when (select count(*) from pg_catalog.pg_constraint
                   where conname='profiles_role_check' and contype='c'
                     and pg_catalog.pg_get_constraintdef(oid) like '%admin%'
                     and pg_catalog.pg_get_constraintdef(oid) like '%vendor%')=1
            then 'PASS' else 'FAIL' end,
       'the role vocabulary is unchanged; D introduced no new privileged value'

union all
select 13, 'D13_profiles_untrusted_no_privilege', '0',
       (select count(*)::text from unnest(array['public','anon']) r(role_name)
          cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p(priv)
         where has_table_privilege(r.role_name,'public.profiles',p.priv)),
       case when (select count(*) from unnest(array['public','anon']) r(role_name)
                    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p(priv)
                   where has_table_privilege(r.role_name,'public.profiles',p.priv))=0
            then 'PASS' else 'FAIL' end,
       'D did not widen profiles: PUBLIC and anon still hold nothing'

union all
select 14, 'D14_profiles_no_insert_policy', '0',
       (select count(*)::text from pg_policies
         where schemaname='public' and tablename='profiles'
           and cmd = 'INSERT'),
       case when (select count(*) from pg_policies
                   where schemaname='public' and tablename='profiles' and cmd='INSERT')=0
            then 'PASS' else 'FAIL' end,
       'no self-provisioning INSERT policy: the trigger remains the sole writer'

union all
select 15, 'D15_no_historical_backfill', 'INFORMATIONAL',
       (select concat('auth_users=', (select count(*) from auth.users),
                      ' profiles=', (select count(*) from public.profiles))),
       'PASS',
       'D performs NO historical backfill. On empty staging both are 0; the migration itself writes no application row.'

union all
select 16, 'D16_canonical_b1_functions_intact', '5',
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
       'D changed no canonical B1 signature'

union all
select 17, 'D17_b2_triggers_intact', '4',
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
select 18, 'D18_g_lineage_boundary_intact', '0',
       (select count(*)::text from unnest(array['public','anon','authenticated']) r(role_name)
          cross join unnest(array['UPDATE','DELETE','TRUNCATE']) p(priv)
         where has_table_privilege(r.role_name,'public.lead_assignment_events',p.priv)),
       case when (select count(*) from unnest(array['public','anon','authenticated']) r(role_name)
                    cross join unnest(array['UPDATE','DELETE','TRUNCATE']) p(priv)
                   where has_table_privilege(r.role_name,'public.lead_assignment_events',p.priv))=0
            then 'PASS' else 'FAIL' end,
       'Migration G lineage append-only boundary unchanged by D'

union all
select 19, 'D19_c_projection_intact', '1',
       (select count(*)::text from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relname='vendor_public_v' and c.relkind='v'),
       case when (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relname='vendor_public_v' and c.relkind='v')=1
            then 'PASS' else 'FAIL' end,
       'the Migration C public projection still exists'

union all
select 20, 'D20_c_anon_revocation_intact', '0',
       (select count(*)::text from unnest(array['public','anon']) r(role_name)
          cross join unnest(array['public.vendors','public.leads']) t(tbl)
         where has_table_privilege(r.role_name,t.tbl,'SELECT')),
       case when (select count(*) from unnest(array['public','anon']) r(role_name)
                    cross join unnest(array['public.vendors','public.leads']) t(tbl)
                   where has_table_privilege(r.role_name,t.tbl,'SELECT'))=0
            then 'PASS' else 'FAIL' end,
       'Migration C anon revocation on vendors and leads unchanged by D'

union all
select 21, 'D21_legacy_rpcs_retained', 'RETAINED',
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
       'E is a LATER phase: D must not drop a legacy assignment RPC'

union all
select 22, 'D22_legacy_rpc_execute_not_revoked', '1',
       (select case when has_function_privilege('service_role',
                 to_regprocedure('public.assign_lead_to_vendors(uuid, uuid[], boolean, text)'),'EXECUTE')
              then '1' else '0' end),
       case when has_function_privilege('service_role',
              to_regprocedure('public.assign_lead_to_vendors(uuid, uuid[], boolean, text)'),'EXECUTE')
            then 'PASS' else 'FAIL' end,
       'legacy RPC EXECUTE posture untouched (revocation is Migration E)'

union all
select 23, 'D23_owner_binding_still_deferred', '0',
       (select count(*)::text from pg_catalog.pg_attribute
         where attrelid='public.leads'::regclass and not attisdropped
           and attname::text = any(array['client_account_id','user_id','created_by']::text[])),
       case when (select count(*) from pg_catalog.pg_attribute
                   where attrelid='public.leads'::regclass and not attisdropped
                     and attname::text = any(array['client_account_id','user_id','created_by']::text[]))=0
            then 'PASS' else 'FAIL' end,
       'R1_BLOCKED_PENDING_OWNER_BINDING remains unresolved and out of scope for D'

union all
select 24, 'D24_owner_break_glass_information', 'INFORMATIONAL',
       (select coalesce(pg_catalog.pg_get_userbyid(p.proowner),'unknown')
          from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.handle_new_user()')),
       'PASS',
       'the SECURITY DEFINER function owner is a privileged role; informational, non-blocking'

union all
select 25, 'D25_application_data_unchanged_by_d', 'INFORMATIONAL',
       (select concat('profiles=', (select count(*) from public.profiles),
                      ' vendors=', (select count(*) from public.vendors),
                      ' leads=', (select count(*) from public.leads))),
       'PASS',
       'D creates only a function and a trigger; it writes no application row'

-- ---------------------------------------------------------------------------
-- QF-MVP-20.3DR1 — PRINCIPAL-CLASSIFICATION CORRECTION
-- ---------------------------------------------------------------------------
union all
select 26, 'D26_profiles_role_nullable_for_neutral_principal', '1',
       (select count(*)::text from pg_catalog.pg_attribute
         where attrelid='public.profiles'::regclass and attnum>0 and not attisdropped
           and attname::text='role' and not attnotnull),
       case when (select count(*) from pg_catalog.pg_attribute
                   where attrelid='public.profiles'::regclass and attnum>0 and not attisdropped
                     and attname::text='role' and not attnotnull)=1
            then 'PASS' else 'FAIL' end,
       'an unclassified principal (first-time client OTP user) is initialised with the NEUTRAL null role, which requires role to stay nullable'

union all
select 27, 'D27_trusted_classification_source_declared', '1',
       (select case when pg_catalog.obj_description(to_regprocedure('public.handle_new_user()'),'pg_proc')
                      like '%raw_app_meta_data%'
                     and pg_catalog.obj_description(to_regprocedure('public.handle_new_user()'),'pg_proc')
                      like '%qf_principal%'
                    then '1' else '0' end),
       case when pg_catalog.obj_description(to_regprocedure('public.handle_new_user()'),'pg_proc')
                   like '%raw_app_meta_data%'
              and pg_catalog.obj_description(to_regprocedure('public.handle_new_user()'),'pg_proc')
                   like '%qf_principal%'
            then 'PASS' else 'FAIL' end,
       'the applied function declares the server-only app_metadata marker as its classification source. This reads the COMMENT catalog object authored by D, NOT function source text, so the B1R2 prohibition is respected; the source-level guarantee is graded offline.'

union all
select 28, 'D28_client_principal_model_intact', '1',
       (select count(*)::text from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
         where n.nspname::text='public' and c.relname::text='client_accounts' and c.relkind='r'),
       case when (select count(*) from pg_catalog.pg_class c
                    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
                   where n.nspname::text='public' and c.relname::text='client_accounts' and c.relkind='r')=1
            then 'PASS' else 'FAIL' end,
       'homeowner/client principals remain modelled by client_accounts, provisioned by the OTP verify path; D never creates a client account and never classifies a client as a vendor'

order by seq;
