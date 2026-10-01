-- QuickFurno — multi-city service-zone authority.
-- service_zone_id is the long-term geographic matching authority.
-- City text remains compatibility/display evidence only when a zone is unresolved.

alter table public.marketplace_service_zones
  add column if not exists city_id uuid,
  add column if not exists resolution_priority integer not null default 100,
  add column if not exists requires_resolved_location boolean not null default false;

update public.marketplace_service_zones z
set city_id = c.id
from public.cities c
where z.city_id is null
  and (
    lower(btrim(c.name)) = lower(btrim(z.canonical_city))
    or lower(btrim(coalesce(c.slug,''))) = lower(btrim(z.canonical_city))
  );

do $city_link$
begin
  if exists (select 1 from public.marketplace_service_zones where city_id is null) then
    raise exception 'QF_MULTI_CITY_ZONE_WITHOUT_CITY_LINK';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='marketplace_service_zones_city_id_fkey'
      and conrelid='public.marketplace_service_zones'::regclass
  ) then
    alter table public.marketplace_service_zones
      add constraint marketplace_service_zones_city_id_fkey
      foreign key (city_id) references public.cities(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='marketplace_service_zones_city_id_key'
      and conrelid='public.marketplace_service_zones'::regclass
  ) then
    alter table public.marketplace_service_zones
      add constraint marketplace_service_zones_city_id_key unique (city_id);
  end if;
end;
$city_link$;

alter table public.marketplace_service_zones alter column city_id set not null;

comment on column public.marketplace_service_zones.resolution_priority is
  'Lower value wins only when active matching-enabled service zones overlap. Equal-priority ambiguity fails closed.';
comment on column public.marketplace_service_zones.requires_resolved_location is
  'When true, automatic assignment requires both lead and vendor to resolve to this service zone. Use after location backfill is complete.';

do $checks$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'marketplace_service_zones_resolution_priority_check'
      and conrelid = 'public.marketplace_service_zones'::regclass
  ) then
    alter table public.marketplace_service_zones
      add constraint marketplace_service_zones_resolution_priority_check
      check (resolution_priority between 0 and 10000);
  end if;
end;
$checks$;

create index if not exists idx_marketplace_service_zones_resolution
  on public.marketplace_service_zones
  (is_active, matching_enabled, resolution_priority, slug);

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
  v_matching_zone_count integer;
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
    into v_matching_zone_count, v_boundary_zone_count
  from public.marketplace_service_zones z
  where z.is_active is true and z.matching_enabled is true;

  -- Polygon authority first. Different-priority overlaps are explicit and the
  -- lowest priority value wins. Equal-priority overlap is ambiguous and fails closed.
  select min(z.resolution_priority)
    into v_best_priority
  from public.marketplace_service_zones z
  where z.is_active is true
    and z.matching_enabled is true
    and z.boundary is not null
    and extensions.ST_Covers(z.boundary, v_point);

  if v_best_priority is not null then
    select count(*)::integer into v_best_count
    from public.marketplace_service_zones z
    where z.is_active is true
      and z.matching_enabled is true
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
      and z.matching_enabled is true
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
      and z.matching_enabled is true
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
        and z.matching_enabled is true
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
        and z.matching_enabled is true
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
        and z.matching_enabled is true
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

  if v_matching_zone_count = 0 then
    return query select null::uuid, null::text, null::boolean,
      'none'::text, 'unverified'::text, 'NO_ACTIVE_SERVICE_ZONE'::text;
  elsif v_boundary_zone_count = v_matching_zone_count then
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

    -- Compatibility fallback only while at least one side is not zone-resolved.
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

do $verify$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='marketplace_service_zones'
      and column_name='resolution_priority'
  ) then
    raise exception 'QF_MULTI_CITY_VERIFY_PRIORITY_MISSING';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='marketplace_service_zones'
      and column_name='requires_resolved_location'
  ) then
    raise exception 'QF_MULTI_CITY_VERIFY_STRICT_MODE_MISSING';
  end if;
  if to_regprocedure('public.qf_resolve_service_zone_v1(double precision,double precision,text)') is null then
    raise exception 'QF_MULTI_CITY_VERIFY_RESOLVER_MISSING';
  end if;
end;
$verify$;

-- Ensure every configured admin city has a real service-zone control row.
-- Newly discovered legacy cities are NOT auto-enabled for matching.
insert into public.marketplace_service_zones (
  city_id, slug, name, canonical_city, accepted_city_labels,
  is_active, matching_enabled, resolution_priority, requires_resolved_location
)
select
  c.id,
  coalesce(nullif(btrim(c.slug),''), lower(regexp_replace(btrim(c.name), '[^a-zA-Z0-9]+', '-', 'g'))) || '-market',
  c.name || ' Market',
  c.name,
  array[c.name]::text[],
  coalesce(c.is_active,false),
  false,
  100,
  false
from public.cities c
where not exists (
  select 1 from public.marketplace_service_zones z where z.city_id=c.id
);

create or replace function public.qf_admin_create_city_market_v1(
  p_name text,
  p_slug text,
  p_initial_active boolean default false
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_name,''));
  v_slug text := lower(btrim(coalesce(p_slug,'')));
  v_city_id uuid;
