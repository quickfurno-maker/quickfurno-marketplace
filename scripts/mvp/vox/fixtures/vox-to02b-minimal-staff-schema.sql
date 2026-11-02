-- Disposable PostgreSQL fixture ONLY. NOT a production migration.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create table public.profiles(id uuid primary key);
create table public.cities(id uuid primary key);
create table public.vox_staff_teams_v1(id uuid primary key,city_id uuid not null references public.cities(id));
create table public.vox_staff_memberships_v1(auth_user_id uuid primary key references public.profiles(id),team_id uuid not null references public.vox_staff_teams_v1(id));
insert into public.profiles(id) values
('00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000002'),
('00000000-0000-4000-8000-000000000003');
insert into public.cities(id) values ('00000000-0000-4000-8000-000000000004');
insert into public.vox_staff_teams_v1(id,city_id)
values ('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004');
insert into public.vox_staff_memberships_v1(auth_user_id,team_id)
values ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000005');
