-- STEP3B6 read-only review inventory; SELECT statements ONLY. No policy changes.
-- Can be used by an independently authorized DBA on a managed catalog; not executed here.
SELECT schemaname, tablename, policyname, permissive, roles, cmd,
       qual AS using_expression, with_check AS with_check_expression,
       CASE WHEN concat_ws(' ',qual,with_check) ILIKE '%is_admin(%' THEN true ELSE false END AS references_is_admin,
       CASE WHEN concat_ws(' ',qual,with_check) ILIKE '%owns_vendor(%' THEN true ELSE false END AS references_owns_vendor,
       CASE WHEN concat_ws(' ',qual,with_check) ~* '(is_active|status|suspend)' THEN true ELSE false END AS visible_status_term,
       'UNREVIEWED'::text AS policy_disposition
FROM pg_catalog.pg_policies
WHERE concat_ws(' ',qual,with_check) ILIKE '%is_admin(%'
   OR concat_ws(' ',qual,with_check) ILIKE '%owns_vendor(%'
ORDER BY schemaname, tablename, policyname;
