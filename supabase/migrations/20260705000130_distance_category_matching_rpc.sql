-- ============================================================================
-- QuickFurno — 20260705000130_distance_category_matching_rpc.sql
-- Phase 2: distance-/category-tier-aware assignment RPC alignment.
--
-- ADDITIVE ONLY: create-or-replace functions; no tables/data dropped or rewritten;
-- WhatsApp stays preview/log-only in the app layer. Idempotent + safe to re-run.
--
-- WHY: the JavaScript matcher (services/leadMatchingEngine.ts) already ranks and
-- filters vendors (commercial eligibility → normalized city → category tier →
-- distance/area ranking → max 3) and passes ALREADY-RANKED vendor IDs to this RPC.
-- The previous RPC still rejected valid JS matches because it used:
--   • a case-SENSITIVE city compare (`v_row.city is distinct from v_lead.city`), and
--   • an exact case-SENSITIVE areas_covered membership hard filter
--     (lead.area = any(vendor.areas_covered))  →  "kharadi" != "Kharadi".
--
-- This migration makes the RPC a DEFENSIVE final gate aligned with the JS contract:
--   • commercial eligibility (Approved + active + paid/trial + credits + package)
--   • NORMALIZED city hard gate
--   • category compatibility via ONE shared PARENT-GROUP contract (below), which
--     equals the JS eligibility contract (Tier 0 ∪ Tier 1 = same parent group)
--   • credits/package deduction, duplicate/idempotency, rollback, credit logs
--   • max 3 = least(configured, 3); input vendor-ID order preserved
-- The legacy exact-area membership rejection is REMOVED (area is ranking-only in JS).
--
-- SHARED CATEGORY CONTRACT (must stay in sync with JS):
--   qf_parent_category_group(...) mirrors PARENT_GROUP_DEFINITIONS in
--   lib/vendors/categoryMatching.ts (Interior / Sofa / Painting / Civil Work, else
--   the normalized label as its own group). Do NOT create a second synonym system.
-- ============================================================================

-- ---- normalization helpers -------------------------------------------------
create or replace function public.qf_normalize_category_label(p_value text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      replace(lower(trim(coalesce(p_value, ''))), '&', ' and '),
      '\s+', ' ', 'g'
    ),
    ''
  );
$$;

create or replace function public.qf_norm_text(p_value text)
returns text
language sql
immutable
as $$
  select nullif(lower(trim(coalesce(p_value, ''))), '');
$$;

-- ---- shared parent-group category contract (mirrors JS) --------------------
create or replace function public.qf_parent_category_group(p_value text)
returns text
language sql
immutable
as $$
  select coalesce(
    (
      select group_name
      from (
        values
          ('Interior', array[
            'full home interior','home interior','interiors','interior','interior design',
            'interior designers','interior designer','premium interiors','premium interior',
            'premium interior design','luxury interior','carpenters','carpenter','carpentry',
            'custom furniture','furniture','woodwork','wood work','furniture work','modular factory',
            'modular kitchen','kitchen','modular furniture','factory made furniture',
            'machine finish furniture','wardrobe','false ceiling','turnkey interior',
            'complete interior','kitchen carpenter'
          ]::text[]),
          ('Sofa', array[
            'sofa','sofa maker','sofa makers','upholstery','sofa repair','sofa cleaning',
            'recliner','custom sofa and upholstery'
          ]::text[]),
          ('Painting', array[
            'painter','painting','paint','wall painting','texture painting'
          ]::text[]),
          ('Civil Work', array[
            'civil work','civil','renovation','home renovation','masonry','tiling','tile work',
            'pop','plumbing civil','plumbing','waterproofing'
          ]::text[])
      ) as groups(group_name, labels)
      where public.qf_normalize_category_label(p_value) = any (
        select public.qf_normalize_category_label(l) from unnest(labels) as label(l)
      )
      limit 1
    ),
    -- Unmapped category keeps its own stable group (the normalized label).
    public.qf_normalize_category_label(p_value)
  );
