-- ============================================================================
-- QuickFurno - Phase 25B Step 5: Vendor profile change approval flow
--
-- Vendors can request public profile changes. Changes only go live after admin
-- approval. The approval service applies a strict public-field allowlist.
-- ============================================================================

create extension if not exists "pgcrypto";

alter table if exists public.vendors add column if not exists public_description text;
alter table if exists public.vendors add column if not exists public_business_hours text;
alter table if exists public.vendors add column if not exists public_service_area_summary text;
alter table if exists public.vendors add column if not exists cover_image_url text;

create table if not exists public.vendor_profile_change_requests (
  id               uuid primary key default gen_random_uuid(),
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  requested_by     uuid null,
  request_type     text default 'profile_update',
  proposed_changes jsonb not null default '{}'::jsonb,
  current_snapshot jsonb null,
  status           text default 'pending',
  admin_notes      text,
  rejection_reason text,
  reviewed_by      uuid null,
  reviewed_at      timestamptz,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

alter table if exists public.vendor_profile_change_requests add column if not exists requested_by uuid null;
alter table if exists public.vendor_profile_change_requests add column if not exists request_type text default 'profile_update';
alter table if exists public.vendor_profile_change_requests add column if not exists proposed_changes jsonb not null default '{}'::jsonb;
alter table if exists public.vendor_profile_change_requests add column if not exists current_snapshot jsonb null;
alter table if exists public.vendor_profile_change_requests add column if not exists status text default 'pending';
alter table if exists public.vendor_profile_change_requests add column if not exists admin_notes text;
alter table if exists public.vendor_profile_change_requests add column if not exists rejection_reason text;
alter table if exists public.vendor_profile_change_requests add column if not exists reviewed_by uuid null;
alter table if exists public.vendor_profile_change_requests add column if not exists reviewed_at timestamptz;
alter table if exists public.vendor_profile_change_requests add column if not exists created_at timestamptz default now();
alter table if exists public.vendor_profile_change_requests add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'vendor_profile_change_requests_status_check'
      and conrelid = 'public.vendor_profile_change_requests'::regclass
  ) then
    alter table public.vendor_profile_change_requests
      add constraint vendor_profile_change_requests_status_check
      check (status in ('pending', 'approved', 'rejected', 'cancelled'));
  end if;
end $$;

create index if not exists idx_vendor_profile_change_requests_vendor_created
  on public.vendor_profile_change_requests(vendor_id, created_at desc);
create index if not exists idx_vendor_profile_change_requests_status
  on public.vendor_profile_change_requests(status, created_at desc);

alter table public.vendor_profile_change_requests enable row level security;

grant select, insert on public.vendor_profile_change_requests to authenticated;
grant select, insert, update, delete on public.vendor_profile_change_requests to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'vendor_profile_change_requests'
      and policyname = 'vendor_profile_change_requests owner read'
  ) then
    execute 'create policy "vendor_profile_change_requests owner read" on public.vendor_profile_change_requests for select to authenticated using (public.owns_vendor(vendor_id) or public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'vendor_profile_change_requests'
      and policyname = 'vendor_profile_change_requests owner insert'
  ) then
    execute 'create policy "vendor_profile_change_requests owner insert" on public.vendor_profile_change_requests for insert to authenticated with check (public.owns_vendor(vendor_id))';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'vendor_profile_change_requests'
      and policyname = 'vendor_profile_change_requests admin all'
  ) then
    execute 'create policy "vendor_profile_change_requests admin all" on public.vendor_profile_change_requests for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;
end $$;
