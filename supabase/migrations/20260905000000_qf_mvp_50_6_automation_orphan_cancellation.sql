-- ============================================================================
-- QF-MVP-50.6 — orphan automation job cancellation authority
--
-- THE PROBLEM
--   An automation job outlives the business entity it was created for. The lead,
--   assignment, vendor or intent is gone, but the job is still `pending` or
--   `retry_scheduled` and still DUE — so the ordinary claim and recovery lanes
--   will happily hand it to an executor, which will try to resolve a recipient
--   for an entity that no longer exists. Nothing in the queue currently
--   distinguishes "due" from "still meaningful".
--
-- WHAT THIS ADDS
--   One governed way to move such a job to the EXISTING terminal state
--   `cancelled`, and nothing else. There is no new terminal vocabulary: the
--   schema has had `cancelled` since the original persistence migration, and the
--   job update guard has always permitted `pending -> cancelled` and
--   `retry_scheduled -> cancelled`. What was missing was an application authority
--   allowed to make that transition. Direct table UPDATE stays ungranted.
--
-- CORE OWNS ORPHAN TRUTH
--   The caller supplies a request id, a worker id and a body hash. It does NOT
--   supply a job id, an entity id, an entity type, a reason or an assertion that
--   anything is missing. Core selects the candidate itself and re-derives absence
--   from the authoritative tables inside the same transaction that cancels.
--
-- FAIL CLOSED ON THE UNKNOWN
--   An entity_type outside the closed map is `unmapped` and is NEVER cancelled.
--   A future action pointing at a table this migration does not know about is
--   therefore invisible to this lane rather than silently terminalized — the
--   failure mode is "the orphan stays queued and a human notices", never "a live
--   job was cancelled because Core did not recognise its entity".
--
-- WHAT IT CANNOT DO
--   It cannot touch `processing` (that belongs to execution and reconciliation),
--   nor any terminal job. It opens NO execution attempt, so `attempt_count` is
--   untouched — the job update guard enforces that independently. It writes no
--   communication row, constructs no provider, and reads no Meta credential.
--
-- Forward-only. No historical migration is modified, no row is seeded, no
-- staging or production data is cleaned here, and no network extension is used.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Dependency preflight — fail closed if the world is not what we assume
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.automation_jobs') is null
     or to_regclass('public.automation_action_requests') is null
     or to_regclass('public.automation_transport_requests') is null then
    raise exception 'QF-MVP-50.6: the automation persistence and transport tables must exist.';
  end if;

  -- The four authoritative entity tables this lane is allowed to consult. If any
  -- is absent the map would silently classify a live entity as missing, so the
  -- migration refuses rather than install a half-blind authority.
  if to_regclass('public.leads') is null
     or to_regclass('public.lead_assignments') is null
     or to_regclass('public.vendors') is null
     or to_regclass('public.communication_intents') is null then
    raise exception 'QF-MVP-50.6: every mapped entity table must exist before the orphan authority is installed.';
  end if;

  if to_regprocedure('public.qf_automation_action_workflow_family_v1(text)') is null then
    raise exception 'QF-MVP-50.6: the canonical workflow-family authority must exist.';
  end if;

  -- The terminal state this phase uses must already be legal for a job.
  if not exists (
    select 1 from pg_constraint
     where conname = 'automation_jobs_status_check'
       and pg_get_constraintdef(oid) like '%cancelled%'
  ) then
    raise exception 'QF-MVP-50.6: automation_jobs must already permit the cancelled status.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Route vocabulary — closed, now exactly six routes
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
    'reconcile_v1',
    'cancel_orphan_v1'
  ));

-- ---------------------------------------------------------------------------
-- 2. State vocabulary — closed; exactly one new terminal state
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
    'reconciled',
    'cancelled'
  ));

