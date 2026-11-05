-- Isolated synthetic PostgreSQL 17 ONLY; not a managed database baseline.
-- Tables/columns mirror the Core ownership and registration contract needed
-- to exercise the private OTP + atomic Pending enrollment SQL.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users(
  id uuid primary key,
  phone text,
  phone_confirmed_at timestamptz
);
create table public.profiles(
  id uuid primary key references auth.users(id),
  role text check (role in ('admin','vendor'))
);
create table public.vendors(
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  business_name text not null,
  owner_name text,
  phone text not null,
  whatsapp_number text,
  email text,
  city text not null,
  service_categories text[],
  gst_number text,
  google_place_id text,
  formatted_address text,
  office_address_line1 text,
  office_state text,
  office_city text,
  status text default 'Pending',
  verification_status text default 'Pending',
  paid_status text default 'Unpaid',
  is_active boolean default true,
  accepting_leads boolean default true,
  public_visibility boolean default false,
  total_credits integer default 0,
  remaining_credits integer default 0,
  location_verification_status text default 'unverified',
  service_zone_id uuid,
  office_latitude double precision,
  office_longitude double precision
);
alter table public.vendors enable row level security;

create table public.client_accounts(
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  phone_e164 text
);
create unique index uq_client_accounts_user on public.client_accounts(user_id);
create table public.vendor_dashboard_users(
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  phone text, email text,
  role text not null default 'owner',
  status text not null default 'active',
  phone_verified boolean not null default false,
  whatsapp_otp_enabled boolean not null default false,
  last_login_method text,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index uq_vendor_dashboard_users_user_id
  on public.vendor_dashboard_users(user_id) where user_id is not null;
alter table public.vendor_dashboard_users enable row level security;

-- The real communication foundation is much richer. The fixture models only
-- fields independently checked by the new atomic gate, never delivery itself.
create table public.communication_messages(
  id uuid primary key default gen_random_uuid(),
  message_type text not null,
  lane text not null,
  channel text not null,
  recipient_type text not null,
  entity_type text,
  entity_id uuid,
  destination_hash text not null,
  provider text not null,
  correlation_id text,
  status text not null,
  created_at timestamptz not null default now()
);

insert into auth.users(id,phone,phone_confirmed_at) values
 ('00000000-0000-4000-8000-000000000001','+919876543210',now()),
 ('00000000-0000-4000-8000-000000000002','+918765432109',now()),
 ('00000000-0000-4000-8000-000000000003','+917654321098',null),
 ('00000000-0000-4000-8000-000000000004','+916543210987',now());
insert into public.profiles(id,role) values
 ('00000000-0000-4000-8000-000000000001',null),
 ('00000000-0000-4000-8000-000000000002',null),
 ('00000000-0000-4000-8000-000000000003',null),
 ('00000000-0000-4000-8000-000000000004',null);
insert into public.vendors(id,business_name,phone,city,status,is_active,accepting_leads)
 values ('10000000-0000-4000-8000-000000000001',
   'Legacy private-verification fixture','9123456789','Pune','Pending',false,false);
