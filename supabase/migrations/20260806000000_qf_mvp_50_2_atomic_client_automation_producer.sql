-- ============================================================================
-- QF-MVP-50.2 FINAL CLOSURE — ATOMIC DB-NATIVE CLIENT AUTOMATION PRODUCER
--
-- PURPOSE
--   Make client automation intent commit or roll back IN THE SAME POSTGRESQL
--   TRANSACTION as the business truth that justifies it.
--
-- WHY A DATABASE TRIGGER
--   The application writes business rows through PostgREST. There is no
--   transaction-aware seam in the TypeScript layer, and the old AOS workflow
--   kernel (outbox_events / domain_events) is deliberately NOT installed — the
--   QF-MVP-50.1B preflight aborts if it ever appears, because two automation
--   authorities must never coexist. A sequential TypeScript producer after the
--   business write would be best-effort fire-and-forget: a crash between the two
--   writes silently loses the automation, and a rolled-back business mutation
--   leaves a ghost job.
--
--   A trigger runs inside the business statement's own transaction, so:
--     business row commits  -> automation request + job are already committed
--     business row rolls back -> automation request + job roll back with it
--
--   This introduces NO second queue and NO second automation authority. It
--   writes exclusively through the ALREADY ADOPTED QF-MVP-50.1B tables and RPCs.
--
-- WHAT THIS IS NOT
--   Not an outbox. Not a scheduler. Not a retry/recovery worker. Not a
--   communication path. It never resolves a recipient, template, provider,
--   provider account or consent state, never calls a provider, and never
--   contacts n8n. Delivery retry and stranded-state recovery remain QF-MVP-50.5.
--
-- SCHEMA IMPACT
--   NONE. No table, column, type or index is created, altered or dropped. The
--   existing uniqueness (uq_automation_action_requests_idempotency and
--   uq_automation_jobs_action_request) already provides durable dedupe and the
--   one-job-per-request invariant, and automation_jobs.available_at already
--   provides business scheduling. Only functions and triggers are added.
--
-- NON-ACTIONS
--   No HTTP call, webhook, n8n workflow, Meta/provider call, communication send,
--   consent/credit/package/assignment mutation, vendor or campaign schema,
--   historical migration edit, or seed row. No vendor accept/reject concept.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Fail-closed dependency / drift preflight
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_name text;
begin
  -- The QF-MVP-50.1B automation authority must already be installed.
  foreach v_name in array array[
    'automation_action_requests',
    'automation_jobs'
  ] loop
    if to_regclass('public.' || v_name) is null then
      raise exception
        'QF-MVP-50.2-PRODUCER aborted: QF-MVP-50.1B table public.% is missing.', v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'public.qf_create_automation_action_request_v1(uuid,integer,text,text,text,text,text,text,timestamptz,text,text,jsonb)',
    'public.qf_decide_automation_action_request_v1(uuid,text,text,text,text,text)',
    'public.qf_create_automation_job_v1(uuid,integer,timestamptz)'
  ] loop
    if to_regprocedure(v_name) is null then
      raise exception
        'QF-MVP-50.2-PRODUCER aborted: required RPC % is missing.', v_name;
    end if;
  end loop;

  -- The business tables this producer hooks must exist with the exact columns
  -- the trigger predicates read. A missing column would silently change which
  -- rows fire, so it is refused rather than masked.
  if to_regclass('public.leads') is null
     or to_regclass('public.lead_clarification_requests') is null
     or to_regclass('public.lead_matching_runs') is null then
    raise exception
      'QF-MVP-50.2-PRODUCER aborted: a required client lifecycle table is missing.';
  end if;

  -- The old generic workflow kernel must remain absent — same rule QF-MVP-50.1B
  -- enforces. This producer must never become a bridge that revives it.
  foreach v_name in array array[
    'workflow_instances', 'workflow_tasks', 'domain_events',
    'outbox_events', 'workflow_failures', 'idempotency_records',
    'workflow_transition_history'
  ] loop
    if to_regclass('public.' || v_name) is not null then
      raise exception
        'QF-MVP-50.2-PRODUCER aborted: legacy workflow-kernel table public.% exists; a second automation authority must not be bridged.',
        v_name;
    end if;
  end loop;

  if exists (
    select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')
  ) then
    raise exception
      'QF-MVP-50.2-PRODUCER aborted: database network extension present; the producer must remain in-transaction only.';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. The atomic enqueue primitive
