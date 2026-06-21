-- ============================================================================
-- QuickFurno - Superadmin foundation
-- Future-ready admin/CMS/AI/automation structures. Idempotent and safe to run
-- after the existing marketplace schema.
-- ============================================================================

-- Profiles: keep current role ('admin'/'vendor') intact, add scoped admin role.
alter table public.profiles
  add column if not exists admin_role text check (admin_role in (
    'Superadmin',
    'Sales Admin',
    'Support Admin',
    'Finance Admin',
    'Content Admin',
    'Operations Admin'
  ));

-- Leads: optional admin/enrichment fields. Existing public forms can continue
-- inserting the current minimal required columns.
alter table public.leads
  add column if not exists email text,
  add column if not exists locality text,
  add column if not exists category text,
  add column if not exists subcategory text,
  add column if not exists project_size text,
  add column if not exists utm_source text,
  add column if not exists utm_campaign text,
  add column if not exists utm_medium text,
  add column if not exists page_url text,
  add column if not exists lead_quality_score integer,
  add column if not exists lead_priority text,
  add column if not exists internal_notes text,
  add column if not exists follow_up_date timestamptz,
  add column if not exists updated_at timestamptz default now();

-- Cities and localities.
alter table public.cities
  add column if not exists state text,
  add column if not exists country text default 'India',
  add column if not exists launch_status text default 'Active' check (launch_status in ('Coming Soon','Active','Paused','Hidden')),
  add column if not exists show_on_homepage boolean default true,
  add column if not exists sort_order integer default 100,
  add column if not exists updated_at timestamptz default now();

create table if not exists public.localities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  city_id uuid references public.cities(id) on delete cascade,
  name text not null,
  slug text,
  is_active boolean default true,
  sort_order integer default 100,
  unique(city_id, slug)
);

-- Category CMS fields and parent/subcategory support.
alter table public.service_categories
  add column if not exists parent_id uuid references public.service_categories(id) on delete set null,
  add column if not exists icon text,
  add column if not exists image_url text,
  add column if not exists description text,
  add column if not exists show_on_homepage boolean default true,
  add column if not exists sort_order integer default 100,
  add column if not exists seo_title text,
  add column if not exists seo_description text,
  add column if not exists required_lead_fields jsonb default '[]'::jsonb,
  add column if not exists updated_at timestamptz default now();

-- Lead/admin timelines.
create table if not exists public.lead_timeline_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  lead_id uuid references public.leads(id) on delete cascade,
  event_type text not null,
  title text not null,
  description text,
  metadata jsonb default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.lead_internal_notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  lead_id uuid references public.leads(id) on delete cascade,
  note text not null,
  follow_up_date timestamptz,
  created_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.vendor_internal_notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  vendor_id uuid references public.vendors(id) on delete cascade,
  note text not null,
  created_by uuid references public.profiles(id) on delete set null
);

-- Audit and notifications.
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  admin_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb default '{}'::jsonb,
  ip_address text,
  user_agent text
);

create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  title text not null,
  message text,
  type text,
  priority text default 'Medium' check (priority in ('Low','Medium','High','Critical')),
  is_read boolean default false,
  metadata jsonb default '{}'::jsonb
);

-- Reviews and ratings.
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  vendor_id uuid references public.vendors(id) on delete cascade,
  client_name text,
  rating integer check (rating between 1 and 5),
  review_text text,
  category text,
  city text,
  status text default 'Pending' check (status in ('Pending','Approved','Rejected','Hidden')),
  feature_on_homepage boolean default false
);

-- AI agents.
create table if not exists public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text not null,
  purpose text,
  status text default 'Draft' check (status in ('Active','Draft','Disabled')),
  last_run_at timestamptz,
  next_run_at timestamptz,
  config jsonb default '{}'::jsonb
);

