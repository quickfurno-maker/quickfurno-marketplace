-- ============================================================================
-- QuickFurno - Phase 14: Assignment Ledger + Recent Assignments Sync
-- Migration suggestion only. Safe to run on the live DB (idempotent).
--
-- Purpose:
-- - Make Phase 13 preview approval records readable in the admin Lead
--   Distribution page (Recent Assignments / Distribution Logs) by storing
--   human-readable SNAPSHOTS at approval time.
-- - Still PREVIEW ONLY. The real lead_assignments table is NOT touched. This
--   only extends the preview ledger (lead_assignment_approvals).
--
-- Adds (all nullable / safe defaults):
--   lead_snapshot     jsonb  - lead name/city/category/budget at approval time
--   vendor_snapshot   jsonb  - selected vendors' name/city/package/credits
--   event_response    jsonb  - safe summary of the AOS emit result
--   failure_reason    text   - set only when a safe failure is recorded
--   approval_source   text   - default 'admin_preview'
--
-- Safety:
-- - ALTER TABLE IF EXISTS / ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT
--   EXISTS only. NO drop/delete/truncate.
-- - No WhatsApp, no vendor notification, no credit deduction, no auto
--   assignment, no n8n changes. RLS already enabled by migration 017.
-- ============================================================================

alter table if exists public.lead_assignment_approvals add column if not exists lead_snapshot jsonb not null default '{}'::jsonb;
alter table if exists public.lead_assignment_approvals add column if not exists vendor_snapshot jsonb not null default '[]'::jsonb;
alter table if exists public.lead_assignment_approvals add column if not exists event_response jsonb not null default '{}'::jsonb;
alter table if exists public.lead_assignment_approvals add column if not exists failure_reason text;
alter table if exists public.lead_assignment_approvals add column if not exists approval_source text not null default 'admin_preview';

create index if not exists idx_lead_assignment_approvals_approval_source on public.lead_assignment_approvals(approval_source);
create index if not exists idx_lead_assignment_approvals_failure_reason on public.lead_assignment_approvals(failure_reason);