$$;

create or replace function public.qf_lead_vendor_parent_group_compatible(
  p_service_required text,
  p_category text,
  p_subcategory text,
  p_vendor_service_categories text[],
  p_vendor_selected_category text,
  p_vendor_selected_subcategories text[]
)
returns boolean
language plpgsql
immutable
as $$
declare
  v_lead_labels text[] := array_remove(array[
    p_service_required, p_category, p_subcategory
  ], null);
  v_vendor_labels text[] := array_remove(
    coalesce(p_vendor_service_categories, '{}'::text[])
      || coalesce(p_vendor_selected_subcategories, '{}'::text[])
      || array[p_vendor_selected_category],
    null
  );
  v_lead_groups text[];
  v_vendor_groups text[];
begin
  if coalesce(array_length(v_lead_labels, 1), 0) = 0
    or coalesce(array_length(v_vendor_labels, 1), 0) = 0
  then
    return false;
  end if;

  select array_agg(distinct public.qf_parent_category_group(l))
    into v_lead_groups
  from unnest(v_lead_labels) as lead_label(l)
  where public.qf_normalize_category_label(l) is not null;

  select array_agg(distinct public.qf_parent_category_group(v))
    into v_vendor_groups
  from unnest(v_vendor_labels) as vendor_label(v)
  where public.qf_normalize_category_label(v) is not null;

  if coalesce(array_length(v_lead_groups, 1), 0) = 0
    or coalesce(array_length(v_vendor_groups, 1), 0) = 0
  then
    return false;
  end if;

  return exists (
    select 1
    from unnest(v_lead_groups) as lg(g)
    join unnest(v_vendor_groups) as vg(g) using (g)
  );
end;
$$;

