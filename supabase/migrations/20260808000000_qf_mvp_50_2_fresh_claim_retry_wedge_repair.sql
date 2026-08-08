-- ============================================================================
-- QF-MVP-50.2 — fresh-claim retry queue wedge repair
--
-- SUCCESSOR MIGRATION. The historical migrations that defined and hardened
-- public.qf_claim_automation_job_v1 (20260801110000) and the signed transport
-- claim wrapper (20260801152049) are APPLIED and are NEVER edited here.
--
-- THE WEDGE (reproduced live on QuickFurno staging)
-- -------------------------------------------------
-- Three individually-correct designs combine into a permanent starvation:
--
--   1. A client execution whose provider is not configured is finalized
--      `retryable_failure` and the job moves to `retry_scheduled` with a
--      `next_retry_at` a short interval in the future.
--   2. `uq_automation_transport_requests_claim_job` is UNIQUE on `job_id`
--      WHERE `route_key = 'claim_v1'`, so a job may be claimed through the
--      signed transport EXACTLY ONCE, ever.
--   3. The ordinary claim selector also accepted `retry_scheduled` jobs and
--      ordered by `next_retry_at`/`available_at` ascending. A stranded job's
--      `next_retry_at` is in the PAST, so it outranks every later fresh job
--      forever.
--
-- Net effect: once any client action takes a retryable outcome, every later
-- claim re-selects the stranded job, the transport wrapper violates the unique
-- index (SQLSTATE 23505) and the Core claim route returns 500. Fresh work is
-- permanently starved.
--
-- THE REPAIR
-- ----------
-- The ORDINARY fresh-work claim selector no longer considers `retry_scheduled`.
-- That single change restores fresh-work progress:
--   * a stranded job is simply not selected, so the unique index is never
--     violated and the 500 disappears;
--   * a fresh `pending` job is selected even though an older past-due
--     `retry_scheduled` job exists.
--
-- `retry_scheduled` remains a fully legal, durable, INERT state. Nothing here
-- resets it to `queued`/`pending`, creates a replacement job or attempt, opens a
-- due sweep, deletes retry evidence or touches the append-only guards. Governed
-- retry recovery — due sweep, `retry_scheduled` reclaim, stale leases,
-- dead-letter handling — remains owned by QF-MVP-50.5 and is NOT implemented.
--
-- CLAIM UNIQUENESS IS DELIBERATELY UNCHANGED.
-- `uq_automation_transport_requests_claim_job` still permits exactly one
-- claim_v1 reservation per job. Excluding `retry_scheduled` fully restores fresh
-- progress on its own, so the frozen one-claim-per-job invariant is preserved.
-- Whether a governed retry should get its own transport identity is a retry
-- IDENTITY design question and belongs to QF-MVP-50.5, not to this repair.
--
-- Everything else about the function is preserved byte-for-byte: signature,
-- return contract, SECURITY DEFINER, pinned search_path, grants, worker-id
-- validation, `for update skip locked` lease semantics, the attempt-budget
-- guard, ordering among valid fresh jobs, and attempt creation.
--
-- No table, column, index, type or trigger change.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Preflight — the exact repair target and the frozen invariants must exist.
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
     and p.proname = 'qf_claim_automation_job_v1'
     and pg_get_function_identity_arguments(p.oid) = 'p_worker_id text';

  if v_oid is null then
    raise exception
      'QF-MVP-50.2 wedge repair aborted: qf_claim_automation_job_v1(text) is absent or has an unexpected signature.'
      using errcode = 'P0001';
  end if;
  if v_secdef is not true then
    raise exception 'QF-MVP-50.2 wedge repair aborted: target is not SECURITY DEFINER.'
      using errcode = 'P0001';
  end if;
  if v_config is null or not ('search_path=pg_catalog, public, pg_temp' = any (v_config)) then
    raise exception 'QF-MVP-50.2 wedge repair aborted: target search_path is not the pinned value.'
      using errcode = 'P0001';
  end if;

  -- The signed transport wrapper and its one-claim-per-job index are the
  -- invariants this repair is protecting. Both must still be in place.
  if to_regprocedure('public.qf_claim_automation_job_transport_v1(uuid,text,text)') is null then
    raise exception 'QF-MVP-50.2 wedge repair aborted: the signed transport claim wrapper is missing.'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'automation_transport_requests'
       and indexname = 'uq_automation_transport_requests_claim_job'
  ) then
    raise exception 'QF-MVP-50.2 wedge repair aborted: the one-claim-per-job index is missing.'
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The repair. Identical to 20260801110000 except that the fresh-work
--    selector no longer accepts `retry_scheduled`.
-- ---------------------------------------------------------------------------
create or replace function public.qf_claim_automation_job_v1(p_worker_id text)
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
        -- QF-MVP-50.2 FRESH-WORK SELECTOR.
        --
        -- ONLY `pending` work that is due. `retry_scheduled` is deliberately
        -- NOT selected here: a retry that has already consumed its
        -- one-per-job claim_v1 transport reservation can never be re-claimed
        -- through the signed route, so accepting it would re-select a
        -- permanently unclaimable job ahead of every fresh job and starve the
        -- queue (SQLSTATE 23505 -> Core 500).
        --
        -- `retry_scheduled` stays a legal, durable, inert state. Governed
        -- retry recovery is QF-MVP-50.5 and is NOT implemented here: this
        -- function opens no due sweep, resets no row and creates no
        -- replacement job or attempt.
        and j.status = 'pending'
        and j.available_at <= now()
      order by j.available_at asc,
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
  'QF-MVP-50.1B durable job claim, repaired by QF-MVP-50.2 to select FRESH pending work only. retry_scheduled is intentionally excluded: it has already consumed its one-per-job claim_v1 transport reservation and would otherwise starve the queue. retry_scheduled remains legal, durable and inert; governed retry recovery is owned by QF-MVP-50.5 and is not implemented here.';

