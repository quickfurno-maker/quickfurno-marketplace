-- ============================================================================
-- QuickFurno — Phase 5F-C1: Authentication transport decision + attempt ledger
-- Migration 20260710000100_auth_transport_resilience_decision_foundation.sql
--
-- ADDITIVE + SAFE. Builds DECISION AUTHORITY and ATTEMPT-LEDGER SAFETY only.
-- It does NOT send SMS, does NOT choose an SMS vendor, does NOT enable a fallback,
-- and does NOT change any existing authentication_transport_policies row.
--
-- WHAT THIS ADDS
--   1. `authentication_transport_failure_rules` — a DEFAULT-DENY allowlist that says
--      which PROVEN primary failures may ever justify an SMS fallback. It ships EMPTY:
--      with no active rule, every fallback is blocked.
--   2. Hardened `authentication_delivery_attempts`: an explicit `outcome_unknown`
--      status, a hard two-attempt ceiling, structural attempt/lineage CHECKs, and a
--      status↔certainty consistency CHECK.
--   3. Two narrowly scoped, service_role-only atomic RPCs:
--      `qf_claim_auth_delivery_attempt` and `qf_finalize_auth_delivery_attempt`.
--
-- AUTHORITY BOUNDARIES (unchanged)
--   Supabase Auth owns the client login OTP + session. `verification_challenges` owns
--   vendor_whatsapp_verify and vendor_password_reset challenge state. Phase 4 Policy
--   Engine owns business communication authorization. CommunicationService owns the
--   message ledger and the dispatch boundary. n8n is never an OTP, password-reset,
--   session, identity, or fallback authority. Channel selection is transport policy;
--   provider selection is infrastructure policy. Neither authorizes anything.
--
--   A FALLBACK NEVER GENERATES A SECOND OTP. The existing authority's OTP is reused
--   from request memory. Nothing here accepts, stores, hashes, or logs an OTP.
--
-- SECURITY
--   No OTP column, no OTP parameter, no plaintext phone / MSISDN / phone_e164 column,
--   no provider credential, no token. Destinations are referenced ONLY by the
--   non-reversible `destination_hash` already used by communication_messages.
--
-- DO NOT APPLY as part of code review. Apply manually via the Supabase SQL editor
-- during the controlled Phase 5F-C rollout. Do NOT `supabase db push` /
-- `migration up` / `repair` / `db reset` (migration history has drifted).
-- ============================================================================


-- ============================================================================
-- SECTION 0 — FAIL LOUD ON SCHEMA DRIFT
-- ============================================================================
-- Phase 5F-A created the transport policy + attempt ledger. Refuse to build on sand.
do $$
begin
  if to_regclass('public.authentication_transport_policies') is null then
    raise exception 'Phase 5F-C1: public.authentication_transport_policies is missing (apply Phase 5F-A first)'
      using errcode = 'no_data_found';
  end if;
  if to_regclass('public.authentication_delivery_attempts') is null then
    raise exception 'Phase 5F-C1: public.authentication_delivery_attempts is missing (apply Phase 5F-A first)'
      using errcode = 'no_data_found';
  end if;
  if to_regclass('public.communication_messages') is null then
    raise exception 'Phase 5F-C1: public.communication_messages is missing (apply Phase 5B first)'
      using errcode = 'no_data_found';
  end if;
end
$$;


