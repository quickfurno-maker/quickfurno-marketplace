-- ============================================================================
-- QF-MVP-50.2D — SIGNED ATTEMPT-COMPLETION TRANSPORT ROUTE
--
-- PURPOSE
--   Give the n8n -> Core `complete_v1` signed route exactly the same one-shot
--   replay discipline `claim_v1` already has, without weakening `claim_v1`.
--
-- AUTHORITY
--   Core remains sole DB/business authority. n8n never receives Supabase
--   credentials and never writes this table. n8n supplies no classification,
--   no safe code, no retry timestamp and no recipient/template/provider field.
--
-- WHY A NEW ROUTE VOCABULARY IS REQUIRED
--   QF-MVP-50.1C fenced the ledger to a single route on four independent
--   levels: the route CHECK, the state CHECK, the insert trigger and the
--   shape CHECK — plus a global unique(job_id) that the claim row for a job
--   already occupies. A completion request is therefore not merely unrecorded
--   today, it is unrepresentable. Each fence is REPLACED by an equally closed
--   route-specific rule; none is simply dropped.
--
-- REPLAY IDENTITY IS ATTEMPT-SCOPED
--   One job may legally produce several attempts across retry scheduling, so
--   `claim_v1` uniqueness (one claim row per job) is the wrong shape for a
--   completion. Completion uniqueness is anchored to the exact attempt.
--
-- ATOMICITY
--   `qf_complete_automation_attempt_transport_v1` performs the attempt
--   completion and the ledger finalization in ONE transaction. If the
--   completion is refused, the pristine ledger insert rolls back with it, so a
--   refused request identity is never burned and no attempt side effect exists.
--
-- NON-ACTIONS
--   No HTTP call, webhook, n8n workflow, Meta/provider call, communication
--   send, assignment/credit/package/consent mutation, historical migration
--   edit, or seed row.
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
      'QF-MVP-50.2D aborted: QF-MVP-50.1C transport ledger is missing.';
  end if;

  if to_regprocedure(
       'public.qf_complete_automation_attempt_v1(uuid,uuid,text,text,text,text,timestamptz)'
     ) is null then
    raise exception
      'QF-MVP-50.2D aborted: qf_complete_automation_attempt_v1 is missing.';
  end if;

  if to_regprocedure('public.qf_claim_automation_job_transport_v1(uuid,text,text)') is null then
    raise exception
      'QF-MVP-50.2D aborted: qf_claim_automation_job_transport_v1 is missing.';
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
        'QF-MVP-50.2D aborted: expected constraint % is absent; reconcile drift instead of masking it.',
        v_name;
    end if;
  end loop;

  if to_regclass('public.uq_automation_transport_requests_job') is null then
    raise exception
      'QF-MVP-50.2D aborted: uq_automation_transport_requests_job is absent.';
  end if;

  if exists (
    select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')
  ) then
    raise exception
      'QF-MVP-50.2D aborted: database network extension present; transport must remain application-layer only.';
  end if;
end;
$preflight$;

lock table public.automation_transport_requests in access exclusive mode;

-- ---------------------------------------------------------------------------
-- 1. Route vocabulary — closed, exactly two routes
-- ---------------------------------------------------------------------------
alter table public.automation_transport_requests
  drop constraint automation_transport_requests_route_check;

alter table public.automation_transport_requests
  add constraint automation_transport_requests_route_check
  check (route_key in ('claim_v1', 'complete_v1'));

-- ---------------------------------------------------------------------------
-- 2. State vocabulary — closed; `completed` is the only new terminal state
-- ---------------------------------------------------------------------------
alter table public.automation_transport_requests
  drop constraint automation_transport_requests_state_check;

alter table public.automation_transport_requests
  add constraint automation_transport_requests_state_check
  check (state in ('processing', 'claimed', 'empty', 'completed'));

-- ---------------------------------------------------------------------------
-- 3. Shape — every terminal state is bound to exactly one route
--
--    claim_v1    : processing -> claimed | empty      (unchanged semantics)
--    complete_v1 : processing -> completed
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
  );

