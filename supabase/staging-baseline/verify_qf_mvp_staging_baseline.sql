-- ============================================================================
-- verify_qf_mvp_staging_baseline.sql — QF-MVP-20.2B
--   corrected QF-MVP-20.2C1R (identity-scoped functions)
--   corrected QF-MVP-20.2C2R (exact OID resolution + constraint-backed index
--                             classification)
-- READ-ONLY post-application verification for the STAGING baseline.
-- SELECT-only: no INSERT/UPDATE/DELETE/MERGE/COPY/DDL/GRANT/REVOKE/COMMENT/
-- CALL/DO and no invocation of any application (mutating) function.
-- Run against STAGING (uckafzuochmbvtiodmcl). Never run write operations here.
--
-- Returns rows: check_name | expected | actual | status | details
--
-- QF-MVP-20.2C2R corrections:
--  * Functions are matched by EXACT OID via
--      to_regprocedure(format('%I.%I(%s)', schema, name, type_args))
--    Type-only signatures are NEVER string-compared against
--    pg_get_function_identity_arguments() (which returns "argname type").
--    That function is used for human-readable details only.
--  * Indexes are classified via pg_constraint.conindid: an index referenced by
--    a constraint is "constraint-backed" (77 = 62 PK + 15 UNIQUE); the reviewed
--    180 / 32 expectations refer to STANDALONE indexes only. Catalog totals
--    (257 / 109) are retained as supporting checks.
-- ============================================================================
WITH
-- The exact 39 QuickFurno functions created by the baseline, expressed as
-- schema + name + TYPE-ONLY argument signature (resolved to OID below).
expected_fn(fschema, fname, type_args) AS (VALUES
  ('public','admin_smart_assign_lead_to_vendors','uuid, uuid[], boolean, integer'),
  ('public','apply_communication_consent_command','text, text, text, text, text, uuid, text, text, text, text, uuid, text, text, text, text'),
  ('public','assign_client_selected_vendor_to_group','uuid, uuid, uuid, integer'),
  ('public','assign_lead_to_paid_vendors_phase26a','uuid, uuid[]'),
  ('public','assign_lead_to_preferred_vendor','uuid, uuid'),
  ('public','assign_lead_to_vendors','uuid, uuid[], boolean, text'),
  ('public','assign_package_to_vendor','uuid, uuid, uuid'),
  ('public','assign_vendor_to_requirement_group','uuid, uuid, uuid, text, integer, text'),
  ('public','check_duplicate_lead','text, text, text'),
  ('public','communication_consent_receipt_results_valid','jsonb'),
  ('public','communication_consent_receipt_scope_result_valid','jsonb, text'),
  ('public','deduct_vendor_credit','uuid'),
  ('public','expire_vendor_packages',''),
  ('public','get_public_eligible_vendors','text, text, text'),
  ('public','get_setting_int','text, integer'),
  ('public','handle_new_user',''),
  ('public','increment_vendor_credits','uuid, integer'),
  ('public','is_admin',''),
  ('public','owns_vendor','uuid'),
  ('public','qf_apply_vendor_credit_delta','uuid, integer, text, text, text, text, text, boolean'),
  ('public','qf_claim_auth_delivery_attempt','text, text, text, text, text, integer, text, text, uuid, uuid, text'),
  ('public','qf_claim_consent_ack_intents','text, integer, interval'),
  ('public','qf_expire_consent_ack_intents','integer'),
  ('public','qf_finalize_auth_delivery_attempt','uuid, text, text, text, text, uuid'),
  ('public','qf_lead_vendor_parent_group_compatible','text, text, text, text[], text, text[]'),
  ('public','qf_norm_text','text'),
  ('public','qf_normalize_category_label','text'),
  ('public','qf_parent_category_group','text'),
  ('public','qf_recover_stale_dispatching_consent_ack_intents','interval, integer'),
  ('public','qf_reserve_consent_ack_provider_attempt','text, text'),
  ('public','qf_terminalize_consent_ack_intent','text, text, text'),
  ('public','refresh_requirement_group_counters','uuid'),
  ('public','restore_vendor_credit','uuid'),
  ('public','update_vendor_visibility','uuid'),
  ('public','vendor_auth_claim_reset_grant','text'),
  ('public','vendor_auth_consume_reset_challenge_and_issue_grant','uuid, uuid, uuid, uuid, text'),
  ('public','vendor_auth_consume_whatsapp_challenge','uuid, uuid, uuid, uuid, text, text'),
  ('public','vendor_auth_issue_challenge','uuid, uuid, uuid, uuid, text, text, text'),
  ('public','vendor_auth_register_failed_attempt','uuid, text')
),
-- Exact resolution to a catalog OID (authoritative comparison key).
expected_resolved AS (
  SELECT e.fschema, e.fname, e.type_args,
         to_regprocedure(format('%I.%I(%s)', e.fschema, e.fname, e.type_args)) AS proc_reg
  FROM expected_fn e
),
-- The single allowed platform-managed public function, resolved separately.
managed_fn AS (
  SELECT to_regprocedure('public.rls_auto_enable()') AS proc_reg
),
-- Live public functions (identity string used for DETAILS only).
pubfn AS (
  SELECT p.oid AS proc_oid, p.proname, p.prosecdef,
         pg_get_function_identity_arguments(p.oid) AS ident
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
),
qf_found AS (
  SELECT r.fname, r.type_args, r.proc_reg
  FROM expected_resolved r
  WHERE r.proc_reg IS NOT NULL
    AND EXISTS (SELECT 1 FROM pubfn f WHERE f.proc_oid = r.proc_reg::oid)
),
qf_missing AS (
  SELECT r.fname, r.type_args
  FROM expected_resolved r
  WHERE r.proc_reg IS NULL
     OR NOT EXISTS (SELECT 1 FROM pubfn f WHERE f.proc_oid = r.proc_reg::oid)
),
qf_unresolved AS (
  SELECT r.fname, r.type_args FROM expected_resolved r WHERE r.proc_reg IS NULL
),
qf_dupe AS (
  SELECT proc_reg FROM expected_resolved
  WHERE proc_reg IS NOT NULL GROUP BY proc_reg HAVING count(*) > 1
),
qf_sd AS (
  SELECT f.proc_oid FROM pubfn f
  WHERE f.prosecdef
    AND f.proc_oid IN (SELECT proc_reg::oid FROM expected_resolved WHERE proc_reg IS NOT NULL)
),
qf_unexpected AS (
  SELECT f.proname, f.ident FROM pubfn f
  WHERE f.proc_oid NOT IN (SELECT proc_reg::oid FROM expected_resolved WHERE proc_reg IS NOT NULL)
    AND f.proc_oid NOT IN (SELECT proc_reg::oid FROM managed_fn WHERE proc_reg IS NOT NULL)
),
-- Index classification: constraint-backed vs standalone (pg_constraint.conindid).
idx AS (
  SELECT i.indexrelid, i.indisunique,
         EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid) AS constraint_backed
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
),
checks AS (

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
         'QuickFurno application base tables in public'

  -- ---- functions: exact OID resolution -----------------------------------
  UNION ALL
  SELECT '03a_quickfurno_function_count', '39',
         (SELECT count(*)::text FROM qf_found),
         CASE WHEN (SELECT count(*) FROM qf_found)=39 THEN 'PASS' ELSE 'FAIL' END,
         'expected signatures resolved via to_regprocedure and found in public pg_proc (OID match)'
  UNION ALL
  SELECT '03b_quickfurno_function_missing', '0',
         (SELECT count(*)::text FROM qf_missing),
         CASE WHEN (SELECT count(*) FROM qf_missing)=0 THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT 'missing: ' || string_agg(fname || '(' || type_args || ')', '; ' ORDER BY fname) FROM qf_missing),
                  'none missing (all 39 expected signatures resolve and exist)')
  UNION ALL
  SELECT '03c_quickfurno_function_duplicate_or_unresolved', '0',
         ((SELECT count(*) FROM qf_unresolved) + (SELECT count(*) FROM qf_dupe))::text,
         CASE WHEN ((SELECT count(*) FROM qf_unresolved) + (SELECT count(*) FROM qf_dupe))=0 THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT 'unresolved: ' || string_agg(fname || '(' || type_args || ')', '; ' ORDER BY fname) FROM qf_unresolved),
                  'all signatures resolve to a non-null, distinct OID')
  UNION ALL
  SELECT '03d_quickfurno_security_definer_count', '33',
         (SELECT count(*)::text FROM qf_sd),
         CASE WHEN (SELECT count(*) FROM qf_sd)=33 THEN 'PASS' ELSE 'FAIL' END,
         'SECURITY DEFINER counted ONLY across the 39 resolved QuickFurno OIDs'
  UNION ALL
  SELECT '03e_allowed_managed_public_function_count', '1',
         (SELECT count(*)::text FROM pubfn f WHERE f.proc_oid IN (SELECT proc_reg::oid FROM managed_fn WHERE proc_reg IS NOT NULL)),
         CASE WHEN (SELECT count(*) FROM pubfn f WHERE f.proc_oid IN (SELECT proc_reg::oid FROM managed_fn WHERE proc_reg IS NOT NULL))=1 THEN 'PASS' ELSE 'FAIL' END,
         'exactly one managed public.rls_auto_enable() (Supabase ensure_rls foundation); do not drop'
  UNION ALL
  SELECT '03f_unexpected_public_function_count', '0',
         (SELECT count(*)::text FROM qf_unexpected),
         CASE WHEN (SELECT count(*) FROM qf_unexpected)=0 THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT 'unexpected: ' || string_agg(proname || '(' || ident || ')', '; ' ORDER BY proname) FROM qf_unexpected),
                  'none unexpected (identity args shown for humans only)')
  UNION ALL
  SELECT '03g_total_public_function_count', '40',
         (SELECT count(*)::text FROM pubfn),
         CASE WHEN (SELECT count(*) FROM pubfn)=40 THEN 'PASS' ELSE 'FAIL' END,
         'SUPPORTING ONLY: 39 QuickFurno + 1 managed; the OID checks above are authoritative'

  -- ---- structure ----------------------------------------------------------
  UNION ALL
  SELECT '04_rls_enabled_tables', '62',
         (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity),
         CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity)=62 THEN 'PASS' ELSE 'FAIL' END,
         'all base tables have RLS enabled'
  UNION ALL
  SELECT '05_policies', '67',
         (SELECT count(*)::text FROM pg_policies WHERE schemaname='public'),
         CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname='public')=67 THEN 'PASS' ELSE 'FAIL' END,
         'RLS policies'
  UNION ALL
  SELECT '06a_primary_key_constraint_count', '62',
         (SELECT count(*)::text FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='p'),
         CASE WHEN (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='p')=62 THEN 'PASS' ELSE 'FAIL' END,
         'primary key constraints'
  UNION ALL
  SELECT '06b_foreign_key_constraint_count', '69',
         (SELECT count(*)::text FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f'),
         CASE WHEN (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f')=69 THEN 'PASS' ELSE 'FAIL' END,
         '5 reference auth.users, 64 reference public'
  UNION ALL
  SELECT '06c_unique_constraint_count', '15',
         (SELECT count(*)::text FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='u'),
         CASE WHEN (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='u')=15 THEN 'PASS' ELSE 'FAIL' END,
         'catalog UNIQUE constraints (NOT 47; 47 is constraints+standalone unique indexes)'
  UNION ALL
  SELECT '06d_check_constraint_count', '169',
         (SELECT count(*)::text FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='c'),
         CASE WHEN (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='c')=169 THEN 'PASS' ELSE 'FAIL' END,
         'catalog CHECK constraints (NOT 178, which was a text-pattern line count)'

  -- ---- indexes: constraint-backed vs standalone ---------------------------
  UNION ALL
  SELECT '07a_constraint_backed_index_count', '77',
         (SELECT count(*)::text FROM idx WHERE constraint_backed),
         CASE WHEN (SELECT count(*) FROM idx WHERE constraint_backed)=77 THEN 'PASS' ELSE 'FAIL' END,
         'indexes auto-created for constraints (62 PK + 15 UNIQUE), identified via pg_constraint.conindid'
  UNION ALL
  SELECT '07b_standalone_index_count', '180',
         (SELECT count(*)::text FROM idx WHERE NOT constraint_backed),
         CASE WHEN (SELECT count(*) FROM idx WHERE NOT constraint_backed)=180 THEN 'PASS' ELSE 'FAIL' END,
         'public-table indexes NOT referenced by any pg_constraint.conindid (the reviewed 180)'
  UNION ALL
  SELECT '07c_standalone_unique_index_count', '32',
         (SELECT count(*)::text FROM idx WHERE NOT constraint_backed AND indisunique),
         CASE WHEN (SELECT count(*) FROM idx WHERE NOT constraint_backed AND indisunique)=32 THEN 'PASS' ELSE 'FAIL' END,
         'standalone unique indexes only; a PK/UNIQUE constraint index is never counted here'
  UNION ALL
  SELECT '07d_combined_uniqueness_mechanism_count', '47',
         ((SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='u')
          + (SELECT count(*) FROM idx WHERE NOT constraint_backed AND indisunique))::text,
         CASE WHEN ((SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='u')
          + (SELECT count(*) FROM idx WHERE NOT constraint_backed AND indisunique))=47 THEN 'PASS' ELSE 'FAIL' END,
         '15 UNIQUE constraints + 32 standalone unique indexes = 47 uniqueness mechanisms'
  UNION ALL
  SELECT '07e_total_public_table_catalog_index_count', '257',
         (SELECT count(*)::text FROM idx),
         CASE WHEN (SELECT count(*) FROM idx)=257 THEN 'PASS' ELSE 'FAIL' END,
         'SUPPORTING ONLY: 180 standalone + 77 constraint-backed'
  UNION ALL
  SELECT '07f_total_catalog_unique_index_count', '109',
         (SELECT count(*)::text FROM idx WHERE indisunique),
         CASE WHEN (SELECT count(*) FROM idx WHERE indisunique)=109 THEN 'PASS' ELSE 'FAIL' END,
         'SUPPORTING ONLY: 32 standalone unique + 77 constraint-backed'

  -- ---- remaining structure ------------------------------------------------
  UNION ALL
  SELECT '08_triggers_on_public_tables', '0',
         (SELECT count(*)::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),
         CASE WHEN (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal)=0 THEN 'PASS' ELSE 'FAIL' END,
         'QuickFurno public-TABLE triggers = 0 (managed ensure_rls is an EVENT trigger and is not counted here)'
  UNION ALL
  SELECT '09_views', '0',
         (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v'),
         CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v')=0 THEN 'PASS' ELSE 'FAIL' END,
         'no views (public-safe projection is later remediation)'
  UNION ALL
  SELECT '10_materialized_views', '0',
         (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='m'),
         CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='m')=0 THEN 'PASS' ELSE 'FAIL' END,
         'no materialized views'
  UNION ALL
  SELECT '11_all_tables_zero_rows', '0',
         (SELECT coalesce(max((xpath('/row/c/text()', query_to_xml(
             format('SELECT count(*) AS c FROM %I.%I', schemaname, tablename), false, true, '')))[1]::text::int), 0)::text
          FROM pg_tables WHERE schemaname='public'),
         CASE WHEN (SELECT coalesce(max((xpath('/row/c/text()', query_to_xml(
             format('SELECT count(*) AS c FROM %I.%I', schemaname, tablename), false, true, '')))[1]::text::int), 0)
          FROM pg_tables WHERE schemaname='public')=0 THEN 'PASS' ELSE 'FAIL' END,
         'max row count across all public tables (must be 0)'
  UNION ALL
  SELECT '12_auth_users_exists', 'present',
         (CASE WHEN to_regclass('auth.users') IS NULL THEN 'missing' ELSE 'present' END),
         CASE WHEN to_regclass('auth.users') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'managed Auth schema present (not recreated by baseline)'
  UNION ALL
  SELECT '13_gen_random_uuid_exists', 'present',
         (CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='gen_random_uuid') THEN 'present' ELSE 'missing' END),
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='gen_random_uuid') THEN 'PASS' ELSE 'FAIL' END,
         'uuid default generator available'

  -- ---- privileges (exact signatures; no function is invoked) --------------
  UNION ALL
  SELECT '14_six_assignment_rpcs_exist', '6',
         (SELECT count(*)::text FROM (VALUES
             ('public.admin_smart_assign_lead_to_vendors(uuid,uuid[],boolean,integer)'),
             ('public.assign_client_selected_vendor_to_group(uuid,uuid,uuid,integer)'),
             ('public.assign_vendor_to_requirement_group(uuid,uuid,uuid,text,integer,text)'),
             ('public.assign_lead_to_preferred_vendor(uuid,uuid)'),
             ('public.assign_lead_to_paid_vendors_phase26a(uuid,uuid[])'),
             ('public.assign_lead_to_vendors(uuid,uuid[],boolean,text)')) f(sig)
          WHERE to_regprocedure(f.sig) IS NOT NULL),
         CASE WHEN (SELECT count(*) FROM (VALUES
             ('public.admin_smart_assign_lead_to_vendors(uuid,uuid[],boolean,integer)'),
             ('public.assign_client_selected_vendor_to_group(uuid,uuid,uuid,integer)'),
             ('public.assign_vendor_to_requirement_group(uuid,uuid,uuid,text,integer,text)'),
             ('public.assign_lead_to_preferred_vendor(uuid,uuid)'),
             ('public.assign_lead_to_paid_vendors_phase26a(uuid,uuid[])'),
             ('public.assign_lead_to_vendors(uuid,uuid[],boolean,text)')) f(sig)
          WHERE to_regprocedure(f.sig) IS NOT NULL)=6 THEN 'PASS' ELSE 'FAIL' END,
         'six compatibility assignment RPCs resolve by exact signature'
  UNION ALL
  SELECT '15_blockers_not_public_anon_auth', '0 grants',
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
  SELECT '16_legacy_credit_not_public_anon_auth', '0 grants',
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
  SELECT '17_credit_delta_service_role_only',
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
  SELECT '18_anon_no_monetization_columns', 'false (all)',
         (SELECT string_agg(col || '=' || has_column_privilege('anon','public.vendors',col,'SELECT')::text, ' ')
            FROM unnest(ARRAY['total_credits','remaining_credits','paid_status','package_name','package_status','package_expires_at']) col),
         CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['total_credits','remaining_credits','paid_status','package_name','package_status','package_expires_at']) col
                WHERE has_column_privilege('anon','public.vendors',col,'SELECT')) THEN 'PASS' ELSE 'FAIL' END,
         'anon has no SELECT on any vendors monetization column'
  UNION ALL
  SELECT '19_anon_no_vendor_credit_logs', 'false',
         has_table_privilege('anon','public.vendor_credit_logs','SELECT')::text,
         CASE WHEN NOT has_table_privilege('anon','public.vendor_credit_logs','SELECT') THEN 'PASS' ELSE 'FAIL' END,
         'anon cannot read the credit ledger'
  UNION ALL
  SELECT '20_anon_no_vendor_packages', 'false',
         has_table_privilege('anon','public.vendor_packages','SELECT')::text,
         CASE WHEN NOT has_table_privilege('anon','public.vendor_packages','SELECT') THEN 'PASS' ELSE 'FAIL' END,
         'anon cannot read vendor_packages'
  UNION ALL
  SELECT '21_anon_no_payments', 'false',
         has_table_privilege('anon','public.payments','SELECT')::text,
         CASE WHEN NOT has_table_privilege('anon','public.payments','SELECT') THEN 'PASS' ELSE 'FAIL' END,
         'anon cannot read payments'

  -- ---- provider / communication inactivity --------------------------------
  UNION ALL
  SELECT '22_provider_accounts_empty', '0',
         (SELECT coalesce((SELECT count(*) FROM communication_provider_accounts),0)::text),
         CASE WHEN coalesce((SELECT count(*) FROM communication_provider_accounts),0)=0 THEN 'PASS' ELSE 'FAIL' END,
         'no provider accounts'
  UNION ALL
  SELECT '23_provider_template_mappings_empty', '0',
         (SELECT coalesce((SELECT count(*) FROM communication_provider_template_mappings),0)::text),
         CASE WHEN coalesce((SELECT count(*) FROM communication_provider_template_mappings),0)=0 THEN 'PASS' ELSE 'FAIL' END,
         'no provider template mappings'
  UNION ALL
  SELECT '24_communication_messages_empty', '0',
         (SELECT coalesce((SELECT count(*) FROM communication_messages),0)::text),
         CASE WHEN coalesce((SELECT count(*) FROM communication_messages),0)=0 THEN 'PASS' ELSE 'FAIL' END,
         'no communication messages / sends'
  UNION ALL
  SELECT '25_provider_runtime_disabled', 'disabled or empty',
         (SELECT coalesce((SELECT count(*) FROM communication_provider_runtime_policies
             WHERE activation_status <> 'disabled' OR outbound_enabled),0)::text),
         CASE WHEN coalesce((SELECT count(*) FROM communication_provider_runtime_policies
             WHERE activation_status <> 'disabled' OR outbound_enabled),0)=0 THEN 'PASS' ELSE 'FAIL' END,
         'no active/canary provider policy; Meta stays disabled'
  UNION ALL
  SELECT '26_no_false_migration_history', '1 baseline row',
         (SELECT CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'no-history-table'
                 ELSE (SELECT count(*)::text FROM supabase_migrations.schema_migrations) END),
         CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
                   AND (SELECT count(*) FROM supabase_migrations.schema_migrations) = 1
                   AND (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20260722000100') = 1
              THEN 'PASS' ELSE 'FAIL' END,
         'exactly one truthful baseline row (20260722000100); the 68 repository migrations are NOT recorded as applied'
)
SELECT check_name, expected, actual, status, details FROM checks ORDER BY check_name;
