-- ============================================================================
-- QuickFurno - CRM + Analytics foundation
-- SQL migration suggestion only. Do not apply automatically from the app.
-- Adds admin-only CRM and lead-attribution tables. Existing public lead tables
-- (e.g. public.leads) are NOT renamed, altered, or deleted by this migration.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- CRM LEADS (CRM overlay; references existing leads by id, does not replace them)
-- ----------------------------------------------------------------------------
create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lead_id uuid,
  client_name text,
  -- Store masked phone only in CRM overlay. Full phone stays in source lead row.
  phone_masked text,
  email_masked text,
  service text,
  subcategory text,
  city text,
  area text,
  budget text,
  priority text not null default 'warm' check (priority in ('hot', 'warm', 'cold', 'weak', 'spam')),
  status text not null default 'new' check (status in (
    'new', 'qualified', 'spam_review', 'vendor_matching', 'assigned',
    'vendor_contact_pending', 'client_contacted', 'site_visit_scheduled',
    'quotation_sent', 'won', 'lost', 'nurture_later', 'invalid', 'duplicate'
  )),
  source text,
  assigned_vendor_count integer not null default 0,
  assigned_to uuid references public.profiles(id) on delete set null,
  owner text,
  next_follow_up_date timestamptz,
  nurture_stage text check (nurture_stage is null or nurture_stage in (
    'nurture_3_days', 'nurture_7_days', 'nurture_15_days', 'nurture_30_days',
    'nurture_60_days', 'nurture_90_days', 'nurture_6_months', 'nurture_1_year',
    'custom_nurture_date', 'future_project', 'not_ready_now', 'reopen_later'
  )),
  nurture_reason text check (nurture_reason is null or nurture_reason in (
    'possession_later', 'budget_later', 'comparing_vendors', 'call_after_few_months',
    'renovation_later', 'not_ready_now', 'future_project', 'other'
  )),
  nurture_follow_up_date timestamptz,
  nurture_custom_date_enabled boolean not null default false,
  last_activity_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.crm_leads is
  'Admin-only QuickFurno CRM overlay. RLS enabled. Stores masked phone only; full client phone stays in the source lead table.';

-- ----------------------------------------------------------------------------
-- CRM LEAD NOTES
-- ----------------------------------------------------------------------------
create table if not exists public.crm_lead_notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid,
  note text not null,
  author uuid references public.profiles(id) on delete set null,
  is_internal boolean not null default true,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.crm_lead_notes is
  'Admin-only CRM lead notes. RLS enabled. Notes should not contain unmasked phone numbers or secrets.';

-- ----------------------------------------------------------------------------
-- CRM LEAD TASKS
-- ----------------------------------------------------------------------------
create table if not exists public.crm_lead_tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid,
  title text not null,
  task_type text,
  due_date timestamptz,
  owner uuid references public.profiles(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'due_today', 'overdue', 'completed', 'snoozed')),
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.crm_lead_tasks is
  'Admin-only CRM follow-up tasks. RLS enabled.';

-- ----------------------------------------------------------------------------
-- CRM ACTIVITIES (timeline)
-- ----------------------------------------------------------------------------
create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid,
  activity_type text not null,
  summary text not null,
  actor text,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.crm_activities is
  'Admin-only CRM activity timeline. RLS enabled. Store safe summaries, not raw phone numbers.';

-- ----------------------------------------------------------------------------
-- CRM FOLLOWUPS (scheduled follow-ups and nurture follow-ups)
-- ----------------------------------------------------------------------------
create table if not exists public.crm_followups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid,
  follow_up_type text not null default 'follow_up' check (follow_up_type in ('follow_up', 'nurture')),
  scheduled_date timestamptz not null,
  preset text,
  custom_date_enabled boolean not null default false,
  reason text,
  owner uuid references public.profiles(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled', 'due', 'overdue', 'done')),
  metadata jsonb not null default '{}'::jsonb
  -- Note: scheduled_date is NOT NULL but intentionally has NO upper-bound check.
  -- Nurture follow-ups may be scheduled far in the future (beyond two months,
  -- up to 1 year or a custom date). Future-date validation is enforced in the
  -- CRM UI (see validateNurtureSchedule), not in the database, so historical and
  -- back-dated rows can still be stored for auditing.
);

comment on table public.crm_followups is
  'Admin-only CRM follow-up and nurture schedule. RLS enabled. Custom nurture dates may extend beyond two months.';

