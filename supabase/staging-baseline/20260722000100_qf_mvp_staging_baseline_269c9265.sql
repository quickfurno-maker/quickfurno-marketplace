-- ============================================================================
-- QF-MVP-20 STAGING BASELINE — DO NOT APPLY TO PRODUCTION
-- ============================================================================
-- Identity           : qf_mvp_staging_baseline_269c9265
-- Generator          : qf-mvp-20.2b/1
-- Baseline instant   : 2026-07-22T00:00:00Z (fixed; not wall-clock)
-- Source schema      : production public schema (schema-only)
-- Source SHA256      : 269c9265d32a9f85488d76bfcf9dd528bd9b6b915bafb09ebb024a6bde182a2f
-- Production ref      : yqpgcsduqbxulrlzwzap   <-- PROHIBITED apply target
-- Staging ref         : uckafzuochmbvtiodmcl   <-- the ONLY permitted apply target
--
-- * Reconstructs the reviewed current public schema for STAGING only.
-- * Production table DATA is EXCLUDED (schema-only source; zero rows).
-- * Production ownership, grants, and default privileges are NOT reproduced;
--   an explicit least-privilege grant block is appended instead.
-- * The four public/anon assignment RPC blockers are service_role-only here.
-- * This file lives OUTSIDE supabase/migrations INTENTIONALLY so that
--   'supabase db push' can never discover or apply it.
-- * MUST NEVER be applied to production yqpgcsduqbxulrlzwzap.
-- * Applied under one controlled identity (qf_mvp_staging_baseline_269c9265) in QF-MVP-20.2C.
-- ============================================================================

-- Restore-session settings (schema-definition only; functions precede their
-- referenced tables, hence check_function_bodies=false — proven-safe pg_dump order).


