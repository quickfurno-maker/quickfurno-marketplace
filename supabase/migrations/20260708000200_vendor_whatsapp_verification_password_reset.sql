-- ============================================================================
-- QuickFurno — 20260708000200_vendor_whatsapp_verification_password_reset.sql
--
-- PHASE 5E — VENDOR WHATSAPP VERIFICATION + VENDOR PASSWORD RESET FOUNDATION.
--
-- Additive, non-destructive, idempotent where practical, fail-loud on automation
-- drift. Nothing becomes production-operational by applying this file: both 5E
-- automations remain is_operationally_enabled = false with provider_required =
-- 'mock', so no real WhatsApp message can be delivered.
--
-- THREE VENDOR SECURITY CONCERNS STAY DISTINCT (never merged):
--   1. vendor LOGIN                 = Supabase Auth + vendor_dashboard_users map
--   2. vendor WHATSAPP VERIFICATION = purpose-bound challenge + phone_e164 binding
--   3. vendor PASSWORD RESET        = purpose-bound challenge + single-use grant
-- Dashboard access continues to depend ONLY on an authentic Supabase user, a
-- valid mapping, and an active membership. Nothing below makes phone_verified,
-- whatsapp_otp_enabled, package, paid status, credits or business verification a
-- login credential.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   • It does NOT backfill vendor_dashboard_users.phone_e164 from ANY source.
--   • It never reads, writes, or infers from vendor_dashboard_users.phone,
--     vendors.phone, or vendors.whatsapp_number. Those are legacy BUSINESS
--     contact fields, not authentication identity.
--   • It never prefixes a country code. No country dialling-code literal appears
--     anywhere in this file, and phone_e164 is never derived from a legacy value.
--   • It does NOT enable an automation, set readiness 'active', or configure a
--     real provider.
--   • It does NOT touch client_login_otp or any business automation.
--   • It does NOT create a client OTP purpose — verification_challenges stays
--     vendor-only.
--   • It stores no plaintext OTP and no plaintext reset-grant token.
--
-- MIGRATION-HISTORY DRIFT WARNING
--   The Supabase CLI migration history is drifted from the local files. Do NOT
--   run `supabase db push` / `migration up` / `migration repair` / `db reset`.
--   This file is a review artefact, applied MANUALLY after GitHub audit.
--
-- NOT applied to production by this change.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — CANONICAL VENDOR AUTH PHONE (explicit, verified, never guessed)
-- ============================================================================
-- vendor_dashboard_users.phone holds LEGACY, non-canonical contact values (the
-- linked database has 3 rows, all non-E.164). It is left exactly as it is.
--
-- phone_e164 is a NEW, separate column: the canonical authentication/WhatsApp
-- SECURITY phone. It is null until the vendor explicitly submits an international
-- number and proves possession of it via a WhatsApp OTP challenge. It is NOT the
-- vendor's general business contact number.
alter table public.vendor_dashboard_users
  add column if not exists phone_e164           text,
  add column if not exists whatsapp_verified_at timestamptz;

-- Canonical E.164: '+', a non-zero country digit, then 7–14 more digits (8–15
-- total). This mirrors lib/communication/phone.ts exactly, so a value the
-- application refuses to normalize can never be written by another path.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'vendor_dashboard_users_phone_e164_format_chk'
      and conrelid = 'public.vendor_dashboard_users'::regclass
  ) then
    alter table public.vendor_dashboard_users
      add constraint vendor_dashboard_users_phone_e164_format_chk
      check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$');
  end if;
end
$$;

-- A verified auth phone belongs to exactly ONE vendor dashboard identity. Partial
-- so the many not-yet-verified rows may all hold NULL. This index is the FINAL
-- authority on phone ownership: the consume function below relies on it to make
-- stealing another identity's verified number abort the whole transaction.
create unique index if not exists uq_vendor_dashboard_users_phone_e164
  on public.vendor_dashboard_users(phone_e164)
  where phone_e164 is not null;

