-- ============================================================================
-- QuickFurno — Phase 5F-B: WhatsApp Cloud API runtime control
-- Migration 20260709000200_whatsapp_cloud_api_runtime_control.sql
--
-- ADDITIVE + SAFE. Creates the INFRASTRUCTURE ACTIVATION authority for a real
-- provider (runtime policy) and a controlled canary allowlist (destination HASHES
-- only). NOTHING is operationally enabled: the single seeded runtime policy ships
-- fully disabled, no canary row is seeded, and no provider account / template
-- mapping / approval / credential is created.
--
-- AUTHORITY BOUNDARIES (unchanged): a provider being technically configured MUST
-- NOT authorize a communication. Runtime policy = infrastructure enablement only;
-- Phase 4 Policy Engine remains the business authorization authority; Supabase Auth
-- and verification_challenges remain the OTP/challenge authorities. A message must
-- still pass QuickFurno authorization before any provider delivery.
--
-- SECURITY: no secret/token column anywhere; the canary table stores a destination
-- HASH only (never plaintext phone / MSISDN / phone_e164 / OTP). No DELETE/TRUNCATE
-- grant, no browser policy, no activation trigger, no provider-activation function.
--
-- DO NOT APPLY as part of code review. Apply manually via the Supabase SQL editor
-- during the controlled Phase 5F-B rollout. Do NOT `supabase db push` /
-- `migration up` / `repair` / `db reset` (migration history has drifted).
-- ============================================================================

-- ============================================================================
-- SECTION 1 — PROVIDER RUNTIME ACTIVATION POLICY (infrastructure authority only)
-- ============================================================================
-- Controls whether a provider's transport is technically activated, and to what
-- degree (readiness_only / shadow / canary / active), plus which capabilities are
-- switched on (outbound send, webhook processing, health checks). This is NOT
-- business authorization, NOT authentication authority, NOT campaign authorization,
-- NOT consent authority. `activation_status = active` (or `provider_ready` on the
-- account) never, by itself, authorizes a communication.
create table if not exists public.communication_provider_runtime_policies (
  id                          uuid primary key default gen_random_uuid(),
  provider_key                text not null,
  channel                     text not null check (channel in ('whatsapp', 'sms', 'rcs')),
  activation_status           text not null default 'disabled'
                                check (activation_status in (
                                  'disabled', 'readiness_only', 'shadow', 'canary', 'active', 'paused')),
  -- Capability switches — all OFF by default. Outbound delivery is permitted only
  -- when outbound_enabled AND activation_status in ('canary','active').
  outbound_enabled            boolean not null default false,
  webhook_processing_enabled  boolean not null default false,
  health_check_enabled        boolean not null default false,
  -- Sanitized non-secret operational notes only. Never a secret/token.
  metadata                    jsonb not null default '{}'::jsonb,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint uq_comm_provider_runtime_policy unique (provider_key, channel)
);

create index if not exists idx_comm_provider_runtime_policy_lookup
  on public.communication_provider_runtime_policies (provider_key, channel, activation_status);

-- Seed EXACTLY one row — the Meta WhatsApp Cloud provider, FULLY DISABLED. Nothing
-- is operationally enabled. `on conflict do nothing` keeps this idempotent and never
-- re-enables a row an operator may have deliberately changed later.
insert into public.communication_provider_runtime_policies
  (provider_key, channel, activation_status, outbound_enabled, webhook_processing_enabled, health_check_enabled)
values
  ('meta_whatsapp_cloud', 'whatsapp', 'disabled', false, false, false)
on conflict (provider_key, channel) do nothing;


-- ============================================================================
-- SECTION 2 — CANARY DESTINATION ALLOWLIST (destination HASHES only)
-- ============================================================================
-- When a provider runs in `canary` activation, outbound delivery is permitted ONLY
-- to a destination whose HASH appears in an active, unexpired row here. This exists
-- for controlled Meta testing against a tiny operator-approved set of numbers —
-- WITHOUT ever storing a plaintext phone. `destination_hash` mirrors
-- `communication_messages.destination_hash` (the same non-reversible hash), so the
-- gate compares hash-to-hash and never handles a plaintext number.
--
-- `activation_status = active` does NOT require a canary row; `canary` DOES; every
-- other activation state permits no outbound delivery at all.
create table if not exists public.communication_provider_canary_destinations (
  id                uuid primary key default gen_random_uuid(),
  provider_key      text not null,
  channel           text not null check (channel in ('whatsapp', 'sms', 'rcs')),
  -- Non-reversible hash ONLY. There is deliberately no plaintext phone/MSISDN/
  -- phone_e164/OTP column; the CHECK below defends the naming at the schema level.
  destination_hash  text not null,
  is_active         boolean not null default true,
  approved_by_type  text,
  approved_by_id    text,
  -- Sanitized reason only — never a raw provider payload or a plaintext number.
  reason_sanitized  text,
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- At most one ACTIVE allowlist entry per (provider, channel, destination hash).
create unique index if not exists uq_comm_canary_active_destination
  on public.communication_provider_canary_destinations (provider_key, channel, destination_hash)
  where is_active;

create index if not exists idx_comm_canary_lookup
  on public.communication_provider_canary_destinations (provider_key, channel, destination_hash, is_active);

-- NO canary destination row is seeded in Phase 5F-B.


-- ============================================================================
-- SECTION 3 — ADDITIVE WEBHOOK RECEIPT STATUS: 'ignored'
-- ============================================================================
-- A verified but deliberately-not-processed webhook (a known NON-delivery payload:
-- inbound message / template status / account status — all owned by later phases)
-- is acknowledged as `ignored`, distinct from `rejected` (which means unsupported/
-- malformed). This widens the existing processing_status vocabulary ADDITIVELY and
-- FAILS LOUD if any existing row holds an unexpected value.
do $$
declare
  v_bad   integer;
  v_con   text;
begin
  if to_regclass('public.communication_webhook_receipts') is null then
    raise exception 'Phase 5F-B: public.communication_webhook_receipts is missing (apply Phase 5B communication core first)'
      using errcode = 'no_data_found';
  end if;

  -- Fail loud if any existing processing_status is outside the known 5B vocabulary.
  select count(*) into v_bad
  from public.communication_webhook_receipts
  where processing_status is not null
    and processing_status not in ('received', 'verified', 'processed', 'duplicate', 'rejected', 'failed', 'ignored');
  if v_bad > 0 then
    raise exception 'Phase 5F-B: communication_webhook_receipts.processing_status has % unexpected value(s); refusing to widen', v_bad
      using errcode = 'invalid_table_definition',
            hint = 'Investigate the unexpected processing_status value before widening the vocabulary.';
  end if;

  -- Drop the existing CHECK constraint on processing_status, whatever its name.
  for v_con in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.communication_webhook_receipts'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%processing_status%'
  loop
    execute format('alter table public.communication_webhook_receipts drop constraint %I', v_con);
  end loop;

  -- Re-add the widened vocabulary (idempotent name).
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.communication_webhook_receipts'::regclass
      and conname = 'communication_webhook_receipts_processing_status_chk'
  ) then
    alter table public.communication_webhook_receipts
      add constraint communication_webhook_receipts_processing_status_chk
      check (processing_status in ('received', 'verified', 'processed', 'duplicate', 'rejected', 'failed', 'ignored'));
  end if;
