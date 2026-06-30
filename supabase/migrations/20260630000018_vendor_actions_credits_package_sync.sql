-- ============================================================================
-- QuickFurno - Phase 13B: Vendor Actions + Credits / Package Management Sync
-- Migration suggestion only. Safe to run on the live DB (idempotent).
--
-- Purpose:
-- - Let a Superadmin manage vendor package + credits from the admin dashboard
--   so the Phase 13 Lead Assignment Approval Preview can see eligible vendors.
-- - Adds DENORMALIZED package fields on the vendor row for the preview's
--   eligibility logic. The existing real package system (public.vendor_packages
--   + public.update_vendor_visibility + public_visibility) is UNCHANGED, so the
--   public website funnel keeps working exactly as before.
-- - Credits continue to use the EXISTING public.vendors.remaining_credits column
--   (no new credit column is added). A credit audit log table is added.
--
-- Safety:
-- - Uses ALTER TABLE IF EXISTS / ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT
--   EXISTS / CREATE INDEX IF NOT EXISTS only. NO drop/delete/truncate.
-- - No automatic credit deduction. No WhatsApp. No vendor notification. No
--   auto-assignment. No n8n.
-- - Admin-only RLS on the new log table. No anon/public policies.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- VENDORS: denormalized package fields (preview eligibility only)
-- Credits reuse the existing public.vendors.remaining_credits column.
-- ----------------------------------------------------------------------------
alter table if exists public.vendors add column if not exists package_name text;
alter table if exists public.vendors add column if not exists package_status text not null default 'none';
alter table if exists public.vendors add column if not exists package_expires_at timestamptz;

-- Constrain package_status to the allowed set (added defensively if missing).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'vendors_package_status_check'
      and conrelid = 'public.vendors'::regclass
  ) then
    alter table public.vendors
      add constraint vendors_package_status_check
      check (package_status in ('none', 'active', 'expired', 'cancelled', 'trial'));
  end if;
end $$;

create index if not exists idx_vendors_package_status on public.vendors(package_status);
create index if not exists idx_vendors_status_active on public.vendors(status, is_active);

-- ----------------------------------------------------------------------------
-- VENDOR CREDIT LOGS (audit trail for manual credit changes)
-- ----------------------------------------------------------------------------
create table if not exists public.vendor_credit_logs (
  id             uuid primary key default gen_random_uuid(),
  vendor_id      uuid not null,
  change_type    text not null
                   check (change_type in ('manual_add', 'manual_set', 'manual_remove', 'package_credit', 'preview_test', 'correction')),
  credits_before integer not null default 0,
  credits_delta  integer not null default 0,
  credits_after  integer not null default 0,
  reason         text,
  updated_by     text,
  created_at     timestamptz not null default now()
);

comment on table public.vendor_credit_logs is
  'Phase 13B: audit trail of manual vendor credit changes made by admins. No automatic deduction is recorded here. Admin-only RLS.';

-- Defensive: ensure columns exist if an earlier partial table is present.
alter table if exists public.vendor_credit_logs add column if not exists change_type text not null default 'correction';
alter table if exists public.vendor_credit_logs add column if not exists credits_before integer not null default 0;
alter table if exists public.vendor_credit_logs add column if not exists credits_delta integer not null default 0;
alter table if exists public.vendor_credit_logs add column if not exists credits_after integer not null default 0;
alter table if exists public.vendor_credit_logs add column if not exists reason text;
alter table if exists public.vendor_credit_logs add column if not exists updated_by text;
alter table if exists public.vendor_credit_logs add column if not exists created_at timestamptz not null default now();

create index if not exists idx_vendor_credit_logs_vendor_id on public.vendor_credit_logs(vendor_id);
create index if not exists idx_vendor_credit_logs_created_at on public.vendor_credit_logs(created_at desc);

-- ----------------------------------------------------------------------------
-- RLS: admin-only. No anon/public policies are created.
-- ----------------------------------------------------------------------------
alter table public.vendor_credit_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'vendor_credit_logs'
      and policyname = 'vendor_credit_logs admin all'
  ) then
    execute 'create policy "vendor_credit_logs admin all" on public.vendor_credit_logs for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;
end $$;
