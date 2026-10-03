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
  add column if not exists capacity_snapshot_id uuid references public.aarohi_channel_capacity_snapshots(id) on delete restrict;
create index if not exists aarohi_outreach_jobs_city_idx
  on public.aarohi_outreach_jobs(city_id,scheduled_at) where city_id is not null;
create index if not exists aarohi_outreach_jobs_eligibility_idx
  on public.aarohi_outreach_jobs(eligibility_ref) where eligibility_ref is not null;
create index if not exists aarohi_outreach_jobs_capacity_idx
  on public.aarohi_outreach_jobs(capacity_snapshot_id) where capacity_snapshot_id is not null;

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
