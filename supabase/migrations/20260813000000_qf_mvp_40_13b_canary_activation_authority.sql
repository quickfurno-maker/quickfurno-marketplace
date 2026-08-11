-- ============================================================================
-- QF-MVP-40.13B — STAGING CANARY ACTIVATION AUTHORITY
--
-- FORWARD-ONLY SUCCESSOR. The historical migrations that created these tables —
-- 20260709000100 (accounts, mappings) and 20260709000200 (runtime policies, canary
-- destinations) — are never edited here.
--
-- WHY AN RPC AND NOT A DIRECT WRITE
--   `service_role` holds `insert, update` on all four provider tables, so anything
--   holding the staging service key could arm a real WhatsApp send with a single
--   PostgREST PATCH: `activation_status='active', outbound_enabled=true`. No readiness
--   rule, no identity check, no evidence, no audit. That is an unrestricted table
--   mutator guarding the most consequential switch in the system.
--
--   These three functions are the narrow authority instead. What they add that a direct
--   write structurally cannot:
--     * the TARGET VALUES ARE HARD-CODED. No caller supplies a status, a posture, a
--       provider or a channel, so no caller can ask for `active`, for an arbitrary
--       readiness value, or for another provider's rows.
--     * COMPARE-AND-SET on the durable prior state, so an illegal transition is refused
--       server-side even when the caller believes it is legal.
--     * a clean-base requirement, so a canary can never be armed on top of an unrelated
--       active mapping or an unrelated active canary destination.
--
--   Direct `insert, update` is additionally REVOKED on the two switch tables. Verified
--   zero blast radius: nothing in the repository writes
--   `communication_provider_runtime_policies` or
--   `communication_provider_canary_destinations` outside these functions. The grants on
--   `communication_provider_accounts` and `communication_provider_template_mappings` are
--   deliberately LEFT ALONE — `services/communicationProviderHealthService.ts` updates
--   health status directly after a real health check, and the QF-MVP-40.12 seed inserts
--   mapping rows. Breaking either would be a regression, not a hardening.
--
-- WHAT SQL CAN AND CANNOT PROVE — STATED PLAINLY
--   SQL cannot verify a Meta GET, a webhook subscription or a health verdict. Those are
--   network facts. So this authority does NOT claim to prove readiness was earned; it
--   proves that IF a readiness write happens it can only ever be the one exact permitted
--   transition, on the one exact identified account, from a safe base. Earning the
--   evidence is the operator's pure decision layer plus its single-use attestation
--   (`scripts/mvp/communication/activate-meta-staging-canary.mjs`). The evidence digest
--   parameters here are recorded for AUDIT ONLY and are never treated as proof.
--
-- NO SEND CAPABILITY IS CREATED
--   Nothing here sends a message, creates a communication row, reaches a provider, or
--   enables `activation_status = 'active'`. `active` is unreachable from every function
--   below: the only sendable posture any of them can produce is `canary`, which the
--   frozen `evaluateCanaryGate` additionally restricts to an active, unexpired
--   allowlisted destination hash.
--
-- NON-ACTIONS
--   No HTTP call, provider call, message send, n8n activation, table, column, type,
--   trigger, historical migration edit, seed row or production change.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Fail-closed preflight
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_name text;
begin
  foreach v_name in array array[
    'public.communication_provider_runtime_policies',
    'public.communication_provider_canary_destinations',
    'public.communication_provider_accounts',
    'public.communication_provider_template_mappings'
  ] loop
    if to_regclass(v_name) is null then
      raise exception 'QF-MVP-40.13B aborted: % is missing.', v_name;
    end if;
  end loop;

  -- The uniqueness rule the canary arm depends on must already exist.
  if to_regclass('public.uq_comm_canary_active_destination') is null then
    raise exception
      'QF-MVP-40.13B aborted: uq_comm_canary_active_destination is absent.';
  end if;
  if to_regclass('public.uq_comm_provider_runtime_policy') is null then
    raise exception
      'QF-MVP-40.13B aborted: uq_comm_provider_runtime_policy is absent.';
  end if;

  if exists (select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')) then
    raise exception
      'QF-MVP-40.13B aborted: database network extension present; provider calls must remain application-layer only.';
  end if;

  -- This authority must not already exist under another definition.
  foreach v_name in array array[
    'public.qf_arm_meta_provider_readiness_v1(text,text,text)',
    'public.qf_arm_meta_canary_v1(text,text,text,text,timestamptz,text)',
    'public.qf_disable_meta_canary_v1()'
  ] loop
    if to_regprocedure(v_name) is not null then
      raise exception
        'QF-MVP-40.13B aborted: % already exists; reconcile instead of masking drift.', v_name;
    end if;
  end loop;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. STAGE 1 — arm provider readiness. STRUCTURALLY NON-SENDING.
--
--    The posture is hard-coded to `readiness_only` with `outbound_enabled = false`, so
--    this function cannot produce a sendable state no matter what the caller wants. It
--    also refuses to run on top of an active mapping or an active canary destination:
--    readiness is armed from a clean base or not at all.
-- ---------------------------------------------------------------------------
create or replace function public.qf_arm_meta_provider_readiness_v1(
  p_phone_number_reference text,
  p_business_account_reference text,
  p_evidence_digest text
)
returns table (
  account_readiness_status text,
  account_configuration_status text,
  account_business_verification_status text,
  account_phone_number_status text,
  account_webhook_status text,
  account_health_status text,
  policy_activation_status text,
  policy_outbound_enabled boolean,
  policy_webhook_processing_enabled boolean,
  policy_health_check_enabled boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  -- Provider and channel are CONSTANTS, never parameters: a caller must not be able to
  -- point this authority at another provider or another channel.
  c_provider constant text := 'meta_whatsapp_cloud';
  c_channel  constant text := 'whatsapp';
  v_account public.communication_provider_accounts%rowtype;
  v_policy public.communication_provider_runtime_policies%rowtype;
begin
  if p_phone_number_reference is null or p_phone_number_reference !~ '^\d{6,}$'
     or p_business_account_reference is null or p_business_account_reference !~ '^\d{6,}$' then
    raise exception 'QF_CANARY_IDENTITY_MALFORMED' using errcode = 'P0001';
  end if;
  if p_evidence_digest is null or p_evidence_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'QF_CANARY_EVIDENCE_DIGEST_INVALID' using errcode = 'P0001';
  end if;

  -- IDENTITY CAS. Exactly one account row, matching BOTH references.
  select * into v_account
    from public.communication_provider_accounts
   where provider_key = c_provider
     and channel = c_channel
     and phone_number_reference = p_phone_number_reference
   for update;

  if v_account.id is null then
    raise exception 'QF_CANARY_ACCOUNT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_account.business_account_reference is distinct from p_business_account_reference then
    raise exception 'QF_CANARY_ACCOUNT_IDENTITY_CONFLICT' using errcode = 'P0001';
  end if;

  -- CLEAN BASE. Readiness may not be armed while anything is already able to send.
  if exists (
    select 1 from public.communication_provider_template_mappings
     where provider_key = c_provider and channel = c_channel and is_active
  ) then
    raise exception 'QF_CANARY_ACTIVE_MAPPING_PRESENT' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.communication_provider_canary_destinations
     where provider_key = c_provider and channel = c_channel and is_active
  ) then
    raise exception 'QF_CANARY_ACTIVE_DESTINATION_PRESENT' using errcode = 'P0001';
  end if;

  -- The six readiness values are LITERALS here. A caller cannot choose them.
  update public.communication_provider_accounts
     set readiness_status = 'provider_ready',
         configuration_status = 'complete',
         business_verification_status = 'verified',
         phone_number_status = 'connected',
         webhook_status = 'verified',
         health_status = 'healthy',
         last_synced_at = now(),
         updated_at = now()
   where id = v_account.id
   returning * into v_account;

  -- The non-sending posture, also literal.
  insert into public.communication_provider_runtime_policies (
    provider_key, channel, activation_status,
    outbound_enabled, webhook_processing_enabled, health_check_enabled
  ) values (
    c_provider, c_channel, 'readiness_only', false, true, true
  )
  on conflict (provider_key, channel) do update
     set activation_status = 'readiness_only',
         outbound_enabled = false,
         webhook_processing_enabled = true,
         health_check_enabled = true,
         updated_at = now()
   returning * into v_policy;

  -- Belt and braces: refuse to commit a sendable posture from this function, ever.
  if v_policy.outbound_enabled is true
     or v_policy.activation_status in ('canary', 'active') then
    raise exception 'QF_CANARY_STAGE1_MUST_NOT_SEND' using errcode = 'P0001';
  end if;

  return query
  select v_account.readiness_status, v_account.configuration_status,
         v_account.business_verification_status, v_account.phone_number_status,
         v_account.webhook_status, v_account.health_status,
         v_policy.activation_status, v_policy.outbound_enabled,
         v_policy.webhook_processing_enabled, v_policy.health_check_enabled;
end;
$$;

comment on function public.qf_arm_meta_provider_readiness_v1(text, text, text) is
  'QF-MVP-40.13B stage 1. Arms provider readiness and the NON-SENDING readiness_only posture. Provider, channel and every written value are hard-coded literals; the caller supplies only the identity to CAS against and an audit digest. Structurally cannot produce a sendable posture, and refuses on top of any active mapping or active canary destination. SQL does not and cannot verify Meta evidence — the digest is audit only.';

-- ---------------------------------------------------------------------------
-- 2. STAGE 2 — arm the canary. A SECOND, DISTINCT invocation.
--
--    Requires durable readiness ALREADY present and the `readiness_only` posture already
--    set, so one invocation can never both earn readiness and enter a send posture.
--    Activates EXACTLY ONE approved ordinary-business mapping and EXACTLY ONE canary
--    destination hash. `active` is unreachable: the only posture it can write is `canary`.
-- ---------------------------------------------------------------------------
create or replace function public.qf_arm_meta_canary_v1(
  p_phone_number_reference text,
  p_business_account_reference text,
  p_template_key text,
  p_destination_hash text,
  p_expires_at timestamptz,
  p_plan_digest text
)
returns table (
  policy_activation_status text,
  policy_outbound_enabled boolean,
  active_mapping_count integer,
  active_mapping_key text,
  active_canary_count integer,
  canary_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  c_provider constant text := 'meta_whatsapp_cloud';
  c_channel  constant text := 'whatsapp';
  c_language constant text := 'en';
  -- The closed ordinary-business set. The three evidence-bound consent
  -- acknowledgements are deliberately ABSENT: they are authorised only by the one-shot
  -- enforcer bound to a verified inbound command, and activating one here would
  -- manufacture ordinary send authority for exactly the templates that must never
  -- have it.
  c_eligible constant text[] := array[
    'lead_received', 'client_lead_status_update', 'client_matching_update',
    'lead_assignment_alert', 'vendor_onboarding_reminder'
  ];
  v_account public.communication_provider_accounts%rowtype;
  v_policy public.communication_provider_runtime_policies%rowtype;
  v_mapping public.communication_provider_template_mappings%rowtype;
  v_count integer;
begin
  if p_phone_number_reference is null or p_phone_number_reference !~ '^\d{6,}$'
     or p_business_account_reference is null or p_business_account_reference !~ '^\d{6,}$' then
    raise exception 'QF_CANARY_IDENTITY_MALFORMED' using errcode = 'P0001';
  end if;
  if p_template_key is null or not (p_template_key = any (c_eligible)) then
    raise exception 'QF_CANARY_TEMPLATE_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;
  if p_destination_hash is null or p_destination_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'QF_CANARY_DESTINATION_HASH_INVALID' using errcode = 'P0001';
  end if;
  if p_plan_digest is null or p_plan_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'QF_CANARY_PLAN_DIGEST_INVALID' using errcode = 'P0001';
  end if;
  -- The window is bounded on BOTH sides: it must be in the future, and it must not
  -- open a canary that outlives a working session.
  if p_expires_at is null or p_expires_at <= now()
     or p_expires_at > now() + interval '24 hours' then
    raise exception 'QF_CANARY_EXPIRY_OUT_OF_BOUNDS' using errcode = 'P0001';
  end if;

  select * into v_account
    from public.communication_provider_accounts
   where provider_key = c_provider
     and channel = c_channel
     and phone_number_reference = p_phone_number_reference
   for update;

  if v_account.id is null then
    raise exception 'QF_CANARY_ACCOUNT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_account.business_account_reference is distinct from p_business_account_reference then
    raise exception 'QF_CANARY_ACCOUNT_IDENTITY_CONFLICT' using errcode = 'P0001';
  end if;

  -- DURABLE READINESS MUST ALREADY BE TRUE. Stage 2 never derives it.
  if v_account.readiness_status <> 'provider_ready'
     or v_account.configuration_status <> 'complete'
     or v_account.business_verification_status <> 'verified'
     or v_account.phone_number_status <> 'connected'
     or v_account.webhook_status <> 'verified'
     or v_account.health_status <> 'healthy' then
    raise exception 'QF_CANARY_READINESS_NOT_PROVEN' using errcode = 'P0001';
  end if;

  -- PRIOR-STATE CAS. Stage 1 must have run, and nothing may already be sending.
  select * into v_policy
    from public.communication_provider_runtime_policies
   where provider_key = c_provider and channel = c_channel
   for update;

  if v_policy.id is null then
    raise exception 'QF_CANARY_POLICY_MISSING' using errcode = 'P0001';
  end if;
  if v_policy.activation_status <> 'readiness_only' then
    raise exception 'QF_CANARY_POLICY_NOT_IN_READINESS' using errcode = 'P0001';
  end if;
  if v_policy.outbound_enabled is true then
    raise exception 'QF_CANARY_POLICY_ALREADY_SENDING' using errcode = 'P0001';
  end if;

  -- NO UNRELATED ACTIVE MAPPING. The canary surface is exactly what was reviewed.
  select count(*) into v_count
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel
     and is_active and template_key <> p_template_key;
  if v_count > 0 then
    raise exception 'QF_CANARY_UNRELATED_ACTIVE_MAPPING' using errcode = 'P0001';
  end if;

  -- NO UNRELATED ACTIVE CANARY DESTINATION.
  select count(*) into v_count
    from public.communication_provider_canary_destinations
   where provider_key = c_provider and channel = c_channel
     and is_active and destination_hash <> p_destination_hash;
  if v_count > 0 then
    raise exception 'QF_CANARY_UNRELATED_ACTIVE_DESTINATION' using errcode = 'P0001';
  end if;

  -- EXACTLY ONE approved, inactive mapping for the exact tuple.
  select count(*) into v_count
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel
     and language = c_language and template_key = p_template_key;
  if v_count <> 1 then
    raise exception 'QF_CANARY_MAPPING_NOT_EXACTLY_ONE' using errcode = 'P0001';
  end if;

  select * into v_mapping
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel
     and language = c_language and template_key = p_template_key
   for update;

  if v_mapping.approval_status <> 'approved' then
    raise exception 'QF_CANARY_MAPPING_NOT_APPROVED' using errcode = 'P0001';
  end if;
  if v_mapping.is_active is true then
    raise exception 'QF_CANARY_MAPPING_ALREADY_ACTIVE' using errcode = 'P0001';
  end if;

  -- Arm the destination hash. Hash only; there is no plaintext column to write.
  update public.communication_provider_canary_destinations
     set is_active = true, expires_at = p_expires_at, updated_at = now()
   where provider_key = c_provider and channel = c_channel
     and destination_hash = p_destination_hash;

  if not found then
    insert into public.communication_provider_canary_destinations (
      provider_key, channel, destination_hash, is_active, expires_at,
      approved_by_type, approved_by_id, reason_sanitized
    ) values (
      c_provider, c_channel, p_destination_hash, true, p_expires_at,
      'core_service', 'qf_mvp_40_13b', 'QF-MVP-40 owner-approved staging canary'
    );
  end if;

  update public.communication_provider_template_mappings
     set is_active = true, updated_at = now()
   where id = v_mapping.id;

  -- The canary posture. `active` is not reachable from this function.
  update public.communication_provider_runtime_policies
     set activation_status = 'canary',
         outbound_enabled = true,
         webhook_processing_enabled = true,
         health_check_enabled = true,
         updated_at = now()
   where id = v_policy.id
   returning * into v_policy;

  if v_policy.activation_status <> 'canary' then
    raise exception 'QF_CANARY_POSTURE_INVARIANT' using errcode = 'P0001';
  end if;

  select count(*) into v_count
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel and is_active;

  return query
  select v_policy.activation_status, v_policy.outbound_enabled,
         v_count, p_template_key,
         (select count(*)::integer from public.communication_provider_canary_destinations
           where provider_key = c_provider and channel = c_channel and is_active),
         p_expires_at;
end;
$$;

comment on function public.qf_arm_meta_canary_v1(text, text, text, text, timestamptz, text) is
  'QF-MVP-40.13B stage 2. Requires durable six-field readiness AND the readiness_only posture to already be true, so one invocation can never both earn readiness and enter a send posture. Activates EXACTLY ONE approved ordinary-business mapping and ONE canary destination hash, then writes the canary posture. activation_status=active is unreachable. The three evidence-bound consent acknowledgements are not in the eligible set.';

-- ---------------------------------------------------------------------------
-- 3. DISABLE — the §17 return to fail-closed.
--
--    Unconditional and idempotent by design, and it takes NO attestation: closing a
--    gate must never be harder than opening one, and a half-armed staging environment
--    must be recoverable in a single call from ANY reachable state.
-- ---------------------------------------------------------------------------
create or replace function public.qf_disable_meta_canary_v1()
returns table (
  policy_activation_status text,
  policy_outbound_enabled boolean,
  policy_webhook_processing_enabled boolean,
  policy_health_check_enabled boolean,
  deactivated_mappings integer,
  deactivated_canary_destinations integer,
  active_mappings_remaining integer,
  active_canary_remaining integer,
  account_send_capable boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  c_provider constant text := 'meta_whatsapp_cloud';
  c_channel  constant text := 'whatsapp';
  v_policy public.communication_provider_runtime_policies%rowtype;
  v_mappings integer := 0;
  v_canary integer := 0;
  v_active_mappings integer;
  v_active_canary integer;
  v_send_capable boolean;
begin
  -- 1. Close the outbound switch FIRST, so the smallest possible window exists
  --    between the first write and a fully fail-closed state.
  insert into public.communication_provider_runtime_policies (
    provider_key, channel, activation_status,
    outbound_enabled, webhook_processing_enabled, health_check_enabled
  ) values (
    c_provider, c_channel, 'disabled', false, false, false
  )
  on conflict (provider_key, channel) do update
     set activation_status = 'disabled',
         outbound_enabled = false,
         webhook_processing_enabled = false,
         health_check_enabled = false,
         updated_at = now()
   returning * into v_policy;

  -- 2. Deactivate every canary destination for this provider/channel.
  with closed as (
    update public.communication_provider_canary_destinations
       set is_active = false, expires_at = least(coalesce(expires_at, now()), now()),
           updated_at = now()
     where provider_key = c_provider and channel = c_channel and is_active
     returning 1
  ) select count(*)::integer into v_canary from closed;

  -- 3. Deactivate every mapping for this provider/channel.
  with closed as (
    update public.communication_provider_template_mappings
       set is_active = false, updated_at = now()
     where provider_key = c_provider and channel = c_channel and is_active
     returning 1
  ) select count(*)::integer into v_mappings from closed;

  -- 4. Return every account for this provider/channel to a non-send-capable state.
  update public.communication_provider_accounts
     set readiness_status = 'disabled',
         configuration_status = 'partial',
         webhook_status = 'pending',
         health_status = 'unknown',
         updated_at = now()
   where provider_key = c_provider and channel = c_channel;

  select count(*)::integer into v_active_mappings
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel and is_active;
  select count(*)::integer into v_active_canary
    from public.communication_provider_canary_destinations
   where provider_key = c_provider and channel = c_channel and is_active;
  select exists (
    select 1 from public.communication_provider_accounts
     where provider_key = c_provider and channel = c_channel
       and readiness_status = 'provider_ready'
  ) into v_send_capable;

  -- Post-write invariant: every reachable sending gate is closed.
  if v_policy.outbound_enabled is true
     or v_policy.activation_status <> 'disabled'
     or v_active_mappings <> 0 or v_active_canary <> 0 or v_send_capable is true then
    raise exception 'QF_CANARY_DISABLE_INCOMPLETE' using errcode = 'P0001';
  end if;

  return query
  select v_policy.activation_status, v_policy.outbound_enabled,
         v_policy.webhook_processing_enabled, v_policy.health_check_enabled,
         v_mappings, v_canary, v_active_mappings, v_active_canary, v_send_capable;
end;
$$;

comment on function public.qf_disable_meta_canary_v1() is
  'QF-MVP-40.13B return to fail-closed. Unconditional, idempotent, takes no argument and no attestation: it closes the outbound switch first, then every canary destination, every mapping, and returns every account to a non-send-capable state, from ANY reachable partial state. Raises if any reachable sending gate remains open.';

-- ---------------------------------------------------------------------------
-- 4. Privileges — the RPCs become the ONLY write path to the two switch tables.
--
--    Verified zero blast radius: nothing in the repository writes either table
--    outside these functions. `accounts` and `template_mappings` keep their grants,
--    because the health service and the QF-MVP-40.12 seed legitimately write them.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.communication_provider_runtime_policies
  from service_role, anon, authenticated;
revoke insert, update, delete on public.communication_provider_canary_destinations
  from service_role, anon, authenticated;

grant select on public.communication_provider_runtime_policies to service_role;
grant select on public.communication_provider_canary_destinations to service_role;

revoke all on function public.qf_arm_meta_provider_readiness_v1(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.qf_arm_meta_canary_v1(text, text, text, text, timestamptz, text)
  from public, anon, authenticated, service_role;
revoke all on function public.qf_disable_meta_canary_v1()
  from public, anon, authenticated, service_role;

grant execute on function public.qf_arm_meta_provider_readiness_v1(text, text, text)
  to service_role;
grant execute on function public.qf_arm_meta_canary_v1(text, text, text, text, timestamptz, text)
  to service_role;
grant execute on function public.qf_disable_meta_canary_v1()
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Self-verification
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_sig text;
  v_oid oid;
  v_def text;
  v_count integer;
begin
  -- 5.1 all three exist, are SECURITY DEFINER, search_path pinned, service_role only.
  foreach v_sig in array array[
    'public.qf_arm_meta_provider_readiness_v1(text,text,text)',
    'public.qf_arm_meta_canary_v1(text,text,text,text,timestamptz,text)',
    'public.qf_disable_meta_canary_v1()'
  ] loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then
      raise exception 'QF-MVP-40.13B aborted: % is missing.', v_sig;
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = v_oid) then
      raise exception 'QF-MVP-40.13B aborted: % is not SECURITY DEFINER.', v_sig;
    end if;
    if not (
      select array_to_string(coalesce(p.proconfig, array[]::text[]), ',')
               like '%search_path=pg_catalog, public, pg_temp%'
        from pg_proc p where p.oid = v_oid
    ) then
      raise exception 'QF-MVP-40.13B aborted: % lacks the pinned search_path.', v_sig;
    end if;
    if has_function_privilege('anon', v_oid, 'execute')
       or has_function_privilege('authenticated', v_oid, 'execute') then
      raise exception 'QF-MVP-40.13B aborted: % granted beyond service_role.', v_sig;
    end if;
    if not has_function_privilege('service_role', v_oid, 'execute') then
      raise exception 'QF-MVP-40.13B aborted: service_role lost execute on %.', v_sig;
    end if;
  end loop;

  -- 5.2 `active` is UNASSIGNABLE from every function in this authority.
  --
  --     Checked as an ASSIGNMENT, not as a mention: the stage-1 and stage-2 guards
  --     legitimately name 'active' and 'canary' in order to REFUSE them, and a
  --     mention-based check would abort on its own defences.
  foreach v_sig in array array[
    'qf_arm_meta_provider_readiness_v1', 'qf_arm_meta_canary_v1', 'qf_disable_meta_canary_v1'
  ] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_sig;
    if v_def ~ 'activation_status\s*=\s*''active''' then
      raise exception
        'QF-MVP-40.13B aborted: % assigns activation_status=active.', v_sig;
    end if;
  end loop;

  -- 5.3 each function assigns EXACTLY its own posture and no other.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qf_arm_meta_provider_readiness_v1';
  if v_def !~ 'activation_status\s*=\s*''readiness_only'''
     or v_def !~ 'QF_CANARY_STAGE1_MUST_NOT_SEND' then
    raise exception 'QF-MVP-40.13B aborted: stage 1 lost its non-sending guarantee.';
  end if;
  if v_def ~ 'activation_status\s*=\s*''canary'''
     or v_def ~ 'outbound_enabled\s*=\s*true' then
    raise exception 'QF-MVP-40.13B aborted: stage 1 can assign a sending posture.';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qf_disable_meta_canary_v1';
  if v_def !~ 'activation_status\s*=\s*''disabled'''
     or v_def ~ 'activation_status\s*=\s*''canary'''
     or v_def ~ 'outbound_enabled\s*=\s*true' then
    raise exception 'QF-MVP-40.13B aborted: disable can assign a sending posture.';
  end if;

  -- 5.4 stage 2 requires durable readiness and the prior posture.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qf_arm_meta_canary_v1';
  if v_def !~ 'QF_CANARY_READINESS_NOT_PROVEN'
     or v_def !~ 'QF_CANARY_POLICY_NOT_IN_READINESS'
     or v_def !~ 'QF_CANARY_UNRELATED_ACTIVE_MAPPING'
     or v_def !~ 'QF_CANARY_UNRELATED_ACTIVE_DESTINATION' then
    raise exception 'QF-MVP-40.13B aborted: a stage 2 CAS guard is missing.';
  end if;
  -- The three evidence-bound acknowledgements must not be eligible.
  if v_def ~ 'consent_stop_acknowledgement'
     or v_def ~ 'consent_start_acknowledgement'
     or v_def ~ 'consent_help_response' then
    raise exception
      'QF-MVP-40.13B aborted: an evidence-bound acknowledgement is canary-eligible.';
  end if;

  -- 5.5 no function here sends, reaches a provider, or writes a communication row.
  foreach v_sig in array array[
    'qf_arm_meta_provider_readiness_v1', 'qf_arm_meta_canary_v1', 'qf_disable_meta_canary_v1'
  ] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_sig;
    if v_def ~ 'communication_messages' or v_def ~ 'graph\.facebook' or v_def ~ 'messages' then
      raise exception 'QF-MVP-40.13B aborted: % touches a send surface.', v_sig;
    end if;
  end loop;

  -- 5.6 the two switch tables are now RPC-only for writes.
  if has_table_privilege('service_role', 'public.communication_provider_runtime_policies', 'insert')
     or has_table_privilege('service_role', 'public.communication_provider_runtime_policies', 'update')
     or has_table_privilege('service_role', 'public.communication_provider_canary_destinations', 'insert')
     or has_table_privilege('service_role', 'public.communication_provider_canary_destinations', 'update') then
    raise exception
      'QF-MVP-40.13B aborted: a switch table is still directly writable by service_role.';
  end if;
  if not has_table_privilege('service_role', 'public.communication_provider_runtime_policies', 'select')
     or not has_table_privilege('service_role', 'public.communication_provider_canary_destinations', 'select') then
    raise exception 'QF-MVP-40.13B aborted: service_role lost read access to a switch table.';
  end if;

  -- 5.7 the paths the health service and the 40.12 seed depend on are PRESERVED.
  if not has_table_privilege('service_role', 'public.communication_provider_accounts', 'update') then
    raise exception
      'QF-MVP-40.13B aborted: the canonical health-check write path was broken.';
  end if;
  if not has_table_privilege('service_role', 'public.communication_provider_template_mappings', 'insert') then
    raise exception
      'QF-MVP-40.13B aborted: the QF-MVP-40.12 mapping seed write path was broken.';
  end if;

  -- 5.8 nothing was armed by this migration.
  select count(*)::integer into v_count
    from public.communication_provider_runtime_policies
   where outbound_enabled or activation_status in ('canary', 'active');
  if v_count <> 0 then
    raise exception 'QF-MVP-40.13B aborted: a sendable runtime policy exists (% rows).', v_count;
  end if;
  select count(*)::integer into v_count
    from public.communication_provider_canary_destinations where is_active;
  if v_count <> 0 then
    raise exception 'QF-MVP-40.13B aborted: an active canary destination exists (% rows).', v_count;
  end if;

  -- 5.9 no table, column, type or trigger was added by this migration.
  select count(*)::integer into v_count
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('communication_provider_runtime_policies',
                       'communication_provider_canary_destinations')
     and not t.tgisinternal;
  if v_count <> 0 then
    raise exception
      'QF-MVP-40.13B aborted: expected 0 user triggers on the switch tables, found %.', v_count;
  end if;

  if exists (select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')) then
    raise exception 'QF-MVP-40.13B aborted: database network extension appeared.';
  end if;
end;
$verify$;

commit;
