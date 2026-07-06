-- ============================================================================
-- QuickFurno - 20260706000148_workflow_kernel_safety_hardening.sql
-- QF Workflow Kernel v1 / Phase 1B correction: ownership and retry hardening.
--
-- ADDITIVE ONLY. GENERATED FOR REVIEW - DO NOT AUTO-APPLY TO PRODUCTION.
-- Does not connect real leads, matching, credits, WhatsApp, n8n production,
-- UI, PM2, workers, or provider execution.
-- ============================================================================

-- Domain event retry lifecycle. Existing rows receive deterministic defaults.
alter table public.domain_events
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 5,
  add column if not exists next_retry_at timestamptz;

alter table public.domain_events
  drop constraint if exists domain_events_processing_status_check;

alter table public.domain_events
  drop constraint if exists domain_events_attempt_count_check,
  drop constraint if exists domain_events_max_attempts_check,
  drop constraint if exists domain_events_attempt_bounds_check;

alter table public.domain_events
  add constraint domain_events_processing_status_check
    check (processing_status in ('pending', 'processing', 'retry_scheduled', 'processed', 'failed', 'dead_letter')),
  add constraint domain_events_attempt_count_check
    check (attempt_count >= 0),
  add constraint domain_events_max_attempts_check
    check (max_attempts > 0),
  add constraint domain_events_attempt_bounds_check
    check (attempt_count <= max_attempts);

comment on column public.domain_events.attempt_count is
  'Number of failed processing attempts recorded by the Workflow Kernel. Incremented when an owned processing event is scheduled for retry or dead-lettered.';
comment on column public.domain_events.max_attempts is
  'Maximum deterministic processing attempts before the event is dead-lettered.';
comment on column public.domain_events.next_retry_at is
  'When a retry_scheduled event becomes eligible for reacquisition. No automatic cron is created in Phase 1B.';

create index if not exists idx_domain_events_retry_due
  on public.domain_events(processing_status, next_retry_at)
  where processing_status = 'retry_scheduled';

-- The original Phase 1B function remains in migration history, but service_role
-- should use the owner-aware overload below.
revoke all on function public.qf_acquire_domain_event(uuid, text) from public;
revoke all on function public.qf_acquire_domain_event(uuid, text) from anon;
revoke all on function public.qf_acquire_domain_event(uuid, text) from authenticated;
revoke all on function public.qf_acquire_domain_event(uuid, text) from service_role;

revoke all on function public.qf_apply_workflow_step(uuid, text, integer, text, text, uuid, text, text, jsonb, text, jsonb, jsonb) from public;
revoke all on function public.qf_apply_workflow_step(uuid, text, integer, text, text, uuid, text, text, jsonb, text, jsonb, jsonb) from anon;
revoke all on function public.qf_apply_workflow_step(uuid, text, integer, text, text, uuid, text, text, jsonb, text, jsonb, jsonb) from authenticated;
revoke all on function public.qf_apply_workflow_step(uuid, text, integer, text, text, uuid, text, text, jsonb, text, jsonb, jsonb) from service_role;

