-- ============================================================================
-- QuickFurno - Phase 25B Step 4: Vendor package order intent
--
-- Purpose:
-- - Vendors can create package/recharge orders from their dashboard.
-- - Orders are audit records only until a verified payment integration confirms
--   payment in a future phase.
--
-- Safety:
-- - No package activation.
-- - No credits added.
-- - No fake payment success.
-- - No admin approval flow for package buying.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.vendor_package_orders (
  id                 uuid primary key default gen_random_uuid(),
  vendor_id          uuid not null references public.vendors(id) on delete cascade,
  package_id         uuid null references public.packages(id) on delete set null,
  package_name       text,
  package_price      numeric null,
  package_currency   text default 'INR',
  credits_included   integer null,
  validity_days      integer null,
  order_status       text default 'created',
  payment_status     text default 'not_started',
  payment_method     text default 'online_future',
  payment_provider   text default 'not_connected',
  provider_order_id  text,
  provider_payment_id text,
  paid_at            timestamptz,
  activated_at       timestamptz,
  activation_status  text default 'not_activated',
  failure_reason     text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

alter table if exists public.vendor_package_orders add column if not exists vendor_id uuid not null references public.vendors(id) on delete cascade;
alter table if exists public.vendor_package_orders add column if not exists package_id uuid null references public.packages(id) on delete set null;
alter table if exists public.vendor_package_orders add column if not exists package_name text;
alter table if exists public.vendor_package_orders add column if not exists package_price numeric null;
alter table if exists public.vendor_package_orders add column if not exists package_currency text default 'INR';
alter table if exists public.vendor_package_orders add column if not exists credits_included integer null;
alter table if exists public.vendor_package_orders add column if not exists validity_days integer null;
alter table if exists public.vendor_package_orders add column if not exists order_status text default 'created';
alter table if exists public.vendor_package_orders add column if not exists payment_status text default 'not_started';
alter table if exists public.vendor_package_orders add column if not exists payment_method text default 'online_future';
alter table if exists public.vendor_package_orders add column if not exists payment_provider text default 'not_connected';
alter table if exists public.vendor_package_orders add column if not exists provider_order_id text;
alter table if exists public.vendor_package_orders add column if not exists provider_payment_id text;
alter table if exists public.vendor_package_orders add column if not exists paid_at timestamptz;
alter table if exists public.vendor_package_orders add column if not exists activated_at timestamptz;
alter table if exists public.vendor_package_orders add column if not exists activation_status text default 'not_activated';
alter table if exists public.vendor_package_orders add column if not exists failure_reason text;
alter table if exists public.vendor_package_orders add column if not exists created_at timestamptz default now();
alter table if exists public.vendor_package_orders add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'vendor_package_orders_order_status_check'
      and conrelid = 'public.vendor_package_orders'::regclass
  ) then
    alter table public.vendor_package_orders
      add constraint vendor_package_orders_order_status_check
      check (order_status in ('created', 'cancelled', 'expired'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'vendor_package_orders_payment_status_check'
      and conrelid = 'public.vendor_package_orders'::regclass
  ) then
    alter table public.vendor_package_orders
      add constraint vendor_package_orders_payment_status_check
      check (payment_status in ('not_started', 'pending', 'paid', 'failed', 'refunded'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'vendor_package_orders_activation_status_check'
      and conrelid = 'public.vendor_package_orders'::regclass
  ) then
    alter table public.vendor_package_orders
      add constraint vendor_package_orders_activation_status_check
      check (activation_status in ('not_activated', 'activated', 'failed'));
  end if;
end $$;

create index if not exists idx_vendor_package_orders_vendor_created
  on public.vendor_package_orders(vendor_id, created_at desc);
create index if not exists idx_vendor_package_orders_status
  on public.vendor_package_orders(payment_status, activation_status);

alter table public.vendor_package_orders enable row level security;

grant select, insert on public.vendor_package_orders to authenticated;
grant select, insert, update, delete on public.vendor_package_orders to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'vendor_package_orders'
      and policyname = 'vendor_package_orders owner read'
  ) then
    execute 'create policy "vendor_package_orders owner read" on public.vendor_package_orders for select to authenticated using (public.owns_vendor(vendor_id) or public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'vendor_package_orders'
      and policyname = 'vendor_package_orders owner insert'
  ) then
    execute 'create policy "vendor_package_orders owner insert" on public.vendor_package_orders for insert to authenticated with check (public.owns_vendor(vendor_id))';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'vendor_package_orders'
      and policyname = 'vendor_package_orders admin all'
  ) then
    execute 'create policy "vendor_package_orders admin all" on public.vendor_package_orders for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;
end $$;
