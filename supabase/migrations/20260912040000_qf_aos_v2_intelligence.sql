-- ==========================================================================
-- QuickFurno AOS V2 — production intelligence foundation
--
-- Authority model:
--   AOS thinks / recommends.
--   QuickFurno Core validates and authorizes.
--   Modern automation_action_requests + n8n execute authorized work.
--   Core verifies and records outcomes.
--
-- Deliberately NOT created or activated:
--   domain_events, workflow_instances, workflow_tasks, outbox_events,
--   idempotency_records, workflow_failures, workflow_transition_history.
-- Those belong to the retired AOS workflow-kernel experiment and MUST NOT
-- coexist with the QF-MVP-50 automation authority.
-- ==========================================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------------------
-- Permanently retire the old placeholder/future-agent catalogue. Historical
-- migration files stay byte-frozen; if the legacy management table exists,
-- deleting these parent rows cascades through dependent future-agent records.
-- ------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.aos_agents') is not null then
    delete from public.aos_agents
    where agent_key in ('client-care', 'vendor-pulse', 'revenue-vault', 'review-shield', 'growth-radar', 'content-craft', 'admin-copilot', 'vault-guard', 'lead-nurture', 'calendar-sync', 'source-tracker', 'ad-brain', 'city-scout', 'vendor-onboard', 'deal-tracker', 'quality-audit', 'package-advisor', 'whatsapp-pilot', 'replacement-desk', 'fraud-radar', 'seo-scout', 'sales-coach', 'executive-brief');
  end if;
end
$$;

-- ------------------------------------------------------------------------
-- Runtime: activate intelligence in SHADOW mode only. Action proposals remain
-- independently OFF. Retire the legacy direct AOS -> n8n preview router.
-- -----------------------------------------------------------------------
insert into public.aos_runtime_settings
  (setting_key, enabled, mode, description, updated_by, updated_at)
values
  (
    'aos_v2_intelligence',
    true,
    'preview',
    'AOS V2 intelligence runtime. Shadow/advisory only; Core remains authority.',
    'migration:qf_aos_v2',
    now()
  ),
  (
    'aos_v2_action_proposals',
    false,
    'off',
    'AOS V2 governed action proposal seam. Locked OFF until separately certified.',
    'migration:qf_aos_v2',
    now()
  )
on conflict (setting_key) do nothing;

update public.aos_runtime_settings
set
  enabled = false,
  mode = 'off',
  description = 'Legacy AOS -> n8n Master Preview Router retired. AOS V2 never calls n8n directly.',
  updated_by = 'migration:qf_aos_v2',
  updated_at = now()
where setting_key = 'aos_n8n_master_router';

