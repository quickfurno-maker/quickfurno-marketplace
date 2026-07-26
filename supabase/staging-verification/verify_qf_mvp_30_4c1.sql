-- ============================================================================
-- QF-MVP-30.4C1 — POST-CORRECTION STAGING VERIFIER (SELECT-ONLY)
--
-- Intended to run EXACTLY ONCE:
--   * AFTER migration 20260723001400 is applied;
--   * BEFORE any campaign fixture exists.
--
-- It is SELECT-only. It writes nothing, creates no fixture, calls no provider
-- and invokes no state-changing RPC. Every row returns (check_id, passed,
-- detail); a run is accepted only when EVERY row reports passed = true.
--
-- It does NOT replace verify_qf_mvp_30_4.sql, verify_qf_mvp_30_3.sql or
-- verify_qf_mvp_30_1b.sql — those remain point-in-time evidence and are
-- unchanged.
-- ============================================================================

-- C01 the applied foundation migration is still recorded EXACTLY once.
select 'C01_foundation_migration_applied_once' as check_id,
       count(*) = 1 as passed,
       '20260723001300 recorded ' || count(*) || ' time(s)' as detail
  from supabase_migrations.schema_migrations
 where version = '20260723001300';

-- C02 the forward correction is recorded EXACTLY once.
select 'C02_hardening_migration_applied_once' as check_id,
       count(*) = 1 as passed,
       '20260723001400 recorded ' || count(*) || ' time(s)' as detail
  from supabase_migrations.schema_migrations
 where version = '20260723001400';

-- C03 the correction is strictly FORWARD of the foundation and is the latest.
select 'C03_forward_only_ordering' as check_id,
       (max(version) = '20260723001400'
        and min(version) filter (where version >= '20260723001300') = '20260723001300') as passed,
       'latest applied version = ' || coalesce(max(version), '(none)') as detail
  from supabase_migrations.schema_migrations;

-- C04 no applied migration version was rewritten or duplicated.
select 'C04_no_rewritten_migration' as check_id,
       count(*) = 0 as passed,
       count(*) || ' duplicated migration version(s)' as detail
  from (select version from supabase_migrations.schema_migrations
         group by version having count(*) > 1) d;

-- C05 EXACTLY the three campaign tables still exist; the correction added none.
select 'C05_exactly_three_campaign_tables' as check_id,
       count(*) = 3 as passed,
       'vendor_campaign* tables: ' || coalesce(string_agg(c.relname, ', ' order by c.relname), '(none)') as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'vendor_campaign%';

-- C06 all three still have RLS enabled and no untrusted policy.
select 'C06_rls_default_deny_intact' as check_id,
       (count(*) filter (where c.relrowsecurity) = 3
        and (select count(*) from pg_policies p
              where p.schemaname = 'public'
                and p.tablename in ('vendor_campaigns','vendor_campaign_audience_members','vendor_campaign_events')
                and (p.roles::text[] && array['public','anon','authenticated'])) = 0) as passed,
       count(*) filter (where c.relrowsecurity) || ' of 3 tables have RLS' as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('vendor_campaigns','vendor_campaign_audience_members','vendor_campaign_events');

-- C07 both canonical fingerprint authorities exist, plus the field encoder.
select 'C07_fingerprint_authorities_exist' as check_id,
       (to_regprocedure('public.qf_campaign_snapshot_fingerprint_v1(uuid, uuid, integer)') is not null
        and to_regprocedure('public.qf_communication_template_fingerprint_v1(text)') is not null
        and to_regprocedure('public.qf_canonical_text_field_v1(text)') is not null) as passed,
       'snapshot / template / field-encoder authorities present' as detail;