-- ---- assignment RPC (defensive final gate; preserves all money/idempotency) --
create or replace function public.assign_lead_to_paid_vendors_phase26a(
  p_lead_id uuid,
  p_vendor_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
-- Deliberately fixed, trusted search path for a SECURITY DEFINER function:
-- pg_catalog first (built-ins cannot be shadowed by a malicious public object),
-- public for the application tables/helpers below (all still fully qualified as
-- public.<name>), pg_temp explicitly LAST so a session temp schema can never
-- hijack an unqualified lookup.
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_lead public.leads%rowtype;
  v_max int;
  v_vendor uuid;
  v_row public.vendors%rowtype;
  v_assignment_id uuid;
  v_pkg_id uuid;
  v_before int;
  v_after int;
  v_has_active_package boolean;
  v_category_ok boolean;
  v_assigned jsonb := '[]'::jsonb;
  v_assigned_ids uuid[] := '{}';
  v_skipped uuid[] := '{}';
begin
  -- MAX 3, never exceeded (respects configured setting, capped at 3).
  v_max := least(public.get_setting_int('max_vendors_per_lead', 3), 3);

  select * into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;

  if coalesce(v_lead.is_duplicate, false) then
    return jsonb_build_object(
      'status', 'skipped_duplicate',
      'lead_id', p_lead_id,
      'assigned', '[]'::jsonb,
      'skipped', '[]'::jsonb,
      'assigned_count', 0
    );
  end if;

  -- Idempotency: if this lead already has assignments, return them unchanged.
  if exists (select 1 from public.lead_assignments where lead_id = p_lead_id) then
    select coalesce(
      jsonb_agg(jsonb_build_object('vendor_id', vendor_id, 'assignment_id', id)),
      '[]'::jsonb
    )
    into v_assigned
    from public.lead_assignments
    where lead_id = p_lead_id;

    select coalesce(array_agg(vendor_id), '{}')
    into v_assigned_ids
    from public.lead_assignments
    where lead_id = p_lead_id;

    return jsonb_build_object(
      'status', 'already_assigned',
      'lead_id', p_lead_id,
      'assigned', v_assigned,
      'skipped', '[]'::jsonb,
      'assigned_count', coalesce(array_length(v_assigned_ids, 1), 0)
    );
  end if;

  -- Process vendors in the exact input order supplied by the JS matcher (deduped).
  for v_vendor in
    select vendor_id
    from (
      select distinct on (item.vendor_id) item.vendor_id, item.ordinality
      from unnest(coalesce(p_vendor_ids, '{}')) with ordinality as item(vendor_id, ordinality)
      where item.vendor_id is not null
      order by item.vendor_id, item.ordinality
    ) deduped
    order by ordinality
    limit v_max
  loop
    select * into v_row
    from public.vendors
    where id = v_vendor
    for update;

    if not found then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    select exists (
      select 1
      from public.vendor_packages vp
      where vp.vendor_id = v_vendor
        and lower(coalesce(vp.status, '')) in ('active', 'trial')
        and coalesce(vp.remaining_leads, 0) > 0
        and (vp.expiry_date is null or vp.expiry_date > now())
    )
    into v_has_active_package;

    v_has_active_package := v_has_active_package
      or lower(coalesce(v_row.package_status, '')) in ('active', 'trial')
      or lower(coalesce(v_row.paid_status, '')) in ('paid', 'trial', 'active', 'premium', 'priority');

    -- Category: ONE shared parent-group contract (aligns with the JS matcher; a
    -- superset of the exact/synonym canonical match, so JS Tier 0 AND Tier 1
    -- fallback are both accepted, while a different service family is rejected).
    v_category_ok := public.qf_lead_vendor_parent_group_compatible(
      v_lead.service_required,
      v_lead.category,
      v_lead.subcategory,
      v_row.service_categories,
      v_row.selected_category,
      v_row.selected_subcategories
    );

    -- Defensive final gates: commercial + NORMALIZED city + category compatibility.
    -- (No area gate: area/distance are ranking signals, decided by the JS matcher.)
    -- Status gate: normalized + fail-closed, mirroring the JS normalizeStatus
    -- contract where BOTH 'approved' and 'active' count as approved. NULL/'' fail
    -- closed (SQL <> against a literal would evaluate NULL as unknown = not blocked).
    if lower(trim(coalesce(v_row.status, ''))) not in ('approved', 'active')
      or coalesce(v_row.is_active, false) is not true
      or coalesce(v_row.remaining_credits, 0) <= 0
      or not v_has_active_package
      or public.qf_norm_text(coalesce(nullif(trim(v_row.city), ''), v_row.office_city))
           is distinct from public.qf_norm_text(v_lead.city)
      or not v_category_ok
    then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    v_before := coalesce(v_row.remaining_credits, 0);

    select id into v_pkg_id
    from public.vendor_packages
    where vendor_id = v_vendor
      and lower(coalesce(status, '')) in ('active', 'trial')
      and coalesce(remaining_leads, 0) > 0
      and (expiry_date is null or expiry_date > now())
    order by expiry_date asc nulls last
    for update skip locked
    limit 1;

    update public.vendors
    set remaining_credits = remaining_credits - 1,
        last_assigned_at = now()
    where id = v_vendor and remaining_credits > 0
    returning remaining_credits into v_after;

    if v_after is null then
      v_skipped := v_skipped || v_vendor;
      continue;
    end if;

    if v_pkg_id is not null then
      update public.vendor_packages
      set remaining_leads = remaining_leads - 1,
          status = case when remaining_leads - 1 <= 0 then 'Consumed' else status end
      where id = v_pkg_id;
    end if;

    begin
      insert into public.lead_assignments (lead_id, vendor_id, assignment_type, credit_deducted)
      values (p_lead_id, v_vendor, 'auto_assigned', true)
      returning id into v_assignment_id;
    exception when unique_violation then
      -- Roll back the credit + package decrement on a duplicate assignment race.
      update public.vendors
      set remaining_credits = remaining_credits + 1
      where id = v_vendor;

      if v_pkg_id is not null then
        update public.vendor_packages
        set remaining_leads = remaining_leads + 1,
            status = case when status = 'Consumed' then 'Active' else status end
        where id = v_pkg_id;
      end if;

      v_skipped := v_skipped || v_vendor;
      continue;
    end;

    begin
      insert into public.vendor_credit_logs (
        vendor_id, change_type, credits_before, credits_delta, credits_after, reason, updated_by
      )
      values (
        v_vendor, 'correction', v_before, -1, v_after,
        'Auto lead dashboard delivery', 'phase26a_auto_matching'
      );
    exception when undefined_table or check_violation then
      null;
    end;

    v_assigned_ids := v_assigned_ids || v_vendor;
    v_assigned := v_assigned || jsonb_build_array(
      jsonb_build_object(
        'vendor_id', v_vendor,
        'assignment_id', v_assignment_id,
        'credits_before', v_before,
        'credits_after', v_after
      )
    );
  end loop;

  if coalesce(array_length(v_assigned_ids, 1), 0) > 0 then
    update public.leads set status = 'Assigned' where id = p_lead_id;
  end if;

  return jsonb_build_object(
    'status', case when coalesce(array_length(v_assigned_ids, 1), 0) > 0 then 'ok' else 'no_eligible_vendors' end,
    'lead_id', p_lead_id,
    'assigned', v_assigned,
    'skipped', to_jsonb(v_skipped),
    'assigned_count', coalesce(array_length(v_assigned_ids, 1), 0)
  );
end;
$$;

-- ============================================================================
-- EXECUTE PRIVILEGE HARDENING (defense in depth; idempotent, safe to re-run).
--
-- CREATE OR REPLACE does NOT reset an existing function's ACL, and new functions
-- in `public` inherit Supabase's default EXECUTE grant to PUBLIC/anon/authenticated.
-- We therefore REVOKE those browser-reachable roles explicitly and keep only the
-- privileges each function actually needs. REVOKE never touches the owner, so the
-- SECURITY DEFINER function (running as its owner) can still call its own helpers.
-- ============================================================================

-- ---- Mutating assignment RPC ------------------------------------------------
-- This is the ONLY money-mutating function here (vendor credits, package
-- remaining_leads, lead_assignments, lead status, vendor_credit_logs). It must be
-- callable ONLY by the trusted server (service_role via adminClient().rpc(...)).
-- It must NOT be reachable from anon/authenticated browser sessions or PUBLIC.
revoke all on function public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[]) from public;
revoke all on function public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[]) from anon;
revoke all on function public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[]) from authenticated;
grant execute on function public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[]) to service_role;

