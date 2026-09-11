-- ============================================================================
-- QF-MVP-40.14 — META TRANSACTIONAL MAPPING SEED + ONE-AT-A-TIME ACTIVATION
--
-- FORWARD-ONLY SUCCESSOR. It edits no historical migration. The tables it uses
-- were created by 20260708000170 (communication_templates), 20260709000100
-- (provider accounts, template mappings), 20260709000200 (runtime policies,
-- canary destinations) and 20260801110000 (automation jobs, execution attempts).
-- The QF-MVP-40.13B authority (20260813000000), the QF-MVP-40 quiesce authority
-- (20260910060000) and the QF-MVP-80.14A activation authority (20260903040000)
-- are PRECONDITIONS of this migration and are never redefined by it.
--
-- WHAT THIS CLOSES
--   Production carries exactly ONE active Meta mapping — lead_assignment_alert
--   -> quickfurno_vendor_lead_assignment_alert_v1 — reached through
--   qf_activate_meta_lead_assignment_v1, whose whole scope is that one lane, all
--   of it hard-coded. Four further Meta templates were independently proven
--   APPROVED / UTILITY / en on the production WABA by GET-only verification:
--
--     lead_received              -> qf_lead_received_v1              1442104054406353
--     client_lead_status_update  -> qf_client_lead_status_update_v1  1078563638151601
--     client_matching_update     -> qf_client_matching_update_v2     1597441458555561
--     vendor_onboarding_reminder -> qf_vendor_onboarding_reminder_v1 2564847817327366
--
--   There is no repository-side route that can turn any of them on. This is that
--   route, and only that route: a closed four-key vocabulary, ONE key per call.
--
-- WHAT IS DELIBERATELY NOT REACHABLE HERE
--   clarification_request       positional binding order never proven in code
--   clarification_reminder      Meta category is MARKETING, not UTILITY
--   client_transactional_followup   placeholder mismatch
--   vendor_new_lead             semantics are the obsolete accept/decline concept
--   vendor_response_reminder    Meta category is MARKETING
--   vendor_package_expiry_warning   Meta category is MARKETING
--   low_credit_warning          Meta category is MARKETING
--   every campaign / marketing template
--   every consent command response template (STOP / START / HELP), which are
--     authorised ONLY by the evidence-bound one-shot enforcer
--   qf_lead_assignment_alert_v1, the duplicate provider template — the live
--     quickfurno_vendor_lead_assignment_alert_v1 mapping is left untouched
--
--   None of those keys appears anywhere inside the activation authority, so the
--   containment is structural rather than a denylist that has to stay current.
--
-- WHY AN RPC AND NOT A SEED-THEN-UPDATE
--   20260813000000 revoked insert/update on the runtime-policy and canary tables
--   from service_role, but left communication_provider_template_mappings
--   directly writable, so "activation" before this migration meant an unguarded
--   one-column UPDATE that anything holding the service key could perform
--   against ANY mapping row. This function is the narrow alternative and adds
--   what a direct write structurally cannot:
--     * EVERY production-scope value is a CONSTANT. Provider, channel, language,
--       category, version, approval status, the active flag, the provider
--       template name, the provider template id and the binding schema are all
--       hard-coded. A caller supplies ONE key from a closed set of four, plus an
--       audit digest that grants nothing.
--     * COMPARE-AND-SET on the durable prior state of the account, the runtime
--       policy, the canary surface, the automation queue and the live
--       lead_assignment_alert mapping.
--     * POSTCONDITIONS that re-read what was written and roll the whole call back
--       unless the resulting sending surface is exactly the reviewed one.
--
--   None of that is worth anything while the bypass remains, so §5a REVOKES
--   INSERT and UPDATE on communication_provider_template_mappings from
--   service_role — after this migration's own seed has completed — leaving
--   SELECT intact. §2 is SECURITY DEFINER and runs as its owner, so it becomes
--   the EXCLUSIVE activation route rather than merely the polite one. 6.12
--   proves SELECT true / INSERT false / UPDATE false / DELETE false at apply
--   time, and 6.13 proves all three controlled authorities are still SECURITY
--   DEFINER and still executable by service_role.
--
-- APPLYING THIS MIGRATION CREATES ZERO SEND AUTHORITY
--   The four mappings are seeded is_active = false. §4 captures the number of
--   ACTIVE Meta/WhatsApp mappings BEFORE the seed and asserts it is unchanged
--   afterwards, and asserts that none of the four seeded keys is active. It
--   writes no runtime policy, no canary destination, no provider account, no
--   communication row and no automation row.
--
--   ONE honest caveat, stated plainly. §3 ensures a public.communication_templates
--   catalogue row exists for each of the four keys, because
--   communication_provider_template_mappings.template_key is a FOREIGN KEY into
--   that table and three of the four keys have no row in any migration — the
--   staging rows were created by a one-shot operator, so without this the
--   migration could not apply to production at all. Those catalogue rows are
--   created with is_active = true and readiness_status = 'provider_mapping_required',
--   exactly matching the staging rows, and communicationService does gate on
--   template.is_active. That gate is NOT the send switch: an intent still cannot
--   leave without an ACTIVE provider mapping, an enabled account and an open
--   runtime policy, and all four mappings are seeded INACTIVE. §3 never modifies
--   an existing catalogue row and aborts if one is present with a conflicting
--   channel or category.
--
-- DRIFT IS REFUSED, NEVER OVERWRITTEN
--   §4 treats an exactly-equal existing mapping as idempotent proof and aborts on
--   ANY difference in provider template name, provider template id, category,
--   language, version, approval status or variables_schema — and also aborts if a
--   target row is already ACTIVE, which this phase has no authority to have caused.
--   This is deliberate and has a known consequence: in an environment that already
--   carries one of these four mappings pointed at DIFFERENT provider assets (the
--   QF-MVP-40.12 staging seed wrote the same four provider template NAMES with
--   provider_template_id = null), this migration will ABORT rather than silently
--   repoint a mapping at another WABA's template id. Reconciling such an
--   environment is an explicit, owner-authorised act, not a side effect of a push.
--
-- NON-ACTIONS
--   No HTTP call, provider call, Meta credential, message send, canary
--   destination, runtime-policy write, provider-account write, n8n activation,
--   cron, table, type, trigger, historical migration edit, assignment, credit,
--   lead, vendor or campaign write.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Fail-closed preflight
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_name text;
begin
  foreach v_name in array array[
    'public.communication_templates',
    'public.communication_provider_template_mappings',
    'public.communication_provider_accounts',
    'public.communication_provider_runtime_policies',
    'public.communication_provider_canary_destinations',
    'public.automation_jobs',
    'public.automation_execution_attempts'
  ] loop
    if to_regclass(v_name) is null then
      raise exception 'QF-MVP-40.14 aborted: % is missing.', v_name;
    end if;
  end loop;

  -- The at-most-one-active-mapping rule this authority's postcondition leans on
  -- must already exist as a database constraint, not only as a check in code.
  if to_regclass('public.uq_comm_provider_template_active') is null then
    raise exception
      'QF-MVP-40.14 aborted: uq_comm_provider_template_active is absent.';
  end if;

  -- The emergency shutdown is a PRECONDITION of granting any further send
  -- surface: every mapping this migration can ever activate must already be
  -- closable by one unconditional call.
  foreach v_name in array array[
    'public.qf_disable_meta_canary_v1()',
    'public.qf_activate_meta_lead_assignment_v1(text,text,text)'
  ] loop
    if to_regprocedure(v_name) is null then
      raise exception
        'QF-MVP-40.14 aborted: % is absent; this migration is their successor, not their replacement.', v_name;
    end if;
  end loop;

  if exists (select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')) then
    raise exception
      'QF-MVP-40.14 aborted: database network extension present; provider calls must remain application-layer only.';
  end if;

  -- This authority must not already exist under another definition.
  if to_regprocedure('public.qf_activate_meta_transactional_mapping_v1(text,text)') is not null then
    raise exception
      'QF-MVP-40.14 aborted: qf_activate_meta_transactional_mapping_v1 already exists; reconcile instead of masking drift.';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 2. THE ACTIVATION AUTHORITY
--
--    Activates EXACTLY ONE mapping per call, from a closed set of exactly four
--    template keys. It can reach no fifth key, no other provider, no other
--    channel, no other language and no other posture.
-- ---------------------------------------------------------------------------
create or replace function public.qf_activate_meta_transactional_mapping_v1(
  p_template_key text,
  p_activation_evidence_digest text
)
returns table (
  activated_template_key text,
  activated_provider_template_name text,
  activated_provider_template_id text,
  policy_activation_status text,
  policy_outbound_enabled boolean,
  policy_webhook_processing_enabled boolean,
  policy_health_check_enabled boolean,
  active_canary_count integer,
  active_mapping_count integer,
  lead_assignment_mapping_active boolean,
  account_ready boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  -- EVERY production-scope value is a CONSTANT. There is deliberately no
  -- parameter for provider, channel, language, category, version, approval
  -- status, active flag, provider template name, provider template id, binding
  -- schema, mapping id, account identity or any runtime-policy flag — so none of
  -- them can be chosen, widened or redirected by a caller.
  c_provider   constant text := 'meta_whatsapp_cloud';
  c_channel    constant text := 'whatsapp';
  c_language   constant text := 'en';
  c_category   constant text := 'utility';
  c_version    constant text := '1.0';
  c_approval   constant text := 'approved';

  -- THE CLOSED ACTIVATION VOCABULARY. Exactly four keys, as an array literal, so
  -- a fifth key cannot be smuggled in by editing a lookup row somewhere else.
  c_keys constant text[] := array[
    'lead_received',
    'client_lead_status_update',
    'client_matching_update',
    'vendor_onboarding_reminder'
  ];

  -- The already-live lane. It is read, compared and re-compared; it is never
  -- written by this function.
  c_anchor_key  constant text := 'lead_assignment_alert';
  c_anchor_name constant text := 'quickfurno_vendor_lead_assignment_alert_v1';

  -- The ONLY template keys that may be ACTIVE on this provider/channel after a
  -- successful call: the live anchor plus the closed four.
  c_allowed_active constant text[] := array[
    'lead_assignment_alert',
    'lead_received',
    'client_lead_status_update',
    'client_matching_update',
    'vendor_onboarding_reminder'
  ];

  -- An automation job or execution attempt that has not reached a terminal state
  -- could still produce a send while the surface is changing underneath it.
  c_open_job_status     constant text[] := array['pending', 'processing', 'retry_scheduled', 'uncertain'];
  c_open_attempt_status constant text[] := array['started'];

  -- The per-key provider identity and binding contract, derived from
  -- lib/communication/businessTemplateVariables.ts BUSINESS_TEMPLATE_CONTRACTS /
  -- bindingSchemaFor(). Positions are declared explicitly and are never inferred
  -- from array order.
  -- QF_TXN_CONTRACT_BEGIN
  c_contract constant jsonb := '[
    {
      "template_key": "lead_received",
      "provider_template_name": "qf_lead_received_v1",
      "provider_template_id": "1442104054406353",
      "variables_schema": {
        "bindingVersion": 1,
        "bindings": [
          {"component": "body", "position": 1, "sourceKey": "client_name", "parameterType": "text"}
        ]
      }
    },
    {
      "template_key": "client_lead_status_update",
      "provider_template_name": "qf_client_lead_status_update_v1",
      "provider_template_id": "1078563638151601",
      "variables_schema": {
        "bindingVersion": 1,
        "bindings": [
          {"component": "body", "position": 1, "sourceKey": "client_name", "parameterType": "text"},
          {"component": "body", "position": 2, "sourceKey": "lead_status_label", "parameterType": "text"}
        ]
      }
    },
    {
      "template_key": "client_matching_update",
      "provider_template_name": "qf_client_matching_update_v2",
      "provider_template_id": "1597441458555561",
      "variables_schema": {
        "bindingVersion": 1,
        "bindings": [
          {"component": "body", "position": 1, "sourceKey": "client_name", "parameterType": "text"},
          {"component": "body", "position": 2, "sourceKey": "matched_vendor_count", "parameterType": "text"}
        ]
      }
    },
    {
      "template_key": "vendor_onboarding_reminder",
      "provider_template_name": "qf_vendor_onboarding_reminder_v1",
      "provider_template_id": "2564847817327366",
      "variables_schema": {
        "bindingVersion": 1,
        "bindings": [
          {"component": "body", "position": 1, "sourceKey": "outstanding_item", "parameterType": "text"}
        ]
      }
    }
  ]'::jsonb;
  -- QF_TXN_CONTRACT_END

  v_spec    jsonb;
  v_account public.communication_provider_accounts%rowtype;
  v_policy  public.communication_provider_runtime_policies%rowtype;
  v_anchor  public.communication_provider_template_mappings%rowtype;
  v_after   public.communication_provider_template_mappings%rowtype;
  v_mapping public.communication_provider_template_mappings%rowtype;
  v_count   integer;
begin
  -- ==== 1. CLOSED-SET ADMISSION ============================================
  -- The FIRST thing that happens. A key outside the four never reaches a lock,
  -- a read of production state or a write.
  if p_template_key is null or not (p_template_key = any (c_keys)) then
    raise exception 'QF_TXN_TEMPLATE_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;

  -- ==== 2. AUDIT-ONLY EVIDENCE DIGEST ======================================
  -- Format-checked, returned to no one, and never treated as proof of anything.
  -- It grants no authority: every gate below is a durable database fact.
  if p_activation_evidence_digest is null
     or p_activation_evidence_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'QF_TXN_EVIDENCE_DIGEST_INVALID' using errcode = 'P0001';
  end if;

  -- ==== 3. CONTRACT INTEGRITY ==============================================
  -- The hard-coded contract must still describe exactly the four admitted keys.
  if jsonb_array_length(c_contract) <> array_length(c_keys, 1)
     or exists (
       select 1 from jsonb_array_elements(c_contract) e
        where not ((e ->> 'template_key') = any (c_keys))
     )
     or (select count(distinct e ->> 'template_key') from jsonb_array_elements(c_contract) e)
        <> array_length(c_keys, 1) then
    raise exception 'QF_TXN_CONTRACT_INTEGRITY' using errcode = 'P0001';
  end if;

  select e into v_spec
    from jsonb_array_elements(c_contract) e
   where e ->> 'template_key' = p_template_key;
  if v_spec is null then
    raise exception 'QF_TXN_CONTRACT_INTEGRITY' using errcode = 'P0001';
  end if;

  -- ==== 4. EXACTLY ONE PROVIDER ACCOUNT, FULLY READY =======================
  -- The account is resolved from provider/channel, never supplied: a caller
  -- cannot point this activation at a different WABA or phone number.
  select count(*)::integer into v_count
    from public.communication_provider_accounts
   where provider_key = c_provider and channel = c_channel;
  if v_count <> 1 then
    raise exception 'QF_TXN_ACCOUNT_NOT_EXACTLY_ONE' using errcode = 'P0001';
  end if;

  select * into v_account
    from public.communication_provider_accounts
   where provider_key = c_provider and channel = c_channel
   for update;

  if v_account.id is null then
    raise exception 'QF_TXN_ACCOUNT_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- This function never derives readiness; it only refuses without it.
  if v_account.readiness_status <> 'provider_ready'
     or v_account.configuration_status <> 'complete'
     or v_account.business_verification_status <> 'verified'
     or v_account.phone_number_status <> 'connected'
     or v_account.webhook_status <> 'verified'
     or v_account.health_status <> 'healthy' then
    raise exception 'QF_TXN_ACCOUNT_NOT_READY' using errcode = 'P0001';
  end if;

  -- ==== 5. THE RUNTIME POLICY IS ALREADY IN NORMAL PRODUCTION ==============
  -- This function widens an ALREADY-OPEN lane by exactly one template. It can
  -- never open the lane itself: `active` must already be true, and reaching
  -- `active` remains the sole business of qf_activate_meta_lead_assignment_v1.
  select * into v_policy
    from public.communication_provider_runtime_policies
   where provider_key = c_provider and channel = c_channel
   for update;

  if v_policy.id is null then
    raise exception 'QF_TXN_POLICY_MISSING' using errcode = 'P0001';
  end if;
  if v_policy.activation_status <> 'active' then
    raise exception 'QF_TXN_POLICY_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if v_policy.outbound_enabled is not true then
    raise exception 'QF_TXN_POLICY_OUTBOUND_OFF' using errcode = 'P0001';
  end if;
  if v_policy.webhook_processing_enabled is not true
     or v_policy.health_check_enabled is not true then
    raise exception 'QF_TXN_POLICY_OBSERVABILITY_OFF' using errcode = 'P0001';
  end if;

  -- ==== 6. ZERO ACTIVE CANARY DESTINATIONS =================================
  -- Normal production and an open canary allowlist are different postures. A
  -- template must never be widened into a half-open one.
  select count(*)::integer into v_count
    from public.communication_provider_canary_destinations
   where provider_key = c_provider and channel = c_channel and is_active;
  if v_count <> 0 then
    raise exception 'QF_TXN_ACTIVE_CANARY_PRESENT' using errcode = 'P0001';
  end if;

  -- ==== 7. THE LIVE lead_assignment_alert MAPPING IS STILL EXACT ===========
  -- Snapshotted here and re-compared after the write, so this function can be
  -- shown never to have disturbed the one lane that is already carrying real
  -- production traffic.
  select count(*)::integer into v_count
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel
     and language = c_language and template_key = c_anchor_key and is_active;
  if v_count <> 1 then
    raise exception 'QF_TXN_ANCHOR_MAPPING_NOT_EXACTLY_ONE' using errcode = 'P0001';
  end if;

  select * into v_anchor
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel
     and language = c_language and template_key = c_anchor_key and is_active
   for update;

  if v_anchor.provider_template_name is distinct from c_anchor_name then
    raise exception 'QF_TXN_ANCHOR_MAPPING_IDENTITY_CONFLICT' using errcode = 'P0001';
  end if;

  -- ==== 8. THE AUTOMATION QUEUE IS QUIET ===================================
  -- A job or attempt that has not reached a terminal state could still fire
  -- while the sending surface is changing. Widening the surface underneath
  -- in-flight work is exactly the race this refuses.
  select count(*)::integer into v_count
    from public.automation_jobs where status = any (c_open_job_status);
  if v_count <> 0 then
    raise exception 'QF_TXN_NONTERMINAL_JOBS_PRESENT' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_count
    from public.automation_execution_attempts where status = any (c_open_attempt_status);
  if v_count <> 0 then
    raise exception 'QF_TXN_NONTERMINAL_ATTEMPTS_PRESENT' using errcode = 'P0001';
  end if;

  -- ==== 9. THE TARGET MAPPING IS EXACT, APPROVED AND INACTIVE ==============
  select count(*)::integer into v_count
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel
     and language = c_language and template_key = p_template_key;
  if v_count <> 1 then
    raise exception 'QF_TXN_MAPPING_NOT_EXACTLY_ONE' using errcode = 'P0001';
  end if;

  select * into v_mapping
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel
     and language = c_language and template_key = p_template_key
   for update;

  if v_mapping.approval_status is distinct from c_approval then
    raise exception 'QF_TXN_MAPPING_NOT_APPROVED' using errcode = 'P0001';
  end if;
  if v_mapping.is_active is true then
    raise exception 'QF_TXN_MAPPING_ALREADY_ACTIVE' using errcode = 'P0001';
  end if;
  if v_mapping.provider_template_name is distinct from (v_spec ->> 'provider_template_name') then
    raise exception 'QF_TXN_MAPPING_NAME_CONFLICT' using errcode = 'P0001';
  end if;
  if v_mapping.provider_template_id is distinct from (v_spec ->> 'provider_template_id') then
    raise exception 'QF_TXN_MAPPING_PROVIDER_ID_CONFLICT' using errcode = 'P0001';
  end if;
  if v_mapping.provider_category is distinct from c_category then
    raise exception 'QF_TXN_MAPPING_CATEGORY_CONFLICT' using errcode = 'P0001';
  end if;
  if v_mapping.language is distinct from c_language then
    raise exception 'QF_TXN_MAPPING_LANGUAGE_CONFLICT' using errcode = 'P0001';
  end if;
  if v_mapping.version is distinct from c_version then
    raise exception 'QF_TXN_MAPPING_VERSION_CONFLICT' using errcode = 'P0001';
  end if;
  if v_mapping.variables_schema is distinct from (v_spec -> 'variables_schema') then
    raise exception 'QF_TXN_MAPPING_SCHEMA_CONFLICT' using errcode = 'P0001';
  end if;

  -- ==== THE ONLY WRITE =====================================================
  -- One row, addressed by the id resolved above, one column plus updated_at.
  --
  -- Deliberately absent: any runtime-policy write, any canary-destination write,
  -- any provider-account write, any other mapping write, any communication
  -- intent/message/event write, any automation job/action-request/attempt write,
  -- any assignment, credit, lead or vendor write, and any write to the
  -- promotional surfaces §6.7 enumerates in full.
  --
  -- The forbidden token vocabulary is deliberately NOT restated inside this body.
  -- PostgreSQL stores a PL/pgSQL body VERBATIM, comments included, and
  -- pg_get_functiondef() hands that same text back — so §6.4 scans THIS comment
  -- exactly as it scans executable code. Naming an excluded key here, even only
  -- to disclaim it, makes the migration abort on its own prose. Every exclusion
  -- is therefore asserted from OUTSIDE the body, in §6.4 and §6.7, where naming
  -- the thing being refused is safe.
  update public.communication_provider_template_mappings
     set is_active = true, updated_at = now()
   where id = v_mapping.id;

  -- ==== POSTCONDITIONS — asserted BEFORE return, roll back on any violation ==

  -- The runtime policy is untouched and still exactly in normal production.
  select * into v_policy
    from public.communication_provider_runtime_policies where id = v_policy.id;
  if v_policy.activation_status <> 'active'
     or v_policy.outbound_enabled is not true
     or v_policy.webhook_processing_enabled is not true
     or v_policy.health_check_enabled is not true then
    raise exception 'QF_TXN_POSTURE_INVARIANT' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_count
    from public.communication_provider_canary_destinations
   where provider_key = c_provider and channel = c_channel and is_active;
  if v_count <> 0 then
    raise exception 'QF_TXN_CANARY_INVARIANT' using errcode = 'P0001';
  end if;

  -- The live lane is byte-for-byte what it was, including its updated_at: this
  -- function did not touch it, and proves that rather than asserting it.
  select * into v_after
    from public.communication_provider_template_mappings where id = v_anchor.id;
  if v_after.id is null
     or v_after.is_active is not true
     or v_after.template_key is distinct from v_anchor.template_key
     or v_after.language is distinct from v_anchor.language
     or v_after.provider_key is distinct from v_anchor.provider_key
     or v_after.channel is distinct from v_anchor.channel
     or v_after.provider_template_name is distinct from v_anchor.provider_template_name
     or v_after.provider_template_id is distinct from v_anchor.provider_template_id
     or v_after.provider_category is distinct from v_anchor.provider_category
     or v_after.approval_status is distinct from v_anchor.approval_status
     or v_after.version is distinct from v_anchor.version
     or v_after.variables_schema is distinct from v_anchor.variables_schema
     or v_after.updated_at is distinct from v_anchor.updated_at then
    raise exception 'QF_TXN_ANCHOR_INVARIANT' using errcode = 'P0001';
  end if;

  -- The target is active and its identity is still exactly the reviewed one.
  select * into v_after
    from public.communication_provider_template_mappings where id = v_mapping.id;
  if v_after.is_active is not true
     or v_after.template_key is distinct from p_template_key
     or v_after.language is distinct from c_language
     or v_after.provider_key is distinct from c_provider
     or v_after.channel is distinct from c_channel
     or v_after.provider_category is distinct from c_category
     or v_after.approval_status is distinct from c_approval
     or v_after.version is distinct from c_version
     or v_after.provider_template_name is distinct from (v_spec ->> 'provider_template_name')
     or v_after.provider_template_id is distinct from (v_spec ->> 'provider_template_id')
     or v_after.variables_schema is distinct from (v_spec -> 'variables_schema') then
    raise exception 'QF_TXN_TARGET_INVARIANT' using errcode = 'P0001';
  end if;

  -- NOTHING outside the reviewed set is active on this provider/channel. This is
  -- the invariant that makes "one key per call" mean something: it is checked
  -- against the whole live surface, not against what this call happens to know.
  if exists (
    select 1 from public.communication_provider_template_mappings
     where provider_key = c_provider and channel = c_channel and is_active
       and not (template_key = any (c_allowed_active))
  ) then
    raise exception 'QF_TXN_ACTIVE_SET_INVARIANT' using errcode = 'P0001';
  end if;

  -- No template/language may hold two active mappings. The partial unique index
  -- uq_comm_provider_template_active already forbids it; this proves it held.
  if exists (
    select 1 from public.communication_provider_template_mappings
     where provider_key = c_provider and channel = c_channel and is_active
     group by template_key, language
    having count(*) > 1
  ) then
    raise exception 'QF_TXN_DUPLICATE_ACTIVE_INVARIANT' using errcode = 'P0001';
  end if;

  -- The account must be exactly as ready as it was; this function never wrote it.
  select * into v_account
    from public.communication_provider_accounts where id = v_account.id;
  if v_account.readiness_status <> 'provider_ready'
     or v_account.configuration_status <> 'complete'
     or v_account.business_verification_status <> 'verified'
     or v_account.phone_number_status <> 'connected'
     or v_account.webhook_status <> 'verified'
     or v_account.health_status <> 'healthy' then
    raise exception 'QF_TXN_ACCOUNT_READINESS_INVARIANT' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_count
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel and is_active;

  return query
  select p_template_key,
         (v_spec ->> 'provider_template_name'),
         (v_spec ->> 'provider_template_id'),
         v_policy.activation_status,
         v_policy.outbound_enabled,
         v_policy.webhook_processing_enabled,
         v_policy.health_check_enabled,
         (select count(*)::integer from public.communication_provider_canary_destinations
           where provider_key = c_provider and channel = c_channel and is_active),
         v_count,
         true,
         true;
end;
$$;

comment on function public.qf_activate_meta_transactional_mapping_v1(text, text) is
  'QF-MVP-40.14. Activates EXACTLY ONE Meta/WhatsApp provider template mapping per call, from a CLOSED set of exactly four keys — lead_received, client_lead_status_update, client_matching_update, vendor_onboarding_reminder. Provider, channel, language, category, version, approval status, active flag, provider template name, provider template id and binding schema are all hard-coded constants; the caller supplies only the target key and a 64-hex AUDIT-ONLY digest that grants no authority. Requires exactly one fully ready provider account, the runtime policy already active with outbound/webhook/health true, zero active canary destinations, the live lead_assignment_alert -> quickfurno_vendor_lead_assignment_alert_v1 mapping still active and exact, zero nonterminal automation jobs, zero nonterminal execution attempts, and a target row that is approved, inactive and exactly the reviewed provider identity and variables_schema. Writes ONE column on ONE mapping row and nothing else. Postconditions roll the whole call back unless the policy posture is unchanged, the canary surface is empty, the lead_assignment_alert row is byte-identical including updated_at, the target is active and exact, every active mapping belongs to the reviewed five-key set, no template/language holds two active mappings, and account readiness is untouched. Reversed at any time by qf_disable_meta_canary_v1(), which is unconditional and deactivates every Meta/WhatsApp mapping.';

-- ---------------------------------------------------------------------------
-- 3. CATALOGUE PREREQUISITE
--
--    communication_provider_template_mappings.template_key is a FOREIGN KEY into
--    public.communication_templates. Only lead_received has a row from a
--    migration; the other three were created on staging by a one-shot operator,
--    so the seed in §4 would fail the FK on production without this.
--
--    Creates ONLY on proven absence, with the exact values the staging rows
--    carry. NEVER modifies an existing row, and aborts on a conflicting one.
--    A catalogue row is a NAME, not a send switch: the mapping seeded in §4 is
--    INACTIVE, so no intent for these keys can reach a provider.
-- ---------------------------------------------------------------------------
do $catalogue$
declare
  c_keys constant text[] := array[
    'lead_received',
    'client_lead_status_update',
    'client_matching_update',
    'vendor_onboarding_reminder'
  ];
  v_key text;
  v_row public.communication_templates%rowtype;
begin
  foreach v_key in array c_keys loop
    select * into v_row from public.communication_templates where template_key = v_key;

    if v_row.template_key is null then
      insert into public.communication_templates
        (template_key, channel, category, description, language, version, readiness_status, is_active)
      values (
        v_key, 'whatsapp', 'business',
        case v_key
          when 'lead_received' then 'Lead received acknowledgement sent to homeowner'
          when 'client_lead_status_update' then 'Lead status update sent to homeowner'
          when 'client_matching_update' then 'Vendor matching update sent to homeowner'
          when 'vendor_onboarding_reminder' then 'Outstanding onboarding item reminder sent to vendor'
        end,
        'en', '1.0', 'provider_mapping_required', true
      );
    else
      -- Present already: leave it EXACTLY as it is, and refuse if it is not the
      -- kind of template this phase believes it is addressing.
      if v_row.channel is distinct from 'whatsapp' then
        raise exception
          'QF-MVP-40.14 aborted: communication_templates.% has channel %, expected whatsapp.',
          v_key, v_row.channel;
      end if;
      if v_row.category is distinct from 'business' then
        raise exception
          'QF-MVP-40.14 aborted: communication_templates.% has category %, expected business.',
          v_key, v_row.category;
      end if;
    end if;
  end loop;

  if (select count(*) from public.communication_templates where template_key = any (c_keys))
     <> array_length(c_keys, 1) then
    raise exception 'QF-MVP-40.14 aborted: the four catalogue rows are not all present.';
  end if;
end;
$catalogue$;

-- ---------------------------------------------------------------------------
-- 4. THE SEED — four APPROVED, INACTIVE mappings
--
--    Idempotent on an exactly-equal existing row. Aborts on ANY drift rather
--    than repointing a mapping at a different provider asset.
-- ---------------------------------------------------------------------------
do $seed$
declare
  c_provider constant text := 'meta_whatsapp_cloud';
  c_channel  constant text := 'whatsapp';
  c_language constant text := 'en';
  c_category constant text := 'utility';
  c_version  constant text := '1.0';

  -- The SAME contract the authority in §2 carries, byte-for-byte in content. The
  -- offline validator proves the two are semantically identical and that both
  -- equal bindingSchemaFor() for these keys.
  -- QF_TXN_SEED_BEGIN
  c_seed constant jsonb := '[
    {
      "template_key": "lead_received",
      "provider_template_name": "qf_lead_received_v1",
      "provider_template_id": "1442104054406353",
      "variables_schema": {
        "bindingVersion": 1,
        "bindings": [
          {"component": "body", "position": 1, "sourceKey": "client_name", "parameterType": "text"}
        ]
      }
    },
    {
      "template_key": "client_lead_status_update",
      "provider_template_name": "qf_client_lead_status_update_v1",
      "provider_template_id": "1078563638151601",
      "variables_schema": {
        "bindingVersion": 1,
        "bindings": [
          {"component": "body", "position": 1, "sourceKey": "client_name", "parameterType": "text"},
          {"component": "body", "position": 2, "sourceKey": "lead_status_label", "parameterType": "text"}
        ]
      }
    },
    {
      "template_key": "client_matching_update",
      "provider_template_name": "qf_client_matching_update_v2",
      "provider_template_id": "1597441458555561",
      "variables_schema": {
        "bindingVersion": 1,
        "bindings": [
          {"component": "body", "position": 1, "sourceKey": "client_name", "parameterType": "text"},
          {"component": "body", "position": 2, "sourceKey": "matched_vendor_count", "parameterType": "text"}
        ]
      }
    },
    {
      "template_key": "vendor_onboarding_reminder",
      "provider_template_name": "qf_vendor_onboarding_reminder_v1",
      "provider_template_id": "2564847817327366",
      "variables_schema": {
        "bindingVersion": 1,
        "bindings": [
          {"component": "body", "position": 1, "sourceKey": "outstanding_item", "parameterType": "text"}
        ]
      }
    }
  ]'::jsonb;
  -- QF_TXN_SEED_END

  v_spec jsonb;
  v_row  public.communication_provider_template_mappings%rowtype;
  v_key  text;
  v_active_before integer;
  v_active_after  integer;
  v_count integer;
