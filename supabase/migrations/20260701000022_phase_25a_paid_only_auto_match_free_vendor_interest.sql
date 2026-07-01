-- ============================================================================
-- QuickFurno - Phase 25A: Paid-only auto matching + free vendor interest capture
--
-- Safe migration rules for this phase:
-- - Additive only: create table if not exists, create index if not exists,
--   insert ... on conflict do nothing.
-- - No drop/delete/truncate/destructive update.
-- - Auto assignment mode is seeded as preview-only.
-- ============================================================================

create table if not exists public.marketplace_runtime_settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value jsonb not null default 'false'::jsonb,
  description text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.free_vendor_profile_interests (
  id uuid primary key default gen_random_uuid(),
  vendor_id text not null,
  lead_id text,
  client_name text,
  client_phone_masked text,
  client_phone_hash text,
  city text,
  area text,
  category text,
  subcategory text,
  interest_type text not null default 'profile_contact_request',
  status text not null default 'interest_captured',
  vendor_notified boolean not null default false,
  vendor_notified_at timestamptz,
  aos_event_id text,
  n8n_preview_called boolean not null default false,
  unlocked_after_payment boolean not null default false,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_assignment_queue (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  city text,
  category text,
  subcategory text,
  queue_status text not null default 'queued',
  queue_reason text not null,
  required_vendor_count int not null default 1,
  eligible_vendor_count int not null default 0,
  selected_vendor_ids jsonb not null default '[]'::jsonb,
  rejected_vendor_reasons jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  next_retry_at timestamptz,
  matching_attempt_count int not null default 0,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_auto_assignment_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  mode text not null default 'preview',
  status text not null,
  city text,
  category text,
  subcategory text,
  eligible_vendor_count int not null default 0,
  selected_vendor_ids jsonb not null default '[]'::jsonb,
  rejected_vendor_reasons jsonb not null default '{}'::jsonb,
  scoring_snapshot jsonb not null default '{}'::jsonb,
  queue_reason text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_free_vendor_profile_interests_vendor_id on public.free_vendor_profile_interests(vendor_id);
create index if not exists idx_free_vendor_profile_interests_lead_id on public.free_vendor_profile_interests(lead_id);
create index if not exists idx_free_vendor_profile_interests_status on public.free_vendor_profile_interests(status);
create index if not exists idx_free_vendor_profile_interests_created_at on public.free_vendor_profile_interests(created_at);

create index if not exists idx_lead_assignment_queue_lead_id on public.lead_assignment_queue(lead_id);
create index if not exists idx_lead_assignment_queue_status on public.lead_assignment_queue(queue_status);
create index if not exists idx_lead_assignment_queue_created_at on public.lead_assignment_queue(created_at);

create index if not exists idx_lead_auto_assignment_logs_lead_id on public.lead_auto_assignment_logs(lead_id);
create index if not exists idx_lead_auto_assignment_logs_status on public.lead_auto_assignment_logs(status);
create index if not exists idx_lead_auto_assignment_logs_created_at on public.lead_auto_assignment_logs(created_at);

insert into public.marketplace_runtime_settings (key, value, description, updated_by)
values
  ('show_free_vendors_publicly', 'true'::jsonb, 'Allows approved active free vendors to remain visible publicly without lead assignment eligibility.', 'system_seed'),
  ('allow_free_vendor_interest_capture', 'true'::jsonb, 'Allows safe interest capture on gated free vendor profiles.', 'system_seed'),
  ('notify_free_vendor_recharge_interest', 'true'::jsonb, 'Allows preview-only recharge prompt event creation for free vendor interest.', 'system_seed'),
  ('allow_trial_vendors_for_assignment', 'true'::jsonb, 'Allows trial vendors with credits to appear in assignment suggestions.', 'system_seed'),
  ('minimum_paid_vendors_required_for_auto_assignment', '1'::jsonb, 'Minimum paid/trial eligible vendors required before auto suggestion succeeds.', 'system_seed'),
  ('max_vendors_per_lead', '3'::jsonb, 'Maximum vendors selected in preview suggestions for one lead.', 'system_seed'),
  ('auto_assignment_mode', '"preview"'::jsonb, 'Preview-only auto assignment mode. No final assignment or credit deduction.', 'system_seed')
on conflict (key) do nothing;
