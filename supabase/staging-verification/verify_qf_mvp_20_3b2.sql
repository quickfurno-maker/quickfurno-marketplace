-- ============================================================================
-- QuickFurno — QF-MVP-20.3B2 — POST-APPLICATION VERIFICATION (SELECT-ONLY)
--
-- SCOPE
--   Verifies the expected database state AFTER applying:
--     20260723000500_qf_mvp_assignment_universal_enforcement.sql   (B2)
--   on top of the already-applied, immutable A / A2 / B1 / G.
--
-- THIS FILE DOES NOT REPLACE OR WEAKEN ANY EARLIER VERIFIER
--   supabase/staging-baseline/verify_qf_mvp_staging_baseline.sql and
--   supabase/staging-verification/verify_qf_mvp_20_3b1.sql are NOT modified,
--   NOT replaced and NOT relaxed by this phase. This file verifies only the
--   B2 delta plus the earlier invariants B2 depends on.
--
-- SELECT-ONLY BY CONSTRUCTION
--   The entire file is ONE read-only statement: a chain of SELECT ... UNION ALL
--   branches. It contains no INSERT, UPDATE, DELETE, MERGE, TRUNCATE, CREATE,
--   ALTER, DROP, GRANT, REVOKE, COPY, CALL, DO or SET. Every acceptance row
--   produces PASS or FAIL without executing a single DML statement, so the
--   enforcement triggers are proved STRUCTURALLY (catalog facts) and are never
--   exercised by writing a row.
--
-- ENVIRONMENT AGNOSTIC
--   Every expectation is a fixed structural contract or is derived from live
--   data. No environment-specific row count is used as an expectation, so the
--   same verdicts hold against empty staging and against a production-shaped
--   database.
--
-- LOCKED POLICY — NO LEXICAL ASSERTIONS OVER RAW SOURCE (QF-MVP-20.3B1R2)
--   No row below inspects pg_get_functiondef(), pg_proc.prosrc or
--   information_schema routine-definition text. That output retains COMMENTS
--   and STRING LITERALS, and a regex over it is what aborted Migration B1
--   during QF-MVP-20.3B1A. Every assertion here is a catalog fact:
--   to_regprocedure, pg_proc.prosecdef/proconfig, pg_trigger.tgtype/tgenabled,
--   pg_class, pg_constraint, pg_index and has_*_privilege.
--
-- TRIGGER TYPE BITS (pg_trigger.tgtype)
--   1 ROW · 2 BEFORE · 4 INSERT · 8 DELETE · 16 UPDATE · 32 TRUNCATE
--     23 = ROW|BEFORE|INSERT|UPDATE          (active cap)
--      7 = ROW|BEFORE|INSERT                 (lifetime cap)
--     27 = ROW|BEFORE|DELETE|UPDATE          (lineage immutability)
--     34 = BEFORE|TRUNCATE, statement-level  (lineage truncate guard)
--
-- OUTPUT: seq | check_name | expected | actual | status | details
-- ============================================================================

select 1 as seq, 'B01_migration_history_b2_once' as check_name,
       '1' as expected,
       (select count(*)::text from supabase_migrations.schema_migrations
         where version = '20260723000500') as actual,
       case when (select count(*) from supabase_migrations.schema_migrations
                   where version = '20260723000500') = 1
            then 'PASS' else 'FAIL' end as status,
       'B2 recorded exactly once; no history falsification' as details

union all
select 2, 'B02_enforcement_functions_present', '4',
       (select count(*)::text from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.pronargs = 0
           and p.proname in ('qf_enforce_lead_assignment_active_cap',
                             'qf_enforce_lead_lifetime_vendor_cap',
                             'qf_prevent_lead_assignment_event_mutation',
                             'qf_prevent_lead_assignment_event_truncate')),
       case when (select count(*) from pg_catalog.pg_proc p
                    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.pronargs = 0
                     and p.proname in ('qf_enforce_lead_assignment_active_cap',
                                       'qf_enforce_lead_lifetime_vendor_cap',
                                       'qf_prevent_lead_assignment_event_mutation',
                                       'qf_prevent_lead_assignment_event_truncate')) = 4
            then 'PASS' else 'FAIL' end,
       'each exactly once, zero-argument trigger functions'

