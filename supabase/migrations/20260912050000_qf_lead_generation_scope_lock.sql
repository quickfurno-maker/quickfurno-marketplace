-- ============================================================================
-- QuickFurno final lead-generation scope lock
--
-- QuickFurno owns lead quality through successful delivery to assigned vendors,
-- plus one bounded connection-assurance service: during the first 24 hours the
-- vendor may report whether the client responded; a no-response outcome may
-- schedule at most five assignment-specific client reminders and a future Riya
-- handoff. Quotation, site visit, negotiation, conversion, project execution
-- and payment remain outside QuickFurno. Historical migrations/data stay intact.
-- ============================================================================

begin;

do $preflight$
begin
  if to_regprocedure('public.qf_produce_client_status_actions()') is null then
    raise exception 'QF_LEAD_SCOPE_LOCK: client status producer is missing';
  end if;
  if to_regprocedure('public.qf_produce_vendor_assignment_actions()') is null then
    raise exception 'QF_LEAD_SCOPE_LOCK: vendor assignment producer is missing';
  end if;
  if to_regprocedure('public.qf_enqueue_client_automation_v1(text,uuid,text,timestamptz)') is null then
    raise exception 'QF_LEAD_SCOPE_LOCK: client enqueue function is missing';
  end if;
  if to_regprocedure('public.qf_enqueue_vendor_automation_v1(text,text,uuid,text,timestamptz)') is null then
    raise exception 'QF_LEAD_SCOPE_LOCK: vendor enqueue function is missing';
  end if;
  if to_regclass('public.automation_action_requests') is null then
    raise exception 'QF_LEAD_SCOPE_LOCK: automation_action_requests is missing';
  end if;
  if to_regprocedure('public.qf_automation_vendor_business_state_v1(text,text,text,text)') is null then
    raise exception 'QF_LEAD_SCOPE_LOCK: vendor business-state authority is missing';
  end if;
end;
$preflight$;

-- Final trigger authority: Jarvis/Riya/Anisha remain historical provenance values
-- only. New automation requests originate from Core/admin/system. Vendor response
-- chasing stays retired; the client transactional action is allowed only through
-- the bounded connection-assurance producer/executor. NOT VALID preserves historical
-- rows that were valid under the earlier contract while enforcing all new writes.
alter table public.automation_action_requests
  drop constraint if exists automation_action_requests_source_action_scope_check;

alter table public.automation_action_requests
  add constraint automation_action_requests_source_action_scope_check
  check (
    source in ('core', 'admin', 'system')
    and action_type in (
      'client.lead_confirmation',
      'client.requirement_collection',
      'client.missing_information_reminder',
      'client.matching_update',
      'client.lead_status_update',
      'client.transactional_followup',
      'vendor.lead_offer',
      'vendor.onboarding_reminder',
      'vendor.document_reminder',
      'vendor.package_expiry_warning',
      'vendor.low_credit_warning',
      'campaign.execute_batch',
      'campaign.execute_recipient'
    )
  ) not valid;

