-- ============================================================================
-- QF-MVP-50.1B — DURABLE AUTOMATION ACTION / JOB / ATTEMPT PERSISTENCE
--
-- BASE
--   QF-MVP-50.1A unified action contract + Jarvis provision.
--
-- PURPOSE
--   Add one narrow, Core-owned persistence plane for:
--     1. source-neutral action requests,
--     2. Core authorization / rejection evidence,
--     3. durable executable jobs,
--     4. append-preserved execution attempts,
--     5. retry / dead-letter / uncertain terminal state.
--
-- AUTHORITY
--   Core is authority. Jarvis/Riya/Anisha may request. n8n executes only a
--   Core-authorized job. Meta/provider transport is NOT implemented here.
--
-- SECURITY MODEL
--   - RLS enabled on all three tables.
--   - anon/authenticated: zero access.
--   - service_role: SELECT only.
--   - ALL application mutations go through five fixed-search-path,
--     service-role-only SECURITY DEFINER RPCs.
--   - tables cannot be DELETEd or TRUNCATEd through normal application paths.
--   - request/action/job identities are immutable after creation.
--
-- CRASH / UNCERTAINTY RULE
--   A job in `processing` is NEVER made claimable merely because its lock is old.
--   A worker may have reached an external executor before crashing. Reclaiming
--   that row automatically could duplicate an action. Stale processing
--   reconciliation belongs to QF-MVP-50.5 and must classify uncertainty safely.
--
-- EXPLICIT NON-ACTIONS
--   No n8n workflow, webhook, HTTP call, provider call, Meta call, message send,
--   assignment, credit change, package change, consent change, campaign approval,
--   environment mutation or seeded application row.
--
-- FORWARD ONLY
--   Does not replay the historical 20260706000146 generic workflow kernel.
--   Both reviewed staging and reconciled production were measured with that
--   historical kernel ABSENT. This migration aborts if it appears.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Fail-closed current-state preflight
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_name text;
begin
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    raise exception
      'QF-MVP-50.1B aborted: pgcrypto is required but absent.';
  end if;

  foreach v_name in array array[
    'automation_action_requests',
    'automation_jobs',
    'automation_execution_attempts'
  ] loop
    if to_regclass('public.' || v_name) is not null then
      raise exception
        'QF-MVP-50.1B aborted: target table public.% already exists; reconcile instead of masking drift.',
        v_name;
    end if;
  end loop;

  -- The old generic workflow kernel is intentionally NOT being replayed. If it
  -- exists in a target environment, that is an authority collision requiring a
  -- dedicated reconciliation decision.
  foreach v_name in array array[
    'workflow_instances',
    'workflow_tasks',
    'domain_events',
    'outbox_events',
    'workflow_failures',
    'idempotency_records',
    'workflow_transition_history'
  ] loop
    if to_regclass('public.' || v_name) is not null then
      raise exception
        'QF-MVP-50.1B aborted: legacy workflow-kernel table public.% exists; reconcile before installing a second automation authority.',
        v_name;
    end if;
  end loop;

  if exists (
    select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')
  ) then
    raise exception
      'QF-MVP-50.1B aborted: a database network extension is installed; this persistence phase must remain transport-free.';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Safe-context database guard
