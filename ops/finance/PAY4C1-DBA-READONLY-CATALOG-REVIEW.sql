-- PAY-4C1 DBA review pack: read-only queries for independently authorized reviewer.
-- DO NOT run via migration tooling or on an unapproved session.
-- No DDL, functions, temporary tables, or writes.
select current_database() as database_name, current_user as reviewer_role,
       current_setting('server_version') as postgres_version;
select n.nspname as schema_name,c.relname as object_name,c.relkind,
       c.relrowsecurity as rls_enabled,c.relforcerowsecurity as force_rls,
       c.relowner::regrole as owner
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
 and (c.relname like 'finance_%' or c.relname like 'vox_%')
order by n.nspname,c.relname;
select n.nspname as schema_name,p.proname as function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       p.proowner::regrole as owner,
       pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as signed_in_execute,
       pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
 and (p.proname like 'qf_finance_v2_%' or p.proname like 'qf_vox_%')
order by n.nspname,p.proname;
select n.nspname,c.relname,
       pg_catalog.has_table_privilege('anon',c.oid,'SELECT') as anon_select,
       pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select,
       pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT') as authenticated_insert
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname like 'finance_%'
 and c.relkind in ('r','v','m') order by c.relname;
