-- Finance V2 PAY-1 candidate: additive, uninstalled, DBA/AppSec review required.
-- No deployment/financial write by this source artifact.
-- Preserves old Razorpay captured-payment RPC and vendor credit ledger.
begin;

-- A manual bank UTR is not a Razorpay provider_payment_id. The legacy
-- application currently allows duplicate external UTRs under distinct UUIDs.
-- Conservative global normalized UTR uniqueness until approved bank account
-- identifiers allow narrower, evidence-based scoping. Existing collisions
-- FAIL migration rather than silently deduplicating financial history.
create unique index if not exists uq_finance_v2_manual_utr_normalized
on public.payments ((upper(btrim(transaction_id))))
where transaction_id is not null
  and nullif(btrim(transaction_id),'') is not null
  and lower(coalesce(payment_method,'')) <> 'razorpay';

-- Existing Razorpay payments.id == vendor_package_orders.id. The stored
-- provider_mode lives in the order and must determine TEST/LIVE treatment.
-- A server-only view computes ALL rows without relying on limited API pages.
-- 'Paid' alone does not prove a bank deposit or recognized taxable revenue.
create or replace view public.qf_finance_v2_collection_summary_v
with (security_invoker=true) as
select
  count(*) filter (where p.payment_status='Paid')::bigint as recorded_paid_count,
  coalesce(sum(
    case when p.payment_status='Paid'
      and lower(p.payment_method)='razorpay'
      and o.payment_provider='razorpay'
      and o.provider_mode='live'
      and o.provider_status='captured'
      and o.activation_status='activated'
      then p.amount else 0::numeric end
  ),0::numeric) as razorpay_live_captured_inr,
  coalesce(sum(
    case when p.payment_status='Paid'
      and lower(p.payment_method)='razorpay'
      and o.payment_provider='razorpay'
      and o.provider_mode='live'
      and o.provider_status='captured'
      and o.activation_status='activated'
      and o.paid_at >= (date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
      then p.amount else 0::numeric end
  ),0::numeric) as razorpay_live_captured_this_month_inr,
  coalesce(sum(
    case when p.payment_status='Paid'
      and lower(p.payment_method)='razorpay'
      and o.provider_mode='test'
      then p.amount else 0::numeric end
  ),0::numeric) as razorpay_test_excluded_inr,
  coalesce(sum(
    case when p.payment_status='Paid'
      and lower(coalesce(p.payment_method,''))<>'razorpay'
      then p.amount else 0::numeric end
  ),0::numeric) as manual_recorded_unreconciled_inr,
  count(*) filter (
    where p.payment_status='Paid'
      and lower(p.payment_method)='razorpay'
      and (o.id is null or o.provider_mode is null
        or o.provider_mode not in ('live','test')
        or o.provider_status is distinct from 'captured')
  )::bigint as razorpay_unclassified_paid_count
from public.payments p
left join public.vendor_package_orders o on o.id=p.id;

revoke all on public.qf_finance_v2_collection_summary_v from public,anon,authenticated;
grant select on public.qf_finance_v2_collection_summary_v to service_role;

-- Do not make an existing monetary row deletable merely by hard-deleting
-- a vendor. Replacing legacy ON DELETE CASCADE with RESTRICT is explicitly
-- RESERVED for a reviewed retention migration, not hidden in PAY-1.

comment on view public.qf_finance_v2_collection_summary_v is
'PAY-1 source-only finance collection projection. Razorpay TEST excluded; manual paid NOT bank reconciled; values are collections, not accounting revenue.';

commit;
