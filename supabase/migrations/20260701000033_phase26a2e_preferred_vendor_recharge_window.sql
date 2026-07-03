-- ============================================================================
-- QuickFurno — 20260701000033_phase26a2e_preferred_vendor_recharge_window.sql
-- Phase 26A-2E: vendor-profile direct enquiry, preferred-vendor 1-hour recharge
-- window, and 1-hour fallback assignment.
--
-- For a CLIENT-SELECTED vendor (from a vendor profile), an active package is NOT
-- a hard requirement — credit balance is the paid-access signal. So this adds a
-- dedicated assign RPC that keeps Approved + active + credits + city HARD but
-- drops the active-package requirement. It still reuses deduct_vendor_credit /
-- restore_vendor_credit — no new credit math, never exceeds 9.
--
-- Additive + idempotent. No destructive DDL/DML on data.
--   1) preferred_vendor_* columns on client_requirement_groups + leads.
--   2) assign_client_selected_vendor_to_group(...) — credit-based selected-vendor
--      assignment used for immediate + post-recharge assignment.
-- ============================================================================

-- 1) preferred-vendor tracking (additive) ------------------------------------
alter table public.client_requirement_groups
  add column if not exists preferred_vendor_id uuid,
  add column if not exists preferred_vendor_name text,
  add column if not exists preferred_vendor_status text,
  add column if not exists preferred_vendor_status_reason text,
  add column if not exists preferred_vendor_recharge_deadline_at timestamptz,
  add column if not exists preferred_vendor_processed_at timestamptz;

alter table public.leads
  add column if not exists preferred_vendor_id uuid,
  add column if not exists preferred_vendor_status text,
  add column if not exists preferred_vendor_status_reason text;

create index if not exists idx_crg_preferred_recharge
  on public.client_requirement_groups (preferred_vendor_status, preferred_vendor_recharge_deadline_at);

-- 2) credit-based client-selected assignment (package NOT required) -----------
-- Mirrors assign_vendor_to_requirement_group but drops the active-package HARD
-- requirement: for a vendor the client explicitly chose, remaining_credits > 0
-- IS the paid-access signal. Approved + active + credits + city stay HARD; the
-- group cap + duplicate protection stay; credits still move only through the
-- existing deduct/restore primitives.
create or replace function public.assign_client_selected_vendor_to_group(
  p_group_id    uuid,
  p_lead_id     uuid,
  p_vendor_id   uuid,
  p_total_limit int default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead     public.leads%rowtype;
  v_row      public.vendors%rowtype;
  v_limit    int;
  v_existing int;
  v_ok       boolean;
begin
  v_limit := least(greatest(coalesce(p_total_limit, 3), 1), 9);

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform 1 from public.client_requirement_groups where id = p_group_id for update;
  if not found then
    raise exception 'REQUIREMENT_GROUP_NOT_FOUND' using errcode = 'P0002';
  end if;

  select count(distinct vendor_id) into v_existing
  from public.lead_assignments where requirement_group_id = p_group_id;
  if v_existing >= v_limit then
    return jsonb_build_object('status', 'group_full', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id, 'assigned_count', v_existing);
  end if;

  select * into v_row from public.vendors where id = p_vendor_id for update;
  if not found then
    return jsonb_build_object('status', 'vendor_not_found', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  -- HARD safety for a client-selected vendor. Credits > 0 is the paid signal;
  -- active-package is intentionally NOT required here.
  if v_row.status <> 'Approved'
    or coalesce(v_row.is_active, false) is not true
    or coalesce(v_row.remaining_credits, 0) <= 0
    or v_row.city is distinct from v_lead.city
  then
    return jsonb_build_object('status', 'vendor_not_eligible', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  if exists (
    select 1 from public.lead_assignments
    where requirement_group_id = p_group_id and vendor_id = p_vendor_id
  ) then
    return jsonb_build_object('status', 'already_in_group', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  if exists (
    select 1 from public.lead_assignments where lead_id = p_lead_id and vendor_id = p_vendor_id
  ) then
    return jsonb_build_object('status', 'already_assigned_to_lead', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  v_ok := public.deduct_vendor_credit(p_vendor_id);   -- reuse existing primitive
  if not v_ok then
    return jsonb_build_object('status', 'credit_deduction_failed', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end if;

  begin
    insert into public.lead_assignments (
      lead_id, vendor_id, assignment_type, credit_deducted,
      requirement_group_id, assignment_source, assignment_metadata
    ) values (
      p_lead_id, p_vendor_id, 'client_selected', true,
      p_group_id, 'client_selected_vendor', jsonb_build_object('source', 'client_selected_vendor')
    );
  exception when unique_violation then
    perform public.restore_vendor_credit(p_vendor_id);
    return jsonb_build_object('status', 'duplicate_on_insert', 'assigned', false,
      'vendor_id', p_vendor_id, 'group_id', p_group_id);
  end;

  update public.vendors set last_assigned_at = now() where id = p_vendor_id;
  update public.leads set status = 'Assigned' where id = p_lead_id;

  perform public.refresh_requirement_group_counters(p_group_id);

  return jsonb_build_object('status', 'ok', 'assigned', true,
    'vendor_id', p_vendor_id, 'group_id', p_group_id, 'assigned_count', v_existing + 1);
end;
$$;

grant execute on function public.assign_client_selected_vendor_to_group(uuid, uuid, uuid, int) to service_role;
