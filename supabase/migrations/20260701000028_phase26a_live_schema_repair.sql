-- ============================================================================
-- QuickFurno — 20260701000028_phase26a_live_schema_repair.sql
-- Repairs live-DB drift found while verifying Phase 26A against production:
--   1) leads: the migration 006 enrichment block and migration 008 UTM/consent
--      block were never applied. Live captured consent in a column named
--      vendor_contact_share_consent; the code reads share_consent. Columns are
--      re-added and consent history is backfilled.
--   2) vendors: selected_category / selected_subcategories (migration 009) are
--      missing. assign_lead_to_paid_vendors_phase26a hard-references
--      selected_category, so the RPC fails at runtime without them.
--   3) lead_matching_runs / lead_delivery_logs / client_notification_logs:
--      an earlier draft created these tables with different columns, so 027's
--      "create table if not exists" silently kept the wrong shape. This
--      migration repairs them ADDITIVELY ONLY — every missing column is added
--      with "alter table ... add column if not exists". No table is ever
--      removed, cleared, or rebuilt, regardless of row count. Existing data
--      is preserved.
-- Idempotent. No-op on databases created from repo migrations 001 -> 027.
-- SAFETY: additive only — no destructive DDL/DML against any data table.
-- ============================================================================

-- 1) leads: re-apply migration 006 enrichment block --------------------------
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

-- leads: re-apply migration 008 UTM/consent block
alter table public.leads
  add column if not exists source_url        text,
  add column if not exists utm_term          text,
  add column if not exists utm_content       text,
  add column if not exists location_consent  boolean default false,
  add column if not exists share_consent     boolean default false;

-- Backfill share_consent from the live-only vendor_contact_share_consent
-- column so consent already given by clients is not lost.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads'
      and column_name = 'vendor_contact_share_consent'
  ) then
    execute 'update public.leads
             set share_consent = true
             where vendor_contact_share_consent is true
               and share_consent is distinct from true';
  end if;
end $$;

-- 2) vendors: re-apply migration 009 onboarding block ------------------------
alter table public.vendors
  add column if not exists whatsapp_number            text,
  add column if not exists selected_category          text,
  add column if not exists selected_subcategories     text[],
  add column if not exists custom_service_area        text,
  add column if not exists location_permission_status text,
  add column if not exists business_type              text,
  add column if not exists years_experience           text,
  add column if not exists team_size                  text,
  add column if not exists monthly_capacity           text,
  add column if not exists starting_price             text,
  add column if not exists paid_status                text default 'Unpaid',
  add column if not exists source_url                 text,
  add column if not exists utm_source                 text,
  add column if not exists utm_medium                 text,
  add column if not exists utm_campaign               text;

-- 3) repair drifted Phase 26A log tables — ADDITIVE ONLY ----------------------
-- Never drops a table. "create table if not exists" builds the canonical shape
-- on a fresh DB (no-op if the table already exists), then the
-- "add column if not exists" blocks below add any columns the drifted live
-- tables are missing. On a drifted table the create is a no-op and the alters
-- do the repair; on a fresh table the create does the work and the alters are
-- no-ops. Either way no existing row or column is touched.
create table if not exists public.lead_matching_runs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  run_status text not null default 'started',
  consent_confirmed boolean not null default false,
  max_vendors integer not null default 3,
  eligible_vendor_count integer not null default 0,
  selected_vendor_ids uuid[] not null default '{}',
  assigned_vendor_ids uuid[] not null default '{}',
  failure_reason text,
  matching_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  assignment_id uuid null references public.lead_assignments(id) on delete set null,
  delivery_channel text not null default 'vendor_dashboard',
  delivery_status text not null default 'pending',
  contact_shared boolean not null default false,
  credit_deducted boolean not null default false,
  whatsapp_preview_message text,
  whatsapp_status text not null default 'preview_only',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_notification_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  notification_type text not null default 'assigned_vendors_preview',
  channel text not null default 'dashboard_preview',
  status text not null default 'preview_created',
  message text,
  vendor_snapshot jsonb not null default '[]'::jsonb,
  whatsapp_status text not null default 'preview_only',
  created_at timestamptz not null default now()
);