begin
  -- The number of ACTIVE Meta/WhatsApp mappings BEFORE anything is written. The
  -- seed must not change it — on production that value is 1 (the live
  -- lead_assignment_alert lane); on a fresh environment it is 0.
  select count(*)::integer into v_active_before
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel and is_active;

  for v_spec in select e from jsonb_array_elements(c_seed) e loop
    v_key := v_spec ->> 'template_key';

    select count(*)::integer into v_count
      from public.communication_provider_template_mappings
     where provider_key = c_provider and channel = c_channel
       and language = c_language and template_key = v_key;
    if v_count > 1 then
      raise exception
        'QF-MVP-40.14 aborted: % already has % mappings for %/%/%; reconcile out of band.',
        v_key, v_count, c_provider, c_channel, c_language;
    end if;

    if v_count = 0 then
      insert into public.communication_provider_template_mappings (
        template_key, channel, provider_key, language, version,
        provider_template_name, provider_template_id, provider_category,
        approval_status, quality_status, variables_schema, is_active
      ) values (
        v_key, c_channel, c_provider, c_language, c_version,
        v_spec ->> 'provider_template_name',
        v_spec ->> 'provider_template_id',
        c_category,
        'approved', 'unknown',
        v_spec -> 'variables_schema',
        false
      );
    else
      -- EQUALITY OR ABORT. An exactly-equal row proves idempotence; anything else
      -- is drift, and drift is reconciled by a human, never by a push.
      select * into v_row
        from public.communication_provider_template_mappings
       where provider_key = c_provider and channel = c_channel
         and language = c_language and template_key = v_key;

      if v_row.is_active is true then
        raise exception
          'QF-MVP-40.14 aborted: % is already ACTIVE; this migration never activates and never deactivates.',
          v_key;
      end if;
      if v_row.provider_template_name is distinct from (v_spec ->> 'provider_template_name') then
        raise exception
          'QF-MVP-40.14 aborted: % provider_template_name is %, expected %.',
          v_key, coalesce(v_row.provider_template_name, '<null>'), v_spec ->> 'provider_template_name';
      end if;
      if v_row.provider_template_id is distinct from (v_spec ->> 'provider_template_id') then
        raise exception
          'QF-MVP-40.14 aborted: % provider_template_id is %, expected %.',
          v_key, coalesce(v_row.provider_template_id, '<null>'), v_spec ->> 'provider_template_id';
      end if;
      if v_row.provider_category is distinct from c_category then
        raise exception
          'QF-MVP-40.14 aborted: % provider_category is %, expected %.',
          v_key, coalesce(v_row.provider_category, '<null>'), c_category;
      end if;
      if v_row.language is distinct from c_language then
        raise exception
          'QF-MVP-40.14 aborted: % language is %, expected %.', v_key, v_row.language, c_language;
      end if;
      if v_row.version is distinct from c_version then
        raise exception
          'QF-MVP-40.14 aborted: % version is %, expected %.', v_key, v_row.version, c_version;
      end if;
      if v_row.approval_status is distinct from 'approved' then
        raise exception
          'QF-MVP-40.14 aborted: % approval_status is %, expected approved.', v_key, v_row.approval_status;
      end if;
      if v_row.variables_schema is distinct from (v_spec -> 'variables_schema') then
        raise exception
          'QF-MVP-40.14 aborted: % variables_schema differs from the proven binding contract.', v_key;
      end if;
    end if;
  end loop;

  -- ==== THE SEED ARMED NOTHING =============================================
  select count(*)::integer into v_count
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel and language = c_language
     and template_key in ('lead_received', 'client_lead_status_update',
                          'client_matching_update', 'vendor_onboarding_reminder');
  if v_count <> 4 then
    raise exception
      'QF-MVP-40.14 aborted: expected exactly 4 seeded mappings, found %.', v_count;
  end if;

  select count(*)::integer into v_count
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel and is_active
     and template_key in ('lead_received', 'client_lead_status_update',
                          'client_matching_update', 'vendor_onboarding_reminder');
  if v_count <> 0 then
    raise exception
      'QF-MVP-40.14 aborted: a seeded mapping is ACTIVE (% rows); applying this migration must create zero send authority.',
      v_count;
  end if;

  select count(*)::integer into v_active_after
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel and is_active;
  if v_active_after <> v_active_before then
    raise exception
      'QF-MVP-40.14 aborted: the ACTIVE mapping count moved from % to %.',
      v_active_before, v_active_after;
  end if;

  select count(*)::integer into v_count
    from public.communication_provider_canary_destinations where is_active;
  if v_count <> 0 then
    raise exception
      'QF-MVP-40.14 aborted: an active canary destination exists (% rows).', v_count;
  end if;
