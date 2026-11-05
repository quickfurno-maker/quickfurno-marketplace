-- QuickFurno Phase 4 — repeatable read-only Staging catalog observation.
-- REVIEW AND TARGET GUARD: Use ONLY the connected QuickFurno Staging project.
-- Does not install migrations, mutate business data, create bucket, or grant access.
-- No SELECT from vendor/customer records, auth.users, identities, payments, credits.
BEGIN TRANSACTION READ ONLY;

SELECT count(*)::int AS applied_migration_count,
       max(version) AS latest_applied_version
FROM supabase_migrations.schema_migrations;

WITH required(version) AS (VALUES
 ('20261104090000'),('20261104140000'),('20261104153000'),
 ('20261104160000'),('20261104163000'),('20261104170000'),
 ('20261104173000')
)
SELECT r.version, EXISTS(
 SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version=r.version
) AS applied
FROM required r
ORDER BY r.version;

SELECT
 (SELECT count(*) FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
    AND (c.relname ILIKE 'vendor%verification%' OR c.relname ILIKE 'qf_vendor%')
 ) AS vendor_verification_related_tables,
 (SELECT count(*) FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND (p.proname ILIKE 'qf_vendor%private%' OR
         p.proname ILIKE 'qf_vendor%verification%' OR
         p.proname ILIKE 'qf_vox%vendor%')
 ) AS vendor_private_or_vox_functions,
 (SELECT count(*) FROM storage.buckets WHERE id LIKE '%vendor%verification%'
 ) AS verification_bucket_count,
 (SELECT count(*) FROM storage.buckets WHERE id LIKE '%vendor%verification%' AND public=true
 ) AS public_verification_bucket_count,
 (SELECT count(*) FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
 ) AS public_non_rls_table_count;

ROLLBACK;
-- Snapshot is descriptive only: never infer Staging/Production GO from counts.