-- ---------------------------------------------------------------------------
-- Staging preflight: abort unless the target is an EMPTY QuickFurno-free
-- Supabase project with the managed prerequisites present. No secrets read.
-- ---------------------------------------------------------------------------
DO $qf_preflight$
BEGIN
  IF (SELECT count(*) FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE') > 0 THEN
    RAISE EXCEPTION 'ABORT: public schema already has base tables; baseline expects an EMPTY project.';
  END IF;
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'ABORT: auth.users not found; managed Auth schema is required.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'gen_random_uuid') THEN
    RAISE EXCEPTION 'ABORT: gen_random_uuid() not available; enable it before applying.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'ABORT: managed roles anon/authenticated/service_role must all exist.';
  END IF;
END
$qf_preflight$;


-- ---------------------------------------------------------------------------
-- Reviewed object inventory (QF-MVP-20.2A) reproduced by this baseline:
--   tables=62 functions=39 security_definer=33
--   policies=67 rls_enabled=62 indexes=180
--   primary_keys=62 foreign_keys=69
--   unique_constraints=15 check_constraints=169
--   triggers=0 views=0
-- Removed from source: owner=102 grant=201 revoke=28 default_priv=12 role/session=0
-- search_path injected into 6 SECURITY INVOKER helper(s).
-- ---------------------------------------------------------------------------

-- === Reviewed schema-definition statements (ownership/grants stripped) ===



SET statement_timeout = 0;

SET lock_timeout = 0;

SET idle_in_transaction_session_timeout = 0;

SET client_encoding = 'UTF8';

SET standard_conforming_strings = on;

SELECT pg_catalog.set_config('search_path', '', false);

SET check_function_bodies = false;

SET xmloption = content;

SET client_min_messages = warning;

SET row_security = off;



CREATE SCHEMA IF NOT EXISTS "public";



COMMENT ON SCHEMA "public" IS 'standard public schema';




CREATE OR REPLACE FUNCTION "public"."admin_smart_assign_lead_to_vendors"("p_lead_id" "uuid", "p_vendor_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "p_allow_duplicate" boolean DEFAULT false, "p_total_limit" integer DEFAULT 3) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_lead     public.leads%rowtype;
  v_limit    int;
  v_existing int;
  v_slots    int;
  v_vendor   uuid;
  v_row      public.vendors%rowtype;
  v_has_active_package boolean;
  v_ok       boolean;
  v_assigned uuid[] := '{}';
  v_skipped  uuid[] := '{}';
begin
  -- Hard cap: manual assignment may never exceed 9 vendors for a lead.
  v_limit := least(greatest(coalesce(p_total_limit, 3), 1), 9);

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;

  if coalesce(v_lead.is_duplicate, false) and not p_allow_duplicate then
    raise exception 'DUPLICATE_LEAD' using errcode = 'P0001';
  end if;

  select count(*) into v_existing from public.lead_assignments where lead_id = p_lead_id;
  if v_existing >= v_limit then
    raise exception 'LEAD_ALREADY_ASSIGNED' using errcode = 'P0001';
  end if;

  v_slots := v_limit - v_existing;

  for v_vendor in
    select vendor_id
    from (
      select distinct on (item.vendor_id) item.vendor_id, item.ordinality
      from unnest(coalesce(p_vendor_ids, '{}')) with ordinality as item(vendor_id, ordinality)
      where item.vendor_id is not null
      order by item.vendor_id, item.ordinality
    ) deduped
    order by ordinality
    limit v_slots
  loop
    select * into v_row from public.vendors where id = v_vendor for update;
    if not found then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    select exists (
      select 1 from public.vendor_packages vp
      where vp.vendor_id = v_vendor
        and lower(coalesce(vp.status, '')) in ('active', 'trial')
        and coalesce(vp.remaining_leads, 0) > 0
        and (vp.expiry_date is null or vp.expiry_date > now())
    ) into v_has_active_package;

    v_has_active_package := v_has_active_package
      or lower(coalesce(v_row.package_status, '')) in ('active', 'trial')
      or lower(coalesce(v_row.paid_status, '')) in ('paid', 'trial', 'active', 'premium', 'priority');

    -- HARD marketplace safety (never bypassed). Category + sub-city area are
    -- intentionally omitted (admin override); city stays hard.
    if v_row.status <> 'Approved'
      or coalesce(v_row.is_active, false) is not true
      or coalesce(v_row.remaining_credits, 0) <= 0
      or not v_has_active_package
      or v_row.city is distinct from v_lead.city
    then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    if exists (select 1 from public.lead_assignments where lead_id = p_lead_id and vendor_id = v_vendor) then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    v_ok := public.deduct_vendor_credit(v_vendor);   -- reuse existing primitive
    if not v_ok then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    begin
      insert into public.lead_assignments (lead_id, vendor_id, assignment_type, credit_deducted)
      values (p_lead_id, v_vendor, 'admin_assigned', true);
    exception when unique_violation then
      perform public.restore_vendor_credit(v_vendor);
      v_skipped := v_skipped || v_vendor;
      continue;
    end;

    update public.vendors set last_assigned_at = now() where id = v_vendor;
    v_assigned := v_assigned || v_vendor;
  end loop;

  if coalesce(array_length(v_assigned, 1), 0) > 0 then
    update public.leads set status = 'Assigned' where id = p_lead_id;
  end if;

  return jsonb_build_object(
    'status', case when coalesce(array_length(v_assigned, 1), 0) > 0 then 'ok' else 'no_eligible_vendors' end,
    'lead_id', p_lead_id,
    'assigned', to_jsonb(v_assigned),
    'skipped', to_jsonb(v_skipped),
    'assigned_count', coalesce(array_length(v_assigned, 1), 0)
  );
end;
$$;



CREATE OR REPLACE FUNCTION "public"."apply_communication_consent_command"("p_policy_version" "text", "p_channel" "text", "p_command" "text", "p_destination_hash" "text", "p_principal_type" "text", "p_principal_id" "uuid", "p_provider" "text", "p_provider_message_id" "text", "p_source_event_type" "text", "p_source_event_id" "text", "p_inbound_message_id" "uuid", "p_occurred_at" "text", "p_received_at" "text", "p_correlation_id" "text", "p_causation_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $_$
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
  v_r_policy      text;
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
  -- The FULL replay binding is (provider, provider_message_id, channel) → destination_hash +
  -- normalized_command + POLICY_VERSION + a structurally valid scope_results. A replay is only stable
  -- if EVERY bound field matches; anything else is a conflict or an integrity violation, never a replay.
  select destination_hash, normalized_command, policy_version, scope_results
    into v_r_dest, v_r_cmd, v_r_policy, v_r_scope
    from public.communication_consent_command_receipts
   where provider = p_provider and provider_message_id = p_provider_message_id and channel = p_channel;
  if found then
    -- INTEGRITY (checked FIRST — a malformed receipt is never a comparable/replayable outcome). SQL is
    -- the authority here: it does NOT defer to the TypeScript normalizer. A receipt missing its command,
    -- destination or POLICY VERSION, or whose scope_results are not a 2-item marketing→transactional
    -- array with a closed outcome vocabulary, UUID-or-null ids and outcome/id consistency (duplicate,
    -- wrong-order, malformed or contradictory), is an integrity violation.
    if v_r_cmd is null or v_r_dest is null or v_r_policy is null
       or not public.communication_consent_receipt_results_valid(v_r_scope) then
      return jsonb_build_object('ok', false, 'code', 'WRITER_INTEGRITY_VIOLATION');
    end if;
    -- CONFLICT: the same provider event bound to a different command, destination OR policy version.
    -- (A receipt written under a different policy version is NOT replayable under this one — its stored
    -- outcome was derived by different rules, so silently re-serving it would launder a stale policy.)
    if v_r_cmd is distinct from p_command
       or v_r_dest is distinct from p_destination_hash
       or v_r_policy is distinct from p_policy_version then
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
$_$;



COMMENT ON FUNCTION "public"."apply_communication_consent_command"("p_policy_version" "text", "p_channel" "text", "p_command" "text", "p_destination_hash" "text", "p_principal_type" "text", "p_principal_id" "uuid", "p_provider" "text", "p_provider_message_id" "text", "p_source_event_type" "text", "p_source_event_id" "text", "p_inbound_message_id" "uuid", "p_occurred_at" "text", "p_received_at" "text", "p_correlation_id" "text", "p_causation_id" "text") IS 'Phase 5F-D2-D: SOLE transactional consent-command writer. Receipt-idempotent, effective-activity aware (expires physically-active rows with system evidence), fixed-order locked (provider-event then destination), fail-closed, sanitized. Marketing + transactional scopes only; never global/authentication; never communication_preferences. Handles STOP/START only; HELP/unsupported never reach it.';




CREATE OR REPLACE FUNCTION "public"."assign_client_selected_vendor_to_group"("p_group_id" "uuid", "p_lead_id" "uuid", "p_vendor_id" "uuid", "p_total_limit" integer DEFAULT 3) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_lead     public.leads%rowtype;
  v_row      public.vendors%rowtype;
  v_limit    int;
  v_existing int;
  v_ok       boolean;
begin
  v_limit := least(greatest(coalesce(p_total_limit, 3), 1), 9);

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform 1 from public.client_requirement_groups where id = p_group_id for update;
  if not found then
    raise exception 'REQUIREMENT_GROUP_NOT_FOUND' using errcode = 'P0002';
  end if;

  select count(distinct vendor_id) into v_existing
  from public.lead_assignments where requirement_group_id = p_group_id;
  if v_existing >= v_limit then
    return jsonb_build_object('status', 'group_full', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id, 'assigned_count', v_existing);
  end if;

  select * into v_row from public.vendors where id = p_vendor_id for update;
  if not found then
    return jsonb_build_object('status', 'vendor_not_found', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  -- HARD safety for a client-selected vendor. Credits > 0 is the paid signal;
  -- active-package is intentionally NOT required here.
  if v_row.status <> 'Approved'
    or coalesce(v_row.is_active, false) is not true
    or coalesce(v_row.remaining_credits, 0) <= 0
    or v_row.city is distinct from v_lead.city
  then
    return jsonb_build_object('status', 'vendor_not_eligible', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  if exists (
    select 1 from public.lead_assignments
    where requirement_group_id = p_group_id and vendor_id = p_vendor_id
  ) then
    return jsonb_build_object('status', 'already_in_group', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  if exists (
    select 1 from public.lead_assignments where lead_id = p_lead_id and vendor_id = p_vendor_id
  ) then
    return jsonb_build_object('status', 'already_assigned_to_lead', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  v_ok := public.deduct_vendor_credit(p_vendor_id);   -- reuse existing primitive
  if not v_ok then
    return jsonb_build_object('status', 'credit_deduction_failed', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  begin
    insert into public.lead_assignments (
      lead_id, vendor_id, assignment_type, credit_deducted,
      requirement_group_id, assignment_source, assignment_metadata
    ) values (
      p_lead_id, p_vendor_id, 'client_selected', true,
      p_group_id, 'client_selected_vendor', jsonb_build_object('source', 'client_selected_vendor')
    );
  exception when unique_violation then
    perform public.restore_vendor_credit(p_vendor_id);
    return jsonb_build_object('status', 'duplicate_on_insert', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end;

  update public.vendors set last_assigned_at = now() where id = p_vendor_id;
  update public.leads set status = 'Assigned' where id = p_lead_id;

  perform public.refresh_requirement_group_counters(p_group_id);

  return jsonb_build_object('status', 'ok', 'assigned', true,
    'vendor_id', p_vendor_id, 'group_id', p_group_id, 'assigned_count', v_existing + 1);
end;
$$;



CREATE OR REPLACE FUNCTION "public"."assign_lead_to_paid_vendors_phase26a"("p_lead_id" "uuid", "p_vendor_ids" "uuid"[] DEFAULT '{}'::"uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_lead public.leads%rowtype;
  v_max int;
  v_credit_cost int := 1; -- LEAD_CREDIT_COST (mirror of lib/vendors/vendorEligibility.ts)
  v_vendor uuid;
  v_row public.vendors%rowtype;
  v_assignment_id uuid;
  v_before int;
  v_after int;
  v_category_ok boolean;
  v_assigned jsonb := '[]'::jsonb;
  v_assigned_ids uuid[] := '{}';
  v_skipped uuid[] := '{}';
begin
  -- MAX 3 SUCCESSFUL, never exceeded (respects configured setting, capped at 3).
  v_max := least(public.get_setting_int('max_vendors_per_lead', 3), 3);

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;

  if coalesce(v_lead.is_duplicate, false) then
    return jsonb_build_object('status','skipped_duplicate','lead_id',p_lead_id,'assigned','[]'::jsonb,'skipped','[]'::jsonb,'assigned_count',0);
  end if;

  -- Idempotency: if this lead already has assignments, return them unchanged.
  if exists (select 1 from public.lead_assignments where lead_id = p_lead_id) then
    select coalesce(jsonb_agg(jsonb_build_object('vendor_id', vendor_id, 'assignment_id', id)), '[]'::jsonb)
      into v_assigned from public.lead_assignments where lead_id = p_lead_id;
    select coalesce(array_agg(vendor_id), '{}') into v_assigned_ids from public.lead_assignments where lead_id = p_lead_id;
    return jsonb_build_object('status','already_assigned','lead_id',p_lead_id,'assigned',v_assigned,'skipped','[]'::jsonb,'assigned_count',coalesce(array_length(v_assigned_ids,1),0));
  end if;

  -- Iterate the ENTIRE deduped ranked pool (input order = JS ranking), stopping
  -- after v_max SUCCESSFUL assignments — fill-until-3, not preselect-3.
  for v_vendor in
    select vendor_id
    from (
      select distinct on (item.vendor_id) item.vendor_id, item.ordinality
      from unnest(coalesce(p_vendor_ids, '{}')) with ordinality as item(vendor_id, ordinality)
      where item.vendor_id is not null
      order by item.vendor_id, item.ordinality
    ) deduped
    order by ordinality
  loop
    exit when coalesce(array_length(v_assigned_ids, 1), 0) >= v_max;

    select * into v_row from public.vendors where id = v_vendor for update;
    if not found then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    -- ONE shared parent-group category contract (mirrors the JS matcher).
    v_category_ok := public.qf_lead_vendor_parent_group_compatible(
      v_lead.service_required, v_lead.category, v_lead.subcategory,
      v_row.service_categories, v_row.selected_category, v_row.selected_subcategories
    );

    -- PHASE 4 CANONICAL GATE (identical to evaluateVendorAutomaticLeadEligibility):
    --   approved/active + is_active + accepting_leads + credits >= cost, plus the
    --   matcher's NORMALIZED city + category compatibility. NO package/paid_status.
    if lower(trim(coalesce(v_row.status, ''))) not in ('approved', 'active')
      or coalesce(v_row.is_active, false) is not true
      or coalesce(v_row.accepting_leads, true) is not true
      or coalesce(v_row.remaining_credits, 0) < v_credit_cost
      or public.qf_norm_text(coalesce(nullif(trim(v_row.city), ''), v_row.office_city))
           is distinct from public.qf_norm_text(v_lead.city)
      or not v_category_ok
    then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    v_before := coalesce(v_row.remaining_credits, 0);

    -- Conditional atomic debit — the guard makes two concurrent leads unable to
    -- both consume the same last credit.
    update public.vendors
    set remaining_credits = remaining_credits - v_credit_cost,
        last_assigned_at = now()
    where id = v_vendor and remaining_credits >= v_credit_cost
    returning remaining_credits into v_after;

    if v_after is null then
      v_skipped := v_skipped || v_vendor; -- lost its last credit concurrently
      continue;
    end if;

    begin
      insert into public.lead_assignments (lead_id, vendor_id, assignment_type, credit_deducted)
      values (p_lead_id, v_vendor, 'auto_assigned', true)
      returning id into v_assignment_id;
    exception when unique_violation then
      -- Duplicate assignment race — restore the credit; no ledger row was written.
      update public.vendors set remaining_credits = remaining_credits + v_credit_cost where id = v_vendor;
      v_skipped := v_skipped || v_vendor;
      continue;
    end;

    -- MANDATORY ledger debit, correlated to the assignment. NO catch: if this row
    -- cannot be written the ENTIRE transaction (credit decrement + assignment + lead
    -- status) rolls back. Canonical rule: NO SUCCESSFUL ASSIGNMENT DEBIT WITHOUT A
    -- SUCCESSFUL LEDGER ROW. (Requires 20260706000141 applied first: reference
    -- columns + the change_type constraint that allows 'lead_assignment_debit'.)
    insert into public.vendor_credit_logs (
      vendor_id, change_type, credits_before, credits_delta, credits_after,
      reason, updated_by, reference_type, reference_id
    ) values (
      v_vendor, 'lead_assignment_debit', v_before, -v_credit_cost, v_after,
      'Automatic lead assignment', 'phase4_credit_wallet_matching',
      'lead_assignment', v_assignment_id::text
    );

    v_assigned_ids := v_assigned_ids || v_vendor;
    v_assigned := v_assigned || jsonb_build_array(jsonb_build_object(
      'vendor_id', v_vendor, 'assignment_id', v_assignment_id, 'credits_before', v_before, 'credits_after', v_after
    ));
  end loop;

  if coalesce(array_length(v_assigned_ids, 1), 0) > 0 then
    update public.leads set status = 'Assigned' where id = p_lead_id;
  end if;

  return jsonb_build_object(
    'status', case when coalesce(array_length(v_assigned_ids,1),0) > 0 then 'ok' else 'no_eligible_vendors' end,
    'lead_id', p_lead_id, 'assigned', v_assigned, 'skipped', to_jsonb(v_skipped),
    'assigned_count', coalesce(array_length(v_assigned_ids,1),0)
  );
end;
$$;



CREATE OR REPLACE FUNCTION "public"."assign_lead_to_preferred_vendor"("p_lead_id" "uuid", "p_vendor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_lead          public.leads%rowtype;
  v_vendor        public.vendors%rowtype;
  v_assignment_id uuid;
  v_before        int;
  v_after         int;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    return jsonb_build_object('status', 'lead_not_found', 'assigned', false);
  end if;

  if coalesce(v_lead.is_duplicate, false) then
    return jsonb_build_object('status', 'preferred_vendor_pending', 'assigned', false,
      'reason', 'duplicate_lead', 'vendor_id', p_vendor_id);
  end if;

  select * into v_vendor from public.vendors where id = p_vendor_id for update;
  if not found then
    return jsonb_build_object('status', 'preferred_vendor_not_found', 'assigned', false);
  end if;

  -- Idempotent replay: this exact vendor already on the lead → success, no 2nd debit.
  select id into v_assignment_id
  from public.lead_assignments
  where lead_id = p_lead_id and vendor_id = p_vendor_id
  limit 1;
  if v_assignment_id is not null then
    return jsonb_build_object('status', 'already_assigned', 'assigned', true,
      'assignment_id', v_assignment_id, 'vendor_id', p_vendor_id);
  end if;

  -- ── Direct commercial gate (client-picked): NO package/paid/public_visibility. ──
  -- Authoritative trust = vendors.status normalized to approved/active. Phase 4
  -- REMOVES verification_status as an eligibility gate (it stays audit/display only)
  -- so the automatic and preferred paths agree: many Approved vendors carry
  -- verification_status='Pending', and that must NOT block a client-picked assignment.
  if lower(coalesce(v_vendor.status, '')) not in ('approved', 'active') then
    return jsonb_build_object('status', 'preferred_vendor_not_eligible', 'assigned', false,
      'reason', 'vendor_not_approved_or_active', 'vendor_id', p_vendor_id);
  end if;

  if coalesce(v_vendor.is_active, true) is not true then
    return jsonb_build_object('status', 'preferred_vendor_not_eligible', 'assigned', false,
      'reason', 'vendor_inactive', 'vendor_id', p_vendor_id);
  end if;

  -- PHASE 4: accepting_leads (temporary availability). Default true when null.
  if coalesce(v_vendor.accepting_leads, true) is not true then
    return jsonb_build_object('status', 'preferred_vendor_not_eligible', 'assigned', false,
      'reason', 'not_accepting_leads', 'vendor_id', p_vendor_id);
  end if;

  v_before := coalesce(v_vendor.remaining_credits, 0);
  if v_before < 1 then
    return jsonb_build_object('status', 'preferred_vendor_no_credits', 'assigned', false,
      'vendor_id', p_vendor_id, 'credits_before', v_before);
  end if;

  -- PHASE 4 credit-wallet debit: atomic conditional decrement (NO deduct_vendor_credit,
  -- NO package burn-down). The vendor row is already locked (FOR UPDATE above).
  update public.vendors
  set remaining_credits = remaining_credits - 1,
      last_assigned_at = now()
  where id = p_vendor_id and remaining_credits >= 1
  returning remaining_credits into v_after;
  if v_after is null then
    return jsonb_build_object('status', 'preferred_vendor_no_credits', 'assigned', false,
      'vendor_id', p_vendor_id, 'credits_before', v_before);
  end if;

  begin
    insert into public.lead_assignments (lead_id, vendor_id, assignment_type, credit_deducted)
    values (p_lead_id, p_vendor_id, 'client_selected', true)
    returning id into v_assignment_id;
  exception when unique_violation then
    -- Race before the ledger row: restore the credit we just debited, no ledger written.
    update public.vendors set remaining_credits = remaining_credits + 1 where id = p_vendor_id;
    return jsonb_build_object('status', 'already_assigned', 'assigned', true, 'vendor_id', p_vendor_id);
  end;

  -- MANDATORY ledger (no catch): a failure rolls back the debit + assignment.
  insert into public.vendor_credit_logs (
    vendor_id, change_type, credits_before, credits_delta, credits_after,
    reason, updated_by, reference_type, reference_id
  ) values (
    p_vendor_id, 'lead_assignment_debit', v_before, -1, v_after,
    'Preferred/client-selected lead assignment', 'phase4_credit_wallet_preferred',
    'lead_assignment', v_assignment_id::text
  );

  update public.leads set status = 'Assigned' where id = p_lead_id;

  return jsonb_build_object(
    'status',         'assigned_to_preferred_vendor',
    'assigned',       true,
    'assignment_id',  v_assignment_id,
    'vendor_id',      p_vendor_id,
    'credits_before', v_before,
    'credits_after',  v_after
  );
end; $$;



CREATE OR REPLACE FUNCTION "public"."assign_lead_to_vendors"("p_lead_id" "uuid", "p_selected_vendor_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "p_allow_duplicate" boolean DEFAULT false, "p_selected_type" "text" DEFAULT 'client_selected'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_lead     public.leads%rowtype;
  v_max      int;
  v_target   uuid[] := '{}';
  v_selected uuid[] := '{}';
  v_vendor   uuid;
  v_slots    int;
  v_assigned uuid[] := '{}';
  v_skipped  uuid[] := '{}';
  v_type     text;
  v_before   int;
  v_after    int;
  v_assignment_id uuid;
begin
  -- PHASE 4 hard cap: MAX 3 vendors per lead, never exceeded, even if the DB
  -- setting is misconfigured higher (live currently returns 4). Both the selected-
  -- count guard and the auto-fill below use v_max, so 3 is the true ceiling.
  v_max := least(public.get_setting_int('max_vendors_per_lead', 3), 3);

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;

  if coalesce(array_length(p_selected_vendor_ids, 1), 0) > v_max then
    raise exception 'MAX_VENDORS_EXCEEDED' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.lead_assignments where lead_id = p_lead_id) then
    raise exception 'LEAD_ALREADY_ASSIGNED' using errcode = 'P0001';
  end if;

  if v_lead.is_duplicate and not p_allow_duplicate then
    raise exception 'DUPLICATE_LEAD' using errcode = 'P0001';
  end if;

  -- 1) validate client-selected vendors. PHASE 4 operational eligibility ONLY:
  --    status Approved + is_active + accepting_leads + credits > 0 + city + category.
  --    public_visibility is NOT an assignment gate (it controls public listing only).
  --    Area is a soft/ranking signal (Phase 2), NEVER a hard eligibility filter.
  select coalesce(array_agg(distinct t.vid), '{}')
  into v_selected
  from unnest(p_selected_vendor_ids) as t(vid)
  where exists (
    select 1 from public.vendors v
    where v.id = t.vid
      and v.status = 'Approved' and v.is_active
      and coalesce(v.accepting_leads, true)
      and v.remaining_credits > 0
      and v.city = v_lead.city
      and v_lead.service_required = any(v.service_categories)
  );

  v_target := v_selected;
  if coalesce(array_length(v_target, 1), 0) > v_max then
    v_target := v_target[1:v_max];
  end if;

  -- 2) auto-fill remaining slots. Same PHASE 4 operational eligibility (no
  --    public_visibility, no hard exact-area filter). Area affinity is PRESERVED as
  --    a soft signal in ORDER BY only. Ranking otherwise unchanged.
  v_slots := v_max - coalesce(array_length(v_target, 1), 0);
  if v_slots > 0 then
    v_target := v_target || array(
      select v.id
      from public.vendors v
      where v.status = 'Approved' and v.is_active
        and coalesce(v.accepting_leads, true)
        and v.remaining_credits > 0
        and v.city = v_lead.city
        and v_lead.service_required = any(v.service_categories)
        and not (v.id = any(v_target))
      order by
        -- area affinity: exact-area vendors rank first (soft signal, not a gate)
        (case when v_lead.area is not null and v_lead.area = any(v.areas_covered) then 0 else 1 end),
        (case when v_lead.service_required = any(v.service_categories) then 0 else 1 end),
        (select count(*) from public.lead_assignments la
         where la.vendor_id = v.id and la.assigned_at > now() - interval '30 days') asc,
        v.rating desc,
        v.last_assigned_at asc nulls first,
        v.remaining_credits desc
      limit v_slots
    );
  end if;

  -- 3) assign + debit (per-vendor, atomic within this function)
  foreach v_vendor in array v_target loop
    -- Lock + transactional recheck of the money-safety gate. city/category/
    -- public_visibility were already validated when building v_target above.
    select remaining_credits into v_before
    from public.vendors
    where id = v_vendor
      and status = 'Approved' and is_active and coalesce(accepting_leads, true)
    for update;
    if v_before is null or v_before < 1 then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    -- PHASE 4 credit-wallet debit: atomic conditional decrement (NO deduct_vendor_credit).
    update public.vendors
    set remaining_credits = remaining_credits - 1,
        last_assigned_at = now()
    where id = v_vendor and remaining_credits >= 1
    returning remaining_credits into v_after;
    if v_after is null then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    v_type := case when v_vendor = any(v_selected) then p_selected_type else 'auto_assigned' end;

    begin
      insert into public.lead_assignments (lead_id, vendor_id, assignment_type, credit_deducted)
      values (p_lead_id, v_vendor, v_type, true)
      returning id into v_assignment_id;
    exception when unique_violation then
      -- Race before the ledger row: restore the credit; no ledger written.
      update public.vendors set remaining_credits = remaining_credits + 1 where id = v_vendor;
      v_skipped := v_skipped || v_vendor;
      continue;
    end;

    -- MANDATORY ledger (no catch): a failure rolls back the debit + assignment.
    insert into public.vendor_credit_logs (
      vendor_id, change_type, credits_before, credits_delta, credits_after,
      reason, updated_by, reference_type, reference_id
    ) values (
      v_vendor, 'lead_assignment_debit', v_before, -1, v_after,
      case when v_vendor = any(v_selected) then 'Client-selected lead assignment' else 'Manual/admin lead assignment' end,
      'phase4_credit_wallet_manual', 'lead_assignment', v_assignment_id::text
    );

    insert into public.whatsapp_logs (recipient_type, recipient_id, phone, template_name, message)
    select 'vendor', v_vendor, ve.phone, 'new_lead_vendor',
           format('New %s lead in %s%s. Open your QuickFurno dashboard to view client details.',
                  v_lead.service_required, v_lead.city,
                  coalesce(' (' || v_lead.area || ')', ''))
    from public.vendors ve where ve.id = v_vendor;

    v_assigned := v_assigned || v_vendor;
  end loop;

  if coalesce(array_length(v_assigned, 1), 0) = 0 then
    raise exception 'NO_ELIGIBLE_VENDORS' using errcode = 'P0001';
  end if;

  update public.leads set status = 'Assigned' where id = p_lead_id;

  insert into public.whatsapp_logs (recipient_type, recipient_id, phone, template_name, message)
  values ('client', p_lead_id, v_lead.phone, 'lead_received_client',
          format('Hi %s, your %s enquiry is received. Up to %s verified QuickFurno professionals will contact you shortly.',
                 v_lead.name, v_lead.service_required, coalesce(array_length(v_assigned, 1), 0)));

  return jsonb_build_object(
    'status', 'ok',
    'lead_id', p_lead_id,
    'assigned', to_jsonb(v_assigned),
    'skipped',  to_jsonb(v_skipped),
    'assigned_count', coalesce(array_length(v_assigned, 1), 0)
  );
end; $$;



CREATE OR REPLACE FUNCTION "public"."assign_package_to_vendor"("p_vendor_id" "uuid", "p_package_id" "uuid", "p_payment_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_pkg public.packages%rowtype;
  v_pay public.payments%rowtype;
  v_vp  uuid;
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;

  -- PHASE 4: the payment must belong to THIS vendor and THIS package (a payment id
  -- must never be reused to credit a different vendor or apply a different package).
  if v_pay.vendor_id is distinct from p_vendor_id then
    raise exception 'PAYMENT_VENDOR_MISMATCH' using errcode = 'P0001';
  end if;
  if v_pay.package_id is distinct from p_package_id then
    raise exception 'PAYMENT_PACKAGE_MISMATCH' using errcode = 'P0001';
  end if;

  if v_pay.payment_status <> 'Paid' then raise exception 'PAYMENT_NOT_PAID' using errcode = 'P0001'; end if;

  select * into v_pkg from public.packages where id = p_package_id;
  if not found then raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0002'; end if;

  -- IDEMPOTENCY: if this payment's package_purchase was already applied, return
  -- WITHOUT inserting another vendor_packages row or granting credits again. The
  -- payment row is locked (FOR UPDATE above), so concurrent same-payment calls
  -- serialize here — the second observes the first's ledger row and short-circuits.
  if exists (
    select 1 from public.vendor_credit_logs
    where reference_type = 'package_purchase' and reference_id = p_payment_id::text
  ) then
    return jsonb_build_object('status', 'already_applied', 'vendor_id', p_vendor_id, 'payment_id', p_payment_id, 'credits_added', 0);
  end if;

  insert into public.vendor_packages
    (vendor_id, package_id, expiry_date, total_leads, remaining_leads, price_paid, payment_status, status)
  values
    (p_vendor_id, p_package_id, now() + (v_pkg.validity_days || ' days')::interval,
     v_pkg.lead_count, v_pkg.lead_count, coalesce(v_pay.amount, v_pkg.total_price), 'Paid', 'Active')
  returning id into v_vp;

  -- PHASE 4: idempotent credit grant through the canonical wallet primitive.
  -- Reference = (package_purchase, payment id) → a replayed confirmation grants once.
  perform public.qf_apply_vendor_credit_delta(
    p_vendor_id, v_pkg.lead_count, 'package_purchase',
    format('Package purchase: %s', coalesce(v_pkg.name, '')),
    'package_purchase', p_payment_id::text, 'assign_package_to_vendor', false
  );
  perform public.update_vendor_visibility(p_vendor_id);

  return jsonb_build_object('status', 'ok', 'vendor_package_id', v_vp, 'credits_added', v_pkg.lead_count);
end; $$;



CREATE OR REPLACE FUNCTION "public"."assign_vendor_to_requirement_group"("p_group_id" "uuid", "p_lead_id" "uuid", "p_vendor_id" "uuid", "p_assignment_source" "text" DEFAULT 'auto_fill'::"text", "p_total_limit" integer DEFAULT 3, "p_assignment_type" "text" DEFAULT 'auto_assigned'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_lead     public.leads%rowtype;
  v_row      public.vendors%rowtype;
  v_limit    int;
  v_existing int;
  v_type     text;
  v_has_active_package boolean;
  v_ok       boolean;
begin
  v_limit := least(greatest(coalesce(p_total_limit, 3), 1), 9);
  v_type  := case
               when p_assignment_type in ('client_selected', 'auto_assigned', 'admin_assigned')
               then p_assignment_type else 'auto_assigned'
             end;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform 1 from public.client_requirement_groups where id = p_group_id for update;
  if not found then
    raise exception 'REQUIREMENT_GROUP_NOT_FOUND' using errcode = 'P0002';
  end if;

  select count(distinct vendor_id) into v_existing
  from public.lead_assignments where requirement_group_id = p_group_id;
  if v_existing >= v_limit then
    return jsonb_build_object('status', 'group_full', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id, 'assigned_count', v_existing);
  end if;

  select * into v_row from public.vendors where id = p_vendor_id for update;
  if not found then
    return jsonb_build_object('status', 'vendor_not_found', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  select exists (
    select 1 from public.vendor_packages vp
    where vp.vendor_id = p_vendor_id
      and lower(coalesce(vp.status, '')) in ('active', 'trial')
      and coalesce(vp.remaining_leads, 0) > 0
      and (vp.expiry_date is null or vp.expiry_date > now())
  ) into v_has_active_package;

  v_has_active_package := v_has_active_package
    or lower(coalesce(v_row.package_status, '')) in ('active', 'trial')
    or lower(coalesce(v_row.paid_status, '')) in ('paid', 'trial', 'active', 'premium', 'priority');

  -- HARD marketplace safety — never bypassed.
  if v_row.status <> 'Approved'
    or coalesce(v_row.is_active, false) is not true
    or coalesce(v_row.remaining_credits, 0) <= 0
    or not v_has_active_package
    or v_row.city is distinct from v_lead.city
  then
    return jsonb_build_object('status', 'vendor_not_eligible', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  if exists (
    select 1 from public.lead_assignments
    where requirement_group_id = p_group_id and vendor_id = p_vendor_id
  ) then
    return jsonb_build_object('status', 'already_in_group', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  if exists (
    select 1 from public.lead_assignments where lead_id = p_lead_id and vendor_id = p_vendor_id
  ) then
    return jsonb_build_object('status', 'already_assigned_to_lead', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  v_ok := public.deduct_vendor_credit(p_vendor_id);   -- reuse existing primitive
  if not v_ok then
    return jsonb_build_object('status', 'credit_deduction_failed', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  begin
    insert into public.lead_assignments (
      lead_id, vendor_id, assignment_type, credit_deducted,
      requirement_group_id, assignment_source, assignment_metadata
    ) values (
      p_lead_id, p_vendor_id, v_type, true,
      p_group_id, p_assignment_source, jsonb_build_object('source', p_assignment_source)
    );
  exception when unique_violation then
    perform public.restore_vendor_credit(p_vendor_id);
    return jsonb_build_object('status', 'duplicate_on_insert', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end;

  update public.vendors set last_assigned_at = now() where id = p_vendor_id;
  update public.leads set status = 'Assigned' where id = p_lead_id;

  perform public.refresh_requirement_group_counters(p_group_id);

  return jsonb_build_object('status', 'ok', 'assigned', true,
    'vendor_id', p_vendor_id, 'group_id', p_group_id, 'assigned_count', v_existing + 1);
end;
$$;



CREATE OR REPLACE FUNCTION "public"."check_duplicate_lead"("p_phone" "text", "p_service" "text", "p_city" "text") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select id
  from public.leads
  where phone = p_phone
    and service_required = p_service
    and city = p_city
    and is_duplicate = false
    and created_at > now() - (public.get_setting_int('duplicate_lead_window_days', 30) || ' days')::interval
  order by created_at desc
  limit 1;
$$;



CREATE OR REPLACE FUNCTION "public"."communication_consent_receipt_results_valid"("p_results" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  -- EXPLICIT type guard, NOT boolean evaluation order. jsonb_array_length RAISES on a non-array, and
  -- SQL does NOT guarantee that `and` short-circuits left-to-right (the planner may reorder a cheap
  -- clause ahead of the typeof test), so a `jsonb_typeof(...) = 'array' and jsonb_array_length(...)`
  -- chain could still raise on a JSON object/string/number/boolean. A CASE fixes the evaluation order:
  -- jsonb_array_length is reachable ONLY from inside the 'array' branch. Everything else — SQL NULL
  -- (jsonb_typeof → NULL, matching no WHEN), JSON null, object, string, number, boolean, and an array
  -- whose length is not exactly 2 — returns false rather than raising.
  select coalesce(
    case jsonb_typeof(p_results)
      when 'array' then
        case when jsonb_array_length(p_results) = 2
               then public.communication_consent_receipt_scope_result_valid(p_results -> 0, 'marketing')
                and public.communication_consent_receipt_scope_result_valid(p_results -> 1, 'transactional')
             else false
        end
      else false
    end,
    false)
$$;



COMMENT ON FUNCTION "public"."communication_consent_receipt_results_valid"("p_results" "jsonb") IS 'Phase 5F-D2-D: the SQL definition of a well-formed stored consent-command receipt result — a 2-item array, marketing then transactional, closed outcome vocabulary, UUID-or-null ids, and outcome/id consistency. Enforced as a receipt CHECK constraint (no malformed row can be inserted) AND re-checked defensively by apply_communication_consent_command before any replay. Returns false, never NULL.';




CREATE OR REPLACE FUNCTION "public"."communication_consent_receipt_scope_result_valid"("p_item" "jsonb", "p_scope" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $_$
  -- EXPLICIT type guard FIRST (a CASE, not `and`): every accessor below is evaluated ONLY for a JSON
  -- object. A non-object (SQL NULL, JSON null / array / string / number / boolean) resolves to false
  -- STRUCTURALLY — never by relying on boolean evaluation order.
  select coalesce(
    case jsonb_typeof(p_item)
      when 'object' then
        -- the item is bound POSITIONALLY to its REQUIRED scope (index 0 marketing, index 1 transactional)
        (p_item ->> 'scope') = p_scope
        -- outcome belongs to the CLOSED vocabulary (mirrors ConsentScopeOutcome exactly)
        and (p_item ->> 'outcome') in (
              'suppression_created', 'user_stop_already_active', 'stronger_suppression_preserved',
              'user_stop_reversed', 'no_reversible_user_stop')
        -- both id keys MUST be present and be a JSON string or JSON null (a missing key yields SQL NULL
        -- from `->`, so jsonb_typeof is NULL and the `in` test is NULL → coalesced to false below)
        and jsonb_typeof(p_item -> 'event_id') in ('string', 'null')
        and jsonb_typeof(p_item -> 'suppression_id') in ('string', 'null')
        -- a present id MUST be a canonical UUID string (never an arbitrary/free-form string)
        and (jsonb_typeof(p_item -> 'event_id') = 'null'
             or (p_item ->> 'event_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        and (jsonb_typeof(p_item -> 'suppression_id') = 'null'
             or (p_item ->> 'suppression_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        -- outcome ⟷ id consistency: a contradictory receipt is NOT replayable evidence
        and case p_item ->> 'outcome'
              when 'suppression_created'            then jsonb_typeof(p_item -> 'event_id') = 'string'
                                                     and jsonb_typeof(p_item -> 'suppression_id') = 'string'
              when 'user_stop_reversed'             then jsonb_typeof(p_item -> 'event_id') = 'string'
                                                     and jsonb_typeof(p_item -> 'suppression_id') = 'string'
              when 'user_stop_already_active'       then jsonb_typeof(p_item -> 'event_id') = 'null'
                                                     and jsonb_typeof(p_item -> 'suppression_id') = 'string'
              when 'stronger_suppression_preserved' then jsonb_typeof(p_item -> 'event_id') = 'null'
                                                     and jsonb_typeof(p_item -> 'suppression_id') = 'string'
              when 'no_reversible_user_stop'        then jsonb_typeof(p_item -> 'event_id') = 'null'
                                                     and jsonb_typeof(p_item -> 'suppression_id') = 'null'
              else false
            end
      else false
    end,
    -- inside the object branch a missing key still yields SQL NULL (`->>`), and a NULL is NOT false —
    -- `if not NULL` would fall through — so the whole expression is coalesced to false here.
    false)
$_$;



CREATE OR REPLACE FUNCTION "public"."deduct_vendor_credit"("p_vendor_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_rem int; v_pkg uuid;
begin
  update public.vendors
  set remaining_credits = remaining_credits - 1
  where id = p_vendor_id and remaining_credits > 0
  returning remaining_credits into v_rem;

  if v_rem is null then
    return false;                          -- no credit available
  end if;

  -- FIFO: burn down the soonest-to-expire active package
  select id into v_pkg
  from public.vendor_packages
  where vendor_id = p_vendor_id and status = 'Active' and remaining_leads > 0
    and (expiry_date is null or expiry_date > now())
  order by expiry_date asc nulls last
  for update skip locked
  limit 1;

  if v_pkg is not null then
    update public.vendor_packages
    set remaining_leads = remaining_leads - 1,
        status = case when remaining_leads - 1 <= 0 then 'Consumed' else status end
    where id = v_pkg;
  end if;

  perform public.update_vendor_visibility(p_vendor_id);
  return true;
end; $$;



CREATE OR REPLACE FUNCTION "public"."expire_vendor_packages"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_vendor uuid;
begin
  update public.vendor_packages
  set status = 'Expired'
  where status = 'Active' and expiry_date is not null and expiry_date <= now();

  for v_vendor in select distinct vendor_id from public.vendors loop
    perform public.update_vendor_visibility(v_vendor);
  end loop;
end; $$;



CREATE OR REPLACE FUNCTION "public"."get_public_eligible_vendors"("p_city" "text", "p_area" "text", "p_service" "text") RETURNS TABLE("id" "uuid", "business_name" "text", "city" "text", "areas_covered" "text"[], "service_categories" "text"[], "experience" "text", "portfolio_urls" "text"[], "profile_image_url" "text", "rating" numeric, "completed_projects" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select v.id, v.business_name, v.city, v.areas_covered, v.service_categories,
         v.experience, v.portfolio_urls, v.profile_image_url, v.rating, v.completed_projects
  from public.vendors v
  where v.status = 'Approved'
    and v.is_active = true
    and v.public_visibility = true
    and v.remaining_credits > 0
    and v.city = p_city
    and p_service = any(v.service_categories)
    and (v.covers_full_city or (p_area is not null and p_area = any(v.areas_covered)))
  order by
    (case when p_area is not null and p_area = any(v.areas_covered) then 0 else 1 end),
    v.rating desc,
    v.completed_projects desc,
    random();
$$;



CREATE OR REPLACE FUNCTION "public"."get_setting_int"("p_key" "text", "p_default" integer) RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select (value #>> '{}')::int from public.app_settings where key = p_key), p_default);
$$;



CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone',
    coalesce(new.raw_user_meta_data->>'role', 'vendor')
  )
  on conflict (id) do nothing;
  return new;
end; $$;



CREATE OR REPLACE FUNCTION "public"."increment_vendor_credits"("p_vendor_id" "uuid", "p_credit_count" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.vendors
  set total_credits = total_credits + p_credit_count,
      remaining_credits = remaining_credits + p_credit_count
  where id = p_vendor_id;
  perform public.update_vendor_visibility(p_vendor_id);
end; $$;



CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;



CREATE OR REPLACE FUNCTION "public"."owns_vendor"("p_vendor_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.vendors where id = p_vendor_id and user_id = auth.uid());
$$;



CREATE OR REPLACE FUNCTION "public"."qf_apply_vendor_credit_delta"("p_vendor_id" "uuid", "p_delta" integer, "p_change_type" "text", "p_reason" "text", "p_reference_type" "text" DEFAULT NULL::"text", "p_reference_id" "text" DEFAULT NULL::"text", "p_updated_by" "text" DEFAULT 'system'::"text", "p_allow_negative" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_before int;
  v_after int;
begin
  -- Lock the vendor row FIRST so concurrent same-vendor calls serialize here.
  select coalesce(remaining_credits, 0) into v_before
  from public.vendors
  where id = p_vendor_id
  for update;
  if not found then
    raise exception 'VENDOR_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Idempotency AFTER the lock: a duplicate reference resolves to already_applied
  -- (exactly one mutation for concurrent duplicate invocations).
  if p_reference_id is not null and p_reference_type is not null then
    if exists (
      select 1 from public.vendor_credit_logs
      where reference_type = p_reference_type and reference_id = p_reference_id
    ) then
      return jsonb_build_object('status', 'already_applied', 'vendor_id', p_vendor_id, 'credits_before', v_before, 'credits_after', v_before, 'delta', 0);
    end if;
  end if;

  v_after := v_before + p_delta;

  -- NEVER silently clamp: an insufficient negative mutation fails unless the caller
  -- explicitly opts into a policy-approved adjustment.
  if v_after < 0 and not p_allow_negative then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
  end if;

  update public.vendors
  set remaining_credits = v_after,
      -- total_credits = CUMULATIVE credits ever granted (positive deltas only).
      total_credits = coalesce(total_credits, 0) + greatest(p_delta, 0)
  where id = p_vendor_id;

  insert into public.vendor_credit_logs (
    vendor_id, change_type, credits_before, credits_delta, credits_after,
    reason, updated_by, reference_type, reference_id
  ) values (
    p_vendor_id, p_change_type, v_before, v_after - v_before, v_after,
    p_reason, p_updated_by, p_reference_type, p_reference_id
  );

  return jsonb_build_object('status', 'applied', 'vendor_id', p_vendor_id, 'credits_before', v_before, 'credits_after', v_after, 'delta', v_after - v_before);
end;
$$;



CREATE OR REPLACE FUNCTION "public"."qf_claim_auth_delivery_attempt"("p_auth_flow" "text", "p_auth_action_id" "text", "p_auth_reference_type" "text", "p_auth_reference_id" "text", "p_destination_hash" "text", "p_attempt_number" integer, "p_channel" "text", "p_provider_key" "text", "p_challenge_id" "uuid" DEFAULT NULL::"uuid", "p_auth_user_id" "uuid" DEFAULT NULL::"uuid", "p_decision_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("outcome" "text", "detail" "text", "attempt_id" "uuid", "attempt_number" integer, "channel" "text", "fallback_from_attempt_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
declare
  v_primary  public.authentication_delivery_attempts%rowtype;
  v_existing public.authentication_delivery_attempts%rowtype;
  v_count    integer;
  v_new_id   uuid;
begin
  -- ---- structural validation (independent of the application decision engine) ----
  if p_auth_flow is null or p_auth_flow not in ('client_login_otp', 'vendor_whatsapp_verify', 'vendor_password_reset') then
    return query select 'invalid_request'::text, 'unknown_auth_flow'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;
  -- The AUTHENTICATION ACTION is what an attempt sequence belongs to. It must already be
  -- a derived 64-char lowercase SHA-256 identity: a raw one-time code, a bare MSISDN, an
  -- E.164 number, or a raw webhook id is refused BEFORE any ledger mutation.
  if p_auth_action_id is null or p_auth_action_id !~ '^[0-9a-f]{64}$' then
    return query select 'invalid_request'::text, 'invalid_auth_action_id'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;
  if p_auth_reference_type is null or p_auth_reference_type not in ('verification_challenge', 'auth_user')
     or p_auth_reference_id is null or p_destination_hash is null or p_provider_key is null then
    return query select 'invalid_request'::text, 'missing_reference'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;
  if p_attempt_number is null or p_attempt_number not in (1, 2) then
    return query select 'attempt_limit_reached'::text, 'attempt_number_out_of_range'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;
  if p_attempt_number = 1 and p_channel <> 'whatsapp' then
    return query select 'lineage_mismatch'::text, 'primary_channel_must_be_whatsapp'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;
  if p_attempt_number = 2 and p_channel <> 'sms' then
    return query select 'lineage_mismatch'::text, 'fallback_channel_must_be_sms'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;
  -- SMS possession is not WhatsApp possession: this flow can never reach attempt 2.
  if p_attempt_number = 2 and p_auth_flow = 'vendor_whatsapp_verify' then
    return query select 'whatsapp_verify_fallback_forbidden'::text, 'possession_flow'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;

  -- ---- serialize every claimer for this authentication ACTION -------------------
  -- Transaction-scoped advisory lock, keyed on the ACTION IDENTITY ALONE — never on the
  -- long-lived reference, and deliberately NOT on (auth_flow, auth_action_id).
  --
  -- The conflict detection below treats the action hash as a GLOBAL identity: reusing one
  -- hash under a different flow / reference / destination is `action_identity_conflict`.
  -- A lock namespaced by flow would hand two same-hash/different-flow callers two
  -- DIFFERENT locks, so both could observe an empty ledger and both insert — breaking the
  -- very invariant this function enforces. Locking on the hash alone makes every
  -- same-hash caller serialize, whatever flow they claim.
  --
  -- Nothing legitimate is merged by that: `auth_flow` is already mixed into the
  -- domain-separated SHA-256 derivation (see authenticationActionIdentity.ts), so two
  -- correctly derived actions under different flows never share a hash. Two DISTINCT
  -- login actions by the same auth user take different locks and never collide.
  perform pg_advisory_xact_lock(hashtextextended('qf-auth-action:' || p_auth_action_id, 0));

  select count(*) into v_count
    from public.authentication_delivery_attempts a
   where a.auth_action_id = p_auth_action_id;

  if v_count >= 2 then
    return query select 'attempt_limit_reached'::text, 'two_attempts_already_recorded'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;

  -- =========================== PRIMARY CLAIM (attempt 1) =========================
  if p_attempt_number = 1 then
    -- Any attempt already recorded under this ACTION id, whatever its flow. A replay
    -- that reuses an action id under a different flow / reference / destination is a
    -- lineage error, never idempotency.
    select * into v_existing
      from public.authentication_delivery_attempts a
     where a.auth_action_id = p_auth_action_id
     order by a.attempt_number
     limit 1
     for update;

    if found then
      if v_existing.auth_flow is distinct from p_auth_flow
         or v_existing.auth_reference_type is distinct from p_auth_reference_type
         or v_existing.auth_reference_id is distinct from p_auth_reference_id
         or v_existing.destination_hash is distinct from p_destination_hash then
        return query select 'lineage_mismatch'::text, 'action_identity_conflict'::text,
                            null::uuid, null::integer, null::text, null::uuid;
        return;
      end if;
      return query select 'already_exists'::text, 'primary_already_claimed'::text,
                          v_existing.id, v_existing.attempt_number, v_existing.channel, v_existing.fallback_from_attempt_id;
      return;
    end if;

    insert into public.authentication_delivery_attempts
      (auth_flow, auth_action_id, auth_reference_type, auth_reference_id, challenge_id, auth_user_id,
       destination_hash, attempt_number, channel, provider_key,
       fallback_from_attempt_id, status, outcome_certainty, decision_reason)
    values
      (p_auth_flow, p_auth_action_id, p_auth_reference_type, p_auth_reference_id, p_challenge_id, p_auth_user_id,
       p_destination_hash, 1, 'whatsapp', p_provider_key,
       null, 'requested', 'unknown_outcome', p_decision_reason)
    returning id into v_new_id;

    return query select 'claimed'::text, 'primary_claimed'::text, v_new_id, 1, 'whatsapp'::text, null::uuid;
    return;
  end if;

  -- ========================== FALLBACK CLAIM (attempt 2) =========================
  -- Scoped to the ACTION, not the reference: action B can never fall back from action
  -- A's primary, even when both belong to the same auth user.
  select * into v_primary
    from public.authentication_delivery_attempts a
   where a.auth_action_id = p_auth_action_id
     and a.attempt_number = 1
   limit 1
   for update;

  if not found then
    return query select 'primary_required'::text, 'no_primary_attempt'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;

  -- Lineage: attempt 2 must share the flow, the ACTION, the reference, and the hash.
  if v_primary.auth_flow is distinct from p_auth_flow then
    return query select 'lineage_mismatch'::text, 'auth_flow_mismatch'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;
  if v_primary.auth_action_id is distinct from p_auth_action_id then
    return query select 'lineage_mismatch'::text, 'auth_action_mismatch'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;
  if v_primary.auth_reference_type is distinct from p_auth_reference_type
     or v_primary.auth_reference_id is distinct from p_auth_reference_id then
    return query select 'lineage_mismatch'::text, 'auth_reference_mismatch'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;
  if v_primary.destination_hash is distinct from p_destination_hash then
    return query select 'lineage_mismatch'::text, 'destination_hash_mismatch'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;
  if v_primary.channel <> 'whatsapp' then
    return query select 'lineage_mismatch'::text, 'primary_not_whatsapp'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;

  -- Outcome gates, most specific first. An accepted primary needs no fallback; an
  -- unknown outcome may already have delivered the OTP and must never be duplicated.
  if v_primary.outcome_certainty = 'accepted' then
    return query select 'accepted_primary_blocked'::text, 'primary_accepted'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;
  if v_primary.outcome_certainty = 'unknown_outcome' then
    return query select 'unknown_outcome_blocked'::text, 'primary_outcome_unknown'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;
  if v_primary.outcome_certainty <> 'definitive_failure' then
    return query select 'primary_not_definitive'::text, 'certainty_not_definitive'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;
  if v_primary.status not in ('failed', 'cancelled') then
    return query select 'primary_not_definitive'::text, 'status_not_terminal_failure'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;

  -- Exactly one fallback per ACTION, ever — scoped to the action hash alone, matching
  -- both the advisory lock and uq_auth_delivery_attempt_single_fallback.
  if exists (
    select 1 from public.authentication_delivery_attempts a
     where a.auth_action_id = p_auth_action_id
       and a.attempt_number = 2
  ) then
    return query select 'attempt_limit_reached'::text, 'fallback_already_claimed'::text, null::uuid, null::integer, null::text, null::uuid;
    return;
  end if;

  insert into public.authentication_delivery_attempts
    (auth_flow, auth_action_id, auth_reference_type, auth_reference_id, challenge_id, auth_user_id,
     destination_hash, attempt_number, channel, provider_key,
     fallback_from_attempt_id, status, outcome_certainty, decision_reason)
  values
    (p_auth_flow, p_auth_action_id, p_auth_reference_type, p_auth_reference_id, v_primary.challenge_id, v_primary.auth_user_id,
     p_destination_hash, 2, 'sms', p_provider_key,
     v_primary.id, 'requested', 'unknown_outcome', p_decision_reason)
  returning id into v_new_id;

  return query select 'claimed'::text, 'fallback_claimed'::text, v_new_id, 2, 'sms'::text, v_primary.id;
  return;
end
$_$;


SET default_tablespace = '';


SET default_table_access_method = "heap";



CREATE TABLE IF NOT EXISTS "public"."communication_consent_ack_intents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "consent_command_receipt_id" "uuid",
    "inbound_message_id" "uuid" NOT NULL,
    "ack_type" "text" NOT NULL,
    "command" "text" NOT NULL,
    "authoritative_disposition" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "canonical_provider_message_hash" "text" NOT NULL,
    "destination_hash" "text" NOT NULL,
    "sealed_destination_ciphertext" "text",
    "sealed_destination_nonce" "text",
    "sealed_destination_auth_tag" "text",
    "encryption_key_id" "text",
    "aad_schema_version" integer DEFAULT 1 NOT NULL,
    "received_at" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "locked_by" "text",
    "locked_at" timestamp with time zone,
    "claim_count" integer DEFAULT 0 NOT NULL,
    "provider_attempt_count" integer DEFAULT 0 NOT NULL,
    "terminal_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "provider_account_id" "uuid",
    CONSTRAINT "ck_ack_intent_attempt_requires_dispatch" CHECK ((("provider_attempt_count" = 0) OR ("status" <> ALL (ARRAY['pending'::"text", 'claimed'::"text"])))),
    CONSTRAINT "ck_ack_intent_completed_at_matches_status" CHECK (((("status" = ANY (ARRAY['pending'::"text", 'claimed'::"text", 'dispatching'::"text"])) AND ("completed_at" IS NULL)) OR (("status" = ANY (ARRAY['sent'::"text", 'suppressed'::"text", 'expired'::"text", 'failed'::"text", 'uncertain'::"text"])) AND ("completed_at" IS NOT NULL)))),
    CONSTRAINT "ck_ack_intent_disposition_matches_command" CHECK (((("command" = 'stop'::"text") AND ("authoritative_disposition" = ANY (ARRAY['stop_applied'::"text", 'stop_already_effective'::"text"]))) OR (("command" = 'start'::"text") AND ("authoritative_disposition" = ANY (ARRAY['start_applied'::"text", 'start_partially_applied'::"text", 'start_no_reversible_stop'::"text"]))) OR (("command" = 'help'::"text") AND ("authoritative_disposition" = 'help_acknowledged'::"text")))),
    CONSTRAINT "ck_ack_intent_expiry_after_receipt" CHECK (("expires_at" > "received_at")),
    CONSTRAINT "ck_ack_intent_live_is_sealed" CHECK ((("status" <> ALL (ARRAY['pending'::"text", 'claimed'::"text", 'dispatching'::"text"])) OR ("sealed_destination_ciphertext" IS NOT NULL))),
    CONSTRAINT "ck_ack_intent_receipt_binding" CHECK (((("command" = 'help'::"text") AND ("consent_command_receipt_id" IS NULL)) OR (("command" = ANY (ARRAY['stop'::"text", 'start'::"text"])) AND ("consent_command_receipt_id" IS NOT NULL)))),
    CONSTRAINT "ck_ack_intent_seal_all_or_nothing" CHECK (((("sealed_destination_ciphertext" IS NOT NULL) AND ("sealed_destination_nonce" IS NOT NULL) AND ("sealed_destination_auth_tag" IS NOT NULL) AND ("encryption_key_id" IS NOT NULL)) OR (("sealed_destination_ciphertext" IS NULL) AND ("sealed_destination_nonce" IS NULL) AND ("sealed_destination_auth_tag" IS NULL) AND ("encryption_key_id" IS NULL)))),
    CONSTRAINT "ck_ack_intent_terminal_is_purged" CHECK ((("status" = ANY (ARRAY['pending'::"text", 'claimed'::"text", 'dispatching'::"text"])) OR (("sealed_destination_ciphertext" IS NULL) AND ("sealed_destination_nonce" IS NULL) AND ("sealed_destination_auth_tag" IS NULL) AND ("encryption_key_id" IS NULL)))),
    CONSTRAINT "ck_ack_intent_type_matches_command" CHECK (((("command" = 'stop'::"text") AND ("ack_type" = 'consent_stop_acknowledgement'::"text")) OR (("command" = 'start'::"text") AND ("ack_type" = 'consent_start_acknowledgement'::"text")) OR (("command" = 'help'::"text") AND ("ack_type" = 'consent_help_response'::"text")))),
    CONSTRAINT "communication_consent_ack_in_canonical_provider_message_h_check" CHECK (("canonical_provider_message_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "communication_consent_ack_inten_authoritative_disposition_check" CHECK (("authoritative_disposition" = ANY (ARRAY['stop_applied'::"text", 'stop_already_effective'::"text", 'start_applied'::"text", 'start_partially_applied'::"text", 'start_no_reversible_stop'::"text", 'help_acknowledged'::"text"]))),
    CONSTRAINT "communication_consent_ack_intents_aad_schema_version_check" CHECK (("aad_schema_version" >= 1)),
    CONSTRAINT "communication_consent_ack_intents_ack_type_check" CHECK (("ack_type" = ANY (ARRAY['consent_stop_acknowledgement'::"text", 'consent_start_acknowledgement'::"text", 'consent_help_response'::"text"]))),
    CONSTRAINT "communication_consent_ack_intents_claim_count_check" CHECK (("claim_count" >= 0)),
    CONSTRAINT "communication_consent_ack_intents_command_check" CHECK (("command" = ANY (ARRAY['stop'::"text", 'start'::"text", 'help'::"text"]))),
    CONSTRAINT "communication_consent_ack_intents_destination_hash_check" CHECK (("destination_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "communication_consent_ack_intents_provider_attempt_count_check" CHECK (("provider_attempt_count" = ANY (ARRAY[0, 1]))),
    CONSTRAINT "communication_consent_ack_intents_provider_check" CHECK (("provider" = ANY (ARRAY['meta_whatsapp'::"text", 'exotel_sms'::"text", 'system'::"text"]))),
    CONSTRAINT "communication_consent_ack_intents_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'claimed'::"text", 'dispatching'::"text", 'sent'::"text", 'suppressed'::"text", 'expired'::"text", 'failed'::"text", 'uncertain'::"text"])))
);



COMMENT ON TABLE "public"."communication_consent_ack_intents" IS 'Phase 5F-D4-C: durable, service-role-only acknowledgement intents for inbound consent commands. Replaces the D4-B inline webhook send. Carries a SHORT-LIVED AES-256-GCM sealed destination (never plaintext), purged on every terminal transition. AT MOST ONE provider attempt; an uncertain outcome is terminal and is never automatically resent. Not consent truth: D2-C decides, D2-D writes.';




COMMENT ON COLUMN "public"."communication_consent_ack_intents"."sealed_destination_ciphertext" IS 'AES-256-GCM ciphertext of the canonical E.164 destination, base64url. AAD-bound to this exact intent. NEVER a plaintext phone. Cleared in the same statement as every terminal transition.';




COMMENT ON COLUMN "public"."communication_consent_ack_intents"."provider_attempt_count" IS 'AT MOST ONE. Reserved atomically with claimed -> dispatching. After reservation there is no reclaim and no automatic retry: a timeout, throw or ambiguous result becomes TERMINAL uncertain.';




CREATE OR REPLACE FUNCTION "public"."qf_claim_consent_ack_intents"("p_worker_id" "text", "p_limit" integer DEFAULT 25, "p_stale_lease" interval DEFAULT '00:02:00'::interval) RETURNS SETOF "public"."communication_consent_ack_intents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_limit integer;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'WORKER_ID_REQUIRED' using errcode = 'P0001';
  end if;
  if p_stale_lease is null or p_stale_lease <= interval '0 seconds' or p_stale_lease > interval '1 hour' then
    raise exception 'INVALID_STALE_LEASE' using errcode = 'P0001';
  end if;

  -- Bounded batch: never more than 25, never less than 1.
  v_limit := least(greatest(coalesce(p_limit, 25), 1), 25);

  return query
  update public.communication_consent_ack_intents t
     set status      = 'claimed',
         locked_by   = trim(p_worker_id),
         locked_at   = now(),
         claim_count = t.claim_count + 1,
         updated_at  = now()
   where t.id in (
     select c.id
       from public.communication_consent_ack_intents c
      where c.expires_at > now()
        and c.provider_attempt_count = 0
        and (
              c.status = 'pending'
           or (c.status = 'claimed' and c.locked_at is not null and c.locked_at < now() - p_stale_lease)
        )
      order by c.received_at
      limit v_limit
      for update skip locked
   )
  returning t.*;
end;
$$;



COMMENT ON FUNCTION "public"."qf_claim_consent_ack_intents"("p_worker_id" "text", "p_limit" integer, "p_stale_lease" interval) IS 'Atomically claims up to 25 due acknowledgement intents (FOR UPDATE SKIP LOCKED). Claims pending or STALE claimed rows only while provider_attempt_count = 0. NEVER claims dispatching, attempted, terminal or expired rows. Service-role only.';




CREATE OR REPLACE FUNCTION "public"."qf_expire_consent_ack_intents"("p_limit" integer DEFAULT 100) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_count integer;
begin
  with due as (
    select id
      from public.communication_consent_ack_intents
     where status in ('pending', 'claimed')
       and expires_at <= now()
     order by expires_at
     limit least(greatest(coalesce(p_limit, 100), 1), 500)
     for update skip locked
  )
  update public.communication_consent_ack_intents t
     set status                        = 'expired',
         terminal_code                 = 'expired',
         sealed_destination_ciphertext = null,
         sealed_destination_nonce      = null,
         sealed_destination_auth_tag   = null,
         encryption_key_id             = null,
         locked_by                     = null,
         locked_at                     = null,
         completed_at                  = now(),
         updated_at                    = now()
    from due
   where t.id = due.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;



COMMENT ON FUNCTION "public"."qf_expire_consent_ack_intents"("p_limit" integer) IS 'Terminalizes EXPIRED pending/claimed intents as `expired` and purges the sealed destination. Never touches a dispatching row (its provider attempt is already reserved).';




CREATE OR REPLACE FUNCTION "public"."qf_finalize_auth_delivery_attempt"("p_attempt_id" "uuid", "p_status" "text", "p_outcome_certainty" "text", "p_failure_code" "text" DEFAULT NULL::"text", "p_failure_classification" "text" DEFAULT NULL::"text", "p_communication_message_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("outcome" "text", "detail" "text", "attempt_id" "uuid", "status" "text", "outcome_certainty" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_row public.authentication_delivery_attempts%rowtype;
  v_now timestamptz := now();
begin
  if p_attempt_id is null or p_status is null or p_outcome_certainty is null then
    return query select 'invalid_request'::text, 'missing_argument'::text, null::uuid, null::text, null::text;
    return;
  end if;

  -- The status/certainty matrix. A contradictory pair is refused before any write.
  if not (
       (p_outcome_certainty = 'accepted'           and p_status in ('accepted', 'sent', 'delivered', 'read'))
    or (p_outcome_certainty = 'definitive_failure' and p_status in ('failed', 'cancelled'))
    or (p_outcome_certainty = 'unknown_outcome'    and p_status = 'outcome_unknown')
  ) then
    return query select 'contradictory_state'::text, 'status_certainty_mismatch'::text, null::uuid, null::text, null::text;
    return;
  end if;

  select * into v_row
    from public.authentication_delivery_attempts a
   where a.id = p_attempt_id
   for update;

  if not found then
    return query select 'not_found'::text, 'attempt_not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;

  -- An unknown outcome is PARKED. It is never rewritten — least of all into a
  -- definitive failure that would unlock an SMS fallback.
  if v_row.outcome_certainty = 'unknown_outcome' and v_row.status = 'outcome_unknown' then
    if p_outcome_certainty = 'unknown_outcome' and p_status = 'outcome_unknown' then
      return query select 'no_change'::text, 'already_outcome_unknown'::text, v_row.id, v_row.status, v_row.outcome_certainty;
      return;
    end if;
    return query select 'terminal_outcome_unknown'::text, 'unknown_outcome_is_not_rewritable'::text, v_row.id, v_row.status, v_row.outcome_certainty;
    return;
  end if;

  -- A terminal acceptance never becomes a failure.
  if v_row.outcome_certainty = 'accepted' and p_outcome_certainty <> 'accepted' then
    return query select 'terminal_accepted'::text, 'accepted_cannot_regress'::text, v_row.id, v_row.status, v_row.outcome_certainty;
    return;
  end if;

  -- A proven failure never becomes an acceptance.
  if v_row.outcome_certainty = 'definitive_failure' and p_outcome_certainty <> 'definitive_failure' then
    return query select 'terminal_definitive_failure'::text, 'definitive_failure_cannot_regress'::text, v_row.id, v_row.status, v_row.outcome_certainty;
    return;
  end if;

  -- A ledger message links to exactly one attempt, and is never re-pointed.
  if v_row.communication_message_id is not null
     and p_communication_message_id is not null
     and v_row.communication_message_id <> p_communication_message_id then
    return query select 'lineage_mismatch'::text, 'communication_message_already_linked'::text, v_row.id, v_row.status, v_row.outcome_certainty;
    return;
  end if;

  update public.authentication_delivery_attempts a
     set status                   = p_status,
         outcome_certainty        = p_outcome_certainty,
         failure_code             = coalesce(p_failure_code, a.failure_code),
         failure_classification   = coalesce(p_failure_classification, a.failure_classification),
         communication_message_id = coalesce(a.communication_message_id, p_communication_message_id),
         accepted_at              = case when p_status = 'accepted'  then coalesce(a.accepted_at, v_now)  else a.accepted_at end,
         sent_at                  = case when p_status = 'sent'      then coalesce(a.sent_at, v_now)      else a.sent_at end,
         delivered_at             = case when p_status = 'delivered' then coalesce(a.delivered_at, v_now) else a.delivered_at end,
         failed_at                = case when p_status = 'failed'    then coalesce(a.failed_at, v_now)    else a.failed_at end,
         completed_at             = case when p_status in ('accepted', 'sent', 'delivered', 'read', 'failed', 'cancelled', 'outcome_unknown')
                                         then coalesce(a.completed_at, v_now) else a.completed_at end,
         updated_at               = v_now
   where a.id = p_attempt_id
  returning a.* into v_row;

  return query select 'finalized'::text, 'attempt_finalized'::text, v_row.id, v_row.status, v_row.outcome_certainty;
  return;
end
$$;



CREATE OR REPLACE FUNCTION "public"."qf_lead_vendor_parent_group_compatible"("p_service_required" "text", "p_category" "text", "p_subcategory" "text", "p_vendor_service_categories" "text"[], "p_vendor_selected_category" "text", "p_vendor_selected_subcategories" "text"[]) RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_lead_labels text[] := array_remove(array[
    p_service_required, p_category, p_subcategory
  ], null);
  v_vendor_labels text[] := array_remove(
    coalesce(p_vendor_service_categories, '{}'::text[])
      || coalesce(p_vendor_selected_subcategories, '{}'::text[])
      || array[p_vendor_selected_category],
    null
  );
  v_lead_groups text[];
  v_vendor_groups text[];
begin
  if coalesce(array_length(v_lead_labels, 1), 0) = 0
    or coalesce(array_length(v_vendor_labels, 1), 0) = 0
  then
    return false;
  end if;

  select array_agg(distinct public.qf_parent_category_group(l))
    into v_lead_groups
  from unnest(v_lead_labels) as lead_label(l)
  where public.qf_normalize_category_label(l) is not null;

  select array_agg(distinct public.qf_parent_category_group(v))
    into v_vendor_groups
  from unnest(v_vendor_labels) as vendor_label(v)
  where public.qf_normalize_category_label(v) is not null;

  if coalesce(array_length(v_lead_groups, 1), 0) = 0
    or coalesce(array_length(v_vendor_groups, 1), 0) = 0
  then
    return false;
  end if;

  return exists (
    select 1
    from unnest(v_lead_groups) as lg(g)
    join unnest(v_vendor_groups) as vg(g) using (g)
  );
end;
$$;



CREATE OR REPLACE FUNCTION "public"."qf_norm_text"("p_value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select nullif(lower(trim(coalesce(p_value, ''))), '');
$$;



CREATE OR REPLACE FUNCTION "public"."qf_normalize_category_label"("p_value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select nullif(
    regexp_replace(
      replace(lower(trim(coalesce(p_value, ''))), '&', ' and '),
      '\s+', ' ', 'g'
    ),
    ''
  );
$$;



CREATE OR REPLACE FUNCTION "public"."qf_parent_category_group"("p_value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select coalesce(
    (
      select group_name
      from (
        values
          ('Interior', array[
            'full home interior','home interior','interiors','interior','interior design',
            'interior designers','interior designer','premium interiors','premium interior',
            'premium interior design','luxury interior','carpenters','carpenter','carpentry',
            'custom furniture','furniture','woodwork','wood work','furniture work','modular factory',
            'modular kitchen','kitchen','modular furniture','factory made furniture',
            'machine finish furniture','wardrobe','false ceiling','turnkey interior',
            'complete interior','kitchen carpenter'
          ]::text[]),
          ('Sofa', array[
            'sofa','sofa maker','sofa makers','upholstery','sofa repair','sofa cleaning',
            'recliner','custom sofa and upholstery'
          ]::text[]),
          ('Painting', array[
            'painter','painting','paint','wall painting','texture painting'
          ]::text[]),
          ('Civil Work', array[
            'civil work','civil','renovation','home renovation','masonry','tiling','tile work',
            'pop','plumbing civil','plumbing','waterproofing'
          ]::text[])
      ) as groups(group_name, labels)
      where public.qf_normalize_category_label(p_value) = any (
        select public.qf_normalize_category_label(l) from unnest(labels) as label(l)
      )
      limit 1
    ),
    -- Unmapped category keeps its own stable group (the normalized label).
    public.qf_normalize_category_label(p_value)
  );
$$;



CREATE OR REPLACE FUNCTION "public"."qf_recover_stale_dispatching_consent_ack_intents"("p_stale_after" interval DEFAULT '00:03:00'::interval, "p_limit" integer DEFAULT 100) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_count integer;
begin
  -- THE SAFETY FLOOR. The application's provider timeout is 60s and the reviewed safety margin is 60s, so
  -- the invariant is STRICT:
  --
  --     recovery threshold  >  provider timeout (60s) + safety margin (60s)   â‡’   > 120 seconds
  --
  -- 120 seconds is therefore NOT safe: at exactly the boundary, recovery could terminalize an attempt a
  -- worker is still legitimately awaiting. Hence `<=`, not `<`. An unsafe threshold cannot be selected â€”
  -- not by accident, and not even by a service-role caller.
  if p_stale_after is null
     or p_stale_after <= interval '120 seconds'
     or p_stale_after > interval '1 hour' then
    raise exception 'UNSAFE_RECOVERY_THRESHOLD' using errcode = 'P0001';
  end if;

  with stuck as (
    select id
      from public.communication_consent_ack_intents
     where status = 'dispatching'
       -- EXPLICIT. A dispatching row should always carry a reserved attempt, but this must not be left to
       -- an implication of the status: only a row whose SINGLE provider attempt was actually reserved may be
       -- recovered as `uncertain`. Anything else is not an ambiguous provider outcome.
       and provider_attempt_count = 1
       and locked_at is not null
       and locked_at < now() - p_stale_after
     order by locked_at
     limit least(greatest(coalesce(p_limit, 100), 1), 500)
     for update skip locked
  )
  update public.communication_consent_ack_intents t
     set status                        = 'uncertain',
         terminal_code                 = 'worker_crashed_after_attempt_reserved',
         sealed_destination_ciphertext = null,
         sealed_destination_nonce      = null,
         sealed_destination_auth_tag   = null,
         encryption_key_id             = null,
         locked_by                     = null,
         locked_at                     = null,
         completed_at                  = now(),
         updated_at                    = now()
    from stuck
   where t.id = stuck.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;



COMMENT ON FUNCTION "public"."qf_recover_stale_dispatching_consent_ack_intents"("p_stale_after" interval, "p_limit" integer) IS 'Recovers STALE dispatching intents to TERMINAL `uncertain` (never back to pending/claimed, never resent) and purges the sealed destination. The provider outcome is unknown, so at-most-once is preserved by refusing to try again.';




CREATE OR REPLACE FUNCTION "public"."qf_reserve_consent_ack_provider_attempt"("p_intent_id" "text", "p_worker_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_updated integer;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'WORKER_ID_REQUIRED' using errcode = 'P0001';
  end if;

  update public.communication_consent_ack_intents
     set status                 = 'dispatching',
         provider_attempt_count = 1,
         updated_at             = now()
   where id                     = p_intent_id::uuid
     and status                 = 'claimed'          -- compare-and-set on the exact prior state
     and locked_by              = trim(p_worker_id)  -- only the lease owner
     and provider_attempt_count = 0                  -- at most one attempt, ever
     and expires_at             > now();             -- never reserve an expired intent

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;



COMMENT ON FUNCTION "public"."qf_reserve_consent_ack_provider_attempt"("p_intent_id" "text", "p_worker_id" "text") IS 'Compare-and-set reservation of THE single provider attempt: claimed -> dispatching and provider_attempt_count 0 -> 1, for the lease owner only. Returns false if another worker won, the lease moved, the attempt was already reserved, or the intent expired. The provider must not be called on false.';




CREATE OR REPLACE FUNCTION "public"."qf_terminalize_consent_ack_intent"("p_intent_id" "text", "p_status" "text", "p_terminal_code" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_updated integer;
begin
  if p_status is null or p_status not in ('sent', 'suppressed', 'expired', 'failed', 'uncertain') then
    raise exception 'INVALID_TERMINAL_STATUS' using errcode = 'P0001';
  end if;

  update public.communication_consent_ack_intents
     set status                        = p_status,
         terminal_code                 = left(coalesce(p_terminal_code, p_status), 64),
         -- PURGE. Same statement, always.
         sealed_destination_ciphertext = null,
         sealed_destination_nonce      = null,
         sealed_destination_auth_tag   = null,
         encryption_key_id             = null,
         locked_by                     = null,
         locked_at                     = null,
         completed_at                  = now(),
         updated_at                    = now()
   where id     = p_intent_id::uuid
     and status in ('pending', 'claimed', 'dispatching');   -- terminal rows are immutable

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;



COMMENT ON FUNCTION "public"."qf_terminalize_consent_ack_intent"("p_intent_id" "text", "p_status" "text", "p_terminal_code" "text") IS 'Terminalizes an intent and PURGES every sealed-destination field in the SAME statement. Terminal rows are immutable. Service-role only.';




CREATE OR REPLACE FUNCTION "public"."refresh_requirement_group_counters"("p_group_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_total    int;
  v_client   int;
  v_auto     int;
  v_manual   int;
  v_primary  int;
  v_recovery int;
begin
  select count(distinct vendor_id) into v_total
  from public.lead_assignments where requirement_group_id = p_group_id;

  select count(distinct vendor_id) into v_client
  from public.lead_assignments
  where requirement_group_id = p_group_id and assignment_source = 'client_selected_vendor';

  select count(distinct vendor_id) into v_auto
  from public.lead_assignments
  where requirement_group_id = p_group_id and assignment_source in ('auto_fill', 'auto_assigned');

  v_manual   := greatest(coalesce(v_total, 0) - coalesce(v_client, 0) - coalesce(v_auto, 0), 0);
  v_primary  := least(coalesce(v_total, 0), 3);
  v_recovery := greatest(coalesce(v_total, 0) - 3, 0);

  update public.client_requirement_groups set
    total_assigned_count         = coalesce(v_total, 0),
    client_selected_vendor_count = coalesce(v_client, 0),
    auto_assigned_vendor_count   = coalesce(v_auto, 0),
    manual_assigned_vendor_count = v_manual,
    primary_assigned_count       = v_primary,
    recovery_assigned_count      = v_recovery,
    pending_primary_slots        = greatest(3 - v_primary, 0),
    updated_at                   = now()
  where id = p_group_id;
end;
$$;



CREATE OR REPLACE FUNCTION "public"."restore_vendor_credit"("p_vendor_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_pkg uuid;
begin
  update public.vendors set remaining_credits = remaining_credits + 1 where id = p_vendor_id;

  select id into v_pkg
  from public.vendor_packages
  where vendor_id = p_vendor_id and status in ('Active','Consumed')
  order by expiry_date desc nulls last
  limit 1;

  if v_pkg is not null then
    update public.vendor_packages
    set remaining_leads = remaining_leads + 1,
        status = case when status = 'Consumed' then 'Active' else status end
    where id = v_pkg;
  end if;

  perform public.update_vendor_visibility(p_vendor_id);
end; $$;



CREATE OR REPLACE FUNCTION "public"."update_vendor_visibility"("p_vendor_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_ok boolean;
begin
  select (
    v.status = 'Approved'
    and v.is_active
    and v.remaining_credits > 0
    and exists (
      select 1 from public.vendor_packages vp
      where vp.vendor_id = v.id
        and vp.status = 'Active'
        and (vp.expiry_date is null or vp.expiry_date > now())
    )
  )
  into v_ok
  from public.vendors v
  where v.id = p_vendor_id;

  update public.vendors set public_visibility = coalesce(v_ok, false) where id = p_vendor_id;
end; $$;



CREATE OR REPLACE FUNCTION "public"."vendor_auth_claim_reset_grant"("p_grant_token_hash" "text") RETURNS TABLE("grant_id" "uuid", "user_id" "uuid", "vendor_id" "uuid", "vendor_dashboard_user_id" "uuid", "challenge_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_now timestamptz := now();
begin
  return query
  update public.password_reset_grants g
     set consumed_at = v_now
   where g.grant_token_hash = p_grant_token_hash
     and g.consumed_at is null
     and g.revoked_at is null
     and g.expires_at > v_now
  returning g.id, g.user_id, g.vendor_id, g.vendor_dashboard_user_id, g.challenge_id;
end
$$;



CREATE OR REPLACE FUNCTION "public"."vendor_auth_consume_reset_challenge_and_issue_grant"("p_challenge_id" "uuid", "p_vendor_dashboard_user_id" "uuid", "p_user_id" "uuid", "p_vendor_id" "uuid", "p_grant_token_hash" "text") RETURNS TABLE("grant_id" "uuid", "user_id" "uuid", "vendor_id" "uuid", "vendor_dashboard_user_id" "uuid", "expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  -- Authoritative reset-grant lifetime. Not caller-controllable.
  c_reset_grant_ttl constant interval := interval '10 minutes';
  v_now             timestamptz := now();
  v_grant_expires_at timestamptz := now() + c_reset_grant_ttl;
  v_consumed        uuid;
  v_grant           uuid;
begin
  update public.verification_challenges c
     set status      = 'consumed',
         verified_at = v_now,
         consumed_at = v_now
   where c.id = p_challenge_id
     and c.purpose is not distinct from 'vendor_password_reset'
     and c.status = 'pending'
     and c.expires_at > v_now
     and c.vendor_dashboard_user_id is not distinct from p_vendor_dashboard_user_id
     and c.user_id is not distinct from p_user_id
     and c.vendor_id is not distinct from p_vendor_id
  returning c.id into v_consumed;

  -- Exactly one concurrent verification can win the CAS, so exactly one grant is
  -- ever issued for a challenge.
  if v_consumed is null then
    return;
  end if;

  -- Older open grants (including already-expired ones) are revoked, never reused.
  update public.password_reset_grants g
     set revoked_at = v_now
   where g.user_id = p_user_id
     and g.consumed_at is null
     and g.revoked_at is null;

  -- uq_password_reset_grants_one_open is the final authority: if a racing writer
  -- somehow left an open grant standing, this insert raises rather than producing
  -- two usable reset tokens. The expires_at is database-owned (now() + TTL).
  insert into public.password_reset_grants
    (vendor_id, user_id, vendor_dashboard_user_id, challenge_id, grant_token_hash, expires_at)
  values
    (p_vendor_id, p_user_id, p_vendor_dashboard_user_id, p_challenge_id, p_grant_token_hash, v_grant_expires_at)
  returning id into v_grant;

  return query select v_grant, p_user_id, p_vendor_id, p_vendor_dashboard_user_id, v_grant_expires_at;
end
$$;



CREATE OR REPLACE FUNCTION "public"."vendor_auth_consume_whatsapp_challenge"("p_challenge_id" "uuid", "p_vendor_dashboard_user_id" "uuid", "p_user_id" "uuid", "p_vendor_id" "uuid", "p_phone_e164" "text", "p_destination_hash" "text") RETURNS TABLE("vendor_dashboard_user_id" "uuid", "vendor_id" "uuid", "user_id" "uuid", "phone_e164" "text", "phone_verified" boolean, "whatsapp_otp_enabled" boolean, "whatsapp_verified_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_now      timestamptz := now();
  v_consumed uuid;
begin
  -- 1) Compare-and-swap the challenge. Purpose, pending status, expiry, and the
  --    full ownership triple are all part of the WHERE — never re-checked later.
  update public.verification_challenges c
     set status      = 'consumed',
         verified_at = v_now,
         consumed_at = v_now
   where c.id = p_challenge_id
     and c.purpose is not distinct from 'vendor_whatsapp_verify'
     and c.status = 'pending'
     and c.expires_at > v_now
     and c.vendor_dashboard_user_id is not distinct from p_vendor_dashboard_user_id
     and c.user_id is not distinct from p_user_id
     and c.vendor_id is not distinct from p_vendor_id
     and c.destination_hash is not distinct from p_destination_hash
  returning c.id into v_consumed;

  -- Already consumed / locked / expired / cancelled / not ours: bind nothing.
  if v_consumed is null then
    return;
  end if;

  -- 2) Bind the verified WhatsApp identity. Only these columns change: role,
  --    status, email, phone, last_login_* and every other membership field are
  --    preserved untouched.
  begin
    return query
    update public.vendor_dashboard_users d
       set phone_e164           = p_phone_e164,
           phone_verified       = true,
           whatsapp_otp_enabled = true,
           whatsapp_verified_at = v_now,
           updated_at           = v_now
     where d.id = p_vendor_dashboard_user_id
       and d.user_id is not distinct from p_user_id
       and d.vendor_id is not distinct from p_vendor_id
       and d.status = 'active'
    returning d.id, d.vendor_id, d.user_id, d.phone_e164,
              d.phone_verified, d.whatsapp_otp_enabled, d.whatsapp_verified_at;
  exception when unique_violation then
    -- Another dashboard identity already verified this number.
    raise exception 'VENDOR_AUTH_PHONE_CONFLICT'
      using errcode = '23505',
            hint = 'This WhatsApp number is already verified by another vendor dashboard identity.';
  end;

  -- Membership deactivated between our read and this write: abort everything.
  if not found then
    raise exception 'VENDOR_AUTH_MEMBERSHIP_NOT_ACTIVE'
      using errcode = 'raise_exception';
  end if;
end
$$;



CREATE OR REPLACE FUNCTION "public"."vendor_auth_issue_challenge"("p_challenge_id" "uuid", "p_vendor_dashboard_user_id" "uuid", "p_user_id" "uuid", "p_vendor_id" "uuid", "p_purpose" "text", "p_destination_hash" "text", "p_otp_hash" "text") RETURNS TABLE("result_code" "text", "rate_limit_scope" "text", "issued_challenge_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  -- Authoritative Phase 5E security policy. Not caller-controllable.
  c_ttl          constant interval := interval '10 minutes';
  c_max_attempts constant integer  := 5;
  c_cooldown     constant interval := interval '60 seconds';
  c_max_per_hour constant integer  := 5;
  c_max_per_day  constant integer  := 12;
  v_now      timestamptz := now();
  v_d        record;
  v_cooldown integer;
  v_hour     integer;
  v_day      integer;
begin
  -- Purpose must be exactly one of the two vendor auth purposes. Never widened.
  if p_purpose is distinct from 'vendor_whatsapp_verify'
     and p_purpose is distinct from 'vendor_password_reset' then
    return query select 'purpose_invalid'::text, null::text, null::uuid;
    return;
  end if;

  -- Serialize issuance for THIS identity: lock the canonical dashboard row. Every
  -- concurrent issuance for the same identity waits here, so the rate-limit read and
  -- the insert below are effectively one critical section.
  select d.id, d.user_id, d.vendor_id, d.status
    into v_d
    from public.vendor_dashboard_users d
   where d.id = p_vendor_dashboard_user_id
     for update;

  if not found then
    return query select 'lineage_mismatch'::text, null::text, null::uuid;
    return;
  end if;

  -- Reject caller-supplied lineage that does not match the current row.
  if v_d.user_id is distinct from p_user_id or v_d.vendor_id is distinct from p_vendor_id then
    return query select 'lineage_mismatch'::text, null::text, null::uuid;
    return;
  end if;
  if v_d.status is distinct from 'active' then
    return query select 'membership_not_active'::text, null::text, null::uuid;
    return;
  end if;

  -- Rate-limit windows are computed from the DATABASE clock and the authoritative
  -- constants above, WHILE HOLDING the per-identity lock. Every status counts
  -- (history is monotonic).
  select
    count(*) filter (where c.created_at > v_now - c_cooldown),
    count(*) filter (where c.created_at > v_now - interval '1 hour'),
    count(*) filter (where c.created_at > v_now - interval '1 day')
    into v_cooldown, v_hour, v_day
    from public.verification_challenges c
   where c.vendor_dashboard_user_id = p_vendor_dashboard_user_id
     and c.purpose = p_purpose;

  -- Rate limited → cancel nothing, insert nothing, send nothing.
  if v_cooldown > 0 then
    return query select 'rate_limited'::text, 'cooldown'::text, null::uuid;
    return;
  end if;
  if v_hour >= c_max_per_hour then
    return query select 'rate_limited'::text, 'hourly'::text, null::uuid;
    return;
  end if;
  if v_day >= c_max_per_day then
    return query select 'rate_limited'::text, 'daily'::text, null::uuid;
    return;
  end if;

  -- Allowed. Cancel the prior pending challenge ONLY now that issuance is committed,
  -- then insert exactly one new pending challenge. A rate-limited request never
  -- reaches this point, so it can never cancel a still-valid challenge. The
  -- expires_at and max_attempts are database-owned: (now() + c_ttl) and c_max_attempts.
  --
  -- last_sent_at / delivery_channel / delivery_provider / communication_message_id
  -- are DELIBERATELY LEFT NULL here. Issuance has sent nothing yet — the OTP is
  -- dispatched by CommunicationService AFTER this returns, and only a successful
  -- delivery + linkage (recordChallengeDelivery) stamps last_sent_at and the channel/
  -- provider/message id. Stamping last_sent_at at issuance would fabricate send
  -- history for a provider failure, a linkage failure, or a challenge that was never
  -- delivered.
  update public.verification_challenges c
     set status = 'cancelled'
   where c.vendor_dashboard_user_id = p_vendor_dashboard_user_id
     and c.purpose = p_purpose
     and c.status = 'pending';

  insert into public.verification_challenges
    (id, principal_type, principal_id, purpose, destination_hash, otp_hash, status,
     expires_at, attempt_count, max_attempts, vendor_dashboard_user_id, user_id,
     vendor_id)
  values
    (p_challenge_id, 'vendor', p_vendor_id, p_purpose, p_destination_hash, p_otp_hash,
     'pending', v_now + c_ttl, 0, c_max_attempts, p_vendor_dashboard_user_id, p_user_id,
     p_vendor_id);

  return query select 'issued'::text, null::text, p_challenge_id;
  return;
end
$$;



CREATE OR REPLACE FUNCTION "public"."vendor_auth_register_failed_attempt"("p_challenge_id" "uuid", "p_purpose" "text") RETURNS TABLE("challenge_id" "uuid", "status" "text", "attempt_count" integer, "max_attempts" integer, "locked" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_id       uuid;
  v_status   text;
  v_attempts integer;
  v_max      integer;
begin
  update public.verification_challenges c
     set attempt_count   = c.attempt_count + 1,
         last_attempt_at = now(),
         status          = case
                             when c.attempt_count + 1 >= c.max_attempts then 'locked'
                             else c.status
                           end
   where c.id = p_challenge_id
     and c.purpose is not distinct from p_purpose
     and c.status = 'pending'
     and c.expires_at > now()
  returning c.id, c.status, c.attempt_count, c.max_attempts
       into v_id, v_status, v_attempts, v_max;

  -- Not pending, expired, or a different purpose: nothing incremented, nothing
  -- revived. Returning zero rows tells the caller the attempt did not count.
  if v_id is null then
    return;
  end if;

  return query select v_id, v_status, v_attempts, v_max, (v_status = 'locked');
end
$$;



CREATE TABLE IF NOT EXISTS "public"."aos_runtime_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "setting_key" "text" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "mode" "text" DEFAULT 'off'::"text" NOT NULL,
    "description" "text",
    "updated_by" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "aos_runtime_settings_mode_check" CHECK (("mode" = ANY (ARRAY['off'::"text", 'preview'::"text", 'production_locked'::"text"])))
);



COMMENT ON TABLE "public"."aos_runtime_settings" IS 'Admin-only AOS runtime switches (Lock 2). RLS enabled. Controls whether QuickFurno forwards AOS events to n8n preview routers. No secrets are stored here.';




CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "key" "text" NOT NULL,
    "value" "jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"()
);



CREATE TABLE IF NOT EXISTS "public"."auth_security_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "principal_type" "text",
    "principal_id" "uuid",
    "actor_user_id" "uuid",
    "purpose" "text",
    "correlation_id" "text",
    "destination_hash" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "auth_security_events_principal_type_check" CHECK (("principal_type" = ANY (ARRAY['anonymous'::"text", 'client'::"text", 'vendor'::"text", 'admin'::"text", 'integration'::"text", 'system'::"text"])))
);



CREATE TABLE IF NOT EXISTS "public"."authentication_delivery_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_flow" "text" NOT NULL,
    "auth_reference_type" "text" NOT NULL,
    "auth_reference_id" "text" NOT NULL,
    "challenge_id" "uuid",
    "auth_user_id" "uuid",
    "destination_hash" "text" NOT NULL,
    "attempt_number" integer NOT NULL,
    "channel" "text" NOT NULL,
    "provider_key" "text" NOT NULL,
    "communication_message_id" "uuid",
    "fallback_from_attempt_id" "uuid",
    "status" "text" DEFAULT 'requested'::"text" NOT NULL,
    "outcome_certainty" "text" DEFAULT 'unknown_outcome'::"text" NOT NULL,
    "failure_classification" "text",
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "auth_action_id" "text" NOT NULL,
    "failure_code" "text",
    "decision_reason" "text",
    "completed_at" timestamp with time zone,
    CONSTRAINT "auth_delivery_attempt_status_chk" CHECK (("status" = ANY (ARRAY['requested'::"text", 'dispatching'::"text", 'accepted'::"text", 'sent'::"text", 'delivered'::"text", 'read'::"text", 'failed'::"text", 'cancelled'::"text", 'outcome_unknown'::"text"]))),
    CONSTRAINT "authentication_delivery_attempts_auth_flow_check" CHECK (("auth_flow" = ANY (ARRAY['client_login_otp'::"text", 'vendor_whatsapp_verify'::"text", 'vendor_password_reset'::"text"]))),
    CONSTRAINT "authentication_delivery_attempts_auth_reference_type_check" CHECK (("auth_reference_type" = ANY (ARRAY['verification_challenge'::"text", 'auth_user'::"text"]))),
    CONSTRAINT "authentication_delivery_attempts_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text"]))),
    CONSTRAINT "authentication_delivery_attempts_outcome_certainty_check" CHECK (("outcome_certainty" = ANY (ARRAY['accepted'::"text", 'definitive_failure'::"text", 'unknown_outcome'::"text"]))),
    CONSTRAINT "chk_auth_attempt_action_id_shape" CHECK (("auth_action_id" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "chk_auth_attempt_number_max_two" CHECK (("attempt_number" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "chk_auth_attempt_sanitized_codes" CHECK (((("failure_code" IS NULL) OR ("failure_code" ~ '^[A-Za-z0-9_]{1,120}$'::"text")) AND (("decision_reason" IS NULL) OR ("decision_reason" ~ '^[A-Za-z0-9_]{1,120}$'::"text")) AND (("failure_classification" IS NULL) OR ("failure_classification" ~ '^[A-Za-z0-9_]{1,120}$'::"text")))),
    CONSTRAINT "chk_auth_attempt_shape" CHECK (((("attempt_number" = 1) AND ("channel" = 'whatsapp'::"text") AND ("fallback_from_attempt_id" IS NULL)) OR (("attempt_number" = 2) AND ("channel" = 'sms'::"text") AND ("fallback_from_attempt_id" IS NOT NULL)))),
    CONSTRAINT "chk_auth_attempt_status_certainty" CHECK (((("outcome_certainty" = 'accepted'::"text") AND ("status" = ANY (ARRAY['accepted'::"text", 'sent'::"text", 'delivered'::"text", 'read'::"text"]))) OR (("outcome_certainty" = 'definitive_failure'::"text") AND ("status" = ANY (ARRAY['failed'::"text", 'cancelled'::"text"]))) OR (("outcome_certainty" = 'unknown_outcome'::"text") AND ("status" = ANY (ARRAY['requested'::"text", 'dispatching'::"text", 'outcome_unknown'::"text"]))))),
    CONSTRAINT "chk_auth_attempt_whatsapp_verify_no_fallback" CHECK ((("auth_flow" <> 'vendor_whatsapp_verify'::"text") OR ("attempt_number" = 1)))
);



COMMENT ON COLUMN "public"."authentication_delivery_attempts"."auth_action_id" IS 'Phase 5F-C1: deterministic domain-separated SHA-256 (64 lowercase hex) identity of ONE authentication delivery action, derived from the authoritative server-side action id. Non-secret. Not an OTP hash, not a phone hash, not a destination identity, not an authentication proof. The raw source identifier is never stored.';




COMMENT ON COLUMN "public"."authentication_delivery_attempts"."failure_code" IS 'Phase 5F-C1: sanitized, identifier-shaped provider/service failure code. Never a raw payload, phone, or OTP.';




COMMENT ON COLUMN "public"."authentication_delivery_attempts"."decision_reason" IS 'Phase 5F-C1: the fallback decision reason code that authorized this attempt. Non-secret.';




COMMENT ON COLUMN "public"."authentication_delivery_attempts"."completed_at" IS 'Phase 5F-C1: when the attempt reached a terminal or parked outcome. Non-secret.';




CREATE TABLE IF NOT EXISTS "public"."authentication_transport_failure_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_flow" "text",
    "primary_channel" "text" NOT NULL,
    "primary_provider_key" "text" NOT NULL,
    "failure_code" "text" NOT NULL,
    "failure_classification" "text" NOT NULL,
    "automatic_fallback_eligible" boolean DEFAULT false NOT NULL,
    "user_requested_fallback_eligible" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "reason_sanitized" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "authentication_transport_failure_r_failure_classification_check" CHECK (("failure_classification" ~ '^[A-Za-z0-9_]{1,120}$'::"text")),
    CONSTRAINT "authentication_transport_failure_rules_auth_flow_check" CHECK ((("auth_flow" IS NULL) OR ("auth_flow" = ANY (ARRAY['client_login_otp'::"text", 'vendor_whatsapp_verify'::"text", 'vendor_password_reset'::"text"])))),
    CONSTRAINT "authentication_transport_failure_rules_failure_code_check" CHECK (("failure_code" ~ '^[A-Za-z0-9_]{1,120}$'::"text")),
    CONSTRAINT "authentication_transport_failure_rules_primary_channel_check" CHECK (("primary_channel" = 'whatsapp'::"text")),
    CONSTRAINT "chk_auth_failure_rule_whatsapp_verify_never_eligible" CHECK ((("auth_flow" IS DISTINCT FROM 'vendor_whatsapp_verify'::"text") OR (("automatic_fallback_eligible" = false) AND ("user_requested_fallback_eligible" = false))))
);



COMMENT ON TABLE "public"."authentication_transport_failure_rules" IS 'Phase 5F-C1: DEFAULT-DENY allowlist of primary failure codes that may justify an SMS fallback. Ships EMPTY; with no active rule every fallback is blocked. Never an authentication authority.';




CREATE TABLE IF NOT EXISTS "public"."authentication_transport_policies" (
    "auth_flow" "text" NOT NULL,
    "primary_channel" "text" NOT NULL,
    "primary_provider_key" "text" NOT NULL,
    "fallback_channel" "text",
    "fallback_provider_key" "text",
    "automatic_fallback_enabled" boolean DEFAULT false NOT NULL,
    "user_requested_fallback_enabled" boolean DEFAULT false NOT NULL,
    "fallback_policy_status" "text" DEFAULT 'disabled'::"text" NOT NULL,
    "hard_failure_only" boolean DEFAULT true NOT NULL,
    "is_operationally_enabled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "authentication_transport_policies_auth_flow_check" CHECK (("auth_flow" = ANY (ARRAY['client_login_otp'::"text", 'vendor_whatsapp_verify'::"text", 'vendor_password_reset'::"text"]))),
    CONSTRAINT "authentication_transport_policies_fallback_channel_check" CHECK ((("fallback_channel" IS NULL) OR ("fallback_channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text"])))),
    CONSTRAINT "authentication_transport_policies_fallback_policy_status_check" CHECK (("fallback_policy_status" = ANY (ARRAY['disabled'::"text", 'pending_provider'::"text", 'manual_only'::"text", 'automatic_ready'::"text"]))),
    CONSTRAINT "authentication_transport_policies_primary_channel_check" CHECK (("primary_channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'rcs'::"text"]))),
    CONSTRAINT "chk_auth_transport_fallback_consistency" CHECK ((("fallback_channel" IS NOT NULL) OR (("fallback_provider_key" IS NULL) AND ("automatic_fallback_enabled" = false) AND ("user_requested_fallback_enabled" = false)))),
    CONSTRAINT "chk_auth_transport_no_rcs" CHECK ((("primary_channel" <> 'rcs'::"text") AND (("fallback_channel" IS NULL) OR ("fallback_channel" <> 'rcs'::"text")))),
    CONSTRAINT "chk_auth_transport_whatsapp_verify_whatsapp_only" CHECK ((("auth_flow" <> 'vendor_whatsapp_verify'::"text") OR (("primary_channel" = 'whatsapp'::"text") AND ("fallback_channel" IS NULL))))
);



CREATE TABLE IF NOT EXISTS "public"."bad_lead_report_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_id" "uuid" NOT NULL,
    "sender_type" "text" DEFAULT 'admin'::"text" NOT NULL,
    "sender_id" "uuid",
    "comment" "text" NOT NULL,
    "is_internal" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);



CREATE TABLE IF NOT EXISTS "public"."bad_lead_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "lead_assignment_id" "uuid",
    "vendor_id" "uuid",
    "reason" "text",
    "description" "text",
    "status" "text" DEFAULT 'Pending'::"text",
    "admin_decision" "text",
    "credit_restored" boolean DEFAULT false,
    "report_type" "text",
    "report_reason" "text",
    "vendor_comment" "text",
    "reviewed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "admin_notes" "text",
    "reviewed_by" "uuid",
    "reason_code" "text",
    "reason_label" "text",
    CONSTRAINT "bad_lead_reports_status_check" CHECK ((("status" IS NULL) OR ("status" = ANY (ARRAY['Pending'::"text", 'Under Review'::"text", 'Valid'::"text", 'Invalid'::"text", 'Resolved'::"text", 'Rejected'::"text", 'Approved'::"text"]))))
);



CREATE TABLE IF NOT EXISTS "public"."cities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text",
    "is_active" boolean DEFAULT true
);



CREATE TABLE IF NOT EXISTS "public"."client_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "phone_e164" "text",
    "display_name" "text",
    "whatsapp_verified_at" timestamp with time zone,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_accounts_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'disabled'::"text"])))
);



CREATE TABLE IF NOT EXISTS "public"."client_notification_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "notification_type" "text" DEFAULT 'assigned_vendors_preview'::"text" NOT NULL,
    "channel" "text" DEFAULT 'dashboard_preview'::"text" NOT NULL,
    "status" "text" DEFAULT 'preview_created'::"text" NOT NULL,
    "message" "text",
    "vendor_snapshot" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "whatsapp_status" "text" DEFAULT 'preview_only'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



CREATE TABLE IF NOT EXISTS "public"."client_requirement_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_phone" "text" NOT NULL,
    "client_phone_normalized" "text" NOT NULL,
    "client_name" "text",
    "city" "text" NOT NULL,
    "parent_category_group" "text" NOT NULL,
    "primary_service" "text",
    "first_lead_id" "uuid",
    "first_enquiry_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "first_selection_at" timestamp with time zone,
    "client_selection_deadline_at" timestamp with time zone,
    "normal_assignment_expires_at" timestamp with time zone DEFAULT ("now"() + '3 days'::interval) NOT NULL,
    "client_selected_vendor_count" integer DEFAULT 0 NOT NULL,
    "auto_assigned_vendor_count" integer DEFAULT 0 NOT NULL,
    "manual_assigned_vendor_count" integer DEFAULT 0 NOT NULL,
    "primary_assigned_count" integer DEFAULT 0 NOT NULL,
    "recovery_assigned_count" integer DEFAULT 0 NOT NULL,
    "total_assigned_count" integer DEFAULT 0 NOT NULL,
    "pending_primary_slots" integer DEFAULT 3 NOT NULL,
    "auto_fill_enabled" boolean DEFAULT false NOT NULL,
    "auto_fill_status" "text" DEFAULT 'not_started'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "preferred_vendor_id" "uuid",
    "preferred_vendor_name" "text",
    "preferred_vendor_status" "text",
    "preferred_vendor_status_reason" "text",
    "preferred_vendor_recharge_deadline_at" timestamp with time zone,
    "preferred_vendor_processed_at" timestamp with time zone
);



CREATE TABLE IF NOT EXISTS "public"."communication_automation_catalog" (
    "automation_key" "text" NOT NULL,
    "category" "text" NOT NULL,
    "description" "text",
    "lane" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "readiness_status" "text" DEFAULT 'wiring_pending'::"text" NOT NULL,
    "provider_required" "text" NOT NULL,
    "template_key" "text",
    "is_operationally_enabled" boolean DEFAULT false NOT NULL,
    "last_triggered_at" timestamp with time zone,
    "last_success_at" timestamp with time zone,
    "last_failure_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_comm_automation_enablement_requires_active" CHECK ((("is_operationally_enabled" = false) OR ("readiness_status" = 'active'::"text"))),
    CONSTRAINT "communication_automation_catalog_category_check" CHECK (("category" = ANY (ARRAY['otp'::"text", 'notification'::"text", 'alert'::"text", 'marketing'::"text", 'system'::"text"]))),
    CONSTRAINT "communication_automation_catalog_channel_vocab_chk" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'rcs'::"text"]))),
    CONSTRAINT "communication_automation_catalog_lane_check" CHECK (("lane" = ANY (ARRAY['authentication'::"text", 'business'::"text"]))),
    CONSTRAINT "communication_automation_catalog_readiness_status_check" CHECK (("readiness_status" = ANY (ARRAY['foundation_ready'::"text", 'wiring_pending'::"text", 'mock_ready'::"text", 'provider_mapping_required'::"text", 'provider_ready'::"text", 'active'::"text"])))
);



CREATE TABLE IF NOT EXISTS "public"."communication_channel_capabilities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "destination_hash" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "provider_key" "text" NOT NULL,
    "capability_status" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "features" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "checked_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "source" "text" DEFAULT 'system'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "communication_channel_capabilities_capability_status_check" CHECK (("capability_status" = ANY (ARRAY['unknown'::"text", 'reachable'::"text", 'not_reachable'::"text", 'stale'::"text", 'error'::"text"]))),
    CONSTRAINT "communication_channel_capabilities_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'rcs'::"text"]))),
    CONSTRAINT "communication_channel_capabilities_source_check" CHECK (("source" = ANY (ARRAY['system'::"text", 'provider'::"text", 'admin'::"text", 'import'::"text"])))
);



CREATE TABLE IF NOT EXISTS "public"."communication_consent_command_receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "provider_message_id" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "destination_hash" "text" NOT NULL,
    "normalized_command" "text" NOT NULL,
    "policy_version" "text" NOT NULL,
    "scope_results" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ck_consent_command_receipt_scope_results" CHECK ((("octet_length"(("scope_results")::"text") <= 4096) AND "public"."communication_consent_receipt_results_valid"("scope_results"))),
    CONSTRAINT "communication_consent_command_receipt_provider_message_id_check" CHECK (("provider_message_id" ~ '^[A-Za-z0-9._:-]{1,200}$'::"text")),
    CONSTRAINT "communication_consent_command_receipts_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'rcs'::"text"]))),
    CONSTRAINT "communication_consent_command_receipts_destination_hash_check" CHECK (("destination_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "communication_consent_command_receipts_normalized_command_check" CHECK (("normalized_command" = ANY (ARRAY['stop'::"text", 'start'::"text"]))),
    CONSTRAINT "communication_consent_command_receipts_policy_version_check" CHECK (("policy_version" ~ '^[A-Za-z0-9._:-]{1,64}$'::"text")),
    CONSTRAINT "communication_consent_command_receipts_provider_check" CHECK (("provider" = ANY (ARRAY['meta_whatsapp'::"text", 'exotel_sms'::"text", 'system'::"text"])))
);



COMMENT ON TABLE "public"."communication_consent_command_receipts" IS 'Phase 5F-D2-D: additive service-role-only PROCESSING/IDEMPOTENCY receipt for inbound consent commands. NOT consent truth and NOT a replacement for communication_consent_events / communication_suppressions. Uniquely binds (provider, provider_message_id, channel) to the ORIGINAL sanitized scope_results (exact event + suppression ids) for stable replay. Stores hashed destination only — no plaintext / raw text.';




CREATE TABLE IF NOT EXISTS "public"."communication_consent_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "target_type" "text" NOT NULL,
    "principal_type" "text",
    "principal_id" "uuid",
    "destination_hash" "text",
    "channel" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "action" "text" NOT NULL,
    "state_before" "text",
    "state_after" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "source" "text" NOT NULL,
    "evidence_type" "text" NOT NULL,
    "policy_version" "text" NOT NULL,
    "actor_type" "text" NOT NULL,
    "actor_id" "uuid",
    "source_event_type" "text" NOT NULL,
    "source_event_id" "text" NOT NULL,
    "inbound_message_id" "uuid",
    "provider" "text",
    "provider_message_id" "text",
    "occurred_at" timestamp with time zone NOT NULL,
    "metadata_sanitized" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_consent_evt_action_state" CHECK (((("action" = ANY (ARRAY['grant'::"text", 'reaffirm'::"text"])) AND ("target_type" = 'preference'::"text") AND ("state_after" = 'allowed'::"text")) OR (("action" = ANY (ARRAY['withdraw'::"text", 'admin_block'::"text"])) AND ("target_type" = 'preference'::"text") AND ("state_after" = 'blocked'::"text")) OR (("action" = ANY (ARRAY['suppress'::"text", 'provider_block'::"text"])) AND ("target_type" = 'suppression'::"text") AND ("state_after" = 'active'::"text")) OR (("action" = ANY (ARRAY['unsuppress'::"text", 'provider_unblock'::"text", 'admin_unblock'::"text"])) AND ("target_type" = 'suppression'::"text") AND ("state_after" = 'inactive'::"text")))),
    CONSTRAINT "chk_consent_evt_actor" CHECK (((("actor_type" = 'admin'::"text") AND ("actor_id" IS NOT NULL)) OR (("actor_type" <> 'admin'::"text") AND ("actor_id" IS NULL)))),
    CONSTRAINT "chk_consent_evt_inbound_command" CHECK ((("evidence_type" <> 'inbound_command'::"text") OR (("provider" IS NOT NULL) AND ("provider_message_id" IS NOT NULL)))),
    CONSTRAINT "chk_consent_evt_principal_pair" CHECK (((("principal_type" IS NULL) AND ("principal_id" IS NULL)) OR (("principal_type" IS NOT NULL) AND ("principal_id" IS NOT NULL)))),
    CONSTRAINT "chk_consent_evt_provider_pair" CHECK (((("provider" IS NULL) AND ("provider_message_id" IS NULL)) OR (("provider" IS NOT NULL) AND ("provider_message_id" IS NOT NULL)))),
    CONSTRAINT "chk_consent_evt_state_before" CHECK ((("state_before" IS NULL) OR (("target_type" = 'preference'::"text") AND ("state_before" = ANY (ARRAY['absent'::"text", 'allowed'::"text", 'blocked'::"text"]))) OR (("target_type" = 'suppression'::"text") AND ("state_before" = ANY (ARRAY['absent'::"text", 'active'::"text", 'inactive'::"text"]))))),
    CONSTRAINT "chk_consent_evt_subject_present" CHECK (((("principal_type" IS NOT NULL) AND ("principal_id" IS NOT NULL)) OR ("destination_hash" IS NOT NULL))),
    CONSTRAINT "chk_consent_evt_target_shape" CHECK (((("target_type" = 'preference'::"text") AND ("principal_type" IS NOT NULL) AND ("principal_id" IS NOT NULL) AND ("destination_hash" IS NULL) AND ("scope" = ANY (ARRAY['authentication'::"text", 'transactional'::"text", 'marketing'::"text"]))) OR (("target_type" = 'suppression'::"text") AND ("destination_hash" IS NOT NULL) AND ("scope" = ANY (ARRAY['transactional'::"text", 'marketing'::"text", 'global'::"text"]))))),
    CONSTRAINT "communication_consent_events_action_check" CHECK (("action" = ANY (ARRAY['grant'::"text", 'withdraw'::"text", 'reaffirm'::"text", 'admin_block'::"text", 'admin_unblock'::"text", 'suppress'::"text", 'unsuppress'::"text", 'provider_block'::"text", 'provider_unblock'::"text"]))),
    CONSTRAINT "communication_consent_events_actor_type_check" CHECK (("actor_type" = ANY (ARRAY['system'::"text", 'user'::"text", 'admin'::"text", 'provider'::"text"]))),
    CONSTRAINT "communication_consent_events_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'rcs'::"text"]))),
    CONSTRAINT "communication_consent_events_destination_hash_check" CHECK ((("destination_hash" IS NULL) OR ("destination_hash" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "communication_consent_events_evidence_type_check" CHECK (("evidence_type" = ANY (ARRAY['inbound_command'::"text", 'admin_action'::"text", 'provider_signal'::"text", 'import'::"text", 'system_action'::"text"]))),
    CONSTRAINT "communication_consent_events_idempotency_key_check" CHECK (("idempotency_key" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "communication_consent_events_metadata_sanitized_check" CHECK ((("jsonb_typeof"("metadata_sanitized") = 'object'::"text") AND ("octet_length"(("metadata_sanitized")::"text") <= 4096))),
    CONSTRAINT "communication_consent_events_policy_version_check" CHECK (("policy_version" ~ '^[A-Za-z0-9._:-]{1,64}$'::"text")),
    CONSTRAINT "communication_consent_events_principal_type_check" CHECK ((("principal_type" IS NULL) OR ("principal_type" = ANY (ARRAY['client'::"text", 'vendor'::"text", 'admin'::"text"])))),
    CONSTRAINT "communication_consent_events_reason_check" CHECK (("reason" = ANY (ARRAY['user_grant'::"text", 'user_withdrawal'::"text", 'user_stop'::"text", 'user_start'::"text", 'provider_block'::"text", 'provider_restored'::"text", 'hard_bounce'::"text", 'complaint'::"text", 'admin'::"text", 'legal'::"text", 'abuse'::"text", 'import'::"text", 'system'::"text", 'unspecified'::"text"]))),
    CONSTRAINT "communication_consent_events_scope_check" CHECK (("scope" = ANY (ARRAY['authentication'::"text", 'transactional'::"text", 'marketing'::"text", 'global'::"text"]))),
    CONSTRAINT "communication_consent_events_source_check" CHECK (("source" = ANY (ARRAY['system'::"text", 'user'::"text", 'admin'::"text", 'provider'::"text", 'import'::"text"]))),
    CONSTRAINT "communication_consent_events_source_event_id_check" CHECK ((("char_length"("source_event_id") >= 1) AND ("char_length"("source_event_id") <= 200))),
    CONSTRAINT "communication_consent_events_source_event_type_check" CHECK (("source_event_type" ~ '^[A-Za-z0-9._:-]{1,64}$'::"text")),
    CONSTRAINT "communication_consent_events_state_after_check" CHECK (("state_after" = ANY (ARRAY['allowed'::"text", 'blocked'::"text", 'active'::"text", 'inactive'::"text"]))),
    CONSTRAINT "communication_consent_events_state_before_check" CHECK ((("state_before" IS NULL) OR ("state_before" = ANY (ARRAY['absent'::"text", 'allowed'::"text", 'blocked'::"text", 'active'::"text", 'inactive'::"text"])))),
    CONSTRAINT "communication_consent_events_target_type_check" CHECK (("target_type" = ANY (ARRAY['preference'::"text", 'suppression'::"text"])))
);



COMMENT ON TABLE "public"."communication_consent_events" IS 'Phase 5F-D2-B: IMMUTABLE append-only communication-consent audit ledger (evidence + state transitions). NOT domain_events, NOT outbox_events; triggers no n8n and drives no execution. Stores hashed destinations and minimized evidence only — never a plaintext phone, raw inbound content, raw webhook payload, provider error, token/secret/signature, OTP, or password. Append-only: service_role has SELECT/INSERT only (no UPDATE/DELETE/TRUNCATE).';




COMMENT ON COLUMN "public"."communication_consent_events"."inbound_message_id" IS 'Phase 5F-D2-B: OPTIONAL convenience link to public.communication_inbound_messages(id), ON DELETE SET NULL. The immutable event outlives the inbound row; the permanent inbound-action identity is source_event_id + (provider, provider_message_id), never message text/phone/timestamp/payload hash.';




COMMENT ON COLUMN "public"."communication_consent_events"."idempotency_key" IS 'Phase 5F-D2-B: server-generated OPAQUE sha256 hex (64 lowercase). Derived by a future writer from a canonical namespaced tuple (e.g. qf-consent-v1 | target_type | provider | provider_message_id | action | channel | scope); the raw tuple is never stored. Unique — a redelivered inbound command is an idempotent replay, never a duplicate event.';




CREATE TABLE IF NOT EXISTS "public"."communication_delivery_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "communication_message_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "provider_event_id" "text",
    "normalized_event_type" "text" NOT NULL,
    "provider_message_id" "text" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sanitized_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provider_account_id" "uuid",
    CONSTRAINT "communication_delivery_events_normalized_event_type_check" CHECK (("normalized_event_type" = ANY (ARRAY['accepted'::"text", 'sent'::"text", 'delivered'::"text", 'read'::"text", 'failed'::"text"]))),
    CONSTRAINT "communication_delivery_events_provider_account_required_check" CHECK (("provider_account_id" IS NOT NULL))
);



CREATE TABLE IF NOT EXISTS "public"."communication_inbound_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "provider_message_id" "text" NOT NULL,
    "webhook_receipt_id" "uuid",
    "sender_hash" "text" NOT NULL,
    "sender_masked" "text",
    "resolved_principal_type" "text",
    "resolved_principal_id" "uuid",
    "identity_confidence" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "message_type" "text" NOT NULL,
    "content_minimized" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "provider_occurred_at" timestamp with time zone,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processing_status" "text" DEFAULT 'captured'::"text" NOT NULL,
    "failure_reason_sanitized" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provider_account_id" "uuid",
    CONSTRAINT "chk_comm_inbound_identity_confidence_principal" CHECK (((("identity_confidence" = 'exact'::"text") AND ("resolved_principal_type" IS NOT NULL) AND ("resolved_principal_id" IS NOT NULL)) OR (("identity_confidence" = ANY (ARRAY['ambiguous'::"text", 'unknown'::"text"])) AND ("resolved_principal_type" IS NULL) AND ("resolved_principal_id" IS NULL)))),
    CONSTRAINT "communication_inbound_messages_identity_confidence_check" CHECK (("identity_confidence" = ANY (ARRAY['exact'::"text", 'ambiguous'::"text", 'unknown'::"text"]))),
    CONSTRAINT "communication_inbound_messages_message_type_check" CHECK (("message_type" = ANY (ARRAY['text'::"text", 'button_reply'::"text", 'list_reply'::"text", 'image'::"text", 'document'::"text", 'audio'::"text", 'video'::"text", 'location'::"text", 'contact'::"text", 'reaction'::"text", 'unsupported'::"text"]))),
    CONSTRAINT "communication_inbound_messages_processing_status_check" CHECK (("processing_status" = ANY (ARRAY['captured'::"text", 'normalized'::"text", 'identity_resolved'::"text", 'identity_ambiguous'::"text", 'identity_unknown'::"text", 'failed'::"text"]))),
    CONSTRAINT "communication_inbound_messages_resolved_principal_type_check" CHECK ((("resolved_principal_type" IS NULL) OR ("resolved_principal_type" = ANY (ARRAY['client'::"text", 'vendor'::"text", 'admin'::"text"])))),
    CONSTRAINT "communication_inbound_messages_sender_hash_check" CHECK (("sender_hash" ~ '^[0-9a-f]{64}$'::"text"))
);



CREATE TABLE IF NOT EXISTS "public"."communication_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_type" "text" NOT NULL,
    "lane" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "recipient_type" "text" NOT NULL,
    "recipient_id" "uuid",
    "destination_source" "text" DEFAULT 'recipient_reference'::"text" NOT NULL,
    "destination_hash" "text" NOT NULL,
    "destination_masked" "text" NOT NULL,
    "template_key" "text",
    "entity_type" "text",
    "entity_id" "uuid",
    "correlation_id" "text",
    "idempotency_key" "text" NOT NULL,
    "policy_decision_id" "uuid",
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "scheduled_at" timestamp with time zone,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 5 NOT NULL,
    "next_retry_at" timestamp with time zone,
    "provider" "text" NOT NULL,
    "provider_message_id" "text",
    "failure_code" "text",
    "failure_reason_sanitized" "text",
    "variables" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "read_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provider_template_mapping_id" "uuid",
    "provider_template_version" "text",
    "provider_template_mapping_fingerprint" "text",
    "provider_account_id" "uuid",
    CONSTRAINT "chk_comm_message_ephemeral_is_authentication" CHECK ((("destination_source" = 'recipient_reference'::"text") OR ("lane" = 'authentication'::"text"))),
    CONSTRAINT "chk_comm_message_ephemeral_never_scheduled" CHECK ((("destination_source" = 'recipient_reference'::"text") OR ("scheduled_at" IS NULL))),
    CONSTRAINT "communication_messages_channel_vocab_chk" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'rcs'::"text"]))),
    CONSTRAINT "communication_messages_destination_source_check" CHECK (("destination_source" = ANY (ARRAY['recipient_reference'::"text", 'ephemeral_auth_destination'::"text"]))),
    CONSTRAINT "communication_messages_lane_check" CHECK (("lane" = ANY (ARRAY['authentication'::"text", 'business'::"text"]))),
    CONSTRAINT "communication_messages_mapping_fingerprint_chk" CHECK ((("provider_template_mapping_fingerprint" IS NULL) OR ("provider_template_mapping_fingerprint" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "communication_messages_priority_check" CHECK (("priority" = ANY (ARRAY['critical'::"text", 'high'::"text", 'normal'::"text", 'low'::"text"]))),
    CONSTRAINT "communication_messages_recipient_type_check" CHECK (("recipient_type" = ANY (ARRAY['client'::"text", 'vendor'::"text", 'admin'::"text", 'integration'::"text", 'system'::"text"]))),
    CONSTRAINT "communication_messages_status_chk" CHECK (("status" = ANY (ARRAY['queued'::"text", 'dispatching'::"text", 'accepted'::"text", 'sent'::"text", 'delivered'::"text", 'read'::"text", 'failed'::"text", 'retry_scheduled'::"text", 'dead_letter'::"text", 'cancelled'::"text", 'outcome_unknown'::"text"])))
);



COMMENT ON COLUMN "public"."communication_messages"."provider_template_mapping_id" IS 'Phase 5F-B: the approved communication_provider_template_mappings row used for this dispatch. Re-resolved by id on restart-safe retry. Non-secret.';




COMMENT ON COLUMN "public"."communication_messages"."provider_template_version" IS 'Phase 5F-B: the approved mapping version pinned at initial send; a changed version fails closed on retry. Non-secret.';




COMMENT ON COLUMN "public"."communication_messages"."provider_template_mapping_fingerprint" IS 'Phase 5F-B: SHA-256 (lowercase hex) of the canonicalized dispatch-critical mapping content pinned at initial send. A mapping edited in place under the same id+version fails closed on retry. Non-secret.';




CREATE TABLE IF NOT EXISTS "public"."communication_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "principal_type" "text" NOT NULL,
    "principal_id" "uuid" NOT NULL,
    "channel" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "state" "text" NOT NULL,
    "source" "text" DEFAULT 'system'::"text" NOT NULL,
    "consented_at" timestamp with time zone,
    "withdrawn_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "policy_version" "text" NOT NULL,
    "last_event_id" "uuid" NOT NULL,
    CONSTRAINT "chk_comm_preference_policy_version" CHECK (("policy_version" ~ '^[A-Za-z0-9._:-]{1,64}$'::"text")),
    CONSTRAINT "chk_comm_preference_principal_type" CHECK (("principal_type" = ANY (ARRAY['client'::"text", 'vendor'::"text", 'admin'::"text"]))),
    CONSTRAINT "chk_comm_preference_state" CHECK (("state" = ANY (ARRAY['allowed'::"text", 'blocked'::"text"]))),
    CONSTRAINT "chk_comm_preference_state_time" CHECK (((("state" = 'allowed'::"text") AND ("consented_at" IS NOT NULL) AND ("withdrawn_at" IS NULL)) OR (("state" = 'blocked'::"text") AND ("consented_at" IS NULL) AND ("withdrawn_at" IS NOT NULL)))),
    CONSTRAINT "communication_preferences_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'rcs'::"text"]))),
    CONSTRAINT "communication_preferences_scope_check" CHECK (("scope" = ANY (ARRAY['authentication'::"text", 'transactional'::"text", 'marketing'::"text"]))),
    CONSTRAINT "communication_preferences_source_check" CHECK (("source" = ANY (ARRAY['system'::"text", 'user'::"text", 'admin'::"text", 'import'::"text", 'provider'::"text"])))
);



COMMENT ON TABLE "public"."communication_preferences" IS 'Phase 5F-D2-B: CURRENT materialized principal-preference projection (whatsapp/sms/rcs x scope). ABSENCE OF A ROW MEANS UNKNOWN — only allowed/blocked are durable states. Authoritative history is communication_consent_events; rows are mutated ONLY by the future controlled writer. principal_id is required (closes the NULL-uniqueness bypass); anonymous/system never own a preference.';




COMMENT ON COLUMN "public"."communication_preferences"."policy_version" IS 'Phase 5F-D2-B: consent policy version under which this current state was written. Server-set; never browser-supplied.';




COMMENT ON COLUMN "public"."communication_preferences"."last_event_id" IS 'Phase 5F-D2-B: FK to the communication_consent_events row that produced this current state (ON DELETE RESTRICT; evidence is immutable).';




CREATE TABLE IF NOT EXISTS "public"."communication_provider_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_key" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "account_reference" "text",
    "business_account_reference" "text",
    "phone_number_reference" "text",
    "readiness_status" "text" DEFAULT 'not_configured'::"text" NOT NULL,
    "configuration_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "business_verification_status" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "phone_number_status" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "webhook_status" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "billing_status" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "health_status" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "last_health_check_at" timestamp with time zone,
    "last_synced_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "communication_provider_accou_business_verification_status_check" CHECK (("business_verification_status" = ANY (ARRAY['unknown'::"text", 'not_started'::"text", 'pending'::"text", 'verified'::"text", 'rejected'::"text"]))),
    CONSTRAINT "communication_provider_accounts_billing_status_check" CHECK (("billing_status" = ANY (ARRAY['unknown'::"text", 'not_configured'::"text", 'active'::"text", 'suspended'::"text"]))),
    CONSTRAINT "communication_provider_accounts_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'rcs'::"text"]))),
    CONSTRAINT "communication_provider_accounts_configuration_status_check" CHECK (("configuration_status" = ANY (ARRAY['pending'::"text", 'partial'::"text", 'complete'::"text", 'error'::"text"]))),
    CONSTRAINT "communication_provider_accounts_health_status_check" CHECK (("health_status" = ANY (ARRAY['unknown'::"text", 'healthy'::"text", 'degraded'::"text", 'unhealthy'::"text"]))),
    CONSTRAINT "communication_provider_accounts_phone_number_status_check" CHECK (("phone_number_status" = ANY (ARRAY['unknown'::"text", 'pending'::"text", 'connected'::"text", 'flagged'::"text", 'disconnected'::"text"]))),
    CONSTRAINT "communication_provider_accounts_readiness_status_check" CHECK (("readiness_status" = ANY (ARRAY['not_configured'::"text", 'credentials_pending'::"text", 'account_ready'::"text", 'webhook_pending'::"text", 'template_mapping_pending'::"text", 'provider_ready'::"text", 'disabled'::"text"]))),
    CONSTRAINT "communication_provider_accounts_webhook_status_check" CHECK (("webhook_status" = ANY (ARRAY['unknown'::"text", 'pending'::"text", 'verified'::"text", 'failing'::"text"])))
);



CREATE TABLE IF NOT EXISTS "public"."communication_provider_canary_destinations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_key" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "destination_hash" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "approved_by_type" "text",
    "approved_by_id" "text",
    "reason_sanitized" "text",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "communication_provider_canary_destinations_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'rcs'::"text"])))
);



COMMENT ON TABLE "public"."communication_provider_canary_destinations" IS 'Phase 5F-B: canary allowlist of destination HASHES for controlled provider testing. No plaintext phone/OTP/secret. Required only in canary activation.';




CREATE TABLE IF NOT EXISTS "public"."communication_provider_runtime_policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_key" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "activation_status" "text" DEFAULT 'disabled'::"text" NOT NULL,
    "outbound_enabled" boolean DEFAULT false NOT NULL,
    "webhook_processing_enabled" boolean DEFAULT false NOT NULL,
    "health_check_enabled" boolean DEFAULT false NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "communication_provider_runtime_policies_activation_status_check" CHECK (("activation_status" = ANY (ARRAY['disabled'::"text", 'readiness_only'::"text", 'shadow'::"text", 'canary'::"text", 'active'::"text", 'paused'::"text"]))),
    CONSTRAINT "communication_provider_runtime_policies_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'rcs'::"text"])))
);



COMMENT ON TABLE "public"."communication_provider_runtime_policies" IS 'Phase 5F-B: infrastructure activation authority for a provider transport. NOT business/auth/campaign/consent authorization. Ships disabled; active never by itself authorizes a communication.';




CREATE TABLE IF NOT EXISTS "public"."communication_provider_template_mappings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_key" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "provider_key" "text" NOT NULL,
    "language" "text" DEFAULT 'en'::"text" NOT NULL,
    "provider_template_name" "text",
    "provider_template_id" "text",
    "provider_category" "text",
    "approval_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "quality_status" "text",
    "version" "text" DEFAULT '1.0'::"text" NOT NULL,
    "variables_schema" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "submission_reference" "text",
    "rejection_reason_sanitized" "text",
    "submitted_at" timestamp with time zone,
    "approved_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "last_synced_at" timestamp with time zone,
    "is_active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "communication_provider_template_mapping_provider_category_check" CHECK ((("provider_category" IS NULL) OR ("provider_category" = ANY (ARRAY['authentication'::"text", 'utility'::"text", 'marketing'::"text", 'service'::"text"])))),
    CONSTRAINT "communication_provider_template_mappings_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['draft'::"text", 'ready_for_submission'::"text", 'submitted'::"text", 'approved'::"text", 'rejected'::"text", 'paused'::"text", 'disabled'::"text", 'superseded'::"text"]))),
    CONSTRAINT "communication_provider_template_mappings_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'rcs'::"text"]))),
    CONSTRAINT "communication_provider_template_mappings_quality_status_check" CHECK ((("quality_status" IS NULL) OR ("quality_status" = ANY (ARRAY['unknown'::"text", 'green'::"text", 'yellow'::"text", 'red'::"text", 'paused'::"text"]))))
);



CREATE TABLE IF NOT EXISTS "public"."communication_suppressions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "destination_hash" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "reason" "text" DEFAULT 'unspecified'::"text" NOT NULL,
    "source" "text" DEFAULT 'system'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "suppressed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deactivated_at" timestamp with time zone,
    "policy_version" "text" NOT NULL,
    "last_event_id" "uuid" NOT NULL,
    CONSTRAINT "chk_comm_suppression_active_deactivated" CHECK (((("is_active" = true) AND ("deactivated_at" IS NULL)) OR (("is_active" = false) AND ("deactivated_at" IS NOT NULL)))),
    CONSTRAINT "chk_comm_suppression_deactivated_order" CHECK ((("deactivated_at" IS NULL) OR ("deactivated_at" >= "suppressed_at"))),
    CONSTRAINT "chk_comm_suppression_destination_hash" CHECK (("destination_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "chk_comm_suppression_expiry_order" CHECK ((("expires_at" IS NULL) OR ("expires_at" > "suppressed_at"))),
    CONSTRAINT "chk_comm_suppression_policy_version" CHECK (("policy_version" ~ '^[A-Za-z0-9._:-]{1,64}$'::"text")),
    CONSTRAINT "chk_comm_suppression_reason" CHECK (("reason" = ANY (ARRAY['unspecified'::"text", 'user_stop'::"text", 'provider_block'::"text", 'hard_bounce'::"text", 'complaint'::"text", 'admin'::"text", 'legal'::"text", 'abuse'::"text"]))),
    CONSTRAINT "communication_suppressions_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'rcs'::"text"]))),
    CONSTRAINT "communication_suppressions_scope_check" CHECK (("scope" = ANY (ARRAY['marketing'::"text", 'transactional'::"text", 'global'::"text"]))),
    CONSTRAINT "communication_suppressions_source_check" CHECK (("source" = ANY (ARRAY['system'::"text", 'user'::"text", 'admin'::"text", 'provider'::"text", 'import'::"text"])))
);



COMMENT ON TABLE "public"."communication_suppressions" IS 'Phase 5F-D2-B: CURRENT materialized destination-prohibition projection (hash-keyed, scope-aware). A row may remain physically is_active until a controlled writer/sweeper deactivates it; readers MUST compute effective activity as is_active AND (expires_at IS NULL OR expires_at > evaluatedAt) at read time. Authoritative history is communication_consent_events; rows are mutated ONLY by the future controlled writer.';




COMMENT ON COLUMN "public"."communication_suppressions"."deactivated_at" IS 'Phase 5F-D2-B: when is_active flipped to false (invariant: is_active=false <=> deactivated_at present). Deterministic ordering only; never derived from the wall clock in a CHECK.';




COMMENT ON COLUMN "public"."communication_suppressions"."last_event_id" IS 'Phase 5F-D2-B: FK to the communication_consent_events row that produced this current state (ON DELETE RESTRICT; evidence is immutable).';




CREATE TABLE IF NOT EXISTS "public"."communication_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_key" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "category" "text" NOT NULL,
    "description" "text",
    "language" "text" DEFAULT 'en'::"text" NOT NULL,
    "version" "text" NOT NULL,
    "provider_template_name" "text",
    "provider_template_id" "text",
    "readiness_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "communication_templates_category_check" CHECK (("category" = ANY (ARRAY['authentication'::"text", 'business'::"text"]))),
    CONSTRAINT "communication_templates_channel_vocab_chk" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text", 'rcs'::"text"]))),
    CONSTRAINT "communication_templates_readiness_status_check" CHECK (("readiness_status" = ANY (ARRAY['draft'::"text", 'mock_ready'::"text", 'provider_mapping_required'::"text", 'provider_ready'::"text", 'disabled'::"text"])))
);



CREATE TABLE IF NOT EXISTS "public"."communication_webhook_receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "provider_event_id" "text",
    "payload_hash" "text" NOT NULL,
    "signature_valid" boolean NOT NULL,
    "normalized_event_type" "text",
    "processing_status" "text" DEFAULT 'received'::"text" NOT NULL,
    "duplicate_count" integer DEFAULT 0 NOT NULL,
    "last_duplicate_at" timestamp with time zone,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "failure_reason_sanitized" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provider_account_id" "uuid",
    CONSTRAINT "communication_webhook_receipts_normalized_event_type_check" CHECK (("normalized_event_type" = ANY (ARRAY['accepted'::"text", 'sent'::"text", 'delivered'::"text", 'read'::"text", 'failed'::"text"]))),
    CONSTRAINT "communication_webhook_receipts_processing_status_chk" CHECK (("processing_status" = ANY (ARRAY['received'::"text", 'verified'::"text", 'processed'::"text", 'duplicate'::"text", 'rejected'::"text", 'failed'::"text", 'ignored'::"text"])))
);



CREATE TABLE IF NOT EXISTS "public"."free_vendor_profile_interests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "text" NOT NULL,
    "lead_id" "text",
    "client_name" "text",
    "client_phone_masked" "text",
    "client_phone_hash" "text",
    "city" "text",
    "area" "text",
    "category" "text",
    "subcategory" "text",
    "interest_type" "text" DEFAULT 'profile_contact_request'::"text" NOT NULL,
    "status" "text" DEFAULT 'interest_captured'::"text" NOT NULL,
    "vendor_notified" boolean DEFAULT false NOT NULL,
    "vendor_notified_at" timestamp with time zone,
    "aos_event_id" "text",
    "n8n_preview_called" boolean DEFAULT false NOT NULL,
    "unlocked_after_payment" boolean DEFAULT false NOT NULL,
    "admin_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



CREATE TABLE IF NOT EXISTS "public"."lead_assignment_approvals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "text" NOT NULL,
    "selected_vendor_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "selected_vendor_count" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'preview_approved'::"text" NOT NULL,
    "mode" "text" DEFAULT 'preview'::"text" NOT NULL,
    "approval_note" "text",
    "approved_by" "text",
    "aos_event_emitted" boolean DEFAULT false NOT NULL,
    "n8n_webhook_called" boolean DEFAULT false NOT NULL,
    "side_effects" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "lead_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "vendor_snapshot" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "event_response" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "failure_reason" "text",
    "approval_source" "text" DEFAULT 'admin_preview'::"text" NOT NULL,
    CONSTRAINT "lead_assignment_approvals_max_three_vendors" CHECK (("selected_vendor_count" <= 3)),
    CONSTRAINT "lead_assignment_approvals_mode_check" CHECK (("mode" = 'preview'::"text")),
    CONSTRAINT "lead_assignment_approvals_selected_vendor_count_check" CHECK (("selected_vendor_count" <= 3)),
    CONSTRAINT "lead_assignment_approvals_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'preview_approved'::"text", 'preview_sent_to_aos'::"text", 'cancelled'::"text"])))
);



COMMENT ON TABLE "public"."lead_assignment_approvals" IS 'Phase 13: Superadmin preview/draft lead->vendor assignment approvals. PREVIEW ONLY. Never assigns leads, notifies vendors, sends WhatsApp, or deducts credits. Max 3 vendors enforced by CHECK.';




CREATE TABLE IF NOT EXISTS "public"."lead_assignment_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "text" NOT NULL,
    "city" "text",
    "category" "text",
    "subcategory" "text",
    "queue_status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "queue_reason" "text" NOT NULL,
    "required_vendor_count" integer DEFAULT 1 NOT NULL,
    "eligible_vendor_count" integer DEFAULT 0 NOT NULL,
    "selected_vendor_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "rejected_vendor_reasons" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "last_checked_at" timestamp with time zone,
    "next_retry_at" timestamp with time zone,
    "matching_attempt_count" integer DEFAULT 0 NOT NULL,
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



CREATE TABLE IF NOT EXISTS "public"."lead_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid",
    "vendor_id" "uuid",
    "assigned_at" timestamp with time zone DEFAULT "now"(),
    "assignment_type" "text",
    "vendor_status" "text" DEFAULT 'New'::"text",
    "credit_deducted" boolean DEFAULT true,
    "is_bad_lead_reported" boolean DEFAULT false,
    "requirement_group_id" "uuid",
    "assignment_source" "text",
    "assignment_metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "lead_assignments_assignment_type_check" CHECK (("assignment_type" = ANY (ARRAY['client_selected'::"text", 'auto_assigned'::"text", 'admin_assigned'::"text"]))),
    CONSTRAINT "lead_assignments_vendor_status_check" CHECK ((("vendor_status" IS NULL) OR ("vendor_status" = ANY (ARRAY['New'::"text", 'Contacted'::"text", 'Follow-up Needed'::"text", 'Site Visit Scheduled'::"text", 'Quotation Sent'::"text", 'Converted'::"text", 'Won'::"text", 'Lost'::"text"]))))
);



CREATE TABLE IF NOT EXISTS "public"."lead_auto_assignment_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "text" NOT NULL,
    "mode" "text" DEFAULT 'preview'::"text" NOT NULL,
    "status" "text" NOT NULL,
    "city" "text",
    "category" "text",
    "subcategory" "text",
    "eligible_vendor_count" integer DEFAULT 0 NOT NULL,
    "selected_vendor_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "rejected_vendor_reasons" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "scoring_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "queue_reason" "text",
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



CREATE TABLE IF NOT EXISTS "public"."lead_clarification_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid",
    "score_before" integer,
    "score_class_before" "text",
    "parent_category_group" "text",
    "marketplace_category" "text",
    "service_required" "text",
    "subcategory" "text",
    "missing_fields" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "questions_json" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "preview_message" "text",
    "status" "text" DEFAULT 'preview_prepared'::"text" NOT NULL,
    "sent_preview_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "response_received_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "text" DEFAULT 'system'::"text" NOT NULL
);



CREATE TABLE IF NOT EXISTS "public"."lead_clarification_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid",
    "request_id" "uuid",
    "question_key" "text" NOT NULL,
    "answer_value" "text" NOT NULL,
    "answer_label" "text",
    "mapped_field" "text",
    "mapped_value" "text",
    "raw_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



CREATE TABLE IF NOT EXISTS "public"."lead_delivery_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "assignment_id" "uuid",
    "delivery_channel" "text" DEFAULT 'vendor_dashboard'::"text" NOT NULL,
    "delivery_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "contact_shared" boolean DEFAULT false NOT NULL,
    "credit_deducted" boolean DEFAULT false NOT NULL,
    "whatsapp_preview_message" "text",
    "whatsapp_status" "text" DEFAULT 'preview_only'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "failure_reason" "text",
    "credit_log_id" "uuid",
    "assignment_source" "text"
);



CREATE TABLE IF NOT EXISTS "public"."lead_matching_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "run_status" "text" DEFAULT 'started'::"text" NOT NULL,
    "consent_confirmed" boolean DEFAULT false NOT NULL,
    "max_vendors" integer DEFAULT 3 NOT NULL,
    "eligible_vendor_count" integer DEFAULT 0 NOT NULL,
    "selected_vendor_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "assigned_vendor_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "failure_reason" "text",
    "matching_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "matched_vendor_count" integer DEFAULT 0,
    "delivered_vendor_count" integer DEFAULT 0,
    "failed_vendor_count" integer DEFAULT 0,
    "skipped_vendor_count" integer DEFAULT 0,
    "skipped_reasons" "jsonb" DEFAULT '{}'::"jsonb",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);



CREATE TABLE IF NOT EXISTS "public"."lead_scores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid",
    "contact_score" integer DEFAULT 0 NOT NULL,
    "location_score" integer DEFAULT 0 NOT NULL,
    "requirement_score" integer DEFAULT 0 NOT NULL,
    "intent_score" integer DEFAULT 0 NOT NULL,
    "fraud_penalty" integer DEFAULT 0 NOT NULL,
    "total_score" integer DEFAULT 0 NOT NULL,
    "score_class" "text" NOT NULL,
    "hard_block_reason" "text",
    "recommended_action" "text" NOT NULL,
    "score_breakdown" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "text" DEFAULT 'system'::"text" NOT NULL
);



CREATE TABLE IF NOT EXISTS "public"."lead_status_updates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "lead_assignment_id" "uuid",
    "vendor_id" "uuid",
    "status" "text",
    "notes" "text"
);



CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "name" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "city" "text" NOT NULL,
    "area" "text",
    "service_required" "text" NOT NULL,
    "budget" "text",
    "property_type" "text",
    "timeline" "text",
    "message" "text",
    "verification_status" "text" DEFAULT 'Pending'::"text",
    "source" "text" DEFAULT 'Website'::"text",
    "status" "text" DEFAULT 'New'::"text",
    "is_duplicate" boolean DEFAULT false,
    "duplicate_of" "uuid",
    "vendor_contact_share_consent" boolean DEFAULT false NOT NULL,
    "vendor_contact_share_consent_at" timestamp with time zone,
    "vendor_contact_share_consent_text" "text",
    "email" "text",
    "locality" "text",
    "category" "text",
    "subcategory" "text",
    "project_size" "text",
    "utm_source" "text",
    "utm_campaign" "text",
    "utm_medium" "text",
    "page_url" "text",
    "lead_quality_score" integer,
    "lead_priority" "text",
    "internal_notes" "text",
    "follow_up_date" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "source_url" "text",
    "utm_term" "text",
    "utm_content" "text",
    "location_consent" boolean DEFAULT false,
    "share_consent" boolean DEFAULT false,
    "requirement_group_id" "uuid",
    "parent_category_group" "text",
    "selected_vendor_id" "uuid",
    "selected_vendor_name" "text",
    "assignment_intent" "text",
    "client_selection_deadline_at" timestamp with time zone,
    "preferred_vendor_id" "uuid",
    "preferred_vendor_status" "text",
    "preferred_vendor_status_reason" "text",
    "lead_intent" "text",
    "target_vendor_id" "uuid",
    "target_vendor_name" "text",
    "target_vendor_category" "text",
    "target_vendor_subcategory" "text",
    "preferred_vendor_checked_at" timestamp with time zone,
    "fallback_allowed" boolean DEFAULT true,
    "clarification_status" "text",
    "clarification_required" boolean DEFAULT false,
    "clarification_missing_fields" "text"[],
    "clarification_last_request_id" "uuid",
    "clarification_checked_at" timestamp with time zone,
    "latitude" double precision,
    "longitude" double precision,
    "location_accuracy_meters" double precision,
    "location_source" "text",
    "location_captured_at" timestamp with time zone,
    "google_place_id" "text",
    "formatted_address" "text",
    "area_normalized" "text",
    "sublocality" "text",
    "neighborhood" "text",
    "postal_code" "text",
    "lead_quality_class" "text",
    "lead_quality_status" "text",
    "lead_quality_hard_block_reason" "text",
    "lead_quality_recommended_action" "text",
    "lead_quality_checked_at" timestamp with time zone,
    "client_note" "text",
    CONSTRAINT "leads_status_check" CHECK (("status" = ANY (ARRAY['New'::"text", 'Verified'::"text", 'Assigned'::"text", 'Contacted'::"text", 'Site Visit Scheduled'::"text", 'Quotation Sent'::"text", 'Converted'::"text", 'Won'::"text", 'Lost'::"text", 'Duplicate'::"text", 'Bad Lead'::"text", 'Quality Checked'::"text", 'Hot Lead'::"text", 'Clarification Required'::"text", 'Nurture'::"text", 'Rejected Quality'::"text"]))),
    CONSTRAINT "leads_verification_status_check" CHECK (("verification_status" = ANY (ARRAY['Pending'::"text", 'Verified'::"text", 'Rejected'::"text", 'Quality Pending'::"text", 'Quality Checked'::"text", 'Manual Review'::"text", 'Rejected Quality'::"text"])))
);



COMMENT ON COLUMN "public"."leads"."preferred_vendor_status" IS 'Outcome of preferred-vendor routing: assigned_immediately, preferred_vendor_no_credits, preferred_vendor_not_eligible, preferred_vendor_pending.';




COMMENT ON COLUMN "public"."leads"."lead_intent" IS 'How the lead was routed: general_auto_match or preferred_vendor.';




COMMENT ON COLUMN "public"."leads"."target_vendor_id" IS 'The vendor selected by the client from a specific vendor CTA.';




COMMENT ON COLUMN "public"."leads"."fallback_allowed" IS 'Whether QuickFurno may fallback to matching other vendors if preferred vendor cannot receive lead.';




COMMENT ON COLUMN "public"."leads"."location_source" IS 'How the coordinates were captured: manual | browser_gps | google_place | reverse_geocode. Phase 1 foundation for Google-area matching.';




COMMENT ON COLUMN "public"."leads"."area_normalized" IS 'Normalized locality/area string (from Google Place / reverse geocode) for future area-based vendor matching. Phase 1 foundation.';




COMMENT ON COLUMN "public"."leads"."client_note" IS 'Genuine client-typed enquiry note (Lead Quality V2). Populated only when the client actually typed/edited the note; used for real-detail / explicit-intent scoring at creation AND re-score. Never metadata or prefilled CTA text.';




CREATE TABLE IF NOT EXISTS "public"."marketplace_runtime_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "value" "jsonb" DEFAULT 'false'::"jsonb" NOT NULL,
    "description" "text",
    "updated_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);



CREATE TABLE IF NOT EXISTS "public"."packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "name" "text" NOT NULL,
    "lead_count" integer NOT NULL,
    "price_per_lead" numeric NOT NULL,
    "total_price" numeric NOT NULL,
    "display_price" numeric NOT NULL,
    "validity_days" integer NOT NULL,
    "is_active" boolean DEFAULT true
);



CREATE TABLE IF NOT EXISTS "public"."password_reset_grants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "uuid",
    "user_id" "uuid" NOT NULL,
    "grant_token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "vendor_dashboard_user_id" "uuid",
    "challenge_id" "uuid",
    "revoked_at" timestamp with time zone
);



CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "vendor_id" "uuid",
    "package_id" "uuid",
    "amount" numeric,
    "payment_method" "text",
    "payment_status" "text" DEFAULT 'Pending'::"text",
    "transaction_id" "text",
    "admin_notes" "text",
    CONSTRAINT "payments_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['Pending'::"text", 'Paid'::"text", 'Failed'::"text", 'Refunded'::"text"])))
);



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "full_name" "text",
    "phone" "text",
    "role" "text",
    "is_active" boolean DEFAULT true,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'vendor'::"text"])))
);



