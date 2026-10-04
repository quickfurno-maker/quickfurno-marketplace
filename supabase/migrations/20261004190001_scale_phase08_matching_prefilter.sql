-- ============================================================================
-- SCALE-P08 — Database & Matching Scale Hardening
--
-- Purpose:
--   Replace the application-side UUID ordered 5,000-vendor scan with a bounded,
--   indexed PostgreSQL prefilter while preserving the existing TypeScript
--   eligibility/ranking contract and the transactional assignment authority.
--
-- Authority boundary:
--   * This function cannot assign a lead or move credits.
--   * It is READ ONLY / SECURITY INVOKER / service_role-only.
--   * The TypeScript matcher re-evaluates every returned vendor.
--   * public.qf_assign_lead_vendors_v2 remains the final transactional authority.
-- ============================================================================

begin;

create or replace function public.qf_match_normalize_label_v1(p_value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog, public, pg_temp
as $$
  with normalized as (
    select regexp_replace(
      replace(lower(btrim(p_value)), '&', ' and '),
      E'\\s+',
      ' ',
      'g'
    ) as value
  )
  select case
    when length(value) > 4 and right(value, 1) = 's' and right(value, 2) <> 'ss'
      then left(value, length(value) - 1)
    else value
  end
  from normalized;
$$;

revoke all on function public.qf_match_normalize_label_v1(text)
  from public, anon, authenticated;
grant execute on function public.qf_match_normalize_label_v1(text)
  to service_role;

create or replace function public.qf_matching_terms_v1(
  p_service_categories text[],
  p_selected_category text,
  p_selected_subcategories text[]
) returns text[]
language sql
immutable
parallel safe
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    array_agg(distinct public.qf_match_normalize_label_v1(term) order by public.qf_match_normalize_label_v1(term))
      filter (where nullif(btrim(term), '') is not null),
    '{}'::text[]
  )
  from unnest(
    coalesce(p_service_categories, '{}'::text[])
    || case when nullif(btrim(p_selected_category), '') is null
            then '{}'::text[] else array[p_selected_category] end
    || coalesce(p_selected_subcategories, '{}'::text[])
  ) as source(term);
$$;

revoke all on function public.qf_matching_terms_v1(text[],text,text[])
  from public, anon, authenticated;
grant execute on function public.qf_matching_terms_v1(text[],text,text[])
  to service_role;

alter table public.vendors
  add column if not exists matching_terms text[]
    generated always as (
      public.qf_matching_terms_v1(
        service_categories,
        selected_category,
        selected_subcategories
      )
    ) stored;

alter table public.vendors
  add column if not exists matching_city_key text
    generated always as (
      lower(
        coalesce(
          nullif(btrim(city), ''),
          nullif(btrim(office_city), ''),
          ''
        )
      )
    ) stored;

comment on column public.vendors.matching_terms is
  'SCALE-P08 generated normalized category vocabulary used only for indexed vendor discovery. Final category compatibility remains in lib/vendors/categoryMatching.ts.';
comment on column public.vendors.matching_city_key is
  'SCALE-P08 generated city fallback key mirroring leadMatchingEngine city priority: vendors.city then office_city.';

create index if not exists idx_vendors_matching_terms_gin
  on public.vendors using gin (matching_terms);

create index if not exists idx_vendors_auto_match_scope
  on public.vendors (service_zone_id, matching_city_key, id)
  where lower(btrim(coalesce(status, ''))) in ('approved','active')
    and is_active is distinct from false
    and accepting_leads is distinct from false
    and coalesce(remaining_credits, 0) >= 1
    and coalesce(location_verification_status, '') <> 'outside_service_area';

-- The fairness reader asks for recent delivered events by scope/vendor/time.
-- A partial covering index avoids carrying unrelated event types through that
-- hot path while retaining the canonical event ledger unchanged.
create index if not exists idx_vendor_opportunity_events_delivered_scope_recent
  on public.vendor_opportunity_events (scope_key, vendor_id, occurred_at desc)
  include (assignment_id)
  where event_type = 'delivered';

