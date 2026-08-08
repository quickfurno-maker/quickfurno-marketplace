-- ============================================================================
-- QF-MVP-50.3 — vendor automation producer
--
-- DB-native, same-transaction producer for the FIVE active vendor workflows,
-- built on the frozen QF-MVP-50.1B/50.2 automation substrate. Nothing here
-- reopens QF-MVP-50.2.
--
-- ACTIVE PRODUCER SCOPE (owner-locked)
--   vendor.lead_offer             immediate on a real lead_assignments INSERT
--   vendor.response_reminder      +2h and +24h from that same assignment
--   vendor.onboarding_reminder    +24h from vendor_crm_profiles INSERT
--   vendor.package_expiry_warning -7d and -1d from vendors.package_expires_at
--   vendor.low_credit_warning     on a real threshold CROSSING, config-driven
--
-- REGISTERED BUT NOT PRODUCIBLE
--   vendor.document_reminder — reason NO_CANONICAL_VENDOR_DOCUMENT_DOMAIN.
--   QuickFurno has no vendor document/KYC domain: no documents table, no
--   document status vocabulary, no document expiry column, no required-document
--   concept. KYC/document storage is explicitly out of scope in the CRM
--   foundation. There is therefore no truthful trigger, and this producer
--   REFUSES the action outright rather than inventing document truth. It stays
--   in the frozen 14-action registry so a future, separately authorized phase
--   can activate it through a governed change.
--
-- NO VENDOR ACCEPT / REJECT. QuickFurno has no accept, reject or decline
-- concept for an assigned lead and must never gain one. vendor.lead_offer is a
-- ONE-WAY TRANSACTIONAL ASSIGNMENT NOTIFICATION; vendor.response_reminder means
-- ONLY "an assigned lead has not progressed past vendor_status = 'New'". Neither
-- creates a decision state, a decision endpoint, or an acceptance/rejection
-- measure. `vendors.accepting_leads` remains an availability toggle and is not
-- a lead accept/reject feature.
--
-- NON-ACTIONS: no HTTP call, webhook, n8n workflow, provider/Meta call,
-- communication send, credit/package/assignment mutation, campaign schema,
-- historical migration edit, generic QF-MVP-50.5 retry recovery, or due sweep.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Preflight — the frozen substrate this producer writes through must exist.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.qf_create_automation_action_request_v1(uuid,integer,text,text,text,text,text,text,timestamptz,text,text,jsonb)') is null
     or to_regprocedure('public.qf_decide_automation_action_request_v1(uuid,text,text,text,text,text)') is null
     or to_regprocedure('public.qf_create_automation_job_v1(uuid,integer,timestamptz)') is null then
    raise exception
      'QF-MVP-50.3 aborted: the QF-MVP-50.1B automation writers are missing.'
      using errcode = 'P0001';
  end if;

  -- The 50.1B dedupe authorities this producer relies on.
  if not exists (select 1 from pg_indexes where schemaname='public'
                  and indexname='uq_automation_action_requests_idempotency')
     or not exists (select 1 from pg_indexes where schemaname='public'
                  and indexname='uq_automation_jobs_action_request') then
    raise exception
      'QF-MVP-50.3 aborted: the 50.1B uniqueness authorities are missing.'
      using errcode = 'P0001';
  end if;

  if to_regclass('public.automation_policy_configs') is null
     or to_regclass('public.automation_policy_active_configs') is null then
    raise exception
      'QF-MVP-50.3 aborted: the automation policy config tables are missing.'
      using errcode = 'P0001';
  end if;

  -- A vendor document/KYC domain must still be absent. If one is ever added,
  -- this migration must be revisited rather than silently staying non-producible.
  if to_regclass('public.vendor_documents') is not null then
    raise exception
      'QF-MVP-50.3 aborted: a vendor document domain now exists; vendor.document_reminder producibility must be re-decided.'
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. OWNER POLICY — low-credit warning threshold, CONFIG-DRIVEN.
--
--    The threshold is 3 remaining credits and it lives in the existing
--    automation_policy_configs authority. It is deliberately NOT a constant in
--    automation runtime code: the producer and the execution-time reproof both
--    read this row. The pre-existing `remaining_credits <= 3` expressions in
--    admin/UI read code are historical supporting evidence only and are left
--    untouched by this package.
-- ---------------------------------------------------------------------------
with inserted_config as (
  insert into public.automation_policy_configs (
    policy_key, policy_version, config_json, config_fingerprint, created_by
  )
  values (
    'vendor_low_credit_warning_threshold',
    'vendor_low_credit_warning_threshold_v1',
    '{"policyVersion":"vendor_low_credit_warning_threshold_v1","thresholdCredits":3}'::jsonb,
    'ae4192b16847ccbd545c492a0213422ade4e5c0b3b51556743cc00bd4172372c',
    'qf_mvp_50_3_vendor_automation_seed'
  )
  on conflict (policy_key, config_fingerprint) do nothing
  returning id, policy_key
),
selected_config as (
  select id, policy_key from inserted_config
  union all
  select id, policy_key
    from public.automation_policy_configs
   where policy_key = 'vendor_low_credit_warning_threshold'
     and config_fingerprint = 'ae4192b16847ccbd545c492a0213422ade4e5c0b3b51556743cc00bd4172372c'
   limit 1
)
insert into public.automation_policy_active_configs (policy_key, config_id, activated_by)
select policy_key, id, 'qf_mvp_50_3_vendor_automation_seed'
  from selected_config
 limit 1