-- ============================================================================
-- SECTION 1 — DEFAULT-DENY FAILURE RULES (ships EMPTY)
-- ============================================================================
-- A `definitive_failure` is NOT automatically SMS-fallback eligible. Most definitive
-- failures are LOCAL configuration problems — a missing template mapping, a disabled
-- runtime gate, an unready provider account, missing config, a template render
-- failure, a provider identity mismatch. Falling back to SMS would hide the
-- misconfiguration behind a second channel and a second bill, indefinitely.
--
-- So eligibility must be DECLARED, per failure code, by an explicit ACTIVE row an
-- operator wrote on purpose. With no active rule the fallback is blocked. This table
-- is created EMPTY and NOTHING is seeded: Phase 5F-C1 blocks every fallback by
-- construction.
create table if not exists public.authentication_transport_failure_rules (
  id                              uuid primary key default gen_random_uuid(),
  -- NULL = a provider-wide rule. An exact auth_flow rule always takes precedence.
  auth_flow                       text
                                    check (auth_flow is null or auth_flow in (
                                      'client_login_otp', 'vendor_whatsapp_verify', 'vendor_password_reset')),
  -- Phase 5F-C models exactly one primary channel.
  primary_channel                 text not null check (primary_channel = 'whatsapp'),
  primary_provider_key            text not null,
  -- A sanitized, identifier-shaped provider/service failure code. Never a raw payload.
  failure_code                    text not null check (failure_code ~ '^[A-Za-z0-9_]{1,120}$'),
  failure_classification          text not null check (failure_classification ~ '^[A-Za-z0-9_]{1,120}$'),
  automatic_fallback_eligible     boolean not null default false,
  user_requested_fallback_eligible boolean not null default false,
  is_active                       boolean not null default false,
  -- Sanitized operator note only. Never a secret, a phone number, or an OTP.
  reason_sanitized                text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  -- vendor_whatsapp_verify proves possession of the WhatsApp destination. SMS
  -- possession is a different claim, so no rule may ever make it fallback-eligible.
  constraint chk_auth_failure_rule_whatsapp_verify_never_eligible
    check (auth_flow is distinct from 'vendor_whatsapp_verify'
           or (automatic_fallback_eligible = false and user_requested_fallback_eligible = false))
);

-- Ambiguity is a security bug: eligibility must never depend on row order. At most one
-- ACTIVE rule per exact (auth_flow, provider, failure_code), and at most one ACTIVE
-- provider-wide rule per (provider, failure_code).
create unique index if not exists uq_auth_failure_rule_active_flow
  on public.authentication_transport_failure_rules (auth_flow, primary_channel, primary_provider_key, failure_code)
  where is_active and auth_flow is not null;

create unique index if not exists uq_auth_failure_rule_active_provider_wide
  on public.authentication_transport_failure_rules (primary_channel, primary_provider_key, failure_code)
  where is_active and auth_flow is null;

create index if not exists idx_auth_failure_rule_lookup
  on public.authentication_transport_failure_rules (primary_channel, primary_provider_key, failure_code, is_active);

-- NO failure rule is seeded in Phase 5F-C1. Default behaviour: fallback BLOCKED.


-- ============================================================================
-- SECTION 2 — ATTEMPT LEDGER: outcome_unknown status (additive, fail loud)
-- ============================================================================
-- An unknown provider outcome must NOT be recorded as an ordinary `failed`: a failed
-- attempt is fallback-eligible in principle, an unknown one never is.
do $$
declare
  v_bad integer;
  v_con text;
begin
  select count(*) into v_bad
  from public.authentication_delivery_attempts
  where status is not null
    and status not in ('requested', 'dispatching', 'accepted', 'sent', 'delivered', 'read',
                       'failed', 'cancelled', 'outcome_unknown');
  if v_bad > 0 then
    raise exception 'Phase 5F-C1: authentication_delivery_attempts.status has % unexpected value(s); refusing to widen', v_bad
      using errcode = 'invalid_table_definition',
            hint = 'Investigate the unexpected status value before widening the vocabulary.';
  end if;

  for v_con in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.authentication_delivery_attempts'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
      and pg_get_constraintdef(con.oid) ilike '%requested%'
  loop
    execute format('alter table public.authentication_delivery_attempts drop constraint %I', v_con);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.authentication_delivery_attempts'::regclass
      and conname = 'auth_delivery_attempt_status_chk'
  ) then
    alter table public.authentication_delivery_attempts
      add constraint auth_delivery_attempt_status_chk
      check (status in ('requested', 'dispatching', 'accepted', 'sent', 'delivered', 'read',
                        'failed', 'cancelled', 'outcome_unknown'));
  end if;
end
$$;


