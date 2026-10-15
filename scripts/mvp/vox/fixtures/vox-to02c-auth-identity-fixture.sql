-- Synthetic identities for disposable PG17 ONLY; no Supabase Auth or live user data.
create schema auth;
create table auth.users(id uuid primary key,raw_app_meta_data jsonb not null default '{}');
alter table public.profiles add column role text;
alter table public.profiles add column is_active boolean not null default true;
alter table public.cities add column is_active boolean not null default true;
alter table public.vox_staff_teams_v1 add column is_active boolean not null default true;
alter table public.vox_staff_memberships_v1 add column staff_role text not null default 'support_agent';
alter table public.vox_staff_memberships_v1 add column is_active boolean not null default true;
alter table public.vox_staff_memberships_v1 add column revoked_at timestamptz;
alter table public.vox_staff_memberships_v1 add column expires_at timestamptz not null default (now()+interval '60 days');
update public.profiles set role='admin' where id='00000000-0000-4000-8000-000000000001';
insert into auth.users(id,raw_app_meta_data) values
 ('00000000-0000-4000-8000-000000000001','{"admin_role":"Superadmin"}'::jsonb),
 ('00000000-0000-4000-8000-000000000002','{"qf_principal":"vox_staff"}'::jsonb),
 ('00000000-0000-4000-8000-000000000003','{"qf_principal":"vox_staff","vox_role":"team_leader"}'::jsonb);
insert into public.vox_staff_memberships_v1(auth_user_id,team_id,staff_role)
values('00000000-0000-4000-8000-000000000003',
       '00000000-0000-4000-8000-000000000005','team_leader');
