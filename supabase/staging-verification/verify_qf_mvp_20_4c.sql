-- ============================================================================
-- QuickFurno — QF-MVP-20.4C — POST-APPLICATION VERIFICATION (SELECT-ONLY)
--
-- SCOPE
--   Verifies the expected database state AFTER applying:
--     20260723000900_qf_mvp_credit_ledger_reconciliation_exception_register.sql
--   on top of the already-applied, immutable A/A2/B1/G/B2/C/D/E.
--
-- SELECT-ONLY BY CONSTRUCTION
--   One read-only statement: a chain of SELECT ... UNION ALL branches. No
--   INSERT/UPDATE/DELETE/MERGE/TRUNCATE/CREATE/ALTER/DROP/GRANT/REVOKE/CALL/DO.
--   It invokes NO state-changing function and attempts NO mutation of the
--   immutable register — every check is a catalog fact.
--
-- LOCKED POLICIES CARRIED FORWARD
--   * QF-MVP-20.3B1R2 — no lexical assertion over pg_get_functiondef()/prosrc.
--     (pg_get_constraintdef() is a normalised constraint expression, not
--     function source, so a positive assertion over it is permitted.)
--   * QF-MVP-20.3B2R1 — every catalog `name` value is compared as text.
--   * QF-MVP-20.3CVR1 — any set comparison normalises BOTH sides in PostgreSQL.
--
-- OUTPUT: seq | check_name | expected | actual | status | details
-- ============================================================================

select 1 as seq, 'X01_migration_history_once' as check_name,
       '1' as expected,
       (select count(*)::text from supabase_migrations.schema_migrations where version = '20260723000900') as actual,
       case when (select count(*) from supabase_migrations.schema_migrations where version = '20260723000900') = 1
            then 'PASS' else 'FAIL' end as status,
       '20.4C recorded exactly once' as details

union all
select 2, 'X02_register_table_present', '1',
       (select count(*)::text from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
         where n.nspname::text='public' and c.relname::text='credit_ledger_reconciliation_exceptions' and c.relkind='r'),
       case when (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
                   where n.nspname::text='public' and c.relname::text='credit_ledger_reconciliation_exceptions' and c.relkind='r')=1
            then 'PASS' else 'FAIL' end,
       'the immutable exception register table exists'

union all
select 3, 'X03_rls_enabled', '1',
       (select case when c.relrowsecurity then '1' else '0' end from pg_catalog.pg_class c
         where c.oid = to_regclass('public.credit_ledger_reconciliation_exceptions')),
       case when (select c.relrowsecurity from pg_catalog.pg_class c
                   where c.oid = to_regclass('public.credit_ledger_reconciliation_exceptions'))
            then 'PASS' else 'FAIL' end,
       'RLS is enabled on the register'

union all
select 4, 'X04_exact_column_set', 'MATCH',
       (select case when
          (select array_agg(a.attname::text order by a.attname::text) from pg_catalog.pg_attribute a
            where a.attrelid=to_regclass('public.credit_ledger_reconciliation_exceptions') and a.attnum>0 and not a.attisdropped)
          = (select array_agg(x order by x) from unnest(array[
               'assignment_id','assignment_source','assignment_type','audit_run_id','audit_sql_sha256',
               'balance_mutation','classification','correction_mode','created_at','evidence_manifest_sha256',
               'founder_decision','id','idempotency_key','package_mutation','reason','reviewed_at',
               'reviewer_actor','supersedes_record_id','vendor_credit_logs_backfill','vendor_id']::text[]) x)
        then 'MATCH' else 'MISMATCH' end),
       case when
          (select array_agg(a.attname::text order by a.attname::text) from pg_catalog.pg_attribute a
            where a.attrelid=to_regclass('public.credit_ledger_reconciliation_exceptions') and a.attnum>0 and not a.attisdropped)
          = (select array_agg(x order by x) from unnest(array[
               'assignment_id','assignment_source','assignment_type','audit_run_id','audit_sql_sha256',
               'balance_mutation','classification','correction_mode','created_at','evidence_manifest_sha256',
               'founder_decision','id','idempotency_key','package_mutation','reason','reviewed_at',
               'reviewer_actor','supersedes_record_id','vendor_credit_logs_backfill','vendor_id']::text[]) x)
        then 'PASS' else 'FAIL' end,
       'the frozen 20-column contract is present exactly (both sides sorted in PostgreSQL)'

union all
select 5, 'X05_zero_rows_after_schema', '0',
       (select count(*)::text from public.credit_ledger_reconciliation_exceptions),
       case when (select count(*) from public.credit_ledger_reconciliation_exceptions)=0
            then 'PASS' else 'FAIL' end,
       'schema-only migration inserted no candidate data'

