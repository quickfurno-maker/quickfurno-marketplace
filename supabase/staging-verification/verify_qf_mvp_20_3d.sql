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
--   * QF-MVP-20.3B1R2 — no UNSTRIPPED lexical assertion over comment-retaining
--     catalog text. See the refinement below.
--   * QF-MVP-20.3B2R1 — every catalog `name` value is compared as text.
--   * QF-MVP-20.3CVR1 — any set comparison normalises BOTH sides in PostgreSQL;
--     a DB-sorted aggregate is never compared with a hand-ordered literal.
--
-- B1R2 REFINEMENT (QF-MVP-20.3DVR1)
--   B1R2 was adopted after a real B1 failure in which a NEGATIVE regex over
--   pg_get_functiondef() matched the function's OWN COMMENTS and aborted a
--   correct migration. The defect was the UNSTRIPPED SOURCE, not the idea of
--   inspecting source. The QF-MVP-20.3DP preflight then proved the opposite
--   failure: rows that read only obj_description() (the COMMENT) cannot detect
--   drift at all, because `create or replace function` and `comment on function`
--   are separate statements — a replaced body with the old COMMENT intact
--   FALSE-PASSED three separate drift mutations.
--
--   This verifier therefore asserts on pg_proc.prosrc AFTER STRIPPING COMMENTS
--   (see the d_body CTE). That satisfies both constraints at once: the proof is
--   about executable code, and a comment can neither cause a failure nor supply
--   a pass. pg_get_functiondef() is deliberately NOT used — prosrc is the
--   narrower, non-pretty-printed source of exactly the reviewed function.
--
--   Rows 26-28 carry the catalog-decidable half of the corrected contract, and
--   rows 27 + 29-37 prove the INSTALLED EXECUTABLE BODY implements the frozen
--   principal-classification contract.
--
-- TRIGGER TYPE BITS (pg_trigger.tgtype)
--   1 ROW · 2 BEFORE · 4 INSERT · 8 DELETE · 16 UPDATE · 32 TRUNCATE
--     5 = ROW|INSERT with the BEFORE bit UNSET  =>  AFTER INSERT FOR EACH ROW
--
-- OUTPUT: seq | check_name | expected | actual | status | details
-- ============================================================================

-- ---------------------------------------------------------------------------
-- INSTALLED-BODY SOURCE (QF-MVP-20.3DVR1)
--
-- `d_body` is the ACTUAL executable body of the installed function, taken from
-- pg_proc.prosrc (never from the COMMENT, and never from the volatile
-- pretty-printed pg_get_functiondef()), then made safe for lexical policy
-- checks in three ordered steps:
--
--   1. block comments  /* ... */   removed  (non-greedy; `.` matches newline)
--   2. line comments   -- ... EOL  removed  ('n' flag: `.` stops at newline and
--                                            `$` matches every line end)
--   3. whitespace collapsed to single spaces, then lower-cased
--
-- Steps 1-2 are what make the NEGATIVE assertions sound: D's body legitimately
-- names `raw_user_meta_data` and 'admin' inside explanatory comments that
-- describe what is forbidden, so an unstripped regex would FALSE-FAIL — the
-- mirror image of the QF-MVP-20.3B1R2 defect. After stripping, only executable
-- text remains, so a comment can neither cause a failure nor satisfy a proof.
--
-- Stripping is FAIL-CLOSED, not best-effort: if a string literal ever contained
-- `--`, step 2 would truncate it and row D35's exact literal allowlist would
-- stop matching. Damage therefore surfaces as a FAIL, never as a silent pass.
--
-- `d_lits` is the exact, de-duplicated, sorted set of single-quoted literals in
-- that executable body. It is the strongest single assertion here: it proves
-- positively which constants the installed function can use, and therefore
-- proves NEGATIVELY that 'admin' and 'superadmin' are absent from executable
-- code — without any whole-source negative regex.
-- ---------------------------------------------------------------------------
with d_fn as (
  select p.oid as fnoid, p.prosrc as raw_src
    from pg_catalog.pg_proc p
   where p.oid = to_regprocedure('public.handle_new_user()')
),
d_body as (
  select fnoid,
         lower(regexp_replace(
                 regexp_replace(
                   regexp_replace(raw_src, '/\*.*?\*/', ' ', 'g'),
                   '--.*$', ' ', 'gn'),
                 '\s+', ' ', 'g')) as body
    from d_fn
),
d_lits as (
  -- Dollar-quote the pattern so the single-quote characters do not have to be
  -- SQL-escaped: the ARE pattern is literally '([^']*)' — a quote, any run of
  -- non-quote characters captured, a quote. Over the lower-cased body this
  -- yields every executable string literal exactly once.
  select (select array_agg(distinct t.m[1] order by t.m[1])
            from regexp_matches(b.body, $lit$'([^']*)'$lit$, 'g') as t(m)) as literals
    from d_body b
)
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
select 27, 'D27_installed_body_obtainable_and_unique', '1',
       (select count(*)::text from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname::text = 'public' and p.proname::text = 'handle_new_user'),
       case when (select count(*) from pg_catalog.pg_proc p
                    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                   where n.nspname::text = 'public' and p.proname::text = 'handle_new_user') = 1
             and (select count(*) from d_body where body is not null and length(body) > 20) = 1
            then 'PASS' else 'FAIL' end,
       'exactly ONE public.handle_new_user exists (no overload ambiguity) and its actual executable body was obtained from pg_proc.prosrc and normalised. Every row below asserts on THAT body, never on the COMMENT.'

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

