-- ============================================================================
-- QF-MVP-30.5A / 30.5A1 — STAGING VERIFICATION (SELECT-ONLY)
--
-- Run AFTER migration 20260728001500 is applied and BEFORE any fixture exists.
-- Every statement is a SELECT. There is no INSERT, UPDATE, DELETE, ALTER, CREATE,
-- DROP, GRANT, REVOKE, TRUNCATE, COPY or DO block anywhere in this file, and no
-- call to the handoff RPC — running it changes nothing and creates no intent.
--
-- Every row reports: check_id, passed, detail.
-- ============================================================================

-- C01 — migration 20260728001500 applied exactly once and is the latest.
select 'C01_migration_once_and_latest' as check_id,
       (count(*) filter (where version = '20260728001500') = 1
        and max(version) = '20260728001500') as passed,
       'count=' || count(*) filter (where version = '20260728001500')
         || ' latest=' || coalesce(max(version), '(none)') as detail
  from supabase_migrations.schema_migrations;

-- C02 — aggregate_type carries vendor_campaign AND all four legacy values.
select 'C02_aggregate_type_widened_compatibly' as check_id,
       (d like '%vendor_campaign%' and d like '%lead_assignment%'
        and d like '%replacement%' and d like '%credit_restoration%'
        and d like '%''lead''%') as passed,
       coalesce(d, '(constraint missing)') as detail
  from (select pg_get_constraintdef(c.oid) as d
          from pg_constraint c
         where c.conrelid = 'public.communication_intents'::regclass
           and c.conname = 'communication_intents_aggregate_type_check') t;

-- C03 — no existing intent row was orphaned by the widening.
select 'C03_no_orphaned_intent_rows' as check_id,
       (count(*) = 0) as passed,
       'rows outside the vocabulary=' || count(*) as detail
  from public.communication_intents
 where aggregate_type <> all (array['lead_assignment','replacement',
                                    'credit_restoration','lead','vendor_campaign']);

-- C04 — campaign event vocabulary widened, append-only rules intact.
select 'C04_event_vocabulary_and_append_only' as check_id,
       (d like '%execution_handoff%' and d like '%approved%' and d like '%prepared%'
        and exists (select 1 from pg_trigger g
                     where g.tgrelid = 'public.vendor_campaign_events'::regclass
                       and not g.tgisinternal)) as passed,
       coalesce(d, '(missing)') as detail
  from (select pg_get_constraintdef(c.oid) as d
          from pg_constraint c
         where c.conrelid = 'public.vendor_campaign_events'::regclass
           and c.conname = 'vce_event_type_check') t;

-- C05 — the policy table exists with the exact expected column set.
select 'C05_policy_table_shape' as check_id,
       (count(*) = 13) as passed,
       'columns=' || count(*) || ' [' || string_agg(column_name, ',' order by column_name) || ']' as detail
  from information_schema.columns
 where table_schema = 'public' and table_name = 'communication_frequency_policies';

-- C06 — the policy table's bounding constraints are all present.
select 'C06_policy_constraints' as check_id,
       (count(*) = 7) as passed,
       'check constraints=' || count(*) as detail
  from pg_constraint
 where conrelid = 'public.communication_frequency_policies'::regclass
   and contype = 'c';

-- C07 — at most one ACTIVE policy per (channel, scope) is representable.
select 'C07_single_active_policy_index' as check_id,
       (count(*) = 1) as passed,
       'partial unique index present=' || count(*) as detail
  from pg_indexes
 where schemaname = 'public'
   and indexname = 'uq_communication_frequency_policies_active';

-- C08 — NO default frequency policy was seeded by the migration.
select 'C08_no_default_policy_seeded' as check_id,
       (count(*) = 0) as passed,
       'policy rows=' || count(*) || ' (the value is an owner decision)' as detail
  from public.communication_frequency_policies;

-- C09 — the handoff RPC exists with the exact signature and is SECURITY DEFINER.
select 'C09_rpc_signature_and_secdef' as check_id,
       (count(*) = 1) as passed,
       'matching functions=' || count(*) as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'qf_handoff_vendor_campaign_intents_v1'
   and pg_get_function_identity_arguments(p.oid) = 'uuid, integer, uuid, integer, text'
   and p.prosecdef;

-- C10 — the RPC has a fixed, safe search_path.
select 'C10_rpc_fixed_search_path' as check_id,
       (count(*) = 1) as passed,
       coalesce((select array_to_string(p.proconfig, ',') from pg_proc p
                  join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public'
                   and p.proname = 'qf_handoff_vendor_campaign_intents_v1'), '(none)') as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'qf_handoff_vendor_campaign_intents_v1'
   and array_to_string(coalesce(p.proconfig, array[]::text[]), ',') like '%search_path=pg_catalog, public, pg_temp%';