-- ----------------------------------------------------------------------------
-- Acquire or safely skip a specific domain event.
-- ----------------------------------------------------------------------------
create or replace function public.qf_acquire_domain_event(
  p_event_id uuid,
  p_worker_id text,
  p_stale_lock_after interval default interval '15 minutes'
)
returns table (
  id uuid,
  event_type text,
  entity_type text,
  entity_id text,
  payload_version integer,
  payload_json jsonb,
  trace_id text,
  correlation_id text,
  causation_id text,
  idempotency_key text,
  processing_status text,
  processed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  attempt_count integer,
  max_attempts integer,
  next_retry_at timestamptz,
  acquisition_status text
)
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event public.domain_events%rowtype;
begin
  if p_event_id is null then
    raise exception 'DOMAIN_EVENT_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'WORKER_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if p_stale_lock_after is null or p_stale_lock_after <= interval '0 seconds' then
    raise exception 'INVALID_STALE_LOCK_INTERVAL' using errcode = 'P0001';
  end if;

  update public.domain_events de
  set processing_status = 'processing',
      locked_at = now(),
      locked_by = trim(p_worker_id),
      updated_at = now()
  where de.id = p_event_id
    and (
      de.processing_status = 'pending'
      or (de.processing_status = 'retry_scheduled' and de.next_retry_at <= now())
      or (de.processing_status = 'processing' and de.locked_at <= now() - p_stale_lock_after)
    )
  returning * into v_event;

  if v_event.id is not null then
    return query
    select
      v_event.id,
      v_event.event_type,
      v_event.entity_type,
      v_event.entity_id,
      v_event.payload_version,
      v_event.payload_json,
      v_event.trace_id,
      v_event.correlation_id,
      v_event.causation_id,
      v_event.idempotency_key,
      v_event.processing_status,
      v_event.processed_at,
      v_event.created_at,
      v_event.updated_at,
      v_event.locked_at,
      v_event.locked_by,
      v_event.attempt_count,
      v_event.max_attempts,
      v_event.next_retry_at,
      'acquired'::text;
    return;
  end if;

  select * into v_event
  from public.domain_events
  where public.domain_events.id = p_event_id;

  if v_event.id is null then
    raise exception 'DOMAIN_EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_event.processing_status = 'processed' then
    return query
    select v_event.id, v_event.event_type, v_event.entity_type, v_event.entity_id,
      v_event.payload_version, v_event.payload_json, v_event.trace_id,
      v_event.correlation_id, v_event.causation_id, v_event.idempotency_key,
      v_event.processing_status, v_event.processed_at, v_event.created_at,
      v_event.updated_at, v_event.locked_at, v_event.locked_by,
      v_event.attempt_count, v_event.max_attempts, v_event.next_retry_at,
      'already_processed'::text;
    return;
  end if;

  if v_event.processing_status = 'processing' then
    return query
    select v_event.id, v_event.event_type, v_event.entity_type, v_event.entity_id,
      v_event.payload_version, v_event.payload_json, v_event.trace_id,
      v_event.correlation_id, v_event.causation_id, v_event.idempotency_key,
      v_event.processing_status, v_event.processed_at, v_event.created_at,
      v_event.updated_at, v_event.locked_at, v_event.locked_by,
      v_event.attempt_count, v_event.max_attempts, v_event.next_retry_at,
      'already_processing'::text;
    return;
  end if;

  if v_event.processing_status = 'retry_scheduled' then
    return query
    select v_event.id, v_event.event_type, v_event.entity_type, v_event.entity_id,
      v_event.payload_version, v_event.payload_json, v_event.trace_id,
      v_event.correlation_id, v_event.causation_id, v_event.idempotency_key,
      v_event.processing_status, v_event.processed_at, v_event.created_at,
      v_event.updated_at, v_event.locked_at, v_event.locked_by,
      v_event.attempt_count, v_event.max_attempts, v_event.next_retry_at,
      'retry_not_due'::text;
    return;
  end if;

  raise exception 'DOMAIN_EVENT_NOT_PROCESSABLE' using errcode = 'P0001';
end;
$$;

comment on function public.qf_acquire_domain_event(uuid, text, interval) is
  'Owner-safe domain event acquisition. Pending/due retry/stale processing rows can be acquired; active processing rows return already_processing without mutation. Service-role only.';

-- ----------------------------------------------------------------------------
-- Owner-aware event retry/dead-letter transitions.
-- ----------------------------------------------------------------------------
create or replace function public.qf_schedule_domain_event_retry(
  p_event_id uuid,
  p_worker_id text,
  p_attempt_count integer,
  p_next_retry_at timestamptz
)
returns public.domain_events
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event public.domain_events%rowtype;
begin
  if p_event_id is null then
    raise exception 'DOMAIN_EVENT_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'WORKER_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if p_attempt_count is null or p_attempt_count < 0 then
    raise exception 'DOMAIN_EVENT_ATTEMPT_COUNT_INVALID' using errcode = 'P0001';
  end if;

  if p_next_retry_at is null then
    raise exception 'DOMAIN_EVENT_NEXT_RETRY_REQUIRED' using errcode = 'P0001';
  end if;

  update public.domain_events
  set processing_status = 'retry_scheduled',
      attempt_count = least(p_attempt_count, max_attempts),
      next_retry_at = p_next_retry_at,
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where id = p_event_id
    and processing_status = 'processing'
    and locked_by = trim(p_worker_id)
  returning * into v_event;

  if v_event.id is null then
    raise exception 'DOMAIN_EVENT_OWNERSHIP_CONFLICT' using errcode = 'P0001';
  end if;

  return v_event;
end;
$$;

