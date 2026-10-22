-- PAY-4C3 reviewer-owned READ-ONLY catalog checks (neither schema installation nor migration).
-- Run separately on QuickFurno Staging and Production with explicit approved connection;
-- do not execute this file as a migration. No table contents or user email is read.
select current_database() as database_name, current_setting('server_version') as server_version;
select n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.reloptions
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
 and (c.relname like 'finance_%' or c.relname like 'vox_%' or c.relname='vendor_public_v')
 and c.relkind in ('r','v')
order by c.relname;
select p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
p.prosecdef,p.proconfig,pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and (p.proname in ('is_admin','owns_vendor')
 or p.proname like 'qf_finance_v2_%')
order by p.proname;
select tablename,policyname,roles,cmd,qual,with_check
from pg_catalog.pg_policies
where schemaname='public' and tablename in ('profiles','vendors')
order by tablename,policyname;
select pg_catalog.has_table_privilege('authenticated','public.profiles','UPDATE') as authenticated_profiles_update,
pg_catalog.has_column_privilege('authenticated','public.profiles','role','UPDATE') as authenticated_role_update,
pg_catalog.has_column_privilege('authenticated','public.profiles','is_active','UPDATE') as authenticated_active_update;