-- ---------------------------------------------------------------------------
-- TypeScript already rejects authority-bearing fields before persistence.
-- This recursive database guard is a second independent fence so a future
-- server-side bug cannot persist destinations, arbitrary templates, provider
-- overrides, credentials, credit/assignment overrides or retry bypasses into
-- the n8n-facing context.
create or replace function public.qf_automation_context_has_forbidden_key(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_key text;
  v_child jsonb;
  v_normalized text;
begin
  if p_value is null then
    return false;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in
      select key, value from jsonb_each(p_value)
    loop
      v_normalized := lower(regexp_replace(v_key, '[^a-zA-Z0-9]', '', 'g'));

      if v_normalized = any (array[
        'forcesend',
        'ignoreconsent',
        'bypassconsent',
        'ignoresuppression',
        'bypasssuppression',
        'recipient',
        'recipientphone',
        'phone',
        'phonenumber',
        'mobile',
        'whatsapp',
        'to',
        'template',
        'templatekey',
        'templatepurpose',
        'provideraccount',
        'provideraccountid',
        'provideroverride',
        'accesstoken',
        'token',
        'secret',
        'authorization',
        'apikey',
        'password',
        'creditdelta',
        'restorecredits',
        'assignvendorids',
        'vendorids',
        'desiredstatus',
        'retryanyway',
        'skipvalidation'
      ]::text[]) then
        return true;
      end if;

      if public.qf_automation_context_has_forbidden_key(v_child) then
        return true;
      end if;
    end loop;

    return false;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    for v_child in
      select value from jsonb_array_elements(p_value)
    loop
      if public.qf_automation_context_has_forbidden_key(v_child) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

comment on function public.qf_automation_context_has_forbidden_key(jsonb) is
  'QF-MVP-50.1B internal CHECK helper: recursively refuses authority-bearing or secret-bearing JSON keys in automation safe_context. Not an executor API.';

-- ---------------------------------------------------------------------------
-- 2. ACTION REQUESTS — request provenance + one Core decision
-- ---------------------------------------------------------------------------
create table public.automation_action_requests (
  id uuid primary key,
  contract_version integer not null,
  action_type text not null,
  entity_type text not null,
  entity_id text not null,

  source text not null,
  requested_by_type text not null,
  requested_by_id text not null,
  requested_at timestamptz not null,

  idempotency_key text not null,
  correlation_id text not null,
  safe_context jsonb not null default '{}'::jsonb,

  decision_status text not null default 'requested',
  decision_id text,
  decision_at timestamptz,
  decision_actor_type text,
  decision_actor_id text,
  decision_reason_code text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint automation_action_requests_contract_version_check
    check (contract_version = 1),

  constraint automation_action_requests_action_type_check
    check (action_type in (
      'client.lead_confirmation',
      'client.requirement_collection',
      'client.missing_information_reminder',
      'client.matching_update',
      'client.lead_status_update',
      'client.transactional_followup',
      'vendor.lead_offer',
      'vendor.response_reminder',
      'vendor.onboarding_reminder',
      'vendor.document_reminder',
      'vendor.package_expiry_warning',
      'vendor.low_credit_warning',
      'campaign.execute_batch',
      'campaign.execute_recipient'
    )),

  constraint automation_action_requests_source_check
    check (source in ('core', 'admin', 'system', 'jarvis', 'riya', 'anisha')),

  constraint automation_action_requests_requested_actor_check
    check (requested_by_type in (
      'core_service',
      'admin_user',
      'system',
      'jarvis_agent'
    )),

  constraint automation_action_requests_source_actor_pair_check
    check (
      (source = 'core' and requested_by_type = 'core_service')
      or (source = 'admin' and requested_by_type = 'admin_user')
      or (source = 'system' and requested_by_type = 'system')
      or (source in ('jarvis', 'riya', 'anisha') and requested_by_type = 'jarvis_agent')
    ),

  -- Requestability is not authorization. This only defines which sources may
  -- submit which request classes to Core.
  constraint automation_action_requests_source_action_scope_check
    check (
      (
        action_type in (
          'client.lead_confirmation',
          'client.requirement_collection',
          'client.missing_information_reminder',
          'client.matching_update',
          'client.lead_status_update',
          'client.transactional_followup'
        )
        and source in ('core', 'admin', 'system', 'jarvis', 'riya', 'anisha')
      )
      or (
        action_type in (
          'vendor.response_reminder',
          'vendor.onboarding_reminder',
          'vendor.document_reminder'
        )
        and source in ('core', 'admin', 'system', 'jarvis')
      )
      or (
        action_type in (
          'vendor.lead_offer',
          'vendor.package_expiry_warning',
          'vendor.low_credit_warning',
          'campaign.execute_batch',
          'campaign.execute_recipient'
        )
        and source in ('core', 'admin', 'system')
      )
    ),

  constraint automation_action_requests_identity_check
    check (
      entity_type ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
      and entity_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
      and requested_by_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
      and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
      and correlation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
    ),

  constraint automation_action_requests_context_check
    check (
      jsonb_typeof(safe_context) = 'object'
      and octet_length(safe_context::text) <= 16384
      and not public.qf_automation_context_has_forbidden_key(safe_context)
    ),

  constraint automation_action_requests_decision_status_check
    check (decision_status in ('requested', 'authorized', 'rejected')),

  constraint automation_action_requests_decision_actor_check
    check (
      decision_actor_type is null
      or decision_actor_type in ('core_service', 'admin_user')
    ),

  constraint automation_action_requests_decision_shape_check
    check (
      (
        decision_status = 'requested'
        and decision_id is null
        and decision_at is null
        and decision_actor_type is null
        and decision_actor_id is null
        and decision_reason_code is null
      )
      or (
        decision_status in ('authorized', 'rejected')
        and decision_id is not null
        and decision_at is not null
        and decision_actor_type in ('core_service', 'admin_user')
        and decision_actor_id is not null
        and decision_reason_code is not null
        and decision_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
        and decision_actor_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
        and decision_reason_code ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
      )
    )
);

comment on table public.automation_action_requests is
  'QF-MVP-50 Core-owned request/decision ledger. source records provenance only; authorization is a separate one-way Core/admin decision.';
comment on column public.automation_action_requests.safe_context is
  'Executor-safe identifiers/evidence only. No destination, phone, arbitrary template, provider override, credential, credit/assignment override or retry bypass.';

create unique index uq_automation_action_requests_idempotency
  on public.automation_action_requests(idempotency_key);

create unique index uq_automation_action_requests_decision_id
  on public.automation_action_requests(decision_id)
  where decision_id is not null;

create index idx_automation_action_requests_entity
  on public.automation_action_requests(entity_type, entity_id);

create index idx_automation_action_requests_correlation
  on public.automation_action_requests(correlation_id);

create index idx_automation_action_requests_decision_status
  on public.automation_action_requests(decision_status, created_at);

-- ---------------------------------------------------------------------------
-- 3. AUTOMATION JOBS — one durable executor job per authorized request
-- ---------------------------------------------------------------------------
create table public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  action_request_id uuid not null
    references public.automation_action_requests(id) on delete restrict,

  status text not null default 'pending',
  available_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_retry_at timestamptz,
  locked_at timestamptz,
  locked_by text,

  last_result_classification text,
  last_safe_code text,
  completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint automation_jobs_status_check
    check (status in (
      'pending',
      'processing',
      'retry_scheduled',
      'succeeded',
      'failed',
      'uncertain',
      'dead_letter',
      'cancelled'
    )),

  constraint automation_jobs_attempt_count_check
    check (attempt_count >= 0),

  constraint automation_jobs_max_attempts_check
    check (max_attempts between 1 and 10),

  constraint automation_jobs_attempt_bounds_check
    check (attempt_count <= max_attempts),

  constraint automation_jobs_last_classification_check
    check (
      last_result_classification is null
      or last_result_classification in (
        'success',
        'retryable_failure',
        'definitive_failure',
        'uncertain'
      )
    ),

  constraint automation_jobs_lock_shape_check
    check (
      (status = 'processing' and locked_at is not null and locked_by is not null)
      or (status <> 'processing' and locked_at is null and locked_by is null)
    ),

  constraint automation_jobs_retry_shape_check
    check (
      (status = 'retry_scheduled' and next_retry_at is not null)
      or (status <> 'retry_scheduled' and next_retry_at is null)
    ),

  constraint automation_jobs_completion_shape_check
    check (
      (
        status in ('succeeded', 'failed', 'uncertain', 'dead_letter', 'cancelled')
        and completed_at is not null
      )
      or (
        status in ('pending', 'processing', 'retry_scheduled')
        and completed_at is null
      )
    ),

  constraint automation_jobs_worker_identity_check
    check (
      locked_by is null
      or locked_by ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
    ),

  constraint automation_jobs_safe_code_check
    check (
      last_safe_code is null
      or last_safe_code ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
    ),

  constraint automation_jobs_result_shape_check
    check (
      status in ('pending', 'processing', 'cancelled')
      or (
        status in ('retry_scheduled', 'dead_letter')
        and last_result_classification = 'retryable_failure'
        and last_safe_code is not null
      )
      or (
        status = 'succeeded'
        and last_result_classification = 'success'
        and last_safe_code is not null
      )
      or (
        status = 'failed'
        and last_result_classification = 'definitive_failure'
        and last_safe_code is not null
      )
      or (
        status = 'uncertain'
        and last_result_classification = 'uncertain'
        and last_safe_code is not null
      )
    )
);

