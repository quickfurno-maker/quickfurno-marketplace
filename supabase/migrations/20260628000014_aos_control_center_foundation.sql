-- ============================================================================
-- QuickFurno - AOS Control Center foundation
-- Migration suggestion only. Do not apply automatically from the app.
--
-- Purpose:
-- - Admin-only AOS tables for agents, versions, prompts, rules, permissions,
--   logs, memory, tests, approvals, failures, costs, and audit history.
-- - No unsafe public policies.
-- - No AI, WhatsApp, n8n, lead distribution, or credit side effects.
-- - Seed rows for all 30 QuickFurno AOS agents.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- AOS AGENTS
-- ----------------------------------------------------------------------------
create table if not exists public.aos_agents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  agent_key text not null unique,
  agent_name text not null,
  purpose text not null,
  status text not null default 'future/inactive' check (status in (
    'foundation', 'testing', 'active', 'paused', 'disabled', 'future', 'inactive', 'future/inactive', 'archived'
  )),
  mode text not null default 'placeholder' check (mode in ('placeholder', 'rule_based', 'ai_assisted', 'hybrid', 'safe_mock')),
  version text not null default '0.1.0',
  last_run_at timestamptz,
  runs_today integer not null default 0,
  success_rate numeric check (success_rate is null or (success_rate >= 0 and success_rate <= 100)),
  error_count integer not null default 0,
  average_confidence numeric check (average_confidence is null or (average_confidence >= 0 and average_confidence <= 100)),
  average_response_time_ms integer,
  memory_access text,
  permission_level text not null default 'disabled',
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.aos_agents is
  'Admin-only QuickFurno AOS agent registry. RLS enabled. Do not expose to public clients.';

alter table if exists public.aos_agents add column if not exists mode text not null default 'placeholder';
alter table if exists public.aos_agents add column if not exists runs_today integer not null default 0;
alter table if exists public.aos_agents add column if not exists success_rate numeric;
alter table if exists public.aos_agents add column if not exists error_count integer not null default 0;
alter table if exists public.aos_agents add column if not exists average_confidence numeric;
alter table if exists public.aos_agents add column if not exists average_response_time_ms integer;
alter table if exists public.aos_agents add column if not exists memory_access text;
alter table if exists public.aos_agents add column if not exists permission_level text not null default 'disabled';

-- ----------------------------------------------------------------------------
-- AOS AGENT VERSIONS
-- ----------------------------------------------------------------------------
create table if not exists public.aos_agent_versions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  agent_key text not null references public.aos_agents(agent_key) on delete cascade,
  version text not null,
  status text not null default 'draft' check (status in ('active', 'draft', 'testing', 'archived')),
  prompt_version text,
  rule_version text,
  version_notes text,
  created_by uuid references public.profiles(id) on delete set null,
  activated_at timestamptz,
  archived_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (agent_key, version)
);

comment on table public.aos_agent_versions is
  'Admin-only AOS agent version history. RLS enabled. Versions should change only through reviewed admin flows.';

-- ----------------------------------------------------------------------------
-- AOS AGENT PROMPTS
-- ----------------------------------------------------------------------------
create table if not exists public.aos_agent_prompts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  agent_key text not null references public.aos_agents(agent_key) on delete cascade,
  version text not null,
  status text not null default 'draft' check (status in ('active', 'draft', 'testing', 'archived')),
  prompt_logic text not null default '',
  version_notes text,
  created_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  unique (agent_key, version)
);

comment on table public.aos_agent_prompts is
  'Admin-only AOS prompt versions. Store no secrets. RLS enabled. Do not expose prompt bodies publicly.';

-- ----------------------------------------------------------------------------
-- AOS AGENT RULES
-- ----------------------------------------------------------------------------
create table if not exists public.aos_agent_rules (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  agent_key text not null references public.aos_agents(agent_key) on delete cascade,
  rule_name text not null,
  version text not null,
  status text not null default 'draft' check (status in ('active', 'draft', 'testing', 'archived')),
  rule_summary text,
  rule_logic jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  unique (agent_key, rule_name, version)
);

comment on table public.aos_agent_rules is
  'Admin-only AOS business rule versions. RLS enabled. Rules require testing and approval before activation.';