-- Bounded post-delivery connection assurance. This is NOT a sales-stage CRM.
create table if not exists public.lead_connection_assurance (
  assignment_id uuid primary key references public.lead_assignments(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  vendor_outcome text not null check (vendor_outcome in ('responded', 'no_response')),
  vendor_reported_at timestamptz not null default now(),
  window_expires_at timestamptz not null,
  client_responded_at timestamptz,
  client_response_source text,
  reminder_limit smallint not null default 5 check (reminder_limit = 5),
  riya_handoff_due_at timestamptz,
  riya_handoff_status text not null default 'not_required'
    check (riya_handoff_status in ('not_required','scheduled','cancelled','ready','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lead_connection_assurance_vendor
  on public.lead_connection_assurance(vendor_id, vendor_reported_at desc);
create index if not exists idx_lead_connection_assurance_riya_due
  on public.lead_connection_assurance(riya_handoff_due_at)
  where riya_handoff_status = 'scheduled' and client_responded_at is null;

alter table public.lead_connection_assurance enable row level security;
revoke all on table public.lead_connection_assurance from public, anon, authenticated, service_role;
grant select, insert, update on table public.lead_connection_assurance to service_role;

create or replace function public.qf_record_vendor_client_response_v1(
  p_vendor_id uuid,
  p_assignment_id uuid,
  p_outcome text
)
returns public.lead_connection_assurance
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_assignment public.lead_assignments%rowtype;
  v_existing public.lead_connection_assurance%rowtype;
  v_result public.lead_connection_assurance%rowtype;
  v_now timestamptz := now();
  v_step integer;
begin
  if p_vendor_id is null or p_assignment_id is null then
    raise exception 'QF_CONNECTION_IDENTITY_REQUIRED' using errcode = 'P0001';
  end if;
  if p_outcome is null or p_outcome not in ('responded', 'no_response') then
    raise exception 'QF_CONNECTION_OUTCOME_INVALID' using errcode = 'P0001';
  end if;
  select * into v_assignment
    from public.lead_assignments
   where id = p_assignment_id and vendor_id = p_vendor_id
   for update;
  if not found or v_assignment.lead_id is null then
    raise exception 'QF_CONNECTION_ASSIGNMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_assignment.assigned_at is null or v_now > v_assignment.assigned_at + interval '24 hours' then
    raise exception 'QF_CONNECTION_WINDOW_CLOSED' using errcode = 'P0001';
  end if;
  select * into v_existing from public.lead_connection_assurance where assignment_id = p_assignment_id;
  if v_existing.assignment_id is not null then
    raise exception 'QF_CONNECTION_RESPONSE_LOCKED' using errcode = 'P0001';
  end if;
  insert into public.lead_connection_assurance (
    assignment_id, lead_id, vendor_id, vendor_outcome, vendor_reported_at,
    window_expires_at, client_responded_at, client_response_source,
    riya_handoff_due_at, riya_handoff_status
  ) values (
    p_assignment_id, v_assignment.lead_id, p_vendor_id, p_outcome, v_now,
    v_assignment.assigned_at + interval '24 hours',
    case when p_outcome = 'responded' then v_now else null end,
    case when p_outcome = 'responded' then 'vendor_confirmation' else null end,
    case when p_outcome = 'no_response' then v_now + interval '120 hours' else null end,
    case when p_outcome = 'no_response' then 'scheduled' else 'not_required' end
  ) returning * into v_result;
  if p_outcome = 'no_response' then
    for v_step in 1..5 loop
      perform public.qf_enqueue_client_automation_v1(
        'client.transactional_followup', v_assignment.lead_id,
        'conn_' || replace(p_assignment_id::text, '-', '') || '_r' || v_step::text,
        v_now + ((v_step - 1) * interval '24 hours')
      );
    end loop;
  end if;
  return v_result;
end;
$$;
revoke all on function public.qf_record_vendor_client_response_v1(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_record_vendor_client_response_v1(uuid, uuid, text) to service_role;

create or replace function public.qf_mark_connection_client_response_v1(p_assignment_id uuid, p_source text)
returns public.lead_connection_assurance
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_result public.lead_connection_assurance%rowtype;
begin
  if p_assignment_id is null or p_source is null or p_source !~ '^[A-Za-z0-9._:-]{1,64}$' then
    raise exception 'QF_CONNECTION_CLIENT_RESPONSE_INVALID' using errcode = 'P0001';
  end if;
  update public.lead_connection_assurance
     set client_responded_at = coalesce(client_responded_at, now()),
         client_response_source = coalesce(client_response_source, p_source),
         riya_handoff_status = case when riya_handoff_status in ('scheduled','ready') then 'cancelled' else riya_handoff_status end,
         updated_at = now()
   where assignment_id = p_assignment_id
   returning * into v_result;
  if v_result.assignment_id is null then
    raise exception 'QF_CONNECTION_ASSURANCE_NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;
revoke all on function public.qf_mark_connection_client_response_v1(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_mark_connection_client_response_v1(uuid, text) to service_role;

create or replace function public.qf_mark_connection_riya_ready_v1(p_assignment_id uuid)
returns public.lead_connection_assurance
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_result public.lead_connection_assurance%rowtype;
begin
  if p_assignment_id is null then
    raise exception 'QF_CONNECTION_IDENTITY_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v_result
    from public.lead_connection_assurance
   where assignment_id = p_assignment_id
   for update;
  if v_result.assignment_id is null then
    raise exception 'QF_CONNECTION_ASSURANCE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_result.client_responded_at is not null then
    raise exception 'QF_CONNECTION_CLIENT_ALREADY_RESPONDED' using errcode = 'P0001';
  end if;
  if v_result.vendor_outcome <> 'no_response'
     or v_result.riya_handoff_status <> 'scheduled'
     or v_result.riya_handoff_due_at is null
     or now() < v_result.riya_handoff_due_at then
    raise exception 'QF_CONNECTION_RIYA_NOT_READY' using errcode = 'P0001';
  end if;
  update public.lead_connection_assurance
     set riya_handoff_status = 'ready', updated_at = now()
   where assignment_id = p_assignment_id
   returning * into v_result;
  return v_result;
end;
$$;
revoke all on function public.qf_mark_connection_riya_ready_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_mark_connection_riya_ready_v1(uuid) to service_role;

-- Historical vendor.response_reminder jobs are permanently outside the final
-- operating scope. Keep the existing 50.7 business-state authority but replace
-- that one branch so database maintenance and TypeScript execution agree.
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
    -- FINAL QUICKFURNO BOUNDARY: once a quality lead is delivered, vendor response
    -- chasing is outside QuickFurno. Every historical correctly-scoped reminder
    -- is stale and must terminalize without communication.
    return 'stale';
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
    v_threshold := public.qf_automation_low_credit_threshold_v1();
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
  'Final QuickFurno lead-generation boundary. Historical vendor.response_reminder is always stale/no-send; remaining vendor maintenance rules preserve the QF-MVP-50.7 authority.';

revoke all on function public.qf_automation_vendor_business_state_v1(text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_automation_vendor_business_state_v1(text, text, text, text)
  to service_role;

-- Client status notifications are allowed only before the vendor/client
-- commercial relationship begins. No transactional sales follow-up is produced.
create or replace function public.qf_produce_client_status_actions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_evidence text;
begin
  v_evidence := md5(
    new.id::text || ':' ||
    coalesce(old.status, '') || ':' ||
    coalesce(new.status, '') || ':' ||
    txid_current()::text
  );

  if new.status is null or new.status not in (
    'Contacted', 'Site Visit Scheduled', 'Quotation Sent', 'Converted', 'Won', 'Lost'
  ) then
    perform public.qf_enqueue_client_automation_v1(
      'client.lead_status_update',
      new.id,
      'status' || v_evidence,
      now()
    );
  end if;

  return null;
end;
$$;

comment on function public.qf_produce_client_status_actions() is
  'Final lead-generation boundary: Core status notifications only before post-delivery commercial activity. No sales follow-up producer.';

revoke all on function public.qf_produce_client_status_actions()
  from public, anon, authenticated, service_role;

-- Assignment creates exactly the delivery notification. The historical +2h/+24h
-- vendor response reminders are retired because QuickFurno work ends at delivery.
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

  perform public.qf_enqueue_vendor_automation_v1(
    'vendor.lead_offer', 'lead_assignment', new.id, 'assigned', now());

  return new;
end;
$$;

comment on function public.qf_produce_vendor_assignment_actions() is
  'Final lead-generation boundary: one-way quality-lead delivery notification only. Vendor response reminders are retired.';

revoke all on function public.qf_produce_vendor_assignment_actions()
  from public, anon, authenticated, service_role;

-- Recreate the trigger against the replacement function explicitly so the
-- intended future producer is obvious and independently verifiable.
drop trigger if exists trg_qf_produce_vendor_assignment_actions on public.lead_assignments;
create trigger trg_qf_produce_vendor_assignment_actions
  after insert on public.lead_assignments
  for each row
  execute function public.qf_produce_vendor_assignment_actions();

do $verify$
declare
  v_client text;
  v_vendor text;
  v_request_scope text;
  v_business text;
  v_connection_record text;
  v_client_response text;
  v_riya_ready text;
begin
  select pg_get_functiondef(to_regprocedure('public.qf_produce_client_status_actions()'))
    into v_client;
  select pg_get_functiondef(to_regprocedure('public.qf_produce_vendor_assignment_actions()'))
    into v_vendor;
  select pg_get_functiondef(to_regprocedure('public.qf_automation_vendor_business_state_v1(text,text,text,text)'))
    into v_business;
  select pg_get_functiondef(to_regprocedure('public.qf_record_vendor_client_response_v1(uuid,uuid,text)'))
    into v_connection_record;
  select pg_get_functiondef(to_regprocedure('public.qf_mark_connection_client_response_v1(uuid,text)'))
    into v_client_response;
  select pg_get_functiondef(to_regprocedure('public.qf_mark_connection_riya_ready_v1(uuid)'))
    into v_riya_ready;
  select pg_get_constraintdef(c.oid)
    into v_request_scope
    from pg_constraint c
    where c.conrelid = 'public.automation_action_requests'::regclass
      and c.conname = 'automation_action_requests_source_action_scope_check';

  if v_client is null or v_vendor is null or v_request_scope is null or v_business is null
     or v_connection_record is null or v_client_response is null or v_riya_ready is null then
    raise exception 'QF_LEAD_SCOPE_LOCK: replacement producer missing';
  end if;
  if position('client.transactional_followup' in v_client) > 0 then
    raise exception 'QF_LEAD_SCOPE_LOCK: client sales follow-up survived';
  end if;
  if position('vendor.response_reminder' in v_vendor) > 0 then
    raise exception 'QF_LEAD_SCOPE_LOCK: vendor response reminder survived';
  end if;
  if position('vendor.lead_offer' in v_vendor) = 0 then
    raise exception 'QF_LEAD_SCOPE_LOCK: lead delivery notification was lost';
  end if;
  if v_business !~* 'if p_action_type = ''vendor\.response_reminder'' then[[:space:]]+return ''stale'';' then
    raise exception 'QF_LEAD_SCOPE_LOCK: response reminder business-state retirement missing';
  end if;
  if position('jarvis' in lower(v_request_scope)) > 0
     or position('riya' in lower(v_request_scope)) > 0
     or position('anisha' in lower(v_request_scope)) > 0 then
    raise exception 'QF_LEAD_SCOPE_LOCK: agent trigger authority survived';
  end if;
  if position('client.transactional_followup' in v_request_scope) = 0 then
    raise exception 'QF_LEAD_SCOPE_LOCK: bounded client connection reminder is not requestable by Core';
  end if;
  if position('vendor.response_reminder' in v_request_scope) > 0 then
    raise exception 'QF_LEAD_SCOPE_LOCK: retired vendor response reminder survived';
  end if;
  if to_regclass('public.lead_connection_assurance') is null then
    raise exception 'QF_LEAD_SCOPE_LOCK: connection assurance table missing';
  end if;
  if position('interval ''24 hours''' in v_connection_record) = 0
     or position('for v_step in 1..5 loop' in lower(v_connection_record)) = 0
     or position('client.transactional_followup' in v_connection_record) = 0
     or position('conn_' in v_connection_record) = 0
     or position('interval ''120 hours''' in v_connection_record) = 0
     or position('QF_CONNECTION_RESPONSE_LOCKED' in v_connection_record) = 0 then
    raise exception 'QF_LEAD_SCOPE_LOCK: bounded connection producer contract drifted';
  end if;
  if position('client_responded_at = coalesce' in v_client_response) = 0
     or position('''cancelled''' in v_client_response) = 0 then
    raise exception 'QF_LEAD_SCOPE_LOCK: client-response cancellation gate missing';
  end if;
  if position('client_responded_at is not null' in lower(v_riya_ready)) = 0
     or position('vendor_outcome <> ''no_response''' in v_riya_ready) = 0
     or position('now() < v_result.riya_handoff_due_at' in lower(v_riya_ready)) = 0
     or position('riya_handoff_status = ''ready''' in v_riya_ready) = 0 then
    raise exception 'QF_LEAD_SCOPE_LOCK: Riya readiness boundary drifted';
  end if;
  if position('Site Visit Scheduled' in v_client) = 0
     or position('Quotation Sent' in v_client) = 0
     or position('Converted' in v_client) = 0
     or position('Won' in v_client) = 0
     or position('Lost' in v_client) = 0 then
    raise exception 'QF_LEAD_SCOPE_LOCK: downstream client-status guard missing';
  end if;
end;
$verify$;

commit;