-- NO BACKFILL. Every existing row keeps phone_e164 = NULL and
-- whatsapp_verified_at = NULL until an explicit, verified Phase 5E challenge
-- binds one. There is deliberately no UPDATE/INSERT touching phone_e164 in this
-- migration, and no read of vendors.phone / vendors.whatsapp_number anywhere.


-- ============================================================================
-- SECTION 2 — CHALLENGE IDENTITY LINEAGE (ownership is never inferred)
-- ============================================================================
-- Phase 5A created verification_challenges with a POLYMORPHIC principal
-- (principal_type/principal_id) and no explicit lineage. A challenge must be
-- bound to the vendor dashboard membership, the Auth user, the vendor business,
-- the purpose, and the destination hash — never to a browser-supplied vendor_id.
alter table public.verification_challenges
  add column if not exists vendor_dashboard_user_id uuid,
  add column if not exists user_id                  uuid,
  add column if not exists vendor_id                uuid,
  add column if not exists last_sent_at             timestamptz,
  add column if not exists last_attempt_at          timestamptz,
  -- The CHANNEL that actually carried the OTP (recorded at delivery time), bound
  -- alongside the provider so attestation is channel + provider specific.
  add column if not exists delivery_channel         text,
  add column if not exists delivery_provider        text,
  add column if not exists communication_message_id uuid;

-- CHANNEL VOCABULARY READINESS (whatsapp only is implemented in Phase 5E).
-- The CHECK admits 'whatsapp' (the only channel this phase delivers on) and 'sms'
-- as forward VOCABULARY readiness — there is NO SMS delivery path, adapter, or
-- attestation implemented, and RCS is deliberately not part of the vocabulary. The
-- application only ever writes 'whatsapp'; a future SMS phase enables the value, it
-- does not need a schema change. NULL until a challenge has been delivered.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'verification_challenges_delivery_channel_chk'
      and conrelid = 'public.verification_challenges'::regclass
  ) then
    alter table public.verification_challenges
      add constraint verification_challenges_delivery_channel_chk
      check (delivery_channel is null or delivery_channel in ('whatsapp', 'sms'));
  end if;
end
$$;

-- Delete semantics, chosen to match the established identity rules:
--   • vendor_dashboard_user_id → CASCADE: a challenge is meaningless without the
--     membership it authenticates. (vendor_dashboard_users itself cascades from
--     vendors, so removing a business removes its challenges.)
--   • user_id  → CASCADE: matches password_reset_grants.user_id (Phase 5A). A
--     challenge is auth ephemera, not a business record.
--   • vendor_id → CASCADE: matches password_reset_grants.vendor_id (Phase 5A).
--   • communication_message_id → RESTRICT: the ledger row is the DELIVERY PROOF a
--     verification depends on. It must not disappear from under a live challenge.
--     (Removing the challenge first is always permitted.)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'verification_challenges_vendor_dashboard_user_id_fkey'
      and conrelid = 'public.verification_challenges'::regclass
  ) then
    alter table public.verification_challenges
      add constraint verification_challenges_vendor_dashboard_user_id_fkey
      foreign key (vendor_dashboard_user_id)
      references public.vendor_dashboard_users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'verification_challenges_user_id_fkey'
      and conrelid = 'public.verification_challenges'::regclass
  ) then
    alter table public.verification_challenges
      add constraint verification_challenges_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'verification_challenges_vendor_id_fkey'
      and conrelid = 'public.verification_challenges'::regclass
  ) then
    alter table public.verification_challenges
      add constraint verification_challenges_vendor_id_fkey
      foreign key (vendor_id) references public.vendors(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'verification_challenges_communication_message_id_fkey'
      and conrelid = 'public.verification_challenges'::regclass
  ) then
    alter table public.verification_challenges
      add constraint verification_challenges_communication_message_id_fkey
      foreign key (communication_message_id)
      references public.communication_messages(id) on delete restrict;
  end if;