-- Additive repair for lead_matching_runs. Columns are added nullable-with-
-- default (not NOT NULL) so the add is always safe on a table that already has
-- rows. id + primary key are supplied by the create above. matching_snapshot
-- and assigned_vendor_ids are the columns the matching engine actually writes,
-- so they are ensured here even though they are not in the summarised count set.
alter table public.lead_matching_runs
  add column if not exists lead_id uuid references public.leads(id) on delete cascade,
  add column if not exists run_status text default 'started',
  add column if not exists consent_confirmed boolean default false,
  add column if not exists max_vendors integer default 3,
  add column if not exists eligible_vendor_count integer default 0,
  add column if not exists matched_vendor_count integer default 0,
  add column if not exists delivered_vendor_count integer default 0,
  add column if not exists failed_vendor_count integer default 0,
  add column if not exists skipped_vendor_count integer default 0,
  add column if not exists selected_vendor_ids uuid[] default '{}',
  add column if not exists assigned_vendor_ids uuid[] default '{}',
  add column if not exists skipped_reasons jsonb default '{}'::jsonb,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists matching_snapshot jsonb default '{}'::jsonb,
  add column if not exists failure_reason text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

-- Additive repair for lead_delivery_logs (migration 027 shape; 029/030 add
-- their own failure_reason / credit_log_id / assignment_source columns later).
alter table public.lead_delivery_logs
  add column if not exists lead_id uuid references public.leads(id) on delete cascade,
  add column if not exists vendor_id uuid references public.vendors(id) on delete cascade,
  add column if not exists assignment_id uuid references public.lead_assignments(id) on delete set null,
  add column if not exists delivery_channel text default 'vendor_dashboard',
  add column if not exists delivery_status text default 'pending',
  add column if not exists contact_shared boolean default false,
  add column if not exists credit_deducted boolean default false,
  add column if not exists whatsapp_preview_message text,
  add column if not exists whatsapp_status text default 'preview_only',
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

-- Additive repair for client_notification_logs (migration 027 shape).
alter table public.client_notification_logs
  add column if not exists lead_id uuid references public.leads(id) on delete cascade,
  add column if not exists notification_type text default 'assigned_vendors_preview',
  add column if not exists channel text default 'dashboard_preview',
  add column if not exists status text default 'preview_created',
  add column if not exists message text,
  add column if not exists vendor_snapshot jsonb default '[]'::jsonb,
  add column if not exists whatsapp_status text default 'preview_only',
  add column if not exists created_at timestamptz default now();

create index if not exists idx_lead_matching_runs_lead_created
  on public.lead_matching_runs(lead_id, created_at desc);
create index if not exists idx_lead_delivery_logs_lead_vendor
  on public.lead_delivery_logs(lead_id, vendor_id);
create index if not exists idx_lead_delivery_logs_assignment
  on public.lead_delivery_logs(assignment_id);
create index if not exists idx_client_notification_logs_lead_created
  on public.client_notification_logs(lead_id, created_at desc);

alter table public.lead_matching_runs enable row level security;
alter table public.lead_delivery_logs enable row level security;
alter table public.client_notification_logs enable row level security;

grant select on public.lead_matching_runs to authenticated;
grant select on public.lead_delivery_logs to authenticated;
grant select on public.client_notification_logs to authenticated;
grant select, insert, update, delete on public.lead_matching_runs to service_role;
grant select, insert, update, delete on public.lead_delivery_logs to service_role;
grant select, insert, update, delete on public.client_notification_logs to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'lead_matching_runs' and policyname = 'lead_matching_runs admin all'
  ) then
    execute 'create policy "lead_matching_runs admin all" on public.lead_matching_runs for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'lead_delivery_logs' and policyname = 'lead_delivery_logs vendor read'
  ) then
    execute 'create policy "lead_delivery_logs vendor read" on public.lead_delivery_logs for select to authenticated using (public.owns_vendor(vendor_id) or public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'lead_delivery_logs' and policyname = 'lead_delivery_logs admin all'
  ) then
    execute 'create policy "lead_delivery_logs admin all" on public.lead_delivery_logs for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'client_notification_logs' and policyname = 'client_notification_logs admin all'
  ) then
    execute 'create policy "client_notification_logs admin all" on public.client_notification_logs for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;
end $$;
