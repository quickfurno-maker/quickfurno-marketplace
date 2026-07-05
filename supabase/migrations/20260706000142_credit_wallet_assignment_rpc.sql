-- ============================================================================
-- QuickFurno — 20260706000142_credit_wallet_assignment_rpc.sql
-- Phase 4 (credit-wallet): align the automatic assignment RPC with the canonical
-- eligibility contract and make it FILL UNTIL 3 SUCCESSFUL from a ranked pool.
--
-- ADDITIVE (create-or-replace). GENERATED FOR REVIEW — DO NOT AUTO-APPLY.
-- Requires 20260706000140 (accepting_leads) and 20260706000141 (ledger reference)
-- applied first. Reuses the existing qf_* category/text helpers unchanged.
--
-- CHANGES vs 20260705000130:
--   • ELIGIBILITY: approved/active + accepting_leads + remaining_credits >= cost.
--     REMOVED the package/paid_status gate (v_has_active_package) entirely.
--   • FILL-UNTIL-3: iterate the WHOLE deduped ranked pool (no `limit 3` on
--     candidates) and stop after v_max SUCCESSFUL assignments — so a candidate that
--     loses its last credit concurrently is skipped and the next one fills the slot.
--   • DEBIT: credit wallet only (LEAD_CREDIT_COST = 1). No vendor_packages
--     decrement (packages are purchase-history only in the wallet model).
--   • LEDGER: MANDATORY (no catch) debit row with change_type='lead_assignment_debit',
--     reference_type='lead_assignment', reference_id=assignment id. A ledger failure
--     rolls back the debit + assignment (closes the Phase 3A accounting gap AND the
--     preflight "swallowed check_violation" gap).
-- UNCHANGED SAFETY: lead FOR UPDATE lock, duplicate/idempotency short-circuits,
--   vendor FOR UPDATE lock, conditional credit decrement, unique(lead,vendor)
--   rollback, max-3 cap, ranking/order preserved (input order = JS ranking).
-- ============================================================================
create or replace function public.assign_lead_to_paid_vendors_phase26a(
  p_lead_id uuid,
  p_vendor_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_lead public.leads%rowtype;
  v_max int;
  v_credit_cost int := 1; -- LEAD_CREDIT_COST (mirror of lib/vendors/vendorEligibility.ts)
  v_vendor uuid;
  v_row public.vendors%rowtype;
  v_assignment_id uuid;
  v_before int;
  v_after int;
  v_category_ok boolean;
  v_assigned jsonb := '[]'::jsonb;
  v_assigned_ids uuid[] := '{}';
  v_skipped uuid[] := '{}';
begin
  -- MAX 3 SUCCESSFUL, never exceeded (respects configured setting, capped at 3).
  v_max := least(public.get_setting_int('max_vendors_per_lead', 3), 3);

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;

  if coalesce(v_lead.is_duplicate, false) then
    return jsonb_build_object('status','skipped_duplicate','lead_id',p_lead_id,'assigned','[]'::jsonb,'skipped','[]'::jsonb,'assigned_count',0);
  end if;

  -- Idempotency: if this lead already has assignments, return them unchanged.
  if exists (select 1 from public.lead_assignments where lead_id = p_lead_id) then
    select coalesce(jsonb_agg(jsonb_build_object('vendor_id', vendor_id, 'assignment_id', id)), '[]'::jsonb)
      into v_assigned from public.lead_assignments where lead_id = p_lead_id;
    select coalesce(array_agg(vendor_id), '{}') into v_assigned_ids from public.lead_assignments where lead_id = p_lead_id;
    return jsonb_build_object('status','already_assigned','lead_id',p_lead_id,'assigned',v_assigned,'skipped','[]'::jsonb,'assigned_count',coalesce(array_length(v_assigned_ids,1),0));
  end if;

  -- Iterate the ENTIRE deduped ranked pool (input order = JS ranking), stopping
  -- after v_max SUCCESSFUL assignments — fill-until-3, not preselect-3.
  for v_vendor in
    select vendor_id
    from (
      select distinct on (item.vendor_id) item.vendor_id, item.ordinality
      from unnest(coalesce(p_vendor_ids, '{}')) with ordinality as item(vendor_id, ordinality)
      where item.vendor_id is not null
      order by item.vendor_id, item.ordinality
    ) deduped
    order by ordinality
  loop
    exit when coalesce(array_length(v_assigned_ids, 1), 0) >= v_max;

    select * into v_row from public.vendors where id = v_vendor for update;
    if not found then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    -- ONE shared parent-group category contract (mirrors the JS matcher).
    v_category_ok := public.qf_lead_vendor_parent_group_compatible(
      v_lead.service_required, v_lead.category, v_lead.subcategory,
      v_row.service_categories, v_row.selected_category, v_row.selected_subcategories
    );

    -- PHASE 4 CANONICAL GATE (identical to evaluateVendorAutomaticLeadEligibility):
    --   approved/active + is_active + accepting_leads + credits >= cost, plus the
    --   matcher's NORMALIZED city + category compatibility. NO package/paid_status.
    if lower(trim(coalesce(v_row.status, ''))) not in ('approved', 'active')
      or coalesce(v_row.is_active, false) is not true
      or coalesce(v_row.accepting_leads, true) is not true
      or coalesce(v_row.remaining_credits, 0) < v_credit_cost
      or public.qf_norm_text(coalesce(nullif(trim(v_row.city), ''), v_row.office_city))
           is distinct from public.qf_norm_text(v_lead.city)
      or not v_category_ok
    then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    v_before := coalesce(v_row.remaining_credits, 0);

    -- Conditional atomic debit — the guard makes two concurrent leads unable to
    -- both consume the same last credit.
    update public.vendors
    set remaining_credits = remaining_credits - v_credit_cost,
        last_assigned_at = now()
    where id = v_vendor and remaining_credits >= v_credit_cost
    returning remaining_credits into v_after;

    if v_after is null then
      v_skipped := v_skipped || v_vendor; -- lost its last credit concurrently
      continue;
    end if;

    begin
      insert into public.lead_assignments (lead_id, vendor_id, assignment_type, credit_deducted)
      values (p_lead_id, v_vendor, 'auto_assigned', true)
      returning id into v_assignment_id;
    exception when unique_violation then
      -- Duplicate assignment race — restore the credit; no ledger row was written.
      update public.vendors set remaining_credits = remaining_credits + v_credit_cost where id = v_vendor;
      v_skipped := v_skipped || v_vendor;
      continue;
    end;

    -- MANDATORY ledger debit, correlated to the assignment. NO catch: if this row
    -- cannot be written the ENTIRE transaction (credit decrement + assignment + lead
    -- status) rolls back. Canonical rule: NO SUCCESSFUL ASSIGNMENT DEBIT WITHOUT A
    -- SUCCESSFUL LEDGER ROW. (Requires 20260706000141 applied first: reference
    -- columns + the change_type constraint that allows 'lead_assignment_debit'.)
    insert into public.vendor_credit_logs (
      vendor_id, change_type, credits_before, credits_delta, credits_after,
      reason, updated_by, reference_type, reference_id
    ) values (
      v_vendor, 'lead_assignment_debit', v_before, -v_credit_cost, v_after,
      'Automatic lead assignment', 'phase4_credit_wallet_matching',
      'lead_assignment', v_assignment_id::text
    );

    v_assigned_ids := v_assigned_ids || v_vendor;
    v_assigned := v_assigned || jsonb_build_array(jsonb_build_object(
      'vendor_id', v_vendor, 'assignment_id', v_assignment_id, 'credits_before', v_before, 'credits_after', v_after
    ));
  end loop;

  if coalesce(array_length(v_assigned_ids, 1), 0) > 0 then
    update public.leads set status = 'Assigned' where id = p_lead_id;
  end if;

  return jsonb_build_object(
    'status', case when coalesce(array_length(v_assigned_ids,1),0) > 0 then 'ok' else 'no_eligible_vendors' end,
    'lead_id', p_lead_id, 'assigned', v_assigned, 'skipped', to_jsonb(v_skipped),
    'assigned_count', coalesce(array_length(v_assigned_ids,1),0)
  );
end;
$$;

-- Execute-privilege hardening (unchanged contract from 20260705000130).
revoke all on function public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[]) from public;
revoke all on function public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[]) from anon;
revoke all on function public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[]) from authenticated;
grant execute on function public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[]) to service_role;

-- Reverse (review only): re-apply 20260705000130_distance_category_matching_rpc.sql
-- to restore the package/paid_status gate + preselect-3 behavior.