-- ---- Internal-only pure category/text helpers -------------------------------
-- These are pure, immutable, and are invoked ONLY from inside the SECURITY
-- DEFINER RPC above (no app code calls them directly via .rpc()). The definer
-- executes them as the function owner, so they need NO role grants at all — we
-- strip the default PUBLIC/anon/authenticated EXECUTE and grant nothing further.
revoke all on function public.qf_normalize_category_label(text) from public;
revoke all on function public.qf_normalize_category_label(text) from anon;
revoke all on function public.qf_normalize_category_label(text) from authenticated;

revoke all on function public.qf_norm_text(text) from public;
revoke all on function public.qf_norm_text(text) from anon;
revoke all on function public.qf_norm_text(text) from authenticated;

revoke all on function public.qf_parent_category_group(text) from public;
revoke all on function public.qf_parent_category_group(text) from anon;
revoke all on function public.qf_parent_category_group(text) from authenticated;

revoke all on function public.qf_lead_vendor_parent_group_compatible(text, text, text, text[], text, text[]) from public;
revoke all on function public.qf_lead_vendor_parent_group_compatible(text, text, text, text[], text, text[]) from anon;
revoke all on function public.qf_lead_vendor_parent_group_compatible(text, text, text, text[], text, text[]) from authenticated;