-- ============================================================================
-- SECTION 2B — ATTEMPT LEDGER: auth ACTION identity + non-secret columns
-- ============================================================================
-- THE GROUPING CORRECTION. Attempts belong to ONE AUTHENTICATION ACTION, never to a
-- long-lived identity. Two concepts, deliberately separate:
--
--   AUTH REFERENCE  (auth_reference_type + auth_reference_id)
--       WHO/WHAT is being authenticated. For a client login this is the Supabase Auth
--       user id, which legitimately performs many OTP logins over its lifetime.
--
--   AUTH ACTION     (auth_action_id)
--       THIS specific OTP issuance/delivery operation. A new login attempt is a NEW
--       action and legally begins a fresh (attempt 1 [, attempt 2]) sequence.
--
-- Grouping by the reference alone would let the first login a user ever performs
-- permanently consume that user's attempt-1 slot.
--
-- auth_action_id is a DETERMINISTIC, DOMAIN-SEPARATED SHA-256 DIGEST — exactly 64
-- lowercase hex characters. It is NOT the raw authoritative identifier, and the raw
-- identifier is never persisted anywhere.
--
--   auth_action_id = sha256( 'qf-auth-action:v1' || NUL || auth_flow || NUL
--                            || source_kind || NUL || authoritative_action_id )
--
-- See lib/communication/authenticationActionIdentity.ts. A shape check on the RAW value
-- could never prove the negative — `^[A-Za-z0-9_.:-]{1,128}$` accepts `483920` and
-- `919876543210`, so it did not structurally prevent an OTP or a phone number from
-- being stored as the action identity. A 64-char lowercase hex digest, by construction,
-- is none of those things.
--
-- The digest is NON-SECRET. It is not an OTP hash, not a phone hash, not a destination
-- identity, not an authentication proof, and not a password-reset token: possessing it
-- authorizes nothing.
--
-- The authoritative input (never stored) is, per flow:
--   client_login_otp       → the SIGNATURE-VERIFIED Supabase Standard Webhooks
--                            `webhook-id` (already the correlation + idempotency key on
--                            the communication path). Never a browser-supplied value.
--   vendor_whatsapp_verify → the server-created `verification_challenges.id`.
--   vendor_password_reset  → the server-created `verification_challenges.id`.
--
-- All other added columns are sanitized and identifier-shaped. No raw provider payload,
-- no OTP, no phone.
alter table public.authentication_delivery_attempts
  add column if not exists auth_action_id  text,
  add column if not exists failure_code    text,
  add column if not exists decision_reason text,
  add column if not exists completed_at    timestamptz;

-- Existing rows must NOT be given a fabricated action id. `auth_reference_id` is the
-- WRONG value for a client login (it is the auth user, not the action), so guessing it
-- would silently recreate the very collision this section fixes. `destination_hash` and
-- `communication_message_id` are equally wrong, and an OTP is unthinkable. Fail loud.
do $$
declare
  v_orphans integer;
begin
  select count(*) into v_orphans
  from public.authentication_delivery_attempts
  where auth_action_id is null;

  if v_orphans > 0 then
    raise exception 'Phase 5F-C1: % authentication_delivery_attempts row(s) have no auth_action_id; refusing to fabricate one', v_orphans
      using errcode = 'invalid_table_definition',
            hint = 'Backfill auth_action_id by DERIVING it with lib/communication/authenticationActionIdentity.ts from the authoritative server-side action (verified webhook id / challenge id). NEVER derive it from auth_reference_id, destination_hash, communication_message_id, or a one-time code.';
  end if;

  alter table public.authentication_delivery_attempts
    alter column auth_action_id set not null;

  -- Exactly a lowercase SHA-256 hex digest. A raw one-time code (`483920`), a bare
  -- MSISDN (`919876543210`), or any other raw authoritative identifier cannot satisfy
  -- this, so the raw value can never reach the ledger even by mistake.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.authentication_delivery_attempts'::regclass
                   and conname = 'chk_auth_attempt_action_id_shape') then
    alter table public.authentication_delivery_attempts
      add constraint chk_auth_attempt_action_id_shape
      check (auth_action_id ~ '^[0-9a-f]{64}$');
  end if;
end
$$;

comment on column public.authentication_delivery_attempts.auth_action_id is
  'Phase 5F-C1: deterministic domain-separated SHA-256 (64 lowercase hex) identity of ONE authentication delivery action, derived from the authoritative server-side action id. Non-secret. Not an OTP hash, not a phone hash, not a destination identity, not an authentication proof. The raw source identifier is never stored.';
comment on column public.authentication_delivery_attempts.failure_code is
  'Phase 5F-C1: sanitized, identifier-shaped provider/service failure code. Never a raw payload, phone, or OTP.';