-- ---------------------------------------------------------------------------
-- QF-MVP-20.3DVR1 — INSTALLED-BODY PROOF (rows 29-37)
-- Every row below reads `d_body.body`: the comment-stripped, whitespace-
-- normalised pg_proc.prosrc of the installed function. A scalar subquery over
-- an empty d_body yields NULL, so a missing function FAILS every row.
-- ---------------------------------------------------------------------------
union all
select 29, 'D29_body_trusted_classification_source', '1',
       coalesce((select case when body ~ 'new\.raw_app_meta_data\s*->>\s*''qf_principal''' then '1' else '0' end
                   from d_body), 'ABSENT'),
       case when (select body ~ 'new\.raw_app_meta_data\s*->>\s*''qf_principal''' from d_body)
            then 'PASS' else 'FAIL' end,
       'A. TRUSTED SOURCE — the installed body reads the server-only app_metadata marker new.raw_app_meta_data->>''qf_principal''. Executable code, not COMMENT.'

union all
select 30, 'D30_body_vendor_marker_yields_vendor', '1',
       coalesce((select case when body ~ 'if\s+[a-z0-9_]+\s*=\s*''vendor''\s+then\s+[a-z0-9_]+\s*:=\s*''vendor''\s*;' then '1' else '0' end
                   from d_body), 'ABSENT'),
       case when (select body ~ 'if\s+[a-z0-9_]+\s*=\s*''vendor''\s+then\s+[a-z0-9_]+\s*:=\s*''vendor''\s*;' from d_body)
            then 'PASS' else 'FAIL' end,
       'B. EXACT OUTPUT — an exact equality test against the marker value ''vendor'' is the only thing that assigns the vendor role. Variable names are matched structurally, so a rename does not false-fail.'

union all
select 31, 'D31_body_neutral_null_default', '1',
       coalesce((select case when body ~ 'else\s+[a-z0-9_]+\s*:=\s*null\s*;\s*end\s+if\s*;' then '1' else '0' end
                   from d_body), 'ABSENT'),
       case when (select body ~ 'else\s+[a-z0-9_]+\s*:=\s*null\s*;\s*end\s+if\s*;' from d_body)
            then 'PASS' else 'FAIL' end,
       'B. EXACT OUTPUT — an absent or unknown marker falls through to SQL NULL (the neutral, unprivileged role), not to a vendor default.'

union all
select 32, 'D32_body_insert_shape_role_not_literal', '1',
       coalesce((select case when body ~ ('insert\s+into\s+public\.profiles\s*\(\s*id\s*,\s*full_name\s*,\s*phone\s*,\s*role\s*\)'
                                       || '\s*values\s*\(\s*new\.id\s*,\s*new\.raw_user_meta_data\s*->>\s*''full_name''\s*,'
                                       || '\s*new\.raw_user_meta_data\s*->>\s*''phone''\s*,\s*[a-z0-9_]+\s*\)'
                                       || '\s*on\s+conflict\s*\(\s*id\s*\)\s*do\s+nothing\s*;') then '1' else '0' end
                   from d_body), 'ABSENT'),
       case when (select body ~ ('insert\s+into\s+public\.profiles\s*\(\s*id\s*,\s*full_name\s*,\s*phone\s*,\s*role\s*\)'
                              || '\s*values\s*\(\s*new\.id\s*,\s*new\.raw_user_meta_data\s*->>\s*''full_name''\s*,'
                              || '\s*new\.raw_user_meta_data\s*->>\s*''phone''\s*,\s*[a-z0-9_]+\s*\)'
                              || '\s*on\s+conflict\s*\(\s*id\s*\)\s*do\s+nothing\s*;') from d_body)
            then 'PASS' else 'FAIL' end,
       'B+C+E in one structural shape — exact target and column list; full_name/phone are the only user-metadata reads; the ROLE position is an IDENTIFIER, never a literal (so no blanket role assignment can exist); and the conflict clause is DO NOTHING.'

