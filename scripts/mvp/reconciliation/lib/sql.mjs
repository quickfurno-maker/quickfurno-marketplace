// ============================================================================
// QF-MVP-10.7 — Read-only reconciliation SQL (metadata only).
//
// Every statement here is SELECT / SHOW / BEGIN READ ONLY / COMMIT only. Nothing
// mutates. `assertReadOnly` scans outgoing SQL for write/DDL keywords and refuses
// to run if any appear. Queries read pg_catalog / information_schema and return a
// single JSON value (json_agg with ORDER BY) so output is deterministic. No query
// selects business row contents, phone/email/message columns, or secrets.
// ============================================================================

// Forbidden as WHOLE words in outgoing SQL (results may legitimately contain
// these — e.g. a function body is DDL text — but we never SEND them). Catalog
// names like `role_table_grants` are safe: `\bgrant\b` does not match `grants`.
const FORBIDDEN = [
  'insert', 'update', 'delete', 'upsert', 'merge', 'drop', 'alter', 'create',
  'truncate', 'grant', 'revoke', 'comment', 'reindex', 'vacuum', 'cluster',
  'call', 'do', 'copy', 'refresh', 'lock',
];

export function assertReadOnly(sql) {
  const lower = sql.toLowerCase();
  for (const kw of FORBIDDEN) {
    const re = new RegExp(`(^|[^a-z_])${kw}([^a-z_]|$)`, 'i');
    if (re.test(lower)) {
      throw new Error(`[reconcile] refusing to run SQL containing forbidden keyword "${kw}"`);
    }
  }
  return sql;
}

// The specific load-bearing RPCs whose exact live body must be resolved.
export const FUNCTION_TARGETS = [
  'assign_lead_to_paid_vendors_phase26a', 'assign_lead_to_paid_vendors',
  'admin_smart_assign_lead_to_vendors', 'assign_lead_to_vendors',
  'assign_lead_to_preferred_vendor', 'assign_client_selected_vendor_to_group',
  'assign_vendor_to_requirement_group', 'qf_apply_vendor_credit_delta',
  'deduct_vendor_credit', 'restore_vendor_credit', 'increment_vendor_credits',
  'refund_credit_for_invalid_lead', 'assign_package_to_vendor',
  'apply_communication_consent_command',
  'communication_consent_receipt_results_valid',
  'communication_consent_receipt_scope_result_valid',
  'qf_claim_consent_ack_intents', 'qf_reserve_consent_ack_provider_attempt',
  'qf_terminalize_consent_ack_intent', 'qf_expire_consent_ack_intents',
  'qf_recover_stale_dispatching_consent_ack_intents',
  'qf_claim_auth_delivery_attempt', 'qf_finalize_auth_delivery_attempt',
];

const fnList = FUNCTION_TARGETS.map((f) => `'${f}'`).join(',');

// The tables whose provider-account / idempotency constraints matter.
const CONSTRAINT_TABLES = [
  'lead_assignments', 'vendor_credit_logs', 'communication_messages',
  'communication_delivery_events', 'communication_consent_ack_intents',
  'communication_inbound_messages', 'communication_webhook_receipts',
  'communication_consent_events', 'communication_provider_accounts',
];
const ctList = CONSTRAINT_TABLES.map((t) => `'${t}'`).join(',');

