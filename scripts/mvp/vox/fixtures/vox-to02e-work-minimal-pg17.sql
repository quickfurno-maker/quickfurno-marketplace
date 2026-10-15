-- Disposable PostgreSQL17 fixture. Synthetic identifiers only. NEVER staging.
begin;
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create table auth.users(id uuid primary key,raw_app_meta_data jsonb not null);
create table public.profiles(id uuid primary key,role text,is_active boolean not null);
create table public.cities(id uuid primary key,is_active boolean not null);
create table public.vox_staff_teams_v1(id uuid primary key,city_id uuid not null references public.cities(id),is_active boolean not null);
create table public.vox_staff_memberships_v1(
 auth_user_id uuid primary key references public.profiles(id),team_id uuid not null references public.vox_staff_teams_v1(id),
 staff_role text not null,is_active boolean not null,revoked_at timestamptz,expires_at timestamptz not null
);
create table public.vox_staff_object_scopes_v1(
 auth_user_id uuid not null,scope_kind text not null,object_id uuid not null,
 expires_at timestamptz not null,revoked_at timestamptz
);
create table public.vox_staff_department_requests_v1(
 id uuid primary key,requested_by uuid not null,target_staff_id uuid not null,
 team_id uuid not null,city_id uuid not null,department text not null,
 state text not null,revision integer not null,expires_at timestamptz not null,
 decided_by uuid,decision_reference text
);
create table public.vox_staff_department_decisions_v1(
 request_id uuid not null,reviewer_id uuid not null,decision text not null,decision_reference text not null
);
create table public.vox_staff_department_capabilities_v1(
 id uuid primary key,request_id uuid not null,auth_user_id uuid not null,team_id uuid not null,
 city_id uuid not null,department text not null,granted_by uuid not null,
 expires_at timestamptz not null,revoked_at timestamptz,revision integer not null
);
create table public.vox_staff_department_activations_v1(
 request_id uuid not null,capability_id uuid not null,activated_by uuid not null
);
insert into public.profiles values
 ('00000000-0000-4000-8000-000000000001',null,true),
 ('00000000-0000-4000-8000-000000000002','admin',true),
 ('00000000-0000-4000-8000-000000000003',null,true),
 ('00000000-0000-4000-8000-000000000004',null,true);
insert into auth.users values
 ('00000000-0000-4000-8000-000000000001','{"qf_principal":"vox_staff"}'),
 ('00000000-0000-4000-8000-000000000002','{"admin_role":"Superadmin"}'),
 ('00000000-0000-4000-8000-000000000003','{"qf_principal":"vox_staff","vox_role":"team_leader"}'),
 ('00000000-0000-4000-8000-000000000004','{"qf_principal":"vox_staff"}');
insert into public.cities values
 ('00000000-0000-4000-8000-000000000101',true),
 ('00000000-0000-4000-8000-000000000102',true);
insert into public.vox_staff_teams_v1 values
 ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101',true),
 ('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000102',true);
insert into public.vox_staff_memberships_v1 values
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000201','acquisition_agent',true,null,now()+interval '7 days'),
 ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000201','team_leader',true,null,now()+interval '7 days'),
 ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000202','support_agent',true,null,now()+interval '7 days');
-- Canonical source ownership and Google-verified zone mapping are Core-owned.
create table public.aarohi_prospects(id uuid primary key,city_id uuid not null);
create table public.marketplace_service_zones(
 id uuid primary key,city_id uuid not null,is_active boolean not null);
create table public.vendors(id uuid primary key,service_zone_id uuid not null);
create table public.vendor_support_threads(id uuid primary key,vendor_id uuid not null);
insert into public.aarohi_prospects values
 ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000101'),
 ('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000102');
insert into public.marketplace_service_zones values
 ('00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000101',true),
 ('00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000102',true);
insert into public.vendors values
 ('00000000-0000-4000-8000-000000000911','00000000-0000-4000-8000-000000000901'),
 ('00000000-0000-4000-8000-000000000912','00000000-0000-4000-8000-000000000902');
insert into public.vendor_support_threads values
 ('00000000-0000-4000-8000-000000000921','00000000-0000-4000-8000-000000000911');
insert into public.vox_staff_object_scopes_v1 values
 ('00000000-0000-4000-8000-000000000001','prospect','00000000-0000-4000-8000-000000000301',now()+interval '7 days',null);
insert into public.vox_staff_department_requests_v1 values
 ('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101','acquisition','APPROVED',1,now()+interval '1 day',
 '00000000-0000-4000-8000-000000000003','REVIEW-APPROVED');
insert into public.vox_staff_department_decisions_v1 values
 ('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000003','APPROVED','REVIEW-APPROVED');
insert into public.vox_staff_department_capabilities_v1 values
 ('00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000401',
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000201',
 '00000000-0000-4000-8000-000000000101','acquisition',
 '00000000-0000-4000-8000-000000000002',now()+interval '1 day',null,2);
insert into public.vox_staff_department_activations_v1 values
 ('00000000-0000-4000-8000-000000000401',
 '00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000002');
commit;
