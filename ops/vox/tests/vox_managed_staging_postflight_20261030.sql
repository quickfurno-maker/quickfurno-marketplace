-- READ ONLY: QuickFurno VOX managed Staging uckafzuochmbvtiodmcl POST-MIGRATION.
-- This is supplementary to genuine Owner/Team Leader/Staff AAL2 E2E.
WITH vox AS (
 SELECT c.oid,c.relrowsecurity,c.relforcerowsecurity
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname LIKE 'vox_%'
), checks AS (
 SELECT count(*)::int vox_tables,
 count(*) FILTER(WHERE relrowsecurity AND relforcerowsecurity)::int forced_rls,
 count(*) FILTER(WHERE
 has_table_privilege('anon',oid,'SELECT') OR has_table_privilege('anon',oid,'INSERT') OR
 has_table_privilege('anon',oid,'UPDATE') OR has_table_privilege('anon',oid,'DELETE'))::int anon_privileged,
 count(*) FILTER(WHERE
 has_table_privilege('authenticated',oid,'SELECT') OR has_table_privilege('authenticated',oid,'INSERT') OR
 has_table_privilege('authenticated',oid,'UPDATE') OR has_table_privilege('authenticated',oid,'DELETE'))::int authenticated_privileged
 FROM vox
), principals AS (
 SELECT count(distinct user_id)::int verified_aal2_principals
 FROM auth.mfa_factors WHERE status='verified'
)
SELECT 'QF_VOX_STAGING_POSTCHECK_V1' check_id,checks.*,principals.*,
CASE
 WHEN checks.vox_tables<>39 THEN 'FAIL_VOX_SCHEMA_COUNT'
 WHEN checks.forced_rls<>39 THEN 'FAIL_FORCE_RLS'
 WHEN checks.anon_privileged<>0 THEN 'FAIL_ANON_TABLE_PRIVILEGES'
 WHEN checks.authenticated_privileged<>0 THEN 'FAIL_AUTHENTICATED_TABLE_PRIVILEGES'
 WHEN principals.verified_aal2_principals<2 THEN 'HOLD_REAL_TEAM_LEADER_AAL2'
 ELSE 'SCHEMA_ONLY_PASS_REQUIRES_REAL_STAFF_AUTHZ_E2E'
END release_decision
FROM checks CROSS JOIN principals;
