-- ============================================================================
-- QF-MVP-40 — CANONICAL EXPLICIT MARKETING CONSENT WRITER
--
-- WHY THIS EXISTS
--   Marketing sending default-denies: services/communicationConsentDecisionService.ts
--   allows a marketing send ONLY on `preference_marketing_opted_in`, which requires an
--   EXACT principal holding an `allowed` marketing preference. Until now no application
--   write path to public.communication_preferences existed anywhere in source — every
--   reference was a read, or an assertion that the table is never written. There was
--   therefore no way to record a real marketing opt-in without a manual database edit,
--   and a manual edit is not an auditable consent record.
--
--   This is consent INFRASTRUCTURE, not a canary bypass. It is the narrow, Core-owned,
--   auditable path by which an EXPLICIT positive marketing opt-in becomes truth.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * It NEVER touches public.communication_suppressions. STOP/START remain suppression
--     semantics owned by apply_communication_consent_command, and START still cannot
--     create marketing consent — this function is not reachable from that path.
--   * It accepts NO 'start' / 'stop' / 'help' action. Only an explicit 'grant' or an
--     explicit 'withdraw'. Consent is never inferred from a conversation, a delivery, a
--     campaign membership, a vendor status or a template approval.
--   * `scope` is NOT a parameter. It is hard-coded 'marketing'. This function can never
--     be repurposed to forge authentication or transactional authority.
--   * It writes no destination, no plaintext phone, no message text and no secret.
--   * It grants nothing to n8n, Jarvis or any provider. Consent truth stays in Core.
--
-- IDEMPOTENCY
--   communication_consent_events.idempotency_key is uniquely fenced. A replay of the same
--   (policy_version, channel, principal, action, source_event_type, source_event_id) tuple
--   produces the SAME digest, inserts no second event, and re-applies the identical
--   preference state — so a redelivered command is a replay, not a second grant.
--
-- APPLYING THIS MIGRATION IS A SEPARATE, AUTHORIZED STEP. It is source only here.
-- ============================================================================

