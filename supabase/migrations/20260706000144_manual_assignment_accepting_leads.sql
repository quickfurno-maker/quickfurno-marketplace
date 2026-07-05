-- ============================================================================
-- QuickFurno — 20260706000144_manual_assignment_accepting_leads.sql
-- Phase 4 (credit-wallet): align the ADMIN/MANUAL + client-selected hybrid
-- assignment RPC with the availability rule. GENERATED FOR REVIEW — DO NOT AUTO-APPLY.
--
-- Changes vs 20260620000003: (1) add `and coalesce(v.accepting_leads, true)` to BOTH
-- eligibility subqueries (client-selected validation AND auto-fill); (2) PHASE 4
-- credit-wallet debit — replace deduct_vendor_credit with a per-vendor lock+recheck,
-- atomic conditional decrement, and a MANDATORY assignment-correlated
-- vendor_credit_logs row (change_type=lead_assignment_debit,
-- reference_type=lead_assignment, reference_id=assignment id). A ledger failure rolls
-- back that vendor's debit + assignment. Signature, max-vendor behavior, idempotency
-- (LEAD_ALREADY_ASSIGNED), response contract, ranking, and the legacy whatsapp_logs
-- writes are PRESERVED. This RPC does not reference package_status/paid_status (it
-- uses public_visibility, which is unchanged).
-- ============================================================================
create or replace function public.assign_lead_to_vendors(
  p_lead_id             uuid,
  p_selected_vendor_ids uuid[] default '{}',
  p_allow_duplicate     boolean default false,
  p_selected_type       text default 'client_selected'
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_lead     public.leads%rowtype;
  v_max      int;
  v_target   uuid[] := '{}';
  v_selected uuid[] := '{}';
  v_vendor   uuid;
  v_slots    int;
  v_assigned uuid[] := '{}';
  v_skipped  uuid[] := '{}';
  v_type     text;
  v_before   int;
  v_after    int;
  v_assignment_id uuid;
begin
  -- PHASE 4 hard cap: MAX 3 vendors per lead, never exceeded, even if the DB
  -- setting is misconfigured higher (live currently returns 4). Both the selected-
  -- count guard and the auto-fill below use v_max, so 3 is the true ceiling.
  v_max := least(public.get_setting_int('max_vendors_per_lead', 3), 3);

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;

  if coalesce(array_length(p_selected_vendor_ids, 1), 0) > v_max then
    raise exception 'MAX_VENDORS_EXCEEDED' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.lead_assignments where lead_id = p_lead_id) then
    raise exception 'LEAD_ALREADY_ASSIGNED' using errcode = 'P0001';
  end if;

  if v_lead.is_duplicate and not p_allow_duplicate then
    raise exception 'DUPLICATE_LEAD' using errcode = 'P0001';
  end if;

  -- 1) validate client-selected vendors (PHASE 4: + accepting_leads)
  select coalesce(array_agg(distinct t.vid), '{}')
  into v_selected
  from unnest(p_selected_vendor_ids) as t(vid)
  where exists (
    select 1 from public.vendors v
    where v.id = t.vid
      and v.status = 'Approved' and v.is_active and v.public_visibility
      and coalesce(v.accepting_leads, true)
      and v.remaining_credits > 0
      and v.city = v_lead.city
      and v_lead.service_required = any(v.service_categories)
      and (v.covers_full_city or (v_lead.area is not null and v_lead.area = any(v.areas_covered)))
  );

  v_target := v_selected;
  if coalesce(array_length(v_target, 1), 0) > v_max then
    v_target := v_target[1:v_max];
  end if;

  -- 2) auto-fill remaining slots (PHASE 4: + accepting_leads). Ranking unchanged.
  v_slots := v_max - coalesce(array_length(v_target, 1), 0);
  if v_slots > 0 then
    v_target := v_target || array(
      select v.id
      from public.vendors v
      where v.status = 'Approved' and v.is_active and v.public_visibility
        and coalesce(v.accepting_leads, true)
        and v.remaining_credits > 0
        and v.city = v_lead.city
        and v_lead.service_required = any(v.service_categories)
        and (v.covers_full_city or (v_lead.area is not null and v_lead.area = any(v.areas_covered)))
        and not (v.id = any(v_target))
      order by
        (case when v_lead.area is not null and v_lead.area = any(v.areas_covered) then 0 else 1 end),
        (case when v_lead.service_required = any(v.service_categories) then 0 else 1 end),
        (select count(*) from public.lead_assignments la
         where la.vendor_id = v.id and la.assigned_at > now() - interval '30 days') asc,
        v.rating desc,
        v.last_assigned_at asc nulls first,
        v.remaining_credits desc
      limit v_slots
    );
  end if;

  -- 3) assign + debit (per-vendor, atomic within this function)
  foreach v_vendor in array v_target loop
    -- Lock + transactional recheck of the money-safety gate. city/category/
    -- public_visibility were already validated when building v_target above.
    select remaining_credits into v_before
    from public.vendors
    where id = v_vendor
      and status = 'Approved' and is_active and coalesce(accepting_leads, true)
    for update;
    if v_before is null or v_before < 1 then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    -- PHASE 4 credit-wallet debit: atomic conditional decrement (NO deduct_vendor_credit).
    update public.vendors
    set remaining_credits = remaining_credits - 1,
        last_assigned_at = now()
    where id = v_vendor and remaining_credits >= 1
    returning remaining_credits into v_after;
    if v_after is null then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    v_type := case when v_vendor = any(v_selected) then p_selected_type else 'auto_assigned' end;

    begin
      insert into public.lead_assignments (lead_id, vendor_id, assignment_type, credit_deducted)
      values (p_lead_id, v_vendor, v_type, true)
      returning id into v_assignment_id;
    exception when unique_violation then
      -- Race before the ledger row: restore the credit; no ledger written.
      update public.vendors set remaining_credits = remaining_credits + 1 where id = v_vendor;
      v_skipped := v_skipped || v_vendor;
      continue;
    end;

    -- MANDATORY ledger (no catch): a failure rolls back the debit + assignment.
    insert into public.vendor_credit_logs (
      vendor_id, change_type, credits_before, credits_delta, credits_after,
      reason, updated_by, reference_type, reference_id
    ) values (
      v_vendor, 'lead_assignment_debit', v_before, -1, v_after,
      case when v_vendor = any(v_selected) then 'Client-selected lead assignment' else 'Manual/admin lead assignment' end,
      'phase4_credit_wallet_manual', 'lead_assignment', v_assignment_id::text
    );

    insert into public.whatsapp_logs (recipient_type, recipient_id, phone, template_name, message)
    select 'vendor', v_vendor, ve.phone, 'new_lead_vendor',
           format('New %s lead in %s%s. Open your QuickFurno dashboard to view client details.',
                  v_lead.service_required, v_lead.city,
                  coalesce(' (' || v_lead.area || ')', ''))
    from public.vendors ve where ve.id = v_vendor;

    v_assigned := v_assigned || v_vendor;
  end loop;

  if coalesce(array_length(v_assigned, 1), 0) = 0 then
    raise exception 'NO_ELIGIBLE_VENDORS' using errcode = 'P0001';
  end if;

  update public.leads set status = 'Assigned' where id = p_lead_id;

  insert into public.whatsapp_logs (recipient_type, recipient_id, phone, template_name, message)
  values ('client', p_lead_id, v_lead.phone, 'lead_received_client',
          format('Hi %s, your %s enquiry is received. Up to %s verified QuickFurno professionals will contact you shortly.',
                 v_lead.name, v_lead.service_required, coalesce(array_length(v_assigned, 1), 0)));

  return jsonb_build_object(
    'status', 'ok',
    'lead_id', p_lead_id,
    'assigned', to_jsonb(v_assigned),
    'skipped',  to_jsonb(v_skipped),
    'assigned_count', coalesce(array_length(v_assigned, 1), 0)
  );
end; $$;

grant execute on function public.assign_lead_to_vendors(uuid, uuid[], boolean, text) to service_role;

-- Reverse (review only): re-apply 20260620000003_functions.sql definition.