end
$$;

-- Ownership lookup: never scan by principal_id alone.
create index if not exists idx_verification_challenges_vdu_purpose_status
  on public.verification_challenges(vendor_dashboard_user_id, purpose, status);

create index if not exists idx_verification_challenges_user_purpose_status
  on public.verification_challenges(user_id, purpose, status);

-- Rate-limit history: issuance counts per identity + purpose over a time window.
create index if not exists idx_verification_challenges_rate_limit
  on public.verification_challenges(vendor_dashboard_user_id, purpose, created_at desc);

-- At most ONE pending challenge per (vendor dashboard identity, purpose). A
-- resend must cancel the previous challenge, so an attacker can never keep a
-- shelf of live OTPs open for the same identity and purpose.
create unique index if not exists uq_verification_challenges_one_pending
  on public.verification_challenges(vendor_dashboard_user_id, purpose)
  where status = 'pending' and vendor_dashboard_user_id is not null;


-- ============================================================================
-- SECTION 3 — RESET GRANT LINEAGE (one open grant, hash only, revocable)
-- ============================================================================
-- A grant must be traceable: dashboard membership → vendor business → Auth user
-- → the password-reset challenge that authorized it. Phase 5A already stores ONLY
-- grant_token_hash; no plaintext token column is added here or anywhere.
alter table public.password_reset_grants
  add column if not exists vendor_dashboard_user_id uuid,
  add column if not exists challenge_id             uuid,
  add column if not exists revoked_at               timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'password_reset_grants_vendor_dashboard_user_id_fkey'
      and conrelid = 'public.password_reset_grants'::regclass
  ) then
    alter table public.password_reset_grants
      add constraint password_reset_grants_vendor_dashboard_user_id_fkey
      foreign key (vendor_dashboard_user_id)
      references public.vendor_dashboard_users(id) on delete cascade;
  end if;

  -- CASCADE (not RESTRICT): a challenge is itself cascade-deleted when the vendor
  -- business is removed, and a RESTRICT here would make that vendor deletion fail.
  if not exists (
    select 1 from pg_constraint
    where conname = 'password_reset_grants_challenge_id_fkey'
      and conrelid = 'public.password_reset_grants'::regclass
  ) then
    alter table public.password_reset_grants
      add constraint password_reset_grants_challenge_id_fkey
      foreign key (challenge_id)
      references public.verification_challenges(id) on delete cascade;
  end if;
end
$$;

-- Active-grant lookup is by token HASH: Phase 5A's uq_password_reset_grants_token
-- (unique on grant_token_hash) already serves it. Lineage + user history:
create index if not exists idx_password_reset_grants_challenge
  on public.password_reset_grants(challenge_id);

-- AT MOST ONE simultaneously open (unconsumed, unrevoked) grant per Auth user.
-- Grant issuance revokes older open grants first; this partial unique index is the
-- FINAL authority, so a race can never leave two usable reset tokens outstanding.
create unique index if not exists uq_password_reset_grants_one_open
  on public.password_reset_grants(user_id)
  where consumed_at is null and revoked_at is null;


-- ============================================================================
-- SECTION 4 — AUTOMATION READINESS (wiring_pending → mock_ready, fail-loud)
-- ============================================================================
-- Moves EXACTLY the two Phase 5E automations to 'mock_ready'. It never enables an
-- automation, never sets readiness 'active', never changes provider_required, and
-- never touches client_login_otp or any business automation row.
--
-- Only two states are acceptable per row:
--   CASE A (transition): the exact safe wiring_pending row → becomes mock_ready.
--   CASE B (idempotent): the exact safe mock_ready row     → no-op.
-- EVERY other state RAISES: missing row, duplicate rows, wrong lane/channel/
-- template/provider, is_operationally_enabled = true, unexpected readiness, or a
-- NULL in any structural column.
--
-- NULL-SAFETY (why `is distinct from`, never `<>`):
--   communication_automation_catalog.template_key is NULLABLE. In PostgreSQL
--   `NULL <> 'vendor_whatsapp_verify'` evaluates to NULL — not TRUE — so an
--   OR-chain of `<>` tests yields NULL for a NULL field, the `if` never fires, and
--   a malformed row slips past instead of RAISING. `is distinct from` returns TRUE
--   when exactly one side is NULL. Every structural column is compared this way,
--   including the NOT NULL ones, so the guard also fails closed under future
--   schema drift that relaxes them.
do $$
declare
  v_keys     text[] := array['vendor_whatsapp_verify', 'vendor_password_reset'];
  v_key      text;
  v_count    integer;
  v_row      public.communication_automation_catalog%rowtype;
  v_updated  integer;
