-- ============================================================================
-- QuickFurno — 20260701000031_phase26a2c_recovery_fallback_reporting.sql
-- Phase 26A-2C part 2: manual recovery limit, interior fallback, structured
-- vendor lead reporting. Additive + idempotent. No destructive DDL/DML on data,
-- no credit-logic changes, no automatic refunds.
--   1) admin_smart_assign_lead_to_vendors gains a total-limit parameter so
--      admin manual mode can top-up and recovery-assign up to 9 vendors
--      (clamped hard at 9). Still reuses deduct_vendor_credit /
--      restore_vendor_credit — no new credit math. Auto matching is untouched.
--   2) lead_assignments.vendor_status: broaden CHECK to add Follow-up Needed +
--      Converted while keeping every legacy value valid.
--   3) bad_lead_reports: add reason_code + reason_label for structured reports.
--   4) one-active-report-per-assignment guard (skipped safely if dupes exist).
-- ============================================================================

-- 1) recovery-capable smart override RPC -------------------------------------
drop function if exists public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean);

create or replace function public.admin_smart_assign_lead_to_vendors(
  p_lead_id         uuid,
  p_vendor_ids      uuid[] default '{}',
  p_allow_duplicate boolean default false,
  p_total_limit     int default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead     public.leads%rowtype;
  v_limit    int;
  v_existing int;
  v_slots    int;
  v_vendor   uuid;
  v_row      public.vendors%rowtype;
  v_has_active_package boolean;
  v_ok       boolean;
  v_assigned uuid[] := '{}';
  v_skipped  uuid[] := '{}';
begin
  -- Hard cap: manual assignment may never exceed 9 vendors for a lead.
  v_limit := least(greatest(coalesce(p_total_limit, 3), 1), 9);

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;

  if coalesce(v_lead.is_duplicate, false) and not p_allow_duplicate then
    raise exception 'DUPLICATE_LEAD' using errcode = 'P0001';
  end if;

  select count(*) into v_existing from public.lead_assignments where lead_id = p_lead_id;
  if v_existing >= v_limit then
    raise exception 'LEAD_ALREADY_ASSIGNED' using errcode = 'P0001';
  end if;

  v_slots := v_limit - v_existing;

  for v_vendor in
    select vendor_id
    from (
      select distinct on (item.vendor_id) item.vendor_id, item.ordinality
      from unnest(coalesce(p_vendor_ids, '{}')) with ordinality as item(vendor_id, ordinality)
      where item.vendor_id is not null
      order by item.vendor_id, item.ordinality
    ) deduped
    order by ordinality
    limit v_slots
  loop
    select * into v_row from public.vendors where id = v_vendor for update;
    if not found then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    select exists (
      select 1 from public.vendor_packages vp
      where vp.vendor_id = v_vendor
        and lower(coalesce(vp.status, '')) in ('active', 'trial')
        and coalesce(vp.remaining_leads, 0) > 0
        and (vp.expiry_date is null or vp.expiry_date > now())
    ) into v_has_active_package;

    v_has_active_package := v_has_active_package
      or lower(coalesce(v_row.package_status, '')) in ('active', 'trial')
      or lower(coalesce(v_row.paid_status, '')) in ('paid', 'trial', 'active', 'premium', 'priority');

    -- HARD marketplace safety (never bypassed). Category + sub-city area are
    -- intentionally omitted (admin override); city stays hard.
    if v_row.status <> 'Approved'
      or coalesce(v_row.is_active, false) is not true
      or coalesce(v_row.remaining_credits, 0) <= 0
      or not v_has_active_package
      or v_row.city is distinct from v_lead.city
    then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    if exists (select 1 from public.lead_assignments where lead_id = p_lead_id and vendor_id = v_vendor) then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    v_ok := public.deduct_vendor_credit(v_vendor);   -- reuse existing primitive
    if not v_ok then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    begin
      insert into public.lead_assignments (lead_id, vendor_id, assignment_type, credit_deducted)
      values (p_lead_id, v_vendor, 'admin_assigned', true);
    exception when unique_violation then
      perform public.restore_vendor_credit(v_vendor);
      v_skipped := v_skipped || v_vendor;
      continue;
    end;

    update public.vendors set last_assigned_at = now() where id = v_vendor;
    v_assigned := v_assigned || v_vendor;
  end loop;

  if coalesce(array_length(v_assigned, 1), 0) > 0 then
    update public.leads set status = 'Assigned' where id = p_lead_id;
  end if;

  return jsonb_build_object(
    'status', case when coalesce(array_length(v_assigned, 1), 0) > 0 then 'ok' else 'no_eligible_vendors' end,
    'lead_id', p_lead_id,
    'assigned', to_jsonb(v_assigned),
    'skipped', to_jsonb(v_skipped),
    'assigned_count', coalesce(array_length(v_assigned, 1), 0)
  );
end;
$$;

grant execute on function public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, int) to service_role;

-- 2) broaden vendor_status CHECK (keep legacy values valid) -------------------
alter table public.lead_assignments drop constraint if exists lead_assignments_vendor_status_check;
alter table public.lead_assignments
  add constraint lead_assignments_vendor_status_check check (
    vendor_status is null or vendor_status in (
      'New', 'Contacted', 'Follow-up Needed', 'Site Visit Scheduled',
      'Quotation Sent', 'Converted', 'Won', 'Lost'
    )
  );

-- 3) structured report fields -------------------------------------------------
alter table public.bad_lead_reports
  add column if not exists reason_code text,
  add column if not exists reason_label text;

-- 4) one active report per assignment (guarded: skip if dupes already exist) --
do $$
begin
  begin
    create unique index if not exists uq_bad_lead_reports_active_assignment
      on public.bad_lead_reports (lead_assignment_id)
      where status in ('Pending', 'Under Review');
  exception when unique_violation or others then
    raise notice 'Skipped uq_bad_lead_reports_active_assignment (existing duplicates or incompatible data); service-layer guard will prevent new duplicates.';
  end;
end $$;
