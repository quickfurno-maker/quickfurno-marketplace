-- QuickFurno Phase 1.5: B-lead WhatsApp clarification preview flow.
-- Preview/admin-controlled only. No live WhatsApp, assignment, or credit logic.

create table if not exists public.lead_clarification_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  score_before integer null,
  score_class_before text null,
  parent_category_group text null,
  marketplace_category text null,
  service_required text null,
  subcategory text null,
  missing_fields text[] not null default '{}',
  questions_json jsonb not null default '[]'::jsonb,
  preview_message text null,
  status text not null default 'preview_prepared',
  sent_preview_at timestamptz null,
  sent_at timestamptz null,
  response_received_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null default 'system'
);

create index if not exists idx_lead_clarification_requests_lead_id on public.lead_clarification_requests(lead_id);
create index if not exists idx_lead_clarification_requests_status on public.lead_clarification_requests(status);
create index if not exists idx_lead_clarification_requests_marketplace_category on public.lead_clarification_requests(marketplace_category);
create index if not exists idx_lead_clarification_requests_created_at on public.lead_clarification_requests(created_at);

create table if not exists public.lead_clarification_responses (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  request_id uuid references public.lead_clarification_requests(id) on delete cascade,
  question_key text not null,
  answer_value text not null,
  answer_label text null,
  mapped_field text null,
  mapped_value text null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_lead_clarification_responses_lead_id on public.lead_clarification_responses(lead_id);
create index if not exists idx_lead_clarification_responses_request_id on public.lead_clarification_responses(request_id);
create index if not exists idx_lead_clarification_responses_question_key on public.lead_clarification_responses(question_key);

alter table public.leads
  add column if not exists clarification_status text,
  add column if not exists clarification_required boolean default false,
  add column if not exists clarification_missing_fields text[],
  add column if not exists clarification_last_request_id uuid,
  add column if not exists clarification_checked_at timestamptz;
