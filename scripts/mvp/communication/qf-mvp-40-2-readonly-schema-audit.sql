-- ============================================================================
-- QF-MVP-40.2 — COMMUNICATION MIGRATION & SCHEMA READINESS AUDIT
-- STRICTLY READ-ONLY. SELECT statements only.
--
-- Safe to run repeatedly against ANY QuickFurno environment. It performs no
-- write of any kind: no INSERT/UPDATE/DELETE/MERGE/COPY, no DDL, no GRANT, no
-- DO block, no temporary table, no SET ROLE, no SECURITY DEFINER call, no
-- application RPC invocation, and no transaction that writes.
--
-- PRIVACY. Catalogue metadata and bounded aggregates only. It never selects a
-- phone number, email, name, message body, template body, raw metadata, token
-- or row identifier. Every output column is a label, a count or a verdict.
--
-- USAGE
--   SECTION 1 (A,B,C,D,E,F,G,I) is catalogue-only and is safe even on a database
--   where none of the communication tables exist — it reads pg_catalog /
--   information_schema / supabase_migrations only.
--
--   SECTION 2 (H) reads bounded AGGREGATE COUNTS from communication tables.
--   PostgreSQL parses a whole statement before executing it, so a missing table
--   makes the statement fail to parse. Run SECTION 2 only after SECTION 1 has
--   reported the relevant tables as PRESENT. A parse failure there is harmless
--   (nothing is written) but it is not evidence — treat it as UNKNOWN.
--
--   The environment label is supplied EXTERNALLY by the operator, never inferred
--   from a secret or a connection string.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — CATALOGUE AUDIT (always safe)
-- ============================================================================
with