begin
  foreach v_key in array v_keys loop
    select count(*) into v_count
    from public.communication_automation_catalog
    where automation_key = v_key;

    if v_count = 0 then
      raise exception 'Phase 5E: automation row % is missing', v_key
        using errcode = 'no_data_found',
              hint = 'Apply the Phase 5B communication core before Phase 5E.';
    elsif v_count > 1 then
      raise exception 'Phase 5E: automation % has % rows (schema drift)', v_key, v_count
        using errcode = 'cardinality_violation';
    end if;

    select * into v_row
    from public.communication_automation_catalog
    where automation_key = v_key;

    -- Structural invariants that must hold in BOTH acceptable states.
    -- The template_key must equal the automation key for these two automations.
    if v_row.lane is distinct from 'authentication'
       or v_row.channel is distinct from 'whatsapp'
       or v_row.template_key is distinct from v_key
       or v_row.provider_required is distinct from 'mock'
       or v_row.is_operationally_enabled is distinct from false then
      raise exception
        'Phase 5E: automation % is in an unexpected state (lane=%, channel=%, template=%, provider=%, enabled=%)',
        v_key, v_row.lane, v_row.channel, v_row.template_key, v_row.provider_required, v_row.is_operationally_enabled
        using errcode = 'invalid_table_definition',
              hint = 'Phase 5E refuses to run against an unexpected or already-operational automation state.';
    end if;

    -- Null-safe dispatch: a NULL readiness matches neither branch and falls to the
    -- final `else`, which RAISEs. It is never silently treated as acceptable.
    if v_row.readiness_status is not distinct from 'wiring_pending' then
      -- CASE A — the expected one-time transition.
      update public.communication_automation_catalog
      set readiness_status = 'mock_ready', updated_at = now()
      where automation_key = v_key
        and readiness_status = 'wiring_pending'
        and lane = 'authentication'
        and channel = 'whatsapp'
        and template_key = v_key
        and provider_required = 'mock'
        and is_operationally_enabled = false;
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'Phase 5E: expected exactly one % row to transition, got %', v_key, v_updated
          using errcode = 'cardinality_violation';
      end if;

    elsif v_row.readiness_status is not distinct from 'mock_ready' then
      -- CASE B — already correct. Idempotent no-op.
      null;

    else
      raise exception
        'Phase 5E: automation % readiness is %, expected wiring_pending or mock_ready',
        v_key, v_row.readiness_status
        using errcode = 'invalid_table_definition';
    end if;
  end loop;
end
$$;


