-- ============================================================================
-- QuickFurno — lead_drafts (partial lead capture for the enquiry modal)
--
-- One anonymous row per modal open. The browser generates the UUID; the
-- server upserts the same row as the visitor advances through the 3-step
-- form ('project' → 'details') and marks it 'converted' when the real lead
-- is submitted. Rows whose stage never reaches 'converted' are drop-offs.
--
-- PRIVACY: this table intentionally has NO name/phone/WhatsApp/GPS columns.
-- SECURITY: RLS is enabled with NO policies — only the service-role key
-- (services/leadDraftService.ts) can read or write. Safe to truncate at any
-- time; nothing in the product depends on it.
--
-- Apply via the normal migration workflow. The app works unchanged before
-- this is applied (draft capture silently no-ops).
-- ============================================================================

create table if not exists public.lead_drafts (
  id uuid primary key,
  stage text not null check (stage in ('project', 'details', 'converted')),
  service_category text,
  subcategory text,
  city text,
  area text,
  budget_range text,
  timeline text,
  property_type text,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.lead_drafts is
  'Anonymous partial enquiries from the 3-step homepage modal. No PII. Service-role access only.';

-- Funnel queries: drop-offs per day / per service.
create index if not exists lead_drafts_created_at_idx on public.lead_drafts (created_at desc);
create index if not exists lead_drafts_stage_idx on public.lead_drafts (stage);

alter table public.lead_drafts enable row level security;
revoke all on table public.lead_drafts from public, anon, authenticated;
grant select, insert, update on table public.lead_drafts to service_role;
-- Deliberately no RLS policies: anon/authenticated clients get nothing.