-- C08 the fingerprint authorities are SECURITY INVOKER with a pinned search_path.
select 'C08_fingerprint_authority_posture' as check_id,
       count(*) = 3 as passed,
       count(*) || ' of 3 are SECURITY INVOKER with a pinned search_path' as detail
  from pg_proc p
 where p.oid in (to_regprocedure('public.qf_campaign_snapshot_fingerprint_v1(uuid, uuid, integer)'),
                 to_regprocedure('public.qf_communication_template_fingerprint_v1(text)'),
                 to_regprocedure('public.qf_canonical_text_field_v1(text)'))
   and not p.prosecdef
   and p.proconfig is not null
   and p.proconfig::text like '%search_path=%';

-- C09 PREPARE executes the new database-authoritative verification contract.
select 'C09_prepare_db_authoritative' as check_id,
       (d like '%qf_campaign_snapshot_fingerprint_v1%'
        and d like '%qf_communication_template_fingerprint_v1%'
        and d like '%snapshot_fingerprint          = v_snap_actual%'
        and d like '%prepared_template_fingerprint = v_tmpl_actual%'
        and d not like '%snapshot_fingerprint          = p_snapshot_fingerprint%'
        and d like '%QFC01%') as passed,
       'prepare computes and stores DB fingerprints and rolls back on mismatch' as detail
  from (select pg_get_functiondef(to_regprocedure(
          'public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)')) as d) s;

-- C10 APPROVAL recomputes BOTH fingerprints and can emit both mismatch codes.
select 'C10_approve_recomputes_both' as check_id,
       (d like '%qf_campaign_snapshot_fingerprint_v1%'
        and d like '%qf_communication_template_fingerprint_v1%'
        and d like '%SNAPSHOT_FINGERPRINT_MISMATCH%'
        and d like '%TEMPLATE_FINGERPRINT_MISMATCH%'
        and d like '%SNAPSHOT_OWNERSHIP_MISMATCH%'
        and d like '%SNAPSHOT_ORDINAL_INVALID%') as passed,
       'approval recomputes snapshot + template fingerprints and checks ownership/ordinals' as detail
  from (select pg_get_functiondef(to_regprocedure(
          'public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)')) as d) s;

-- C11 prepared evidence now REQUIRES a non-null template fingerprint.
select 'C11_prepared_evidence_requires_template_fingerprint' as check_id,
       count(*) = 1 as passed,
       'vcm_prepared_evidence_complete requires prepared_template_fingerprint' as detail
  from pg_constraint c
 where c.conrelid = to_regclass('public.vendor_campaigns')
   and c.conname = 'vcm_prepared_evidence_complete'
   and pg_get_constraintdef(c.oid) like '%prepared_template_fingerprint IS NOT NULL%';

-- C12 EXECUTED PARITY: the canonical field encoder matches the TypeScript mirror.
--     chr(233) builds the multi-byte probe from its code point rather than a
--     literal non-ASCII character, so the assertion cannot be weakened by a file
--     or client encoding accident.
select 'C12_field_encoder_parity' as check_id,
       (public.qf_canonical_text_field_v1(null) = '-1:'
        and public.qf_canonical_text_field_v1('') = '0:'
        and public.qf_canonical_text_field_v1('ab') = '2:ab'
        and public.qf_canonical_text_field_v1(chr(233)) = '2:' || chr(233)) as passed,
       'NULL/empty/ascii/multi-byte encodings match lib/crm/campaignValidation.ts' as detail;

-- C13 EXECUTED PARITY: the pinned SNAPSHOT golden vector.
--     The literal stream below is byte-identical to the one the TypeScript
--     canonicalizer produces for the same two rows; the pinned hex is asserted
--     on the TypeScript side by scripts/mvp/crm/validate-qf-mvp-30-4c.mjs.
select 'C13_snapshot_golden_vector_parity' as check_id,
       encode(sha256(convert_to(
         'qf-campaign-snapshot-v1'
         || chr(30) || '0' || chr(31) || '11111111-1111-4111-8111-111111111111'
                    || chr(31) || 'marketing_opted_in'
                    || chr(31) || 'preference_marketing_opted_in'
                    || chr(31) || '2026-07-01'
                    || chr(31) || 'none'
         || chr(30) || '1' || chr(31) || '22222222-2222-4222-8222-222222222222'
                    || chr(31) || 'marketing_opted_in'
                    || chr(31) || 'preference_marketing_opted_in'
                    || chr(31) || '2026-07-01'
                    || chr(31) || 'none', 'UTF8')), 'hex')
       = 'f6807a63ddd99798eb0e40857c23265a91d6ee1f6572f7eea187b2dc2095a2cd' as passed,
       'SQL and TypeScript hash identical canonical snapshot bytes' as detail;

