-- Aarohi Phase 2 scale-governance hardening.
-- All autonomous controls default OFF/UNKNOWN. No provider credential or send authority is created here.

create table if not exists public.aarohi_acquisition_city_policies (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null unique references public.cities(id) on delete restrict,
  enabled boolean not null default false,
  discovery_enabled boolean not null default false,
  outreach_enabled boolean not null default false,
  broadcasts_enabled boolean not null default false,
  timezone text not null default 'Asia/Kolkata',
  quiet_start time not null default time '21:00',
  quiet_end time not null default time '09:00',
  daily_discovery_cap integer not null default 250 check (daily_discovery_cap between 1 and 5000),
  daily_outreach_cap integer not null default 100 check (daily_outreach_cap between 1 and 5000),
  categories jsonb not null default '[]'::jsonb,
  autonomy_level smallint not null default 0 check (autonomy_level between 0 and 4),
  policy_reference text not null default 'phase2-disabled-default',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not enabled or discovery_enabled or outreach_enabled or broadcasts_enabled)
);
create index if not exists aarohi_city_policy_created_by_idx
  on public.aarohi_acquisition_city_policies(created_by) where created_by is not null;

create table if not exists public.aarohi_channel_eligibility (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.aarohi_prospects(id) on delete cascade,
  channel text not null check (channel in ('INSTAGRAM','FACEBOOK','X','WHATSAPP')),
  state text not null check (state in ('UNKNOWN','ELIGIBLE','INELIGIBLE')),
  provider_key text,
  evidence_kind text not null,
  evidence_ref text not null,
  observed_at timestamptz not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(prospect_id,channel),
  check (state<>'ELIGIBLE' or expires_at is null or expires_at>observed_at)
);
create index if not exists aarohi_channel_eligibility_expiry_idx
  on public.aarohi_channel_eligibility(channel,state,expires_at);

create table if not exists public.aarohi_channel_capacity_snapshots (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('WHATSAPP','INSTAGRAM','FACEBOOK','X')),
  provider_key text not null,
  provider_account_id uuid references public.communication_provider_accounts(id) on delete restrict,
  state text not null check (state in ('UNKNOWN','GREEN','YELLOW','RED')),
  daily_limit integer check (daily_limit is null or daily_limit>=0),
  used_today integer not null default 0 check (used_today>=0),
  reserved_for_main integer not null default 0 check (reserved_for_main>=0),
  acquisition_available integer not null default 0 check (acquisition_available>=0),
  reason_code text,
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at>observed_at),
  check (daily_limit is null or used_today<=daily_limit),
  check (daily_limit is null or acquisition_available<=greatest(daily_limit-used_today-reserved_for_main,0))
);
create index if not exists aarohi_capacity_latest_idx
  on public.aarohi_channel_capacity_snapshots(channel,provider_key,observed_at desc);
create index if not exists aarohi_capacity_provider_account_idx
  on public.aarohi_channel_capacity_snapshots(provider_account_id) where provider_account_id is not null;

create table if not exists public.aarohi_followup_policies (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('INSTAGRAM','FACEBOOK','X','WHATSAPP')),
  trigger_stage text not null,
  enabled boolean not null default false,
  delay_minutes integer not null check (delay_minutes between 60 and 43200),
  max_attempts integer not null default 1 check (max_attempts between 1 and 10),
  policy_reference text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel,trigger_stage)
);
create index if not exists aarohi_followup_policy_created_by_idx
  on public.aarohi_followup_policies(created_by) where created_by is not null;

alter table public.aarohi_discovery_runs
  add column if not exists city_id uuid references public.cities(id) on delete restrict,
  add column if not exists city_policy_id uuid references public.aarohi_acquisition_city_policies(id) on delete restrict;
create index if not exists aarohi_discovery_runs_city_idx
  on public.aarohi_discovery_runs(city_id,requested_at desc) where city_id is not null;