-- ----------------------------------------------------------------------
-- One durable AOS run per intelligence evaluation.
-- Safe context only: no phone, access token, provider secret or raw message.
-- ----------------------------------------------------------------------
create table if not exists public.aos_runs (
  id uuid primary key default gen_random_uuid(),
  correlation_id text not null,
  event_type text not null,
  entity_type text not null,
  entity_id text not null,
  source text not null default 'quickfurno-core',
  mode text not null default 'shadow'
    check (mode in ('shadow', 'recommend')),
  status text not null default 'started'
    check (status in ('started', 'completed', 'failed', 'skipped')),
  canonical_inputs jsonb not null default '{}'::jsonb,
  recommendation_summary jsonb not null default '{}'::jsonb,
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.aos_runs is
  'AOS V2 intelligence-run ledger. Advisory only; rows never authorize assignment, credits, messaging or automation.';

create index if not exists idx_aos_runs_entity_created
  on public.aos_runs(entity_type, entity_id, created_at desc);
create index if not exists idx_aos_runs_status_created
  on public.aos_runs(status, created_at desc);
create index if not exists idx_aos_runs_correlation
  on public.aos_runs(correlation_id);

-- ------------------------------------------------------------------------
-- Agent decisions. This name intentionally matches services/aosService.ts so
-- historical safe logging becomes durable when the migration is present.
-- ------------------------------------------------------------------------
create table if not exists public.aos_agent_logs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.aos_runs(id) on delete set null,
  agent_key text not null,
  task_type text not null,
  entity_type text,
  entity_id text,
  input_summary text,
  output_summary text,
  decision text,
  reason text,
  confidence_score numeric(6,5)
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  status text not null default 'completed'
    check (status in ('started', 'completed', 'failed', 'skipped')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.aos_agent_logs is
  'Durable AOS agent decision audit. No business authority and no direct executor permission.';

create index if not exists idx_aos_agent_logs_run
  on public.aos_agent_logs(run_id, created_at);
create index if not exists idx_aos_agent_logs_agent_created
  on public.aos_agent_logs(agent_key, created_at desc);
create index if not exists idx_aos_agent_logs_entity_created
  on public.aos_agent_logs(entity_type, entity_id, created_at desc);

-- ----------------------------------------------------------------------
-- Advisory recommendations. An automation_request_id is only provenance after
-- Core receives a separately governed proposal; the row itself is never an
-- authorization and never creates a job.
-- ----------------------------------------------------------------------
create table if not exists public.aos_recommendations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.aos_runs(id) on delete cascade,
  agent_key text not null,
  recommendation_key text not null,
  entity_type text not null,
  entity_id text not null,
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high')),
  confidence_score numeric(6,5) not null
    check (confidence_score >= 0 and confidence_score <= 1),
  rationale text not null,
  payload jsonb not null default '{}'::jsonb,
  suggested_action_type text,
  action_state text not null default 'advisory_only'
    check (action_state in ('advisory_only', 'proposable', 'requested', 'rejected')),
  automation_request_id uuid,
  created_at timestamptz not null default now(),
  unique (run_id, agent_key, recommendation_key)
);

comment on table public.aos_recommendations is
  'AOS V2 advisory recommendations. Core must independently validate/authorize any proposed action.';

create index if not exists idx_aos_recommendations_entity_created
  on public.aos_recommendations(entity_type, entity_id, created_at desc);
create index if not exists idx_aos_recommendations_key_created
  on public.aos_recommendations(recommendation_key, created_at desc);
create index if not exists idx_aos_recommendations_action_state
  on public.aos_recommendations(action_state, created_at desc);

-- ------------------------------------------------------------------------
-- Durable scoped memory. This stores compact structured facts only; it is not
-- a workflow queue and carries no side-effect authority.
-- ------------------------------------------------------------------------
create table if not exists public.aos_agent_memory (
  id uuid primary key default gen_random_uuid(),
  namespace text not null,
  subject_type text not null,
  subject_id text not null,
  memory_key text not null,
  value jsonb not null default '{}'::jsonb,
  source_run_id uuid references public.aos_runs(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (namespace, subject_type, subject_id, memory_key)
);

comment on table public.aos_agent_memory is
  'AOS V2 scoped structured memory. Advisory context only; never an execution queue.';

create index if not exists idx_aos_agent_memory_subject
  on public.aos_agent_memory(namespace, subject_type, subject_id);
create index if not exists idx_aos_agent_memory_expiry
  on public.aos_agent_memory(expires_at)
  where expires_at is not null;

-- -----------------------------------------------------------------------
-- Security/audit trail for AOS control-plane and proposal transitions.
-- ------------------------------------------------------------------------
create table if not exists public.aos_audit_logs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.aos_runs(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  actor_type text not null default 'system',
  actor_id text not null default 'aos-v2',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.aos_audit_logs is
  'AOS V2 control/audit ledger. No secrets and no authority-bearing payloads.';

create index if not exists idx_aos_audit_logs_created
  on public.aos_audit_logs(created_at desc);
create index if not exists idx_aos_audit_logs_entity
  on public.aos_audit_logs(entity_type, entity_id, created_at desc);

-- -----------------------------------------------------------------------
-- RLS: service-role writes server-side; authenticated admins may read. No anon
-- policy and no authenticated write policy are introduced.
-- -------------------------------------------------------------------------
alter table public.aos_runs enable row level security;
alter table public.aos_agent_logs enable row level security;
alter table public.aos_recommendations enable row level security;
alter table public.aos_agent_memory enable row level security;
alter table public.aos_audit_logs enable row level security;

do $$
declare
  v_table text;
  v_policy text;
begin
  foreach v_table in array array[
    'aos_runs',
    'aos_agent_logs',
    'aos_recommendations',
    'aos_agent_memory',
    'aos_audit_logs'
  ]
  loop
    v_policy := v_table || ' admin read';
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = v_table
        and policyname = v_policy
    ) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.is_admin())',
        v_policy,
        v_table
      );
    end if;
  end loop;
end
$$;

revoke all on table public.aos_runs from public, anon, authenticated;
revoke all on table public.aos_agent_logs from public, anon, authenticated;
revoke all on table public.aos_recommendations from public, anon, authenticated;
revoke all on table public.aos_agent_memory from public, anon, authenticated;
revoke all on table public.aos_audit_logs from public, anon, authenticated;

grant select on table public.aos_runs to authenticated;
grant select on table public.aos_agent_logs to authenticated;
grant select on table public.aos_recommendations to authenticated;
grant select on table public.aos_agent_memory to authenticated;
grant select on table public.aos_audit_logs to authenticated;

grant select, insert, update on table public.aos_runs to service_role;
grant select, insert, update on table public.aos_agent_logs to service_role;
grant select, insert, update on table public.aos_recommendations to service_role;
grant select, insert, update on table public.aos_agent_memory to service_role;
grant select, insert, update on table public.aos_audit_logs to service_role;
