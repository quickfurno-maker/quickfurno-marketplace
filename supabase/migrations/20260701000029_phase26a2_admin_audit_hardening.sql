-- ============================================================================
-- QuickFurno — 20260701000029_phase26a2_admin_audit_hardening.sql
-- Phase 26A-2: admin audit visibility fields only. No credit logic changes,
-- no automatic refunds, no WhatsApp, no drops of data tables.
--   1) bad_lead_reports: admin review workflow fields + broader status set.
--   2) bad_lead_report_comments: admin/vendor comment trail for a report.
--   3) lead_delivery_logs: optional audit columns (failure_reason,
--      credit_log_id) for future writers; nullable and additive.
-- Idempotent. Safe to re-run.
-- ============================================================================

-- 1) bad_lead_reports review fields ------------------------------------------
alter table public.bad_lead_reports
  add column if not exists admin_notes text,
  add column if not exists reviewed_by uuid null;

-- Broaden the status set for the Phase 26A-2 review workflow while keeping
-- every legacy value valid. Review statuses never change credits.
alter table public.bad_lead_reports drop constraint if exists bad_lead_reports_status_check;
alter table public.bad_lead_reports
  add constraint bad_lead_reports_status_check check (
    status is null or status in (
      'Pending', 'Under Review', 'Valid', 'Invalid', 'Resolved', 'Rejected', 'Approved'
    )
  );

-- 2) bad_lead_report_comments --------------------------------------------------
create table if not exists public.bad_lead_report_comments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.bad_lead_reports(id) on delete cascade,
  sender_type text not null default 'admin',
  sender_id uuid null,
  comment text not null,
  is_internal boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_bad_lead_report_comments_report
  on public.bad_lead_report_comments(report_id, created_at);

alter table public.bad_lead_report_comments enable row level security;

grant select on public.bad_lead_report_comments to authenticated;
grant select, insert, update, delete on public.bad_lead_report_comments to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'bad_lead_report_comments' and policyname = 'bad_lead_report_comments admin all'
  ) then
    execute 'create policy "bad_lead_report_comments admin all" on public.bad_lead_report_comments for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'bad_lead_report_comments' and policyname = 'bad_lead_report_comments vendor read own'
  ) then
    execute 'create policy "bad_lead_report_comments vendor read own" on public.bad_lead_report_comments for select to authenticated using (
      coalesce(is_internal, false) = false
      and exists (
        select 1 from public.bad_lead_reports r
        where r.id = report_id and public.owns_vendor(r.vendor_id)
      )
    )';
  end if;
end $$;

-- 3) lead_delivery_logs optional audit columns ---------------------------------
alter table public.lead_delivery_logs
  add column if not exists failure_reason text,
  add column if not exists credit_log_id uuid null;