-- C11 — execute is fail-closed: untrusted roles cannot call the RPC.
select 'C11_rpc_execute_fail_closed' as check_id,
       (not has_function_privilege('anon',
              'public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text)', 'execute')
        and not has_function_privilege('authenticated',
              'public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text)', 'execute')
        and has_function_privilege('service_role',
              'public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text)', 'execute')) as passed,
       'anon=' || has_function_privilege('anon',
              'public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text)', 'execute')::text
         || ' authenticated=' || has_function_privilege('authenticated',
              'public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text)', 'execute')::text
         || ' service_role=' || has_function_privilege('service_role',
              'public.qf_handoff_vendor_campaign_intents_v1(uuid,integer,uuid,integer,text)', 'execute')::text as detail;

-- C12 — the policy table is not writable by untrusted roles.
select 'C12_policy_table_privileges' as check_id,
       (not has_table_privilege('anon', 'public.communication_frequency_policies', 'insert')
        and not has_table_privilege('authenticated', 'public.communication_frequency_policies', 'insert')
        and not has_table_privilege('anon', 'public.communication_frequency_policies', 'select')
        and has_table_privilege('service_role', 'public.communication_frequency_policies', 'insert')) as passed,
       'anon_insert=' || has_table_privilege('anon', 'public.communication_frequency_policies', 'insert')::text
         || ' authenticated_insert=' || has_table_privilege('authenticated', 'public.communication_frequency_policies', 'insert')::text as detail;

-- C13 — RLS is enabled on the policy table (default deny).
select 'C13_policy_table_rls' as check_id,
       bool_and(c.relrowsecurity) as passed,
       'rls_enabled=' || bool_and(c.relrowsecurity)::text as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'communication_frequency_policies';

-- C14 — lock order is campaign -> segment -> template inside the RPC body.
select 'C14_lock_order_campaign_segment_template' as check_id,
       (position('from public.vendor_campaigns' in src) > 0
        and position('from public.vendor_segments' in src)
              > position('from public.vendor_campaigns' in src)
        and position('from public.communication_templates' in src)
              > position('from public.vendor_segments' in src)) as passed,
       'campaign@' || position('from public.vendor_campaigns' in src)
         || ' segment@' || position('from public.vendor_segments' in src)
         || ' template@' || position('from public.communication_templates' in src) as detail
  from (select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'qf_handoff_vendor_campaign_intents_v1') t;

-- C15 — the evidence rows are locked FOR SHARE, and the head FOR UPDATE.
select 'C15_evidence_row_locks' as check_id,
       (src like '%where id = p_campaign_id for update%'
        and src like '%where id = v_campaign.segment_id for share%'
        and src like '%where template_key = v_campaign.template_key for share%'
        and src not like '%for key share%') as passed,
       'for_update=' || (src like '%for update%')::text
         || ' segment_for_share=' || (src like '%v_campaign.segment_id for share%')::text
         || ' template_for_share=' || (src like '%v_campaign.template_key for share%')::text as detail
  from (select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'qf_handoff_vendor_campaign_intents_v1') t;

-- C16 — snapshot and template fingerprints are RECOMPUTED from canonical functions.
select 'C16_fingerprints_recomputed' as check_id,
       (src like '%qf_campaign_snapshot_fingerprint_v1(%'
        and src like '%qf_communication_template_fingerprint_v1(%'
        and src like '%SNAPSHOT_FINGERPRINT_MISMATCH%'
        and src like '%TEMPLATE_FINGERPRINT_MISMATCH%') as passed,
       'snapshot_fn=' || (src like '%qf_campaign_snapshot_fingerprint_v1(%')::text
         || ' template_fn=' || (src like '%qf_communication_template_fingerprint_v1(%')::text as detail
  from (select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'qf_handoff_vendor_campaign_intents_v1') t;

-- C17 — SEGMENT AUTHORITY RESOLUTION: the stored (definition, fingerprint,
--       version) triple is database-enforced by a trigger, which is what makes
--       the stored-evidence comparison trustworthy.
select 'C17_segment_pair_enforced' as check_id,
       (exists (select 1 from pg_trigger g
                 where g.tgrelid = 'public.vendor_segments'::regclass
                   and g.tgname = 'trg_vsg_definition_pair'
                   and not g.tgisinternal)
        and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public'
                       and p.proname = 'qf_enforce_segment_definition_pair')) as passed,
       'trigger=' || exists (select 1 from pg_trigger g
                              where g.tgrelid = 'public.vendor_segments'::regclass
                                and g.tgname = 'trg_vsg_definition_pair')::text as detail;

