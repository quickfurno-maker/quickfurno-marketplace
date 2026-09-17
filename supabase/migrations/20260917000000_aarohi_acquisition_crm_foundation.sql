-- QuickFurno Aarohi Acquisition CRM foundation.
-- PRE-ACQUISITION ONLY. This migration never inserts into or mutates public.vendors.
create extension if not exists "pgcrypto";

create table public.aarohi_prospects (
  id uuid primary key default gen_random_uuid(), tenant_id text not null default 'quickfurno',
  city_id uuid not null references public.cities(id), business_name text not null,
  normalized_business_name text not null, primary_category text, subcategories text[] not null default '{}',
  address text, area text, pincode text, state text, website text,
  primary_phone text, whatsapp_available boolean, email text, contact_person_name text, contact_person_role text,
  google_profile_url text, instagram_url text, facebook_url text, linkedin_url text, x_url text,
  source_confidence smallint not null default 0 check (source_confidence between 0 and 100),
  data_confidence smallint not null default 0 check (data_confidence between 0 and 100),
  prospect_stage text not null default 'DISCOVERED' check (prospect_stage in ('DISCOVERED','ENRICHED','QUALIFIED','OUTREACH_READY','CONTACTED','ENGAGED','INTERESTED','CONVERSION','WON','LOST','SUPPRESSED')),
  conversation_stage text not null default 'NONE' check (conversation_stage in ('NONE','FIRST_CONTACT','REPLIED','DISCOVERY','OBJECTION','PITCH','WHATSAPP_HANDOFF','FOLLOW_UP','CLOSING')),
  registration_stage text not null default 'NOT_STARTED' check (registration_stage in ('NOT_STARTED','STARTED','IN_PROGRESS','COMPLETED','BLOCKED')),
  commercial_stage text not null default 'NONE' check (commercial_stage in ('NONE','PACKAGE_INTEREST','PACKAGE_PRESENTED','PACKAGE_SELECTED')),
  payment_stage text not null default 'NONE' check (payment_stage in ('NONE','PENDING','STARTED','PAID','FAILED')),
  agent_owner text not null default 'AAROHI' check (agent_owner in ('AAROHI','ANISHA')),
  human_owner uuid references public.profiles(id) on delete set null,
  priority_band text not null default 'D' check (priority_band in ('A+','A','B','C','D')),
  do_not_contact boolean not null default false, ai_paused boolean not null default false, human_takeover boolean not null default false,
  next_action_type text, next_action_at timestamptz, next_action_reason text,
  preferred_channel text, current_objection text, conversation_summary text, risks_blockers text,
  merged_into_prospect_id uuid references public.aarohi_prospects(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_activity_at timestamptz not null default now()
);
create index aarohi_prospects_pipeline_idx on public.aarohi_prospects(tenant_id,prospect_stage,priority_band,last_activity_at desc);
create index aarohi_prospects_next_action_idx on public.aarohi_prospects(tenant_id,next_action_at) where next_action_at is not null;
create index aarohi_prospects_city_idx on public.aarohi_prospects(city_id,primary_category);

create table public.aarohi_prospect_sources (
 id uuid primary key default gen_random_uuid(), prospect_id uuid not null references public.aarohi_prospects(id) on delete cascade,
 source_type text not null check (source_type in ('GOOGLE','WEBSITE','INSTAGRAM','FACEBOOK','LINKEDIN','X','JUSTDIAL','INDIAMART','MANUAL','CSV','FIRECRAWL','OTHER')),
 source_name text, source_url text, discovery_query text, discovery_batch_id text,
 raw_business_name text, raw_phone text, raw_email text, raw_address text, raw_category text,
 observed_at timestamptz, imported_at timestamptz not null default now(), confidence smallint not null default 0 check (confidence between 0 and 100)
);
create index aarohi_sources_prospect_idx on public.aarohi_prospect_sources(prospect_id,imported_at desc);

create table public.aarohi_channel_identities (
 id uuid primary key default gen_random_uuid(), prospect_id uuid not null references public.aarohi_prospects(id) on delete cascade,
 channel text not null check (channel in ('CALL','WHATSAPP','INSTAGRAM','FACEBOOK','LINKEDIN','X','WEBSITE','PHONE','EMAIL')),
 external_reference text not null, profile_url text, display_name text,
 verification_status text not null default 'UNVERIFIED' check (verification_status in ('UNVERIFIED','OBSERVED','VERIFIED','REJECTED')),
 source_id uuid references public.aarohi_prospect_sources(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(prospect_id,channel,external_reference)
);

create table public.aarohi_conversations (
 id uuid primary key default gen_random_uuid(), prospect_id uuid not null references public.aarohi_prospects(id) on delete cascade,
 channel text not null check (channel in ('CALL','WHATSAPP','INSTAGRAM','FACEBOOK','LINKEDIN','X')),
 external_thread_reference text, state text not null default 'OPEN' check (state in ('OPEN','PAUSED','HUMAN','CLOSED')),
 current_intent text, current_objection text, last_commitment text, next_action text, follow_up_at timestamptz,
 summary text, orchestration_reference text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index aarohi_conversations_prospect_idx on public.aarohi_conversations(prospect_id,updated_at desc);

create table public.aarohi_interactions (
 id uuid primary key default gen_random_uuid(), prospect_id uuid not null references public.aarohi_prospects(id) on delete cascade,
 conversation_id uuid references public.aarohi_conversations(id) on delete set null,
 channel text not null, direction text check (direction in ('INBOUND','OUTBOUND','INTERNAL')),
 actor_type text not null check (actor_type in ('VENDOR','AAROHI','HUMAN','SYSTEM')),
 interaction_type text not null, safe_summary text, external_reference text, occurred_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create index aarohi_interactions_timeline_idx on public.aarohi_interactions(prospect_id,occurred_at desc);
create table public.aarohi_tasks (
 id uuid primary key default gen_random_uuid(), prospect_id uuid not null references public.aarohi_prospects(id) on delete cascade,
 task_type text not null check (task_type in ('CALL','FOLLOW_UP','WHATSAPP','REVIEW','IDENTITY_REVIEW','REGISTRATION_ASSIST','PAYMENT_FOLLOWUP','HUMAN_CALLBACK','OTHER')),
 due_at timestamptz, priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
 reason text, assigned_to uuid references public.profiles(id) on delete set null,
 status text not null default 'OPEN' check (status in ('OPEN','IN_PROGRESS','DONE','CANCELLED','BLOCKED')),
 created_by uuid references public.profiles(id) on delete set null, workflow_reference text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz
);
create index aarohi_tasks_due_idx on public.aarohi_tasks(status,due_at) where status in ('OPEN','IN_PROGRESS','BLOCKED');

create table public.aarohi_opportunities (
 id uuid primary key default gen_random_uuid(), prospect_id uuid not null references public.aarohi_prospects(id) on delete cascade,
 interested_package_id uuid references public.packages(id) on delete set null,
 opportunity_status text not null default 'OPEN' check (opportunity_status in ('OPEN','INTERESTED','PRESENTED','SELECTED','CLOSED_WON','CLOSED_LOST')),
 notes_summary text, core_vendor_id uuid references public.vendors(id) on delete set null,
 core_order_reference uuid references public.vendor_package_orders(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.aarohi_scores (
 id uuid primary key default gen_random_uuid(), prospect_id uuid not null references public.aarohi_prospects(id) on delete cascade,
 qualification_score smallint not null check (qualification_score between 0 and 100),
 contactability_score smallint not null check (contactability_score between 0 and 100),
 engagement_score smallint not null check (engagement_score between 0 and 100),
 commercial_intent_score smallint not null check (commercial_intent_score between 0 and 100),
 data_confidence_score smallint not null check (data_confidence_score between 0 and 100),
 priority_band text not null check (priority_band in ('A+','A','B','C','D')),
 score_version text not null, score_reason_codes text[] not null default '{}', calculated_at timestamptz not null default now(),
 calculated_by text not null default 'AAROHI'
);
create index aarohi_scores_latest_idx on public.aarohi_scores(prospect_id,calculated_at desc);

create table public.aarohi_events (
 id uuid primary key default gen_random_uuid(), tenant_id text not null default 'quickfurno',
 prospect_id uuid references public.aarohi_prospects(id) on delete cascade,
 event_type text not null, actor_type text not null check (actor_type in ('AAROHI','HUMAN','SYSTEM','CORE','JARVIS')),
 actor_reference text, channel text, safe_summary text, reference_type text, reference_id text,
 idempotency_key text, event_data jsonb not null default '{}'::jsonb,
 occurred_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create unique index aarohi_events_idempotency_idx on public.aarohi_events(tenant_id,idempotency_key) where idempotency_key is not null;
create index aarohi_events_timeline_idx on public.aarohi_events(prospect_id,occurred_at desc);

create table public.aarohi_identity_matches (
 id uuid primary key default gen_random_uuid(), prospect_a_id uuid not null references public.aarohi_prospects(id) on delete cascade,
 prospect_b_id uuid not null references public.aarohi_prospects(id) on delete cascade,
 match_score smallint not null check (match_score between 0 and 100), phone_match boolean not null default false,
 domain_match boolean not null default false, name_match boolean not null default false, address_match boolean not null default false,
 social_match boolean not null default false, evidence jsonb not null default '{}'::jsonb,
 status text not null default 'RECOMMENDED' check (status in ('RECOMMENDED','CONFIRMED','REJECTED')),
 reviewed_by uuid references public.profiles(id) on delete set null, reviewed_at timestamptz,
 created_at timestamptz not null default now(), check (prospect_a_id <> prospect_b_id), unique(prospect_a_id,prospect_b_id)
);

create table public.aarohi_campaigns (
 id uuid primary key default gen_random_uuid(), tenant_id text not null default 'quickfurno', name text not null,
 description text, segment_definition jsonb not null default '{}'::jsonb,
 created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(),
 status text not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','PAUSED','COMPLETED','ARCHIVED'))
);
create table public.aarohi_campaign_members (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.aarohi_campaigns(id) on delete cascade,
 prospect_id uuid not null references public.aarohi_prospects(id) on delete cascade,
 added_at timestamptz not null default now(), added_by uuid references public.profiles(id) on delete set null,
 unique(campaign_id,prospect_id)
);

create table public.aarohi_handoffs (
 id uuid primary key default gen_random_uuid(), prospect_id uuid not null references public.aarohi_prospects(id) on delete restrict,
 vendor_id uuid not null references public.vendors(id) on delete restrict,
 handoff_type text not null default 'ACQUISITION_COMPLETE' check (handoff_type='ACQUISITION_COMPLETE'),
 core_reference text not null, completed_at timestamptz not null default now(), completed_by uuid references public.profiles(id) on delete set null,
 unique(prospect_id), unique(vendor_id)
);
-- Browser roles receive no direct Aarohi table access. Server services use service_role.
do $$ declare t text; begin
  foreach t in array array['aarohi_prospects','aarohi_prospect_sources','aarohi_channel_identities','aarohi_interactions','aarohi_conversations','aarohi_tasks','aarohi_opportunities','aarohi_scores','aarohi_events','aarohi_identity_matches','aarohi_campaigns','aarohi_campaign_members','aarohi_handoffs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
revoke update, delete on public.aarohi_events from service_role;
grant select, insert on public.aarohi_events to service_role;

create or replace function public.qf_aarohi_suppress_prospect_v1(
  p_prospect_id uuid, p_actor_id uuid, p_reason text, p_idempotency_key text default null
) returns public.aarohi_prospects language plpgsql security definer set search_path=public as $$
declare v public.aarohi_prospects;
begin
  update public.aarohi_prospects set do_not_contact=true, ai_paused=true,
    prospect_stage='SUPPRESSED', next_action_type=null, next_action_at=null,
    next_action_reason=p_reason, updated_at=now(), last_activity_at=now()
  where id=p_prospect_id returning * into v;
  if v.id is null then raise exception 'aarohi_prospect_not_found'; end if;
  update public.aarohi_tasks set status='CANCELLED', updated_at=now()
    where prospect_id=p_prospect_id and status in ('OPEN','IN_PROGRESS') and task_type in ('CALL','FOLLOW_UP','WHATSAPP');
  insert into public.aarohi_events(prospect_id,event_type,actor_type,actor_reference,safe_summary,idempotency_key)
    values(p_prospect_id,'prospect.suppressed','HUMAN',p_actor_id::text,left(coalesce(p_reason,'Do not contact'),500),p_idempotency_key)
    on conflict (tenant_id,idempotency_key) where idempotency_key is not null do nothing;
  return v;
end $$;
revoke all on function public.qf_aarohi_suppress_prospect_v1(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.qf_aarohi_suppress_prospect_v1(uuid,uuid,text,text) to service_role;

create or replace function public.qf_aarohi_set_human_takeover_v1(
  p_prospect_id uuid, p_actor_id uuid, p_takeover boolean, p_idempotency_key text default null
) returns public.aarohi_prospects language plpgsql security definer set search_path=public as $$
declare v public.aarohi_prospects;
begin
  update public.aarohi_prospects set human_takeover=p_takeover, ai_paused=case when p_takeover then true else ai_paused end,
    human_owner=case when p_takeover then p_actor_id else null end, updated_at=now(), last_activity_at=now()
  where id=p_prospect_id returning * into v;
  if v.id is null then raise exception 'aarohi_prospect_not_found'; end if;
  update public.aarohi_conversations set state=case when p_takeover then 'HUMAN' else 'OPEN' end, updated_at=now()
    where prospect_id=p_prospect_id and state <> 'CLOSED';
  insert into public.aarohi_events(prospect_id,event_type,actor_type,actor_reference,safe_summary,idempotency_key)
    values(p_prospect_id,case when p_takeover then 'human.takeover' else 'human.release' end,'HUMAN',p_actor_id::text,
      case when p_takeover then 'Human operator took control' else 'Human operator released control' end,p_idempotency_key)
    on conflict (tenant_id,idempotency_key) where idempotency_key is not null do nothing;
  return v;
end $$;
revoke all on function public.qf_aarohi_set_human_takeover_v1(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.qf_aarohi_set_human_takeover_v1(uuid,uuid,boolean,text) to service_role;
create or replace function public.qf_aarohi_complete_handoff_v1(
  p_prospect_id uuid, p_vendor_id uuid, p_actor_id uuid, p_core_reference text, p_idempotency_key text default null
) returns public.aarohi_handoffs language plpgsql security definer set search_path=public as $$
declare v_vendor public.vendors; v_handoff public.aarohi_handoffs; v_paid boolean;
begin
  select * into v_vendor from public.vendors where id=p_vendor_id;
  if v_vendor.id is null then raise exception 'canonical_vendor_not_found'; end if;
  if coalesce(v_vendor.status,'') <> 'Approved' or coalesce(v_vendor.is_active,false) is not true
     or lower(coalesce(v_vendor.verification_status,'')) <> 'verified' then
    raise exception 'canonical_vendor_not_active';
  end if;
  select exists(
    select 1 from public.vendor_packages vp where vp.vendor_id=p_vendor_id and lower(coalesce(vp.payment_status,''))='paid' and lower(coalesce(vp.status,''))='active'
    union all
    select 1 from public.vendor_package_orders vo where vo.vendor_id=p_vendor_id and lower(coalesce(vo.payment_status,''))='paid' and lower(coalesce(vo.activation_status,''))='activated'
  ) into v_paid;
  if not v_paid then raise exception 'canonical_package_payment_not_confirmed'; end if;
  insert into public.aarohi_handoffs(prospect_id,vendor_id,core_reference,completed_by)
    values(p_prospect_id,p_vendor_id,p_core_reference,p_actor_id)
    on conflict (prospect_id) do update set vendor_id=excluded.vendor_id, core_reference=excluded.core_reference,
      completed_at=now(), completed_by=excluded.completed_by
    returning * into v_handoff;
  update public.aarohi_prospects set agent_owner='ANISHA', prospect_stage='WON', registration_stage='COMPLETED', payment_stage='PAID',
    ai_paused=true, human_takeover=false, next_action_type=null, next_action_at=null,
    next_action_reason='Acquisition completed; transferred to Vendor CRM', updated_at=now(), last_activity_at=now()
    where id=p_prospect_id;
  if not found then raise exception 'aarohi_prospect_not_found'; end if;
  insert into public.aarohi_events(prospect_id,event_type,actor_type,actor_reference,safe_summary,reference_type,reference_id,idempotency_key)
    values(p_prospect_id,'aarohi.handoff_completed','CORE',p_actor_id::text,'Core confirmed active vendor; acquisition handed to Vendor CRM','vendor',p_vendor_id::text,p_idempotency_key)
    on conflict (tenant_id,idempotency_key) where idempotency_key is not null do nothing;
  return v_handoff;
end $$;
revoke all on function public.qf_aarohi_complete_handoff_v1(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.qf_aarohi_complete_handoff_v1(uuid,uuid,uuid,text,text) to service_role;

create or replace function public.qf_aarohi_confirm_identity_match_v1(
  p_match_id uuid, p_keep_prospect_id uuid, p_actor_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare m public.aarohi_identity_matches; v_drop uuid;
begin
  select * into m from public.aarohi_identity_matches where id=p_match_id for update;
  if m.id is null or m.status <> 'RECOMMENDED' then raise exception 'identity_match_not_reviewable'; end if;
  if p_keep_prospect_id not in (m.prospect_a_id,m.prospect_b_id) then raise exception 'identity_keep_not_in_match'; end if;
  v_drop := case when p_keep_prospect_id=m.prospect_a_id then m.prospect_b_id else m.prospect_a_id end;
  if exists(select 1 from public.aarohi_handoffs where prospect_id in (p_keep_prospect_id,v_drop)) then raise exception 'identity_merge_after_handoff_forbidden'; end if;
  update public.aarohi_prospect_sources set prospect_id=p_keep_prospect_id where prospect_id=v_drop;
  insert into public.aarohi_channel_identities(prospect_id,channel,external_reference,profile_url,display_name,verification_status,source_id,created_at,updated_at)
    select p_keep_prospect_id,channel,external_reference,profile_url,display_name,verification_status,source_id,created_at,updated_at
      from public.aarohi_channel_identities where prospect_id=v_drop on conflict(prospect_id,channel,external_reference) do nothing;
  delete from public.aarohi_channel_identities where prospect_id=v_drop;
  update public.aarohi_conversations set prospect_id=p_keep_prospect_id where prospect_id=v_drop;
  update public.aarohi_interactions set prospect_id=p_keep_prospect_id where prospect_id=v_drop;
  update public.aarohi_tasks set prospect_id=p_keep_prospect_id where prospect_id=v_drop;
  update public.aarohi_opportunities set prospect_id=p_keep_prospect_id where prospect_id=v_drop;
  update public.aarohi_scores set prospect_id=p_keep_prospect_id where prospect_id=v_drop;
  delete from public.aarohi_campaign_members a using public.aarohi_campaign_members b
    where a.prospect_id=v_drop and b.prospect_id=p_keep_prospect_id and a.campaign_id=b.campaign_id;
  update public.aarohi_campaign_members set prospect_id=p_keep_prospect_id where prospect_id=v_drop;
  update public.aarohi_prospects set merged_into_prospect_id=p_keep_prospect_id, prospect_stage='SUPPRESSED', do_not_contact=true,
    ai_paused=true, next_action_at=null, next_action_type=null, updated_at=now() where id=v_drop;
  update public.aarohi_identity_matches set status='CONFIRMED', reviewed_by=p_actor_id, reviewed_at=now() where id=p_match_id;
  insert into public.aarohi_events(prospect_id,event_type,actor_type,actor_reference,safe_summary,reference_type,reference_id)
    values(p_keep_prospect_id,'identity.match_confirmed','HUMAN',p_actor_id::text,'Operator confirmed duplicate identity; provenance preserved','prospect',v_drop::text);
  return p_keep_prospect_id;
end $$;
revoke all on function public.qf_aarohi_confirm_identity_match_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.qf_aarohi_confirm_identity_match_v1(uuid,uuid,uuid) to service_role;

comment on table public.aarohi_prospects is 'Pre-acquisition prospect domain only. Never canonical vendor activation truth.';
comment on table public.aarohi_events is 'Append-only safe acquisition history; conversation content belongs in conversation stores.';
comment on table public.aarohi_handoffs is 'Explicit link from acquisition prospect to canonical active vendor; no vendor copy is created.';