-- ---------------------------------------------------------------------------
-- 3. Reassert the exact privilege posture. service_role only.
-- ---------------------------------------------------------------------------
revoke all on function public.qf_claim_automation_job_v1(text)
  from public, anon, authenticated, service_role;

grant execute on function public.qf_claim_automation_job_v1(text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Self-verification
-- ---------------------------------------------------------------------------
do $$
declare
  v_oid oid;
  v_def text;
  v_config text[];
  v_stranded integer;
  v_selected uuid;
begin
  select p.oid, pg_get_functiondef(p.oid), p.proconfig
    into v_oid, v_def, v_config
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'qf_claim_automation_job_v1'
     and pg_get_function_identity_arguments(p.oid) = 'p_worker_id text';

  if v_oid is null then
    raise exception 'QF-MVP-50.2 wedge repair aborted: repaired function not found.'
      using errcode = 'P0001';
  end if;

  -- 4.1 posture preserved
  if not (select p.prosecdef from pg_proc p where p.oid = v_oid) then
    raise exception 'QF-MVP-50.2 wedge repair aborted: SECURITY DEFINER lost.'
      using errcode = 'P0001';
  end if;
  if v_config is null or not ('search_path=pg_catalog, public, pg_temp' = any (v_config)) then
    raise exception 'QF-MVP-50.2 wedge repair aborted: search_path not preserved.'
      using errcode = 'P0001';
  end if;

  -- 4.2 no EXECUTABLE retry predicate survives, and due pending work is still
  --     selected. Prose in the body comments may name retry_scheduled; only the
  --     executable predicate shapes are rejected.
  if v_def ~ 'j\.status = ''retry_scheduled'''
     or v_def ~ 'j\.next_retry_at <= now\(\)'
     or v_def ~ 'j\.next_retry_at is not null' then
    raise exception 'QF-MVP-50.2 wedge repair aborted: an executable retry_scheduled selector predicate remains.'
      using errcode = 'P0001';
  end if;
  if v_def !~ 'j\.status = ''pending''' or v_def !~ 'j\.available_at <= now\(\)' then
    raise exception 'QF-MVP-50.2 wedge repair aborted: the fresh pending selector is absent.'
      using errcode = 'P0001';
  end if;

  -- 4.3 lease, budget and worker-id semantics preserved
  if v_def !~ 'for update skip locked'
     or v_def !~ 'j\.attempt_count < j\.max_attempts'
     or v_def !~ 'AUTOMATION_WORKER_ID_INVALID' then
    raise exception 'QF-MVP-50.2 wedge repair aborted: a frozen claim invariant was lost.'
      using errcode = 'P0001';
  end if;

  -- 4.4 no retry recovery is introduced
  if v_def ~ 'due_sweep' or v_def ~ 'reclaim' or v_def ~ 'delete from' then
    raise exception 'QF-MVP-50.2 wedge repair aborted: retry recovery must remain QF-MVP-50.5 scope.'
      using errcode = 'P0001';
  end if;

  -- 4.5 execute privilege is service_role only
  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'QF-MVP-50.2 wedge repair aborted: execute granted beyond service_role.'
      using errcode = 'P0001';
  end if;
  if not has_function_privilege('service_role', v_oid, 'execute') then
    raise exception 'QF-MVP-50.2 wedge repair aborted: service_role lost execute.'
      using errcode = 'P0001';
  end if;

  -- 4.6 the one-claim-per-job invariant is UNCHANGED
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'automation_transport_requests'
       and indexname = 'uq_automation_transport_requests_claim_job'
  ) then
    raise exception 'QF-MVP-50.2 wedge repair aborted: claim uniqueness must not be weakened.'
      using errcode = 'P0001';
  end if;

  -- 4.7 existing retry_scheduled evidence is untouched and still legal
  select count(*) into v_stranded
    from public.automation_jobs aj
   where aj.status = 'retry_scheduled';
  if v_stranded > 0 then
    -- prove the repaired selector now ignores it: the next selectable job must
    -- not be a retry_scheduled one
    select j.id into v_selected
      from public.automation_jobs j
     where j.attempt_count < j.max_attempts
       and j.status = 'pending'
       and j.available_at <= now()
     order by j.available_at asc, j.created_at asc
     limit 1;
    if v_selected is not null and exists (
      select 1 from public.automation_jobs aj
       where aj.id = v_selected and aj.status = 'retry_scheduled'
    ) then
      raise exception 'QF-MVP-50.2 wedge repair aborted: a retry_scheduled job is still selectable.'
        using errcode = 'P0001';
    end if;
  end if;
end $$;