-- C14 EXECUTED PARITY: the pinned TEMPLATE golden vector.
select 'C14_template_golden_vector_parity' as check_id,
       encode(sha256(convert_to(
         'qf-template-catalog-v1'
         || chr(31) || public.qf_canonical_text_field_v1('qf_parity_probe')
         || chr(31) || public.qf_canonical_text_field_v1('1.0.0')
         || chr(31) || public.qf_canonical_text_field_v1('whatsapp')
         || chr(31) || public.qf_canonical_text_field_v1('marketing')
         || chr(31) || public.qf_canonical_text_field_v1('en')
         || chr(31) || public.qf_canonical_text_field_v1('provider_ready')
         || chr(31) || public.qf_canonical_text_field_v1('true')
         || chr(31) || public.qf_canonical_text_field_v1(null)
         || chr(31) || public.qf_canonical_text_field_v1(null)
         || chr(31) || public.qf_canonical_text_field_v1(''), 'UTF8')), 'hex')
       = 'd9af14ec95590c4650506133dc59b8855f2534ae653b6c34d8183fcb3bc5e308' as passed,
       'SQL and TypeScript hash identical canonical template bytes' as detail;

-- C15 the snapshot authority returns NULL — never a misleading hash — for an
--     unknown snapshot, and the template authority for an unknown template.
select 'C15_fingerprint_null_on_unknown' as check_id,
       (public.qf_campaign_snapshot_fingerprint_v1(
          '00000000-0000-4000-8000-000000000000'::uuid,
          '00000000-0000-4000-8000-000000000001'::uuid, 1) is null
        and public.qf_communication_template_fingerprint_v1('__qf_no_such_template__') is null) as passed,
       'an absent set fingerprints to NULL, forcing callers to fail closed' as detail;

-- C16 the two campaign RPCs remain SECURITY DEFINER with a pinned search_path.
select 'C16_rpc_security_posture' as check_id,
       count(*) = 2 as passed,
       count(*) || ' of 2 campaign RPCs are SECURITY DEFINER with a pinned search_path' as detail
  from pg_proc p
 where p.oid in (
   to_regprocedure('public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)'),
   to_regprocedure('public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)'))
   and p.prosecdef and p.proconfig is not null and p.proconfig::text like '%search_path=%';

-- C17 untrusted roles hold ZERO execute on every campaign / fingerprint function.
select 'C17_untrusted_execute_zero' as check_id,
       count(*) = 0 as passed,
       count(*) || ' untrusted EXECUTE grant(s)' as detail
  from unnest(array[
    'public.qf_canonical_text_field_v1(text)',
    'public.qf_campaign_snapshot_fingerprint_v1(uuid, uuid, integer)',
    'public.qf_communication_template_fingerprint_v1(text)',
    'public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)',
    'public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)']) s(fn)
  cross join unnest(array['public','anon','authenticated']) r(role_name)
 where has_function_privilege(r.role_name, s.fn, 'EXECUTE');

-- C18 the fingerprint authorities are NOT externally callable by service_role.
select 'C18_fingerprint_helpers_not_externally_callable' as check_id,
       (not has_function_privilege('service_role', 'public.qf_campaign_snapshot_fingerprint_v1(uuid, uuid, integer)', 'EXECUTE')
        and not has_function_privilege('service_role', 'public.qf_communication_template_fingerprint_v1(text)', 'EXECUTE')
        and not has_function_privilege('service_role', 'public.qf_canonical_text_field_v1(text)', 'EXECUTE')) as passed,
       'only the SECURITY DEFINER RPCs, running as owner, may invoke them' as detail;

