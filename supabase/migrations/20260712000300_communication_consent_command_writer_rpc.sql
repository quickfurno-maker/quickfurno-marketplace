-- ============================================================================
-- QuickFurno — 20260712000300_communication_consent_command_writer_rpc.sql
-- Phase 5F-D2-D — Controlled Transactional Communication Consent Writer (ADDITIVE, RPC-ONLY)
--
-- WHAT THIS MIGRATION DOES
--   Adds ONE additive SECURITY DEFINER function, public.apply_communication_consent_command(...),
--   the SOLE transactional writer for inbound STOP/START consent commands. In ONE transaction it
--   appends IMMUTABLE evidence to public.communication_consent_events and mutates the authoritative
--   public.communication_suppressions projection ATOMICALLY, with row locking, replay/conflict
--   detection and deterministic ordering. HELP / unsupported never reach this RPC (they cause no
--   consent-state transition and are handled evidence-free by the TypeScript writer).
--
-- LOCKED POLICY (Phase 5F-D2-D)
--   P1 — STOP/START apply INDEPENDENTLY to the 'marketing' and 'transactional' suppression scopes
--        ONLY. This RPC NEVER creates/clears a 'global' suppression and NEVER touches 'authentication'.
--        OTP stays available unless a SEPARATE existing global suppression independently blocks it.
--   P2 — SUPPRESSION-ONLY. This RPC NEVER reads or writes public.communication_preferences — even for
--        an exact principal. START NEVER creates marketing consent. Explicit opt-in is a separate flow.
--   P3 — HELP writes no evidence and no projection (handled outside this RPC).
--
-- WHAT THIS MIGRATION IS NOT
--   • No table/column/enum/index change. No DELETE/TRUNCATE. No evidence UPDATE/DELETE (append-only).
--   • No dynamic SQL. No trigger. No Meta/provider/n8n call. No send. No route/webhook.
--   • It creates NO parallel consent truth — it reuses the D2-B ledger + suppression projection and
--     the D2-C policy version. It does NOT decide final send authorization (consent ≠ delivery).
--
-- ┌────────────────────────────────────────────────────────────────────────────────────────────┐
-- │ MIGRATION-HISTORY DRIFT WARNING — REVIEW-ONLY, DO NOT AUTO-APPLY                              │
-- │ The live communication-consent schema was applied MANUALLY and recent migration files are    │
-- │ NOT registered in supabase_migrations.schema_migrations (known drift). Therefore:            │
-- │   • This file is prepared for REVIEW ONLY and is NOT auto-applied here.                       │
-- │   • Do NOT run `supabase db push`, `supabase migration up`, `migration repair`, or `db reset`.│
-- │   • Eventual application is a REVIEWED, MANUAL, single-transaction step accompanied by an      │
-- │     explicit migration-history reconciliation plan for the drifted registry.                  │
-- │   • `create or replace function` is idempotent and non-destructive; it changes no table/row.  │
-- └────────────────────────────────────────────────────────────────────────────────────────────┘
-- ============================================================================