union all
select 3, 'B03_cap_functions_security_definer', '2',
       (select count(*)::text from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef
           and p.proname in ('qf_enforce_lead_assignment_active_cap',
                             'qf_enforce_lead_lifetime_vendor_cap')),
       case when (select count(*) from pg_catalog.pg_proc p
                    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.prosecdef
                     and p.proname in ('qf_enforce_lead_assignment_active_cap',
                                       'qf_enforce_lead_lifetime_vendor_cap')) = 2
            then 'PASS' else 'FAIL' end,
       'RLS must never hide rows from a cap check'

union all
select 4, 'B04_cap_functions_pinned_search_path', '2',
       (select count(*)::text from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('qf_enforce_lead_assignment_active_cap',
                             'qf_enforce_lead_lifetime_vendor_cap')
           and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                        where cfg like 'search_path=%' and cfg like '%pg_catalog%')),
       case when (select count(*) from pg_catalog.pg_proc p
                    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('qf_enforce_lead_assignment_active_cap',
                                       'qf_enforce_lead_lifetime_vendor_cap')
                     and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                                  where cfg like 'search_path=%' and cfg like '%pg_catalog%')) = 2
            then 'PASS' else 'FAIL' end,
       'structural proconfig check, never exact string equality'

union all
select 5, 'B05_enforcement_functions_not_untrusted_executable', '0',
       (select count(*)::text from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.pronargs = 0
           and p.proname in ('qf_enforce_lead_assignment_active_cap',
                             'qf_enforce_lead_lifetime_vendor_cap',
                             'qf_prevent_lead_assignment_event_mutation',
                             'qf_prevent_lead_assignment_event_truncate')
           and (has_function_privilege('public', p.oid, 'EXECUTE')
             or has_function_privilege('anon', p.oid, 'EXECUTE')
             or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
       case when (select count(*) from pg_catalog.pg_proc p
                    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.pronargs = 0
                     and p.proname in ('qf_enforce_lead_assignment_active_cap',
                                       'qf_enforce_lead_lifetime_vendor_cap',
                                       'qf_prevent_lead_assignment_event_mutation',
                                       'qf_prevent_lead_assignment_event_truncate')
                     and (has_function_privilege('public', p.oid, 'EXECUTE')
                       or has_function_privilege('anon', p.oid, 'EXECUTE')
                       or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) = 0
            then 'PASS' else 'FAIL' end,
       'effective privilege check; PUBLIC/anon/authenticated hold nothing'

union all
select 6, 'B06_trigger_active_cap_wiring', '1',
       (select count(*)::text from pg_catalog.pg_trigger t
          join pg_catalog.pg_class c on c.oid = t.tgrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where not t.tgisinternal and n.nspname = 'public'
           and t.tgname = 'trg_lead_assignments_active_cap'
           and c.relname = 'lead_assignments'
           and t.tgtype = 23 and t.tgenabled = 'O'),
       case when (select count(*) from pg_catalog.pg_trigger t
                    join pg_catalog.pg_class c on c.oid = t.tgrelid
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   where not t.tgisinternal and n.nspname = 'public'
                     and t.tgname = 'trg_lead_assignments_active_cap'
                     and c.relname = 'lead_assignments'
                     and t.tgtype = 23 and t.tgenabled = 'O') = 1
            then 'PASS' else 'FAIL' end,
       'BEFORE INSERT OR UPDATE FOR EACH ROW on lead_assignments, enabled'

union all
select 7, 'B07_trigger_lifetime_cap_wiring', '1',
       (select count(*)::text from pg_catalog.pg_trigger t
          join pg_catalog.pg_class c on c.oid = t.tgrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where not t.tgisinternal and n.nspname = 'public'
           and t.tgname = 'trg_lead_assignment_events_lifetime_cap'
           and c.relname = 'lead_assignment_events'
           and t.tgtype = 7 and t.tgenabled = 'O'),
       case when (select count(*) from pg_catalog.pg_trigger t
                    join pg_catalog.pg_class c on c.oid = t.tgrelid
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   where not t.tgisinternal and n.nspname = 'public'
                     and t.tgname = 'trg_lead_assignment_events_lifetime_cap'
                     and c.relname = 'lead_assignment_events'
                     and t.tgtype = 7 and t.tgenabled = 'O') = 1
            then 'PASS' else 'FAIL' end,
       'BEFORE INSERT FOR EACH ROW on lead_assignment_events, enabled'

union all
select 8, 'B08_trigger_lineage_immutable_wiring', '1',
       (select count(*)::text from pg_catalog.pg_trigger t
          join pg_catalog.pg_class c on c.oid = t.tgrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where not t.tgisinternal and n.nspname = 'public'
           and t.tgname = 'trg_lead_assignment_events_immutable'
           and c.relname = 'lead_assignment_events'
           and t.tgtype = 27 and t.tgenabled = 'O'),
       case when (select count(*) from pg_catalog.pg_trigger t
                    join pg_catalog.pg_class c on c.oid = t.tgrelid
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   where not t.tgisinternal and n.nspname = 'public'
                     and t.tgname = 'trg_lead_assignment_events_immutable'
                     and c.relname = 'lead_assignment_events'
                     and t.tgtype = 27 and t.tgenabled = 'O') = 1
            then 'PASS' else 'FAIL' end,
       'BEFORE UPDATE OR DELETE FOR EACH ROW on lead_assignment_events, enabled'

union all
select 9, 'B09_trigger_lineage_truncate_guard_wiring', '1',
       (select count(*)::text from pg_catalog.pg_trigger t
          join pg_catalog.pg_class c on c.oid = t.tgrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where not t.tgisinternal and n.nspname = 'public'
           and t.tgname = 'trg_lead_assignment_events_no_truncate'
           and c.relname = 'lead_assignment_events'
           and t.tgtype = 34 and t.tgenabled = 'O'),
       case when (select count(*) from pg_catalog.pg_trigger t
                    join pg_catalog.pg_class c on c.oid = t.tgrelid
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   where not t.tgisinternal and n.nspname = 'public'
                     and t.tgname = 'trg_lead_assignment_events_no_truncate'
                     and c.relname = 'lead_assignment_events'
                     and t.tgtype = 34 and t.tgenabled = 'O') = 1
            then 'PASS' else 'FAIL' end,
       'BEFORE TRUNCATE FOR EACH STATEMENT on lead_assignment_events, enabled'

union all
select 10, 'B10_no_unexpected_trigger_on_enforced_tables', '0',
       (select count(*)::text from pg_catalog.pg_trigger t
          join pg_catalog.pg_class c on c.oid = t.tgrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where not t.tgisinternal and n.nspname = 'public'
           and c.relname in ('lead_assignments', 'lead_assignment_events')
           and t.tgname not in ('trg_lead_assignments_active_cap',
                                'trg_lead_assignment_events_lifetime_cap',
                                'trg_lead_assignment_events_immutable',
                                'trg_lead_assignment_events_no_truncate')),
       case when (select count(*) from pg_catalog.pg_trigger t
                    join pg_catalog.pg_class c on c.oid = t.tgrelid
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   where not t.tgisinternal and n.nspname = 'public'
                     and c.relname in ('lead_assignments', 'lead_assignment_events')
                     and t.tgname not in ('trg_lead_assignments_active_cap',
                                          'trg_lead_assignment_events_lifetime_cap',
                                          'trg_lead_assignment_events_immutable',
                                          'trg_lead_assignment_events_no_truncate')) = 0
            then 'PASS' else 'FAIL' end,
       'scope fence: B2 declared four triggers and installed no others'

union all
select 11, 'B11_active_count_index_present', '1',
       (select count(*)::text from pg_catalog.pg_class
         where relname = 'idx_lead_assignments_active' and relkind = 'i'),
       case when (select count(*) from pg_catalog.pg_class
                   where relname = 'idx_lead_assignments_active' and relkind = 'i') = 1
            then 'PASS' else 'FAIL' end,
       'Migration A index that serves the active-three count; B2 adds none'

union all
select 12, 'B12_lifetime_count_index_present', '1',
       (select count(*)::text from pg_catalog.pg_class
         where relname = 'idx_lead_assignment_events_lifetime' and relkind = 'i'),
       case when (select count(*) from pg_catalog.pg_class
                   where relname = 'idx_lead_assignment_events_lifetime' and relkind = 'i') = 1
            then 'PASS' else 'FAIL' end,
       'Migration A index that serves the lifetime-six count; B2 adds none'

union all
select 13, 'B13_assignment_uniqueness_preserved', '1',
       (select count(*)::text from pg_catalog.pg_constraint con
          join pg_catalog.pg_class c on c.oid = con.conrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'lead_assignments' and con.contype = 'u'
           and (select array_agg(a.attname::text order by a.attname::text)
                  from unnest(con.conkey) k
                  join pg_catalog.pg_attribute a
                    on a.attrelid = con.conrelid and a.attnum = k)
               = array['lead_id','vendor_id']::text[]),
       case when (select count(*) from pg_catalog.pg_constraint con
                    join pg_catalog.pg_class c on c.oid = con.conrelid
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = 'lead_assignments' and con.contype = 'u'
                     and (select array_agg(a.attname::text order by a.attname::text)
                            from unnest(con.conkey) k
                            join pg_catalog.pg_attribute a
                              on a.attrelid = con.conrelid and a.attnum = k)
                         = array['lead_id','vendor_id']::text[]) = 1
            then 'PASS' else 'FAIL' end,
       'UNIQUE (lead_id, vendor_id) settles duplicate races'

union all
select 14, 'B14_event_idempotency_uniqueness_preserved', '1',
       (select count(*)::text from pg_catalog.pg_constraint
         where conname = 'uq_lead_assignment_events_idempotency' and contype = 'u'),
       case when (select count(*) from pg_catalog.pg_constraint
                   where conname = 'uq_lead_assignment_events_idempotency' and contype = 'u') = 1
            then 'PASS' else 'FAIL' end,
       'event idempotency remains unique by event_idempotency_key'

union all
select 15, 'B15_no_lead_vendor_uniqueness_on_events', '0',
       (select count(*)::text from pg_catalog.pg_constraint con
          join pg_catalog.pg_class c on c.oid = con.conrelid
         where c.relname = 'lead_assignment_events' and con.contype = 'u'
           and (select array_agg(a.attname::text order by a.attname::text)
                  from unnest(con.conkey) k
                  join pg_catalog.pg_attribute a
                    on a.attrelid = con.conrelid and a.attnum = k)
               = array['lead_id','vendor_id']::text[]),
       case when (select count(*) from pg_catalog.pg_constraint con
                    join pg_catalog.pg_class c on c.oid = con.conrelid
                   where c.relname = 'lead_assignment_events' and con.contype = 'u'
                     and (select array_agg(a.attname::text order by a.attname::text)
                            from unnest(con.conkey) k
                            join pg_catalog.pg_attribute a
                              on a.attrelid = con.conrelid and a.attnum = k)
                         = array['lead_id','vendor_id']::text[]) = 0
            then 'PASS' else 'FAIL' end,
       'QF-MVP-20.3A1R regression guard: the event stream is not pair-unique'

union all
select 16, 'B16_replacement_single_open_index_present', '1',
       (select count(*)::text from pg_catalog.pg_class
         where relname = 'uq_replacement_requests_open_per_lead' and relkind = 'i'),
       case when (select count(*) from pg_catalog.pg_class
                   where relname = 'uq_replacement_requests_open_per_lead' and relkind = 'i') = 1
            then 'PASS' else 'FAIL' end,
       'one open replacement per lead; Migration A owns this, B2 adds nothing'

union all
select 17, 'B17_replacement_open_state_definition_exact', '1',
       (select count(*)::text from pg_catalog.pg_index i
          join pg_catalog.pg_class ic on ic.oid = i.indexrelid
         where ic.relname = 'uq_replacement_requests_open_per_lead'
           and i.indisunique
           and pg_catalog.pg_get_expr(i.indpred, i.indrelid) like '%requested%'
           and pg_catalog.pg_get_expr(i.indpred, i.indrelid) like '%approved%'
           and pg_catalog.pg_get_expr(i.indpred, i.indrelid) like '%activating%'),
       case when (select count(*) from pg_catalog.pg_index i
                    join pg_catalog.pg_class ic on ic.oid = i.indexrelid
                   where ic.relname = 'uq_replacement_requests_open_per_lead'
                     and i.indisunique
                     and pg_catalog.pg_get_expr(i.indpred, i.indrelid) like '%requested%'
                     and pg_catalog.pg_get_expr(i.indpred, i.indrelid) like '%approved%'
                     and pg_catalog.pg_get_expr(i.indpred, i.indrelid) like '%activating%') = 1
            then 'PASS' else 'FAIL' end,
       'open = {requested, approved, activating}; index predicate, not function text'

union all
select 18, 'B18_canonical_b1_functions_intact', '5',
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
                   where to_regprocedure(s.sig) is not null) = 5
            then 'PASS' else 'FAIL' end,
       'B2 changed no canonical API signature'

union all
select 19, 'B19_canonical_authority_still_service_role_only', '1',
       (select count(*)::text
          where has_function_privilege('service_role',
                 to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'), 'EXECUTE')
            and not has_function_privilege('public',
                 to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'), 'EXECUTE')
            and not has_function_privilege('anon',
                 to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'), 'EXECUTE')
            and not has_function_privilege('authenticated',
                 to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'), 'EXECUTE')),
       case when (select count(*)
                    where has_function_privilege('service_role',
                           to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'), 'EXECUTE')
                      and not has_function_privilege('public',
                           to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'), 'EXECUTE')
                      and not has_function_privilege('anon',
                           to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'), 'EXECUTE')
                      and not has_function_privilege('authenticated',
                           to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'), 'EXECUTE')) = 1
            then 'PASS' else 'FAIL' end,
       'B2 neither broadened nor narrowed the authority grant'

union all
select 20, 'B20_lineage_untrusted_table_privileges', '0',
       (select count(*)::text from unnest(array['public','anon','authenticated']) r(role_name)
          cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
         where has_table_privilege(r.role_name, 'public.lead_assignment_events', p.priv)),
       case when (select count(*) from unnest(array['public','anon','authenticated']) r(role_name)
                    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
                   where has_table_privilege(r.role_name, 'public.lead_assignment_events', p.priv)) = 0
            then 'PASS' else 'FAIL' end,
       'Migration G boundary preserved: untrusted roles hold nothing'

union all
select 21, 'B21_lineage_service_role_forbidden_privileges', '0',
       (select count(*)::text from unnest(array['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
         where has_table_privilege('service_role', 'public.lead_assignment_events', p.priv)),
       case when (select count(*) from unnest(array['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
                   where has_table_privilege('service_role', 'public.lead_assignment_events', p.priv)) = 0
            then 'PASS' else 'FAIL' end,
       'Migration G boundary preserved: service_role cannot mutate lineage'

union all
select 22, 'B22_lineage_service_role_required_privileges', '2',
       (select count(*)::text from unnest(array['SELECT','INSERT']) p(priv)
         where has_table_privilege('service_role', 'public.lead_assignment_events', p.priv)),
       case when (select count(*) from unnest(array['SELECT','INSERT']) p(priv)
                   where has_table_privilege('service_role', 'public.lead_assignment_events', p.priv)) = 2
            then 'PASS' else 'FAIL' end,
       'append-only means SELECT + INSERT, and B2 did not remove them'

union all
select 23, 'B23_lineage_owner_break_glass_information', 'INFORMATIONAL',
       (select coalesce(max(pg_catalog.pg_get_userbyid(c.relowner)), 'unknown')
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'lead_assignment_events'),
       'PASS',
       'Owner authority is documented break-glass, NOT an application-role failure. After B2 the owner is additionally blocked at the trigger layer (row 8/9).'

union all
select 24, 'B24_legacy_assignment_rpcs_retained', 'RETAINED',
       (select case when count(*) > 0 then 'RETAINED' else 'MISSING' end
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('assign_lead_to_vendors','admin_smart_assign_lead_to_vendors',
                             'assign_lead_to_paid_vendors_phase26a','assign_lead_to_preferred_vendor',
                             'assign_client_selected_vendor_to_group','assign_vendor_to_requirement_group')),
       case when (select count(*) from pg_catalog.pg_proc p
                    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('assign_lead_to_vendors','admin_smart_assign_lead_to_vendors',
                                       'assign_lead_to_paid_vendors_phase26a','assign_lead_to_preferred_vendor',
                                       'assign_client_selected_vendor_to_group','assign_vendor_to_requirement_group')) > 0
            then 'PASS' else 'FAIL' end,
       'E is a LATER phase: B2 must not revoke or drop a legacy RPC'

union all
select 25, 'B25_migration_c_projection_absent', '0',
       (select count(*)::text from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'vendor_public_v'),
       case when (select count(*) from pg_catalog.pg_class c
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = 'vendor_public_v') = 0
            then 'PASS' else 'FAIL' end,
       'Migration C not started'

union all
select 26, 'B26_migration_d_auth_trigger_absent', '0',
       (select count(*)::text from pg_catalog.pg_trigger t
          join pg_catalog.pg_class c on c.oid = t.tgrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where not t.tgisinternal and n.nspname = 'auth' and c.relname = 'users'),
       case when (select count(*) from pg_catalog.pg_trigger t
                    join pg_catalog.pg_class c on c.oid = t.tgrelid
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   where not t.tgisinternal and n.nspname = 'auth' and c.relname = 'users') = 0
            then 'PASS' else 'FAIL' end,
       'Migration D not started'

union all
select 27, 'B27_owner_binding_still_deferred', '0',
       (select count(*)::text from pg_catalog.pg_attribute
         where attrelid = 'public.leads'::regclass and not attisdropped
           and attname in ('client_account_id','user_id','created_by')),
       case when (select count(*) from pg_catalog.pg_attribute
                   where attrelid = 'public.leads'::regclass and not attisdropped
                     and attname in ('client_account_id','user_id','created_by')) = 0
            then 'PASS' else 'FAIL' end,
       'R1_BLOCKED_PENDING_OWNER_BINDING remains UNRESOLVED and out of scope for B2'

union all
select 28, 'B28_client_selection_request_table_absent', '0',
       (select count(*)::text from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname in ('client_selection_requests','lead_ownership','client_lead_bindings')),
       case when (select count(*) from pg_catalog.pg_class c
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public'
                     and c.relname in ('client_selection_requests','lead_ownership','client_lead_bindings')) = 0
            then 'PASS' else 'FAIL' end,
       'the owner-binding prerequisite was not implemented by B2'

union all
select 29, 'B29_lifecycle_vocabulary_unchanged', '1',
       (select count(*)::text from pg_catalog.pg_constraint
         where conname = 'lead_assignments_lifecycle_status_check'
           and pg_catalog.pg_get_constraintdef(oid) not like '%in_progress%'),
       case when (select count(*) from pg_catalog.pg_constraint
                   where conname = 'lead_assignments_lifecycle_status_check'
                     and pg_catalog.pg_get_constraintdef(oid) not like '%in_progress%') = 1
            then 'PASS' else 'FAIL' end,
       'no lifecycle state invented; in_progress remains CRM-only'

union all
select 30, 'B30_rls_still_enabled_on_enforced_tables', '2',
       (select count(*)::text from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relrowsecurity
           and c.relname in ('lead_assignments','lead_assignment_events')),
       case when (select count(*) from pg_catalog.pg_class c
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relrowsecurity
                     and c.relname in ('lead_assignments','lead_assignment_events')) = 2
            then 'PASS' else 'FAIL' end,
       'B2 neither enabled nor disabled RLS'

union all
select 31, 'B31_no_active_cap_breach_in_existing_data', '0',
       (select coalesce(count(*), 0)::text from (
          select lead_id from public.lead_assignments
           where lifecycle_status in ('assigned','delivered','accepted')
           group by lead_id having count(*) > 3) x),
       case when (select coalesce(count(*), 0) from (
                    select lead_id from public.lead_assignments
                     where lifecycle_status in ('assigned','delivered','accepted')
                     group by lead_id having count(*) > 3) x) = 0
            then 'PASS' else 'FAIL' end,
       'derived from live data: no pre-existing lead already exceeds active-three'

union all
select 32, 'B32_no_lifetime_cap_breach_in_existing_data', '0',
       (select coalesce(count(*), 0)::text from (
          select lead_id from public.lead_assignment_events
           where event_type = 'assignment_created' and lifecycle_to = 'assigned'
           group by lead_id having count(distinct vendor_id) > 6) x),
       case when (select coalesce(count(*), 0) from (
                    select lead_id from public.lead_assignment_events
                     where event_type = 'assignment_created' and lifecycle_to = 'assigned'
                     group by lead_id having count(distinct vendor_id) > 6) x) = 0
            then 'PASS' else 'FAIL' end,
       'derived from live data: no pre-existing lead already exceeds lifetime-six'

union all
select 33, 'B33_no_open_replacement_duplication_in_existing_data', '0',
       (select coalesce(count(*), 0)::text from (
          select lead_id from public.replacement_requests
           where status in ('requested','approved','activating')
           group by lead_id having count(*) > 1) x),
       case when (select coalesce(count(*), 0) from (
                    select lead_id from public.replacement_requests
                     where status in ('requested','approved','activating')
                     group by lead_id having count(*) > 1) x) = 0
            then 'PASS' else 'FAIL' end,
       'derived from live data: the one-open-replacement invariant already holds'

union all
select 34, 'B34_application_data_unchanged_by_b2', 'INFORMATIONAL',
       (select concat('assignments=', (select count(*) from public.lead_assignments),
                      ' events=',      (select count(*) from public.lead_assignment_events),
                      ' operations=',  (select count(*) from public.assignment_operations),
                      ' replacements=',(select count(*) from public.replacement_requests))),
       'PASS',
       'B2 creates only functions and triggers. It writes no application row; these counts must equal the pre-application snapshot.'

order by seq;
