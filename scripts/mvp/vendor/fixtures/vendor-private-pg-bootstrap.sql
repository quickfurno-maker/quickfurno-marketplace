-- Synthetic fixture, isolated Docker Postgres only.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users(id uuid primary key);
create table public.vendors(id uuid primary key);
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000002');
insert into public.vendors(id) values ('10000000-0000-4000-8000-000000000001');
