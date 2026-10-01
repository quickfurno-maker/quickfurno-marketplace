-- QuickFurno — admin-controlled service-zone boundary management.
-- Boundaries are real PostGIS data, never hard-coded application constants.

create or replace function public.qf_admin_set_city_boundary_v1(
  p_city_id uuid,
  p_geojson jsonb,
  p_source text default null,
  p_version text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_zone_id uuid;
  v_geometry_json jsonb;
  v_geom extensions.geometry;
  v_type text;
  v_source text := coalesce(nullif(btrim(p_source),''),'admin_geojson');
  v_version text := coalesce(nullif(btrim(p_version),''),to_char(clock_timestamp(),'YYYYMMDDHH24MISS'));
  v_npoints integer;
  v_area_sq_km numeric;
begin
  select id into v_zone_id
  from public.marketplace_service_zones
  where city_id=p_city_id
  for update;

  if not found then
    raise exception using errcode='P0001', message='QF_CITY_SERVICE_ZONE_MISSING';
  end if;

  if p_geojson is null or jsonb_typeof(p_geojson) <> 'object' then
    raise exception using errcode='P0001', message='QF_BOUNDARY_GEOJSON_INVALID';
  end if;

  v_type := p_geojson->>'type';

  if v_type = 'Feature' then
    v_geometry_json := p_geojson->'geometry';
    if v_geometry_json is null or jsonb_typeof(v_geometry_json) <> 'object' then
      raise exception using errcode='P0001', message='QF_BOUNDARY_FEATURE_GEOMETRY_MISSING';
    end if;
    v_geom := extensions.ST_SetSRID(
      extensions.ST_GeomFromGeoJSON(v_geometry_json::text),
      4326
    );
  elsif v_type = 'FeatureCollection' then
    if jsonb_typeof(p_geojson->'features') <> 'array'
       or jsonb_array_length(p_geojson->'features') = 0 then
      raise exception using errcode='P0001', message='QF_BOUNDARY_FEATURE_COLLECTION_EMPTY';
    end if;

    select extensions.ST_UnaryUnion(
      extensions.ST_Collect(
        extensions.ST_SetSRID(
          extensions.ST_GeomFromGeoJSON((feature->'geometry')::text),
          4326
        )
      )
    )
    into v_geom
    from jsonb_array_elements(p_geojson->'features') feature
    where jsonb_typeof(feature->'geometry')='object';
  elsif v_type in ('Polygon','MultiPolygon') then
    v_geom := extensions.ST_SetSRID(
      extensions.ST_GeomFromGeoJSON(p_geojson::text),
      4326
    );
  else
    raise exception using errcode='P0001', message='QF_BOUNDARY_MUST_BE_POLYGON_OR_MULTIPOLYGON';
  end if;

  if v_geom is null or extensions.ST_IsEmpty(v_geom) then
    raise exception using errcode='P0001', message='QF_BOUNDARY_EMPTY';
  end if;

  v_geom := extensions.ST_Force2D(v_geom);

  -- Feature collections can union into collections. Keep polygonal components only.
  if extensions.GeometryType(v_geom) = 'GEOMETRYCOLLECTION' then
    v_geom := extensions.ST_CollectionExtract(v_geom,3);
  end if;

  if extensions.GeometryType(v_geom) = 'POLYGON' then
    v_geom := extensions.ST_Multi(v_geom);
  end if;

  if extensions.GeometryType(v_geom) <> 'MULTIPOLYGON' then
    raise exception using errcode='P0001', message='QF_BOUNDARY_MUST_BE_POLYGON_OR_MULTIPOLYGON';
  end if;

  if not extensions.ST_IsValid(v_geom) then
    raise exception using
      errcode='P0001',
      message='QF_BOUNDARY_INVALID_GEOMETRY',
      detail=extensions.ST_IsValidReason(v_geom);
  end if;

  v_npoints := extensions.ST_NPoints(v_geom);
  if v_npoints > 100000 then
    raise exception using errcode='P0001', message='QF_BOUNDARY_TOO_COMPLEX';
  end if;

  v_area_sq_km := round(
    (extensions.ST_Area(v_geom::extensions.geography) / 1000000.0)::numeric,
    2
  );

  update public.marketplace_service_zones
  set boundary=v_geom,
      boundary_source=left(v_source,200),
      boundary_version=left(v_version,100),
      updated_at=now()
  where id=v_zone_id;

  return jsonb_build_object(
    'service_zone_id',v_zone_id,
    'geometry_type','MultiPolygon',
    'point_count',v_npoints,
    'area_sq_km',v_area_sq_km,
    'boundary_source',left(v_source,200),
    'boundary_version',left(v_version,100)
  );
end;
$$;

revoke all on function public.qf_admin_set_city_boundary_v1(uuid,jsonb,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_admin_set_city_boundary_v1(uuid,jsonb,text,text)
  to service_role;

create or replace function public.qf_admin_clear_city_boundary_v1(
  p_city_id uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  update public.marketplace_service_zones
  set boundary=null,
      boundary_source=null,
      boundary_version=null,
      updated_at=now()
  where city_id=p_city_id;

  if not found then
    raise exception using errcode='P0001', message='QF_CITY_SERVICE_ZONE_MISSING';
  end if;
end;
$$;

revoke all on function public.qf_admin_clear_city_boundary_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_admin_clear_city_boundary_v1(uuid)
  to service_role;

create or replace function public.qf_admin_service_zone_summaries_v1()
returns table (
  id uuid,
  city_id uuid,
  slug text,
  name text,
  canonical_city text,
  accepted_city_labels text[],
  boundary_version text,
  boundary_source text,
  is_active boolean,
  matching_enabled boolean,
  resolution_priority integer,
  requires_resolved_location boolean,
  boundary_configured boolean,
  boundary_npoints integer,
  boundary_area_sq_km numeric
)
language sql
stable
security invoker
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select
    z.id,
    z.city_id,
    z.slug,
    z.name,
    z.canonical_city,
    z.accepted_city_labels,
    z.boundary_version,
    z.boundary_source,
    z.is_active,
    z.matching_enabled,
    z.resolution_priority,
    z.requires_resolved_location,
    z.boundary is not null as boundary_configured,
    case when z.boundary is null then null else extensions.ST_NPoints(z.boundary) end as boundary_npoints,
    case when z.boundary is null then null
      else round((extensions.ST_Area(z.boundary::extensions.geography)/1000000.0)::numeric,2)
    end as boundary_area_sq_km
  from public.marketplace_service_zones z
  order by z.resolution_priority,z.slug;
$$;

revoke all on function public.qf_admin_service_zone_summaries_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.qf_admin_service_zone_summaries_v1()
  to service_role;

do $verify$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.qf_admin_set_city_boundary_v1(uuid,jsonb,text,text)',
    'public.qf_admin_clear_city_boundary_v1(uuid)',
    'public.qf_admin_service_zone_summaries_v1()'
  ]
  loop
    if to_regprocedure(v_sig) is null then
      raise exception 'QF_BOUNDARY_VERIFY_RPC_MISSING: %',v_sig;
    end if;
    if not has_function_privilege('service_role',to_regprocedure(v_sig),'EXECUTE') then
      raise exception 'QF_BOUNDARY_VERIFY_SERVICE_ROLE_EXECUTE_MISSING: %',v_sig;
    end if;
    if has_function_privilege('anon',to_regprocedure(v_sig),'EXECUTE')
       or has_function_privilege('authenticated',to_regprocedure(v_sig),'EXECUTE') then
      raise exception 'QF_BOUNDARY_VERIFY_BROWSER_EXECUTE_PRESENT: %',v_sig;
    end if;
  end loop;
end;
$verify$;
