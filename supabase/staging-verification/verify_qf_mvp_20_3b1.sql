-- ============================================================================
-- QuickFurno — QF-MVP-20.3B1 — POST-APPLICATION VERIFICATION (SELECT-ONLY)
--
-- SCOPE
--   Verifies the expected database state AFTER applying, in order:
--     20260723000100_qf_mvp_marketplace_authority_foundation.sql   (A)
--     20260723000200_qf_mvp_assignment_lineage_backfill.sql        (A2)
--     20260723000300_qf_mvp_canonical_assignment_authority.sql     (B1)
--
-- THIS FILE IS SEPARATE FROM THE LOCKED BASELINE VERIFIER
--   supabase/staging-baseline/verify_qf_mvp_staging_baseline.sql
--   (SHA256 7ba9792f...) is NOT modified, NOT replaced and NOT extended by this
--   phase. It continues to verify the baseline shape. This file verifies only
--   the A/A2/B1 delta.
--
-- SELECT-ONLY BY CONSTRUCTION
--   The entire file is ONE read-only statement: a chain of SELECT ... UNION ALL
--   branches. It contains no INSERT, UPDATE, DELETE, MERGE, TRUNCATE, CREATE,
--   ALTER, DROP, GRANT, REVOKE, COPY, CALL, DO or SET. It cannot mutate any
--   application row, catalog object or privilege, and it cannot be made to do
--   so by the role that runs it.
--
-- ENVIRONMENT AGNOSTIC
--   Every expectation is either a fixed structural contract or is DERIVED from
--   the live data. No production-specific count (46 assignments, 24 leads, 28
--   vendors) is used as a universal expectation. The file returns the same
--   verdicts against:
--     • empty staging (zero application rows)
--     • a production-shaped database containing historical assignments
--
-- QF-MVP-20.3B1R ADDITIONS
--   Checks 601-614 close the four reviewed contracts: operation request
--   fingerprint and result persistence (601-604), replay/conflict semantics,
--   the locked one-credit assignment cost, package non-mutation, the
--   client_selected fail-closed disposition and the audit_logs boundary
--   (605-614). They sort last in the output.
--
-- OUTPUT
--   check_name · expected · actual · status · details
--   status is PASS or FAIL. Any FAIL row blocks the phase.
--   Two rows are INFORMATIONAL and always report PASS (27, 614); their details
--   say so explicitly and they must never be read as proof of anything else.
-- ============================================================================

with

-- ---------------------------------------------------------------------------
-- Derived facts (measured, never assumed)
-- ---------------------------------------------------------------------------
facts as (
  select
    (select count(*) from public.lead_assignments)                                   as assignments_total,
    (select count(*) from public.lead_assignments
      where lead_id is not null and vendor_id is not null and assigned_at is not null) as assignments_qualifying,
    (select count(distinct lead_id) from public.lead_assignments
      where lead_id is not null and vendor_id is not null and assigned_at is not null) as leads_qualifying,
    (select count(*) from public.lead_assignment_events
      where event_idempotency_key like 'legacy_assignment_seed_v1:%')                 as seed_events,
    (select count(*) from public.assignment_operations
      where idempotency_key like 'qf_mvp_20_a2_lineage_backfill_v1:%')                as seed_operations,
    (select count(*) from public.vendor_credit_logs)                                  as ledger_rows,
    (select count(*) from public.communication_intents)                               as intent_rows
),