comment on table public.automation_jobs is
  'QF-MVP-50 durable executor jobs. One row per authorized action request. A processing job is never automatically reclaimed after a stale lock because external outcome may be uncertain.';

create unique index uq_automation_jobs_action_request
  on public.automation_jobs(action_request_id);

create index idx_automation_jobs_claim
  on public.automation_jobs(status, available_at, next_retry_at, created_at);

create index idx_automation_jobs_processing_lock
  on public.automation_jobs(locked_at)
  where status = 'processing';

-- ---------------------------------------------------------------------------
-- 4. EXECUTION ATTEMPTS — durable per-attempt evidence
-- ---------------------------------------------------------------------------
create table public.automation_execution_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null
    references public.automation_jobs(id) on delete restrict,
  attempt_number integer not null,
  worker_id text not null,

  status text not null default 'started',
  classification text,
  safe_code text,
  executor_reference text,

  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),

  constraint automation_execution_attempts_number_check
    check (attempt_number > 0),

  constraint automation_execution_attempts_worker_check
    check (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),

  constraint automation_execution_attempts_status_check
    check (status in ('started', 'completed')),

  constraint automation_execution_attempts_classification_check
    check (
      classification is null
      or classification in (
        'success',
        'retryable_failure',
        'definitive_failure',
        'uncertain'
      )
    ),

  constraint automation_execution_attempts_safe_code_check
    check (
      safe_code is null
      or safe_code ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
    ),

  constraint automation_execution_attempts_executor_ref_check
    check (
      executor_reference is null
      or executor_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
    ),

  constraint automation_execution_attempts_shape_check
    check (
      (
        status = 'started'
        and classification is null
        and safe_code is null
        and finished_at is null
      )
      or (
        status = 'completed'
        and classification is not null
        and safe_code is not null
        and finished_at is not null
      )
    )
);

comment on table public.automation_execution_attempts is
  'QF-MVP-50 per-attempt execution evidence. Each attempt is inserted as started and may complete once; retryable failure never permits blind retry of uncertain outcomes.';

create unique index uq_automation_execution_attempts_job_number
  on public.automation_execution_attempts(job_id, attempt_number);

create index idx_automation_execution_attempts_job
  on public.automation_execution_attempts(job_id, created_at);

-- ---------------------------------------------------------------------------
-- 5. Universal history / lifecycle triggers
-- ---------------------------------------------------------------------------
create or replace function public.qf_prevent_automation_history_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception
    'QF-MVP-50.1B: % is audit-bearing automation history and cannot be deleted or truncated.',
    tg_table_name
    using errcode = 'check_violation';
  return null;
end;
$$;

create or replace function public.qf_guard_automation_action_request_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.decision_status <> 'requested'
     or new.decision_id is not null
     or new.decision_at is not null
     or new.decision_actor_type is not null
     or new.decision_actor_id is not null
     or new.decision_reason_code is not null then
    raise exception
      'QF-MVP-50.1B: every action request must be inserted undecided; Core decision is a separate one-way step.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace function public.qf_guard_automation_action_request_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.contract_version is distinct from old.contract_version
     or new.action_type is distinct from old.action_type
     or new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id
     or new.source is distinct from old.source
     or new.requested_by_type is distinct from old.requested_by_type
     or new.requested_by_id is distinct from old.requested_by_id
     or new.requested_at is distinct from old.requested_at
     or new.idempotency_key is distinct from old.idempotency_key
     or new.correlation_id is distinct from old.correlation_id
     or new.safe_context is distinct from old.safe_context
     or new.created_at is distinct from old.created_at then
    raise exception
      'QF-MVP-50.1B: action-request identity/provenance is immutable.'
      using errcode = 'check_violation';
  end if;

  if old.decision_status <> 'requested' then
    raise exception
      'QF-MVP-50.1B: an action request may be decided exactly once.'
      using errcode = 'check_violation';
  end if;

  if new.decision_status not in ('authorized', 'rejected') then
    raise exception
      'QF-MVP-50.1B: requested may transition only to authorized or rejected.'
      using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.qf_guard_automation_job_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_status text;
