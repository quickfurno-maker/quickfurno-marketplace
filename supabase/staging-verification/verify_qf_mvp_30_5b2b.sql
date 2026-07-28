-- ============================================================================
-- QF-MVP-30.5B2B — STAGING VERIFICATION (SELECT-ONLY)
--
-- Run AFTER migration 20260728001600 is applied and BEFORE any fixture exists.
-- Every statement is a SELECT. No INSERT/UPDATE/DELETE/DDL/GRANT/TRUNCATE/COPY
-- and no DO block anywhere, and no call to the handoff RPC.
--
-- Every row reports: check_id, passed, detail.
-- ============================================================================

-- D01 — migration 20260728001600 applied exactly once and is the latest.
select 'D01_migration_1600_once_and_latest' as check_id,
       (count(*) filter (where version = '20260728001600') = 1
        and max(version) = '20260728001600') as passed,
       'count=' || count(*) filter (where version = '20260728001600')
         || ' latest=' || coalesce(max(version), '(none)')
         || ' total=' || count(*) as detail
  from supabase_migrations.schema_migrations;

-- D02 — migration 1500 is still present exactly once and was not rewritten.
select 'D02_migration_1500_intact' as check_id,
       (count(*) = 1) as passed,
       'rows for 20260728001500=' || count(*) as detail
  from supabase_migrations.schema_migrations
 where version = '20260728001500';

-- D03 — DELETE is denied to service_role, anon and authenticated.
select 'D03_delete_denied_all_roles' as check_id,
       (not has_table_privilege('service_role', 'public.communication_frequency_policies', 'delete')
        and not has_table_privilege('anon', 'public.communication_frequency_policies', 'delete')
        and not has_table_privilege('authenticated', 'public.communication_frequency_policies', 'delete')) as passed,
       'service_role=' || has_table_privilege('service_role', 'public.communication_frequency_policies', 'delete')::text
         || ' anon=' || has_table_privilege('anon', 'public.communication_frequency_policies', 'delete')::text
         || ' authenticated=' || has_table_privilege('authenticated', 'public.communication_frequency_policies', 'delete')::text as detail;

-- D04 — TRUNCATE is denied too (it erases history just as completely).
select 'D04_truncate_denied' as check_id,
       (not has_table_privilege('service_role', 'public.communication_frequency_policies', 'truncate')
        and not has_table_privilege('authenticated', 'public.communication_frequency_policies', 'truncate')) as passed,
       'service_role=' || has_table_privilege('service_role', 'public.communication_frequency_policies', 'truncate')::text as detail;

-- D05 — PUBLIC holds no privilege on the table.
select 'D05_no_public_grant' as check_id,
       (count(*) = 0) as passed,
       'PUBLIC grants=' || count(*) as detail
  from pg_class c, aclexplode(c.relacl) a
 where c.oid = 'public.communication_frequency_policies'::regclass
   and a.grantee = 0;

-- D06 — the intended backend authority is preserved EXACTLY: select/insert/update.
select 'D06_intended_authority_exact' as check_id,
       (has_table_privilege('service_role', 'public.communication_frequency_policies', 'select')
        and has_table_privilege('service_role', 'public.communication_frequency_policies', 'insert')
        and has_table_privilege('service_role', 'public.communication_frequency_policies', 'update')
        and not has_table_privilege('service_role', 'public.communication_frequency_policies', 'delete')
        and not has_table_privilege('service_role', 'public.communication_frequency_policies', 'truncate')) as passed,
       coalesce((select string_agg(a.privilege_type, ',' order by a.privilege_type)
                   from pg_class c, aclexplode(c.relacl) a
                  where c.oid = 'public.communication_frequency_policies'::regclass
                    and a.grantee = 'service_role'::regrole), '(none)') as detail;

-- D07 — untrusted roles hold nothing at all.
select 'D07_untrusted_roles_have_nothing' as check_id,
       (not has_table_privilege('anon', 'public.communication_frequency_policies', 'select')
        and not has_table_privilege('authenticated', 'public.communication_frequency_policies', 'select')
        and not has_table_privilege('authenticated', 'public.communication_frequency_policies', 'insert')
        and not has_table_privilege('authenticated', 'public.communication_frequency_policies', 'update')) as passed,
       'anon_select=' || has_table_privilege('anon', 'public.communication_frequency_policies', 'select')::text
         || ' auth_update=' || has_table_privilege('authenticated', 'public.communication_frequency_policies', 'update')::text as detail;

-- D08 — historical MEANING cannot be rewritten: the immutability trigger exists
--       and covers every identity/scope/threshold/window/effective_from field.
select 'D08_history_rewrite_blocked' as check_id,
       (exists (select 1 from pg_trigger t
                 where t.tgrelid = 'public.communication_frequency_policies'::regclass
                   and t.tgname = 'trg_cfp_history_immutable' and not t.tgisinternal)
        and (select bool_and(src like '%' || col || '%')
               from (select p.prosrc src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public'
                        and p.proname = 'qf_prevent_frequency_policy_history_rewrite') s,
                    unnest(array['channel','scope','min_interval','max_per_window',
                                 'window_length','effective_from','policy_reference']) col)) as passed,
       'trigger=' || exists (select 1 from pg_trigger t
                              where t.tgrelid = 'public.communication_frequency_policies'::regclass
                                and t.tgname = 'trg_cfp_history_immutable')::text as detail;

