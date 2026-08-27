-- ============================================================================
-- QuickFurno — QF-MVP-75.02 — GEO NORMALIZATION + POSTGIS SHORTLIST FOUNDATION
--
-- PHASE
--   QF-MVP-75.02. Single migration. Forward-only. Additive only.
--
-- PURPOSE
--   Give QuickFurno a canonical, indexed WGS84 geography representation of the
--   coordinates it ALREADY stores, plus ONE bounded read-only PostGIS shortlist
--   seam that the automatic matcher can OBSERVE. Nothing here decides who is
--   assigned a lead.
--
-- WHAT THIS MIGRATION IS NOT — the QF-MVP-75.02 boundary.
--   * It is NOT a second assignment authority. public.qf_assign_lead_vendors_v2
--     (migration 20260815000000) remains the sole authority, untouched. This
--     file contains no INSERT, no UPDATE, no DELETE and no call into it.
--   * It is NOT an eligibility authority. public.qf_vendor_assignment_eligible
--     (migration 20260723000300) remains the sole hard gate, untouched. The
--     shortlist below applies NO eligibility predicate whatsoever, precisely so
--     it can never become a competing gate.
--   * It is NOT route distance or route time. ST_Distance over `geography` is a
--     STRAIGHT-LINE great-circle number. No Google, no Route Matrix, no
--     Distance Matrix, no HTTP, no geocoder.
--   * There is no H3 column, no GeoRegret, no route cache, no fairness model,
--     no primary/reserve lifecycle and no service-radius gate.
--   * It does not rewrite, backfill or alter one existing latitude/longitude
--     value. The two new columns are GENERATED ALWAYS ... STORED, derived from
--     the existing columns, so no write path can drift away from them.
--
-- THE CANONICAL COORDINATE CONTRACT IMPLEMENTED HERE
--   SRID 4326 (WGS84). latitude in [-90, 90]. longitude in [-180, 180]. A point
--   exists only when BOTH sides are present and in range, and the pair is not
--   the (0, 0) null island. That last rule is not invented here: it is the
--   EXISTING runtime rule in lib/geo/distance.ts `isValidCoordinate`, which the
--   automatic matcher has always used, and the SQL half must agree with the
--   TypeScript half or the two would disagree about which vendors have a usable
--   coordinate. A one-sided pair, an out-of-range value, a numeric 'NaN' and a
--   float 'Infinity' all normalize to NULL rather than to a wrong point: in
--   PostgreSQL both numeric NaN and float8 NaN/Infinity sort ABOVE every finite
--   value, so the plain `between` range test rejects them.
--   Point construction is ST_MakePoint(longitude, latitude) — X then Y, never
--   swapped.
--
-- COORDINATE SOURCES — source-proven, not chosen here.
--   leads   : public.leads.latitude / longitude   (double precision,
--             migration 20260704000040). This is the only lead coordinate the
--             matcher reads today.
--   vendors : public.vendors.office_latitude / office_longitude (numeric,
--             migration 20260624000011) preferred, falling back to the legacy
--             public.vendors.latitude / longitude (numeric, migration
--             20260624000010) ONLY when the office pair is not usable. That is
--             exactly `resolveVendorCoordinates` in services/leadMatchingEngine.
--             public.vendors.base_latitude / base_longitude (migration
--             20260622000007) are deliberately NOT used: no runtime path reads
--             them, and they are absent from the QuickFurno Staging baseline.
--   google_place_id stays provenance/identity metadata on both tables. It is
--   never a distance input. Pincode is never a matching authority.
--
-- EXTENSION CONVENTION
--   Verified against QuickFurno Staging (project uckafzuochmbvtiodmcl,
--   PostgreSQL 17.6) on 2026-08-27: `postgis` 3.3.7 is AVAILABLE but NOT
--   installed, and every installed non-core extension on this platform lives in
--   the `extensions` schema (pgcrypto -> extensions, uuid-ossp -> extensions).
--   This migration therefore installs PostGIS into `extensions` and qualifies
--   every PostGIS reference. If PostGIS is already installed in some OTHER
--   schema this migration ABORTS rather than guessing, relocating an extension
--   other work may depend on, or silently writing unqualified DDL that would
--   resolve differently at a later search_path.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. PostGIS availability, in the accepted extension schema.
--
--    The guarded `if not exists (select 1 from pg_extension ...)` shape is the
--    established repository pattern (migration 20260808500000, section STATE A).
-- ---------------------------------------------------------------------------
do $postgis$
declare
  v_schema text;