comment on column public.authentication_delivery_attempts.decision_reason is
  'Phase 5F-C1: the fallback decision reason code that authorized this attempt. Non-secret.';
comment on column public.authentication_delivery_attempts.completed_at is
  'Phase 5F-C1: when the attempt reached a terminal or parked outcome. Non-secret.';


-- ============================================================================
-- SECTION 2C — ATTEMPT LEDGER: structural safety CHECKs
-- ============================================================================
do $$
declare
  v_con text;
begin
  -- Replace the permissive `attempt_number >= 1` with the Phase 5F-C ceiling of two.
  for v_con in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.authentication_delivery_attempts'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%attempt_number%'
      and pg_get_constraintdef(con.oid) ilike '%>=%'
  loop
    execute format('alter table public.authentication_delivery_attempts drop constraint %I', v_con);
  end loop;

  -- (C) Maximum two transport attempts per authentication action, ever.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.authentication_delivery_attempts'::regclass
                   and conname = 'chk_auth_attempt_number_max_two') then
    alter table public.authentication_delivery_attempts
      add constraint chk_auth_attempt_number_max_two
      check (attempt_number in (1, 2));
  end if;

  -- (D) Attempt semantics + lineage shape. Attempt 1 is the WhatsApp primary and has
  -- no ancestor; attempt 2 is the SMS fallback and MUST point at its primary.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.authentication_delivery_attempts'::regclass
                   and conname = 'chk_auth_attempt_shape') then
    alter table public.authentication_delivery_attempts
      add constraint chk_auth_attempt_shape
      check (
        (attempt_number = 1 and channel = 'whatsapp' and fallback_from_attempt_id is null)
        or
        (attempt_number = 2 and channel = 'sms' and fallback_from_attempt_id is not null)
      );
  end if;

  -- (E) vendor_whatsapp_verify is WhatsApp-only: attempt 2 is structurally impossible.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.authentication_delivery_attempts'::regclass
                   and conname = 'chk_auth_attempt_whatsapp_verify_no_fallback') then
    alter table public.authentication_delivery_attempts
      add constraint chk_auth_attempt_whatsapp_verify_no_fallback
      check (auth_flow <> 'vendor_whatsapp_verify' or attempt_number = 1);
  end if;

  -- Status and certainty may never contradict each other. `accepted` is not a failure;
  -- `outcome_unknown` is neither an acceptance nor a proven failure.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.authentication_delivery_attempts'::regclass
                   and conname = 'chk_auth_attempt_status_certainty') then
    alter table public.authentication_delivery_attempts
      add constraint chk_auth_attempt_status_certainty
      check (
        (outcome_certainty = 'accepted'           and status in ('accepted', 'sent', 'delivered', 'read'))
        or (outcome_certainty = 'definitive_failure' and status in ('failed', 'cancelled'))
        or (outcome_certainty = 'unknown_outcome'    and status in ('requested', 'dispatching', 'outcome_unknown'))
      );
  end if;

  -- Sanitized, identifier-shaped codes only — a raw provider payload cannot fit.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.authentication_delivery_attempts'::regclass
                   and conname = 'chk_auth_attempt_sanitized_codes') then
    alter table public.authentication_delivery_attempts
      add constraint chk_auth_attempt_sanitized_codes
      check (
        (failure_code is null or failure_code ~ '^[A-Za-z0-9_]{1,120}$')
        and (decision_reason is null or decision_reason ~ '^[A-Za-z0-9_]{1,120}$')
        and (failure_classification is null or failure_classification ~ '^[A-Za-z0-9_]{1,120}$')
      );
  end if;
end
$$;

-- One fallback per primary attempt: a second row can never point at the same ancestor.
create unique index if not exists uq_auth_delivery_attempt_fallback_lineage
  on public.authentication_delivery_attempts (fallback_from_attempt_id)
  where fallback_from_attempt_id is not null;

-- At most one fallback attempt per authentication ACTION (not per user).
create unique index if not exists uq_auth_delivery_attempt_single_fallback
  on public.authentication_delivery_attempts (auth_flow, auth_action_id)
  where attempt_number = 2;


