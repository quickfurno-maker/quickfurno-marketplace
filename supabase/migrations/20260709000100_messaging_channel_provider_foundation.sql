-- ============================================================================
-- QuickFurno — 20260709000100_messaging_channel_provider_foundation.sql
--
-- PHASE 5F-A — MESSAGING CHANNEL & PROVIDER FOUNDATION (additive-only, safe).
--
-- Evolves the WhatsApp-only communication core into a multi-channel platform
-- FOUNDATION (whatsapp / sms / rcs) WITHOUT activating anything. After this file:
--   • the GENERIC communication tables accept the sms/rcs vocabulary, but every
--     existing WhatsApp row is preserved exactly and CommunicationService still
--     dispatches only WhatsApp;
--   • non-secret provider-readiness, provider-template-mapping, auth-transport-
--     policy, auth-delivery-attempt, preference, suppression, and channel-
--     capability registries exist, all empty of secrets and mostly empty of rows;
--   • NOTHING is enabled: no automation readiness advances, no fallback policy is
--     operational, no provider is configured, no token/secret column exists.
--
-- AUTHORITY BOUNDARIES (unchanged — never merged):
--   • Supabase Auth              = client phone OTP + session authority
--   • verification_challenges    = vendor verification/reset challenge authority
--   • Phase 4 policy engine       = business communication authorization authority
--   • CommunicationService       = canonical message ledger + dispatch boundary
--   • n8n                        = execution fabric, NEVER an OTP/identity authority
-- Channel selection is a TRANSPORT decision; provider selection is an
-- INFRASTRUCTURE decision. Neither is an authentication or business-authorization
-- authority. One user action never spawns competing OTP authorities.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   • It does NOT set is_operationally_enabled = true on any automation or policy.
--   • It does NOT advance any automation/template readiness to a live state.
--   • It does NOT configure a real WhatsApp/SMS/RCS provider or store any token,
--     App Secret, webhook secret, SMS API secret, or Google service-account JSON.
--   • It does NOT store a plaintext phone/MSISDN, an OTP, or a raw provider error.
--   • It does NOT change verification_challenges.delivery_channel — that Phase 5E
--     SECURITY vocabulary stays ('whatsapp','sms'); RCS is NOT an OTP challenge
--     delivery channel.
--   • It does NOT rename/delete/re-map/re-categorize any existing template, and it
--     does NOT touch business-automation readiness.
--
-- MIGRATION-HISTORY DRIFT WARNING
--   The Supabase CLI migration history is drifted. Do NOT run `supabase db push`
--   / `migration up` / `migration repair` / `db reset`. This file is a review
--   artefact, applied MANUALLY via the SQL Editor after GitHub audit.
--
-- Additive, non-destructive, idempotent where practical, fail-loud on drift.
-- NOT applied to production by this change.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — CHANNEL VOCABULARY EXPANSION (whatsapp / sms / rcs)
-- ============================================================================
-- The GENERIC communication tables are widened from `channel = 'whatsapp'` to the
-- vocabulary ('whatsapp','sms','rcs'). This is done fail-loud and per-table:
--   1. validate that EVERY existing row is 'whatsapp' — refuse if any drifted;
--   2. drop the existing channel CHECK constraint(s), whatever they are named;
--   3. add an explicit, named vocabulary constraint (idempotent).
-- Existing WhatsApp rows are preserved exactly. verification_challenges is NOT in
-- this list — its Phase 5E security vocabulary is left untouched below.
do $$
declare
  v_tables text[] := array[
    'communication_messages',
    'communication_templates',
    'communication_automation_catalog'
  ];
  v_tbl  text;
  v_bad  integer;
  v_con  text;
  v_name text;
begin
  foreach v_tbl in array v_tables loop
    if to_regclass(format('public.%I', v_tbl)) is null then
      raise exception 'Phase 5F-A: table public.% is missing (apply Phase 5B communication core first)', v_tbl
        using errcode = 'no_data_found';
    end if;

    -- 1) Validate existing channel values. A single non-whatsapp row is drift.
    execute format('select count(*) from public.%I where channel is distinct from ''whatsapp''', v_tbl)
      into v_bad;
    if v_bad > 0 then
      raise exception 'Phase 5F-A: %.channel has % non-whatsapp row(s); refusing to widen the vocabulary', v_tbl, v_bad
        using errcode = 'invalid_table_definition',
              hint = 'Investigate the unexpected channel value before widening the vocabulary.';
    end if;

    -- 2) Drop every existing CHECK constraint on the channel column, whatever its
    --    auto-generated name. Scoped to check constraints whose definition mentions
    --    `channel` on this table only.
    for v_con in
      select con.conname
      from pg_constraint con
      where con.conrelid = format('public.%I', v_tbl)::regclass
        and con.contype = 'c'
        and pg_get_constraintdef(con.oid) ilike '%channel%'
    loop
      execute format('alter table public.%I drop constraint %I', v_tbl, v_con);
    end loop;

    -- 3) Add the explicit vocabulary constraint (idempotent name).
    v_name := format('%s_channel_vocab_chk', v_tbl);
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', v_tbl)::regclass
        and conname = v_name
    ) then
      execute format(
        'alter table public.%I add constraint %I check (channel in (''whatsapp'', ''sms'', ''rcs''))',
        v_tbl, v_name
      );
    end if;
  end loop;