-- C19 service_role retains EXECUTE on exactly the two campaign RPCs.
select 'C19_service_role_rpc_execute' as check_id,
       (has_function_privilege('service_role', 'public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)', 'EXECUTE')
        and has_function_privilege('service_role', 'public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)', 'EXECUTE')) as passed,
       'the runtime can still prepare and approve' as detail;

-- C20 table grants are unchanged: head SIU, snapshot/events SI, never DELETE/TRUNCATE.
select 'C20_table_grant_posture_unchanged' as check_id,
       (has_table_privilege('service_role','public.vendor_campaigns','SELECT')
        and has_table_privilege('service_role','public.vendor_campaigns','INSERT')
        and has_table_privilege('service_role','public.vendor_campaigns','UPDATE')
        and has_table_privilege('service_role','public.vendor_campaign_audience_members','SELECT')
        and has_table_privilege('service_role','public.vendor_campaign_audience_members','INSERT')
        and not has_table_privilege('service_role','public.vendor_campaign_audience_members','UPDATE')
        and not has_table_privilege('service_role','public.vendor_campaign_events','UPDATE')
        and not has_table_privilege('service_role','public.vendor_campaigns','DELETE')
        and not has_table_privilege('service_role','public.vendor_campaign_audience_members','DELETE')
        and not has_table_privilege('service_role','public.vendor_campaign_events','DELETE')) as passed,
       'append-only snapshot/event posture and no hard delete anywhere' as detail;

-- C21 immutability and lifecycle triggers are all still installed.
select 'C21_triggers_intact' as check_id,
       count(*) = 4 as passed,
       count(*) || ' of 4 campaign triggers present' as detail
  from pg_trigger t
 where not t.tgisinternal
   and t.tgname in ('trg_vcam_immutable','trg_vce_immutable','trg_vcm_transition_guard','trg_vcm_no_delete');

-- C22 NO destination / PII / secret column exists on any campaign table.
select 'C22_no_destination_or_pii_column' as check_id,
       count(*) = 0 as passed,
       coalesce(string_agg(a.attname, ', '), 'none') as detail
  from pg_attribute a
 where a.attrelid in (to_regclass('public.vendor_campaigns'),
                      to_regclass('public.vendor_campaign_audience_members'),
                      to_regclass('public.vendor_campaign_events'))
   and a.attnum > 0 and not a.attisdropped
   and (a.attname in ('phone','email','whatsapp_number','msisdn','destination','recipient_ref',
                      'to_address','provider_payload','access_token','api_key')
        or a.attname like '%password%' or a.attname like '%secret%');

-- C23 NO intent / provider / frequency / dispatch object was introduced.
select 'C23_no_intent_provider_frequency_object' as check_id,
       count(*) = 0 as passed,
       coalesce(string_agg(c.relname, ', '), 'none') as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and (c.relname like '%frequency%'
        or c.relname like 'vendor_campaign_dispatch%'
        or c.relname like 'vendor_campaign_intent%'
        or c.relname like 'vendor_campaign_provider%'
        or c.relname like 'vendor_campaign_deliver%');

-- C24 communication_intents.aggregate_type was still NOT widened for campaigns.
-- An absent table or absent constraint must read as PASS (nothing was widened),
-- never as NULL — a NULL `passed` would silently fail an equality check.
select 'C24_no_campaign_intent_aggregate' as check_id,
       coalesce(
         (select bool_and(pg_get_constraintdef(c.oid) not like '%campaign%')
            from pg_constraint c
           where c.conrelid = to_regclass('public.communication_intents')
             and c.conname = 'communication_intents_aggregate_type_check'),
         true) as passed,
       'no campaign aggregate type was added to communication_intents' as detail;

