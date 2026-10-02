-- QuickFurno fair-opportunity FK index hardening
-- Additive/index-only. No data, credit, assignment, or fairness mutation.
begin;

create index if not exists idx_lead_fairness_candidates_vendor
  on public.lead_fairness_candidates(vendor_id, lead_id);

create index if not exists idx_vendor_opportunity_events_vendor
  on public.vendor_opportunity_events(vendor_id, occurred_at desc);

commit;
