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
--      "create table if not exists" silently kept the wrong shape. They are
--      rebuilt ONLY when empty and missing the expected columns; if they ever
--      hold rows the migration aborts for manual review instead of dropping.
-- Idempotent. No-op on databases created from repo migrations 001 -> 027.
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

-- 3) rebuild drifted, EMPTY Phase 26A log tables ------------------------------
do $$
declare
  v_table text;
  v_expected_column text;
  v_row_count bigint;
begin
  for v_table, v_expected_column in
    select tbl, col from (values
      ('lead_matching_runs', 'run_status'),
      ('lead_delivery_logs', 'whatsapp_status'),
      ('client_notification_logs', 'vendor_snapshot')
    ) as drift(tbl, col)
  loop
    if exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = v_table
       )
       and not exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = v_table
           and column_name = v_expected_column
       )
    then
      execute format('select count(*) from public.%I', v_table) into v_row_count;
      if v_row_count = 0 then
        execute format('drop table public.%I', v_table);
        raise notice 'Dropped drifted empty table public.% (missing column %)', v_table, v_expected_column;
      else
        raise exception 'public.% has % rows but not the Phase 26A shape (missing %). Manual review required — not dropping.',
          v_table, v_row_count, v_expected_column;
      end if;
    end if;
  end loop;
end $$;

-- Recreate with the exact migration 027 shape.
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