-- ============================================================================
-- SECTION 2D — REPLACE THE ATTEMPT UNIQUENESS AUTHORITY (reference → action)
-- ============================================================================
-- Phase 5F-A made `(auth_reference_type, auth_reference_id, attempt_number)` unique.
-- For `client_login_otp` the reference is the Supabase Auth USER, so that index would
-- permanently block every login action after the user's first one. The uniqueness
-- authority moves to the AUTH ACTION. `auth_reference_type` / `auth_reference_id` are
-- PRESERVED — they remain the lineage identity a fallback must match.
--
-- This is a controlled replacement of a security-relevant constraint, so it FAILS LOUD
-- if the index it is about to drop is missing or has drifted from the exact Phase 5F-A
-- definition. No historical row is ever deleted.
do $$
declare
  v_def text;
  v_expected constant text :=
    'CREATE UNIQUE INDEX uq_auth_delivery_attempt_number ON public.authentication_delivery_attempts USING btree (auth_reference_type, auth_reference_id, attempt_number)';
begin
  select pg_get_indexdef(i.indexrelid) into v_def
  from pg_index i
  join pg_class c     on c.oid = i.indexrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'uq_auth_delivery_attempt_number';

  if v_def is null then
    raise exception 'Phase 5F-C1: the Phase 5F-A index uq_auth_delivery_attempt_number is missing; refusing to replace an unknown uniqueness authority'
      using errcode = 'no_data_found',
            hint = 'Apply Phase 5F-A first, or investigate who removed the attempt uniqueness index.';
  end if;

  if v_def <> v_expected then
    raise exception 'Phase 5F-C1: uq_auth_delivery_attempt_number has drifted from its Phase 5F-A definition (%); refusing to replace it', v_def
      using errcode = 'invalid_table_definition',
            hint = 'Investigate the index drift before replacing the attempt uniqueness authority.';
  end if;
end
$$;

-- The old reference-scoped authority is retired (index only — no data is removed).
drop index if exists public.uq_auth_delivery_attempt_number;

-- The new authority: attempt numbers are unique within ONE authentication action.
create unique index if not exists uq_auth_delivery_attempt_action_number
  on public.authentication_delivery_attempts (auth_flow, auth_action_id, attempt_number);

create index if not exists idx_auth_delivery_attempt_action
  on public.authentication_delivery_attempts (auth_flow, auth_action_id, attempt_number);