create or replace function public.qf_dead_letter_domain_event(
  p_event_id uuid,
  p_worker_id text,
  p_attempt_count integer
)
returns public.domain_events
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event public.domain_events%rowtype;
begin
  if p_event_id is null then
    raise exception 'DOMAIN_EVENT_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'WORKER_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if p_attempt_count is null or p_attempt_count < 0 then
    raise exception 'DOMAIN_EVENT_ATTEMPT_COUNT_INVALID' using errcode = 'P0001';
  end if;

  update public.domain_events
  set processing_status = 'dead_letter',
      attempt_count = least(p_attempt_count, max_attempts),
      next_retry_at = null,
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where id = p_event_id
    and processing_status = 'processing'
    and locked_by = trim(p_worker_id)
  returning * into v_event;

  if v_event.id is null then
    raise exception 'DOMAIN_EVENT_OWNERSHIP_CONFLICT' using errcode = 'P0001';
  end if;

  return v_event;
end;
$$;

-- ----------------------------------------------------------------------------
-- Owner-aware atomic workflow step with in-transaction idempotency completion.
-- ----------------------------------------------------------------------------
create or replace function public.qf_apply_workflow_step(
  p_workflow_instance_id uuid,
  p_expected_state text,
  p_expected_version integer,
  p_target_state text,
  p_target_status text,
  p_domain_event_id uuid,
  p_event_type text,
  p_worker_id text,
  p_reason text default null,
  p_transition_metadata jsonb default '{}'::jsonb,
  p_created_by text default 'workflow_kernel',
  p_next_tasks jsonb default '[]'::jsonb,
  p_outbox_commands jsonb default '[]'::jsonb,
  p_idempotency_key text default null,
  p_idempotency_result jsonb default '{}'::jsonb
)
returns public.workflow_instances
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_workflow public.workflow_instances%rowtype;
  v_updated public.workflow_instances%rowtype;
  v_event public.domain_events%rowtype;
  v_task jsonb;
  v_command jsonb;
  v_existing_task public.workflow_tasks%rowtype;
  v_existing_outbox public.outbox_events%rowtype;
  v_task_idempotency_key text;
  v_outbox_idempotency_key text;
  v_task_payload jsonb;
  v_outbox_payload jsonb;
  v_task_type text;
  v_command_type text;
  v_task_due_at timestamptz;
  v_task_due_at_explicit boolean;
  v_task_priority integer;
  v_task_max_attempts integer;
  v_outbox_entity_type text;
  v_outbox_entity_id text;
  v_idempotency_key text;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'WORKER_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if p_workflow_instance_id is null then
    raise exception 'WORKFLOW_INSTANCE_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if p_expected_state is null or length(trim(p_expected_state)) = 0 then
    raise exception 'EXPECTED_STATE_REQUIRED' using errcode = 'P0001';
  end if;

  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'EXPECTED_VERSION_REQUIRED' using errcode = 'P0001';
  end if;

  if p_target_state is null or length(trim(p_target_state)) = 0 then
    raise exception 'TARGET_STATE_REQUIRED' using errcode = 'P0001';
  end if;

  if p_target_status is null or p_target_status not in ('active', 'paused', 'completed', 'failed', 'cancelled') then
    raise exception 'TARGET_STATUS_INVALID' using errcode = 'P0001';
  end if;

  if p_domain_event_id is null then
    raise exception 'DOMAIN_EVENT_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if p_event_type is null or length(trim(p_event_type)) = 0 then
    raise exception 'EVENT_TYPE_REQUIRED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_transition_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'TRANSITION_METADATA_MUST_BE_OBJECT' using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_next_tasks, '[]'::jsonb)) <> 'array' then
    raise exception 'NEXT_TASKS_MUST_BE_ARRAY' using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_outbox_commands, '[]'::jsonb)) <> 'array' then
    raise exception 'OUTBOX_COMMANDS_MUST_BE_ARRAY' using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_idempotency_result, '{}'::jsonb)) <> 'object' then
    raise exception 'IDEMPOTENCY_RESULT_MUST_BE_OBJECT' using errcode = 'P0001';
  end if;

  v_idempotency_key := nullif(trim(coalesce(p_idempotency_key, '')), '');

  select * into v_workflow
  from public.workflow_instances
  where id = p_workflow_instance_id
  for update;

  if v_workflow.id is null then
    raise exception 'WORKFLOW_INSTANCE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_workflow.current_state is distinct from trim(p_expected_state)
    or v_workflow.version is distinct from p_expected_version
  then
    raise exception 'WORKFLOW_STATE_CONFLICT' using errcode = 'P0001';
  end if;

  select * into v_event
  from public.domain_events
  where id = p_domain_event_id
  for update;

  if v_event.id is null then
    raise exception 'DOMAIN_EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_event.processing_status <> 'processing'
    or v_event.locked_by is distinct from trim(p_worker_id)
  then
    raise exception 'DOMAIN_EVENT_OWNERSHIP_CONFLICT' using errcode = 'P0001';
  end if;

  if v_event.event_type is distinct from trim(p_event_type) then
    raise exception 'DOMAIN_EVENT_TYPE_MISMATCH' using errcode = 'P0001';
  end if;

  update public.workflow_instances
  set current_state = trim(p_target_state),
      status = p_target_status,
      version = version + 1,
      updated_at = v_now,
      completed_at = case
        when p_target_status in ('completed', 'failed', 'cancelled') then coalesce(completed_at, v_now)
        else null
      end,
      last_error = null
  where id = p_workflow_instance_id
  returning * into v_updated;

  insert into public.workflow_transition_history (
    workflow_instance_id,
    from_state,
    to_state,
    event_type,
    reason,
    metadata_json,
    created_by
  )
  values (
    p_workflow_instance_id,
    v_workflow.current_state,
    trim(p_target_state),
    trim(p_event_type),
    p_reason,
    coalesce(p_transition_metadata, '{}'::jsonb),
    nullif(trim(coalesce(p_created_by, '')), '')
  );

  for v_task in
    select value from jsonb_array_elements(coalesce(p_next_tasks, '[]'::jsonb))
  loop
    if jsonb_typeof(v_task) <> 'object' then
      raise exception 'WORKFLOW_TASK_REQUEST_MUST_BE_OBJECT' using errcode = 'P0001';
    end if;

    v_task_type := nullif(trim(coalesce(v_task->>'task_type', '')), '');
    if v_task_type is null then
      raise exception 'WORKFLOW_TASK_TYPE_REQUIRED' using errcode = 'P0001';
    end if;

    v_task_payload := coalesce(v_task->'payload_json', '{}'::jsonb);
    if jsonb_typeof(v_task_payload) <> 'object' then
      raise exception 'WORKFLOW_TASK_PAYLOAD_MUST_BE_OBJECT' using errcode = 'P0001';
    end if;

    v_task_idempotency_key := nullif(trim(coalesce(v_task->>'idempotency_key', '')), '');
    v_task_priority := coalesce(nullif(v_task->>'priority', '')::integer, 100);
    v_task_max_attempts := coalesce(nullif(v_task->>'max_attempts', '')::integer, 5);
    v_task_due_at_explicit := nullif(v_task->>'due_at', '') is not null;
    v_task_due_at := coalesce(nullif(v_task->>'due_at', '')::timestamptz, v_now);

    if v_task_max_attempts <= 0 then
      raise exception 'WORKFLOW_TASK_MAX_ATTEMPTS_INVALID' using errcode = 'P0001';
    end if;

    if v_task_idempotency_key is not null then
      select * into v_existing_task
      from public.workflow_tasks
      where idempotency_key = v_task_idempotency_key;

      if v_existing_task.id is not null then
        if v_existing_task.workflow_instance_id is distinct from p_workflow_instance_id
          or v_existing_task.task_type is distinct from v_task_type
          or v_existing_task.payload_json is distinct from v_task_payload
          or v_existing_task.priority is distinct from v_task_priority
          or v_existing_task.max_attempts is distinct from v_task_max_attempts
          or (v_task_due_at_explicit and v_existing_task.due_at is distinct from v_task_due_at)
        then
          raise exception 'WORKFLOW_TASK_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
        end if;
        continue;
      end if;
    end if;

    insert into public.workflow_tasks (
      workflow_instance_id,
      task_type,
      status,
      priority,
      due_at,
      max_attempts,
      idempotency_key,
      payload_json
    )
    values (
      p_workflow_instance_id,
      v_task_type,
      'pending',
      v_task_priority,
      v_task_due_at,
      v_task_max_attempts,
      v_task_idempotency_key,
      v_task_payload
    );
  end loop;

  for v_command in
    select value from jsonb_array_elements(coalesce(p_outbox_commands, '[]'::jsonb))
  loop
    if jsonb_typeof(v_command) <> 'object' then
      raise exception 'OUTBOX_COMMAND_REQUEST_MUST_BE_OBJECT' using errcode = 'P0001';
    end if;

    v_command_type := nullif(trim(coalesce(v_command->>'command_type', '')), '');
    v_outbox_idempotency_key := nullif(trim(coalesce(v_command->>'idempotency_key', '')), '');
    v_outbox_entity_type := nullif(trim(coalesce(v_command->>'entity_type', '')), '');
    v_outbox_entity_id := nullif(trim(coalesce(v_command->>'entity_id', '')), '');
    v_outbox_payload := coalesce(v_command->'payload_json', '{}'::jsonb);

    if v_command_type is null then
      raise exception 'OUTBOX_COMMAND_TYPE_REQUIRED' using errcode = 'P0001';
    end if;

    if v_outbox_idempotency_key is null then
      raise exception 'OUTBOX_IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
    end if;

    if jsonb_typeof(v_outbox_payload) <> 'object' then
      raise exception 'OUTBOX_PAYLOAD_MUST_BE_OBJECT' using errcode = 'P0001';
    end if;

    select * into v_existing_outbox
    from public.outbox_events
    where idempotency_key = v_outbox_idempotency_key;

    if v_existing_outbox.id is not null then
      if v_existing_outbox.command_type is distinct from v_command_type
        or v_existing_outbox.entity_type is distinct from v_outbox_entity_type
        or v_existing_outbox.entity_id is distinct from v_outbox_entity_id
        or v_existing_outbox.payload_json is distinct from v_outbox_payload
      then
        raise exception 'OUTBOX_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
      end if;
      continue;
    end if;

    insert into public.outbox_events (
      command_type,
      entity_type,
      entity_id,
      payload_json,
      idempotency_key,
      status
    )
    values (
      v_command_type,
      v_outbox_entity_type,
      v_outbox_entity_id,
      v_outbox_payload,
      v_outbox_idempotency_key,
      'pending'
    );
  end loop;

  update public.domain_events
  set processing_status = 'processed',
      processed_at = v_now,
      next_retry_at = null,
      updated_at = v_now,
      locked_at = null,
      locked_by = null
  where id = p_domain_event_id
    and processing_status = 'processing'
    and locked_by = trim(p_worker_id);

  if not found then
    raise exception 'DOMAIN_EVENT_OWNERSHIP_CONFLICT' using errcode = 'P0001';
  end if;

  if v_idempotency_key is not null then
    update public.idempotency_records
    set status = 'completed',
        result_json = coalesce(p_idempotency_result, '{}'::jsonb)
          || jsonb_build_object(
            'workflow_instance_id', v_updated.id,
            'workflow_type', v_updated.workflow_type,
            'state', v_updated.current_state,
            'version', v_updated.version
          ),
        completed_at = v_now,
        updated_at = v_now
    where idempotency_key = v_idempotency_key;

    if not found then
      raise exception 'IDEMPOTENCY_RECORD_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  return v_updated;