create table if not exists public.ai_agent_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  agent_id uuid references public.ai_agents(id) on delete cascade,
  status text default 'Started',
  started_at timestamptz default now(),
  finished_at timestamptz,
  summary text,
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  agent_id uuid references public.ai_agents(id) on delete set null,
  suggestion_type text not null,
  related_entity_type text,
  related_entity_id uuid,
  suggestion_text text not null,
  confidence_score numeric,
  status text default 'New' check (status in ('New','Accepted','Rejected','Applied')),
  metadata jsonb default '{}'::jsonb
);

-- Automations.
create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  name text not null,
  trigger_name text not null,
  action_name text not null,
  status text default 'Draft' check (status in ('Active','Draft','Disabled')),
  webhook_url text,
  last_run_at timestamptz,
  success_count integer default 0,
  failure_count integer default 0,
  config jsonb default '{}'::jsonb
);

create table if not exists public.automation_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  automation_id uuid references public.automations(id) on delete cascade,
  status text not null,
  message text,
  payload jsonb default '{}'::jsonb,
  response jsonb default '{}'::jsonb
);

-- Indexes.
create index if not exists idx_localities_city_active on public.localities(city_id, is_active);
create index if not exists idx_leads_followup on public.leads(follow_up_date) where follow_up_date is not null;
create index if not exists idx_lead_timeline_lead on public.lead_timeline_events(lead_id, created_at desc);
create index if not exists idx_audit_logs_created on public.audit_logs(created_at desc);
create index if not exists idx_notifications_read on public.admin_notifications(is_read, created_at desc);
create index if not exists idx_reviews_vendor_status on public.reviews(vendor_id, status);
create index if not exists idx_ai_suggestions_status on public.ai_suggestions(status, created_at desc);
create index if not exists idx_automation_logs_automation on public.automation_logs(automation_id, created_at desc);

-- RLS.
alter table public.localities enable row level security;
alter table public.lead_timeline_events enable row level security;
alter table public.lead_internal_notes enable row level security;
alter table public.vendor_internal_notes enable row level security;
alter table public.audit_logs enable row level security;
alter table public.admin_notifications enable row level security;
alter table public.reviews enable row level security;
alter table public.ai_agents enable row level security;
alter table public.ai_agent_runs enable row level security;
alter table public.ai_suggestions enable row level security;
alter table public.automations enable row level security;
alter table public.automation_logs enable row level security;

drop policy if exists "localities public read" on public.localities;
create policy "localities public read" on public.localities for select to anon, authenticated
  using (is_active or public.is_admin());

drop policy if exists "localities admin all" on public.localities;
create policy "localities admin all" on public.localities for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "reviews public approved read" on public.reviews;
create policy "reviews public approved read" on public.reviews for select to anon, authenticated
  using (status = 'Approved' or public.is_admin());

drop policy if exists "reviews admin all" on public.reviews;
create policy "reviews admin all" on public.reviews for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "lead timeline admin all" on public.lead_timeline_events;
create policy "lead timeline admin all" on public.lead_timeline_events for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "lead notes admin all" on public.lead_internal_notes;
create policy "lead notes admin all" on public.lead_internal_notes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "vendor notes admin all" on public.vendor_internal_notes;
create policy "vendor notes admin all" on public.vendor_internal_notes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "audit admin read" on public.audit_logs;
create policy "audit admin read" on public.audit_logs for select to authenticated
  using (public.is_admin());

drop policy if exists "audit admin insert" on public.audit_logs;
create policy "audit admin insert" on public.audit_logs for insert to authenticated
  with check (public.is_admin());

drop policy if exists "notifications admin all" on public.admin_notifications;
create policy "notifications admin all" on public.admin_notifications for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "ai agents admin all" on public.ai_agents;
create policy "ai agents admin all" on public.ai_agents for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "ai runs admin all" on public.ai_agent_runs;
create policy "ai runs admin all" on public.ai_agent_runs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "ai suggestions admin all" on public.ai_suggestions;
create policy "ai suggestions admin all" on public.ai_suggestions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "automations admin all" on public.automations;
create policy "automations admin all" on public.automations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "automation logs admin all" on public.automation_logs;
create policy "automation logs admin all" on public.automation_logs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
