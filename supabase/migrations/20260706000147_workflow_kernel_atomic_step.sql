-- ============================================================================
-- QuickFurno - 20260706000147_workflow_kernel_atomic_step.sql
-- QF Workflow Kernel v1 / Phase 1B: generic atomic workflow-step support.
--
-- ADDITIVE ONLY. GENERATED FOR REVIEW - DO NOT AUTO-APPLY TO PRODUCTION.
-- Adds durable event ownership fields and generic service-role-only RPCs used by
-- the server-side Workflow Kernel. Does not connect real lead flow, matching,
-- credits, WhatsApp, n8n production, UI, PM2, or workers.
-- ============================================================================

-- Domain event ownership for one-by-id Kernel processing.
alter table public.domain_events
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text;

comment on column public.domain_events.locked_at is
  'Workflow Kernel processing ownership timestamp. Used for explicit event-by-id processing, not a polling worker.';
comment on column public.domain_events.locked_by is
  'Workflow Kernel processing owner identifier. Must be a server-side worker/request id, never a secret.';

create index if not exists idx_domain_events_processing_locked_at
  on public.domain_events(locked_at)
  where processing_status = 'processing';

-- ----------------------------------------------------------------------------
-- Acquire processing ownership of a specific domain event.
-- ----------------------------------------------------------------------------
create or replace function public.qf_acquire_domain_event(
  p_event_id uuid,
  p_worker_id text
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

  update public.domain_events de
  set processing_status = 'processing',
      locked_at = now(),
      locked_by = trim(p_worker_id),
      updated_at = now()
  where de.id = p_event_id
    and de.processing_status = 'pending'
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
      'already_processed'::text;
    return;
  end if;

  if v_event.processing_status = 'processing' then
    raise exception 'DOMAIN_EVENT_ALREADY_PROCESSING' using errcode = 'P0001';
  end if;

  raise exception 'DOMAIN_EVENT_NOT_PROCESSABLE' using errcode = 'P0001';
end;
$$;

comment on function public.qf_acquire_domain_event(uuid, text) is
  'Conditionally acquires one pending domain event for Workflow Kernel processing. Processed events return already_processed; failed/dead-letter events are not silently processed. Service-role only.';

-- ----------------------------------------------------------------------------
-- Atomically apply one successful workflow step.
-- ----------------------------------------------------------------------------
create or replace function public.qf_apply_workflow_step(
  p_workflow_instance_id uuid,
  p_expected_state text,
  p_expected_version integer,
  p_target_state text,
  p_target_status text,
  p_domain_event_id uuid,
  p_event_type text,
  p_reason text default null,
  p_transition_metadata jsonb default '{}'::jsonb,
  p_created_by text default 'workflow_kernel',
  p_next_tasks jsonb default '[]'::jsonb,
  p_outbox_commands jsonb default '[]'::jsonb
)
returns public.workflow_instances
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
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
  v_task_priority integer;
  v_task_max_attempts integer;
  v_outbox_entity_type text;
  v_outbox_entity_id text;
begin
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

  if v_event.processing_status <> 'processing' then
    raise exception 'DOMAIN_EVENT_NOT_PROCESSING' using errcode = 'P0001';
  end if;

  if v_event.event_type is distinct from trim(p_event_type) then
    raise exception 'DOMAIN_EVENT_TYPE_MISMATCH' using errcode = 'P0001';
  end if;

  update public.workflow_instances
  set current_state = trim(p_target_state),
      status = p_target_status,
      version = version + 1,
      updated_at = now(),
      completed_at = case
        when p_target_status in ('completed', 'failed', 'cancelled') then coalesce(completed_at, now())
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
    v_task_due_at := coalesce(nullif(v_task->>'due_at', '')::timestamptz, now());

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
      processed_at = now(),
      updated_at = now(),
      locked_at = null,
      locked_by = null
  where id = p_domain_event_id
    and processing_status = 'processing';

  if not found then
    raise exception 'DOMAIN_EVENT_PROCESSING_STATE_CONFLICT' using errcode = 'P0001';
  end if;

  return v_updated;
end;
$$;

comment on function public.qf_apply_workflow_step(uuid, text, integer, text, text, uuid, text, text, jsonb, text, jsonb, jsonb) is
  'Atomically verifies workflow state/version, updates workflow state, writes transition history, enqueues tasks, enqueues outbox intents, and marks the triggering event processed. Service-role only.';

-- ----------------------------------------------------------------------------
-- EXECUTE PRIVILEGES
-- ----------------------------------------------------------------------------
revoke all on function public.qf_acquire_domain_event(uuid, text) from public;
revoke all on function public.qf_acquire_domain_event(uuid, text) from anon;
revoke all on function public.qf_acquire_domain_event(uuid, text) from authenticated;
grant execute on function public.qf_acquire_domain_event(uuid, text) to service_role;

revoke all on function public.qf_apply_workflow_step(uuid, text, integer, text, text, uuid, text, text, jsonb, text, jsonb, jsonb) from public;
revoke all on function public.qf_apply_workflow_step(uuid, text, integer, text, text, uuid, text, text, jsonb, text, jsonb, jsonb) from anon;
revoke all on function public.qf_apply_workflow_step(uuid, text, integer, text, text, uuid, text, text, jsonb, text, jsonb, jsonb) from authenticated;
grant execute on function public.qf_apply_workflow_step(uuid, text, integer, text, text, uuid, text, text, jsonb, text, jsonb, jsonb) to service_role;

