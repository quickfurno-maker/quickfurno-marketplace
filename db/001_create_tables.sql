-- ============================================================================
-- QuickFurno — 001_create_tables.sql
-- Verified Interior & Carpentry Lead Portal — full schema
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. profiles  (linked to Supabase Auth)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz default now(),
  full_name   text,
  phone       text,
  role        text check (role in ('admin', 'vendor')),
  is_active   boolean default true
);

-- ----------------------------------------------------------------------------
-- 2. vendors
-- ----------------------------------------------------------------------------
create table if not exists public.vendors (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references public.profiles(id) on delete set null,
  created_at         timestamptz default now(),
  business_name      text not null,
  owner_name         text,
  phone              text not null,
  email              text,
  city               text not null,
  areas_covered      text[],
  covers_full_city   boolean default false,
  service_categories text[],
  experience         text,
  portfolio_urls     text[],
  profile_image_url  text,
  gst_number         text,
  rating             numeric default 0,
  completed_projects integer default 0,
  status             text default 'Pending' check (status in ('Pending','Approved','Rejected','Suspended')),
  total_credits      integer default 0,
  remaining_credits  integer default 0,
  is_active          boolean default true,
  last_assigned_at   timestamptz,
  public_visibility  boolean default false,
  message            text
);

-- ----------------------------------------------------------------------------
-- 3. leads
-- ----------------------------------------------------------------------------
create table if not exists public.leads (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz default now(),
  name                text not null,
  phone               text not null,
  city                text not null,
  area                text,
  service_required    text not null,
  budget              text,
  property_type       text,
  timeline            text,
  message             text,
  verification_status text default 'Pending' check (verification_status in ('Pending','Verified','Rejected')),
  source              text default 'Website',
  status              text default 'New' check (status in ('New','Verified','Assigned','Contacted','Site Visit Scheduled','Quotation Sent','Converted','Won','Lost','Duplicate','Bad Lead')),
  is_duplicate        boolean default false,
  duplicate_of        uuid references public.leads(id) on delete set null
);

-- ----------------------------------------------------------------------------
-- 4. packages
-- ----------------------------------------------------------------------------
create table if not exists public.packages (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz default now(),
  name           text not null,
  lead_count     integer not null,
  price_per_lead numeric not null,
  total_price    numeric not null,
  display_price  numeric not null,
  validity_days  integer not null,
  is_active      boolean default true
);

-- ----------------------------------------------------------------------------
-- 5. vendor_packages  (purchase + credit validity)
-- ----------------------------------------------------------------------------
create table if not exists public.vendor_packages (
  id              uuid primary key default gen_random_uuid(),
  vendor_id       uuid references public.vendors(id) on delete cascade,
  package_id      uuid references public.packages(id),
  purchase_date   timestamptz default now(),
  expiry_date     timestamptz,
  total_leads     integer,
  remaining_leads integer,
  price_paid      numeric,
  payment_status  text default 'Pending' check (payment_status in ('Pending','Paid','Failed','Refunded')),
  status          text default 'Active'  check (status in ('Active','Expired','Consumed','Cancelled'))
);

-- ----------------------------------------------------------------------------
-- 6. payments  (manual payment records)
-- ----------------------------------------------------------------------------
create table if not exists public.payments (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz default now(),
  vendor_id      uuid references public.vendors(id) on delete cascade,
  package_id     uuid references public.packages(id),
  amount         numeric,
  payment_method text,
  payment_status text default 'Pending' check (payment_status in ('Pending','Paid','Failed','Refunded')),
  transaction_id text,
  admin_notes    text
);

-- ----------------------------------------------------------------------------
-- 7. lead_assignments  (which vendors received which lead)
-- ----------------------------------------------------------------------------
create table if not exists public.lead_assignments (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid references public.leads(id) on delete cascade,
  vendor_id             uuid references public.vendors(id) on delete cascade,
  assigned_at           timestamptz default now(),
  assignment_type       text check (assignment_type in ('client_selected','auto_assigned','admin_assigned')),
  vendor_status         text default 'New' check (vendor_status in ('New','Contacted','Site Visit Scheduled','Quotation Sent','Won','Lost')),
  credit_deducted       boolean default true,
  is_bad_lead_reported  boolean default false,
  unique (lead_id, vendor_id)        -- never assign same lead to same vendor twice
);

-- ----------------------------------------------------------------------------
-- 8. lead_status_updates  (vendor activity timeline)
-- ----------------------------------------------------------------------------
create table if not exists public.lead_status_updates (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz default now(),
  lead_assignment_id uuid references public.lead_assignments(id) on delete cascade,
  vendor_id          uuid references public.vendors(id) on delete cascade,
  status             text,
  notes              text
);

-- ----------------------------------------------------------------------------
-- 9. bad_lead_reports
-- ----------------------------------------------------------------------------
create table if not exists public.bad_lead_reports (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz default now(),
  lead_assignment_id uuid references public.lead_assignments(id) on delete cascade,
  vendor_id          uuid references public.vendors(id) on delete cascade,
  reason             text,
  description        text,
  status             text default 'Pending' check (status in ('Pending','Approved','Rejected')),
  admin_decision     text,
  credit_restored    boolean default false
);

-- ----------------------------------------------------------------------------
-- 10. whatsapp_logs
-- ----------------------------------------------------------------------------
create table if not exists public.whatsapp_logs (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz default now(),
  recipient_type text check (recipient_type in ('client','vendor','admin')),
  recipient_id   uuid,
  phone          text,
  message        text,
  template_name  text,
  status         text default 'Pending' check (status in ('Pending','Sent','Failed')),
  error_message  text
);

-- ----------------------------------------------------------------------------
-- 11. service_categories
-- ----------------------------------------------------------------------------
create table if not exists public.service_categories (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  slug      text unique,
  is_active boolean default true
);

-- ----------------------------------------------------------------------------
-- 12. cities
-- ----------------------------------------------------------------------------
create table if not exists public.cities (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  slug      text unique,
  is_active boolean default true
);

-- ----------------------------------------------------------------------------
-- 13. app_settings
-- ----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------------------------
create index if not exists idx_leads_phone           on public.leads (phone);
create index if not exists idx_leads_city            on public.leads (city);
create index if not exists idx_leads_service         on public.leads (service_required);
create index if not exists idx_vendors_city          on public.vendors (city);
create index if not exists idx_vendors_status        on public.vendors (status);
create index if not exists idx_vendors_credits       on public.vendors (remaining_credits);
create index if not exists idx_vendors_public        on public.vendors (public_visibility) where public_visibility = true;
create index if not exists idx_assignments_lead      on public.lead_assignments (lead_id);
create index if not exists idx_assignments_vendor    on public.lead_assignments (vendor_id);
create index if not exists idx_vendor_pkgs_vendor    on public.vendor_packages (vendor_id, status);
create index if not exists idx_payments_vendor       on public.payments (vendor_id, payment_status);
create index if not exists idx_badreports_status     on public.bad_lead_reports (status);