-- ---------------------------------------------------------------------------
-- 3. Shape — the new terminal state is bound to its own route, and carries NO
--    attempt identity
--
--    cancel_orphan_v1 : processing -> cancelled | empty
--
--    `cancelled` is the FIRST work-carrying transport state with a null
--    attempt_id, and that is the point rather than an omission. Cancelling an
--    orphan opens no execution attempt: no worker runs, no provider is called and
--    `attempt_count` does not move. A shape that demanded an attempt id here
--    would have forced this lane to manufacture an attempt that never executed,
--    which is exactly the fiction the ledger exists to prevent.
--
--    `empty` widens to the fourth SELECTING route for the same reason it widened
--    before: "Core looked and there was nothing eligible" is one real outcome,
--    and an `empty` row still carries no identity columns at all.
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
      and route_key in ('claim_v1', 'recover_v1', 'reconcile_v1', 'cancel_orphan_v1')
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
    or (
      -- NO attempt identity, by construction: cancellation runs no attempt.
      state = 'cancelled'
      and route_key = 'cancel_orphan_v1'
      and job_id is not null
      and action_request_id is not null
      and attempt_id is null
      and attempt_number is null
      and max_attempts is null
      and finalized_at is not null
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Route-scoped uniqueness — ONE cancellation per JOB
--
--    A job can be cancelled exactly once: `cancelled` is terminal and terminal
--    jobs are immutable, so the natural identity here is the job itself — unlike
--    recover_v1, where a job legally recovers once per retry generation.
--
--    This rule cannot wedge the lane the way an unreachable claim reservation
--    once did: a job that holds a cancel row is already terminal and is excluded
--    by the selector's status filter, so it can never be re-selected and then
--    collide. The selector additionally skips any job already holding a
--    cancel_orphan_v1 row, so SQLSTATE 23505 is unreachable rather than unlikely.
-- ---------------------------------------------------------------------------
create unique index uq_automation_transport_requests_cancel_orphan_job
  on public.automation_transport_requests(job_id)
  where route_key = 'cancel_orphan_v1'
    and job_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Insert guard — still pristine-only, now for exactly six routes
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
       'claim_v1', 'complete_v1', 'execute_v1',
       'recover_v1', 'reconcile_v1', 'cancel_orphan_v1'
     )
     or new.state <> 'processing'
     or new.job_id is not null
     or new.action_request_id is not null
     or new.attempt_id is not null
     or new.attempt_number is not null
     or new.max_attempts is not null
     or new.finalized_at is not null then
    raise exception
      'QF-MVP-50.6: transport requests must be inserted as pristine n8n_to_core processing rows on a known route.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Update guard — every existing route rule preserved, one added
-- ---------------------------------------------------------------------------
create or replace function public.qf_guard_automation_transport_request_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.state <> 'processing' then
    raise exception
      'QF-MVP-50.6: finalized transport request history is immutable.'
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
      'QF-MVP-50.6: transport request identity/evidence is immutable.'
      using errcode = 'check_violation';
  end if;

  if old.route_key = 'claim_v1' and new.state not in ('claimed', 'empty') then
    raise exception
      'QF-MVP-50.6: a claim_v1 request may finalize only to claimed or empty.'
      using errcode = 'check_violation';
  end if;

  if old.route_key = 'complete_v1' and new.state <> 'completed' then
    raise exception
      'QF-MVP-50.6: a complete_v1 request may finalize only to completed.'
      using errcode = 'check_violation';
  end if;

  if old.route_key = 'execute_v1' and new.state <> 'recorded' then
    raise exception
      'QF-MVP-50.6: an execute_v1 request may finalize only to recorded.'
      using errcode = 'check_violation';
  end if;

  if old.route_key = 'recover_v1' and new.state not in ('recovered', 'empty') then
    raise exception
      'QF-MVP-50.6: a recover_v1 request may finalize only to recovered or empty.'
      using errcode = 'check_violation';
  end if;

  if old.route_key = 'reconcile_v1' and new.state not in ('reconciled', 'empty') then
    raise exception
      'QF-MVP-50.6: a reconcile_v1 request may finalize only to reconciled or empty.'
      using errcode = 'check_violation';
  end if;

  if old.route_key = 'cancel_orphan_v1' and new.state not in ('cancelled', 'empty') then
    raise exception
      'QF-MVP-50.6: a cancel_orphan_v1 request may finalize only to cancelled or empty.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Entity-existence authority — the ONLY place orphan truth is decided
