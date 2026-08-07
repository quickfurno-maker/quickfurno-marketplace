-- ============================================================================
-- QF-MVP-50.2E — SIGNED CLIENT-EXECUTION TRANSPORT ROUTE
--
-- PURPOSE
--   Give the n8n -> Core `execute_v1` signed route a durable, one-shot,
--   ATTEMPT-SCOPED request identity, without weakening `claim_v1` or
--   `complete_v1`.
--
-- IDENTITY ONLY — THE CENTRAL RULE OF THIS MIGRATION
--   The execute ledger records EXACTLY ONE fact: "a signed execution request
--   identity was durably reserved for this exact attempt". It stores NO provider
--   outcome, NO communication status, NO classification, NO safe code, NO
--   executor reference and NO recipient/template/provider/consent/business
--   payload. The table has never had columns for any of those and this migration
--   adds none.
--
--   Consequently EVERY replay must re-read Core truth — the communication ledger
--   and the attempt/job rows — rather than trusting a stored verdict. A replay
--   can therefore never disagree with what actually happened, and a stale
--   reservation can never masquerade as a result.
--
-- NO CROSS-SYSTEM ATOMICITY IS CLAIMED
--   Reserving this identity and performing the provider execution are NOT one
--   transaction and cannot be: the provider call is an external network action
--   made by the application layer, long after this function has committed. This
--   migration deliberately claims only what it can deliver — a durable,
--   attempt-scoped reservation. Crash-safety across the boundary comes from
--   re-reading truth on replay, not from a transaction that does not exist.
--
-- WHY ATTEMPT-SCOPED
--   One job legally produces several attempts across retry scheduling, so the
--   `claim_v1` one-row-per-JOB rule is the wrong shape. Execution uniqueness is
--   anchored to the exact attempt, exactly as `complete_v1` already is.
--
-- NON-ACTIONS
--   No HTTP call, webhook, n8n workflow, Meta/provider call, communication send,
--   attempt completion, retry scheduling, assignment/credit/package/consent
--   mutation, historical migration edit, or seed row.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Fail-closed dependency / drift preflight
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_name text;
begin
  if to_regclass('public.automation_transport_requests') is null then
    raise exception
      'QF-MVP-50.2E aborted: QF-MVP-50.1C transport ledger is missing.';
  end if;

  if to_regprocedure('public.qf_claim_automation_job_transport_v1(uuid,text,text)') is null then
    raise exception
      'QF-MVP-50.2E aborted: qf_claim_automation_job_transport_v1 is missing.';
  end if;

  -- The QF-MVP-50.2D completion route must already exist. Running 50.2E against
  -- a ledger that never received 50.2D would silently produce a different table.
  if to_regprocedure(
       'public.qf_complete_automation_attempt_transport_v1(uuid,text,text,uuid,uuid,text,text,text,timestamptz)'
     ) is null then
    raise exception
      'QF-MVP-50.2E aborted: QF-MVP-50.2D completion transport RPC is missing.';
  end if;

  -- Every fence this migration replaces must exist by its exact name first.
  -- A missing fence means the ledger already drifted; masking that would be
  -- worse than refusing to run.
  foreach v_name in array array[
    'automation_transport_requests_route_check',
    'automation_transport_requests_state_check',
    'automation_transport_requests_shape_check'
  ] loop
    if not exists (
      select 1
        from pg_catalog.pg_constraint con
       where con.conrelid = to_regclass('public.automation_transport_requests')
         and con.conname = v_name
         and con.contype = 'c'
    ) then
      raise exception
        'QF-MVP-50.2E aborted: expected constraint % is absent; reconcile drift instead of masking it.',
        v_name;
    end if;
  end loop;

  -- Both QF-MVP-50.2D uniqueness rules must be present and are preserved verbatim.
  if to_regclass('public.uq_automation_transport_requests_claim_job') is null then
    raise exception
      'QF-MVP-50.2E aborted: uq_automation_transport_requests_claim_job is absent.';
  end if;

  if to_regclass('public.uq_automation_transport_requests_complete_attempt') is null then
    raise exception
      'QF-MVP-50.2E aborted: uq_automation_transport_requests_complete_attempt is absent.';
  end if;

  if to_regclass('public.uq_automation_transport_requests_execute_attempt') is not null then
    raise exception
      'QF-MVP-50.2E aborted: execute uniqueness already exists; reconcile instead of masking drift.';
  end if;

  if exists (
    select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')
  ) then
    raise exception
      'QF-MVP-50.2E aborted: database network extension present; transport must remain application-layer only.';
  end if;