-- ============================================================================
-- SECTION 5 — PRIVILEGE HARDENING (REVOKE ALL, then exact GRANT)
-- ============================================================================
-- A GRANT only ADDS privileges. Phase 5A granted service_role DELETE on both
-- tables, and the linked database additionally carries historical broad grants
-- (TRUNCATE / REFERENCES / TRIGGER) that no GRANT can remove. Every role is
-- therefore REVOKED to zero FIRST, then granted exactly what the server layer
-- needs. The revoke must precede the grant.
--
-- Required effective state on BOTH tables:
--   anon           → no direct privileges
--   authenticated  → no direct privileges
--   service_role   → SELECT, INSERT, UPDATE
-- No role retains DELETE / TRUNCATE / REFERENCES / TRIGGER. Challenge and grant
-- history is LIFECYCLE-UPDATED (cancelled / expired / consumed / revoked), never
-- physically deleted by application logic.
--
-- RLS stays enabled with ZERO policies for anon/authenticated, so the browser can
-- never read an OTP hash or a reset-grant hash.
alter table public.verification_challenges enable row level security;
revoke all on public.verification_challenges from anon;
revoke all on public.verification_challenges from authenticated;
revoke all on public.verification_challenges from service_role;
grant select, insert, update on public.verification_challenges to service_role;

alter table public.password_reset_grants enable row level security;
revoke all on public.password_reset_grants from anon;
revoke all on public.password_reset_grants from authenticated;
revoke all on public.password_reset_grants from service_role;
grant select, insert, update on public.password_reset_grants to service_role;


-- ============================================================================
-- SECTION 6 — ATOMIC SECURITY FUNCTIONS
-- ============================================================================
-- The application must NEVER read-then-write a security-critical counter or claim.
-- Each function below performs its decision and its mutation in ONE statement, so
-- PostgreSQL's row locking — not application code — serializes concurrent callers.
--
-- Every function: SECURITY DEFINER, pinned search_path, EXECUTE revoked from
-- PUBLIC/anon/authenticated and granted only to service_role, and returns NO
-- secret (no otp_hash, no grant_token_hash, no pepper, no plaintext).