-- ----------------------------------------------------------------------------
-- CRM CALENDAR EVENTS (internal calendar; Google Calendar sync is future work)
-- ----------------------------------------------------------------------------
create table if not exists public.crm_calendar_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid,
  title text not null,
  event_type text not null check (event_type in (
    'client_call', 'vendor_call', 'site_visit', 'quotation_followup',
    'nurture_followup', 'complaint_followup', 'renewal_followup'
  )),
  scheduled_at timestamptz not null,
  owner uuid references public.profiles(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled', 'due', 'overdue', 'done', 'cancelled')),
  notes text,
  -- TODO(google-calendar): populate once Google Calendar integration is added.
  google_calendar_event_id text,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.crm_calendar_events is
  'Admin-only internal CRM calendar. RLS enabled. Google Calendar sync is future work.';

-- ----------------------------------------------------------------------------
-- CRM SOURCES
-- ----------------------------------------------------------------------------
create table if not exists public.crm_sources (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null,
  channel text,
  metadata jsonb not null default '{}'::jsonb,
  unique (source)
);

comment on table public.crm_sources is
  'Admin-only CRM source registry. RLS enabled.';

-- ----------------------------------------------------------------------------
-- LEAD ATTRIBUTION (UTM / marketing attribution; references leads by id)
-- ----------------------------------------------------------------------------
create table if not exists public.lead_attribution (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
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

comment on table public.lead_attribution is
  'Admin-only lead attribution / UTM capture. RLS enabled. Does not replace existing lead tables.';

-- ----------------------------------------------------------------------------
-- CAMPAIGN PERFORMANCE (analytics; spend/cost are placeholders until ads connect)
-- ----------------------------------------------------------------------------
create table if not exists public.campaign_performance (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  campaign text not null,
  source text,
  leads integer not null default 0,
  hot_leads integer not null default 0,
  won_leads integer not null default 0,
  spend numeric,
  cpl numeric,
  quality_score numeric,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.campaign_performance is
  'Admin-only campaign analytics. RLS enabled. Spend and CPL stay null until ad platforms are connected.';

-- ----------------------------------------------------------------------------
-- CRM FUNNEL EVENTS (analytics funnel transitions)
-- ----------------------------------------------------------------------------
create table if not exists public.crm_funnel_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid,
  stage text not null,
  previous_stage text,
  source text,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.crm_funnel_events is
  'Admin-only CRM funnel transition log. RLS enabled.';

-- ----------------------------------------------------------------------------
-- INDEXES
-- Required: lead_id, phone, source, status, created_at, next_follow_up_date,
-- nurture_follow_up_date, assigned_to.
-- ----------------------------------------------------------------------------
create index if not exists idx_crm_leads_lead_id on public.crm_leads(lead_id);
create index if not exists idx_crm_leads_phone_masked on public.crm_leads(phone_masked);
create index if not exists idx_crm_leads_source on public.crm_leads(source);
create index if not exists idx_crm_leads_status on public.crm_leads(status);
create index if not exists idx_crm_leads_priority on public.crm_leads(priority);
create index if not exists idx_crm_leads_created_at on public.crm_leads(created_at desc);
create index if not exists idx_crm_leads_next_follow_up_date on public.crm_leads(next_follow_up_date);
create index if not exists idx_crm_leads_nurture_follow_up_date on public.crm_leads(nurture_follow_up_date);
create index if not exists idx_crm_leads_assigned_to on public.crm_leads(assigned_to);

create index if not exists idx_crm_lead_notes_lead_id on public.crm_lead_notes(lead_id);
create index if not exists idx_crm_lead_notes_created_at on public.crm_lead_notes(created_at desc);

create index if not exists idx_crm_lead_tasks_lead_id on public.crm_lead_tasks(lead_id);
create index if not exists idx_crm_lead_tasks_status on public.crm_lead_tasks(status);
create index if not exists idx_crm_lead_tasks_due_date on public.crm_lead_tasks(due_date);
create index if not exists idx_crm_lead_tasks_owner on public.crm_lead_tasks(owner);

create index if not exists idx_crm_activities_lead_id on public.crm_activities(lead_id);
create index if not exists idx_crm_activities_created_at on public.crm_activities(created_at desc);

create index if not exists idx_crm_followups_lead_id on public.crm_followups(lead_id);
create index if not exists idx_crm_followups_status on public.crm_followups(status);
create index if not exists idx_crm_followups_scheduled_date on public.crm_followups(scheduled_date);
create index if not exists idx_crm_followups_created_at on public.crm_followups(created_at desc);

create index if not exists idx_crm_calendar_events_lead_id on public.crm_calendar_events(lead_id);
create index if not exists idx_crm_calendar_events_status on public.crm_calendar_events(status);
create index if not exists idx_crm_calendar_events_scheduled_at on public.crm_calendar_events(scheduled_at);
create index if not exists idx_crm_calendar_events_event_type on public.crm_calendar_events(event_type);

create index if not exists idx_crm_sources_source on public.crm_sources(source);

create index if not exists idx_lead_attribution_lead_id on public.lead_attribution(lead_id);
create index if not exists idx_lead_attribution_source on public.lead_attribution(source);
create index if not exists idx_lead_attribution_utm_campaign on public.lead_attribution(utm_campaign);
create index if not exists idx_lead_attribution_created_at on public.lead_attribution(created_at desc);

create index if not exists idx_campaign_performance_campaign on public.campaign_performance(campaign);
create index if not exists idx_campaign_performance_source on public.campaign_performance(source);
create index if not exists idx_campaign_performance_created_at on public.campaign_performance(created_at desc);

create index if not exists idx_crm_funnel_events_lead_id on public.crm_funnel_events(lead_id);
create index if not exists idx_crm_funnel_events_stage on public.crm_funnel_events(stage);
create index if not exists idx_crm_funnel_events_created_at on public.crm_funnel_events(created_at desc);

-- ----------------------------------------------------------------------------
-- RLS: admin-only policies. No anon/public policies are created.
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
        and policyname = target_table || ' admin all'
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
        target_table || ' admin all',
        target_table
      );
    end if;
  end loop;
end $$;