union all
select 33, 'D33_body_role_not_from_user_metadata', '0',
       coalesce((select ((case when body ~ ':=\s*[^;]*raw_user_meta_data' then 1 else 0 end)
                       + (case when body ~ ('raw_user_meta_data\s*->>\s*''(role|admin|admin_role|is_admin|superadmin|verified'
                                         || '|verification_status|package|package_status|paid|paid_status|credits'
                                         || '|remaining_credits|total_credits|status|approved)''') then 1 else 0 end))::text
                   from d_body), 'ABSENT'),
       case when (select ((case when body ~ ':=\s*[^;]*raw_user_meta_data' then 1 else 0 end)
                        + (case when body ~ ('raw_user_meta_data\s*->>\s*''(role|admin|admin_role|is_admin|superadmin|verified'
                                          || '|verification_status|package|package_status|paid|paid_status|credits'
                                          || '|remaining_credits|total_credits|status|approved)''') then 1 else 0 end)) = 0
                   from d_body)
            then 'PASS' else 'FAIL' end,
       'C. UNTRUSTED BOUNDARY — no assignment expression is fed by raw_user_meta_data, and no privileged key is read from it. The allowlisted DISPLAY reads (full_name, phone) are permitted and proved by row D32, so this negative cannot false-fail on them.'

union all
select 34, 'D34_body_no_privileged_role_branch', '0',
       coalesce((select ((case when body ~ '''admin''' then 1 else 0 end)
                       + (case when body ~ '''superadmin''' then 1 else 0 end)
                       + (case when body ~ 'admin_role' then 1 else 0 end)
                       + (case when body ~ 'is_admin' then 1 else 0 end))::text
                   from d_body), 'ABSENT'),
       case when (select ((case when body ~ '''admin''' then 1 else 0 end)
                        + (case when body ~ '''superadmin''' then 1 else 0 end)
                        + (case when body ~ 'admin_role' then 1 else 0 end)
                        + (case when body ~ 'is_admin' then 1 else 0 end)) = 0
                   from d_body)
            then 'PASS' else 'FAIL' end,
       'D. PRIVILEGED ROLE ABSENCE — no executable branch can initialise admin or superadmin. Asserted on the COMMENT-STRIPPED body, so D''s own explanatory comments (which legitimately mention ''admin'') cannot false-fail this row.'

union all
select 35, 'D35_body_string_literal_allowlist_exact', 'full_name,phone,qf_principal,vendor',
       coalesce((select array_to_string(literals, ',') from d_lits), 'ABSENT'),
       case when (select literals from d_lits)
                 = (select array_agg(distinct x order by x)
                      from unnest(array['vendor','full_name','qf_principal','phone']::text[]) x)
            then 'PASS' else 'FAIL' end,
       'THE EXHAUSTIVE CONSTANT PROOF — the complete de-duplicated set of string literals in the executable body is exactly {full_name, phone, qf_principal, vendor}. Positively proves the trusted key and marker exist; negatively proves NO other constant (admin, superadmin, any package/credit/status value) can appear. Both sides are sorted BY POSTGRESQL — the expected literal is deliberately left hand-unordered so the normalisation stays load-bearing (QF-MVP-20.3CVR1 policy).'

union all
select 36, 'D36_body_idempotent_no_overwrite', '1',
       coalesce((select case when body ~ 'on\s+conflict\s*\(\s*id\s*\)\s*do\s+nothing'
                          and body !~ 'do\s+update'
                          and body !~ 'update\s+public\.profiles'
                          and body !~ 'delete\s+from\s+public\.profiles'
                         then '1' else '0' end from d_body), 'ABSENT'),
       case when (select body ~ 'on\s+conflict\s*\(\s*id\s*\)\s*do\s+nothing'
                     and body !~ 'do\s+update'
                     and body !~ 'update\s+public\.profiles'
                     and body !~ 'delete\s+from\s+public\.profiles'
                    from d_body)
            then 'PASS' else 'FAIL' end,
       'E. IDEMPOTENCY — the installed body retains ON CONFLICT (id) DO NOTHING and introduces no overwrite, update or delete path against profiles.'

union all
select 37, 'D37_body_stable_behaviour', '1',
       coalesce((select case when body ~ 'return\s+new\s*;'
                          and body !~ 'execute\s'
                          and body !~ 'dblink|pg_read_file|pg_read_server_files|copy\s'
                          and body !~ ('insert\s+into\s+public\.(vendors|vendor_packages|vendor_credit_logs|payments'
                                    || '|lead_assignments|assignment_operations|client_accounts|vendor_dashboard_users)')
                         then '1' else '0' end from d_body), 'ABSENT'),
       case when (select body ~ 'return\s+new\s*;'
                     and body !~ 'execute\s'
                     and body !~ 'dblink|pg_read_file|pg_read_server_files|copy\s'
                     and body !~ ('insert\s+into\s+public\.(vendors|vendor_packages|vendor_credit_logs|payments'
                               || '|lead_assignments|assignment_operations|client_accounts|vendor_dashboard_users)')
                    from d_body)
            then 'PASS' else 'FAIL' end,
       'F. STABLE BEHAVIOUR — the body returns NEW, contains no dynamic SQL, makes no external/file call, and mutates no vendor, credit, package, verification, assignment or client-account state.'

order by seq;
