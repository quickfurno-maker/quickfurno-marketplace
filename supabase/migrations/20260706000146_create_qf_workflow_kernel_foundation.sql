-- ============================================================================
-- QuickFurno - 20260706000146_create_qf_workflow_kernel_foundation.sql
-- QF Workflow Kernel v1 / Phase 1A: durable workflow persistence foundation.
--
-- ADDITIVE ONLY. GENERATED FOR REVIEW - DO NOT AUTO-APPLY TO PRODUCTION.
-- Creates internal operational tables and service-role-only RPCs for future
-- workflow workers. Does not connect to lead intake, matching, credits, WhatsApp,
-- n8n, admin UI, vendor UI, or client UI.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- WORKFLOW INSTANCES
-- ----------------------------------------------------------------------------
create table if not exists public.workflow_instances (
  id uuid primary key default gen_random_uuid(),
  workflow_type text not null,
  entity_type text not null,
  entity_id text not null,
  current_state text not null,
  status text not null default 'active',
  version integer not null default 1,
  context_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint workflow_instances_status_check
    check (status in ('active', 'paused', 'completed', 'failed', 'cancelled')),
  constraint workflow_instances_version_check
    check (version >= 1)
);

comment on table public.workflow_instances is
  'Internal durable QuickFurno workflow instance records. RLS enabled; service-role access only in Phase 1A.';
comment on column public.workflow_instances.context_json is
  'Workflow context. Store domain-safe operational data only; never store secrets, API keys, authorization headers, or raw provider payloads.';

-- Prevent accidental duplicate non-terminal instances while preserving completed,
-- failed, and cancelled history and allowing future intentional restarts.
create unique index if not exists uq_workflow_instances_active_entity
  on public.workflow_instances(workflow_type, entity_type, entity_id)
  where status in ('active', 'paused');

create index if not exists idx_workflow_instances_workflow_type
  on public.workflow_instances(workflow_type);
create index if not exists idx_workflow_instances_entity
  on public.workflow_instances(entity_type, entity_id);
create index if not exists idx_workflow_instances_status
  on public.workflow_instances(status);
create index if not exists idx_workflow_instances_updated_at
  on public.workflow_instances(updated_at desc);

-- ----------------------------------------------------------------------------
-- WORKFLOW TASKS
-- ----------------------------------------------------------------------------
create table if not exists public.workflow_tasks (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null references public.workflow_instances(id) on delete cascade,
  task_type text not null,
  status text not null default 'pending',
  priority integer not null default 100,
  due_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_retry_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  idempotency_key text,
  payload_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint workflow_tasks_status_check
    check (status in ('pending', 'processing', 'completed', 'retry_scheduled', 'failed', 'dead_letter', 'cancelled')),
  constraint workflow_tasks_attempt_count_check
    check (attempt_count >= 0),
  constraint workflow_tasks_max_attempts_check
    check (max_attempts > 0),
  constraint workflow_tasks_attempt_bounds_check
    check (attempt_count <= max_attempts)
);

comment on table public.workflow_tasks is
  'Internal durable units of workflow work. Future workers must claim through qf_claim_due_workflow_task.';
comment on column public.workflow_tasks.priority is
  'Higher numeric values are claimed first. Default 100; urgent work can use larger values.';
comment on column public.workflow_tasks.locked_at is
  'Worker lock timestamp. Future recovery can requeue processing rows whose lock is older than a configured threshold.';

create unique index if not exists uq_workflow_tasks_idempotency_key
  on public.workflow_tasks(idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_workflow_tasks_status
  on public.workflow_tasks(status);
create index if not exists idx_workflow_tasks_due_at
  on public.workflow_tasks(due_at);
create index if not exists idx_workflow_tasks_next_retry_at
  on public.workflow_tasks(next_retry_at);
create index if not exists idx_workflow_tasks_priority
  on public.workflow_tasks(priority desc);
create index if not exists idx_workflow_tasks_workflow_instance_id
  on public.workflow_tasks(workflow_instance_id);
create index if not exists idx_workflow_tasks_claim
  on public.workflow_tasks(status, due_at, next_retry_at, priority desc, created_at);
create index if not exists idx_workflow_tasks_processing_locked_at
  on public.workflow_tasks(locked_at)
  where status = 'processing';

-- ----------------------------------------------------------------------------
-- DOMAIN EVENTS
-- ----------------------------------------------------------------------------
create table if not exists public.domain_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  entity_type text,
  entity_id text,
  payload_version integer not null default 1,
  payload_json jsonb not null default '{}'::jsonb,
  trace_id text,
  correlation_id text,
  causation_id text,
  idempotency_key text,
  processing_status text not null default 'pending',
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint domain_events_processing_status_check
    check (processing_status in ('pending', 'processing', 'processed', 'failed', 'dead_letter')),
  constraint domain_events_payload_version_check
    check (payload_version >= 1)
);

