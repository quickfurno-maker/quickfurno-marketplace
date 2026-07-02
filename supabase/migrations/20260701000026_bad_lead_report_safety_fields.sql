-- Phase 25B Step 7: bad-lead report safety fields.
-- Admin review remains required; reporting does not automatically refund credit.

alter table public.bad_lead_reports
  add column if not exists report_type text,
  add column if not exists report_reason text,
  add column if not exists vendor_comment text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists updated_at timestamptz default now();

create index if not exists idx_badreports_vendor_created
  on public.bad_lead_reports(vendor_id, created_at desc);
