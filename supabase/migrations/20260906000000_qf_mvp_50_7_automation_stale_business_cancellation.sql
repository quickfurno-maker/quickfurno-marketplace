-- ============================================================================
-- QF-MVP-50.7 — governed stale-business job terminalization
--
-- THE PROBLEM QF-MVP-50.6 DID NOT SOLVE
--   50.6 removed jobs whose business ENTITY had been deleted. But a job can also
--   outlive its business TRUTH while the entity is perfectly healthy: the vendor
--   still exists and their onboarding simply moved past `new`; the assignment
--   still exists and the vendor already responded; the package was cancelled;
--   the credit balance recovered. The executor correctly refuses all of these
--   with QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE — and then the retry policy puts
--   them straight back on the queue, forever.
--
--   Staging currently holds 11 such rows. They are not orphans. Cancelling them
--   through the orphan authority would be a lie about why they are terminal.
--
-- THE ONE THING THAT MATTERS MOST HERE: NO PREDICATE DRIFT
--   If this migration restated the eligibility rules in SQL and the TypeScript
--   executor kept its own copy, the two would drift and a job could become
--   "stale enough to cancel" while the executor still considered it sendable.
--   So the rules are stated ONCE in lib/automation/vendorBusinessEligibility.ts,
--   the executor now delegates to that module, and the function below is the
--   TRANSACTIONAL RE-PROOF of the same predicates against the same columns. The
--   50.7 gate executes the TypeScript authority over a case matrix and pins each
--   predicate encoded here, so changing one side alone fails the build.
--
-- AND NO TOCTOU
--   Selection and mutation happen in ONE statement under `for update skip
--   locked`, and after the write the business state is re-derived a second time
--   inside the same transaction. If it is not still `stale`, the whole statement
--   raises AUTOMATION_STALE_BUSINESS_STATE_CHANGED and rolls back. A job whose
--   truth recovered between select and write is never left cancelled.
--
-- THE HARD BOUNDARY AGAINST 50.6
--   This lane requires the mapped entity to be PRESENT, using the SAME
--   qf_automation_entity_state_v1 authority 50.6 uses to require it ABSENT. The
--   two lanes are therefore mutually exclusive by construction: no job can be a
--   candidate for both, and none falls between them by accident.
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
    raise exception 'QF-MVP-50.7: the automation persistence and transport tables must exist.';
  end if;

  -- The business tables this lane's predicates read. A missing one would make a
  -- rule silently unprovable, so the migration refuses rather than install a
  -- half-blind authority.
  if to_regclass('public.vendors') is null
     or to_regclass('public.lead_assignments') is null
     or to_regclass('public.vendor_crm_profiles') is null
     or to_regclass('public.automation_policy_active_configs') is null
     or to_regclass('public.automation_policy_configs') is null then
    raise exception 'QF-MVP-50.7: every business table this authority reads must exist.';
  end if;

  -- The QF-MVP-50.6 entity authority is REQUIRED: it is how this lane proves the
  -- entity is still present and therefore not an orphan.
  if to_regprocedure('public.qf_automation_entity_state_v1(text,text)') is null then
    raise exception 'QF-MVP-50.7: the QF-MVP-50.6 entity-state authority must exist.';
  end if;

  if to_regprocedure('public.qf_cancel_orphan_automation_job_v1(text)') is null then
    raise exception 'QF-MVP-50.7: the QF-MVP-50.6 orphan authority must remain installed.';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'automation_jobs_status_check'
       and pg_get_constraintdef(oid) like '%cancelled%'
  ) then
    raise exception 'QF-MVP-50.7: automation_jobs must already permit the cancelled status.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Route vocabulary — closed, now exactly seven routes
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
    'cancel_orphan_v1',
    'cancel_stale_v1'
  ));

-- ---------------------------------------------------------------------------
-- 2. Shape — cancel_stale_v1 reuses the EXISTING `cancelled` and `empty` states
--    and, exactly like cancel_orphan_v1, carries NO attempt identity.
--
--    cancel_stale_v1 : processing -> cancelled | empty
-- ---------------------------------------------------------------------------
alter table public.automation_transport_requests
  drop constraint automation_transport_requests_shape_check;

