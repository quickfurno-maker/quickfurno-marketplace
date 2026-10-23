-- Step3B5: READ-ONLY Staging catalogue observer for reviewed Phase22 cutover.
-- No DDL, grants, Auth changes, migration-history repairs or action permissions.
-- Safe both BEFORE and AFTER Phase22 because pg_catalog objects are queried by name.
SELECT
  (SELECT count(*) FROM supabase_migrations.schema_migrations) AS recorded_migration_versions,
  EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
          WHERE version='20261006113720') AS phase22_recorded_as_applied,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN
   ('identity_principals','identity_provider_identities','identity_business_bindings','identity_admin_roles')
   AND c.relkind IN ('r','p')) AS identity_tables_installed,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN
   ('identity_principals','identity_provider_identities','identity_business_bindings','identity_admin_roles')
   AND c.relrowsecurity) AS identity_tables_rls_enabled,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN
   ('identity_principals','identity_provider_identities','identity_business_bindings','identity_admin_roles')
   AND (has_table_privilege('anon',c.oid,'SELECT') OR has_table_privilege('authenticated',c.oid,'SELECT'))) AS identity_unauthorized_direct_select_grants,
  (SELECT count(*) FROM auth.mfa_factors WHERE status='verified') AS genuine_verified_mfa_factors;
SELECT
 (SELECT count(*) FROM pg_policies
  WHERE schemaname='public' AND
    (coalesce(qual,'')||coalesce(with_check,'')) LIKE '%is_admin%') AS is_admin_dependent_policies,
 (SELECT count(*) FROM pg_policies
  WHERE schemaname='public' AND
    (coalesce(qual,'')||coalesce(with_check,'')) LIKE '%owns_vendor%') AS owns_vendor_dependent_policies,
 (SELECT md5(string_agg(schemaname || '.' || tablename || ':' || policyname || ':' || cmd || ':' ||
             coalesce(qual,'') || ':' || coalesce(with_check,''), '|' ORDER BY schemaname,tablename,policyname))
  FROM pg_policies WHERE schemaname IN ('public','auth','storage','supabase_migrations')) AS policy_fingerprint;