end;
$preflight$;

lock table public.automation_transport_requests in access exclusive mode;

-- ---------------------------------------------------------------------------
-- 1. Route vocabulary — closed, exactly three routes
-- ---------------------------------------------------------------------------
alter table public.automation_transport_requests
  drop constraint automation_transport_requests_route_check;

alter table public.automation_transport_requests
  add constraint automation_transport_requests_route_check
  check (route_key in ('claim_v1', 'complete_v1', 'execute_v1'));

-- ---------------------------------------------------------------------------
-- 2. State vocabulary — closed; `recorded` is the only new terminal state
-- ---------------------------------------------------------------------------
alter table public.automation_transport_requests
  drop constraint automation_transport_requests_state_check;

alter table public.automation_transport_requests
  add constraint automation_transport_requests_state_check
  check (state in ('processing', 'claimed', 'empty', 'completed', 'recorded'));

-- ---------------------------------------------------------------------------
-- 3. Shape — every terminal state is bound to exactly one route
--
--    claim_v1    : processing -> claimed | empty      (unchanged semantics)
--    complete_v1 : processing -> completed            (unchanged semantics)
--    execute_v1  : processing -> recorded
--
--    The `recorded` branch carries ONLY identity columns. There is no outcome
--    column on this table to carry, and none is added.
-- ---------------------------------------------------------------------------
alter table public.automation_transport_requests
  drop constraint automation_transport_requests_shape_check;