end
$$;

-- Phase 5E security vocabulary is DELIBERATELY UNCHANGED: verification_challenges
-- .delivery_channel stays ('whatsapp','sms'). RCS must never become a vendor OTP
-- challenge delivery channel. (No statement here touches that constraint.)


-- ============================================================================
-- SECTION 2 — PROVIDER ACCOUNT READINESS REGISTRY (non-secret only)
-- ============================================================================
-- Operational READINESS state for messaging providers. It stores NO credential of
-- any kind: no access token, App Secret, webhook verify token, SMS API secret, or
-- Google service-account JSON — only opaque non-secret REFERENCE identifiers (a
-- phone-number id, a WABA id) and constrained status vocabularies. A row being
-- `provider_ready` never activates dispatch; automations stay independently
-- disabled.
create table if not exists public.communication_provider_accounts (
  id                            uuid primary key default gen_random_uuid(),
  provider_key                  text not null,
  channel                       text not null check (channel in ('whatsapp', 'sms', 'rcs')),
  display_name                  text not null,
  -- Opaque NON-SECRET references only (e.g. a Meta phone-number id / WABA id).
  account_reference             text,
  business_account_reference    text,
  phone_number_reference        text,
  readiness_status              text not null default 'not_configured'
                                  check (readiness_status in (
                                    'not_configured', 'credentials_pending', 'account_ready',
                                    'webhook_pending', 'template_mapping_pending', 'provider_ready', 'disabled')),
  configuration_status          text not null default 'pending'
                                  check (configuration_status in ('pending', 'partial', 'complete', 'error')),
  business_verification_status  text not null default 'unknown'
                                  check (business_verification_status in ('unknown', 'not_started', 'pending', 'verified', 'rejected')),
  phone_number_status           text not null default 'unknown'
                                  check (phone_number_status in ('unknown', 'pending', 'connected', 'flagged', 'disconnected')),
  webhook_status                text not null default 'unknown'
                                  check (webhook_status in ('unknown', 'pending', 'verified', 'failing')),
  billing_status                text not null default 'unknown'
                                  check (billing_status in ('unknown', 'not_configured', 'active', 'suspended')),
  health_status                 text not null default 'unknown'
                                  check (health_status in ('unknown', 'healthy', 'degraded', 'unhealthy')),
  last_health_check_at          timestamptz,
  last_synced_at                timestamptz,
  -- Sanitized non-secret operational notes only. The application must never write a
  -- secret here; there is no token/secret column by design.
  metadata                      jsonb not null default '{}'::jsonb,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  -- One account row per (provider, channel, phone-number reference). The partial
  -- index below additionally guarantees a single row when the reference is null.
  constraint uq_comm_provider_account
    unique (provider_key, channel, phone_number_reference)
);

create unique index if not exists uq_comm_provider_account_no_phone
  on public.communication_provider_accounts (provider_key, channel)
  where phone_number_reference is null;

create index if not exists idx_comm_provider_account_channel_status
  on public.communication_provider_accounts (channel, readiness_status);


