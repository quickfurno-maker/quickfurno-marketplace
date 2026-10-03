-- Aarohi Phase 1 omnichannel production activation.
-- Additive and fail-closed: no outbound campaign is enabled by this migration.

create table if not exists public.aarohi_whatsapp_intakes (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null references public.communication_provider_accounts(id) on delete restrict,
  destination_hash text not null check (destination_hash ~ '^[0-9a-f]{64}  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.aarohi_prospects(id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  channel text not null check (channel in ('WHATSAPP','INSTAGRAM','FACEBOOK','X','WEBSITE','MANUAL')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  vendor_id uuid references public.vendors(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((consumed_at is null and vendor_id is null) or (consumed_at is not null and vendor_id is not null))
);

create index if not exists aarohi_registration_intents_open_idx
  on public.aarohi_registration_intents(prospect_id,expires_at)
  where consumed_at is null;

alter table public.aarohi_registration_intents enable row level security;
revoke all on public.aarohi_registration_intents from public,anon,authenticated;
grant select,insert,update on public.aarohi_registration_intents to service_role;

create table if not exists public.aarohi_vendor_conversion_links (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null unique references public.aarohi_prospects(id) on delete restrict,
  vendor_id uuid not null unique references public.vendors(id) on delete restrict,
  registration_intent_id uuid references public.aarohi_registration_intents(id) on delete restrict,
  status text not null default 'LINKED' check (status in ('LINKED','CONVERTED','REVOKED')),
  source text not null check (source in ('REGISTRATION_TOKEN','ADMIN_RECONCILIATION')),
  source_reference text not null,
  created_at timestamptz not null default now(),
  converted_at timestamptz,
  revoked_at timestamptz
);

create index if not exists aarohi_vendor_conversion_status_idx
  on public.aarohi_vendor_conversion_links(status,created_at desc);

alter table public.aarohi_vendor_conversion_links enable row level security;
revoke all on public.aarohi_vendor_conversion_links from public,anon,authenticated;
grant select,insert,update on public.aarohi_vendor_conversion_links to service_role;

alter table public.aarohi_scores
  add column if not exists evidence_readiness_score smallint
    check (evidence_readiness_score between 0 and 9),
  add column if not exists evidence_readiness_version text;

comment on column public.aarohi_scores.evidence_readiness_score is
  'Governed deterministic Aarohi evidence-readiness score (AVG-3, 0..9). Separate from weighted CRM commercial priority.';
comment on table public.aarohi_registration_intents is
  'Opaque expiring Core-owned bridge from Aarohi acquisition to the canonical vendor registration flow. Raw tokens are never stored.';
comment on table public.aarohi_vendor_conversion_links is
  'Authoritative Core correlation proving which canonical vendor originated from which Aarohi prospect. Required before final handoff.';

-- Repurpose the already-connected second conversational account for Aarohi.
-- Provider readiness/billing/health are intentionally not promoted here; those remain operator/provider facts.
update public.communication_provider_accounts
set account_alias='aarohi',
    display_name='QuickFurno Partner — Aarohi Acquisition',
    account_role='conversational',
    jarvis_access_mode='proposal_only',
    is_default_for_role=true,
    metadata=coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
        'lane','acquisition',
        'agent','AAROHI',
        'runtime_activation','enabled_after_application_deploy'
      ),
    updated_at=now()
where provider_key='meta_whatsapp_cloud'
  and channel='whatsapp'
  and account_alias='jarvis'
  and account_role='conversational';

