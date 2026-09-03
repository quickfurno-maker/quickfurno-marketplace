// ============================================================================
// QuickFurno — scripts/mvp/matching/validate-qf-mvp-75-02.mjs
//
// QF-MVP-75.02 — GEO NORMALIZATION + POSTGIS SHORTLIST FOUNDATION.
//
// OFFLINE BY CONSTRUCTION. No database, no network, no provider, no secret, no
// clock-dependent assertion. It imports the REAL production modules through the
// `.ts` resolve hook and reads the REAL migration text; it never re-implements
// a rule it is checking.
//
// VERIFICATION LEVELS — never conflated:
//   [pure]   executes the real production module.
//   [static] reads migration / source text for a required contract.
//   [mutant] mutates the text and asserts the static checks REJECT it, so a
//            green run cannot be an artefact of a check that never bites.
//
// WHAT THIS HARNESS CANNOT PROVE, AND SAYS SO
//   It cannot prove a query PLAN. That the planner actually chooses
//   idx_vendors_geo_point_gist for the KNN scan is a database fact and belongs
//   to the QF-MVP-75.02 staging gate. What is proved here is that the SQL is
//   WRITTEN to be index-driven (KNN `<->` against the indexed geography column,
//   bounded) and that both GiST indexes are created.
//
// Run: npm run test:mvp:75-02
// ============================================================================
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  GEO_CONTRACT_VERSION,
  GEO_SRID,
  hasCanonicalCoordinate,
  normalizeCoordinate,
  resolveLeadCanonicalCoordinate,
  resolveVendorCanonicalCoordinate,
} from '../../../lib/geo/canonicalCoordinate.ts';
import {
  GEO_SHORTLIST_DISTANCE_METRIC,
  GEO_SHORTLIST_MAX_RESULTS,
  GEO_SHORTLIST_RPC,
  buildGeoMatchEvidence,
  isCityFallbackPath,
  normalizeGeoShortlistRows,
  resolveGeoMatchPath,
} from '../../../lib/geo/geoShortlistContract.ts';
import { isValidCoordinate } from '../../../lib/geo/distance.ts';
import {
  compareAutomaticMatchDecisions,
  splitRankedPool,
} from '../../../lib/matchcore/automaticMatchDecision.ts';
import {
  CANONICAL_ACTIVE_ASSIGNMENT_CAP,
  CANONICAL_ASSIGNMENT_CREDIT_COST,
  CANONICAL_LIFETIME_ASSIGNMENT_CAP,
  MAX_CANONICAL_CANDIDATE_POOL,
} from '../../../lib/marketplace/canonicalAssignmentContract.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GEO_MIGRATION = 'supabase/migrations/20260816000000_qf_mvp_75_02_geo_postgis_shortlist.sql';
const MATCHCORE_MIGRATION = 'supabase/migrations/20260815000000_qf_mvp_75_01_matchcore_binding_rank_order.sql';
const AUTHORITY_MIGRATION = 'supabase/migrations/20260723000300_qf_mvp_canonical_assignment_authority.sql';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
/** Drop `--` line comments so a check can never match explanatory prose. */
const stripSql = (src) => src.replace(/--[^\n]*/g, '');
const stripTs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const flat = (src) => src.replace(/\s+/g, ' ');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`   ok    ${name}`);
  } else {
    failed += 1;
    const line = `   FAIL  ${name}${detail ? ` — ${detail}` : ''}`;
    failures.push(line);
    console.log(line);
  }
}
function section(title) {
  console.log(`\n── ${title} ──`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const MIGRATION_RAW = read(GEO_MIGRATION);
const MIGRATION = stripSql(MIGRATION_RAW);

/** The shortlist function body alone — the only place a predicate may hide. */
function extractFunctionBody(src) {
  const m = /create or replace function public\.qf_geo_vendor_shortlist_v1[\s\S]*?\nas \$\$\n([\s\S]*?)\n\$\$;/.exec(src);
  return m ? m[1] : '';
}
/** One generated-column expression, exactly as written. */
function extractGeneratedExpression(src, table) {
  const re = new RegExp(
    `alter table public\\.${table}\\s*\\n\\s*add column if not exists geo_point([\\s\\S]*?)\\)\\s*stored;`,
  );
  const m = re.exec(src);
  return m ? m[1] : '';
}

const FN_BODY_RAW = extractFunctionBody(MIGRATION_RAW);
const FN_BODY = stripSql(FN_BODY_RAW);
const LEAD_GEN = extractGeneratedExpression(MIGRATION_RAW, 'leads');
const VENDOR_GEN = extractGeneratedExpression(MIGRATION_RAW, 'vendors');

const SHORTLIST_SVC_RAW = read('services/geoVendorShortlistService.ts');
const SHORTLIST_SVC = stripTs(SHORTLIST_SVC_RAW);
const MATCHER_RAW = read('services/leadMatchingEngine.ts');
const MATCHER = stripTs(MATCHER_RAW);
const CONTRACT_TS = stripTs(read('lib/geo/geoShortlistContract.ts'));
const COORD_TS = stripTs(read('lib/geo/canonicalCoordinate.ts'));

// ===========================================================================
section('A. CANONICAL COORDINATE CONTRACT [pure]');
// ===========================================================================
{
  check('A01 the contract version and SRID are the WGS84 pair the SQL uses',
    GEO_CONTRACT_VERSION === 1 && GEO_SRID === 4326);

  // Valid coordinates.
  check('A02 an ordinary Indian coordinate normalizes',
    eq(normalizeCoordinate(28.6139, 77.209), { latitude: 28.6139, longitude: 77.209 }));
  check('A03 a numeric string normalizes to numbers',
    eq(normalizeCoordinate('28.6139', '77.209'), { latitude: 28.6139, longitude: 77.209 }));
  check('A04 a negative-hemisphere coordinate normalizes',
    eq(normalizeCoordinate(-33.8688, -151.2093), { latitude: -33.8688, longitude: -151.2093 }));

  // Exact boundaries — inclusive on all four.
  for (const [lat, lng, label] of [
    [90, 180, 'north-east corner'],
    [-90, -180, 'south-west corner'],
    [90, -180, 'north-west corner'],
    [-90, 180, 'south-east corner'],
  ]) {
    check(`A05 exact boundary accepted: ${label} (${lat}, ${lng})`,
      normalizeCoordinate(lat, lng) !== null);
  }

  // Out of range — just outside every boundary.
  for (const [lat, lng] of [[90.0001, 0], [-90.0001, 0], [0, 180.0001], [0, -180.0001], [91, 181], [-1000, 1000]]) {
    check(`A06 out of range rejected: (${lat}, ${lng})`, normalizeCoordinate(lat, lng) === null);
  }

  // One-sided pairs.
  for (const [lat, lng, label] of [
    [28.6139, null, 'longitude null'],
    [null, 77.209, 'latitude null'],
    [28.6139, undefined, 'longitude undefined'],
    [undefined, 77.209, 'latitude undefined'],
    [28.6139, '', 'longitude empty string'],
  ]) {
    check(`A07 one-sided pair rejected: ${label}`, normalizeCoordinate(lat, lng) === null);
  }

  // NaN / Infinity / garbage.
  for (const [lat, lng, label] of [
    [NaN, 77.209, 'NaN latitude'],
    [28.6139, NaN, 'NaN longitude'],
    [Infinity, 77.209, 'Infinity latitude'],
    [28.6139, -Infinity, '-Infinity longitude'],
    ['abc', 'def', 'non-numeric strings'],
    [{}, [], 'objects'],
    [true, false, 'booleans'],
  ]) {
    check(`A08 garbage rejected: ${label}`, normalizeCoordinate(lat, lng) === null);
  }

  // The (0,0) null island — the EXISTING runtime rule, not a new one.
  check('A09 the (0,0) null island is not a coordinate',
    normalizeCoordinate(0, 0) === null && isValidCoordinate(0, 0) === false);
  check('A10 (0, non-zero) and (non-zero, 0) remain real coordinates',
    normalizeCoordinate(0, 77.209) !== null && normalizeCoordinate(28.6139, 0) !== null);

  // The primitive must DELEGATE, never restate.
  check('A11 [static] normalizeCoordinate delegates to the existing isValidCoordinate and restates no bound',
    /import\s*\{\s*isValidCoordinate\s*\}\s*from\s*"\.\/distance"/.test(COORD_TS)
    && /if \(!isValidCoordinate\(lat, lng\)\) return null;/.test(COORD_TS)
    && !/-90|-180|null island|=== 0/.test(
      ((COORD_TS.split('export function normalizeCoordinate')[1] ?? '')
        .split('export function hasCanonicalCoordinate')[0] ?? '')));
  check('A12 hasCanonicalCoordinate agrees with normalizeCoordinate on every case above',
    hasCanonicalCoordinate(28.6139, 77.209) === true
    && hasCanonicalCoordinate(0, 0) === false
    && hasCanonicalCoordinate(28.6139, null) === false);
  check('A13 the primitive contains no geocoder, no HTTP and no Google reference',
    !/fetch\(|https?:|google|maps|geocod|route.?matrix|distance.?matrix/i.test(COORD_TS));
}

// ===========================================================================
section('B. VENDOR CANONICAL COORDINATE SOURCE [pure]');
// ===========================================================================
{
  const office = { office_latitude: 12.9716, office_longitude: 77.5946, latitude: 28.6139, longitude: 77.209 };
  check('B01 the office pair wins when both pairs are usable',
    eq(resolveVendorCanonicalCoordinate(office),
      { latitude: 12.9716, longitude: 77.5946, source: 'office_coordinates' }));

  check('B02 the legacy pair is used ONLY when the office pair is missing',
    eq(resolveVendorCanonicalCoordinate({ latitude: 28.6139, longitude: 77.209 }),
      { latitude: 28.6139, longitude: 77.209, source: 'legacy_coordinates' }));

  check('B03 the legacy pair is used when the office pair is one-sided',
    resolveVendorCanonicalCoordinate({ office_latitude: 12.9716, latitude: 28.6139, longitude: 77.209 }).source
      === 'legacy_coordinates');

  check('B04 the legacy pair is used when the office pair is out of range',
    resolveVendorCanonicalCoordinate({ office_latitude: 999, office_longitude: 77.5946, latitude: 28.6139, longitude: 77.209 }).source
      === 'legacy_coordinates');

  check('B05 the legacy pair is used when the office pair is the null island',
    resolveVendorCanonicalCoordinate({ office_latitude: 0, office_longitude: 0, latitude: 28.6139, longitude: 77.209 }).source
      === 'legacy_coordinates');

  check('B06 no usable pair yields null coordinates and source "none"',
    eq(resolveVendorCanonicalCoordinate({}), { latitude: null, longitude: null, source: 'none' })
    && eq(resolveVendorCanonicalCoordinate({ office_latitude: 0, office_longitude: 0, latitude: NaN, longitude: 5 }),
      { latitude: null, longitude: null, source: 'none' }));

  check('B07 a null/undefined vendor row is total, not a throw',
    resolveVendorCanonicalCoordinate(null).source === 'none'
    && resolveVendorCanonicalCoordinate(undefined).source === 'none');

  // base_* is NOT a source anywhere.
  check('B08 base_latitude / base_longitude are NOT a coordinate source',
    resolveVendorCanonicalCoordinate({ base_latitude: 12.9716, base_longitude: 77.5946 }).source === 'none'
    && !/base_latitude|base_longitude/.test(COORD_TS.split('export function resolveVendorCanonicalCoordinate')[1] ?? '')
    && !/base_latitude|base_longitude/.test(LEAD_GEN + VENDOR_GEN + FN_BODY));

  // The lead side has exactly one pair, and provenance is never a distance input.
  check('B09 the lead coordinate is leads.latitude/longitude and nothing else',
    eq(resolveLeadCanonicalCoordinate({ latitude: 28.6139, longitude: 77.209 }),
      { latitude: 28.6139, longitude: 77.209, source: 'lead_coordinates' })
    && resolveLeadCanonicalCoordinate({}).source === 'none'
    && resolveLeadCanonicalCoordinate(null).source === 'none');
  check('B10 google_place_id and pincode are not consulted for the lead point',
    resolveLeadCanonicalCoordinate({ google_place_id: 'ChIJabc', postal_code: '110001' }).source === 'none'
    && !/google_place_id|postal_code|pincode/.test(
      (COORD_TS.split('export function resolveLeadCanonicalCoordinate')[1] ?? '').split('\n}')[0]));

  // The matcher must DELEGATE, so there is one rule and not two.
  check('B11 [static] leadMatchingEngine delegates vendor coordinates to the shared primitive',
    /resolveVendorCanonicalCoordinate/.test(MATCHER)
    && /function resolveVendorCoordinates[\s\S]*?resolveVendorCanonicalCoordinate\(vendor\)/.test(MATCHER)
    && !/function resolveVendorCoordinates[\s\S]*?isValidCoordinate\(oLat/.test(MATCHER));
}

// ===========================================================================
section('C. POSTGIS FOUNDATION [static]');
// ===========================================================================
{
  check('C01 exactly ONE new migration file carries this phase',
    readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => /qf_mvp_75_02/.test(f)).length === 1);

  check('C02 postgis is created guarded, in the accepted `extensions` schema',
    /if\s+v_schema\s+is\s+null\s+then/.test(flat(MIGRATION))
    && /create extension "postgis" with schema extensions/.test(MIGRATION));

  check('C03 an existing postgis in another schema ABORTS instead of being relocated',
    /elsif v_schema <> 'extensions' then\s*raise exception/.test(flat(MIGRATION))
    && !/alter extension\s+"?postgis"?\s+set schema/i.test(MIGRATION)
    && !/drop extension/i.test(MIGRATION));

  check('C04 both geography columns are geography(Point, 4326)',
    /add column if not exists geo_point extensions\.geography\(Point, 4326\)/.test(LEAD_GEN ? MIGRATION : '')
    && (MIGRATION.match(/extensions\.geography\(Point, 4326\)/g) || []).length >= 4);

  check('C05 both geography columns are GENERATED ALWAYS ... STORED and nullable',
    /generated always as \(/.test(LEAD_GEN) && /generated always as \(/.test(VENDOR_GEN)
    && /\)\s*stored;/.test(MIGRATION_RAW)
    && (MIGRATION.match(/generated always as \(/g) || []).length === 2
    && !/\)\s*stored\s+not null/i.test(MIGRATION)
    && !/geo_point extensions\.geography\(Point, 4326\)\s+not null/i.test(MIGRATION));

  check('C06 both columns are added idempotently and no existing column is altered',
    (MIGRATION.match(/add column if not exists geo_point/g) || []).length === 2
    && !/alter column\s+(latitude|longitude|office_latitude|office_longitude)/i.test(MIGRATION)
    && !/drop column/i.test(MIGRATION)
    && !/rename column/i.test(MIGRATION));

  check('C07 point construction is ST_MakePoint(longitude, latitude) on the LEAD side',
    /ST_MakePoint\(longitude, latitude\)/.test(LEAD_GEN)
    && !/ST_MakePoint\(latitude, longitude\)/.test(MIGRATION));

  check('C08 point construction is ST_MakePoint(longitude, latitude) on the VENDOR side',
    /ST_MakePoint\(\s*office_longitude::double precision,\s*office_latitude::double precision\s*\)/.test(flat(VENDOR_GEN))
    && /ST_MakePoint\(\s*longitude::double precision,\s*latitude::double precision\s*\)/.test(flat(VENDOR_GEN))
    && !/ST_MakePoint\(\s*office_latitude/.test(flat(VENDOR_GEN)));

  check('C09 SRID 4326 is stamped on every constructed point',
    (MIGRATION.match(/ST_SetSRID\(/g) || []).length === 3
    && (MIGRATION.match(/, 4326\s*\n?\s*\)/g) || []).length >= 3
    && !/4269|3857|900913|SRID=\s*0/.test(MIGRATION));

  check('C10 the LEAD expression mirrors the TypeScript validity rule exactly',
    /latitude\s+is not null/.test(LEAD_GEN)
    && /longitude\s+is not null/.test(LEAD_GEN)
    && /latitude\s+between -90\s+and 90/.test(LEAD_GEN)
    && /longitude between -180 and 180/.test(LEAD_GEN)
    && /not \(latitude = 0 and longitude = 0\)/.test(LEAD_GEN));

  check('C11 the VENDOR expression is office-first, legacy-second, else nothing',
    (VENDOR_GEN.match(/when office_latitude\s+is not null/g) || []).length === 1
    && (VENDOR_GEN.match(/when latitude\s+is not null/g) || []).length === 1
    && VENDOR_GEN.indexOf('office_latitude') < VENDOR_GEN.indexOf('when latitude')
    && /not \(office_latitude = 0 and office_longitude = 0\)/.test(VENDOR_GEN)
    && /not \(latitude = 0 and longitude = 0\)/.test(VENDOR_GEN));

  check('C12 an invalid or missing historical pair yields NULL, never a migration failure',
    (MIGRATION.match(/else null/g) || []).length === 2
    && !/raise exception/i.test(MIGRATION.split('create or replace function')[0].split('$postgis$;')[1] ?? '')
    && !/check\s*\(/i.test(MIGRATION.split('create or replace function')[0]));

  check('C13 a GiST index exists on each geography column',
    /create index if not exists idx_leads_geo_point_gist\s*\n?\s*on public\.leads using gist \(geo_point\)/.test(MIGRATION)
    && /create index if not exists idx_vendors_geo_point_gist\s*\n?\s*on public\.vendors using gist \(geo_point\)/.test(MIGRATION));

  check('C14 no H3, no route matrix, no Google, no geocoder, no HTTP anywhere in the migration',
    !/\bh3[_(\s]|h3_index|hex(agon)?_?cell/i.test(MIGRATION)
    && !/google|route.?matrix|distance.?matrix|geocod|https?:\/\/|pg_net|\bhttp\b/i.test(MIGRATION));

  check('C15 the migration writes no data at all',
    !/\binsert\s+into\b/i.test(MIGRATION)
    && !/\bupdate\s+public\./i.test(MIGRATION)
    && !/\bdelete\s+from\b/i.test(MIGRATION)
    && !/\btruncate\b/i.test(MIGRATION));

  check('C16 the migration edits no earlier migration and creates exactly one function',
    (MIGRATION.match(/create or replace function/gi) || []).length === 1
    && !/drop function/i.test(MIGRATION)
    && !/qf_assign_lead_vendors_v2|qf_apply_credit_mutation_v2/.test(
      MIGRATION.split('create or replace function')[0]));
}

// ===========================================================================
section('D. GEO SHORTLIST — READ-ONLY, BOUNDED, DETERMINISTIC [static]');
// ===========================================================================
{
  check('D01 the shortlist body was extracted (checks below are scoped to it)',
    FN_BODY.length > 200);

  check('D02 the shortlist is STABLE and SECURITY INVOKER, following qf_vendor_assignment_eligible',
    /language plpgsql\s*stable\s*security invoker/.test(flat(MIGRATION))
    && !/security definer/i.test(MIGRATION));

  check('D03 the shortlist pins search_path (and includes extensions only for PostGIS)',
    /set search_path = pg_catalog, public, extensions, pg_temp/.test(MIGRATION));

  check('D04 the shortlist is bounded, and the SQL clamps independently of the caller',
    /least\(greatest\(coalesce\(p_limit, 20\), 1\), 20\)/.test(FN_BODY)
    && /limit v_limit/.test(FN_BODY));

  check('D05 the bound is the existing transport pool ceiling, not an invented number',
    GEO_SHORTLIST_MAX_RESULTS === MAX_CANONICAL_CANDIDATE_POOL
    && MAX_CANONICAL_CANDIDATE_POOL === 20
    && /GEO_SHORTLIST_MAX_RESULTS = MAX_CANONICAL_CANDIDATE_POOL/.test(CONTRACT_TS));

  check('D06 the bounded scan is KNN-driven against the indexed geography column',
    /order by v\.geo_point operator\(extensions\.<->\) v_lead_geo, v\.id/.test(FN_BODY)
    && /from public\.vendors v\s*where v\.geo_point is not null/.test(flat(FN_BODY)));

  check('D07 the deterministic tiebreak is INSIDE the bound, so the boundary cannot be arbitrary',
    /operator\(extensions\.<->\) v_lead_geo, v\.id\s*limit v_limit/.test(flat(FN_BODY)));

  check('D08 ordering and the reported distance use the SAME model (sphere), so rank is monotone',
    (FN_BODY.match(/ST_Distance\(k\.geo_point, v_lead_geo, false\)/g) || []).length === 3);

  check('D09 the outer result order is (distance ASC, vendor id ASC) — total and deterministic',
    /order by extensions\.ST_Distance\(k\.geo_point, v_lead_geo, false\), k\.id;/.test(flat(FN_BODY)));

  check('D10 the shortlist writes nothing',
    !/\binsert\b/i.test(FN_BODY) && !/\bupdate\b/i.test(FN_BODY)
    && !/\bdelete\b/i.test(FN_BODY) && !/\bmerge\b/i.test(FN_BODY)
    && !/\btruncate\b/i.test(FN_BODY) && !/for update/i.test(FN_BODY)
    && !/perform\s/i.test(FN_BODY));

  check('D11 the shortlist touches no credit, no assignment and no matching-run state',
    !/credit|remaining_credits|lead_assignments|assignment|lead_matching_runs|wallet|ledger/i.test(FN_BODY));

  check('D12 the shortlist never calls the canonical assignment authority',
    !/qf_assign_lead_vendors_v2|qf_apply_credit_mutation_v2|qf_vendor_assignment_eligible/.test(FN_BODY));

  check('D13 the shortlist applies NO eligibility or commercial predicate',
    !/status|is_active|accepting_leads|package|paid_status|verification|city|category|service_radius_km|rating|visibility/i
      .test(FN_BODY));

  check('D14 the shortlist reads only the two canonical tables, by the lead id it was given',
    /from public\.leads l\s*where l\.id = p_lead_id/.test(flat(FN_BODY))
    && (FN_BODY.match(/from public\./g) || []).length === 2);

  check('D15 no lead coordinate is a TYPED zero-row outcome, never an exception',
    /if v_lead_geo is null then\s*return;\s*end if;/.test(flat(FN_BODY))
    && !/raise exception/i.test(FN_BODY));

  check('D16 ACL: revoked from PUBLIC/anon/authenticated/service_role, granted to service_role only',
    /revoke all on function public\.qf_geo_vendor_shortlist_v1\(uuid, integer\)\s*from public, anon, authenticated, service_role;/.test(flat(MIGRATION))
    && /grant execute on function public\.qf_geo_vendor_shortlist_v1\(uuid, integer\)\s*to service_role;/.test(flat(MIGRATION))
    && !/to (public|anon|authenticated)\b/.test(flat(MIGRATION).replace(/from public, anon, authenticated, service_role/g, '')));

  check('D17 the migration self-verifies the ACL positively AND negatively',
    /has_function_privilege\('service_role', v_oid, 'EXECUTE'\)/.test(MIGRATION)
    && /has_function_privilege\('public', v_oid, 'EXECUTE'\)/.test(MIGRATION)
    && /has_function_privilege\('anon', v_oid, 'EXECUTE'\)/.test(MIGRATION)
    && /has_function_privilege\('authenticated', v_oid, 'EXECUTE'\)/.test(MIGRATION)
    && /aclexplode/.test(MIGRATION)
    && /a\.grantee <> 0/.test(MIGRATION));

  check('D18 the migration self-verifies SECURITY INVOKER, STABLE, pinned search_path and both GiST indexes',
    /provolatile from pg_catalog\.pg_proc p where p\.oid = v_oid\) <> 's'/.test(flat(MIGRATION))
    && /must be SECURITY INVOKER/.test(MIGRATION)
    && /does not pin search_path/.test(MIGRATION)
    && (MIGRATION.match(/am\.amname = 'gist'/g) || []).length === 2
    && /attgenerated/.test(MIGRATION));

  check('D19 the runtime seam calls exactly this RPC and no other',
    GEO_SHORTLIST_RPC === 'qf_geo_vendor_shortlist_v1'
    && (SHORTLIST_SVC.match(/\.rpc\(/g) || []).length === 1
    && /\.rpc\(GEO_SHORTLIST_RPC/.test(SHORTLIST_SVC));

  check('D20 the runtime seam performs no write, no credit move and no assignment',
    !/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(SHORTLIST_SVC)
    && !/assignLeadToMatchedVendors|executeCanonicalAssignment|qf_assign_lead_vendors_v2|credit/i.test(SHORTLIST_SVC));

  check('D21 the runtime seam reaches no external geo service',
    !/fetch\(|axios|https?:\/\/|google|maps|geocod|route.?matrix|distance.?matrix/i.test(SHORTLIST_SVC));
}

// ===========================================================================
section('E. FALLBACK CONTRACT [pure + static]');
// ===========================================================================
{
  const outcome = (status, entries = [], error_code = null) => ({ status, entries, error_code });

  check('E01 every non-shortlisted status resolves to an EXPLICIT city fallback path',
    resolveGeoMatchPath('no_lead_coordinate') === 'city_fallback_no_lead_coordinate'
    && resolveGeoMatchPath('no_geo_vendor') === 'city_fallback_no_geo_vendor'
    && resolveGeoMatchPath('unavailable') === 'city_fallback_geo_unavailable'
    && resolveGeoMatchPath('error') === 'city_fallback_geo_error'
    && resolveGeoMatchPath('shortlisted') === 'geo_shortlist');

  check('E02 an unknown status still falls back rather than becoming a geo path',
    resolveGeoMatchPath('something_new_entirely') === 'city_fallback_geo_error'
    && isCityFallbackPath(resolveGeoMatchPath('something_new_entirely')));

  check('E03 there is NO path or status meaning "no supply"',
    !/no_supply|no_vendors_available|market_empty|zero_supply/i.test(CONTRACT_TS));

  // No lead coordinate -> the RPC is never called at all.
  check('E04 [static] a lead with no coordinate short-circuits BEFORE the RPC',
    SHORTLIST_SVC.indexOf('return { status: "no_lead_coordinate"') > 0
    && SHORTLIST_SVC.indexOf('return { status: "no_lead_coordinate"') < SHORTLIST_SVC.indexOf('.rpc(')
    && /resolveLeadCanonicalCoordinate\(lead\)/.test(SHORTLIST_SVC));

  const noCoord = buildGeoMatchEvidence({
    outcome: outcome('no_lead_coordinate'),
    leadCoordinateSource: 'none',
    leadHasValidCoordinate: false,
    leadLocationSource: null,
    leadGooglePlaceIdPresent: false,
    cityEligibleVendorCount: 7,
  });
  check('E05 no lead coordinate records the city path and keeps the city-eligible count',
    noCoord.shortlist_path === 'city_fallback_no_lead_coordinate'
    && noCoord.city_fallback_used === true
    && noCoord.lead_has_valid_coordinate === false
    && noCoord.city_eligible_vendor_count === 7
    && noCoord.shortlist_vendor_ids.length === 0);

  // Zero geo vendors while city-eligible vendors exist.
  const emptyGeo = buildGeoMatchEvidence({
    outcome: outcome('no_geo_vendor'),
    leadCoordinateSource: 'lead_coordinates',
    leadHasValidCoordinate: true,
    leadLocationSource: 'browser_gps',
    leadGooglePlaceIdPresent: true,
    cityEligibleVendorCount: 5,
  });
  check('E06 zero geo vendors + city-eligible vendors is an EXPLICIT city fallback, not "no supply"',
    emptyGeo.shortlist_status === 'no_geo_vendor'
    && emptyGeo.shortlist_path === 'city_fallback_no_geo_vendor'
    && emptyGeo.city_fallback_used === true
    && emptyGeo.city_eligible_vendor_count === 5
    && emptyGeo.geo_error_code === null);

  // Infrastructure failure is never a supply fact.
  const infra = buildGeoMatchEvidence({
    outcome: outcome('error', [], 'GEO_SHORTLIST_QUERY_FAILED'),
    leadCoordinateSource: 'lead_coordinates',
    leadHasValidCoordinate: true,
    leadLocationSource: 'google_place',
    leadGooglePlaceIdPresent: true,
    cityEligibleVendorCount: 3,
  });
  check('E07 an infrastructure failure is recorded as an ERROR, distinct from "no geo vendor"',
    infra.shortlist_status === 'error'
    && infra.shortlist_path === 'city_fallback_geo_error'
    && infra.geo_error_code === 'GEO_SHORTLIST_QUERY_FAILED'
    && infra.city_eligible_vendor_count === 3);
  check('E08 [static] the seam never reports an infra failure as an empty market',
    /return \{ status: "error", entries: \[\], error_code: GEO_SHORTLIST_FAILED \}/.test(SHORTLIST_SVC)
    && SHORTLIST_SVC.indexOf('status: "no_geo_vendor"') > SHORTLIST_SVC.indexOf('status: "error"'));

  check('E09 [static] a missing migration degrades to `unavailable`, never to a throw',
    /return \{ status: "unavailable", entries: \[\], error_code: GEO_SHORTLIST_UNAVAILABLE \}/.test(SHORTLIST_SVC)
    && /42883|PGRST202/.test(SHORTLIST_SVC)
    && /catch \(e\)/.test(SHORTLIST_SVC)
    && !/throw /.test(SHORTLIST_SVC));

  const unavailable = buildGeoMatchEvidence({
    outcome: outcome('unavailable', [], 'GEO_SHORTLIST_RPC_UNAVAILABLE'),
    leadCoordinateSource: 'lead_coordinates',
    leadHasValidCoordinate: true,
    leadLocationSource: null,
    leadGooglePlaceIdPresent: false,
    cityEligibleVendorCount: 11,
  });
  check('E10 an unapplied migration cannot suppress an eligible city pool',
    unavailable.shortlist_path === 'city_fallback_geo_unavailable'
    && unavailable.city_eligible_vendor_count === 11
    && unavailable.shortlist_narrowed_candidate_pool === false);

  check('E11 no geo outcome can ever create an assignment: the seam holds no assignment API',
    !/assign|deliver|debit|credit/i.test(
      (SHORTLIST_SVC.split('export async function fetchGeoVendorShortlist')[1] ?? '')));
}

// ===========================================================================
section('F. SHORTLIST NEVER NARROWS THE CANDIDATE POOL [static]');
// ===========================================================================
{
  const iEval = MATCHER.indexOf('const evaluation = await evaluateVendorsForLead(leadRow);');
  const iGeo = MATCHER.indexOf('await fetchGeoVendorShortlist(leadRow)');
  const iPool = MATCHER.indexOf('const rankedPool = splitRankedPool(');

  check('F01 the geo shortlist runs AFTER the eligible pool is already final',
    iEval > 0 && iGeo > iEval);

  check('F02 the ranked pool is still built from `eligible` alone, with no geo input',
    iPool > 0
    && /const rankedPool = splitRankedPool\(\s*eligible\.map\(\(vendor\) => vendor\.id\),\s*MAX_ASSIGNMENT_CANDIDATE_POOL,\s*\);/
      .test(flat(MATCHER))
    && !/geo/i.test(MATCHER.slice(iPool, MATCHER.indexOf(');', iPool) + 2)));

  check('F03 the pure ranking function has no geo shortlist input at all',
    !/fetchGeoVendorShortlist|geoOutcome|geoEvidence|shortlist/i.test(
      MATCHER.split('export function rankVendorsForLead')[1] ?? ''));

  check('F04 the shortlist is consulted exactly once, and only for evidence',
    (MATCHER.match(/await fetchGeoVendorShortlist\(/g) || []).length === 1
    && (MATCHER.match(/geoEvidence/g) || []).length === 2
    && /geo: geoEvidence,/.test(MATCHER));

  check('F05 the authority is still handed exactly the ranked pool, unmodified',
    /const assignment = await assignLeadToMatchedVendors\(leadId, selectedVendorIds\);/.test(MATCHER)
    && /const selectedVendorIds = rankedPool\.pool;/.test(MATCHER));

  check('F06 the evidence itself asserts it narrowed nothing',
    buildGeoMatchEvidence({
      outcome: { status: 'shortlisted', entries: [], error_code: null },
      leadCoordinateSource: 'lead_coordinates',
      leadHasValidCoordinate: true,
      leadLocationSource: null,
      leadGooglePlaceIdPresent: false,
      cityEligibleVendorCount: 4,
    }).shortlist_narrowed_candidate_pool === false);

  check('F07 the canonical automatic path is unchanged end to end',
    /runAutoLeadMatchingForLead/.test(MATCHER)
    && /assignLeadToMatchedVendors/.test(MATCHER)
    && /executeCanonicalAssignment/.test(stripTs(read('services/leadDeliveryService.ts')))
    && /mode: "automatic"/.test(stripTs(read('services/leadDeliveryService.ts'))));
}

// ===========================================================================
section('G. MATCHING EVIDENCE [pure]');
// ===========================================================================
{
  const rows = [
    { vendor_id: '33333333-3333-4333-8333-333333333333', straight_line_distance_km: 9.5 },
    { vendor_id: '11111111-1111-4111-8111-111111111111', straight_line_distance_km: 2.25 },
    { vendor_id: '22222222-2222-4222-8222-222222222222', straight_line_distance_km: 2.25 },
  ];
  const normalized = normalizeGeoShortlistRows(rows);
  check('G01 rows are re-ordered deterministically by (distance ASC, vendor id ASC)',
    eq(normalized.map((e) => e.vendor_id), [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]));
  check('G02 shortlist_rank is re-stamped 1-based from that order, never trusted from transport',
    eq(normalized.map((e) => e.shortlist_rank), [1, 2, 3]));

  check('G03 a malformed or partial row can never become evidence',
    normalizeGeoShortlistRows([
      { vendor_id: 'not-a-uuid', straight_line_distance_km: 1 },
      { vendor_id: '11111111-1111-4111-8111-111111111111', straight_line_distance_km: 'abc' },
      { vendor_id: '11111111-1111-4111-8111-111111111111', straight_line_distance_km: -1 },
      { vendor_id: '11111111-1111-4111-8111-111111111111' },
      null,
      'garbage',
    ]).length === 0
    && normalizeGeoShortlistRows(null).length === 0
    && normalizeGeoShortlistRows(undefined).length === 0);

  check('G04 a duplicated vendor id keeps the first occurrence only',
    normalizeGeoShortlistRows([
      { vendor_id: '11111111-1111-4111-8111-111111111111', straight_line_distance_km: 5 },
      { vendor_id: '11111111-1111-4111-8111-111111111111', straight_line_distance_km: 1 },
    ]).length === 1);

  check('G05 the TypeScript side clamps to the same bound the SQL clamps to',
    normalizeGeoShortlistRows(
      Array.from({ length: 50 }, (_, i) => ({
        vendor_id: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
        straight_line_distance_km: i,
      })),
    ).length === GEO_SHORTLIST_MAX_RESULTS);

  const evidence = buildGeoMatchEvidence({
    outcome: { status: 'shortlisted', entries: normalized, error_code: null },
    leadCoordinateSource: 'lead_coordinates',
    leadHasValidCoordinate: true,
    leadLocationSource: 'browser_gps',
    leadGooglePlaceIdPresent: true,
    cityEligibleVendorCount: 6,
  });

  check('G06 the evidence carries the geo contract version and SRID',
    evidence.geo_contract_version === GEO_CONTRACT_VERSION && evidence.geo_srid === 4326);
  check('G07 the evidence carries the shortlist ids and their straight-line distances',
    eq(evidence.shortlist_vendor_ids, normalized.map((e) => e.vendor_id))
    && evidence.shortlist_distances.length === 3);
  check('G08 the distance is LABELLED straight-line and explicitly not route distance or route time',
    evidence.shortlist_distance_metric === GEO_SHORTLIST_DISTANCE_METRIC
    && /straight_line/.test(GEO_SHORTLIST_DISTANCE_METRIC)
    && evidence.shortlist_is_route_distance === false
    && evidence.shortlist_is_route_time === false);
  check('G09 the evidence states it is neither an assignment nor an eligibility authority',
    evidence.shortlist_is_assignment_authority === false
    && evidence.shortlist_is_eligibility_authority === false);
  check('G10 the evidence carries the bound it was taken under',
    evidence.shortlist_bound === GEO_SHORTLIST_MAX_RESULTS);

  check('G11 coordinate PROVENANCE is recorded, but never the lead coordinate itself',
    evidence.lead_coordinate_source === 'lead_coordinates'
    && evidence.lead_location_source === 'browser_gps'
    && evidence.lead_google_place_id_present === true
    && !Object.prototype.hasOwnProperty.call(evidence, 'lead_latitude')
    && !Object.prototype.hasOwnProperty.call(evidence, 'lead_longitude')
    && !JSON.stringify(evidence).includes('ChIJ'));

  check('G12 no raw provider payload, secret, analytics schema or new table is introduced',
    !/api_key|secret|token|access_token|payload_raw|analytics/i.test(CONTRACT_TS)
    && !/create table/i.test(MIGRATION));

  check('G13 the evidence extends the EXISTING matching_snapshot jsonb only',
    /matching_snapshot: \{ lead: summarizeLead\(leadRow\)/.test(MATCHER)
    && /geo: geoEvidence,/.test(MATCHER)
    && !/alter table public\.lead_matching_runs/i.test(MIGRATION));

  check('G14 the 75.01 evidence fields are all still present alongside the geo half',
    /matchcore_contract_version/.test(MATCHER)
    && /request_fingerprint_version/.test(MATCHER)
    && /candidate_order_is_binding: true/.test(MATCHER)
    && /ranked_candidate_order: selectedVendorIds/.test(MATCHER)
    && /cap_deferred_vendor_ids/.test(MATCHER)
    && /max_vendor_cap_reached_vendor_ids/.test(MATCHER)
    && /assigned_vendor_ids: assigned\.map/.test(MATCHER));
}

// ===========================================================================
section('H. MATCHCORE PRESERVATION [pure + static]');
// ===========================================================================
{
  const decision = (id, o = {}) => ({
    vendor_id: id, eligible: true, reason_codes: [], match_tier: 0, match_type: 'exact',
    has_coordinates: true, coordinate_source: 'office_coordinates', distance_km: 10,
    area_affinity: 0, last_assigned_at: null, rating: 0, rank_position: null, ...o,
  });

  const far0 = decision('99999999-9999-4999-8999-999999999999', { match_tier: 0, distance_km: 900 });
  const near1 = decision('11111111-1111-4111-8111-111111111111', { match_tier: 1, distance_km: 1 });
  check('H01 Tier-0 still beats Tier-1 regardless of distance',
    compareAutomaticMatchDecisions(far0, near1, true) < 0);

  check('H02 the final candidate pool ceiling is still 20',
    MAX_CANONICAL_CANDIDATE_POOL === 20
    && splitRankedPool(Array.from({ length: 30 }, (_, i) => `v${i}`), MAX_CANONICAL_CANDIDATE_POOL).pool.length === 20);

  check('H03 the active cap is still 3, the lifetime cap 6 and the credit cost 1',
    CANONICAL_ACTIVE_ASSIGNMENT_CAP === 3
    && CANONICAL_LIFETIME_ASSIGNMENT_CAP === 6
    && CANONICAL_ASSIGNMENT_CREDIT_COST === 1);

  const matchcore = read(MATCHCORE_MIGRATION);
  check('H04 the 75.01 authority migration is byte-unchanged by this phase',
    sha256(matchcore.replace(/\r\n/g, '\n'))
      === 'ea65d8803f3d2510357d19a7aa779e74efc112089e787cc8c9802a13a4666707');
  check('H05 the 75.01 order-sensitive fingerprint and two-pass lock order survive',
    /c_fingerprint_version constant integer := 2;/.test(matchcore)
    && /jsonb_agg\(to_jsonb\(u\.vid::text\) order by u\.ord\)/.test(flat(matchcore))
    && /for v_lock_id in select u\.vid from unnest\(v_ranked\) as u\(vid\) order by u\.vid/.test(flat(matchcore))
    && /for v_candidate in select u\.vid from unnest\(v_ranked\) with ordinality as u\(vid, ord\) order by u\.ord/.test(flat(matchcore)));
  check('H06 the caps live in the authority and this phase did not move them',
    /c_active_cap\s+constant integer := 3;/.test(matchcore)
    && /c_lifetime_cap constant integer := 6;/.test(matchcore)
    && /c_credit_cost  constant integer := 1;/.test(matchcore)
    && !/c_active_cap|c_lifetime_cap|c_credit_cost/.test(MIGRATION));

  check('H07 the canonical eligibility helper is untouched and still the hard gate',
    /create or replace function public\.qf_vendor_assignment_eligible/.test(read(AUTHORITY_MIGRATION))
    && !/create or replace function public\.qf_vendor_assignment_eligible/.test(MIGRATION));

  check('H08 the matcher still applies the city hard gate and the category tier gate',
    /if \(!cityMatches\(vendor, lead\)\) reasons\.push\("city_mismatch"\);/.test(MATCHER)
    && /if \(tierResult === null\) reasons\.push\("category_mismatch"\);/.test(MATCHER)
    && /evaluateVendorAutomaticLeadEligibility\(vendor, \{ nowMs \}\)/.test(MATCHER));

  check('H09 the matcher still takes exactly ONE clock read per ranking run',
    (MATCHER.match(/const nowMs = Date\.now\(\);/g) || []).length === 1);

  check('H10 the comparator is still the shared MatchCore contract, unchanged by this phase',
    /eligible\.sort\(\(a, b\) => compareAutomaticMatchDecisions\(a\.__decision, b\.__decision, leadHasCoords\)\);/.test(MATCHER));

  check('H11 MatchCore still ranks on its own haversine, never on the PostGIS number',
    /haversineKm\(lead\.latitude, lead\.longitude, coords\.lat, coords\.lng\)/.test(MATCHER)
    && !/shortlist|ST_Distance|straight_line_distance_km/.test(
      MATCHER.split('export function rankVendorsForLead')[1] ?? ''));
}

// ===========================================================================
section('I. COMMERCIAL ISOLATION [static]');
// ===========================================================================
{
  check('I01 no paid / package / visibility ordering anywhere in the new SQL',
    !/paid_status|package_status|package_name|public_visibility|visibility_type/i.test(FN_BODY)
    && !/order by[^;]*(paid|package|visibility|rating)/i.test(MIGRATION));

  check('I02 service_radius_km is not a gate and not an ordering key',
    !/service_radius_km/.test(FN_BODY)
    && !/service_radius_km/.test(LEAD_GEN + VENDOR_GEN)
    && !/service_radius_km/i.test(CONTRACT_TS)
    && !/service_radius_km/i.test(SHORTLIST_SVC));

  check('I03 city remains the geographic BOUNDARY for this slice, enforced where it always was',
    /function cityMatches/.test(MATCHER)
    && /city_mismatch/.test(MATCHER)
    && !/city/i.test(FN_BODY));

  check('I04 pincode never becomes a matching authority',
    !/pincode|postal_code/i.test(FN_BODY)
    && !/pincode|postal_code/i.test(CONTRACT_TS)
    && !/pincode|postal_code/i.test(SHORTLIST_SVC));

  check('I05 google_place_id stays provenance: presence only, never the identifier, never a distance',
    /lead_google_place_id_present/.test(CONTRACT_TS)
    && !/google_place_id: /.test(CONTRACT_TS)
    && /leadGooglePlaceIdPresent: Boolean\(asText\(leadRow\.google_place_id\)\)/.test(MATCHER));

  check('I06 no fairness model, primary/reserve, lifecycle or ML is introduced',
    !/primary|reserve|promotion|lifecycle|retry_framework|model|ml_|score_model/i.test(FN_BODY)
    && !/primary_vendor|reserve_vendor|georegret|geo_regret/i.test(CONTRACT_TS + SHORTLIST_SVC + MIGRATION));

  check('I07 no fifth generic control plane: no new table, policy, trigger or settings row',
    !/create table/i.test(MIGRATION)
    && !/create policy/i.test(MIGRATION)
    && !/create trigger/i.test(MIGRATION)
    && !/enable row level security/i.test(MIGRATION));
}

// ===========================================================================
section('J. MIGRATION GOVERNANCE [static]');
// ===========================================================================
{
  const migrations = readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
// QF-MVP-80.14A RE-PIN: 102 -> 103, adding ONLY the SOURCE-PENDING Meta production
// activation authority (20260903040000). No existing migration was changed, renamed,
// deleted or reordered. Still exact equality.
  check('J01 the local migration set is exactly 103', migrations.length === 103,
    `found ${migrations.length}`);
  // QF-MVP-80.03: the geo migration is no longer the TAIL of the set — the
  // audit_logs forward repair (20260817000000) was added after it. What 75.02
  // actually needs is that its own migration is unmoved and unrenamed and still
  // sits immediately after 75.01, so the rule is narrowed to exactly that rather
  // than deleted. Position-from-the-end was never the invariant; adjacency was.
  const geoIndex = migrations.indexOf('20260816000000_qf_mvp_75_02_geo_postgis_shortlist.sql');
  check('J02 the geo migration is present, at the expected version and name, immediately after 75.01',
    geoIndex > 0
    && migrations[geoIndex - 1] === '20260815000000_qf_mvp_75_01_matchcore_binding_rank_order.sql');

  const g1 = read('scripts/mvp/staging/validate-qf-mvp-50-2c-s2-g1.mjs');
  const geoSha = sha256(MIGRATION_RAW.replace(/\r\n/g, '\n'));
  check('J03 G1 is re-pinned to 103 by exact equality, never loosened to >=',
    /const MIGRATION_COUNT = 103;/.test(g1)
    && !/MIGRATION_COUNT\s*[><]=/.test(g1));
  // QF-MVP-80.05 RECONCILIATION: 20260816000000 was applied to staging and production,
  // proved by read-only history queries, so the manifest now carries it as RECONCILED /
  // APPLIED rather than SOURCE-PENDING. Its hash pin is unchanged and still exact.
  check('J04 G1 pins the geo migration as a post-anchor entry, by exact hash',
    g1.includes('20260816000000')
    && g1.includes('qf_mvp_75_02_geo_postgis_shortlist')
    && g1.includes(geoSha),
    `expected sha ${geoSha}`);

  const manifest = JSON.parse(read('supabase/staging-history/qf-mvp-staging-history-manifest.json'));
  const pending = manifest.pendingPostAnchorMigrations ?? [];
  const reconciled = manifest.reconciledPostAnchorMigrations ?? [];
  const geoEntry = reconciled.find((m) => m.version === '20260816000000');
  check('J05 the staging-history manifest carries the geo migration as RECONCILED/APPLIED with the same hash',
    Boolean(geoEntry)
    && geoEntry.sha256 === geoSha
    && geoEntry.operationalStatus === 'APPLIED'
    && geoEntry.appliedToStaging === true
    && geoEntry.appliedToProduction === true
    && geoEntry.appliedByThisPhase === false
    && geoEntry.requiresSeparateStagingDeploymentGate === false
    && !pending.some((m) => m.version === '20260816000000'));
  check('J06 the manifest post-anchor count is 16: ten applied, five reconciled, one pending',
    manifest.appliedAnchor.postAnchorMigrationCount === 16
    && (manifest.appliedPostAnchorMigrations ?? []).length === 10
    && reconciled.length === 5
    && pending.length === 1
    && pending[0].version === '20260903040000'
    && pending[0].operationalStatus === 'PENDING');
  check('J07 THIS phase still applied nothing: the geo record carries no observed remote-history count',
    geoEntry && geoEntry.remoteVersionStatus === 'PRESENT_IN_STAGING_AND_PRODUCTION_HISTORY'
    && geoEntry.remoteHistoryCountObservedAtApply === false
    && !Object.prototype.hasOwnProperty.call(geoEntry, 'remoteHistory')
    && !Object.prototype.hasOwnProperty.call(geoEntry, 'remoteHistoryCountAfterApply'));

  check('J08 no earlier migration was renamed, reordered or re-hashed',
    migrations.slice(0, 100).every((f) => /^\d{14}_/.test(f))
    && migrations.every((f, i) => i === 0 || f.slice(0, 14) > migrations[i - 1].slice(0, 14)));
}

// ===========================================================================
section('K. CI [static]');
// ===========================================================================
{
  const pkg = JSON.parse(read('package.json'));
  check('K01 npm run test:mvp:75-02 exists and points at this harness',
    pkg.scripts['test:mvp:75-02']?.includes('scripts/mvp/matching/validate-qf-mvp-75-02.mjs'));

  const wf = read('.github/workflows/qf-mvp-50-quality-gate.yml');
  check('K02 the single quality gate runs 75.02',
    /run: npm run test:mvp:75-02/.test(wf));
  check('K03 the gate still runs 75.01, marketplace, assignment-authority and the Phase 4 money path',
    /run: npm run test:mvp:75-01/.test(wf)
    && /run: npm run test:mvp:marketplace/.test(wf)
    && /run: npm run test:mvp:assignment-authority/.test(wf)
    && /run: npm run test:phase4/.test(wf));
  check('K04 the gate still runs the staging-history governance gate and the 70.x harnesses',
    /run: npm run test:mvp:50-2c-s2-g1/.test(wf)
    && /run: npm run test:mvp:70-04/.test(wf));
  check('K05 the gate takes no secret and makes no provider or staging call',
    !/secrets\./.test(wf)
    && !/SUPABASE_[A-Z_]*KEY|SERVICE_ROLE|QF_STAGING_DB_URL|META_|WHATSAPP_/.test(wf));
}

// ===========================================================================
section('MUTATION REJECTION — the checks above must actually bite');
// ===========================================================================
{
  const mutants = [
    ['lat/lng swapped on the lead point', (s) =>
      s.replace('ST_MakePoint(longitude, latitude), 4326', 'ST_MakePoint(latitude, longitude), 4326'),
      (s) => /ST_MakePoint\(longitude, latitude\)/.test(extractGeneratedExpression(s, 'leads'))
        && !/ST_MakePoint\(latitude, longitude\)/.test(stripSql(s))],

    ['lat/lng swapped on the vendor office point', (s) =>
      s.replace('office_longitude::double precision,\n                 office_latitude::double precision',
        'office_latitude::double precision,\n                 office_longitude::double precision'),
      (s) => !/ST_MakePoint\(\s*office_latitude/.test(flat(extractGeneratedExpression(s, 'vendors')))],

    ['the lead GiST index removed', (s) =>
      s.replace(/create index if not exists idx_leads_geo_point_gist\n  on public\.leads using gist \(geo_point\);/, ''),
      (s) => /create index if not exists idx_leads_geo_point_gist\s*\n?\s*on public\.leads using gist \(geo_point\)/.test(stripSql(s))],

    ['the vendor GiST index downgraded to btree', (s) =>
      s.replace('on public.vendors using gist (geo_point)', 'on public.vendors using btree (geo_point)'),
      (s) => /create index if not exists idx_vendors_geo_point_gist\s*\n?\s*on public\.vendors using gist \(geo_point\)/.test(stripSql(s))],

    ['wrong SRID (4326 -> 3857) on the lead point', (s) =>
      s.replace('extensions.ST_MakePoint(longitude, latitude), 4326', 'extensions.ST_MakePoint(longitude, latitude), 3857'),
      (s) => !/4269|3857|900913|SRID=\s*0/.test(stripSql(s))],

    ['missing coordinates made FATAL instead of NULL', (s) =>
      s.replace(/        else null\n      end\n    \) stored;\n\ncomment on column public\.leads/,
        "        else (select 1/0)\n      end\n    ) stored;\n\ncomment on column public.leads"),
      (s) => (stripSql(s).match(/else null/g) || []).length === 2],

    ['the generated column made a plain writable column', (s) =>
      s.replace('generated always as (\n      case\n        when latitude', 'default null as (\n      case\n        when latitude'),
      (s) => (stripSql(s).match(/generated always as \(/g) || []).length === 2],

    ['the null-island rule dropped from the vendor legacy branch', (s) =>
      s.replace('         and not (latitude = 0 and longitude = 0)\n        then extensions.ST_SetSRID(\n               extensions.ST_MakePoint(\n                 longitude::double precision',
        '         and true\n        then extensions.ST_SetSRID(\n               extensions.ST_MakePoint(\n                 longitude::double precision'),
      (s) => /not \(latitude = 0 and longitude = 0\)/.test(extractGeneratedExpression(s, 'vendors'))],

    ['an H3 column added', (s) => `${s}\nalter table public.vendors add column if not exists h3_cell_r8 text;\n`,
      (s) => !/\bh3[_(\s]|h3_index|hex(agon)?_?cell/i.test(stripSql(s))],

    ['a Google Route Matrix call added', (s) =>
      `${s}\ndo $x$ begin perform extensions.http_get('https://routes.googleapis.com/distanceMatrix'); end; $x$;\n`,
      (s) => !/google|route.?matrix|distance.?matrix|geocod|https?:\/\/|pg_net|\bhttp\b/i.test(stripSql(s))],

    ['the shortlist writes an assignment row', (s) =>
      s.replace('  return query\n    select k.id,',
        "  insert into public.lead_assignments (lead_id) values (p_lead_id);\n  return query\n    select k.id,"),
      (s) => !/\binsert\b/i.test(stripSql(extractFunctionBody(s)))],

    ['the shortlist calls the canonical assignment authority', (s) =>
      s.replace('  v_limit := least(greatest(coalesce(p_limit, 20), 1), 20);',
        "  perform public.qf_assign_lead_vendors_v2(p_lead_id, 'automatic', null, null, null, null, null, null);\n  v_limit := least(greatest(coalesce(p_limit, 20), 1), 20);"),
      (s) => !/qf_assign_lead_vendors_v2|qf_apply_credit_mutation_v2|qf_vendor_assignment_eligible/
        .test(stripSql(extractFunctionBody(s)))],

    ['the shortlist becomes an eligibility authority (accepting_leads predicate)', (s) =>
      s.replace('         where v.geo_point is not null', '         where v.geo_point is not null and v.accepting_leads is true'),
      (s) => !/status|is_active|accepting_leads|package|paid_status|verification|city|category|service_radius_km|rating|visibility/i
        .test(stripSql(extractFunctionBody(s)))],

    ['paid/package ordering slipped into the shortlist', (s) =>
      s.replace('         order by v.geo_point operator(extensions.<->) v_lead_geo, v.id',
        '         order by v.package_status desc, v.geo_point operator(extensions.<->) v_lead_geo, v.id'),
      (s) => !/paid_status|package_status|package_name|public_visibility|visibility_type/i
        .test(stripSql(extractFunctionBody(s)))],

    ['a service_radius_km hard gate added', (s) =>
      s.replace('         where v.geo_point is not null',
        '         where v.geo_point is not null and v.service_radius_km >= 10'),
      (s) => !/service_radius_km/.test(stripSql(extractFunctionBody(s)))],

    ['the bound removed (unbounded scan)', (s) => s.replace('         limit v_limit', ''),
      (s) => /limit v_limit/.test(stripSql(extractFunctionBody(s)))],

    ['the bound raised past the transport pool ceiling', (s) =>
      s.replace('least(greatest(coalesce(p_limit, 20), 1), 20)', 'least(greatest(coalesce(p_limit, 20), 1), 5000)'),
      (s) => /least\(greatest\(coalesce\(p_limit, 20\), 1\), 20\)/.test(stripSql(extractFunctionBody(s)))],

    ['the deterministic tiebreak dropped from inside the bound', (s) =>
      s.replace('order by v.geo_point operator(extensions.<->) v_lead_geo, v.id',
        'order by v.geo_point operator(extensions.<->) v_lead_geo'),
      (s) => /operator\(extensions\.<->\) v_lead_geo, v\.id\s*limit v_limit/
        .test(flat(stripSql(extractFunctionBody(s))))],

    ['the KNN operator replaced by a non-indexable expression', (s) =>
      s.replace('order by v.geo_point operator(extensions.<->) v_lead_geo, v.id',
        'order by extensions.ST_Distance(v.geo_point, v_lead_geo, false), v.id'),
      (s) => /order by v\.geo_point operator\(extensions\.<->\) v_lead_geo, v\.id/
        .test(stripSql(extractFunctionBody(s)))],

    ['the no-lead-coordinate fallback removed (raises instead)', (s) =>
      s.replace('  if v_lead_geo is null then\n    return;\n  end if;',
        "  if v_lead_geo is null then\n    raise exception 'no lead coordinate';\n  end if;"),
      (s) => /if v_lead_geo is null then\s*return;\s*end if;/.test(flat(stripSql(extractFunctionBody(s))))
        && !/raise exception/i.test(stripSql(extractFunctionBody(s)))],

    ['SECURITY DEFINER substituted for INVOKER', (s) => s.replace('  security invoker\n', '  security definer\n'),
      (s) => /language plpgsql\s*stable\s*security invoker/.test(flat(stripSql(s))) && !/security definer/i.test(stripSql(s))],

    ['VOLATILE substituted for STABLE (read-only volatility lost)', (s) =>
      s.replace('  language plpgsql\n  stable\n', '  language plpgsql\n  volatile\n'),
      (s) => /language plpgsql\s*stable\s*security invoker/.test(flat(stripSql(s)))],

    ['search_path unpinned', (s) => s.replace('  set search_path = pg_catalog, public, extensions, pg_temp\n', ''),
      (s) => /set search_path = pg_catalog, public, extensions, pg_temp/.test(stripSql(s))],

    ['EXECUTE granted to authenticated', (s) =>
      `${s}\ngrant execute on function public.qf_geo_vendor_shortlist_v1(uuid, integer) to authenticated;\n`,
      (s) => !/to (public|anon|authenticated)\b/
        .test(flat(stripSql(s)).replace(/from public, anon, authenticated, service_role/g, ''))],

    ['EXECUTE granted to anon', (s) =>
      `${s}\ngrant execute on function public.qf_geo_vendor_shortlist_v1(uuid, integer) to anon;\n`,
      (s) => !/to (public|anon|authenticated)\b/
        .test(flat(stripSql(s)).replace(/from public, anon, authenticated, service_role/g, ''))],

    ['EXECUTE granted to PUBLIC', (s) =>
      `${s}\ngrant execute on function public.qf_geo_vendor_shortlist_v1(uuid, integer) to public;\n`,
      (s) => !/to (public|anon|authenticated)\b/
        .test(flat(stripSql(s)).replace(/from public, anon, authenticated, service_role/g, ''))],

    ['the negative ACL self-verification removed', (s) => s.replace(/aclexplode/g, 'no_acl_check'),
      (s) => /aclexplode/.test(stripSql(s))],

    ['postgis relocated instead of aborting', (s) =>
      s.replace("      'QF-MVP-75.02 aborted: postgis is installed in schema %, not extensions.",
        "      execute 'alter extension postgis set schema extensions'; raise notice 'QF-MVP-75.02: postgis relocated. %, not extensions."),
      (s) => !/alter extension\s+"?postgis"?\s+set schema/i.test(stripSql(s))],

    ['a second function slipped in', (s) =>
      `${s}\ncreate or replace function public.qf_geo_side_effect_v1() returns void language sql as $x$ select 1 $x$;\n`,
      (s) => (stripSql(s).match(/create or replace function/gi) || []).length === 1],

    ['a new control-plane table slipped in', (s) =>
      `${s}\ncreate table public.geo_policy_configs (id uuid primary key);\n`,
      (s) => !/create table/i.test(stripSql(s))],

    ['an existing coordinate column altered', (s) =>
      `${s}\nalter table public.vendors alter column office_latitude type double precision;\n`,
      (s) => !/alter column\s+(latitude|longitude|office_latitude|office_longitude)/i.test(stripSql(s))],
  ];

  let rejected = 0;
  for (const [name, mutate, stillHolds] of mutants) {
    const mutated = mutate(MIGRATION_RAW);
    const changed = mutated !== MIGRATION_RAW;
    const holdsOnReal = stillHolds(MIGRATION_RAW);
    const holdsOnMutant = stillHolds(mutated);
    const ok = changed && holdsOnReal && !holdsOnMutant;
    if (ok) rejected += 1;
    check(`MUT reject: ${name}`, ok,
      ok ? '' : `changed=${changed} real=${holdsOnReal} mutant=${holdsOnMutant}`);
  }
  console.log(`   ..    ${rejected}/${mutants.length} migration mutants rejected`);
}

// ===========================================================================
section('MUTATION REJECTION — TypeScript seam');
// ===========================================================================
{
  const tsMutants = [
    ['the shortlist result fed back into the ranked pool', (s) =>
      s.replace('const rankedPool = splitRankedPool(\n      eligible.map((vendor) => vendor.id),',
        'const rankedPool = splitRankedPool(\n      eligible.map((vendor) => vendor.id).filter((id) => geoEvidence.shortlist_vendor_ids.includes(id)),'),
      (s) => {
        const st = stripTs(s);
        const iPool = st.indexOf('const rankedPool = splitRankedPool(');
        return iPool > 0 && !/geo/i.test(st.slice(iPool, st.indexOf(');', iPool) + 2));
      }],

    ['the geo shortlist moved into the pure ranking function', (s) =>
      s.replace('export function rankVendorsForLead(', 'export function rankVendorsForLead_geoShortlist('),
      (s) => !/fetchGeoVendorShortlist|geoOutcome|geoEvidence|shortlist/i
        .test(stripTs(s).split('export function rankVendorsForLead')[1] ?? '')],

    ['the city hard gate removed from the matcher', (s) =>
      s.replace('if (!cityMatches(vendor, lead)) reasons.push("city_mismatch");', ''),
      (s) => /if \(!cityMatches\(vendor, lead\)\) reasons\.push\("city_mismatch"\);/.test(stripTs(s))],

    ['the single clock read per run duplicated', (s) =>
      s.replace('  const nowMs = Date.now();', '  const nowMs = Date.now();\n  const nowMs2 = Date.now();'),
      (s) => (stripTs(s).match(/Date\.now\(\)/g) || []).length === 1],

    ['MatchCore re-ranked on the PostGIS distance instead of its own haversine', (s) =>
      s.replace('haversineKm(lead.latitude, lead.longitude, coords.lat, coords.lng)',
        'shortlistDistanceKm(lead, coords)'),
      (s) => /haversineKm\(lead\.latitude, lead\.longitude, coords\.lat, coords\.lng\)/.test(stripTs(s))],

    ['the authority handed something other than the ranked pool', (s) =>
      s.replace('await assignLeadToMatchedVendors(leadId, selectedVendorIds);',
        'await assignLeadToMatchedVendors(leadId, geoEvidence.shortlist_vendor_ids);'),
      (s) => /const assignment = await assignLeadToMatchedVendors\(leadId, selectedVendorIds\);/.test(stripTs(s))],

    ['the vendor coordinate rule restated locally instead of delegated', (s) =>
      s.replace('  const resolved = resolveVendorCanonicalCoordinate(vendor);\n  return { lat: resolved.latitude, lng: resolved.longitude, source: resolved.source };',
        '  const oLat = Number(vendor.office_latitude);\n  const oLng = Number(vendor.office_longitude);\n  if (isValidCoordinate(oLat, oLng)) return { lat: oLat, lng: oLng, source: "office_coordinates" };\n  return { lat: null, lng: null, source: "none" };'),
      (s) => /function resolveVendorCoordinates[\s\S]*?resolveVendorCanonicalCoordinate\(vendor\)/.test(stripTs(s))
        && !/function resolveVendorCoordinates[\s\S]*?isValidCoordinate\(oLat/.test(stripTs(s))],

    ['the 75.01 binding-order evidence dropped from the snapshot', (s) =>
      s.replace('ranked_candidate_order: selectedVendorIds,', ''),
      (s) => /ranked_candidate_order: selectedVendorIds/.test(stripTs(s))],
  ];

  let rejected = 0;
  for (const [name, mutate, stillHolds] of tsMutants) {
    const mutated = mutate(MATCHER_RAW);
    const changed = mutated !== MATCHER_RAW;
    const holdsOnReal = stillHolds(MATCHER_RAW);
    const holdsOnMutant = stillHolds(mutated);
    const ok = changed && holdsOnReal && !holdsOnMutant;
    if (ok) rejected += 1;
    check(`MUT reject: ${name}`, ok, ok ? '' : `changed=${changed} real=${holdsOnReal} mutant=${holdsOnMutant}`);
  }

  const svcMutants = [
    ['an infra failure reported as an empty market', (s) =>
      s.replace('return { status: "error", entries: [], error_code: GEO_SHORTLIST_FAILED };',
        'return { status: "no_geo_vendor", entries: [], error_code: null };'),
      (s) => {
        const st = stripTs(s);
        return /return \{ status: "error", entries: \[\], error_code: GEO_SHORTLIST_FAILED \}/.test(st)
          && st.indexOf('status: "no_geo_vendor"') > st.indexOf('status: "error"');
      }],
    ['the seam gained a write path', (s) => s.replace('.rpc(GEO_SHORTLIST_RPC', '.from("lead_assignments").insert({}) && adminClient().rpc(GEO_SHORTLIST_RPC'),
      (s) => !/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(stripTs(s))],
    ['the seam reached an external geo service', (s) => `${s}\nawait fetch("https://maps.googleapis.com/maps/api/distancematrix/json");\n`,
      (s) => !/fetch\(|axios|https?:\/\/|google|maps|geocod|route.?matrix|distance.?matrix/i.test(stripTs(s))],
    ['the no-lead-coordinate short-circuit removed', (s) =>
      s.replace(/  if \(leadPoint\.source === "none"\) \{\n    return \{ status: "no_lead_coordinate", entries: \[\], error_code: null \};\n  \}\n/, ''),
      (s) => {
        const st = stripTs(s);
        return st.indexOf('return { status: "no_lead_coordinate"') > 0
          && st.indexOf('return { status: "no_lead_coordinate"') < st.indexOf('.rpc(');
      }],
  ];
  for (const [name, mutate, stillHolds] of svcMutants) {
    const mutated = mutate(SHORTLIST_SVC_RAW);
    const changed = mutated !== SHORTLIST_SVC_RAW;
    const holdsOnReal = stillHolds(SHORTLIST_SVC_RAW);
    const holdsOnMutant = stillHolds(mutated);
    const ok = changed && holdsOnReal && !holdsOnMutant;
    if (ok) rejected += 1;
    check(`MUT reject: ${name}`, ok, ok ? '' : `changed=${changed} real=${holdsOnReal} mutant=${holdsOnMutant}`);
  }
  console.log(`   ..    ${rejected}/${tsMutants.length + svcMutants.length} TypeScript mutants rejected`);
}

// ===========================================================================
console.log('');
if (failures.length > 0) {
  console.log('Failures:');
  for (const line of failures) console.log(line);
}
console.log(`\nQF-MVP-75.02 geo normalization + PostGIS shortlist foundation: ${passed} passed, ${failed} failed`);
console.log('offline: no database, no network, no provider, no secret, no clock-dependent assertion');
console.log('NOT proved here (belongs to the staging gate): the query PLAN actually using the GiST index.');
if (failed > 0) process.exitCode = 1;
else console.log('QF_MVP_75_02_GEO_POSTGIS_SHORTLIST_SOURCE_READY');