union all
select 6, 'X06_financial_locks_pinned', '6',
       (select count(*)::text from (values
          ('clre_classification_locked',  '%(classification = ''insufficient_evidence''::text)%'),
          ('clre_correction_mode_locked', '%(correction_mode = ''exception_record_only''::text)%'),
          ('clre_decision_locked',        '%(founder_decision = ''no_financial_change''::text)%'),
          ('clre_balance_mutation_false', '%(balance_mutation = false)%'),
          ('clre_package_mutation_false', '%(package_mutation = false)%'),
          ('clre_no_ledger_backfill',     '%(vendor_credit_logs_backfill = false)%')) t(nm,want)
         where exists (select 1 from pg_catalog.pg_constraint con
                        where con.conrelid=to_regclass('public.credit_ledger_reconciliation_exceptions')
                          and con.contype='c' and con.conname::text=t.nm
                          and lower(pg_catalog.pg_get_constraintdef(con.oid)) like t.want)),
       case when (select count(*) from (values
                    ('clre_classification_locked',  '%(classification = ''insufficient_evidence''::text)%'),
                    ('clre_correction_mode_locked', '%(correction_mode = ''exception_record_only''::text)%'),
                    ('clre_decision_locked',        '%(founder_decision = ''no_financial_change''::text)%'),
                    ('clre_balance_mutation_false', '%(balance_mutation = false)%'),
                    ('clre_package_mutation_false', '%(package_mutation = false)%'),
                    ('clre_no_ledger_backfill',     '%(vendor_credit_logs_backfill = false)%')) t(nm,want)
                   where exists (select 1 from pg_catalog.pg_constraint con
                                  where con.conrelid=to_regclass('public.credit_ledger_reconciliation_exceptions')
                                    and con.contype='c' and con.conname::text=t.nm
                                    and lower(pg_catalog.pg_get_constraintdef(con.oid)) like t.want))=6
            then 'PASS' else 'FAIL' end,
       'classification / correction_mode / founder_decision and the three mutation-false flags are CHECK-pinned to the approved values'

union all
select 7, 'X07_integrity_constraints_present', '10',
       (select count(*)::text from unnest(array[
          'clre_pkey','clre_idempotency_key_unique','clre_reviewer_actor_check','clre_reason_nonempty',
          'clre_audit_run_id_nonempty','clre_idempotency_nonempty','clre_audit_sql_sha256_hex',
          'clre_manifest_sha256_hex','clre_supersedes_self_fk','clre_no_self_supersede']) s(nm)
         where exists (select 1 from pg_catalog.pg_constraint con
                        where con.conrelid=to_regclass('public.credit_ledger_reconciliation_exceptions')
                          and con.conname::text=s.nm)),
       case when (select count(*) from unnest(array[
                    'clre_pkey','clre_idempotency_key_unique','clre_reviewer_actor_check','clre_reason_nonempty',
                    'clre_audit_run_id_nonempty','clre_idempotency_nonempty','clre_audit_sql_sha256_hex',
                    'clre_manifest_sha256_hex','clre_supersedes_self_fk','clre_no_self_supersede']) s(nm)
                   where exists (select 1 from pg_catalog.pg_constraint con
                                  where con.conrelid=to_regclass('public.credit_ledger_reconciliation_exceptions')
                                    and con.conname::text=s.nm))=10
            then 'PASS' else 'FAIL' end,
       'PK, unique idempotency, actor check, non-empty reason/run/idempotency, two sha256-hex checks, self-FK and no-self-supersede all present'

union all
select 8, 'X08_idempotency_unique', '1',
       (select count(*)::text from pg_catalog.pg_constraint con
         where con.conrelid=to_regclass('public.credit_ledger_reconciliation_exceptions')
           and con.contype='u' and con.conname::text='clre_idempotency_key_unique'),
       case when (select count(*) from pg_catalog.pg_constraint con
                   where con.conrelid=to_regclass('public.credit_ledger_reconciliation_exceptions')
                     and con.contype='u' and con.conname::text='clre_idempotency_key_unique')=1
            then 'PASS' else 'FAIL' end,
       'idempotency_key carries a UNIQUE constraint (deterministic duplicate prevention)'

union all
select 9, 'X09_untrusted_roles_no_privilege', '0',
       (select count(*)::text from unnest(array['public','anon','authenticated']) r(role_name)
          cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
         where has_table_privilege(r.role_name, to_regclass('public.credit_ledger_reconciliation_exceptions'), p.priv)),
       case when (select count(*) from unnest(array['public','anon','authenticated']) r(role_name)
                    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
                   where has_table_privilege(r.role_name, to_regclass('public.credit_ledger_reconciliation_exceptions'), p.priv))=0
            then 'PASS' else 'FAIL' end,
       'PUBLIC / anon / authenticated hold ZERO privilege on the register'

