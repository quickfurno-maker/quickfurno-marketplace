-- ============================================================================
-- QuickFurno — 20260708000190_client_whatsapp_otp_login_readiness.sql
--
-- PHASE 5D — CLIENT WHATSAPP OTP LOGIN READINESS (additive-only, mock-safe).
--
-- Prepares the client login OTP path for a LATER controlled activation, WITHOUT
-- turning anything on. After this migration:
--   • the client_login_otp automation is 'mock_ready' but still
--     is_operationally_enabled = false and provider_required = 'mock';
--   • client_accounts carries exactly the least-privilege grants the server layer
--     needs (authenticated: SELECT only; service_role: SELECT/INSERT/UPDATE);
--   • a partial index supports the WhatsApp delivery ATTESTATION lookup the verify
--     service performs — indexing only hashes/ids/status/time, never plaintext.
--
-- IDENTITY MODEL (unchanged, do not merge):
--   • Supabase Auth               = OTP generation/validity/verification + session
--   • Phase 5B communication core = transport of the Supabase-generated OTP
--   • client_accounts             = QuickFurno client business identity mapping
--   • auth_security_events        = security audit
--   • verification_challenges     = vendor-owned QuickFurno challenges ONLY —
--     NO client login OTP row is ever created here or anywhere else.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   • It does NOT set is_operationally_enabled = true.
--   • It does NOT set readiness_status = 'active'.
--   • It does NOT configure a real provider (provider_required stays 'mock').
--   • It does NOT alter any other automation row.
--   • It does NOT create a client_login purpose in verification_challenges.
--   • It does NOT create a second OTP store, custom JWT, or custom session.
--   • It does NOT touch Phase 5A / 5B / 5C migration files or their objects,
--     beyond the client_accounts GRANT/REVOKE hardening below.
--
-- MIGRATION-HISTORY DRIFT WARNING
--   The Supabase CLI migration history is drifted from the local files. Do NOT
--   run `supabase db push` / `migration up` / `migration repair` / reset. This
--   file is a review artefact and is applied MANUALLY after GitHub audit.
--
-- Additive, idempotent, non-destructive. NOT applied to production by this change.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) CLIENT OTP AUTOMATION READINESS — wiring_pending → mock_ready (guarded)
-- ----------------------------------------------------------------------------
-- A guarded DO block that RAISES on any unexpected state rather than silently
-- accepting the migration. Only two states are acceptable:
--
--   CASE A (transition): exactly one client_login_otp row with lane=authentication,
--     channel=whatsapp, template_key=client_login_otp, provider_required=mock,
--     is_operationally_enabled=false, readiness_status=wiring_pending
--     → update readiness_status to mock_ready; assert exactly one row transitions.
--
--   CASE B (idempotent): the same row already at readiness_status=mock_ready
--     → no-op.
--
-- EVERY other state RAISES: missing row, duplicate rows (schema drift),
-- is_operationally_enabled=true, wrong lane/channel/template/provider, or any
-- other readiness value. It NEVER enables the automation, NEVER sets 'active',
-- NEVER configures a real provider, and NEVER touches another automation row.
do $$
declare
  v_count    integer;
  v_row      public.communication_automation_catalog%rowtype;
  v_updated  integer;
begin
  select count(*) into v_count
  from public.communication_automation_catalog
  where automation_key = 'client_login_otp';

  if v_count = 0 then
    raise exception 'Phase 5D: client_login_otp automation row is missing'
      using errcode = 'no_data_found',
            hint = 'Apply the Phase 5B communication core before Phase 5D.';
  elsif v_count > 1 then
    raise exception 'Phase 5D: client_login_otp automation has % rows (schema drift)', v_count
      using errcode = 'cardinality_violation';
  end if;

  select * into v_row
  from public.communication_automation_catalog
  where automation_key = 'client_login_otp';

  -- Structural invariants that must hold in BOTH acceptable states.
  if v_row.lane <> 'authentication'
     or v_row.channel <> 'whatsapp'
     or v_row.template_key <> 'client_login_otp'
     or v_row.provider_required <> 'mock'
     or v_row.is_operationally_enabled <> false then
    raise exception
      'Phase 5D: client_login_otp automation is in an unexpected state (lane=%, channel=%, template=%, provider=%, enabled=%)',
      v_row.lane, v_row.channel, v_row.template_key, v_row.provider_required, v_row.is_operationally_enabled
      using errcode = 'invalid_table_definition',
            hint = 'Phase 5D refuses to run against an unexpected or already-operational automation state.';
  end if;

  if v_row.readiness_status = 'wiring_pending' then
    -- CASE A — expected transition.
    update public.communication_automation_catalog
    set readiness_status = 'mock_ready', updated_at = now()
    where automation_key = 'client_login_otp'
      and readiness_status = 'wiring_pending'
      and lane = 'authentication'
      and channel = 'whatsapp'
      and template_key = 'client_login_otp'
      and provider_required = 'mock'
      and is_operationally_enabled = false;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Phase 5D: expected exactly one client_login_otp row to transition, got %', v_updated
        using errcode = 'cardinality_violation';
    end if;

  elsif v_row.readiness_status = 'mock_ready' then
    -- CASE B — already correct. Idempotent no-op.
    null;

  else
    raise exception
      'Phase 5D: client_login_otp readiness is %, expected wiring_pending or mock_ready', v_row.readiness_status
      using errcode = 'invalid_table_definition';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 2) CLIENT_ACCOUNTS PRIVILEGE HARDENING — REVOKE ALL, then least-privilege GRANT