-- ----------------------------------------------------------------------------
-- 6A. FAILED OTP ATTEMPT — atomic increment + lock at max_attempts
-- ----------------------------------------------------------------------------
-- Under READ COMMITTED, a concurrent UPDATE re-evaluates its WHERE clause after
-- acquiring the row lock, so two racing wrong-guesses increment 0→1→2. A count can
-- never be lost, never decremented, and a terminal challenge is never revived.
create or replace function public.vendor_auth_register_failed_attempt(
  p_challenge_id uuid,
  p_purpose      text
)
returns table (
  challenge_id  uuid,
  status        text,
  attempt_count integer,
  max_attempts  integer,
  locked        boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

revoke all on function public.vendor_auth_register_failed_attempt(uuid, text) from public;
revoke all on function public.vendor_auth_register_failed_attempt(uuid, text) from anon;
revoke all on function public.vendor_auth_register_failed_attempt(uuid, text) from authenticated;
grant execute on function public.vendor_auth_register_failed_attempt(uuid, text) to service_role;


-- ----------------------------------------------------------------------------
-- 6B. CONSUME WHATSAPP VERIFICATION CHALLENGE — CAS, then bind verified identity
-- ----------------------------------------------------------------------------
-- Called ONLY after the server has loaded the challenge, validated ownership,
-- verified the contextual HMAC, and confirmed a matching provider-bound delivery
-- attestation. The challenge is compare-and-swapped to 'consumed' FIRST; the
-- verified flags are never written before that swap succeeds.
--
-- A phone already verified by another dashboard identity raises 23505 on
-- uq_vendor_dashboard_users_phone_e164. The exception aborts the whole function,
-- so the consume above rolls back with it: ownership is never stolen and the
-- challenge is never partially consumed.
create or replace function public.vendor_auth_consume_whatsapp_challenge(
  p_challenge_id             uuid,
  p_vendor_dashboard_user_id uuid,
  p_user_id                  uuid,
  p_vendor_id                uuid,
  p_phone_e164               text,
  p_destination_hash         text
)
returns table (
  vendor_dashboard_user_id uuid,
  vendor_id                uuid,
  user_id                  uuid,
  phone_e164               text,
  phone_verified           boolean,
  whatsapp_otp_enabled     boolean,
  whatsapp_verified_at     timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

revoke all on function public.vendor_auth_consume_whatsapp_challenge(uuid, uuid, uuid, uuid, text, text) from public;
revoke all on function public.vendor_auth_consume_whatsapp_challenge(uuid, uuid, uuid, uuid, text, text) from anon;
revoke all on function public.vendor_auth_consume_whatsapp_challenge(uuid, uuid, uuid, uuid, text, text) from authenticated;
grant execute on function public.vendor_auth_consume_whatsapp_challenge(uuid, uuid, uuid, uuid, text, text) to service_role;


-- ----------------------------------------------------------------------------
-- 6C. CONSUME RESET CHALLENGE + ISSUE GRANT — one open grant per Auth user
-- ----------------------------------------------------------------------------
-- Atomically: CAS the pending password-reset challenge to 'consumed', revoke every
-- older open grant for that Auth user (expired ones included), and insert the new
-- grant HASH. Returns only non-secret identity/metadata — never the token or hash.
--
-- SECURITY POLICY AUTHORITY: the reset-grant TTL is DATABASE-OWNED, exactly like the
-- challenge TTL / attempt limit / rate limits. The function takes NO p_expires_at —
-- it computes expires_at = now() + interval '10 minutes' from the database clock and
-- RETURNS it. A caller (even the service-role application) can never lengthen,
-- shorten, or otherwise control the grant lifetime. The application keeps a matching
-- advisory RESET_GRANT_TTL_MS for UI/docs/tests only; it never reaches this function.
create or replace function public.vendor_auth_consume_reset_challenge_and_issue_grant(
  p_challenge_id             uuid,
  p_vendor_dashboard_user_id uuid,
  p_user_id                  uuid,
  p_vendor_id                uuid,
  p_grant_token_hash         text
)
returns table (
  grant_id                 uuid,
  user_id                  uuid,
  vendor_id                uuid,
  vendor_dashboard_user_id uuid,
  expires_at               timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

revoke all on function public.vendor_auth_consume_reset_challenge_and_issue_grant(uuid, uuid, uuid, uuid, text) from public;
revoke all on function public.vendor_auth_consume_reset_challenge_and_issue_grant(uuid, uuid, uuid, uuid, text) from anon;
revoke all on function public.vendor_auth_consume_reset_challenge_and_issue_grant(uuid, uuid, uuid, uuid, text) from authenticated;
grant execute on function public.vendor_auth_consume_reset_challenge_and_issue_grant(uuid, uuid, uuid, uuid, text) to service_role;


-- ----------------------------------------------------------------------------
-- 6D. CLAIM RESET GRANT — exactly one concurrent winner
-- ----------------------------------------------------------------------------
-- A single conditional UPDATE. Under READ COMMITTED the loser of a race
-- re-evaluates `consumed_at is null` after the row lock and matches zero rows, so
-- exactly one password-reset completion can ever claim a grant.
--
-- The grant is BURNED on claim. If the subsequent Supabase Admin password update
-- fails, the grant stays consumed and the vendor must restart the reset — safer
-- than leaving a reusable grant after an uncertain password mutation.
create or replace function public.vendor_auth_claim_reset_grant(
  p_grant_token_hash text
)
returns table (
  grant_id                 uuid,
  user_id                  uuid,
  vendor_id                uuid,
  vendor_dashboard_user_id uuid,
  challenge_id             uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

revoke all on function public.vendor_auth_claim_reset_grant(text) from public;
revoke all on function public.vendor_auth_claim_reset_grant(text) from anon;
revoke all on function public.vendor_auth_claim_reset_grant(text) from authenticated;
grant execute on function public.vendor_auth_claim_reset_grant(text) to service_role;


-- ----------------------------------------------------------------------------
-- 6E. ISSUE CHALLENGE — one atomic issuance authority (serialized per identity)
-- ----------------------------------------------------------------------------
-- The whole issuance sequence — validate lineage + purpose, evaluate the persisted
-- cooldown/hour/day rate limits, cancel the prior pending challenge, insert exactly
-- one new pending challenge — happens INSIDE ONE transaction that first takes a
-- per-identity row lock (`select ... for update` on vendor_dashboard_users). Doing
-- it in application code as separate round trips is race-prone: two concurrent
-- requests could both pass a stale rate-limit read, both insert, and both send an
-- OTP (one of them for a challenge the other just cancelled). The lock serializes
-- issuance for a given dashboard identity, so concurrent callers cannot exceed the
-- persisted limits, cannot create two pending challenges, and cannot send a stale
-- OTP for a cancelled challenge.
--
-- Lineage and purpose are validated against the CURRENT locked row even though
-- EXECUTE is service-role-only: a caller-supplied (user_id, vendor_id) that does not
-- match the dashboard identity, or an unknown purpose, is rejected BEFORE any write.
-- The rate-limit history counts EVERY status (history is monotonic; cancelled and
-- consumed rows still count against the limit). It returns NO OTP plaintext.
--
-- SECURITY POLICY AUTHORITY (hardening): the function is the AUTHORITATIVE source of
-- the OTP TTL, attempt limit, cooldown, and hourly/daily ceilings. It takes NO
-- caller-supplied policy parameters — there is no p_expires_at, p_max_attempts,
-- p_cooldown_seconds, p_max_per_hour, or p_max_per_day — so a caller (even the
-- service-role application) can never weaken the TTL, attempt limit, cooldown, or
-- rate limits. The constants below, and the database clock, are the only authority.
-- The application may keep MATCHING exported constants for UI/docs/tests/messaging,
-- but those are advisory and never reach this function.
--
-- result_code ∈ {issued, rate_limited, lineage_mismatch, membership_not_active,
-- purpose_invalid}. On anything but `issued`, nothing is cancelled and nothing is
-- inserted.
create or replace function public.vendor_auth_issue_challenge(
  p_challenge_id             uuid,
  p_vendor_dashboard_user_id uuid,
  p_user_id                  uuid,
  p_vendor_id                uuid,
  p_purpose                  text,
  p_destination_hash         text,
  p_otp_hash                 text
)
returns table (
  result_code         text,
  rate_limit_scope    text,
  issued_challenge_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

revoke all on function public.vendor_auth_issue_challenge(uuid, uuid, uuid, uuid, text, text, text) from public;
revoke all on function public.vendor_auth_issue_challenge(uuid, uuid, uuid, uuid, text, text, text) from anon;
revoke all on function public.vendor_auth_issue_challenge(uuid, uuid, uuid, uuid, text, text, text) from authenticated;
grant execute on function public.vendor_auth_issue_challenge(uuid, uuid, uuid, uuid, text, text, text) to service_role;


-- ============================================================================
-- Deliberately NOT created (per Phase 5E review scope):
--   • no SMS delivery path, adapter, template, or attestation; no RCS anything —
--     delivery_channel exists as VOCABULARY readiness only, and Phase 5E writes and
--     attests exactly 'whatsapp'
--   • no caller-controllable OTP policy: vendor_auth_issue_challenge owns the TTL,
--     attempt limit, cooldown, and hourly/daily ceilings internally
--   • no backfill of phone_e164 from any legacy column; no country-code literal
--   • no UPDATE of vendors.phone or vendors.whatsapp_number
--   • no is_operationally_enabled = true; no readiness_status = 'active'
--   • no real provider configuration (provider_required stays 'mock')
--   • no change to client_login_otp or any business automation row
--   • no client purpose in verification_challenges (it stays vendor-only)
--   • no plaintext OTP column, no plaintext reset-token column, no pepper column
--   • no anon/authenticated grant or policy on challenges or grants
--   • no DELETE / TRUNCATE / REFERENCES / TRIGGER privilege for ANY role
--   • no custom session table, no custom JWT, no second auth cookie
--   • no n8n hook, no scheduled/queued authentication delivery
--   • no lead, package, credit, or location change of any kind
-- ============================================================================