union all
select 10, 'X10_service_role_select_insert_only', '1',
       (select case when has_table_privilege('service_role', to_regclass('public.credit_ledger_reconciliation_exceptions'),'SELECT')
                     and has_table_privilege('service_role', to_regclass('public.credit_ledger_reconciliation_exceptions'),'INSERT')
                     and not has_table_privilege('service_role', to_regclass('public.credit_ledger_reconciliation_exceptions'),'UPDATE')
                     and not has_table_privilege('service_role', to_regclass('public.credit_ledger_reconciliation_exceptions'),'DELETE')
                     and not has_table_privilege('service_role', to_regclass('public.credit_ledger_reconciliation_exceptions'),'TRUNCATE')
                    then '1' else '0' end),
       case when has_table_privilege('service_role', to_regclass('public.credit_ledger_reconciliation_exceptions'),'SELECT')
             and has_table_privilege('service_role', to_regclass('public.credit_ledger_reconciliation_exceptions'),'INSERT')
             and not has_table_privilege('service_role', to_regclass('public.credit_ledger_reconciliation_exceptions'),'UPDATE')
             and not has_table_privilege('service_role', to_regclass('public.credit_ledger_reconciliation_exceptions'),'DELETE')
             and not has_table_privilege('service_role', to_regclass('public.credit_ledger_reconciliation_exceptions'),'TRUNCATE')
            then 'PASS' else 'FAIL' end,
       'service_role holds SELECT + INSERT only; no UPDATE / DELETE / TRUNCATE'

union all
select 11, 'X11_immutable_update_delete_trigger', '1',
       (select count(*)::text from pg_catalog.pg_trigger t
         where t.tgrelid=to_regclass('public.credit_ledger_reconciliation_exceptions') and not t.tgisinternal
           and t.tgname::text='trg_clre_immutable' and t.tgtype=27 and t.tgenabled='O'
           and t.tgfoid=to_regprocedure('public.qf_prevent_credit_ledger_exception_mutation()')),
       case when (select count(*) from pg_catalog.pg_trigger t
                   where t.tgrelid=to_regclass('public.credit_ledger_reconciliation_exceptions') and not t.tgisinternal
                     and t.tgname::text='trg_clre_immutable' and t.tgtype=27 and t.tgenabled='O'
                     and t.tgfoid=to_regprocedure('public.qf_prevent_credit_ledger_exception_mutation()'))=1
            then 'PASS' else 'FAIL' end,
       'BEFORE UPDATE|DELETE FOR EACH ROW immutability trigger (tgtype 27), enabled, bound to the guard'

union all
select 12, 'X12_no_truncate_trigger', '1',
       (select count(*)::text from pg_catalog.pg_trigger t
         where t.tgrelid=to_regclass('public.credit_ledger_reconciliation_exceptions') and not t.tgisinternal
           and t.tgname::text='trg_clre_no_truncate' and t.tgtype=34 and t.tgenabled='O'
           and t.tgfoid=to_regprocedure('public.qf_prevent_credit_ledger_exception_truncate()')),
       case when (select count(*) from pg_catalog.pg_trigger t
                   where t.tgrelid=to_regclass('public.credit_ledger_reconciliation_exceptions') and not t.tgisinternal
                     and t.tgname::text='trg_clre_no_truncate' and t.tgtype=34 and t.tgenabled='O'
                     and t.tgfoid=to_regprocedure('public.qf_prevent_credit_ledger_exception_truncate()'))=1
            then 'PASS' else 'FAIL' end,
       'BEFORE TRUNCATE FOR EACH STATEMENT trigger (tgtype 34), enabled, bound to the guard'

union all
select 13, 'X13_only_self_fk_non_cascading', '1',
       (select case when
          (select count(*) from pg_catalog.pg_constraint con
            where con.conrelid=to_regclass('public.credit_ledger_reconciliation_exceptions') and con.contype='f')=1
          and (select count(*) from pg_catalog.pg_constraint con
                where con.conrelid=to_regclass('public.credit_ledger_reconciliation_exceptions') and con.contype='f'
                  and con.confrelid=to_regclass('public.credit_ledger_reconciliation_exceptions')
                  and con.confdeltype in ('r','a'))=1
        then '1' else '0' end),
       case when
          (select count(*) from pg_catalog.pg_constraint con
            where con.conrelid=to_regclass('public.credit_ledger_reconciliation_exceptions') and con.contype='f')=1
          and (select count(*) from pg_catalog.pg_constraint con
                where con.conrelid=to_regclass('public.credit_ledger_reconciliation_exceptions') and con.contype='f'
                  and con.confrelid=to_regclass('public.credit_ledger_reconciliation_exceptions')
                  and con.confdeltype in ('r','a'))=1
        then 'PASS' else 'FAIL' end,
       'the ONLY FK is the self-supersession reference and it does not cascade (RESTRICT/NO ACTION); no FK to lead_assignments/vendors erases history'

