-- ============================================================================
-- QuickFurno — 20260712000300_communication_consent_command_writer_rpc.sql
-- Phase 5F-D2-D — Controlled Transactional Communication Consent Writer (ADDITIVE)
--
-- WHAT THIS MIGRATION DOES
--   1. Adds public.communication_consent_command_receipts — an additive, service-role-only
--      processing/idempotency RECEIPT (NOT consent truth; NOT a replacement for
--      communication_consent_events or communication_suppressions). It uniquely binds one provider
--      event to its ORIGINAL sanitized scope_results (exact event + suppression ids) for stable replay.
--   2. Adds ONE SECURITY DEFINER function, public.apply_communication_consent_command(...), the SOLE
--      transactional writer for inbound STOP/START. In ONE transaction it: reads the receipt for
--      idempotent replay/conflict; computes EFFECTIVE suppression activity (expiring physically-active
--      rows with immutable system evidence first); appends immutable inbound-command evidence; mutates
--      the communication_suppressions projection; and writes the receipt — all-or-nothing. HELP /
--      unsupported never reach this RPC (no consent-state transition; handled by the TypeScript writer).
--
-- LOCKED POLICY (Phase 5F-D2-D)
--   P1 — STOP/START apply INDEPENDENTLY to 'marketing' + 'transactional' suppression scopes ONLY;
--        never 'global'/'authentication'. OTP stays available unless a separate global suppression blocks.
--   P2 — SUPPRESSION-ONLY. Never reads/writes communication_preferences. START never creates opt-in.
--   P3 — HELP writes no evidence/projection (handled outside this RPC).
--
-- WHAT THIS MIGRATION IS NOT
--   • No change to existing tables/columns/enums/indexes. No DELETE/TRUNCATE. No evidence UPDATE/DELETE.
--   • No dynamic SQL. No trigger. No Meta/provider/n8n call. No send. No route/webhook. No preferences.
--   • The receipt is a processing record; consent truth remains communication_consent_events +
--     communication_suppressions. No parallel consent truth is created.
--
-- ┌────────────────────────────────────────────────────────────────────────────────────────────┐
-- │ MIGRATION-HISTORY DRIFT WARNING — REVIEW-ONLY, DO NOT AUTO-APPLY                              │
-- │ The live communication-consent schema was applied MANUALLY and recent migration files are    │
-- │ NOT registered in supabase_migrations.schema_migrations (known drift). Therefore:            │
-- │   • This file is prepared for REVIEW ONLY and is NOT auto-applied here.                       │
-- │   • Do NOT run `supabase db push`, `supabase migration up`, `migration repair`, or `db reset`.│
-- │   • Eventual application is a REVIEWED, MANUAL, single-transaction step accompanied by an      │
-- │     explicit migration-history reconciliation plan for the drifted registry.                  │
-- │   • `create table if not exists` + `create or replace function` are idempotent + non-destructive.│
-- └────────────────────────────────────────────────────────────────────────────────────────────┘
-- ============================================================================