create or replace function public.apply_communication_consent_command(
  p_policy_version      text,
  p_channel             text,
  p_command             text,   -- 'stop' | 'start' ONLY (help/unsupported never reach the RPC)
  p_destination_hash    text,
  p_principal_type      text,   -- nullable (optional audit linkage; NEVER a preference write)
  p_principal_id        uuid,   -- nullable
  p_provider            text,
  p_provider_message_id text,
  p_source_event_type   text,
  p_source_event_id     text,
  p_inbound_message_id  uuid,   -- nullable
  p_occurred_at         text,   -- strict tz-qualified RFC3339 text (RE-validated here; no cast bypass)
  p_received_at         text,   -- strict tz-qualified RFC3339 text (server receipt)
  p_correlation_id      text,   -- nullable (bounded)
  p_causation_id        text    -- nullable (bounded)
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  -- Fixed policy version fence — mirrors lib/communication/consentPolicy.ts CONSENT_POLICY_VERSION.
  c_expected_policy constant text := 'qf-consent-v1';
  -- STRICT, range-enforcing, timezone-qualified RFC3339 (mandatory T + seconds + Z/±HH:MM, 1-6 frac).
  -- Intentionally a REPEATED contract: the Phase 5F-D2-C parser is private and D2-C must stay
  -- unchanged, so it cannot be reused. Re-validating here stops a direct RPC caller from bypassing
  -- the TypeScript validation via a lenient timestamptz cast. Calendar validity is enforced by the cast.
  c_rfc3339 constant text :=
    '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$';
  c_scopes constant text[] := array['marketing', 'transactional']; -- P1: never 'global'/'authentication'

  v_occurred_at   timestamptz;
  v_scope         text;
  v_n             int;
  v_distinct_nc   int;
  v_distinct_so   int;
  v_evidence_arr  text[];
  v_existing_cmd  text;
  v_existing_so   jsonb;
  v_expected      text[];
  v_actual        text[];
  v_active_id     uuid;
  v_active_reason text;
  v_outcome       text;
  v_decisions     jsonb := '[]'::jsonb;
  v_dec           jsonb;
  v_outcome_map   jsonb := '{}'::jsonb;
  v_meta          jsonb;
  v_event_id      uuid;
  v_supp_id       uuid;
  v_ikey          text;
  v_scope_results jsonb := '[]'::jsonb;
begin
  -- ── 1. FIXED POLICY VERSION ───────────────────────────────────────────────────────────────
  if p_policy_version is distinct from c_expected_policy then
    return jsonb_build_object('ok', false, 'code', 'UNSUPPORTED_POLICY_VERSION');
  end if;

  -- ── 2. VALIDATE ALL INPUTS (fail closed; no DB effect for invalid input) ───────────────────
  if p_channel is null or p_channel not in ('whatsapp', 'sms', 'rcs')
     or p_command is null or p_command not in ('stop', 'start')
     or p_destination_hash is null or p_destination_hash !~ '^[0-9a-f]{64}$'
     or p_provider is null or char_length(p_provider) < 1 or char_length(p_provider) > 64
     or p_provider_message_id is null or char_length(p_provider_message_id) < 1 or char_length(p_provider_message_id) > 200
     or p_source_event_type is null or p_source_event_type !~ '^[A-Za-z0-9._:-]{1,64}$'
     or p_source_event_id is null or char_length(p_source_event_id) < 1 or char_length(p_source_event_id) > 200
     or p_occurred_at is null or p_occurred_at !~ c_rfc3339
     or p_received_at is null or p_received_at !~ c_rfc3339
     or (p_principal_type is not null and p_principal_type not in ('client', 'vendor', 'admin'))
     or ((p_principal_type is null) <> (p_principal_id is null))
     or (p_correlation_id is not null and char_length(p_correlation_id) > 200)
     or (p_causation_id is not null and char_length(p_causation_id) > 200)
  then
    return jsonb_build_object('ok', false, 'code', 'INVALID_WRITER_INPUT');
  end if;

  -- Calendar validity (rejects e.g. 2026-02-29, 2026-04-31 that the range-regex cannot catch).
  begin
    v_occurred_at := p_occurred_at::timestamptz;
    perform p_received_at::timestamptz;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'INVALID_WRITER_INPUT');
  end;

  -- ── 3. DETERMINISTIC SAME-DESTINATION/CHANNEL TRANSACTION LOCK ─────────────────────────────
  -- Serializes concurrent commands for the same destination+channel; auto-released at COMMIT/ROLLBACK.
  perform pg_advisory_xact_lock(hashtextextended(p_destination_hash || '|' || p_channel, 0));

  -- ── 4. COMMAND-LEVEL REPLAY / CONFLICT DETECTION over the (provider, message, channel) group ─
  select count(*),
         count(distinct metadata_sanitized ->> 'nc'),
         count(distinct (metadata_sanitized -> 'so')::text),
         array_agg(scope),
         min(metadata_sanitized ->> 'nc'),
         (array_agg(metadata_sanitized -> 'so'))[1]
    into v_n, v_distinct_nc, v_distinct_so, v_evidence_arr, v_existing_cmd, v_existing_so
    from public.communication_consent_events
   where provider = p_provider
     and provider_message_id = p_provider_message_id
     and channel = p_channel
     and evidence_type = 'inbound_command'
     and target_type = 'suppression';

  if v_n > 0 then
    -- The group must be internally consistent (one command, one scope-outcome map).
    if v_distinct_nc > 1 or v_distinct_so > 1 then
      return jsonb_build_object('ok', false, 'code', 'WRITER_INTEGRITY_VIOLATION');
    end if;
    -- The evidence-producing scopes recorded in the map must EXACTLY match the evidence rows present
    -- (a partially-present group — evidence lost, or an unexpected extra row — is an integrity violation).
    select coalesce(array_agg(key order by key), '{}')
      into v_expected
      from jsonb_each_text(v_existing_so)
     where value in ('suppression_created', 'user_stop_reversed');
    select coalesce(array_agg(distinct e order by e), '{}')
      into v_actual
      from unnest(v_evidence_arr) e;
    if v_expected is distinct from v_actual then
      return jsonb_build_object('ok', false, 'code', 'WRITER_INTEGRITY_VIOLATION');
    end if;
    -- Same provider event, DIFFERENT command → conflict (never accept STOP then START on one event).
    if v_existing_cmd is distinct from p_command then
      return jsonb_build_object('ok', false, 'code', 'WRITER_CONFLICT');
    end if;
    -- Stable replay: rebuild the ORIGINAL scope results from the immutable stored outcome map.
    foreach v_scope in array c_scopes loop
      select id into v_event_id
        from public.communication_consent_events
       where provider = p_provider and provider_message_id = p_provider_message_id
         and channel = p_channel and evidence_type = 'inbound_command'
         and target_type = 'suppression' and scope = v_scope
       limit 1;
      select id into v_supp_id
        from public.communication_suppressions
       where destination_hash = p_destination_hash and channel = p_channel and scope = v_scope
       order by suppressed_at desc, created_at desc
       limit 1;
      v_scope_results := v_scope_results || jsonb_build_object(
        'scope', v_scope, 'outcome', v_existing_so ->> v_scope, 'event_id', v_event_id, 'suppression_id', v_supp_id);
    end loop;
    return jsonb_build_object('ok', true, 'replayed', true, 'scope_results', v_scope_results);
  end if;

  -- ── 5-9. FRESH COMMAND — decide per scope (locked), then write evidence+projection atomically ─
  begin
    -- 5-6. Lock each scope's active suppression row and decide the outcome (deterministic order).
    foreach v_scope in array c_scopes loop
      select id, reason into v_active_id, v_active_reason
        from public.communication_suppressions
       where destination_hash = p_destination_hash and channel = p_channel
         and scope = v_scope and is_active = true
       for update;

      if p_command = 'stop' then
        if not found then
          v_outcome := 'suppression_created';
        elsif v_active_reason = 'user_stop' then
          v_outcome := 'user_stop_already_active';           -- idempotent; preserve, no new evidence
        else
          v_outcome := 'stronger_suppression_preserved';     -- provider_block/complaint/legal/... never weakened
        end if;
      else -- 'start'
        if not found then
          v_outcome := 'no_reversible_user_stop';
        elsif v_active_reason = 'user_stop' then
          v_outcome := 'user_stop_reversed';                 -- START reverses ONLY a user_stop
        else
          v_outcome := 'stronger_suppression_preserved';     -- never clears a stronger suppression
        end if;
      end if;

      v_decisions := v_decisions || jsonb_build_object('scope', v_scope, 'outcome', v_outcome, 'active_id', v_active_id);
      v_outcome_map := v_outcome_map || jsonb_build_object(v_scope, v_outcome);
    end loop;

    -- Complete, immutable, allowlisted evidence metadata — identical on every row of this command
    -- group so replay can recover the full outcome from any one row. Never raw text/phone/payload.
    v_meta := jsonb_strip_nulls(jsonb_build_object(
      'nc', p_command, 'so', v_outcome_map,
      'corr', p_correlation_id, 'caus', p_causation_id, 'rcv', p_received_at));

    -- 7-8. Apply each scope's decision. Evidence is inserted FIRST (immutable), then the projection
    -- references it via last_event_id — both inside this one transaction (all-or-nothing).
    for v_dec in select * from jsonb_array_elements(v_decisions) loop
      v_scope := v_dec ->> 'scope';
      v_outcome := v_dec ->> 'outcome';
      v_active_id := nullif(v_dec ->> 'active_id', '')::uuid;

      if v_outcome = 'suppression_created' then
        v_event_id := gen_random_uuid();
        v_supp_id := gen_random_uuid();
        v_ikey := encode(sha256(convert_to(
          p_policy_version || '|suppression|' || p_provider || '|' || p_provider_message_id
          || '|suppress|' || p_channel || '|' || v_scope, 'UTF8')), 'hex');
        insert into public.communication_consent_events (
          id, target_type, principal_type, principal_id, destination_hash, channel, scope,
          action, state_before, state_after, reason, source, evidence_type, policy_version,
          actor_type, actor_id, source_event_type, source_event_id, inbound_message_id,
          provider, provider_message_id, occurred_at, metadata_sanitized, idempotency_key
        ) values (
          v_event_id, 'suppression', p_principal_type, p_principal_id, p_destination_hash, p_channel, v_scope,
          'suppress', 'absent', 'active', 'user_stop', 'user', 'inbound_command', p_policy_version,
          'user', null, p_source_event_type, p_source_event_id, p_inbound_message_id,
          p_provider, p_provider_message_id, v_occurred_at, v_meta, v_ikey
        );
        insert into public.communication_suppressions (
          id, destination_hash, channel, scope, reason, source, is_active,
          suppressed_at, expires_at, deactivated_at, policy_version, last_event_id
        ) values (
          v_supp_id, p_destination_hash, p_channel, v_scope, 'user_stop', 'user', true,
          now(), null, null, p_policy_version, v_event_id
        );
        v_scope_results := v_scope_results || jsonb_build_object(
          'scope', v_scope, 'outcome', v_outcome, 'event_id', v_event_id, 'suppression_id', v_supp_id);

      elsif v_outcome = 'user_stop_reversed' then
        v_event_id := gen_random_uuid();
        v_ikey := encode(sha256(convert_to(
          p_policy_version || '|suppression|' || p_provider || '|' || p_provider_message_id
          || '|unsuppress|' || p_channel || '|' || v_scope, 'UTF8')), 'hex');
        insert into public.communication_consent_events (
          id, target_type, principal_type, principal_id, destination_hash, channel, scope,
          action, state_before, state_after, reason, source, evidence_type, policy_version,
          actor_type, actor_id, source_event_type, source_event_id, inbound_message_id,
          provider, provider_message_id, occurred_at, metadata_sanitized, idempotency_key
        ) values (
          v_event_id, 'suppression', p_principal_type, p_principal_id, p_destination_hash, p_channel, v_scope,
          'unsuppress', 'active', 'inactive', 'user_start', 'user', 'inbound_command', p_policy_version,
          'user', null, p_source_event_type, p_source_event_id, p_inbound_message_id,
          p_provider, p_provider_message_id, v_occurred_at, v_meta, v_ikey
        );
        update public.communication_suppressions
           set is_active = false, deactivated_at = now(), last_event_id = v_event_id, updated_at = now()
         where id = v_active_id;
        v_scope_results := v_scope_results || jsonb_build_object(
          'scope', v_scope, 'outcome', v_outcome, 'event_id', v_event_id, 'suppression_id', v_active_id);

      else
        -- No-op scope (already-active / stronger-preserved / no-reversible): NO evidence, NO mutation.
        v_scope_results := v_scope_results || jsonb_build_object(
          'scope', v_scope, 'outcome', v_outcome, 'event_id', null, 'suppression_id', v_active_id);
      end if;
    end loop;

  exception
    -- A racing duplicate that slipped past the group check (e.g. an advisory-key hash collision) hits a
    -- unique index → surfaced as a sanitized conflict; the subtransaction rolls back this whole command.
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'WRITER_CONFLICT');
    -- Any other failure propagates: the ENTIRE transaction rolls back (never evidence-without-projection
    -- or one scope committed without the other); the caller maps the error to WRITER_TRANSACTION_FAILED.
  end;

  -- ── 10. SANITIZED RESULT (no rows / raw error / SQLSTATE / hash / text / payload) ──────────
  return jsonb_build_object('ok', true, 'replayed', false, 'scope_results', v_scope_results);