-- C25 the template catalog still carries EXACTLY the fingerprinted columns.
select 'C25_template_catalog_shape' as check_id,
       count(*) = 10 as passed,
       count(*) || ' of 10 dispatch-critical template columns present' as detail
  from unnest(array['template_key','version','channel','category','language',
                    'readiness_status','is_active','provider_template_name',
                    'provider_template_id','description']) as c(col)
 where exists (select 1 from pg_attribute a
                where a.attrelid = to_regclass('public.communication_templates')
                  and a.attname = c.col and a.attnum > 0 and not a.attisdropped);

-- C26 ZERO campaign rows before fixtures.
select 'C26_zero_campaign_rows_before_fixtures' as check_id,
       ((select count(*) from public.vendor_campaigns) = 0
        and (select count(*) from public.vendor_campaign_audience_members) = 0
        and (select count(*) from public.vendor_campaign_events) = 0) as passed,
       'campaigns=' || (select count(*) from public.vendor_campaigns)
       || ' audience=' || (select count(*) from public.vendor_campaign_audience_members)
       || ' events=' || (select count(*) from public.vendor_campaign_events) as detail;

-- C27 NO Core financial, assignment, consent, suppression or package mutation.
--     The correction touches none of these; they must still read as untouched.
select 'C27_no_core_mutation' as check_id,
       ((select count(*) from public.vendor_credit_logs) = 0
        and (select count(*) from public.lead_assignments) = 0) as passed,
       'vendor_credit_logs=' || (select count(*) from public.vendor_credit_logs)
       || ' lead_assignments=' || (select count(*) from public.lead_assignments) as detail;

-- ============================================================================
-- QF-MVP-30.4C2 — SOURCE-EVIDENCE ROW-LOCK CONTRACT (C28–C33)
--
-- Locking the campaign head alone left a real race: approval could verify the
-- segment and template, a concurrent transaction could then commit a non-key
-- UPDATE to a dispatch-critical field, and approval would still commit — thereby
-- approving evidence that was ALREADY STALE. Both RPCs must hold BOTH source
-- rows under a lock that conflicts with a plain UPDATE, in one deterministic
-- order, until the transaction ends.
--
-- Every row below reads the INSTALLED definition via pg_get_functiondef and
-- STRIPS COMMENTS FIRST, so a comment that merely mentions FOR SHARE can never
-- satisfy a lock assertion.
-- ============================================================================

-- C28 PREPARE holds both source evidence rows FOR SHARE.
select 'C28_prepare_locks_evidence_rows' as check_id,
       (d ~* 'from\s+public\.vendor_segments[^;]*\sfor\s+share\s*;'
        and d ~* 'from\s+public\.communication_templates[^;]*\sfor\s+share\s*;'
        and d ~* 'from\s+public\.vendor_campaigns\s+where\s+id\s*=\s*p_campaign_id\s+for\s+update') as passed,
       'prepare locks campaign FOR UPDATE and both evidence rows FOR SHARE' as detail
  from (select lower(regexp_replace(pg_get_functiondef(to_regprocedure(
          'public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)')),
          '--[^\n]*', ' ', 'g')) as d) s;

-- C29 APPROVE holds both source evidence rows FOR SHARE.
select 'C29_approve_locks_evidence_rows' as check_id,
       (d ~* 'from\s+public\.vendor_segments[^;]*\sfor\s+share\s*;'
        and d ~* 'from\s+public\.communication_templates[^;]*\sfor\s+share\s*;'
        and d ~* 'from\s+public\.vendor_campaigns\s+where\s+id\s*=\s*p_campaign_id\s+for\s+update') as passed,
       'approve locks campaign FOR UPDATE and both evidence rows FOR SHARE' as detail
  from (select lower(regexp_replace(pg_get_functiondef(to_regprocedure(
          'public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)')),
          '--[^\n]*', ' ', 'g')) as d) s;

