-- ============================================================================
-- QuickFurno — QF-MVP-30.3 — POST-APPLICATION VERIFICATION (SELECT-ONLY)
--
-- Verifies the deterministic vendor segment foundation after applying:
--   20260723001200_qf_mvp_vendor_segment_foundation.sql
-- on top of the applied Marketplace Engine + the QF-MVP-30.1B CRM foundation.
--
-- SUPERSESSION NOTE (owner decision 3)
--   verify_qf_mvp_30_1b.sql is a LOCKED, POINT-IN-TIME, PRE-SEGMENTS verifier.
--   Its W18 assertion ("no segment/campaign tables") is intentionally historical
--   and correct for the state it certified. It is NOT edited and MUST NOT be used
--   as the post-30.3 foundation verifier. THIS file supersedes it for the
--   post-30.3 schema state: it re-asserts the applicable 30.1B invariants and
--   explicitly ACCEPTS the new locked segment-definition foundation, while still
--   proving that NO membership/campaign/audience/provider object exists.
--
-- SELECT-ONLY BY CONSTRUCTION: one read-only SELECT ... UNION ALL statement.
-- No INSERT/UPDATE/DELETE/MERGE/TRUNCATE/CREATE/ALTER/DROP/GRANT/REVOKE/CALL/DO;
-- invokes no mutating function. Every check is a catalog/privilege/zero-row fact.
--
-- INTENDED USE: exactly ONE run, immediately after QF-MVP-30.3B application and
-- BEFORE any fixture is created (several checks assert zero rows).
--
-- OUTPUT: seq | check_name | expected | actual | status | details
-- ============================================================================

select 1 as seq, 'S01_migration_history_once' as check_name, '1' as expected,
       (select count(*)::text from supabase_migrations.schema_migrations where version='20260723001200') as actual,
       case when (select count(*) from supabase_migrations.schema_migrations where version='20260723001200')=1
            then 'PASS' else 'FAIL' end as status,
       'the segment foundation migration is applied exactly once' as details

union all
select 2, 'S02_foundation_migration_still_applied', '1',
       (select count(*)::text from supabase_migrations.schema_migrations where version='20260723001100'),
       case when (select count(*) from supabase_migrations.schema_migrations where version='20260723001100')=1
            then 'PASS' else 'FAIL' end,
       'the QF-MVP-30.1B CRM foundation remains applied exactly once'

union all
select 3, 'S03_vendor_segments_present', '1',
       (select count(*)::text from unnest(array['public.vendor_segments']) s(t) where to_regclass(s.t) is not null),
       case when to_regclass('public.vendor_segments') is not null then 'PASS' else 'FAIL' end,
       'the locked segment-definition table exists (ACCEPTED — supersedes 30.1B W18)'

union all
select 4, 'S04_six_crm_tables_intact', '6',
       (select count(*)::text from unnest(array['public.vendor_crm_profiles','public.vendor_contacts',
          'public.vendor_tags','public.vendor_tag_assignments','public.vendor_tasks',
          'public.vendor_internal_notes']) s(t) where to_regclass(s.t) is not null),
       case when (select count(*) from unnest(array['public.vendor_crm_profiles','public.vendor_contacts',
          'public.vendor_tags','public.vendor_tag_assignments','public.vendor_tasks',
          'public.vendor_internal_notes']) s(t) where to_regclass(s.t) is not null)=6
            then 'PASS' else 'FAIL' end,
       'the six QF-MVP-30.1B CRM foundation tables are untouched'

union all
select 5, 'S05_no_membership_or_campaign_tables', '0',
       (select count(*)::text from unnest(array['public.vendor_segment_memberships','public.vendor_segment_members',
          'public.vendor_segment_versions','public.vendor_campaigns','public.vendor_campaign_audiences',
          'public.vendor_campaign_events','public.vendor_engagement_events']) s(t)
         where to_regclass(s.t) is not null),
       case when (select count(*) from unnest(array['public.vendor_segment_memberships','public.vendor_segment_members',
          'public.vendor_segment_versions','public.vendor_campaigns','public.vendor_campaign_audiences',
          'public.vendor_campaign_events','public.vendor_engagement_events']) s(t)
         where to_regclass(s.t) is not null)=0
            then 'PASS' else 'FAIL' end,
       'QF-MVP-30.3 persists definitions only — no membership, audience, campaign or provider table'

union all
select 6, 'S06_rls_enabled_on_vendor_segments', '1',
       (select count(*)::text from pg_class c
         where c.oid = to_regclass('public.vendor_segments') and c.relrowsecurity),
       case when exists (select 1 from pg_class c
         where c.oid = to_regclass('public.vendor_segments') and c.relrowsecurity)
            then 'PASS' else 'FAIL' end,
       'row level security is enabled (default-deny for untrusted roles)'

union all
select 7, 'S07_no_untrusted_policy', '0',
       (select count(*)::text from pg_policies p
         where p.schemaname='public' and p.tablename='vendor_segments'
           and (p.roles::text[] && array['public','anon','authenticated'])),
       case when (select count(*) from pg_policies p
         where p.schemaname='public' and p.tablename='vendor_segments'
           and (p.roles::text[] && array['public','anon','authenticated']))=0
            then 'PASS' else 'FAIL' end,
       'no policy grants an untrusted role access to segment definitions'

