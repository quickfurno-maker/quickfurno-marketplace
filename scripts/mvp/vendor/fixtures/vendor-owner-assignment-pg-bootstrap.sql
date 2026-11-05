-- Synthetic-only PG17 supplement for Batch5 private Owner review + assignments.
-- Never run against managed Staging or Production.
alter table auth.users
 add column raw_app_meta_data jsonb not null default '{}'::jsonb;
alter table public.profiles
 add column is_active boolean not null default true;

create table public.leads (
 id uuid primary key
);
create table public.lead_assignments (
 id uuid primary key default gen_random_uuid(),
 lead_id uuid not null references public.leads(id),
 vendor_id uuid not null references public.vendors(id),
 lifecycle_status text not null default 'assigned'
);

insert into auth.users(id,phone,phone_confirmed_at,raw_app_meta_data)
 values ('00000000-0000-4000-8000-000000000005',null,null,
         '{"admin_role":"Superadmin"}'::jsonb);
insert into public.profiles(id,role,is_active)
 values ('00000000-0000-4000-8000-000000000005','admin',true);
insert into public.leads(id) values
 ('90000000-0000-4000-8000-000000000001'),
 ('90000000-0000-4000-8000-000000000002'),
 ('90000000-0000-4000-8000-000000000003'),
 ('90000000-0000-4000-8000-000000000004');