end;
$$;

comment on function public.qf_apply_workflow_step(uuid, text, integer, text, text, uuid, text, text, text, jsonb, text, jsonb, jsonb, text, jsonb) is
  'Owner-aware atomic workflow step. Verifies event processing ownership, applies workflow changes, writes task/outbox intents, marks event processed, and can complete kernel idempotency in one transaction. Service-role only.';

-- ----------------------------------------------------------------------------
-- EXECUTE PRIVILEGES
-- ----------------------------------------------------------------------------
revoke all on function public.qf_acquire_domain_event(uuid, text, interval) from public;
revoke all on function public.qf_acquire_domain_event(uuid, text, interval) from anon;
revoke all on function public.qf_acquire_domain_event(uuid, text, interval) from authenticated;
grant execute on function public.qf_acquire_domain_event(uuid, text, interval) to service_role;

revoke all on function public.qf_schedule_domain_event_retry(uuid, text, integer, timestamptz) from public;
revoke all on function public.qf_schedule_domain_event_retry(uuid, text, integer, timestamptz) from anon;
revoke all on function public.qf_schedule_domain_event_retry(uuid, text, integer, timestamptz) from authenticated;
grant execute on function public.qf_schedule_domain_event_retry(uuid, text, integer, timestamptz) to service_role;

revoke all on function public.qf_dead_letter_domain_event(uuid, text, integer) from public;
revoke all on function public.qf_dead_letter_domain_event(uuid, text, integer) from anon;
revoke all on function public.qf_dead_letter_domain_event(uuid, text, integer) from authenticated;
grant execute on function public.qf_dead_letter_domain_event(uuid, text, integer) to service_role;

revoke all on function public.qf_apply_workflow_step(uuid, text, integer, text, text, uuid, text, text, text, jsonb, text, jsonb, jsonb, text, jsonb) from public;
revoke all on function public.qf_apply_workflow_step(uuid, text, integer, text, text, uuid, text, text, text, jsonb, text, jsonb, jsonb, text, jsonb) from anon;
revoke all on function public.qf_apply_workflow_step(uuid, text, integer, text, text, uuid, text, text, text, jsonb, text, jsonb, jsonb, text, jsonb) from authenticated;
grant execute on function public.qf_apply_workflow_step(uuid, text, integer, text, text, uuid, text, text, text, jsonb, text, jsonb, jsonb, text, jsonb) to service_role;