union all
select 8, 'S08_untrusted_roles_zero_privilege', '0',
       (select count(*)::text from unnest(array['public','anon','authenticated']) r(role_name)
          cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
         where has_table_privilege(r.role_name, 'public.vendor_segments', p.priv)),
       case when (select count(*) from unnest(array['public','anon','authenticated']) r(role_name)
          cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
         where has_table_privilege(r.role_name, 'public.vendor_segments', p.priv))=0
            then 'PASS' else 'FAIL' end,
       'public/anon/authenticated hold ZERO direct privilege on vendor_segments'

union all
select 9, 'S09_service_role_select_insert_update_only', '1',
       (case when has_table_privilege('service_role','public.vendor_segments','SELECT')
              and has_table_privilege('service_role','public.vendor_segments','INSERT')
              and has_table_privilege('service_role','public.vendor_segments','UPDATE')
              and not has_table_privilege('service_role','public.vendor_segments','DELETE')
              and not has_table_privilege('service_role','public.vendor_segments','TRUNCATE')
             then 1 else 0 end)::text,
       case when has_table_privilege('service_role','public.vendor_segments','SELECT')
             and has_table_privilege('service_role','public.vendor_segments','INSERT')
             and has_table_privilege('service_role','public.vendor_segments','UPDATE')
             and not has_table_privilege('service_role','public.vendor_segments','DELETE')
             and not has_table_privilege('service_role','public.vendor_segments','TRUNCATE')
            then 'PASS' else 'FAIL' end,
       'service_role has SELECT+INSERT+UPDATE and NO DELETE/TRUNCATE (archive-only, hard delete impossible)'

union all
select 10, 'S10_required_columns_present', '11',
       (select count(*)::text from pg_attribute a
         where a.attrelid = to_regclass('public.vendor_segments') and a.attnum > 0 and not a.attisdropped
           and a.attname = any (array['id','name','status','schema_version','definition','definition_version',
             'definition_fingerprint','created_at','updated_at','created_by','archived_at'])),
       case when (select count(*) from pg_attribute a
         where a.attrelid = to_regclass('public.vendor_segments') and a.attnum > 0 and not a.attisdropped
           and a.attname = any (array['id','name','status','schema_version','definition','definition_version',
             'definition_fingerprint','created_at','updated_at','created_by','archived_at']))=11
            then 'PASS' else 'FAIL' end,
       'the canonical rule/version/fingerprint/provenance columns exist'

union all
select 11, 'S11_no_core_truth_or_membership_column', '0',
       (select count(*)::text from pg_attribute a
         where a.attrelid = to_regclass('public.vendor_segments') and a.attnum > 0 and not a.attisdropped
           and a.attname = any (array['vendor_id','verification_status','is_active','city','service_categories',
             'areas_covered','package_id','remaining_credits','total_credits','consent','consent_status',
             'is_suppressed','suppression','communication_authorization','member_count','members',
             'recipient_count','recipients','approved_audience'])),
       case when (select count(*) from pg_attribute a
         where a.attrelid = to_regclass('public.vendor_segments') and a.attnum > 0 and not a.attisdropped
           and a.attname = any (array['vendor_id','verification_status','is_active','city','service_categories',
             'areas_covered','package_id','remaining_credits','total_credits','consent','consent_status',
             'is_suppressed','suppression','communication_authorization','member_count','members',
             'recipient_count','recipients','approved_audience']))=0
            then 'PASS' else 'FAIL' end,
       'no authoritative Core copy and no membership column on the definition table'

union all
select 12, 'S12_required_check_constraints', '7',
       (select count(*)::text from pg_constraint c
         where c.conrelid = to_regclass('public.vendor_segments') and c.contype='c'
           and c.conname = any (array['vsg_name_nonempty','vsg_name_len','vsg_status_check',
             'vsg_archived_consistency','vsg_schema_version_check','vsg_definition_version_check',
             'vsg_fingerprint_shape'])),
       case when (select count(*) from pg_constraint c
         where c.conrelid = to_regclass('public.vendor_segments') and c.contype='c'
           and c.conname = any (array['vsg_name_nonempty','vsg_name_len','vsg_status_check',
             'vsg_archived_consistency','vsg_schema_version_check','vsg_definition_version_check',
             'vsg_fingerprint_shape']))=7
            then 'PASS' else 'FAIL' end,
       'lifecycle, name, schema-version, definition-version and fingerprint-shape checks are present'

union all
select 13, 'S13_primary_key_present', '1',
       (select count(*)::text from pg_constraint c
         where c.conrelid = to_regclass('public.vendor_segments') and c.contype='p' and c.conname='vsg_pkey'),
       case when exists (select 1 from pg_constraint c
         where c.conrelid = to_regclass('public.vendor_segments') and c.contype='p' and c.conname='vsg_pkey')
            then 'PASS' else 'FAIL' end,
       'vsg_pkey primary key on id'