create or replace function public.qf_match_haversine_km_v1(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
) returns double precision
language sql
immutable
parallel safe
set search_path = pg_catalog, public, pg_temp
as $$
  select case
    when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null
      or p_lat1 < -90 or p_lat1 > 90 or p_lat2 < -90 or p_lat2 > 90
      or p_lng1 < -180 or p_lng1 > 180 or p_lng2 < -180 or p_lng2 > 180
      or (p_lat1 = 0 and p_lng1 = 0)
      or (p_lat2 = 0 and p_lng2 = 0)
    then null
    else round((
      6371.0 * 2.0 * atan2(
        sqrt(least(1.0, greatest(0.0,
          power(sin(radians(p_lat2 - p_lat1) / 2.0), 2)
          + cos(radians(p_lat1)) * cos(radians(p_lat2))
            * power(sin(radians(p_lng2 - p_lng1) / 2.0), 2)
        ))),
        sqrt(greatest(0.0, 1.0 - least(1.0, greatest(0.0,
          power(sin(radians(p_lat2 - p_lat1) / 2.0), 2)
          + cos(radians(p_lat1)) * cos(radians(p_lat2))
            * power(sin(radians(p_lng2 - p_lng1) / 2.0), 2)
        ))))
      )
    )::numeric, 3)::double precision
  end;
$$;

revoke all on function public.qf_match_haversine_km_v1(double precision,double precision,double precision,double precision)
  from public, anon, authenticated;
grant execute on function public.qf_match_haversine_km_v1(double precision,double precision,double precision,double precision)
  to service_role;

create or replace function public.qf_match_vendor_prefilter_v1(
  p_lead_id uuid,
  p_scope_key text,
  p_tier0_terms text[],
  p_tier1_terms text[],
  p_limit integer default 512
) returns table (vendor jsonb)
language sql
stable
security invoker
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  with
  lead_ctx as (
    select
      l.id,
      l.latitude,
      l.longitude,
      l.geo_point,
      lower(btrim(coalesce(l.city, ''))) as city_key,
      lower(btrim(coalesce(l.area, ''))) as area_key,
      l.service_zone_id,
      z.is_active as lead_zone_active,
      z.matching_enabled as lead_zone_matching_enabled,
      coalesce(z.requires_resolved_location, false) as lead_zone_strict
    from public.leads l
    left join public.marketplace_service_zones z on z.id = l.service_zone_id
    where l.id = p_lead_id
  ),
  terms as (
    select
      coalesce((
        select array_agg(distinct public.qf_match_normalize_label_v1(t))
        from unnest(coalesce(p_tier0_terms, '{}'::text[])) as x(t)
        where nullif(btrim(t), '') is not null
      ), '{}'::text[]) as tier0,
      coalesce((
        select array_agg(distinct public.qf_match_normalize_label_v1(t))
        from unnest(coalesce(p_tier1_terms, '{}'::text[])) as x(t)
        where nullif(btrim(t), '') is not null
      ), '{}'::text[]) as tier1
  ),
  recent_deliveries as (
    select
      d.vendor_id,
      count(*)::integer as delivered_7d
    from public.vendor_opportunity_events d
    where d.scope_key = p_scope_key
      and d.event_type = 'delivered'
      and d.occurred_at >= now() - interval '7 days'
      and not exists (
        select 1
        from public.vendor_opportunity_events restored
        where restored.assignment_id = d.assignment_id
          and restored.event_type = 'restored_bad_lead'
      )
    group by d.vendor_id
  ),
  base as (
    select
      v as vendor_row,
      case
        when v.matching_terms && t.tier0 then 0
        else 1
      end::smallint as match_tier,
      public.qf_match_haversine_km_v1(
        l.latitude,
        l.longitude,
        case
          when v.office_latitude is not null and v.office_longitude is not null
               and v.office_latitude between -90 and 90
               and v.office_longitude between -180 and 180
               and not (v.office_latitude = 0 and v.office_longitude = 0)
            then v.office_latitude::double precision
          when v.latitude is not null and v.longitude is not null
               and v.latitude between -90 and 90
               and v.longitude between -180 and 180
               and not (v.latitude = 0 and v.longitude = 0)
            then v.latitude::double precision
          else null
        end,
        case
          when v.office_latitude is not null and v.office_longitude is not null
               and v.office_latitude between -90 and 90
               and v.office_longitude between -180 and 180
               and not (v.office_latitude = 0 and v.office_longitude = 0)
            then v.office_longitude::double precision
          when v.latitude is not null and v.longitude is not null
               and v.latitude between -90 and 90
               and v.longitude between -180 and 180
               and not (v.latitude = 0 and v.longitude = 0)
            then v.longitude::double precision
          else null
        end
      ) as distance_km,
      case
        when nullif(l.area_key, '') is not null
          and exists (
            select 1
            from unnest(coalesce(v.areas_covered, '{}'::text[])) a(area_name)
            where lower(btrim(a.area_name)) = l.area_key
          ) then 1.0
        when v.covers_full_city is true then 0.5
        else 0.0
      end as area_affinity,
      greatest(-3.0, least(3.0, coalesce(f.fair_share_balance, 0)::double precision))
        as fair_share_balance,
      coalesce(recent.delivered_7d, 0)::integer as delivered_7d,
      case when f.vendor_id is not null then f.last_delivered_at else v.last_delivered_at end
        as last_delivered_at
    from lead_ctx l
    cross join terms t
    join public.vendors v
      on lower(btrim(coalesce(v.status, ''))) in ('approved','active')
     and v.is_active is distinct from false
     and v.accepting_leads is distinct from false
     and coalesce(v.remaining_credits, 0) >= 1
     and not (
       v.assignment_suspended_at is not null
       and (
         v.assignment_suspended_until is null
         or v.assignment_suspended_until > now()
       )
     )
     and coalesce(v.location_verification_status, '') <> 'outside_service_area'
     and (
       v.matching_terms && t.tier0
       or v.matching_terms && t.tier1
     )
    left join public.marketplace_service_zones vz on vz.id = v.service_zone_id
    left join public.vendor_opportunity_fairness f
      on f.vendor_id = v.id and f.scope_key = p_scope_key
    left join recent_deliveries recent on recent.vendor_id = v.id
    where
      (l.service_zone_id is null or l.lead_zone_active is distinct from false)
      and (l.service_zone_id is null or l.lead_zone_matching_enabled is distinct from false)
      and (v.service_zone_id is null or vz.id is null or (
        vz.is_active is true and vz.matching_enabled is true
      ))
      and (
        (
          l.service_zone_id is not null
          and v.service_zone_id is not null
          and l.service_zone_id = v.service_zone_id
        )
        or (
          (l.service_zone_id is null or v.service_zone_id is null)
          and not (
            (l.service_zone_id is not null and l.lead_zone_strict)
            or (v.service_zone_id is not null and coalesce(vz.requires_resolved_location, false))
          )
          and (
            l.city_key = ''
            or v.matching_city_key = l.city_key
          )
        )
      )
  ),
  ranked as (
    select
      b.*,
      case
        when b.distance_km is null then 4
        when b.distance_km <= 3 then 0
        when b.distance_km <= 7 then 1
        when b.distance_km <= 12 then 2
        else 3
      end as distance_band,
      case when b.distance_km is null then 0 else 1 end as has_coordinates
    from base b
  )
  select to_jsonb(r.vendor_row) as vendor
  from ranked r
  order by
    r.match_tier asc,
    case when (select geo_point is not null from lead_ctx) then r.has_coordinates else 1 end desc,
    case when (select geo_point is not null from lead_ctx) then r.distance_band else 0 end asc,
    r.fair_share_balance desc,
    r.delivered_7d asc,
    r.last_delivered_at asc nulls first,
    r.area_affinity desc,
    case when (select geo_point is not null from lead_ctx) then r.distance_km else 0 end asc nulls last,
    (r.vendor_row).id asc
  limit least(greatest(coalesce(p_limit, 512), 20), 2048);