-- ---------------------------------------------------------------------------
-- 4. Route-scoped uniqueness
--
--    The old global unique(job_id) is REPLACED, not relaxed: the identical
--    one-claim-row-per-job rule is preserved verbatim for claim_v1, and
--    completion gets its own exact-attempt rule. A completion row for a job
--    that already holds a claim row is therefore representable, while a second
--    completion for the same attempt is not.
-- ---------------------------------------------------------------------------
drop index public.uq_automation_transport_requests_job;

create unique index uq_automation_transport_requests_claim_job
  on public.automation_transport_requests(job_id)
  where route_key = 'claim_v1' and job_id is not null;

create unique index uq_automation_transport_requests_complete_attempt
  on public.automation_transport_requests(attempt_id)
  where route_key = 'complete_v1' and attempt_id is not null;

create index idx_automation_transport_requests_route
  on public.automation_transport_requests(route_key, state, created_at);

-- ---------------------------------------------------------------------------
-- 5. Insert guard — still pristine-only, now for exactly two routes
-- ---------------------------------------------------------------------------
create or replace function public.qf_guard_automation_transport_request_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.transport_version <> 1
     or new.direction <> 'n8n_to_core'
     or new.route_key not in ('claim_v1', 'complete_v1')
     or new.state <> 'processing'
     or new.job_id is not null
     or new.action_request_id is not null
     or new.attempt_id is not null
     or new.attempt_number is not null
     or new.max_attempts is not null
     or new.finalized_at is not null then
    raise exception
      'QF-MVP-50.2D: transport requests must be inserted as pristine n8n_to_core claim_v1/complete_v1 processing rows.'
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
      'QF-MVP-50.2D: finalized transport request history is immutable.'
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
      'QF-MVP-50.2D: transport request identity/evidence is immutable.'
      using errcode = 'check_violation';
  end if;

  if old.route_key = 'claim_v1' and new.state not in ('claimed', 'empty') then
    raise exception
      'QF-MVP-50.2D: a claim_v1 request may finalize only to claimed or empty.'
      using errcode = 'check_violation';
  end if;

  if old.route_key = 'complete_v1' and new.state <> 'completed' then
    raise exception
      'QF-MVP-50.2D: a complete_v1 request may finalize only to completed.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. One-shot signed completion transport RPC