union all
select 14, 'S14_actor_fks_set_null_not_cascade', '3',
       (select count(*)::text from pg_constraint c
         where c.conrelid = to_regclass('public.vendor_segments') and c.contype='f'
           and c.confrelid = to_regclass('public.profiles') and c.confdeltype='n'),
       case when (select count(*) from pg_constraint c
         where c.conrelid = to_regclass('public.vendor_segments') and c.contype='f'
           and c.confrelid = to_regclass('public.profiles') and c.confdeltype='n')=3
            then 'PASS' else 'FAIL' end,
       'created_by/updated_by/archived_by reference profiles ON DELETE SET NULL (never CASCADE)'

union all
select 15, 'S15_live_name_partial_unique_index', '1',
       (select count(*)::text from pg_indexes i
         where i.schemaname='public' and i.tablename='vendor_segments'
           and i.indexname='uq_vendor_segments_live_name'
           and i.indexdef ilike '%unique%' and i.indexdef ilike '%lower(btrim(name))%'
           and i.indexdef ilike '%where%archived%'),
       case when (select count(*) from pg_indexes i
         where i.schemaname='public' and i.tablename='vendor_segments'
           and i.indexname='uq_vendor_segments_live_name'
           and i.indexdef ilike '%unique%' and i.indexdef ilike '%lower(btrim(name))%'
           and i.indexdef ilike '%where%archived%')=1
            then 'PASS' else 'FAIL' end,
       'one live segment per case-insensitive name; archived names are reusable'

union all
select 16, 'S16_deterministic_indexes_present', '2',
       (select count(*)::text from pg_indexes i
         where i.schemaname='public' and i.tablename='vendor_segments'
           and i.indexname = any (array['ix_vendor_segments_status_updated','ix_vendor_segments_fingerprint'])),
       case when (select count(*) from pg_indexes i
         where i.schemaname='public' and i.tablename='vendor_segments'
           and i.indexname = any (array['ix_vendor_segments_status_updated','ix_vendor_segments_fingerprint']))=2
            then 'PASS' else 'FAIL' end,
       'bounded deterministic listing + duplicate-definition detection indexes'

union all
select 17, 'S17_updated_at_trigger_present', '1',
       (select count(*)::text from pg_trigger t
         where t.tgrelid = to_regclass('public.vendor_segments') and not t.tgisinternal
           and t.tgname='trg_vsg_touch'),
       case when exists (select 1 from pg_trigger t
         where t.tgrelid = to_regclass('public.vendor_segments') and not t.tgisinternal
           and t.tgname='trg_vsg_touch')
            then 'PASS' else 'FAIL' end,
       'updated_at is server-maintained (reuses the 30.1B shared helper)'

union all
select 18, 'S18_zero_segment_rows_before_fixtures', '0',
       (select count(*)::text from public.vendor_segments),
       case when (select count(*) from public.vendor_segments)=0 then 'PASS' else 'FAIL' end,
       'the migration is schema-only — it creates no segment row'

union all
select 19, 'S19_no_core_row_mutation', '1',
       (case when (select count(*) from public.vendor_credit_logs)=0
              and (select count(*) from public.lead_assignments)=0
             then 1 else 0 end)::text,
       case when (select count(*) from public.vendor_credit_logs)=0
             and (select count(*) from public.lead_assignments)=0
            then 'PASS' else 'FAIL' end,
       'the migration wrote no Core financial/assignment row (staging pre-fixture state)'

union all
select 20, 'S20_vendor_public_v_exposes_no_segment', '0',
       (select count(*)::text from pg_attribute a
         where a.attrelid = to_regclass('public.vendor_public_v') and a.attnum > 0 and not a.attisdropped
           and (a.attname like '%segment%' or a.attname like '%definition%'
             or a.attname like '%onboarding%' or a.attname like '%relationship%')),
       case when (select count(*) from pg_attribute a
         where a.attrelid = to_regclass('public.vendor_public_v') and a.attnum > 0 and not a.attisdropped
           and (a.attname like '%segment%' or a.attname like '%definition%'
             or a.attname like '%onboarding%' or a.attname like '%relationship%'))=0
            then 'PASS' else 'FAIL' end,
       'the public projection exposes no segment or private CRM field'

union all
select 21, 'S21_no_006_assumption', '1',
       (case when to_regclass('public.audit_logs') is null
              or to_regclass('public.audit_logs') is not null then 1 else 0 end)::text,
       'PASS',
       'audit_logs/admin_notifications are NOT assumed by 30.3 — provenance lives on vendor_segments itself (informational)'

union all
select 22, 'S22_core_authority_intact', '1',
       (case when to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is not null
              and to_regclass('public.credit_ledger_reconciliation_exceptions') is not null
             then 1 else 0 end)::text,
       case when to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is not null
             and to_regclass('public.credit_ledger_reconciliation_exceptions') is not null
            then 'PASS' else 'FAIL' end,
       'canonical assignment authority and the 20.4C register are untouched'

order by seq;