on conflict (policy_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The configured threshold reader. ONE definition, used by the producer AND
--    by the execution-time reproof, so the two can never disagree.
-- ---------------------------------------------------------------------------
create or replace function public.qf_vendor_low_credit_threshold_v1()
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select (c.config_json ->> 'thresholdCredits')::integer
    from public.automation_policy_active_configs a
    join public.automation_policy_configs c
      on c.id = a.config_id
     and c.policy_key = a.policy_key
   where a.policy_key = 'vendor_low_credit_warning_threshold';
$$;

comment on function public.qf_vendor_low_credit_threshold_v1() is
  'QF-MVP-50.3 owner policy: the low-credit warning threshold, read from automation_policy_configs. NULL means unconfigured, and an unconfigured threshold produces no warning (fail closed) rather than falling back to a hard-coded number.';

revoke all on function public.qf_vendor_low_credit_threshold_v1() from public, anon, authenticated, service_role;
grant execute on function public.qf_vendor_low_credit_threshold_v1() to service_role;

-- ---------------------------------------------------------------------------
-- 4. The atomic vendor producer.
--
--    Same shape as the frozen QF-MVP-50.2 client producer: it takes no business
--    authority from its caller, hard-codes the entity vocabulary, refuses any
--    action outside the active five, and writes exclusively through the adopted
--    50.1B request/decision/job writers inside the caller's transaction.
-- ---------------------------------------------------------------------------
create or replace function public.qf_enqueue_vendor_automation_v1(
  p_action_type     text,
  p_entity_type     text,
  p_entity_id       uuid,
  p_source_event_key text,
  p_available_at    timestamptz default now()
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
  -- Exactly the FIVE active vendor actions. There is no default branch and no
  -- prefix parsing. vendor.document_reminder is deliberately EXCLUDED: with no
  -- vendor document/KYC domain in QuickFurno there is no truthful trigger, so
  -- it is unproducible by construction rather than by convention.
  if p_action_type is null or p_action_type not in (
    'vendor.lead_offer',
    'vendor.response_reminder',
    'vendor.onboarding_reminder',
    'vendor.package_expiry_warning',
    'vendor.low_credit_warning'
  ) then
    if p_action_type = 'vendor.document_reminder' then
      raise exception 'QF_PRODUCER_VENDOR_DOCUMENT_DOMAIN_ABSENT'
        using errcode = 'P0001';
    end if;
    raise exception 'QF_PRODUCER_ACTION_NOT_VENDOR_DISPATCHABLE'
      using errcode = 'P0001';
  end if;

  -- Closed entity vocabulary. An assignment-scoped action is keyed by the
  -- assignment so its execution-time reproof reads exactly one row; a
  -- vendor-scoped action is keyed by the vendor.
  if p_entity_type is null or p_entity_type not in ('vendor', 'lead_assignment') then
    raise exception 'QF_PRODUCER_ENTITY_TYPE_INVALID' using errcode = 'P0001';
  end if;
  if (p_action_type in ('vendor.lead_offer', 'vendor.response_reminder')
        and p_entity_type <> 'lead_assignment')
     or (p_action_type in ('vendor.onboarding_reminder',
                           'vendor.package_expiry_warning',
                           'vendor.low_credit_warning')
        and p_entity_type <> 'vendor') then
    raise exception 'QF_PRODUCER_ENTITY_TYPE_MISMATCH' using errcode = 'P0001';
  end if;

  if p_entity_id is null then
    raise exception 'QF_PRODUCER_ENTITY_REQUIRED' using errcode = 'P0001';
  end if;

  -- Bounded, safe-identifier source-event token — identical convention to the
  -- frozen client producer, so business text can never reach the key directly.
  if p_source_event_key is null
     or p_source_event_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'QF_PRODUCER_SOURCE_EVENT_KEY_INVALID' using errcode = 'P0001';
  end if;

  if p_available_at is null then
    raise exception 'QF_PRODUCER_AVAILABLE_AT_REQUIRED' using errcode = 'P0001';
  end if;

  v_idempotency_key :=
    'qf_action_v1:' || p_action_type || ':' || p_entity_type || ':'
    || p_entity_id::text || ':' || p_source_event_key;
  v_correlation_id := 'qf_corr_v1:' || p_entity_type || ':' || p_entity_id::text;

  -- DURABLE DEDUPE via the adopted 50.1B uniqueness authority.
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

  v_request := public.qf_create_automation_action_request_v1(
    v_request_id,
    1,
    p_action_type,
    p_entity_type,
    p_entity_id::text,
    'core',
    'core_service',
    'qf_core_vendor_automation_producer',
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
    'qf_core_vendor_automation_producer',
    'QF_CORE_VENDOR_LIFECYCLE_EVENT'
  );

  v_job := public.qf_create_automation_job_v1(v_request.id, 5, p_available_at);

  if v_job.id is null then
    raise exception 'QF_PRODUCER_JOB_NOT_CREATED' using errcode = 'P0001';
  end if;

  return v_job;
end;
$$;

comment on function public.qf_enqueue_vendor_automation_v1(text, text, uuid, text, timestamptz) is
  'QF-MVP-50.3 atomic vendor automation producer. Runs inside the business statement transaction, accepts no recipient/template/provider/consent authority, and refuses vendor.document_reminder because QuickFurno has no vendor document/KYC domain. No accept/reject concept exists.';

revoke all on function public.qf_enqueue_vendor_automation_v1(text, text, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_enqueue_vendor_automation_v1(text, text, uuid, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. TRIGGER 1 — a real lead assignment.
--
--    ONE immediate assignment notification plus EXACTLY TWO reminders at +2h
--    and +24h. Each is an independent durable job with its own dedupe identity,
--    so the pair can never become a repeating loop.
-- ---------------------------------------------------------------------------
create or replace function public.qf_produce_vendor_assignment_actions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.vendor_id is null then
    return new;
  end if;

  -- One-way transactional assignment notice. It never asks the vendor to accept
  -- or reject, and creates no decision state.
  perform public.qf_enqueue_vendor_automation_v1(
    'vendor.lead_offer', 'lead_assignment', new.id, 'assigned', now());

  -- "Still at vendor_status = 'New'" reminders. Exactly two, never a third.
  perform public.qf_enqueue_vendor_automation_v1(
    'vendor.response_reminder', 'lead_assignment', new.id, 'resp2h',
    now() + interval '2 hours');
  perform public.qf_enqueue_vendor_automation_v1(
    'vendor.response_reminder', 'lead_assignment', new.id, 'resp24h',
    now() + interval '24 hours');

  return new;
end;
$$;

drop trigger if exists trg_qf_produce_vendor_assignment_actions on public.lead_assignments;
create trigger trg_qf_produce_vendor_assignment_actions
  after insert on public.lead_assignments
  for each row
  execute function public.qf_produce_vendor_assignment_actions();

-- ---------------------------------------------------------------------------
-- 6. TRIGGER 2 — onboarding has not progressed.
--
--    EXACTLY ONE reminder, +24h from CRM profile creation. The execution-time
--    reproof sends only while onboarding_stage is still the exact initial
--    persisted stage recorded here, so a vendor who progresses at all is never
--    reminded. No completeness score, no new boolean, no new state machine.
-- ---------------------------------------------------------------------------
create or replace function public.qf_produce_vendor_onboarding_reminder()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- Only a profile that starts at the canonical initial stage can fail to
  -- progress from it. A row created already past 'new' is never reminded.
  if new.onboarding_stage is distinct from 'new' then
    return new;
  end if;

  perform public.qf_enqueue_vendor_automation_v1(
    'vendor.onboarding_reminder', 'vendor', new.vendor_id, 'onbnew24h',
    now() + interval '24 hours');

  return new;
end;
$$;

drop trigger if exists trg_qf_produce_vendor_onboarding_reminder on public.vendor_crm_profiles;
create trigger trg_qf_produce_vendor_onboarding_reminder
  after insert on public.vendor_crm_profiles
  for each row
  execute function public.qf_produce_vendor_onboarding_reminder();

-- ---------------------------------------------------------------------------
-- 7. TRIGGER 3 — package expiry warnings at exactly -7d and -1d.
--
--    The dedupe identity binds the vendor, the exact expiry instant and the
--    window, so a renewal that moves package_expires_at produces a NEW pair and
--    leaves the old pair to fail its execution-time reproof and no-send.
--    A warning whose scheduled moment has already passed is not enqueued.
-- ---------------------------------------------------------------------------
create or replace function public.qf_produce_vendor_package_expiry_warnings()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_expiry timestamptz := new.package_expires_at;
  v_stamp text;
begin
  if v_expiry is null then
    return new;
  end if;

  -- Only a vendor holding an active package is warned about its expiry.
  if new.package_status is distinct from 'active' then
    return new;
  end if;

  -- Bounded safe token for the exact expiry instant. This is what makes a
  -- renewal a genuinely different warning identity.
  v_stamp := to_char(v_expiry at time zone 'UTC', 'YYYYMMDDHH24MISS');

  if v_expiry - interval '7 days' > now() then
    perform public.qf_enqueue_vendor_automation_v1(
      'vendor.package_expiry_warning', 'vendor', new.id,
      'pkgexp7d.' || v_stamp, v_expiry - interval '7 days');
  end if;

  if v_expiry - interval '1 day' > now() then
    perform public.qf_enqueue_vendor_automation_v1(
      'vendor.package_expiry_warning', 'vendor', new.id,
      'pkgexp1d.' || v_stamp, v_expiry - interval '1 day');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_qf_produce_vendor_package_expiry_warnings on public.vendors;
create trigger trg_qf_produce_vendor_package_expiry_warnings
  after update of package_expires_at on public.vendors
  for each row
  when (new.package_expires_at is distinct from old.package_expires_at)
  execute function public.qf_produce_vendor_package_expiry_warnings();

-- ---------------------------------------------------------------------------
-- 8. TRIGGER 4 — low credit, on a REAL threshold crossing only.
--
--    Fires only when the balance was ABOVE the configured threshold and lands
--    AT OR BELOW it. 2 -> 1 and 1 -> 0 are not crossings and warn nothing. A
--    recharge back above the threshold RE-ARMS the warning, and the crossing
--    identity is stamped with the transaction so a later genuine crossing is a
--    genuinely new action.
--
--    An unconfigured threshold warns nothing. It never falls back to a literal.
-- ---------------------------------------------------------------------------
create or replace function public.qf_produce_vendor_low_credit_warning()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_threshold integer := public.qf_vendor_low_credit_threshold_v1();
  v_old integer := old.remaining_credits;
  v_new integer := new.remaining_credits;
begin
  if v_threshold is null or v_old is null or v_new is null then
    return new;
  end if;

  -- THE CROSSING. Above -> at-or-below, and nothing else.
  if not (v_old > v_threshold and v_new <= v_threshold) then
    return new;
  end if;

  perform public.qf_enqueue_vendor_automation_v1(
    'vendor.low_credit_warning', 'vendor', new.id,
    'lowcred.' || md5(new.id::text || ':' || v_old::text || ':' || v_new::text
                      || ':' || txid_current()::text),
    now());

  return new;
end;
$$;

drop trigger if exists trg_qf_produce_vendor_low_credit_warning on public.vendors;
create trigger trg_qf_produce_vendor_low_credit_warning
  after update of remaining_credits on public.vendors
  for each row
  when (new.remaining_credits is distinct from old.remaining_credits)
  execute function public.qf_produce_vendor_low_credit_warning();

-- ---------------------------------------------------------------------------
-- 9. Self-verification
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
  v_threshold integer;
begin
  -- 9.1 expected 4 vendor producer triggers
  select count(*) into v_count
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and t.tgname like 'trg_qf_produce_vendor_%';
  if v_count <> 4 then
    raise exception 'QF-MVP-50.3 aborted: expected 4 vendor producer triggers, found %.', v_count
      using errcode = 'P0001';
  end if;

  -- 9.2 the owner threshold is configured and is exactly 3
  v_threshold := public.qf_vendor_low_credit_threshold_v1();
  if v_threshold is distinct from 3 then
    raise exception 'QF-MVP-50.3 aborted: low-credit threshold must be the owner-locked 3, found %.',
      coalesce(v_threshold::text, 'NULL') using errcode = 'P0001';
  end if;

  -- 9.3 vendor.document_reminder is refused by the producer
  begin
    perform public.qf_enqueue_vendor_automation_v1(
      'vendor.document_reminder', 'vendor', gen_random_uuid(), 'probe', now());
    raise exception 'QF-MVP-50.3 aborted: vendor.document_reminder must not be producible.'
      using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'QF_PRODUCER_VENDOR_DOCUMENT_DOMAIN_ABSENT' then
        raise;
      end if;
  end;

  -- 9.4 this producer seeds no automation work and no communication row
  select count(*) into v_count from public.automation_action_requests
   where requested_by_id = 'qf_core_vendor_automation_producer';
  if v_count <> 0 then
    raise exception 'QF-MVP-50.3 aborted: producer unexpectedly seeded % request(s).', v_count
      using errcode = 'P0001';
  end if;

  -- 9.5 the frozen client producer and the 50.2 claim repair are untouched
  if to_regprocedure('public.qf_enqueue_client_automation_v1(text,uuid,text,timestamptz)') is null
     or to_regprocedure('public.qf_claim_automation_job_v1(text)') is null
     or to_regprocedure('public.qf_record_automation_execution_transport_v1(uuid,text,text,uuid,uuid)') is null then
    raise exception 'QF-MVP-50.3 aborted: a frozen QF-MVP-50.2 primitive is missing.'
      using errcode = 'P0001';
  end if;

  -- 9.6 no vendor accept/reject state was introduced anywhere
  --
  -- EXACTLY ONE EXEMPTION: public.vendors.accepting_leads. That column is a
  -- VENDOR AVAILABILITY toggle -- "this vendor is currently open to new leads" --
  -- created by the pre-baseline migration 20260706000140_vendor_accepting_leads.sql
  -- and load-bearing in preferred/manual assignment, the credit wallet RPC, the
  -- canonical assignment authority and the public projection. It is NOT per-lead
  -- acceptance, rejection, decline, vendor decision state or an acceptance
  -- workflow, and this migration introduces none of those. The header of this
  -- file already states that distinction; the exemption below makes the guard
  -- agree with it. The exemption is deliberately keyed to that one exact
  -- table+column pair, so every other accept/reject-style lead column -- on
  -- vendors or anywhere else in public -- still aborts this migration.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and (column_name ilike '%accept%lead%'
         or column_name ilike '%lead%accept%'
         or column_name ilike '%reject%lead%'
         or column_name ilike '%lead%reject%'
         or column_name in ('acceptance_rate', 'rejection_rate'))
       and not (
         table_name = 'vendors'
         and column_name = 'accepting_leads'
       )
  ) then
    raise exception 'QF-MVP-50.3 aborted: a vendor accept/reject column exists.'
      using errcode = 'P0001';
  end if;
end $$;