CREATE TABLE IF NOT EXISTS "public"."service_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text",
    "is_active" boolean DEFAULT true
);



CREATE TABLE IF NOT EXISTS "public"."vendor_credit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "change_type" "text" NOT NULL,
    "credits_before" integer DEFAULT 0 NOT NULL,
    "credits_delta" integer DEFAULT 0 NOT NULL,
    "credits_after" integer DEFAULT 0 NOT NULL,
    "reason" "text",
    "updated_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reference_type" "text",
    "reference_id" "text",
    CONSTRAINT "vendor_credit_logs_change_type_check" CHECK (("change_type" = ANY (ARRAY['package_purchase'::"text", 'admin_credit_grant'::"text", 'lead_assignment_debit'::"text", 'invalid_lead_refund'::"text", 'manual_adjustment'::"text", 'manual_add'::"text", 'manual_set'::"text", 'manual_remove'::"text", 'package_credit'::"text", 'preview_test'::"text", 'correction'::"text"])))
);



COMMENT ON TABLE "public"."vendor_credit_logs" IS 'Phase 13B: audit trail of manual vendor credit changes made by admins. No automatic deduction is recorded here. Admin-only RLS.';




CREATE TABLE IF NOT EXISTS "public"."vendor_dashboard_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "phone" "text",
    "email" "text",
    "role" "text" DEFAULT 'owner'::"text",
    "status" "text" DEFAULT 'active'::"text",
    "phone_verified" boolean DEFAULT false,
    "whatsapp_otp_enabled" boolean DEFAULT false,
    "last_login_method" "text",
    "last_login_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "phone_e164" "text",
    "whatsapp_verified_at" timestamp with time zone,
    CONSTRAINT "vendor_dashboard_users_phone_e164_format_chk" CHECK ((("phone_e164" IS NULL) OR ("phone_e164" ~ '^\+[1-9][0-9]{7,14}$'::"text")))
);



