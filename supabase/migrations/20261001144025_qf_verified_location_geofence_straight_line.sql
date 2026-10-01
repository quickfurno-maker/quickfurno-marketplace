-- QuickFurno — verified location + service-zone authority + straight-line geography.
-- Google Places/GPS supplies coordinates; QuickFurno/PostGIS owns geography.
-- No route-time provider, route matrix, road-distance or traffic dependency exists here.

create table if not exists public.marketplace_service_zones (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  canonical_city text not null,
  accepted_city_labels text[] not null default '{}'::text[],
  boundary extensions.geometry(MultiPolygon, 4326),
  boundary_version text,
  boundary_source text,
  is_active boolean not null default false,
  matching_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.marketplace_service_zones is
  'QuickFurno-owned service geography. When boundary is populated it is the geofence authority; accepted_city_labels are a provisional fallback only while no polygon is configured.';

create index if not exists idx_marketplace_service_zones_boundary_gist
  on public.marketplace_service_zones using gist (boundary)
  where boundary is not null;

alter table public.marketplace_service_zones enable row level security;
revoke all on table public.marketplace_service_zones from public, anon, authenticated;
grant select, insert, update, delete on table public.marketplace_service_zones to service_role;
insert into public.marketplace_service_zones (
  slug, name, canonical_city, accepted_city_labels, is_active, matching_enabled
) values (
  'pune-pcmc-launch',
  'Pune + PCMC Launch Region',
  'Pune',
  array['Pune','Pimpri-Chinchwad','Pimpri Chinchwad','PCMC']::text[],
  true,
  true
)
on conflict (slug) do update set
  name = excluded.name,
  canonical_city = excluded.canonical_city,
  accepted_city_labels = excluded.accepted_city_labels,
  is_active = excluded.is_active,
  matching_enabled = excluded.matching_enabled,
  updated_at = now();

alter table public.leads
  add column if not exists google_city text,
  add column if not exists service_zone_id uuid references public.marketplace_service_zones(id) on delete set null,
  add column if not exists location_verification_status text not null default 'unverified',
  add column if not exists location_verification_method text,
  add column if not exists location_verified_at timestamptz;

alter table public.vendors
  add column if not exists google_city text,
  add column if not exists service_zone_id uuid references public.marketplace_service_zones(id) on delete set null,
  add column if not exists location_verification_status text not null default 'unverified',
  add column if not exists location_verification_method text,
  add column if not exists location_verified_at timestamptz;
do $checks$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'leads_location_verification_status_check'
      and conrelid = 'public.leads'::regclass
  ) then
    alter table public.leads add constraint leads_location_verification_status_check
      check (location_verification_status in ('unverified','provisional','verified','outside_service_area'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'vendors_location_verification_status_check'
      and conrelid = 'public.vendors'::regclass
  ) then
    alter table public.vendors add constraint vendors_location_verification_status_check
      check (location_verification_status in ('unverified','provisional','verified','outside_service_area'));
  end if;
end;
$checks$;

create index if not exists idx_leads_service_zone_id on public.leads(service_zone_id);
create index if not exists idx_vendors_service_zone_id on public.vendors(service_zone_id);

comment on column public.leads.google_city is
  'Independent city evidence returned by Google Place address components; never manufactured from the selected marketplace city.';
comment on column public.vendors.google_city is
  'Independent city evidence returned by Google Place address components for the canonical office/base point.';
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
  v_has_polygon boolean := false;
  v_zone public.marketplace_service_zones%rowtype;
  v_city text := lower(btrim(coalesce(p_city_hint, '')));
begin
  if p_latitude is null or p_longitude is null
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180
     or (p_latitude = 0 and p_longitude = 0) then
    return query select null::uuid, null::text, null::boolean,
      'none'::text, 'unverified'::text, 'INVALID_OR_MISSING_COORDINATE'::text;
    return;
  end if;

  v_point := extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326);
  select exists (
    select 1 from public.marketplace_service_zones z
    where z.is_active is true
      and z.matching_enabled is true
      and z.boundary is not null
  ) into v_has_polygon;

  if v_has_polygon then
    select z.* into v_zone
    from public.marketplace_service_zones z
    where z.is_active is true
      and z.matching_enabled is true
      and z.boundary is not null
      and extensions.ST_Covers(z.boundary, v_point)
    order by z.slug
    limit 1;

    if found then
      return query select v_zone.id, v_zone.slug, true,
        'polygon'::text, 'verified'::text, null::text;
    else
      return query select null::uuid, null::text, false,
        'polygon'::text, 'outside_service_area'::text, 'OUTSIDE_SERVICE_AREA'::text;
    end if;
    return;
  end if;

  -- No business polygon has been loaded yet. Only independent Google city
  -- evidence may produce PROVISIONAL acceptance; selected form city/GPS alone
  -- must never manufacture verification.
  if v_city = '' then
    return query select null::uuid, null::text, null::boolean,
      'none'::text, 'unverified'::text, 'SERVICE_ZONE_BOUNDARY_NOT_CONFIGURED'::text;
    return;
  end if;
  select z.* into v_zone
  from public.marketplace_service_zones z
  where z.is_active is true
    and z.matching_enabled is true
    and (
      lower(btrim(z.canonical_city)) = v_city
      or exists (
        select 1 from unnest(z.accepted_city_labels) label(value)
        where lower(btrim(label.value)) = v_city
      )
    )
  order by z.slug
  limit 1;

  if found then
    return query select v_zone.id, v_zone.slug, true,
      'city_fallback'::text, 'provisional'::text, 'BOUNDARY_NOT_CONFIGURED'::text;
  else
    return query select null::uuid, null::text, false,
      'city_fallback'::text, 'outside_service_area'::text, 'OUTSIDE_SERVICE_AREA'::text;
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
  if v_lead.service_zone_id is not null and v_vendor.service_zone_id is not null
     and v_lead.service_zone_id is distinct from v_vendor.service_zone_id then
    return jsonb_build_object('eligible',false,'reason_code','service_zone_mismatch');
  end if;
  if lower(trim(coalesce(v_vendor.status,''))) not in ('approved','active') then return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible'); end if;
  if coalesce(v_vendor.is_active,false) is not true or coalesce(v_vendor.accepting_leads,true) is not true then return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible'); end if;
  if v_vendor.assignment_suspended_at is not null and (v_vendor.assignment_suspended_until is null or v_vendor.assignment_suspended_until > now()) then return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible'); end if;
  if coalesce(v_vendor.remaining_credits,0) < v_cost then return jsonb_build_object('eligible',false,'reason_code','insufficient_credits'); end if;
  if public.qf_norm_text(v_vendor_city) is distinct from public.qf_norm_text(v_lead.city) then return jsonb_build_object('eligible',false,'reason_code','vendor_not_eligible'); end if;
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
begin
  select l.location_verification_status, l.service_zone_id
    into v_lead_status, v_lead_zone
    from public.leads l where l.id = new.lead_id;

  select v.location_verification_status, v.service_zone_id
    into v_vendor_status, v_vendor_zone
    from public.vendors v where v.id = new.vendor_id;

  if v_lead_status = 'outside_service_area'
     or v_vendor_status = 'outside_service_area' then
    raise exception using errcode = 'P0001', message = 'QF_ASSIGNMENT_OUTSIDE_SERVICE_AREA';
  end if;

  if v_lead_zone is not null and v_vendor_zone is not null
     and v_lead_zone is distinct from v_vendor_zone then
    raise exception using errcode = 'P0001', message = 'QF_ASSIGNMENT_SERVICE_ZONE_MISMATCH';
  end if;

  return new;
end;
$$;

revoke all on function public.qf_enforce_service_zone_on_assignment()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_01_qf_lead_assignments_service_zone_gate on public.lead_assignments;
create trigger trg_01_qf_lead_assignments_service_zone_gate
before insert or update of lead_id, vendor_id on public.lead_assignments
for each row execute function public.qf_enforce_service_zone_on_assignment();
do $verify$
begin
  if not exists (
    select 1 from public.marketplace_service_zones
    where slug = 'pune-pcmc-launch' and is_active and matching_enabled
  ) then
    raise exception 'QF_LOCATION_VERIFY_LAUNCH_ZONE_MISSING';
  end if;

  if to_regprocedure('public.qf_resolve_service_zone_v1(double precision,double precision,text)') is null then
    raise exception 'QF_LOCATION_VERIFY_RESOLVER_MISSING';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.lead_assignments'::regclass
      and tgname = 'trg_01_qf_lead_assignments_service_zone_gate'
      and not tgisinternal
  ) then
    raise exception 'QF_LOCATION_VERIFY_ASSIGNMENT_GATE_MISSING';
  end if;
end;
$verify$;
