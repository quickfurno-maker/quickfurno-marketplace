-- ============================================================================
-- QuickFurno — Phase 1: Preferred-vendor enquiry routing (ADDITIVE ONLY)
--
-- When a client clicks a specific paid/trial vendor CTA, the lead is routed
-- FIRST to that single selected vendor. This migration is fully additive:
--   * add-column-if-not-exists only (no drops, no destructive alters)
--   * a new atomic RPC that assigns ONLY the chosen vendor and deducts exactly
--     one credit, reusing the existing deduct_vendor_credit / restore_vendor_credit
--     primitives (base migration 20260620000003_functions.sql).
--
-- Phase 1 rules honoured here:
--   * assign to the preferred vendor only — NO fan-out to other vendors
--   * one credit deducted from the preferred vendor
--   * no credits / not eligible → NO assignment row is created, so the vendor
--     never sees the client contact; the lead is marked for admin follow-up
--   * WhatsApp stays preview/log only (handled in the service layer, not here)
--
-- Columns are OPTIONAL context for admin/audit. The application layer writes them
-- best-effort and degrades gracefully if this migration has not been applied yet.
-- Several of these (preferred_vendor_id / preferred_vendor_status) may already
-- exist from 20260701000033; add-if-not-exists makes this safe to run either way.
-- ============================================================================

alter table public.leads
  add column if not exists lead_intent text,
  add column if not exists target_vendor_id uuid,
  add column if not exists target_vendor_name text,
  add column if not exists target_vendor_category text,
  add column if not exists target_vendor_subcategory text,
  add column if not exists preferred_vendor_id uuid,
  add column if not exists preferred_vendor_status text,
  add column if not exists preferred_vendor_status_reason text,
  add column if not exists preferred_vendor_checked_at timestamptz,
  add column if not exists fallback_allowed boolean default true;

comment on column public.leads.lead_intent is
  'How the lead was routed: general_auto_match (default) or preferred_vendor (Phase 1 single-vendor routing).';
comment on column public.leads.target_vendor_id is
  'The specific vendor the client picked from a vendor card/profile CTA (preferred_vendor intent).';
comment on column public.leads.preferred_vendor_status is
  'Outcome of preferred-vendor routing: assigned_immediately | preferred_vendor_no_credits | preferred_vendor_not_eligible | preferred_vendor_pending.';
comment on column public.leads.fallback_allowed is
  'Reserved for Phase 2 delayed remaining-slot fill. Not acted on in Phase 1.';

-- ----------------------------------------------------------------------------
-- Atomic single preferred-vendor assignment.
--   * client explicitly chose this vendor, so there is NO category/area gate
--     (city already matches — the CTA prefills the vendor's own city)
--   * commercial gate: vendor Approved + active + remaining_credits > 0
--   * exactly one credit is deducted via the tested deduct_vendor_credit()
--   * exactly one lead_assignments row is created (assignment_type client_selected)
--   * NEVER assigns any other vendor (Phase 1)
-- Returns a jsonb status the service maps to the client-facing message.
-- ----------------------------------------------------------------------------
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

  -- Commercial gate only (no category/area — the client explicitly picked this vendor).
  if v_vendor.status <> 'Approved' or coalesce(v_vendor.is_active, false) is not true then
    return jsonb_build_object('status', 'preferred_vendor_not_eligible', 'assigned', false,
      'reason', 'vendor_not_active_or_approved', 'vendor_id', p_vendor_id);
  end if;

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