create index if not exists aarohi_discovery_runs_city_policy_idx
  on public.aarohi_discovery_runs(city_policy_id) where city_policy_id is not null;

alter table public.aarohi_outreach_jobs
  add column if not exists city_id uuid references public.cities(id) on delete restrict,
  add column if not exists eligibility_ref uuid references public.aarohi_channel_eligibility(id) on delete restrict,
  add column if not exists capacity_snapshot_id uuid references public.aarohi_channel_capacity_snapshots(id) on delete restrict,
  add column if not exists broadcast_batch_id uuid references public.aarohi_broadcast_batches(id) on delete set null;
create index if not exists aarohi_outreach_jobs_city_idx
  on public.aarohi_outreach_jobs(city_id,scheduled_at) where city_id is not null;
create index if not exists aarohi_outreach_jobs_eligibility_idx
  on public.aarohi_outreach_jobs(eligibility_ref) where eligibility_ref is not null;
create index if not exists aarohi_outreach_jobs_capacity_idx
  on public.aarohi_outreach_jobs(capacity_snapshot_id) where capacity_snapshot_id is not null;
create index if not exists aarohi_outreach_jobs_broadcast_batch_idx
  on public.aarohi_outreach_jobs(broadcast_batch_id) where broadcast_batch_id is not null;

alter table public.aarohi_broadcast_batches
  add column if not exists city_id uuid references public.cities(id) on delete restrict,
  add column if not exists capacity_snapshot_id uuid references public.aarohi_channel_capacity_snapshots(id) on delete restrict;
create index if not exists aarohi_broadcast_batches_city_idx
  on public.aarohi_broadcast_batches(city_id) where city_id is not null;
create index if not exists aarohi_broadcast_batches_capacity_idx
  on public.aarohi_broadcast_batches(capacity_snapshot_id) where capacity_snapshot_id is not null;

