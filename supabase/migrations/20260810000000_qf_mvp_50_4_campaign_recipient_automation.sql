-- ============================================================================
-- QF-MVP-50.4 — campaign recipient automation vehicle
--
-- This adds the ORCHESTRATION VEHICLE for campaign execution and nothing else.
-- It creates no campaign audience, no recipient authority, no metrics authority
-- and no second send path.
--
-- WHAT ALREADY EXISTS AND IS REUSED VERBATIM
--   qf_prepare_vendor_campaign_v1        freezes the audience into
--                                        vendor_campaign_audience_members
--                                        (immutable, dense ordinals)
--   vendor_campaigns.revision            the campaign version token
--   qf_approve_vendor_campaign_v1        owner approval
--   qf_handoff_vendor_campaign_intents_v1
--                                        bounded batching (1..500, default 100)
--                                        with per-recipient consent, suppression
--                                        and frequency gating under
--                                        cross-campaign advisory locks, writing
--                                        public.communication_intents
--
-- communication_intents REMAINS the per-recipient business and execution
-- authority. docs/QF-MVP-40-8-CAMPAIGN-RESULT-CONTRACT.md is the binding
-- integration spec: QF-MVP-50 calls buildCampaignExecutionPlan({intentId}),
-- dispatches through the EXISTING CommunicationService outbound path, then
-- calls reconcileCampaignIntent({intentId}). That contract explicitly assigns
-- claiming, batching, scheduling and the per-recipient loop to QF-MVP-50, which
-- is exactly and only what this migration supplies.
--
-- THE VEHICLE: one automation action/job per already-authorized campaign
-- intent, produced in the SAME TRANSACTION as the intent insert. The automation
-- job carries no recipient, template, provider, consent or frequency decision —
-- every one of those was already decided by the handoff and is re-proven by
-- Core at execution time. n8n only claims and drives the intent identity.
--
-- campaign.execute_batch is REGISTERED BUT NOT PRODUCED here: advancing a
-- campaign to its next bounded batch remains the existing Core-owned admin
-- action over qf_handoff_vendor_campaign_intents_v1. Introducing a second
-- fan-out layer would create exactly the parallel authority this phase forbids.
--
-- NON-ACTIONS: no new campaign table, no new audience or snapshot, no campaign
-- status vocabulary change (draft / ready_for_review / approved / cancelled /
-- archived is unchanged, and no running / paused / completed is invented), no
-- pause/resume column, no metrics table, no provider or Meta call, no
-- communication send, no generic QF-MVP-50.5 retry recovery, no due sweep.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Preflight — every authority this vehicle rides on must already exist.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.communication_intents') is null
     or to_regclass('public.vendor_campaigns') is null
     or to_regclass('public.vendor_campaign_audience_members') is null then
    raise exception
      'QF-MVP-50.4 aborted: the campaign/intent authorities are missing.'
      using errcode = 'P0001';
  end if;

  if to_regprocedure('public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text)') is null
     or to_regprocedure('public.qf_prepare_vendor_campaign_v1(uuid,integer,uuid,integer,text,text,text,jsonb,text,jsonb,text)') is null then
    raise exception
      'QF-MVP-50.4 aborted: the campaign preparation/handoff authorities are missing.'
      using errcode = 'P0001';
  end if;

  if to_regprocedure('public.qf_create_automation_action_request_v1(uuid,integer,text,text,text,text,text,text,timestamptz,text,text,jsonb)') is null
     or to_regprocedure('public.qf_create_automation_job_v1(uuid,integer,timestamptz)') is null then
    raise exception
      'QF-MVP-50.4 aborted: the QF-MVP-50.1B automation writers are missing.'
      using errcode = 'P0001';
  end if;

  -- No competing per-recipient campaign authority may exist.
  if to_regclass('public.vendor_campaign_deliveries') is not null
     or to_regclass('public.vendor_campaign_dispatches') is not null
     or to_regclass('public.vendor_campaign_intents') is not null then
    raise exception
      'QF-MVP-50.4 aborted: a second per-recipient campaign authority exists.'
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The campaign recipient producer.
--
--    Keyed by the communication_intent, which is already the Core-authorized
--    per-recipient unit. Because the handoff inserts intents with
--    `on conflict (idempotency_key) do nothing`, a replayed handoff creates no
--    second intent and therefore no second job.
-- ---------------------------------------------------------------------------
create or replace function public.qf_enqueue_campaign_recipient_automation_v1(
  p_intent_id uuid
)
returns public.automation_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_intent public.communication_intents%rowtype;
  v_request public.automation_action_requests%rowtype;
  v_job public.automation_jobs%rowtype;
  v_request_id uuid;
  v_idempotency_key text;
  v_correlation_id text;
  v_now timestamptz := now();
