-- ============================================================================
-- QF-MVP-50.3 / 50.4 — family-aware claim routing
--
-- SHARED SUBSTRATE SAFETY REPAIR. Successor migration only: the historical
-- claim migrations (20260801110000, 20260801152049) and the QF-MVP-50.2 wedge
-- repair (20260808000000) are never edited.
--
-- THE DEFECT
-- ----------
-- The signed claim was FAMILY-BLIND. `qf_claim_automation_job_v1(p_worker_id)`
-- and its transport wrapper took no workflow family; the family was derived in
-- Core only AFTER the claim had already committed. A claim is irreversible
-- under the frozen 50.2 invariants:
--
--   * the job moves to `processing`, `attempt_count` increments and an attempt
--     row is created;
--   * the job's single permitted `claim_v1` transport row is consumed
--     (uq_automation_transport_requests_claim_job is UNIQUE on job_id);
--   * `processing -> pending` is NOT a legal transition in
--     qf_guard_automation_job_update;
--   * automation_transport_requests is append-only;
--   * stale-lease recovery is QF-MVP-50.5 and is not implemented.
--
-- So a workflow that claimed another family's job discovered the mismatch too
-- late, stopped, and PERMANENTLY STRANDED that job. Latent while only the
-- client executor existed; unacceptable the moment vendor and campaign
-- executors share the queue.
--
-- THE REPAIR — prevention, never reversal
-- ---------------------------------------
--   1. a canonical SQL action -> workflow-family map, derived from the frozen
--      14-action registry and validator-pinned against the TypeScript
--      dispatch authority;
--   2. the LEGACY `qf_claim_automation_job_v1(text)` keeps its exact signature,
--      return shape and every frozen queue semantic, but its selector becomes
--      CLIENT-ONLY — which is the only historically valid use of the
--      family-blind API, so the existing client route and workflow keep working
--      unchanged and are now safe in a multi-family queue;
--   3. a family-aware claim taking a worker and EXACTLY ONE family;
--   4. a family-aware transport wrapper that keeps route identity `claim_v1`.
--
-- Family is bound into the signed request identity by the CALLER's canonical
-- body hash (the family-aware claim body carries `workflowFamily`), so the
-- existing body_sha256 replay-conflict rule already makes a same-requestId,
-- changed-family call a CONFLICT. No claim_v2 vocabulary is introduced.
--
-- DELIBERATELY ABSENT: no release, no unclaim, no `processing -> pending`, no
-- claim-row deletion, no extra attempt, no due sweep, no stale-lease recovery.
-- Those are QF-MVP-50.5. The one-claim-per-job uniqueness and the
-- retry_scheduled exclusion are unchanged. No table, column, index or type.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Preflight
-- ---------------------------------------------------------------------------
do $$
declare
  v_config text[];
begin
  if to_regprocedure('public.qf_claim_automation_job_v1(text)') is null
     or to_regprocedure('public.qf_claim_automation_job_transport_v1(uuid,text,text)') is null then
    raise exception
      'QF-MVP-50.3/50.4 aborted: the frozen claim functions are missing.'
      using errcode = 'P0001';
  end if;

  select p.proconfig into v_config
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qf_claim_automation_job_v1';
  if v_config is null
     or not ('search_path=pg_catalog, public, pg_temp' = any (v_config)) then
    raise exception
      'QF-MVP-50.3/50.4 aborted: the legacy claim search_path is not the pinned value.'
      using errcode = 'P0001';
  end if;

  -- The invariant this repair exists to protect.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'automation_transport_requests'
       and indexname = 'uq_automation_transport_requests_claim_job'
  ) then
    raise exception
      'QF-MVP-50.3/50.4 aborted: the one-claim-per-job index is missing.'
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Canonical action -> workflow family.
--
--    Exactly the frozen 14-action registry. There is no default branch and no
--    prefix parsing: an unknown action returns NULL and every caller below
--    fails closed on it. A validator pins this map against
--    lib/automation/actionRegistry.ts so the two can never drift.
--
--    Registered-but-non-producible actions (vendor.document_reminder,
--    campaign.execute_batch) keep their canonical family here. Producibility is
--    a separate concern owned by the producers, not by claim routing.
-- ---------------------------------------------------------------------------
create or replace function public.qf_automation_action_workflow_family_v1(
  p_action_type text
)
returns text
language sql
immutable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select case p_action_type
    when 'client.lead_confirmation'            then 'client_whatsapp'
    when 'client.requirement_collection'       then 'client_whatsapp'
    when 'client.missing_information_reminder' then 'client_whatsapp'
    when 'client.matching_update'              then 'client_whatsapp'
    when 'client.lead_status_update'           then 'client_whatsapp'
    when 'client.transactional_followup'       then 'client_whatsapp'
    when 'vendor.lead_offer'                   then 'vendor_whatsapp'
    when 'vendor.response_reminder'            then 'vendor_whatsapp'
    when 'vendor.onboarding_reminder'          then 'vendor_whatsapp'
    when 'vendor.document_reminder'            then 'vendor_whatsapp'
    when 'vendor.package_expiry_warning'       then 'vendor_whatsapp'
    when 'vendor.low_credit_warning'           then 'vendor_whatsapp'
    when 'campaign.execute_batch'              then 'campaign_execution'
    when 'campaign.execute_recipient'          then 'campaign_execution'
    else null
  end;
