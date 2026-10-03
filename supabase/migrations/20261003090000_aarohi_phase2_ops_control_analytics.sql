-- Aarohi Phase 2 operations control + attribution analytics.
-- All execution controls default fail-closed. No provider credential or production activation is stored here.

create table if not exists public.aarohi_runtime_controls (
  tenant_id text primary key default 'quickfurno' check (tenant_id='quickfurno'),
  mode text not null default 'PAUSED'
    check (mode in ('PAUSED','INBOUND_ONLY','ASSISTED_ONLY','GOVERNED_AUTOMATION')),
  discovery_enabled boolean not null default false,
  outbound_enabled boolean not null default false,
  broadcasts_enabled boolean not null default false,
  followups_enabled boolean not null default false,
  whatsapp_enabled boolean not null default false,
  instagram_enabled boolean not null default false,
  facebook_enabled boolean not null default false,
  x_enabled boolean not null default false,
  provider_incident_mode boolean not null default false,
  reason text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (
    mode<>'PAUSED'
    or (
      discovery_enabled=false and outbound_enabled=false and broadcasts_enabled=false
      and followups_enabled=false and whatsapp_enabled=false and instagram_enabled=false
      and facebook_enabled=false and x_enabled=false
    )
  )
);

alter table public.aarohi_runtime_controls enable row level security;
revoke all on public.aarohi_runtime_controls from public,anon,authenticated;
grant select,insert,update on public.aarohi_runtime_controls to service_role;

insert into public.aarohi_runtime_controls(tenant_id)
values ('quickfurno')
on conflict(tenant_id) do nothing;

comment on table public.aarohi_runtime_controls is
  'Core-owned Aarohi operations kill switches. Defaults PAUSED; database guards fail closed when absent/disabled.';

create table if not exists public.aarohi_acquisition_cost_entries (
  id uuid primary key default gen_random_uuid(),
  occurred_on date not null,
  channel text check (channel is null or channel in ('INSTAGRAM','FACEBOOK','X','WHATSAPP','WEBSITE','GOOGLE','JUSTDIAL','INDIAMART','OTHER')),
  source_type text,
  city_id uuid references public.cities(id) on delete set null,
  campaign_id uuid references public.aarohi_campaigns(id) on delete set null,
  amount_minor bigint not null check (amount_minor>=0),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  source_reference text not null,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(source_reference)
);

create index if not exists aarohi_cost_entries_date_idx
  on public.aarohi_acquisition_cost_entries(occurred_on desc);
create index if not exists aarohi_cost_entries_city_idx
  on public.aarohi_acquisition_cost_entries(city_id) where city_id is not null;
create index if not exists aarohi_cost_entries_campaign_idx
  on public.aarohi_acquisition_cost_entries(campaign_id) where campaign_id is not null;

alter table public.aarohi_acquisition_cost_entries enable row level security;
revoke all on public.aarohi_acquisition_cost_entries from public,anon,authenticated;
grant select,insert,update,delete on public.aarohi_acquisition_cost_entries to service_role;

comment on table public.aarohi_acquisition_cost_entries is
  'Operator/imported acquisition spend evidence used only for descriptive cost attribution. No ROI is inferred without recorded cost.';

create or replace function public.qf_aarohi_runtime_channel_enabled_v1(
  p_channel text
) returns boolean
language plpgsql
stable
security definer
set search_path=public
as $$
declare v public.aarohi_runtime_controls;
begin
  select * into v from public.aarohi_runtime_controls where tenant_id='quickfurno';
  if v.tenant_id is null or v.provider_incident_mode=true then return false; end if;
  if p_channel='WHATSAPP' then return v.whatsapp_enabled;
  elsif p_channel='INSTAGRAM' then return v.instagram_enabled;
  elsif p_channel='FACEBOOK' then return v.facebook_enabled;
  elsif p_channel='X' then return v.x_enabled;
  end if;
  return false;
end
$$;
revoke all on function public.qf_aarohi_runtime_channel_enabled_v1(text) from public,anon,authenticated;
grant execute on function public.qf_aarohi_runtime_channel_enabled_v1(text) to service_role;

create or replace function public.qf_aarohi_guard_outreach_runtime_v1()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare v public.aarohi_runtime_controls;
begin
  select * into v from public.aarohi_runtime_controls where tenant_id='quickfurno';
  if v.tenant_id is null then raise exception 'aarohi_runtime_control_missing'; end if;

  if new.state in ('DISPATCH_READY','CLAIMED') then
    if v.mode<>'GOVERNED_AUTOMATION' or v.outbound_enabled=false or v.provider_incident_mode=true then
      raise exception 'aarohi_runtime_outbound_disabled';
    end if;
    if public.qf_aarohi_runtime_channel_enabled_v1(new.channel)=false then
      raise exception 'aarohi_runtime_channel_disabled';
    end if;
    if new.broadcast_batch_id is not null and v.broadcasts_enabled=false then
      raise exception 'aarohi_runtime_broadcasts_disabled';
    end if;
    if coalesce(new.draft_ref,'') like 'system:follow-up:%' and v.followups_enabled=false then
      raise exception 'aarohi_runtime_followups_disabled';
    end if;
  end if;

  if old.state='NEEDS_HUMAN_REVIEW' and new.state='WAITING_REPLY' then
    if v.mode not in ('ASSISTED_ONLY','GOVERNED_AUTOMATION')
       or v.outbound_enabled=false or v.provider_incident_mode=true then
      raise exception 'aarohi_runtime_assisted_outbound_disabled';
    end if;
    if new.channel not in ('INSTAGRAM','FACEBOOK')
       or public.qf_aarohi_runtime_channel_enabled_v1(new.channel)=false then
      raise exception 'aarohi_runtime_assisted_channel_disabled';
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.qf_aarohi_guard_outreach_runtime_v1() from public,anon,authenticated;

drop trigger if exists trg_aarohi_runtime_guard_outreach on public.aarohi_outreach_jobs;
create trigger trg_aarohi_runtime_guard_outreach
before update of state on public.aarohi_outreach_jobs
for each row execute function public.qf_aarohi_guard_outreach_runtime_v1();

create or replace function public.qf_aarohi_guard_discovery_claim_v1()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare v public.aarohi_runtime_controls;
begin
  if new.state='CLAIMED' and old.state is distinct from new.state then
    select * into v from public.aarohi_runtime_controls where tenant_id='quickfurno';
    if v.tenant_id is null
       or v.discovery_enabled=false
       or v.mode not in ('ASSISTED_ONLY','GOVERNED_AUTOMATION') then
      raise exception 'aarohi_runtime_discovery_disabled';
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.qf_aarohi_guard_discovery_claim_v1() from public,anon,authenticated;

drop trigger if exists trg_aarohi_runtime_guard_discovery on public.aarohi_discovery_runs;
create trigger trg_aarohi_runtime_guard_discovery
before update of state on public.aarohi_discovery_runs
for each row execute function public.qf_aarohi_guard_discovery_claim_v1();