begin
  select n.nspname
    into v_schema
    from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'postgis';

  if v_schema is null then
    raise notice 'QF-MVP-75.02: installing postgis into the extensions schema.';
    execute $ddl$ create extension "postgis" with schema extensions $ddl$;
  elsif v_schema <> 'extensions' then
    raise exception
      'QF-MVP-75.02 aborted: postgis is installed in schema %, not extensions. This phase refuses to relocate an existing extension or to emit DDL that would resolve differently at another search_path. Resolve the extension schema out of band and re-run.',
      v_schema
      using errcode = 'P0001';
  else
    raise notice 'QF-MVP-75.02: postgis already present in the extensions schema. NO-OP.';
  end if;
end;
$postgis$;

-- ---------------------------------------------------------------------------
-- 2. Lead canonical geography — nullable, generated, stored, indexed.
--
--    GENERATED ALWAYS ... STORED is deliberate: it makes the coordinate
--    contract unwritable and therefore undriftable. There is no application
--    write path to keep in step, and a historical row whose coordinates are
--    missing, one-sided or out of range yields NULL instead of failing the
--    migration.
-- ---------------------------------------------------------------------------
alter table public.leads
  add column if not exists geo_point extensions.geography(Point, 4326)
    generated always as (
      case
        when latitude  is not null
         and longitude is not null
         and latitude  between -90  and 90
         and longitude between -180 and 180
         and not (latitude = 0 and longitude = 0)
        then extensions.ST_SetSRID(
               extensions.ST_MakePoint(longitude, latitude), 4326
             )::extensions.geography(Point, 4326)
        else null
      end
    ) stored;

comment on column public.leads.geo_point is
  'QF-MVP-75.02 canonical WGS84 lead point, GENERATED from public.leads.latitude/longitude. NULL whenever the pair is missing, one-sided, out of range or the (0,0) null island — mirroring lib/geo/distance.isValidCoordinate. ST_MakePoint(longitude, latitude). Straight-line discovery evidence only; never an assignment or eligibility authority.';

create index if not exists idx_leads_geo_point_gist
  on public.leads using gist (geo_point);

-- ---------------------------------------------------------------------------
-- 3. Vendor canonical geography — office coordinates, then the legacy pair.
--
--    The two-branch CASE is the SQL statement of the SAME priority the runtime
--    already applies in services/leadMatchingEngine.resolveVendorCoordinates:
--    office first, legacy only when the office pair is not usable, otherwise no
--    point at all. The numeric -> double precision casts are required because
--    these four columns are `numeric` while ST_MakePoint takes double
--    precision; both the cast and ST_MakePoint are IMMUTABLE, which is what a
--    generated column requires.
-- ---------------------------------------------------------------------------
alter table public.vendors
  add column if not exists geo_point extensions.geography(Point, 4326)
    generated always as (
      case
        when office_latitude  is not null
         and office_longitude is not null
         and office_latitude  between -90  and 90
         and office_longitude between -180 and 180
         and not (office_latitude = 0 and office_longitude = 0)
        then extensions.ST_SetSRID(
               extensions.ST_MakePoint(
                 office_longitude::double precision,
                 office_latitude::double precision
               ), 4326
             )::extensions.geography(Point, 4326)
        when latitude  is not null
         and longitude is not null
         and latitude  between -90  and 90
         and longitude between -180 and 180
         and not (latitude = 0 and longitude = 0)
        then extensions.ST_SetSRID(
               extensions.ST_MakePoint(
                 longitude::double precision,
                 latitude::double precision
               ), 4326
             )::extensions.geography(Point, 4326)
        else null
      end
    ) stored;

