-- ============================================================================
-- QF-MVP-50.5 — AUTOMATION RECOVERY AND RECONCILIATION TRANSPORT
--
-- FORWARD-ONLY SUCCESSOR. Every historical migration named below is APPLIED and
-- is never edited here: 20260801110000 (job/attempt persistence + the job update
-- guard), 20260801152049 (transport ledger), 20260804000000 (complete_v1),
-- 20260805000000 (execute_v1), 20260808000000 (fresh-claim wedge repair) and
-- 20260811000000 (family-aware claim routing).
--
-- WHAT QF-MVP-50.5 OWNS
--   Every earlier migration in this lineage deferred exactly the same thing:
--   "governed retry recovery — due sweep, retry_scheduled reclaim, stale leases,
--   dead-letter handling — remains owned by QF-MVP-50.5". This is that migration.
--
-- TWO DISTINCT ROUTES, NEVER ONE
--   recover_v1    DUE-RETRY RECOVERY. Selects one eligible due `retry_scheduled`
--                 job, creates the NEXT attempt, increments attempt_count exactly
--                 once, moves retry_scheduled -> processing and returns the new
--                 exact attempt identity plus the canonical workflow family. It
--                 never inspects or classifies a stale current attempt.
--
--   reconcile_v1  STALE-PROCESSING RECONCILIATION. Selects one stale CURRENT
--                 attempt and either finalizes it through the FROZEN completion
--                 authority using durable evidence, or deliberately withholds. It
--                 never creates an attempt and never blindly retries.
--
--   They are kept apart because their authority, replay identity, uniqueness and
--   legal state transitions genuinely differ. `recover_v1` is unique per RETRY
--   GENERATION (one recovery per job per attempt number, ever). `reconcile_v1` is
--   deliberately repeatable, because "examine this stale attempt and decide" must
--   remain askable again after a deferral. One shared route could not carry both
--   rules, and the resulting constraint would have to be weakened to the union of
--   the two — which is precisely how an auditable ledger stops being auditable.
--
-- claim_v1 IS COMPLETELY PRESERVED
--   Fresh `pending` work only. `retry_scheduled` stays excluded from it. Exactly
--   one claim_v1 row per job. This migration does not drop, recreate, relax or
--   even reference-modify `uq_automation_transport_requests_claim_job`, does not
--   reuse claim_v1 for a retry, and deletes no claim row. `complete_v1` and
--   `execute_v1` uniqueness are likewise untouched.
--
-- NO BLIND RECLAIM
--   `automation_jobs` has always carried the comment "A processing job is never
--   automatically reclaimed after a stale lock because external outcome may be
--   uncertain." That remains true. Reconciliation NEVER reclaims: it reads durable
--   evidence for the exact current attempt and, where the evidence is unresolved,
--   contradictory or owned by the communication lane, it changes nothing at all.
--
-- THE DEAD-LETTER BOUNDARY DOES NOT MOVE
--   `qf_complete_automation_attempt_v1` remains the single place where
--   `attempt_count >= max_attempts` becomes `dead_letter`. Reconciliation reaches
--   it by CALLING that function rather than reimplementing its state machine, so
--   there is exactly one dead-letter rule in the database.
--
-- NON-ACTIONS
--   No HTTP call, webhook, n8n workflow, provider/Meta call, communication send,
--   communication row write, consent decision, assignment/credit/package
--   mutation, historical migration edit, seed row, new table, new column, new
--   type, or change to `available_at` (which the job guard holds immutable).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Fail-closed dependency / drift preflight
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_name text;
  v_config text[];
begin
  if to_regclass('public.automation_transport_requests') is null
     or to_regclass('public.automation_jobs') is null
     or to_regclass('public.automation_execution_attempts') is null then
    raise exception
      'QF-MVP-50.5 aborted: the automation persistence/transport substrate is missing.';
  end if;

  -- Every authority this migration builds on must already exist by exact
  -- signature. A missing one means the lineage drifted; masking that would be
  -- worse than refusing to run.
  foreach v_name in array array[
    'public.qf_claim_automation_job_v1(text)',
    'public.qf_claim_automation_job_transport_v1(uuid,text,text)',
    'public.qf_claim_automation_job_for_family_v1(text,text)',
    'public.qf_claim_automation_job_transport_for_family_v1(uuid,text,text,text)',
    'public.qf_automation_action_workflow_family_v1(text)',
    'public.qf_complete_automation_attempt_v1(uuid,uuid,text,text,text,text,timestamptz)',
    'public.qf_complete_automation_attempt_transport_v1(uuid,text,text,uuid,uuid,text,text,text,timestamptz)',
    'public.qf_record_automation_execution_transport_v1(uuid,text,text,uuid,uuid)'
  ] loop
    if to_regprocedure(v_name) is null then
      raise exception
        'QF-MVP-50.5 aborted: required function % is missing.', v_name;
    end if;
  end loop;

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
        'QF-MVP-50.5 aborted: expected constraint % is absent; reconcile drift instead of masking it.',
        v_name;
    end if;
  end loop;

  -- All three existing route uniqueness rules must be present. They are preserved
  -- verbatim; this migration adds one more and drops none.
  foreach v_name in array array[
    'public.uq_automation_transport_requests_claim_job',
    'public.uq_automation_transport_requests_complete_attempt',
    'public.uq_automation_transport_requests_execute_attempt'
  ] loop
    if to_regclass(v_name) is null then
      raise exception 'QF-MVP-50.5 aborted: % is absent.', v_name;
    end if;
  end loop;

  if to_regclass('public.uq_automation_transport_requests_recover_generation') is not null then
    raise exception
      'QF-MVP-50.5 aborted: recovery uniqueness already exists; reconcile instead of masking drift.';
  end if;

  -- The wedge repair and the family fence must both still be in the claim body.
  -- Recovery is only safe on top of a claim that cannot re-select retry work.
  select p.proconfig into v_config
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qf_claim_automation_job_v1';
  if v_config is null
     or not ('search_path=pg_catalog, public, pg_temp' = any (v_config)) then
    raise exception
      'QF-MVP-50.5 aborted: the legacy claim search_path is not the pinned value.';
  end if;

  if exists (
    select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')
  ) then
    raise exception
      'QF-MVP-50.5 aborted: database network extension present; transport must remain application-layer only.';
  end if;