CREATE TABLE IF NOT EXISTS "public"."vendor_lead_activity_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "lead_id" "uuid",
    "assignment_id" "uuid",
    "activity_type" "text" NOT NULL,
    "activity_note" "text",
    "created_by" "text" DEFAULT 'system'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vendor_lead_activity_logs_type_check" CHECK (("activity_type" = ANY (ARRAY['matched'::"text", 'delivered_to_dashboard'::"text", 'whatsapp_preview_created'::"text", 'client_vendor_details_preview_created'::"text", 'credit_deducted'::"text", 'viewed_masked_lead'::"text", 'viewed_unlocked_contact'::"text", 'marked_contacted'::"text", 'marked_interested'::"text", 'marked_not_interested'::"text", 'marked_converted'::"text", 'reported_bad_lead'::"text"])))
);



CREATE TABLE IF NOT EXISTS "public"."vendor_lead_report_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_id" "uuid" NOT NULL,
    "sender_type" "text" NOT NULL,
    "sender_id" "uuid",
    "comment" "text" NOT NULL,
    "is_internal" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vendor_lead_report_comments_sender_type_check" CHECK (("sender_type" = ANY (ARRAY['vendor'::"text", 'admin'::"text", 'system'::"text"])))
);



CREATE TABLE IF NOT EXISTS "public"."vendor_lead_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "lead_id" "uuid",
    "assignment_id" "uuid",
    "report_type" "text" NOT NULL,
    "report_reason" "text" NOT NULL,
    "vendor_comment" "text",
    "status" "text" DEFAULT 'pending_review'::"text" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "admin_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vendor_lead_reports_status_check" CHECK (("status" = ANY (ARRAY['pending_review'::"text", 'under_review'::"text", 'valid_report'::"text", 'invalid_report'::"text", 'resolved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "vendor_lead_reports_type_check" CHECK (("report_type" = ANY (ARRAY['bad_lead'::"text", 'duplicate_lead'::"text", 'wrong_category'::"text", 'unreachable_client'::"text", 'fake_enquiry'::"text", 'outside_service_area'::"text", 'budget_mismatch'::"text", 'client_denied_enquiry'::"text", 'other'::"text"])))
);



CREATE TABLE IF NOT EXISTS "public"."vendor_mobile_auth_provisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "phone" "text" NOT NULL,
    "whatsapp_otp_ready" boolean DEFAULT false,
    "preferred_otp_channel" "text" DEFAULT 'whatsapp_future'::"text",
    "provider_name" "text",
    "provider_status" "text" DEFAULT 'not_configured'::"text",
    "last_otp_requested_at" timestamp with time zone,
    "last_verified_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);



CREATE TABLE IF NOT EXISTS "public"."vendor_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "notification_type" "text" DEFAULT 'general'::"text",
    "priority" "text" DEFAULT 'normal'::"text",
    "cta_label" "text",
    "cta_url" "text",
    "is_read" boolean DEFAULT false,
    "read_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "type" "text" DEFAULT 'general'::"text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);



CREATE TABLE IF NOT EXISTS "public"."vendor_package_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "package_id" "uuid",
    "package_name" "text",
    "package_price" numeric,
    "package_currency" "text" DEFAULT 'INR'::"text",
    "credits_included" integer,
    "validity_days" integer,
    "order_status" "text" DEFAULT 'created'::"text",
    "payment_status" "text" DEFAULT 'not_started'::"text",
    "payment_method" "text" DEFAULT 'online_future'::"text",
    "payment_provider" "text" DEFAULT 'not_connected'::"text",
    "provider_order_id" "text",
    "provider_payment_id" "text",
    "provider_status" "text",
    "paid_at" timestamp with time zone,
    "activated_at" timestamp with time zone,
    "activation_status" "text" DEFAULT 'not_activated'::"text",
    "failure_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);



CREATE TABLE IF NOT EXISTS "public"."vendor_package_purchase_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "package_id" "uuid",
    "package_name" "text",
    "package_price" numeric,
    "requested_credits" integer,
    "request_type" "text" DEFAULT 'package_purchase'::"text",
    "payment_method" "text" DEFAULT 'manual'::"text",
    "payment_reference" "text",
    "payment_screenshot_url" "text",
    "vendor_note" "text",
    "status" "text" DEFAULT 'pending_review'::"text",
    "admin_note" "text",
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "payment_provider" "text" DEFAULT 'manual_future'::"text",
    "provider_order_id" "text",
    "provider_payment_id" "text",
    "provider_status" "text" DEFAULT 'not_connected'::"text",
    CONSTRAINT "vendor_package_purchase_requests_status_check" CHECK (("status" = ANY (ARRAY['pending_review'::"text", 'approved'::"text", 'rejected'::"text", 'cancelled'::"text", 'manual_activation_required'::"text"])))
);



COMMENT ON TABLE "public"."vendor_package_purchase_requests" IS 'Phase 25B-1A: vendor-initiated package purchase/recharge requests. Admin approval is required before activation. No gateway integration.';




COMMENT ON COLUMN "public"."vendor_package_purchase_requests"."payment_provider" IS 'Future provider placeholder only: Razorpay, Cashfree, UPI intent/QR, Stripe if needed later. No provider is connected in Phase 25B-1A.';




CREATE TABLE IF NOT EXISTS "public"."vendor_packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "uuid",
    "package_id" "uuid",
    "purchase_date" timestamp with time zone DEFAULT "now"(),
    "expiry_date" timestamp with time zone,
    "total_leads" integer,
    "remaining_leads" integer,
    "price_paid" numeric,
    "payment_status" "text" DEFAULT 'Pending'::"text",
    "status" "text" DEFAULT 'Active'::"text",
    CONSTRAINT "vendor_packages_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['Pending'::"text", 'Paid'::"text", 'Failed'::"text", 'Refunded'::"text"]))),
    CONSTRAINT "vendor_packages_status_check" CHECK (("status" = ANY (ARRAY['Active'::"text", 'Expired'::"text", 'Consumed'::"text", 'Cancelled'::"text"])))
);



