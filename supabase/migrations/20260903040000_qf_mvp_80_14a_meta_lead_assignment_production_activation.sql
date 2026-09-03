-- ============================================================================
-- QF-MVP-80.14A — META LEAD-ASSIGNMENT PRODUCTION ACTIVATION AUTHORITY
--
-- FORWARD-ONLY SUCCESSOR. The historical migrations that created these tables —
-- 20260709000100 (accounts, mappings), 20260709000200 (runtime policies, canary
-- destinations) — and the QF-MVP-40.13B authority (20260813000000) are never
-- edited here. This migration ADDS one function and nothing else.
--
-- WHAT THIS CLOSES
--   QF-MVP-40.13B can reach `canary` and can reach `disabled`. It deliberately
--   cannot reach `active`: §5.2 of that migration aborts if ANY function in it
--   assigns `activation_status = 'active'`. That was correct while nothing had
--   ever been proven end to end. It now leaves the certified lead-assignment
--   lane with no governed route to normal production.
--
--   This is that route, and only that route.
--
-- WHY AN RPC AND NOT A DIRECT WRITE
--   20260813000000 already REVOKED insert/update on
--   communication_provider_runtime_policies and
--   communication_provider_canary_destinations from service_role, so an RPC is
--   now the ONLY write path to the outbound switch. Re-granting direct write to
--   reach `active` would undo that hardening and hand anything holding the
--   service key a one-statement production send switch. Instead this function is
--   the narrow authority, and it adds what a direct write structurally cannot:
--
--     * THE TARGET VALUES ARE HARD-CODED. Provider, channel, template key,
--       language, activation status and every capability flag are constants. No
--       caller supplies any of them, so no caller can activate another provider,
--       another channel, another template or another posture.
--     * COMPARE-AND-SET on the durable prior state, so an illegal transition is
--       refused server-side even when the caller believes it is legal.
--     * DURABLE PROOF OF A REAL, RECENT, DELIVERED CANARY MESSAGE — not an
--       assertion that one happened. See "WHAT SQL CAN AND CANNOT PROVE".
--     * POSTCONDITIONS that re-read what was written and roll the whole call
--       back if the resulting posture is not exactly the reviewed one.
--
-- WHAT SQL CAN AND CANNOT PROVE — STATED PLAINLY
--   SQL cannot verify a Meta API call, a webhook signature computation or a
--   delivery receipt as it happens. Those are network facts.
--
--   What it CAN do — and what makes this different from 40.13B's audit-only
--   digest — is require that the DURABLE CONSEQUENCES of those network facts are
--   already recorded in this database by the ordinary, already-certified code
--   path: a communication_messages row that reached `delivered` or `read` with a
--   provider message id, a communication_delivery_events row for that exact
--   message, a communication_webhook_receipts row with signature_valid = true
--   and processing_status = 'processed', and a canary-destination row proving
--   that message's destination was authorized at the time it was sent. Those
--   rows can only exist if a real message was really sent, really accepted and
--   really acknowledged by a signature-verified callback.
--
--   `p_canary_evidence_digest` remains AUDIT ONLY. It is recorded, it is
--   format-checked, and it is never treated as proof of anything.
--
-- THE PROOF WINDOW IS DELIBERATELY NARROW (24 HOURS)
--   Stale proof is not proof. An operator who cannot activate within a day of
--   the canary must run a fresh canary rather than lean on an old one — and the
--   40.13B arm/disable pair makes that cheap. This is the single most likely
--   reason a legitimate activation attempt will refuse, and refusing is correct.
--
-- THE HISTORICAL CANARY DESTINATION ROW SURVIVES SHUTDOWN, BY DESIGN
--   qf_disable_meta_canary_v1 sets is_active = false and
--   expires_at = least(coalesce(expires_at, now()), now()); it does NOT delete
--   the row. So after a completed canary the destination row is INACTIVE but its
--   [created_at, expires_at] window still brackets the proof message. Clause 13
--   therefore checks the window, never is_active — an activation that required
--   an ACTIVE canary destination could only ever run with the canary still open,
--   which is the opposite of what a safe rollout wants.
--
-- NO SEND CAPABILITY IS CREATED BY APPLYING THIS MIGRATION
--   Applying it creates a function. It arms nothing, activates nothing, sends
--   nothing, and writes no communication row. §6 asserts that after this
--   migration there is still ZERO sendable runtime policy and ZERO active canary
--   destination.
--
-- NON-ACTIONS
--   No HTTP call, provider call, message send, n8n activation, cron, table,
--   column, type, trigger, historical migration edit, seed row, canary
--   destination, lead-assignment intent read/write, activation-boundary change,
--   credit change or assignment-cap change.
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
    'public.communication_provider_template_mappings',
    'public.communication_messages',
    'public.communication_delivery_events',
    'public.communication_webhook_receipts'
  ] loop
    if to_regclass(v_name) is null then
      raise exception 'QF-MVP-80.14A aborted: % is missing.', v_name;
    end if;
  end loop;

  -- The uniqueness rule this authority's CAS depends on must already exist.
  if to_regclass('public.uq_comm_provider_runtime_policy') is null then
    raise exception
      'QF-MVP-80.14A aborted: uq_comm_provider_runtime_policy is absent.';
  end if;

  -- The QF-MVP-40.13B authority must already be present: this migration is its
  -- successor, not its replacement, and the emergency shutdown it provides is a
  -- PRECONDITION of granting any route to `active`.
  foreach v_name in array array[
    'public.qf_arm_meta_provider_readiness_v1(text,text,text)',
    'public.qf_arm_meta_canary_v1(text,text,text,text,timestamptz,text)',
    'public.qf_disable_meta_canary_v1()'
  ] loop
    if to_regprocedure(v_name) is null then
      raise exception
        'QF-MVP-80.14A aborted: % is absent; the 40.13B authority must exist first.', v_name;
    end if;
  end loop;

  -- The account attribution column every proof clause binds against.
  foreach v_name in array array[
    'communication_messages', 'communication_delivery_events', 'communication_webhook_receipts'
  ] loop
    if not exists (
      select 1 from pg_attribute a
       where a.attrelid = to_regclass('public.' || v_name)
         and a.attname = 'provider_account_id'
         and a.attnum > 0 and not a.attisdropped
    ) then
      raise exception
        'QF-MVP-80.14A aborted: %.provider_account_id is absent; proof cannot bind to an account.', v_name;
    end if;
  end loop;

  if exists (select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')) then
    raise exception
      'QF-MVP-80.14A aborted: database network extension present; provider calls must remain application-layer only.';
  end if;

  -- This authority must not already exist under another definition.
  if to_regprocedure('public.qf_activate_meta_lead_assignment_v1(text,text,text)') is not null then
    raise exception
      'QF-MVP-80.14A aborted: qf_activate_meta_lead_assignment_v1 already exists; reconcile instead of masking drift.';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. THE ACTIVATION AUTHORITY
--
--    The ONLY function in this repository that can assign
--    activation_status = 'active'. It activates EXACTLY the lead_assignment_alert
--    mapping and EXACTLY the Meta/WhatsApp runtime policy, and nothing else.
-- ---------------------------------------------------------------------------
create or replace function public.qf_activate_meta_lead_assignment_v1(
  p_phone_number_reference text,
  p_business_account_reference text,
  p_canary_evidence_digest text
)
returns table (
  policy_activation_status text,
  policy_outbound_enabled boolean,
  policy_webhook_processing_enabled boolean,
  policy_health_check_enabled boolean,
  active_mapping_count integer,
  active_mapping_key text,
  active_canary_count integer,
  proof_message_status text,
  proof_delivery_event_type text,
  account_send_capable boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  -- EVERY production-scope value is a CONSTANT. A caller supplies only the
  -- identity to compare-and-set against, plus an audit digest. There is
  -- deliberately no parameter for provider, channel, template key, language,
  -- activation status, outbound flag, mapping id, destination or destination
  -- hash — so none of them can be chosen, widened or redirected by a caller.
  c_provider     constant text := 'meta_whatsapp_cloud';
  c_channel      constant text := 'whatsapp';
  c_template_key constant text := 'lead_assignment_alert';
  c_language     constant text := 'en';
  -- Stale proof is not proof.
  c_proof_window constant interval := interval '24 hours';

  v_account public.communication_provider_accounts%rowtype;
  v_policy  public.communication_provider_runtime_policies%rowtype;
  v_mapping public.communication_provider_template_mappings%rowtype;
  v_proof   public.communication_messages%rowtype;
  v_event_type text;
  v_count integer;
  v_send_capable boolean;
begin
  -- ==== 1-3. INPUT GRAMMAR =================================================
  -- The same numeric-id grammar the 40.13B authority already enforces.
  if p_phone_number_reference is null or p_phone_number_reference !~ '^\d{6,}$'
     or p_business_account_reference is null or p_business_account_reference !~ '^\d{6,}$' then
    raise exception 'QF_ACTIVATION_IDENTITY_MALFORMED' using errcode = 'P0001';
  end if;
  -- AUDIT ONLY. This digest proves nothing about Meta and is never treated as
  -- evidence; the durable-row clauses below are the evidence.
  if p_canary_evidence_digest is null or p_canary_evidence_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'QF_ACTIVATION_EVIDENCE_DIGEST_INVALID' using errcode = 'P0001';
  end if;

  -- ==== 4-5. IDENTITY CAS ==================================================
  -- Exactly one account for provider/channel/phone-number id, and its WABA
  -- reference must match the supplied one exactly.
  select count(*)::integer into v_count
    from public.communication_provider_accounts
   where provider_key = c_provider
     and channel = c_channel
     and phone_number_reference = p_phone_number_reference;
  if v_count <> 1 then
    raise exception 'QF_ACTIVATION_ACCOUNT_NOT_EXACTLY_ONE' using errcode = 'P0001';
  end if;

  select * into v_account
    from public.communication_provider_accounts
   where provider_key = c_provider
     and channel = c_channel
     and phone_number_reference = p_phone_number_reference
   for update;

  if v_account.id is null then
    raise exception 'QF_ACTIVATION_ACCOUNT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_account.business_account_reference is distinct from p_business_account_reference then
    raise exception 'QF_ACTIVATION_ACCOUNT_IDENTITY_CONFLICT' using errcode = 'P0001';
  end if;

  -- ==== 6. DURABLE READINESS — ALL SIX, EXACTLY ============================
  -- This function never derives readiness; it only refuses without it.
  if v_account.readiness_status <> 'provider_ready'
     or v_account.configuration_status <> 'complete'
     or v_account.business_verification_status <> 'verified'
     or v_account.phone_number_status <> 'connected'
     or v_account.webhook_status <> 'verified'
     or v_account.health_status <> 'healthy' then
    raise exception 'QF_ACTIVATION_READINESS_NOT_PROVEN' using errcode = 'P0001';
  end if;

  -- ==== 7. PRIOR POSTURE CAS ===============================================
  -- Activation is reachable ONLY from the non-sending readiness_only posture
  -- with webhooks and health checks already on. In particular it is NOT
  -- reachable from `canary`: an open canary must be closed by
  -- qf_disable_meta_canary_v1 and readiness re-armed, so a canary can never
  -- silently widen itself into unrestricted production.
  select * into v_policy
    from public.communication_provider_runtime_policies
   where provider_key = c_provider and channel = c_channel
   for update;

  if v_policy.id is null then
    raise exception 'QF_ACTIVATION_POLICY_MISSING' using errcode = 'P0001';
  end if;
  if v_policy.activation_status <> 'readiness_only' then
    raise exception 'QF_ACTIVATION_POLICY_NOT_IN_READINESS' using errcode = 'P0001';
  end if;
  if v_policy.outbound_enabled is true then
    raise exception 'QF_ACTIVATION_POLICY_ALREADY_SENDING' using errcode = 'P0001';
  end if;
  if v_policy.webhook_processing_enabled is not true
     or v_policy.health_check_enabled is not true then
    raise exception 'QF_ACTIVATION_POLICY_OBSERVABILITY_OFF' using errcode = 'P0001';
  end if;

  -- ==== 8. ZERO ACTIVE CANARY DESTINATIONS =================================
  -- The canary must be SHUT before normal production opens. Production is not a
  -- canary with a wider allowlist; it is a different posture entirely.
  select count(*)::integer into v_count
    from public.communication_provider_canary_destinations
   where provider_key = c_provider and channel = c_channel and is_active;
  if v_count <> 0 then
    raise exception 'QF_ACTIVATION_ACTIVE_CANARY_PRESENT' using errcode = 'P0001';
  end if;

  -- ==== 9. ZERO PRE-EXISTING ACTIVE MAPPINGS ===============================
  -- Activation starts from a clean surface, so the sending surface after this
  -- call is exactly the one mapping reviewed here and nothing inherited.
  select count(*)::integer into v_count
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel and is_active;
  if v_count <> 0 then
    raise exception 'QF_ACTIVATION_ACTIVE_MAPPING_PRESENT' using errcode = 'P0001';
  end if;

  -- ==== 10-11. EXACTLY ONE APPROVED, INACTIVE lead_assignment_alert MAPPING =
  select count(*)::integer into v_count
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel
     and language = c_language and template_key = c_template_key;
  if v_count <> 1 then
    raise exception 'QF_ACTIVATION_MAPPING_NOT_EXACTLY_ONE' using errcode = 'P0001';
  end if;

  select * into v_mapping
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel
     and language = c_language and template_key = c_template_key
   for update;

  if v_mapping.approval_status <> 'approved' then
    raise exception 'QF_ACTIVATION_MAPPING_NOT_APPROVED' using errcode = 'P0001';
  end if;
  if v_mapping.is_active is true then
    raise exception 'QF_ACTIVATION_MAPPING_ALREADY_ACTIVE' using errcode = 'P0001';
  end if;
  if v_mapping.provider_template_name is null
     or btrim(v_mapping.provider_template_name) = '' then
    raise exception 'QF_ACTIVATION_MAPPING_TEMPLATE_NAME_MISSING' using errcode = 'P0001';
  end if;

  -- ==== 12-14. DURABLE PROOF OF A REAL, RECENT, DELIVERED CANARY MESSAGE ====
  -- One selection that satisfies ALL THREE clauses together, so a message that
  -- passes one and fails another can never be split across candidates.
  select m.* into v_proof
    from public.communication_messages m
   where m.provider = c_provider
     and m.channel = c_channel
     and m.provider_account_id = v_account.id
     and m.template_key = c_template_key
     and m.status in ('delivered', 'read')
     and m.delivered_at is not null
     and m.provider_message_id is not null
     and m.created_at >= now() - c_proof_window
     -- 13. that exact destination was an AUTHORIZED canary at send time. The row
     --     is expected to be inactive now (shutdown closed it); what must hold is
     --     that its window bracketed the message.
     and exists (
       select 1 from public.communication_provider_canary_destinations d
        where d.provider_key = c_provider
          and d.channel = c_channel
          and d.destination_hash = m.destination_hash
          and d.created_at <= m.created_at
          and d.expires_at >= m.created_at
     )
     -- 14. an exact delivery event for THIS message and THIS provider message id.
     and exists (
       select 1 from public.communication_delivery_events e
        where e.communication_message_id = m.id
          and e.provider = c_provider
          and e.provider_message_id = m.provider_message_id
          and e.normalized_event_type in ('delivered', 'read')
     )
   order by m.created_at desc
   limit 1;

  if v_proof.id is null then
    -- Distinguish the three failures so an operator learns WHICH proof is
    -- missing, without weakening any of them.
    if not exists (
      select 1 from public.communication_messages m
       where m.provider = c_provider and m.channel = c_channel
         and m.provider_account_id = v_account.id
         and m.template_key = c_template_key
         and m.status in ('delivered', 'read')
         and m.delivered_at is not null
         and m.provider_message_id is not null
         and m.created_at >= now() - c_proof_window
    ) then
      raise exception 'QF_ACTIVATION_NO_RECENT_DELIVERED_MESSAGE' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.communication_messages m
       join public.communication_provider_canary_destinations d
         on d.provider_key = c_provider and d.channel = c_channel
        and d.destination_hash = m.destination_hash
        and d.created_at <= m.created_at and d.expires_at >= m.created_at
       where m.provider = c_provider and m.channel = c_channel
         and m.provider_account_id = v_account.id
         and m.template_key = c_template_key
         and m.status in ('delivered', 'read')
         and m.created_at >= now() - c_proof_window
    ) then
      raise exception 'QF_ACTIVATION_PROOF_NOT_CANARY_BOUND' using errcode = 'P0001';
    end if;
    raise exception 'QF_ACTIVATION_DELIVERY_EVENT_MISSING' using errcode = 'P0001';
  end if;

  select e.normalized_event_type into v_event_type
    from public.communication_delivery_events e
   where e.communication_message_id = v_proof.id
     and e.provider = c_provider
     and e.provider_message_id = v_proof.provider_message_id
     and e.normalized_event_type in ('delivered', 'read')
   order by e.occurred_at desc
   limit 1;

  -- ==== 15. SIGNED, SUCCESSFULLY PROCESSED WEBHOOK PROOF ===================
  -- Bound to the EXACT account, signature-verified, actually processed, carrying
  -- a delivery-class event, inside the same narrow window. An unsigned or
  -- rejected callback proves nothing and is not accepted here.
  if not exists (
    select 1 from public.communication_webhook_receipts w
     where w.provider = c_provider
       and w.provider_account_id = v_account.id
       and w.signature_valid is true
       and w.processing_status = 'processed'
       and w.normalized_event_type in ('delivered', 'read')
       and w.received_at >= now() - c_proof_window
  ) then
    raise exception 'QF_ACTIVATION_SIGNED_WEBHOOK_PROOF_MISSING' using errcode = 'P0001';
  end if;

  -- ==== THE ONLY WRITES ====================================================
  -- 1. Activate ONLY the exact lead_assignment_alert mapping, addressed by the
  --    id resolved above, so no other row can be reached by this statement.
  update public.communication_provider_template_mappings
     set is_active = true, updated_at = now()
   where id = v_mapping.id;

  -- 2. Move ONLY the Meta/WhatsApp runtime policy to normal production. Every
  --    written value is a literal.
  update public.communication_provider_runtime_policies
     set activation_status = 'active',
         outbound_enabled = true,
         webhook_processing_enabled = true,
         health_check_enabled = true,
         updated_at = now()
   where id = v_policy.id
   returning * into v_policy;

  -- Deliberately absent: any canary-destination write, any other mapping write,
  -- any provider-account write, any communication intent/message/event write,
  -- any lead-assignment or credit write, any activation-boundary write.

  -- ==== POSTCONDITIONS — asserted BEFORE return, roll back on any violation ==
  if v_policy.activation_status <> 'active'
     or v_policy.outbound_enabled is not true
     or v_policy.webhook_processing_enabled is not true
     or v_policy.health_check_enabled is not true then
    raise exception 'QF_ACTIVATION_POSTURE_INVARIANT' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_count
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel and is_active;
  if v_count <> 1 then
    raise exception 'QF_ACTIVATION_ACTIVE_MAPPING_COUNT_INVARIANT' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.communication_provider_template_mappings
     where provider_key = c_provider and channel = c_channel and is_active
       and template_key = c_template_key and language = c_language
  ) then
    raise exception 'QF_ACTIVATION_ACTIVE_MAPPING_IDENTITY_INVARIANT' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_count
    from public.communication_provider_canary_destinations
   where provider_key = c_provider and channel = c_channel and is_active;
  if v_count <> 0 then
    raise exception 'QF_ACTIVATION_CANARY_INVARIANT' using errcode = 'P0001';
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
    raise exception 'QF_ACTIVATION_ACCOUNT_READINESS_INVARIANT' using errcode = 'P0001';
  end if;
  v_send_capable := true;

  select count(*)::integer into v_count
    from public.communication_provider_template_mappings
   where provider_key = c_provider and channel = c_channel and is_active;

  return query
  select v_policy.activation_status, v_policy.outbound_enabled,
         v_policy.webhook_processing_enabled, v_policy.health_check_enabled,
         v_count, c_template_key,
         (select count(*)::integer from public.communication_provider_canary_destinations
           where provider_key = c_provider and channel = c_channel and is_active),
         v_proof.status, v_event_type, v_send_capable;
