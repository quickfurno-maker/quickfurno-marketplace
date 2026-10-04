-- ============================================================================
-- SCALE-P09 — Connection Pooling, Retention & Data Lifecycle
--
-- QuickFurno runtime uses the Supabase Data API and does NOT create a pg.Pool
-- per web replica. This migration therefore focuses on bounded data lifecycle.
--
-- Deletion authority is intentionally tiny:
--   1) finalized automation transport receipts older than the operator cutoff
--   2) processed/ignored webhook receipts older than the operator cutoff
--
-- Business/audit evidence is never auto-deleted here.
-- ============================================================================

begin;

create table if not exists public.data_lifecycle_policies (
  policy_key text primary key,
  relation_name text not null,
  lifecycle_class text not null check (
    lifecycle_class in ('operational','business_evidence','audit','telemetry')
  ),
  hot_days integer not null check (hot_days >= 0),
  retained_days integer not null check (retained_days >= hot_days),
  archive_required_before_delete boolean not null default true,
  auto_delete_enabled boolean not null default false,
  partition_review_bytes bigint not null check (partition_review_bytes > 0),
  timestamp_column text not null,
  notes text not null,
  updated_at timestamptz not null default now()
);

alter table public.data_lifecycle_policies enable row level security;
revoke all on public.data_lifecycle_policies from public, anon, authenticated;
grant select on public.data_lifecycle_policies to service_role;

insert into public.data_lifecycle_policies(
  policy_key,relation_name,lifecycle_class,hot_days,retained_days,
  archive_required_before_delete,auto_delete_enabled,partition_review_bytes,
  timestamp_column,notes,updated_at
) values
  (
    'automation_transport_requests_v1','public.automation_transport_requests','operational',
    7,30,false,true,1073741824,'created_at',
    'Transient transport evidence. Only rows with finalized_at IS NOT NULL are prunable in bounded batches.',
    now()
  ),
  (
    'communication_webhook_receipts_v1','public.communication_webhook_receipts','operational',
    30,365,false,true,1073741824,'created_at',
    'Provider receipt/dedupe evidence. Only processed/ignored rows with processed_at IS NOT NULL are prunable.',
    now()
  ),
  (
    'communication_conversation_events_v1','public.communication_conversation_events','business_evidence',
    30,365,true,false,5368709120,'occurred_at',
    'Conversation history is archive-before-delete and has no Phase 09 auto-delete path.',
    now()
  ),
  (
    'communication_delivery_events_v1','public.communication_delivery_events','business_evidence',
    30,730,true,false,5368709120,'occurred_at',
    'Provider delivery truth is archive-before-delete and has no Phase 09 auto-delete path.',
    now()
  ),
  (
    'automation_execution_attempts_v1','public.automation_execution_attempts','audit',
    30,365,true,false,5368709120,'created_at',
    'Execution audit remains retained; pruning requires a future archive/reconciliation design.',
    now()
  ),
  (
    'audit_logs_v1','public.audit_logs','audit',
    90,2555,true,false,5368709120,'created_at',
    'Administrative audit evidence is retained for seven years unless legal policy changes.',
    now()
  ),
  (
    'lead_matching_runs_v1','public.lead_matching_runs','business_evidence',
    30,365,true,false,5368709120,'created_at',
    'Matching decision evidence is retained and never bulk-deleted by Phase 09.',
    now()
  ),
  (
    'vendor_campaign_events_v1','public.vendor_campaign_events','business_evidence',
    90,730,true,false,5368709120,'occurred_at',
    'Campaign decision/execution history is archive-before-delete.',
    now()
  ),
  (
    'aos_agent_logs_v1','public.aos_agent_logs','telemetry',
    7,30,true,false,1073741824,'created_at',
    'Telemetry is partition-ready metadata only in Phase 09; automatic pruning stays disabled until archive sink is live.',
    now()
  )
on conflict (policy_key) do update set
  relation_name=excluded.relation_name,
  lifecycle_class=excluded.lifecycle_class,
  hot_days=excluded.hot_days,
  retained_days=excluded.retained_days,
  archive_required_before_delete=excluded.archive_required_before_delete,
  auto_delete_enabled=excluded.auto_delete_enabled,
  partition_review_bytes=excluded.partition_review_bytes,
  timestamp_column=excluded.timestamp_column,
  notes=excluded.notes,
  updated_at=now();

