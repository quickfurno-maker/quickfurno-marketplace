-- ============================================================================
-- QF-MVP-50.2 — execute_v1 reservation ambiguity repair
--
-- SUCCESSOR MIGRATION. The historical migration
-- 20260805000000_qf_mvp_50_2e_automation_transport_client_execution_route.sql
-- is APPLIED and is NEVER edited or rewritten by this file.
--
-- DEFECT (deterministic, reproduced live on QuickFurno staging)
-- ------------------------------------------------------------
-- public.qf_record_automation_execution_transport_v1 is declared
-- `returns table (request_id, route_key, state, is_replay, job_id,
-- action_request_id, attempt_id, attempt_number, max_attempts)`. In PL/pgSQL
-- every one of those output columns is an OUT parameter that stays in scope for
-- the whole function body. The attempt-scoped replay lookup then referenced two
-- of those names as bare column names against a table that has columns of
-- exactly the same name:
--
--     select * into v_existing
--       from public.automation_transport_requests
--      where route_key = 'execute_v1'      -- OUT param vs column
--        and attempt_id = p_attempt_id     -- OUT param vs column
--      for update;
--
-- With the default `plpgsql.variable_conflict = error` this raises
--     42702  column reference "route_key" is ambiguous
-- on EVERY call, so the reservation could never succeed and no client
-- automation action could ever be executed. Observed on staging:
-- `select count(*) from automation_transport_requests where route_key =
-- 'execute_v1'` was 0 — the reservation had never once succeeded.
--
-- REPAIR
-- ------
-- CREATE OR REPLACE with the IDENTICAL signature, return shape, SECURITY
-- DEFINER, search_path, grants, ownership checks, attempt-currency checks,
-- replay/conflict branches, route vocabulary, body-hash semantics and state
-- transitions. The ONLY change is that column references are now explicitly
-- qualified through table aliases, which removes the OUT-parameter collision.
--
-- `#variable_conflict` is deliberately NOT used: explicit qualification fixes
-- the defect precisely and locally, whereas a pragma would silently change name
-- resolution for the entire body and hide any future collision instead of
-- failing on it.
--
-- The two ambiguous references are the complete collision set. An audit of the
-- body against all nine OUT names found:
--   * the automation_jobs and automation_execution_attempts lookups reference
--     only `id`, which is not an OUT name;
--   * the INSERT column list is a target-column list and is never substituted;
--   * the UPDATE SET targets are target columns and are never substituted
--     (PostgreSQL in fact forbids qualifying them);
--   * only the replay lookup referenced OUT-shadowed names in an expression.
-- Every statement touching automation_transport_requests is nevertheless
-- aliased and qualified below, so this class of defect cannot recur here.
--
-- NO business authority changes. NO table, column, index, type or trigger
-- change. NO producer change. NO provider, n8n, vendor, campaign or 50.5
-- change. NO seed. NO cleanup of append-only certification evidence.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Preflight — the exact repair target must already exist, with the exact
--    signature and security posture we are about to preserve.
-- ---------------------------------------------------------------------------
do $$
declare
  v_oid oid;
  v_secdef boolean;
  v_config text[];
begin
  select p.oid, p.prosecdef, p.proconfig
    into v_oid, v_secdef, v_config
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'qf_record_automation_execution_transport_v1'
     and pg_get_function_identity_arguments(p.oid)
         = 'p_request_id uuid, p_worker_id text, p_body_sha256 text, p_job_id uuid, p_attempt_id uuid';

  if v_oid is null then
    raise exception
      'QF-MVP-50.2 execute_v1 repair aborted: target function is absent or has an unexpected signature.'
      using errcode = 'P0001';
  end if;

  if v_secdef is not true then
    raise exception
      'QF-MVP-50.2 execute_v1 repair aborted: target function is not SECURITY DEFINER.'
      using errcode = 'P0001';
  end if;

  if v_config is null
     or not ('search_path=pg_catalog, public, pg_temp' = any (v_config)) then
    raise exception
      'QF-MVP-50.2 execute_v1 repair aborted: target function search_path is not the pinned value.'
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The repair. Semantics byte-for-byte equivalent to 20260805000000 except
--    for alias qualification.
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
  select aj.* into v_job
    from public.automation_jobs as aj
   where aj.id = p_job_id
   for update;

  if v_job.id is null then
    raise exception 'AUTOMATION_EXECUTION_JOB_NOT_FOUND'
      using errcode = 'P0001';
  end if;

  select aea.* into v_attempt
    from public.automation_execution_attempts as aea
   where aea.id = p_attempt_id
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
  --
  -- REPAIRED: `atr.route_key` / `atr.attempt_id` are explicitly qualified. Bare
  -- names here resolved to the RETURNS TABLE output variables and raised 42702.
  select atr.* into v_existing
    from public.automation_transport_requests as atr
   where atr.route_key = 'execute_v1'
     and atr.attempt_id = p_attempt_id
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
    select atr.* into v_request
      from public.automation_transport_requests as atr
     where atr.id = p_request_id
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
  -- SET targets are target columns and are never variable-substituted (and may
  -- not be alias-qualified); the WHERE clause is qualified.
  update public.automation_transport_requests as atr
     set state = 'recorded',
         job_id = v_job.id,
         action_request_id = v_job.action_request_id,
         attempt_id = v_attempt.id,
         attempt_number = v_attempt.attempt_number,
         max_attempts = v_job.max_attempts,
         finalized_at = now()
   where atr.id = p_request_id
   returning atr.* into v_request;

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
  'QF-MVP-50.2E one-shot signed execution-identity reservation, repaired by QF-MVP-50.2 for a PL/pgSQL RETURNS TABLE output-variable / column ambiguity (42702). IDENTITY ONLY: it stores no outcome, classification, safe code, executor reference or communication status, completes no attempt and calls no provider. Replay is attempt-scoped; every replay re-reads Core truth rather than a stored verdict.';