-- ----------------------------------------------------------------------------
-- AOS AGENT PERMISSIONS
-- ----------------------------------------------------------------------------
create table if not exists public.aos_agent_permissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  agent_key text not null unique references public.aos_agents(agent_key) on delete cascade,
  status text not null default 'disabled' check (status in ('foundation', 'testing', 'active', 'paused', 'disabled', 'future', 'inactive', 'future/inactive')),
  permission_level text not null default 'disabled',
  read_leads boolean not null default false,
  write_leads boolean not null default false,
  send_whatsapp boolean not null default false,
  deduct_credits boolean not null default false,
  access_revenue boolean not null default false,
  access_client_phone boolean not null default false,
  approval_required boolean not null default true,
  auto_execute_allowed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.aos_agent_permissions is
  'Admin-only AOS permission matrix. RLS enabled. Dangerous permissions default to false.';

-- ----------------------------------------------------------------------------
-- AOS AGENT LOGS
-- ----------------------------------------------------------------------------
create table if not exists public.aos_agent_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  agent_key text not null references public.aos_agents(agent_key) on delete cascade,
  task_type text not null,
  entity_type text,
  entity_id text,
  input_summary text,
  output_summary text,
  decision text,
  reason text,
  confidence_score numeric check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'blocked', 'skipped')),
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.aos_agent_logs is
  'Admin-only AOS run logs. RLS enabled. Summaries should mask phone numbers and sensitive values.';

-- ----------------------------------------------------------------------------
-- AOS AGENT MEMORY
-- ----------------------------------------------------------------------------
create table if not exists public.aos_agent_memory (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  agent_key text not null references public.aos_agents(agent_key) on delete cascade,
  memory_type text not null,
  entity_type text,
  entity_id text,
  memory_key text not null,
  memory_value text not null,
  is_sensitive boolean not null default false,
  created_by_agent text,
  confidence_score numeric check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'expired', 'archived')),
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.aos_agent_memory is
  'Admin-only AOS memory table. RLS enabled. Sensitive values must be masked or summarized.';

-- ----------------------------------------------------------------------------
-- AOS AGENT TESTS
-- ----------------------------------------------------------------------------
create table if not exists public.aos_agent_tests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  agent_key text not null references public.aos_agents(agent_key) on delete cascade,
  current_version text,
  draft_version text,
  sample_entity_type text,
  sample_entity_id text,
  old_decision text,
  new_decision text,
  difference text,
  risk text check (risk is null or risk in ('low', 'medium', 'high', 'critical')),
  recommendation text,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  created_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.aos_agent_tests is
  'Admin-only AOS test lab runs. RLS enabled. Tests compare versions without executing live side effects.';

