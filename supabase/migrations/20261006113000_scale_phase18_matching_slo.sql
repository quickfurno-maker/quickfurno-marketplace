-- ============================================================================
-- SCALE-P18 — Matching latency SLO hardening
--
-- Inline the exact spherical distance calculation inside the ranked SQL query
-- so the 100k/1M hot path avoids one SQL-function invocation per candidate.
-- Assignment, fairness, credit, category and final Core authority are unchanged.
-- ============================================================================

begin;
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
  candidate_ids as materialized (
    -- Fast path: when both sides carry a resolved zone, keep the zone equality
    -- as an indexable equality instead of hiding it inside an OR expression.
    -- This is the dominant production path and lets PostgreSQL combine the
    -- partial service-zone B-tree with the matching-terms GIN index.
    select
      v.id,
      v.matching_terms,
      v.office_latitude,
      v.office_longitude,
      v.latitude,
      v.longitude,
      v.areas_covered,
      v.covers_full_city,
      v.last_delivered_at
    from lead_ctx l
    cross join terms t
    join public.vendors v
      on l.service_zone_id is not null
     and v.service_zone_id = l.service_zone_id
     and lower(btrim(coalesce(v.status, ''))) in ('approved','active')
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
     and v.matching_terms && (t.tier0 || t.tier1)
    where l.lead_zone_active is distinct from false
      and l.lead_zone_matching_enabled is distinct from false

    union all

    -- Compatibility path for unresolved/null-zone records. This branch is
    -- disjoint from the resolved-zone branch, preserving the original strict
    -- zone/city fallback rules without forcing the hot branch through an OR.
    select
      v.id,
      v.matching_terms,
      v.office_latitude,
      v.office_longitude,
      v.latitude,
      v.longitude,
      v.areas_covered,
      v.covers_full_city,
      v.last_delivered_at
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
     and v.matching_terms && (t.tier0 || t.tier1)
    left join public.marketplace_service_zones vz on vz.id = v.service_zone_id
    where (l.service_zone_id is null or v.service_zone_id is null)
      and (l.service_zone_id is null or l.lead_zone_active is distinct from false)
      and (l.service_zone_id is null or l.lead_zone_matching_enabled is distinct from false)
      and (v.service_zone_id is null or vz.id is null or (
        vz.is_active is true and vz.matching_enabled is true
      ))
      and not (
        (l.service_zone_id is not null and l.lead_zone_strict)
        or (v.service_zone_id is not null and coalesce(vz.requires_resolved_location, false))
      )
      and (
        l.city_key = ''
        or v.matching_city_key = l.city_key
      )
  ),
  base as (
    select
      c.id as vendor_id,
      case
        when c.matching_terms && t.tier0 then 0
        else 1
      end::smallint as match_tier,
      case
        when l.latitude is null or l.longitude is null
          or l.latitude < -90 or l.latitude > 90
          or l.longitude < -180 or l.longitude > 180
          or (l.latitude = 0 and l.longitude = 0)
          or coords.vendor_latitude is null
          or coords.vendor_longitude is null
        then null
        else round((
          6371.0 * 2.0 * asin(
            sqrt(least(1.0, greatest(0.0,
              power(sin(radians(coords.vendor_latitude - l.latitude) / 2.0), 2)
              + cos(radians(l.latitude)) * cos(radians(coords.vendor_latitude))
                * power(sin(radians(coords.vendor_longitude - l.longitude) / 2.0), 2)
            )))
          )
        )::numeric, 3)::double precision
      end as distance_km,
      case
        when nullif(l.area_key, '') is not null
          and exists (
            select 1
            from unnest(coalesce(c.areas_covered, '{}'::text[])) a(area_name)
            where lower(btrim(a.area_name)) = l.area_key
          ) then 1.0
        when c.covers_full_city is true then 0.5
        else 0.0
      end as area_affinity,
      greatest(-3.0, least(3.0, coalesce(f.fair_share_balance, 0)::double precision))
        as fair_share_balance,
      coalesce(recent.delivered_7d, 0)::integer as delivered_7d,
      case when f.vendor_id is not null then f.last_delivered_at else c.last_delivered_at end
        as last_delivered_at
    from lead_ctx l
    cross join terms t
    join candidate_ids c on true
    cross join lateral (
      select
        case
          when c.office_latitude is not null and c.office_longitude is not null
               and c.office_latitude between -90 and 90
               and c.office_longitude between -180 and 180
               and not (c.office_latitude = 0 and c.office_longitude = 0)
            then c.office_latitude::double precision
          when c.latitude is not null and c.longitude is not null
               and c.latitude between -90 and 90
               and c.longitude between -180 and 180
               and not (c.latitude = 0 and c.longitude = 0)
            then c.latitude::double precision
          else null
        end as vendor_latitude,
        case
          when c.office_latitude is not null and c.office_longitude is not null
               and c.office_latitude between -90 and 90
               and c.office_longitude between -180 and 180
               and not (c.office_latitude = 0 and c.office_longitude = 0)
            then c.office_longitude::double precision
          when c.latitude is not null and c.longitude is not null
               and c.latitude between -90 and 90
               and c.longitude between -180 and 180
               and not (c.latitude = 0 and c.longitude = 0)
            then c.longitude::double precision
          else null
        end as vendor_longitude
    ) coords
    left join public.vendor_opportunity_fairness f
      on f.vendor_id = c.id and f.scope_key = p_scope_key
    left join recent_deliveries recent on recent.vendor_id = c.id
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
  ),
  top_candidates as materialized (
    -- Keep the expensive sort narrow. Carrying the complete vendors composite
    -- through a tens-of-thousands-row sort made performance depend heavily on
    -- row width and runner memory. Rank only IDs/scalars, limit to the bounded
    -- window, and fetch/JSON-encode full vendor rows afterwards.
    select
      r.vendor_id,
      r.match_tier,
      r.has_coordinates,
      r.distance_band,
      r.fair_share_balance,
      r.delivered_7d,
      r.last_delivered_at,
      r.area_affinity,
      r.distance_km
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
      r.vendor_id asc
    limit least(greatest(coalesce(p_limit, 512), 20), 2048)
  )
  select to_jsonb(v) as vendor
  from top_candidates r
  join public.vendors v on v.id = r.vendor_id
  order by
    r.match_tier asc,
    case when (select geo_point is not null from lead_ctx) then r.has_coordinates else 1 end desc,
    case when (select geo_point is not null from lead_ctx) then r.distance_band else 0 end asc,
    r.fair_share_balance desc,
    r.delivered_7d asc,
    r.last_delivered_at asc nulls first,
    r.area_affinity desc,
    case when (select geo_point is not null from lead_ctx) then r.distance_km else 0 end asc nulls last,
    r.vendor_id asc;
$$;


comment on function public.qf_match_vendor_prefilter_v1(uuid,text,text[],text[],integer) is
  'SCALE-P18 bounded indexed discovery with inlined spherical distance calculation; transactional assignment and Core re-evaluation remain unchanged.';

commit;
