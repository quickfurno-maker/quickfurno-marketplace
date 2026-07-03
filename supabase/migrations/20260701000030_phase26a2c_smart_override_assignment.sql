-- ============================================================================
-- QuickFurno — 20260701000030_phase26a2c_smart_override_assignment.sql
-- Phase 26A-2C: admin "Assign Anyway" smart override.
--
-- WHY A DEDICATED FUNCTION: the existing assign_lead_to_vendors /
-- assign_lead_to_paid_vendors_phase26a RPCs HARD-filter on exact category and
-- area, so they structurally cannot assign a synonym/subcategory-related
-- vendor — which is the whole point of smart override. This function relaxes
-- ONLY those soft checks. It does NOT invent new credit logic: it reuses the
-- exact same atomic primitives (deduct_vendor_credit / restore_vendor_credit)
-- the legacy RPC uses, so there is no double-deduct and no new credit math.
--
-- Marketplace safety is still enforced HARD in SQL (defense in depth):
--   approved + active + active package + credits > 0 + same city
--   + not already assigned to this vendor + lead not already at max vendors.
-- Category / sub-city area are intentionally NOT enforced here (the override).
-- No WhatsApp, no live sends — preview logs are written by the TS service.
-- Idempotent. Safe to re-run.
-- ============================================================================

-- Audit marker on delivery logs so the admin audit can show manual_smart_override.
alter table public.lead_delivery_logs
  add column if not exists assignment_source text;

create or replace function public.admin_smart_assign_lead_to_vendors(
  p_lead_id         uuid,
  p_vendor_ids      uuid[] default '{}',
  p_allow_duplicate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead     public.leads%rowtype;
  v_max      int;
  v_existing int;
  v_slots    int;
  v_vendor   uuid;
  v_row      public.vendors%rowtype;
  v_has_active_package boolean;
  v_ok       boolean;
  v_assigned uuid[] := '{}';
  v_skipped  uuid[] := '{}';
begin
  v_max := least(public.get_setting_int('max_vendors_per_lead', 3), 3);

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- hard: unapproved duplicate lead
  if coalesce(v_lead.is_duplicate, false) and not p_allow_duplicate then
    raise exception 'DUPLICATE_LEAD' using errcode = 'P0001';
  end if;

  -- hard: lead already has the maximum number of vendors
  select count(*) into v_existing from public.lead_assignments where lead_id = p_lead_id;
  if v_existing >= v_max then
    raise exception 'LEAD_ALREADY_ASSIGNED' using errcode = 'P0001';
  end if;

  v_slots := v_max - v_existing;

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

    -- HARD marketplace safety (never bypassed by override). Category + area are
    -- intentionally omitted; city is kept hard.
    if v_row.status <> 'Approved'
      or coalesce(v_row.is_active, false) is not true
      or coalesce(v_row.remaining_credits, 0) <= 0
      or not v_has_active_package
      or v_row.city is distinct from v_lead.city
    then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    -- hard: already assigned to this lead
    if exists (select 1 from public.lead_assignments where lead_id = p_lead_id and vendor_id = v_vendor) then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    -- reuse the existing atomic credit primitive (no new credit logic)
    v_ok := public.deduct_vendor_credit(v_vendor);
    if not v_ok then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    begin
      insert into public.lead_assignments (lead_id, vendor_id, assignment_type, credit_deducted)
      values (p_lead_id, v_vendor, 'admin_assigned', true);
    exception when unique_violation then
      perform public.restore_vendor_credit(v_vendor);   -- undo the deduction we just made
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

grant execute on function public.admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean) to service_role;