CREATE TABLE IF NOT EXISTS "public"."vendor_profile_change_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "requested_by" "uuid",
    "request_type" "text" DEFAULT 'profile_update'::"text",
    "proposed_changes" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "current_snapshot" "jsonb",
    "status" "text" DEFAULT 'pending'::"text",
    "admin_notes" "text",
    "rejection_reason" "text",
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "vendor_profile_change_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'cancelled'::"text"])))
);



CREATE TABLE IF NOT EXISTS "public"."vendor_support_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "thread_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "sender_type" "text" NOT NULL,
    "sender_id" "uuid",
    "message" "text" NOT NULL,
    "is_internal" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);



CREATE TABLE IF NOT EXISTS "public"."vendor_support_threads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "subject" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text",
    "priority" "text" DEFAULT 'normal'::"text",
    "created_by_vendor" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);



CREATE TABLE IF NOT EXISTS "public"."vendors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "business_name" "text" NOT NULL,
    "owner_name" "text",
    "phone" "text" NOT NULL,
    "email" "text",
    "city" "text" NOT NULL,
    "areas_covered" "text"[],
    "covers_full_city" boolean DEFAULT false,
    "service_categories" "text"[],
    "experience" "text",
    "portfolio_urls" "text"[],
    "profile_image_url" "text",
    "gst_number" "text",
    "rating" numeric DEFAULT 0,
    "completed_projects" integer DEFAULT 0,
    "status" "text" DEFAULT 'Pending'::"text",
    "total_credits" integer DEFAULT 0,
    "remaining_credits" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "last_assigned_at" timestamp with time zone,
    "public_visibility" boolean DEFAULT false,
    "message" "text",
    "whatsapp_number" "text",
    "location_permission_status" "text" DEFAULT 'not_requested'::"text",
    "latitude" numeric,
    "longitude" numeric,
    "service_radius_km" integer,
    "business_type" "text",
    "team_size" "text",
    "monthly_capacity" "text",
    "starting_price" "text",
    "verification_status" "text" DEFAULT 'Pending'::"text",
    "paid_status" "text" DEFAULT 'Unpaid'::"text",
    "source_url" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "office_address_line1" "text",
    "office_address_line2" "text",
    "office_landmark" "text",
    "office_city" "text",
    "office_state" "text",
    "office_pincode" "text",
    "office_latitude" numeric,
    "office_longitude" numeric,
    "package_name" "text",
    "package_status" "text" DEFAULT 'none'::"text" NOT NULL,
    "package_expires_at" timestamp with time zone,
    "public_description" "text",
    "public_business_hours" "text",
    "public_service_area_summary" "text",
    "cover_image_url" "text",
    "selected_category" "text",
    "selected_subcategories" "text"[],
    "custom_service_area" "text",
    "years_experience" "text",
    "google_place_id" "text",
    "formatted_address" "text",
    "area_normalized" "text",
    "sublocality" "text",
    "neighborhood" "text",
    "accepting_leads" boolean DEFAULT true NOT NULL,
    CONSTRAINT "vendors_package_status_check" CHECK (("package_status" = ANY (ARRAY['none'::"text", 'active'::"text", 'expired'::"text", 'cancelled'::"text", 'trial'::"text"]))),
    CONSTRAINT "vendors_status_check" CHECK (("status" = ANY (ARRAY['Pending'::"text", 'Approved'::"text", 'Rejected'::"text", 'Suspended'::"text"])))
);



