-- QF Batch 10: minimal legacy Core-only PostgreSQL17 fixture.
-- Intentionally contains NO qf_vendor_private objects and NO Supabase
-- managed migration schema. All identifiers/phones are synthetic.
create schema if not exists public;

create table public.vendors(
 id uuid primary key,
 user_id uuid,
 phone text,
 status text not null,
 is_active boolean not null default false,
 accepting_leads boolean not null default false,
 public_visibility boolean not null default false
);
create table public.vendor_dashboard_users(
 vendor_id uuid not null references public.vendors(id),
 user_id uuid,
 role text not null,
 status text not null
);
create table public.client_accounts(
 id uuid primary key,
 user_id uuid not null
);
create table public.lead_assignments(
 id uuid primary key,
 vendor_id uuid references public.vendors(id),
 lifecycle_status text not null
);

-- One canonical live legacy vendor, one shared-client principal, two duplicate
-- phone records, a noncanonical record and an accidentally active Pending row.
insert into public.vendors
 (id,user_id,phone,status,is_active,accepting_leads,public_visibility)
values
 ('10000000-0000-4000-8000-000000000081',
  '00000000-0000-4000-8000-000000000081','9876543281',
  'Approved',true,true,true),
 ('10000000-0000-4000-8000-000000000082',
  '00000000-0000-4000-8000-000000000082','9876543282',
  'Pending',false,false,false),
 ('10000000-0000-4000-8000-000000000083',
  '00000000-0000-4000-8000-000000000083','9876543282',
  'Pending',true,false,false),
 ('10000000-0000-4000-8000-000000000084',
  '00000000-0000-4000-8000-000000000084','1234',
  'Pending',false,false,false);

insert into public.vendor_dashboard_users(vendor_id,user_id,role,status)
values
 ('10000000-0000-4000-8000-000000000081',
  '00000000-0000-4000-8000-000000000081','owner','active'),
 ('10000000-0000-4000-8000-000000000082',
  '00000000-0000-4000-8000-000000000092','owner','active');

insert into public.client_accounts(id,user_id)
values ('40000000-0000-4000-8000-000000000081',
        '00000000-0000-4000-8000-000000000081');

insert into public.lead_assignments(id,vendor_id,lifecycle_status)
values ('50000000-0000-4000-8000-000000000081',
        '10000000-0000-4000-8000-000000000081','delivered');
