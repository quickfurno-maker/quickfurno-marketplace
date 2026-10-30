-- READ ONLY: Staging uckafzuochmbvtiodmcl - DBA/AppSec review evidence.
-- Inspect object-level effective privileges; does NOT represent independent approval.
WITH checked AS (
 SELECT n.nspname AS schema_name,c.relname AS object_name,c.relrowsecurity,c.relforcerowsecurity,
 has_table_privilege('anon',c.oid,'SELECT') anon_select,
 has_table_privilege('anon',c.oid,'INSERT') anon_insert,
 has_table_privilege('anon',c.oid,'UPDATE') anon_update,
 has_table_privilege('anon',c.oid,'DELETE') anon_delete,
 has_table_privilege('authenticated',c.oid,'SELECT') auth_select,
 has_table_privilege('authenticated',c.oid,'INSERT') auth_insert,
 has_table_privilege('authenticated',c.oid,'UPDATE') auth_update,
 has_table_privilege('authenticated',c.oid,'DELETE') auth_delete
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p')
 AND (c.relname LIKE 'vox_%' OR c.relname IN
 ('profiles','vendors','aarohi_prospects','vendor_crm_profiles',
  'vendor_support_threads','communication_conversations','marketplace_service_zones'))
), roles AS (
 SELECT rolname,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles
 WHERE rolname IN ('anon','authenticated','service_role','postgres','supabase_admin')
), privileged_functions AS (
 SELECT n.nspname,p.proname,p.prosecdef,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
 AND (p.proname='is_admin' OR p.proname='owns_vendor' OR p.proname LIKE 'vox_%')
)
SELECT 'QF_VOX_STAGING_ACL_INVENTORY_V1' AS check_id,
 (SELECT jsonb_agg(to_jsonb(checked) ORDER BY object_name) FROM checked) AS table_privileges,
 (SELECT jsonb_agg(to_jsonb(roles) ORDER BY rolname) FROM roles) AS server_roles,
 (SELECT jsonb_agg(to_jsonb(privileged_functions) ORDER BY proname) FROM privileged_functions) AS function_privileges;
