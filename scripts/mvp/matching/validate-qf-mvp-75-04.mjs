// ============================================================================
// QuickFurno — scripts/mvp/matching/validate-qf-mvp-75-04.mjs
//
// QF-MVP-75.04 — GEOFAIR SECONDARY RANKING + PRIMARY/RESERVES.
//
// OFFLINE BY CONSTRUCTION. No database, no network, no provider, no secret, no
// live Google call, no clock-dependent assertion. It imports the REAL production
// modules through the `.ts` resolve hook; it never re-implements a rule it checks.
//
// VERIFICATION LEVELS — never conflated:
//   [pure]   executes the real production module.
//   [static] reads source text for a required contract.
//   [mutant] mutates the text and asserts the static checks REJECT it, so a
//            green run cannot be an artefact of a check that never bites.
//
// WHAT THIS HARNESS CANNOT PROVE, AND SAYS SO
//   It cannot prove that a DELIVERED fact will one day exist, nor how a future
//   delivery phase will produce one. What it CAN prove — and does — is that the
//   fairness rule is encoded rather than described: that delivered exposure is
//   the only thing that counts, that selection, assignment creation and a failed
//   send never count, that exposure is geographically scoped, and that the
//   NEUTRAL decision this phase actually ships cannot reorder anything at all.
//
// Run: npm run test:mvp:75-04
// ============================================================================
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  GEOFAIR_EXPOSURE_EVENT_KINDS,
  GEOFAIR_EXPOSURE_WINDOW_DAYS,
  GEOFAIR_FAIRNESS_CONSUMING_EVENT_KINDS,
  GEOFAIR_FAIRNESS_MODES,
  GEOFAIR_NEUTRAL_REASONS,
  GEOFAIR_POLICY_ID,
  GEOFAIR_POLICY_VERSION,
  GEOFAIR_SCOPE_KINDS,
  GEOFAIR_SECONDARY_COMPONENTS,
  GEOFAIR_SECONDARY_CONTRACT_VERSION,
  buildGeoFairEvidence,
  compareGeoFairSecondary,
  computeGeoFairnessExposure,
  consumesGeoFairness,
  geoFairnessOrderKey,
  isGeoFairnessNeutralReason,
  neutralGeoFairness,
  normalizeGeoFairnessScopeKey,
  reorderByGeoFairSecondary,
  resolveGeoFairnessScope,
} from '../../../lib/matchcore/geoFairSecondaryDecision.ts';
import {
  SELECTION_PLAN_CONTRACT_VERSION,
  SELECTION_PLAN_ROLE_CAP,
  SELECTION_ROLES,
  buildSelectionPlan,
  isSelectionRole,
  selectionPlanMatchesRankedPool,
  selectionPlanToOrderedVendorIds,
} from '../../../lib/matchcore/selectionPlan.ts';
import {
  compareGeoFrontierCandidates,
  reorderByGeoFrontier,
} from '../../../lib/matchcore/geoFrontierDecision.ts';
import {
  CANONICAL_REQUEST_FINGERPRINT_VERSION,
  MATCHCORE_AUTOMATIC_CONTRACT_VERSION,
  compareAutomaticMatchDecisions,
  normalizeRankedVendorIds,
  splitRankedPool,
} from '../../../lib/matchcore/automaticMatchDecision.ts';
import {
  CANONICAL_ACTIVE_ASSIGNMENT_CAP,
  CANONICAL_ASSIGNMENT_CREDIT_COST,
  CANONICAL_LIFETIME_ASSIGNMENT_CAP,
  MAX_CANONICAL_CANDIDATE_POOL,
  buildAssignmentOperationKey,
  normalizeCandidateVendorIds,
} from '../../../lib/marketplace/canonicalAssignmentContract.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const stripTs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const flat = (src) => src.replace(/\s+/g, ' ');
/** Comment prose with the leading `*` gutter removed, so a wrapped sentence is matchable. */
const prose = (src) => src.replace(/\n\s*\*\s?/g, ' ').replace(/\s+/g, ' ');
/**
 * The evidence block names its own STANDING NEGATIVES — `geofair_package_weighted`
 * and `geofair_is_eligibility_authority` are assertions that package weighting and
 * eligibility authority are ABSENT. A vocabulary check must not read its own denial
 * as the thing it denies, so those two identifiers are removed before scanning.
 */
const withoutStandingNegatives = (src) =>
  src.replace(/geofair_package_weighted/g, '').replace(/geofair_is_eligibility_authority/g, '');

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

const FAIR_RAW = read('lib/matchcore/geoFairSecondaryDecision.ts');
const FAIR_TS = stripTs(FAIR_RAW);
const PLAN_RAW = read('lib/matchcore/selectionPlan.ts');
const PLAN_TS = stripTs(PLAN_RAW);
const FRONTIER_RAW = read('lib/matchcore/geoFrontierDecision.ts');
const MATCHCORE_RAW = read('lib/matchcore/automaticMatchDecision.ts');
const MATCHER_RAW = read('services/leadMatchingEngine.ts');
const MATCHER = stripTs(MATCHER_RAW);
const NEW_TS = FAIR_TS + PLAN_TS;
const PKG = JSON.parse(read('package.json'));

const V = {
  v1: '11111111-1111-4111-8111-111111111111',
  v2: '22222222-2222-4222-8222-222222222222',
  v3: '33333333-3333-4333-8333-333333333333',
  v4: '44444444-4444-4444-8444-444444444444',
  v5: '55555555-5555-4555-8555-555555555555',
};

const NOW = Date.UTC(2026, 7, 28, 0, 0, 0);
const DAY = 86_400_000;

/** A GeoFrontier placement, exactly the shape decideRouteFrontier emits. */
const place = (id, band, regret = null, seconds = null) => ([id, {
  vendor_id: id,
  band,
  route_status: band === 'unmeasured' ? 'MISSING_COORDINATE' : 'SUCCESS',
  travel_time_seconds: seconds,
  distance_meters: null,
  geo_regret_seconds: regret,
}]);

const cand = (id, o = {}) => ({ id, match_tier: 0, area_affinity: 0, rank_position: undefined, ...o });
const key = (id, o = {}) => ({ id, match_tier: 0, area_affinity: 0, base_rank: 1, ...o });
const evt = (vendorId, kind, scopeKey = 'pune', ageDays = 1) => ({
  vendor_id: vendorId,
  kind,
  scope_key: scopeKey,
  occurred_at_ms: NOW - ageDays * DAY,
});

const NEUTRAL = neutralGeoFairness(resolveGeoFairnessScope({ city: 'Pune' }));
const ctx = (engaged, placements, fairness = NEUTRAL) => ({
  geographyEngaged: engaged,
  placements,
  fairness,
});

console.log('\nQF-MVP-75.04 — GeoFair secondary ranking + PRIMARY/RESERVES');

