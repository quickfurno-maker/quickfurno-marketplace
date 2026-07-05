-- ============================================================================
-- QuickFurno — PHASE4_HISTORICAL_CREDIT_AUDIT.sql
-- READ-ONLY audit for the pre-Phase-4 credit history. GENERATED FOR REVIEW.
--
-- The live preflight found ~27 charged assignments and ~16 negative credit-log
-- rows. The OLD ledger has NO assignment reference, so historical debit↔assignment
-- correlation is NOT deterministic. DO NOT BACKFILL. These are SELECT-only audit
-- queries (no INSERT/UPDATE/DELETE, no mutation). Phase 4's guarantee is
-- forward-only: all NEW assignment debits are ledger-correlated and mandatory.
-- ============================================================================

-- 1) Charged assignments (credit_deducted = true) that have NO deterministically
--    correlated ledger row. Pre-Phase-4 rows have reference_id IS NULL, so this is
--    an OBSERVATION, not a repair target.
select la.id as assignment_id, la.lead_id, la.vendor_id, la.assignment_type, la.assigned_at
from public.lead_assignments la
where coalesce(la.credit_deducted, false) = true
  and not exists (
    select 1 from public.vendor_credit_logs vcl
    where vcl.reference_type = 'lead_assignment'
      and vcl.reference_id = la.id::text
  )
order by la.assigned_at desc;

-- 2) Count of legacy debit ledger rows (negative delta) with no reference — the
--    historical rows that cannot be deterministically tied to an assignment.
select count(*) as legacy_unreferenced_negative_ledger_rows
from public.vendor_credit_logs
where credits_delta < 0
  and reference_id is null;

-- 3) Vendors currently at a negative wallet balance (should be none post-Phase-4;
--    surfaced for manual review, NOT auto-corrected).
select id as vendor_id, business_name, remaining_credits, total_credits
from public.vendors
where coalesce(remaining_credits, 0) < 0
order by remaining_credits asc;

-- 4) Post-Phase-4 forward check: NEW assignment debits MUST be ledger-correlated.
--    After the credit-wallet RPC (20260706000142) is live, this should return zero
--    rows for assignments created after cutover.
select la.id as assignment_id, la.assigned_at
from public.lead_assignments la
where la.assignment_type = 'auto_assigned'
  and la.assigned_at > timestamptz '2026-07-06 00:00:00+00'   -- set to actual cutover
  and coalesce(la.credit_deducted, false) = true
  and not exists (
    select 1 from public.vendor_credit_logs vcl
    where vcl.reference_type = 'lead_assignment' and vcl.reference_id = la.id::text
  )
order by la.assigned_at desc;

-- 5) Ledger change_type distribution (verify canonical + legacy coexistence).
select change_type, count(*) as rows, sum(credits_delta) as net_delta
from public.vendor_credit_logs
group by change_type
order by rows desc;