results as (

-- === 1. Migration A — additive columns ====================================
select 1 as seq, 'A01_lead_assignments_columns' as check_name,
       '4' as expected,
       (select count(*)::text from pg_catalog.pg_attribute
         where attrelid = 'public.lead_assignments'::regclass and not attisdropped
           and attname in ('lifecycle_status','lifecycle_updated_at','operation_id','replaced_by_assignment_id')) as actual,
       case when (select count(*) from pg_catalog.pg_attribute
                   where attrelid = 'public.lead_assignments'::regclass and not attisdropped
                     and attname in ('lifecycle_status','lifecycle_updated_at','operation_id','replaced_by_assignment_id')) = 4
            then 'PASS' else 'FAIL' end as status,
       'lifecycle_status, lifecycle_updated_at, operation_id, replaced_by_assignment_id' as details

union all
select 2, 'A02_vendor_credit_logs_columns', '4',
       (select count(*)::text from pg_catalog.pg_attribute
         where attrelid = 'public.vendor_credit_logs'::regclass and not attisdropped
           and attname in ('approval_reference','idempotency_key','actor_kind','actor_id')),
       case when (select count(*) from pg_catalog.pg_attribute
                   where attrelid = 'public.vendor_credit_logs'::regclass and not attisdropped
                     and attname in ('approval_reference','idempotency_key','actor_kind','actor_id')) = 4
            then 'PASS' else 'FAIL' end,
       'approval_reference, idempotency_key, actor_kind, actor_id'

union all
select 3, 'A03_vendors_suspension_columns', '5',
       (select count(*)::text from pg_catalog.pg_attribute
         where attrelid = 'public.vendors'::regclass and not attisdropped
           and attname in ('assignment_suspended_at','assignment_suspended_until',
                           'assignment_suspension_reason','assignment_suspended_by',
                           'assignment_suspension_reference')),
       case when (select count(*) from pg_catalog.pg_attribute
                   where attrelid = 'public.vendors'::regclass and not attisdropped
                     and attname in ('assignment_suspended_at','assignment_suspended_until',
                                     'assignment_suspension_reason','assignment_suspended_by',
                                     'assignment_suspension_reference')) = 5
            then 'PASS' else 'FAIL' end,
       'temporary assignment-suspension storage (inert in A/A2/B1)'

-- === 2. Migration A — foundation tables ===================================
union all
select 4, 'A04_foundation_tables_exist', '5',
       (select count(*)::text from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r'
           and c.relname in ('assignment_operations','replacement_requests',
                             'credit_restoration_approvals','lead_assignment_events',
                             'communication_intents')),
       case when (select count(*) from pg_catalog.pg_class c
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relkind = 'r'
                     and c.relname in ('assignment_operations','replacement_requests',
                                       'credit_restoration_approvals','lead_assignment_events',
                                       'communication_intents')) = 5
            then 'PASS' else 'FAIL' end,
       'assignment_operations, replacement_requests, credit_restoration_approvals, lead_assignment_events, communication_intents'

union all
select 5, 'A05_primary_keys', '5',
       (select count(*)::text from pg_catalog.pg_constraint
         where contype = 'p'
           and conrelid in ('public.assignment_operations'::regclass,
                            'public.replacement_requests'::regclass,
                            'public.credit_restoration_approvals'::regclass,
                            'public.lead_assignment_events'::regclass,
                            'public.communication_intents'::regclass)),
       case when (select count(*) from pg_catalog.pg_constraint
                   where contype = 'p'
                     and conrelid in ('public.assignment_operations'::regclass,
                                      'public.replacement_requests'::regclass,
                                      'public.credit_restoration_approvals'::regclass,
                                      'public.lead_assignment_events'::regclass,
                                      'public.communication_intents'::regclass)) = 5
            then 'PASS' else 'FAIL' end,
       'one uuid primary key per new table'

union all
select 6, 'A06_operation_idempotency_unique', '1',
       (select count(*)::text from pg_catalog.pg_constraint
         where conrelid = 'public.assignment_operations'::regclass and contype = 'u'
           and conname = 'uq_assignment_operations_idempotency'),
       case when exists (select 1 from pg_catalog.pg_constraint
                          where conrelid = 'public.assignment_operations'::regclass and contype = 'u'
                            and conname = 'uq_assignment_operations_idempotency')
            then 'PASS' else 'FAIL' end,
       'operation-level replay guard'

-- QF-MVP-20.3B1R — replay contract support
union all
select 601, 'A06b_operation_request_fingerprint', 'present and NOT NULL',
       coalesce((select case when attnotnull then 'present and NOT NULL' else 'present but NULLABLE' end
                   from pg_catalog.pg_attribute
                  where attrelid = 'public.assignment_operations'::regclass
                    and attname = 'request_fingerprint' and not attisdropped), 'absent'),
       case when exists (select 1 from pg_catalog.pg_attribute
                          where attrelid = 'public.assignment_operations'::regclass
                            and attname = 'request_fingerprint' and attnotnull and not attisdropped)
            then 'PASS' else 'FAIL' end,
       'idempotency must never be decided on the key alone; same key + different request = idempotency_conflict'

union all
select 602, 'A06c_operation_result_persistence', 'jsonb NOT NULL + terminal completion check',
       case when exists (select 1 from pg_catalog.pg_attribute
                          where attrelid = 'public.assignment_operations'::regclass
                            and attname = 'result' and attnotnull and not attisdropped)
             and exists (select 1 from pg_catalog.pg_constraint
                          where conrelid = 'public.assignment_operations'::regclass
                            and conname = 'assignment_operations_terminal_completion_check')
            then 'jsonb NOT NULL + terminal completion check' else 'incomplete' end,
       case when exists (select 1 from pg_catalog.pg_attribute
                          where attrelid = 'public.assignment_operations'::regclass
                            and attname = 'result' and attnotnull and not attisdropped)
             and exists (select 1 from pg_catalog.pg_constraint
                          where conrelid = 'public.assignment_operations'::regclass
                            and conname = 'assignment_operations_terminal_completion_check')
            then 'PASS' else 'FAIL' end,
       'a terminal operation must carry completed_at AND a non-empty result, so a replay can be reconstructed without recomputation'

union all
select 603, 'A06d_no_terminal_operation_without_result', '0',
       (select count(*)::text from public.assignment_operations
         where status <> 'in_progress'
           and (completed_at is null or result = '{}'::jsonb)),
       case when (select count(*) from public.assignment_operations
                   where status <> 'in_progress'
                     and (completed_at is null or result = '{}'::jsonb)) = 0
            then 'PASS' else 'FAIL' end,
       'asserted independently of the CHECK constraint'

union all
select 604, 'A06e_no_duplicate_operation_key', '0',
       (select count(*)::text from (
          select idempotency_key from public.assignment_operations
           group by idempotency_key having count(*) > 1) d),
       case when (select count(*) from (
                    select idempotency_key from public.assignment_operations
                     group by idempotency_key having count(*) > 1) d) = 0
            then 'PASS' else 'FAIL' end,
       'exactly one invocation may claim an operation key'

union all
select 7, 'A07_replacement_one_open_per_lead', '1',
       (select count(*)::text from pg_catalog.pg_class
         where relname = 'uq_replacement_requests_open_per_lead' and relkind = 'i'),
       case when exists (select 1 from pg_catalog.pg_class
                          where relname = 'uq_replacement_requests_open_per_lead' and relkind = 'i')
            then 'PASS' else 'FAIL' end,
       'partial unique index is the one-replacement-at-a-time authority'

-- === 3. Event idempotency contract (QF-MVP-20.3A1R) =======================
union all
select 8, 'A08_event_key_exists_not_null', 'present and NOT NULL',
       coalesce((select case when attnotnull then 'present and NOT NULL' else 'present but NULLABLE' end
                   from pg_catalog.pg_attribute
                  where attrelid = 'public.lead_assignment_events'::regclass
                    and attname = 'event_idempotency_key' and not attisdropped), 'absent'),
       case when exists (select 1 from pg_catalog.pg_attribute
                          where attrelid = 'public.lead_assignment_events'::regclass
                            and attname = 'event_idempotency_key' and attnotnull and not attisdropped)
            then 'PASS' else 'FAIL' end,
       'text NOT NULL, authority-derived, never caller-supplied'

union all
select 9, 'A09_event_key_uniquely_constrained', '1',
       (select count(*)::text from pg_catalog.pg_constraint
         where conrelid = 'public.lead_assignment_events'::regclass and contype = 'u'
           and conkey = array[(select attnum from pg_catalog.pg_attribute
                                where attrelid = 'public.lead_assignment_events'::regclass
                                  and attname = 'event_idempotency_key')]),
       case when (select count(*) from pg_catalog.pg_constraint
                   where conrelid = 'public.lead_assignment_events'::regclass and contype = 'u'
                     and conkey = array[(select attnum from pg_catalog.pg_attribute
                                          where attrelid = 'public.lead_assignment_events'::regclass
                                            and attname = 'event_idempotency_key')]) = 1
            then 'PASS' else 'FAIL' end,
       'the sole event replay guard'

union all
select 10, 'A10_no_lead_vendor_unique_on_events', '0',
       (select count(*)::text from pg_catalog.pg_constraint
         where conrelid = 'public.lead_assignment_events'::regclass and contype = 'u'
           and conkey @> array[(select attnum from pg_catalog.pg_attribute
                                 where attrelid = 'public.lead_assignment_events'::regclass and attname = 'lead_id')]
           and conkey @> array[(select attnum from pg_catalog.pg_attribute
                                 where attrelid = 'public.lead_assignment_events'::regclass and attname = 'vendor_id')]),
       case when (select count(*) from pg_catalog.pg_constraint
                   where conrelid = 'public.lead_assignment_events'::regclass and contype = 'u'
                     and conkey @> array[(select attnum from pg_catalog.pg_attribute
                                           where attrelid = 'public.lead_assignment_events'::regclass and attname = 'lead_id')]
                     and conkey @> array[(select attnum from pg_catalog.pg_attribute
                                           where attrelid = 'public.lead_assignment_events'::regclass and attname = 'vendor_id')]) = 0
            then 'PASS' else 'FAIL' end,
       'QF-MVP-20.3A1R: an append-only event stream must NEVER carry (lead_id, vendor_id) uniqueness'

union all
select 11, 'A11_lead_assignments_unique_preserved', '1',
       (select count(*)::text from pg_catalog.pg_constraint
         where conrelid = 'public.lead_assignments'::regclass and contype = 'u'
           and conkey @> array[(select attnum from pg_catalog.pg_attribute
                                 where attrelid = 'public.lead_assignments'::regclass and attname = 'lead_id')]
           and conkey @> array[(select attnum from pg_catalog.pg_attribute
                                 where attrelid = 'public.lead_assignments'::regclass and attname = 'vendor_id')]),
       case when (select count(*) from pg_catalog.pg_constraint
                   where conrelid = 'public.lead_assignments'::regclass and contype = 'u'
                     and conkey @> array[(select attnum from pg_catalog.pg_attribute
                                           where attrelid = 'public.lead_assignments'::regclass and attname = 'lead_id')]
                     and conkey @> array[(select attnum from pg_catalog.pg_attribute
                                           where attrelid = 'public.lead_assignments'::regclass and attname = 'vendor_id')]) = 1
            then 'PASS' else 'FAIL' end,
       'the pre-existing assignment-row idempotency boundary must survive untouched'

-- === 4. Retention (FK delete actions) =====================================
union all
select 12, 'A12_lineage_retention_actions', 'n|r|n|r',
       coalesce((select string_agg(confdeltype::text, '|' order by conname)
                   from pg_catalog.pg_constraint
                  where conname in ('lead_assignment_events_lead_id_fkey',
                                    'lead_assignment_events_vendor_id_fkey',
                                    'lead_assignment_events_assignment_id_fkey',
                                    'lead_assignment_events_operation_id_fkey')), 'missing'),
       case when (select count(*) from pg_catalog.pg_constraint
                   where (conname in ('lead_assignment_events_lead_id_fkey','lead_assignment_events_vendor_id_fkey') and confdeltype = 'r')
                      or (conname in ('lead_assignment_events_assignment_id_fkey','lead_assignment_events_operation_id_fkey') and confdeltype = 'n')) = 4
            then 'PASS' else 'FAIL' end,
       'assignment(SET NULL) | lead(RESTRICT) | operation(SET NULL) | vendor(RESTRICT), ordered by constraint name'

union all
select 13, 'A13_operation_lead_restrict', 'r',
       coalesce((select confdeltype::text from pg_catalog.pg_constraint
                  where conname = 'assignment_operations_lead_id_fkey'), 'missing'),
       case when exists (select 1 from pg_catalog.pg_constraint
                          where conname = 'assignment_operations_lead_id_fkey' and confdeltype = 'r')
            then 'PASS' else 'FAIL' end,
       'operation audit must survive lead deletion attempts'

-- === 5. Lifecycle vocabulary and active set ===============================
union all
select 14, 'A14_lifecycle_vocabulary', 'all 10 values present',
       case when (select pg_catalog.pg_get_constraintdef(oid) from pg_catalog.pg_constraint
                   where conrelid = 'public.lead_assignments'::regclass
                     and conname = 'lead_assignments_lifecycle_status_check')
                 like all (array['%requested%','%assigned%','%delivered%','%accepted%','%rejected%',
                                 '%expired%','%cancelled%','%invalid%','%replaced%','%completed%'])
            then 'all 10 values present' else 'vocabulary mismatch' end,
       case when (select pg_catalog.pg_get_constraintdef(oid) from pg_catalog.pg_constraint
                   where conrelid = 'public.lead_assignments'::regclass
                     and conname = 'lead_assignments_lifecycle_status_check')
                 like all (array['%requested%','%assigned%','%delivered%','%accepted%','%rejected%',
                                 '%expired%','%cancelled%','%invalid%','%replaced%','%completed%'])
            then 'PASS' else 'FAIL' end,
       'requested, assigned, delivered, accepted, rejected, expired, cancelled, invalid, replaced, completed'

union all
select 15, 'A15_active_set_index_predicate', 'assigned+delivered+accepted only',
       case when (select pg_catalog.pg_get_indexdef(indexrelid) from pg_catalog.pg_index
                   where indexrelid = to_regclass('public.idx_lead_assignments_active'))
                 like '%''assigned''%delivered%accepted%'
            and (select pg_catalog.pg_get_indexdef(indexrelid) from pg_catalog.pg_index
                   where indexrelid = to_regclass('public.idx_lead_assignments_active'))
                 not like '%in_progress%'
            then 'assigned+delivered+accepted only' else 'active set mismatch' end,
       case when (select pg_catalog.pg_get_indexdef(indexrelid) from pg_catalog.pg_index
                   where indexrelid = to_regclass('public.idx_lead_assignments_active'))
                 like '%''assigned''%delivered%accepted%'
            and (select pg_catalog.pg_get_indexdef(indexrelid) from pg_catalog.pg_index
                   where indexrelid = to_regclass('public.idx_lead_assignments_active'))
                 not like '%in_progress%'
            then 'PASS' else 'FAIL' end,
       'ACTIVE = {assigned, delivered, accepted}; in_progress is NOT a lifecycle status'

union all
select 16, 'A16_lifetime_index_predicate', 'assignment_created + assigned',
       case when (select pg_catalog.pg_get_indexdef(indexrelid) from pg_catalog.pg_index
                   where indexrelid = to_regclass('public.idx_lead_assignment_events_lifetime'))
                 like '%assignment_created%' then 'assignment_created + assigned' else 'missing or wrong' end,
       case when (select pg_catalog.pg_get_indexdef(indexrelid) from pg_catalog.pg_index
                   where indexrelid = to_regclass('public.idx_lead_assignment_events_lifetime'))
                 like '%assignment_created%'
            then 'PASS' else 'FAIL' end,
       'serves count(distinct vendor_id) for lifetime-six'

union all
select 17, 'A17_ledger_vocabulary_widened_additively', 'legacy retained + 4 canonical',
       case when (select pg_catalog.pg_get_constraintdef(oid) from pg_catalog.pg_constraint
                   where conrelid = 'public.vendor_credit_logs'::regclass
                     and conname = 'vendor_credit_logs_change_type_check')
                 like all (array['%package_purchase%','%correction%','%manual_set%',
                                 '%approved_bad_lead_restoration%','%package_purchase_credit%',
                                 '%authorized_manual_adjustment%','%migration_reconciliation_adjustment%'])
            then 'legacy retained + 4 canonical' else 'vocabulary mismatch' end,
       case when (select pg_catalog.pg_get_constraintdef(oid) from pg_catalog.pg_constraint
                   where conrelid = 'public.vendor_credit_logs'::regclass
                     and conname = 'vendor_credit_logs_change_type_check')
                 like all (array['%package_purchase%','%correction%','%manual_set%',
                                 '%approved_bad_lead_restoration%','%package_purchase_credit%',
                                 '%authorized_manual_adjustment%','%migration_reconciliation_adjustment%'])
            then 'PASS' else 'FAIL' end,
       'every historical row must stay valid'

-- === 6. Views ==============================================================
union all
select 18, 'A18_divergence_view_not_in_this_phase', '0',
       (select count(*)::text from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('v','m')
           and c.relname in ('vendor_wallet_package_divergence_v','vendor_public_v')),
       case when (select count(*) from pg_catalog.pg_class c
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relkind in ('v','m')
                     and c.relname in ('vendor_wallet_package_divergence_v','vendor_public_v')) = 0
            then 'PASS' else 'FAIL' end,
       'the design assigns both views to Migration C or a later ops migration, NOT to A/A2/B1'

-- === 7. Migration B1 — canonical functions =================================
union all
select 19, 'B01_qf_apply_credit_mutation_v2_signature', 'present',
       case when to_regprocedure('public.qf_apply_credit_mutation_v2(uuid, integer, text, text, text, text, text, uuid, text, boolean)') is null
            then 'absent' else 'present' end,
       case when to_regprocedure('public.qf_apply_credit_mutation_v2(uuid, integer, text, text, text, text, text, uuid, text, boolean)') is not null
            then 'PASS' else 'FAIL' end,
       'exact frozen signature resolved by OID, not by name'

union all
select 20, 'B02_qf_assign_lead_vendors_v2_signature', 'present',
       case when to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is null
            then 'absent' else 'present' end,
       case when to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is not null
            then 'PASS' else 'FAIL' end,
       'exact frozen signature; no p_total_limit exists'

union all
select 21, 'B03_all_five_canonical_functions', '5',
       (select count(*)::text from (values
          ('public.qf_vendor_assignment_eligible(uuid, uuid, integer)'),
          ('public.qf_apply_credit_mutation_v2(uuid, integer, text, text, text, text, text, uuid, text, boolean)'),
          ('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'),
          ('public.qf_request_replacement_v2(uuid, uuid, text, text, uuid)'),
          ('public.qf_approve_credit_restoration_v2(uuid, uuid, text)')
        ) as s(sig) where to_regprocedure(s.sig) is not null),
       case when (select count(*) from (values
          ('public.qf_vendor_assignment_eligible(uuid, uuid, integer)'),
          ('public.qf_apply_credit_mutation_v2(uuid, integer, text, text, text, text, text, uuid, text, boolean)'),
          ('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'),
          ('public.qf_request_replacement_v2(uuid, uuid, text, text, uuid)'),
          ('public.qf_approve_credit_restoration_v2(uuid, uuid, text)')
        ) as s(sig) where to_regprocedure(s.sig) is not null) = 5
            then 'PASS' else 'FAIL' end,
       'canonical authority surface'

union all
select 22, 'B04_canonical_not_executable_by_untrusted', '0',
       (select count(*)::text from (values
          ('public.qf_vendor_assignment_eligible(uuid, uuid, integer)'),
          ('public.qf_apply_credit_mutation_v2(uuid, integer, text, text, text, text, text, uuid, text, boolean)'),
          ('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'),
          ('public.qf_request_replacement_v2(uuid, uuid, text, text, uuid)'),
          ('public.qf_approve_credit_restoration_v2(uuid, uuid, text)')
        ) as s(sig), unnest(array['public','anon','authenticated']) as r(role_name)
        where case when to_regprocedure(s.sig) is null then false
                   else has_function_privilege(r.role_name, to_regprocedure(s.sig), 'EXECUTE') end),
       case when (select count(*) from (values
          ('public.qf_vendor_assignment_eligible(uuid, uuid, integer)'),
          ('public.qf_apply_credit_mutation_v2(uuid, integer, text, text, text, text, text, uuid, text, boolean)'),
          ('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'),
          ('public.qf_request_replacement_v2(uuid, uuid, text, text, uuid)'),
          ('public.qf_approve_credit_restoration_v2(uuid, uuid, text)')
        ) as s(sig), unnest(array['public','anon','authenticated']) as r(role_name)
        where to_regprocedure(s.sig) is not null
          and has_function_privilege(r.role_name, to_regprocedure(s.sig), 'EXECUTE')) = 0
            then 'PASS' else 'FAIL' end,
       'PUBLIC, anon and authenticated must hold NO execute on canonical mutation authority'

union all
select 23, 'B05_service_role_execute_granted', '5',
       (select count(*)::text from (values
          ('public.qf_vendor_assignment_eligible(uuid, uuid, integer)'),
          ('public.qf_apply_credit_mutation_v2(uuid, integer, text, text, text, text, text, uuid, text, boolean)'),
          ('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'),
          ('public.qf_request_replacement_v2(uuid, uuid, text, text, uuid)'),
          ('public.qf_approve_credit_restoration_v2(uuid, uuid, text)')
        ) as s(sig)
        where case when to_regprocedure(s.sig) is null then false
                   else has_function_privilege('service_role', to_regprocedure(s.sig), 'EXECUTE') end),
       case when (select count(*) from (values
          ('public.qf_vendor_assignment_eligible(uuid, uuid, integer)'),
          ('public.qf_apply_credit_mutation_v2(uuid, integer, text, text, text, text, text, uuid, text, boolean)'),
          ('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'),
          ('public.qf_request_replacement_v2(uuid, uuid, text, text, uuid)'),
          ('public.qf_approve_credit_restoration_v2(uuid, uuid, text)')
        ) as s(sig)
        where to_regprocedure(s.sig) is not null
          and has_function_privilege('service_role', to_regprocedure(s.sig), 'EXECUTE')) = 5
            then 'PASS' else 'FAIL' end,
       'the approved execution role, and the only one'

-- === 7b. QF-MVP-20.3B1R — canonical authority behavioural contracts ========
union all
select 605, 'B05a_replay_and_conflict_semantics_present', 'fingerprint + conflict + retry',
       (select case when d ~ 'request_fingerprint' then 'fingerprint ' else '' end
                 || case when d ~ 'idempotency_conflict' then 'conflict ' else '' end
                 || case when d ~ 'conflict_retry' then 'retry' else '' end
          from (select coalesce(pg_catalog.pg_get_functiondef(
                  to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)')), '') as d) s),
       case when (select d ~ 'request_fingerprint' and d ~ 'idempotency_conflict' and d ~ 'conflict_retry'
                    from (select coalesce(pg_catalog.pg_get_functiondef(
                            to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)')), '') as d) s)
            then 'PASS' else 'FAIL' end,
       'same key + same request replays the persisted result; same key + different request is idempotency_conflict with zero mutation'

union all
select 606, 'B05b_no_caller_cost_or_delta_parameter', 'absent',
       coalesce((select pg_catalog.pg_get_function_identity_arguments(
                   to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'))), 'function absent'),
       case when coalesce((select pg_catalog.pg_get_function_identity_arguments(
                             to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'))), '')
                 !~* '(cost|delta|credit|limit|max)'
            then 'PASS' else 'FAIL' end,
       'ASSIGNMENT_CREDIT_COST = 1 is an internal locked constant; no caller may supply a cost, delta or ceiling'

union all
select 607, 'B05c_assignment_cost_not_configurable', 'no app_settings / vendor_packages read',
       case when coalesce((select pg_catalog.pg_get_functiondef(
                             to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'))), '')
                 ~* '(app_settings|get_setting_int|vendor_packages)'
            then 'configuration or package lookup present' else 'no app_settings / vendor_packages read' end,
       case when coalesce((select pg_catalog.pg_get_functiondef(
                             to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'))), '')
                 ~* '(app_settings|get_setting_int|vendor_packages)'
            then 'FAIL' else 'PASS' end,
       'cost must not be read from configuration, and package state must not influence it'

union all
select 608, 'B05d_package_counters_not_debited', 'no vendor_packages mutation',
       (select count(*)::text from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('qf_assign_lead_vendors_v2','qf_apply_credit_mutation_v2',
                             'qf_request_replacement_v2','qf_approve_credit_restoration_v2')
           and pg_catalog.pg_get_functiondef(p.oid) ~* 'update\s+public\.vendor_packages') || ' mutating functions',
       case when (select count(*) from pg_catalog.pg_proc p
                    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('qf_assign_lead_vendors_v2','qf_apply_credit_mutation_v2',
                                       'qf_request_replacement_v2','qf_approve_credit_restoration_v2')
                     and pg_catalog.pg_get_functiondef(p.oid) ~* 'update\s+public\.vendor_packages') = 0
            then 'PASS' else 'FAIL' end,
       'the wallet is the sole assignment-debit authority; vendor_packages is an entitlement record only'

union all
select 609, 'B05e_every_assignment_debit_is_exactly_one_credit', '0 deviating',
       (select count(*)::text from public.vendor_credit_logs
         where change_type = 'lead_assignment_debit'
           and idempotency_key like 'assignment_debit:%'
           and credits_delta <> -1) || ' deviating',
       case when (select count(*) from public.vendor_credit_logs
                   where change_type = 'lead_assignment_debit'
                     and idempotency_key like 'assignment_debit:%'
                     and credits_delta <> -1) = 0
            then 'PASS' else 'FAIL' end,
       'scoped to canonical-authority debits; legacy historical rows are not judged here'

union all
select 610, 'B05f_no_canonical_debit_without_matching_assignment', '0',
       (select count(*)::text from public.vendor_credit_logs l
         where l.change_type = 'lead_assignment_debit'
           and l.idempotency_key like 'assignment_debit:%'
           and not exists (select 1 from public.lead_assignments la
                            where la.id::text = l.reference_id)),
       case when (select count(*) from public.vendor_credit_logs l
                   where l.change_type = 'lead_assignment_debit'
                     and l.idempotency_key like 'assignment_debit:%'
                     and not exists (select 1 from public.lead_assignments la
                                      where la.id::text = l.reference_id)) = 0
            then 'PASS' else 'FAIL' end,
       'a canonical debit exists only for a genuinely created assignment; replays, rejected and cap-blocked candidates debit nothing'

union all
select 611, 'B05g_client_selected_fails_closed', 'unauthorized before any write',
       case when coalesce((select pg_catalog.pg_get_functiondef(
                             to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'))), '')
                 ~ 'R1_BLOCKED_PENDING_OWNER_BINDING'
            then 'unauthorized before any write' else 'fail-closed marker absent' end,
       case when coalesce((select pg_catalog.pg_get_functiondef(
                             to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'))), '')
                 ~ 'R1_BLOCKED_PENDING_OWNER_BINDING'
            then 'PASS' else 'FAIL' end,
       'the schema has no lead-to-client ownership binding and no canonical phone normalizer, so client_selected is refused rather than authorised by phone equality'

union all
select 612, 'B05h_no_phone_equality_ownership_authority', 'absent',
       case when coalesce((select pg_catalog.pg_get_functiondef(
                             to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'))), '')
                 ~* 'client_accounts'
            then 'phone/account matching present' else 'absent' end,
       case when coalesce((select pg_catalog.pg_get_functiondef(
                             to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)'))), '')
                 ~* 'client_accounts'
            then 'FAIL' else 'PASS' end,
       'phone equality is not accepted as ownership authority in any form'

union all
select 613, 'B05i_no_audit_logs_dependency', 'absent',
       (select count(*)::text from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('qf_assign_lead_vendors_v2','qf_apply_credit_mutation_v2',
                             'qf_request_replacement_v2','qf_approve_credit_restoration_v2',
                             'qf_vendor_assignment_eligible')
           and pg_catalog.pg_get_functiondef(p.oid) ~* 'audit_logs') || ' functions referencing audit_logs',
       case when (select count(*) from pg_catalog.pg_proc p
                    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('qf_assign_lead_vendors_v2','qf_apply_credit_mutation_v2',
                                       'qf_request_replacement_v2','qf_approve_credit_restoration_v2',
                                       'qf_vendor_assignment_eligible')
                     and pg_catalog.pg_get_functiondef(p.oid) ~* 'audit_logs') = 0
            then 'PASS' else 'FAIL' end,
       'audit_logs is absent from the baseline; the domain tables carry the evidence and the operation result is completed instead'

union all
select 614, 'B05j_audit_logs_table_not_created', '0',
       (select count(*)::text from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'audit_logs'),
       'PASS',
       'INFORMATIONAL, never a failure of this phase: A/A2/B1 neither create nor require public.audit_logs. A non-zero actual means the drifted migration 20260621000006 was applied by some other route. That drift is tracked separately and is non-blocking here.'

-- === 8. Legacy compatibility must be intact ================================
union all
select 24, 'B06_six_legacy_assignment_rpcs_present', '6',
       (select count(distinct p.proname)::text from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('admin_smart_assign_lead_to_vendors','assign_client_selected_vendor_to_group',
                             'assign_lead_to_preferred_vendor','assign_lead_to_vendors',
                             'assign_package_to_vendor','assign_vendor_to_requirement_group')),
       case when (select count(distinct p.proname) from pg_catalog.pg_proc p
                    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname in ('admin_smart_assign_lead_to_vendors','assign_client_selected_vendor_to_group',
                                       'assign_lead_to_preferred_vendor','assign_lead_to_vendors',
                                       'assign_package_to_vendor','assign_vendor_to_requirement_group')) = 6
            then 'PASS' else 'FAIL' end,
       'B1 retires nothing; retirement is Migration E and later'

union all
select 25, 'B07_legacy_grants_not_broadened', '0',
       (select count(*)::text from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace,
               unnest(array['anon','authenticated']) as r(role_name)
         where n.nspname = 'public'
           and p.proname in ('assign_lead_to_paid_vendors_phase26a','qf_apply_vendor_credit_delta')
           and has_function_privilege(r.role_name, p.oid, 'EXECUTE')),
       case when (select count(*) from pg_catalog.pg_proc p
                    join pg_catalog.pg_namespace n on n.oid = p.pronamespace,
                         unnest(array['anon','authenticated']) as r(role_name)
                   where n.nspname = 'public'
                     and p.proname in ('assign_lead_to_paid_vendors_phase26a','qf_apply_vendor_credit_delta')
                     and has_function_privilege(r.role_name, p.oid, 'EXECUTE')) = 0
            then 'PASS' else 'FAIL' end,
       'the two already-locked canonical bases must not have been widened by this phase'

-- === 9. Exclusions: B2, C and D must NOT have happened =====================
union all
select 26, 'X01_no_b2_enforcement_trigger', '0',
       (select count(*)::text from pg_catalog.pg_trigger
         where tgrelid in ('public.lead_assignments'::regclass, 'public.lead_assignment_events'::regclass)
           and not tgisinternal),
       case when (select count(*) from pg_catalog.pg_trigger
                   where tgrelid in ('public.lead_assignments'::regclass, 'public.lead_assignment_events'::regclass)
                     and not tgisinternal) = 0
            then 'PASS' else 'FAIL' end,
       'active-3, lifetime-6 and lineage-immutable triggers belong to B2, after the R1 consumer release'

union all
select 27, 'X02_no_migration_c_hardening_claimed', 'unchanged',
       case when exists (select 1 from pg_catalog.pg_policies
                          where schemaname = 'public' and tablename = 'leads' and policyname = 'leads public insert')
              or exists (select 1 from information_schema.role_table_grants
                          where table_schema = 'public' and table_name in ('leads','vendors') and grantee = 'anon')
            then 'pre-C state (as expected on production)'
            else 'already hardened (expected on staging baseline)' end,
       'PASS',
       'INFORMATIONAL: A/A2/B1 change no policy and no anon grant. Migration C owns that change; this row must never be read as proof that hardening happened.'

union all
select 28, 'X03_no_auth_users_profile_trigger_added', '0 added by this phase',
       (select count(*)::text from pg_catalog.pg_trigger
         where tgrelid = 'auth.users'::regclass and not tgisinternal
           and tgname = 'on_auth_user_created'),
       case when (select count(*) from pg_catalog.pg_trigger
                   where tgrelid = 'auth.users'::regclass and not tgisinternal
                     and tgname = 'on_auth_user_created') = 0
            then 'PASS' else 'FAIL' end,
       'Migration D owns the auth.users trigger. On staging it must still be absent after A/A2/B1.'

union all
select 29, 'X04_no_provider_account_or_activation', '0',
       (select count(*)::text from public.communication_provider_accounts),
       case when (select count(*) from public.communication_provider_accounts) = 0
            then 'PASS' else 'FAIL' end,
       'this phase introduces no provider account and activates nothing'

union all
select 30, 'X05_no_communication_delivery_row', '0',
       (select count(*)::text from public.communication_delivery_events),
       case when (select count(*) from public.communication_delivery_events) = 0
            then 'PASS' else 'FAIL' end,
       'the marketplace authority writes intents only, never a delivery result'

-- === 10. Migration A2 — backfill semantics (all DERIVED) ===================
union all
select 31, 'D01_no_ledger_row_fabricated_by_a2', '0',
       (select count(*)::text from public.vendor_credit_logs
         where reason = 'lineage_backfill'
            or idempotency_key like 'qf_mvp_20_a2_lineage_backfill_v1%'
            or change_type = 'migration_reconciliation_adjustment'),
       case when (select count(*) from public.vendor_credit_logs
                   where reason = 'lineage_backfill'
                      or idempotency_key like 'qf_mvp_20_a2_lineage_backfill_v1%'
                      or change_type = 'migration_reconciliation_adjustment') = 0
            then 'PASS' else 'FAIL' end,
       'A2 must never fabricate credit-ledger evidence; the 27-row gap stays open for QF-MVP-20.4'

union all
select 32, 'D02_seed_events_equal_qualifying_assignments',
       (select assignments_qualifying::text from facts),
       (select seed_events::text from facts),
       case when (select seed_events from facts) = (select assignments_qualifying from facts)
            then 'PASS' else 'FAIL' end,
       'DERIVED, never hardcoded. Empty staging expects 0 = 0.'

union all
select 33, 'D03_seed_operations_equal_qualifying_leads',
       (select leads_qualifying::text from facts),
       (select seed_operations::text from facts),
       case when (select seed_operations from facts) = (select leads_qualifying from facts)
            then 'PASS' else 'FAIL' end,
       'one deterministic operation per distinct lead (founder decision 1). Empty staging expects 0 = 0.'

union all
select 34, 'D04_every_seed_key_follows_contract', '0 malformed',
       (select count(*)::text from public.lead_assignment_events
         where event_idempotency_key like 'legacy_assignment_seed_v1:%'
           and event_idempotency_key is distinct from 'legacy_assignment_seed_v1:' || assignment_id::text) || ' malformed',
       case when (select count(*) from public.lead_assignment_events
                   where event_idempotency_key like 'legacy_assignment_seed_v1:%'
                     and event_idempotency_key is distinct from 'legacy_assignment_seed_v1:' || assignment_id::text) = 0
            then 'PASS' else 'FAIL' end,
       'legacy_assignment_seed_v1:<assignment_id>'

union all
select 35, 'D05_every_seed_event_is_created_to_assigned', '0 deviating',
       (select count(*)::text from public.lead_assignment_events
         where event_idempotency_key like 'legacy_assignment_seed_v1:%'
           and (event_type is distinct from 'assignment_created'
             or lifecycle_to is distinct from 'assigned'
             or lifecycle_from is not null
             or source_kind is distinct from 'migration_backfill'
             or actor_kind is distinct from 'worker'
             or actor_id is not null
             or operation_id is null)) || ' deviating',
       case when (select count(*) from public.lead_assignment_events
                   where event_idempotency_key like 'legacy_assignment_seed_v1:%'
                     and (event_type is distinct from 'assignment_created'
                       or lifecycle_to is distinct from 'assigned'
                       or lifecycle_from is not null
                       or source_kind is distinct from 'migration_backfill'
                       or actor_kind is distinct from 'worker'
                       or actor_id is not null
                       or operation_id is null)) = 0
            then 'PASS' else 'FAIL' end,
       'assignment_created -> assigned, source_kind=migration_backfill, actor worker/NULL, anchored to an operation'

union all
select 36, 'D06_no_historical_assignment_missing_its_seed', '0',
       (select count(*)::text from public.lead_assignments la
         where la.lead_id is not null and la.vendor_id is not null and la.assigned_at is not null
           and not exists (select 1 from public.lead_assignment_events e where e.assignment_id = la.id)),
       case when (select count(*) from public.lead_assignments la
                   where la.lead_id is not null and la.vendor_id is not null and la.assigned_at is not null
                     and not exists (select 1 from public.lead_assignment_events e where e.assignment_id = la.id)) = 0
            then 'PASS' else 'FAIL' end,
       'every complete historical assignment carries lineage'

union all
select 37, 'D07_no_duplicate_event_idempotency_key', '0',
       (select count(*)::text from (
          select event_idempotency_key from public.lead_assignment_events
           group by event_idempotency_key having count(*) > 1) d),
       case when (select count(*) from (
                    select event_idempotency_key from public.lead_assignment_events
                     group by event_idempotency_key having count(*) > 1) d) = 0
            then 'PASS' else 'FAIL' end,
       'guaranteed by uq_lead_assignment_events_idempotency; asserted independently'

union all
select 38, 'D08_seed_event_anchored_to_own_lead_operation', '0 mismatched',
       (select count(*)::text from public.lead_assignment_events e
          join public.assignment_operations op on op.id = e.operation_id
         where e.event_idempotency_key like 'legacy_assignment_seed_v1:%'
           and op.lead_id is distinct from e.lead_id) || ' mismatched',
       case when (select count(*) from public.lead_assignment_events e
                    join public.assignment_operations op on op.id = e.operation_id
                   where e.event_idempotency_key like 'legacy_assignment_seed_v1:%'
                     and op.lead_id is distinct from e.lead_id) = 0
            then 'PASS' else 'FAIL' end,
       'each event references the operation belonging to its own assignment''s lead'

union all
select 39, 'D09_empty_database_produced_no_a2_rows', 'consistent',
       case when (select assignments_total from facts) = 0
                 and ((select seed_events from facts) > 0 or (select seed_operations from facts) > 0)
            then 'INCONSISTENT: A2 rows exist with no assignments'
            else 'consistent' end,
       case when (select assignments_total from facts) = 0
                 and ((select seed_events from facts) > 0 or (select seed_operations from facts) > 0)
            then 'FAIL' else 'PASS' end,
       'on empty staging A2 must leave zero batch operations and zero lineage events'

-- === 11. Migration history =================================================
union all
select 40, 'H01_expected_migration_versions_present', 'baseline + A + A2 + B1',
       coalesce((select string_agg(version, ',' order by version)
                   from supabase_migrations.schema_migrations
                  where version in ('20260722000100','20260723000100','20260723000200','20260723000300')), 'none'),
       case when (select count(*) from supabase_migrations.schema_migrations
                   where version in ('20260722000100','20260723000100','20260723000200','20260723000300')) = 4
            then 'PASS' else 'FAIL' end,
       'exactly the reviewed baseline plus the three QF-MVP-20.3B1 versions; run AFTER application'

union all
select 41, 'H02_no_unexpected_20260723_versions', '0',
       (select count(*)::text from supabase_migrations.schema_migrations
         where version like '20260723%'
           and version not in ('20260723000100','20260723000200','20260723000300')),
       case when (select count(*) from supabase_migrations.schema_migrations
                   where version like '20260723%'
                     and version not in ('20260723000100','20260723000200','20260723000300')) = 0
            then 'PASS' else 'FAIL' end,
       'no history falsification and no extra same-day migration'

-- === 12. RLS posture on the new tables =====================================
union all
select 42, 'R01_rls_enabled_no_policies', '5 RLS / 0 policies',
       (select count(*)::text from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relrowsecurity
           and c.relname in ('assignment_operations','replacement_requests',
                             'credit_restoration_approvals','lead_assignment_events','communication_intents'))
       || ' RLS / '
       || (select count(*)::text from pg_catalog.pg_policies
            where schemaname = 'public'
              and tablename in ('assignment_operations','replacement_requests',
                                'credit_restoration_approvals','lead_assignment_events','communication_intents'))
       || ' policies',
       case when (select count(*) from pg_catalog.pg_class c
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relrowsecurity
                     and c.relname in ('assignment_operations','replacement_requests',
                                       'credit_restoration_approvals','lead_assignment_events','communication_intents')) = 5
             and (select count(*) from pg_catalog.pg_policies
                   where schemaname = 'public'
                     and tablename in ('assignment_operations','replacement_requests',
                                       'credit_restoration_approvals','lead_assignment_events','communication_intents')) = 0
            then 'PASS' else 'FAIL' end,
       'RLS on with no policy is deliberately fail-closed for anon and authenticated'

union all
select 43, 'R02_no_anon_authenticated_grant_on_new_tables', '0',
       (select count(*)::text from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name in ('assignment_operations','replacement_requests',
                              'credit_restoration_approvals','lead_assignment_events','communication_intents')
           and grantee in ('anon','authenticated','PUBLIC')),
       case when (select count(*) from information_schema.role_table_grants
                   where table_schema = 'public'
                     and table_name in ('assignment_operations','replacement_requests',
                                        'credit_restoration_approvals','lead_assignment_events','communication_intents')
                     and grantee in ('anon','authenticated','PUBLIC')) = 0
            then 'PASS' else 'FAIL' end,
       'no mutation authority is granted to PUBLIC, anon or authenticated'

union all
select 44, 'R03_lineage_append_only_grants', '0 update/delete grants',
       (select count(*)::text from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'lead_assignment_events'
           and privilege_type in ('UPDATE','DELETE')) || ' update/delete grants',
       case when (select count(*) from information_schema.role_table_grants
                   where table_schema = 'public' and table_name = 'lead_assignment_events'
                     and privilege_type in ('UPDATE','DELETE')) = 0
            then 'PASS' else 'FAIL' end,
       'append-only: no role, including service_role, may UPDATE or DELETE lineage'

)

select check_name, expected, actual, status, details
from results
order by seq;
