-- TO-05A DISPOSABLE PG17 ONLY: run after real department SQL candidate,
-- 02C request/review/activate/revoke fixture, before work candidate.
-- Same exact synthetic Staff, TL, owner, city and team for both modules.
begin;
create table public.vox_staff_object_scopes_v1 (
 auth_user_id uuid not null references public.profiles(id),
 scope_kind text not null,object_id uuid not null,
 expires_at timestamptz not null,revoked_at timestamptz
);
create table public.aarohi_prospects(id uuid primary key,city_id uuid not null);
create table public.marketplace_service_zones(
 id uuid primary key,city_id uuid not null,is_active boolean not null);
create table public.vendors(
 id uuid primary key,service_zone_id uuid not null references public.marketplace_service_zones(id));
create table public.vendor_support_threads(
 id uuid primary key,vendor_id uuid not null references public.vendors(id));
insert into public.marketplace_service_zones(id,city_id,is_active) values
 ('00000000-0000-4000-8000-000000000901',
  '00000000-0000-4000-8000-000000000004',true);
insert into public.vendors(id,service_zone_id) values
 ('00000000-0000-4000-8000-000000000911','00000000-0000-4000-8000-000000000901');
insert into public.vox_staff_object_scopes_v1(auth_user_id,scope_kind,object_id,expires_at)
 values('00000000-0000-4000-8000-000000000002','vendor',
 '00000000-0000-4000-8000-000000000911',now()+interval '1 day');
commit;
