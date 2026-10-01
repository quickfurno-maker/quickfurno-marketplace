-- QuickFurno — admin-managed market labels + overlap priority.
-- Keeps future MMR/NCR-style accepted Google city labels in Supabase, not code.

create or replace function public.qf_admin_update_city_market_v1(
  p_city_id uuid,
  p_accepted_city_labels text[],
  p_resolution_priority integer
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_city_name text;
  v_priority integer := coalesce(p_resolution_priority,100);
  v_labels text[];
begin
  if v_priority < 0 or v_priority > 10000 then
    raise exception using errcode='P0001', message='QF_CITY_PRIORITY_OUT_OF_RANGE';
  end if;

  select name into v_city_name from public.cities where id=p_city_id;
  if not found then
    raise exception using errcode='P0001', message='QF_CITY_NOT_FOUND';
  end if;

  select coalesce(array_agg(label order by label), '{}'::text[])
    into v_labels
  from (
    select distinct btrim(value) as label
    from unnest(coalesce(p_accepted_city_labels,'{}'::text[])) item(value)
    where btrim(value) <> ''
  ) clean;

  if not exists (
    select 1 from unnest(v_labels) label(value)
    where lower(btrim(label.value))=lower(btrim(v_city_name))
  ) then
    v_labels := array_prepend(v_city_name,v_labels);
  end if;

  update public.marketplace_service_zones
  set accepted_city_labels=v_labels,
      resolution_priority=v_priority,
      updated_at=now()
  where city_id=p_city_id;

  if not found then
    raise exception using errcode='P0001', message='QF_CITY_SERVICE_ZONE_MISSING';
  end if;
end;
$$;

revoke all on function public.qf_admin_update_city_market_v1(uuid,text[],integer)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_admin_update_city_market_v1(uuid,text[],integer)
  to service_role;

do $verify$
declare
  v_oid oid := to_regprocedure('public.qf_admin_update_city_market_v1(uuid,text[],integer)');
begin
  if v_oid is null then
    raise exception 'QF_CITY_MARKET_SETTINGS_VERIFY_RPC_MISSING';
  end if;

  if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'QF_CITY_MARKET_SETTINGS_VERIFY_SERVICE_ROLE_EXECUTE_MISSING';
  end if;

  if has_function_privilege('anon', v_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'QF_CITY_MARKET_SETTINGS_VERIFY_BROWSER_EXECUTE_PRESENT';
  end if;
end;
$verify$;

-- Location verification follows PUBLIC-ACTIVE markets even when assignment matching is paused.
create or replace function public.qf_resolve_service_zone_v1(
  p_latitude double precision,
  p_longitude double precision,
  p_city_hint text default null
) returns table (
  service_zone_id uuid,
  service_zone_slug text,
  in_service_area boolean,
  resolution_mode text,
  verification_status text,
  reason_code text
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_point extensions.geometry(Point, 4326);
  v_city text := lower(btrim(coalesce(p_city_hint, '')));
  v_best_priority integer;
  v_best_count integer;
  v_zone public.marketplace_service_zones%rowtype;
  v_active_zone_count integer;
  v_boundary_zone_count integer;
begin
  if p_latitude is null or p_longitude is null
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180
     or (p_latitude = 0 and p_longitude = 0) then
    return query select null::uuid, null::text, null::boolean,
      'none'::text, 'unverified'::text, 'INVALID_OR_MISSING_COORDINATE'::text;
    return;
  end if;

  v_point := extensions.ST_SetSRID(
    extensions.ST_MakePoint(p_longitude, p_latitude), 4326
  );

  select count(*)::integer,
         count(*) filter (where z.boundary is not null)::integer
    into v_active_zone_count, v_boundary_zone_count
  from public.marketplace_service_zones z
  where z.is_active is true;

  -- Polygon authority first. Different-priority overlaps are explicit and the
  -- lowest priority value wins. Equal-priority overlap is ambiguous and fails closed.
  select min(z.resolution_priority)
    into v_best_priority
  from public.marketplace_service_zones z
  where z.is_active is true
    and z.boundary is not null
    and extensions.ST_Covers(z.boundary, v_point);

  if v_best_priority is not null then
    select count(*)::integer into v_best_count
    from public.marketplace_service_zones z
    where z.is_active is true
      and z.boundary is not null
      and z.resolution_priority = v_best_priority
      and extensions.ST_Covers(z.boundary, v_point);

    if v_best_count <> 1 then
      return query select null::uuid, null::text, null::boolean,
        'polygon'::text, 'unverified'::text, 'AMBIGUOUS_SERVICE_ZONE'::text;
      return;
    end if;

    select z.* into v_zone
    from public.marketplace_service_zones z
    where z.is_active is true
      and z.boundary is not null
      and z.resolution_priority = v_best_priority
      and extensions.ST_Covers(z.boundary, v_point)
    order by z.slug
    limit 1;

    return query select v_zone.id, v_zone.slug, true,
      'polygon'::text, 'verified'::text, null::text;
    return;
  end if;

  -- No polygon covered the point. A boundary-less active market can still use
  -- independent Google city evidence provisionally until its reviewed polygon
  -- is loaded. This is evaluated per market; one city's polygon does not force
  -- every other city into polygon mode.
  if v_city <> '' then
    select min(z.resolution_priority)
      into v_best_priority
    from public.marketplace_service_zones z
    where z.is_active is true
      and z.boundary is null
      and (
        lower(btrim(z.canonical_city)) = v_city
        or exists (
          select 1 from unnest(z.accepted_city_labels) label(value)
          where lower(btrim(label.value)) = v_city
        )
      );

    if v_best_priority is not null then
      select count(*)::integer into v_best_count
      from public.marketplace_service_zones z
      where z.is_active is true
        and z.boundary is null
        and z.resolution_priority = v_best_priority
        and (
          lower(btrim(z.canonical_city)) = v_city
          or exists (
            select 1 from unnest(z.accepted_city_labels) label(value)
            where lower(btrim(label.value)) = v_city
          )
        );

      if v_best_count <> 1 then
        return query select null::uuid, null::text, null::boolean,
          'city_fallback'::text, 'unverified'::text, 'AMBIGUOUS_SERVICE_ZONE'::text;
        return;
      end if;

      select z.* into v_zone
      from public.marketplace_service_zones z
      where z.is_active is true
        and z.boundary is null
        and z.resolution_priority = v_best_priority
        and (
          lower(btrim(z.canonical_city)) = v_city
          or exists (
            select 1 from unnest(z.accepted_city_labels) label(value)
            where lower(btrim(label.value)) = v_city
          )
        )
      order by z.slug
      limit 1;

      return query select v_zone.id, v_zone.slug, true,
        'city_fallback'::text, 'provisional'::text, 'BOUNDARY_NOT_CONFIGURED'::text;
      return;
    end if;

    -- The hint names an active polygon-backed market, but the coordinate is
    -- outside its boundary: explicit outside-area verdict.
    if exists (
      select 1
      from public.marketplace_service_zones z
      where z.is_active is true
        and z.boundary is not null
        and (
          lower(btrim(z.canonical_city)) = v_city
          or exists (
            select 1 from unnest(z.accepted_city_labels) label(value)
            where lower(btrim(label.value)) = v_city
          )
        )
    ) then
      return query select null::uuid, null::text, false,
        'polygon'::text, 'outside_service_area'::text, 'OUTSIDE_SERVICE_AREA'::text;
      return;
    end if;

    return query select null::uuid, null::text, false,
      'city_fallback'::text, 'outside_service_area'::text, 'OUTSIDE_SERVICE_AREA'::text;
    return;
  end if;

  if v_active_zone_count = 0 then
    return query select null::uuid, null::text, null::boolean,
      'none'::text, 'unverified'::text, 'NO_ACTIVE_SERVICE_ZONE'::text;
  elsif v_boundary_zone_count = v_active_zone_count then
    return query select null::uuid, null::text, false,
      'polygon'::text, 'outside_service_area'::text, 'OUTSIDE_SERVICE_AREA'::text;
  else
    return query select null::uuid, null::text, null::boolean,
      'none'::text, 'unverified'::text, 'SERVICE_ZONE_UNRESOLVED'::text;
  end if;
end;
$$;

revoke all on function public.qf_resolve_service_zone_v1(double precision,double precision,text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_resolve_service_zone_v1(double precision,double precision,text)
  to service_role;


-- Matching remains an independent admin-controlled gate. Public-active markets
-- can collect/verify locations while assignments are paused.
create or replace function public.qf_vendor_assignment_eligible(
  p_lead_id uuid,
  p_vendor_id uuid,
  p_credit_cost integer
) returns jsonb
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_lead public.leads%rowtype;
  v_vendor public.vendors%rowtype;
  v_cost integer := greatest(coalesce(p_credit_cost,1),0);
  v_vendor_city text;
  v_zone_requires_resolved boolean := false;
begin
  select * into v_lead from public.leads where id=p_lead_id;
  if not found then return jsonb_build_object('eligible',false,'reason_code','lead_not_found'); end if;
  if coalesce(v_lead.is_duplicate,false) then return jsonb_build_object('eligible',false,'reason_code','lead_not_eligible'); end if;
  if not public.qf_city_is_active(v_lead.city) then return jsonb_build_object('eligible',false,'reason_code','inactive_city'); end if;
  if v_lead.location_verification_status = 'outside_service_area' then
    return jsonb_build_object('eligible',false,'reason_code','outside_service_area');
  end if;

  select * into v_vendor from public.vendors where id=p_vendor_id;
  if not found then return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible'); end if;
  v_vendor_city := coalesce(nullif(btrim(v_vendor.city),''), v_vendor.office_city);
  if not public.qf_city_is_active(v_vendor_city) then return jsonb_build_object('eligible',false,'reason_code','inactive_city'); end if;
  if v_vendor.location_verification_status = 'outside_service_area' then
    return jsonb_build_object('eligible',false,'reason_code','outside_service_area');
  end if;

  -- If either side resolves (or falls back) to a market whose matching switch
  -- is off, automatic/canonical assignment must not proceed.
  if exists (
    select 1
    from public.marketplace_service_zones z
    join public.cities c on c.id=z.city_id
    where (
      z.id in (v_lead.service_zone_id, v_vendor.service_zone_id)
      or (v_lead.service_zone_id is null and (
        public.qf_norm_text(c.name)=public.qf_norm_text(v_lead.city)
        or public.qf_norm_text(c.slug)=public.qf_norm_text(v_lead.city)
      ))
      or (v_vendor.service_zone_id is null and (
        public.qf_norm_text(c.name)=public.qf_norm_text(v_vendor_city)
        or public.qf_norm_text(c.slug)=public.qf_norm_text(v_vendor_city)
      ))
    )
    and (z.is_active is not true or z.matching_enabled is not true)
  ) then
    return jsonb_build_object('eligible',false,'reason_code','service_zone_matching_disabled');
  end if;

  -- service_zone_id is authoritative whenever both sides have one.
  if v_lead.service_zone_id is not null and v_vendor.service_zone_id is not null then
    if v_lead.service_zone_id is distinct from v_vendor.service_zone_id then
      return jsonb_build_object('eligible',false,'reason_code','service_zone_mismatch');
    end if;
  else
    select coalesce(bool_or(z.requires_resolved_location), false)
      into v_zone_requires_resolved
    from public.marketplace_service_zones z
    join public.cities c on c.id=z.city_id
    where z.id in (v_lead.service_zone_id, v_vendor.service_zone_id)
       or public.qf_norm_text(c.name) in (
         public.qf_norm_text(v_lead.city),
         public.qf_norm_text(v_vendor_city)
       )
       or public.qf_norm_text(c.slug) in (
         public.qf_norm_text(v_lead.city),
         public.qf_norm_text(v_vendor_city)
       );

    if v_zone_requires_resolved then
      return jsonb_build_object('eligible',false,'reason_code','service_zone_unresolved');
    end if;

    if public.qf_norm_text(v_vendor_city) is distinct from public.qf_norm_text(v_lead.city) then
      return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible');
    end if;
  end if;

  if lower(trim(coalesce(v_vendor.status,''))) not in ('approved','active') then return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible'); end if;
  if coalesce(v_vendor.is_active,false) is not true or coalesce(v_vendor.accepting_leads,true) is not true then return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible'); end if;
  if v_vendor.assignment_suspended_at is not null and (v_vendor.assignment_suspended_until is null or v_vendor.assignment_suspended_until > now()) then return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible'); end if;
  if coalesce(v_vendor.remaining_credits,0) < v_cost then return jsonb_build_object('eligible',false,'reason_code','insufficient_credits'); end if;
  if not public.qf_lead_vendor_parent_group_compatible(v_lead.service_required,v_lead.category,v_lead.subcategory,v_vendor.service_categories,v_vendor.selected_category,v_vendor.selected_subcategories) then return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible'); end if;
  if exists(select 1 from public.lead_assignments where lead_id=p_lead_id and vendor_id=p_vendor_id) then return jsonb_build_object('eligible',false,'reason_code','duplicate_assignment'); end if;
  return jsonb_build_object('eligible',true,'reason_code',null);
end;
$$;

revoke all on function public.qf_vendor_assignment_eligible(uuid,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.qf_vendor_assignment_eligible(uuid,uuid,integer)
  to service_role;

create or replace function public.qf_enforce_service_zone_on_assignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_lead_status text;
  v_vendor_status text;
  v_lead_zone uuid;
  v_vendor_zone uuid;
  v_lead_city text;
  v_vendor_city text;
  v_requires_resolved boolean := false;
begin
  select l.location_verification_status, l.service_zone_id, l.city
    into v_lead_status, v_lead_zone, v_lead_city
    from public.leads l where l.id = new.lead_id;

  select v.location_verification_status, v.service_zone_id,
         coalesce(nullif(btrim(v.city),''),v.office_city)
    into v_vendor_status, v_vendor_zone, v_vendor_city
    from public.vendors v where v.id = new.vendor_id;

  if v_lead_status = 'outside_service_area'
     or v_vendor_status = 'outside_service_area' then
    raise exception using errcode = 'P0001', message = 'QF_ASSIGNMENT_OUTSIDE_SERVICE_AREA';
  end if;

  if exists (
    select 1
    from public.marketplace_service_zones z
    join public.cities c on c.id=z.city_id
    where (
      z.id in (v_lead_zone, v_vendor_zone)
      or (v_lead_zone is null and (
        public.qf_norm_text(c.name)=public.qf_norm_text(v_lead_city)
        or public.qf_norm_text(c.slug)=public.qf_norm_text(v_lead_city)
      ))
      or (v_vendor_zone is null and (
        public.qf_norm_text(c.name)=public.qf_norm_text(v_vendor_city)
        or public.qf_norm_text(c.slug)=public.qf_norm_text(v_vendor_city)
      ))
    )
    and (z.is_active is not true or z.matching_enabled is not true)
  ) then
    raise exception using errcode='P0001', message='QF_ASSIGNMENT_SERVICE_ZONE_MATCHING_DISABLED';
  end if;

  if v_lead_zone is not null and v_vendor_zone is not null then
    if v_lead_zone is distinct from v_vendor_zone then
      raise exception using errcode = 'P0001', message = 'QF_ASSIGNMENT_SERVICE_ZONE_MISMATCH';
    end if;
  else
    select coalesce(bool_or(z.requires_resolved_location), false)
      into v_requires_resolved
    from public.marketplace_service_zones z
    join public.cities c on c.id=z.city_id
    where z.id in (v_lead_zone, v_vendor_zone)
       or public.qf_norm_text(c.name) in (
         public.qf_norm_text(v_lead_city),
         public.qf_norm_text(v_vendor_city)
       )
       or public.qf_norm_text(c.slug) in (
         public.qf_norm_text(v_lead_city),
         public.qf_norm_text(v_vendor_city)
       );

    if v_requires_resolved then
      raise exception using errcode = 'P0001', message = 'QF_ASSIGNMENT_SERVICE_ZONE_UNRESOLVED';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.qf_enforce_service_zone_on_assignment()
  from public, anon, authenticated, service_role;

do $runtime_verify$
begin
  if position('matching_enabled' in pg_get_functiondef(
    'public.qf_vendor_assignment_eligible(uuid,uuid,integer)'::regprocedure
  )) = 0 then
    raise exception 'QF_CITY_RUNTIME_VERIFY_MATCHING_GATE_MISSING';
  end if;

  if position('QF_ASSIGNMENT_SERVICE_ZONE_MATCHING_DISABLED' in pg_get_functiondef(
    'public.qf_enforce_service_zone_on_assignment()'::regprocedure
  )) = 0 then
    raise exception 'QF_CITY_RUNTIME_VERIFY_ASSIGNMENT_GATE_MISSING';
  end if;
end;
$runtime_verify$;