--
--    ONE function invocation creates the action request, authorizes it and
--    creates its job. Because a PL/pgSQL function body runs inside the caller's
--    transaction, a failure at any step rolls the whole thing back: a request
--    can never exist without its job, and neither can exist without the
--    business row that triggered it.
--
--    AUTHORITY BOUNDARY. The only inputs are a frozen action type, a lead id, a
--    deterministic source-event identity and an optional business due time.
--    There is deliberately NO parameter for recipient, phone, email, template,
--    provider, provider account, consent, classification, safe code or retry
--    timing — those remain Core execution-time concerns and cannot be injected
--    here. `p_source_event_key` is constrained to a safe token, so a trigger
--    cannot smuggle arbitrary text into the idempotency identity.
-- ---------------------------------------------------------------------------
create or replace function public.qf_enqueue_client_automation_v1(
  p_action_type text,
  p_lead_id uuid,
  p_source_event_key text,
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
  v_request_id uuid;
  v_idempotency_key text;
  v_correlation_id text;
  v_now timestamptz := now();
begin
  -- Exactly the six frozen client actions. There is no default branch and no
  -- prefix parsing: an unregistered action cannot be produced at all.
  if p_action_type is null or p_action_type not in (
    'client.lead_confirmation',
    'client.requirement_collection',
    'client.missing_information_reminder',
    'client.matching_update',
    'client.lead_status_update',
    'client.transactional_followup'
  ) then
    raise exception 'QF_PRODUCER_ACTION_NOT_CLIENT_DISPATCHABLE'
      using errcode = 'P0001';
  end if;

  if p_lead_id is null then
    raise exception 'QF_PRODUCER_ENTITY_REQUIRED' using errcode = 'P0001';
  end if;

  -- Bounded, safe-identifier source-event token. This is what makes the
  -- idempotency key deterministic AND unforgeable from business text (a lead
  -- status such as 'Quotation Sent' contains a space and could never reach the
  -- key directly).
  if p_source_event_key is null
     or p_source_event_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'QF_PRODUCER_SOURCE_EVENT_KEY_INVALID' using errcode = 'P0001';
  end if;

  if p_available_at is null then
    raise exception 'QF_PRODUCER_AVAILABLE_AT_REQUIRED' using errcode = 'P0001';
  end if;

  -- Mirrors the pure QF-MVP-50.1A convention
  -- createActionIdempotencyKey(): qf_action_v1:{action}:{entity}:{id}:{evidence}
  v_idempotency_key :=
    'qf_action_v1:' || p_action_type || ':lead:' || p_lead_id::text || ':' || p_source_event_key;
  v_correlation_id := 'qf_corr_v1:lead:' || p_lead_id::text;

  -- DURABLE DEDUPE. uq_automation_action_requests_idempotency is the authority;
  -- this read is the fast path that makes a replay a no-op instead of an error.
  select * into v_request
    from public.automation_action_requests
   where idempotency_key = v_idempotency_key;

  if v_request.id is not null then
    -- Replay of the same business source event. Return the existing job; never
    -- create a second request or a second job.
    select * into v_job
      from public.automation_jobs
     where action_request_id = v_request.id;
    return v_job;
  end if;

  v_request_id := gen_random_uuid();

  -- Core is the requester AND the authorizer. `source = 'core'` records that
  -- this intent originated from QuickFurno Core business truth, never from an
  -- agent, an operator or n8n.
  v_request := public.qf_create_automation_action_request_v1(
    v_request_id,
    1,
    p_action_type,
    'lead',
    p_lead_id::text,
    'core',
    'core_service',
    'qf_core_client_automation_producer',
    v_now,
    v_idempotency_key,
    v_correlation_id,
    '{}'::jsonb
  );

  v_request := public.qf_decide_automation_action_request_v1(
    v_request.id,
    'authorized',
    'qf_auto_decision_' || replace(v_request.id::text, '-', ''),
    'core_service',
    'qf_core_client_automation_producer',
    'QF_CORE_CLIENT_LIFECYCLE_EVENT'
  );

  v_job := public.qf_create_automation_job_v1(v_request.id, 5, p_available_at);

  if v_job.id is null then
    raise exception 'QF_PRODUCER_JOB_NOT_CREATED' using errcode = 'P0001';
  end if;

  return v_job;
end;
$$;

comment on function public.qf_enqueue_client_automation_v1(text, uuid, text, timestamptz) is
  'QF-MVP-50.2 atomic client automation producer. Creates the action request, authorizes it and creates its job in ONE transaction, so automation intent commits or rolls back with the business row that justified it. Accepts only a frozen action type, a lead id, a safe source-event token and a business due time — never a recipient, template, provider, consent or retry input. Replay of the same source event returns the existing job.';

-- ---------------------------------------------------------------------------
-- 2. TRIGGER 1 — client.lead_confirmation
--
--    Source: the actual INSERT of a lead row. Exactly once per lead, because
--    the source-event token is the lead's own id.
-- ---------------------------------------------------------------------------
create or replace function public.qf_produce_client_lead_confirmation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.qf_enqueue_client_automation_v1(
    'client.lead_confirmation',
    new.id,
    'leadcreated',
    now()
  );
  return null;
end;
$$;

create trigger trg_qf_produce_client_lead_confirmation
  after insert on public.leads
  for each row execute function public.qf_produce_client_lead_confirmation();

-- ---------------------------------------------------------------------------
-- 3. TRIGGERS 2 + 3 — client.requirement_collection and the ONE reminder
--
--    Source: a real clarification request row becoming durably prepared. The
--    source-event token is the clarification request's own id, so:
--      * requirement_collection is emitted exactly once per clarification request;
--      * missing_information_reminder is scheduled AT MOST ONCE per clarification
--        request identity, at +24 hours (owner policy B1).
--
--    The reminder is a BUSINESS scheduled action, not a delivery retry. Core
--    re-proves at execution time that the clarification is still unresolved;
--    this trigger only decides that a reminder is due.
-- ---------------------------------------------------------------------------
create or replace function public.qf_produce_client_clarification_actions()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
security definer
as $$
begin
  if new.lead_id is null then
    return null;
  end if;

  if new.status is distinct from 'preview_prepared' then
    return null;
  end if;

  perform public.qf_enqueue_client_automation_v1(
    'client.requirement_collection',
    new.lead_id,
    'clar' || replace(new.id::text, '-', ''),
    now()
  );

  -- Owner policy B1: exactly ONE reminder, +24h, no repeating loop in 50.2.
  perform public.qf_enqueue_client_automation_v1(
    'client.missing_information_reminder',
    new.lead_id,
    'clarrem' || replace(new.id::text, '-', ''),
    now() + interval '24 hours'
  );

  return null;
end;
$$;

create trigger trg_qf_produce_client_clarification_actions
  after insert on public.lead_clarification_requests
  for each row execute function public.qf_produce_client_clarification_actions();

-- ---------------------------------------------------------------------------
-- 4. TRIGGER 4 — client.matching_update
--
--    Source: a matching run reaching the durable 'matched' state. The WHEN
--    clause requires an actual TRANSITION into 'matched', so a re-write of an
--    already-matched run produces nothing, and a run that ends 'skipped',
--    'waiting' or 'failed' produces nothing. The source-event token is the
--    matching run's own id, so one durable match yields one update.
-- ---------------------------------------------------------------------------
create or replace function public.qf_produce_client_matching_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.lead_id is null then
    return null;
  end if;

  perform public.qf_enqueue_client_automation_v1(
    'client.matching_update',
    new.lead_id,
    'match' || replace(new.id::text, '-', ''),
    now()
  );

  return null;
end;
$$;

create trigger trg_qf_produce_client_matching_update
  after update of run_status on public.lead_matching_runs
  for each row
  when (old.run_status is distinct from new.run_status and new.run_status = 'matched')
  execute function public.qf_produce_client_matching_update();

-- ---------------------------------------------------------------------------
-- 5. TRIGGERS 5 + 6 — client.lead_status_update and client.transactional_followup
--
--    Source: an ACTUAL leads.status transition. The WHEN clause is
--    `old.status IS DISTINCT FROM new.status`, so writing the same value again
--    — the classic idempotent application retry — fires nothing at all.
--
--    Per-transition identity: a status is not a safe identifier (several values
--    contain spaces) and there is no status-transition ledger, so the evidence
--    token is an md5 over (lead, old, new, transaction id). It is stable within
--    one transaction — a retried transaction is a genuinely new transition whose
--    predecessor rolled back — and distinct for each real transition.
--
--    Owner policy B2: a transition INTO the exact status 'Quotation Sent' also
--    schedules exactly ONE transactional follow-up at +48 hours. Leaving and
--    legitimately re-entering 'Quotation Sent' is a new real transition and may
--    schedule one new follow-up. Core re-proves the status at execution time.
-- ---------------------------------------------------------------------------
create or replace function public.qf_produce_client_status_actions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_evidence text;
begin
  v_evidence := md5(
    new.id::text || ':' ||
    coalesce(old.status, '') || ':' ||
    coalesce(new.status, '') || ':' ||
    txid_current()::text
  );

  perform public.qf_enqueue_client_automation_v1(
    'client.lead_status_update',
    new.id,
    'status' || v_evidence,
    now()
  );

  if new.status = 'Quotation Sent' then
    perform public.qf_enqueue_client_automation_v1(
      'client.transactional_followup',
      new.id,
      'qsfu' || v_evidence,
      now() + interval '48 hours'
    );
  end if;

  return null;
end;
$$;

create trigger trg_qf_produce_client_status_actions
  after update of status on public.leads
  for each row
  when (old.status is distinct from new.status)
  execute function public.qf_produce_client_status_actions();

-- ---------------------------------------------------------------------------
-- 6. Exact privileges — the producer is never callable by a client role
-- ---------------------------------------------------------------------------
revoke all on function public.qf_enqueue_client_automation_v1(text, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_enqueue_client_automation_v1(text, uuid, text, timestamptz)
  to service_role;

revoke all on function public.qf_produce_client_lead_confirmation()
  from public, anon, authenticated, service_role;
revoke all on function public.qf_produce_client_clarification_actions()
  from public, anon, authenticated, service_role;
revoke all on function public.qf_produce_client_matching_update()
  from public, anon, authenticated, service_role;
revoke all on function public.qf_produce_client_status_actions()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Self-verification
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_count integer;
  v_sig text := 'public.qf_enqueue_client_automation_v1(text,uuid,text,timestamptz)';
begin
  -- 7.1 the enqueue primitive exists with the exact security posture.
  if to_regprocedure(v_sig) is null then
    raise exception 'QF-MVP-50.2-PRODUCER aborted: enqueue primitive missing.';
  end if;

  if not (select p.prosecdef from pg_proc p where p.oid = to_regprocedure(v_sig)) then
    raise exception 'QF-MVP-50.2-PRODUCER aborted: enqueue primitive is not SECURITY DEFINER.';
  end if;

  if not (
    select array_to_string(coalesce(p.proconfig, array[]::text[]), ',')
             like '%search_path=pg_catalog, public, pg_temp%'
      from pg_proc p where p.oid = to_regprocedure(v_sig)
  ) then
    raise exception 'QF-MVP-50.2-PRODUCER aborted: enqueue primitive lacks a fixed search_path.';
  end if;

  if not has_function_privilege('service_role', v_sig, 'execute')
     or has_function_privilege('anon', v_sig, 'execute')
     or has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception 'QF-MVP-50.2-PRODUCER aborted: enqueue primitive ACL invalid.';
  end if;

  -- 7.2 exactly four producer triggers are bound, on their exact tables.
  select count(*) into v_count
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and not t.tgisinternal
     and t.tgname in (
       'trg_qf_produce_client_lead_confirmation',
       'trg_qf_produce_client_clarification_actions',
       'trg_qf_produce_client_matching_update',
       'trg_qf_produce_client_status_actions'
     )
     and c.relname in ('leads', 'lead_clarification_requests', 'lead_matching_runs');

  if v_count <> 4 then
    raise exception
      'QF-MVP-50.2-PRODUCER aborted: expected 4 producer triggers, found %.', v_count;
  end if;

  -- 7.3 no table, column or index was created by this migration: the existing
  -- QF-MVP-50.1B uniqueness remains the only dedupe authority.
  if to_regclass('public.uq_automation_action_requests_idempotency') is null
     or to_regclass('public.uq_automation_jobs_action_request') is null then
    raise exception
      'QF-MVP-50.2-PRODUCER aborted: existing automation uniqueness is missing; dedupe would be unenforced.';
  end if;

  -- 7.4 no legacy kernel table appeared and no network extension appeared.
  if to_regclass('public.outbox_events') is not null
     or to_regclass('public.domain_events') is not null then
    raise exception
      'QF-MVP-50.2-PRODUCER aborted: a legacy workflow-kernel table appeared.';
  end if;

  if exists (
    select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')
  ) then
    raise exception
      'QF-MVP-50.2-PRODUCER aborted: database network extension appeared.';
  end if;

  -- 7.5 the producer seeded nothing.
  select count(*) into v_count
    from public.automation_action_requests
   where requested_by_id = 'qf_core_client_automation_producer';
  if v_count <> 0 then
    raise exception
      'QF-MVP-50.2-PRODUCER aborted: producer unexpectedly seeded % action requests.', v_count;
  end if;
end;
$verify$;

commit;