end;
$seed$;

-- ---------------------------------------------------------------------------
-- 5. Privileges
--
-- 5a. THE DIRECT-WRITE ESCAPE HATCH IS CLOSED.
--
--     This migration's own header states the problem it exists to solve:
--     20260813000000 "left communication_provider_template_mappings directly
--     writable, so 'activation' before this migration meant an unguarded
--     one-column UPDATE that anything holding the service key could perform
--     against ANY mapping row."
--
--     Adding a narrow RPC does not remove that. While service_role keeps direct
--     INSERT/UPDATE on the mapping table, every gate in §2 is merely OPTIONAL —
--     the closed four-key vocabulary, the six readiness preconditions, the
--     already-active runtime policy, the empty canary surface, the quiet
--     automation queue, the byte-identical anchor and every postcondition are
--     all bypassed by one direct `set is_active = true`, or by INSERTing a fresh
--     ACTIVE row pointed at any provider template id at all. §2 would never run.
--
--     So the authority is made EXCLUSIVE the only way an authority can be: the
--     alternative route is removed. 20260709000100 §9 granted this table exactly
--     `select, insert, update` to service_role (no DELETE, no TRUNCATE); the two
--     write privileges go, and SELECT stays.
--
--     WHY THIS BREAKS NOTHING THAT MAY RUN:
--       * §2 is SECURITY DEFINER and executes as its OWNER, not as the caller,
--         so the sole governed activation path is unaffected. 6.13 re-proves
--         service_role still holds EXECUTE on it and on both predecessors.
--       * A migration applies as its own (owner) role, never as service_role, so
--         §3 and §4 above — which have already completed by this point — are
--         unaffected, as is any future migration.
--       * Every runtime reader keeps working. The ONLY repository runtime paths
--         that touch this table are SELECT-only:
--           services/providerTemplateMappingService.ts  (send-time resolution)
--           services/adminWhatsAppService.ts            (admin read model)
--           services/smsProviderRuntimeService.ts       (sms mapping read)
--         No file under services/, lib/ or app/ INSERTs or UPDATEs it.
--
--     Nothing here GRANTS any table privilege. DELETE was never granted and is
--     not granted now; 6.12 asserts it is still absent.
-- ---------------------------------------------------------------------------
revoke insert, update on table public.communication_provider_template_mappings from service_role;