comment on column public.vendors.geo_point is
  'QF-MVP-75.02 canonical WGS84 vendor point, GENERATED from office_latitude/office_longitude with the legacy latitude/longitude pair as fallback — exactly services/leadMatchingEngine.resolveVendorCoordinates. base_latitude/base_longitude are deliberately NOT a source. NULL when no pair is usable. Never an eligibility gate; service_radius_km is NOT applied here.';

create index if not exists idx_vendors_geo_point_gist
  on public.vendors using gist (geo_point);

-- ---------------------------------------------------------------------------
-- 4. The bounded read-only geo shortlist.
--
--    CONTRACT
--      * READ ONLY. No write of any kind, no credit movement, no assignment, no
--        matching-run row, no call into public.qf_assign_lead_vendors_v2.
--      * DISCOVERY ONLY. It returns vendor ids and STRAIGHT-LINE kilometres. It
--        is not a candidate list, not an eligibility verdict and not a ranking.
--      * NO ELIGIBILITY PREDICATE. Deliberately none — not status, not
--        accepting_leads, not credits, not city, not category, not package and
--        not paid status. A shortlist that filtered on any of those would be a
--        second eligibility authority, which QF-MVP-75.02 forbids.
--      * BOUNDED. p_limit is clamped into [1, 20]. 20 is not invented here: it
--        is MAX_CANONICAL_CANDIDATE_POOL, the existing transport ceiling on the
--        candidate pool the authority can ever be handed, so the evidence window
--        can never be wider than the pool itself.
--      * DETERMINISTIC. Ordering is (sphere distance ASC, vendor id ASC) and the
--        tiebreak is INSIDE the bounded scan, so two vendors sharing a
--        coordinate — common when both carry a city-centroid point — cannot make
--        the boundary of the result set arbitrary.
--      * INDEXED. The KNN operator `<->` over geography drives the bounded scan
--        against idx_vendors_geo_point_gist.
--
--    DISTANCE MODEL
--      `<->` on geography is the SPHERE distance in metres. ST_Distance's third
--      argument use_spheroid is therefore passed FALSE, so the number reported
--      is computed on the SAME model the ordering used and rank position is
--      monotone in the reported distance. It is close to, but not bit-identical
--      with, the R=6371 haversine in lib/geo/distance.ts, and it is NEVER a
--      ranking input: MatchCore continues to rank on its own haversine.
--
--    SECURITY
--      STABLE and SECURITY INVOKER, following the established read-only helper
--      precedent public.qf_vendor_assignment_eligible (migration
--      20260723000300, section 1). It grants no privilege of its own and is
--      reachable only by a role that can already read both tables. SECURITY
--      DEFINER is not necessary and is therefore not used. search_path is
--      pinned; `extensions` is present in it solely so the PostGIS type,
--      functions and the `<->` operator resolve.
-- ---------------------------------------------------------------------------
create or replace function public.qf_geo_vendor_shortlist_v1(
  p_lead_id uuid,
  p_limit   integer
) returns table (
  vendor_id                 uuid,
  straight_line_distance_km double precision,
  shortlist_rank            integer
)
  language plpgsql
  stable
  security invoker
  set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_lead_geo extensions.geography(Point, 4326);
  v_limit    integer;
begin
  if p_lead_id is null then
    return;
  end if;

  v_limit := least(greatest(coalesce(p_limit, 20), 1), 20);

  select l.geo_point
    into v_lead_geo
    from public.leads l
   where l.id = p_lead_id;

  -- No valid lead coordinate is a NORMAL, TYPED outcome, never an error: the
  -- caller reads zero rows and takes the deterministic city path.
  if v_lead_geo is null then
    return;
  end if;

  return query
    select k.id,
           round(
             (extensions.ST_Distance(k.geo_point, v_lead_geo, false) / 1000.0)::numeric,
             3
           )::double precision,
           (row_number() over (
              order by extensions.ST_Distance(k.geo_point, v_lead_geo, false), k.id
            ))::integer
      from (
        select v.id, v.geo_point
          from public.vendors v
         where v.geo_point is not null
         order by v.geo_point operator(extensions.<->) v_lead_geo, v.id
         limit v_limit
      ) k
     order by extensions.ST_Distance(k.geo_point, v_lead_geo, false), k.id;