comment on table public.domain_events is
  'Internal durable business/domain events for future QuickFurno workflow processing.';
comment on column public.domain_events.payload_json is
  'Domain payload. Store safe domain facts; do not store secrets or raw authorization/provider payloads.';

create unique index if not exists uq_domain_events_idempotency_key
  on public.domain_events(idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_domain_events_processing_status
  on public.domain_events(processing_status);
create index if not exists idx_domain_events_event_type
  on public.domain_events(event_type);
create index if not exists idx_domain_events_entity
  on public.domain_events(entity_type, entity_id);
create index if not exists idx_domain_events_created_at
  on public.domain_events(created_at desc);
create index if not exists idx_domain_events_correlation_id
  on public.domain_events(correlation_id);

-- ----------------------------------------------------------------------------
-- OUTBOX EVENTS
-- ----------------------------------------------------------------------------
create table if not exists public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  command_type text not null,
  entity_type text,
  entity_id text,
  payload_json jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_retry_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  completed_at timestamptz,
  last_error text,
  constraint outbox_events_status_check
    check (status in ('pending', 'processing', 'sent', 'completed', 'retry_scheduled', 'failed', 'dead_letter', 'cancelled')),
  constraint outbox_events_attempt_count_check
    check (attempt_count >= 0),
  constraint outbox_events_max_attempts_check
    check (max_attempts > 0),
  constraint outbox_events_attempt_bounds_check
    check (attempt_count <= max_attempts)
);

comment on table public.outbox_events is
  'Internal durable external command outbox. Phase 1A creates commands storage only; no provider integration or webhook execution.';
comment on column public.outbox_events.payload_json is
  'External command payload. Store the minimum provider-safe data required by a future executor; never store secrets or authorization headers.';

create unique index if not exists uq_outbox_events_idempotency_key
  on public.outbox_events(idempotency_key);

create index if not exists idx_outbox_events_status
  on public.outbox_events(status);
create index if not exists idx_outbox_events_next_retry_at
  on public.outbox_events(next_retry_at);
create index if not exists idx_outbox_events_created_at
  on public.outbox_events(created_at desc);
-- The claim ordering uses created_at as the outbox due-order because Phase 1A
-- intentionally does not add a separate due_at column to the requested outbox shape.
create index if not exists idx_outbox_events_claim
  on public.outbox_events(status, next_retry_at, created_at);
create index if not exists idx_outbox_events_processing_locked_at
  on public.outbox_events(locked_at)
  where status = 'processing';

-- ----------------------------------------------------------------------------
-- WORKFLOW FAILURES
-- ----------------------------------------------------------------------------
create table if not exists public.workflow_failures (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid references public.workflow_instances(id) on delete set null,
  task_id uuid references public.workflow_tasks(id) on delete set null,
  error_code text,
  safe_error_message text not null,
  attempt_number integer not null default 0,
  status text not null default 'open',
  retryable boolean not null default false,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint workflow_failures_status_check
    check (status in ('open', 'retry_scheduled', 'resolved', 'dead_letter')),
  constraint workflow_failures_attempt_number_check
    check (attempt_number >= 0)
);

comment on table public.workflow_failures is
  'Internal operational workflow failure records. Store safe summaries only, never secrets, raw headers, provider tokens, or uncontrolled stack traces.';

create index if not exists idx_workflow_failures_workflow_instance_id
  on public.workflow_failures(workflow_instance_id);
create index if not exists idx_workflow_failures_task_id
  on public.workflow_failures(task_id);
create index if not exists idx_workflow_failures_status
  on public.workflow_failures(status);
create index if not exists idx_workflow_failures_created_at
  on public.workflow_failures(created_at desc);

-- ----------------------------------------------------------------------------
-- IDEMPOTENCY RECORDS
-- ----------------------------------------------------------------------------
create table if not exists public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text unique not null,
  operation_type text not null,
  entity_type text,
  entity_id text,
  status text not null default 'started',
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint idempotency_records_status_check
    check (status in ('started', 'completed', 'failed'))
);

comment on table public.idempotency_records is
  'Internal concurrency-safe idempotency guard records for future workflow/domain operations.';

create index if not exists idx_idempotency_records_operation_type
  on public.idempotency_records(operation_type);
