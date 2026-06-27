-- ============================================================================
-- QuickFurno - AOS management foundation
-- SQL migration suggestion only. Do not apply automatically from the app.
-- Adds admin-only AOS control center tables for agents, versions, prompts,
-- rules, permissions, logs, memory, tests, approvals, failures, costs, audit.
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
    'testing', 'active', 'paused', 'disabled', 'future', 'inactive', 'future/inactive', 'archived'
  )),
  version text not null default '0.1.0',
  last_run_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.aos_agents is
  'Admin-only QuickFurno AOS agent registry. RLS enabled. Do not expose to public clients.';

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
  'Admin-only AOS agent version history. RLS enabled. Versions should be changed through reviewed admin flows only.';

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
  status text not null default 'disabled' check (status in ('testing', 'active', 'paused', 'disabled', 'future/inactive')),
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
-- SEED: all 15 QuickFurno AOS agents. First 7 are testing; future agents are
-- future/inactive. ON CONFLICT DO NOTHING avoids overwriting admin changes.
-- ----------------------------------------------------------------------------
insert into public.aos_agents (agent_key, agent_name, purpose, status, version, metadata)
values
  ('nexus-kernel', 'QF-AOS-NexusKernel', 'Routes AOS tasks, checks permission gates, and coordinates safe mock-only orchestration.', 'testing', '0.1.0', '{"phase":"foundation"}'::jsonb),
  ('furno-memory', 'QF-AOS-FurnoMemory', 'Stores future shared lead, vendor, client, and agent context memory.', 'testing', '0.1.0', '{"phase":"foundation"}'::jsonb),
  ('lead-lens', 'QF-AOS-LeadLens', 'Reviews lead quality, duplicate risk, budget strength, urgency, and CRM fit.', 'testing', '0.1.0', '{"phase":"foundation"}'::jsonb),
  ('trust-shield', 'QF-AOS-TrustShield', 'Reviews spam, abuse, vendor trust signals, and unsafe marketplace patterns.', 'testing', '0.1.0', '{"phase":"foundation"}'::jsonb),
  ('match-forge', 'QF-AOS-MatchForge', 'Previews vendor matches while respecting max 3 vendors, disabled vendor exclusions, and future paid priority.', 'testing', '0.1.0', '{"phase":"foundation"}'::jsonb),
  ('lead-flow', 'QF-AOS-LeadFlow', 'Models CRM lifecycle, follow-ups, invalid lead replacement, and assignment readiness.', 'testing', '0.1.0', '{"phase":"foundation"}'::jsonb),
  ('ops-brief', 'QF-AOS-OpsBrief', 'Creates read-only operations summaries for leads, vendors, quality, approvals, failures, and cost.', 'testing', '0.1.0', '{"phase":"foundation"}'::jsonb),
  ('client-care', 'QF-AOS-ClientCare', 'Future client follow-up, support, and nurture assistant.', 'future/inactive', '0.1.0', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('vendor-pulse', 'QF-AOS-VendorPulse', 'Future vendor health, response, renewal, and capacity assistant.', 'future/inactive', '0.1.0', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('revenue-vault', 'QF-AOS-RevenueVault', 'Future package, payment, revenue, and credit intelligence assistant.', 'future/inactive', '0.1.0', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('review-shield', 'QF-AOS-ReviewShield', 'Future review moderation and public trust assistant.', 'future/inactive', '0.1.0', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('growth-radar', 'QF-AOS-GrowthRadar', 'Future city, category, SEO, and demand growth assistant.', 'future/inactive', '0.1.0', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('content-craft', 'QF-AOS-ContentCraft', 'Future SEO page, content, and marketplace copy assistant.', 'future/inactive', '0.1.0', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('admin-copilot', 'QF-AOS-AdminCopilot', 'Future superadmin helper for summaries, drafts, and safe recommendations.', 'future/inactive', '0.1.0', '{"phase":"future","activation_state":"inactive"}'::jsonb),
  ('vault-guard', 'QF-AOS-VaultGuard', 'Future secret, permission, audit, and rollback guardian.', 'future/inactive', '0.1.0', '{"phase":"future","activation_state":"inactive"}'::jsonb)
on conflict (agent_key) do nothing;

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
  case when status = 'testing' then 'mock-only' else 'disabled' end,
  agent_key in ('lead-lens', 'trust-shield', 'match-forge', 'lead-flow', 'ops-brief'),
  false,
  false,
  false,
  agent_key = 'revenue-vault',
  false,
  true,
  false
from public.aos_agents
on conflict (agent_key) do nothing;