--
--    Core has ALREADY derived classification / safe code / next_retry_at from
--    its own evidence before this is called. This function does not interpret
--    n8n input, does not read communication state and does not invent a
--    classification. It re-proves request identity and delegates every
--    ownership rule to qf_complete_automation_attempt_v1.
-- ---------------------------------------------------------------------------
create or replace function public.qf_complete_automation_attempt_transport_v1(
  p_request_id uuid,
  p_worker_id text,
  p_body_sha256 text,
  p_job_id uuid,
  p_attempt_id uuid,
  p_classification text,
  p_safe_code text,
  p_executor_reference text,
  p_next_retry_at timestamptz default null
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
  max_attempts integer,
  job_status text,
  attempt_status text,
  classification text,
  safe_code text,
  executor_reference text
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.automation_transport_requests%rowtype;
  v_job public.automation_jobs%rowtype;
  v_attempt public.automation_execution_attempts%rowtype;
  v_inserted boolean := false;
begin
  if p_request_id is null or p_job_id is null or p_attempt_id is null then
    raise exception 'AUTOMATION_TRANSPORT_COMPLETION_IDENTITY_REQUIRED'
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

  insert into public.automation_transport_requests (
    id,
    route_key,
    worker_id,
    body_sha256
  ) values (
    p_request_id,
    'complete_v1',
    p_worker_id,
    p_body_sha256
  )
  on conflict (id) do nothing
  returning * into v_request;

  v_inserted := v_request.id is not null;

  if not v_inserted then
    -- INSERT ON CONFLICT waits for a concurrent inserter to finish before
    -- returning. The row is then locked so exact replay evidence is stable.
    select * into v_request
      from public.automation_transport_requests
     where id = p_request_id
     for update;

    if v_request.id is null then
      raise exception 'AUTOMATION_TRANSPORT_REPLAY_STATE_MISSING'
        using errcode = 'P0001';
    end if;

    -- A request identity is bound to ONE route. A claim_v1 identity replayed
    -- against the completion route is a conflict, never a completion.
    if v_request.transport_version <> 1
       or v_request.direction <> 'n8n_to_core'
       or v_request.route_key <> 'complete_v1'
       or v_request.worker_id is distinct from p_worker_id
       or v_request.body_sha256 is distinct from p_body_sha256
       or v_request.job_id is distinct from p_job_id
       or v_request.attempt_id is distinct from p_attempt_id then
      raise exception 'AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT'
        using errcode = 'P0001';
    end if;

    if v_request.state = 'processing' then
      raise exception 'AUTOMATION_TRANSPORT_REQUEST_INCOMPLETE_INVARIANT'
        using errcode = 'P0001';
    end if;

    if v_request.state <> 'completed' then
      raise exception 'AUTOMATION_TRANSPORT_REPLAY_STATE_INVALID'
        using errcode = 'P0001';
    end if;

    -- The durable outcome is re-read from the attempt/job rows rather than
    -- duplicated into the ledger, so a replay can never disagree with truth.
    select * into v_job from public.automation_jobs where id = v_request.job_id;
    select * into v_attempt
      from public.automation_execution_attempts
     where id = v_request.attempt_id;

    if v_job.id is null or v_attempt.id is null then
      raise exception 'AUTOMATION_TRANSPORT_COMPLETION_EVIDENCE_MISSING'
        using errcode = 'P0001';
    end if;

    return query
    select
      v_request.id,
      v_request.route_key,
      v_request.state,
      true,
      v_request.job_id,
      v_request.action_request_id,
      v_request.attempt_id,
      v_request.attempt_number,
      v_request.max_attempts,
      v_job.status,
      v_attempt.status,
      v_attempt.classification,
      v_attempt.safe_code,
      v_attempt.executor_reference;
    return;
  end if;

  -- First and only finalization opportunity for this signed request identity.
  -- Every ownership rule (job processing, worker lock, attempt linkage, current
  -- attempt, attempt started, retry legality, dead-letter boundary) belongs to
  -- qf_complete_automation_attempt_v1 and is NOT duplicated here. If it raises,
  -- this whole transaction — including the pristine insert above — rolls back.
  select * into v_job
    from public.qf_complete_automation_attempt_v1(
      p_job_id,
      p_attempt_id,
      p_worker_id,
      p_classification,
      p_safe_code,
      p_executor_reference,
      p_next_retry_at
    );

  if v_job.id is null then
    raise exception 'AUTOMATION_TRANSPORT_COMPLETION_FAILED'
      using errcode = 'P0001';
  end if;

  select * into v_attempt
    from public.automation_execution_attempts
   where id = p_attempt_id;

  if v_attempt.id is null or v_attempt.job_id <> v_job.id then
    raise exception 'AUTOMATION_TRANSPORT_COMPLETION_EVIDENCE_MISSING'
      using errcode = 'P0001';
  end if;

  update public.automation_transport_requests
     set state = 'completed',
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
    v_request.max_attempts,
    v_job.status,
    v_attempt.status,
    v_attempt.classification,
    v_attempt.safe_code,
    v_attempt.executor_reference;
end;
$$;

comment on function public.qf_complete_automation_attempt_transport_v1(
  uuid, text, text, uuid, uuid, text, text, text, timestamptz
) is
  'QF-MVP-50.2D one-shot signed completion transport. Replay identity is attempt-scoped; a duplicate request UUID returns is_replay=true and never completes a second time. Classification/safe code/next_retry_at are Core-derived inputs, never n8n authority.';

comment on column public.automation_transport_requests.route_key is
  'QF-MVP-50.2D closed transport route vocabulary: claim_v1 (finalizes to claimed/empty) or complete_v1 (finalizes to completed). No other route is authorized.';

-- ---------------------------------------------------------------------------
-- 8. Exact privileges — unchanged posture, one new RPC
-- ---------------------------------------------------------------------------
revoke all on function public.qf_complete_automation_attempt_transport_v1(
  uuid, text, text, uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.qf_complete_automation_attempt_transport_v1(
  uuid, text, text, uuid, uuid, text, text, text, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Self-verification
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_count integer;
  v_sig text :=
    'public.qf_complete_automation_attempt_transport_v1(uuid,text,text,uuid,uuid,text,text,text,timestamptz)';
  v_claim_sig text :=
    'public.qf_claim_automation_job_transport_v1(uuid,text,text)';
begin
  -- 9.1 the claim route survived untouched.
  if to_regprocedure(v_claim_sig) is null then
    raise exception 'QF-MVP-50.2D aborted: claim transport RPC disappeared.';
  end if;

  if to_regclass('public.uq_automation_transport_requests_claim_job') is null then
    raise exception 'QF-MVP-50.2D aborted: claim job uniqueness was not preserved.';
  end if;

  if to_regclass('public.uq_automation_transport_requests_complete_attempt') is null then
    raise exception 'QF-MVP-50.2D aborted: completion attempt uniqueness missing.';
  end if;

  if to_regclass('public.uq_automation_transport_requests_job') is not null then
    raise exception 'QF-MVP-50.2D aborted: superseded global job uniqueness still present.';
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
      'QF-MVP-50.2D aborted: expected 4 transport lifecycle triggers, found %.',
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
      'QF-MVP-50.2D aborted: expected 3 validated route/state/shape fences, found %.',
      v_count;
  end if;

  -- 9.4 RLS and table ACL posture is exactly as QF-MVP-50.1C left it.
  if not (
    select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'automation_transport_requests'
       and c.relkind = 'r'
  ) then
    raise exception 'QF-MVP-50.2D aborted: RLS missing.';
  end if;

  if not has_table_privilege('service_role', 'public.automation_transport_requests', 'select')
     or has_table_privilege('service_role', 'public.automation_transport_requests', 'insert')
     or has_table_privilege('service_role', 'public.automation_transport_requests', 'update')
     or has_table_privilege('service_role', 'public.automation_transport_requests', 'delete')
     or has_table_privilege('service_role', 'public.automation_transport_requests', 'truncate')
     or has_table_privilege('anon', 'public.automation_transport_requests', 'select')
     or has_table_privilege('authenticated', 'public.automation_transport_requests', 'select') then
    raise exception 'QF-MVP-50.2D aborted: transport table ACL invalid.';
  end if;

  -- 9.5 the new RPC is SECURITY DEFINER, search_path pinned, service_role only.
  if to_regprocedure(v_sig) is null then
    raise exception 'QF-MVP-50.2D aborted: completion transport RPC missing.';
  end if;

  if not (select p.prosecdef from pg_proc p where p.oid = to_regprocedure(v_sig)) then
    raise exception 'QF-MVP-50.2D aborted: completion transport RPC is not SECURITY DEFINER.';
  end if;

  if not (
    select array_to_string(coalesce(p.proconfig, array[]::text[]), ',')
             like '%search_path=pg_catalog, public, pg_temp%'
      from pg_proc p
     where p.oid = to_regprocedure(v_sig)
  ) then
    raise exception 'QF-MVP-50.2D aborted: completion transport RPC lacks fixed search_path.';
  end if;

  if not has_function_privilege('service_role', v_sig, 'execute')
     or has_function_privilege('anon', v_sig, 'execute')
     or has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception 'QF-MVP-50.2D aborted: completion transport RPC ACL invalid.';
  end if;

  -- 9.6 no seed row and no network extension appeared.
  select count(*) into v_count from public.automation_transport_requests
   where route_key = 'complete_v1';
  if v_count <> 0 then
    raise exception
      'QF-MVP-50.2D aborted: completion ledger unexpectedly seeded (% rows).', v_count;
  end if;

  if exists (
    select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')
  ) then
    raise exception
      'QF-MVP-50.2D aborted: database network extension appeared.';
  end if;
end;
$verify$;

commit;