end;
$preflight$;

lock table public.automation_transport_requests in access exclusive mode;

-- ---------------------------------------------------------------------------
-- 1. Route vocabulary — closed, exactly five routes
-- ---------------------------------------------------------------------------
alter table public.automation_transport_requests
  drop constraint automation_transport_requests_route_check;

alter table public.automation_transport_requests
  add constraint automation_transport_requests_route_check
  check (route_key in (
    'claim_v1',
    'complete_v1',
    'execute_v1',
    'recover_v1',
    'reconcile_v1'
  ));

-- ---------------------------------------------------------------------------
-- 2. State vocabulary — closed; exactly two new terminal states
-- ---------------------------------------------------------------------------
alter table public.automation_transport_requests
  drop constraint automation_transport_requests_state_check;

alter table public.automation_transport_requests
  add constraint automation_transport_requests_state_check
  check (state in (
    'processing',
    'claimed',
    'empty',
    'completed',
    'recorded',
    'recovered',
    'reconciled'
  ));

-- ---------------------------------------------------------------------------
-- 3. Shape — every terminal state stays bound to its own route set
--
--    claim_v1     : processing -> claimed | empty        (unchanged semantics)
--    complete_v1  : processing -> completed             (unchanged semantics)
--    execute_v1   : processing -> recorded              (unchanged semantics)
--    recover_v1   : processing -> recovered | empty
--    reconcile_v1 : processing -> reconciled | empty
--
--    `empty` widens from claim-only to the three SELECTING routes, because
--    "Core looked and there was nothing eligible" is a real, identical outcome
--    for all three. It still carries NO identity columns, so an `empty` row can
--    never masquerade as work. `completed`, `recorded`, `claimed`, `recovered`
--    and `reconciled` each remain bound to exactly one route.
--
--    `recovered` and `reconciled` carry ONLY identity columns. This ledger has
--    never had an outcome column and this migration adds none: a reconciliation
--    verdict lives in the attempt/job rows, which is why every replay re-reads
--    Core truth instead of trusting a stored answer.
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
      and route_key in ('claim_v1', 'recover_v1', 'reconcile_v1')
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
    or (
      state = 'recovered'
      and route_key = 'recover_v1'
      and job_id is not null
      and action_request_id is not null
      and attempt_id is not null
      and attempt_number is not null
      and max_attempts is not null
      and finalized_at is not null
    )
    or (
      state = 'reconciled'
      and route_key = 'reconcile_v1'
      and job_id is not null
      and action_request_id is not null
      and attempt_id is not null
      and attempt_number is not null
      and max_attempts is not null
      and finalized_at is not null
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Route-scoped uniqueness — ONE recovery per retry generation
--
--    A job legally recovers many times across its retry budget, so neither the
--    claim_v1 one-row-per-JOB rule nor the complete/execute one-row-per-ATTEMPT
--    rule is the right shape: at the moment recovery decides, the attempt it will
--    create does not exist yet. The natural identity is the RETRY GENERATION —
--    (job, the attempt number this recovery is opening).
--
--    Because `attempt_count` only ever increases, and because a job must pass
--    through `processing` and back to `retry_scheduled` before it is recoverable
--    again, each generation is reachable exactly once. The rule is therefore
--    exact and can never wedge the queue the way an unreachable claim_v1
--    reservation once did: the recovery selector additionally SKIPS any job whose
--    next generation already holds a recover row, so SQLSTATE 23505 is
--    unreachable rather than merely unlikely.
--
--    reconcile_v1 deliberately gets NO uniqueness index. A deferral must remain
--    re-examinable later, and double-application is already impossible: an
--    attempt may go `started -> completed` exactly once, enforced by
--    qf_guard_automation_attempt_update. The database, not an index, is the
--    serialization point.
-- ---------------------------------------------------------------------------
create unique index uq_automation_transport_requests_recover_generation
  on public.automation_transport_requests(job_id, attempt_number)
  where route_key = 'recover_v1'
    and job_id is not null
    and attempt_number is not null;

-- ---------------------------------------------------------------------------
-- 5. Insert guard — still pristine-only, now for exactly five routes
-- ---------------------------------------------------------------------------
create or replace function public.qf_guard_automation_transport_request_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.transport_version <> 1
     or new.direction <> 'n8n_to_core'
     or new.route_key not in (
       'claim_v1', 'complete_v1', 'execute_v1', 'recover_v1', 'reconcile_v1'
     )
     or new.state <> 'processing'
     or new.job_id is not null
     or new.action_request_id is not null
     or new.attempt_id is not null
     or new.attempt_number is not null
     or new.max_attempts is not null
     or new.finalized_at is not null then
    raise exception
      'QF-MVP-50.5: transport requests must be inserted as pristine n8n_to_core claim_v1/complete_v1/execute_v1/recover_v1/reconcile_v1 processing rows.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Update guard — finalization stays route-bound, history stays immutable
-- ---------------------------------------------------------------------------
create or replace function public.qf_guard_automation_transport_request_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.state <> 'processing' then
    raise exception
      'QF-MVP-50.5: finalized transport request history is immutable.'
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
      'QF-MVP-50.5: transport request identity/evidence is immutable.'
      using errcode = 'check_violation';
  end if;

  if old.route_key = 'claim_v1' and new.state not in ('claimed', 'empty') then
    raise exception
      'QF-MVP-50.5: a claim_v1 request may finalize only to claimed or empty.'
      using errcode = 'check_violation';
  end if;

  if old.route_key = 'complete_v1' and new.state <> 'completed' then
    raise exception
      'QF-MVP-50.5: a complete_v1 request may finalize only to completed.'
      using errcode = 'check_violation';
  end if;

  if old.route_key = 'execute_v1' and new.state <> 'recorded' then
    raise exception
      'QF-MVP-50.5: an execute_v1 request may finalize only to recorded.'
      using errcode = 'check_violation';
  end if;

  if old.route_key = 'recover_v1' and new.state not in ('recovered', 'empty') then
    raise exception
      'QF-MVP-50.5: a recover_v1 request may finalize only to recovered or empty.'
      using errcode = 'check_violation';
  end if;

  if old.route_key = 'reconcile_v1' and new.state not in ('reconciled', 'empty') then
    raise exception
      'QF-MVP-50.5: a reconcile_v1 request may finalize only to reconciled or empty.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. DUE-RETRY RECOVERY — the only function that may open a retry attempt
--
--    Structurally identical to the frozen claim, one state earlier in the
--    lifecycle: it selects `retry_scheduled` work that is genuinely due instead
--    of fresh `pending` work. `retry_scheduled -> processing` is an EXISTING legal
--    transition in qf_guard_automation_job_update, so nothing about the state
--    machine is widened here.
--
--    DELIBERATELY ABSENT: no `processing -> pending`, no release, no unclaim, no
--    claim-row deletion, no `available_at` mutation, no retry-timestamp
--    invention, no dead-letter decision, no communication read or write, no
--    provider call.
-- ---------------------------------------------------------------------------
create or replace function public.qf_recover_automation_job_v1(p_worker_id text)
returns table (
  job_id uuid,
  action_request_id uuid,
  attempt_id uuid,
  attempt_number integer,
  max_attempts integer,
  workflow_family text
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.automation_jobs%rowtype;
  v_attempt public.automation_execution_attempts%rowtype;
  v_family text;
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
        -- THE DUE-RETRY SELECTOR. Only `retry_scheduled` work whose Core-computed
        -- retry instant has arrived. `pending` is NOT selected here: fresh work
        -- belongs to claim_v1 and the two lanes never share a selector, so
        -- neither class can starve the other.
        and j.status = 'retry_scheduled'
        and j.next_retry_at is not null
        and j.next_retry_at <= now()
        -- The family must be derivable from durable action truth. A job whose
        -- action has no canonical family is INVISIBLE here rather than an error,
        -- so a future unmapped action can never wedge the recovery lane.
        and exists (
          select 1
            from public.automation_action_requests r
           where r.id = j.action_request_id
             and public.qf_automation_action_workflow_family_v1(r.action_type)
                 is not null
        )
        -- WEDGE PROOF. The generation this recovery would open must not already
        -- hold a recover_v1 reservation. Unreachable in a consistent database,
        -- and asserted here so SQLSTATE 23505 can never re-select a permanently
        -- unrecoverable job ahead of every other one — the exact failure the
        -- QF-MVP-50.2 fresh-claim wedge repair exists to prevent.
        and not exists (
          select 1
            from public.automation_transport_requests t
           where t.route_key = 'recover_v1'
             and t.job_id = j.id
             and t.attempt_number = j.attempt_count + 1
        )
      -- Due order within the retry lane. Ordering by the retry instant keeps a
      -- repeatedly-failing job from outranking others forever: each failure moves
      -- its next_retry_at further into the future through the frozen backoff.
      order by j.next_retry_at asc,
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

  select public.qf_automation_action_workflow_family_v1(r.action_type)
    into v_family
    from public.automation_action_requests r
   where r.id = v_job.action_request_id;

  -- Defensive: the selector already excluded an unmapped family, and the action
  -- vocabulary is DB-constrained to the frozen 14. Fail closed rather than hand
  -- an orchestrator a null family it might treat as "any".
  if v_family is null then
    raise exception 'AUTOMATION_RECOVERY_WORKFLOW_FAMILY_UNRESOLVED'
      using errcode = 'P0001';
  end if;

  return query
  select
    v_job.id,
    v_job.action_request_id,
    v_attempt.id,
    v_attempt.attempt_number,
    v_job.max_attempts,
    v_family;
end;
$$;

comment on function public.qf_recover_automation_job_v1(text) is
  'QF-MVP-50.5 due-retry recovery. Selects ONE eligible due retry_scheduled job, creates the NEXT attempt, increments attempt_count exactly once and returns the new exact attempt identity plus the canonical workflow family. Separate lane from claim_v1 fresh work; never releases a claim, never mutates available_at, never decides dead-letter and never classifies a stale attempt.';

revoke all on function public.qf_recover_automation_job_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_recover_automation_job_v1(text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 8. Signed recovery transport wrapper — one-shot, route identity recover_v1
-- ---------------------------------------------------------------------------
create or replace function public.qf_recover_automation_job_transport_v1(
  p_request_id uuid,
  p_worker_id text,
  p_body_sha256 text
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
  workflow_family text
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.automation_transport_requests%rowtype;
  v_recovery record;
  v_family text;
  v_inserted boolean := false;
begin
  if p_request_id is null then
    raise exception 'AUTOMATION_TRANSPORT_REQUEST_ID_REQUIRED'
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
    'recover_v1',
    p_worker_id,
    p_body_sha256
  )
  on conflict (id) do nothing
  returning * into v_request;

  v_inserted := v_request.id is not null;

  if not v_inserted then
    select * into v_request
      from public.automation_transport_requests
     where id = p_request_id
     for update;

    if v_request.id is null then
      raise exception 'AUTOMATION_TRANSPORT_REPLAY_STATE_MISSING'
        using errcode = 'P0001';
    end if;

    if v_request.transport_version <> 1
       or v_request.direction <> 'n8n_to_core'
       or v_request.route_key <> 'recover_v1'
       or v_request.worker_id is distinct from p_worker_id
       or v_request.body_sha256 is distinct from p_body_sha256 then
      raise exception 'AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT'
        using errcode = 'P0001';
    end if;

    if v_request.state = 'processing' then
      raise exception 'AUTOMATION_TRANSPORT_REQUEST_INCOMPLETE_INVARIANT'
        using errcode = 'P0001';
    end if;

    -- A replay re-reads the family from durable action truth rather than storing
    -- and echoing it, so the answer can never disagree with the ledger.
    if v_request.action_request_id is not null then
      select public.qf_automation_action_workflow_family_v1(r.action_type)
        into v_family
        from public.automation_action_requests r
       where r.id = v_request.action_request_id;
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
      v_family;
    return;
  end if;

  -- First and only execution opportunity for this signed request identity.
  select * into v_recovery
    from public.qf_recover_automation_job_v1(p_worker_id);

  if v_recovery.job_id is null then
    update public.automation_transport_requests
       set state = 'empty',
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
      null::text;
    return;
  end if;

  update public.automation_transport_requests
     set state = 'recovered',
         job_id = v_recovery.job_id,
         action_request_id = v_recovery.action_request_id,
         attempt_id = v_recovery.attempt_id,
         attempt_number = v_recovery.attempt_number,
         max_attempts = v_recovery.max_attempts,
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
    v_recovery.workflow_family;
end;
$$;

comment on function public.qf_recover_automation_job_transport_v1(uuid, text, text) is
  'QF-MVP-50.5 one-shot signed due-retry recovery, route identity recover_v1, unique per retry generation. A duplicate request UUID returns is_replay=true and MUST NOT become an executable envelope. The workflow family is always re-read from durable action truth, never echoed from storage.';

revoke all on function public.qf_recover_automation_job_transport_v1(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_recover_automation_job_transport_v1(uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 9. STALE CANDIDATE SELECTION — read-only, Core-selected, never n8n-selected
--
--    Returns at most ONE stale current attempt together with the durable facts a
--    reconciliation decision needs: the canonical family, the action type, and
--    whether an `execute_v1` reservation exists for this exact attempt and how
--    old it is.
--
--    It deliberately does NOT read `communication_messages`. The automation
--    idempotency key `qf_auto_v1:{jobId}:{attemptId}` is derived in exactly one
--    place in the repository (lib/automation/clientDispatchRegistry.ts) and
--    re-deriving its format in SQL would create a silent drift surface. Core
--    reads the communication row itself, through that single derivation.
--
--    THE THRESHOLD IS A PARAMETER, NOT A CONSTANT HERE. Its value is owned by
--    lib/automation/recoveryContract.ts, derived there from the real transport
--    HTTP timeout, the provider ceiling, the signed-request window and the
--    already-reviewed recovery safety margin. SQL bounds it to a closed sane
--    range so a caller can never pass 0 (which would reconcile live work) or an
--    absurd value.
-- ---------------------------------------------------------------------------
create or replace function public.qf_select_stale_automation_attempt_v1(
  p_stale_after_seconds integer
)
returns table (
  job_id uuid,
  action_request_id uuid,
  attempt_id uuid,
  attempt_number integer,
  max_attempts integer,
  attempt_count integer,
  workflow_family text,
  action_type text,
  locked_by text,
  locked_at timestamptz,
  execute_request_id uuid,
  execute_reserved_at timestamptz,
  execute_reservation_stale boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_cutoff timestamptz;
begin
  if p_stale_after_seconds is null
     or p_stale_after_seconds < 300
     or p_stale_after_seconds > 86400 then
    raise exception 'AUTOMATION_STALE_THRESHOLD_INVALID' using errcode = 'P0001';
  end if;

  v_cutoff := now() - make_interval(secs => p_stale_after_seconds);

  return query
  select
    j.id,
    j.action_request_id,
    a.id,
    a.attempt_number,
    j.max_attempts,
    j.attempt_count,
    public.qf_automation_action_workflow_family_v1(r.action_type),
    r.action_type,
    j.locked_by,
    j.locked_at,
    t.id,
    t.finalized_at,
    (t.id is not null and t.finalized_at is not null and t.finalized_at <= v_cutoff)
    from public.automation_jobs j
    join public.automation_action_requests r on r.id = j.action_request_id
    join public.automation_execution_attempts a
      on a.job_id = j.id
     -- THE CURRENT attempt only. A superseded attempt is never a reconciliation
     -- candidate: finalizing one would contradict the job's own attempt_count.
     and a.attempt_number = j.attempt_count
    left join public.automation_transport_requests t
      on t.route_key = 'execute_v1'
     and t.job_id = j.id
     and t.attempt_id = a.id
   where j.status = 'processing'
     and j.locked_at is not null
     and j.locked_at <= v_cutoff
     and j.locked_by is not null
     -- An attempt still open. A completed current attempt beside a `processing`
     -- job is a torn state, not a candidate: it is reported as an anomaly by the
     -- caller rather than silently repaired here.
     and a.status = 'started'
     and a.worker_id = j.locked_by
   order by j.locked_at asc, j.created_at asc
   limit 1;
end;
$$;

comment on function public.qf_select_stale_automation_attempt_v1(integer) is
  'QF-MVP-50.5 read-only stale current-attempt selection. Core selects the candidate; n8n never does. Returns the canonical family, the action type and the execute_v1 reservation age for the exact current attempt. Reads no communication row: the automation idempotency key has exactly one derivation, in TypeScript.';

revoke all on function public.qf_select_stale_automation_attempt_v1(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_select_stale_automation_attempt_v1(integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 10. SIGNED RECONCILIATION — applies a Core ruling, or deliberately nothing
--
--     THE RULING IS CORE'S, THE AUTHORITY IS THIS FUNCTION'S. The classification
--     and safe code are derived by Core from the SAME closed communication tables
--     that QF-MVP-50.2D and 50.2E already use, so there is exactly one
--     communication-status vocabulary in the system. What this function owns is
--     the part that must be atomic and provable: that the candidate really is
--     stale, really is the current attempt, and is finalized exactly once through
--     the FROZEN completion authority.
--
--     WHY IT DELEGATES TO qf_complete_automation_attempt_v1
--     Reimplementing attempt completion would fork the dead-letter rule, the
--     retry-shape constraints and the terminal-state mapping. Instead it calls
--     the frozen function with the ORIGINAL owner's worker id — which is truthful:
--     that worker did start the attempt, and the attempt row keeps its worker_id
--     unchanged. WHO reconciled is recorded separately and durably, as the
--     worker_id of this reconcile_v1 transport row.
--
--     `defer` mutates NOTHING. It exists so that "we looked, and the correct
--     action was to leave it alone" is a first-class, durable, auditable outcome
--     rather than an absence of evidence.
-- ---------------------------------------------------------------------------
create or replace function public.qf_reconcile_automation_attempt_transport_v1(
  p_request_id uuid,
  p_worker_id text,
  p_body_sha256 text,
  p_disposition text,
  p_stale_after_seconds integer,
  p_job_id uuid default null,
  p_attempt_id uuid default null,
  p_classification text default null,
  p_safe_code text default null,
  p_executor_reference text default null,
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
  safe_code text
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.automation_transport_requests%rowtype;
  v_job public.automation_jobs%rowtype;
  v_attempt public.automation_execution_attempts%rowtype;
  v_cutoff timestamptz;
  v_inserted boolean := false;
begin
  if p_request_id is null then
    raise exception 'AUTOMATION_TRANSPORT_REQUEST_ID_REQUIRED'
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

  if p_disposition is null
     or p_disposition not in ('finalize', 'defer', 'empty') then
    raise exception 'AUTOMATION_RECONCILE_DISPOSITION_INVALID'
      using errcode = 'P0001';
  end if;

  if p_stale_after_seconds is null
     or p_stale_after_seconds < 300
     or p_stale_after_seconds > 86400 then
    raise exception 'AUTOMATION_STALE_THRESHOLD_INVALID' using errcode = 'P0001';
  end if;

  -- The disposition fully determines which arguments are legal. A caller cannot
  -- ask to defer while smuggling a classification, or claim emptiness while
  -- naming a job.
  if p_disposition = 'empty' then
    if p_job_id is not null
       or p_attempt_id is not null
       or p_classification is not null
       or p_safe_code is not null
       or p_executor_reference is not null
       or p_next_retry_at is not null then
      raise exception 'AUTOMATION_RECONCILE_EMPTY_ARGUMENTS_INVALID'
        using errcode = 'P0001';
    end if;
  else
    if p_job_id is null or p_attempt_id is null then
      raise exception 'AUTOMATION_RECONCILE_IDENTITY_REQUIRED'
        using errcode = 'P0001';
    end if;

    if p_disposition = 'defer' then
      if p_classification is not null
         or p_safe_code is not null
         or p_executor_reference is not null
         or p_next_retry_at is not null then
        raise exception 'AUTOMATION_RECONCILE_DEFER_ARGUMENTS_INVALID'
          using errcode = 'P0001';
      end if;
    else
      if p_classification is null or p_safe_code is null then
        raise exception 'AUTOMATION_RECONCILE_RULING_REQUIRED'
          using errcode = 'P0001';
      end if;
      -- Only a retryable failure may carry a retry instant, and Core computes it
      -- from the single frozen backoff schedule. Everything else is terminal.
      if p_classification <> 'retryable_failure' and p_next_retry_at is not null then
        raise exception 'AUTOMATION_TERMINAL_RESULT_NEXT_RETRY_FORBIDDEN'
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  insert into public.automation_transport_requests (
    id,
    route_key,
    worker_id,
    body_sha256
  ) values (
    p_request_id,
    'reconcile_v1',
    p_worker_id,
    p_body_sha256
  )
  on conflict (id) do nothing
  returning * into v_request;

  v_inserted := v_request.id is not null;

  if not v_inserted then
    select * into v_request
      from public.automation_transport_requests
     where id = p_request_id
     for update;

    if v_request.id is null then
      raise exception 'AUTOMATION_TRANSPORT_REPLAY_STATE_MISSING'
        using errcode = 'P0001';
    end if;

    if v_request.transport_version <> 1
       or v_request.direction <> 'n8n_to_core'
       or v_request.route_key <> 'reconcile_v1'
       or v_request.worker_id is distinct from p_worker_id
       or v_request.body_sha256 is distinct from p_body_sha256 then
      raise exception 'AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT'
        using errcode = 'P0001';
    end if;

    if v_request.state = 'processing' then
      raise exception 'AUTOMATION_TRANSPORT_REQUEST_INCOMPLETE_INVARIANT'
        using errcode = 'P0001';
    end if;

    -- REPLAY RE-READS TRUTH. The ledger stores no reconciliation verdict, so the
    -- answer is rebuilt from the live job and attempt rows. A replay therefore
    -- cannot disagree with what actually happened, and a deferral that has since
    -- been finalized by a later examination reports the finalized truth.
    if v_request.job_id is not null then
      select * into v_job from public.automation_jobs where id = v_request.job_id;
      select * into v_attempt
        from public.automation_execution_attempts
       where id = v_request.attempt_id;
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
      v_attempt.safe_code;
    return;
  end if;

  if p_disposition = 'empty' then
    -- "Core looked and found no eligible stale candidate." This is a statement
    -- about a specific instant, bounded by this row's own created_at and
    -- finalized_at, and it mutates nothing. Re-verifying it a moment later could
    -- neither confirm nor refute it, so no re-verification is performed or
    -- implied.
    update public.automation_transport_requests
       set state = 'empty',
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
      null::text,
      null::text,
      null::text,
      null::text;
    return;
  end if;

  v_cutoff := now() - make_interval(secs => p_stale_after_seconds);

  select * into v_job
    from public.automation_jobs
   where id = p_job_id
   for update;

  if v_job.id is null then
    raise exception 'AUTOMATION_RECONCILE_JOB_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_attempt
    from public.automation_execution_attempts
   where id = p_attempt_id
   for update;

  if v_attempt.id is null
     or v_attempt.job_id <> v_job.id
     or v_attempt.attempt_number <> v_job.attempt_count then
    raise exception 'AUTOMATION_RECONCILE_ATTEMPT_NOT_CURRENT'
      using errcode = 'P0001';
  end if;

  -- STALENESS IS RE-PROVEN HERE, under the row lock. Core's read happened in an
  -- earlier transaction; only this proof can be trusted, and it is what stops a
  -- reconciliation from ever touching an attempt that is still live.
  if v_job.status <> 'processing'
     or v_job.locked_at is null
     or v_job.locked_by is null
     or v_job.locked_at > v_cutoff
     or v_attempt.status <> 'started'
     or v_attempt.worker_id is distinct from v_job.locked_by then
    raise exception 'AUTOMATION_RECONCILE_CANDIDATE_NOT_STALE'
      using errcode = 'P0001';
  end if;

  if p_disposition = 'finalize' then
    -- The frozen completion authority, called with the ORIGINAL owner identity.
    -- Every terminal-state rule, retry-shape constraint and the single
    -- dead-letter boundary therefore stay in exactly one place.
    perform public.qf_complete_automation_attempt_v1(
      v_job.id,
      v_attempt.id,
      v_job.locked_by,
      p_classification,
      p_safe_code,
      p_executor_reference,
      p_next_retry_at
    );

    select * into v_job
      from public.automation_jobs where id = v_job.id;
    select * into v_attempt
      from public.automation_execution_attempts where id = v_attempt.id;
  end if;

  update public.automation_transport_requests
     set state = 'reconciled',
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
    v_attempt.safe_code;
end;
$$;

comment on function public.qf_reconcile_automation_attempt_transport_v1(
  uuid, text, text, text, integer, uuid, uuid, text, text, text, timestamptz
) is
  'QF-MVP-50.5 one-shot signed stale-attempt reconciliation, route identity reconcile_v1. Re-proves staleness and current-attempt currency under lock, then either finalizes through the frozen qf_complete_automation_attempt_v1 (so the dead-letter boundary never forks) or records a deliberate no-op deferral that mutates nothing. Deliberately repeatable across examinations; double finalization is impossible because an attempt may go started -> completed only once. Every replay re-reads live job/attempt truth instead of a stored verdict.';

comment on column public.automation_transport_requests.route_key is
  'QF-MVP-50.5 closed transport route vocabulary: claim_v1 (claimed/empty), complete_v1 (completed), execute_v1 (recorded), recover_v1 (recovered/empty) or reconcile_v1 (reconciled/empty). No other route is authorized.';

revoke all on function public.qf_reconcile_automation_attempt_transport_v1(
  uuid, text, text, text, integer, uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.qf_reconcile_automation_attempt_transport_v1(
  uuid, text, text, text, integer, uuid, uuid, text, text, text, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- 11. Self-verification
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_count integer;
  v_def text;
  v_oid oid;
  v_sig text;
  v_recover_sig text :=
    'public.qf_recover_automation_job_transport_v1(uuid,text,text)';
  v_reconcile_sig text :=
    'public.qf_reconcile_automation_attempt_transport_v1(uuid,text,text,text,integer,uuid,uuid,text,text,text,timestamptz)';
begin
  -- 11.1 every earlier route authority survived untouched.
  foreach v_sig in array array[
    'public.qf_claim_automation_job_transport_v1(uuid,text,text)',
    'public.qf_claim_automation_job_transport_for_family_v1(uuid,text,text,text)',
    'public.qf_complete_automation_attempt_transport_v1(uuid,text,text,uuid,uuid,text,text,text,timestamptz)',
    'public.qf_record_automation_execution_transport_v1(uuid,text,text,uuid,uuid)',
    'public.qf_complete_automation_attempt_v1(uuid,uuid,text,text,text,text,timestamptz)'
  ] loop
    if to_regprocedure(v_sig) is null then
      raise exception 'QF-MVP-50.5 aborted: % disappeared.', v_sig;
    end if;
  end loop;

  -- 11.2 all three earlier uniqueness rules preserved, one new one added.
  foreach v_sig in array array[
    'public.uq_automation_transport_requests_claim_job',
    'public.uq_automation_transport_requests_complete_attempt',
    'public.uq_automation_transport_requests_execute_attempt',
    'public.uq_automation_transport_requests_recover_generation'
  ] loop
    if to_regclass(v_sig) is null then
      raise exception 'QF-MVP-50.5 aborted: % is missing.', v_sig;
    end if;
  end loop;

  -- 11.3 reconcile_v1 has NO uniqueness index. This is a decision, not an
  --      omission: examinations must remain repeatable. If a future migration
  --      adds one, that decision must be re-made explicitly rather than inherited.
  if exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'automation_transport_requests'
       and indexdef like '%reconcile_v1%'
  ) then
    raise exception
      'QF-MVP-50.5 aborted: a reconcile_v1 uniqueness index exists; deferral must stay re-examinable.';
  end if;

  -- 11.4 the recovery index is exactly the retry-generation rule.
  select indexdef into v_def from pg_indexes
   where schemaname = 'public'
     and indexname = 'uq_automation_transport_requests_recover_generation';
  if v_def is null
     or v_def !~ 'UNIQUE'
     or v_def !~ '\(job_id, attempt_number\)'
     or v_def !~ 'recover_v1' then
    raise exception
      'QF-MVP-50.5 aborted: the recovery uniqueness rule is not the retry-generation rule.';
  end if;

  -- 11.5 the four transport lifecycle triggers are still bound.
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
      'QF-MVP-50.5 aborted: expected 4 transport lifecycle triggers, found %.', v_count;
  end if;

  -- 11.6 the three replaced fences exist and are validated.
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
      'QF-MVP-50.5 aborted: expected 3 validated route/state/shape fences, found %.', v_count;
  end if;

  -- 11.7 the ledger still carries NO outcome column. The identity-only promise of
  --      execute_v1 is inherited by recover_v1 and reconcile_v1.
  if exists (
    select 1
      from pg_catalog.pg_attribute a
     where a.attrelid = to_regclass('public.automation_transport_requests')
       and a.attnum > 0
       and not a.attisdropped
       and a.attname in (
         'classification', 'safe_code', 'executor_reference',
         'communication_status', 'communication_message_id',
         'provider_message_id', 'disposition', 'stale_after_seconds'
       )
  ) then
    raise exception
      'QF-MVP-50.5 aborted: transport ledger carries an outcome column; recovery must remain identity-only.';
  end if;

  -- 11.8 the frozen claim semantics are UNCHANGED: fresh pending only, no
  --      retry_scheduled selector, still client-fenced.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qf_claim_automation_job_v1';
  if v_def !~ 'j\.status = ''pending'''
     or v_def ~ 'j\.status = ''retry_scheduled'''
     or v_def !~ '''client_whatsapp'''
     or v_def !~ 'for update skip locked' then
    raise exception
      'QF-MVP-50.5 aborted: the frozen fresh-claim semantics changed.';
  end if;

  -- 11.9 recovery is a SEPARATE lane: it selects retry_scheduled and never
  --      unions in pending work, so neither class can starve the other.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qf_recover_automation_job_v1';
  if v_def !~ 'j\.status = ''retry_scheduled'''
     or v_def ~ 'j\.status in \(''pending'''
     or v_def ~ 'j\.status = ''pending''' then
    raise exception
      'QF-MVP-50.5 aborted: the recovery selector must be retry_scheduled only.';
  end if;
  if v_def !~ 'for update skip locked'
     or v_def !~ 'j\.attempt_count < j\.max_attempts'
     or v_def !~ 'j\.next_retry_at <= now\(\)' then
    raise exception
      'QF-MVP-50.5 aborted: a required recovery selector invariant is missing.';
  end if;
  -- available_at is immutable under qf_guard_automation_job_update and recovery
  -- must never attempt to move it.
  if v_def ~ 'available_at\s*=' then
    raise exception
      'QF-MVP-50.5 aborted: recovery must never mutate available_at.';
  end if;
  if v_def ~ 'delete from' then
    raise exception
      'QF-MVP-50.5 aborted: recovery must delete no evidence.';
  end if;

  -- 11.10 reconciliation delegates finalization and invents no state machine.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'qf_reconcile_automation_attempt_transport_v1';
  if v_def !~ 'qf_complete_automation_attempt_v1' then
    raise exception
      'QF-MVP-50.5 aborted: reconciliation must finalize through the frozen completion authority.';
  end if;
  if v_def ~ 'dead_letter' then
    raise exception
      'QF-MVP-50.5 aborted: the dead-letter boundary must stay inside qf_complete_automation_attempt_v1.';
  end if;
  if v_def !~ 'AUTOMATION_RECONCILE_CANDIDATE_NOT_STALE' then
    raise exception
      'QF-MVP-50.5 aborted: reconciliation must re-prove staleness under lock.';
  end if;
  if v_def ~ 'delete from' or v_def ~ 'insert into public\.communication_messages' then
    raise exception
      'QF-MVP-50.5 aborted: reconciliation must not delete evidence or write communication rows.';
  end if;

  -- 11.11 both new transport RPCs are SECURITY DEFINER, search_path pinned and
  --       service_role only. The read-only selector too.
  foreach v_sig in array array[
    'public.qf_recover_automation_job_v1(text)',
    'public.qf_select_stale_automation_attempt_v1(integer)',
    'public.qf_recover_automation_job_transport_v1(uuid,text,text)',
    'public.qf_reconcile_automation_attempt_transport_v1(uuid,text,text,text,integer,uuid,uuid,text,text,text,timestamptz)'
  ] loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then
      raise exception 'QF-MVP-50.5 aborted: % is missing.', v_sig;
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = v_oid) then
      raise exception 'QF-MVP-50.5 aborted: % is not SECURITY DEFINER.', v_sig;
    end if;
    if not (
      select array_to_string(coalesce(p.proconfig, array[]::text[]), ',')
               like '%search_path=pg_catalog, public, pg_temp%'
        from pg_proc p where p.oid = v_oid
    ) then
      raise exception 'QF-MVP-50.5 aborted: % lacks the pinned search_path.', v_sig;
    end if;
    if has_function_privilege('anon', v_oid, 'execute')
       or has_function_privilege('authenticated', v_oid, 'execute') then
      raise exception 'QF-MVP-50.5 aborted: % granted beyond service_role.', v_sig;
    end if;
    if not has_function_privilege('service_role', v_oid, 'execute') then
      raise exception 'QF-MVP-50.5 aborted: service_role lost execute on %.', v_sig;
    end if;
  end loop;

  -- 11.12 the threshold bound is enforced, not advisory.
  begin
    perform * from public.qf_select_stale_automation_attempt_v1(0);
    raise exception 'QF-MVP-50.5 aborted: a zero staleness threshold was accepted.';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'AUTOMATION_STALE_THRESHOLD_INVALID' then raise; end if;
  end;
  begin
    perform * from public.qf_select_stale_automation_attempt_v1(null);
    raise exception 'QF-MVP-50.5 aborted: a null staleness threshold was accepted.';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'AUTOMATION_STALE_THRESHOLD_INVALID' then raise; end if;
  end;

  -- 11.12a THE OUT-PARAMETER AMBIGUITY CLASS IS EXERCISED, NOT ASSUMED.
  --       Every output column of these functions is an OUT parameter that stays in
  --       scope over the body, which is exactly what produced SQLSTATE 42702 in the
  --       defect QF-MVP-50.2 had to repair by migration 20260807000000. The fix
  --       there — and here — is explicit table-alias qualification, never
  --       `#variable_conflict`. A regex over the source could not prove it, so the
  --       real query is RUN instead: an unqualified reference would raise 42702 and
  --       abort this migration.
  perform * from public.qf_select_stale_automation_attempt_v1(900);

  -- The reconcile body past its insert is exercised the same way. The unknown job
  -- makes it fail closed, and because the call sits inside this exception block the
  -- transport row it inserted is rolled back with it — proven by 11.14 below.
  begin
    perform public.qf_reconcile_automation_attempt_transport_v1(
      '00000000-0000-4000-8000-00000050050a'::uuid,
      'qf-verify-worker',
      repeat('a', 64),
      'defer',
      900,
      '00000000-0000-4000-8000-00000050050b'::uuid,
      '00000000-0000-4000-8000-00000050050c'::uuid
    );
    raise exception
      'QF-MVP-50.5 aborted: reconciliation accepted an unknown job.';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'AUTOMATION_RECONCILE_JOB_NOT_FOUND' then raise; end if;
  end;

  -- A disposition outside the closed set is refused BEFORE any row is written.
  begin
    perform public.qf_reconcile_automation_attempt_transport_v1(
      '00000000-0000-4000-8000-00000050050d'::uuid,
      'qf-verify-worker',
      repeat('a', 64),
      'retry_everything',
      900
    );
    raise exception
      'QF-MVP-50.5 aborted: an unknown reconcile disposition was accepted.';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'AUTOMATION_RECONCILE_DISPOSITION_INVALID' then raise; end if;
  end;

  -- `empty` may never name a job, and `defer` may never carry a ruling.
  begin
    perform public.qf_reconcile_automation_attempt_transport_v1(
      '00000000-0000-4000-8000-00000050050e'::uuid,
      'qf-verify-worker',
      repeat('a', 64),
      'empty',
      900,
      '00000000-0000-4000-8000-00000050050b'::uuid
    );
    raise exception
      'QF-MVP-50.5 aborted: an empty reconcile claim named a job.';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'AUTOMATION_RECONCILE_EMPTY_ARGUMENTS_INVALID' then raise; end if;
  end;
  begin
    perform public.qf_reconcile_automation_attempt_transport_v1(
      '00000000-0000-4000-8000-00000050050f'::uuid,
      'qf-verify-worker',
      repeat('a', 64),
      'defer',
      900,
      '00000000-0000-4000-8000-00000050050b'::uuid,
      '00000000-0000-4000-8000-00000050050c'::uuid,
      'success',
      'QF_FAKE'
    );
    raise exception
      'QF-MVP-50.5 aborted: a deferral carried a ruling.';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'AUTOMATION_RECONCILE_DEFER_ARGUMENTS_INVALID' then raise; end if;
  end;

  -- 11.13 the RLS and table ACL posture is exactly as QF-MVP-50.1C left it.
  if not (
    select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'automation_transport_requests'
       and c.relkind = 'r'
  ) then
    raise exception 'QF-MVP-50.5 aborted: RLS missing.';
  end if;
  if not has_table_privilege('service_role', 'public.automation_transport_requests', 'select')
     or has_table_privilege('service_role', 'public.automation_transport_requests', 'insert')
     or has_table_privilege('service_role', 'public.automation_transport_requests', 'update')
     or has_table_privilege('service_role', 'public.automation_transport_requests', 'delete')
     or has_table_privilege('anon', 'public.automation_transport_requests', 'select')
     or has_table_privilege('authenticated', 'public.automation_transport_requests', 'select') then
    raise exception 'QF-MVP-50.5 aborted: transport table ACL invalid.';
  end if;

  -- 11.14 no seed row for either new route, and no network extension appeared.
  select count(*) into v_count from public.automation_transport_requests
   where route_key in ('recover_v1', 'reconcile_v1');
  if v_count <> 0 then
    raise exception
      'QF-MVP-50.5 aborted: recovery ledger unexpectedly seeded (% rows).', v_count;
  end if;
  if exists (
    select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')
  ) then
    raise exception 'QF-MVP-50.5 aborted: database network extension appeared.';
  end if;

  -- 11.15 THE JOB STATE MACHINE IS UNCHANGED. Recovery is a runtime capability,
  --       never a data fix and never a widened transition: `retry_scheduled ->
  --       processing` was already legal, `available_at` is still immutable, and
  --       terminal jobs are still frozen. This migration performs no DML on
  --       automation_jobs at all.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qf_guard_automation_job_update';
  if v_def is null
     or v_def !~ 'old\.status = ''retry_scheduled'' and new\.status in \(''processing'''
     or v_def !~ 'new\.available_at is distinct from old\.available_at'
     or v_def !~ 'terminal automation jobs are immutable' then
    raise exception
      'QF-MVP-50.5 aborted: the frozen automation-job transition guard changed.';
  end if;

  -- 11.16 no trigger or rule was added to the job or attempt ledgers.
  select count(*) into v_count
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('automation_jobs', 'automation_execution_attempts')
     and not t.tgisinternal;
  if v_count <> 8 then
    raise exception
      'QF-MVP-50.5 aborted: expected 8 job/attempt lifecycle triggers, found %.', v_count;
  end if;
end;
$verify$;

commit;