alter table public.automation_transport_requests
  add constraint automation_transport_requests_shape_check
--    EVERY pre-existing clause below is reproduced from QF-MVP-50.6 verbatim.
--    The ONLY differences are the added cancel_stale_v1 clause and the widened
--    `empty` route list — nothing is relaxed, and no null/not-null requirement
--    on an existing state is dropped.
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
      and route_key in ('claim_v1', 'recover_v1', 'reconcile_v1', 'cancel_orphan_v1', 'cancel_stale_v1')
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
    or (
      -- QF-MVP-50.7. Same shape discipline as the orphan lane: a stale-business
      -- terminalization opens no attempt, so all three attempt columns stay null.
      state = 'cancelled'
      and route_key = 'cancel_stale_v1'
      and job_id is not null
      and action_request_id is not null
      and attempt_id is null
      and attempt_number is null
      and max_attempts is null
      and finalized_at is not null
    )
  );

-- ---------------------------------------------------------------------------
-- 3. One stale terminalization per job, ever. Route-scoped so it cannot collide
--    with the orphan lane's identical guarantee.
-- ---------------------------------------------------------------------------
create unique index if not exists uq_automation_transport_requests_cancel_stale_job
  on public.automation_transport_requests(job_id)
  where route_key = 'cancel_stale_v1' and job_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Transport guards re-created ONLY to widen the closed route vocabulary.
--    Every pre-existing route and state rule is preserved verbatim.
-- ---------------------------------------------------------------------------
-- The QF-MVP-50.6 bodies, reproduced verbatim. The ONLY edits are the added
-- 'cancel_stale_v1' route in the INSERT allowlist and the added cancel_stale_v1
-- finalization rule in the UPDATE guard. Structure, ordering, comparison
-- operators, error codes and volatility/privilege attributes are unchanged —
-- note in particular that these remain NON-security-definer trigger functions.
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
       'recover_v1', 'reconcile_v1', 'cancel_orphan_v1', 'cancel_stale_v1'
     )
     or new.state <> 'processing'
     or new.job_id is not null
     or new.action_request_id is not null
     or new.attempt_id is not null
     or new.attempt_number is not null
     or new.max_attempts is not null
     or new.finalized_at is not null then
    raise exception
      'QF-MVP-50.7: transport requests must be inserted as pristine n8n_to_core processing rows on a known route.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

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

  if old.route_key = 'cancel_stale_v1' and new.state not in ('cancelled', 'empty') then
    raise exception
      'QF-MVP-50.7: a cancel_stale_v1 request may finalize only to cancelled or empty.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. THE SHARED BUSINESS PREDICATE, in SQL.