// Each section returns exactly one JSON line (tuples-only, unaligned psql).
export const SECTIONS = [
  { name: 'readonly_check', kind: 'scalar', sql: `show transaction_read_only;` },

  { name: 'identity', kind: 'json', sql:
`select json_build_object(
  'current_database', current_database(),
  'current_user', current_user,
  'server_version', current_setting('server_version'),
  'server_version_num', current_setting('server_version_num'),
  'transaction_read_only', current_setting('transaction_read_only')
);` },

  // Which migration-history tables exist (do not assume one shape).
  { name: 'migration_tables', kind: 'json', sql:
`select coalesce(json_agg(json_build_object('schema', table_schema, 'table', table_name) order by table_schema, table_name), '[]')
from information_schema.tables
where table_name ilike '%schema_migrations%' or (table_schema='supabase_migrations');` },

  // Recorded migrations in the Supabase ledger (version/name; NEVER the SQL body).
  { name: 'migrations_supabase', kind: 'json', sql:
`select case when to_regclass('supabase_migrations.schema_migrations') is not null
  then (select coalesce(json_agg((to_jsonb(m) - 'statements') order by m.version), '[]')
        from supabase_migrations.schema_migrations m)
  else '[]'::json end;` },

  // Recorded migrations in a legacy public.schema_migrations (version only).
  { name: 'migrations_public', kind: 'json', sql:
`select case when to_regclass('public.schema_migrations') is not null
  then (select coalesce(json_agg(to_jsonb(m) order by 1), '[]') from public.schema_migrations m)
  else '[]'::json end;` },

  // Tables + columns (public).
  { name: 'columns', kind: 'json', sql:
`select coalesce(json_agg(json_build_object(
  'table', table_name, 'column', column_name, 'type', data_type,
  'nullable', is_nullable, 'default', column_default
) order by table_name, ordinal_position), '[]')
from information_schema.columns where table_schema='public';` },

  // Constraints (PK/FK/UNIQUE/CHECK) with exact definitions + validated state.
  { name: 'constraints', kind: 'json', sql:
`select coalesce(json_agg(json_build_object(
  'table', c.conrelid::regclass::text, 'name', c.conname,
  'type', c.contype, 'validated', c.convalidated,
  'definition', pg_get_constraintdef(c.oid)
) order by c.conrelid::regclass::text, c.conname), '[]')
from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public';` },

  // Indexes (exact defs, uniqueness, predicates via indexdef).
  { name: 'indexes', kind: 'json', sql:
`select coalesce(json_agg(json_build_object(
  'table', tablename, 'index', indexname, 'definition', indexdef
) order by tablename, indexname), '[]')
from pg_indexes where schemaname='public';` },

  // All functions: signature + security + volatility + body fingerprint (no body).
  { name: 'functions', kind: 'json', sql:
`select coalesce(json_agg(json_build_object(
  'name', p.proname, 'args', pg_get_function_identity_arguments(p.oid),
  'result', pg_get_function_result(p.oid), 'security_definer', p.prosecdef,
  'volatility', p.provolatile, 'owner', pg_get_userbyid(p.proowner),
  'body_md5', md5(pg_get_functiondef(p.oid))
) order by p.proname, pg_get_function_identity_arguments(p.oid)), '[]')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind='f';` },

  // Load-bearing RPCs: EXACT body + derived behaviour flags + exec grants.
  { name: 'load_bearing_functions', kind: 'json', sql:
`select coalesce(json_agg(json_build_object(
  'name', p.proname, 'args', pg_get_function_identity_arguments(p.oid),
  'result', pg_get_function_result(p.oid), 'security_definer', p.prosecdef,
  'volatility', p.provolatile, 'owner', pg_get_userbyid(p.proowner),
  'body_md5', md5(pg_get_functiondef(p.oid)),
  'body', pg_get_functiondef(p.oid),
  'writes_vendor_credit_logs', (pg_get_functiondef(p.oid) ilike '%vendor_credit_logs%'),
  'debits_credits', (pg_get_functiondef(p.oid) ~* 'remaining_credits[[:space:]]*-|deduct_vendor_credit|qf_apply_vendor_credit_delta'),
  'restores_credits', (pg_get_functiondef(p.oid) ~* 'restore_vendor_credit|increment_vendor_credits|remaining_credits[[:space:]]*\\+'),
  'mentions_max_vendors', (pg_get_functiondef(p.oid) ~* 'max_vendors_per_lead|array_length\\(v_assigned'),
  'mentions_lifetime_or_total', (pg_get_functiondef(p.oid) ~* 'total_limit|lifetime|unique.*vendor'),
  'exec_grants', (select coalesce(json_agg(g.grantee order by g.grantee), '[]')
                  from information_schema.role_routine_grants g
                  where g.specific_schema='public' and g.routine_name=p.proname)
) order by p.proname, pg_get_function_identity_arguments(p.oid)), '[]')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (${fnList});` },

  // Triggers (exact def + enabled state).
  { name: 'triggers', kind: 'json', sql:
`select coalesce(json_agg(json_build_object(
  'table', t.tgrelid::regclass::text, 'name', t.tgname,
  'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid)
) order by t.tgrelid::regclass::text, t.tgname), '[]')
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal;` },

  // RLS enabled/forced per table.
  { name: 'rls', kind: 'json', sql:
`select coalesce(json_agg(json_build_object(
  'table', c.relname, 'rls_enabled', c.relrowsecurity, 'rls_forced', c.relforcerowsecurity
) order by c.relname), '[]')
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r';` },

  // Policies (name/command/roles/USING/WITH CHECK).
  { name: 'policies', kind: 'json', sql:
`select coalesce(json_agg(json_build_object(
  'table', tablename, 'policy', policyname, 'command', cmd,
  'roles', roles, 'using', qual, 'with_check', with_check
) order by tablename, policyname), '[]')
from pg_policies where schemaname='public';` },

  // Table grants (who can read/write which table).
  { name: 'table_grants', kind: 'json', sql:
`select coalesce(json_agg(json_build_object(
  'table', table_name, 'grantee', grantee, 'privilege', privilege_type
) order by table_name, grantee, privilege_type), '[]')
from information_schema.role_table_grants where table_schema='public';` },

  // SAFE aggregate evidence — counts only, no row contents.
  // NULL provider_account_id counts on constrained comms tables + duplicate credit refs
  // + duplicate assignment business keys. Each guarded by to_regclass.
  { name: 'safe_counts', kind: 'json', sql:
`select json_build_object(
  'delivery_events_null_provider_account',
    case when to_regclass('public.communication_delivery_events') is not null
      then (select count(*) from public.communication_delivery_events where provider_account_id is null) else null end,
  'ack_intents_null_provider_account',
    case when to_regclass('public.communication_consent_ack_intents') is not null
      then (select count(*) from public.communication_consent_ack_intents where provider_account_id is null) else null end,
  'messages_null_provider_account',
    case when to_regclass('public.communication_messages') is not null
      then (select count(*) from public.communication_messages where provider_account_id is null) else null end,
  'vendor_credit_log_duplicate_references',
    case when to_regclass('public.vendor_credit_logs') is not null
      then (select count(*) from (select reference_type, reference_id from public.vendor_credit_logs
             where reference_id is not null group by 1,2 having count(*) > 1) d) else null end,
  'lead_assignment_duplicate_pairs',
    case when to_regclass('public.lead_assignments') is not null
      then (select count(*) from (select lead_id, vendor_id from public.lead_assignments
             group by 1,2 having count(*) > 1) d) else null end,
  'lead_assignments_total', case when to_regclass('public.lead_assignments') is not null
      then (select count(*) from public.lead_assignments) else null end,
  'vendor_credit_logs_total', case when to_regclass('public.vendor_credit_logs') is not null
      then (select count(*) from public.vendor_credit_logs) else null end
);` },
];

// Targeted constraint-existence checks by name (answered from the `constraints`
// + `indexes` sections; listed here for the results report).
export const EXPECTED_CONSTRAINTS = [
  'uq_vendor_credit_logs_reference',
  'communication_delivery_events_provider_account_required_check',
  'communication_consent_ack_intents_provider_account_req_check',
  'lead_assignments unique (lead_id, vendor_id)',
  'lead_assignment_approvals_max_three_vendors',
];

export { CONSTRAINT_TABLES };