-- C18 — no SECOND segment fingerprint canonicaliser was introduced.
select 'C18_no_second_segment_canonicaliser' as check_id,
       (count(*) = 0) as passed,
       'segment-fingerprint functions=' || count(*) as detail
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname ~ 'segment.*fingerprint|fingerprint.*segment';

-- C19 — the no-policy and ambiguous-policy fail-closed codes exist.
select 'C19_policy_fail_closed_codes' as check_id,
       (src like '%FREQUENCY_POLICY_NOT_CONFIGURED%'
        and src like '%FREQUENCY_POLICY_AMBIGUOUS%') as passed,
       'not_configured=' || (src like '%FREQUENCY_POLICY_NOT_CONFIGURED%')::text
         || ' ambiguous=' || (src like '%FREQUENCY_POLICY_AMBIGUOUS%')::text as detail
  from (select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'qf_handoff_vendor_campaign_intents_v1') t;

-- C20 — cross-campaign recipient serialization is acquired BEFORE the count.
select 'C20_recipient_serialization_before_count' as check_id,
       (position('pg_advisory_xact_lock' in src) > 0
        and position('pg_advisory_xact_lock' in src)
              < position('into v_recent, v_last_at' in src)) as passed,
       'lock@' || position('pg_advisory_xact_lock' in src)
         || ' count@' || position('into v_recent, v_last_at' in src) as detail
  from (select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'qf_handoff_vendor_campaign_intents_v1') t;

-- C21 — the frequency count is status-inclusive (conservative).
select 'C21_frequency_counts_all_statuses' as check_id,
       (src not like '%i.status =%' and src not like '%i.status in%') as passed,
       'no status filter narrows the frequency count' as detail
  from (select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'qf_handoff_vendor_campaign_intents_v1') t;

-- C22 — recipient idempotency is database-enforced and NOT nullable.
select 'C22_idempotency_unique_not_null' as check_id,
       (exists (select 1 from pg_constraint c
                 where c.conrelid = 'public.communication_intents'::regclass
                   and c.conname = 'uq_communication_intents_idempotency'
                   and c.contype = 'u')
        and (select a.attnotnull from pg_attribute a
              where a.attrelid = 'public.communication_intents'::regclass
                and a.attname = 'idempotency_key')) as passed,
       'unique+not_null enforced' as detail;

-- C23 — consent and suppression are read at handoff time.
select 'C23_consent_suppression_rechecked' as check_id,
       (src like '%public.communication_preferences%'
        and src like '%public.communication_suppressions%'
        and src like '%''global''%') as passed,
       'preferences=' || (src like '%public.communication_preferences%')::text
         || ' suppressions=' || (src like '%public.communication_suppressions%')::text as detail
  from (select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'qf_handoff_vendor_campaign_intents_v1') t;

-- C24 — only provider-neutral 'pending' intents are creatable by this RPC.
select 'C24_provider_neutral_pending_only' as check_id,
       (src like '%''pending''%'
        and src not like '%provider_message_id%'
        and src not like '%dispatched_at%'
        and src not like '%delivered%') as passed,
       'pending_only=' || (src like '%''pending''%')::text as detail
  from (select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'qf_handoff_vendor_campaign_intents_v1') t;

-- C25 — no provider/network path exists in the RPC or as an extension.
select 'C25_no_provider_or_network_path' as check_id,
       ((select count(*) from pg_extension where extname in ('pg_net','http','dblink')) = 0
        and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'qf_handoff_vendor_campaign_intents_v1'
                and (p.prosrc like '%http%' or p.prosrc like '%net.%' or p.prosrc like '%dblink%')) = 0) as passed,
       'network extensions=' || (select count(*) from pg_extension
                                  where extname in ('pg_net','http','dblink')) as detail;

-- C26 — no prohibited project reference is embedded anywhere in the new objects.
select 'C26_no_prohibited_project_refs' as check_id,
       (count(*) = 0) as passed,
       'objects containing a prohibited ref=' || count(*) as detail
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('qf_handoff_vendor_campaign_intents_v1','qf_enforce_segment_definition_pair')
   and (p.prosrc like '%yqpgcsduqbxulrlzwzap%' or p.prosrc like '%coilipywdvxklewquqvv%');

-- C27 — applying the migration created ZERO communication intents.
select 'C27_zero_campaign_intents_after_migration' as check_id,
       (count(*) = 0) as passed,
       'vendor_campaign intents=' || count(*) as detail
  from public.communication_intents
 where aggregate_type = 'vendor_campaign';

-- C28 — applying the migration created ZERO handoff events.
select 'C28_zero_handoff_events_after_migration' as check_id,
       (count(*) = 0) as passed,
       'execution_handoff events=' || count(*) as detail
  from public.vendor_campaign_events
 where event_type = 'execution_handoff';
