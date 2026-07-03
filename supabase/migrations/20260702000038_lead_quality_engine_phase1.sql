-- QuickFurno Lead Quality Engine Phase 1
-- Rule-based lead scoring + hybrid distribution gate.

create table if not exists public.lead_scores (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  contact_score integer not null default 0,
  location_score integer not null default 0,
  requirement_score integer not null default 0,
  intent_score integer not null default 0,
  fraud_penalty integer not null default 0,
  total_score integer not null default 0,
  score_class text not null,
  hard_block_reason text null,
  recommended_action text not null,
  score_breakdown jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by text not null default 'system'
);

create index if not exists idx_lead_scores_lead_id on public.lead_scores(lead_id);
create index if not exists idx_lead_scores_score_class on public.lead_scores(score_class);
create index if not exists idx_lead_scores_total_score on public.lead_scores(total_score);
create index if not exists idx_lead_scores_created_at on public.lead_scores(created_at);

alter table public.leads
  add column if not exists lead_quality_score integer,
  add column if not exists lead_quality_class text,
  add column if not exists lead_quality_status text,
  add column if not exists lead_quality_hard_block_reason text,
  add column if not exists lead_quality_recommended_action text,
  add column if not exists lead_quality_checked_at timestamptz;
