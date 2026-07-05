-- ============================================================================
-- QuickFurno — 20260706000145_package_purchase_idempotent_grant.sql
-- Phase 4 (credit-wallet): route the paid-package credit grant through the
-- canonical idempotent primitive. GENERATED FOR REVIEW — DO NOT AUTO-APPLY.
--
-- `assign_package_to_vendor` is the existing DB-level paid-package handler (it
-- requires a payments row = 'Paid'). Previously it granted credits via
-- increment_vendor_credits with NO idempotency reference, so a replayed payment
-- confirmation could grant twice. This wires the grant through
-- qf_apply_vendor_credit_delta with reference (package_purchase, payment id) so a
-- repeated confirmation grants credits exactly once (`already_applied`).
--
-- Also fixes the row-duplication concern: an idempotency guard checks the prior
-- (package_purchase, payment id) ledger reference BEFORE inserting vendor_packages,
-- so a replayed payment confirmation neither double-grants credits NOR creates a
-- duplicate vendor_packages row. The whole function is one transaction and the
-- payment row is locked FOR UPDATE, so concurrent replays serialize safely.
-- ============================================================================
create or replace function public.assign_package_to_vendor(
  p_vendor_id  uuid,
  p_package_id uuid,
  p_payment_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pkg public.packages%rowtype;
  v_pay public.payments%rowtype;
  v_vp  uuid;
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_pay.payment_status <> 'Paid' then raise exception 'PAYMENT_NOT_PAID' using errcode = 'P0001'; end if;

  select * into v_pkg from public.packages where id = p_package_id;
  if not found then raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0002'; end if;

  -- IDEMPOTENCY: if this payment's package_purchase was already applied, return
  -- WITHOUT inserting another vendor_packages row or granting credits again. The
  -- payment row is locked (FOR UPDATE above), so concurrent same-payment calls
  -- serialize here — the second observes the first's ledger row and short-circuits.
  if exists (
    select 1 from public.vendor_credit_logs
    where reference_type = 'package_purchase' and reference_id = p_payment_id::text
  ) then
    return jsonb_build_object('status', 'already_applied', 'vendor_id', p_vendor_id, 'payment_id', p_payment_id, 'credits_added', 0);
  end if;

  insert into public.vendor_packages
    (vendor_id, package_id, expiry_date, total_leads, remaining_leads, price_paid, payment_status, status)
  values
    (p_vendor_id, p_package_id, now() + (v_pkg.validity_days || ' days')::interval,
     v_pkg.lead_count, v_pkg.lead_count, coalesce(v_pay.amount, v_pkg.total_price), 'Paid', 'Active')
  returning id into v_vp;

  -- PHASE 4: idempotent credit grant through the canonical wallet primitive.
  -- Reference = (package_purchase, payment id) → a replayed confirmation grants once.
  perform public.qf_apply_vendor_credit_delta(
    p_vendor_id, v_pkg.lead_count, 'package_purchase',
    format('Package purchase: %s', coalesce(v_pkg.name, '')),
    'package_purchase', p_payment_id::text, 'assign_package_to_vendor', false
  );
  perform public.update_vendor_visibility(p_vendor_id);

  return jsonb_build_object('status', 'ok', 'vendor_package_id', v_vp, 'credits_added', v_pkg.lead_count);
end; $$;

grant execute on function public.assign_package_to_vendor(uuid, uuid, uuid) to service_role;

-- Reverse (review only): re-apply the 20260620000003_functions.sql definition
-- (which used increment_vendor_credits).
