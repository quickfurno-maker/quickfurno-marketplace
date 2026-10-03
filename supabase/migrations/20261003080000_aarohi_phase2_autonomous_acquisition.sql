-- Aarohi Phase 2 autonomous acquisition foundation.
-- Repository/staging capable only. This migration does NOT enable provider access or production sends.

create table if not exists public.aarohi_discovery_connectors (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'quickfurno' check (tenant_id='quickfurno'),
  channel text not null check (channel in ('INSTAGRAM','FACEBOOK','X','GOOGLE','WEBSITE','JUSTDIAL','INDIAMART')),
  provider_key text not null,
  discovery_mode text not null check (discovery_mode in ('ASSISTED_IMPORT','GOVERNED_API','INBOUND_FEED')),
  outreach_mode text not null check (outreach_mode in ('NONE','ASSISTED_FIRST_CONTACT','GOVERNED_API_IF_ELIGIBLE')),
  enabled boolean not null default false,
  provider_ready boolean not null default false,
  schedule_minutes integer not null default 1440 check (schedule_minutes between 60 and 10080),
  daily_candidate_cap integer not null default 250 check (daily_candidate_cap between 1 and 5000),
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,channel,provider_key),
  check (enabled=false or provider_ready=true)
);

create table if not exists public.aarohi_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references public.aarohi_discovery_connectors(id) on delete restrict,
  state text not null default 'QUEUED' check (state in ('QUEUED','CLAIMED','COMPLETED','PARTIAL','FAILED','CANCELLED')),
  query_spec jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  worker_ref text,
  candidate_count integer not null default 0 check (candidate_count>=0),
  promoted_count integer not null default 0 check (promoted_count>=0 and promoted_count<=candidate_count),
  error_code text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists aarohi_discovery_runs_queue_idx
  on public.aarohi_discovery_runs(state,requested_at) where state in ('QUEUED','CLAIMED');

create table if not exists public.aarohi_discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.aarohi_discovery_runs(id) on delete cascade,
  connector_id uuid not null references public.aarohi_discovery_connectors(id) on delete restrict,
  source_type text not null check (source_type in ('GOOGLE','WEBSITE','INSTAGRAM','FACEBOOK','X','JUSTDIAL','INDIAMART','OTHER')),
  external_reference text not null,
  profile_url text,
  business_name text not null,
  normalized_business_name text not null,
  city_hint text,
  category_hint text,
  website text,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  email text,
  confidence smallint not null default 0 check (confidence between 0 and 100),
  safe_metadata jsonb not null default '{}'::jsonb,
  state text not null default 'NEW' check (state in ('NEW','REVIEW','PROMOTED','DUPLICATE','REJECTED')),
  prospect_id uuid references public.aarohi_prospects(id) on delete restrict,
  observed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connector_id,external_reference),
  check ((state='PROMOTED' and prospect_id is not null) or state<>'PROMOTED')
);
create index if not exists aarohi_discovery_candidates_review_idx
  on public.aarohi_discovery_candidates(state,confidence desc,created_at desc);
create index if not exists aarohi_discovery_candidates_business_idx
  on public.aarohi_discovery_candidates(normalized_business_name,city_hint);

create table if not exists public.aarohi_outreach_jobs (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.aarohi_prospects(id) on delete cascade,
  campaign_id uuid references public.aarohi_campaigns(id) on delete set null,
  channel text not null check (channel in ('INSTAGRAM','FACEBOOK','X','WHATSAPP')),
  initiation_mode text not null check (initiation_mode in ('ASSISTED_FIRST_CONTACT','GOVERNED_API_IF_ELIGIBLE','GOVERNED_TEMPLATE')),
  state text not null default 'QUEUED' check (state in (
    'QUEUED','NEEDS_HUMAN_REVIEW','NEEDS_CORE_AUTHORIZATION','AUTHORIZED',
    'DISPATCH_READY','CLAIMED','DISPATCHED','WAITING_REPLY','COMPLETED','BLOCKED','CANCELLED'
  )),
  priority smallint not null default 50 check (priority between 0 and 100),
  scheduled_at timestamptz not null default now(),
  draft_ref text,
  core_authorization_ref text,
  provider_message_ref text,
  worker_ref text,
  execution_token uuid,
  claimed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count>=0),
  max_attempts integer not null default 1 check (max_attempts between 1 and 5),
  last_error_code text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (state not in ('AUTHORIZED','DISPATCH_READY','CLAIMED','DISPATCHED','WAITING_REPLY','COMPLETED') or core_authorization_ref is not null),
  check (state<>'CLAIMED' or (execution_token is not null and worker_ref is not null and claimed_at is not null))
);
create index if not exists aarohi_outreach_jobs_queue_idx
  on public.aarohi_outreach_jobs(state,scheduled_at,priority desc)
  where state in ('QUEUED','NEEDS_HUMAN_REVIEW','NEEDS_CORE_AUTHORIZATION','AUTHORIZED','DISPATCH_READY');

