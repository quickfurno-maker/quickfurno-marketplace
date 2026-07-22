-- ============================================================================
-- verify_qf_mvp_staging_baseline.sql — QF-MVP-20.2B
-- READ-ONLY post-application verification for the STAGING baseline.
-- SELECT-only: no INSERT/UPDATE/DELETE/DDL/GRANT/REVOKE and no data-mutating
-- function call. Run against STAGING (uckafzuochmbvtiodmcl) AFTER applying the
-- baseline in QF-MVP-20.2C. Never run write operations here.
--
-- Returns rows: check_name | expected | actual | status | details
-- Counts are pg_catalog (semantic). Where the QF-MVP-20.2A audit reported a
-- text-pattern figure (unique 47, check 178) the reconciliation is in details.
-- ============================================================================
WITH checks AS (

  SELECT '01_pg_version_and_db' AS check_name, 'present' AS expected,
         (SELECT current_setting('server_version')) AS actual,
         'PASS' AS status,
         ('db=' || current_database() || ' (identity only; no secrets)') AS details
  UNION ALL
  SELECT '02_public_base_tables', '62',
         (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind='r'),
         CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind='r')=62 THEN 'PASS' ELSE 'FAIL' END,
         'base tables in public'
  UNION ALL
  SELECT '03_public_functions', '39',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')=39 THEN 'PASS' ELSE 'FAIL' END,
         'functions in public'
  UNION ALL
  SELECT '04_security_definer_functions', '33',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef),
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef)=33 THEN 'PASS' ELSE 'FAIL' END,
         'SECURITY DEFINER functions'
  UNION ALL
  SELECT '05_rls_enabled_tables', '62',
         (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity),
         CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity)=62 THEN 'PASS' ELSE 'FAIL' END,
         'all base tables have RLS enabled'
  UNION ALL
  SELECT '06_policies', '67',
         (SELECT count(*)::text FROM pg_policies WHERE schemaname='public'),
         CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname='public')=67 THEN 'PASS' ELSE 'FAIL' END,
         'RLS policies'
  UNION ALL
  SELECT '07_primary_keys', '62',
         (SELECT count(*)::text FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='p'),
         CASE WHEN (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='p')=62 THEN 'PASS' ELSE 'FAIL' END,
         'primary key constraints'
  UNION ALL
  SELECT '08_foreign_keys', '69',
         (SELECT count(*)::text FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f'),
         CASE WHEN (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f')=69 THEN 'PASS' ELSE 'FAIL' END,
         '5 reference auth.users, 64 reference public'
  UNION ALL
  SELECT '09_unique_constraints', '15',
         (SELECT count(*)::text FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='u'),
         CASE WHEN (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='u')=15 THEN 'PASS' ELSE 'FAIL' END,
         'catalog UNIQUE constraints=15; +32 unique indexes = the audit''s 47'
  UNION ALL
  SELECT '10_check_constraints', '169',
         (SELECT count(*)::text FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='c'),
         CASE WHEN (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='c')=169 THEN 'PASS' ELSE 'FAIL' END,
         'catalog CHECK constraints=169 (audit''s 178 was a text-pattern line count)'
  UNION ALL
  SELECT '11_indexes', '180',
         (SELECT count(*)::text FROM pg_indexes WHERE schemaname='public'),
         CASE WHEN (SELECT count(*) FROM pg_indexes WHERE schemaname='public')=180 THEN 'PASS' ELSE 'FAIL' END,
         '148 non-unique + 32 unique indexes'
  UNION ALL
  SELECT '12_triggers', '0',
         (SELECT count(*)::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),
         CASE WHEN (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal)=0 THEN 'PASS' ELSE 'FAIL' END,
         'no enforcement triggers exist yet (QF-MVP-20 remediation adds them)'
  UNION ALL
  SELECT '13_views', '0',
         (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v'),
         CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v')=0 THEN 'PASS' ELSE 'FAIL' END,
         'no views (public-safe projection is later remediation)'
  UNION ALL
  SELECT '14_materialized_views', '0',
         (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='m'),
         CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='m')=0 THEN 'PASS' ELSE 'FAIL' END,
         'no materialized views'
  UNION ALL
  -- 15. every public table empty (query_to_xml runs a read-only count per table)
  SELECT '15_all_tables_zero_rows', '0',
         (SELECT coalesce(max((xpath('/row/c/text()', query_to_xml(
             format('SELECT count(*) AS c FROM %I.%I', schemaname, tablename), false, true, '')))[1]::text::int), 0)::text
          FROM pg_tables WHERE schemaname='public'),
         CASE WHEN (SELECT coalesce(max((xpath('/row/c/text()', query_to_xml(
             format('SELECT count(*) AS c FROM %I.%I', schemaname, tablename), false, true, '')))[1]::text::int), 0)
          FROM pg_tables WHERE schemaname='public')=0 THEN 'PASS' ELSE 'FAIL' END,
         'max row count across all public tables (must be 0 right after baseline)'
  UNION ALL
  SELECT '16_auth_users_exists', 'present',
         (CASE WHEN to_regclass('auth.users') IS NULL THEN 'missing' ELSE 'present' END),
         CASE WHEN to_regclass('auth.users') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'managed Auth schema present (not recreated by baseline)'
  UNION ALL
  SELECT '17_gen_random_uuid_exists', 'present',
         (CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='gen_random_uuid') THEN 'present' ELSE 'missing' END),
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='gen_random_uuid') THEN 'PASS' ELSE 'FAIL' END,
         'uuid default generator available'
  UNION ALL
  SELECT '18_six_assignment_rpcs_exist', '6',
         (SELECT count(DISTINCT proname)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND proname IN
            ('admin_smart_assign_lead_to_vendors','assign_client_selected_vendor_to_group',
             'assign_vendor_to_requirement_group','assign_lead_to_preferred_vendor',
             'assign_lead_to_paid_vendors_phase26a','assign_lead_to_vendors')),
         CASE WHEN (SELECT count(DISTINCT proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND proname IN
            ('admin_smart_assign_lead_to_vendors','assign_client_selected_vendor_to_group',
             'assign_vendor_to_requirement_group','assign_lead_to_preferred_vendor',
             'assign_lead_to_paid_vendors_phase26a','assign_lead_to_vendors'))=6 THEN 'PASS' ELSE 'FAIL' END,
         'compatibility assignment RPCs present'
  UNION ALL
  -- 19. four blocker RPCs NOT executable by PUBLIC / anon / authenticated
  SELECT '19_blockers_not_public_anon_auth', '0 grants',
         (SELECT count(*)::text FROM (VALUES
             ('public.admin_smart_assign_lead_to_vendors(uuid,uuid[],boolean,integer)'),
             ('public.assign_client_selected_vendor_to_group(uuid,uuid,uuid,integer)'),
             ('public.assign_vendor_to_requirement_group(uuid,uuid,uuid,text,integer,text)'),
             ('public.assign_lead_to_preferred_vendor(uuid,uuid)')) f(sig),
           LATERAL (VALUES ('public'),('anon'),('authenticated')) r(role)
          WHERE to_regprocedure(f.sig) IS NOT NULL
            AND has_function_privilege(r.role, to_regprocedure(f.sig), 'EXECUTE')),
         CASE WHEN (SELECT count(*) FROM (VALUES
             ('public.admin_smart_assign_lead_to_vendors(uuid,uuid[],boolean,integer)'),
             ('public.assign_client_selected_vendor_to_group(uuid,uuid,uuid,integer)'),
             ('public.assign_vendor_to_requirement_group(uuid,uuid,uuid,text,integer,text)'),
             ('public.assign_lead_to_preferred_vendor(uuid,uuid)')) f(sig),
           LATERAL (VALUES ('public'),('anon'),('authenticated')) r(role)
          WHERE to_regprocedure(f.sig) IS NOT NULL
            AND has_function_privilege(r.role, to_regprocedure(f.sig), 'EXECUTE'))=0 THEN 'PASS' ELSE 'FAIL' END,
         'no PUBLIC/anon/authenticated EXECUTE on any of the 4 blocker RPCs'
  UNION ALL
  -- 20. legacy credit primitives not executable by PUBLIC/anon/authenticated
  SELECT '20_legacy_credit_not_public_anon_auth', '0 grants',
         (SELECT count(*)::text FROM (VALUES
             ('public.deduct_vendor_credit(uuid)'),
             ('public.restore_vendor_credit(uuid)'),
             ('public.increment_vendor_credits(uuid,integer)')) f(sig),
           LATERAL (VALUES ('public'),('anon'),('authenticated')) r(role)
          WHERE to_regprocedure(f.sig) IS NOT NULL
            AND has_function_privilege(r.role, to_regprocedure(f.sig), 'EXECUTE')),
         CASE WHEN (SELECT count(*) FROM (VALUES
             ('public.deduct_vendor_credit(uuid)'),
             ('public.restore_vendor_credit(uuid)'),
             ('public.increment_vendor_credits(uuid,integer)')) f(sig),
           LATERAL (VALUES ('public'),('anon'),('authenticated')) r(role)
          WHERE to_regprocedure(f.sig) IS NOT NULL
            AND has_function_privilege(r.role, to_regprocedure(f.sig), 'EXECUTE'))=0 THEN 'PASS' ELSE 'FAIL' END,
         'legacy un-ledgered credit primitives are service_role-only'
  UNION ALL
  -- 21. qf_apply_vendor_credit_delta service_role-only
  SELECT '21_credit_delta_service_role_only',
         'service_role=yes; others=no',
         ('sr=' || has_function_privilege('service_role', to_regprocedure('public.qf_apply_vendor_credit_delta(uuid,integer,text,text,text,text,text,boolean)'), 'EXECUTE')::text
          || ' anon=' || has_function_privilege('anon', to_regprocedure('public.qf_apply_vendor_credit_delta(uuid,integer,text,text,text,text,text,boolean)'), 'EXECUTE')::text
          || ' auth=' || has_function_privilege('authenticated', to_regprocedure('public.qf_apply_vendor_credit_delta(uuid,integer,text,text,text,text,text,boolean)'), 'EXECUTE')::text),
         CASE WHEN has_function_privilege('service_role', to_regprocedure('public.qf_apply_vendor_credit_delta(uuid,integer,text,text,text,text,text,boolean)'), 'EXECUTE')
              AND NOT has_function_privilege('anon', to_regprocedure('public.qf_apply_vendor_credit_delta(uuid,integer,text,text,text,text,text,boolean)'), 'EXECUTE')
              AND NOT has_function_privilege('authenticated', to_regprocedure('public.qf_apply_vendor_credit_delta(uuid,integer,text,text,text,text,text,boolean)'), 'EXECUTE')
              THEN 'PASS' ELSE 'FAIL' END,
         'canonical credit authority is service_role-only'
  UNION ALL
  -- 22. no anon SELECT on vendor monetization columns
  SELECT '22_anon_no_monetization_columns', 'false (all)',
         (SELECT string_agg(col || '=' || has_column_privilege('anon','public.vendors',col,'SELECT')::text, ' ')
            FROM unnest(ARRAY['total_credits','remaining_credits','paid_status','package_name','package_status','package_expires_at']) col),
         CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['total_credits','remaining_credits','paid_status','package_name','package_status','package_expires_at']) col
                WHERE has_column_privilege('anon','public.vendors',col,'SELECT')) THEN 'PASS' ELSE 'FAIL' END,
         'anon has no SELECT on any vendors monetization column'
  UNION ALL
  SELECT '23_anon_no_vendor_credit_logs', 'false',
         has_table_privilege('anon','public.vendor_credit_logs','SELECT')::text,
         CASE WHEN NOT has_table_privilege('anon','public.vendor_credit_logs','SELECT') THEN 'PASS' ELSE 'FAIL' END,
         'anon cannot read the credit ledger'
  UNION ALL
  SELECT '24_anon_no_vendor_packages', 'false',
         has_table_privilege('anon','public.vendor_packages','SELECT')::text,
         CASE WHEN NOT has_table_privilege('anon','public.vendor_packages','SELECT') THEN 'PASS' ELSE 'FAIL' END,
         'anon cannot read vendor_packages'
  UNION ALL
  SELECT '25_anon_no_payments', 'false',
         has_table_privilege('anon','public.payments','SELECT')::text,
         CASE WHEN NOT has_table_privilege('anon','public.payments','SELECT') THEN 'PASS' ELSE 'FAIL' END,
         'anon cannot read payments'
  UNION ALL
  SELECT '26_provider_accounts_empty', '0',
         (SELECT coalesce((SELECT count(*) FROM communication_provider_accounts),0)::text),
         CASE WHEN coalesce((SELECT count(*) FROM communication_provider_accounts),0)=0 THEN 'PASS' ELSE 'FAIL' END,
         'no provider accounts'
  UNION ALL
  SELECT '27_provider_template_mappings_empty', '0',
         (SELECT coalesce((SELECT count(*) FROM communication_provider_template_mappings),0)::text),
         CASE WHEN coalesce((SELECT count(*) FROM communication_provider_template_mappings),0)=0 THEN 'PASS' ELSE 'FAIL' END,
         'no provider template mappings'
  UNION ALL
  SELECT '28_communication_messages_empty', '0',
         (SELECT coalesce((SELECT count(*) FROM communication_messages),0)::text),
         CASE WHEN coalesce((SELECT count(*) FROM communication_messages),0)=0 THEN 'PASS' ELSE 'FAIL' END,
         'no communication messages / sends'
  UNION ALL
  SELECT '29_provider_runtime_disabled', 'disabled or empty',
         (SELECT coalesce((SELECT count(*) FROM communication_provider_runtime_policies
             WHERE activation_status <> 'disabled' OR outbound_enabled),0)::text),
         CASE WHEN coalesce((SELECT count(*) FROM communication_provider_runtime_policies
             WHERE activation_status <> 'disabled' OR outbound_enabled),0)=0 THEN 'PASS' ELSE 'FAIL' END,
         'no active/canary provider policy; Meta stays disabled (0 rows expected)'
  UNION ALL
  SELECT '30_no_false_migration_history', '<=1 baseline row',
         (SELECT CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'no-history-table'
                 ELSE (SELECT count(*)::text FROM supabase_migrations.schema_migrations) END),
         CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL
                   OR (SELECT count(*) FROM supabase_migrations.schema_migrations) <= 1 THEN 'PASS' ELSE 'FAIL' END,
         'at most the single baseline identity row; the 68 repo migrations are NOT recorded as applied'
)
SELECT check_name, expected, actual, status, details FROM checks ORDER BY check_name;