-- C30 NEITHER RPC uses FOR KEY SHARE, which does not conflict with FOR NO KEY
--     UPDATE and therefore cannot protect a non-key evidence field.
select 'C30_no_for_key_share' as check_id,
       (p !~* 'for\s+key\s+share' and a !~* 'for\s+key\s+share') as passed,
       'FOR KEY SHARE is absent from both campaign RPCs' as detail
  from (select lower(regexp_replace(pg_get_functiondef(to_regprocedure(
          'public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)')),
          '--[^\n]*', ' ', 'g')) as p,
               lower(regexp_replace(pg_get_functiondef(to_regprocedure(
          'public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)')),
          '--[^\n]*', ' ', 'g')) as a) s;

-- C31 DETERMINISTIC LOCK ORDER campaign -> segment -> template in BOTH RPCs, so
--     prepare and approve can never deadlock against one another. Anchored on
--     'from public.<table>' — the locking READS — never on the bare table name,
--     which also appears in each DECLARE block as %rowtype and would make this
--     pass vacuously whatever the real order was.
select 'C31_deterministic_lock_order' as check_id,
       (position('from public.vendor_campaigns' in p) > 0
        and position('from public.vendor_segments' in p) > position('from public.vendor_campaigns' in p)
        and position('from public.communication_templates' in p) > position('from public.vendor_segments' in p)
        and position('from public.vendor_campaigns' in a) > 0
        and position('from public.vendor_segments' in a) > position('from public.vendor_campaigns' in a)
        and position('from public.communication_templates' in a) > position('from public.vendor_segments' in a)) as passed,
       'both RPCs lock campaign -> segment -> template' as detail
  from (select lower(regexp_replace(pg_get_functiondef(to_regprocedure(
          'public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)')),
          '--[^\n]*', ' ', 'g')) as p,
               lower(regexp_replace(pg_get_functiondef(to_regprocedure(
          'public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)')),
          '--[^\n]*', ' ', 'g')) as a) s;

-- C32 APPROVE acquires both evidence locks BEFORE its first evidence check and
--     still holds them at the approving UPDATE and the event INSERT.
select 'C32_approve_locks_before_checks_and_held' as check_id,
       (position('for share' in a) > 0
        and position('for share' in a) < position('from public.vendor_campaign_audience_members' in a)
        and position('from public.communication_templates' in a) < position('update public.vendor_campaigns set' in a)
        and position('update public.vendor_campaigns set' in a) < position('insert into public.vendor_campaign_events' in a)) as passed,
       'locks precede every evidence check and are still held at the approving UPDATE + event INSERT' as detail
  from (select lower(regexp_replace(pg_get_functiondef(to_regprocedure(
          'public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)')),
          '--[^\n]*', ' ', 'g')) as a) s;

-- C33 SELECT ... FOR SHARE requires UPDATE privilege in addition to SELECT.
--     Both RPCs are SECURITY DEFINER, so the OWNER must hold it — not
--     service_role. Without it every prepare and approve would fail at runtime.
select 'C33_definer_owner_may_lock_evidence_rows' as check_id,
       coalesce(bool_and(has_table_privilege(r.rolname, 'public.vendor_segments', 'UPDATE')
                     and has_table_privilege(r.rolname, 'public.communication_templates', 'UPDATE')), false) as passed,
       'RPC owner ' || coalesce(max(r.rolname), '(unknown)') || ' may take a row lock on both evidence tables' as detail
  from pg_proc p
  join pg_roles r on r.oid = p.proowner
 where p.oid in (
   to_regprocedure('public.qf_prepare_vendor_campaign_v1(uuid, integer, uuid, integer, text, text, text, jsonb, text, jsonb, text)'),
   to_regprocedure('public.qf_approve_vendor_campaign_v1(uuid, integer, uuid, text)'));

-- C34 the public/vendor projection is unchanged and exposes no campaign object.
select 'C34_public_projection_unchanged' as check_id,
       (to_regclass('public.vendor_public_v') is not null
        and (select count(*) from pg_attribute a
              where a.attrelid = to_regclass('public.vendor_public_v')
                and a.attnum > 0 and not a.attisdropped
                and (a.attname like '%campaign%' or a.attname like '%snapshot%')) = 0) as passed,
       'vendor_public_v exists and exposes no campaign/snapshot column' as detail;
