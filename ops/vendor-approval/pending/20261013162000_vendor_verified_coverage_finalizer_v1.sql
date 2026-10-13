-- Vendor OS V3: same-city, existing-primary-category adjustments only.
-- PENDING GOVERNED RELEASE. Must not enable new cities or unverified offices.
-- Requires an already Google-verified Core office, authoritative polygon, and
-- existing selected category. Other ownership/contact and office changes HOLD.
begin;
create or replace function public.qf_approve_vendor_verified_coverage_v1(
  p_request_id uuid,p_admin_id uuid,p_notes text default null
) returns public.vendor_profile_change_requests
language plpgsql security definer set search_path=''
as $body$
declare
  r public.vendor_profile_change_requests%rowtype;
  v public.vendors%rowtype;
  z public.marketplace_service_zones%rowtype;
  result public.vendor_profile_change_requests%rowtype;
  v_categories text[];
  v_city text;
begin
  if p_request_id is null or p_admin_id is null or
      length(coalesce(p_notes,''))>2000 then
    raise exception 'QF_COVERAGE_INVALID_INPUT' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_admin_id and p.role='admin'
      and u.raw_app_meta_data->>'admin_role'='Superadmin'
  ) then
    raise exception 'QF_COVERAGE_SUPERADMIN_REQUIRED' using errcode='42501';
  end if;
  select * into r from public.vendor_profile_change_requests
    where id=p_request_id for update;
  if not found or r.request_type is distinct from 'service_coverage_change'
       or r.status is distinct from 'pending' then
    raise exception 'QF_COVERAGE_NOT_PENDING' using errcode='P0001';
  end if;
  if p_admin_id is not distinct from r.requested_by then
    raise exception 'QF_COVERAGE_SELF_APPROVAL' using errcode='42501';
  end if;
  select * into v from public.vendors where id=r.vendor_id for update;
  if not found then raise exception 'QF_COVERAGE_VENDOR_ABSENT'; end if;
  if r.current_snapshot is null
    or jsonb_typeof(r.current_snapshot)<>'object'
    or not (r.current_snapshot ?& array['city','service_categories'])
    or r.current_snapshot->'city' is distinct from to_jsonb(v.city)
    or r.current_snapshot->'service_categories' is distinct from to_jsonb(v.service_categories) then
    raise exception 'QF_COVERAGE_STALE' using errcode='P0001';
  end if;
  if r.proposed_changes is null
    or jsonb_typeof(r.proposed_changes)<>'object'
    or not (r.proposed_changes ?& array['requested_city','requested_categories'])
    or (select count(*) from jsonb_object_keys(r.proposed_changes))<>2
    or jsonb_typeof(r.proposed_changes->'requested_city')<>'string'
    or jsonb_typeof(r.proposed_changes->'requested_categories')<>'array' then
    raise exception 'QF_COVERAGE_BAD_REQUEST' using errcode='P0001';
  end if;
  v_city := trim(r.proposed_changes->>'requested_city');
  if v_city='' or length(v_city)>100 or
    lower(v_city) is distinct from lower(trim(v.city)) then
    raise exception 'QF_COVERAGE_CITY_MOVE_REQUIRES_SEPARATE_REVIEW' using errcode='P0001';
  end if;
  if jsonb_array_length(r.proposed_changes->'requested_categories') not between 1 and 8
    or exists(select 1 from jsonb_array_elements(r.proposed_changes->'requested_categories') e
      where jsonb_typeof(e)<>'string') then
    raise exception 'QF_COVERAGE_BAD_CATEGORIES' using errcode='P0001';
  end if;
  select array_agg(x) into v_categories
    from jsonb_array_elements_text(r.proposed_changes->'requested_categories') t(x);
  if cardinality(v_categories)<>cardinality(array(select distinct unnest(v_categories)))
    or exists(select 1 from unnest(v_categories) c
      where c not in (
        'Interior Designers','Carpenters','Modular Factory',
        'Premium Interiors','Sofa','Painter','Civil Work','False Ceiling'
      ))
    or v.selected_category is null
    or not(v.selected_category=any(v_categories)) then
    raise exception 'QF_COVERAGE_PRIMARY_CATEGORY_INVARIANT' using errcode='P0001';
  end if;

  -- This is intentionally stronger than city-fallback / provisional data:
  -- arbitrary typed city and coordinates cannot grant matching eligibility.
  if v.google_place_id is null or trim(v.google_place_id)=''
    or v.location_verification_status is distinct from 'verified'
    or v.location_verification_method is distinct from 'polygon'
    or v.office_latitude is null or v.office_longitude is null
    or v.office_latitude not between -90 and 90
    or v.office_longitude not between -180 and 180
    or v.service_zone_id is null then
    raise exception 'QF_COVERAGE_GOOGLE_AND_POLYGON_REQUIRED' using errcode='P0001';
  end if;
  select * into z from public.marketplace_service_zones where id=v.service_zone_id for update;
  if not found or z.is_active is distinct from true
    or z.matching_enabled is distinct from true
    or z.boundary is null
    or lower(trim(z.canonical_city)) is distinct from lower(v_city) then
    raise exception 'QF_COVERAGE_ZONE_UNREADY' using errcode='P0001';
  end if;
  if not extensions.st_isvalid(z.boundary)
    or not extensions.st_covers(z.boundary,
         extensions.st_setsrid(extensions.st_makepoint(v.office_longitude::double precision,
                                               v.office_latitude::double precision),4326)) then
    raise exception 'QF_COVERAGE_OUTSIDE_VERIFIED_POLYGON' using errcode='P0001';
  end if;

  update public.vendors
     set service_categories=v_categories
     where id=v.id;
  update public.vendor_profile_change_requests
     set status='approved',reviewed_by=p_admin_id,reviewed_at=now(),
         updated_at=now(),admin_notes=nullif(trim(p_notes),''),
         rejection_reason=null
     where id=r.id and status='pending' returning * into result;
  if not found then raise exception 'QF_COVERAGE_RACE'; end if;
  -- Existing audited decision trigger records the complete transaction.
  return result;
end
$body$;
revoke all on function public.qf_approve_vendor_verified_coverage_v1(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.qf_approve_vendor_verified_coverage_v1(uuid,uuid,text)
  to service_role;
commit;
