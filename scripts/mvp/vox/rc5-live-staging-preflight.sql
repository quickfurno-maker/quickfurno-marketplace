-- VOX RC5 managed STAGING preflight — READ ONLY, no data rows or secrets.
-- Operator MUST separately verify target project ID uckafzuochmbvtiodmcl.
-- This literal is an expected target label, NOT proof of server identity.
-- No transaction writes, migration repair, DDL, source data export or approvals.
SELECT jsonb_build_object(
 'schema','qf.vox.rc5.managed-staging-readonly.v1',
 'expected_project_ref','uckafzuochmbvtiodmcl',
 'database_time_utc',timezone('utc',now()),
 'server_version_num',current_setting('server_version_num')::int,
 'migration_count',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'migration_max_version',(SELECT max(version) FROM supabase_migrations.schema_migrations),
 'p06_recorded',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261029160138'),
 'installed_vox_staff_tables',(SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'vox_%'),
 'verified_mfa_principals',(SELECT count(DISTINCT user_id) FROM auth.mfa_factors WHERE status='verified'),
 'admin_policy_references',(SELECT count(*) FROM pg_policies WHERE schemaname='public' AND
   (qual ILIKE '%is_admin%' OR with_check ILIKE '%is_admin%')),
 'required_extension_status',(
   SELECT jsonb_object_agg(required_name,EXISTS(
     SELECT 1 FROM pg_extension e WHERE e.extname=required_name))
   FROM (VALUES('pgcrypto'),('postgis'),('supabase_vault')) AS r(required_name)),
 'relevant_table_security',(
   SELECT jsonb_agg(jsonb_build_object(
    'table',c.relname,
    'owner',pg_get_userbyid(c.relowner),
    'rls_enabled',c.relrowsecurity,
    'force_rls',c.relforcerowsecurity,
    'anon_select',has_table_privilege('anon',c.oid,'SELECT'),
    'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'),
    'service_role_select',has_table_privilege('service_role',c.oid,'SELECT')
   ) ORDER BY c.relname)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p')
     AND c.relname IN ('profiles','communication_conversations',
       'communication_preferences','communication_suppressions','communication_consent_events')
 )
) AS vox_staging_preflight;