COMMENT ON COLUMN "public"."vendors"."area_normalized" IS 'Normalized locality/area string aligned with leads.area_normalized for future Google-area matching. Phase 1 foundation.';




COMMENT ON COLUMN "public"."vendors"."accepting_leads" IS 'Phase 4 credit-wallet: vendor temporary availability for NEW enquiries. true=wants leads, false=paused. Distinct from is_active/package_status/public_visibility. Default true so existing delivery is never silently stopped.';




CREATE TABLE IF NOT EXISTS "public"."verification_challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "principal_type" "text" NOT NULL,
    "principal_id" "uuid",
    "purpose" "text" NOT NULL,
    "destination_hash" "text" NOT NULL,
    "otp_hash" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 5 NOT NULL,
    "resend_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "verified_at" timestamp with time zone,
    "consumed_at" timestamp with time zone,
    "vendor_dashboard_user_id" "uuid",
    "user_id" "uuid",
    "vendor_id" "uuid",
    "last_sent_at" timestamp with time zone,
    "last_attempt_at" timestamp with time zone,
    "delivery_channel" "text",
    "delivery_provider" "text",
    "communication_message_id" "uuid",
    CONSTRAINT "verification_challenges_delivery_channel_chk" CHECK ((("delivery_channel" IS NULL) OR ("delivery_channel" = ANY (ARRAY['whatsapp'::"text", 'sms'::"text"])))),
    CONSTRAINT "verification_challenges_principal_type_check" CHECK (("principal_type" = ANY (ARRAY['anonymous'::"text", 'client'::"text", 'vendor'::"text", 'admin'::"text", 'integration'::"text", 'system'::"text"]))),
    CONSTRAINT "verification_challenges_purpose_check" CHECK (("purpose" = ANY (ARRAY['vendor_whatsapp_verify'::"text", 'vendor_password_reset'::"text"]))),
    CONSTRAINT "verification_challenges_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'verified'::"text", 'consumed'::"text", 'expired'::"text", 'locked'::"text", 'cancelled'::"text"])))
);



CREATE TABLE IF NOT EXISTS "public"."whatsapp_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "recipient_type" "text",
    "recipient_id" "uuid",
    "phone" "text",
    "message" "text",
    "template_name" "text",
    "status" "text" DEFAULT 'Pending'::"text",
    "error_message" "text",
    CONSTRAINT "whatsapp_logs_recipient_type_check" CHECK (("recipient_type" = ANY (ARRAY['client'::"text", 'vendor'::"text", 'admin'::"text"]))),
    CONSTRAINT "whatsapp_logs_status_check" CHECK (("status" = ANY (ARRAY['Pending'::"text", 'Sent'::"text", 'Failed'::"text"])))
);



ALTER TABLE ONLY "public"."aos_runtime_settings"
    ADD CONSTRAINT "aos_runtime_settings_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."aos_runtime_settings"
    ADD CONSTRAINT "aos_runtime_settings_setting_key_key" UNIQUE ("setting_key");




ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key");




ALTER TABLE ONLY "public"."auth_security_events"
    ADD CONSTRAINT "auth_security_events_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."authentication_delivery_attempts"
    ADD CONSTRAINT "authentication_delivery_attempts_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."authentication_transport_failure_rules"
    ADD CONSTRAINT "authentication_transport_failure_rules_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."authentication_transport_policies"
    ADD CONSTRAINT "authentication_transport_policies_pkey" PRIMARY KEY ("auth_flow");




ALTER TABLE ONLY "public"."bad_lead_report_comments"
    ADD CONSTRAINT "bad_lead_report_comments_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."bad_lead_reports"
    ADD CONSTRAINT "bad_lead_reports_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."cities"
    ADD CONSTRAINT "cities_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."cities"
    ADD CONSTRAINT "cities_slug_key" UNIQUE ("slug");




ALTER TABLE ONLY "public"."client_accounts"
    ADD CONSTRAINT "client_accounts_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."client_notification_logs"
    ADD CONSTRAINT "client_notification_logs_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."client_requirement_groups"
    ADD CONSTRAINT "client_requirement_groups_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."communication_automation_catalog"
    ADD CONSTRAINT "communication_automation_catalog_pkey" PRIMARY KEY ("automation_key");




ALTER TABLE ONLY "public"."communication_channel_capabilities"
    ADD CONSTRAINT "communication_channel_capabilities_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."communication_consent_ack_intents"
    ADD CONSTRAINT "communication_consent_ack_intents_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."communication_consent_command_receipts"
    ADD CONSTRAINT "communication_consent_command_receipts_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."communication_consent_events"
    ADD CONSTRAINT "communication_consent_events_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."communication_delivery_events"
    ADD CONSTRAINT "communication_delivery_events_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."communication_inbound_messages"
    ADD CONSTRAINT "communication_inbound_messages_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."communication_messages"
    ADD CONSTRAINT "communication_messages_idempotency_key_key" UNIQUE ("idempotency_key");




ALTER TABLE ONLY "public"."communication_messages"
    ADD CONSTRAINT "communication_messages_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."communication_preferences"
    ADD CONSTRAINT "communication_preferences_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."communication_provider_accounts"
    ADD CONSTRAINT "communication_provider_accounts_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."communication_provider_canary_destinations"
    ADD CONSTRAINT "communication_provider_canary_destinations_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."communication_provider_runtime_policies"
    ADD CONSTRAINT "communication_provider_runtime_policies_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."communication_provider_template_mappings"
    ADD CONSTRAINT "communication_provider_template_mappings_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."communication_suppressions"
    ADD CONSTRAINT "communication_suppressions_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."communication_templates"
    ADD CONSTRAINT "communication_templates_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."communication_templates"
    ADD CONSTRAINT "communication_templates_template_key_key" UNIQUE ("template_key");




ALTER TABLE ONLY "public"."communication_webhook_receipts"
    ADD CONSTRAINT "communication_webhook_receipts_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."free_vendor_profile_interests"
    ADD CONSTRAINT "free_vendor_profile_interests_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."lead_assignment_approvals"
    ADD CONSTRAINT "lead_assignment_approvals_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."lead_assignment_queue"
    ADD CONSTRAINT "lead_assignment_queue_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."lead_assignments"
    ADD CONSTRAINT "lead_assignments_lead_id_vendor_id_key" UNIQUE ("lead_id", "vendor_id");




ALTER TABLE ONLY "public"."lead_assignments"
    ADD CONSTRAINT "lead_assignments_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."lead_auto_assignment_logs"
    ADD CONSTRAINT "lead_auto_assignment_logs_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."lead_clarification_requests"
    ADD CONSTRAINT "lead_clarification_requests_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."lead_clarification_responses"
    ADD CONSTRAINT "lead_clarification_responses_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."lead_delivery_logs"
    ADD CONSTRAINT "lead_delivery_logs_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."lead_matching_runs"
    ADD CONSTRAINT "lead_matching_runs_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."lead_scores"
    ADD CONSTRAINT "lead_scores_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."lead_status_updates"
    ADD CONSTRAINT "lead_status_updates_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."marketplace_runtime_settings"
    ADD CONSTRAINT "marketplace_runtime_settings_key_key" UNIQUE ("key");




ALTER TABLE ONLY "public"."marketplace_runtime_settings"
    ADD CONSTRAINT "marketplace_runtime_settings_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."password_reset_grants"
    ADD CONSTRAINT "password_reset_grants_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."service_categories"
    ADD CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."service_categories"
    ADD CONSTRAINT "service_categories_slug_key" UNIQUE ("slug");




ALTER TABLE ONLY "public"."communication_channel_capabilities"
    ADD CONSTRAINT "uq_comm_channel_capability" UNIQUE ("destination_hash", "channel", "provider_key");




ALTER TABLE ONLY "public"."communication_preferences"
    ADD CONSTRAINT "uq_comm_preference" UNIQUE ("principal_type", "principal_id", "channel", "scope");




ALTER TABLE ONLY "public"."communication_provider_accounts"
    ADD CONSTRAINT "uq_comm_provider_account" UNIQUE ("provider_key", "channel", "phone_number_reference");




ALTER TABLE ONLY "public"."communication_provider_runtime_policies"
    ADD CONSTRAINT "uq_comm_provider_runtime_policy" UNIQUE ("provider_key", "channel");




ALTER TABLE ONLY "public"."communication_consent_ack_intents"
    ADD CONSTRAINT "uq_consent_ack_intent_idempotency" UNIQUE ("idempotency_key");




ALTER TABLE ONLY "public"."communication_consent_command_receipts"
    ADD CONSTRAINT "uq_consent_command_receipt" UNIQUE ("provider", "provider_message_id", "channel");




ALTER TABLE ONLY "public"."vendor_credit_logs"
    ADD CONSTRAINT "vendor_credit_logs_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."vendor_dashboard_users"
    ADD CONSTRAINT "vendor_dashboard_users_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."vendor_dashboard_users"
    ADD CONSTRAINT "vendor_dashboard_users_vendor_id_phone_key" UNIQUE ("vendor_id", "phone");




ALTER TABLE ONLY "public"."vendor_lead_activity_logs"
    ADD CONSTRAINT "vendor_lead_activity_logs_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."vendor_lead_report_comments"
    ADD CONSTRAINT "vendor_lead_report_comments_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."vendor_lead_reports"
    ADD CONSTRAINT "vendor_lead_reports_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."vendor_mobile_auth_provisions"
    ADD CONSTRAINT "vendor_mobile_auth_provisions_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."vendor_mobile_auth_provisions"
    ADD CONSTRAINT "vendor_mobile_auth_provisions_vendor_id_phone_key" UNIQUE ("vendor_id", "phone");




ALTER TABLE ONLY "public"."vendor_notifications"
    ADD CONSTRAINT "vendor_notifications_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."vendor_package_orders"
    ADD CONSTRAINT "vendor_package_orders_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."vendor_package_purchase_requests"
    ADD CONSTRAINT "vendor_package_purchase_requests_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."vendor_packages"
    ADD CONSTRAINT "vendor_packages_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."vendor_profile_change_requests"
    ADD CONSTRAINT "vendor_profile_change_requests_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."vendor_support_messages"
    ADD CONSTRAINT "vendor_support_messages_pkey" PRIMARY KEY ("id");




ALTER TABLE "public"."vendor_support_messages"
    ADD CONSTRAINT "vendor_support_messages_sender_type_check" CHECK (("sender_type" = ANY (ARRAY['vendor'::"text", 'admin'::"text", 'system'::"text"]))) NOT VALID;




ALTER TABLE ONLY "public"."vendor_support_threads"
    ADD CONSTRAINT "vendor_support_threads_pkey" PRIMARY KEY ("id");




ALTER TABLE "public"."vendor_support_threads"
    ADD CONSTRAINT "vendor_support_threads_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'admin_replied'::"text", 'vendor_replied'::"text", 'closed'::"text"]))) NOT VALID;




ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."verification_challenges"
    ADD CONSTRAINT "verification_challenges_pkey" PRIMARY KEY ("id");




ALTER TABLE ONLY "public"."whatsapp_logs"
    ADD CONSTRAINT "whatsapp_logs_pkey" PRIMARY KEY ("id");




CREATE INDEX "idx_ack_intents_claimable" ON "public"."communication_consent_ack_intents" USING "btree" ("status", "expires_at") WHERE ("status" = ANY (ARRAY['pending'::"text", 'claimed'::"text"]));




CREATE INDEX "idx_ack_intents_dispatching" ON "public"."communication_consent_ack_intents" USING "btree" ("status", "locked_at") WHERE ("status" = 'dispatching'::"text");




CREATE INDEX "idx_ack_intents_inbound" ON "public"."communication_consent_ack_intents" USING "btree" ("inbound_message_id");




CREATE INDEX "idx_aos_runtime_settings_setting_key" ON "public"."aos_runtime_settings" USING "btree" ("setting_key");




CREATE INDEX "idx_aos_runtime_settings_updated_at" ON "public"."aos_runtime_settings" USING "btree" ("updated_at" DESC);




CREATE INDEX "idx_assignments_lead" ON "public"."lead_assignments" USING "btree" ("lead_id");




CREATE INDEX "idx_assignments_vendor" ON "public"."lead_assignments" USING "btree" ("vendor_id");




CREATE INDEX "idx_auth_delivery_attempt_action" ON "public"."authentication_delivery_attempts" USING "btree" ("auth_action_id", "attempt_number");




CREATE INDEX "idx_auth_delivery_attempt_challenge" ON "public"."authentication_delivery_attempts" USING "btree" ("challenge_id");




CREATE INDEX "idx_auth_delivery_attempt_reference" ON "public"."authentication_delivery_attempts" USING "btree" ("auth_reference_type", "auth_reference_id", "attempt_number");




CREATE INDEX "idx_auth_failure_rule_lookup" ON "public"."authentication_transport_failure_rules" USING "btree" ("primary_channel", "primary_provider_key", "failure_code", "is_active");




CREATE INDEX "idx_auth_security_events_principal" ON "public"."auth_security_events" USING "btree" ("principal_type", "principal_id", "created_at" DESC);




CREATE INDEX "idx_auth_security_events_type_created" ON "public"."auth_security_events" USING "btree" ("event_type", "created_at" DESC);




CREATE INDEX "idx_bad_lead_report_comments_report" ON "public"."bad_lead_report_comments" USING "btree" ("report_id", "created_at");




CREATE INDEX "idx_badreports_status" ON "public"."bad_lead_reports" USING "btree" ("status");




CREATE INDEX "idx_badreports_vendor_created" ON "public"."bad_lead_reports" USING "btree" ("vendor_id", "created_at" DESC);




CREATE INDEX "idx_client_notification_logs_lead_created" ON "public"."client_notification_logs" USING "btree" ("lead_id", "created_at" DESC);




CREATE INDEX "idx_comm_ack_intent_provider_account" ON "public"."communication_consent_ack_intents" USING "btree" ("provider_account_id") WHERE ("provider_account_id" IS NOT NULL);




CREATE INDEX "idx_comm_canary_lookup" ON "public"."communication_provider_canary_destinations" USING "btree" ("provider_key", "channel", "destination_hash", "is_active");




CREATE INDEX "idx_comm_channel_capability_lookup" ON "public"."communication_channel_capabilities" USING "btree" ("destination_hash", "channel", "provider_key", "capability_status");




CREATE INDEX "idx_comm_consent_event_destination" ON "public"."communication_consent_events" USING "btree" ("destination_hash", "channel", "scope", "occurred_at" DESC);




CREATE INDEX "idx_comm_consent_event_inbound" ON "public"."communication_consent_events" USING "btree" ("inbound_message_id") WHERE ("inbound_message_id" IS NOT NULL);




CREATE INDEX "idx_comm_consent_event_principal" ON "public"."communication_consent_events" USING "btree" ("principal_type", "principal_id", "channel", "scope", "occurred_at" DESC);




CREATE INDEX "idx_comm_consent_event_source_event" ON "public"."communication_consent_events" USING "btree" ("source_event_type", "source_event_id");




CREATE INDEX "idx_comm_delivery_event_message_id" ON "public"."communication_delivery_events" USING "btree" ("communication_message_id");




CREATE INDEX "idx_comm_delivery_event_provider_account" ON "public"."communication_delivery_events" USING "btree" ("provider_account_id") WHERE ("provider_account_id" IS NOT NULL);




CREATE INDEX "idx_comm_inbound_principal" ON "public"."communication_inbound_messages" USING "btree" ("resolved_principal_type", "resolved_principal_id") WHERE ("resolved_principal_id" IS NOT NULL);




CREATE INDEX "idx_comm_inbound_processing" ON "public"."communication_inbound_messages" USING "btree" ("processing_status");




CREATE INDEX "idx_comm_inbound_received" ON "public"."communication_inbound_messages" USING "btree" ("received_at" DESC);




CREATE INDEX "idx_comm_inbound_sender_hash" ON "public"."communication_inbound_messages" USING "btree" ("sender_hash", "provider");




CREATE INDEX "idx_comm_messages_client_login_attestation" ON "public"."communication_messages" USING "btree" ("entity_id", "destination_hash", "provider", "status", "created_at" DESC) WHERE (("message_type" = 'client_login_otp'::"text") AND ("lane" = 'authentication'::"text") AND ("entity_type" = 'auth_user'::"text"));




CREATE INDEX "idx_comm_preference_lookup" ON "public"."communication_preferences" USING "btree" ("principal_type", "principal_id", "channel", "scope");




CREATE INDEX "idx_comm_provider_account_channel_status" ON "public"."communication_provider_accounts" USING "btree" ("channel", "readiness_status");




CREATE INDEX "idx_comm_provider_runtime_policy_lookup" ON "public"."communication_provider_runtime_policies" USING "btree" ("provider_key", "channel", "activation_status");




CREATE INDEX "idx_comm_provider_template_lookup" ON "public"."communication_provider_template_mappings" USING "btree" ("template_key", "channel", "provider_key", "approval_status");




CREATE INDEX "idx_comm_suppression_lookup" ON "public"."communication_suppressions" USING "btree" ("destination_hash", "channel", "scope", "is_active");




CREATE INDEX "idx_comm_webhook_receipt_received" ON "public"."communication_webhook_receipts" USING "btree" ("received_at" DESC);




CREATE INDEX "idx_communication_messages_lookup" ON "public"."communication_messages" USING "btree" ("status", "lane", "recipient_type", "recipient_id");




CREATE INDEX "idx_communication_messages_provider_account" ON "public"."communication_messages" USING "btree" ("provider_account_id") WHERE ("provider_account_id" IS NOT NULL);




CREATE INDEX "idx_communication_messages_provider_message" ON "public"."communication_messages" USING "btree" ("provider", "provider_message_id") WHERE ("provider_message_id" IS NOT NULL);




CREATE INDEX "idx_communication_messages_retry" ON "public"."communication_messages" USING "btree" ("next_retry_at") WHERE ("status" = 'retry_scheduled'::"text");




CREATE INDEX "idx_communication_messages_scheduled" ON "public"."communication_messages" USING "btree" ("scheduled_at") WHERE ("status" = 'queued'::"text");




CREATE INDEX "idx_communication_templates_key_active" ON "public"."communication_templates" USING "btree" ("template_key", "is_active");




CREATE INDEX "idx_crg_autofill_due" ON "public"."client_requirement_groups" USING "btree" ("auto_fill_status", "client_selection_deadline_at");




CREATE INDEX "idx_crg_identity" ON "public"."client_requirement_groups" USING "btree" ("client_phone_normalized", "city", "parent_category_group", "status");




CREATE INDEX "idx_crg_preferred_recharge" ON "public"."client_requirement_groups" USING "btree" ("preferred_vendor_status", "preferred_vendor_recharge_deadline_at");




CREATE INDEX "idx_crg_status" ON "public"."client_requirement_groups" USING "btree" ("status");




CREATE INDEX "idx_free_vendor_profile_interests_created_at" ON "public"."free_vendor_profile_interests" USING "btree" ("created_at");




CREATE INDEX "idx_free_vendor_profile_interests_lead_id" ON "public"."free_vendor_profile_interests" USING "btree" ("lead_id");




CREATE INDEX "idx_free_vendor_profile_interests_status" ON "public"."free_vendor_profile_interests" USING "btree" ("status");




CREATE INDEX "idx_free_vendor_profile_interests_vendor_id" ON "public"."free_vendor_profile_interests" USING "btree" ("vendor_id");




CREATE INDEX "idx_lead_assignment_approvals_approval_source" ON "public"."lead_assignment_approvals" USING "btree" ("approval_source");




CREATE INDEX "idx_lead_assignment_approvals_created_at" ON "public"."lead_assignment_approvals" USING "btree" ("created_at" DESC);




CREATE INDEX "idx_lead_assignment_approvals_failure_reason" ON "public"."lead_assignment_approvals" USING "btree" ("failure_reason");




CREATE INDEX "idx_lead_assignment_approvals_lead_id" ON "public"."lead_assignment_approvals" USING "btree" ("lead_id");




CREATE INDEX "idx_lead_assignment_approvals_status" ON "public"."lead_assignment_approvals" USING "btree" ("status");