-- ============================================================================
-- SECTION 3 — ATOMIC ATTEMPT CLAIM (race-safety boundary, NOT policy authority)
-- ============================================================================
-- The application decision engine MUST run first. This function independently
-- RE-CHECKS the structural safety properties and serializes concurrent claimers on
-- the authentication reference with a transaction-scoped advisory lock, so a
-- SELECT-then-INSERT race in application code cannot produce two primaries or two
-- fallbacks.
--
-- It accepts NO OTP, NO plaintext phone, and NO provider credential. It never decides
-- authentication success and never enables a policy.
-- `p_auth_action_id` is the ALREADY-DERIVED 64-character lowercase SHA-256 action
-- identity (see lib/communication/authenticationActionIdentity.ts). The RPC never sees,
-- and never stores, the raw authoritative identifier — nor an OTP, nor a phone number.
create or replace function public.qf_claim_auth_delivery_attempt(
  p_auth_flow           text,
  p_auth_action_id      text,
  p_auth_reference_type text,
  p_auth_reference_id   text,
  p_destination_hash    text,
  p_attempt_number      integer,
  p_channel             text,
  p_provider_key        text,
  p_challenge_id        uuid default null,
  p_auth_user_id        uuid default null,
  p_decision_reason     text default null
)
returns table (
  outcome                  text,
  detail                   text,
  attempt_id               uuid,
  attempt_number           integer,
  channel                  text,
  fallback_from_attempt_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  -- Transaction-scoped advisory lock, keyed on the ACTION (auth_flow + auth_action_id),
  -- never on the long-lived reference. Two concurrent claimers for one action cannot
  -- both observe an empty ledger; the loser sees the winner's row. Two DISTINCT login
  -- actions by the same auth user take different locks and never collide. Including
  -- auth_flow keeps unrelated flows out of one another's lock namespace.
  perform pg_advisory_xact_lock(hashtextextended(p_auth_flow || ':' || p_auth_action_id, 0));

  select count(*) into v_count
    from public.authentication_delivery_attempts a
   where a.auth_flow      = p_auth_flow
     and a.auth_action_id = p_auth_action_id;

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

  -- Exactly one fallback per ACTION, ever.
  if exists (
    select 1 from public.authentication_delivery_attempts a
     where a.auth_flow      = p_auth_flow
       and a.auth_action_id = p_auth_action_id
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
$$;

revoke all on function public.qf_claim_auth_delivery_attempt(text, text, text, text, text, integer, text, text, uuid, uuid, text) from public;
revoke all on function public.qf_claim_auth_delivery_attempt(text, text, text, text, text, integer, text, text, uuid, uuid, text) from anon;
revoke all on function public.qf_claim_auth_delivery_attempt(text, text, text, text, text, integer, text, text, uuid, uuid, text) from authenticated;
grant execute on function public.qf_claim_auth_delivery_attempt(text, text, text, text, text, integer, text, text, uuid, uuid, text) to service_role;


-- ============================================================================
-- SECTION 4 — ATOMIC ATTEMPT FINALIZATION
-- ============================================================================
-- Records the transport outcome of one attempt. Non-secret inputs only. It refuses
-- contradictory (status, certainty) pairs, refuses to regress a terminal accepted
-- attempt, refuses to regress a proven failure into an acceptance, and — crucially —
-- refuses to rewrite `outcome_unknown` into anything at all. Rewriting an unknown
-- outcome into a definitive failure is exactly how an attacker (or a bug) would
-- manufacture fallback eligibility for an OTP that may already have been delivered.
-- Verified provider-event reconciliation is deliberately NOT invented here.
create or replace function public.qf_finalize_auth_delivery_attempt(
  p_attempt_id               uuid,
  p_status                   text,
  p_outcome_certainty        text,
  p_failure_code             text default null,
  p_failure_classification   text default null,
  p_communication_message_id uuid default null
)
returns table (
  outcome           text,
  detail            text,
  attempt_id        uuid,
  status            text,
  outcome_certainty text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

revoke all on function public.qf_finalize_auth_delivery_attempt(uuid, text, text, text, text, uuid) from public;
revoke all on function public.qf_finalize_auth_delivery_attempt(uuid, text, text, text, text, uuid) from anon;
revoke all on function public.qf_finalize_auth_delivery_attempt(uuid, text, text, text, text, uuid) from authenticated;
grant execute on function public.qf_finalize_auth_delivery_attempt(uuid, text, text, text, text, uuid) to service_role;


-- ============================================================================
-- SECTION 5 — RLS + PRIVILEGES (least privilege; no browser policies)
-- ============================================================================
-- The new table: RLS on, ZERO policies (so anon/authenticated see nothing), and
-- service_role limited to SELECT/INSERT/UPDATE — no DELETE, no TRUNCATE. There is no
-- secret column and no activation trigger anywhere in this migration.
alter table public.authentication_transport_failure_rules enable row level security;

revoke all on public.authentication_transport_failure_rules from anon;
revoke all on public.authentication_transport_failure_rules from authenticated;
revoke all on public.authentication_transport_failure_rules from service_role;

grant select, insert, update on public.authentication_transport_failure_rules to service_role;

-- Defence in depth for the attempt ledger (its service_role grants come from 5F-A and
-- are deliberately left untouched here).
revoke all on public.authentication_delivery_attempts from anon;
revoke all on public.authentication_delivery_attempts from authenticated;

comment on table public.authentication_transport_failure_rules is
  'Phase 5F-C1: DEFAULT-DENY allowlist of primary failure codes that may justify an SMS fallback. Ships EMPTY; with no active rule every fallback is blocked. Never an authentication authority.';


-- ============================================================================
-- SECTION 6 — NO ACTIVATION
-- ============================================================================
-- This migration deliberately performs NO write to authentication_transport_policies:
-- no insert, no update, no delete. Every existing policy row keeps automatic fallback
-- off, user-requested fallback off, fallback_policy_status 'disabled', and
-- is_operationally_enabled false. It also creates no SMS provider account, no template
-- mapping, no canary destination, and changes no Meta activation state.
-- QF_NO_ACTIVATION_MARKER