-- ============================================================================
-- SECTION 3 — PROVIDER TEMPLATE MAPPING REGISTRY
-- ============================================================================
-- One internal template maps to MANY provider representations (a Meta WhatsApp
-- template, an SMS DLT content template, a future RCS campaign template). The
-- legacy communication_templates.provider_template_name / _id columns are LEFT IN
-- PLACE as backward-compatible Phase 5B fields — a later controlled migration
-- retires them. Nothing here fabricates an approval: rows start `draft`.
create table if not exists public.communication_provider_template_mappings (
  id                          uuid primary key default gen_random_uuid(),
  template_key                text not null references public.communication_templates(template_key),
  channel                     text not null check (channel in ('whatsapp', 'sms', 'rcs')),
  provider_key                text not null,
  language                    text not null default 'en',
  provider_template_name      text,
  provider_template_id        text,
  provider_category           text
                                check (provider_category is null or provider_category in ('authentication', 'utility', 'marketing', 'service')),
  approval_status             text not null default 'draft'
                                check (approval_status in (
                                  'draft', 'ready_for_submission', 'submitted', 'approved',
                                  'rejected', 'paused', 'disabled', 'superseded')),
  quality_status              text
                                check (quality_status is null or quality_status in ('unknown', 'green', 'yellow', 'red', 'paused')),
  version                     text not null default '1.0',
  variables_schema            jsonb not null default '{}'::jsonb,
  submission_reference        text,
  -- Sanitized rejection reason only — never a raw provider error/payload.
  rejection_reason_sanitized  text,
  submitted_at                timestamptz,
  approved_at                 timestamptz,
  rejected_at                 timestamptz,
  last_synced_at              timestamptz,
  is_active                   boolean not null default false,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- One mapping per (template, channel, provider, language, version). Prevents an
-- ambiguous "which provider template do I use?" for a given internal template.
create unique index if not exists uq_comm_provider_template_mapping
  on public.communication_provider_template_mappings
  (template_key, channel, provider_key, language, version);

-- At most ONE active mapping per (template, channel, provider, language): a live
-- send can never face two competing active provider templates.
create unique index if not exists uq_comm_provider_template_active
  on public.communication_provider_template_mappings (template_key, channel, provider_key, language)
  where is_active;

create index if not exists idx_comm_provider_template_lookup
  on public.communication_provider_template_mappings (template_key, channel, provider_key, approval_status);


-- ============================================================================
-- SECTION 4 — AUTHENTICATION TRANSPORT POLICY (declaration, not authority)
-- ============================================================================
-- Declares channel order and ALLOWED fallback behaviour per auth flow. It is a
-- POLICY declaration, not an authentication authority: provider configuration can
-- never, by itself, authorize a fallback. Everything ships disabled.
--
-- CRITICAL: SMS must NEVER automatically substitute for vendor_whatsapp_verify —
-- that flow proves the WhatsApp destination is reachable/possessed, and SMS
-- possession is a DIFFERENT claim. So vendor_whatsapp_verify has NO fallback
-- channel at all.
create table if not exists public.authentication_transport_policies (
  auth_flow                       text primary key
                                    check (auth_flow in ('client_login_otp', 'vendor_whatsapp_verify', 'vendor_password_reset')),
  primary_channel                 text not null check (primary_channel in ('whatsapp', 'sms', 'rcs')),
  primary_provider_key            text not null,
  fallback_channel                text check (fallback_channel is null or fallback_channel in ('whatsapp', 'sms')),
  fallback_provider_key           text,
  automatic_fallback_enabled      boolean not null default false,
  user_requested_fallback_enabled boolean not null default false,
  fallback_policy_status          text not null default 'disabled'
                                    check (fallback_policy_status in ('disabled', 'pending_provider', 'manual_only', 'automatic_ready')),
  -- Automatic fallback may only ever be considered after a DEFINITIVE failure.
  hard_failure_only               boolean not null default true,
  is_operationally_enabled        boolean not null default false,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  -- RCS is never an authentication channel in Phase 5F: neither primary nor
  -- fallback may be 'rcs'.
  constraint chk_auth_transport_no_rcs
    check (primary_channel <> 'rcs' and (fallback_channel is null or fallback_channel <> 'rcs')),
  -- A fallback provider only makes sense with a fallback channel.
  constraint chk_auth_transport_fallback_consistency
    check (fallback_channel is not null or (fallback_provider_key is null and automatic_fallback_enabled = false and user_requested_fallback_enabled = false)),
  -- vendor_whatsapp_verify NEVER has a fallback: possession of the WhatsApp number
  -- cannot be proven by an SMS. This is a schema-level guarantee.
  constraint chk_auth_transport_whatsapp_verify_no_fallback
    check (auth_flow <> 'vendor_whatsapp_verify' or fallback_channel is null)
);

-- Safe seed: primary whatsapp on the current mock adapter; every fallback and
-- enablement OFF. vendor_whatsapp_verify has NO fallback channel.
insert into public.authentication_transport_policies
  (auth_flow, primary_channel, primary_provider_key, fallback_channel, fallback_provider_key,
   automatic_fallback_enabled, user_requested_fallback_enabled, fallback_policy_status,
   hard_failure_only, is_operationally_enabled)
values
  ('client_login_otp',      'whatsapp', 'mock', 'sms',  null, false, false, 'disabled', true, false),
  ('vendor_password_reset', 'whatsapp', 'mock', 'sms',  null, false, false, 'disabled', true, false),
  ('vendor_whatsapp_verify','whatsapp', 'mock', null,   null, false, false, 'disabled', true, false)
on conflict (auth_flow) do nothing;


-- ============================================================================
-- SECTION 5 — AUTHENTICATION DELIVERY ATTEMPT LEDGER
-- ============================================================================
-- Groups transport attempts around ONE authentication action, WITHOUT creating a
-- second OTP authority. It carries NO OTP and NO plaintext destination — only a
-- destination_hash and a link to the existing communication_messages ledger. It
-- records outcome CERTAINTY so a future Phase 5F-C can distinguish a definitive
-- failure (fallback-eligible) from an unknown outcome (NEVER fallback-eligible).
-- 5F-A does not send fallbacks.
create table if not exists public.authentication_delivery_attempts (
  id                        uuid primary key default gen_random_uuid(),
  auth_flow                 text not null
                              check (auth_flow in ('client_login_otp', 'vendor_whatsapp_verify', 'vendor_password_reset')),
  -- What the attempt authenticates against (a QuickFurno challenge, or a Supabase
  -- Auth user for the client login OTP path). Never a browser-supplied identity.
  auth_reference_type       text not null
                              check (auth_reference_type in ('verification_challenge', 'auth_user')),
  auth_reference_id         text not null,
  challenge_id              uuid references public.verification_challenges(id) on delete cascade,
  auth_user_id              uuid,
  -- sha256 of the canonical E.164 destination. NEVER the plaintext number, NEVER
  -- an OTP.
  destination_hash          text not null,
  attempt_number            integer not null check (attempt_number >= 1),
  channel                   text not null check (channel in ('whatsapp', 'sms')),
  provider_key              text not null,
  communication_message_id  uuid references public.communication_messages(id) on delete restrict,
  -- Lineage: which attempt this one fell back FROM (null for the primary attempt).
  fallback_from_attempt_id  uuid references public.authentication_delivery_attempts(id) on delete set null,
  status                    text not null default 'requested'
                              check (status in ('requested', 'dispatching', 'accepted', 'sent', 'delivered', 'read', 'failed', 'cancelled')),
  outcome_certainty         text not null default 'unknown_outcome'
                              check (outcome_certainty in ('accepted', 'definitive_failure', 'unknown_outcome')),
  failure_classification    text,
  requested_at              timestamptz not null default now(),
  accepted_at               timestamptz,
  sent_at                   timestamptz,
  delivered_at              timestamptz,
  failed_at                 timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- Attempt numbers cannot duplicate within one authentication reference.
create unique index if not exists uq_auth_delivery_attempt_number
  on public.authentication_delivery_attempts (auth_reference_type, auth_reference_id, attempt_number);

-- A given ledger message links to at most one authentication attempt (no
-- ambiguous fan-out).
create unique index if not exists uq_auth_delivery_attempt_message
  on public.authentication_delivery_attempts (communication_message_id)
  where communication_message_id is not null;

create index if not exists idx_auth_delivery_attempt_reference
  on public.authentication_delivery_attempts (auth_reference_type, auth_reference_id, attempt_number);
create index if not exists idx_auth_delivery_attempt_challenge
  on public.authentication_delivery_attempts (challenge_id);


-- ============================================================================
-- SECTION 6 — COMMUNICATION PREFERENCES FOUNDATION (row-based)
-- ============================================================================
-- Per-(principal, channel, scope) preference. Marketing opt-out must NEVER become
-- an authentication denial — the scopes are distinct, and the authentication
-- safety policy lives elsewhere. No campaign execution is built here.
create table if not exists public.communication_preferences (
  id                uuid primary key default gen_random_uuid(),
  principal_type    text not null
                      check (principal_type in ('client', 'vendor', 'admin', 'anonymous', 'system')),
  principal_id      uuid,
  channel           text not null check (channel in ('whatsapp', 'sms', 'rcs')),
  scope             text not null check (scope in ('authentication', 'transactional', 'marketing')),
  state             text not null default 'unknown'
                      check (state in ('allowed', 'blocked', 'unknown')),
  source            text not null default 'system'
                      check (source in ('system', 'user', 'admin', 'import', 'provider')),
  consented_at      timestamptz,
  withdrawn_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint uq_comm_preference unique (principal_type, principal_id, channel, scope)
);

create index if not exists idx_comm_preference_lookup
  on public.communication_preferences (principal_type, principal_id, channel, scope);


-- ============================================================================
-- SECTION 7 — SUPPRESSION FOUNDATION (hash only, scope-aware)
-- ============================================================================
-- Scope-aware suppression by destination HASH (never a plaintext phone). A
-- marketing STOP must NEVER automatically block OTP authentication — the policy
-- layer distinguishes 'marketing' / 'transactional' / 'global' scopes.
create table if not exists public.communication_suppressions (
  id                uuid primary key default gen_random_uuid(),
  destination_hash  text not null,
  channel           text not null check (channel in ('whatsapp', 'sms', 'rcs')),
  scope             text not null check (scope in ('marketing', 'transactional', 'global')),
  reason            text not null default 'unspecified'
                      check (reason in ('unspecified', 'user_stop', 'provider_block', 'hard_bounce', 'complaint', 'admin')),
  source            text not null default 'system'
                      check (source in ('system', 'user', 'admin', 'provider', 'import')),
  is_active         boolean not null default true,
  suppressed_at     timestamptz not null default now(),
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One active suppression per (hash, channel, scope). History is lifecycle-updated
-- (is_active), never physically deleted.
create unique index if not exists uq_comm_suppression_active
  on public.communication_suppressions (destination_hash, channel, scope)
  where is_active;

create index if not exists idx_comm_suppression_lookup
  on public.communication_suppressions (destination_hash, channel, scope, is_active);


-- ============================================================================
-- SECTION 8 — RCS CAPABILITY CACHE FOUNDATION (no Google API in 5F-A)
-- ============================================================================
-- Future RCS reachability/capability cache, by destination HASH (never a
-- plaintext MSISDN). Phase 5F-A creates the table only: no Google API call, no
-- service account, no RCS send, no campaign execution.
create table if not exists public.communication_channel_capabilities (
  id                 uuid primary key default gen_random_uuid(),
  destination_hash   text not null,
  channel            text not null check (channel in ('whatsapp', 'sms', 'rcs')),
  provider_key       text not null,
  capability_status  text not null default 'unknown'
                       check (capability_status in ('unknown', 'reachable', 'not_reachable', 'stale', 'error')),
  features           jsonb not null default '{}'::jsonb,
  checked_at         timestamptz,
  expires_at         timestamptz,
  source             text not null default 'system'
                       check (source in ('system', 'provider', 'admin', 'import')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint uq_comm_channel_capability unique (destination_hash, channel, provider_key)
);

create index if not exists idx_comm_channel_capability_lookup
  on public.communication_channel_capabilities (destination_hash, channel, provider_key, capability_status);


-- ============================================================================
-- SECTION 9 — RLS + PRIVILEGES (least privilege; no browser policies)
-- ============================================================================
-- Every new operational table: RLS enabled, ZERO anon/authenticated privileges and
-- ZERO browser policies, and service_role gets exactly SELECT/INSERT/UPDATE (no
-- DELETE — history is lifecycle-updated, never physically deleted by the app; no
-- TRUNCATE/REFERENCES/TRIGGER). The REVOKE precedes the GRANT so a historical broad
-- grant cannot survive.
do $$
declare
  v_tables text[] := array[
    'communication_provider_accounts',
    'communication_provider_template_mappings',
    'authentication_transport_policies',
    'authentication_delivery_attempts',
    'communication_preferences',
    'communication_suppressions',
    'communication_channel_capabilities'
  ];
  v_tbl text;
begin
  foreach v_tbl in array v_tables loop
    execute format('alter table public.%I enable row level security', v_tbl);
    execute format('revoke all on public.%I from anon', v_tbl);
    execute format('revoke all on public.%I from authenticated', v_tbl);
    execute format('revoke all on public.%I from service_role', v_tbl);
    execute format('grant select, insert, update on public.%I to service_role', v_tbl);
  end loop;
end
$$;

-- ============================================================================
-- Deliberately NOT created (per Phase 5F-A review scope):
--   • no token / App Secret / webhook secret / SMS API secret / service-account
--     column on ANY table — provider readiness is non-secret references only
--   • no plaintext phone / MSISDN / OTP column anywhere (hashes + refs only)
--   • no is_operationally_enabled = true; no automation/template readiness advance
--   • no real WhatsApp / SMS / RCS provider configuration; no provider activation
--   • no change to verification_challenges.delivery_channel ('whatsapp','sms')
--   • no RCS in any authentication transport (primary or fallback)
--   • no automatic-fallback send path; no fallback policy operationally enabled
--   • no rename/delete/re-map/re-categorize of any existing template
--   • no anon/authenticated grant or policy on any new table
--   • no DELETE / TRUNCATE / REFERENCES / TRIGGER privilege for any role
--   • no n8n hook, no custom session, no custom JWT, no second OTP authority
--   • no lead / package / credit / location change of any kind
-- ============================================================================