-- ----------------------------------------------------------------------------
-- AOS APPROVAL QUEUE
-- ----------------------------------------------------------------------------
create table if not exists public.aos_approval_queue (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  agent_key text references public.aos_agents(agent_key) on delete set null,
  action_type text not null,
  entity_type text,
  entity_id text,
  request_summary text not null,
  risk_level text not null default 'medium' check (risk_level in ('low', 'medium', 'high', 'critical')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  requested_by_agent text,
  requested_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.aos_approval_queue is
  'Admin-only AOS approval queue. RLS enabled. Sensitive actions must be approved before execution.';

-- ----------------------------------------------------------------------------
-- AOS FAILURES
-- ----------------------------------------------------------------------------
create table if not exists public.aos_failures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  agent_key text not null references public.aos_agents(agent_key) on delete cascade,
  failure_type text not null,
  task_type text,
  entity_type text,
  entity_id text,
  status text not null default 'failed' check (status in ('failed', 'blocked', 'resolved', 'retrying')),
  error_message text,
  retry_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.aos_failures is
  'Admin-only AOS failure center. RLS enabled. Failures should not expose secrets or raw client phone numbers.';

-- ----------------------------------------------------------------------------
-- AOS COST LOGS
-- ----------------------------------------------------------------------------
create table if not exists public.aos_cost_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  agent_key text not null references public.aos_agents(agent_key) on delete cascade,
  task_type text,
  entity_type text,
  entity_id text,
  runs_count integer not null default 1,
  token_estimate integer not null default 0,
  cost_estimate numeric not null default 0,
  cost_per_lead numeric,
  monthly_estimate numeric,
  failed_cost numeric not null default 0,
  status text not null default 'estimated' check (status in ('completed', 'failed', 'blocked', 'estimated')),
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.aos_cost_logs is
  'Admin-only AOS cost tracking. RLS enabled. Placeholder costs are estimates until real AI providers are enabled.';

-- ----------------------------------------------------------------------------
-- AOS AUDIT LOGS
-- ----------------------------------------------------------------------------
create table if not exists public.aos_audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  agent_key text references public.aos_agents(agent_key) on delete set null,
  actor_type text not null default 'system' check (actor_type in ('system', 'admin', 'agent')),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  status text not null default 'recorded' check (status in ('recorded', 'blocked', 'approved', 'rejected')),
  reason text,
  before_summary text,
  after_summary text,
  approval_request_id uuid references public.aos_approval_queue(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.aos_audit_logs is
  'Admin-only AOS audit history. RLS enabled. Store safe summaries, not secrets.';

-- ----------------------------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------------------------
create index if not exists idx_aos_agents_agent_key on public.aos_agents(agent_key);
create index if not exists idx_aos_agents_status on public.aos_agents(status);
create index if not exists idx_aos_agents_created_at on public.aos_agents(created_at desc);

create index if not exists idx_aos_agent_versions_agent_key on public.aos_agent_versions(agent_key);
create index if not exists idx_aos_agent_versions_status on public.aos_agent_versions(status);
create index if not exists idx_aos_agent_versions_created_at on public.aos_agent_versions(created_at desc);

create index if not exists idx_aos_agent_prompts_agent_key on public.aos_agent_prompts(agent_key);
create index if not exists idx_aos_agent_prompts_status on public.aos_agent_prompts(status);
create index if not exists idx_aos_agent_prompts_created_at on public.aos_agent_prompts(created_at desc);

create index if not exists idx_aos_agent_rules_agent_key on public.aos_agent_rules(agent_key);
create index if not exists idx_aos_agent_rules_status on public.aos_agent_rules(status);
create index if not exists idx_aos_agent_rules_created_at on public.aos_agent_rules(created_at desc);

create index if not exists idx_aos_agent_permissions_agent_key on public.aos_agent_permissions(agent_key);
create index if not exists idx_aos_agent_permissions_status on public.aos_agent_permissions(status);
create index if not exists idx_aos_agent_permissions_created_at on public.aos_agent_permissions(created_at desc);

create index if not exists idx_aos_agent_logs_agent_key on public.aos_agent_logs(agent_key);
create index if not exists idx_aos_agent_logs_status on public.aos_agent_logs(status);
create index if not exists idx_aos_agent_logs_created_at on public.aos_agent_logs(created_at desc);
create index if not exists idx_aos_agent_logs_entity_type on public.aos_agent_logs(entity_type);
create index if not exists idx_aos_agent_logs_entity_id on public.aos_agent_logs(entity_id);

create index if not exists idx_aos_agent_memory_agent_key on public.aos_agent_memory(agent_key);
create index if not exists idx_aos_agent_memory_status on public.aos_agent_memory(status);
create index if not exists idx_aos_agent_memory_created_at on public.aos_agent_memory(created_at desc);
create index if not exists idx_aos_agent_memory_entity_type on public.aos_agent_memory(entity_type);
create index if not exists idx_aos_agent_memory_entity_id on public.aos_agent_memory(entity_id);

create index if not exists idx_aos_agent_tests_agent_key on public.aos_agent_tests(agent_key);
create index if not exists idx_aos_agent_tests_status on public.aos_agent_tests(status);
create index if not exists idx_aos_agent_tests_created_at on public.aos_agent_tests(created_at desc);
create index if not exists idx_aos_agent_tests_entity_type on public.aos_agent_tests(sample_entity_type);
create index if not exists idx_aos_agent_tests_entity_id on public.aos_agent_tests(sample_entity_id);

create index if not exists idx_aos_approval_queue_agent_key on public.aos_approval_queue(agent_key);
create index if not exists idx_aos_approval_queue_status on public.aos_approval_queue(status);
create index if not exists idx_aos_approval_queue_created_at on public.aos_approval_queue(created_at desc);
create index if not exists idx_aos_approval_queue_entity_type on public.aos_approval_queue(entity_type);
create index if not exists idx_aos_approval_queue_entity_id on public.aos_approval_queue(entity_id);

create index if not exists idx_aos_failures_agent_key on public.aos_failures(agent_key);
create index if not exists idx_aos_failures_status on public.aos_failures(status);
create index if not exists idx_aos_failures_created_at on public.aos_failures(created_at desc);
create index if not exists idx_aos_failures_entity_type on public.aos_failures(entity_type);
create index if not exists idx_aos_failures_entity_id on public.aos_failures(entity_id);

create index if not exists idx_aos_cost_logs_agent_key on public.aos_cost_logs(agent_key);
create index if not exists idx_aos_cost_logs_status on public.aos_cost_logs(status);
create index if not exists idx_aos_cost_logs_created_at on public.aos_cost_logs(created_at desc);
create index if not exists idx_aos_cost_logs_entity_type on public.aos_cost_logs(entity_type);
create index if not exists idx_aos_cost_logs_entity_id on public.aos_cost_logs(entity_id);

create index if not exists idx_aos_audit_logs_agent_key on public.aos_audit_logs(agent_key);
create index if not exists idx_aos_audit_logs_status on public.aos_audit_logs(status);
create index if not exists idx_aos_audit_logs_created_at on public.aos_audit_logs(created_at desc);
create index if not exists idx_aos_audit_logs_entity_type on public.aos_audit_logs(entity_type);
create index if not exists idx_aos_audit_logs_entity_id on public.aos_audit_logs(entity_id);

-- ----------------------------------------------------------------------------
-- RLS: admin-only policies. No anon/public policies are created.
-- ----------------------------------------------------------------------------
alter table public.aos_agents enable row level security;
alter table public.aos_agent_versions enable row level security;
alter table public.aos_agent_prompts enable row level security;
alter table public.aos_agent_rules enable row level security;
alter table public.aos_agent_permissions enable row level security;
alter table public.aos_agent_logs enable row level security;
alter table public.aos_agent_memory enable row level security;
alter table public.aos_agent_tests enable row level security;
alter table public.aos_approval_queue enable row level security;
alter table public.aos_failures enable row level security;
alter table public.aos_cost_logs enable row level security;
alter table public.aos_audit_logs enable row level security;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'aos_agents',
    'aos_agent_versions',
    'aos_agent_prompts',
    'aos_agent_rules',
    'aos_agent_permissions',
    'aos_agent_logs',
    'aos_agent_memory',
    'aos_agent_tests',
    'aos_approval_queue',
    'aos_failures',
    'aos_cost_logs',
    'aos_audit_logs'
  ]
  loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = target_table
        and policyname = target_table || ' admin all'
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
        target_table || ' admin all',
        target_table
      );
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- SEED: all 30 QuickFurno AOS agents.
-- Foundation agents: testing with foundation metadata.
-- Future agents: future/inactive and disabled/placeholder.
-- ON CONFLICT updates only non-dangerous metadata/display fields.
-- ----------------------------------------------------------------------------
insert into public.aos_agents (
  agent_key,
  agent_name,
  purpose,
  status,
  mode,
  version,
  permission_level,
  memory_access,
  metadata
)
values
  ('nexus-kernel', 'QF-AOS-NexusKernel', 'Routes AOS tasks, checks permission gates, coordinates safe orchestration.', 'testing', 'rule_based', '0.1.0-foundation', 'kernel approval', 'system memory', '{"phase":"foundation","activation_state":"testing"}'::jsonb),
  ('furno-memory', 'QF-AOS-FurnoMemory', 'Stores shared lead, vendor, client, and agent context memory.', 'testing', 'rule_based', '0.1.0-foundation', 'memory steward', 'system memory', '{"phase":"foundation","activation_state":"testing"}'::jsonb),
  ('lead-lens', 'QF-AOS-LeadLens', 'Rule-based lead quality scoring and qualification.', 'testing', 'rule_based', '0.1.0-foundation', 'review only', 'lead memory', '{"phase":"foundation","activation_state":"testing"}'::jsonb),
  ('trust-shield', 'QF-AOS-TrustShield', 'Rule-based spam and duplicate risk review.', 'testing', 'rule_based', '0.1.0-foundation', 'review only', 'trust memory', '{"phase":"foundation","activation_state":"testing"}'::jsonb),
  ('match-forge', 'QF-AOS-MatchForge', 'Vendor suggestions only, max 3, excludes disabled vendors.', 'testing', 'rule_based', '0.1.0-foundation', 'preview only', 'lead/vendor memory', '{"phase":"foundation","activation_state":"testing"}'::jsonb),
  ('lead-flow', 'QF-AOS-LeadFlow', 'Assignment and notification preview only, no side effects.', 'testing', 'rule_based', '0.1.0-foundation', 'approval required', 'crm memory', '{"phase":"foundation","activation_state":"testing"}'::jsonb),
  ('ops-brief', 'QF-AOS-OpsBrief', 'Read-only operations summary and daily report.', 'testing', 'rule_based', '0.1.0-foundation', 'read only', 'analytics memory', '{"phase":"foundation","activation_state":"testing"}'::jsonb),
  ('client-care', 'QF-AOS-ClientCare', 'Future client follow-up, support, and nurture assistant.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('vendor-pulse', 'QF-AOS-VendorPulse', 'Future vendor health, response, renewal, and capacity assistant.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('revenue-vault', 'QF-AOS-RevenueVault', 'Future package, payment, revenue, and credit intelligence assistant.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('review-shield', 'QF-AOS-ReviewShield', 'Future review moderation and public trust assistant.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('growth-radar', 'QF-AOS-GrowthRadar', 'Future city, category, SEO, and demand growth assistant.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('content-craft', 'QF-AOS-ContentCraft', 'Future SEO page, content, and marketplace copy assistant.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('admin-copilot', 'QF-AOS-AdminCopilot', 'Future superadmin helper for summaries, drafts, and safe recommendations.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('vault-guard', 'QF-AOS-VaultGuard', 'Future secret, permission, audit, and rollback guardian.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('lead-nurture', 'QF-AOS-LeadNurture', 'Long-term lead nurturing, follow-up scheduling, and reactivation.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('calendar-sync', 'QF-AOS-CalendarSync', 'Future CRM calendar and follow-up/site-visit reminder sync.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('source-tracker', 'QF-AOS-SourceTracker', 'Track lead source, UTM, campaign, referrer, and landing page attribution.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('ad-brain', 'QF-AOS-AdBrain', 'Future Google/Meta campaign performance and marketing recommendation assistant.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('city-scout', 'QF-AOS-CityScout', 'Analyze area and city demand for expansion suggestions.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('vendor-onboard', 'QF-AOS-VendorOnboard', 'Vendor onboarding, profile completeness, and verification readiness.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('deal-tracker', 'QF-AOS-DealTracker', 'Track lead outcome, site visit, quotation, won/lost, and vendor conversion.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('quality-audit', 'QF-AOS-QualityAudit', 'Audit lead quality, vendor quality, bad matching, complaints, and poor source quality.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('package-advisor', 'QF-AOS-PackageAdvisor', 'Recommend vendor packages by category, demand, city, performance, and budget.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('whatsapp-pilot', 'QF-AOS-WhatsAppPilot', 'Future WhatsApp automation controller for clients, vendors, and admin alerts.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('replacement-desk', 'QF-AOS-ReplacementDesk', 'Handle invalid lead replacement requests and recommend approval or rejection.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('fraud-radar', 'QF-AOS-FraudRadar', 'Advanced fraud, competitor testing, vendor spying, fake client, and suspicious activity detection.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('seo-scout', 'QF-AOS-SEOScout', 'Find SEO page opportunities from lead demand, service, city, and area data.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('sales-coach', 'QF-AOS-SalesCoach', 'Sales and admin follow-up suggestions, objection handling, and next best action.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('executive-brief', 'QF-AOS-ExecutiveBrief', 'Founder-level daily and weekly business summary, revenue projection, urgent actions, and growth suggestions.', 'future/inactive', 'placeholder', '0.1.0-future', 'disabled', 'none', '{"phase":"future","activation_state":"inactive"}'::jsonb)
on conflict (agent_key) do update set
  agent_name = excluded.agent_name,
  purpose = excluded.purpose,
  mode = excluded.mode,
  version = excluded.version,
  permission_level = excluded.permission_level,
  memory_access = excluded.memory_access,
  metadata = aos_agents.metadata || excluded.metadata,
  updated_at = now();

insert into public.aos_agent_permissions (
  agent_key,
  status,
  permission_level,
  read_leads,
  write_leads,
  send_whatsapp,
  deduct_credits,
  access_revenue,
  access_client_phone,
  approval_required,
  auto_execute_allowed
)
select
  agent_key,
  case when status = 'testing' then 'testing' else 'future/inactive' end,
  permission_level,
  agent_key in ('lead-lens', 'trust-shield', 'match-forge', 'lead-flow', 'ops-brief', 'lead-nurture', 'source-tracker'),
  false,
  false,
  false,
  agent_key = 'revenue-vault',
  false,
  true,
  false
from public.aos_agents
on conflict (agent_key) do update set
  status = excluded.status,
  permission_level = excluded.permission_level,
  read_leads = excluded.read_leads,
  write_leads = false,
  send_whatsapp = false,
  deduct_credits = false,
  access_client_phone = false,
  approval_required = true,
  auto_execute_allowed = false,
  updated_at = now();