create index if not exists idx_idempotency_records_entity
  on public.idempotency_records(entity_type, entity_id);
create index if not exists idx_idempotency_records_status
  on public.idempotency_records(status);
create index if not exists idx_idempotency_records_updated_at
  on public.idempotency_records(updated_at desc);

-- ----------------------------------------------------------------------------
-- WORKFLOW TRANSITION HISTORY
-- ----------------------------------------------------------------------------
create table if not exists public.workflow_transition_history (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null references public.workflow_instances(id) on delete restrict,
  from_state text,
  to_state text not null,
  event_type text,
  reason text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

comment on table public.workflow_transition_history is
  'Permanent internal audit trail of workflow state transitions. ON DELETE RESTRICT prevents workflow deletion from silently deleting audit history.';

create index if not exists idx_workflow_transition_history_instance_created_at
  on public.workflow_transition_history(workflow_instance_id, created_at);

-- ----------------------------------------------------------------------------
-- ATOMIC WORK CLAIMING FUNCTIONS
-- ----------------------------------------------------------------------------
create or replace function public.qf_claim_due_workflow_task(
  p_worker_id text,
  p_stale_lock_after interval default interval '15 minutes'
)
returns public.workflow_tasks
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_task public.workflow_tasks%rowtype;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'WORKER_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if p_stale_lock_after is null or p_stale_lock_after <= interval '0 seconds' then
    raise exception 'INVALID_STALE_LOCK_INTERVAL' using errcode = 'P0001';
  end if;

  update public.workflow_tasks
  set status = 'processing',
      locked_at = now(),
      locked_by = trim(p_worker_id),
      started_at = coalesce(started_at, now()),
      updated_at = now()
  where id = (
    select wt.id
    from public.workflow_tasks wt
    where wt.due_at <= now()
      and (
        wt.status = 'pending'
        or (wt.status = 'retry_scheduled' and wt.next_retry_at <= now())
      )
      and (
        wt.locked_at is null
        or wt.locked_at <= now() - p_stale_lock_after
      )
    order by wt.priority desc, wt.due_at asc, wt.created_at asc
    for update skip locked
    limit 1
  )
  returning * into v_task;

  return v_task;
end;
$$;

comment on function public.qf_claim_due_workflow_task(text, interval) is
  'Atomically claims one due workflow task using UPDATE over a FOR UPDATE SKIP LOCKED subquery. Service-role only.';

create or replace function public.qf_claim_due_outbox_event(
  p_worker_id text,
  p_stale_lock_after interval default interval '15 minutes'
)
returns public.outbox_events
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event public.outbox_events%rowtype;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'WORKER_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if p_stale_lock_after is null or p_stale_lock_after <= interval '0 seconds' then
    raise exception 'INVALID_STALE_LOCK_INTERVAL' using errcode = 'P0001';
  end if;

  update public.outbox_events
  set status = 'processing',
      locked_at = now(),
      locked_by = trim(p_worker_id),
      updated_at = now()
  where id = (
    select oe.id
    from public.outbox_events oe
    where (
        oe.status = 'pending'
        or (oe.status = 'retry_scheduled' and oe.next_retry_at <= now())
      )
      and (
        oe.locked_at is null
        or oe.locked_at <= now() - p_stale_lock_after
      )
    order by oe.created_at asc
    for update skip locked
    limit 1
  )
  returning * into v_event;

  return v_event;
end;
$$;

comment on function public.qf_claim_due_outbox_event(text, interval) is
  'Atomically claims one due outbox event using UPDATE over a FOR UPDATE SKIP LOCKED subquery. Service-role only.';

create or replace function public.qf_begin_idempotent_operation(
  p_idempotency_key text,
  p_operation_type text,
  p_entity_type text default null,
  p_entity_id text default null
)
returns table (
  id uuid,
  idempotency_key text,
  operation_type text,
  entity_type text,
  entity_id text,
  status text,
  result_json jsonb,
  created_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz,
  was_created boolean
)
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_key text;
  v_operation_type text;
  v_entity_type text;
  v_entity_id text;
  v_record public.idempotency_records%rowtype;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  if p_operation_type is null or length(trim(p_operation_type)) = 0 then
    raise exception 'OPERATION_TYPE_REQUIRED' using errcode = 'P0001';
  end if;

  v_key := trim(p_idempotency_key);
  v_operation_type := trim(p_operation_type);
  v_entity_type := nullif(trim(coalesce(p_entity_type, '')), '');
  v_entity_id := nullif(trim(coalesce(p_entity_id, '')), '');

  insert into public.idempotency_records (
    idempotency_key,
    operation_type,
    entity_type,
    entity_id,
    status
  )
  values (
    v_key,
    v_operation_type,
    v_entity_type,
    v_entity_id,
    'started'
  )
  on conflict (idempotency_key) do nothing
  returning * into v_record;

  if v_record.id is not null then
    return query
    select
      v_record.id,
      v_record.idempotency_key,
      v_record.operation_type,
      v_record.entity_type,
      v_record.entity_id,
      v_record.status,
      v_record.result_json,
      v_record.created_at,
      v_record.completed_at,
      v_record.updated_at,
      true;
    return;
  end if;

  select existing.*
  into v_record
  from public.idempotency_records existing
  where existing.idempotency_key = v_key;

  if v_record.id is null then
    raise exception 'IDEMPOTENCY_RECORD_NOT_FOUND_AFTER_CONFLICT' using errcode = 'P0001';
  end if;

  if v_record.operation_type is distinct from v_operation_type
    or v_record.entity_type is distinct from v_entity_type
    or v_record.entity_id is distinct from v_entity_id
  then
    raise exception 'IDEMPOTENCY_KEY_SCOPE_MISMATCH' using errcode = 'P0001';
  end if;

  return query
  select
    v_record.id,
    v_record.idempotency_key,
    v_record.operation_type,
    v_record.entity_type,
    v_record.entity_id,
    v_record.status,
    v_record.result_json,
    v_record.created_at,
    v_record.completed_at,
    v_record.updated_at,
    false;
end;
$$;

comment on function public.qf_begin_idempotent_operation(text, text, text, text) is
  'Concurrency-safe insert-first idempotency guard. One caller inserts; same-scope duplicates receive the existing record with was_created=false; scope mismatches raise IDEMPOTENCY_KEY_SCOPE_MISMATCH. Service-role only.';

-- ----------------------------------------------------------------------------
-- RLS / PRIVILEGES
-- ----------------------------------------------------------------------------
alter table public.workflow_instances enable row level security;
alter table public.workflow_tasks enable row level security;
alter table public.domain_events enable row level security;
alter table public.outbox_events enable row level security;
alter table public.workflow_failures enable row level security;
alter table public.idempotency_records enable row level security;
alter table public.workflow_transition_history enable row level security;

-- Internal operational tables: no browser/public access in Phase 1A.
-- service_role bypasses RLS in Supabase; explicit grants document intended use.
revoke all on public.workflow_instances from anon;
revoke all on public.workflow_instances from authenticated;
revoke all on public.workflow_tasks from anon;
revoke all on public.workflow_tasks from authenticated;
revoke all on public.domain_events from anon;
revoke all on public.domain_events from authenticated;
revoke all on public.outbox_events from anon;
revoke all on public.outbox_events from authenticated;
revoke all on public.workflow_failures from anon;
revoke all on public.workflow_failures from authenticated;
revoke all on public.idempotency_records from anon;
revoke all on public.idempotency_records from authenticated;
revoke all on public.workflow_transition_history from anon;
revoke all on public.workflow_transition_history from authenticated;

grant select, insert, update, delete on public.workflow_instances to service_role;
grant select, insert, update, delete on public.workflow_tasks to service_role;
grant select, insert, update, delete on public.domain_events to service_role;
grant select, insert, update, delete on public.outbox_events to service_role;
grant select, insert, update, delete on public.workflow_failures to service_role;
grant select, insert, update, delete on public.idempotency_records to service_role;
grant select, insert, update, delete on public.workflow_transition_history to service_role;

revoke all on function public.qf_claim_due_workflow_task(text, interval) from public;
revoke all on function public.qf_claim_due_workflow_task(text, interval) from anon;
revoke all on function public.qf_claim_due_workflow_task(text, interval) from authenticated;
grant execute on function public.qf_claim_due_workflow_task(text, interval) to service_role;

revoke all on function public.qf_claim_due_outbox_event(text, interval) from public;
revoke all on function public.qf_claim_due_outbox_event(text, interval) from anon;
revoke all on function public.qf_claim_due_outbox_event(text, interval) from authenticated;
grant execute on function public.qf_claim_due_outbox_event(text, interval) to service_role;

revoke all on function public.qf_begin_idempotent_operation(text, text, text, text) from public;
revoke all on function public.qf_begin_idempotent_operation(text, text, text, text) from anon;
revoke all on function public.qf_begin_idempotent_operation(text, text, text, text) from authenticated;
grant execute on function public.qf_begin_idempotent_operation(text, text, text, text) to service_role;