-- ---- A. IDENTITY --------------------------------------------------------
identity as (
  select
    'A_IDENTITY'::text                                as section,
    k                                                 as check_name,
    v                                                 as observed,
    'INFO'::text                                      as verdict
  from (values
    ('current_database',   current_database()),
    ('current_user',       current_user::text),
    ('session_user',       session_user::text),
    ('server_version',     current_setting('server_version')),
    ('utc_now',            to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    ('is_superuser',       coalesce((select usesuper::text from pg_user where usename = current_user), 'unknown'))
  ) as t(k, v)
),

-- ---- B. MIGRATION HISTORY ----------------------------------------------
-- The 12 communication migration versions QF-MVP-40 depends on.
expected_versions(version) as (
  values ('20260708000170'),('20260708000190'),('20260708000200'),
         ('20260709000100'),('20260709000200'),('20260711000100'),
         ('20260711000200'),('20260712000300'),('20260713000100'),
         ('20260716000100'),('20260720000100'),('20260721000100')
),
history_rows as (
  select version::text as version
  from supabase_migrations.schema_migrations
),
history_check as (
  select
    'B_MIGRATION_HISTORY'::text as section,
    'history_recorded:' || e.version as check_name,
    case when h.version is null then 'ABSENT' else 'RECORDED' end as observed,
    case when h.version is null then 'NOT_RECORDED' else 'RECORDED' end as verdict
  from expected_versions e
  left join history_rows h on h.version = e.version
),
history_summary as (
  select 'B_MIGRATION_HISTORY'::text, k, v, 'INFO'::text
  from (values
    ('history_total_rows',        (select count(*)::text from history_rows)),
    ('history_latest_version',    coalesce((select max(version) from history_rows), 'NONE')),
    ('history_expected_present',  (select count(*)::text from expected_versions e
                                     join history_rows h on h.version = e.version)),
    ('history_duplicate_versions',(select count(*)::text from (
                                     select version from history_rows
                                     group by version having count(*) > 1) d))
  ) as t(k, v)
),

-- ---- C. CORE COMMUNICATION OBJECTS -------------------------------------
expected_tables(tbl, purpose) as (
  values
    ('communication_templates',                 'template catalogue'),
    ('communication_messages',                  'outbound ledger'),
    ('communication_delivery_events',           'delivery lifecycle'),
    ('communication_webhook_receipts',          'webhook receipts'),
    ('communication_automation_catalog',        'automation catalogue'),
    ('communication_provider_accounts',         'provider accounts'),
    ('communication_provider_template_mappings','template/provider mappings'),
    ('communication_provider_runtime_policies', 'runtime gates'),
    ('communication_provider_canary_destinations','canary allowlist'),
    ('communication_channel_capabilities',      'channel capabilities'),
    ('communication_preferences',               'consent preferences'),
    ('communication_suppressions',              'suppressions'),
    ('communication_consent_events',            'consent evidence'),
    ('communication_consent_command_receipts',  'consent command receipts'),
    ('communication_consent_ack_intents',       'ack intents'),
    ('communication_inbound_messages',          'inbound messages'),
    ('communication_intents',                   'communication intents'),
    ('authentication_delivery_attempts',        'auth transport attempts'),
    ('authentication_transport_policies',       'auth transport policy')
),
table_presence as (
  select
    'C_OBJECTS'::text as section,
    'table:' || tbl as check_name,
    case when to_regclass('public.' || tbl) is null then 'ABSENT' else 'PRESENT' end as observed,
    case when to_regclass('public.' || tbl) is null then 'ABSENT' else 'PRESENT' end as verdict
  from expected_tables
),

-- ---- D. COLUMNS AND NULLABILITY ----------------------------------------
expected_columns(tbl, col, note) as (
  values
    ('communication_messages',            'provider_account_id',    'outbound account lineage'),
    ('communication_messages',            'provider_message_id',    'provider message id'),
    ('communication_messages',            'mapping_fingerprint',    'pinned mapping fingerprint'),
    ('communication_delivery_events',     'provider_account_id',    'callback account lineage'),
    ('communication_delivery_events',     'provider_event_id',      'callback idempotency'),
    ('communication_inbound_messages',    'provider_account_id',    'inbound account lineage'),
    ('communication_inbound_messages',    'provider_message_id',    'inbound idempotency'),
    ('communication_webhook_receipts',    'provider_account_id',    'receipt account lineage'),
    ('communication_consent_ack_intents', 'provider_account_id',    'ack account lineage'),
    ('communication_consent_ack_intents', 'ack_type',               'ack vocabulary'),
    ('communication_consent_ack_intents', 'status',                 'ack lifecycle'),
    ('communication_suppressions',        'scope',                  'suppression scope'),
    ('communication_preferences',         'scope',                  'preference scope')
),
column_presence as (
  select
    'D_COLUMNS'::text as section,
    'column:' || e.tbl || '.' || e.col as check_name,
    case
      when to_regclass('public.' || e.tbl) is null then 'TABLE_ABSENT'
      when c.column_name is null then 'COLUMN_ABSENT'
      else c.data_type || '/' || case when c.is_nullable = 'YES' then 'NULLABLE' else 'NOT_NULL' end
    end as observed,
    case
      when to_regclass('public.' || e.tbl) is null then 'UNKNOWN'
      when c.column_name is null then 'ABSENT'
      else 'PRESENT'
    end as verdict
  from expected_columns e
  left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = e.tbl and c.column_name = e.col
),

-- ---- E. CONSTRAINTS -----------------------------------------------------
expected_constraints(conname, note) as (
  values
    ('communication_delivery_events_provider_account_required_check', 'Wave 1 delivery-event account required'),
    ('communication_consent_ack_intents_provider_account_req_check',  'Wave 2A-R2 ack-intent account required'),
    ('uq_comm_delivery_event_account_event',                          'delivery event idempotency per account'),
    ('uq_comm_inbound_account_message',                               'inbound idempotency per account'),
    ('uq_comm_message_account_provider_message',                      'outbound provider-message uniqueness'),
    ('uq_comm_webhook_receipt_account_event',                         'receipt uniqueness per account'),
    ('uq_communication_intents_idempotency',                          'intent idempotency'),
    ('ck_consent_command_receipt_scope_results',                      'consent receipt scope shape')
),
constraint_presence as (
  select
    'E_CONSTRAINTS'::text as section,
    'constraint:' || e.conname as check_name,
    case when c.conname is null and i.indexname is null then 'ABSENT' else 'PRESENT' end as observed,
    case when c.conname is null and i.indexname is null then 'ABSENT' else 'PRESENT' end as verdict
  from expected_constraints e
  left join pg_constraint c on c.conname = e.conname
  left join pg_indexes  i on i.indexname = e.conname and i.schemaname = 'public'
),

-- ---- F. FUNCTIONS / RPCS -----------------------------------------------
expected_functions(fname, note) as (
  values
    ('apply_communication_consent_command',                'consent command writer'),
    ('qf_claim_consent_ack_intents',                       'ack claim'),
    ('qf_expire_consent_ack_intents',                      'ack expiry'),
    ('qf_recover_stale_dispatching_consent_ack_intents',   'ack recovery'),
    ('qf_reserve_consent_ack_provider_attempt',            'ack attempt reservation'),
    ('qf_terminalize_consent_ack_intent',                  'ack terminalization'),
    ('communication_consent_receipt_results_valid',        'receipt validation'),
    ('communication_consent_receipt_scope_result_valid',   'receipt scope validation')
),
function_presence as (
  select
    'F_FUNCTIONS'::text as section,
    'function:' || e.fname as check_name,
    case
      when p.proname is null then 'ABSENT'
      else 'args=' || pg_get_function_identity_arguments(p.oid)
           || '; secdef=' || p.prosecdef::text
           || '; owner=' || pg_get_userbyid(p.proowner)
           || '; search_path=' || coalesce(array_to_string(p.proconfig, ','), 'UNSET')
    end as observed,
    case when p.proname is null then 'ABSENT' else 'PRESENT' end as verdict
  from expected_functions e
  left join pg_proc p on p.proname = e.fname
    and p.pronamespace = 'public'::regnamespace
),

-- ---- G. TRIGGERS / RLS / GRANTS ----------------------------------------
rls_state as (
  select
    'G_RLS'::text as section,
    'rls:' || c.relname as check_name,
    'enabled=' || c.relrowsecurity::text || '; forced=' || c.relforcerowsecurity::text
      || '; policies=' || (select count(*)::text from pg_policy p where p.polrelid = c.oid) as observed,
    case when c.relrowsecurity then 'RLS_ON' else 'RLS_OFF' end as verdict
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname like 'communication%'
),
function_grants as (
  select
    'G_GRANTS'::text as section,
    'execute_grant:' || e.fname as check_name,
    'anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
      || '; authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
      || '; service_role=' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text as observed,
    'INFO'::text as verdict
  from expected_functions e
  join pg_proc p on p.proname = e.fname and p.pronamespace = 'public'::regnamespace
),

-- ---- I. REQUIRED INVARIANTS --------------------------------------------
invariants as (
  select 'I_INVARIANTS'::text as section, k as check_name, v as observed,
         case when v = 'true' then 'PASS' when v = 'false' then 'FAIL' else 'UNKNOWN' end as verdict
  from (values
    ('inv_provider_accounts_table_exists',
      (to_regclass('public.communication_provider_accounts') is not null)::text),
    ('inv_template_mappings_table_exists',
      (to_regclass('public.communication_provider_template_mappings') is not null)::text),
    ('inv_runtime_policies_table_exists',
      (to_regclass('public.communication_provider_runtime_policies') is not null)::text),
    ('inv_inbound_table_exists',
      (to_regclass('public.communication_inbound_messages') is not null)::text),
    ('inv_ack_intents_table_exists',
      (to_regclass('public.communication_consent_ack_intents') is not null)::text),
    ('inv_delivery_events_table_exists',
      (to_regclass('public.communication_delivery_events') is not null)::text),
    ('inv_intents_table_exists',
      (to_regclass('public.communication_intents') is not null)::text),
    ('inv_delivery_event_account_constraint',
      (exists (select 1 from pg_constraint
                where conname = 'communication_delivery_events_provider_account_required_check'))::text),
    ('inv_ack_intent_account_constraint',
      (exists (select 1 from pg_constraint
                where conname = 'communication_consent_ack_intents_provider_account_req_check'))::text),
    ('inv_consent_writer_rpc_exists',
      (exists (select 1 from pg_proc where proname = 'apply_communication_consent_command'
                and pronamespace = 'public'::regnamespace))::text),
    ('inv_ack_worker_rpcs_all_five',
      ((select count(*) from pg_proc where pronamespace = 'public'::regnamespace
         and proname in ('qf_claim_consent_ack_intents','qf_expire_consent_ack_intents',
                         'qf_recover_stale_dispatching_consent_ack_intents',
                         'qf_reserve_consent_ack_provider_attempt',
                         'qf_terminalize_consent_ack_intent')) = 5)::text)
  ) as t(k, v)
)

select section, check_name, observed, verdict from identity
union all select * from history_summary
union all select * from history_check
union all select * from table_presence
union all select * from column_presence
union all select * from constraint_presence
union all select * from function_presence
union all select * from rls_state
union all select * from function_grants
union all select * from invariants
order by section, check_name;


-- ============================================================================
-- SECTION 2 — BOUNDED NON-PII AGGREGATE COUNTS
--
-- Run ONLY where SECTION 1 reported the referenced tables PRESENT. Aggregates
-- and grouped status labels only — never an id, destination, body or metadata.
-- Statement is read-only; a parse failure on an absent table writes nothing and
-- must be recorded as UNKNOWN rather than as evidence of emptiness.
-- ============================================================================
-- select 'provider_accounts_total' as metric, count(*)::text as value
--   from public.communication_provider_accounts
-- union all
-- select 'template_mappings_total', count(*)::text
--   from public.communication_provider_template_mappings
-- union all
-- select 'inbound_messages_total', count(*)::text
--   from public.communication_inbound_messages
-- union all
-- select 'inbound_null_provider_account', count(*)::text
--   from public.communication_inbound_messages where provider_account_id is null
-- union all
-- select 'delivery_events_total', count(*)::text
--   from public.communication_delivery_events
-- union all
-- select 'delivery_events_null_provider_account', count(*)::text
--   from public.communication_delivery_events where provider_account_id is null
-- union all
-- select 'ack_intents_total', count(*)::text
--   from public.communication_consent_ack_intents
-- union all
-- select 'communication_intents_total', count(*)::text
--   from public.communication_intents
-- union all
-- select 'suppressions_total', count(*)::text
--   from public.communication_suppressions
-- union all
-- select 'communication_messages_total', count(*)::text
--   from public.communication_messages
-- order by metric;