-- 5b. Function privileges — matched to the 40.13B / 80.14A grant style exactly.
--     Browser roles get NO activation capability, now or ever.
revoke all on function public.qf_activate_meta_transactional_mapping_v1(text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.qf_activate_meta_transactional_mapping_v1(text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Self-verification
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_sig text := 'public.qf_activate_meta_transactional_mapping_v1(text,text)';
  v_oid oid;
  v_def text;
  v_name text;
  v_count integer;
begin
  -- 6.1 exists, SECURITY DEFINER, pinned search_path, service_role only.
  v_oid := to_regprocedure(v_sig);
  if v_oid is null then
    raise exception 'QF-MVP-40.14 aborted: % is missing.', v_sig;
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = v_oid) then
    raise exception 'QF-MVP-40.14 aborted: % is not SECURITY DEFINER.', v_sig;
  end if;
  if not (
    select array_to_string(coalesce(p.proconfig, array[]::text[]), ',')
             like '%search_path=pg_catalog, public, pg_temp%'
      from pg_proc p where p.oid = v_oid
  ) then
    raise exception 'QF-MVP-40.14 aborted: % lacks the pinned search_path.', v_sig;
  end if;
  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'QF-MVP-40.14 aborted: % granted beyond service_role.', v_sig;
  end if;
  if not has_function_privilege('service_role', v_oid, 'execute') then
    raise exception 'QF-MVP-40.14 aborted: service_role lost execute on %.', v_sig;
  end if;

  select pg_get_functiondef(v_oid) into v_def;

  -- 6.2 the production scope is HARD-CODED, not parameterised.
  if v_def !~ 'c_provider\s+constant\s+text\s*:=\s*''meta_whatsapp_cloud'''
     or v_def !~ 'c_channel\s+constant\s+text\s*:=\s*''whatsapp'''
     or v_def !~ 'c_language\s+constant\s+text\s*:=\s*''en'''
     or v_def !~ 'c_category\s+constant\s+text\s*:=\s*''utility'''
     or v_def !~ 'c_version\s+constant\s+text\s*:=\s*''1\.0'''
     or v_def !~ 'c_approval\s+constant\s+text\s*:=\s*''approved''' then
    raise exception 'QF-MVP-40.14 aborted: the production scope is not hard-coded.';
  end if;
  -- Exactly two parameters, both text, and neither of them names a switch.
  if (select p.pronargs from pg_proc p where p.oid = v_oid) <> 2 then
    raise exception 'QF-MVP-40.14 aborted: the signature gained a parameter.';
  end if;
  if v_def ~ 'p_provider' or v_def ~ 'p_channel' or v_def ~ 'p_language'
     or v_def ~ 'p_category' or v_def ~ 'p_version' or v_def ~ 'p_approval'
     or v_def ~ 'p_provider_template_name' or v_def ~ 'p_provider_template_id'
     or v_def ~ 'p_variables_schema' or v_def ~ 'p_is_active'
     or v_def ~ 'p_activation_status' or v_def ~ 'p_outbound'
     or v_def ~ 'p_mapping_id' or v_def ~ 'p_account' or v_def ~ 'p_destination' then
    raise exception 'QF-MVP-40.14 aborted: a switch became caller-controlled.';
  end if;

  -- 6.3 the activation vocabulary is a CLOSED set of exactly the four keys.
  if v_def !~ 'c_keys\s+constant\s+text\[\]\s*:=\s*array\[\s*''lead_received'',\s*''client_lead_status_update'',\s*''client_matching_update'',\s*''vendor_onboarding_reminder''\s*\]' then
    raise exception 'QF-MVP-40.14 aborted: the closed four-key vocabulary is not exact.';
  end if;
  if v_def !~ 'not \(p_template_key = any \(c_keys\)\)' then
    raise exception 'QF-MVP-40.14 aborted: the closed-set admission gate is missing.';
  end if;

  -- 6.4 no excluded key is reachable. The authority never NAMES these, so a
  --     plain containment test is sound here (unlike a whole-file test, which
  --     would match this migration's own header).
  foreach v_name in array array[
    'clarification_request', 'clarification_reminder', 'client_transactional_followup',
    'vendor_new_lead', 'vendor_response_reminder', 'vendor_package_expiry_warning',
    'low_credit_warning', 'consent_stop_acknowledgement', 'consent_start_acknowledgement',
    'consent_help_response', 'recharge_reminder', 'client_nurture_followup',
    'dormant_requirement_reactivation', 'qf_lead_assignment_alert_v1', 'campaign'
  ] loop
    if v_def ~ v_name then
      raise exception
        'QF-MVP-40.14 aborted: excluded key % is reachable from this authority.', v_name;
    end if;
  end loop;

  -- 6.5 every mandatory gate is present.
  foreach v_name in array array[
    'QF_TXN_TEMPLATE_NOT_ELIGIBLE', 'QF_TXN_EVIDENCE_DIGEST_INVALID',
    'QF_TXN_CONTRACT_INTEGRITY', 'QF_TXN_ACCOUNT_NOT_EXACTLY_ONE',
    'QF_TXN_ACCOUNT_NOT_FOUND', 'QF_TXN_ACCOUNT_NOT_READY',
    'QF_TXN_POLICY_MISSING', 'QF_TXN_POLICY_NOT_ACTIVE',
    'QF_TXN_POLICY_OUTBOUND_OFF', 'QF_TXN_POLICY_OBSERVABILITY_OFF',
    'QF_TXN_ACTIVE_CANARY_PRESENT', 'QF_TXN_ANCHOR_MAPPING_NOT_EXACTLY_ONE',
    'QF_TXN_ANCHOR_MAPPING_IDENTITY_CONFLICT', 'QF_TXN_NONTERMINAL_JOBS_PRESENT',
    'QF_TXN_NONTERMINAL_ATTEMPTS_PRESENT', 'QF_TXN_MAPPING_NOT_EXACTLY_ONE',
    'QF_TXN_MAPPING_NOT_APPROVED', 'QF_TXN_MAPPING_ALREADY_ACTIVE',
    'QF_TXN_MAPPING_NAME_CONFLICT', 'QF_TXN_MAPPING_PROVIDER_ID_CONFLICT',
    'QF_TXN_MAPPING_CATEGORY_CONFLICT', 'QF_TXN_MAPPING_LANGUAGE_CONFLICT',
    'QF_TXN_MAPPING_VERSION_CONFLICT', 'QF_TXN_MAPPING_SCHEMA_CONFLICT',
    'QF_TXN_POSTURE_INVARIANT', 'QF_TXN_CANARY_INVARIANT',
    'QF_TXN_ANCHOR_INVARIANT', 'QF_TXN_TARGET_INVARIANT',
    'QF_TXN_ACTIVE_SET_INVARIANT', 'QF_TXN_DUPLICATE_ACTIVE_INVARIANT',
    'QF_TXN_ACCOUNT_READINESS_INVARIANT'
  ] loop
    if v_def !~ v_name then
      raise exception 'QF-MVP-40.14 aborted: guard % is missing.', v_name;
    end if;
  end loop;

  -- 6.6 the six readiness literals are all required.
  if v_def !~ 'readiness_status <> ''provider_ready'''
     or v_def !~ 'configuration_status <> ''complete'''
     or v_def !~ 'business_verification_status <> ''verified'''
     or v_def !~ 'phone_number_status <> ''connected'''
     or v_def !~ 'webhook_status <> ''verified'''
     or v_def !~ 'health_status <> ''healthy''' then
    raise exception 'QF-MVP-40.14 aborted: a provider-readiness precondition is missing.';
  end if;

  -- 6.7 the authority writes EXACTLY ONE surface: the mapping row. Checked as
  --     DML, not as a mention — the gates legitimately READ policies, canary
  --     destinations, accounts and the automation queue.
  if v_def ~ 'insert\s+into\s+public\.' then
    raise exception 'QF-MVP-40.14 aborted: the authority inserts a row.';
  end if;
  foreach v_name in array array[
    'communication_provider_runtime_policies', 'communication_provider_canary_destinations',
    'communication_provider_accounts', 'communication_messages', 'communication_intents',
    'communication_delivery_events', 'communication_webhook_receipts',
    'communication_templates', 'automation_jobs', 'automation_action_requests',
    'automation_execution_attempts', 'lead_assignments', 'leads', 'vendors',
    'vendor_credit_wallets', 'vendor_campaigns'
  ] loop
    if v_def ~ ('update\s+public\.' || v_name) or v_def ~ ('delete\s+from\s+public\.' || v_name) then
      raise exception
        'QF-MVP-40.14 aborted: the authority writes public.%, a surface it must only read.', v_name;
    end if;
  end loop;
  -- ...and the ONE permitted write is the single-column mapping activation.
  if v_def !~ 'update public\.communication_provider_template_mappings\s*\n\s*set is_active = true, updated_at = now\(\)\s*\n\s*where id = v_mapping\.id;' then
    raise exception 'QF-MVP-40.14 aborted: the single permitted write is not exact.';
  end if;
  if (select count(*) from regexp_matches(v_def, 'update\s+public\.', 'g')) <> 1 then
    raise exception 'QF-MVP-40.14 aborted: the authority performs more than one update.';
  end if;

  -- 6.8 the four seeded mappings exist, are APPROVED and are INACTIVE.
  select count(*)::integer into v_count
    from public.communication_provider_template_mappings
   where provider_key = 'meta_whatsapp_cloud' and channel = 'whatsapp' and language = 'en'
     and approval_status = 'approved' and is_active = false
     and template_key in ('lead_received', 'client_lead_status_update',
                          'client_matching_update', 'vendor_onboarding_reminder');
  if v_count <> 4 then
    raise exception
      'QF-MVP-40.14 aborted: expected 4 approved INACTIVE seeded mappings, found %.', v_count;
  end if;

  -- 6.9 applying this migration armed nothing at all.
  select count(*)::integer into v_count
    from public.communication_provider_canary_destinations where is_active;
  if v_count <> 0 then
    raise exception 'QF-MVP-40.14 aborted: an active canary destination exists (% rows).', v_count;
  end if;

  -- 6.10 the QF-MVP-80.14A authority and the emergency shutdown are UNTOUCHED.
  if to_regprocedure('public.qf_activate_meta_lead_assignment_v1(text,text,text)') is null then
    raise exception 'QF-MVP-40.14 aborted: qf_activate_meta_lead_assignment_v1 disappeared.';
  end if;
  select pg_get_functiondef(to_regprocedure('public.qf_activate_meta_lead_assignment_v1(text,text,text)'))
    into v_def;
  if v_def !~ 'c_template_key\s+constant\s+text\s*:=\s*''lead_assignment_alert'''
     or v_def !~ 'QF_ACTIVATION_POSTURE_INVARIANT' then
    raise exception 'QF-MVP-40.14 aborted: the 80.14A activation authority was altered.';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qf_disable_meta_canary_v1';
  if v_def is null then
    raise exception 'QF-MVP-40.14 aborted: qf_disable_meta_canary_v1 is missing.';
  end if;
  if v_def !~ 'activation_status\s*=\s*''disabled'''
     or v_def !~ 'outbound_enabled\s*=\s*false'
     or v_def !~ 'QF_CANARY_DISABLE_INCOMPLETE'
     or v_def !~ 'on conflict \(provider_key, channel\) do update' then
    raise exception 'QF-MVP-40.14 aborted: the emergency shutdown was weakened.';
  end if;
  -- It must still deactivate EVERY mapping, which is what makes the four keys
  -- this migration can activate reversible by one unconditional call.
  if v_def !~ 'update public\.communication_provider_template_mappings\s*\n\s*set is_active = false' then
    raise exception
      'QF-MVP-40.14 aborted: the emergency shutdown no longer deactivates every mapping.';
  end if;

  -- 6.11 no network extension appeared while applying this migration.
  if exists (select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')) then
    raise exception 'QF-MVP-40.14 aborted: database network extension appeared.';
  end if;

  -- 6.12 THE DIRECT-WRITE ESCAPE HATCH IS PROVEN CLOSED.
  --
  --      This is what makes §2 the EXCLUSIVE activation authority rather than
  --      merely the polite one. Asserted with has_table_privilege(), which
  --      resolves EFFECTIVE privilege, so a write re-granted through some other
  --      role service_role is a member of is caught as well as a direct ACL entry.
  if not has_table_privilege(
       'service_role', 'public.communication_provider_template_mappings', 'SELECT') then
    raise exception
      'QF-MVP-40.14 aborted: service_role lost SELECT on public.communication_provider_template_mappings; the send-time and admin READ paths must keep working.';
  end if;
  if has_table_privilege(
       'service_role', 'public.communication_provider_template_mappings', 'INSERT') then
    raise exception
      'QF-MVP-40.14 aborted: service_role still holds INSERT on public.communication_provider_template_mappings; a fresh ACTIVE row could be written past every gate in this migration.';
  end if;
  if has_table_privilege(
       'service_role', 'public.communication_provider_template_mappings', 'UPDATE') then
    raise exception
      'QF-MVP-40.14 aborted: service_role still holds UPDATE on public.communication_provider_template_mappings; a direct is_active = true would bypass every gate in this migration.';
  end if;
  if has_table_privilege(
       'service_role', 'public.communication_provider_template_mappings', 'DELETE') then
    raise exception
      'QF-MVP-40.14 aborted: service_role holds DELETE on public.communication_provider_template_mappings, which 20260709000100 never granted; that is an unreviewed privilege posture and is reconciled out of band, never silently by this push.';
  end if;

  -- 6.13 CLOSING THE DIRECT WRITE MUST NOT STRAND THE GOVERNED ROUTES.
  --      All three controlled authorities still exist, are still SECURITY
  --      DEFINER (so they are unaffected by the revoke above, which applies to
  --      the CALLER's role), and are still executable by service_role.
  foreach v_name in array array[
    'public.qf_activate_meta_lead_assignment_v1(text,text,text)',
    'public.qf_activate_meta_transactional_mapping_v1(text,text)',
    'public.qf_disable_meta_canary_v1()'
  ] loop
    v_oid := to_regprocedure(v_name);
    if v_oid is null then
      raise exception 'QF-MVP-40.14 aborted: controlled authority % is absent.', v_name;
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = v_oid) then
      raise exception
        'QF-MVP-40.14 aborted: controlled authority % is not SECURITY DEFINER; the revoke in §5a would disable it instead of narrowing the caller.', v_name;
    end if;
    if not has_function_privilege('service_role', v_oid, 'execute') then
      raise exception
        'QF-MVP-40.14 aborted: service_role lost execute on %; the direct write is closed, so the governed route must stay open.', v_name;
    end if;
  end loop;
end;
$verify$;

commit;