CREATE INDEX "idx_lead_assignment_queue_created_at" ON "public"."lead_assignment_queue" USING "btree" ("created_at");




CREATE INDEX "idx_lead_assignment_queue_lead_id" ON "public"."lead_assignment_queue" USING "btree" ("lead_id");




CREATE INDEX "idx_lead_assignment_queue_status" ON "public"."lead_assignment_queue" USING "btree" ("queue_status");




CREATE INDEX "idx_lead_assignments_requirement_group" ON "public"."lead_assignments" USING "btree" ("requirement_group_id");




CREATE INDEX "idx_lead_auto_assignment_logs_created_at" ON "public"."lead_auto_assignment_logs" USING "btree" ("created_at");




CREATE INDEX "idx_lead_auto_assignment_logs_lead_id" ON "public"."lead_auto_assignment_logs" USING "btree" ("lead_id");




CREATE INDEX "idx_lead_auto_assignment_logs_status" ON "public"."lead_auto_assignment_logs" USING "btree" ("status");




CREATE INDEX "idx_lead_clarification_requests_created_at" ON "public"."lead_clarification_requests" USING "btree" ("created_at");




CREATE INDEX "idx_lead_clarification_requests_lead_id" ON "public"."lead_clarification_requests" USING "btree" ("lead_id");




CREATE INDEX "idx_lead_clarification_requests_marketplace_category" ON "public"."lead_clarification_requests" USING "btree" ("marketplace_category");




CREATE INDEX "idx_lead_clarification_requests_status" ON "public"."lead_clarification_requests" USING "btree" ("status");




CREATE INDEX "idx_lead_clarification_responses_lead_id" ON "public"."lead_clarification_responses" USING "btree" ("lead_id");




CREATE INDEX "idx_lead_clarification_responses_question_key" ON "public"."lead_clarification_responses" USING "btree" ("question_key");




CREATE INDEX "idx_lead_clarification_responses_request_id" ON "public"."lead_clarification_responses" USING "btree" ("request_id");




CREATE INDEX "idx_lead_delivery_logs_assignment" ON "public"."lead_delivery_logs" USING "btree" ("assignment_id");




CREATE INDEX "idx_lead_delivery_logs_lead_vendor" ON "public"."lead_delivery_logs" USING "btree" ("lead_id", "vendor_id");




CREATE INDEX "idx_lead_matching_runs_lead_created" ON "public"."lead_matching_runs" USING "btree" ("lead_id", "created_at" DESC);




CREATE INDEX "idx_lead_scores_created_at" ON "public"."lead_scores" USING "btree" ("created_at");




CREATE INDEX "idx_lead_scores_lead_id" ON "public"."lead_scores" USING "btree" ("lead_id");




CREATE INDEX "idx_lead_scores_score_class" ON "public"."lead_scores" USING "btree" ("score_class");




CREATE INDEX "idx_lead_scores_total_score" ON "public"."lead_scores" USING "btree" ("total_score");




CREATE INDEX "idx_leads_area_normalized" ON "public"."leads" USING "btree" ("area_normalized");




CREATE INDEX "idx_leads_city" ON "public"."leads" USING "btree" ("city");




CREATE INDEX "idx_leads_city_service" ON "public"."leads" USING "btree" ("city", "service_required");




CREATE INDEX "idx_leads_phone" ON "public"."leads" USING "btree" ("phone");




CREATE INDEX "idx_leads_requirement_group" ON "public"."leads" USING "btree" ("requirement_group_id");




CREATE INDEX "idx_leads_service" ON "public"."leads" USING "btree" ("service_required");




CREATE INDEX "idx_leads_vendor_contact_share_consent" ON "public"."leads" USING "btree" ("vendor_contact_share_consent");




CREATE INDEX "idx_password_reset_grants_challenge" ON "public"."password_reset_grants" USING "btree" ("challenge_id");




CREATE INDEX "idx_password_reset_grants_user" ON "public"."password_reset_grants" USING "btree" ("user_id", "created_at" DESC);




CREATE INDEX "idx_payments_vendor" ON "public"."payments" USING "btree" ("vendor_id", "payment_status");




CREATE INDEX "idx_vendor_credit_logs_created_at" ON "public"."vendor_credit_logs" USING "btree" ("created_at" DESC);




CREATE INDEX "idx_vendor_credit_logs_vendor_id" ON "public"."vendor_credit_logs" USING "btree" ("vendor_id");




CREATE INDEX "idx_vendor_dashboard_users_user_id" ON "public"."vendor_dashboard_users" USING "btree" ("user_id");




CREATE INDEX "idx_vendor_dashboard_users_vendor" ON "public"."vendor_dashboard_users" USING "btree" ("vendor_id");




CREATE INDEX "idx_vendor_dashboard_users_vendor_id" ON "public"."vendor_dashboard_users" USING "btree" ("vendor_id");




CREATE INDEX "idx_vendor_lead_activity_logs_assignment_id" ON "public"."vendor_lead_activity_logs" USING "btree" ("assignment_id");




CREATE INDEX "idx_vendor_lead_activity_logs_created_at" ON "public"."vendor_lead_activity_logs" USING "btree" ("created_at" DESC);




CREATE INDEX "idx_vendor_lead_activity_logs_lead_id" ON "public"."vendor_lead_activity_logs" USING "btree" ("lead_id");




CREATE INDEX "idx_vendor_lead_activity_logs_type" ON "public"."vendor_lead_activity_logs" USING "btree" ("activity_type");




CREATE INDEX "idx_vendor_lead_activity_logs_vendor_id" ON "public"."vendor_lead_activity_logs" USING "btree" ("vendor_id");




CREATE INDEX "idx_vendor_lead_report_comments_created_at" ON "public"."vendor_lead_report_comments" USING "btree" ("created_at" DESC);




CREATE INDEX "idx_vendor_lead_report_comments_report_id" ON "public"."vendor_lead_report_comments" USING "btree" ("report_id");




CREATE INDEX "idx_vendor_lead_reports_assignment_id" ON "public"."vendor_lead_reports" USING "btree" ("assignment_id");




CREATE INDEX "idx_vendor_lead_reports_created_at" ON "public"."vendor_lead_reports" USING "btree" ("created_at" DESC);




CREATE INDEX "idx_vendor_lead_reports_lead_id" ON "public"."vendor_lead_reports" USING "btree" ("lead_id");




CREATE INDEX "idx_vendor_lead_reports_status" ON "public"."vendor_lead_reports" USING "btree" ("status");




CREATE INDEX "idx_vendor_lead_reports_vendor_id" ON "public"."vendor_lead_reports" USING "btree" ("vendor_id");




CREATE INDEX "idx_vendor_mobile_auth_provisions_vendor_id" ON "public"."vendor_mobile_auth_provisions" USING "btree" ("vendor_id");




CREATE INDEX "idx_vendor_notifications_created_at" ON "public"."vendor_notifications" USING "btree" ("created_at");




CREATE INDEX "idx_vendor_notifications_is_read" ON "public"."vendor_notifications" USING "btree" ("is_read");




CREATE INDEX "idx_vendor_notifications_vendor_created" ON "public"."vendor_notifications" USING "btree" ("vendor_id", "created_at" DESC);




CREATE INDEX "idx_vendor_notifications_vendor_id" ON "public"."vendor_notifications" USING "btree" ("vendor_id");




CREATE INDEX "idx_vendor_notifications_vendor_read" ON "public"."vendor_notifications" USING "btree" ("vendor_id", "is_read", "created_at" DESC);




CREATE INDEX "idx_vendor_package_purchase_requests_created_at" ON "public"."vendor_package_purchase_requests" USING "btree" ("created_at" DESC);




CREATE INDEX "idx_vendor_package_purchase_requests_package_id" ON "public"."vendor_package_purchase_requests" USING "btree" ("package_id");




CREATE INDEX "idx_vendor_package_purchase_requests_reviewed_at" ON "public"."vendor_package_purchase_requests" USING "btree" ("reviewed_at" DESC);




CREATE INDEX "idx_vendor_package_purchase_requests_status" ON "public"."vendor_package_purchase_requests" USING "btree" ("status");




CREATE INDEX "idx_vendor_package_purchase_requests_vendor_id" ON "public"."vendor_package_purchase_requests" USING "btree" ("vendor_id");




CREATE INDEX "idx_vendor_pkgs_vendor" ON "public"."vendor_packages" USING "btree" ("vendor_id", "status");




CREATE INDEX "idx_vendor_profile_change_requests_status" ON "public"."vendor_profile_change_requests" USING "btree" ("status", "created_at" DESC);




CREATE INDEX "idx_vendor_profile_change_requests_vendor_created" ON "public"."vendor_profile_change_requests" USING "btree" ("vendor_id", "created_at" DESC);




CREATE INDEX "idx_vendor_support_messages_created_at" ON "public"."vendor_support_messages" USING "btree" ("created_at");




CREATE INDEX "idx_vendor_support_messages_thread_created" ON "public"."vendor_support_messages" USING "btree" ("thread_id", "created_at");




CREATE INDEX "idx_vendor_support_messages_thread_id" ON "public"."vendor_support_messages" USING "btree" ("thread_id");




CREATE INDEX "idx_vendor_support_messages_vendor_id" ON "public"."vendor_support_messages" USING "btree" ("vendor_id");




CREATE INDEX "idx_vendor_support_threads_status" ON "public"."vendor_support_threads" USING "btree" ("status");




CREATE INDEX "idx_vendor_support_threads_status_updated" ON "public"."vendor_support_threads" USING "btree" ("status", "updated_at" DESC);




CREATE INDEX "idx_vendor_support_threads_updated_at" ON "public"."vendor_support_threads" USING "btree" ("updated_at");




CREATE INDEX "idx_vendor_support_threads_vendor_id" ON "public"."vendor_support_threads" USING "btree" ("vendor_id");




CREATE INDEX "idx_vendor_support_threads_vendor_updated" ON "public"."vendor_support_threads" USING "btree" ("vendor_id", "updated_at" DESC);




CREATE INDEX "idx_vendors_accepting_leads" ON "public"."vendors" USING "btree" ("accepting_leads");




CREATE INDEX "idx_vendors_area_normalized" ON "public"."vendors" USING "btree" ("area_normalized");




CREATE INDEX "idx_vendors_city" ON "public"."vendors" USING "btree" ("city");




CREATE INDEX "idx_vendors_credits" ON "public"."vendors" USING "btree" ("remaining_credits");




CREATE INDEX "idx_vendors_package_status" ON "public"."vendors" USING "btree" ("package_status");




CREATE INDEX "idx_vendors_public" ON "public"."vendors" USING "btree" ("public_visibility") WHERE ("public_visibility" = true);




CREATE INDEX "idx_vendors_status" ON "public"."vendors" USING "btree" ("status");




CREATE INDEX "idx_vendors_status_active" ON "public"."vendors" USING "btree" ("status", "is_active");




CREATE INDEX "idx_verification_challenges_lookup" ON "public"."verification_challenges" USING "btree" ("principal_type", "principal_id", "purpose", "status");




CREATE INDEX "idx_verification_challenges_pending_expiry" ON "public"."verification_challenges" USING "btree" ("expires_at") WHERE ("status" = 'pending'::"text");




CREATE INDEX "idx_verification_challenges_rate_limit" ON "public"."verification_challenges" USING "btree" ("vendor_dashboard_user_id", "purpose", "created_at" DESC);




CREATE INDEX "idx_verification_challenges_user_purpose_status" ON "public"."verification_challenges" USING "btree" ("user_id", "purpose", "status");




CREATE INDEX "idx_verification_challenges_vdu_purpose_status" ON "public"."verification_challenges" USING "btree" ("vendor_dashboard_user_id", "purpose", "status");




CREATE UNIQUE INDEX "uq_auth_delivery_attempt_action_number" ON "public"."authentication_delivery_attempts" USING "btree" ("auth_action_id", "attempt_number");




CREATE UNIQUE INDEX "uq_auth_delivery_attempt_fallback_lineage" ON "public"."authentication_delivery_attempts" USING "btree" ("fallback_from_attempt_id") WHERE ("fallback_from_attempt_id" IS NOT NULL);




CREATE UNIQUE INDEX "uq_auth_delivery_attempt_message" ON "public"."authentication_delivery_attempts" USING "btree" ("communication_message_id") WHERE ("communication_message_id" IS NOT NULL);




CREATE UNIQUE INDEX "uq_auth_delivery_attempt_single_fallback" ON "public"."authentication_delivery_attempts" USING "btree" ("auth_action_id") WHERE ("attempt_number" = 2);




CREATE UNIQUE INDEX "uq_auth_failure_rule_active_flow" ON "public"."authentication_transport_failure_rules" USING "btree" ("auth_flow", "primary_channel", "primary_provider_key", "failure_code") WHERE ("is_active" AND ("auth_flow" IS NOT NULL));




CREATE UNIQUE INDEX "uq_auth_failure_rule_active_provider_wide" ON "public"."authentication_transport_failure_rules" USING "btree" ("primary_channel", "primary_provider_key", "failure_code") WHERE ("is_active" AND ("auth_flow" IS NULL));




CREATE UNIQUE INDEX "uq_bad_lead_reports_active_assignment" ON "public"."bad_lead_reports" USING "btree" ("lead_assignment_id") WHERE ("status" = ANY (ARRAY['Pending'::"text", 'Under Review'::"text"]));




CREATE UNIQUE INDEX "uq_client_accounts_phone_e164" ON "public"."client_accounts" USING "btree" ("phone_e164") WHERE ("phone_e164" IS NOT NULL);




CREATE UNIQUE INDEX "uq_client_accounts_user" ON "public"."client_accounts" USING "btree" ("user_id");




CREATE UNIQUE INDEX "uq_comm_canary_active_destination" ON "public"."communication_provider_canary_destinations" USING "btree" ("provider_key", "channel", "destination_hash") WHERE "is_active";




CREATE UNIQUE INDEX "uq_comm_consent_event_idempotency" ON "public"."communication_consent_events" USING "btree" ("idempotency_key");




CREATE UNIQUE INDEX "uq_comm_consent_event_provider_action" ON "public"."communication_consent_events" USING "btree" ("provider", "provider_message_id", "target_type", "action", "channel", "scope") WHERE (("provider" IS NOT NULL) AND ("provider_message_id" IS NOT NULL));




CREATE UNIQUE INDEX "uq_comm_delivery_event_account_event" ON "public"."communication_delivery_events" USING "btree" ("provider_account_id", "provider_event_id", "provider_message_id", "normalized_event_type") WHERE (("provider_event_id" IS NOT NULL) AND ("provider_account_id" IS NOT NULL));




CREATE UNIQUE INDEX "uq_comm_delivery_event_provider_event_legacy" ON "public"."communication_delivery_events" USING "btree" ("provider", "provider_event_id", "provider_message_id", "normalized_event_type") WHERE (("provider_event_id" IS NOT NULL) AND ("provider_account_id" IS NULL));




CREATE UNIQUE INDEX "uq_comm_inbound_account_message" ON "public"."communication_inbound_messages" USING "btree" ("provider_account_id", "provider_message_id") WHERE ("provider_account_id" IS NOT NULL);




CREATE UNIQUE INDEX "uq_comm_inbound_provider_message_legacy" ON "public"."communication_inbound_messages" USING "btree" ("provider", "provider_message_id") WHERE ("provider_account_id" IS NULL);




CREATE UNIQUE INDEX "uq_comm_message_account_provider_message" ON "public"."communication_messages" USING "btree" ("provider_account_id", "provider_message_id") WHERE (("provider_account_id" IS NOT NULL) AND ("provider_message_id" IS NOT NULL));




CREATE UNIQUE INDEX "uq_comm_provider_account_no_phone" ON "public"."communication_provider_accounts" USING "btree" ("provider_key", "channel") WHERE ("phone_number_reference" IS NULL);




CREATE UNIQUE INDEX "uq_comm_provider_template_active" ON "public"."communication_provider_template_mappings" USING "btree" ("template_key", "channel", "provider_key", "language") WHERE "is_active";




CREATE UNIQUE INDEX "uq_comm_provider_template_mapping" ON "public"."communication_provider_template_mappings" USING "btree" ("template_key", "channel", "provider_key", "language", "version");




CREATE UNIQUE INDEX "uq_comm_suppression_active" ON "public"."communication_suppressions" USING "btree" ("destination_hash", "channel", "scope") WHERE "is_active";




CREATE UNIQUE INDEX "uq_comm_webhook_receipt_account_event" ON "public"."communication_webhook_receipts" USING "btree" ("provider_account_id", "provider_event_id") WHERE ("signature_valid" AND ("provider_event_id" IS NOT NULL) AND ("provider_account_id" IS NOT NULL));




CREATE UNIQUE INDEX "uq_comm_webhook_receipt_payload_rejected_unbound" ON "public"."communication_webhook_receipts" USING "btree" ("provider", "payload_hash") WHERE ((NOT "signature_valid") AND ("provider_account_id" IS NULL));




CREATE UNIQUE INDEX "uq_comm_webhook_receipt_payload_verified_account" ON "public"."communication_webhook_receipts" USING "btree" ("provider_account_id", "payload_hash") WHERE ("signature_valid" AND ("provider_account_id" IS NOT NULL));




CREATE UNIQUE INDEX "uq_comm_webhook_receipt_payload_verified_legacy" ON "public"."communication_webhook_receipts" USING "btree" ("provider", "payload_hash") WHERE ("signature_valid" AND ("provider_account_id" IS NULL));




CREATE UNIQUE INDEX "uq_comm_webhook_receipt_provider_event_legacy" ON "public"."communication_webhook_receipts" USING "btree" ("provider", "provider_event_id") WHERE ("signature_valid" AND ("provider_event_id" IS NOT NULL) AND ("provider_account_id" IS NULL));




CREATE UNIQUE INDEX "uq_password_reset_grants_one_open" ON "public"."password_reset_grants" USING "btree" ("user_id") WHERE (("consumed_at" IS NULL) AND ("revoked_at" IS NULL));




CREATE UNIQUE INDEX "uq_password_reset_grants_token" ON "public"."password_reset_grants" USING "btree" ("grant_token_hash");




CREATE UNIQUE INDEX "uq_vendor_credit_logs_reference" ON "public"."vendor_credit_logs" USING "btree" ("reference_type", "reference_id") WHERE ("reference_id" IS NOT NULL);




CREATE UNIQUE INDEX "uq_vendor_dashboard_users_phone_e164" ON "public"."vendor_dashboard_users" USING "btree" ("phone_e164") WHERE ("phone_e164" IS NOT NULL);




CREATE UNIQUE INDEX "uq_vendor_dashboard_users_user_id" ON "public"."vendor_dashboard_users" USING "btree" ("user_id") WHERE ("user_id" IS NOT NULL);




CREATE UNIQUE INDEX "uq_verification_challenges_one_pending" ON "public"."verification_challenges" USING "btree" ("vendor_dashboard_user_id", "purpose") WHERE (("status" = 'pending'::"text") AND ("vendor_dashboard_user_id" IS NOT NULL));




CREATE INDEX "vendor_package_orders_created_at_idx" ON "public"."vendor_package_orders" USING "btree" ("created_at" DESC);




CREATE INDEX "vendor_package_orders_package_id_idx" ON "public"."vendor_package_orders" USING "btree" ("package_id");




CREATE INDEX "vendor_package_orders_vendor_id_idx" ON "public"."vendor_package_orders" USING "btree" ("vendor_id");




CREATE INDEX "vendors_city_idx" ON "public"."vendors" USING "btree" ("city");




CREATE INDEX "vendors_paid_status_idx" ON "public"."vendors" USING "btree" ("paid_status");




CREATE INDEX "vendors_public_visibility_idx" ON "public"."vendors" USING "btree" ("public_visibility");




CREATE INDEX "vendors_status_idx" ON "public"."vendors" USING "btree" ("status");




CREATE INDEX "vendors_verification_status_idx" ON "public"."vendors" USING "btree" ("verification_status");




ALTER TABLE ONLY "public"."authentication_delivery_attempts"
    ADD CONSTRAINT "authentication_delivery_attempts_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."verification_challenges"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."authentication_delivery_attempts"
    ADD CONSTRAINT "authentication_delivery_attempts_communication_message_id_fkey" FOREIGN KEY ("communication_message_id") REFERENCES "public"."communication_messages"("id") ON DELETE RESTRICT;




ALTER TABLE ONLY "public"."authentication_delivery_attempts"
    ADD CONSTRAINT "authentication_delivery_attempts_fallback_from_attempt_id_fkey" FOREIGN KEY ("fallback_from_attempt_id") REFERENCES "public"."authentication_delivery_attempts"("id") ON DELETE SET NULL;




ALTER TABLE ONLY "public"."bad_lead_report_comments"
    ADD CONSTRAINT "bad_lead_report_comments_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."bad_lead_reports"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."bad_lead_reports"
    ADD CONSTRAINT "bad_lead_reports_lead_assignment_id_fkey" FOREIGN KEY ("lead_assignment_id") REFERENCES "public"."lead_assignments"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."bad_lead_reports"
    ADD CONSTRAINT "bad_lead_reports_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."client_accounts"
    ADD CONSTRAINT "client_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."client_notification_logs"
    ADD CONSTRAINT "client_notification_logs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."client_requirement_groups"
    ADD CONSTRAINT "client_requirement_groups_first_lead_id_fkey" FOREIGN KEY ("first_lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;




ALTER TABLE ONLY "public"."communication_automation_catalog"
    ADD CONSTRAINT "communication_automation_catalog_template_key_fkey" FOREIGN KEY ("template_key") REFERENCES "public"."communication_templates"("template_key");




ALTER TABLE ONLY "public"."communication_consent_ack_intents"
    ADD CONSTRAINT "communication_consent_ack_inten_consent_command_receipt_id_fkey" FOREIGN KEY ("consent_command_receipt_id") REFERENCES "public"."communication_consent_command_receipts"("id") ON DELETE RESTRICT;




ALTER TABLE ONLY "public"."communication_consent_ack_intents"
    ADD CONSTRAINT "communication_consent_ack_intents_inbound_message_id_fkey" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."communication_inbound_messages"("id") ON DELETE RESTRICT;




ALTER TABLE ONLY "public"."communication_consent_ack_intents"
    ADD CONSTRAINT "communication_consent_ack_intents_provider_account_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "public"."communication_provider_accounts"("id") ON DELETE RESTRICT;




ALTER TABLE ONLY "public"."communication_consent_events"
    ADD CONSTRAINT "communication_consent_events_inbound_message_id_fkey" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."communication_inbound_messages"("id") ON DELETE SET NULL;




ALTER TABLE ONLY "public"."communication_delivery_events"
    ADD CONSTRAINT "communication_delivery_events_communication_message_id_fkey" FOREIGN KEY ("communication_message_id") REFERENCES "public"."communication_messages"("id") ON DELETE RESTRICT;




ALTER TABLE ONLY "public"."communication_delivery_events"
    ADD CONSTRAINT "communication_delivery_events_provider_account_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "public"."communication_provider_accounts"("id") ON DELETE RESTRICT;




ALTER TABLE ONLY "public"."communication_inbound_messages"
    ADD CONSTRAINT "communication_inbound_messages_provider_account_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "public"."communication_provider_accounts"("id") ON DELETE RESTRICT;




ALTER TABLE ONLY "public"."communication_inbound_messages"
    ADD CONSTRAINT "communication_inbound_messages_webhook_receipt_id_fkey" FOREIGN KEY ("webhook_receipt_id") REFERENCES "public"."communication_webhook_receipts"("id") ON DELETE SET NULL;




ALTER TABLE ONLY "public"."communication_messages"
    ADD CONSTRAINT "communication_messages_provider_account_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "public"."communication_provider_accounts"("id") ON DELETE RESTRICT;




ALTER TABLE ONLY "public"."communication_messages"
    ADD CONSTRAINT "communication_messages_template_key_fkey" FOREIGN KEY ("template_key") REFERENCES "public"."communication_templates"("template_key");




ALTER TABLE ONLY "public"."communication_provider_template_mappings"
    ADD CONSTRAINT "communication_provider_template_mappings_template_key_fkey" FOREIGN KEY ("template_key") REFERENCES "public"."communication_templates"("template_key");




ALTER TABLE ONLY "public"."communication_webhook_receipts"
    ADD CONSTRAINT "communication_webhook_receipts_provider_account_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "public"."communication_provider_accounts"("id") ON DELETE RESTRICT;




ALTER TABLE ONLY "public"."communication_preferences"
    ADD CONSTRAINT "fk_comm_preference_last_event" FOREIGN KEY ("last_event_id") REFERENCES "public"."communication_consent_events"("id") ON DELETE RESTRICT;




ALTER TABLE ONLY "public"."communication_suppressions"
    ADD CONSTRAINT "fk_comm_suppression_last_event" FOREIGN KEY ("last_event_id") REFERENCES "public"."communication_consent_events"("id") ON DELETE RESTRICT;




ALTER TABLE ONLY "public"."lead_assignments"
    ADD CONSTRAINT "lead_assignments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."lead_assignments"
    ADD CONSTRAINT "lead_assignments_requirement_group_id_fkey" FOREIGN KEY ("requirement_group_id") REFERENCES "public"."client_requirement_groups"("id") ON DELETE SET NULL;




ALTER TABLE ONLY "public"."lead_assignments"
    ADD CONSTRAINT "lead_assignments_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."lead_clarification_requests"
    ADD CONSTRAINT "lead_clarification_requests_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."lead_clarification_responses"
    ADD CONSTRAINT "lead_clarification_responses_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."lead_clarification_responses"
    ADD CONSTRAINT "lead_clarification_responses_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."lead_clarification_requests"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."lead_delivery_logs"
    ADD CONSTRAINT "lead_delivery_logs_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."lead_assignments"("id") ON DELETE SET NULL;




ALTER TABLE ONLY "public"."lead_delivery_logs"
    ADD CONSTRAINT "lead_delivery_logs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."lead_delivery_logs"
    ADD CONSTRAINT "lead_delivery_logs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."lead_matching_runs"
    ADD CONSTRAINT "lead_matching_runs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."lead_scores"
    ADD CONSTRAINT "lead_scores_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."lead_status_updates"
    ADD CONSTRAINT "lead_status_updates_lead_assignment_id_fkey" FOREIGN KEY ("lead_assignment_id") REFERENCES "public"."lead_assignments"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."lead_status_updates"
    ADD CONSTRAINT "lead_status_updates_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_duplicate_of_fkey" FOREIGN KEY ("duplicate_of") REFERENCES "public"."leads"("id") ON DELETE SET NULL;




ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_requirement_group_id_fkey" FOREIGN KEY ("requirement_group_id") REFERENCES "public"."client_requirement_groups"("id") ON DELETE SET NULL;




ALTER TABLE ONLY "public"."password_reset_grants"
    ADD CONSTRAINT "password_reset_grants_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."verification_challenges"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."password_reset_grants"
    ADD CONSTRAINT "password_reset_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."password_reset_grants"
    ADD CONSTRAINT "password_reset_grants_vendor_dashboard_user_id_fkey" FOREIGN KEY ("vendor_dashboard_user_id") REFERENCES "public"."vendor_dashboard_users"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."password_reset_grants"
    ADD CONSTRAINT "password_reset_grants_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id");




ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."vendor_dashboard_users"
    ADD CONSTRAINT "vendor_dashboard_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;




ALTER TABLE ONLY "public"."vendor_dashboard_users"
    ADD CONSTRAINT "vendor_dashboard_users_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."vendor_lead_activity_logs"
    ADD CONSTRAINT "vendor_lead_activity_logs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;




ALTER TABLE ONLY "public"."vendor_lead_activity_logs"
    ADD CONSTRAINT "vendor_lead_activity_logs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."vendor_lead_report_comments"
    ADD CONSTRAINT "vendor_lead_report_comments_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."vendor_lead_reports"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."vendor_lead_reports"
    ADD CONSTRAINT "vendor_lead_reports_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;




ALTER TABLE ONLY "public"."vendor_lead_reports"
    ADD CONSTRAINT "vendor_lead_reports_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."vendor_mobile_auth_provisions"
    ADD CONSTRAINT "vendor_mobile_auth_provisions_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."vendor_notifications"
    ADD CONSTRAINT "vendor_notifications_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."vendor_package_orders"
    ADD CONSTRAINT "vendor_package_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."vendor_package_purchase_requests"
    ADD CONSTRAINT "vendor_package_purchase_requests_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE SET NULL;




ALTER TABLE ONLY "public"."vendor_package_purchase_requests"
    ADD CONSTRAINT "vendor_package_purchase_requests_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."vendor_packages"
    ADD CONSTRAINT "vendor_packages_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id");




ALTER TABLE ONLY "public"."vendor_packages"
    ADD CONSTRAINT "vendor_packages_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."vendor_profile_change_requests"
    ADD CONSTRAINT "vendor_profile_change_requests_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."vendor_support_messages"
    ADD CONSTRAINT "vendor_support_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."vendor_support_threads"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."vendor_support_messages"
    ADD CONSTRAINT "vendor_support_messages_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."vendor_support_threads"
    ADD CONSTRAINT "vendor_support_threads_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;




ALTER TABLE ONLY "public"."verification_challenges"
    ADD CONSTRAINT "verification_challenges_communication_message_id_fkey" FOREIGN KEY ("communication_message_id") REFERENCES "public"."communication_messages"("id") ON DELETE RESTRICT;




ALTER TABLE ONLY "public"."verification_challenges"
    ADD CONSTRAINT "verification_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."verification_challenges"
    ADD CONSTRAINT "verification_challenges_vendor_dashboard_user_id_fkey" FOREIGN KEY ("vendor_dashboard_user_id") REFERENCES "public"."vendor_dashboard_users"("id") ON DELETE CASCADE;




ALTER TABLE ONLY "public"."verification_challenges"
    ADD CONSTRAINT "verification_challenges_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;




ALTER TABLE "public"."aos_runtime_settings" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "aos_runtime_settings admin all" ON "public"."aos_runtime_settings" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "assign admin all" ON "public"."lead_assignments" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "assign owner read" ON "public"."lead_assignments" FOR SELECT TO "authenticated" USING (("public"."owns_vendor"("vendor_id") OR "public"."is_admin"()));




CREATE POLICY "assign owner update" ON "public"."lead_assignments" FOR UPDATE TO "authenticated" USING ("public"."owns_vendor"("vendor_id")) WITH CHECK ("public"."owns_vendor"("vendor_id"));




