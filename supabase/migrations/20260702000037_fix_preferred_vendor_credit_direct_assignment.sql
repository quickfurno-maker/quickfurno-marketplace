-- ============================================================================
-- QuickFurno — 20260702000037_fix_preferred_vendor_credit_direct_assignment.sql
--
-- Fix: a client-picked (preferred) vendor with credits + approved/verified/active
-- was NOT being assigned. The previous RPC gated the status with a CASE-SENSITIVE
-- compare (status <> 'Approved'), so an 'approved'/'Active' vendor was wrongly
-- rejected. This replaces public.assign_lead_to_preferred_vendor with a DIRECT
-- commercial check that reflects the business rule: once the client has clicked a
-- specific vendor CTA, the assignment must succeed on the commercial essentials
-- alone.
--
-- Gate (and ONLY this gate):
--   * status:        lower(coalesce(status,'')) in ('approved','active')
--   * verification:  lower(coalesce(verification_status,'verified')) not in
--                    ('pending','rejected','unverified','not verified','failed','in review')
--   * active:        coalesce(is_active, true) is true
--   * credits:       coalesce(remaining_credits, 0) > 0
--
-- Deliberately NOT checked for a preferred/direct assignment:
--   * public_visibility  (controls PUBLIC listing, not a backend direct assign)
--   * package_status
--   * paid_status
--   * category / subcategory / city
--
-- Additive + idempotent: CREATE OR REPLACE only, reuses the existing atomic
-- deduct_vendor_credit / restore_vendor_credit primitives. No destructive DDL/DML.
-- WhatsApp / delivery previews stay in the service layer (preview/log only).
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
  v_ok            boolean;
begin
  -- Lock the lead (serialises concurrent routing attempts for the same lead).
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    return jsonb_build_object('status', 'lead_not_found', 'assigned', false);
  end if;

  -- Never assign an unapproved duplicate; keep it safe for admin review.
  if coalesce(v_lead.is_duplicate, false) then
    return jsonb_build_object('status', 'preferred_vendor_pending', 'assigned', false,
      'reason', 'duplicate_lead', 'vendor_id', p_vendor_id);
  end if;

  select * into v_vendor from public.vendors where id = p_vendor_id for update;
  if not found then
    return jsonb_build_object('status', 'preferred_vendor_not_found', 'assigned', false);
  end if;

  -- Idempotent: if this exact vendor is already on the lead, report success
  -- without deducting a second credit.
  select id into v_assignment_id
  from public.lead_assignments
  where lead_id = p_lead_id and vendor_id = p_vendor_id
  limit 1;
  if v_assignment_id is not null then
    return jsonb_build_object('status', 'already_assigned', 'assigned', true,
      'assignment_id', v_assignment_id, 'vendor_id', p_vendor_id);
  end if;

  -- ── Direct commercial gate ────────────────────────────────────────────────
  -- The client explicitly picked this vendor, so we do NOT gate on
  -- public_visibility, package_status, paid_status, or category/area.

  -- Status: case-insensitive approved/active.
  if lower(coalesce(v_vendor.status, '')) not in ('approved', 'active') then
    return jsonb_build_object('status', 'preferred_vendor_not_eligible', 'assigned', false,
      'reason', 'vendor_not_approved_or_active', 'vendor_id', p_vendor_id);
  end if;

  -- Verification: missing/blank is trusted as verified; only explicit bad states block.
  if lower(coalesce(v_vendor.verification_status, 'verified'))
     in ('pending', 'rejected', 'unverified', 'not verified', 'failed', 'in review') then
    return jsonb_build_object('status', 'preferred_vendor_not_eligible', 'assigned', false,
      'reason', 'vendor_not_verified', 'vendor_id', p_vendor_id);
  end if;

  -- Active: default true only when the flag is null.
  if coalesce(v_vendor.is_active, true) is not true then
    return jsonb_build_object('status', 'preferred_vendor_not_eligible', 'assigned', false,
      'reason', 'vendor_inactive', 'vendor_id', p_vendor_id);
  end if;

  -- Credits: must have at least one (no package/paid gate).
  v_before := coalesce(v_vendor.remaining_credits, 0);
  if v_before <= 0 then
    return jsonb_build_object('status', 'preferred_vendor_no_credits', 'assigned', false,
      'vendor_id', p_vendor_id, 'credits_before', v_before);
  end if;

  -- Deduct exactly one credit (atomic; also burns down the FIFO package).
  v_ok := public.deduct_vendor_credit(p_vendor_id);
  if not v_ok then
    return jsonb_build_object('status', 'preferred_vendor_no_credits', 'assigned', false,
      'vendor_id', p_vendor_id, 'credits_before', v_before);
  end if;

  begin
    insert into public.lead_assignments (lead_id, vendor_id, assignment_type, credit_deducted)
    values (p_lead_id, p_vendor_id, 'client_selected', true)
    returning id into v_assignment_id;
  exception when unique_violation then
    -- Lost the race to another writer — undo the deduction we just made.
    perform public.restore_vendor_credit(p_vendor_id);
    return jsonb_build_object('status', 'already_assigned', 'assigned', true, 'vendor_id', p_vendor_id);
  end;

  select remaining_credits into v_after from public.vendors where id = p_vendor_id;

  update public.vendors set last_assigned_at = now() where id = p_vendor_id;
  update public.leads   set status = 'Assigned' where id = p_lead_id;

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