$$;

comment on function public.qf_automation_action_workflow_family_v1(text) is
  'QF-MVP-50.3/50.4 canonical action -> workflow family map over the frozen 14-action registry. NULL for an unknown action; every caller fails closed rather than defaulting to a family.';

revoke all on function public.qf_automation_action_workflow_family_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_automation_action_workflow_family_v1(text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. LEGACY claim — same signature, same everything, now CLIENT-ONLY.
--
--    Identical to the QF-MVP-50.2 wedge-repaired body except that the selector
--    also requires the job's action to belong to `client_whatsapp`. The client
--    route and the client n8n workflow therefore need no change at all, and the
--    only historically valid caller of the family-blind API keeps working while
--    becoming safe beside vendor and campaign work.
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
        -- QF-MVP-50.2 FRESH-WORK SELECTOR (unchanged): only due `pending`
        -- work. retry_scheduled stays excluded and inert; governed retry
        -- recovery remains QF-MVP-50.5 and is NOT implemented here.
        and j.status = 'pending'
        and j.available_at <= now()
        -- QF-MVP-50.3/50.4 FAMILY FENCE: this legacy entry point is now
        -- CLIENT-ONLY, so it can never irreversibly consume vendor or campaign
        -- work. The family is derived from durable action truth, never from a
        -- caller-supplied allowlist.
        and exists (
          select 1
            from public.automation_action_requests r
           where r.id = j.action_request_id
             and public.qf_automation_action_workflow_family_v1(r.action_type)
                 = 'client_whatsapp'
        )
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
  'QF-MVP-50.1B durable job claim. QF-MVP-50.2 restricted it to FRESH pending work (retry_scheduled excluded, recovery is 50.5). QF-MVP-50.3/50.4 additionally fences it to client_whatsapp so this legacy family-blind entry point can never irreversibly consume vendor or campaign work.';

revoke all on function public.qf_claim_automation_job_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_claim_automation_job_v1(text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Family-aware claim — EXACTLY ONE family per request.
--
--    No array, no wildcard, no comma list, no "all", and NULL is not "any".
--    The caller declares one family from the closed registry vocabulary; the
--    job's family comes from durable action truth.
-- ---------------------------------------------------------------------------
create or replace function public.qf_claim_automation_job_for_family_v1(
  p_worker_id text,
  p_workflow_family text
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

  -- EXACTLY ONE family, from the closed vocabulary. A null, an empty string, a
  -- padded string, a wildcard or any multi-family expression all fail closed.
  if p_workflow_family is null
     or p_workflow_family not in
        ('client_whatsapp', 'vendor_whatsapp', 'campaign_execution') then
    raise exception 'AUTOMATION_CLAIM_WORKFLOW_FAMILY_INVALID'
      using errcode = 'P0001';
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
        and j.status = 'pending'
        and j.available_at <= now()
        -- The family fence. A job of another family is INVISIBLE here, so an
        -- older foreign job can never win this claim merely by sorting first.
        and exists (
          select 1
            from public.automation_action_requests r
           where r.id = j.action_request_id
             and public.qf_automation_action_workflow_family_v1(r.action_type)
                 = p_workflow_family
        )
      -- Ordering WITHIN the requested family is the frozen queue order.
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

comment on function public.qf_claim_automation_job_for_family_v1(text, text) is
  'QF-MVP-50.3/50.4 family-aware durable job claim. Exactly ONE workflow family per request, matched against durable action truth; no caller-supplied action allowlist, no wildcard, no multi-family. Same fresh-pending semantics, retry_scheduled exclusion, ordering, lease and attempt behaviour as the legacy claim.';

revoke all on function public.qf_claim_automation_job_for_family_v1(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_claim_automation_job_for_family_v1(text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Family-aware transport wrapper.
--
--    Route identity stays `claim_v1`. Family is bound into the signed request
--    identity by the caller's canonical body hash, so the existing
--    body_sha256 replay-conflict rule already turns a same-requestId
--    changed-family call into AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT.
--    The one-claim-per-job uniqueness is untouched.
-- ---------------------------------------------------------------------------
create or replace function public.qf_claim_automation_job_transport_for_family_v1(
  p_request_id uuid,
  p_worker_id text,
  p_workflow_family text,
  p_body_sha256 text
)
returns table (
  request_id uuid,
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
  v_claim record;
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

  if p_workflow_family is null
     or p_workflow_family not in
        ('client_whatsapp', 'vendor_whatsapp', 'campaign_execution') then
    raise exception 'AUTOMATION_CLAIM_WORKFLOW_FAMILY_INVALID'
      using errcode = 'P0001';
  end if;

  if p_body_sha256 is null
     or p_body_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'AUTOMATION_TRANSPORT_BODY_HASH_INVALID'
      using errcode = 'P0001';
  end if;

  insert into public.automation_transport_requests (
    id,
    worker_id,
    body_sha256
  ) values (
    p_request_id,
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

    -- body_sha256 carries the declared family, so a replay under a DIFFERENT
    -- family cannot inherit this identity.
    if v_request.transport_version <> 1
       or v_request.direction <> 'n8n_to_core'
       or v_request.route_key <> 'claim_v1'
       or v_request.worker_id is distinct from p_worker_id
       or v_request.body_sha256 is distinct from p_body_sha256 then
      raise exception 'AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT'
        using errcode = 'P0001';
    end if;

    if v_request.state = 'processing' then
      raise exception 'AUTOMATION_TRANSPORT_REQUEST_INCOMPLETE_INVARIANT'
        using errcode = 'P0001';
    end if;

    return query
    select
      v_request.id,
      v_request.state,
      true,
      v_request.job_id,
      v_request.action_request_id,
      v_request.attempt_id,
      v_request.attempt_number,
      v_request.max_attempts;
    return;
  end if;

  -- First and only execution opportunity for this signed request identity.
  select * into v_claim
    from public.qf_claim_automation_job_for_family_v1(p_worker_id, p_workflow_family);

  if v_claim.job_id is null then
    update public.automation_transport_requests
       set state = 'empty',
           finalized_at = now()
     where id = p_request_id
     returning * into v_request;
  else
    update public.automation_transport_requests
       set state = 'claimed',
           job_id = v_claim.job_id,
           action_request_id = v_claim.action_request_id,
           attempt_id = v_claim.attempt_id,
           attempt_number = v_claim.attempt_number,
           max_attempts = v_claim.max_attempts,
           finalized_at = now()
     where id = p_request_id
     returning * into v_request;
  end if;

  return query
  select
    v_request.id,
    v_request.state,
    false,
    v_request.job_id,
    v_request.action_request_id,
    v_request.attempt_id,
    v_request.attempt_number,
    v_request.max_attempts;
end;
$$;

comment on function public.qf_claim_automation_job_transport_for_family_v1(uuid, text, text, text) is
  'QF-MVP-50.3/50.4 one-shot signed family-aware transport claim, route identity claim_v1. Exactly one workflow family per request; the family is bound into the signed identity through the caller canonical body hash, so a same-requestId changed-family call conflicts. A duplicate request UUID returns is_replay=true and MUST NOT become an executable envelope.';

revoke all on function public.qf_claim_automation_job_transport_for_family_v1(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_claim_automation_job_transport_for_family_v1(uuid, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Self-verification
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_oid oid;
  v_family text;
begin
  -- 6.1 the map is total over the frozen 14 and fails closed elsewhere
  if public.qf_automation_action_workflow_family_v1('client.lead_confirmation') <> 'client_whatsapp'
     or public.qf_automation_action_workflow_family_v1('vendor.lead_offer') <> 'vendor_whatsapp'
     or public.qf_automation_action_workflow_family_v1('vendor.document_reminder') <> 'vendor_whatsapp'
     or public.qf_automation_action_workflow_family_v1('campaign.execute_recipient') <> 'campaign_execution'
     or public.qf_automation_action_workflow_family_v1('campaign.execute_batch') <> 'campaign_execution' then
    raise exception 'QF-MVP-50.3/50.4 aborted: the action->family map is wrong.'
      using errcode = 'P0001';
  end if;
  if public.qf_automation_action_workflow_family_v1('client.not_a_real_action') is not null
     or public.qf_automation_action_workflow_family_v1('') is not null
     or public.qf_automation_action_workflow_family_v1(null) is not null then
    raise exception 'QF-MVP-50.3/50.4 aborted: an unknown action must map to NULL.'
      using errcode = 'P0001';
  end if;

  -- 6.2 the map covers exactly the 14 action types the DB constraint allows
  select count(*) into v_oid
    from unnest(array[
      'client.lead_confirmation','client.requirement_collection',
      'client.missing_information_reminder','client.matching_update',
      'client.lead_status_update','client.transactional_followup',
      'vendor.lead_offer','vendor.response_reminder','vendor.onboarding_reminder',
      'vendor.document_reminder','vendor.package_expiry_warning',
      'vendor.low_credit_warning','campaign.execute_batch',
      'campaign.execute_recipient']) a(t)
   where public.qf_automation_action_workflow_family_v1(a.t) is null;
  if v_oid <> 0 then
    raise exception 'QF-MVP-50.3/50.4 aborted: % registered action(s) have no family.', v_oid
      using errcode = 'P0001';
  end if;

  -- 6.3 the legacy claim is now client-fenced and still fresh-pending only
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='qf_claim_automation_job_v1';
  if v_def !~ '''client_whatsapp''' then
    raise exception 'QF-MVP-50.3/50.4 aborted: the legacy claim is not client-fenced.'
      using errcode = 'P0001';
  end if;
  if v_def !~ 'j\.status = ''pending''' or v_def ~ 'j\.status = ''retry_scheduled''' then
    raise exception 'QF-MVP-50.3/50.4 aborted: the frozen fresh-claim semantics changed.'
      using errcode = 'P0001';
  end if;
  if v_def !~ 'for update skip locked' or v_def !~ 'j\.attempt_count < j\.max_attempts' then
    raise exception 'QF-MVP-50.3/50.4 aborted: a frozen claim invariant was lost.'
      using errcode = 'P0001';
  end if;

  -- 6.4 the family-aware claim rejects everything but one exact family
  begin
    perform * from public.qf_claim_automation_job_for_family_v1('qf-verify-worker', 'all');
    raise exception 'QF-MVP-50.3/50.4 aborted: a wildcard family was accepted.'
      using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'AUTOMATION_CLAIM_WORKFLOW_FAMILY_INVALID' then raise; end if;
  end;
  begin
    perform * from public.qf_claim_automation_job_for_family_v1('qf-verify-worker', null);
    raise exception 'QF-MVP-50.3/50.4 aborted: a null family was accepted.'
      using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'AUTOMATION_CLAIM_WORKFLOW_FAMILY_INVALID' then raise; end if;
  end;
  begin
    perform * from public.qf_claim_automation_job_for_family_v1(
      'qf-verify-worker', 'client_whatsapp,vendor_whatsapp');
    raise exception 'QF-MVP-50.3/50.4 aborted: a multi-family string was accepted.'
      using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'AUTOMATION_CLAIM_WORKFLOW_FAMILY_INVALID' then raise; end if;
  end;

  -- 6.5 no release / recovery semantics were introduced
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='qf_claim_automation_job_for_family_v1';
  if v_def ~ '''pending''\s*,?\s*$' and v_def ~ 'set status = ''pending''' then
    raise exception 'QF-MVP-50.3/50.4 aborted: a claim release path was introduced.'
      using errcode = 'P0001';
  end if;
  if v_def ~ 'delete from' or v_def ~ 'due_sweep' then
    raise exception 'QF-MVP-50.3/50.4 aborted: recovery semantics must remain QF-MVP-50.5.'
      using errcode = 'P0001';
  end if;

  -- 6.6 the one-claim-per-job invariant is UNCHANGED
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'automation_transport_requests'
       and indexname = 'uq_automation_transport_requests_claim_job'
  ) then
    raise exception 'QF-MVP-50.3/50.4 aborted: claim uniqueness must not be weakened.'
      using errcode = 'P0001';
  end if;

  -- 6.7 privileges: service_role only, on all three new/replaced functions
  for v_family in
    select unnest(array[
      'public.qf_automation_action_workflow_family_v1(text)',
      'public.qf_claim_automation_job_v1(text)',
      'public.qf_claim_automation_job_for_family_v1(text,text)',
      'public.qf_claim_automation_job_transport_for_family_v1(uuid,text,text,text)'])
  loop
    v_oid := to_regprocedure(v_family);
    if v_oid is null then
      raise exception 'QF-MVP-50.3/50.4 aborted: % is missing.', v_family
        using errcode = 'P0001';
    end if;
    if has_function_privilege('anon', v_oid, 'execute')
       or has_function_privilege('authenticated', v_oid, 'execute') then
      raise exception 'QF-MVP-50.3/50.4 aborted: % granted beyond service_role.', v_family
        using errcode = 'P0001';
    end if;
    if not has_function_privilege('service_role', v_oid, 'execute') then
      raise exception 'QF-MVP-50.3/50.4 aborted: service_role lost execute on %.', v_family
        using errcode = 'P0001';
    end if;
  end loop;
end $$;