-- ---------------------------------------------------------------------------
-- 3. Reassert the exact privilege posture. service_role only.
-- ---------------------------------------------------------------------------
revoke all on function public.qf_record_automation_execution_transport_v1(
  uuid, text, text, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.qf_record_automation_execution_transport_v1(
  uuid, text, text, uuid, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Self-verification
-- ---------------------------------------------------------------------------
do $$
declare
  v_oid oid;
  v_def text;
  v_secdef boolean;
  v_config text[];
  v_count integer;
begin
  select p.oid, pg_get_functiondef(p.oid), p.prosecdef, p.proconfig
    into v_oid, v_def, v_secdef, v_config
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'qf_record_automation_execution_transport_v1'
     and pg_get_function_identity_arguments(p.oid)
         = 'p_request_id uuid, p_worker_id text, p_body_sha256 text, p_job_id uuid, p_attempt_id uuid';

  if v_oid is null then
    raise exception 'QF-MVP-50.2 execute_v1 repair aborted: repaired function not found.'
      using errcode = 'P0001';
  end if;

  -- 4.1 security posture preserved
  if v_secdef is not true then
    raise exception 'QF-MVP-50.2 execute_v1 repair aborted: SECURITY DEFINER lost.'
      using errcode = 'P0001';
  end if;
  if v_config is null
     or not ('search_path=pg_catalog, public, pg_temp' = any (v_config)) then
    raise exception 'QF-MVP-50.2 execute_v1 repair aborted: search_path not preserved.'
      using errcode = 'P0001';
  end if;

  -- 4.2 the ambiguous references are gone and the qualified ones are present
  if v_def ~ 'where\s+route_key\s*=' or v_def ~ 'and\s+attempt_id\s*=\s*p_attempt_id' then
    raise exception 'QF-MVP-50.2 execute_v1 repair aborted: an unqualified ambiguous reference remains.'
      using errcode = 'P0001';
  end if;
  if v_def !~ 'atr\.route_key\s*=\s*''execute_v1'''
     or v_def !~ 'atr\.attempt_id\s*=\s*p_attempt_id' then
    raise exception 'QF-MVP-50.2 execute_v1 repair aborted: qualified replay lookup is absent.'
      using errcode = 'P0001';
  end if;

  -- 4.3 route vocabulary and replay/conflict semantics preserved
  if v_def !~ 'AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT'
     or v_def !~ 'AUTOMATION_EXECUTION_ATTEMPT_NOT_CURRENT'
     or v_def !~ 'AUTOMATION_EXECUTION_JOB_NOT_OWNED'
     or v_def !~ 'AUTOMATION_TRANSPORT_REQUEST_INCOMPLETE_INVARIANT'
     or v_def !~ 'AUTOMATION_TRANSPORT_REPLAY_STATE_MISSING' then
    raise exception 'QF-MVP-50.2 execute_v1 repair aborted: a guard clause was lost.'
      using errcode = 'P0001';
  end if;

  -- 4.4 execute privilege is service_role only
  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'QF-MVP-50.2 execute_v1 repair aborted: execute granted beyond service_role.'
      using errcode = 'P0001';
  end if;
  if not has_function_privilege('service_role', v_oid, 'execute') then
    raise exception 'QF-MVP-50.2 execute_v1 repair aborted: service_role lost execute.'
      using errcode = 'P0001';
  end if;

  -- 4.5 this migration seeds nothing and reveals no pre-existing reservation
  select count(*) into v_count
    from public.automation_transport_requests as atr
   where atr.route_key = 'execute_v1';
  if v_count <> 0 then
    raise exception
      'QF-MVP-50.2 execute_v1 repair aborted: execution ledger unexpectedly seeded (% rows).', v_count
      using errcode = 'P0001';
  end if;

  -- 4.6 the sibling routes are untouched
  if to_regprocedure('public.qf_claim_automation_job_transport_v1(uuid,text,text)') is null
     or to_regprocedure('public.qf_complete_automation_attempt_transport_v1(uuid,text,text,uuid,uuid,text,text,text,timestamptz)') is null then
    raise exception 'QF-MVP-50.2 execute_v1 repair aborted: a sibling transport route is missing.'
      using errcode = 'P0001';
  end if;
end $$;
