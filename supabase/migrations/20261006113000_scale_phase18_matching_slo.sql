-- ============================================================================
-- SCALE-P18 — Matching latency SLO hardening
--
-- Purpose:
--   Preserve the exact spherical straight-line distance semantics used by the
--   Phase 08 prefilter while removing duplicate trigonometric work and numeric
--   casting from the hot 100k/1M candidate-ranking path.
--
-- Authority:
--   Read-only helper only. Assignment, fairness mutation and credit movement
--   remain under the existing transactional Core authority.
-- ============================================================================

begin;

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
    else
      floor((
        6371.0 * 2.0 * asin(
          sqrt(
            least(
              1.0,
              greatest(
                0.0,
                power(sin(radians(p_lat2 - p_lat1) / 2.0), 2)
                + cos(radians(p_lat1)) * cos(radians(p_lat2))
                  * power(sin(radians(p_lng2 - p_lng1) / 2.0), 2)
              )
            )
          )
        )
      ) * 1000.0 + 0.5) / 1000.0
  end;
$$;

comment on function public.qf_match_haversine_km_v1(
  double precision,double precision,double precision,double precision
) is
  'SCALE-P18 optimized spherical straight-line distance helper. Same 1m-rounded km contract; avoids duplicate haversine evaluation on the 100k/1M matching hot path.';

revoke all on function public.qf_match_haversine_km_v1(
  double precision,double precision,double precision,double precision
) from public, anon, authenticated;
grant execute on function public.qf_match_haversine_km_v1(
  double precision,double precision,double precision,double precision
) to service_role;

commit;