begin
  if new.status <> 'pending'
     or new.attempt_count <> 0
     or new.next_retry_at is not null
     or new.locked_at is not null
     or new.locked_by is not null
     or new.last_result_classification is not null
     or new.last_safe_code is not null
     or new.completed_at is not null then
    raise exception
      'QF-MVP-50.1B: automation jobs must be inserted in pristine pending state.'
      using errcode = 'check_violation';
  end if;

  select decision_status into v_status
    from public.automation_action_requests
   where id = new.action_request_id;

  if v_status is null then
    raise exception
      'QF-MVP-50.1B: automation job references a missing action request.'
      using errcode = 'foreign_key_violation';
  end if;

  if v_status <> 'authorized' then
    raise exception
      'QF-MVP-50.1B: only a Core-authorized action request may become an automation job.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace function public.qf_guard_automation_job_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_allowed boolean := false;
  v_attempt_status text;
  v_attempt_classification text;
begin
  if new.id is distinct from old.id
     or new.action_request_id is distinct from old.action_request_id
     or new.available_at is distinct from old.available_at
     or new.max_attempts is distinct from old.max_attempts
     or new.created_at is distinct from old.created_at then
    raise exception
      'QF-MVP-50.1B: automation-job identity/schedule/retry budget is immutable.'
      using errcode = 'check_violation';
  end if;

  if old.status in ('succeeded', 'failed', 'uncertain', 'dead_letter', 'cancelled') then
    raise exception
      'QF-MVP-50.1B: terminal automation jobs are immutable.'
      using errcode = 'check_violation';
  end if;

  v_allowed :=
    (old.status = 'pending' and new.status in ('processing', 'cancelled'))
    or (old.status = 'retry_scheduled' and new.status in ('processing', 'cancelled'))
    or (
      old.status = 'processing'
      and new.status in (
        'retry_scheduled',
        'succeeded',
        'failed',
        'uncertain',
        'dead_letter'
      )
    );

  if not v_allowed then
    raise exception
      'QF-MVP-50.1B: invalid automation-job transition % -> %.',
      old.status, new.status
      using errcode = 'check_violation';
  end if;

  if old.status = 'processing' then
    select status, classification
      into v_attempt_status, v_attempt_classification
      from public.automation_execution_attempts
     where job_id = old.id
       and attempt_number = old.attempt_count;

    if v_attempt_status is distinct from 'completed'
       or v_attempt_classification is distinct from new.last_result_classification then
      raise exception
        'QF-MVP-50.1B: a processing job may leave processing only after its current attempt is completed with matching classification.'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.status = 'processing' then
    if new.attempt_count <> old.attempt_count + 1 then
      raise exception
        'QF-MVP-50.1B: claiming must increment attempt_count exactly once.'
        using errcode = 'check_violation';
    end if;
  elsif new.attempt_count <> old.attempt_count then
    raise exception
      'QF-MVP-50.1B: attempt_count may change only while claiming a new attempt.'
      using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.qf_guard_automation_attempt_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.automation_jobs%rowtype;
begin
  if new.status <> 'started'
     or new.classification is not null
     or new.safe_code is not null
     or new.executor_reference is not null
     or new.finished_at is not null then
    raise exception
      'QF-MVP-50.1B: execution attempts must be inserted in pristine started state.'
      using errcode = 'check_violation';
  end if;

  select * into v_job
    from public.automation_jobs
   where id = new.job_id;

  if v_job.id is null then
    raise exception
      'QF-MVP-50.1B: execution attempt references a missing automation job.'
      using errcode = 'foreign_key_violation';
  end if;

  if v_job.status <> 'processing'
     or v_job.attempt_count <> new.attempt_number
     or v_job.locked_by is distinct from new.worker_id then
    raise exception
      'QF-MVP-50.1B: execution attempt must match the currently owned processing job.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace function public.qf_guard_automation_attempt_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.status <> 'started' or new.status <> 'completed' then
    raise exception
      'QF-MVP-50.1B: an execution attempt may transition only started -> completed once.'
      using errcode = 'check_violation';
  end if;

  if new.id is distinct from old.id
     or new.job_id is distinct from old.job_id
     or new.attempt_number is distinct from old.attempt_number
     or new.worker_id is distinct from old.worker_id
     or new.started_at is distinct from old.started_at
     or new.created_at is distinct from old.created_at then
    raise exception
      'QF-MVP-50.1B: execution-attempt identity is immutable.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_automation_action_request_insert_guard
  before insert on public.automation_action_requests
  for each row execute function public.qf_guard_automation_action_request_insert();

create trigger trg_automation_action_request_update_guard
  before update on public.automation_action_requests
  for each row execute function public.qf_guard_automation_action_request_update();

create trigger trg_automation_action_requests_no_delete
  before delete on public.automation_action_requests
  for each row execute function public.qf_prevent_automation_history_delete();

create trigger trg_automation_action_requests_no_truncate
  before truncate on public.automation_action_requests
  for each statement execute function public.qf_prevent_automation_history_delete();

create trigger trg_automation_job_insert_guard
  before insert on public.automation_jobs
  for each row execute function public.qf_guard_automation_job_insert();

