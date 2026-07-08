-- ============================================================================
-- QuickFurno — 20260708000160_identity_security_foundation.sql
--
-- PHASE 5A — IDENTITY & SECURITY FOUNDATION (additive-only, foundation-only).
--
-- Establishes persistence readiness for the later Phase 5 identity/auth-security
-- work WITHOUT activating any OTP transport, login workflow, WhatsApp provider,
-- Maps, geocoding, or n8n auth path. Nothing here reads, updates, or deletes
-- existing data, drops tables/columns, or changes Phase 1–4 behaviour.
--
-- Creates four additive tables:
--   • public.client_accounts        — client business identity (owner + admin RLS)
--   • public.verification_challenges — server-only vendor verification challenges
--   • public.password_reset_grants   — server-only single-use reset grants
--   • public.auth_security_events    — server-only, append-oriented security log
--
-- RLS model (matches the established repo conventions):
--   • Fully sensitive server-only tables (verification_challenges,
--     password_reset_grants, auth_security_events): enable RLS (deny-all for the
--     PostgREST API roles), revoke anon + authenticated grants, and grant only
--     the least-privilege service_role access the future server layer needs.
--     No anon/authenticated policies are created — the browser can never read
--     OTP hashes, reset-token hashes, or the security event log.
--   • client_accounts: enable RLS with an owner-scoped SELECT (auth.uid() =
--     user_id) plus admin management via public.is_admin(), consistent with the
--     Supabase SSR/session architecture. Writes go through the server/service
--     layer. No anon access.
--
-- SECURITY INVARIANTS ENCODED HERE:
--   • No plaintext OTP, password, or reset-token column exists anywhere — only
--     *_hash columns (otp_hash, destination_hash, grant_token_hash).
--   • Verification purposes are constrained and NOT interchangeable
--     (vendor_whatsapp_verify vs vendor_password_reset).
--   • Client Supabase OTP login is NOT modelled here — it stays Supabase Auth
--     session-controlled; verification_challenges is for QuickFurno-managed
--     vendor challenges only (see the Phase 5A architecture doc).
--
-- Idempotent + safe to re-run. NOT applied to production by this change.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) CLIENT ACCOUNTS — client business identity mapping (owner + admin RLS)
-- ----------------------------------------------------------------------------
create table if not exists public.client_accounts (
  id                    uuid primary key default gen_random_uuid(),
  -- Supabase Auth identity this client account belongs to.
  user_id               uuid not null references auth.users(id) on delete cascade,
  -- Normalized E.164 phone (business identity). Nullable until captured.
  phone_e164            text,
  display_name          text,
  -- Set only once the client's WhatsApp is verified (future Phase 5 flow).
  whatsapp_verified_at  timestamptz,
  status                text not null default 'active'
                          check (status in ('active', 'suspended', 'disabled')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- One client account per Supabase auth user (no duplicate identity rows).
create unique index if not exists uq_client_accounts_user
  on public.client_accounts(user_id);

-- Normalized phone identity is unique where present. Partial index so multiple
-- rows may have NULL phone (not yet captured) without violating uniqueness. This
-- does NOT relink historical leads by phone — no lead claiming happens here.
create unique index if not exists uq_client_accounts_phone_e164
  on public.client_accounts(phone_e164)
  where phone_e164 is not null;

-- ----------------------------------------------------------------------------
-- 2) VERIFICATION CHALLENGES — server-only vendor verification persistence
-- ----------------------------------------------------------------------------
-- principal_id is a POLYMORPHIC business-identity reference resolved by
-- principal_type (no cross-table FK). otp_hash / destination_hash store ONLY
-- secure hashes — never plaintext OTPs or destinations.
create table if not exists public.verification_challenges (
  id                uuid primary key default gen_random_uuid(),
  principal_type    text not null
                      check (principal_type in ('anonymous', 'client', 'vendor', 'admin', 'integration', 'system')),
  principal_id      uuid,
  -- Purpose-bound: a challenge issued for one purpose can never satisfy another.
  purpose           text not null
                      check (purpose in ('vendor_whatsapp_verify', 'vendor_password_reset')),
  -- Secure hash of the delivery destination (e.g. phone). Never plaintext.
  destination_hash  text not null,
  -- Secure hash of the one-time code. Never the plaintext OTP.
  otp_hash          text not null,
  status            text not null default 'pending'
                      check (status in ('pending', 'verified', 'consumed', 'expired', 'locked', 'cancelled')),
  expires_at        timestamptz not null,
  attempt_count     integer not null default 0,
  max_attempts      integer not null default 5,
  resend_count      integer not null default 0,
  created_at        timestamptz not null default now(),
  verified_at       timestamptz,
  consumed_at       timestamptz
);

create index if not exists idx_verification_challenges_lookup
  on public.verification_challenges(principal_type, principal_id, purpose, status);
-- Sweep support for future expiry handling (only pending challenges can expire).
create index if not exists idx_verification_challenges_pending_expiry
  on public.verification_challenges(expires_at)
  where status = 'pending';

-- ----------------------------------------------------------------------------
-- 3) PASSWORD RESET GRANTS — server-only single-use reset authorization
-- ----------------------------------------------------------------------------
-- Stores ONLY a secure hash of the reset grant token. Grants are single-use
-- (consumed_at) and expire (expires_at). Phase 5A performs no password updates.
create table if not exists public.password_reset_grants (
  id                uuid primary key default gen_random_uuid(),
  vendor_id         uuid references public.vendors(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  grant_token_hash  text not null,
  expires_at        timestamptz not null,
  consumed_at       timestamptz,
  created_at        timestamptz not null default now()
);

-- A grant-token hash is globally unique (no two grants share a token).
create unique index if not exists uq_password_reset_grants_token
  on public.password_reset_grants(grant_token_hash);
create index if not exists idx_password_reset_grants_user
  on public.password_reset_grants(user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 4) AUTH SECURITY EVENTS — server-only, append-oriented security audit log
-- ----------------------------------------------------------------------------
-- Kept SEPARATE from Phase 4 business policy decision logs. actor_user_id is a
-- plain uuid (no FK cascade) so the audit trail survives user deletion.
-- metadata must be sanitized by the server layer BEFORE insert — no plaintext
-- OTP, password, token, or provider secret may ever be stored here.
create table if not exists public.auth_security_events (
  id                uuid primary key default gen_random_uuid(),
  event_type        text not null,
  principal_type    text
                      check (principal_type in ('anonymous', 'client', 'vendor', 'admin', 'integration', 'system')),
  principal_id      uuid,
  actor_user_id     uuid,
  purpose           text,
  correlation_id    text,
  destination_hash  text,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists idx_auth_security_events_type_created
  on public.auth_security_events(event_type, created_at desc);
create index if not exists idx_auth_security_events_principal
  on public.auth_security_events(principal_type, principal_id, created_at desc);

-- ============================================================================
-- RLS + GRANTS
-- ============================================================================

-- --- Fully sensitive, server-only tables ------------------------------------
-- Enable RLS (deny-all for anon/authenticated with no policies), revoke the
-- broad API-role grants, and grant least-privilege service_role access.

alter table public.verification_challenges enable row level security;
revoke all on public.verification_challenges from anon;
revoke all on public.verification_challenges from authenticated;
grant select, insert, update, delete on public.verification_challenges to service_role;

alter table public.password_reset_grants enable row level security;
revoke all on public.password_reset_grants from anon;
revoke all on public.password_reset_grants from authenticated;
grant select, insert, update, delete on public.password_reset_grants to service_role;

-- Append-oriented: service_role may write + read, but NOT update/delete history.
alter table public.auth_security_events enable row level security;
revoke all on public.auth_security_events from anon;
revoke all on public.auth_security_events from authenticated;
grant select, insert on public.auth_security_events to service_role;

-- --- client_accounts: owner-read + admin-manage -----------------------------
alter table public.client_accounts enable row level security;
-- Clients authenticate via Supabase sessions (authenticated role), never anon.
revoke all on public.client_accounts from anon;
-- authenticated may SELECT only, governed by the owner/admin policy below.
-- Inserts/updates flow through the server/service layer (service_role).
grant select on public.client_accounts to authenticated;
grant select, insert, update, delete on public.client_accounts to service_role;

drop policy if exists "client_accounts owner read" on public.client_accounts;
create policy "client_accounts owner read" on public.client_accounts
  for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "client_accounts admin manage" on public.client_accounts;
create policy "client_accounts admin manage" on public.client_accounts
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Deliberately NOT created (per security review):
--   • no anon policy/grant on any Phase 5A table
--   • no authenticated read policy on verification_challenges / password_reset_grants
--     / auth_security_events (no legitimate browser-side requirement exists)
--   • no update/delete grant to service_role on auth_security_events (append-only)
--   • no verification_challenges rows for client Supabase OTP login (client OTP
--     login remains Supabase Auth session-controlled — see Phase 5A doc)
