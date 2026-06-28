-- ============================================================================
-- QuickFurno CRM + Analytics foundation safe placeholders
-- Migration file only. Do not apply automatically.
--
-- Purpose:
-- - Ensure CRM and analytics foundation tables exist if they have not already
--   been created by an earlier migration.
-- - Keep all changes additive and reversible.
-- - Do not rename, delete, or modify existing public lead tables.
-- - Keep RLS enabled with admin-only policy placeholders.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- CRM tables
-- ----------------------------------------------------------------------------
create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lead_id uuid,
  client_name text,
  phone_masked text,
  email_masked text,
  service text,
  category text,
  subcategory text,
  city text,
  area text,
  budget text,
  priority text not null default 'warm',
  status text not null default 'new',
  source text,
  assigned_vendor_count integer not null default 0,
  assigned_to uuid,
  owner text,
  next_follow_up_date timestamptz,
  nurture_stage text,
  nurture_reason text,
  nurture_follow_up_date timestamptz,
  nurture_custom_date_enabled boolean not null default false,
  last_activity_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.crm_lead_notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lead_id uuid,
  note text not null,
  author uuid,
  is_internal boolean not null default true,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.crm_lead_tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lead_id uuid,
  title text not null,
  task_type text,
  due_date timestamptz,
  owner uuid,
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lead_id uuid,
  activity_type text not null,
  summary text not null,
  actor text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.crm_followups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lead_id uuid,
  follow_up_type text not null default 'follow_up',
  scheduled_date timestamptz not null,
  preset text,
  custom_date_enabled boolean not null default false,
  reason text,
  owner uuid,
  status text not null default 'scheduled',
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.crm_calendar_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lead_id uuid,
  title text not null,
  event_type text not null,
  scheduled_at timestamptz not null,
  owner uuid,
  status text not null default 'scheduled',
  notes text,
  google_calendar_event_id text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.crm_sources (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source text not null,
  channel text,
  metadata jsonb not null default '{}'::jsonb
);