end;
$fn$;

comment on function public.apply_communication_consent_command(
  text, text, text, text, text, uuid, text, text, text, text, uuid, text, text, text, text) is
  'Phase 5F-D2-D: SOLE transactional consent-command writer. Atomically appends immutable evidence to '
  'communication_consent_events and mutates communication_suppressions (marketing + transactional scopes '
  'ONLY; never global/authentication; never communication_preferences). Idempotent, row-locked, '
  'replay/conflict-safe, fail-closed, sanitized. Handles STOP/START only; HELP/unsupported never reach it.';

-- Least privilege: only service_role may execute; no PUBLIC/anon/authenticated execute.
revoke all on function public.apply_communication_consent_command(
  text, text, text, text, text, uuid, text, text, text, text, uuid, text, text, text, text) from public;
revoke all on function public.apply_communication_consent_command(
  text, text, text, text, text, uuid, text, text, text, text, uuid, text, text, text, text) from anon;
revoke all on function public.apply_communication_consent_command(
  text, text, text, text, text, uuid, text, text, text, text, uuid, text, text, text, text) from authenticated;
grant execute on function public.apply_communication_consent_command(
  text, text, text, text, text, uuid, text, text, text, text, uuid, text, text, text, text) to service_role;

-- ============================================================================
-- Deliberately NOT done in Phase 5F-D2-D:
--   • no table/column/enum/index change; no DELETE/TRUNCATE; no evidence UPDATE/DELETE
--   • no communication_preferences read or write (suppression-only); no marketing opt-in
--   • no global/authentication suppression; no dynamic SQL; no trigger
--   • no Meta/provider/n8n call; no send; no route/webhook; no env change; not auto-applied
-- ============================================================================