create trigger trg_automation_job_update_guard
  before update on public.automation_jobs
  for each row execute function public.qf_guard_automation_job_update();

create trigger trg_automation_jobs_no_delete
  before delete on public.automation_jobs
  for each row execute function public.qf_prevent_automation_history_delete();

create trigger trg_automation_jobs_no_truncate
  before truncate on public.automation_jobs
  for each statement execute function public.qf_prevent_automation_history_delete();

create trigger trg_automation_attempt_insert_guard
  before insert on public.automation_execution_attempts
  for each row execute function public.qf_guard_automation_attempt_insert();

create trigger trg_automation_attempt_update_guard
  before update on public.automation_execution_attempts
  for each row execute function public.qf_guard_automation_attempt_update();

create trigger trg_automation_attempts_no_delete
  before delete on public.automation_execution_attempts
  for each row execute function public.qf_prevent_automation_history_delete();

create trigger trg_automation_attempts_no_truncate
  before truncate on public.automation_execution_attempts
  for each statement execute function public.qf_prevent_automation_history_delete();

-- ---------------------------------------------------------------------------
-- 6. Core-owned mutation RPCs
-- ---------------------------------------------------------------------------

-- 6.1 Idempotent request creation.
create or replace function public.qf_create_automation_action_request_v1(
  p_request_id uuid,
  p_contract_version integer,
  p_action_type text,
  p_entity_type text,
  p_entity_id text,
  p_source text,
  p_requested_by_type text,
  p_requested_by_id text,
  p_requested_at timestamptz,
  p_idempotency_key text,
  p_correlation_id text,
  p_safe_context jsonb
)
returns public.automation_action_requests
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.automation_action_requests%rowtype;
begin
  insert into public.automation_action_requests (
    id,
    contract_version,
    action_type,
    entity_type,
    entity_id,
    source,
    requested_by_type,
    requested_by_id,
    requested_at,
    idempotency_key,
    correlation_id,
    safe_context
  ) values (
    p_request_id,
    p_contract_version,
    p_action_type,
    p_entity_type,
    p_entity_id,
    p_source,
    p_requested_by_type,
    p_requested_by_id,
    p_requested_at,
    p_idempotency_key,
    p_correlation_id,
    coalesce(p_safe_context, '{}'::jsonb)
  )
  on conflict (idempotency_key) do nothing
  returning * into v_row;

  if v_row.id is not null then
    return v_row;
  end if;

  select * into v_row
    from public.automation_action_requests
   where idempotency_key = p_idempotency_key;

  if v_row.id is null then
    raise exception
      'AUTOMATION_ACTION_REQUEST_CREATE_CONFLICT'
      using errcode = 'P0001';
  end if;

  if v_row.id is distinct from p_request_id
     or v_row.contract_version is distinct from p_contract_version
     or v_row.action_type is distinct from p_action_type
     or v_row.entity_type is distinct from p_entity_type
     or v_row.entity_id is distinct from p_entity_id
     or v_row.source is distinct from p_source
     or v_row.requested_by_type is distinct from p_requested_by_type
     or v_row.requested_by_id is distinct from p_requested_by_id
     or v_row.requested_at is distinct from p_requested_at
     or v_row.correlation_id is distinct from p_correlation_id
     or v_row.safe_context is distinct from coalesce(p_safe_context, '{}'::jsonb) then
    raise exception
      'AUTOMATION_ACTION_REQUEST_IDEMPOTENCY_CONFLICT'
      using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

comment on function public.qf_create_automation_action_request_v1(
  uuid, integer, text, text, text, text, text, text, timestamptz, text, text, jsonb
) is
  'QF-MVP-50.1B Core mutation boundary: idempotently persists one source-neutral action request; same key with different scope/evidence is rejected.';

-- 6.2 One-way Core/admin decision, idempotent on exact replay.
create or replace function public.qf_decide_automation_action_request_v1(
  p_request_id uuid,
  p_decision text,
  p_decision_id text,
  p_decision_actor_type text,
  p_decision_actor_id text,
  p_reason_code text
)
returns public.automation_action_requests
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.automation_action_requests%rowtype;
begin
  if p_decision not in ('authorized', 'rejected') then
    raise exception 'AUTOMATION_DECISION_INVALID' using errcode = 'P0001';
  end if;

  if p_decision_actor_type not in ('core_service', 'admin_user') then
    raise exception 'AUTOMATION_DECISION_ACTOR_INVALID' using errcode = 'P0001';
  end if;

  if p_decision_id is null
     or p_decision_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
     or p_decision_actor_id is null
     or p_decision_actor_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
     or p_reason_code is null
     or p_reason_code !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$' then
    raise exception 'AUTOMATION_DECISION_EVIDENCE_INVALID' using errcode = 'P0001';
  end if;

  select * into v_row
    from public.automation_action_requests
   where id = p_request_id
   for update;

  if v_row.id is null then
    raise exception 'AUTOMATION_ACTION_REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_row.decision_status = 'requested' then
    update public.automation_action_requests
       set decision_status = p_decision,
           decision_id = p_decision_id,
           decision_at = now(),
           decision_actor_type = p_decision_actor_type,
           decision_actor_id = p_decision_actor_id,
           decision_reason_code = p_reason_code
     where id = p_request_id
     returning * into v_row;

    return v_row;
  end if;

  -- Exact replays are safe and return the already-decided row. The timestamp is
  -- intentionally not caller-supplied, so replay comparison uses immutable
  -- decision identity/actor/reason rather than wall-clock equality.
  if v_row.decision_status = p_decision
     and v_row.decision_id = p_decision_id
     and v_row.decision_actor_type = p_decision_actor_type
     and v_row.decision_actor_id = p_decision_actor_id
     and v_row.decision_reason_code = p_reason_code then
    return v_row;
  end if;

  raise exception
    'AUTOMATION_ACTION_REQUEST_DECISION_CONFLICT'
    using errcode = 'P0001';