union all
select 14, 'X14_trigger_fns_not_untrusted_executable', '0',
       (select count(*)::text from unnest(array['public','anon','authenticated']) r(role_name)
          cross join unnest(array[
            'public.qf_prevent_credit_ledger_exception_mutation()',
            'public.qf_prevent_credit_ledger_exception_truncate()']) f(sig)
         where has_function_privilege(r.role_name, to_regprocedure(f.sig), 'EXECUTE')),
       case when (select count(*) from unnest(array['public','anon','authenticated']) r(role_name)
                    cross join unnest(array[
                      'public.qf_prevent_credit_ledger_exception_mutation()',
                      'public.qf_prevent_credit_ledger_exception_truncate()']) f(sig)
                   where has_function_privilege(r.role_name, to_regprocedure(f.sig), 'EXECUTE'))=0
            then 'PASS' else 'FAIL' end,
       'the immutability trigger functions are not a callable escalation surface for untrusted roles'

union all
select 15, 'X15_vendor_credit_logs_unchanged', '1',
       (select case when
          exists (select 1 from pg_catalog.pg_class c where c.relname::text='uq_vendor_credit_logs_reference' and c.relkind='i')
          and exists (select 1 from pg_catalog.pg_constraint con
                       where con.conrelid=to_regclass('public.vendor_credit_logs') and con.contype='c'
                         and lower(pg_catalog.pg_get_constraintdef(con.oid)) like '%lead_assignment_debit%')
        then '1' else '0' end),
       case when
          exists (select 1 from pg_catalog.pg_class c where c.relname::text='uq_vendor_credit_logs_reference' and c.relkind='i')
          and exists (select 1 from pg_catalog.pg_constraint con
                       where con.conrelid=to_regclass('public.vendor_credit_logs') and con.contype='c'
                         and lower(pg_catalog.pg_get_constraintdef(con.oid)) like '%lead_assignment_debit%')
        then 'PASS' else 'FAIL' end,
       'vendor_credit_logs is untouched: its reference-unique index and change_type CHECK remain'

union all
select 16, 'X16_operational_tables_present', '3',
       (select count(*)::text from unnest(array['public.vendors','public.vendor_packages','public.lead_assignments']) s(t)
         where to_regclass(s.t) is not null),
       case when (select count(*) from unnest(array['public.vendors','public.vendor_packages','public.lead_assignments']) s(t)
                   where to_regclass(s.t) is not null)=3
            then 'PASS' else 'FAIL' end,
       'vendors / vendor_packages / lead_assignments still exist (this migration created only the register)'

union all
select 17, 'X17_b1_authority_intact', '1',
       (select case when to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is not null then '1' else '0' end),
       case when to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is not null
            then 'PASS' else 'FAIL' end,
       'the canonical B1 assignment authority is intact'

union all
select 18, 'X18_b2_triggers_intact', '4',
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
select 19, 'X19_c_and_d_intact', '1',
       (select case when exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
                                  where n.nspname='public' and c.relname='vendor_public_v' and c.relkind='v')
                     and exists (select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
                                  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
                                 where not t.tgisinternal and t.tgname='on_auth_user_created'
                                   and n.nspname='auth' and c.relname='users')
                    then '1' else '0' end),
       case when exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
                          where n.nspname='public' and c.relname='vendor_public_v' and c.relkind='v')
             and exists (select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
                          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
                         where not t.tgisinternal and t.tgname='on_auth_user_created'
                           and n.nspname='auth' and c.relname='users')
            then 'PASS' else 'FAIL' end,
       'Migration C projection and Migration D auth trigger are intact'

union all
select 20, 'X20_e_posture_intact', '0',
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
select 21, 'X21_owner_binding_still_deferred', '0',
       (select count(*)::text from pg_catalog.pg_attribute
         where attrelid='public.leads'::regclass and not attisdropped
           and attname::text = any(array['client_account_id','user_id','created_by']::text[])),
       case when (select count(*) from pg_catalog.pg_attribute
                   where attrelid='public.leads'::regclass and not attisdropped
                     and attname::text = any(array['client_account_id','user_id','created_by']::text[]))=0
            then 'PASS' else 'FAIL' end,
       'R1_BLOCKED_PENDING_OWNER_BINDING remains unresolved; 20.4C implements no owner binding'

union all
select 22, 'X22_register_owner_information', 'INFORMATIONAL',
       (select coalesce(pg_catalog.pg_get_userbyid(c.relowner)::text,'unknown')
          from pg_catalog.pg_class c where c.oid=to_regclass('public.credit_ledger_reconciliation_exceptions')),
       'PASS',
       'the register table owner (break-glass authority) is informational; owner/postgres is documented, not an application path'

order by seq;