begin
  if p_intent_id is null then
    raise exception 'QF_PRODUCER_ENTITY_REQUIRED' using errcode = 'P0001';
  end if;

  select ci.* into v_intent
    from public.communication_intents ci
   where ci.id = p_intent_id;

  if v_intent.id is null then
    raise exception 'QF_PRODUCER_CAMPAIGN_INTENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- ONLY a campaign intent. Every other aggregate type on this shared outbox
  -- belongs to a different lane and must never gain a campaign job.
  if v_intent.aggregate_type is distinct from 'vendor_campaign' then
    raise exception 'QF_PRODUCER_NOT_A_CAMPAIGN_INTENT' using errcode = 'P0001';
  end if;

  -- The intent identity IS the dedupe identity: one execution vehicle per
  -- Core-authorized recipient intent, for the life of that intent.
  v_idempotency_key :=
    'qf_action_v1:campaign.execute_recipient:communication_intent:' || v_intent.id::text || ':intent';
  v_correlation_id := 'qf_corr_v1:vendor_campaign:' || v_intent.aggregate_id::text;

  select * into v_request
    from public.automation_action_requests
   where idempotency_key = v_idempotency_key;

  if v_request.id is not null then
    select * into v_job
      from public.automation_jobs
     where action_request_id = v_request.id;
    return v_job;
  end if;

  v_request_id := gen_random_uuid();

  -- NOTE the deliberately empty safe context. The recipient, template, channel,
  -- consent scope, snapshot and campaign evidence all already live on the
  -- committed intent row; copying any of them here would create a second,
  -- divergeable copy of campaign truth.
  v_request := public.qf_create_automation_action_request_v1(
    v_request_id,
    1,
    'campaign.execute_recipient',
    'communication_intent',
    v_intent.id::text,
    'core',
    'core_service',
    'qf_core_campaign_recipient_producer',
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
    'qf_core_campaign_recipient_producer',
    'QF_CORE_CAMPAIGN_RECIPIENT_AUTHORIZED'
  );

  v_job := public.qf_create_automation_job_v1(v_request.id, 5, v_now);

  if v_job.id is null then
    raise exception 'QF_PRODUCER_JOB_NOT_CREATED' using errcode = 'P0001';
  end if;

  return v_job;
end;
$$;

comment on function public.qf_enqueue_campaign_recipient_automation_v1(uuid) is
  'QF-MVP-50.4 campaign execution vehicle. One automation job per already-authorized communication_intent of aggregate_type vendor_campaign. Creates no audience, no recipient, no template or provider decision and no second per-recipient authority; the intent remains the authority and Core re-proves consent, suppression and frequency at execution time.';

revoke all on function public.qf_enqueue_campaign_recipient_automation_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_enqueue_campaign_recipient_automation_v1(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Same-transaction production from the existing bounded handoff.
--
--    The trigger is scoped strictly to campaign intents, so the other aggregate
--    types sharing this outbox (lead_assignment, replacement,
--    credit_restoration, lead) are untouched. Batching stays exactly where it
--    already is: inside qf_handoff_vendor_campaign_intents_v1's 1..500 limit.
--    This adds no fan-out of its own.
-- ---------------------------------------------------------------------------
create or replace function public.qf_produce_campaign_recipient_action()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.aggregate_type is distinct from 'vendor_campaign' then
    return new;
  end if;

  perform public.qf_enqueue_campaign_recipient_automation_v1(new.id);
  return new;
end;
$$;

drop trigger if exists trg_qf_produce_campaign_recipient_action on public.communication_intents;
create trigger trg_qf_produce_campaign_recipient_action
  after insert on public.communication_intents
  for each row
  when (new.aggregate_type = 'vendor_campaign')
  execute function public.qf_produce_campaign_recipient_action();

-- ---------------------------------------------------------------------------
-- 4. Self-verification
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  -- 4.1 exactly one campaign producer trigger, on the intent outbox
  select count(*) into v_count
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal
     and t.tgname = 'trg_qf_produce_campaign_recipient_action'
     and c.relname = 'communication_intents';
  if v_count <> 1 then
    raise exception 'QF-MVP-50.4 aborted: expected exactly 1 campaign producer trigger, found %.', v_count
      using errcode = 'P0001';
  end if;

  -- 4.2 the campaign status vocabulary is UNCHANGED — no running/paused/completed
  if exists (
    select 1 from pg_constraint
     where conname = 'vcm_status_check'
       and pg_get_constraintdef(oid) !~
           '''draft''.*''ready_for_review''.*''approved''.*''cancelled''.*''archived'''
  ) then
    raise exception 'QF-MVP-50.4 aborted: the campaign status vocabulary changed.'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from pg_constraint
     where conname = 'vcm_status_check'
       and pg_get_constraintdef(oid) ~ '''running''|''paused''|''completed'''
  ) then
    raise exception 'QF-MVP-50.4 aborted: a new campaign execution status was invented.'
      using errcode = 'P0001';
  end if;

  -- 4.3 no pause/resume column was added to the campaign head
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'vendor_campaigns'
       and column_name in ('paused_at', 'resumed_at', 'paused_by', 'is_paused')
  ) then
    raise exception 'QF-MVP-50.4 aborted: a pause/resume column was added.'
      using errcode = 'P0001';
  end if;

  -- 4.4 the frozen audience remains the only snapshot, and immutable
  if to_regclass('public.vendor_campaign_audience_members') is null then
    raise exception 'QF-MVP-50.4 aborted: the frozen audience table is missing.'
      using errcode = 'P0001';
  end if;
  select count(*) into v_count
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and c.relname = 'vendor_campaign_audience_members'
     and t.tgname = 'trg_vcam_immutable';
  if v_count <> 1 then
    raise exception 'QF-MVP-50.4 aborted: the audience immutability guard is missing.'
      using errcode = 'P0001';
  end if;

  -- 4.5 the bounded handoff is untouched and still the only batching authority
  if to_regprocedure('public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text)') is null then
    raise exception 'QF-MVP-50.4 aborted: the bounded handoff authority is missing.'
      using errcode = 'P0001';
  end if;

  -- 4.6 this migration seeds no automation work
  select count(*) into v_count from public.automation_action_requests
   where requested_by_id = 'qf_core_campaign_recipient_producer';
  if v_count <> 0 then
    raise exception 'QF-MVP-50.4 aborted: producer unexpectedly seeded % request(s).', v_count
      using errcode = 'P0001';
  end if;
end $$;