--
--    Returns 'eligible' | 'stale' | 'unmapped', mirroring decideVendorBusinessState
--    in lib/automation/vendorBusinessEligibility.ts branch for branch. Only the
--    four v1 stale actions are decidable here; vendor.lead_offer is deliberately
--    absent because its only refusal is entity truth, which belongs to 50.6.
--
--    STABLE and read-only. It reads four tables and writes nothing.
-- ---------------------------------------------------------------------------
create or replace function public.qf_automation_vendor_business_state_v1(
  p_action_type text,
  p_entity_type text,
  p_entity_id text,
  p_source_event_key text
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uuid uuid;
  v_vendor_id uuid;
  v_assignment_vendor uuid;
  v_vendor_status text;
  v_stage text;
  v_package_status text;
  v_expires timestamptz;
  v_bound_stamp text;
  v_credits integer;
  v_threshold integer;
  v_exists boolean;
begin
  if p_action_type is null or p_entity_type is null or p_entity_id is null then
    return 'unmapped';
  end if;

  -- CLOSED action set and CLOSED action -> entity pairing. Anything else is
  -- unknowable, and an unknowable job is never terminalized.
  if p_action_type = 'vendor.response_reminder' then
    if p_entity_type <> 'lead_assignment' then return 'unmapped'; end if;
  elsif p_action_type in ('vendor.onboarding_reminder', 'vendor.package_expiry_warning', 'vendor.low_credit_warning') then
    if p_entity_type <> 'vendor' then return 'unmapped'; end if;
  else
    return 'unmapped';
  end if;

  begin
    v_uuid := p_entity_id::uuid;
  exception
    when invalid_text_representation then
      -- A non-uuid entity id cannot address any of these uuid-keyed tables, so
      -- this is entity truth, not business truth: 50.6's lane, never this one.
      return 'unmapped';
  end;

  if p_action_type = 'vendor.response_reminder' then
    -- A reminder whose durable source identity names no known window cannot be
    -- interpreted; the executor already treats that as a definitive refusal.
    if p_source_event_key is null
       or not (p_source_event_key like '%:resp2h' or p_source_event_key like '%:resp24h') then
      return 'stale';
    end if;

    select la.vendor_id, la.vendor_status
      into v_assignment_vendor, v_vendor_status
      from public.lead_assignments la
     where la.id = v_uuid;

    if not found then
      -- Entity absence. Reported as stale for EXECUTOR parity, but the caller
      -- additionally requires entity_state = 'present', so this can never reach
      -- a terminalization.
      return 'stale';
    end if;
    if v_assignment_vendor is null then return 'stale'; end if;
    -- The nudge exists only while the assigned lead has not progressed past New.
    if v_vendor_status is distinct from 'New' then return 'stale'; end if;
    return 'eligible';
  end if;

  -- The three vendor-entity actions all resolve the vendor directly.
  v_vendor_id := v_uuid;
  select exists (select 1 from public.vendors v where v.id = v_vendor_id) into v_exists;
  if not v_exists then
    return 'stale';
  end if;

  if p_action_type = 'vendor.onboarding_reminder' then
    select p.onboarding_stage into v_stage
      from public.vendor_crm_profiles p
     where p.vendor_id = v_vendor_id;
    if not found then return 'stale'; end if;
    if v_stage is distinct from 'new' then return 'stale'; end if;
    return 'eligible';
  end if;

  if p_action_type = 'vendor.package_expiry_warning' then
    -- The warning is bound to ONE expiry instant. A renewal that moves the
    -- expiry makes this warning stale; the new expiry produces its own pair.
    v_bound_stamp := split_part(p_source_event_key, '.', array_length(string_to_array(p_source_event_key, '.'), 1));
    if v_bound_stamp is null or v_bound_stamp !~ '^\d{14}$' then
      return 'stale';
    end if;
    select v.package_status, v.package_expires_at
      into v_package_status, v_expires
      from public.vendors v
     where v.id = v_vendor_id;
    if v_package_status is distinct from 'active' then return 'stale'; end if;
    if v_expires is null then return 'stale'; end if;
    if to_char(v_expires at time zone 'UTC', 'YYYYMMDDHH24MISS') <> v_bound_stamp then
      return 'stale';
    end if;
    return 'eligible';
  end if;

  if p_action_type = 'vendor.low_credit_warning' then
    -- OWNER-LOCKED: an unconfigured threshold is a definitive refusal. There is
    -- deliberately NO numeric fallback — assuming a number would send a warning
    -- nobody configured.
    -- The policy key is the EXACT repository constant
    -- VENDOR_LOW_CREDIT_THRESHOLD_POLICY_KEY from lib/automation/vendorDispatchRegistry.ts.
    -- The join mirrors the composite foreign key (policy_key, config_id) ->
    -- (policy_key, id), so a config can never be read across policies.
    select (c.config_json ->> 'thresholdCredits')::integer
      into v_threshold
      from public.automation_policy_active_configs a
      join public.automation_policy_configs c
        on c.id = a.config_id
       and c.policy_key = a.policy_key
     where a.policy_key = 'vendor_low_credit_warning_threshold';
    if v_threshold is null then return 'stale'; end if;

    select v.remaining_credits into v_credits
      from public.vendors v
     where v.id = v_vendor_id;
    if v_credits is null then return 'stale'; end if;
    -- A recharge back above the threshold makes the warning stale.
    if v_credits > v_threshold then return 'stale'; end if;
    return 'eligible';
  end if;

  return 'unmapped';
end;
$$;

comment on function public.qf_automation_vendor_business_state_v1(text, text, text, text) is
  'QF-MVP-50.7 vendor business-eligibility authority. Returns eligible | stale | unmapped, mirroring lib/automation/vendorBusinessEligibility.ts branch for branch. Read-only; an unsupported action or wrong entity pairing is unmapped so callers fail closed.';

revoke all on function public.qf_automation_vendor_business_state_v1(text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_automation_vendor_business_state_v1(text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. The terminalization authority — one job, one call, Core-selected
-- ---------------------------------------------------------------------------
create or replace function public.qf_cancel_stale_automation_job_v1(p_worker_id text)
returns table (
  job_id uuid,
  action_request_id uuid,
  action_type text,
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
  v_entity text;
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
         -- Nothing executed, so there is nothing to classify. Writing a
         -- definitive_failure here would fabricate an attempt outcome that never
         -- ran. The safe code records WHY it will never execute and is a fixed
         -- repository-owned constant, never a caller-supplied string.
         last_result_classification = null,
         last_safe_code = 'QF_AUTOMATION_BUSINESS_STATE_NO_LONGER_ELIGIBLE',
         updated_at = now()
   where id = (
     select j.id
       from public.automation_jobs j
       join public.automation_action_requests r on r.id = j.action_request_id
      -- ONLY the two non-executing, non-terminal states.
      where j.status in ('pending', 'retry_scheduled')
        -- THE HARD BOUNDARY AGAINST QF-MVP-50.6: the entity must still EXIST.
        -- An absent entity is the orphan lane's business, never this one.
        and public.qf_automation_entity_state_v1(r.entity_type, r.entity_id) = 'present'
        -- The CLOSED v1 stale vocabulary.
        and r.action_type in (
          'vendor.response_reminder',
          'vendor.onboarding_reminder',
          'vendor.package_expiry_warning',
          'vendor.low_credit_warning'
        )
        -- The SHARED predicate. Only a proven 'stale' qualifies; 'eligible' and
        -- 'unmapped' are both left untouched.
        and public.qf_automation_vendor_business_state_v1(
              r.action_type, r.entity_type, r.entity_id, r.idempotency_key
            ) = 'stale'
        -- Already terminalized once? Then it is terminal and invisible anyway;
        -- this makes the uniqueness index unreachable rather than merely unlikely.
        and not exists (
          select 1
            from public.automation_transport_requests t
           where t.route_key = 'cancel_stale_v1'
             and t.job_id = j.id
        )
      -- Oldest first, so a growing stale set drains deterministically and no
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

  -- TOCTOU DEFENCE. The selector already required 'stale' and 'present', and in
  -- a consistent database this cannot disagree — but if the authoritative truth
  -- moved between the select and the write, the whole statement rolls back
  -- rather than leaving a job cancelled that had just become eligible again.
  v_entity := public.qf_automation_entity_state_v1(v_request.entity_type, v_request.entity_id);
  v_state := public.qf_automation_vendor_business_state_v1(
    v_request.action_type, v_request.entity_type, v_request.entity_id, v_request.idempotency_key
  );
  if v_entity is distinct from 'present' or v_state is distinct from 'stale' then
    raise exception 'AUTOMATION_STALE_BUSINESS_STATE_CHANGED' using errcode = 'P0001';
  end if;

  return query
  select
    v_job.id,
    v_job.action_request_id,
    v_request.action_type,
    v_job.last_safe_code;
end;
$$;

comment on function public.qf_cancel_stale_automation_job_v1(text) is
  'QF-MVP-50.7 stale-business terminalization. Selects ONE pending/retry_scheduled job whose entity is still PRESENT but whose current business truth is provably stale under the shared predicate, and moves it to the existing terminal cancelled state. Opens no execution attempt, never touches attempt_count, never selects processing or terminal jobs, and re-proves business truth after the write.';

revoke all on function public.qf_cancel_stale_automation_job_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_cancel_stale_automation_job_v1(text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. Signed transport wrapper — one-shot, route identity cancel_stale_v1
-- ---------------------------------------------------------------------------
create or replace function public.qf_cancel_stale_automation_job_transport_v1(
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
  action_type text,
  safe_code text
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.automation_transport_requests%rowtype;
  v_cancellation record;
  v_action_type text;
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
    'cancel_stale_v1',
    p_worker_id,
    p_body_sha256
  )
  on conflict (id) do nothing
  returning * into v_request;

  v_inserted := v_request.id is not null;

  -- REPLAY. The same signed request never terminalizes a second job: it re-reads
  -- its own durable row and answers with the identity it already produced.
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
       or v_request.route_key <> 'cancel_stale_v1'
       or v_request.worker_id is distinct from p_worker_id
       or v_request.body_sha256 is distinct from p_body_sha256 then
      raise exception 'AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT' using errcode = 'P0001';
    end if;

    if v_request.state = 'processing' then
      raise exception 'AUTOMATION_TRANSPORT_REQUEST_INCOMPLETE_INVARIANT' using errcode = 'P0001';
    end if;

    if v_request.action_request_id is not null then
      select r.action_type into v_action_type
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
      v_action_type,
      case when v_request.job_id is null
           then null::text
           else 'QF_AUTOMATION_BUSINESS_STATE_NO_LONGER_ELIGIBLE'::text
      end;
    return;
  end if;

  select * into v_cancellation
    from public.qf_cancel_stale_automation_job_v1(p_worker_id);

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
    v_cancellation.action_type,
    v_cancellation.safe_code;
end;
$$;

comment on function public.qf_cancel_stale_automation_job_transport_v1(uuid, text, text) is
  'QF-MVP-50.7 signed stale-business transport. One request id terminalizes at most ONE job, ever; a replay re-reads its own durable row instead of selecting again. Carries no attempt identity because terminalization runs no attempt.';

revoke all on function public.qf_cancel_stale_automation_job_transport_v1(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_cancel_stale_automation_job_transport_v1(uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 8. Self-verification — fail closed if this migration did not do what it says
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.qf_automation_vendor_business_state_v1(text,text,text,text)') is null
     or to_regprocedure('public.qf_cancel_stale_automation_job_v1(text)') is null
     or to_regprocedure('public.qf_cancel_stale_automation_job_transport_v1(uuid,text,text)') is null then
    raise exception 'QF-MVP-50.7: the stale-business authority was not installed.';
  end if;

  -- QF-MVP-50.6 must still be installed and untouched.
  if to_regprocedure('public.qf_automation_entity_state_v1(text,text)') is null
     or to_regprocedure('public.qf_cancel_orphan_automation_job_v1(text)') is null
     or to_regprocedure('public.qf_cancel_orphan_automation_job_transport_v1(uuid,text,text)') is null then
    raise exception 'QF-MVP-50.7: the QF-MVP-50.6 orphan authority must remain installed.';
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
    raise exception 'QF-MVP-50.7: automation tables must remain SELECT-only for service_role.';
  end if;

  -- No API role may reach the new authority.
  if exists (
    select 1
      from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name in ('qf_automation_vendor_business_state_v1',
                            'qf_cancel_stale_automation_job_v1',
                            'qf_cancel_stale_automation_job_transport_v1')
       and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) then
    raise exception 'QF-MVP-50.7: an API role gained execute on the stale-business authority.';
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'uq_automation_transport_requests_cancel_stale_job'
  ) then
    raise exception 'QF-MVP-50.7: the one-terminalization-per-job index is missing.';
  end if;

  -- The QF-MVP-50.6 index must still exist: 50.7 may not weaken it.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'uq_automation_transport_requests_cancel_orphan_job'
  ) then
    raise exception 'QF-MVP-50.7: the QF-MVP-50.6 uniqueness index must remain.';
  end if;
end
$$;