--
--    Returns exactly one of:
--      'present'  — the authoritative row exists
--      'missing'  — the entity type is mapped and no row can exist for that id
--      'unmapped' — this migration does not know the entity type, so NOTHING is
--                   concluded and the caller must refuse to cancel
--
--    A non-UUID entity_id against a uuid-keyed table is 'missing', not an error:
--    a uuid column cannot hold that value, so no row can EVER match it. That is a
--    proof about the schema, not a guess about the data — which is why the
--    certification queue's `qf505cert` identities are safely cancellable while an
--    unrecognised entity type is not.
--
--    STABLE and read-only. It reads four tables and writes nothing.
-- ---------------------------------------------------------------------------
create or replace function public.qf_automation_entity_state_v1(
  p_entity_type text,
  p_entity_id text
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uuid uuid;
  v_exists boolean;
begin
  if p_entity_type is null or p_entity_id is null then
    return 'unmapped';
  end if;

  -- The closed map. Anything not listed here is deliberately unknowable.
  if p_entity_type not in ('lead', 'lead_assignment', 'vendor', 'communication_intent') then
    return 'unmapped';
  end if;

  begin
    v_uuid := p_entity_id::uuid;
  exception
    when invalid_text_representation then
      -- Well-formed question, provably empty answer: a uuid primary key cannot
      -- contain this value, so no row exists or ever will.
      return 'missing';
  end;

  case p_entity_type
    when 'lead' then
      select exists (select 1 from public.leads t where t.id = v_uuid) into v_exists;
    when 'lead_assignment' then
      select exists (select 1 from public.lead_assignments t where t.id = v_uuid) into v_exists;
    when 'vendor' then
      select exists (select 1 from public.vendors t where t.id = v_uuid) into v_exists;
    when 'communication_intent' then
      select exists (select 1 from public.communication_intents t where t.id = v_uuid) into v_exists;
    else
      return 'unmapped';
  end case;

  return case when v_exists then 'present' else 'missing' end;
end;
$$;

comment on function public.qf_automation_entity_state_v1(text, text) is
  'QF-MVP-50.6 entity-existence authority. Returns present | missing | unmapped for a mapped automation entity. Read-only; an unknown entity_type is unmapped so callers fail closed rather than assume absence.';

revoke all on function public.qf_automation_entity_state_v1(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_automation_entity_state_v1(text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 8. The cancellation authority — one job, one call, Core-selected
-- ---------------------------------------------------------------------------
create or replace function public.qf_cancel_orphan_automation_job_v1(p_worker_id text)
returns table (
  job_id uuid,
  action_request_id uuid,
  entity_type text,
  safe_code text
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.automation_jobs%rowtype;
  v_request public.automation_action_requests%rowtype;
  v_state text;
begin
  if p_worker_id is null
     or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' then
    raise exception 'AUTOMATION_WORKER_ID_INVALID' using errcode = 'P0001';
  end if;

  update public.automation_jobs
     set status = 'cancelled',
         completed_at = now(),
         next_retry_at = null,
         locked_at = null,
         locked_by = null,
         -- A cancelled job carries no result classification: nothing executed.
         -- The safe code records WHY it will never execute, and is a fixed
         -- repository-owned constant, never a caller-supplied string.
         last_result_classification = null,
         last_safe_code = 'QF_AUTOMATION_ORPHAN_ENTITY_MISSING',
         updated_at = now()
   where id = (
     select j.id
       from public.automation_jobs j
       join public.automation_action_requests r on r.id = j.action_request_id
      -- ONLY the two non-executing, non-terminal states. `processing` belongs to
      -- execution and reconciliation and must never be stolen by maintenance.
      where j.status in ('pending', 'retry_scheduled')
        -- Core re-derives absence itself, inside this transaction. The caller
        -- asserted nothing and could not have.
        and public.qf_automation_entity_state_v1(r.entity_type, r.entity_id) = 'missing'
        -- Already cancelled once? Then it is terminal and invisible anyway; this
        -- makes the uniqueness index unreachable rather than merely unlikely.
        and not exists (
          select 1
            from public.automation_transport_requests t
           where t.route_key = 'cancel_orphan_v1'
             and t.job_id = j.id
        )
      -- Oldest first, so a growing orphan set drains deterministically and no
      -- single job can be starved by newer arrivals.
      order by j.created_at asc, j.id asc
      for update skip locked
      limit 1
   )
   returning * into v_job;

  if v_job.id is null then
    return;
  end if;

  select * into v_request
    from public.automation_action_requests
   where id = v_job.action_request_id;

  -- Defensive re-proof AFTER the write, inside the same transaction. The selector
  -- already required 'missing', and this cannot disagree in a consistent
  -- database — but if it ever did, the whole statement rolls back rather than
  -- leaving a live job cancelled.
  v_state := public.qf_automation_entity_state_v1(v_request.entity_type, v_request.entity_id);
  if v_state is distinct from 'missing' then
    raise exception 'AUTOMATION_ORPHAN_ENTITY_STATE_CHANGED' using errcode = 'P0001';
  end if;

  return query
  select
    v_job.id,
    v_job.action_request_id,
    v_request.entity_type,
    v_job.last_safe_code;
end;
$$;

comment on function public.qf_cancel_orphan_automation_job_v1(text) is
  'QF-MVP-50.6 orphan cancellation. Selects ONE pending/retry_scheduled job whose mapped authoritative entity is provably absent and moves it to the existing terminal cancelled state. Opens no execution attempt, never touches attempt_count, never selects processing or terminal jobs, and refuses any unmapped entity type.';

revoke all on function public.qf_cancel_orphan_automation_job_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_cancel_orphan_automation_job_v1(text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 9. Signed transport wrapper — one-shot, route identity cancel_orphan_v1
-- ---------------------------------------------------------------------------
create or replace function public.qf_cancel_orphan_automation_job_transport_v1(
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
  entity_type text,
  safe_code text
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.automation_transport_requests%rowtype;
  v_cancellation record;
  v_entity_type text;
  v_inserted boolean := false;
begin
  if p_request_id is null then
    raise exception 'AUTOMATION_TRANSPORT_REQUEST_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if p_worker_id is null
     or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' then
    raise exception 'AUTOMATION_TRANSPORT_WORKER_ID_INVALID' using errcode = 'P0001';
  end if;

  if p_body_sha256 is null
     or p_body_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'AUTOMATION_TRANSPORT_BODY_HASH_INVALID' using errcode = 'P0001';
  end if;

  insert into public.automation_transport_requests (
    id,
    route_key,
    worker_id,
    body_sha256
  ) values (
    p_request_id,
    'cancel_orphan_v1',
    p_worker_id,
    p_body_sha256
  )
  on conflict (id) do nothing
  returning * into v_request;

  v_inserted := v_request.id is not null;

  -- REPLAY. The same signed request never cancels a second job: it re-reads its
  -- own durable row and answers with the identity it already produced.
  if not v_inserted then
    select * into v_request
      from public.automation_transport_requests
     where id = p_request_id
     for update;

    if v_request.id is null then
      raise exception 'AUTOMATION_TRANSPORT_REPLAY_STATE_MISSING' using errcode = 'P0001';
    end if;

    if v_request.transport_version <> 1
       or v_request.direction <> 'n8n_to_core'
       or v_request.route_key <> 'cancel_orphan_v1'
       or v_request.worker_id is distinct from p_worker_id
       or v_request.body_sha256 is distinct from p_body_sha256 then
      raise exception 'AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT' using errcode = 'P0001';
    end if;

    if v_request.state = 'processing' then
      raise exception 'AUTOMATION_TRANSPORT_REQUEST_INCOMPLETE_INVARIANT' using errcode = 'P0001';
    end if;

    if v_request.action_request_id is not null then
      select r.entity_type into v_entity_type
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
      v_entity_type,
      case when v_request.job_id is null
           then null::text
           else 'QF_AUTOMATION_ORPHAN_ENTITY_MISSING'::text
      end;
    return;
  end if;

  select * into v_cancellation
    from public.qf_cancel_orphan_automation_job_v1(p_worker_id);

  if v_cancellation.job_id is null then
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
      null::uuid,
      null::uuid,
      null::text,
      null::text;
    return;
  end if;

  update public.automation_transport_requests
     set state = 'cancelled',
         job_id = v_cancellation.job_id,
         action_request_id = v_cancellation.action_request_id,
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
    v_cancellation.entity_type,
    v_cancellation.safe_code;
end;
$$;

comment on function public.qf_cancel_orphan_automation_job_transport_v1(uuid, text, text) is
  'QF-MVP-50.6 signed orphan-cancellation transport. One request id cancels at most ONE job, ever; a replay re-reads its own durable row instead of selecting again. Carries no attempt identity because cancellation runs no attempt.';

revoke all on function public.qf_cancel_orphan_automation_job_transport_v1(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_cancel_orphan_automation_job_transport_v1(uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 10. Self-verification — fail closed if this migration did not do what it says
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.qf_automation_entity_state_v1(text,text)') is null
     or to_regprocedure('public.qf_cancel_orphan_automation_job_v1(text)') is null
     or to_regprocedure('public.qf_cancel_orphan_automation_job_transport_v1(uuid,text,text)') is null then
    raise exception 'QF-MVP-50.6: the orphan cancellation authority was not installed.';
  end if;

  -- The service_role must NOT have gained direct table mutation anywhere.
  if exists (
    select 1
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name in ('automation_jobs', 'automation_action_requests',
                          'automation_transport_requests', 'automation_execution_attempts')
       and grantee = 'service_role'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ) then
    raise exception 'QF-MVP-50.6: automation tables must remain SELECT-only for service_role.';
  end if;

  -- No API role may reach the new authority.
  if exists (
    select 1
      from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name in ('qf_automation_entity_state_v1',
                            'qf_cancel_orphan_automation_job_v1',
                            'qf_cancel_orphan_automation_job_transport_v1')
       and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) then
    raise exception 'QF-MVP-50.6: an API role gained execute on the orphan authority.';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'uq_automation_transport_requests_cancel_orphan_job'
  ) then
    raise exception 'QF-MVP-50.6: the one-cancellation-per-job index is missing.';
  end if;
end
$$;