-- ----------------------------------------------------------------------------
-- The linked database carries historical broad table grants on client_accounts
-- (including DELETE / TRUNCATE / REFERENCES / TRIGGER) that a GRANT can never
-- remove. Phase 5A additionally granted service_role DELETE, which this phase
-- removes. Every role is therefore REVOKED to zero FIRST, then granted exactly
-- what it needs. The revoke must precede the grant.
--
-- Required effective state:
--   anon           → no direct privileges
--   authenticated  → SELECT only
--   service_role   → SELECT, INSERT, UPDATE
-- No role retains DELETE / TRUNCATE / REFERENCES / TRIGGER.
--
-- RLS stays enabled and the Phase 5A owner-read + admin-manage policies are
-- preserved untouched (they are NOT dropped or recreated here). Client account
-- provisioning and the whatsapp_verified_at write happen server-side only.
alter table public.client_accounts enable row level security;

-- anon: browser-side clients authenticate before anything here is readable.
revoke all on public.client_accounts from anon;

-- authenticated: SELECT only, governed by the Phase 5A owner/admin policy. No
-- INSERT/UPDATE/DELETE grant, so a client can never write this table from the
-- browser (no client-side INSERT/UPDATE authority is ever added).
revoke all on public.client_accounts from authenticated;
grant select on public.client_accounts to authenticated;

-- service_role: the server layer provisions accounts and stamps the WhatsApp
-- verification timestamp. Exactly SELECT + INSERT + UPDATE remain after the
-- revoke — no DELETE, no TRUNCATE, no REFERENCES, no TRIGGER. Account removal is
-- expressed by setting `status`, never by deleting a row.
revoke all on public.client_accounts from service_role;
grant select, insert, update on public.client_accounts to service_role;

-- ----------------------------------------------------------------------------
-- 3) COMMUNICATION ATTESTATION INDEX — support the verify-time ledger lookup
-- ----------------------------------------------------------------------------
-- The client verify service confirms a recent successful client_login_otp
-- WhatsApp communication for the verified Supabase Auth user + phone, using the
-- EXISTING communication_messages ledger (no second OTP/challenge table is
-- created). This partial index covers exactly that lookup.
--
-- It indexes ONLY entity_id (the auth user id), destination_hash (sha256 of the
-- canonical phone), status, and created_at. There is no plaintext phone or OTP
-- column in communication_messages, and none is referenced here.
create index if not exists idx_comm_messages_client_login_attestation
  on public.communication_messages (entity_id, destination_hash, status, created_at desc)
  where message_type = 'client_login_otp'
    and lane = 'authentication'
    and entity_type = 'auth_user';

-- ============================================================================
-- Deliberately NOT created (per Phase 5D review scope):
--   • no is_operationally_enabled = true, no readiness_status = 'active'
--   • no real provider configuration (provider_required stays 'mock')
--   • no change to any automation row other than client_login_otp
--   • no client_login purpose in verification_challenges; no OTP/token column
--   • no anon grant; no authenticated INSERT/UPDATE/DELETE grant or policy
--   • no DELETE / TRUNCATE / REFERENCES / TRIGGER privilege for ANY role
--   • no drop/recreate of the Phase 5A client_accounts RLS policies
--   • no plaintext phone/OTP column or index anywhere
--   • no historical lead relinking; no change to anonymous lead submission
-- ============================================================================
