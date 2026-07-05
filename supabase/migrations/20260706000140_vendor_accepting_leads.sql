-- ============================================================================
-- QuickFurno — 20260706000140_vendor_accepting_leads.sql
-- Phase 4 (credit-wallet): temporary vendor availability control for NEW enquiries.
--
-- ADDITIVE + REVERSIBLE. GENERATED FOR REVIEW — DO NOT AUTO-APPLY.
-- Existing vendors default to TRUE so current production lead delivery is never
-- silently stopped. This field has ONE meaning: does the vendor currently want new
-- enquiries? It is DISTINCT from is_active / package_status / public_visibility.
-- ============================================================================
alter table if exists public.vendors
  add column if not exists accepting_leads boolean not null default true;

create index if not exists idx_vendors_accepting_leads on public.vendors(accepting_leads);

comment on column public.vendors.accepting_leads is
  'Phase 4 credit-wallet: vendor temporary availability for NEW enquiries. true=wants leads, false=paused. Distinct from is_active/package_status/public_visibility. Default true so existing delivery is never silently stopped.';

-- Reverse (review only):
--   alter table public.vendors drop column if exists accepting_leads;
