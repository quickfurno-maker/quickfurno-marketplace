-- ============================================================================
-- QuickFurno - 20260706000150_automation_policy_config_foundation.sql
-- Phase 4B-1: durable automation policy config storage and active pointer.
--
-- ADDITIVE ONLY. GENERATED FOR REVIEW - DO NOT AUTO-APPLY TO PRODUCTION.
-- Creates immutable policy config versions and a mutable active pointer for the
-- central automation policy engine. Does not publish events, assign vendors,
-- deduct credits, call matching, WhatsApp, n8n, provider outbox, workers, PM2,
-- UI, or any production Supabase operation.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Immutable policy config versions
-- ----------------------------------------------------------------------------
create table if not exists public.automation_policy_configs (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null,
  policy_version text not null,
  config_json jsonb not null,
  config_fingerprint text not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint automation_policy_configs_policy_key_non_empty
    check (length(trim(policy_key)) > 0),
  constraint automation_policy_configs_policy_version_non_empty
    check (length(trim(policy_version)) > 0),
  constraint automation_policy_configs_config_json_object
    check (jsonb_typeof(config_json) = 'object'),
  constraint automation_policy_configs_fingerprint_sha256_lower_hex
    check (config_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint automation_policy_configs_policy_fingerprint_unique
    unique (policy_key, config_fingerprint),
  constraint automation_policy_configs_policy_id_unique
    unique (policy_key, id)
);

comment on table public.automation_policy_configs is
  'Immutable automation policy config versions. Rows are append-only; updates and deletes are blocked by trigger.';
comment on column public.automation_policy_configs.config_json is
  'Strict policy config JSON object. Store only policy thresholds/gates; no client PII or secrets.';
comment on column public.automation_policy_configs.config_fingerprint is
  'Lowercase SHA-256 fingerprint computed by the Phase 4A policy fingerprint helper.';

create index if not exists idx_automation_policy_configs_policy_version
  on public.automation_policy_configs(policy_key, policy_version);
create index if not exists idx_automation_policy_configs_created_at
  on public.automation_policy_configs(created_at desc);

create or replace function public.qf_prevent_automation_policy_config_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'AUTOMATION_POLICY_CONFIG_IMMUTABLE' using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_automation_policy_configs_immutable
  on public.automation_policy_configs;
create trigger trg_automation_policy_configs_immutable
before update or delete on public.automation_policy_configs
for each row execute function public.qf_prevent_automation_policy_config_mutation();

-- ----------------------------------------------------------------------------
-- Mutable active pointer to an immutable config version
-- ----------------------------------------------------------------------------
create table if not exists public.automation_policy_active_configs (
  policy_key text primary key,
  config_id uuid not null,
  activated_by text,
  activated_at timestamptz not null default now(),
  constraint automation_policy_active_configs_policy_key_non_empty
    check (length(trim(policy_key)) > 0),
  constraint automation_policy_active_configs_config_fk
    foreign key (policy_key, config_id)
    references public.automation_policy_configs(policy_key, id)
    on update restrict
    on delete restrict
);

comment on table public.automation_policy_active_configs is
  'Mutable pointer to the currently active immutable automation policy config. Service-role only in Phase 4B-1.';

create index if not exists idx_automation_policy_active_configs_config_id
  on public.automation_policy_active_configs(config_id);

-- ----------------------------------------------------------------------------
-- Safe default seed: lead_distribution_authorization_v1
-- Fingerprint computed from:
-- computePolicyConfigFingerprint(
--   SAFE_DEFAULT_LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_CONFIG
-- )
-- Expected by scripts/phase4b1-policy-inputs-contract-harness.mjs.
-- ----------------------------------------------------------------------------
with inserted_config as (
  insert into public.automation_policy_configs (
    policy_key,
    policy_version,
    config_json,
    config_fingerprint,
    created_by
  )
  values (
    'lead_distribution_authorization',
    'lead_distribution_authorization_v1',
    '{
      "policyVersion": "lead_distribution_authorization_v1",
      "mode": "human_approval_only",
      "enabled": false,
      "minimumAutoAuthorizeScore": 90,
      "allowedAutoAuthorizeScoreClasses": ["A+"],
      "requireNoHardBlock": true,
      "requiredRecommendedAction": "auto_distribute",
      "minimumRecommendationCount": 1,
      "maximumRecommendationCount": 3
    }'::jsonb,
    '1ecca567b6564e9188d4aab7cb7557614c87f2131c947b42929475b4e592901c',
    'phase4b1_safe_default_seed'
  )
  on conflict (policy_key, config_fingerprint) do nothing
  returning id, policy_key
),
selected_config as (
  select id, policy_key
  from inserted_config
  union all
  select id, policy_key
  from public.automation_policy_configs
  where policy_key = 'lead_distribution_authorization'
    and config_fingerprint = '1ecca567b6564e9188d4aab7cb7557614c87f2131c947b42929475b4e592901c'
  limit 1
)
insert into public.automation_policy_active_configs (
  policy_key,
  config_id,
  activated_by
)
select
  policy_key,
  id,
  'phase4b1_safe_default_seed'
from selected_config
on conflict (policy_key) do nothing;

-- ----------------------------------------------------------------------------
-- RLS / privileges
-- ----------------------------------------------------------------------------
alter table public.automation_policy_configs enable row level security;
alter table public.automation_policy_active_configs enable row level security;

revoke all on public.automation_policy_configs from anon;
revoke all on public.automation_policy_configs from authenticated;
revoke all on public.automation_policy_active_configs from anon;
revoke all on public.automation_policy_active_configs from authenticated;

grant select, insert on public.automation_policy_configs to service_role;
grant select, insert, update, delete on public.automation_policy_active_configs to service_role;

revoke all on function public.qf_prevent_automation_policy_config_mutation() from public;
revoke all on function public.qf_prevent_automation_policy_config_mutation() from anon;
revoke all on function public.qf_prevent_automation_policy_config_mutation() from authenticated;
grant execute on function public.qf_prevent_automation_policy_config_mutation() to service_role;