end;
$$;

comment on function public.qf_activate_meta_lead_assignment_v1(text, text, text) is
  'QF-MVP-80.14A. The ONLY authority that can assign activation_status=active, and it can do so for exactly one lane: meta_whatsapp_cloud / whatsapp / lead_assignment_alert / en, all hard-coded. The caller supplies only the account identity to CAS against and an AUDIT-ONLY evidence digest; provider, channel, template, language, posture, flags, mapping id and destination are not parameters. Requires the readiness_only posture, all six durable readiness values, zero active canary destinations, zero pre-existing active mappings, exactly one approved inactive lead_assignment_alert mapping, and DURABLE PROOF of a real recent (24h) delivered/read message on that exact account whose destination was an authorized canary at send time, with a matching delivery event and a signature-verified, successfully processed webhook receipt. Activates one mapping and one policy row; writes no canary destination, no account, and no communication row. Postconditions roll the whole call back unless the resulting posture is exactly active/outbound/webhook/health with exactly one active mapping and zero active canary destinations. Reversed at any time by qf_disable_meta_canary_v1(), which is unconditional and closes an active posture identically to a canary one.';

-- ---------------------------------------------------------------------------
-- 2. Privileges — matched to the 40.13B grant style exactly.
--    Browser roles get NO activation capability, now or ever.
-- ---------------------------------------------------------------------------
revoke all on function public.qf_activate_meta_lead_assignment_v1(text, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.qf_activate_meta_lead_assignment_v1(text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Self-verification
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_sig text := 'public.qf_activate_meta_lead_assignment_v1(text,text,text)';
  v_oid oid;
  v_def text;
  v_count integer;
begin
  -- 3.1 exists, SECURITY DEFINER, pinned search_path, service_role only.
  v_oid := to_regprocedure(v_sig);
  if v_oid is null then
    raise exception 'QF-MVP-80.14A aborted: % is missing.', v_sig;
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = v_oid) then
    raise exception 'QF-MVP-80.14A aborted: % is not SECURITY DEFINER.', v_sig;
  end if;
  if not (
    select array_to_string(coalesce(p.proconfig, array[]::text[]), ',')
             like '%search_path=pg_catalog, public, pg_temp%'
      from pg_proc p where p.oid = v_oid
  ) then
    raise exception 'QF-MVP-80.14A aborted: % lacks the pinned search_path.', v_sig;
  end if;
  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'QF-MVP-80.14A aborted: % granted beyond service_role.', v_sig;
  end if;
  if not has_function_privilege('service_role', v_oid, 'execute') then
    raise exception 'QF-MVP-80.14A aborted: service_role lost execute on %.', v_sig;
  end if;

  select pg_get_functiondef(v_oid) into v_def;

  -- 3.2 the production scope is HARD-CODED, not parameterised.
  if v_def !~ 'c_provider\s+constant\s+text\s*:=\s*''meta_whatsapp_cloud'''
     or v_def !~ 'c_channel\s+constant\s+text\s*:=\s*''whatsapp'''
     or v_def !~ 'c_template_key\s+constant\s+text\s*:=\s*''lead_assignment_alert'''
     or v_def !~ 'c_language\s+constant\s+text\s*:=\s*''en''' then
    raise exception 'QF-MVP-80.14A aborted: the production scope is not hard-coded.';
  end if;
  -- Exactly three parameters, all text, and none of them names a switch.
  if (select p.pronargs from pg_proc p where p.oid = v_oid) <> 3 then
    raise exception 'QF-MVP-80.14A aborted: the signature gained a parameter.';
  end if;
  if v_def ~ 'p_template_key' or v_def ~ 'p_provider' or v_def ~ 'p_channel'
     or v_def ~ 'p_activation_status' or v_def ~ 'p_outbound' or v_def ~ 'p_language'
     or v_def ~ 'p_mapping_id' or v_def ~ 'p_destination' then
    raise exception 'QF-MVP-80.14A aborted: a switch became caller-controlled.';
  end if;

  -- 3.3 every mandatory precondition is present.
  foreach v_sig in array array[
    'QF_ACTIVATION_IDENTITY_MALFORMED', 'QF_ACTIVATION_EVIDENCE_DIGEST_INVALID',
    'QF_ACTIVATION_ACCOUNT_NOT_EXACTLY_ONE', 'QF_ACTIVATION_ACCOUNT_IDENTITY_CONFLICT',
    'QF_ACTIVATION_READINESS_NOT_PROVEN', 'QF_ACTIVATION_POLICY_NOT_IN_READINESS',
    'QF_ACTIVATION_POLICY_ALREADY_SENDING', 'QF_ACTIVATION_POLICY_OBSERVABILITY_OFF',
    'QF_ACTIVATION_ACTIVE_CANARY_PRESENT', 'QF_ACTIVATION_ACTIVE_MAPPING_PRESENT',
    'QF_ACTIVATION_MAPPING_NOT_EXACTLY_ONE', 'QF_ACTIVATION_MAPPING_NOT_APPROVED',
    'QF_ACTIVATION_MAPPING_ALREADY_ACTIVE', 'QF_ACTIVATION_MAPPING_TEMPLATE_NAME_MISSING',
    'QF_ACTIVATION_NO_RECENT_DELIVERED_MESSAGE', 'QF_ACTIVATION_PROOF_NOT_CANARY_BOUND',
    'QF_ACTIVATION_DELIVERY_EVENT_MISSING', 'QF_ACTIVATION_SIGNED_WEBHOOK_PROOF_MISSING',
    'QF_ACTIVATION_POSTURE_INVARIANT', 'QF_ACTIVATION_ACTIVE_MAPPING_COUNT_INVARIANT',
    'QF_ACTIVATION_ACTIVE_MAPPING_IDENTITY_INVARIANT', 'QF_ACTIVATION_CANARY_INVARIANT',
    'QF_ACTIVATION_ACCOUNT_READINESS_INVARIANT'
  ] loop
    if v_def !~ v_sig then
      raise exception 'QF-MVP-80.14A aborted: guard % is missing.', v_sig;
    end if;
  end loop;

  -- 3.4 the six readiness literals are all required.
  if v_def !~ 'readiness_status <> ''provider_ready'''
     or v_def !~ 'configuration_status <> ''complete'''
     or v_def !~ 'business_verification_status <> ''verified'''
     or v_def !~ 'phone_number_status <> ''connected'''
     or v_def !~ 'webhook_status <> ''verified'''
     or v_def !~ 'health_status <> ''healthy''' then
    raise exception 'QF-MVP-80.14A aborted: a provider-readiness precondition is missing.';
  end if;

  -- 3.5 the durable canary proof cannot be removed.
  if v_def !~ 'communication_messages'
     or v_def !~ 'communication_delivery_events'
     or v_def !~ 'communication_webhook_receipts'
     or v_def !~ 'communication_provider_canary_destinations'
     or v_def !~ 'signature_valid is true'
     or v_def !~ 'processing_status = ''processed''' then
    raise exception 'QF-MVP-80.14A aborted: the durable canary proof was weakened.';
  end if;

  -- 3.6 this authority WRITES only the two intended surfaces. Checked as
  --     assignment/DML, not as a mention: the proof clauses legitimately READ
  --     messages, events, receipts and canary destinations.
  if v_def ~ 'insert\s+into\s+public\.communication_provider_canary_destinations'
     or v_def ~ 'update\s+public\.communication_provider_canary_destinations'
     or v_def ~ 'update\s+public\.communication_provider_accounts'
     or v_def ~ 'insert\s+into\s+public\.communication_messages'
     or v_def ~ 'update\s+public\.communication_messages'
     or v_def ~ 'insert\s+into\s+public\.communication_intents'
     or v_def ~ 'update\s+public\.communication_intents'
     or v_def ~ 'update\s+public\.lead_assignments'
     or v_def ~ 'update\s+public\.vendors' then
    raise exception 'QF-MVP-80.14A aborted: the authority writes a surface it must only read.';
  end if;

  -- 3.7 no other template can become active here.
  if v_def ~ 'lead_received' or v_def ~ 'client_lead_status_update'
     or v_def ~ 'client_matching_update' or v_def ~ 'vendor_onboarding_reminder'
     or v_def ~ 'consent_stop_acknowledgement' or v_def ~ 'consent_start_acknowledgement'
     or v_def ~ 'consent_help_response' then
    raise exception 'QF-MVP-80.14A aborted: another template is reachable from this authority.';
  end if;

  -- 3.8 the 40.13B emergency shutdown is intact and can still close `active`.
  --     Its policy write is UNCONDITIONAL (a plain upsert to 'disabled' with no
  --     prior-state guard), so it closes an active posture exactly as it closes
  --     a canary one. It also deactivates every mapping and destination and
  --     returns every account to a non-send-capable state.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qf_disable_meta_canary_v1';
  if v_def is null then
    raise exception 'QF-MVP-80.14A aborted: qf_disable_meta_canary_v1 is missing.';
  end if;
  if v_def !~ 'activation_status\s*=\s*''disabled'''
     or v_def !~ 'outbound_enabled\s*=\s*false'
     or v_def !~ 'QF_CANARY_DISABLE_INCOMPLETE'
     or v_def !~ 'readiness_status\s*=\s*''disabled''' then
    raise exception 'QF-MVP-80.14A aborted: the emergency shutdown was weakened.';
  end if;
  -- It must remain UNCONDITIONAL. Checked two ways, and deliberately NOT by
  -- looking for `<>`: the disable function's own POST-invariant legitimately
  -- writes `activation_status <> 'disabled'`, so a naive inequality probe would
  -- abort on the very guard it is meant to protect.
  --   (a) the policy write is a plain upsert with no prior-state branch, and
  --   (b) none of the arm-time or activation-time prior-state guards appear.
  if v_def !~ 'on conflict \(provider_key, channel\) do update' then
    raise exception
      'QF-MVP-80.14A aborted: the emergency shutdown is no longer an unconditional upsert.';
  end if;
  if v_def ~ 'QF_CANARY_POLICY_NOT_IN_READINESS'
     or v_def ~ 'QF_CANARY_POLICY_ALREADY_SENDING'
     or v_def ~ 'QF_CANARY_READINESS_NOT_PROVEN'
     or v_def ~ 'QF_ACTIVATION_' then
    raise exception
      'QF-MVP-80.14A aborted: the emergency shutdown gained a prior-state precondition.';
  end if;

  -- 3.9 the 40.13B arm functions are untouched and still cannot reach `active`.
  foreach v_sig in array array[
    'qf_arm_meta_provider_readiness_v1', 'qf_arm_meta_canary_v1', 'qf_disable_meta_canary_v1'
  ] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_sig;
    if v_def ~ 'activation_status\s*=\s*''active''' then
      raise exception
        'QF-MVP-80.14A aborted: % gained the ability to assign active.', v_sig;
    end if;
  end loop;

  -- 3.10 nothing was armed by applying this migration.
  select count(*)::integer into v_count
    from public.communication_provider_runtime_policies
   where outbound_enabled or activation_status in ('canary', 'active');
  if v_count <> 0 then
    raise exception 'QF-MVP-80.14A aborted: a sendable runtime policy exists (% rows).', v_count;
  end if;
  select count(*)::integer into v_count
    from public.communication_provider_canary_destinations where is_active;
  if v_count <> 0 then
    raise exception 'QF-MVP-80.14A aborted: an active canary destination exists (% rows).', v_count;
  end if;
  select count(*)::integer into v_count
    from public.communication_provider_template_mappings where is_active;
  if v_count <> 0 then
    raise exception 'QF-MVP-80.14A aborted: an active template mapping exists (% rows).', v_count;
  end if;

  -- 3.11 the switch tables remain RPC-only for writes, as 40.13B left them.
  if has_table_privilege('service_role', 'public.communication_provider_runtime_policies', 'insert')
     or has_table_privilege('service_role', 'public.communication_provider_runtime_policies', 'update')
     or has_table_privilege('service_role', 'public.communication_provider_canary_destinations', 'insert')
     or has_table_privilege('service_role', 'public.communication_provider_canary_destinations', 'update') then
    raise exception
      'QF-MVP-80.14A aborted: a switch table became directly writable by service_role.';
  end if;

  -- 3.12 no network extension, no new trigger on the switch tables.
  if exists (select 1 from pg_extension where extname in ('pg_net', 'http', 'dblink')) then
    raise exception 'QF-MVP-80.14A aborted: database network extension appeared.';
  end if;
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
      'QF-MVP-80.14A aborted: expected 0 user triggers on the switch tables, found %.', v_count;
  end if;
end;
$verify$;

commit;
