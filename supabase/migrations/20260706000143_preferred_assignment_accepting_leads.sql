-- ============================================================================
-- QuickFurno — 20260706000143_preferred_assignment_accepting_leads.sql
-- Phase 4 (credit-wallet): align the CLIENT-SELECTED (preferred) assignment RPC
-- with the availability rule. GENERATED FOR REVIEW — DO NOT AUTO-APPLY.
--
-- Changes vs 20260702000037: (1) add an `accepting_leads` gate (default true when
-- null); (2) PHASE 4 credit-wallet debit — replace deduct_vendor_credit with an
-- atomic conditional decrement + a MANDATORY assignment-correlated vendor_credit_logs
-- row (change_type=lead_assignment_debit, reference_type=lead_assignment,
-- reference_id=assignment id). A ledger failure rolls back the debit + assignment.
-- The preferred path still ignores package_status/paid_status/public_visibility for
-- a client-picked vendor. Signature, already-assigned replay (no 2nd debit / no 2nd
-- ledger row), and the response contract are PRESERVED.
-- ============================================================================
create or replace function public.assign_lead_to_preferred_vendor(
  p_lead_id   uuid,
  p_vendor_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_lead          public.leads%rowtype;
  v_vendor        public.vendors%rowtype;
  v_assignment_id uuid;
  v_before        int;
  v_after         int;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    return jsonb_build_object('status', 'lead_not_found', 'assigned', false);
  end if;

  if coalesce(v_lead.is_duplicate, false) then
    return jsonb_build_object('status', 'preferred_vendor_pending', 'assigned', false,
      'reason', 'duplicate_lead', 'vendor_id', p_vendor_id);
  end if;

  select * into v_vendor from public.vendors where id = p_vendor_id for update;
  if not found then
    return jsonb_build_object('status', 'preferred_vendor_not_found', 'assigned', false);
  end if;

  -- Idempotent replay: this exact vendor already on the lead → success, no 2nd debit.
  select id into v_assignment_id
  from public.lead_assignments
  where lead_id = p_lead_id and vendor_id = p_vendor_id
  limit 1;
  if v_assignment_id is not null then
    return jsonb_build_object('status', 'already_assigned', 'assigned', true,
      'assignment_id', v_assignment_id, 'vendor_id', p_vendor_id);
  end if;

  -- ── Direct commercial gate (client-picked): NO package/paid/public_visibility. ──
  -- Authoritative trust = vendors.status normalized to approved/active. Phase 4
  -- REMOVES verification_status as an eligibility gate (it stays audit/display only)
  -- so the automatic and preferred paths agree: many Approved vendors carry
  -- verification_status='Pending', and that must NOT block a client-picked assignment.
  if lower(coalesce(v_vendor.status, '')) not in ('approved', 'active') then
    return jsonb_build_object('status', 'preferred_vendor_not_eligible', 'assigned', false,
      'reason', 'vendor_not_approved_or_active', 'vendor_id', p_vendor_id);
  end if;

  if coalesce(v_vendor.is_active, true) is not true then
    return jsonb_build_object('status', 'preferred_vendor_not_eligible', 'assigned', false,
      'reason', 'vendor_inactive', 'vendor_id', p_vendor_id);
  end if;

  -- PHASE 4: accepting_leads (temporary availability). Default true when null.
  if coalesce(v_vendor.accepting_leads, true) is not true then
    return jsonb_build_object('status', 'preferred_vendor_not_eligible', 'assigned', false,
      'reason', 'not_accepting_leads', 'vendor_id', p_vendor_id);
  end if;

  v_before := coalesce(v_vendor.remaining_credits, 0);
  if v_before < 1 then
    return jsonb_build_object('status', 'preferred_vendor_no_credits', 'assigned', false,
      'vendor_id', p_vendor_id, 'credits_before', v_before);
  end if;

  -- PHASE 4 credit-wallet debit: atomic conditional decrement (NO deduct_vendor_credit,
  -- NO package burn-down). The vendor row is already locked (FOR UPDATE above).
  update public.vendors
  set remaining_credits = remaining_credits - 1,
      last_assigned_at = now()
  where id = p_vendor_id and remaining_credits >= 1
  returning remaining_credits into v_after;
  if v_after is null then
    return jsonb_build_object('status', 'preferred_vendor_no_credits', 'assigned', false,
      'vendor_id', p_vendor_id, 'credits_before', v_before);
  end if;

  begin
    insert into public.lead_assignments (lead_id, vendor_id, assignment_type, credit_deducted)
    values (p_lead_id, p_vendor_id, 'client_selected', true)
    returning id into v_assignment_id;
  exception when unique_violation then
    -- Race before the ledger row: restore the credit we just debited, no ledger written.
    update public.vendors set remaining_credits = remaining_credits + 1 where id = p_vendor_id;
    return jsonb_build_object('status', 'already_assigned', 'assigned', true, 'vendor_id', p_vendor_id);
  end;

  -- MANDATORY ledger (no catch): a failure rolls back the debit + assignment.
  insert into public.vendor_credit_logs (
    vendor_id, change_type, credits_before, credits_delta, credits_after,
    reason, updated_by, reference_type, reference_id
  ) values (
    p_vendor_id, 'lead_assignment_debit', v_before, -1, v_after,
    'Preferred/client-selected lead assignment', 'phase4_credit_wallet_preferred',
    'lead_assignment', v_assignment_id::text
  );

  update public.leads set status = 'Assigned' where id = p_lead_id;

  return jsonb_build_object(
    'status',         'assigned_to_preferred_vendor',
    'assigned',       true,
    'assignment_id',  v_assignment_id,
    'vendor_id',      p_vendor_id,
    'credits_before', v_before,
    'credits_after',  v_after
  );
end; $$;

grant execute on function public.assign_lead_to_preferred_vendor(uuid, uuid) to service_role;

-- Reverse (review only): re-apply 20260702000037_fix_preferred_vendor_credit_direct_assignment.sql.