-- ----------------------------------------------------------------------------
-- Analytics and attribution tables
-- ----------------------------------------------------------------------------
create table if not exists public.lead_attribution (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lead_id uuid,
  source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  gclid text,
  fbclid text,
  landing_page text,
  referrer text,
  device_type text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.campaign_performance (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  campaign text not null,
  source text,
  spend numeric,
  leads integer not null default 0,
  cpl numeric,
  conversion_rate numeric,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.crm_funnel_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lead_id uuid,
  stage text not null,
  previous_stage text,
  source text,
  metadata jsonb not null default '{}'::jsonb
);

-- Additive safety columns for projects that already have the previous
-- foundation migration applied.
alter table if exists public.crm_leads add column if not exists updated_at timestamptz not null default now();
alter table if exists public.crm_leads add column if not exists category text;
alter table if exists public.crm_lead_notes add column if not exists updated_at timestamptz not null default now();
alter table if exists public.crm_lead_tasks add column if not exists updated_at timestamptz not null default now();
alter table if exists public.crm_activities add column if not exists updated_at timestamptz not null default now();
alter table if exists public.crm_followups add column if not exists updated_at timestamptz not null default now();
alter table if exists public.crm_calendar_events add column if not exists updated_at timestamptz not null default now();
alter table if exists public.crm_sources add column if not exists updated_at timestamptz not null default now();
alter table if exists public.lead_attribution add column if not exists updated_at timestamptz not null default now();
alter table if exists public.campaign_performance add column if not exists updated_at timestamptz not null default now();
alter table if exists public.campaign_performance add column if not exists conversion_rate numeric;
alter table if exists public.crm_funnel_events add column if not exists updated_at timestamptz not null default now();

-- ----------------------------------------------------------------------------
-- Useful indexes
-- ----------------------------------------------------------------------------
create index if not exists idx_crm_leads_lead_id_safe on public.crm_leads(lead_id);
create index if not exists idx_crm_leads_status_safe on public.crm_leads(status);
create index if not exists idx_crm_leads_city_safe on public.crm_leads(city);
create index if not exists idx_crm_leads_category_safe on public.crm_leads(category);
create index if not exists idx_crm_leads_source_safe on public.crm_leads(source);
create index if not exists idx_crm_leads_created_at_safe on public.crm_leads(created_at desc);
create index if not exists idx_crm_leads_next_follow_up_date_safe on public.crm_leads(next_follow_up_date);

create index if not exists idx_crm_lead_notes_lead_id_safe on public.crm_lead_notes(lead_id);
create index if not exists idx_crm_lead_notes_created_at_safe on public.crm_lead_notes(created_at desc);

create index if not exists idx_crm_lead_tasks_lead_id_safe on public.crm_lead_tasks(lead_id);
create index if not exists idx_crm_lead_tasks_status_safe on public.crm_lead_tasks(status);
create index if not exists idx_crm_lead_tasks_created_at_safe on public.crm_lead_tasks(created_at desc);

create index if not exists idx_crm_activities_lead_id_safe on public.crm_activities(lead_id);
create index if not exists idx_crm_activities_created_at_safe on public.crm_activities(created_at desc);

create index if not exists idx_crm_followups_lead_id_safe on public.crm_followups(lead_id);
create index if not exists idx_crm_followups_status_safe on public.crm_followups(status);
create index if not exists idx_crm_followups_created_at_safe on public.crm_followups(created_at desc);

create index if not exists idx_crm_calendar_events_lead_id_safe on public.crm_calendar_events(lead_id);
create index if not exists idx_crm_calendar_events_event_type_safe on public.crm_calendar_events(event_type);
create index if not exists idx_crm_calendar_events_created_at_safe on public.crm_calendar_events(created_at desc);

create index if not exists idx_crm_sources_source_safe on public.crm_sources(source);
create index if not exists idx_crm_sources_created_at_safe on public.crm_sources(created_at desc);

create index if not exists idx_lead_attribution_lead_id_safe on public.lead_attribution(lead_id);
create index if not exists idx_lead_attribution_source_safe on public.lead_attribution(source);
create index if not exists idx_lead_attribution_created_at_safe on public.lead_attribution(created_at desc);

create index if not exists idx_campaign_performance_source_safe on public.campaign_performance(source);
create index if not exists idx_campaign_performance_campaign_safe on public.campaign_performance(campaign);
create index if not exists idx_campaign_performance_created_at_safe on public.campaign_performance(created_at desc);

create index if not exists idx_crm_funnel_events_lead_id_safe on public.crm_funnel_events(lead_id);
create index if not exists idx_crm_funnel_events_stage_safe on public.crm_funnel_events(stage);
create index if not exists idx_crm_funnel_events_created_at_safe on public.crm_funnel_events(created_at desc);

-- ----------------------------------------------------------------------------
-- RLS and admin-only policy placeholders
-- ----------------------------------------------------------------------------
alter table public.crm_leads enable row level security;
alter table public.crm_lead_notes enable row level security;
alter table public.crm_lead_tasks enable row level security;
alter table public.crm_activities enable row level security;
alter table public.crm_followups enable row level security;
alter table public.crm_calendar_events enable row level security;
alter table public.crm_sources enable row level security;
alter table public.lead_attribution enable row level security;
alter table public.campaign_performance enable row level security;
alter table public.crm_funnel_events enable row level security;

comment on table public.crm_leads is 'QuickFurno CRM overlay. Admin-only RLS placeholder. Store masked phone only.';
comment on table public.crm_lead_notes is 'QuickFurno CRM notes. Admin-only RLS placeholder.';
comment on table public.crm_lead_tasks is 'QuickFurno CRM tasks. Admin-only RLS placeholder.';
comment on table public.crm_activities is 'QuickFurno CRM activity timeline. Admin-only RLS placeholder.';
comment on table public.crm_followups is 'QuickFurno CRM follow-up and nurture schedules. Admin-only RLS placeholder.';
comment on table public.crm_calendar_events is 'QuickFurno internal CRM calendar events. Admin-only RLS placeholder. No Google Calendar sync.';
comment on table public.crm_sources is 'QuickFurno CRM source registry. Admin-only RLS placeholder.';
comment on table public.lead_attribution is 'QuickFurno lead attribution foundation. Admin-only RLS placeholder.';
comment on table public.campaign_performance is 'QuickFurno campaign analytics foundation. Admin-only RLS placeholder.';
comment on table public.crm_funnel_events is 'QuickFurno CRM funnel events foundation. Admin-only RLS placeholder.';

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'crm_leads',
    'crm_lead_notes',
    'crm_lead_tasks',
    'crm_activities',
    'crm_followups',
    'crm_calendar_events',
    'crm_sources',
    'lead_attribution',
    'campaign_performance',
    'crm_funnel_events'
  ]
  loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = target_table
        and policyname = target_table || ' admin placeholder all'
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
        target_table || ' admin placeholder all',
        target_table
      );
    end if;
  end loop;
end $$;