create or replace function public.qf_apply_marketing_consent_v1(
  p_policy_version    text,
  p_channel           text,
  p_principal_type    text,
  p_principal_id      uuid,
  p_action            text,   -- 'grant' | 'withdraw' ONLY
  p_source            text,   -- 'user' | 'admin' ONLY
  p_source_event_type text,
  p_source_event_id   text,
  p_occurred_at       timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state_after   text;
  v_reason        text;
  v_evidence      text;
  v_actor_type    text;
  v_state_before  text;
  v_idempotency   text;
  v_inserted      boolean := false;
  v_pref_id       uuid;
begin
  -- ---- closed input fences. Anything unrecognised is a refusal, never a default. ----
  if p_action is null or p_action not in ('grant', 'withdraw') then
    return jsonb_build_object('ok', false, 'code', 'ACTION_NOT_EXPLICIT');
  end if;
  if p_source is null or p_source not in ('user', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'SOURCE_NOT_PERMITTED');
  end if;
  if p_channel is null or p_channel not in ('whatsapp', 'sms', 'rcs') then
    return jsonb_build_object('ok', false, 'code', 'CHANNEL_INVALID');
  end if;
  -- Marketing authority requires an EXACT principal. An ambiguous or unknown sender has
  -- no marketing authority (see the decision service's *_no_marketing_authority reasons),
  -- so a partial or absent principal pair is refused rather than invented.
  if p_principal_type is null or p_principal_id is null
     or p_principal_type not in ('client', 'vendor') then
    return jsonb_build_object('ok', false, 'code', 'PRINCIPAL_NOT_EXACT');
  end if;
  if p_policy_version is null or p_policy_version !~ '^[A-Za-z0-9._:-]{1,64}$' then
    return jsonb_build_object('ok', false, 'code', 'POLICY_VERSION_INVALID');
  end if;
  if p_source_event_type is null or p_source_event_type !~ '^[A-Za-z0-9._:-]{1,64}$' then
    return jsonb_build_object('ok', false, 'code', 'SOURCE_EVENT_TYPE_INVALID');
  end if;
  if p_source_event_id is null or char_length(p_source_event_id) not between 1 and 200 then
    return jsonb_build_object('ok', false, 'code', 'SOURCE_EVENT_ID_INVALID');
  end if;
  if p_occurred_at is null then
    return jsonb_build_object('ok', false, 'code', 'OCCURRED_AT_REQUIRED');
  end if;

  if p_action = 'grant' then
    v_state_after := 'allowed';
    v_reason      := 'user_grant';
  else
    v_state_after := 'blocked';
    v_reason      := 'user_withdrawal';
  end if;
  if p_source = 'admin' then
    v_actor_type := 'admin';
    v_evidence   := 'admin_action';
  else
    v_actor_type := 'user';
    v_evidence   := 'inbound_command';
  end if;

  -- Opaque, deterministic replay fence over the whole causing tuple.
  v_idempotency := encode(digest(
    'qf.marketing_consent.v1|' || p_policy_version || '|' || p_channel || '|'
      || p_principal_type || '|' || p_principal_id::text || '|' || p_action || '|'
      || p_source_event_type || '|' || p_source_event_id, 'sha256'), 'hex');

  -- ---- lock the preference row so state_before and the write are one transaction ----
  select id, state into v_pref_id, v_state_before
  from public.communication_preferences
  where principal_type = p_principal_type
    and principal_id   = p_principal_id
    and channel        = p_channel
    and scope          = 'marketing'
  for update;

  if v_state_before is null then
    v_state_before := 'absent';
  end if;

  -- ---- immutable evidence first; the unique fence makes a replay a no-op ----
  insert into public.communication_consent_events (
    target_type, principal_type, principal_id, destination_hash, channel, scope,
    action, state_before, state_after, reason, source, evidence_type, policy_version,
    actor_type, actor_id, source_event_type, source_event_id, occurred_at,
    metadata_sanitized, idempotency_key
  ) values (
    'preference', p_principal_type, p_principal_id, null, p_channel, 'marketing',
    p_action, v_state_before, v_state_after, v_reason, p_source, v_evidence,
    p_policy_version, v_actor_type, null, p_source_event_type, p_source_event_id,
    p_occurred_at, '{}'::jsonb, v_idempotency
  )
  on conflict (idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;

  -- ---- preference state. scope is hard-coded; it is never caller-supplied. ----
  insert into public.communication_preferences (
    principal_type, principal_id, channel, scope, state, source,
    consented_at, withdrawn_at
  ) values (
    p_principal_type, p_principal_id, p_channel, 'marketing', v_state_after, p_source,
    case when p_action = 'grant'    then p_occurred_at else null end,
    case when p_action = 'withdraw' then p_occurred_at else null end
  )
  on conflict (principal_type, principal_id, channel, scope) do update
    set state        = excluded.state,
        source       = excluded.source,
        consented_at = case when excluded.state = 'allowed'
                            then coalesce(public.communication_preferences.consented_at, excluded.consented_at)
                            else public.communication_preferences.consented_at end,
        withdrawn_at = case when excluded.state = 'blocked'
                            then coalesce(public.communication_preferences.withdrawn_at, excluded.withdrawn_at)
                            else public.communication_preferences.withdrawn_at end,
        updated_at   = now();

  return jsonb_build_object(
    'ok', true,
    'code', case when v_inserted then 'APPLIED' else 'REPLAYED' end,
    'scope', 'marketing',
    'channel', p_channel,
    'state_before', v_state_before,
    'state_after', v_state_after
  );
end;
$$;

comment on function public.qf_apply_marketing_consent_v1 is
  'QF-MVP-40 canonical EXPLICIT marketing consent writer. Accepts only grant/withdraw for an '
  'exact (client|vendor) principal, hard-codes scope=marketing, writes an immutable idempotent '
  'consent event plus the preference row, and NEVER touches communication_suppressions. START '
  'cannot reach it, so START still never creates marketing consent.';

-- Service-role only. There is no anon/authenticated grant: consent is Core-owned and this
-- function is reachable only from the server-only service layer.
revoke all on function public.qf_apply_marketing_consent_v1(
  text, text, text, uuid, text, text, text, text, timestamptz) from public;
revoke all on function public.qf_apply_marketing_consent_v1(
  text, text, text, uuid, text, text, text, text, timestamptz) from anon;
revoke all on function public.qf_apply_marketing_consent_v1(
  text, text, text, uuid, text, text, text, text, timestamptz) from authenticated;
grant execute on function public.qf_apply_marketing_consent_v1(
  text, text, text, uuid, text, text, text, text, timestamptz) to service_role;