-- @@ RECEIPT_TABLE_BEGIN
-- ============================================================================
-- SECTION 1 — COMMAND PROCESSING / IDEMPOTENCY RECEIPT (additive, service-role only)
-- ============================================================================
-- One row per accepted provider event. Stores the ORIGINAL sanitized scope_results (exact event +
-- suppression ids) so a redelivery returns the exact historical outcome WITHOUT re-deriving ids from
-- the current/latest suppression row. This is NOT consent truth and is NOT read by any consent decision.
create table if not exists public.communication_consent_command_receipts (
  id                   uuid primary key default gen_random_uuid(),
  provider             text not null check (provider in ('meta_whatsapp', 'exotel_sms', 'system')),
  provider_message_id  text not null check (provider_message_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
  channel              text not null check (channel in ('whatsapp', 'sms', 'rcs')),
  destination_hash     text not null check (destination_hash ~ '^[0-9a-f]{64}$'),
  normalized_command   text not null check (normalized_command in ('stop', 'start')),
  policy_version       text not null check (policy_version ~ '^[A-Za-z0-9._:-]{1,64}$'),
  -- The exact sanitized scope_results returned for this event (2 elements; ids embedded). Bounded.
  scope_results        jsonb not null check (
                         jsonb_typeof(scope_results) = 'array'
                         and jsonb_array_length(scope_results) = 2
                         and octet_length(scope_results::text) <= 4096),
  created_at           timestamptz not null default now(),
  -- Idempotency anchor: one receipt per provider event identity.
  constraint uq_consent_command_receipt unique (provider, provider_message_id, channel)
);

comment on table public.communication_consent_command_receipts is
  'Phase 5F-D2-D: additive service-role-only PROCESSING/IDEMPOTENCY receipt for inbound consent commands. '
  'NOT consent truth and NOT a replacement for communication_consent_events / communication_suppressions. '
  'Uniquely binds (provider, provider_message_id, channel) to the ORIGINAL sanitized scope_results (exact '
  'event + suppression ids) for stable replay. Stores hashed destination only — no plaintext / raw text.';

alter table public.communication_consent_command_receipts enable row level security;
revoke all on table public.communication_consent_command_receipts from public;
revoke all on public.communication_consent_command_receipts from anon;
revoke all on public.communication_consent_command_receipts from authenticated;
revoke all on public.communication_consent_command_receipts from service_role;
grant select, insert on public.communication_consent_command_receipts to service_role;
-- @@ RECEIPT_TABLE_END


-- @@ RPC_BEGIN
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
  p_received_at         text,   -- strict tz-qualified RFC3339 text (server evaluation instant)
  p_correlation_id      text,   -- nullable (bounded identifier)
  p_causation_id        text    -- nullable (bounded identifier)
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  c_expected_policy constant text := 'qf-consent-v1';
  -- STRICT, range-enforcing, timezone-qualified RFC3339 (mirrors the private D2-C contract; D2-C must
  -- stay unchanged so it cannot be imported). Calendar validity is enforced by the cast below.
  c_rfc3339 constant text :=
    '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$';
  -- Bounded identifier fence — EXACTLY matches the TypeScript BOUNDED_ID_SHAPE (no whitespace, no
  -- control characters, no free-form message body).
  c_ident constant text := '^[A-Za-z0-9._:-]{1,200}$';
  c_scopes constant text[] := array['marketing', 'transactional']; -- P1: never 'global'/'authentication'

  v_evaluated_at  timestamptz;   -- effective-activity + mutation instant (the server receipt time)
  v_occurred_at   timestamptz;   -- provider occurrence time (evidence)
  v_scope         text;
  v_r_dest        text;
  v_r_cmd         text;
  v_r_scope       jsonb;
  v_active_id     uuid;
  v_active_reason text;
  v_active_expires timestamptz;
  v_outcome       text;
  v_decisions     jsonb := '[]'::jsonb;
  v_dec           jsonb;
  v_meta          jsonb;
  v_event_id      uuid;
  v_supp_id       uuid;
  v_exp_event_id  uuid;
  v_ikey          text;
  v_scope_results jsonb := '[]'::jsonb;
begin
  -- ── 1. FIXED POLICY VERSION ───────────────────────────────────────────────────────────────
  if p_policy_version is distinct from c_expected_policy then
    return jsonb_build_object('ok', false, 'code', 'UNSUPPORTED_POLICY_VERSION');
  end if;

  -- ── 2. VALIDATE ALL INPUTS (mirrors the TypeScript contract exactly; fail closed) ──────────
  if p_channel is null or p_channel not in ('whatsapp', 'sms', 'rcs')
     or p_command is null or p_command not in ('stop', 'start')
     or p_destination_hash is null or p_destination_hash !~ '^[0-9a-f]{64}$'
     or p_provider is null or p_provider not in ('meta_whatsapp', 'exotel_sms', 'system')
     or p_provider_message_id is null or p_provider_message_id !~ c_ident
     or p_source_event_type is null or p_source_event_type !~ '^[A-Za-z0-9._:-]{1,64}$'
     or p_source_event_id is null or p_source_event_id !~ c_ident
     or p_occurred_at is null or p_occurred_at !~ c_rfc3339
     or p_received_at is null or p_received_at !~ c_rfc3339
     or (p_principal_type is not null and p_principal_type not in ('client', 'vendor', 'admin'))
     or ((p_principal_type is null) <> (p_principal_id is null))
     or (p_correlation_id is not null and p_correlation_id !~ c_ident)
     or (p_causation_id is not null and p_causation_id !~ c_ident)
  then
    return jsonb_build_object('ok', false, 'code', 'INVALID_WRITER_INPUT');
  end if;

  begin
    v_occurred_at := p_occurred_at::timestamptz;         -- calendar validity (rejects Feb 29 non-leap, …)
    v_evaluated_at := p_received_at::timestamptz;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'INVALID_WRITER_INPUT');
  end;

  -- ── 3. LOCKS IN A FIXED ORDER: provider-event identity, THEN destination ───────────────────
  -- The provider-event lock serializes ALL calls sharing one provider event (even with a different
  -- destination or command); the destination lock then serializes same-destination work. Fixed order
  -- (event → destination) prevents deadlock.
  perform pg_advisory_xact_lock(hashtextextended('evt|' || p_provider || '|' || p_provider_message_id || '|' || p_channel, 0));
  perform pg_advisory_xact_lock(hashtextextended('dst|' || p_destination_hash || '|' || p_channel, 0));

  -- ── 4. RECEIPT-BASED REPLAY / CONFLICT (the idempotency authority) ─────────────────────────
  select destination_hash, normalized_command, scope_results
    into v_r_dest, v_r_cmd, v_r_scope
    from public.communication_consent_command_receipts
   where provider = p_provider and provider_message_id = p_provider_message_id and channel = p_channel;
  if found then
    -- Invalid / incomplete stored receipt → integrity violation.
    if v_r_scope is null or jsonb_typeof(v_r_scope) <> 'array' or jsonb_array_length(v_r_scope) <> 2
       or v_r_cmd is null or v_r_dest is null then
      return jsonb_build_object('ok', false, 'code', 'WRITER_INTEGRITY_VIOLATION');
    end if;
    -- Same provider event with a different command OR destination → conflict.
    if v_r_cmd is distinct from p_command or v_r_dest is distinct from p_destination_hash then
      return jsonb_build_object('ok', false, 'code', 'WRITER_CONFLICT');
    end if;
    -- Stable replay: return the EXACT original stored scope_results (never re-derived from current state).
    return jsonb_build_object('ok', true, 'replayed', true, 'scope_results', v_r_scope);
  end if;

  -- ── 5-9. FRESH COMMAND (all-or-nothing) ────────────────────────────────────────────────────
  begin
    v_meta := jsonb_strip_nulls(jsonb_build_object(
      'nc', p_command, 'corr', p_correlation_id, 'caus', p_causation_id, 'rcv', p_received_at));

    -- 5-6. Per scope: lock the physically-active row, EXPIRE it (with system evidence) if past its
    -- expiry, then decide against the EFFECTIVE state.
    foreach v_scope in array c_scopes loop
      select id, reason, expires_at into v_active_id, v_active_reason, v_active_expires
        from public.communication_suppressions
       where destination_hash = p_destination_hash and channel = p_channel
         and scope = v_scope and is_active = true
       for update;

      if found and v_active_expires is not null and v_active_expires <= v_evaluated_at then
        -- Physically-active but EXPIRED → never silently mutate: append an immutable system-action
        -- deactivation event, then deactivate the projection, then treat the scope as having no
        -- effective suppression.
        v_exp_event_id := gen_random_uuid();
        v_ikey := encode(sha256(convert_to(
          p_policy_version || '|suppression|expiry|' || v_active_id::text || '|unsuppress|' || p_channel || '|' || v_scope, 'UTF8')), 'hex');
        insert into public.communication_consent_events (
          id, target_type, principal_type, principal_id, destination_hash, channel, scope,
          action, state_before, state_after, reason, source, evidence_type, policy_version,
          actor_type, actor_id, source_event_type, source_event_id, inbound_message_id,
          provider, provider_message_id, occurred_at, metadata_sanitized, idempotency_key
        ) values (
          v_exp_event_id, 'suppression', null, null, p_destination_hash, p_channel, v_scope,
          'unsuppress', 'active', 'inactive', 'system', 'system', 'system_action', p_policy_version,
          'system', null, 'consent.suppression.expiry', v_active_id::text, null,
          null, null, v_evaluated_at, jsonb_build_object('sys', 'suppression_expiry'), v_ikey
        );
        update public.communication_suppressions
           set is_active = false, deactivated_at = v_evaluated_at, last_event_id = v_exp_event_id, updated_at = now()
         where id = v_active_id;
        v_active_id := null;   -- no effective suppression remains for this scope
      elsif not found then
        v_active_id := null;
      end if;

      if p_command = 'stop' then
        if v_active_id is null then v_outcome := 'suppression_created';
        elsif v_active_reason = 'user_stop' then v_outcome := 'user_stop_already_active';
        else v_outcome := 'stronger_suppression_preserved';
        end if;
      else -- 'start'
        if v_active_id is null then v_outcome := 'no_reversible_user_stop';
        elsif v_active_reason = 'user_stop' then v_outcome := 'user_stop_reversed';
        else v_outcome := 'stronger_suppression_preserved';
        end if;
      end if;

      v_decisions := v_decisions || jsonb_build_object('scope', v_scope, 'outcome', v_outcome, 'active_id', v_active_id);
    end loop;

    -- 7-8. Apply each scope's decision. Evidence inserted FIRST, then the projection references it.
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
          v_evaluated_at, null, null, p_policy_version, v_event_id
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
           set is_active = false, deactivated_at = v_evaluated_at, last_event_id = v_event_id, updated_at = now()
         where id = v_active_id;
        v_scope_results := v_scope_results || jsonb_build_object(
          'scope', v_scope, 'outcome', v_outcome, 'event_id', v_event_id, 'suppression_id', v_active_id);

      else
        -- No-op scope: NO evidence, NO mutation. (suppression_id is the existing effective row, or null.)
        v_scope_results := v_scope_results || jsonb_build_object(
          'scope', v_scope, 'outcome', v_outcome, 'event_id', null, 'suppression_id', v_active_id);
      end if;
    end loop;

    -- 9. Write the processing receipt (same transaction) — the idempotency/replay authority.
    insert into public.communication_consent_command_receipts (
      provider, provider_message_id, channel, destination_hash, normalized_command, policy_version, scope_results
    ) values (
      p_provider, p_provider_message_id, p_channel, p_destination_hash, p_command, p_policy_version, v_scope_results
    );

  exception
    -- A racing duplicate that slipped past the receipt read (same provider event identity) hits the
    -- receipt/evidence unique index → sanitized conflict; the subtransaction rolls back the whole command.
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'WRITER_CONFLICT');
    -- Any other failure propagates: the ENTIRE transaction rolls back (never receipt/evidence/projection
    -- partially applied); the caller maps the error to WRITER_TRANSACTION_FAILED.
  end;

  -- ── 10. SANITIZED RESULT ───────────────────────────────────────────────────────────────────
  return jsonb_build_object('ok', true, 'replayed', false, 'scope_results', v_scope_results);
end;
$fn$;
-- @@ RPC_END

comment on function public.apply_communication_consent_command(
  text, text, text, text, text, uuid, text, text, text, text, uuid, text, text, text, text) is
  'Phase 5F-D2-D: SOLE transactional consent-command writer. Receipt-idempotent, effective-activity aware '
  '(expires physically-active rows with system evidence), fixed-order locked (provider-event then '
  'destination), fail-closed, sanitized. Marketing + transactional scopes only; never global/authentication; '
  'never communication_preferences. Handles STOP/START only; HELP/unsupported never reach it.';

-- Least privilege: only service_role may execute.
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
--   • no change to existing tables/columns/enums/indexes; no DELETE/TRUNCATE; no evidence UPDATE/DELETE
--   • no communication_preferences read or write (suppression-only); no marketing opt-in
--   • no global/authentication suppression; no dynamic SQL; no trigger
--   • no Meta/provider/n8n call; no send; no route/webhook; no env change; not auto-applied
-- ============================================================================
