-- ============================================================================
-- QuickFurno - Fix auto-match category/service mapping.
--
-- Organic client leads store enquiry-service labels such as "Modular Kitchen",
-- "Painting", and "Home Renovation", while vendor rows may store public category
-- labels such as "Modular Factory", "Painter", and "Civil Work". The Phase 26A
-- auto-assignment RPC previously required exact equality, so valid paid/trial
-- vendors could be skipped as category mismatches.
--
-- This migration is additive and production-safe:
--   - no tables are dropped
--   - no data is deleted or rewritten
--   - WhatsApp remains preview/log-only in the application layer
--   - only helper functions and the existing auto-assignment RPC are replaced
-- ============================================================================

create or replace function public.qf_normalize_category_label(p_value text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      replace(lower(trim(coalesce(p_value, ''))), '&', ' and '),
      '\s+',
      ' ',
      'g'
    ),
    ''
  );
$$;

create or replace function public.qf_category_groups_for_label(p_value text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(group_name order by group_name), '{}'::text[])
  from (
    values
      ('Interior Designers', array[
        'interior designers', 'interior designer', 'full home interior',
        'home interior', 'interior design', 'interior', 'interiors',
        'false ceiling'
      ]::text[]),
      ('Carpenters', array[
        'carpenters', 'carpenter', 'carpentry', 'custom furniture',
        'furniture', 'woodwork', 'wood work', 'wardrobe'
      ]::text[]),
      ('Modular Factory', array[
        'modular factory', 'modular kitchen', 'kitchen', 'factory finish',
        'factory made furniture', 'machine finish furniture',
        'modular furniture', 'wardrobe'
      ]::text[]),
      ('Premium Interiors', array[
        'premium interiors', 'premium interior', 'premium interior design',
        'luxury interior'
      ]::text[]),
      ('Sofa', array[
        'sofa', 'sofa maker', 'sofa makers', 'custom sofa and upholstery',
        'upholstery', 'recliner', 'sofa repair'
      ]::text[]),
      ('Painter', array[
        'painter', 'painting', 'paint', 'texture painting', 'wall painting'
      ]::text[]),
      ('Civil Work', array[
        'civil work', 'civil', 'home renovation', 'renovation', 'tiling',
        'tile work', 'masonry', 'pop', 'plumbing civil', 'waterproofing'
      ]::text[])
  ) as groups(group_name, labels)
  where public.qf_normalize_category_label(p_value) = any (
    select public.qf_normalize_category_label(label_value) from unnest(labels) as label(label_value)
  );
$$;

create or replace function public.qf_category_labels_match(p_lead_value text, p_vendor_value text)
returns boolean
language sql
immutable
as $$
  with normalized as (
    select
      public.qf_normalize_category_label(p_lead_value) as lead_label,
      public.qf_normalize_category_label(p_vendor_value) as vendor_label
  ),
  lead_groups as (
    select unnest(public.qf_category_groups_for_label(p_lead_value)) as group_name
  ),
  vendor_groups as (
    select unnest(public.qf_category_groups_for_label(p_vendor_value)) as group_name
  )
  select coalesce((
    select lead_label is not null
      and vendor_label is not null
      and (
        lead_label = vendor_label
        or exists (
          select 1
          from lead_groups lg
          join vendor_groups vg using (group_name)
        )
      )
    from normalized
  ), false);
$$;

create or replace function public.qf_lead_vendor_category_matches(
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
  v_lead_label text;
  v_vendor_label text;
  v_lead_labels text[] := array_remove(array[
    p_service_required,
    p_category,
    p_subcategory
  ], null);
  v_vendor_labels text[] := array_remove(
    coalesce(p_vendor_service_categories, '{}'::text[])
      || coalesce(p_vendor_selected_subcategories, '{}'::text[])
      || array[p_vendor_selected_category],
    null
  );
begin
  if coalesce(array_length(v_lead_labels, 1), 0) = 0
    or coalesce(array_length(v_vendor_labels, 1), 0) = 0
  then
    return false;
  end if;

  foreach v_lead_label in array v_lead_labels loop
    foreach v_vendor_label in array v_vendor_labels loop
      if public.qf_category_labels_match(v_lead_label, v_vendor_label) then
        return true;
      end if;
    end loop;
  end loop;

  return false;
end;
$$;

create or replace function public.assign_lead_to_paid_vendors_phase26a(
  p_lead_id uuid,
  p_vendor_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
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

    -- Category compatibility intentionally uses canonical groups instead of
    -- exact equality: enquiry services and vendor public categories are stored
    -- with different labels but represent the same service families.
    v_category_ok := public.qf_lead_vendor_category_matches(
      v_lead.service_required,
      v_lead.category,
      v_lead.subcategory,
      v_row.service_categories,
      v_row.selected_category,
      v_row.selected_subcategories
    );

    if v_row.status <> 'Approved'
      or coalesce(v_row.is_active, false) is not true
      or coalesce(v_row.remaining_credits, 0) <= 0
      or not v_has_active_package
      or v_row.city is distinct from v_lead.city
      or not v_category_ok
      or (
        coalesce(v_row.covers_full_city, false) is not true
        and v_lead.area is not null
        and coalesce(array_length(v_row.areas_covered, 1), 0) > 0
        and not (v_lead.area = any(v_row.areas_covered))
      )
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
        vendor_id,
        change_type,
        credits_before,
        credits_delta,
        credits_after,
        reason,
        updated_by
      )
      values (
        v_vendor,
        'correction',
        v_before,
        -1,
        v_after,
        'Auto lead dashboard delivery',
        'phase26a_auto_matching'
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

grant execute on function public.assign_lead_to_paid_vendors_phase26a(uuid, uuid[]) to service_role;
grant execute on function public.qf_normalize_category_label(text) to service_role;
grant execute on function public.qf_category_groups_for_label(text) to service_role;
grant execute on function public.qf_category_labels_match(text, text) to service_role;
grant execute on function public.qf_lead_vendor_category_matches(text, text, text, text[], text, text[]) to service_role;