$$;

comment on function public.qf_match_vendor_prefilter_v1(uuid,text,text[],text[],integer) is
  'SCALE-P08 bounded indexed discovery only. It cannot assign, debit credit, or replace canonical TypeScript eligibility/ranking. Returns a best candidate window using the same rank dimensions; Core re-evaluates and transactionally assigns.';

revoke all on function public.qf_match_vendor_prefilter_v1(uuid,text,text[],text[],integer)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_match_vendor_prefilter_v1(uuid,text,text[],text[],integer)
  to service_role;

-- Fail closed if this phase accidentally creates a competing mutation authority.
do $verify$
declare
  v_def text;
begin
  select pg_get_functiondef('public.qf_match_vendor_prefilter_v1(uuid,text,text[],text[],integer)'::regprocedure)
    into v_def;

  if v_def ~* '\m(insert|update|delete|merge|truncate)\M'
     or v_def ~* 'qf_assign_lead_vendors_v2'
     or v_def ~* 'qf_apply_vendor_credit_delta' then
    raise exception 'SCALE-P08 aborted: matching prefilter contains mutation/assignment authority.';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname='public'
      and tablename='vendors'
      and indexname='idx_vendors_matching_terms_gin'
      and indexdef ilike '%using gin%'
  ) then
    raise exception 'SCALE-P08 aborted: vendor matching GIN index missing.';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname='public'
      and tablename='vendors'
      and indexname='idx_vendors_geo_point_gist'
  ) then
    raise exception 'SCALE-P08 aborted: canonical vendor geography GiST index missing.';
  end if;
end;
$verify$;

commit;