ALTER TABLE "public"."auth_security_events" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."authentication_delivery_attempts" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."authentication_transport_failure_rules" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."authentication_transport_policies" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."bad_lead_report_comments" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "bad_lead_report_comments admin all" ON "public"."bad_lead_report_comments" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "bad_lead_report_comments vendor read own" ON "public"."bad_lead_report_comments" FOR SELECT TO "authenticated" USING (((COALESCE("is_internal", false) = false) AND (EXISTS ( SELECT 1
   FROM "public"."bad_lead_reports" "r"
  WHERE (("r"."id" = "bad_lead_report_comments"."report_id") AND "public"."owns_vendor"("r"."vendor_id"))))));




ALTER TABLE "public"."bad_lead_reports" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "categories admin write" ON "public"."service_categories" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "categories public read" ON "public"."service_categories" FOR SELECT TO "authenticated", "anon" USING (("is_active" OR "public"."is_admin"()));




ALTER TABLE "public"."cities" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "cities admin write" ON "public"."cities" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "cities public read" ON "public"."cities" FOR SELECT TO "authenticated", "anon" USING (("is_active" OR "public"."is_admin"()));




ALTER TABLE "public"."client_accounts" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "client_accounts admin manage" ON "public"."client_accounts" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "client_accounts owner read" ON "public"."client_accounts" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));




ALTER TABLE "public"."client_notification_logs" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "client_notification_logs admin all" ON "public"."client_notification_logs" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




ALTER TABLE "public"."client_requirement_groups" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "client_requirement_groups admin all" ON "public"."client_requirement_groups" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




ALTER TABLE "public"."communication_automation_catalog" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."communication_channel_capabilities" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."communication_consent_ack_intents" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."communication_consent_command_receipts" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."communication_consent_events" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."communication_delivery_events" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."communication_inbound_messages" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."communication_messages" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."communication_preferences" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."communication_provider_accounts" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."communication_provider_canary_destinations" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."communication_provider_runtime_policies" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."communication_provider_template_mappings" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."communication_suppressions" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."communication_templates" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."communication_webhook_receipts" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."free_vendor_profile_interests" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."lead_assignment_approvals" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "lead_assignment_approvals admin all" ON "public"."lead_assignment_approvals" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




ALTER TABLE "public"."lead_assignment_queue" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."lead_assignments" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."lead_auto_assignment_logs" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."lead_clarification_requests" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."lead_clarification_responses" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."lead_delivery_logs" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "lead_delivery_logs admin all" ON "public"."lead_delivery_logs" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "lead_delivery_logs vendor read" ON "public"."lead_delivery_logs" FOR SELECT TO "authenticated" USING (("public"."owns_vendor"("vendor_id") OR "public"."is_admin"()));




ALTER TABLE "public"."lead_matching_runs" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "lead_matching_runs admin all" ON "public"."lead_matching_runs" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




ALTER TABLE "public"."lead_scores" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."lead_status_updates" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "leads admin all" ON "public"."leads" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "leads public insert" ON "public"."leads" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);




CREATE POLICY "leads vendor read" ON "public"."leads" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."lead_assignments" "la"
     JOIN "public"."vendors" "v" ON (("v"."id" = "la"."vendor_id")))
  WHERE (("la"."lead_id" = "leads"."id") AND ("v"."user_id" = "auth"."uid"())))));




ALTER TABLE "public"."marketplace_runtime_settings" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."packages" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "packages admin write" ON "public"."packages" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "packages public read" ON "public"."packages" FOR SELECT TO "authenticated", "anon" USING (("is_active" OR "public"."is_admin"()));




ALTER TABLE "public"."password_reset_grants" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "payments admin all" ON "public"."payments" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "payments owner read" ON "public"."payments" FOR SELECT TO "authenticated" USING (("public"."owns_vendor"("vendor_id") OR "public"."is_admin"()));




ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "profiles admin all" ON "public"."profiles" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "profiles self read" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR "public"."is_admin"()));




CREATE POLICY "profiles self update" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));




CREATE POLICY "reports admin all" ON "public"."bad_lead_reports" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "reports owner insert" ON "public"."bad_lead_reports" FOR INSERT TO "authenticated" WITH CHECK (("public"."owns_vendor"("vendor_id") AND (EXISTS ( SELECT 1
   FROM "public"."lead_assignments" "la"
  WHERE (("la"."id" = "bad_lead_reports"."lead_assignment_id") AND ("la"."vendor_id" = "bad_lead_reports"."vendor_id"))))));




CREATE POLICY "reports owner read" ON "public"."bad_lead_reports" FOR SELECT TO "authenticated" USING (("public"."owns_vendor"("vendor_id") OR "public"."is_admin"()));




ALTER TABLE "public"."service_categories" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "settings admin write" ON "public"."app_settings" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "settings public read" ON "public"."app_settings" FOR SELECT TO "authenticated", "anon" USING (true);




CREATE POLICY "status owner rw" ON "public"."lead_status_updates" TO "authenticated" USING (("public"."owns_vendor"("vendor_id") OR "public"."is_admin"())) WITH CHECK (("public"."owns_vendor"("vendor_id") OR "public"."is_admin"()));




ALTER TABLE "public"."vendor_credit_logs" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "vendor_credit_logs admin all" ON "public"."vendor_credit_logs" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




ALTER TABLE "public"."vendor_dashboard_users" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "vendor_dashboard_users admin read" ON "public"."vendor_dashboard_users" FOR SELECT TO "authenticated" USING ("public"."is_admin"());




CREATE POLICY "vendor_dashboard_users self read" ON "public"."vendor_dashboard_users" FOR SELECT TO "authenticated" USING ((("auth"."uid"() IS NOT NULL) AND ("auth"."uid"() = "user_id")));




ALTER TABLE "public"."vendor_lead_activity_logs" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "vendor_lead_activity_logs admin all" ON "public"."vendor_lead_activity_logs" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "vendor_lead_activity_logs vendor read own" ON "public"."vendor_lead_activity_logs" FOR SELECT TO "authenticated" USING ("public"."owns_vendor"("vendor_id"));




ALTER TABLE "public"."vendor_lead_report_comments" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "vendor_lead_report_comments admin all" ON "public"."vendor_lead_report_comments" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "vendor_lead_report_comments vendor insert own" ON "public"."vendor_lead_report_comments" FOR INSERT TO "authenticated" WITH CHECK ((("sender_type" = 'vendor'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."vendor_lead_reports" "r"
  WHERE (("r"."id" = "vendor_lead_report_comments"."report_id") AND "public"."owns_vendor"("r"."vendor_id"))))));




CREATE POLICY "vendor_lead_report_comments vendor read own" ON "public"."vendor_lead_report_comments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendor_lead_reports" "r"
  WHERE (("r"."id" = "vendor_lead_report_comments"."report_id") AND "public"."owns_vendor"("r"."vendor_id") AND ("vendor_lead_report_comments"."is_internal" = false)))));




ALTER TABLE "public"."vendor_lead_reports" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "vendor_lead_reports admin all" ON "public"."vendor_lead_reports" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "vendor_lead_reports vendor insert own" ON "public"."vendor_lead_reports" FOR INSERT TO "authenticated" WITH CHECK ("public"."owns_vendor"("vendor_id"));




CREATE POLICY "vendor_lead_reports vendor read own" ON "public"."vendor_lead_reports" FOR SELECT TO "authenticated" USING ("public"."owns_vendor"("vendor_id"));




ALTER TABLE "public"."vendor_mobile_auth_provisions" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."vendor_notifications" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "vendor_notifications admin all" ON "public"."vendor_notifications" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "vendor_notifications owner read" ON "public"."vendor_notifications" FOR SELECT TO "authenticated" USING (("public"."owns_vendor"("vendor_id") OR "public"."is_admin"()));




CREATE POLICY "vendor_notifications owner update" ON "public"."vendor_notifications" FOR UPDATE TO "authenticated" USING (("public"."owns_vendor"("vendor_id") OR "public"."is_admin"())) WITH CHECK (("public"."owns_vendor"("vendor_id") OR "public"."is_admin"()));




ALTER TABLE "public"."vendor_package_orders" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."vendor_package_purchase_requests" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."vendor_packages" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "vendor_pkgs admin all" ON "public"."vendor_packages" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "vendor_pkgs owner read" ON "public"."vendor_packages" FOR SELECT TO "authenticated" USING (("public"."owns_vendor"("vendor_id") OR "public"."is_admin"()));




ALTER TABLE "public"."vendor_profile_change_requests" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "vendor_profile_change_requests admin all" ON "public"."vendor_profile_change_requests" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "vendor_profile_change_requests owner insert" ON "public"."vendor_profile_change_requests" FOR INSERT TO "authenticated" WITH CHECK ("public"."owns_vendor"("vendor_id"));




CREATE POLICY "vendor_profile_change_requests owner read" ON "public"."vendor_profile_change_requests" FOR SELECT TO "authenticated" USING (("public"."owns_vendor"("vendor_id") OR "public"."is_admin"()));




ALTER TABLE "public"."vendor_support_messages" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "vendor_support_messages admin all" ON "public"."vendor_support_messages" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "vendor_support_messages owner insert" ON "public"."vendor_support_messages" FOR INSERT TO "authenticated" WITH CHECK ((("sender_type" = 'vendor'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."vendor_support_threads" "t"
  WHERE (("t"."id" = "vendor_support_messages"."thread_id") AND "public"."owns_vendor"("t"."vendor_id"))))));




CREATE POLICY "vendor_support_messages owner read" ON "public"."vendor_support_messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."vendor_support_threads" "t"
  WHERE (("t"."id" = "vendor_support_messages"."thread_id") AND ("public"."owns_vendor"("t"."vendor_id") OR "public"."is_admin"())))));




ALTER TABLE "public"."vendor_support_threads" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "vendor_support_threads admin all" ON "public"."vendor_support_threads" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "vendor_support_threads owner insert" ON "public"."vendor_support_threads" FOR INSERT TO "authenticated" WITH CHECK ("public"."owns_vendor"("vendor_id"));




CREATE POLICY "vendor_support_threads owner read" ON "public"."vendor_support_threads" FOR SELECT TO "authenticated" USING (("public"."owns_vendor"("vendor_id") OR "public"."is_admin"()));




CREATE POLICY "vendor_support_threads owner update" ON "public"."vendor_support_threads" FOR UPDATE TO "authenticated" USING (("public"."owns_vendor"("vendor_id") OR "public"."is_admin"())) WITH CHECK (("public"."owns_vendor"("vendor_id") OR "public"."is_admin"()));




ALTER TABLE "public"."vendors" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "vendors admin all" ON "public"."vendors" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "vendors owner read" ON "public"."vendors" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));




CREATE POLICY "vendors owner update" ON "public"."vendors" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));




CREATE POLICY "vendors public listing" ON "public"."vendors" FOR SELECT TO "authenticated", "anon" USING ((("status" = 'Approved'::"text") AND ("is_active" = true) AND ("public_visibility" = true) AND ("remaining_credits" > 0)));




CREATE POLICY "vendors public register" ON "public"."vendors" FOR INSERT TO "authenticated", "anon" WITH CHECK ((("status" = 'Pending'::"text") AND ("public_visibility" = false)));




ALTER TABLE "public"."verification_challenges" ENABLE ROW LEVEL SECURITY;



CREATE POLICY "wa admin all" ON "public"."whatsapp_logs" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());




CREATE POLICY "wa vendor read" ON "public"."whatsapp_logs" FOR SELECT TO "authenticated" USING ((("recipient_type" = 'vendor'::"text") AND "public"."owns_vendor"("recipient_id")));




ALTER TABLE "public"."whatsapp_logs" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Explicit least-privilege grants (rules from staging-baseline-grants.json,
-- signatures derived from the pinned source). NOT copied from production.
-- No blanket GRANT ALL to anon/authenticated; no default-privilege grants for
-- anon/authenticated. Every mutation RPC is service_role-only. anon receives
-- NO table access and NO monetization reads.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA "public" TO "anon", "authenticated", "service_role";

-- Functions (all 39): default-deny to PUBLIC/anon/authenticated; explicit allow-list.
REVOKE ALL ON FUNCTION "public"."admin_smart_assign_lead_to_vendors"("p_lead_id" "uuid", "p_vendor_ids" "uuid"[], "p_allow_duplicate" boolean, "p_total_limit" integer) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."admin_smart_assign_lead_to_vendors"("p_lead_id" "uuid", "p_vendor_ids" "uuid"[], "p_allow_duplicate" boolean, "p_total_limit" integer) TO "service_role";
REVOKE ALL ON FUNCTION "public"."apply_communication_consent_command"("p_policy_version" "text", "p_channel" "text", "p_command" "text", "p_destination_hash" "text", "p_principal_type" "text", "p_principal_id" "uuid", "p_provider" "text", "p_provider_message_id" "text", "p_source_event_type" "text", "p_source_event_id" "text", "p_inbound_message_id" "uuid", "p_occurred_at" "text", "p_received_at" "text", "p_correlation_id" "text", "p_causation_id" "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."apply_communication_consent_command"("p_policy_version" "text", "p_channel" "text", "p_command" "text", "p_destination_hash" "text", "p_principal_type" "text", "p_principal_id" "uuid", "p_provider" "text", "p_provider_message_id" "text", "p_source_event_type" "text", "p_source_event_id" "text", "p_inbound_message_id" "uuid", "p_occurred_at" "text", "p_received_at" "text", "p_correlation_id" "text", "p_causation_id" "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."assign_client_selected_vendor_to_group"("p_group_id" "uuid", "p_lead_id" "uuid", "p_vendor_id" "uuid", "p_total_limit" integer) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."assign_client_selected_vendor_to_group"("p_group_id" "uuid", "p_lead_id" "uuid", "p_vendor_id" "uuid", "p_total_limit" integer) TO "service_role";
REVOKE ALL ON FUNCTION "public"."assign_lead_to_paid_vendors_phase26a"("p_lead_id" "uuid", "p_vendor_ids" "uuid"[]) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."assign_lead_to_paid_vendors_phase26a"("p_lead_id" "uuid", "p_vendor_ids" "uuid"[]) TO "service_role";
REVOKE ALL ON FUNCTION "public"."assign_lead_to_preferred_vendor"("p_lead_id" "uuid", "p_vendor_id" "uuid") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."assign_lead_to_preferred_vendor"("p_lead_id" "uuid", "p_vendor_id" "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."assign_lead_to_vendors"("p_lead_id" "uuid", "p_selected_vendor_ids" "uuid"[], "p_allow_duplicate" boolean, "p_selected_type" "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."assign_lead_to_vendors"("p_lead_id" "uuid", "p_selected_vendor_ids" "uuid"[], "p_allow_duplicate" boolean, "p_selected_type" "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."assign_package_to_vendor"("p_vendor_id" "uuid", "p_package_id" "uuid", "p_payment_id" "uuid") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."assign_package_to_vendor"("p_vendor_id" "uuid", "p_package_id" "uuid", "p_payment_id" "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."assign_vendor_to_requirement_group"("p_group_id" "uuid", "p_lead_id" "uuid", "p_vendor_id" "uuid", "p_assignment_source" "text", "p_total_limit" integer, "p_assignment_type" "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."assign_vendor_to_requirement_group"("p_group_id" "uuid", "p_lead_id" "uuid", "p_vendor_id" "uuid", "p_assignment_source" "text", "p_total_limit" integer, "p_assignment_type" "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."check_duplicate_lead"("p_phone" "text", "p_service" "text", "p_city" "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."check_duplicate_lead"("p_phone" "text", "p_service" "text", "p_city" "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."communication_consent_receipt_results_valid"("p_results" "jsonb") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."communication_consent_receipt_results_valid"("p_results" "jsonb") TO "service_role";
REVOKE ALL ON FUNCTION "public"."communication_consent_receipt_scope_result_valid"("p_item" "jsonb", "p_scope" "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."communication_consent_receipt_scope_result_valid"("p_item" "jsonb", "p_scope" "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."deduct_vendor_credit"("p_vendor_id" "uuid") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."deduct_vendor_credit"("p_vendor_id" "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."expire_vendor_packages"() FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."expire_vendor_packages"() TO "service_role";
REVOKE ALL ON FUNCTION "public"."get_public_eligible_vendors"("p_city" "text", "p_area" "text", "p_service" "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_public_eligible_vendors"("p_city" "text", "p_area" "text", "p_service" "text") TO "service_role", "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."get_setting_int"("p_key" "text", "p_default" integer) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_setting_int"("p_key" "text", "p_default" integer) TO "service_role";
REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "service_role";
REVOKE ALL ON FUNCTION "public"."increment_vendor_credits"("p_vendor_id" "uuid", "p_credit_count" integer) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."increment_vendor_credits"("p_vendor_id" "uuid", "p_credit_count" integer) TO "service_role";
REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."is_admin"() TO "service_role", "authenticated";
REVOKE ALL ON FUNCTION "public"."owns_vendor"("p_vendor_id" "uuid") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."owns_vendor"("p_vendor_id" "uuid") TO "service_role", "authenticated";
REVOKE ALL ON FUNCTION "public"."qf_apply_vendor_credit_delta"("p_vendor_id" "uuid", "p_delta" integer, "p_change_type" "text", "p_reason" "text", "p_reference_type" "text", "p_reference_id" "text", "p_updated_by" "text", "p_allow_negative" boolean) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."qf_apply_vendor_credit_delta"("p_vendor_id" "uuid", "p_delta" integer, "p_change_type" "text", "p_reason" "text", "p_reference_type" "text", "p_reference_id" "text", "p_updated_by" "text", "p_allow_negative" boolean) TO "service_role";
REVOKE ALL ON FUNCTION "public"."qf_claim_auth_delivery_attempt"("p_auth_flow" "text", "p_auth_action_id" "text", "p_auth_reference_type" "text", "p_auth_reference_id" "text", "p_destination_hash" "text", "p_attempt_number" integer, "p_channel" "text", "p_provider_key" "text", "p_challenge_id" "uuid", "p_auth_user_id" "uuid", "p_decision_reason" "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."qf_claim_auth_delivery_attempt"("p_auth_flow" "text", "p_auth_action_id" "text", "p_auth_reference_type" "text", "p_auth_reference_id" "text", "p_destination_hash" "text", "p_attempt_number" integer, "p_channel" "text", "p_provider_key" "text", "p_challenge_id" "uuid", "p_auth_user_id" "uuid", "p_decision_reason" "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."qf_claim_consent_ack_intents"("p_worker_id" "text", "p_limit" integer, "p_stale_lease" interval) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."qf_claim_consent_ack_intents"("p_worker_id" "text", "p_limit" integer, "p_stale_lease" interval) TO "service_role";
REVOKE ALL ON FUNCTION "public"."qf_expire_consent_ack_intents"("p_limit" integer) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."qf_expire_consent_ack_intents"("p_limit" integer) TO "service_role";
REVOKE ALL ON FUNCTION "public"."qf_finalize_auth_delivery_attempt"("p_attempt_id" "uuid", "p_status" "text", "p_outcome_certainty" "text", "p_failure_code" "text", "p_failure_classification" "text", "p_communication_message_id" "uuid") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."qf_finalize_auth_delivery_attempt"("p_attempt_id" "uuid", "p_status" "text", "p_outcome_certainty" "text", "p_failure_code" "text", "p_failure_classification" "text", "p_communication_message_id" "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."qf_lead_vendor_parent_group_compatible"("p_service_required" "text", "p_category" "text", "p_subcategory" "text", "p_vendor_service_categories" "text"[], "p_vendor_selected_category" "text", "p_vendor_selected_subcategories" "text"[]) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."qf_lead_vendor_parent_group_compatible"("p_service_required" "text", "p_category" "text", "p_subcategory" "text", "p_vendor_service_categories" "text"[], "p_vendor_selected_category" "text", "p_vendor_selected_subcategories" "text"[]) TO "service_role";
REVOKE ALL ON FUNCTION "public"."qf_norm_text"("p_value" "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."qf_norm_text"("p_value" "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."qf_normalize_category_label"("p_value" "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."qf_normalize_category_label"("p_value" "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."qf_parent_category_group"("p_value" "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."qf_parent_category_group"("p_value" "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."qf_recover_stale_dispatching_consent_ack_intents"("p_stale_after" interval, "p_limit" integer) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."qf_recover_stale_dispatching_consent_ack_intents"("p_stale_after" interval, "p_limit" integer) TO "service_role";
REVOKE ALL ON FUNCTION "public"."qf_reserve_consent_ack_provider_attempt"("p_intent_id" "text", "p_worker_id" "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."qf_reserve_consent_ack_provider_attempt"("p_intent_id" "text", "p_worker_id" "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."qf_terminalize_consent_ack_intent"("p_intent_id" "text", "p_status" "text", "p_terminal_code" "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."qf_terminalize_consent_ack_intent"("p_intent_id" "text", "p_status" "text", "p_terminal_code" "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."refresh_requirement_group_counters"("p_group_id" "uuid") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."refresh_requirement_group_counters"("p_group_id" "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."restore_vendor_credit"("p_vendor_id" "uuid") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."restore_vendor_credit"("p_vendor_id" "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."update_vendor_visibility"("p_vendor_id" "uuid") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."update_vendor_visibility"("p_vendor_id" "uuid") TO "service_role";
REVOKE ALL ON FUNCTION "public"."vendor_auth_claim_reset_grant"("p_grant_token_hash" "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."vendor_auth_claim_reset_grant"("p_grant_token_hash" "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."vendor_auth_consume_reset_challenge_and_issue_grant"("p_challenge_id" "uuid", "p_vendor_dashboard_user_id" "uuid", "p_user_id" "uuid", "p_vendor_id" "uuid", "p_grant_token_hash" "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."vendor_auth_consume_reset_challenge_and_issue_grant"("p_challenge_id" "uuid", "p_vendor_dashboard_user_id" "uuid", "p_user_id" "uuid", "p_vendor_id" "uuid", "p_grant_token_hash" "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."vendor_auth_consume_whatsapp_challenge"("p_challenge_id" "uuid", "p_vendor_dashboard_user_id" "uuid", "p_user_id" "uuid", "p_vendor_id" "uuid", "p_phone_e164" "text", "p_destination_hash" "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."vendor_auth_consume_whatsapp_challenge"("p_challenge_id" "uuid", "p_vendor_dashboard_user_id" "uuid", "p_user_id" "uuid", "p_vendor_id" "uuid", "p_phone_e164" "text", "p_destination_hash" "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."vendor_auth_issue_challenge"("p_challenge_id" "uuid", "p_vendor_dashboard_user_id" "uuid", "p_user_id" "uuid", "p_vendor_id" "uuid", "p_purpose" "text", "p_destination_hash" "text", "p_otp_hash" "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."vendor_auth_issue_challenge"("p_challenge_id" "uuid", "p_vendor_dashboard_user_id" "uuid", "p_user_id" "uuid", "p_vendor_id" "uuid", "p_purpose" "text", "p_destination_hash" "text", "p_otp_hash" "text") TO "service_role";
REVOKE ALL ON FUNCTION "public"."vendor_auth_register_failed_attempt"("p_challenge_id" "uuid", "p_purpose" "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."vendor_auth_register_failed_attempt"("p_challenge_id" "uuid", "p_purpose" "text") TO "service_role";

-- Tables (all 62): default-deny to PUBLIC/anon/authenticated; service_role operational.
REVOKE ALL ON TABLE "public"."aos_runtime_settings" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."aos_runtime_settings" TO "service_role";
REVOKE ALL ON TABLE "public"."app_settings" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";
REVOKE ALL ON TABLE "public"."auth_security_events" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."auth_security_events" TO "service_role";
REVOKE ALL ON TABLE "public"."authentication_delivery_attempts" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."authentication_delivery_attempts" TO "service_role";
REVOKE ALL ON TABLE "public"."authentication_transport_failure_rules" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."authentication_transport_failure_rules" TO "service_role";
REVOKE ALL ON TABLE "public"."authentication_transport_policies" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."authentication_transport_policies" TO "service_role";
REVOKE ALL ON TABLE "public"."bad_lead_report_comments" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."bad_lead_report_comments" TO "service_role";
REVOKE ALL ON TABLE "public"."bad_lead_reports" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."bad_lead_reports" TO "service_role";
REVOKE ALL ON TABLE "public"."cities" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."cities" TO "service_role";
REVOKE ALL ON TABLE "public"."client_accounts" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."client_accounts" TO "service_role";
REVOKE ALL ON TABLE "public"."client_notification_logs" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."client_notification_logs" TO "service_role";
REVOKE ALL ON TABLE "public"."client_requirement_groups" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."client_requirement_groups" TO "service_role";
REVOKE ALL ON TABLE "public"."communication_automation_catalog" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."communication_automation_catalog" TO "service_role";
REVOKE ALL ON TABLE "public"."communication_channel_capabilities" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."communication_channel_capabilities" TO "service_role";
REVOKE ALL ON TABLE "public"."communication_consent_ack_intents" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."communication_consent_ack_intents" TO "service_role";
REVOKE ALL ON TABLE "public"."communication_consent_command_receipts" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."communication_consent_command_receipts" TO "service_role";
REVOKE ALL ON TABLE "public"."communication_consent_events" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."communication_consent_events" TO "service_role";
REVOKE ALL ON TABLE "public"."communication_delivery_events" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."communication_delivery_events" TO "service_role";
REVOKE ALL ON TABLE "public"."communication_inbound_messages" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."communication_inbound_messages" TO "service_role";
REVOKE ALL ON TABLE "public"."communication_messages" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."communication_messages" TO "service_role";
REVOKE ALL ON TABLE "public"."communication_preferences" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."communication_preferences" TO "service_role";
REVOKE ALL ON TABLE "public"."communication_provider_accounts" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."communication_provider_accounts" TO "service_role";
REVOKE ALL ON TABLE "public"."communication_provider_canary_destinations" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."communication_provider_canary_destinations" TO "service_role";
REVOKE ALL ON TABLE "public"."communication_provider_runtime_policies" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."communication_provider_runtime_policies" TO "service_role";
REVOKE ALL ON TABLE "public"."communication_provider_template_mappings" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."communication_provider_template_mappings" TO "service_role";
REVOKE ALL ON TABLE "public"."communication_suppressions" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."communication_suppressions" TO "service_role";
REVOKE ALL ON TABLE "public"."communication_templates" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."communication_templates" TO "service_role";
REVOKE ALL ON TABLE "public"."communication_webhook_receipts" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."communication_webhook_receipts" TO "service_role";
REVOKE ALL ON TABLE "public"."free_vendor_profile_interests" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."free_vendor_profile_interests" TO "service_role";
REVOKE ALL ON TABLE "public"."lead_assignment_approvals" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."lead_assignment_approvals" TO "service_role";
REVOKE ALL ON TABLE "public"."lead_assignment_queue" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."lead_assignment_queue" TO "service_role";
REVOKE ALL ON TABLE "public"."lead_assignments" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."lead_assignments" TO "service_role";
REVOKE ALL ON TABLE "public"."lead_auto_assignment_logs" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."lead_auto_assignment_logs" TO "service_role";
REVOKE ALL ON TABLE "public"."lead_clarification_requests" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."lead_clarification_requests" TO "service_role";
REVOKE ALL ON TABLE "public"."lead_clarification_responses" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."lead_clarification_responses" TO "service_role";
REVOKE ALL ON TABLE "public"."lead_delivery_logs" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."lead_delivery_logs" TO "service_role";
REVOKE ALL ON TABLE "public"."lead_matching_runs" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."lead_matching_runs" TO "service_role";
REVOKE ALL ON TABLE "public"."lead_scores" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."lead_scores" TO "service_role";
REVOKE ALL ON TABLE "public"."lead_status_updates" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."lead_status_updates" TO "service_role";
REVOKE ALL ON TABLE "public"."leads" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";
REVOKE ALL ON TABLE "public"."marketplace_runtime_settings" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."marketplace_runtime_settings" TO "service_role";
REVOKE ALL ON TABLE "public"."packages" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."packages" TO "service_role";
REVOKE ALL ON TABLE "public"."password_reset_grants" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."password_reset_grants" TO "service_role";
REVOKE ALL ON TABLE "public"."payments" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";
REVOKE ALL ON TABLE "public"."profiles" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";
REVOKE ALL ON TABLE "public"."service_categories" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."service_categories" TO "service_role";
REVOKE ALL ON TABLE "public"."vendor_credit_logs" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."vendor_credit_logs" TO "service_role";
REVOKE ALL ON TABLE "public"."vendor_dashboard_users" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."vendor_dashboard_users" TO "service_role";
REVOKE ALL ON TABLE "public"."vendor_lead_activity_logs" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."vendor_lead_activity_logs" TO "service_role";
REVOKE ALL ON TABLE "public"."vendor_lead_report_comments" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."vendor_lead_report_comments" TO "service_role";
REVOKE ALL ON TABLE "public"."vendor_lead_reports" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."vendor_lead_reports" TO "service_role";
REVOKE ALL ON TABLE "public"."vendor_mobile_auth_provisions" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."vendor_mobile_auth_provisions" TO "service_role";
REVOKE ALL ON TABLE "public"."vendor_notifications" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."vendor_notifications" TO "service_role";
REVOKE ALL ON TABLE "public"."vendor_package_orders" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."vendor_package_orders" TO "service_role";
REVOKE ALL ON TABLE "public"."vendor_package_purchase_requests" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."vendor_package_purchase_requests" TO "service_role";
REVOKE ALL ON TABLE "public"."vendor_packages" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."vendor_packages" TO "service_role";
REVOKE ALL ON TABLE "public"."vendor_profile_change_requests" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."vendor_profile_change_requests" TO "service_role";
REVOKE ALL ON TABLE "public"."vendor_support_messages" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."vendor_support_messages" TO "service_role";
REVOKE ALL ON TABLE "public"."vendor_support_threads" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."vendor_support_threads" TO "service_role";
REVOKE ALL ON TABLE "public"."vendors" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."vendors" TO "service_role";
REVOKE ALL ON TABLE "public"."verification_challenges" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."verification_challenges" TO "service_role";
REVOKE ALL ON TABLE "public"."whatsapp_logs" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_logs" TO "service_role";

-- End of qf_mvp_staging_baseline_269c9265. STAGING ONLY. NEVER apply to yqpgcsduqbxulrlzwzap.
