-- TO-04L: disposable PG17 approximation of *read-only observed* existing
-- QuickFurno handle_new_user() trigger semantics. NEVER run in Supabase.
-- Simulated synthetic auth.users and public.profiles; no actual accounts.
create schema if not exists auth;
create table auth.users(
 id uuid primary key,
 raw_app_meta_data jsonb not null default '{}'::jsonb,
 raw_user_meta_data jsonb not null default '{}'::jsonb
);
create table public.profiles(
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text,phone text,role text default null,
 constraint profiles_role_check check(role=any(array['admin'::text,'vendor'::text]))
);
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','public','pg_temp'
as $vox_trigger$
declare
 v_principal text:=new.raw_app_meta_data->>'qf_principal';
 v_role text;
begin
 if v_principal='vendor' then v_role:='vendor';
 else v_role:=null; end if;
 insert into public.profiles(id,full_name,phone,role)
 values(new.id,new.raw_user_meta_data->>'full_name',
  new.raw_user_meta_data->>'phone',v_role)
 on conflict(id) do nothing;
 return new;
end;
$vox_trigger$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();
insert into auth.users(id,raw_app_meta_data,raw_user_meta_data) values
 ('00000000-0000-4000-8000-000000000001','{"qf_principal":"vendor"}','{"role":"admin","full_name":"Synthetic Vendor"}'),
 ('00000000-0000-4000-8000-000000000002','{"qf_principal":"vox_staff"}','{"role":"admin","admin_role":"Superadmin","full_name":"Synthetic Staff"}'),
 ('00000000-0000-4000-8000-000000000003','{}','{"role":"admin","admin_role":"Superadmin","full_name":"Synthetic Client"}'),
 ('00000000-0000-4000-8000-000000000004','{"qf_principal":"admin"}','{"role":"admin","full_name":"Forged Admin"}');
do $vox_assert$
begin
 if(select role from public.profiles where id='00000000-0000-4000-8000-000000000001')is distinct from 'vendor'
 then raise exception 'VENDOR_CLASSIFICATION_BROKEN'; end if;
 if exists(select 1 from public.profiles where role='admin')
 then raise exception 'PUBLIC_METADATA_GRANTED_ADMIN_ROLE'; end if;
 if(select count(*) from public.profiles where role is null)<>3
 then raise exception 'NEUTRAL_IDENTITY_MISSING'; end if;
 if(select count(*) from public.profiles where id='00000000-0000-4000-8000-000000000002' and role is null)<>1
 then raise exception 'STAFF_AUTH_ROLE_NOT_NEUTRAL'; end if;
end;
$vox_assert$;
select 'VOX_TO04L_NEUTRAL_AUTH_TRIGGER_ISOLATED_PG17_PASS_NOT_LIVE_AUTH' as result;