end
$$;


-- ============================================================================
-- SECTION 3B — ADDITIVE MESSAGE STATUS: 'outcome_unknown'
-- ============================================================================
-- A provider outcome that can be neither proven nor disproven (timeout / abort /
-- ambiguous network / ambiguous 5xx / 2xx without a usable provider message id) must
-- NOT be collapsed into `failed`: the provider may actually have accepted the
-- request and a later verified `sent`/`delivered`/`read`/`failed` webhook may arrive.
-- This widens `communication_messages.status` ADDITIVELY and FAILS LOUD on any
-- existing unexpected value. The transition rules (dispatching → outcome_unknown;
-- outcome_unknown → sent/delivered/read/failed only; never → retry_scheduled /
-- dispatching / dead_letter) are enforced in CommunicationService.
do $$
declare
  v_bad integer;
  v_con text;
begin
  if to_regclass('public.communication_messages') is null then
    raise exception 'Phase 5F-B: public.communication_messages is missing (apply Phase 5B communication core first)'
      using errcode = 'no_data_found';
  end if;

  select count(*) into v_bad
  from public.communication_messages
  where status is not null
    and status not in ('queued', 'dispatching', 'accepted', 'sent', 'delivered', 'read',
                       'failed', 'retry_scheduled', 'dead_letter', 'cancelled', 'outcome_unknown');
  if v_bad > 0 then
    raise exception 'Phase 5F-B: communication_messages.status has % unexpected value(s); refusing to widen', v_bad
      using errcode = 'invalid_table_definition',
            hint = 'Investigate the unexpected status value before widening the vocabulary.';
  end if;

  -- Drop the existing CHECK on status (whatever its auto-generated name), then re-add
  -- the widened vocabulary under a stable idempotent name.
  for v_con in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.communication_messages'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
      and pg_get_constraintdef(con.oid) ilike '%queued%'
  loop
    execute format('alter table public.communication_messages drop constraint %I', v_con);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.communication_messages'::regclass
      and conname = 'communication_messages_status_chk'
  ) then
    alter table public.communication_messages
      add constraint communication_messages_status_chk
      check (status in ('queued', 'dispatching', 'accepted', 'sent', 'delivered', 'read',
                        'failed', 'retry_scheduled', 'dead_letter', 'cancelled', 'outcome_unknown'));
  end if;
end
$$;


-- ============================================================================
-- SECTION 4 — RLS + PRIVILEGES (least privilege; no browser policies)
-- ============================================================================
-- Both new tables: RLS on, ZERO policies (so anon/authenticated see nothing), and
-- service_role limited to SELECT/INSERT/UPDATE — no DELETE, no TRUNCATE. There is
-- no secret column, no automatic activation trigger, and no provider-activation
-- function anywhere in this migration.
alter table public.communication_provider_runtime_policies  enable row level security;
alter table public.communication_provider_canary_destinations enable row level security;

revoke all on public.communication_provider_runtime_policies  from anon;
revoke all on public.communication_provider_runtime_policies  from authenticated;
revoke all on public.communication_provider_runtime_policies  from service_role;
revoke all on public.communication_provider_canary_destinations from anon;
revoke all on public.communication_provider_canary_destinations from authenticated;
revoke all on public.communication_provider_canary_destinations from service_role;

grant select, insert, update on public.communication_provider_runtime_policies  to service_role;
grant select, insert, update on public.communication_provider_canary_destinations to service_role;

comment on table public.communication_provider_runtime_policies is
  'Phase 5F-B: infrastructure activation authority for a provider transport. NOT business/auth/campaign/consent authorization. Ships disabled; active never by itself authorizes a communication.';
comment on table public.communication_provider_canary_destinations is
  'Phase 5F-B: canary allowlist of destination HASHES for controlled provider testing. No plaintext phone/OTP/secret. Required only in canary activation.';