-- Time-ordered bounded deletion should not require a whole-table sort.
create index if not exists idx_automation_transport_requests_retention
  on public.automation_transport_requests(created_at,id)
  where finalized_at is not null;

create index if not exists idx_communication_webhook_receipts_retention
  on public.communication_webhook_receipts(created_at,id)
  where processed_at is not null
    and processing_status in ('processed','ignored');

create or replace function public.qf_prune_operational_history_v1(
  p_policy_key text,
  p_before timestamptz,
  p_limit integer default 500
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set statement_timeout = '5000ms'
as $$
declare
  v_limit integer;
  v_deleted integer := 0;
begin
  if p_policy_key is null or p_before is null then
    return jsonb_build_object('status','rejected','reason_code','policy_and_cutoff_required','deleted',0);
  end if;

  -- A lifecycle command must never erase near-live evidence because of a bad
  -- timestamp/unit conversion. The policy's normal cutoffs are much older.
  if p_before > now() - interval '24 hours' then
    return jsonb_build_object('status','rejected','reason_code','cutoff_too_recent','deleted',0);
  end if;

  v_limit := least(greatest(coalesce(p_limit,500),1),1000);

  if p_policy_key = 'automation_transport_requests_v1' then
    with doomed as (
      select t.id
      from public.automation_transport_requests t
      where t.finalized_at is not null
        and t.created_at < p_before
      order by t.created_at,t.id
      limit v_limit
      for update skip locked
    )
    delete from public.automation_transport_requests t
    using doomed d
    where t.id=d.id;
    get diagnostics v_deleted = row_count;

  elsif p_policy_key = 'communication_webhook_receipts_v1' then
    with doomed as (
      select r.id
      from public.communication_webhook_receipts r
      where r.processed_at is not null
        and r.processing_status in ('processed','ignored')
        and r.created_at < p_before
      order by r.created_at,r.id
      limit v_limit
      for update skip locked
    )
    delete from public.communication_webhook_receipts r
    using doomed d
    where r.id=d.id;
    get diagnostics v_deleted = row_count;

  else
    return jsonb_build_object(
      'status','rejected',
      'reason_code','policy_not_auto_prunable',
      'deleted',0
    );
  end if;

  return jsonb_build_object(
    'status','pruned',
    'policy_key',p_policy_key,
    'deleted',v_deleted,
    'batch_limit',v_limit,
    'before',p_before
  );
end;
$$;

comment on function public.qf_prune_operational_history_v1(text,timestamptz,integer) is
  'SCALE-P09 bounded operational-history pruning. Hardcoded allowlist; max 1000 rows; near-live cutoff refused. Business/audit evidence policies are not executable deletion targets.';

revoke all on function public.qf_prune_operational_history_v1(text,timestamptz,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_prune_operational_history_v1(text,timestamptz,integer)
  to service_role;

-- Fail closed if a future edit silently broadens auto-delete beyond the two
-- reviewed operational relations.
do $verify$
declare
  v_enabled text[];
  v_def text;
begin
  select array_agg(policy_key order by policy_key)
    into v_enabled
  from public.data_lifecycle_policies
  where auto_delete_enabled;

  if v_enabled is distinct from array[
    'automation_transport_requests_v1',
    'communication_webhook_receipts_v1'
  ]::text[] then
    raise exception 'SCALE-P09 aborted: auto-delete policy allowlist changed.';
  end if;

  select pg_get_functiondef(
    'public.qf_prune_operational_history_v1(text,timestamptz,integer)'::regprocedure
  ) into v_def;

  if v_def ~* 'delete[[:space:]]+from[[:space:]]+public\.(audit_logs|lead_assignments|vendor_credit_logs|communication_consent_events|communication_delivery_events|communication_conversation_events|lead_matching_runs|vendor_campaign_events)' then
    raise exception 'SCALE-P09 aborted: protected evidence relation entered prune authority.';
  end if;
end;
$verify$;

commit;