do $$
declare t text;
begin
  foreach t in array array[
    'aarohi_acquisition_city_policies',
    'aarohi_channel_eligibility',
    'aarohi_channel_capacity_snapshots',
    'aarohi_followup_policies'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
  end loop;
end
$$;

insert into public.aarohi_acquisition_city_policies(city_id)
select c.id
from public.cities c
where c.is_active=true
on conflict(city_id) do nothing;

comment on table public.aarohi_acquisition_city_policies is
  'Admin-owned multi-city acquisition policy. Every seeded city starts disabled.';
comment on table public.aarohi_channel_eligibility is
  'Current channel-initiation eligibility evidence. UNKNOWN or expired eligibility fails closed.';
comment on table public.aarohi_channel_capacity_snapshots is
  'Short-lived provider/capacity evidence used only as a gate; credentials never belong here.';
comment on table public.aarohi_followup_policies is
  'Explicit operator follow-up cadence. No row or disabled row means no automatic follow-up.';


create or replace function public.qf_aarohi_is_quiet_time_v1(
  p_now timestamptz,
  p_timezone text,
  p_quiet_start time,
  p_quiet_end time
) returns boolean
language plpgsql
stable
set search_path=public
as $$
declare v_local time;
begin
  v_local:=(p_now at time zone p_timezone)::time;
  if p_quiet_start=p_quiet_end then return false; end if;
  if p_quiet_start<p_quiet_end then
    return v_local>=p_quiet_start and v_local<p_quiet_end;
  end if;
  return v_local>=p_quiet_start or v_local<p_quiet_end;
end
$$;
revoke all on function public.qf_aarohi_is_quiet_time_v1(timestamptz,text,time,time)
  from public,anon,authenticated;

create or replace function public.qf_aarohi_authorize_outreach_v1(
  p_job_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_job public.aarohi_outreach_jobs;
  v_prospect public.aarohi_prospects;
  v_city public.aarohi_acquisition_city_policies;
  v_capacity public.aarohi_channel_capacity_snapshots;
  v_eligibility public.aarohi_channel_eligibility;
  v_permission public.aarohi_communication_permissions;
  v_frequency public.communication_frequency_policies;
  v_frequency_count integer;
  v_recent_count integer;
  v_last_contact timestamptz;
  v_purpose text;
  v_auth_ref text;
begin
  select * into v_job from public.aarohi_outreach_jobs
    where id=p_job_id for update;
  if v_job.id is null then
    return jsonb_build_object('allowed',false,'reason','JOB_NOT_FOUND');
  end if;
  if v_job.state<>'NEEDS_CORE_AUTHORIZATION' then
    return jsonb_build_object('allowed',false,'reason','JOB_STATE_INVALID');
  end if;

  select * into v_prospect from public.aarohi_prospects
    where id=v_job.prospect_id;
  if v_prospect.id is null
     or v_prospect.do_not_contact=true
     or v_prospect.ai_paused=true
     or v_prospect.human_takeover=true
     or v_prospect.prospect_stage='SUPPRESSED' then
    return jsonb_build_object('allowed',false,'reason','PROSPECT_NOT_ACTIONABLE');
  end if;

  select * into v_city from public.aarohi_acquisition_city_policies
    where city_id=v_prospect.city_id;
  if v_city.id is null or v_city.enabled=false or v_city.outreach_enabled=false then
    return jsonb_build_object('allowed',false,'reason','CITY_OUTREACH_DISABLED');
  end if;
  if public.qf_aarohi_is_quiet_time_v1(now(),v_city.timezone,v_city.quiet_start,v_city.quiet_end) then
    return jsonb_build_object('allowed',false,'reason','QUIET_HOURS');
  end if;

  select * into v_capacity
    from public.aarohi_channel_capacity_snapshots
    where channel=v_job.channel
      and expires_at>now()
      and state in ('GREEN','YELLOW')
      and acquisition_available>0
    order by observed_at desc,id desc
    limit 1;
  if v_capacity.id is null then
    return jsonb_build_object('allowed',false,'reason','CAPACITY_UNAVAILABLE');
  end if;

  if v_job.channel in ('INSTAGRAM','FACEBOOK','X') then
    if v_job.draft_ref='system:request-whatsapp-continuation' then
      if not exists (
        select 1 from public.aarohi_social_reply_signals s
        where s.prospect_id=v_job.prospect_id
          and s.channel=v_job.channel
          and s.reply_kind in ('INTERESTED','WHATSAPP_SHARED')
      ) then
        return jsonb_build_object('allowed',false,'reason','SOCIAL_REPLY_REQUIRED');
      end if;
    elsif v_job.channel='X' then
      select * into v_eligibility
        from public.aarohi_channel_eligibility
        where prospect_id=v_job.prospect_id
          and channel='X'
          and state='ELIGIBLE'
          and (expires_at is null or expires_at>now())
        limit 1;
      if v_eligibility.id is null then
        return jsonb_build_object('allowed',false,'reason','X_ELIGIBILITY_REQUIRED');
      end if;
    else
      return jsonb_build_object('allowed',false,'reason','ASSISTED_FIRST_CONTACT_REQUIRED');
    end if;
  elsif v_job.channel='WHATSAPP' then
    v_purpose:=case when coalesce(v_job.draft_ref,'') like 'template:%'
      then 'MARKETING_BROADCAST' else 'ACQUISITION_CONTINUATION' end;

    select * into v_permission
      from public.aarohi_communication_permissions
      where prospect_id=v_job.prospect_id
        and channel='WHATSAPP'
        and purpose=v_purpose
        and state='GRANTED'
      limit 1;
    if v_permission.id is null then
      return jsonb_build_object('allowed',false,'reason','WHATSAPP_PERMISSION_REQUIRED');
    end if;

    select count(*),min(p.id)
      into v_frequency_count,v_frequency.id
      from public.communication_frequency_policies p
      where p.channel='whatsapp'
        and p.scope='marketing'
        and p.is_active=true
        and p.effective_from<=now()
        and (p.effective_to is null or p.effective_to>now());
    if v_frequency_count<>1 then
      return jsonb_build_object(
        'allowed',false,
        'reason',case when v_frequency_count=0
          then 'FREQUENCY_POLICY_NOT_CONFIGURED' else 'FREQUENCY_POLICY_AMBIGUOUS' end
      );
    end if;
    select * into v_frequency
      from public.communication_frequency_policies where id=v_frequency.id;

    select count(*),max(j.updated_at)
      into v_recent_count,v_last_contact
      from public.aarohi_outreach_jobs j
      where j.prospect_id=v_job.prospect_id
        and j.channel='WHATSAPP'
        and j.provider_message_ref is not null
        and j.updated_at>=now()-v_frequency.window_length;
    if v_recent_count>=v_frequency.max_per_window then
      return jsonb_build_object('allowed',false,'reason','FREQUENCY_WINDOW_EXHAUSTED');
    end if;
    if v_last_contact is not null and v_last_contact>now()-v_frequency.min_interval then
      return jsonb_build_object('allowed',false,'reason','FREQUENCY_MIN_INTERVAL');
    end if;

    if v_purpose='MARKETING_BROADCAST' and v_city.broadcasts_enabled=false then
      return jsonb_build_object('allowed',false,'reason','CITY_BROADCASTS_DISABLED');
    end if;
  else
    return jsonb_build_object('allowed',false,'reason','CHANNEL_UNSUPPORTED');
  end if;

  if (
    select count(*) from public.aarohi_outreach_jobs j
    where j.city_id=v_prospect.city_id
      and j.updated_at>=date_trunc('day',now() at time zone v_city.timezone) at time zone v_city.timezone
      and j.state in ('CLAIMED','DISPATCHED','WAITING_REPLY','COMPLETED')
  )>=v_city.daily_outreach_cap then
    return jsonb_build_object('allowed',false,'reason','CITY_DAILY_OUTREACH_CAP');
  end if;

  v_auth_ref:='core:aarohi-outreach:'||v_job.id::text||':'||
    extract(epoch from clock_timestamp())::bigint::text;

  update public.aarohi_outreach_jobs
    set state='DISPATCH_READY',
        city_id=v_prospect.city_id,
        eligibility_ref=case when v_job.channel='X' then v_eligibility.id else null end,
        capacity_snapshot_id=v_capacity.id,
        core_authorization_ref=v_auth_ref,
        last_error_code=null,
        updated_at=now()
    where id=v_job.id;

  if v_job.broadcast_batch_id is not null then
    update public.aarohi_broadcast_batches b
      set authorized_count=(
        select count(*) from public.aarohi_outreach_jobs j
        where j.broadcast_batch_id=b.id
          and j.state in ('DISPATCH_READY','CLAIMED','DISPATCHED','WAITING_REPLY','COMPLETED')
      ),
      capacity_snapshot_id=v_capacity.id,
      city_id=v_prospect.city_id,
      updated_at=now()
      where b.id=v_job.broadcast_batch_id;
  end if;

  return jsonb_build_object(
    'allowed',true,
    'authorizationRef',v_auth_ref,
    'capacitySnapshotId',v_capacity.id,
    'cityId',v_prospect.city_id
  );
end
$$;
revoke all on function public.qf_aarohi_authorize_outreach_v1(uuid)
  from public,anon,authenticated;
grant execute on function public.qf_aarohi_authorize_outreach_v1(uuid)
  to service_role;

create or replace function public.qf_aarohi_claim_whatsapp_outreach_v1(
  p_worker_ref text
) returns public.aarohi_outreach_jobs
language plpgsql
security definer
set search_path=public
as $$
declare
  v public.aarohi_outreach_jobs;
  v_city public.aarohi_acquisition_city_policies;
  v_capacity public.aarohi_channel_capacity_snapshots;
begin
  if nullif(trim(p_worker_ref),'') is null then raise exception 'worker_ref_required'; end if;

  select j.* into v
  from public.aarohi_outreach_jobs j
  join public.aarohi_prospects p on p.id=j.prospect_id
  join public.aarohi_acquisition_city_policies cp on cp.city_id=p.city_id
  join public.aarohi_channel_capacity_snapshots cs on cs.id=j.capacity_snapshot_id
  where j.state='DISPATCH_READY'
    and j.channel='WHATSAPP'
    and j.core_authorization_ref is not null
    and p.do_not_contact=false
    and p.ai_paused=false
    and p.human_takeover=false
    and p.prospect_stage<>'SUPPRESSED'
    and cp.enabled=true
    and cp.outreach_enabled=true
    and cs.expires_at>now()
    and cs.state in ('GREEN','YELLOW')
    and cs.acquisition_available>0
  order by j.priority desc,j.scheduled_at asc,j.id asc
  limit 1
  for update of j skip locked;

  if v.id is null then return null; end if;
  select * into v_city from public.aarohi_acquisition_city_policies where city_id=v.city_id;
  if public.qf_aarohi_is_quiet_time_v1(now(),v_city.timezone,v_city.quiet_start,v_city.quiet_end) then
    return null;
  end if;
  select * into v_capacity from public.aarohi_channel_capacity_snapshots where id=v.capacity_snapshot_id;
  if v_capacity.id is null or v_capacity.expires_at<=now() then return null; end if;

  update public.aarohi_outreach_jobs
    set state='CLAIMED',
        worker_ref=left(trim(p_worker_ref),128),
        execution_token=gen_random_uuid(),
        claimed_at=now(),
        attempt_count=attempt_count+1,
        updated_at=now()
    where id=v.id
    returning * into v;
  return v;
end
$$;
revoke all on function public.qf_aarohi_claim_whatsapp_outreach_v1(text)
  from public,anon,authenticated;
grant execute on function public.qf_aarohi_claim_whatsapp_outreach_v1(text)
  to service_role;

create or replace function public.qf_aarohi_complete_whatsapp_outreach_v1(
  p_job_id uuid,
  p_execution_token uuid,
  p_outcome text,
  p_provider_message_ref text default null,
  p_error_code text default null
) returns public.aarohi_outreach_jobs
language plpgsql
security definer
set search_path=public
as $$
declare v public.aarohi_outreach_jobs;
begin
  if p_outcome not in ('ACCEPTED','DEFINITIVE_FAILURE','UNCERTAIN') then
    raise exception 'outreach_outcome_invalid';
  end if;
  select * into v from public.aarohi_outreach_jobs where id=p_job_id for update;
  if v.id is null then raise exception 'outreach_job_not_found'; end if;
  if v.channel<>'WHATSAPP' or v.state<>'CLAIMED'
     or v.execution_token is distinct from p_execution_token then
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
            case when p_outcome='UNCERTAIN'
              then 'PROVIDER_EXECUTION_UNCERTAIN' else 'PROVIDER_DEFINITIVE_FAILURE' end),160),
          updated_at=now()
      where id=p_job_id returning * into v;
  end if;

  if v.broadcast_batch_id is not null then
    update public.aarohi_broadcast_batches b
      set dispatched_count=(
        select count(*) from public.aarohi_outreach_jobs j
        where j.broadcast_batch_id=b.id and j.provider_message_ref is not null
      ),
      failed_count=(
        select count(*) from public.aarohi_outreach_jobs j
        where j.broadcast_batch_id=b.id and j.state='BLOCKED'
      ),
      updated_at=now()
      where b.id=v.broadcast_batch_id;
  end if;
  return v;
end
$$;
revoke all on function public.qf_aarohi_complete_whatsapp_outreach_v1(uuid,uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.qf_aarohi_complete_whatsapp_outreach_v1(uuid,uuid,text,text,text)
  to service_role;