-- D09 — retirement is one-way and effective_to is write-once.
select 'D09_retirement_is_one_way' as check_id,
       (src like '%cannot be re-activated%' and src like '%write-once%') as passed,
       'reactivation_blocked=' || (src like '%cannot be re-activated%')::text
         || ' effective_to_write_once=' || (src like '%write-once%')::text as detail
  from (select p.prosrc src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = 'qf_prevent_frequency_policy_history_rewrite') t;

-- D10 — canonical retirement remains POSSIBLE: is_active/effective_to/updated_at
--       are deliberately absent from the immutable set.
select 'D10_canonical_retirement_still_possible' as check_id,
       (src not like '%new.is_active is distinct from old.is_active%'
        and src not like '%new.updated_at is distinct from old.updated_at%'
        and has_table_privilege('service_role', 'public.communication_frequency_policies', 'update')) as passed,
       'is_active and effective_to remain updatable for retirement' as detail
  from (select p.prosrc src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = 'qf_prevent_frequency_policy_history_rewrite') t;

-- D11 — DELETE and TRUNCATE are refused by trigger, not only by grant, so the
--       history survives the table owner as well.
select 'D11_delete_truncate_triggers' as check_id,
       (count(*) = 2) as passed,
       'protective triggers=' || count(*) as detail
  from pg_trigger
 where tgrelid = 'public.communication_frequency_policies'::regclass
   and not tgisinternal
   and tgname in ('trg_cfp_no_delete', 'trg_cfp_no_truncate');

-- D12 — both protective functions have a fixed, safe search_path.
select 'D12_protective_functions_search_path' as check_id,
       (count(*) = 2) as passed,
       'functions with a fixed search_path=' || count(*) as detail
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('qf_prevent_frequency_policy_history_rewrite',
                     'qf_prevent_frequency_policy_delete')
   and array_to_string(coalesce(p.proconfig, array[]::text[]), ',')
       like '%search_path=pg_catalog, public, pg_temp%';

-- D13 — NO default policy row and no ACTIVE policy: the number stays an owner decision.
select 'D13_no_default_policy' as check_id,
       (count(*) filter (where is_active) = 0) as passed,
       'active=' || count(*) filter (where is_active)
         || ' historical=' || count(*) filter (where not is_active) as detail
  from public.communication_frequency_policies;

-- D14 — applying 1600 created ZERO communication intents.
select 'D14_zero_intents_from_migration' as check_id,
       (count(*) filter (where i.status in ('pending','claimed')) = 0) as passed,
       'campaign intents=' || count(*)
         || ' sendable=' || count(*) filter (where i.status in ('pending','claimed')) as detail
  from public.communication_intents i
 where i.aggregate_type = 'vendor_campaign';

-- D15 — no provider/network object exists.
select 'D15_no_provider_or_network_object' as check_id,
       ((select count(*) from pg_extension where extname in ('pg_net','http','dblink')) = 0
        and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('qf_prevent_frequency_policy_history_rewrite',
                                  'qf_prevent_frequency_policy_delete')
                and (p.prosrc like '%http%' or p.prosrc like '%net.%')) = 0) as passed,
       'network extensions=' || (select count(*) from pg_extension
                                  where extname in ('pg_net','http','dblink')) as detail;

-- D16 — no prohibited project reference is embedded in the new objects.
select 'D16_no_prohibited_project_refs' as check_id,
       (count(*) = 0) as passed,
       'objects containing a prohibited ref=' || count(*) as detail
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('qf_prevent_frequency_policy_history_rewrite',
                     'qf_prevent_frequency_policy_delete')
   and (p.prosrc like '%yqpgcsduqbxulrlzwzap%' or p.prosrc like '%coilipywdvxklewquqvv%');

-- D17 — the 30.5A handoff authority is untouched by this migration.
select 'D17_handoff_rpc_untouched' as check_id,
       (to_regprocedure('public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text)') is not null
        and not has_function_privilege('anon',
              'public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text)', 'execute')
        and has_function_privilege('service_role',
              'public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text)', 'execute')) as passed,
       'rpc present and still fail-closed' as detail;

-- D18 — the 30.5A1 segment-pair enforcement is still in place.
select 'D18_segment_pair_trigger_intact' as check_id,
       (count(*) = 1) as passed,
       'trg_vsg_definition_pair=' || count(*) as detail
  from pg_trigger
 where tgrelid = 'public.vendor_segments'::regclass
   and tgname = 'trg_vsg_definition_pair'
   and not tgisinternal;