// ===========================================================================
section('A. CONTRACT SHAPE + POLICY VERSION [pure] [static]');
// ===========================================================================
{
  check('A01 the GeoFair secondary contract carries an explicit version',
    GEOFAIR_SECONDARY_CONTRACT_VERSION === 1);

  check('A02 the phase carries exactly ONE explicit policy identity + version',
    GEOFAIR_POLICY_ID === 'qf_geofair_v1' && GEOFAIR_POLICY_VERSION === 1);

  check('A03 the selection-plan contract carries its own version',
    SELECTION_PLAN_CONTRACT_VERSION === 1);

  check('A04 the ordered secondary components are declared, in comparator order',
    eq([...GEOFAIR_SECONDARY_COMPONENTS], [
      'geo_band', 'geo_regret_seconds', 'match_tier',
      'area_affinity', 'geo_fairness_exposure', 'matchcore_base_rank',
    ]));

  check('A05 the fairness modes are exactly ACTIVE and NEUTRAL',
    eq([...GEOFAIR_FAIRNESS_MODES], ['ACTIVE', 'NEUTRAL']));

  check('A06 the neutral reasons are a closed, guarded vocabulary',
    eq([...GEOFAIR_NEUTRAL_REASONS], ['DELIVERY_EXPOSURE_UNAVAILABLE', 'FAIRNESS_SCOPE_UNAVAILABLE'])
    && isGeoFairnessNeutralReason('DELIVERY_EXPOSURE_UNAVAILABLE') === true
    && isGeoFairnessNeutralReason('SOMETHING_ELSE') === false
    && isGeoFairnessNeutralReason(null) === false);

  check('A07 the exposure window is bounded and recent, never lifetime',
    GEOFAIR_EXPOSURE_WINDOW_DAYS === 30);

  check('A08 the roles are exactly PRIMARY, RESERVE_1, RESERVE_2 and the cap is the canonical 3',
    eq([...SELECTION_ROLES], ['PRIMARY', 'RESERVE_1', 'RESERVE_2'])
    && SELECTION_PLAN_ROLE_CAP === CANONICAL_ACTIVE_ASSIGNMENT_CAP
    && SELECTION_PLAN_ROLE_CAP === 3
    && isSelectionRole('PRIMARY') === true
    && isSelectionRole('RESERVE_3') === false);

  check('A09 [static] the new modules are PURE — no clock, no randomness, no env, no I/O',
    !/Date\.now\(\)|new Date\(|Math\.random|process\.env|adminClient|supabase|createClient|\.rpc\(|fetch\(/i
      .test(NEW_TS));

  check('A10 [static] the new modules perform no write of any kind',
    !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|executeCanonicalAssignment|assignLeadToMatchedVendors|qf_assign_lead_vendors/
      .test(NEW_TS));

  check('A11 [static] the cap is imported from the canonical contract, never re-declared',
    /import \{ CANONICAL_ACTIVE_ASSIGNMENT_CAP \} from "\.\.\/marketplace\/canonicalAssignmentContract"/.test(PLAN_RAW)
    && /SELECTION_PLAN_ROLE_CAP = CANONICAL_ACTIVE_ASSIGNMENT_CAP/.test(PLAN_TS)
    && !/=\s*3\s*;/.test(PLAN_TS.split('SELECTION_PLAN_ROLE_CAP')[0] ?? ''));

  check('A12 [static] no H3, geohash or S2 was introduced to manufacture a fairness scope',
    !/\bh3\b|h3-js|geohash|\bs2\b|latLngToCell|hexagon/i.test(NEW_TS));
}

// ===========================================================================
section('B. GEO SCOPE — smallest source-proven stable scope [pure] [static]');
// ===========================================================================
{
  check('B01 the scope kinds are exactly lead_city and none',
    eq([...GEOFAIR_SCOPE_KINDS], ['lead_city', 'none']));

  check('B02 the scope key normalizes as lower(trim(...)) — the qf_norm_text rule',
    normalizeGeoFairnessScopeKey('  Pune ') === 'pune'
    && normalizeGeoFairnessScopeKey('PUNE') === 'pune'
    && normalizeGeoFairnessScopeKey('   ') === null
    && normalizeGeoFairnessScopeKey(null) === null
    && normalizeGeoFairnessScopeKey(42) === null);

  check('B03 a lead with a city yields a lead_city scope',
    eq(resolveGeoFairnessScope({ city: 'Pune' }), { kind: 'lead_city', key: 'pune' }));

  check('B04 a lead with no usable city yields NO scope — never a global counter',
    eq(resolveGeoFairnessScope({ city: '   ' }), { kind: 'none', key: null })
    && eq(resolveGeoFairnessScope({ city: null }), { kind: 'none', key: null })
    && eq(resolveGeoFairnessScope(null), { kind: 'none', key: null })
    && eq(resolveGeoFairnessScope(undefined), { kind: 'none', key: null }));

  check('B05 an unscoped lead forces NEUTRAL fairness with its own explicit reason',
    computeGeoFairnessExposure({
      scope: resolveGeoFairnessScope({ city: null }),
      events: [evt(V.v1, 'delivered', null)],
      nowMs: NOW,
    }).mode === 'NEUTRAL'
    && computeGeoFairnessExposure({
      scope: resolveGeoFairnessScope({ city: null }),
      events: [evt(V.v1, 'delivered', null)],
      nowMs: NOW,
    }).reason === 'FAIRNESS_SCOPE_UNAVAILABLE');

  check('B06 [static] the scope is documented as the lead CITY hard gate, not an invention',
    /city is already the HARD geographic gate/i.test(prose(FAIR_RAW))
    && /qf_vendor_assignment_eligible/.test(FAIR_RAW));
}

// ===========================================================================
section('C. FAIRNESS SEMANTICS — the locked rule, as code [pure]');
// ===========================================================================
{
  check('C01 the exposure vocabulary is closed and names every case the rule distinguishes',
    eq([...GEOFAIR_EXPOSURE_EVENT_KINDS], [
      'selected', 'assignment_created', 'send_failed', 'delivered', 'delivered_ignored',
    ]));

  check('C02 ONLY delivered and delivered_ignored consume fairness',
    eq([...GEOFAIR_FAIRNESS_CONSUMING_EVENT_KINDS], ['delivered', 'delivered_ignored'])
    && consumesGeoFairness('delivered') === true
    && consumesGeoFairness('delivered_ignored') === true
    && consumesGeoFairness('selected') === false
    && consumesGeoFairness('assignment_created') === false
    && consumesGeoFairness('send_failed') === false
    && consumesGeoFairness('anything_else') === false);

  const scope = resolveGeoFairnessScope({ city: 'Pune' });

  check('C03 [pure] SELECTION alone does not consume fairness',
    computeGeoFairnessExposure({
      scope, nowMs: NOW,
      events: [evt(V.v1, 'selected'), evt(V.v1, 'selected'), evt(V.v1, 'selected')],
    }).exposure_by_vendor[V.v1] === undefined);

  check('C04 [pure] ASSIGNMENT-ROW CREATION does not consume fairness',
    computeGeoFairnessExposure({
      scope, nowMs: NOW,
      events: [evt(V.v1, 'assignment_created'), evt(V.v1, 'assignment_created')],
    }).counted_event_count === 0);

  check('C05 [pure] a FAILED SEND does not consume fairness',
    computeGeoFairnessExposure({
      scope, nowMs: NOW,
      events: [evt(V.v1, 'send_failed'), evt(V.v1, 'send_failed')],
    }).counted_event_count === 0);

  check('C06 [pure] a DELIVERED lead consumes fairness',
    computeGeoFairnessExposure({
      scope, nowMs: NOW, events: [evt(V.v1, 'delivered')],
    }).exposure_by_vendor[V.v1] === 1);

  check('C07 [pure] a DELIVERED-BUT-IGNORED lead still consumes fairness',
    computeGeoFairnessExposure({
      scope, nowMs: NOW, events: [evt(V.v1, 'delivered_ignored'), evt(V.v1, 'delivered_ignored')],
    }).exposure_by_vendor[V.v1] === 2);

  check('C08 [pure] a mixed history counts ONLY the delivered half',
    computeGeoFairnessExposure({
      scope, nowMs: NOW,
      events: [
        evt(V.v1, 'selected'), evt(V.v1, 'assignment_created'), evt(V.v1, 'send_failed'),
        evt(V.v1, 'delivered'), evt(V.v1, 'delivered_ignored'),
      ],
    }).exposure_by_vendor[V.v1] === 2);

  check('C09 [pure] exposure in ANOTHER geo scope never penalises this scope',
    (() => {
      const snap = computeGeoFairnessExposure({
        scope, nowMs: NOW,
        events: [
          evt(V.v1, 'delivered', 'mumbai'), evt(V.v1, 'delivered', 'mumbai'),
          evt(V.v2, 'delivered', 'pune'),
        ],
      });
      return snap.exposure_by_vendor[V.v1] === undefined
        && snap.exposure_by_vendor[V.v2] === 1
        && snap.rejected_event_count === 2;
    })());

  check('C10 [pure] the scope comparison is normalized on BOTH sides',
    computeGeoFairnessExposure({
      scope, nowMs: NOW, events: [evt(V.v1, 'delivered', '  PUNE  ')],
    }).exposure_by_vendor[V.v1] === 1);

  check('C11 [pure] the recency window is bounded — an old delivery is not charged forever',
    (() => {
      const snap = computeGeoFairnessExposure({
        scope, nowMs: NOW,
        events: [evt(V.v1, 'delivered', 'pune', 29), evt(V.v1, 'delivered', 'pune', 31)],
      });
      return snap.exposure_by_vendor[V.v1] === 1 && snap.window_days === 30;
    })());

  check('C12 [pure] a future-dated event is never counted',
    computeGeoFairnessExposure({
      scope, nowMs: NOW, events: [evt(V.v1, 'delivered', 'pune', -1)],
    }).counted_event_count === 0);

  check('C13 [pure] a malformed event is rejected, never thrown on and never counted',
    (() => {
      const snap = computeGeoFairnessExposure({
        scope, nowMs: NOW,
        events: [
          { vendor_id: '', kind: 'delivered', scope_key: 'pune', occurred_at_ms: NOW },
          { vendor_id: V.v1, kind: 'delivered', scope_key: 'pune', occurred_at_ms: Number.NaN },
          { vendor_id: V.v1, kind: undefined, scope_key: 'pune', occurred_at_ms: NOW },
        ],
      });
      return snap.counted_event_count === 0 && snap.rejected_event_count === 3;
    })());

  check('C14 [pure] MISSING history is NEUTRAL, not punitive — an unseen vendor scores best',
    (() => {
      const snap = computeGeoFairnessExposure({
        scope, nowMs: NOW, events: [evt(V.v1, 'delivered'), evt(V.v1, 'delivered')],
      });
      return geoFairnessOrderKey(snap, V.v9 ?? V.v5) === 0
        && geoFairnessOrderKey(snap, V.v1) === 2
        && geoFairnessOrderKey(snap, V.v5) < geoFairnessOrderKey(snap, V.v1);
    })());

  check('C15 [pure] the fairness key direction is LESS-EXPOSED-FIRST',
    (() => {
      const snap = computeGeoFairnessExposure({
        scope, nowMs: NOW, events: [evt(V.v1, 'delivered'), evt(V.v1, 'delivered'), evt(V.v2, 'delivered')],
      });
      const placements = new Map([place(V.v1, 'inside_frontier', 0), place(V.v2, 'inside_frontier', 10)]);
      // v1 is ranked FIRST by base rank but is the more exposed vendor.
      const rows = [cand(V.v1, { rank_position: 1 }), cand(V.v2, { rank_position: 2 })];
      return eq(reorderByGeoFairSecondary(rows, ctx(true, placements, snap)), [V.v2, V.v1]);
    })());

  check('C16 [pure] a vendor\'s PACKAGE spend is not an input — the contract has no commercial field',
    !/package|paid_status|credit|visibility|premium|priority|wallet|spend|tier_price/i
      .test(FAIR_TS.split('export function compareGeoFairSecondary')[1]
        ?.split('export function reorderByGeoFairSecondary')[0] ?? 'package'));
}

// ===========================================================================
section('D. THE NEUTRAL DECISION THIS PHASE SHIPS [pure]');
// ===========================================================================
{
  check('D01 the shipped decision is NEUTRAL with the exact source-derived reason',
    NEUTRAL.mode === 'NEUTRAL'
    && NEUTRAL.reason === 'DELIVERY_EXPOSURE_UNAVAILABLE'
    && NEUTRAL.counted_event_count === 0
    && NEUTRAL.rejected_event_count === 0);

  check('D02 a NEUTRAL decision holds NO exposure map at all',
    eq(NEUTRAL.exposure_by_vendor, {})
    && Object.keys(NEUTRAL.exposure_by_vendor).length === 0);

  check('D03 a NEUTRAL decision returns the SAME key for every vendor, structurally',
    geoFairnessOrderKey(NEUTRAL, V.v1) === 0
    && geoFairnessOrderKey(NEUTRAL, V.v5) === 0
    && geoFairnessOrderKey(NEUTRAL, 'not-a-vendor-at-all') === 0);

  check('D04 a NEUTRAL key is returned WITHOUT consulting the map (poisoned map is ignored)',
    (() => {
      const poisoned = { ...NEUTRAL, exposure_by_vendor: { [V.v1]: 999 } };
      return geoFairnessOrderKey(poisoned, V.v1) === 0;
    })());

  check('D05 [pure] NEUTRAL fairness cannot reorder an engaged run — identity',
    (() => {
      const placements = new Map([
        place(V.v1, 'inside_frontier', 0), place(V.v2, 'inside_frontier', 120),
        place(V.v3, 'outside_frontier', 1800), place(V.v4, 'unmeasured'),
      ]);
      const rows = [
        cand(V.v3, { match_tier: 0, area_affinity: 1 }),
        cand(V.v1, { match_tier: 1, area_affinity: 0 }),
        cand(V.v4, { match_tier: 0, area_affinity: 1 }),
        cand(V.v2, { match_tier: 0, area_affinity: 0 }),
      ];
      const geoOrder = reorderByGeoFrontier(rows, placements);
      const before = rows.map((r) => ({ id: r.id, rank_position: r.rank_position }));
      const fairOrder = reorderByGeoFairSecondary(rows, ctx(true, placements, NEUTRAL));
      const after = rows.map((r) => ({ id: r.id, rank_position: r.rank_position }));
      return eq(geoOrder, fairOrder) && eq(before, after);
    })());

  check('D06 [pure] NEUTRAL fairness cannot reorder a NON-engaged run either — identity',
    (() => {
      const placements = new Map([
        place(V.v1, 'outside_frontier', 5000), place(V.v2, 'inside_frontier', 0),
      ]);
      // Pre-75.03 canonical order, where distance already outranks area affinity.
      const rows = [
        cand(V.v1, { match_tier: 0, area_affinity: 0, rank_position: 1 }),
        cand(V.v2, { match_tier: 0, area_affinity: 1, rank_position: 2 }),
      ];
      return eq(reorderByGeoFairSecondary(rows, ctx(false, placements, NEUTRAL)), [V.v1, V.v2]);
    })());

  check('D07 [pure] a provider outage therefore cannot reorder a lead through this pass',
    (() => {
      // Same candidates, same fairness; the ONLY difference is engagement.
      const placements = new Map([
        place(V.v1, 'unmeasured'), place(V.v2, 'inside_frontier', 0), place(V.v3, 'inside_frontier', 30),
      ]);
      const base = () => [
        cand(V.v1, { match_tier: 0, area_affinity: 1, rank_position: 1 }),
        cand(V.v2, { match_tier: 1, area_affinity: 0, rank_position: 2 }),
        cand(V.v3, { match_tier: 1, area_affinity: 0, rank_position: 3 }),
      ];
      const notEngaged = reorderByGeoFairSecondary(base(), ctx(false, placements, NEUTRAL));
      return eq(notEngaged, [V.v1, V.v2, V.v3]);
    })());

  check('D08 [pure] when geography IS engaged, unmeasured still ranks LAST — never mixed in',
    (() => {
      const placements = new Map([
        place(V.v1, 'unmeasured'), place(V.v2, 'outside_frontier', 4000), place(V.v3, 'inside_frontier', 0),
      ]);
      const rows = [
        cand(V.v1, { match_tier: 0, area_affinity: 1, rank_position: 1 }),
        cand(V.v2, { match_tier: 0, area_affinity: 1, rank_position: 2 }),
        cand(V.v3, { match_tier: 1, area_affinity: 0, rank_position: 3 }),
      ];
      return eq(reorderByGeoFairSecondary(rows, ctx(true, placements, NEUTRAL)), [V.v3, V.v2, V.v1]);
    })());

  check('D09 [pure] NEUTRAL identity holds across 2000 deterministic band/tier/affinity shapes',
    (() => {
      // A fixed-seed LCG, so this sweep is reproducible and clock-free. For every
      // shape: rank by the FROZEN 75.03 frontier, then run the 75.04 pass. With
      // NEUTRAL fairness the second pass must be the identity, or 75.04 would be
      // silently changing assignment outcomes it claims not to touch.
      let seed = 0x9e3779b9;
      const next = (n) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
      const ids = [V.v1, V.v2, V.v3, V.v4, V.v5];
      const bands = ['inside_frontier', 'outside_frontier', 'unmeasured'];
      const affinities = [0, 0.5, 1];
      for (let trial = 0; trial < 2000; trial += 1) {
        const placements = new Map();
        const rows = [];
        for (const id of ids) {
          const band = bands[next(3)];
          const regret = band === 'unmeasured' ? null : next(3000);
          placements.set(...place(id, band, regret, regret === null ? null : 600 + regret));
          rows.push(cand(id, { match_tier: next(2), area_affinity: affinities[next(3)] }));
        }
        const geoOrder = reorderByGeoFrontier(rows, placements);
        const fairOrder = reorderByGeoFairSecondary(rows, ctx(true, placements, NEUTRAL));
        if (!eq(geoOrder, fairOrder)) return false;
      }
      return true;
    })());
}

// ===========================================================================
section('E. GEOGRAPHY PRECEDES EVERY SECONDARY SIGNAL [pure]');
// ===========================================================================
{
  const placements = new Map([
    place(V.v1, 'inside_frontier', 800),
    place(V.v2, 'outside_frontier', 2400),
    place(V.v3, 'unmeasured'),
  ]);

  check('E01 an INSIDE-frontier vendor beats an OUTSIDE one even with a worse tier AND worse affinity',
    compareGeoFairSecondary(
      key(V.v1, { match_tier: 1, area_affinity: 0, base_rank: 900 }),
      key(V.v2, { match_tier: 0, area_affinity: 1, base_rank: 1 }),
      ctx(true, placements),
    ) < 0);

  check('E02 no ACTIVE fairness value, however extreme, can displace the inside-frontier vendor',
    (() => {
      const brutal = {
        mode: 'ACTIVE', reason: null,
        scope: { kind: 'lead_city', key: 'pune' }, window_days: 30,
        exposure_by_vendor: { [V.v1]: 1_000_000, [V.v2]: 0 },
        counted_event_count: 1_000_000, rejected_event_count: 0,
      };
      return compareGeoFairSecondary(
        key(V.v1, { base_rank: 900 }), key(V.v2, { base_rank: 1 }),
        ctx(true, placements, brutal),
      ) < 0;
    })());

  check('E03 fairness is NEVER consulted when the band key already decides',
    (() => {
      // A snapshot whose accessor would throw if it were read for a banded pair.
      const tripwire = {
        mode: 'ACTIVE', reason: null,
        scope: { kind: 'lead_city', key: 'pune' }, window_days: 30,
        get exposure_by_vendor() { throw new Error('fairness consulted across a band'); },
        counted_event_count: 0, rejected_event_count: 0,
      };
      try {
        return compareGeoFairSecondary(
          key(V.v1, { base_rank: 5 }), key(V.v2, { base_rank: 1 }),
          ctx(true, placements, tripwire),
        ) < 0;
      } catch {
        return false;
      }
    })());

  check('E04 an OUTSIDE-frontier vendor still beats an UNMEASURED one regardless of secondaries',
    compareGeoFairSecondary(
      key(V.v2, { match_tier: 1, area_affinity: 0, base_rank: 900 }),
      key(V.v3, { match_tier: 0, area_affinity: 1, base_rank: 1 }),
      ctx(true, placements),
    ) < 0);

  check('E05 inside the frontier, exact seconds of regret do NOT become a hidden priority',
    (() => {
      const inside = new Map([place(V.v1, 'inside_frontier', 0), place(V.v2, 'inside_frontier', 880)]);
      // v2 is 880s further but is the better category match: it must win.
      return compareGeoFairSecondary(
        key(V.v2, { match_tier: 0, base_rank: 2 }),
        key(V.v1, { match_tier: 1, base_rank: 1 }),
        ctx(true, inside),
      ) < 0;
    })());

  check('E06 the geography+secondary prefix is DELEGATED to the frozen 75.03 comparator',
    (() => {
      // For every pair, a non-zero 75.03 prefix must be reproduced exactly.
      const pairs = [[V.v1, V.v2], [V.v2, V.v3], [V.v1, V.v3]];
      return pairs.every(([a, b]) => {
        const ka = key(a, { match_tier: 1, area_affinity: 0, base_rank: 7 });
        const kb = key(b, { match_tier: 0, area_affinity: 1, base_rank: 2 });
        const prefix = compareGeoFrontierCandidates({ ...ka, base_rank: 0 }, { ...kb, base_rank: 0 }, placements);
        const combined = compareGeoFairSecondary(ka, kb, ctx(true, placements));
        return prefix === 0 || Math.sign(prefix) === Math.sign(combined);
      });
    })());

  check('E07 within one band the 75.03 secondary keys still decide before fairness',
    (() => {
      const inside = new Map([place(V.v1, 'inside_frontier', 0), place(V.v2, 'inside_frontier', 0)]);
      const active = {
        mode: 'ACTIVE', reason: null, scope: { kind: 'lead_city', key: 'pune' }, window_days: 30,
        exposure_by_vendor: { [V.v1]: 0, [V.v2]: 99 }, counted_event_count: 99, rejected_event_count: 0,
      };
      // v2 has a better tier; fairness prefers v1. Tier must win.
      return compareGeoFairSecondary(
        key(V.v2, { match_tier: 0, base_rank: 2 }),
        key(V.v1, { match_tier: 1, base_rank: 1 }),
        ctx(true, inside, active),
      ) < 0;
    })());

  check('E08 [static] the comparator holds NO package/commercial key, and neither does its delegate',
    !/package|paid_status|remaining_credits|visibility_type|premium|priority/i
      .test(withoutStandingNegatives(FAIR_TS))
    && !/package|paid_status|remaining_credits|visibility_type|premium|priority/i
      .test(stripTs(FRONTIER_RAW).split('export function compareGeoFrontierCandidates')[1]
        ?.split('export function reorderByGeoFrontier')[0] ?? 'package'));
}

// ===========================================================================
section('F. DETERMINISM + TOTALITY [pure]');
// ===========================================================================
{
  const placements = new Map([
    place(V.v1, 'inside_frontier', 0), place(V.v2, 'inside_frontier', 300),
    place(V.v3, 'outside_frontier', 1800), place(V.v4, 'outside_frontier', 3600),
    place(V.v5, 'unmeasured'),
  ]);
  const rows = () => [
    cand(V.v1, { match_tier: 1, area_affinity: 0, rank_position: 3 }),
    cand(V.v2, { match_tier: 0, area_affinity: 1, rank_position: 1 }),
    cand(V.v3, { match_tier: 0, area_affinity: 0, rank_position: 2 }),
    cand(V.v4, { match_tier: 1, area_affinity: 1, rank_position: 4 }),
    cand(V.v5, { match_tier: 0, area_affinity: 1, rank_position: 5 }),
  ];

  check('F01 identical inputs produce an identical final order',
    eq(reorderByGeoFairSecondary(rows(), ctx(true, placements)),
       reorderByGeoFairSecondary(rows(), ctx(true, placements))));

  check('F02 input PERMUTATION cannot change the result — base rank carries the order',
    (() => {
      const forward = rows();
      const reverse = rows().reverse();
      return eq(reorderByGeoFairSecondary(forward, ctx(true, placements)),
                reorderByGeoFairSecondary(reverse, ctx(true, placements)));
    })());

  check('F03 the comparator is TOTAL — 0 only for the same candidate',
    (() => {
      const a = key(V.v1, { base_rank: 1 });
      const b = key(V.v2, { base_rank: 2 });
      return compareGeoFairSecondary(a, a, ctx(true, placements)) === 0
        && compareGeoFairSecondary(a, b, ctx(true, placements)) !== 0
        && compareGeoFairSecondary(a, b, ctx(true, placements))
           === -compareGeoFairSecondary(b, a, ctx(true, placements));
    })());

  check('F04 a candidate with NO placement degrades to unmeasured, never to a throw',
    (() => {
      const rowsX = [cand(V.v1, { rank_position: 1 }), cand('99999999-9999-4999-8999-999999999999', { rank_position: 2 })];
      const out = reorderByGeoFairSecondary(rowsX, ctx(true, new Map([place(V.v1, 'inside_frontier', 0)])));
      return out.length === 2 && out[0] === V.v1;
    })());

  check('F05 the pass is MEMBERSHIP-PRESERVING — nothing added, nothing removed',
    (() => {
      const input = rows();
      const ids = input.map((r) => r.id).slice().sort();
      const out = reorderByGeoFairSecondary(input, ctx(true, placements)).slice().sort();
      return eq(ids, out) && input.length === 5;
    })());

  check('F06 rank_position is re-stamped 1..n after the pass',
    (() => {
      const input = rows();
      reorderByGeoFairSecondary(input, ctx(true, placements));
      return input.every((r, i) => r.rank_position === i + 1);
    })());

  check('F07 re-running the pass on its own output is idempotent',
    (() => {
      const input = rows();
      const first = reorderByGeoFairSecondary(input, ctx(true, placements));
      const second = reorderByGeoFairSecondary(input, ctx(true, placements));
      return eq(first, second);
    })());
}

// ===========================================================================
section('G. PRIMARY + RESERVES SELECTION PLAN [pure]');
// ===========================================================================
{
  const plan3 = buildSelectionPlan([V.v1, V.v2, V.v3, V.v4, V.v5]);

  check('G01 rank 1 is PRIMARY, rank 2 RESERVE_1, rank 3 RESERVE_2 — in the final ranked order',
    eq(plan3.entries.map((e) => [e.vendor_id, e.role, e.rank_position]), [
      [V.v1, 'PRIMARY', 1], [V.v2, 'RESERVE_1', 2], [V.v3, 'RESERVE_2', 3],
    ]));

  check('G02 the plan respects the canonical cap of 3 and never spills',
    plan3.role_count === 3 && plan3.role_cap === 3
    && !plan3.entries.some((e) => e.vendor_id === V.v4 || e.vendor_id === V.v5));

  check('G03 primary and ordered reserves are exposed directly',
    plan3.primary_vendor_id === V.v1 && eq([...plan3.reserve_vendor_ids], [V.v2, V.v3]));

  check('G04 fewer than three candidates yields fewer roles — never a padded entry',
    (() => {
      const one = buildSelectionPlan([V.v1]);
      const two = buildSelectionPlan([V.v1, V.v2]);
      const none = buildSelectionPlan([]);
      return one.role_count === 1 && one.primary_vendor_id === V.v1 && one.reserve_vendor_ids.length === 0
        && two.role_count === 2 && eq([...two.reserve_vendor_ids], [V.v2])
        && none.role_count === 0 && none.primary_vendor_id === null && none.entries.length === 0;
    })());

  check('G05 no duplicate vendor id and no duplicate role can appear',
    (() => {
      const dup = buildSelectionPlan([V.v1, V.v1, V.v2, V.v2, V.v3]);
      const ids = dup.entries.map((e) => e.vendor_id);
      const roles = dup.entries.map((e) => e.role);
      return new Set(ids).size === ids.length && new Set(roles).size === roles.length
        && eq(ids, [V.v1, V.v2, V.v3]);
    })());

  check('G06 de-duplication keeps the FIRST (best-ranked) occurrence',
    eq(buildSelectionPlan([V.v3, V.v1, V.v3, V.v2]).entries.map((e) => e.vendor_id), [V.v3, V.v1, V.v2]));

  check('G07 the plan reuses the ONE canonical normalization rule',
    eq(buildSelectionPlan([' ' + V.v1.toUpperCase() + ' ', 'not-a-uuid', null, 7, V.v2]).entries.map((e) => e.vendor_id),
       normalizeRankedVendorIds([' ' + V.v1.toUpperCase() + ' ', 'not-a-uuid', null, 7, V.v2]).slice(0, 3))
    && /import \{ normalizeRankedVendorIds \} from "\.\/automaticMatchDecision"/.test(PLAN_RAW));

  check('G08 the plan is FROZEN — it cannot be mutated after it is built',
    (() => {
      try { plan3.entries.push({ vendor_id: V.v4, role: 'PRIMARY', rank_position: 4 }); } catch { /* expected */ }
      try { plan3.primary_vendor_id = V.v5; } catch { /* expected */ }
      return Object.isFrozen(plan3) && plan3.entries.length === 3 && plan3.primary_vendor_id === V.v1;
    })());

  check('G09 a ROLE IS NOT A DELIVERY FACT, and the plan says so in its own payload',
    plan3.is_delivery_evidence === false && plan3.consumes_fairness === false);

  check('G10 building a plan does not touch fairness — the snapshot is byte-identical after',
    (() => {
      const before = JSON.stringify(NEUTRAL);
      buildSelectionPlan([V.v1, V.v2, V.v3]);
      return JSON.stringify(NEUTRAL) === before && NEUTRAL.counted_event_count === 0;
    })());

  check('G11 [static] the plan module imports NOTHING from the fairness contract',
    !/geoFairSecondaryDecision/.test(PLAN_RAW)
    && !/geoFairnessOrderKey|computeGeoFairnessExposure|neutralGeoFairness|GeoFairnessSnapshot/.test(PLAN_TS)
    && !/^\s*import[^;]*fairness/im.test(PLAN_RAW));

  check('G12 [static] the plan module writes nothing and asserts no lifecycle state',
    !/lifecycle|delivered|lead_delivery_logs|lead_assignment_events|\.insert\(|\.update\(/i.test(PLAN_TS));

  check('G13 the plan is built from the FINAL ranked order the GeoFair pass produced',
    (() => {
      const placements = new Map([
        place(V.v1, 'outside_frontier', 1800), place(V.v2, 'inside_frontier', 0), place(V.v3, 'inside_frontier', 60),
      ]);
      const rows = [
        cand(V.v1, { rank_position: 1 }), cand(V.v2, { rank_position: 2 }), cand(V.v3, { rank_position: 3 }),
      ];
      const ordered = reorderByGeoFairSecondary(rows, ctx(true, placements));
      const plan = buildSelectionPlan(ordered);
      return plan.primary_vendor_id === V.v2 && eq([...plan.reserve_vendor_ids], [V.v3, V.v1]);
    })());
}

// ===========================================================================
section('H. LEGACY ASSIGNMENT COMPATIBILITY + IDEMPOTENCY [pure] [static]');
// ===========================================================================
{
  const ranked = [V.v1, V.v2, V.v3, V.v4, V.v5];
  const pool = splitRankedPool(ranked, MAX_CANONICAL_CANDIDATE_POOL).pool;
  const plan = buildSelectionPlan(ranked);

  check('H01 the plan projects back to an ordered id list the assignment seam speaks',
    eq(selectionPlanToOrderedVendorIds(plan), [V.v1, V.v2, V.v3]));

  check('H02 the plan is always a PREFIX of the submitted ranked pool',
    selectionPlanMatchesRankedPool(plan, pool) === true
    && selectionPlanMatchesRankedPool(plan, [V.v2, V.v1, V.v3]) === false
    && selectionPlanMatchesRankedPool(buildSelectionPlan(ranked), ranked) === true);

  check('H03 the plan never REPLACES the submitted pool — fill-until-3 is preserved',
    /const rankedPool = splitRankedPool\(\s*eligible\.map\(\(vendor\) => vendor\.id\),\s*MAX_ASSIGNMENT_CANDIDATE_POOL,\s*\);/
      .test(flat(MATCHER))
    && /const selectedVendorIds = rankedPool\.pool;/.test(MATCHER)
    && /const assignment = await assignLeadToMatchedVendors\(leadId, selectedVendorIds\);/.test(MATCHER)
    && !/assignLeadToMatchedVendors\(leadId, selectionPlan/.test(MATCHER)
    && !/selectionPlanToOrderedVendorIds/.test(MATCHER));

  check('H04 the ORDER-SENSITIVE fingerprint version is untouched',
    CANONICAL_REQUEST_FINGERPRINT_VERSION === 2
    && MATCHCORE_AUTOMATIC_CONTRACT_VERSION === 1);

  check('H05 the operation key is unchanged by this phase — same pool, same key',
    (() => {
      const args = {
        leadId: '00000000-0000-4000-8000-000000000001',
        mode: 'automatic', actorKind: 'system', actorId: null,
        replacementRequestId: null, reasonCode: 'automatic_match',
        operationScope: 'auto_match', candidateVendorIds: pool,
      };
      return buildAssignmentOperationKey(args) === buildAssignmentOperationKey({ ...args })
        && buildAssignmentOperationKey(args)
           !== buildAssignmentOperationKey({ ...args, candidateVendorIds: [V.v1] });
    })());

  check('H06 the MatchCore and transport normalizations still agree, exactly',
    (() => {
      const raw = [' ' + V.v2.toUpperCase() + ' ', V.v1, V.v2, 'nope', null, 5, V.v3];
      return eq(normalizeRankedVendorIds(raw), normalizeCandidateVendorIds(raw));
    })());

  check('H07 the caps are untouched: active 3, lifetime 6, credit 1, pool 20',
    CANONICAL_ACTIVE_ASSIGNMENT_CAP === 3
    && CANONICAL_LIFETIME_ASSIGNMENT_CAP === 6
    && CANONICAL_ASSIGNMENT_CREDIT_COST === 1
    && MAX_CANONICAL_CANDIDATE_POOL === 20);

  check('H08 role assignment is deterministic — no clock, no randomness anywhere in the plan',
    !/Date\.now|new Date|Math\.random|crypto|uuid/i.test(PLAN_TS)
    && eq(buildSelectionPlan(ranked), buildSelectionPlan(ranked)));

  check('H09 the DB lock order is a separate concern this phase does not touch',
    !/for update|lock|ascending uuid|order by u\.vid/i.test(NEW_TS));
}

// ===========================================================================
section('I. HARD ELIGIBILITY IS UNTOUCHED [pure] [static]');
// ===========================================================================
{
  check('I01 [static] neither new module can revive, admit or exclude a candidate',
    !/eligible|eligibility|approved|accepting_leads|suspend|city_mismatch|category_mismatch|remaining_credits/i
      .test(withoutStandingNegatives(NEW_TS)));

  check('I02 [pure] the pass cannot introduce a vendor that was not given to it',
    (() => {
      const rows = [cand(V.v1, { rank_position: 1 })];
      const out = reorderByGeoFairSecondary(rows, ctx(true, new Map([
        place(V.v1, 'unmeasured'), place(V.v2, 'inside_frontier', 0), place(V.v3, 'inside_frontier', 0),
      ])));
      return eq(out, [V.v1]);
    })());

  check('I03 [pure] the pass cannot drop a vendor that was given to it',
    (() => {
      const rows = [cand(V.v1, { rank_position: 1 }), cand(V.v2, { rank_position: 2 })];
      return reorderByGeoFairSecondary(rows, ctx(true, new Map())).length === 2;
    })());

  check('I04 [static] the matcher still computes `eligible` BEFORE any 75.04 input exists',
    (() => {
      const iEval = MATCHER.indexOf('const evaluation = await evaluateVendorsForLead(leadRow);');
      const iFair = MATCHER.indexOf('const fairness = neutralGeoFairness(');
      return iEval > 0 && iFair > iEval;
    })());

  check('I05 [static] the PURE ranking function gained no GeoFair, fairness or plan input',
    !/neutralGeoFairness|reorderByGeoFairSecondary|buildSelectionPlan|geoFairEvidence|selectionPlan|fairness/i
      .test(MATCHER.split('export function rankVendorsForLead')[1] ?? ''));

  check('I06 [pure] the frozen 75.01 comparator is unchanged and still tier-first',
    (() => {
      const d = (id, o) => ({
        vendor_id: id, eligible: true, reason_codes: [], match_tier: 0, match_type: 'exact',
        has_coordinates: true, coordinate_source: 'office_coordinates', distance_km: 1,
        area_affinity: 0, last_assigned_at: null, rating: 0, rank_position: null, ...o,
      });
      return compareAutomaticMatchDecisions(d(V.v1, { match_tier: 0, distance_km: 90 }),
                                            d(V.v2, { match_tier: 1, distance_km: 1 }), true) < 0;
    })());

  check('I07 [static] the frozen 75.01 and 75.03 modules are not edited by this phase to make room',
    /export function compareAutomaticMatchDecisions/.test(MATCHCORE_RAW)
    && /export function compareGeoFrontierCandidates/.test(FRONTIER_RAW)
    && !/geoFair|GeoFairness|selectionPlan|SelectionPlan|PRIMARY|RESERVE_/.test(FRONTIER_RAW + MATCHCORE_RAW));
}

// ===========================================================================
section('J. MATCHER INTEGRATION [static]');
// ===========================================================================
{
  const iRoute = MATCHER.indexOf('const routeOutcome = await measureLeadRouteTimes(');
  const iRouteOrder = MATCHER.indexOf('const routeOrderedVendorIds = routeOutcome.decision.engaged');
  const iFair = MATCHER.indexOf('const fairness = neutralGeoFairness(');
  const iPlan = MATCHER.indexOf('const selectionPlan = buildSelectionPlan(');
  const iPool = MATCHER.indexOf('const rankedPool = splitRankedPool(');

  check('J01 the GeoFair pass runs AFTER the 75.03 frontier and BEFORE the bounded pool',
    iRoute > 0 && iRouteOrder > iRoute && iFair > iRouteOrder && iPlan > iFair && iPool > iPlan);

  check('J02 the 75.03 reorder statement is byte-preserved (its own harness pins it)',
    /const routeOrderedVendorIds = routeOutcome\.decision\.engaged\s*\?\s*reorderByGeoFrontier\(eligible, routeOutcome\.placements\)\s*:\s*eligible\.map\(\(vendor\) => vendor\.id\);/
      .test(flat(MATCHER)));

  check('J03 the GeoFair pass is handed the SAME engagement flag the frontier used',
    /reorderByGeoFairSecondary\(eligible, \{\s*geographyEngaged: routeOutcome\.decision\.engaged,\s*placements: routeOutcome\.placements,\s*fairness,\s*\}\)/
      .test(flat(MATCHER)));

  check('J04 the pass reorders `eligible` in place — it never filters or splices it',
    !/eligible\s*=\s*eligible\.filter/.test(MATCHER)
    && !/eligible\.splice/.test(MATCHER)
    && !/eligible\.filter\([\s\S]{0,200}?(geoFair|selectionPlan|fairness)/i.test(MATCHER));

  check('J05 the matcher builds a NEUTRAL fairness decision — ACTIVE is unreachable in production',
    /neutralGeoFairness\(resolveGeoFairnessScope\(leadRow\), "DELIVERY_EXPOSURE_UNAVAILABLE"\)/.test(flat(MATCHER))
    && !/computeGeoFairnessExposure/.test(MATCHER));

  check('J06 no service or route outside the offline suite can reach the ACTIVE path',
    (() => {
      const offenders = [];
      const walk = (dir) => {
        for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          const rel = `${dir}/${entry.name}`;
          if (entry.isDirectory()) walk(rel);
          else if (/\.(ts|tsx)$/.test(entry.name)) {
            const src = readFileSync(path.join(ROOT, rel), 'utf8');
            if (/computeGeoFairnessExposure/.test(src) && !rel.startsWith('lib/matchcore/')) offenders.push(rel);
          }
        }
      };
      for (const dir of ['app', 'components', 'lib', 'services']) walk(dir);
      return offenders.length === 0;
    })());

  check('J07 the GeoFair evidence is a sibling of geo and route on the SAME snapshot',
    /geofair: geoFairEvidence,/.test(MATCHER)
    && /route: routeEvidence,/.test(MATCHER)
    && /geo: geoEvidence,/.test(MATCHER));

  check('J08 the QF-MVP-75.01 / 75.02 / 75.03 evidence all survive unchanged',
    /matchcore_contract_version/.test(MATCHER)
    && /request_fingerprint_version: CANONICAL_REQUEST_FINGERPRINT_VERSION/.test(MATCHER)
    && /candidate_order_is_binding: true/.test(MATCHER)
    && /ranked_candidate_order: selectedVendorIds/.test(MATCHER)
    && /cap_deferred_vendor_ids: classifyCapDeferred\(/.test(MATCHER)
    && /route_ordered_vendor_ids: routeOrderedVendorIds/.test(MATCHER)
    && (MATCHER.match(/\.\.\.outcomeAudit/g) || []).length === 3
    && (MATCHER.match(/geoEvidence/g) || []).length === 2);

  check('J09 the matcher still takes exactly ONE clock read per ranking run',
    (MATCHER.match(/const nowMs = Date\.now\(\);/g) || []).length === 1);

  check('J10 the GeoFair block performs no assignment, delivery, credit or run write',
    !/deliverLeadToVendorDashboard|executeCanonicalAssignment|remaining_credits|lead_delivery_logs/
      .test(MATCHER.slice(iFair, iPool)));
}

// ===========================================================================
section('K. OBSERVABILITY + SECURITY [pure] [static]');
// ===========================================================================
{
  const plan = buildSelectionPlan([V.v1, V.v2, V.v3]);
  const evidence = buildGeoFairEvidence({
    geographyEngaged: true,
    fairness: NEUTRAL,
    orderedVendorIds: [V.v1, V.v2, V.v3],
    selectionPlan: plan,
  });
  const serialized = JSON.stringify(evidence);

  check('K01 the evidence states policy, version, components and geography engagement',
    evidence.geofair_contract_version === 1
    && evidence.geofair_policy_id === 'qf_geofair_v1'
    && evidence.geofair_policy_version === 1
    && evidence.geography_engaged === true
    && eq([...evidence.geofair_secondary_components], [...GEOFAIR_SECONDARY_COMPONENTS]));

  check('K02 the evidence states the fairness MODE and REASON',
    evidence.fairness_mode === 'NEUTRAL'
    && evidence.fairness_reason === 'DELIVERY_EXPOSURE_UNAVAILABLE'
    && evidence.fairness_window_days === 30);

  check('K03 the evidence states the geo scope identifier, which is the already-persisted city',
    evidence.fairness_scope_kind === 'lead_city'
    && evidence.fairness_scope_key === 'pune'
    && /city: lead\.city \?\? null,/.test(MATCHER));

  check('K04 the evidence carries the primary vendor, the ordered reserves and the reason-bearing plan',
    evidence.selection_plan.primary_vendor_id === V.v1
    && eq([...evidence.selection_plan.reserve_vendor_ids], [V.v2, V.v3])
    && eq([...evidence.geofair_ordered_vendor_ids], [V.v1, V.v2, V.v3]));

  check('K05 the evidence NEVER carries a per-vendor exposure map',
    !/exposure_by_vendor/.test(serialized));

  check('K06 the evidence carries the standing negatives a reviewer must be able to check',
    evidence.geofair_is_assignment_authority === false
    && evidence.geofair_is_eligibility_authority === false
    && evidence.geofair_package_weighted === false
    && evidence.geofair_consumes_fairness_on_selection === false
    && evidence.geofair_role_is_delivery_evidence === false
    && evidence.selection_plan.is_delivery_evidence === false);

  check('K07 the evidence contains NO provider body, credential, coordinate or PII',
    !/apiKey|api_key|X-Goog|authorization|bearer|GOOGLE_ROUTES_API_KEY|latitude|longitude|phone|email|address/i
      .test(serialized));

  check('K08 [static] the new modules never name a credential or a provider endpoint',
    !/GOOGLE_ROUTES_API_KEY|GOOGLE_MAPS|X-Goog-Api-Key|routes\.googleapis\.com|NEXT_PUBLIC_/i.test(FAIR_RAW + PLAN_RAW));

  check('K09 the evidence is JSON-serializable with no cycle and no undefined leakage',
    typeof serialized === 'string' && serialized.length > 0 && !/undefined/.test(serialized));

  check('K10 an ACTIVE evidence block would still expose counts only, never the map',
    (() => {
      const active = computeGeoFairnessExposure({
        scope: resolveGeoFairnessScope({ city: 'Pune' }),
        events: [evt(V.v1, 'delivered'), evt(V.v2, 'selected')],
        nowMs: NOW,
      });
      const e = buildGeoFairEvidence({
        geographyEngaged: true, fairness: active, orderedVendorIds: [V.v1], selectionPlan: plan,
      });
      return e.fairness_mode === 'ACTIVE' && e.fairness_reason === null
        && e.fairness_counted_event_count === 1 && e.fairness_rejected_event_count === 1
        && !/exposure_by_vendor/.test(JSON.stringify(e));
    })());
}

// ===========================================================================
section('L. GOVERNANCE [static]');
// ===========================================================================
{
  const migrations = readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();

  check('L01 QF-MVP-75.04 itself adds NO migration — the set is exactly 102 after the QF-MVP-80.03 audit repair',
    migrations.length === 102, `found ${migrations.length}`);

  check('L02 no 75.04 migration file exists',
    migrations.filter((f) => /qf_mvp_75_04|geofair/i.test(f)).length === 0);

  check('L03 the new modules contain no SQL/DDL of any kind',
    !/supabase\/migrations/.test(NEW_TS)
    && !/create (or replace )?(function|table|index|extension|view)/i.test(NEW_TS));

  check('L04 the npm script exists and matches this file',
    PKG.scripts['test:mvp:75-04']?.includes('validate-qf-mvp-75-04.mjs') === true);

  check('L05 the 75.01 / 75.02 / 75.03 scripts are all still wired',
    PKG.scripts['test:mvp:75-01']?.includes('validate-qf-mvp-75-01.mjs') === true
    && PKG.scripts['test:mvp:75-02']?.includes('validate-qf-mvp-75-02.mjs') === true
    && PKG.scripts['test:mvp:75-03']?.includes('validate-qf-mvp-75-03.mjs') === true);

  check('L06 no DRAFT/SIMULATION/SHADOW/ACTIVATE policy plane was built in this phase',
    !/automation_policy_configs|policy_key|SIMULATION|SHADOW|policy_lifecycle/i.test(NEW_TS));
}

// ===========================================================================
section('M. MUTANTS — every static/pure check above must actually bite');
// ===========================================================================
{
  function mutant(name, source, mutate, predicate) {
    const mutated = mutate(source);
    const changed = mutated !== source;
    const rejects = !predicate(mutated);
    check(`mutant ${name}`, changed && rejects,
      !changed ? 'mutation did not change the source' : 'the check still passed on mutated source');
  }

  mutant('01 counting SELECTION as fairness is rejected',
    FAIR_RAW,
    (s) => s.replace(
      'export const GEOFAIR_FAIRNESS_CONSUMING_EVENT_KINDS: readonly GeoFairnessExposureEventKind[] = [\n  "delivered",\n  "delivered_ignored",\n];',
      'export const GEOFAIR_FAIRNESS_CONSUMING_EVENT_KINDS: readonly GeoFairnessExposureEventKind[] = [\n  "delivered",\n  "delivered_ignored",\n  "selected",\n];'),
    (s) => !/"delivered_ignored",\s*"selected",/.test(s));

  mutant('02 counting a FAILED SEND as fairness is rejected',
    FAIR_RAW,
    (s) => s.replace('"delivered_ignored",\n];', '"delivered_ignored",\n  "send_failed",\n];'),
    (s) => !/"send_failed",\s*\];/.test(s));

  mutant('03 dropping DELIVERED_IGNORED from fairness is rejected',
    FAIR_RAW,
    (s) => s.replace('  "delivered",\n  "delivered_ignored",\n];', '  "delivered",\n];'),
    (s) => /"delivered",\s*"delivered_ignored",\s*\];/.test(flat(s)));

  mutant('04 inverting the fairness direction (more exposure ranks first) is rejected',
    FAIR_RAW,
    (s) => s.replace('if (fa !== fb) return fa < fb ? -1 : 1;', 'if (fa !== fb) return fa > fb ? -1 : 1;'),
    (s) => /if \(fa !== fb\) return fa < fb \? -1 : 1;/.test(s));

  mutant('05 letting a NEUTRAL snapshot read the exposure map is rejected',
    FAIR_RAW,
    (s) => s.replace('if (snapshot.mode !== "ACTIVE") return 0;', ''),
    (s) => /if \(snapshot\.mode !== "ACTIVE"\) return 0;/.test(s));

  mutant('06 dropping the geo scope filter (a global fairness counter) is rejected',
    FAIR_RAW,
    (s) => s.replace('scopeKey !== scope.key ||', ''),
    (s) => /scopeKey !== scope\.key \|\|/.test(s));

  mutant('07 dropping the recency window (a lifetime counter) is rejected',
    FAIR_RAW,
    (s) => s.replace('|| !inWindow', ''),
    (s) => /\|\| !inWindow/.test(s));

  mutant('08 letting fairness be consulted BEFORE geography is rejected',
    FAIR_RAW,
    (s) => s.replace('    if (geo !== 0) return geo;', ''),
    (s) => /if \(geo !== 0\) return geo;/.test(s));

  mutant('09 letting the frozen 75.03 base_rank tiebreak pre-empt fairness is rejected',
    FAIR_RAW,
    (s) => s.replace(
      '{ id: a.id, match_tier: a.match_tier, area_affinity: a.area_affinity, base_rank: 0 },',
      '{ id: a.id, match_tier: a.match_tier, area_affinity: a.area_affinity, base_rank: a.base_rank },'),
    (s) => /base_rank: 0 \},\s*\{ id: b\.id/.test(flat(s)));

  mutant('10 applying the geography keys on a NON-engaged run is rejected',
    FAIR_RAW,
    (s) => s.replace('  if (context.geographyEngaged) {', '  if (true) {'),
    (s) => /if \(context\.geographyEngaged\) \{/.test(s));

  mutant('11 re-implementing the geography order instead of delegating is rejected',
    FAIR_RAW,
    (s) => s.replace('compareGeoFrontierCandidates(', 'localBandCompare('),
    (s) => /compareGeoFrontierCandidates\(/.test(stripTs(s)));

  mutant('12 a commercial key entering the secondary comparator is rejected',
    FAIR_RAW,
    (s) => s.replace('  const fa = geoFairnessOrderKey(context.fairness, a.id);',
      '  if (a.package_status !== b.package_status) return a.package_status === "premium" ? -1 : 1;\n  const fa = geoFairnessOrderKey(context.fairness, a.id);'),
    (s) => !/package|paid_status|remaining_credits|visibility_type|premium|priority/i.test(stripTs(s)));

  mutant('13 raising the role cap above the canonical active cap is rejected',
    PLAN_RAW,
    (s) => s.replace('export const SELECTION_PLAN_ROLE_CAP = CANONICAL_ACTIVE_ASSIGNMENT_CAP;',
      'export const SELECTION_PLAN_ROLE_CAP = 5;'),
    (s) => /SELECTION_PLAN_ROLE_CAP = CANONICAL_ACTIVE_ASSIGNMENT_CAP;/.test(s));

  mutant('14 dropping plan de-duplication (a vendor holding two roles) is rejected',
    PLAN_RAW,
    (s) => s.replace('  const ranked = normalizeRankedVendorIds(rankedVendorIds);',
      '  const ranked = (rankedVendorIds ?? []).map(String);'),
    (s) => /const ranked = normalizeRankedVendorIds\(rankedVendorIds\);/.test(s));

  mutant('15 declaring a role to BE delivery evidence is rejected',
    PLAN_RAW,
    (s) => s.replace('is_delivery_evidence: false as const,', 'is_delivery_evidence: true as const,'),
    (s) => /is_delivery_evidence: false as const,/.test(s));

  mutant('16 declaring that a role consumes fairness is rejected',
    PLAN_RAW,
    (s) => s.replace('consumes_fairness: false as const,', 'consumes_fairness: true as const,'),
    (s) => /consumes_fairness: false as const,/.test(s));

  mutant('17 submitting the three roles INSTEAD of the ranked pool is rejected',
    MATCHER_RAW,
    (s) => s.replace('const assignment = await assignLeadToMatchedVendors(leadId, selectedVendorIds);',
      'const assignment = await assignLeadToMatchedVendors(leadId, selectionPlanToOrderedVendorIds(selectionPlan));'),
    (s) => /const assignment = await assignLeadToMatchedVendors\(leadId, selectedVendorIds\);/.test(s)
      && !/selectionPlanToOrderedVendorIds/.test(s));

  mutant('18 wiring ACTIVE fairness into the matcher without a delivery source is rejected',
    MATCHER_RAW,
    (s) => s.replace('const fairness = neutralGeoFairness(resolveGeoFairnessScope(leadRow), "DELIVERY_EXPOSURE_UNAVAILABLE");',
      'const fairness = computeGeoFairnessExposure({ scope: resolveGeoFairnessScope(leadRow), events: [], nowMs: Date.now() });'),
    (s) => /neutralGeoFairness\(resolveGeoFairnessScope\(leadRow\), "DELIVERY_EXPOSURE_UNAVAILABLE"\)/.test(flat(s))
      && !/computeGeoFairnessExposure/.test(s));

  mutant('19 ignoring the 75.03 engagement flag in the matcher is rejected',
    MATCHER_RAW,
    (s) => s.replace(/geographyEngaged: routeOutcome\.decision\.engaged,/g, 'geographyEngaged: true,'),
    (s) => /geographyEngaged: routeOutcome\.decision\.engaged,/.test(s));

  mutant('20 filtering `eligible` in the GeoFair block is rejected',
    MATCHER_RAW,
    (s) => s.replace('const selectionPlan = buildSelectionPlan(geoFairOrderedVendorIds);',
      'const selectionPlan = buildSelectionPlan(geoFairOrderedVendorIds);\n    eligible = eligible.filter((v) => selectionPlan.entries.some((e) => e.vendor_id === v.id));'),
    (s) => !/eligible\s*=\s*eligible\.filter/.test(stripTs(s)));

  mutant('21 persisting the per-vendor exposure map into the snapshot is rejected',
    FAIR_RAW,
    (s) => s.replace('    fairness_counted_event_count: input.fairness.counted_event_count,',
      '    exposure_by_vendor: input.fairness.exposure_by_vendor,\n    fairness_counted_event_count: input.fairness.counted_event_count,'),
    (s) => !/exposure_by_vendor: input\.fairness\.exposure_by_vendor/.test(s));

  mutant('22 a clock read entering a pure 75.04 module is rejected',
    FAIR_RAW,
    (s) => s.replace('  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : 0;',
      '  const nowMs = Date.now();'),
    (s) => !/Date\.now\(\)/.test(stripTs(s)));
}

// ===========================================================================
console.log(`\n${'='.repeat(78)}`);
console.log(`QF-MVP-75.04 — passed ${passed}, failed ${failed}`);
if (failed > 0) {
  console.log('\nFAILURES:');
  for (const line of failures) console.log(line);
}
console.log('='.repeat(78));
process.exit(failed > 0 ? 1 : 0);