create table if not exists public.aarohi_social_reply_signals (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.aarohi_prospects(id) on delete cascade,
  channel text not null check (channel in ('INSTAGRAM','FACEBOOK','X')),
  external_thread_reference text not null,
  external_message_reference text not null,
  reply_kind text not null check (reply_kind in ('INTERESTED','WHATSAPP_SHARED','STOP','OTHER')),
  whatsapp_hash text check (whatsapp_hash is null or whatsapp_hash ~ '^[0-9a-f]{64}$'),
  safe_summary text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(channel,external_message_reference)
);
create index if not exists aarohi_social_reply_timeline_idx
  on public.aarohi_social_reply_signals(prospect_id,occurred_at desc);

create table if not exists public.aarohi_communication_permissions (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.aarohi_prospects(id) on delete cascade,
  channel text not null check (channel in ('WHATSAPP','INSTAGRAM','FACEBOOK','X')),
  purpose text not null check (purpose in ('ACQUISITION_CONTINUATION','MARKETING_BROADCAST')),
  state text not null check (state in ('GRANTED','REVOKED')),
  destination_hash text check (destination_hash is null or destination_hash ~ '^[0-9a-f]{64}
  prospect_id uuid primary key references public.aarohi_prospects(id) on delete cascade,
  version integer not null default 1 check (version>=1),
  safe_summary text not null default '',
  structured_facts jsonb not null default '{}'::jsonb,
  last_channel text,
  last_event_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on table public.aarohi_memory_snapshots is
  'Non-authoritative, content-minimized cross-channel acquisition context for Aarohi WhatsApp continuity. Core facts remain authoritative elsewhere.';

create table if not exists public.aarohi_broadcast_batches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.aarohi_campaigns(id) on delete restrict,
  channel text not null default 'WHATSAPP' check (channel='WHATSAPP'),
  template_name text not null,
  state text not null default 'DRAFT' check (state in ('DRAFT','READY','QUEUED','RUNNING','COMPLETED','CANCELLED','BLOCKED')),
  scheduled_for timestamptz,
  target_count integer not null default 0 check (target_count>=0),
  authorized_count integer not null default 0 check (authorized_count>=0 and authorized_count<=target_count),
  dispatched_count integer not null default 0 check (dispatched_count>=0 and dispatched_count<=authorized_count),
  failed_count integer not null default 0 check (failed_count>=0 and failed_count<=authorized_count),
  daily_cap integer not null default 1000 check (daily_cap between 1 and 10000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aarohi_broadcast_batches_schedule_idx
  on public.aarohi_broadcast_batches(state,scheduled_for)
  where state in ('READY','QUEUED','RUNNING');

do $$ declare t text; begin
  foreach t in array array[
    'aarohi_discovery_connectors','aarohi_discovery_runs','aarohi_discovery_candidates',
    'aarohi_outreach_jobs','aarohi_social_reply_signals','aarohi_communication_permissions',
    'aarohi_memory_snapshots','aarohi_broadcast_batches'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public,anon,authenticated', t);
    execute format('grant select,insert,update,delete on public.%I to service_role', t);
  end loop;
end $$;

insert into public.aarohi_discovery_connectors(
  tenant_id,channel,provider_key,discovery_mode,outreach_mode,enabled,provider_ready,config
) values
('quickfurno','INSTAGRAM','meta_official','ASSISTED_IMPORT','ASSISTED_FIRST_CONTACT',false,false,'{"arbitrary_browser_cold_dm":false}'::jsonb),
('quickfurno','FACEBOOK','meta_official','ASSISTED_IMPORT','ASSISTED_FIRST_CONTACT',false,false,'{"arbitrary_browser_cold_dm":false}'::jsonb),
('quickfurno','X','x_official','GOVERNED_API','GOVERNED_API_IF_ELIGIBLE',false,false,'{"arbitrary_browser_cold_dm":false}'::jsonb),
('quickfurno','GOOGLE','google_business_discovery','GOVERNED_API','NONE',false,false,'{}'::jsonb),
('quickfurno','WEBSITE','approved_web_discovery','INBOUND_FEED','NONE',false,false,'{}'::jsonb),
('quickfurno','JUSTDIAL','approved_directory_feed','INBOUND_FEED','NONE',false,false,'{}'::jsonb),
('quickfurno','INDIAMART','approved_directory_feed','INBOUND_FEED','NONE',false,false,'{}'::jsonb)
on conflict(tenant_id,channel,provider_key) do nothing;

create or replace function public.qf_aarohi_claim_discovery_run_v1(p_worker_ref text)
returns public.aarohi_discovery_runs
language plpgsql security definer set search_path=public as $$
declare v public.aarohi_discovery_runs;
begin
  if nullif(trim(p_worker_ref),'') is null then raise exception 'worker_ref_required'; end if;
  select * into v from public.aarohi_discovery_runs
    where state='QUEUED' order by requested_at asc,id asc limit 1 for update skip locked;
  if v.id is null then return null; end if;
  update public.aarohi_discovery_runs
    set state='CLAIMED',claimed_at=now(),worker_ref=left(trim(p_worker_ref),128)
    where id=v.id returning * into v;
  return v;
end $$;
revoke all on function public.qf_aarohi_claim_discovery_run_v1(text) from public,anon,authenticated;
grant execute on function public.qf_aarohi_claim_discovery_run_v1(text) to service_role;

create or replace function public.qf_aarohi_claim_social_outreach_v1(p_worker_ref text)
returns public.aarohi_outreach_jobs
language plpgsql security definer set search_path=public as $
declare v public.aarohi_outreach_jobs;
begin
  if nullif(trim(p_worker_ref),'') is null then raise exception 'worker_ref_required'; end if;
  select * into v from public.aarohi_outreach_jobs
    where state='DISPATCH_READY'
      and channel in ('INSTAGRAM','FACEBOOK','X')
      and core_authorization_ref is not null
    order by priority desc,scheduled_at asc,id asc
    limit 1 for update skip locked;
  if v.id is null then return null; end if;
  update public.aarohi_outreach_jobs
    set state='CLAIMED',worker_ref=left(trim(p_worker_ref),128),
        execution_token=gen_random_uuid(),claimed_at=now(),
        attempt_count=attempt_count+1,updated_at=now()
    where id=v.id returning * into v;
  return v;
end $;
revoke all on function public.qf_aarohi_claim_social_outreach_v1(text) from public,anon,authenticated;
grant execute on function public.qf_aarohi_claim_social_outreach_v1(text) to service_role;

create or replace function public.qf_aarohi_complete_social_outreach_v1(
  p_job_id uuid,
  p_execution_token uuid,
  p_outcome text,
  p_provider_message_ref text default null,
  p_error_code text default null
) returns public.aarohi_outreach_jobs
language plpgsql security definer set search_path=public as $
declare v public.aarohi_outreach_jobs;
begin
  if p_outcome not in ('ACCEPTED','DEFINITIVE_FAILURE','UNCERTAIN') then
    raise exception 'outreach_outcome_invalid';
  end if;
  select * into v from public.aarohi_outreach_jobs
    where id=p_job_id for update;
  if v.id is null then raise exception 'outreach_job_not_found'; end if;
  if v.state<>'CLAIMED' or v.execution_token is distinct from p_execution_token then
    raise exception 'outreach_execution_token_mismatch';
  end if;
  if p_outcome='ACCEPTED' then
    if nullif(trim(coalesce(p_provider_message_ref,'')),'') is null then
      raise exception 'outreach_provider_ref_required';
    end if;
    update public.aarohi_outreach_jobs
      set state='WAITING_REPLY',
          provider_message_ref=left(trim(p_provider_message_ref),300),
          execution_token=null,worker_ref=null,claimed_at=null,
          last_error_code=null,updated_at=now()
      where id=p_job_id returning * into v;
  else
    update public.aarohi_outreach_jobs
      set state='BLOCKED',
          execution_token=null,worker_ref=null,claimed_at=null,
          last_error_code=left(coalesce(nullif(trim(p_error_code),''),
            case when p_outcome='UNCERTAIN' then 'PROVIDER_EXECUTION_UNCERTAIN' else 'PROVIDER_DEFINITIVE_FAILURE' end),160),
          updated_at=now()
      where id=p_job_id returning * into v;
  end if;
  return v;
end $;
revoke all on function public.qf_aarohi_complete_social_outreach_v1(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.qf_aarohi_complete_social_outreach_v1(uuid,uuid,text,text,text) to service_role;

create or replace function public.qf_aarohi_cancel_outreach_on_suppression_v1()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.do_not_contact=true or new.ai_paused=true or new.prospect_stage='SUPPRESSED' then
    update public.aarohi_communication_permissions
      set state='REVOKED',revoked_at=coalesce(revoked_at,now()),updated_at=now(),
          evidence_kind='STOP_OR_SUPPRESSION',
          evidence_ref=case when evidence_ref='' then 'core-suppression' else evidence_ref end
      where prospect_id=new.id and state='GRANTED';
    update public.aarohi_outreach_jobs
      set state='CANCELLED',last_error_code='PROSPECT_SUPPRESSED',updated_at=now(),completed_at=now()
      where prospect_id=new.id
        and state not in ('COMPLETED','CANCELLED');
    update public.aarohi_broadcast_batches b
      set state=case when b.state='RUNNING' then 'BLOCKED' else b.state end,updated_at=now()
      where b.id in (
        select distinct j.campaign_id from public.aarohi_outreach_jobs j
        where j.prospect_id=new.id and j.campaign_id is not null
      );
  end if;
  return new;
end $$;
revoke all on function public.qf_aarohi_cancel_outreach_on_suppression_v1() from public,anon,authenticated;

drop trigger if exists trg_aarohi_cancel_outreach_on_suppression on public.aarohi_prospects;
create trigger trg_aarohi_cancel_outreach_on_suppression
after update of do_not_contact,ai_paused,prospect_stage on public.aarohi_prospects
for each row execute function public.qf_aarohi_cancel_outreach_on_suppression_v1();
),
  evidence_kind text not null check (evidence_kind in (
    'SOCIAL_WHATSAPP_SHARE','WHATSAPP_EXPLICIT_OPT_IN','ADMIN_EVIDENCE_IMPORT','STOP_OR_SUPPRESSION'
  )),
  evidence_ref text not null,
  policy_version text not null default 'aarohi-permission-v1',
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(prospect_id,channel,purpose),
  check (
    (state='GRANTED' and granted_at is not null and revoked_at is null)
    or (state='REVOKED' and revoked_at is not null)
  )
);
create index if not exists aarohi_permissions_purpose_idx
  on public.aarohi_communication_permissions(channel,purpose,state,updated_at desc);

create table if not exists public.aarohi_memory_snapshots (
  prospect_id uuid primary key references public.aarohi_prospects(id) on delete cascade,
  version integer not null default 1 check (version>=1),
  safe_summary text not null default '',
  structured_facts jsonb not null default '{}'::jsonb,
  last_channel text,
  last_event_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on table public.aarohi_memory_snapshots is
  'Non-authoritative, content-minimized cross-channel acquisition context for Aarohi WhatsApp continuity. Core facts remain authoritative elsewhere.';

create table if not exists public.aarohi_broadcast_batches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.aarohi_campaigns(id) on delete restrict,
  channel text not null default 'WHATSAPP' check (channel='WHATSAPP'),
  template_name text not null,
  state text not null default 'DRAFT' check (state in ('DRAFT','READY','QUEUED','RUNNING','COMPLETED','CANCELLED','BLOCKED')),
  scheduled_for timestamptz,
  target_count integer not null default 0 check (target_count>=0),
  authorized_count integer not null default 0 check (authorized_count>=0 and authorized_count<=target_count),
  dispatched_count integer not null default 0 check (dispatched_count>=0 and dispatched_count<=authorized_count),
  failed_count integer not null default 0 check (failed_count>=0 and failed_count<=authorized_count),
  daily_cap integer not null default 1000 check (daily_cap between 1 and 10000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aarohi_broadcast_batches_schedule_idx
  on public.aarohi_broadcast_batches(state,scheduled_for)
  where state in ('READY','QUEUED','RUNNING');

do $$ declare t text; begin
  foreach t in array array[
    'aarohi_discovery_connectors','aarohi_discovery_runs','aarohi_discovery_candidates',
    'aarohi_outreach_jobs','aarohi_social_reply_signals','aarohi_memory_snapshots',
    'aarohi_broadcast_batches'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public,anon,authenticated', t);
    execute format('grant select,insert,update,delete on public.%I to service_role', t);
  end loop;
end $$;

insert into public.aarohi_discovery_connectors(
  tenant_id,channel,provider_key,discovery_mode,outreach_mode,enabled,provider_ready,config
) values
('quickfurno','INSTAGRAM','meta_official','ASSISTED_IMPORT','ASSISTED_FIRST_CONTACT',false,false,'{"arbitrary_browser_cold_dm":false}'::jsonb),
('quickfurno','FACEBOOK','meta_official','ASSISTED_IMPORT','ASSISTED_FIRST_CONTACT',false,false,'{"arbitrary_browser_cold_dm":false}'::jsonb),
('quickfurno','X','x_official','GOVERNED_API','GOVERNED_API_IF_ELIGIBLE',false,false,'{"arbitrary_browser_cold_dm":false}'::jsonb),
('quickfurno','GOOGLE','google_business_discovery','GOVERNED_API','NONE',false,false,'{}'::jsonb),
('quickfurno','WEBSITE','approved_web_discovery','INBOUND_FEED','NONE',false,false,'{}'::jsonb),
('quickfurno','JUSTDIAL','approved_directory_feed','INBOUND_FEED','NONE',false,false,'{}'::jsonb),
('quickfurno','INDIAMART','approved_directory_feed','INBOUND_FEED','NONE',false,false,'{}'::jsonb)
on conflict(tenant_id,channel,provider_key) do nothing;

create or replace function public.qf_aarohi_claim_discovery_run_v1(p_worker_ref text)
returns public.aarohi_discovery_runs
language plpgsql security definer set search_path=public as $$
declare v public.aarohi_discovery_runs;
begin
  if nullif(trim(p_worker_ref),'') is null then raise exception 'worker_ref_required'; end if;
  select * into v from public.aarohi_discovery_runs
    where state='QUEUED' order by requested_at asc,id asc limit 1 for update skip locked;
  if v.id is null then return null; end if;
  update public.aarohi_discovery_runs
    set state='CLAIMED',claimed_at=now(),worker_ref=left(trim(p_worker_ref),128)
    where id=v.id returning * into v;
  return v;
end $$;
revoke all on function public.qf_aarohi_claim_discovery_run_v1(text) from public,anon,authenticated;
grant execute on function public.qf_aarohi_claim_discovery_run_v1(text) to service_role;

create or replace function public.qf_aarohi_cancel_outreach_on_suppression_v1()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.do_not_contact=true or new.ai_paused=true or new.prospect_stage='SUPPRESSED' then
    update public.aarohi_outreach_jobs
      set state='CANCELLED',last_error_code='PROSPECT_SUPPRESSED',updated_at=now(),completed_at=now()
      where prospect_id=new.id
        and state not in ('COMPLETED','CANCELLED');
    update public.aarohi_broadcast_batches b
      set state=case when b.state='RUNNING' then 'BLOCKED' else b.state end,updated_at=now()
      where b.id in (
        select distinct j.campaign_id from public.aarohi_outreach_jobs j
        where j.prospect_id=new.id and j.campaign_id is not null
      );
  end if;
  return new;
end $$;
revoke all on function public.qf_aarohi_cancel_outreach_on_suppression_v1() from public,anon,authenticated;

drop trigger if exists trg_aarohi_cancel_outreach_on_suppression on public.aarohi_prospects;
create trigger trg_aarohi_cancel_outreach_on_suppression
after update of do_not_contact,ai_paused,prospect_stage on public.aarohi_prospects
for each row execute function public.qf_aarohi_cancel_outreach_on_suppression_v1();