end;
$$;

comment on function public.qf_geo_vendor_shortlist_v1(uuid, integer) is
  'QF-MVP-75.02 bounded READ-ONLY PostGIS geo shortlist. Returns at most 20 vendors that hold a canonical geography point, nearest first by STRAIGHT-LINE sphere distance, with a deterministic vendor-id tiebreak. Applies NO eligibility predicate and is NOT an assignment authority: it writes nothing, moves no credit and never calls public.qf_assign_lead_vendors_v2. The distance is straight-line discovery evidence and must never be presented as route distance or route time.';

-- ---------------------------------------------------------------------------
-- 5. ACL — service_role only, matching every canonical QuickFurno RPC.
-- ---------------------------------------------------------------------------
revoke all on function public.qf_geo_vendor_shortlist_v1(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.qf_geo_vendor_shortlist_v1(uuid, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Self-verification — fail closed on any deviation from the contract above.
-- ---------------------------------------------------------------------------
do $verify$
declare
  c_sig   constant text := 'public.qf_geo_vendor_shortlist_v1(uuid, integer)';
  v_oid   oid;
  v_def   text;
  v_table text;
  v_kind  "char";
begin
  -- 6.1 PostGIS present, in the accepted extension schema.
  if not exists (
    select 1
      from pg_catalog.pg_extension e
      join pg_catalog.pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'postgis' and n.nspname = 'extensions'
  ) then
    raise exception
      'QF-MVP-75.02 aborted: postgis is not installed in the extensions schema.';
  end if;

  -- 6.2 both geography columns exist, are GENERATED STORED, and carry the exact
  --     geography(Point,4326) type. attgenerated = 's' is the stored-generated
  --     marker; anything else means a plain writable column slipped in.
  foreach v_table in array array['leads', 'vendors'] loop
    select a.attgenerated
      into v_kind
      from pg_catalog.pg_attribute a
     where a.attrelid = ('public.' || v_table)::regclass
       and a.attname  = 'geo_point'
       and not a.attisdropped;

    if v_kind is null then
      raise exception 'QF-MVP-75.02 aborted: public.%.geo_point is missing.', v_table;
    end if;
    if v_kind <> 's' then
      raise exception
        'QF-MVP-75.02 aborted: public.%.geo_point is not a STORED generated column, so a write path could drift from the canonical coordinate contract.',
        v_table;
    end if;
    if (select pg_catalog.format_type(a.atttypid, a.atttypmod)
          from pg_catalog.pg_attribute a
         where a.attrelid = ('public.' || v_table)::regclass
           and a.attname = 'geo_point') not like '%geography(Point,4326)%' then
      raise exception
        'QF-MVP-75.02 aborted: public.%.geo_point is not geography(Point,4326).', v_table;
    end if;
  end loop;

  -- 6.3 a GiST index exists on each geography column.
  if not exists (
    select 1 from pg_catalog.pg_class i
      join pg_catalog.pg_index x  on x.indexrelid = i.oid
      join pg_catalog.pg_am    am on am.oid = i.relam
     where x.indrelid = 'public.leads'::regclass
       and am.amname = 'gist'
       and pg_catalog.pg_get_indexdef(i.oid) like '%geo_point%'
  ) then
    raise exception 'QF-MVP-75.02 aborted: no GiST index on public.leads.geo_point.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class i
      join pg_catalog.pg_index x  on x.indexrelid = i.oid
      join pg_catalog.pg_am    am on am.oid = i.relam
     where x.indrelid = 'public.vendors'::regclass
       and am.amname = 'gist'
       and pg_catalog.pg_get_indexdef(i.oid) like '%geo_point%'
  ) then
    raise exception 'QF-MVP-75.02 aborted: no GiST index on public.vendors.geo_point.';
  end if;

  -- 6.4 the shortlist exists with the exact frozen signature, is READ-ONLY by
  --     volatility, is SECURITY INVOKER and pins search_path.
  v_oid := to_regprocedure(c_sig);
  if v_oid is null then
    raise exception 'QF-MVP-75.02 aborted: % is missing.', c_sig;
  end if;
  if (select p.provolatile from pg_catalog.pg_proc p where p.oid = v_oid) <> 's' then
    raise exception 'QF-MVP-75.02 aborted: % must be STABLE (read-only).', c_sig;
  end if;
  if (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_oid) then
    raise exception
      'QF-MVP-75.02 aborted: % must be SECURITY INVOKER. A read-only discovery seam needs no elevated privilege.',
      c_sig;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p, unnest(coalesce(p.proconfig, array[]::text[])) cfg
     where p.oid = v_oid and cfg like 'search_path=%'
  ) then
    raise exception 'QF-MVP-75.02 aborted: % does not pin search_path.', c_sig;
  end if;

  -- 6.5 ACL: service_role yes, PUBLIC / anon / authenticated no.
  if has_function_privilege('public', v_oid, 'EXECUTE')
     or has_function_privilege('anon', v_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception
      'QF-MVP-75.02 aborted: % is executable by PUBLIC, anon or authenticated.', c_sig;
  end if;
  if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'QF-MVP-75.02 aborted: service_role cannot execute %.', c_sig;
  end if;
  if not exists (
    select 1
      from pg_catalog.pg_proc p,
           aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = v_oid
       and a.privilege_type = 'EXECUTE'
       and a.grantee <> 0
       and pg_catalog.pg_get_userbyid(a.grantee) = 'service_role'
  ) then
    raise exception
      'QF-MVP-75.02 aborted: % holds no explicit service_role EXECUTE entry.', c_sig;
  end if;

  -- 6.6 the shortlist body writes nothing and reaches no authority.
  select pg_catalog.pg_get_functiondef(v_oid) into v_def;
  if v_def ~* '\minsert\s+into\M'
     or v_def ~* '\mupdate\s+public\.'
     or v_def ~* '\mdelete\s+from\M'
     or v_def ~* '\mmerge\s+into\M'
     or v_def ~* '\mtruncate\M' then
    raise exception
      'QF-MVP-75.02 aborted: % contains a write statement. The shortlist is read-only.', c_sig;
  end if;
  if v_def ~* 'qf_assign_lead_vendors_v2'
     or v_def ~* 'qf_apply_credit_mutation_v2'
     or v_def ~* 'lead_assignments'
     or v_def ~* 'lead_matching_runs'
     or v_def ~* 'vendor_credit'
     or v_def ~* 'remaining_credits' then
    raise exception
      'QF-MVP-75.02 aborted: % reaches assignment, credit or matching-run state. It is discovery only.', c_sig;
  end if;
  if v_def ~* 'package_status'
     or v_def ~* 'paid_status'
     or v_def ~* 'service_radius_km'
     or v_def ~* 'accepting_leads' then
    raise exception
      'QF-MVP-75.02 aborted: % applies a commercial or eligibility predicate. It must apply none.', c_sig;
  end if;

  -- 6.7 the canonical assignment authority and the canonical eligibility helper
  --     are untouched by this phase and still exist exactly as frozen.
  if to_regprocedure('public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)') is null then
    raise exception
      'QF-MVP-75.02 aborted: the canonical assignment authority is missing. QF-MVP-75.02 must never run without it.';
  end if;
  if to_regprocedure('public.qf_vendor_assignment_eligible(uuid, uuid, integer)') is null then
    raise exception
      'QF-MVP-75.02 aborted: the canonical eligibility helper is missing.';
  end if;

  raise notice 'QF-MVP-75.02 geo foundation verified: postgis in extensions, two generated geography columns, two GiST indexes, one read-only service_role-only shortlist.';
end;
$verify$;