end;
$$;

comment on function public.qf_decide_automation_action_request_v1(
  uuid, text, text, text, text, text
) is
  'QF-MVP-50.1B Core/admin-only decision boundary: requested -> authorized|rejected exactly once; exact replay is idempotent, conflicting replay is refused.';

-- 6.3 One job per authorized request.
create or replace function public.qf_create_automation_job_v1(
  p_action_request_id uuid,
  p_max_attempts integer default 5,
  p_available_at timestamptz default now()
)
returns public.automation_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.automation_action_requests%rowtype;
  v_job public.automation_jobs%rowtype;
begin
  if p_max_attempts is null or p_max_attempts < 1 or p_max_attempts > 10 then
    raise exception 'AUTOMATION_JOB_MAX_ATTEMPTS_INVALID' using errcode = 'P0001';
  end if;

  if p_available_at is null then
    raise exception 'AUTOMATION_JOB_AVAILABLE_AT_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_request
    from public.automation_action_requests
   where id = p_action_request_id
   for share;

  if v_request.id is null then
    raise exception 'AUTOMATION_ACTION_REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_request.decision_status <> 'authorized' then
    raise exception 'AUTOMATION_CORE_AUTHORIZATION_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.automation_jobs (
    action_request_id,
    max_attempts,
    available_at
  ) values (
    p_action_request_id,
    p_max_attempts,
    p_available_at
  )
  on conflict (action_request_id) do nothing
  returning * into v_job;

  if v_job.id is not null then
    return v_job;
  end if;

  select * into v_job
    from public.automation_jobs
   where action_request_id = p_action_request_id;

  if v_job.id is null then
    raise exception 'AUTOMATION_JOB_CREATE_CONFLICT' using errcode = 'P0001';
  end if;

  -- A replay may omit/recompute available_at, but it may never silently widen
  -- the persisted retry budget.
  if v_job.max_attempts <> p_max_attempts then
    raise exception 'AUTOMATION_JOB_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;

  return v_job;
end;
$$;

comment on function public.qf_create_automation_job_v1(uuid, integer, timestamptz) is
  'QF-MVP-50.1B creates exactly one durable job for an already-authorized request. Rejected/requested actions cannot become executor jobs.';

