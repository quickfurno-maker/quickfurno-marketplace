-- READ ONLY: QuickFurno VOX managed Staging uckafzuochmbvtiodmcl.
-- Not an approval to install the quarantined 7+23 SQL candidates.
WITH migrations AS (
 SELECT count(*)::int ledger_count,max(version) latest_version,
 count(*) FILTER(WHERE version='20261029160138')::int p06_recorded
 FROM supabase_migrations.schema_migrations
), objects AS (
 SELECT count(*)::int vox_tables,
 count(*) FILTER(WHERE c.relrowsecurity AND c.relforcerowsecurity)::int vox_force_rls
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname LIKE 'vox_%'
), functions AS (
 SELECT count(*)::int vox_functions FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'vox_%'
), authz AS (
 SELECT position('is_active is true' IN lower(pg_get_functiondef('public.is_admin()'::regprocedure)))>0 p06_active_predicate,
 has_function_privilege('authenticated','public.is_admin()','EXECUTE') auth_execute,
 has_function_privilege('anon','public.is_admin()','EXECUTE') anon_execute
), identities AS (
 SELECT (SELECT count(*)::int FROM auth.users) auth_users,
 (SELECT count(distinct user_id)::int FROM auth.mfa_factors WHERE status='verified') verified_aal2_principals
), policy_counts AS (
 SELECT count(*) FILTER(WHERE strpos(coalesce(qual,'')||' '||coalesce(with_check,''),'is_admin(')>0)::int admin_policies,
 count(*) FILTER(WHERE strpos(coalesce(qual,'')||' '||coalesce(with_check,''),'owns_vendor(')>0)::int vendor_policies
 FROM pg_policies WHERE schemaname='public'
)
SELECT 'QF_VOX_STAGING_PRECHECK_V1' check_id,migrations.*,objects.*,functions.*,authz.*,identities.*,policy_counts.*,
CASE
 WHEN migrations.p06_recorded<>1 OR authz.p06_active_predicate IS NOT TRUE THEN 'HOLD_P06_MANAGED_STAGING_NOT_APPLIED'
 WHEN objects.vox_tables<>0 OR functions.vox_functions<>0 THEN 'HOLD_VOX_OBJECT_DRIFT'
 WHEN authz.auth_execute IS NOT TRUE OR authz.anon_execute IS NOT FALSE THEN 'HOLD_FUNCTION_GRANT_DRIFT'
 WHEN policy_counts.admin_policies<>59 OR policy_counts.vendor_policies<>22 THEN 'HOLD_POLICY_DRIFT'
 WHEN identities.verified_aal2_principals<2 THEN 'HOLD_DISTINCT_TEAM_LEADER_MFA'
 ELSE 'REQUIRES_INDEPENDENT_DBA_APPSEC_REVIEW_AND_SIGNED_OWNER_RELEASE'
END release_decision
FROM migrations CROSS JOIN objects CROSS JOIN functions CROSS JOIN authz CROSS JOIN identities CROSS JOIN policy_counts;