create or replace function public.qf_aarohi_complete_whatsapp_intake_v1(
  p_intake_id uuid,
  p_primary_category text
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_intake public.aarohi_whatsapp_intakes;
  v_existing uuid;
  v_prospect_id uuid;
  v_category text;
begin
  v_category:=left(trim(coalesce(p_primary_category,'')),120);
  if length(v_category)<2 then raise exception 'aarohi_intake_category_required'; end if;

  select * into v_intake
    from public.aarohi_whatsapp_intakes
    where id=p_intake_id
    for update;
  if v_intake.id is null then raise exception 'aarohi_intake_not_found'; end if;
  if v_intake.state='COMPLETE' and v_intake.prospect_id is not null then
    return v_intake.prospect_id;
  end if;
  if v_intake.state<>'AWAITING_CATEGORY'
     or nullif(trim(coalesce(v_intake.business_name,'')),'') is null
     or v_intake.city_id is null then
    raise exception 'aarohi_intake_not_ready';
  end if;

  select ci.prospect_id into v_existing
    from public.aarohi_channel_identities ci
    join public.aarohi_prospects p on p.id=ci.prospect_id
    where ci.channel='WHATSAPP'
      and ci.external_reference=('whatsapp_hash:'||v_intake.destination_hash)
      and p.tenant_id='quickfurno'
      and p.merged_into_prospect_id is null
      and p.do_not_contact=false
      and p.prospect_stage<>'SUPPRESSED'
    order by ci.created_at asc
    limit 1;

  if v_existing is not null then
    update public.aarohi_whatsapp_intakes
      set state='COMPLETE',primary_category=v_category,prospect_id=v_existing,
          completed_at=coalesce(completed_at,now()),updated_at=now()
      where id=v_intake.id;
    return v_existing;
  end if;

  insert into public.aarohi_prospects(
    tenant_id,city_id,business_name,normalized_business_name,primary_category,
    source_confidence,data_confidence,prospect_stage,conversation_stage,
    preferred_channel,last_activity_at
  ) values (
    'quickfurno',v_intake.city_id,trim(v_intake.business_name),
    lower(regexp_replace(trim(v_intake.business_name),'[^a-zA-Z0-9]+',' ','g')),
    v_category,80,60,'CONTACTED','FIRST_CONTACT','WHATSAPP',now()
  ) returning id into v_prospect_id;

  insert into public.aarohi_channel_identities(
    prospect_id,channel,external_reference,display_name,verification_status
  ) values (
    v_prospect_id,'WHATSAPP','whatsapp_hash:'||v_intake.destination_hash,
    trim(v_intake.business_name),'OBSERVED'
  );

  insert into public.aarohi_events(
    prospect_id,event_type,actor_type,actor_reference,channel,safe_summary,
    reference_type,reference_id,event_data
  ) values (
    v_prospect_id,'prospect.whatsapp_intake_completed','CORE','whatsapp-intake','WHATSAPP',
    'Dedicated Aarohi WhatsApp intake created a durable acquisition prospect',
    'whatsapp_intake',v_intake.id::text,
    jsonb_build_object('city_id',v_intake.city_id::text,'category',v_category)
  );

  update public.aarohi_whatsapp_intakes
    set state='COMPLETE',primary_category=v_category,prospect_id=v_prospect_id,
        completed_at=now(),updated_at=now()
    where id=v_intake.id;

  return v_prospect_id;
end
$$;

revoke all on function public.qf_aarohi_complete_whatsapp_intake_v1(uuid,text)
  from public,anon,authenticated;
grant execute on function public.qf_aarohi_complete_whatsapp_intake_v1(uuid,text)
  to service_role;

create or replace function public.qf_aarohi_link_vendor_conversion_v1(
  p_prospect_id uuid,
  p_vendor_id uuid,
  p_registration_intent_id uuid,
  p_source_reference text
) returns public.aarohi_vendor_conversion_links
language plpgsql
security definer
set search_path=public
as $$
declare
  v_prospect public.aarohi_prospects;
  v_vendor public.vendors;
  v_intent public.aarohi_registration_intents;
  v_existing public.aarohi_vendor_conversion_links;
  v_result public.aarohi_vendor_conversion_links;
begin
  select * into v_prospect from public.aarohi_prospects
    where id=p_prospect_id and tenant_id='quickfurno' for update;
  if v_prospect.id is null then raise exception 'aarohi_prospect_not_found'; end if;
  if v_prospect.merged_into_prospect_id is not null
     or v_prospect.do_not_contact is true
     or v_prospect.prospect_stage='SUPPRESSED' then
    raise exception 'aarohi_prospect_not_convertible';
  end if;

  select * into v_vendor from public.vendors where id=p_vendor_id;
  if v_vendor.id is null then raise exception 'canonical_vendor_not_found'; end if;

  select * into v_intent from public.aarohi_registration_intents
    where id=p_registration_intent_id and prospect_id=p_prospect_id for update;
  if v_intent.id is null then raise exception 'aarohi_registration_intent_not_found'; end if;
  if v_intent.expires_at <= now() then raise exception 'aarohi_registration_intent_expired'; end if;
  if v_intent.consumed_at is not null and v_intent.vendor_id <> p_vendor_id then
    raise exception 'aarohi_registration_intent_consumed';
  end if;

  select * into v_existing from public.aarohi_vendor_conversion_links
    where prospect_id=p_prospect_id or vendor_id=p_vendor_id
    order by created_at asc limit 1 for update;

  if v_existing.id is not null then
    if v_existing.prospect_id<>p_prospect_id or v_existing.vendor_id<>p_vendor_id then
      raise exception 'aarohi_vendor_correlation_conflict';
    end if;
    v_result:=v_existing;
  else
    insert into public.aarohi_vendor_conversion_links(
      prospect_id,vendor_id,registration_intent_id,status,source,source_reference
    ) values (
      p_prospect_id,p_vendor_id,p_registration_intent_id,'LINKED','REGISTRATION_TOKEN',
      left(coalesce(p_source_reference,'registration'),240)
    ) returning * into v_result;
  end if;

  update public.aarohi_registration_intents
    set consumed_at=coalesce(consumed_at,now()),vendor_id=p_vendor_id
    where id=p_registration_intent_id;

  update public.aarohi_prospects
    set registration_stage='STARTED',
        prospect_stage=case when prospect_stage in ('DISCOVERED','ENRICHED','QUALIFIED','OUTREACH_READY','CONTACTED','ENGAGED','INTERESTED')
          then 'CONVERSION' else prospect_stage end,
        updated_at=now(),
        last_activity_at=now()
    where id=p_prospect_id;

  update public.aarohi_opportunities
    set core_vendor_id=p_vendor_id,updated_at=now()
    where prospect_id=p_prospect_id and core_vendor_id is null;

  insert into public.aarohi_events(
    prospect_id,event_type,actor_type,actor_reference,safe_summary,
    reference_type,reference_id,event_data
  ) values (
    p_prospect_id,'registration.vendor_correlated','CORE','vendor-registration',
    'Core linked Aarohi prospect to canonical vendor registration',
    'vendor',p_vendor_id::text,
    jsonb_build_object('correlation_id',v_result.id::text)
  );

  return v_result;
end
$$;

revoke all on function public.qf_aarohi_link_vendor_conversion_v1(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.qf_aarohi_link_vendor_conversion_v1(uuid,uuid,uuid,text)
  to service_role;

create or replace function public.qf_aarohi_require_conversion_link_v1()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if not exists (
    select 1 from public.aarohi_vendor_conversion_links l
    where l.prospect_id=new.prospect_id
      and l.vendor_id=new.vendor_id
      and l.status in ('LINKED','CONVERTED')
  ) then
    raise exception 'aarohi_vendor_correlation_required';
  end if;
  return new;
end
$$;

drop trigger if exists trg_aarohi_handoff_requires_conversion on public.aarohi_handoffs;
create trigger trg_aarohi_handoff_requires_conversion
before insert or update of prospect_id,vendor_id on public.aarohi_handoffs
for each row execute function public.qf_aarohi_require_conversion_link_v1();

create or replace function public.qf_aarohi_mark_conversion_complete_v1()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  update public.aarohi_vendor_conversion_links
    set status='CONVERTED',converted_at=coalesce(converted_at,new.completed_at)
    where prospect_id=new.prospect_id and vendor_id=new.vendor_id and status='LINKED';
  return new;
end
$$;

drop trigger if exists trg_aarohi_handoff_marks_conversion on public.aarohi_handoffs;
create trigger trg_aarohi_handoff_marks_conversion
after insert or update of prospect_id,vendor_id on public.aarohi_handoffs
for each row execute function public.qf_aarohi_mark_conversion_complete_v1();

revoke all on function public.qf_aarohi_require_conversion_link_v1() from public,anon,authenticated;
revoke all on function public.qf_aarohi_mark_conversion_complete_v1() from public,anon,authenticated;


create or replace function public.qf_aarohi_try_auto_handoff_v1(p_vendor_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_link public.aarohi_vendor_conversion_links;
  v_vendor public.vendors;
  v_paid boolean;
begin
  select * into v_link
    from public.aarohi_vendor_conversion_links
    where vendor_id=p_vendor_id and status='LINKED'
    for update;
  if v_link.id is null then return false; end if;
  if exists(select 1 from public.aarohi_handoffs where vendor_id=p_vendor_id) then return true; end if;

  select * into v_vendor from public.vendors where id=p_vendor_id;
  if v_vendor.id is null
     or coalesce(v_vendor.status,'')<>'Approved'
     or coalesce(v_vendor.is_active,false) is not true
     or lower(coalesce(v_vendor.verification_status,''))<>'verified' then
    return false;
  end if;

  select exists(
    select 1 from public.vendor_packages vp
      where vp.vendor_id=p_vendor_id
        and lower(coalesce(vp.payment_status,''))='paid'
        and lower(coalesce(vp.status,''))='active'
    union all
    select 1 from public.vendor_package_orders vo
      where vo.vendor_id=p_vendor_id
        and lower(coalesce(vo.payment_status,''))='paid'
        and lower(coalesce(vo.activation_status,''))='activated'
  ) into v_paid;
  if not v_paid then return false; end if;

  perform public.qf_aarohi_complete_handoff_v1(
    v_link.prospect_id,
    p_vendor_id,
    null,
    'core.auto.vendor.'||p_vendor_id::text,
    'auto-handoff.'||v_link.prospect_id::text||'.'||p_vendor_id::text
  );
  return true;
end
$$;

revoke all on function public.qf_aarohi_try_auto_handoff_v1(uuid) from public,anon,authenticated;
grant execute on function public.qf_aarohi_try_auto_handoff_v1(uuid) to service_role;

create or replace function public.qf_aarohi_auto_handoff_from_vendor_v1()
returns trigger language plpgsql set search_path=public as $$
begin
  perform public.qf_aarohi_try_auto_handoff_v1(new.id);
  return new;
end $$;

create or replace function public.qf_aarohi_auto_handoff_from_package_v1()
returns trigger language plpgsql set search_path=public as $$
begin
  perform public.qf_aarohi_try_auto_handoff_v1(new.vendor_id);
  return new;
end $$;

create or replace function public.qf_aarohi_auto_handoff_from_link_v1()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='LINKED' then perform public.qf_aarohi_try_auto_handoff_v1(new.vendor_id); end if;
  return new;
end $$;

drop trigger if exists trg_aarohi_auto_handoff_vendor on public.vendors;
create trigger trg_aarohi_auto_handoff_vendor
after update of status,is_active,verification_status on public.vendors
for each row execute function public.qf_aarohi_auto_handoff_from_vendor_v1();

drop trigger if exists trg_aarohi_auto_handoff_vendor_package on public.vendor_packages;
create trigger trg_aarohi_auto_handoff_vendor_package
after insert or update of payment_status,status on public.vendor_packages
for each row execute function public.qf_aarohi_auto_handoff_from_package_v1();

drop trigger if exists trg_aarohi_auto_handoff_package_order on public.vendor_package_orders;
create trigger trg_aarohi_auto_handoff_package_order
after insert or update of payment_status,activation_status on public.vendor_package_orders
for each row execute function public.qf_aarohi_auto_handoff_from_package_v1();

drop trigger if exists trg_aarohi_auto_handoff_link on public.aarohi_vendor_conversion_links;
create trigger trg_aarohi_auto_handoff_link
after insert or update of status on public.aarohi_vendor_conversion_links
for each row execute function public.qf_aarohi_auto_handoff_from_link_v1();

revoke all on function public.qf_aarohi_auto_handoff_from_vendor_v1() from public,anon,authenticated;
revoke all on function public.qf_aarohi_auto_handoff_from_package_v1() from public,anon,authenticated;
revoke all on function public.qf_aarohi_auto_handoff_from_link_v1() from public,anon,authenticated;
),
  state text not null default 'AWAITING_BUSINESS'
    check (state in ('AWAITING_BUSINESS','AWAITING_CITY','AWAITING_CATEGORY','COMPLETE','CANCELLED')),
  business_name text,
  city_id uuid references public.cities(id) on delete restrict,
  primary_category text,
  prospect_id uuid references public.aarohi_prospects(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(provider_account_id,destination_hash),
  check ((state='COMPLETE' and prospect_id is not null and completed_at is not null) or state<>'COMPLETE')
);

alter table public.aarohi_whatsapp_intakes enable row level security;
revoke all on public.aarohi_whatsapp_intakes from public,anon,authenticated;
grant select,insert,update on public.aarohi_whatsapp_intakes to service_role;

comment on table public.aarohi_whatsapp_intakes is
  'Deterministic first-contact intake for the dedicated Aarohi WhatsApp lane. No model may own an unbound prospect.';

create table if not exists public.aarohi_registration_intents (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.aarohi_prospects(id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  channel text not null check (channel in ('WHATSAPP','INSTAGRAM','FACEBOOK','X','WEBSITE','MANUAL')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  vendor_id uuid references public.vendors(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((consumed_at is null and vendor_id is null) or (consumed_at is not null and vendor_id is not null))
);

create index if not exists aarohi_registration_intents_open_idx
  on public.aarohi_registration_intents(prospect_id,expires_at)
  where consumed_at is null;

alter table public.aarohi_registration_intents enable row level security;
revoke all on public.aarohi_registration_intents from public,anon,authenticated;
grant select,insert,update on public.aarohi_registration_intents to service_role;

create table if not exists public.aarohi_vendor_conversion_links (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null unique references public.aarohi_prospects(id) on delete restrict,
  vendor_id uuid not null unique references public.vendors(id) on delete restrict,
  registration_intent_id uuid references public.aarohi_registration_intents(id) on delete restrict,
  status text not null default 'LINKED' check (status in ('LINKED','CONVERTED','REVOKED')),
  source text not null check (source in ('REGISTRATION_TOKEN','ADMIN_RECONCILIATION')),
  source_reference text not null,
  created_at timestamptz not null default now(),
  converted_at timestamptz,
  revoked_at timestamptz
);

create index if not exists aarohi_vendor_conversion_status_idx
  on public.aarohi_vendor_conversion_links(status,created_at desc);

alter table public.aarohi_vendor_conversion_links enable row level security;
revoke all on public.aarohi_vendor_conversion_links from public,anon,authenticated;
grant select,insert,update on public.aarohi_vendor_conversion_links to service_role;

alter table public.aarohi_scores
  add column if not exists evidence_readiness_score smallint
    check (evidence_readiness_score between 0 and 9),
  add column if not exists evidence_readiness_version text;

comment on column public.aarohi_scores.evidence_readiness_score is
  'Governed deterministic Aarohi evidence-readiness score (AVG-3, 0..9). Separate from weighted CRM commercial priority.';
comment on table public.aarohi_registration_intents is
  'Opaque expiring Core-owned bridge from Aarohi acquisition to the canonical vendor registration flow. Raw tokens are never stored.';
comment on table public.aarohi_vendor_conversion_links is
  'Authoritative Core correlation proving which canonical vendor originated from which Aarohi prospect. Required before final handoff.';

-- Repurpose the already-connected second conversational account for Aarohi.
-- Provider readiness/billing/health are intentionally not promoted here; those remain operator/provider facts.
update public.communication_provider_accounts
set account_alias='aarohi',
    display_name='QuickFurno Partner — Aarohi Acquisition',
    account_role='conversational',
    jarvis_access_mode='proposal_only',
    is_default_for_role=true,
    metadata=coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
        'lane','acquisition',
        'agent','AAROHI',
        'runtime_activation','enabled_after_application_deploy'
      ),
    updated_at=now()
where provider_key='meta_whatsapp_cloud'
  and channel='whatsapp'
  and account_alias='jarvis'
  and account_role='conversational';

create or replace function public.qf_aarohi_link_vendor_conversion_v1(
  p_prospect_id uuid,
  p_vendor_id uuid,
  p_registration_intent_id uuid,
  p_source_reference text
) returns public.aarohi_vendor_conversion_links
language plpgsql
security definer
set search_path=public
as $$
declare
  v_prospect public.aarohi_prospects;
  v_vendor public.vendors;
  v_intent public.aarohi_registration_intents;
  v_existing public.aarohi_vendor_conversion_links;
  v_result public.aarohi_vendor_conversion_links;
begin
  select * into v_prospect from public.aarohi_prospects
    where id=p_prospect_id and tenant_id='quickfurno' for update;
  if v_prospect.id is null then raise exception 'aarohi_prospect_not_found'; end if;
  if v_prospect.merged_into_prospect_id is not null
     or v_prospect.do_not_contact is true
     or v_prospect.prospect_stage='SUPPRESSED' then
    raise exception 'aarohi_prospect_not_convertible';
  end if;

  select * into v_vendor from public.vendors where id=p_vendor_id;
  if v_vendor.id is null then raise exception 'canonical_vendor_not_found'; end if;

  select * into v_intent from public.aarohi_registration_intents
    where id=p_registration_intent_id and prospect_id=p_prospect_id for update;
  if v_intent.id is null then raise exception 'aarohi_registration_intent_not_found'; end if;
  if v_intent.expires_at <= now() then raise exception 'aarohi_registration_intent_expired'; end if;
  if v_intent.consumed_at is not null and v_intent.vendor_id <> p_vendor_id then
    raise exception 'aarohi_registration_intent_consumed';
  end if;

  select * into v_existing from public.aarohi_vendor_conversion_links
    where prospect_id=p_prospect_id or vendor_id=p_vendor_id
    order by created_at asc limit 1 for update;

  if v_existing.id is not null then
    if v_existing.prospect_id<>p_prospect_id or v_existing.vendor_id<>p_vendor_id then
      raise exception 'aarohi_vendor_correlation_conflict';
    end if;
    v_result:=v_existing;
  else
    insert into public.aarohi_vendor_conversion_links(
      prospect_id,vendor_id,registration_intent_id,status,source,source_reference
    ) values (
      p_prospect_id,p_vendor_id,p_registration_intent_id,'LINKED','REGISTRATION_TOKEN',
      left(coalesce(p_source_reference,'registration'),240)
    ) returning * into v_result;
  end if;

  update public.aarohi_registration_intents
    set consumed_at=coalesce(consumed_at,now()),vendor_id=p_vendor_id
    where id=p_registration_intent_id;

  update public.aarohi_prospects
    set registration_stage='STARTED',
        prospect_stage=case when prospect_stage in ('DISCOVERED','ENRICHED','QUALIFIED','OUTREACH_READY','CONTACTED','ENGAGED','INTERESTED')
          then 'CONVERSION' else prospect_stage end,
        updated_at=now(),
        last_activity_at=now()
    where id=p_prospect_id;

  update public.aarohi_opportunities
    set core_vendor_id=p_vendor_id,updated_at=now()
    where prospect_id=p_prospect_id and core_vendor_id is null;

  insert into public.aarohi_events(
    prospect_id,event_type,actor_type,actor_reference,safe_summary,
    reference_type,reference_id,event_data
  ) values (
    p_prospect_id,'registration.vendor_correlated','CORE','vendor-registration',
    'Core linked Aarohi prospect to canonical vendor registration',
    'vendor',p_vendor_id::text,
    jsonb_build_object('correlation_id',v_result.id::text)
  );

  return v_result;
end
$$;

revoke all on function public.qf_aarohi_link_vendor_conversion_v1(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.qf_aarohi_link_vendor_conversion_v1(uuid,uuid,uuid,text)
  to service_role;

create or replace function public.qf_aarohi_require_conversion_link_v1()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if not exists (
    select 1 from public.aarohi_vendor_conversion_links l
    where l.prospect_id=new.prospect_id
      and l.vendor_id=new.vendor_id
      and l.status in ('LINKED','CONVERTED')
  ) then
    raise exception 'aarohi_vendor_correlation_required';
  end if;
  return new;
end
$$;

drop trigger if exists trg_aarohi_handoff_requires_conversion on public.aarohi_handoffs;
create trigger trg_aarohi_handoff_requires_conversion
before insert or update of prospect_id,vendor_id on public.aarohi_handoffs
for each row execute function public.qf_aarohi_require_conversion_link_v1();

create or replace function public.qf_aarohi_mark_conversion_complete_v1()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  update public.aarohi_vendor_conversion_links
    set status='CONVERTED',converted_at=coalesce(converted_at,new.completed_at)
    where prospect_id=new.prospect_id and vendor_id=new.vendor_id and status='LINKED';
  return new;
end
$$;

drop trigger if exists trg_aarohi_handoff_marks_conversion on public.aarohi_handoffs;
create trigger trg_aarohi_handoff_marks_conversion
after insert or update of prospect_id,vendor_id on public.aarohi_handoffs
for each row execute function public.qf_aarohi_mark_conversion_complete_v1();

revoke all on function public.qf_aarohi_require_conversion_link_v1() from public,anon,authenticated;
revoke all on function public.qf_aarohi_mark_conversion_complete_v1() from public,anon,authenticated;