-- 6.4 Atomic claim + attempt creation.
create or replace function public.qf_claim_automation_job_v1(
  p_worker_id text
)
returns table (
  job_id uuid,
  action_request_id uuid,
  attempt_id uuid,
  attempt_number integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.automation_jobs%rowtype;
  v_attempt public.automation_execution_attempts%rowtype;
begin
  if p_worker_id is null
     or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' then
    raise exception 'AUTOMATION_WORKER_ID_INVALID' using errcode = 'P0001';
  end if;

  update public.automation_jobs
     set status = 'processing',
         attempt_count = attempt_count + 1,
         next_retry_at = null,
         locked_at = now(),
         locked_by = p_worker_id,
         updated_at = now()
   where id = (
     select j.id
       from public.automation_jobs j
      where j.attempt_count < j.max_attempts
        and (
          (j.status = 'pending' and j.available_at <= now())
          or (
            j.status = 'retry_scheduled'
            and j.next_retry_at is not null
            and j.next_retry_at <= now()
          )
        )
      order by
        case when j.status = 'retry_scheduled' then j.next_retry_at else j.available_at end asc,
        j.created_at asc
      for update skip locked
      limit 1
   )
   returning * into v_job;

  if v_job.id is null then
    return;
  end if;

  insert into public.automation_execution_attempts (
    job_id,
    attempt_number,
    worker_id
  ) values (
    v_job.id,
    v_job.attempt_count,
    p_worker_id
  )
  returning * into v_attempt;

  return query
  select
    v_job.id,
    v_job.action_request_id,
    v_attempt.id,
    v_attempt.attempt_number,
    v_job.max_attempts;
end;
$$;

comment on function public.qf_claim_automation_job_v1(text) is
  'QF-MVP-50.1B atomically claims one due pending/retry_scheduled job and creates its attempt. Processing jobs are NEVER stale-reclaimed automatically.';

-- 6.5 Complete exactly the currently owned attempt and classify Core outcome.
create or replace function public.qf_complete_automation_attempt_v1(
  p_job_id uuid,
  p_attempt_id uuid,
  p_worker_id text,
  p_classification text,
  p_safe_code text,
  p_executor_reference text default null,
  p_next_retry_at timestamptz default null
)
returns public.automation_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.automation_jobs%rowtype;
  v_attempt public.automation_execution_attempts%rowtype;
  v_next_status text;
begin
  if p_worker_id is null
     or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' then
    raise exception 'AUTOMATION_WORKER_ID_INVALID' using errcode = 'P0001';
  end if;

  if p_classification not in (
    'success',
    'retryable_failure',
    'definitive_failure',
    'uncertain'
  ) then
    raise exception 'AUTOMATION_RESULT_CLASSIFICATION_INVALID' using errcode = 'P0001';
  end if;

  if p_safe_code is null
     or p_safe_code !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' then
    raise exception 'AUTOMATION_SAFE_CODE_INVALID' using errcode = 'P0001';
  end if;

  if p_executor_reference is not null
     and p_executor_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' then
    raise exception 'AUTOMATION_EXECUTOR_REFERENCE_INVALID' using errcode = 'P0001';
  end if;

  select * into v_job
    from public.automation_jobs
   where id = p_job_id
   for update;

  if v_job.id is null then
    raise exception 'AUTOMATION_JOB_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_job.status <> 'processing'
     or v_job.locked_by is distinct from p_worker_id then
    raise exception 'AUTOMATION_JOB_OWNERSHIP_CONFLICT' using errcode = 'P0001';
  end if;

  select * into v_attempt
    from public.automation_execution_attempts
   where id = p_attempt_id
   for update;

  if v_attempt.id is null
     or v_attempt.job_id <> v_job.id
     or v_attempt.attempt_number <> v_job.attempt_count
     or v_attempt.worker_id is distinct from p_worker_id
     or v_attempt.status <> 'started' then
    raise exception 'AUTOMATION_ATTEMPT_OWNERSHIP_CONFLICT' using errcode = 'P0001';
  end if;

  if p_classification = 'retryable_failure' then
    if v_job.attempt_count >= v_job.max_attempts then
      if p_next_retry_at is not null then
        raise exception
          'AUTOMATION_RETRY_EXHAUSTED_NEXT_RETRY_FORBIDDEN'
          using errcode = 'P0001';
      end if;
      v_next_status := 'dead_letter';
    else
      if p_next_retry_at is null or p_next_retry_at <= now() then
        raise exception
          'AUTOMATION_NEXT_RETRY_AT_INVALID'
          using errcode = 'P0001';
      end if;
      v_next_status := 'retry_scheduled';
    end if;
  else
    -- SUCCESS / DEFINITIVE_FAILURE / UNCERTAIN are all terminal for this
    -- execution. UNCERTAIN is explicitly never converted into a retry.
    if p_next_retry_at is not null then
      raise exception
        'AUTOMATION_TERMINAL_RESULT_NEXT_RETRY_FORBIDDEN'
        using errcode = 'P0001';
    end if;

    v_next_status := case p_classification
      when 'success' then 'succeeded'
      when 'definitive_failure' then 'failed'
      when 'uncertain' then 'uncertain'
    end;
  end if;

  update public.automation_execution_attempts
     set status = 'completed',
         classification = p_classification,
         safe_code = p_safe_code,
         executor_reference = p_executor_reference,
         finished_at = now()
   where id = v_attempt.id;

  update public.automation_jobs
     set status = v_next_status,
         next_retry_at = case
           when v_next_status = 'retry_scheduled' then p_next_retry_at
           else null
         end,
         locked_at = null,
         locked_by = null,
         last_result_classification = p_classification,
         last_safe_code = p_safe_code,
         completed_at = case
           when v_next_status in (
             'succeeded',
             'failed',
             'uncertain',
             'dead_letter'
           ) then now()
           else null
         end,
         updated_at = now()
   where id = v_job.id
   returning * into v_job;

  return v_job;
end;
$$;

comment on function public.qf_complete_automation_attempt_v1(
  uuid, uuid, text, text, text, text, timestamptz
) is
  'QF-MVP-50.1B completes the owned attempt with a Core classification. Only retryable_failure may schedule another attempt; uncertain is terminal and never blindly resent.';

-- ---------------------------------------------------------------------------
-- 7. RLS + exact application privileges
-- ---------------------------------------------------------------------------
alter table public.automation_action_requests enable row level security;
alter table public.automation_jobs enable row level security;
alter table public.automation_execution_attempts enable row level security;

-- Supabase default ACLs may pre-grant broad access. Reset every relevant role,
-- including service_role, then grant ONLY read access to the tables. All writes
-- must pass through the narrow RPCs above.
revoke all on table public.automation_action_requests
  from public, anon, authenticated, service_role;
revoke all on table public.automation_jobs
  from public, anon, authenticated, service_role;
revoke all on table public.automation_execution_attempts
  from public, anon, authenticated, service_role;

grant select on table public.automation_action_requests to service_role;
grant select on table public.automation_jobs to service_role;
grant select on table public.automation_execution_attempts to service_role;

-- Internal helper/trigger functions are not application APIs.
revoke all on function public.qf_automation_context_has_forbidden_key(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.qf_prevent_automation_history_delete()
  from public, anon, authenticated, service_role;
revoke all on function public.qf_guard_automation_action_request_insert()
  from public, anon, authenticated, service_role;
revoke all on function public.qf_guard_automation_action_request_update()
  from public, anon, authenticated, service_role;
revoke all on function public.qf_guard_automation_job_insert()
  from public, anon, authenticated, service_role;
revoke all on function public.qf_guard_automation_job_update()
  from public, anon, authenticated, service_role;
revoke all on function public.qf_guard_automation_attempt_insert()
  from public, anon, authenticated, service_role;
revoke all on function public.qf_guard_automation_attempt_update()
  from public, anon, authenticated, service_role;

-- Public functions default to PUBLIC EXECUTE; remove everything first.
revoke all on function public.qf_create_automation_action_request_v1(
  uuid, integer, text, text, text, text, text, text, timestamptz, text, text, jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.qf_decide_automation_action_request_v1(
  uuid, text, text, text, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.qf_create_automation_job_v1(
  uuid, integer, timestamptz
) from public, anon, authenticated, service_role;

revoke all on function public.qf_claim_automation_job_v1(text)
  from public, anon, authenticated, service_role;

revoke all on function public.qf_complete_automation_attempt_v1(
  uuid, uuid, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.qf_create_automation_action_request_v1(
  uuid, integer, text, text, text, text, text, text, timestamptz, text, text, jsonb
) to service_role;

grant execute on function public.qf_decide_automation_action_request_v1(
  uuid, text, text, text, text, text
) to service_role;

grant execute on function public.qf_create_automation_job_v1(
  uuid, integer, timestamptz
) to service_role;

grant execute on function public.qf_claim_automation_job_v1(text)
  to service_role;

grant execute on function public.qf_complete_automation_attempt_v1(
  uuid, uuid, text, text, text, text, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Self-verification
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_count integer;
  v_name text;
  v_sig text;
begin
  -- 8.1 exact tables exist, are RLS-enabled and empty.
  foreach v_name in array array[
    'automation_action_requests',
    'automation_jobs',
    'automation_execution_attempts'
  ] loop
    if to_regclass('public.' || v_name) is null then
      raise exception 'QF-MVP-50.1B aborted: public.% missing.', v_name;
    end if;

    if not (
      select c.relrowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = v_name
         and c.relkind = 'r'
    ) then
      raise exception 'QF-MVP-50.1B aborted: RLS not enabled on public.%.', v_name;
    end if;

    execute format('select count(*) from public.%I', v_name) into v_count;
    if v_count <> 0 then
      raise exception 'QF-MVP-50.1B aborted: public.% was unexpectedly seeded (% rows).', v_name, v_count;
    end if;

    if not has_table_privilege('service_role', 'public.' || v_name, 'select')
       or has_table_privilege('service_role', 'public.' || v_name, 'insert')
       or has_table_privilege('service_role', 'public.' || v_name, 'update')
       or has_table_privilege('service_role', 'public.' || v_name, 'delete')
       or has_table_privilege('service_role', 'public.' || v_name, 'truncate')
       or has_table_privilege('anon', 'public.' || v_name, 'select')
       or has_table_privilege('authenticated', 'public.' || v_name, 'select') then
      raise exception
        'QF-MVP-50.1B aborted: table ACL is wider/narrower than SELECT-only service_role for public.%.',
        v_name;
    end if;
  end loop;

  -- 8.2 exactly five application mutation RPCs exist, are SECURITY DEFINER,
  -- have a fixed search_path, and are executable only by service_role.
  foreach v_sig in array array[
    'public.qf_create_automation_action_request_v1(uuid,integer,text,text,text,text,text,text,timestamp with time zone,text,text,jsonb)',
    'public.qf_decide_automation_action_request_v1(uuid,text,text,text,text,text)',
    'public.qf_create_automation_job_v1(uuid,integer,timestamp with time zone)',
    'public.qf_claim_automation_job_v1(text)',
    'public.qf_complete_automation_attempt_v1(uuid,uuid,text,text,text,text,timestamp with time zone)'
  ] loop
    if to_regprocedure(v_sig) is null then
      raise exception 'QF-MVP-50.1B aborted: RPC % missing.', v_sig;
    end if;

    if not (
      select p.prosecdef
        from pg_proc p
       where p.oid = to_regprocedure(v_sig)
    ) then
      raise exception 'QF-MVP-50.1B aborted: RPC % is not SECURITY DEFINER.', v_sig;
    end if;

    if not (
      select array_to_string(coalesce(p.proconfig, array[]::text[]), ',')
               like '%search_path=pg_catalog, public, pg_temp%'
        from pg_proc p
       where p.oid = to_regprocedure(v_sig)
    ) then
      raise exception 'QF-MVP-50.1B aborted: RPC % lacks fixed search_path.', v_sig;
    end if;

    if not has_function_privilege('service_role', v_sig, 'execute')
       or has_function_privilege('anon', v_sig, 'execute')
       or has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception 'QF-MVP-50.1B aborted: RPC execute ACL invalid for %.', v_sig;
    end if;
  end loop;

  -- 8.3 all twelve history/lifecycle triggers exist.
  select count(*) into v_count
    from pg_trigger t
   where not t.tgisinternal
     and t.tgname in (
       'trg_automation_action_request_insert_guard',
       'trg_automation_action_request_update_guard',
       'trg_automation_action_requests_no_delete',
       'trg_automation_action_requests_no_truncate',
       'trg_automation_job_insert_guard',
       'trg_automation_job_update_guard',
       'trg_automation_jobs_no_delete',
       'trg_automation_jobs_no_truncate',
       'trg_automation_attempt_insert_guard',
       'trg_automation_attempt_update_guard',
       'trg_automation_attempts_no_delete',
       'trg_automation_attempts_no_truncate'
     );

  if v_count <> 12 then
    raise exception
      'QF-MVP-50.1B aborted: expected 12 automation lifecycle/history triggers, found %.',
      v_count;
  end if;

  -- 8.4 old generic kernel remains absent.
  foreach v_name in array array[
    'workflow_instances',
    'workflow_tasks',
    'domain_events',
    'outbox_events',
    'workflow_failures',
    'idempotency_records',
    'workflow_transition_history'
  ] loop
    if to_regclass('public.' || v_name) is not null then
      raise exception
        'QF-MVP-50.1B aborted: legacy workflow-kernel table public.% appeared.',
        v_name;
    end if;
  end loop;

  -- 8.5 no database transport was introduced.
  if exists (
    select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')
  ) then
    raise exception
      'QF-MVP-50.1B aborted: a database network extension is installed.';
  end if;
end;
$verify$;

commit;