alter table public.automation_transport_requests
  add constraint automation_transport_requests_shape_check
  check (
    (
      state = 'processing'
      and job_id is null
      and action_request_id is null
      and attempt_id is null
      and attempt_number is null
      and max_attempts is null
      and finalized_at is null
    )
    or (
      state = 'empty'
      and route_key = 'claim_v1'
      and job_id is null
      and action_request_id is null
      and attempt_id is null
      and attempt_number is null
      and max_attempts is null
      and finalized_at is not null
    )
    or (
      state = 'claimed'
      and route_key = 'claim_v1'
      and job_id is not null
      and action_request_id is not null
      and attempt_id is not null
      and attempt_number is not null
      and max_attempts is not null
      and finalized_at is not null
    )
    or (
      state = 'completed'
      and route_key = 'complete_v1'
      and job_id is not null
      and action_request_id is not null
      and attempt_id is not null
      and attempt_number is not null
      and max_attempts is not null
      and finalized_at is not null
    )
    or (
      state = 'recorded'
      and route_key = 'execute_v1'
      and job_id is not null
      and action_request_id is not null
      and attempt_id is not null
      and attempt_number is not null
      and max_attempts is not null
      and finalized_at is not null
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Route-scoped uniqueness
--
--    Both QF-MVP-50.2D indexes are left completely untouched. Execution gets its
--    own exact-attempt rule, so an attempt may hold at most ONE execute identity
--    while still legally holding a claim row and a completion row.
-- ---------------------------------------------------------------------------
create unique index uq_automation_transport_requests_execute_attempt
  on public.automation_transport_requests(attempt_id)
  where route_key = 'execute_v1' and attempt_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Insert guard — still pristine-only, now for exactly three routes
-- ---------------------------------------------------------------------------
create or replace function public.qf_guard_automation_transport_request_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.transport_version <> 1
     or new.direction <> 'n8n_to_core'
     or new.route_key not in ('claim_v1', 'complete_v1', 'execute_v1')
     or new.state <> 'processing'
     or new.job_id is not null
     or new.action_request_id is not null
     or new.attempt_id is not null
     or new.attempt_number is not null
     or new.max_attempts is not null
     or new.finalized_at is not null then
    raise exception
      'QF-MVP-50.2E: transport requests must be inserted as pristine n8n_to_core claim_v1/complete_v1/execute_v1 processing rows.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Update guard — finalization is route-bound and history stays immutable
-- ---------------------------------------------------------------------------
create or replace function public.qf_guard_automation_transport_request_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.state <> 'processing' then
    raise exception
      'QF-MVP-50.2E: finalized transport request history is immutable.'
      using errcode = 'check_violation';
  end if;

  if new.id is distinct from old.id
     or new.transport_version is distinct from old.transport_version
     or new.direction is distinct from old.direction
     or new.route_key is distinct from old.route_key
     or new.worker_id is distinct from old.worker_id
     or new.body_sha256 is distinct from old.body_sha256
     or new.created_at is distinct from old.created_at then
    raise exception
      'QF-MVP-50.2E: transport request identity/evidence is immutable.'
      using errcode = 'check_violation';
  end if;

  if old.route_key = 'claim_v1' and new.state not in ('claimed', 'empty') then
    raise exception
      'QF-MVP-50.2E: a claim_v1 request may finalize only to claimed or empty.'
      using errcode = 'check_violation';
  end if;

  if old.route_key = 'complete_v1' and new.state <> 'completed' then
    raise exception
      'QF-MVP-50.2E: a complete_v1 request may finalize only to completed.'
      using errcode = 'check_violation';
  end if;

  if old.route_key = 'execute_v1' and new.state <> 'recorded' then
    raise exception
      'QF-MVP-50.2E: an execute_v1 request may finalize only to recorded.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. One-shot signed execution-identity reservation RPC
--
--    THIS FUNCTION RESERVES AN IDENTITY. IT DOES NOTHING ELSE.
--
--    It does NOT complete an attempt, does NOT classify anything, does NOT
--    schedule a retry, does NOT read or write communication state, does NOT
--    resolve a recipient/template/provider/consent, and does NOT call a
--    provider. The application layer performs the execution AFTER this function
--    has committed, which is precisely why nothing here pretends the two are
--    atomic.
--
--    Ownership IS proven here — not as a duplicate of the application's own
--    check, but because this is the single durable serialization point at which
--    "this attempt now holds an execution reservation" becomes true. Reserving
--    against an attempt the caller does not own would be a durable falsehood.
-- ---------------------------------------------------------------------------
create or replace function public.qf_record_automation_execution_transport_v1(
  p_request_id uuid,
  p_worker_id text,
  p_body_sha256 text,
  p_job_id uuid,
  p_attempt_id uuid
)
returns table (
  request_id uuid,
  route_key text,
  state text,
  is_replay boolean,
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
  v_request public.automation_transport_requests%rowtype;
  v_existing public.automation_transport_requests%rowtype;
  v_job public.automation_jobs%rowtype;
  v_attempt public.automation_execution_attempts%rowtype;
  v_inserted boolean := false;
begin
  if p_request_id is null or p_job_id is null or p_attempt_id is null then
    raise exception 'AUTOMATION_TRANSPORT_EXECUTION_IDENTITY_REQUIRED'
      using errcode = 'P0001';
  end if;

  if p_worker_id is null
     or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' then
    raise exception 'AUTOMATION_TRANSPORT_WORKER_ID_INVALID'
      using errcode = 'P0001';
  end if;

  if p_body_sha256 is null
     or p_body_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'AUTOMATION_TRANSPORT_BODY_HASH_INVALID'
      using errcode = 'P0001';
  end if;

  -- Lock the job FIRST. Two concurrent execution requests for the same job are
  -- serialized here, so the attempt-scoped lookup below cannot be raced into
  -- producing two reservations.
  select * into v_job
    from public.automation_jobs
   where id = p_job_id
   for update;

  if v_job.id is null then
    raise exception 'AUTOMATION_EXECUTION_JOB_NOT_FOUND'
      using errcode = 'P0001';
  end if;

  select * into v_attempt
    from public.automation_execution_attempts
   where id = p_attempt_id
   for update;

  if v_attempt.id is null
     or v_attempt.job_id <> v_job.id
     or v_attempt.attempt_number <> v_job.attempt_count
     or v_attempt.worker_id is distinct from p_worker_id then
    raise exception 'AUTOMATION_EXECUTION_ATTEMPT_NOT_CURRENT'
      using errcode = 'P0001';
  end if;

  -- An execution reservation may only be opened against a live, owned, started
  -- attempt. A replay of an already-finalized attempt never reaches this
  -- function: the caller resolves that from durable evidence beforehand.
  if v_job.status <> 'processing'
     or v_job.locked_by is distinct from p_worker_id
     or v_attempt.status <> 'started' then
    raise exception 'AUTOMATION_EXECUTION_JOB_NOT_OWNED'
      using errcode = 'P0001';
  end if;

  -- ATTEMPT-SCOPED REPLAY. Checked BEFORE any insert, so a second signed request
  -- for an attempt that already holds a reservation returns that reservation
  -- instead of burning a fresh request identity or raising.
  select * into v_existing
    from public.automation_transport_requests
   where route_key = 'execute_v1'
     and attempt_id = p_attempt_id
   for update;

  if v_existing.id is not null then
    if v_existing.job_id is distinct from p_job_id
       or v_existing.state <> 'recorded' then
      raise exception 'AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT'
        using errcode = 'P0001';
    end if;

    -- Same request identity replayed: the worker and the exact body must match,
    -- so a re-signed different body can never inherit this reservation.
    if v_existing.id = p_request_id
       and (v_existing.worker_id is distinct from p_worker_id
            or v_existing.body_sha256 is distinct from p_body_sha256) then
      raise exception 'AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT'
        using errcode = 'P0001';
    end if;

    return query
    select
      v_existing.id,
      v_existing.route_key,
      v_existing.state,
      true,
      v_existing.job_id,
      v_existing.action_request_id,
      v_existing.attempt_id,
      v_existing.attempt_number,
      v_existing.max_attempts;
    return;
  end if;

  insert into public.automation_transport_requests (
    id,
    route_key,
    worker_id,
    body_sha256
  ) values (
    p_request_id,
    'execute_v1',
    p_worker_id,
    p_body_sha256
  )
  on conflict (id) do nothing
  returning * into v_request;

  v_inserted := v_request.id is not null;

  if not v_inserted then
    -- The identity exists but holds no reservation for THIS attempt (the lookup
    -- above found none). It therefore belongs to another route or another
    -- attempt, or a prior transaction died mid-flight. Never reuse it.
    select * into v_request
      from public.automation_transport_requests
     where id = p_request_id
     for update;

    if v_request.id is null then
      raise exception 'AUTOMATION_TRANSPORT_REPLAY_STATE_MISSING'
        using errcode = 'P0001';
    end if;

    if v_request.state = 'processing' then
      raise exception 'AUTOMATION_TRANSPORT_REQUEST_INCOMPLETE_INVARIANT'
        using errcode = 'P0001';
    end if;

    raise exception 'AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT'
      using errcode = 'P0001';
  end if;

  -- First and only reservation for this attempt. Identity columns only.
  update public.automation_transport_requests
     set state = 'recorded',
         job_id = v_job.id,
         action_request_id = v_job.action_request_id,
         attempt_id = v_attempt.id,
         attempt_number = v_attempt.attempt_number,
         max_attempts = v_job.max_attempts,
         finalized_at = now()
   where id = p_request_id
   returning * into v_request;

  return query
  select
    v_request.id,
    v_request.route_key,
    v_request.state,
    false,
    v_request.job_id,
    v_request.action_request_id,
    v_request.attempt_id,
    v_request.attempt_number,
    v_request.max_attempts;
end;
$$;

comment on function public.qf_record_automation_execution_transport_v1(
  uuid, text, text, uuid, uuid
) is
  'QF-MVP-50.2E one-shot signed execution-identity reservation. IDENTITY ONLY: it stores no outcome, classification, safe code, executor reference or communication status, completes no attempt and calls no provider. Replay is attempt-scoped; every replay re-reads Core truth rather than a stored verdict.';

comment on column public.automation_transport_requests.route_key is
  'QF-MVP-50.2E closed transport route vocabulary: claim_v1 (finalizes to claimed/empty), complete_v1 (finalizes to completed) or execute_v1 (finalizes to recorded). No other route is authorized.';

comment on column public.automation_transport_requests.finalized_at is
  'When this signed TRANSPORT REQUEST identity finished being handled. For execute_v1 this marks the reservation, never a provider outcome: the execution happens in the application layer after this row commits, and no cross-system atomicity is claimed.';

-- ---------------------------------------------------------------------------
-- 8. Exact privileges — unchanged posture, one new RPC
-- ---------------------------------------------------------------------------
revoke all on function public.qf_record_automation_execution_transport_v1(
  uuid, text, text, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.qf_record_automation_execution_transport_v1(
  uuid, text, text, uuid, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Self-verification
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_count integer;
  v_sig text :=
    'public.qf_record_automation_execution_transport_v1(uuid,text,text,uuid,uuid)';
  v_claim_sig text :=
    'public.qf_claim_automation_job_transport_v1(uuid,text,text)';
  v_complete_sig text :=
    'public.qf_complete_automation_attempt_transport_v1(uuid,text,text,uuid,uuid,text,text,text,timestamptz)';
begin
  -- 9.1 the two earlier routes survived untouched.
  if to_regprocedure(v_claim_sig) is null then
    raise exception 'QF-MVP-50.2E aborted: claim transport RPC disappeared.';
  end if;

  if to_regprocedure(v_complete_sig) is null then
    raise exception 'QF-MVP-50.2E aborted: completion transport RPC disappeared.';
  end if;

  if to_regclass('public.uq_automation_transport_requests_claim_job') is null then
    raise exception 'QF-MVP-50.2E aborted: claim job uniqueness was not preserved.';
  end if;

  if to_regclass('public.uq_automation_transport_requests_complete_attempt') is null then
    raise exception 'QF-MVP-50.2E aborted: completion attempt uniqueness was not preserved.';
  end if;

  if to_regclass('public.uq_automation_transport_requests_execute_attempt') is null then
    raise exception 'QF-MVP-50.2E aborted: execution attempt uniqueness missing.';
  end if;

  -- 9.2 the four lifecycle triggers are still bound.
  select count(*) into v_count
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'automation_transport_requests'
     and not t.tgisinternal
     and t.tgname in (
       'trg_automation_transport_request_insert_guard',
       'trg_automation_transport_request_update_guard',
       'trg_automation_transport_requests_no_delete',
       'trg_automation_transport_requests_no_truncate'
     );

  if v_count <> 4 then
    raise exception
      'QF-MVP-50.2E aborted: expected 4 transport lifecycle triggers, found %.',
      v_count;
  end if;

  -- 9.3 the three replaced fences exist and are validated.
  select count(*) into v_count
    from pg_catalog.pg_constraint con
   where con.conrelid = to_regclass('public.automation_transport_requests')
     and con.contype = 'c'
     and con.convalidated
     and con.conname in (
       'automation_transport_requests_route_check',
       'automation_transport_requests_state_check',
       'automation_transport_requests_shape_check'
     );

  if v_count <> 3 then
    raise exception
      'QF-MVP-50.2E aborted: expected 3 validated route/state/shape fences, found %.',
      v_count;
  end if;

  -- 9.4 the ledger still carries NO outcome column. If a future migration ever
  -- adds one, this migration's identity-only promise must be re-decided rather
  -- than quietly inherited.
  if exists (
    select 1
      from pg_catalog.pg_attribute a
     where a.attrelid = to_regclass('public.automation_transport_requests')
       and a.attnum > 0
       and not a.attisdropped
       and a.attname in (
         'classification',
         'safe_code',
         'executor_reference',
         'communication_status',
         'communication_message_id',
         'provider_message_id'
       )
  ) then
    raise exception
      'QF-MVP-50.2E aborted: transport ledger carries an outcome column; execute_v1 must remain identity-only.';
  end if;

  -- 9.5 RLS and table ACL posture is exactly as QF-MVP-50.1C left it.
  if not (
    select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'automation_transport_requests'
       and c.relkind = 'r'
  ) then
    raise exception 'QF-MVP-50.2E aborted: RLS missing.';
  end if;

  if not has_table_privilege('service_role', 'public.automation_transport_requests', 'select')
     or has_table_privilege('service_role', 'public.automation_transport_requests', 'insert')
     or has_table_privilege('service_role', 'public.automation_transport_requests', 'update')
     or has_table_privilege('service_role', 'public.automation_transport_requests', 'delete')
     or has_table_privilege('service_role', 'public.automation_transport_requests', 'truncate')
     or has_table_privilege('anon', 'public.automation_transport_requests', 'select')
     or has_table_privilege('authenticated', 'public.automation_transport_requests', 'select') then
    raise exception 'QF-MVP-50.2E aborted: transport table ACL invalid.';
  end if;

  -- 9.6 the new RPC is SECURITY DEFINER, search_path pinned, service_role only.
  if to_regprocedure(v_sig) is null then
    raise exception 'QF-MVP-50.2E aborted: execution transport RPC missing.';
  end if;

  if not (select p.prosecdef from pg_proc p where p.oid = to_regprocedure(v_sig)) then
    raise exception 'QF-MVP-50.2E aborted: execution transport RPC is not SECURITY DEFINER.';
  end if;

  if not (
    select array_to_string(coalesce(p.proconfig, array[]::text[]), ',')
             like '%search_path=pg_catalog, public, pg_temp%'
      from pg_proc p
     where p.oid = to_regprocedure(v_sig)
  ) then
    raise exception 'QF-MVP-50.2E aborted: execution transport RPC lacks fixed search_path.';
  end if;

  if not has_function_privilege('service_role', v_sig, 'execute')
     or has_function_privilege('anon', v_sig, 'execute')
     or has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception 'QF-MVP-50.2E aborted: execution transport RPC ACL invalid.';
  end if;

  -- 9.7 no seed row and no network extension appeared.
  select count(*) into v_count from public.automation_transport_requests
   where route_key = 'execute_v1';
  if v_count <> 0 then
    raise exception
      'QF-MVP-50.2E aborted: execution ledger unexpectedly seeded (% rows).', v_count;
  end if;

  if exists (
    select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')
  ) then
    raise exception
      'QF-MVP-50.2E aborted: database network extension appeared.';
  end if;
end;
$verify$;

commit;