begin
  if v_name = '' or v_slug = '' then
    raise exception using errcode='P0001', message='QF_CITY_INVALID_INPUT';
  end if;

  if exists (
    select 1 from public.cities
    where lower(btrim(name))=lower(v_name)
       or lower(btrim(coalesce(slug,'')))=v_slug
  ) then
    raise exception using errcode='P0001', message='QF_CITY_ALREADY_EXISTS';
  end if;

  insert into public.cities(name,slug,is_active)
  values(v_name,v_slug,coalesce(p_initial_active,false))
  returning id into v_city_id;

  insert into public.marketplace_service_zones(
    city_id,slug,name,canonical_city,accepted_city_labels,
    is_active,matching_enabled,resolution_priority,requires_resolved_location
  ) values (
    v_city_id,
    v_slug || '-market',
    v_name || ' Market',
    v_name,
    array[v_name]::text[],
    coalesce(p_initial_active,false),
    false,
    100,
    false
  );

  return v_city_id;
end;
$$;

revoke all on function public.qf_admin_create_city_market_v1(text,text,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_admin_create_city_market_v1(text,text,boolean)
  to service_role;

create or replace function public.qf_admin_set_city_active_v1(
  p_city_id uuid,
  p_active boolean
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_count integer;
begin
  update public.cities
  set is_active=coalesce(p_active,false)
  where id=p_city_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception using errcode='P0001', message='QF_CITY_NOT_FOUND';
  end if;

  update public.marketplace_service_zones
  set is_active=coalesce(p_active,false),
      matching_enabled=case when coalesce(p_active,false) then matching_enabled else false end,
      updated_at=now()
  where city_id=p_city_id;

  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception using errcode='P0001', message='QF_CITY_SERVICE_ZONE_MISSING';
  end if;
end;
$$;

revoke all on function public.qf_admin_set_city_active_v1(uuid,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_admin_set_city_active_v1(uuid,boolean)
  to service_role;

create or replace function public.qf_admin_set_city_matching_v1(
  p_city_id uuid,
  p_enabled boolean
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_city_active boolean;
  v_zone_active boolean;
begin
  select coalesce(c.is_active,false), coalesce(z.is_active,false)
    into v_city_active,v_zone_active
  from public.cities c
  join public.marketplace_service_zones z on z.city_id=c.id
  where c.id=p_city_id
  for update of c,z;

  if not found then
    raise exception using errcode='P0001', message='QF_CITY_SERVICE_ZONE_MISSING';
  end if;

  if coalesce(p_enabled,false) and (not v_city_active or not v_zone_active) then
    raise exception using errcode='P0001', message='QF_CITY_MUST_BE_ACTIVE_BEFORE_MATCHING';
  end if;

  update public.marketplace_service_zones
  set matching_enabled=coalesce(p_enabled,false),
      updated_at=now()
  where city_id=p_city_id;
end;
$$;

revoke all on function public.qf_admin_set_city_matching_v1(uuid,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_admin_set_city_matching_v1(uuid,boolean)
  to service_role;

create or replace function public.qf_admin_set_city_strict_location_v1(
  p_city_id uuid,
  p_enabled boolean
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  update public.marketplace_service_zones
  set requires_resolved_location=coalesce(p_enabled,false),
      updated_at=now()
  where city_id=p_city_id;
  if not found then
    raise exception using errcode='P0001', message='QF_CITY_SERVICE_ZONE_MISSING';
  end if;
end;
$$;

revoke all on function public.qf_admin_set_city_strict_location_v1(uuid,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_admin_set_city_strict_location_v1(uuid,boolean)
  to service_role;

do $admin_verify$
declare
  v_sig text;
begin
  if exists (
    select 1 from public.cities c
    where not exists (
      select 1 from public.marketplace_service_zones z where z.city_id=c.id
    )
  ) then
    raise exception 'QF_MULTI_CITY_VERIFY_CITY_WITHOUT_ZONE';
  end if;

  if exists (
    select 1
    from public.marketplace_service_zones z
    join public.cities c on c.id=z.city_id
    group by z.city_id
    having count(*) <> 1
  ) then
    raise exception 'QF_MULTI_CITY_VERIFY_NON_UNIQUE_CITY_ZONE';
  end if;

  foreach v_sig in array array[
    'public.qf_admin_create_city_market_v1(text,text,boolean)',
    'public.qf_admin_set_city_active_v1(uuid,boolean)',
    'public.qf_admin_set_city_matching_v1(uuid,boolean)',
    'public.qf_admin_set_city_strict_location_v1(uuid,boolean)'
  ]
  loop
    if to_regprocedure(v_sig) is null then
      raise exception 'QF_MULTI_CITY_VERIFY_ADMIN_RPC_MISSING: %', v_sig;
    end if;
    if not has_function_privilege('service_role', to_regprocedure(v_sig), 'EXECUTE') then
      raise exception 'QF_MULTI_CITY_VERIFY_SERVICE_ROLE_EXECUTE_MISSING: %', v_sig;
    end if;
    if has_function_privilege('anon', to_regprocedure(v_sig), 'EXECUTE')
       or has_function_privilege('authenticated', to_regprocedure(v_sig), 'EXECUTE') then
      raise exception 'QF_MULTI_CITY_VERIFY_BROWSER_EXECUTE_PRESENT: %', v_sig;
    end if;
  end loop;
end;
$admin_verify$;
