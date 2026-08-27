// ============================================================================
// QuickFurno — scripts/mvp/matching/validate-qf-mvp-75-01.mjs
//
// QF-MVP-75.01 — DETERMINISTIC MATCHCORE CONTRACT + BINDING RANK ORDER.
//
// OFFLINE BY CONSTRUCTION. No database, no network, no provider, no secret, no
// clock-dependent assertion. It imports the REAL production modules through the
// `.ts` resolve hook and reads the REAL migration text; it never re-implements
// a rule it is checking.
//
// VERIFICATION LEVELS — never conflated:
//   [pure]   executes the real production module.
//   [model]  executes a faithful JS model of the SQL authority's fill loop, and
//            separately PROVES by static check that the SQL orders the way the
//            model does. A model alone would prove nothing about the database.
//   [static] reads migration / source text for a required contract.
//   [mutant] mutates the migration text and asserts the static checks REJECT it,
//            so a green run cannot be an artefact of a check that never bites.
//
// Run: npm run test:mvp:75-01
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  AUTOMATIC_MATCH_REJECT_REASONS,
  CANONICAL_REQUEST_FINGERPRINT_VERSION,
  classifyCapDeferred,
  compareAutomaticMatchDecisions,
  fairnessKey,
  isAutomaticMatchRejectReason,
  normalizeRankedVendorIds,
  rankAutomaticMatchDecisions,
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
import {
  evaluateVendorAutomaticLeadEligibility,
  isVendorAssignmentSuspended,
} from '../../../lib/vendors/vendorAutomaticEligibility.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NEW_MIGRATION = 'supabase/migrations/20260815000000_qf_mvp_75_01_matchcore_binding_rank_order.sql';
const OLD_MIGRATION = 'supabase/migrations/20260723000300_qf_mvp_canonical_assignment_authority.sql';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
/** Drop `--` line comments so a check can never match explanatory prose. */
const stripSql = (src) => src.replace(/--[^\n]*/g, '');
const stripTs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

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

const MIGRATION_RAW = read(NEW_MIGRATION);
const MIGRATION = stripSql(MIGRATION_RAW);
const OLD_AUTHORITY = stripSql(read(OLD_MIGRATION));

// ---------------------------------------------------------------------------
// Deterministic fixture vendor ids.
//
// Chosen so RANK ORDER and ASCENDING-UUID ORDER are maximally different: the
// best-ranked vendor carries the HIGHEST uuid and the worst-ranked carries the
// LOWEST. Under the pre-75.01 authority the three winners would have been
// v1/v2/v3 (lowest uuids). Under 75.01 they must be the first three by rank.
// ---------------------------------------------------------------------------
const V = {
  v1: '11111111-1111-4111-8111-111111111111',
  v2: '22222222-2222-4222-8222-222222222222',
  v3: '33333333-3333-4333-8333-333333333333',
  v4: '44444444-4444-4444-8444-444444444444',
  v5: '55555555-5555-4555-8555-555555555555',
  v9: '99999999-9999-4999-8999-999999999999',
};

function decision(vendorId, overrides = {}) {
  return {
    vendor_id: vendorId,
    eligible: true,
    reason_codes: [],
    match_tier: 0,
    match_type: 'exact',
    has_coordinates: true,
    coordinate_source: 'office_coordinates',
    distance_km: 10,
    area_affinity: 0,
    last_assigned_at: null,
    rating: 0,
    rank_position: null,
    ...overrides,
  };
}

/**
 * [model] Faithful JS model of the QF-MVP-75.01 SQL business pass:
 *   iterate the NORMALIZED RANKED list in rank order,
 *   skip a candidate that fails eligibility (it consumes NO slot),
 *   stop as soon as `activeCap` successful assignments exist.
 * The static section below proves the SQL actually orders this way.
 */
function simulateAuthorityFill(rankedIds, isEligible, activeCap = CANONICAL_ACTIVE_ASSIGNMENT_CAP) {
  const normalized = normalizeRankedVendorIds(rankedIds);
  const assigned = [];
  const skipped = [];
  for (const id of normalized) {
    if (assigned.length >= activeCap) break;
    if (!isEligible(id)) {
      skipped.push(id);
      continue;
    }
    assigned.push(id);
  }
  return { assigned, skipped, normalized };
}

/** [model] The PRE-75.01 behaviour, kept only to prove the fix is observable. */
function simulateLegacyUuidFill(rankedIds, isEligible, activeCap = CANONICAL_ACTIVE_ASSIGNMENT_CAP) {
  const byUuid = [...normalizeRankedVendorIds(rankedIds)].sort();
  const assigned = [];
  for (const id of byUuid) {
    if (assigned.length >= activeCap) break;
    if (!isEligible(id)) continue;
    assigned.push(id);
  }
  return { assigned };
}

console.log('QF-MVP-75.01 — deterministic MatchCore contract + binding rank order');

// ===========================================================================
section('A. RANK IS BINDING');
// ===========================================================================
{
  // Ranked best-to-worst, deliberately anti-correlated with uuid order.
  const ranked = [V.v9, V.v5, V.v4, V.v3, V.v2, V.v1];
  const all = () => true;
  const now = simulateAuthorityFill(ranked, all);
  const legacy = simulateLegacyUuidFill(ranked, all);

  check(
    'A1 [model] the winners are the first three BY RANK',
    eq(now.assigned, [V.v9, V.v5, V.v4]),
    JSON.stringify(now.assigned),
  );
  check(
    'A2 [model] the winners are NOT the three lowest uuids',
    !eq(now.assigned, legacy.assigned) && eq(legacy.assigned, [V.v1, V.v2, V.v3]),
    `legacy=${JSON.stringify(legacy.assigned)}`,
  );
  check(
    'A3 [static] the business pass iterates the ranked list, not ascending uuid',
    /for\s+v_candidate\s+in\s+select\s+u\.vid\s+from\s+unnest\(v_ranked\)\s+with\s+ordinality\s+as\s+u\(vid,\s*ord\)\s+order\s+by\s+u\.ord/.test(
      MIGRATION.replace(/\s+/g, ' '),
    ),
  );
  check(
    'A4 [static] the pre-75.01 uuid-ordered candidate loop is gone',
    !/\)\s*deduped\s+order\s+by\s+vid/.test(MIGRATION.replace(/\s+/g, ' ')),
  );
  check(
    'A5 [static] the superseded authority really did carry the defect',
    /\)\s*deduped\s+order\s+by\s+vid/.test(OLD_AUTHORITY.replace(/\s+/g, ' ')),
  );
}

// ===========================================================================
section('B. LOCK ORDER IS INDEPENDENT OF BUSINESS ORDER');
// ===========================================================================
{
  const flat = MIGRATION.replace(/\s+/g, ' ');
  const lockPass = /for\s+v_lock_id\s+in\s+select\s+u\.vid\s+from\s+unnest\(v_ranked\)\s+as\s+u\(vid\)\s+order\s+by\s+u\.vid\s+loop\s+perform\s+1\s+from\s+public\.vendors\s+where\s+id\s+=\s+v_lock_id\s+for\s+update;\s+end\s+loop;/;

  check('B1 [static] a dedicated LOCK pass exists', lockPass.test(flat));
  check(
    'B2 [static] the lock pass orders by ascending vendor uuid',
    /for\s+v_lock_id\s+in\s+select\s+u\.vid\s+from\s+unnest\(v_ranked\)\s+as\s+u\(vid\)\s+order\s+by\s+u\.vid/.test(flat),
  );
  check(
    'B3 [static] the lock pass runs BEFORE the business pass',
    flat.indexOf('for v_lock_id in') > 0 &&
      flat.indexOf('for v_lock_id in') < flat.indexOf('for v_candidate in'),
  );
  check(
    'B4 [static] the lock pass writes nothing (perform-only, no insert/update/delete)',
    (() => {
      const start = flat.indexOf('for v_lock_id in');
      const end = flat.indexOf('for v_candidate in');
      const body = flat.slice(start, end);
      return !/(insert|update|delete)\s/i.test(body) && /perform 1 from public\.vendors/.test(body);
    })(),
  );
  check(
    'B5 [static] both passes consume the SAME normalized array, so they cannot disagree',
    (flat.match(/unnest\(v_ranked\)/g) || []).length === 3,
    `unnest(v_ranked) occurrences=${(flat.match(/unnest\(v_ranked\)/g) || []).length} (fingerprint + lock + business)`,
  );
  check(
    'B6 [static] the business pass still re-reads each vendor row FOR UPDATE',
    /select \* into v_vendor from public\.vendors where id = v_candidate for update;/.test(flat),
  );
  // The business loop can never touch a vendor the lock pass did not lock,
  // because BOTH iterate the same v_ranked array and the lock pass iterates ALL
  // of it with no filter, no slice and no early exit.
  check(
    'B7 [static] the lock pass covers the WHOLE ranked array — no filter, slice or early exit',
    (() => {
      const start = flat.indexOf('for v_lock_id in');
      const body = flat.slice(start, flat.indexOf('for v_candidate in'));
      return /unnest\(v_ranked\)/.test(body) &&
        !/exit when/.test(body) &&
        !/ where /.test(body.slice(0, body.indexOf('loop'))) &&
        !/limit /.test(body);
    })(),
  );
  check(
    'B8 [static] the business loop reads no candidate source other than v_ranked',
    (() => {
      const start = flat.indexOf('for v_candidate in');
      const header = flat.slice(start, flat.indexOf('loop exit when', start));
      return /unnest\(v_ranked\)/.test(header) && !/p_candidate_vendors/.test(header);
    })(),
  );
  check(
    'B9 [model] the business set is always a subset of the pre-locked set',
    (() => {
      const raw = [V.v9, null, V.v5, V.v9, V.v4, 'nope', V.v3];
      const ranked = normalizeRankedVendorIds(raw);
      const locked = new Set([...ranked].sort());
      return simulateAuthorityFill(raw, () => true).normalized.every((id) => locked.has(id));
    })(),
  );
}

// ===========================================================================
section('C. AN INELIGIBLE RANKED CANDIDATE CONSUMES NO SLOT');
// ===========================================================================
{
  const ranked = [V.v9, V.v5, V.v4, V.v3, V.v2];
  const eligibleSet = new Set([V.v5, V.v4, V.v3, V.v2]); // rank #1 (v9) ineligible
  const out = simulateAuthorityFill(ranked, (id) => eligibleSet.has(id));

  check('C1 [model] rank #1 ineligible => ranks #2/#3/#4 fill the cap', eq(out.assigned, [V.v5, V.v4, V.v3]));
  check('C2 [model] the ineligible candidate is reported as skipped', eq(out.skipped, [V.v9]));
  check(
    'C3 [static] a skipped candidate uses `continue`, never an early exit',
    /reason_code','vendor_not_eligible'\)\);\s*continue;/.test(MIGRATION.replace(/\s+/g, ' ')),
  );
  check(
    'C4 [static] the loop exits ONLY on the active cap',
    /exit when v_active_count >= c_active_cap;/.test(MIGRATION) &&
      (MIGRATION.match(/exit when/g) || []).length === 1,
  );
}

// ===========================================================================
section('D. TIER PRIORITY SURVIVES PERSISTENCE');
// ===========================================================================
{
  // Tier-1 vendors carry the LOWEST uuids, Tier-0 the highest: pre-75.01 the
  // parent-group fallbacks would have won all three slots.
  const tier1 = [decision(V.v1, { match_tier: 1, match_type: 'parent_group_fallback' }),
                 decision(V.v2, { match_tier: 1, match_type: 'parent_group_fallback' }),
                 decision(V.v3, { match_tier: 1, match_type: 'parent_group_fallback' })];
  const tier0 = [decision(V.v4), decision(V.v5), decision(V.v9)];
  const ranked = rankAutomaticMatchDecisions([...tier1, ...tier0], true);
  const rankedIds = ranked.map((d) => d.vendor_id);

  check('D1 [pure] every Tier-0 vendor ranks ahead of every Tier-1 vendor',
    eq(rankedIds.slice(0, 3), [V.v4, V.v5, V.v9]));
  check('D2 [model] the authority therefore assigns the Tier-0 vendors',
    eq(simulateAuthorityFill(rankedIds, () => true).assigned, [V.v4, V.v5, V.v9]));
  check('D3 [model] the pre-75.01 order would have assigned the Tier-1 fallbacks',
    eq(simulateLegacyUuidFill(rankedIds, () => true).assigned, [V.v1, V.v2, V.v3]));
  check(
    'D4 [static] Tier-1 was NOT demoted to ineligible to force this',
    /qf_lead_vendor_parent_group_compatible/.test(OLD_AUTHORITY) &&
      !/qf_lead_vendor_parent_group_compatible/.test(MIGRATION),
    'the taxonomy gate is untouched by 75.01',
  );
}

// ===========================================================================
section('E/F/G. IDEMPOTENCY FOLLOWS BUSINESS ORDER');
// ===========================================================================
{
  const flat = MIGRATION.replace(/\s+/g, ' ');

  check(
    'E1 [static] the fingerprint version constant is 2',
    /c_fingerprint_version constant integer := 2;/.test(flat),
  );
  check(
    'E2 [static] the fingerprint uses that constant, not a literal 1',
    /'v', c_fingerprint_version,/.test(flat) && !/'v', 1,/.test(flat),
  );
  check(
    'E3 [pure] the TypeScript contract mirror agrees with the SQL version',
    CANONICAL_REQUEST_FINGERPRINT_VERSION === 2,
  );
  check(
    'F1 [static] the fingerprint candidate list is ORDER-PRESERVING',
    /jsonb_agg\(to_jsonb\(u\.vid::text\) order by u\.ord\) from unnest\(v_ranked\) with ordinality as u\(vid, ord\)/.test(flat),
  );
  check(
    'F2 [static] the pre-75.01 SORTED fingerprint is gone',
    !/jsonb_agg\(to_jsonb\(v\.vid::text\) order by v\.vid\)/.test(flat),
  );
  check(
    'F3 [static] the superseded authority really did sort the fingerprint',
    /jsonb_agg\(to_jsonb\(v\.vid::text\) order by v\.vid\)/.test(OLD_AUTHORITY.replace(/\s+/g, ' ')),
  );
  check(
    'F4 [static] a differing fingerprint returns idempotency_conflict and mutates nothing',
    /if v_existing_op\.request_fingerprint is distinct from v_fingerprint then return jsonb_build_object\( 'status','rejected','reason_code','idempotency_conflict', 'operation_id', v_existing_op\.id\); end if;/.test(flat),
  );
  check(
    'F5 [static] the conflict branch is decided BEFORE the lead lock',
    flat.indexOf("'idempotency_conflict'") < flat.indexOf('from public.leads where id = p_lead_id for update'),
  );

  // The operation KEY must stay SET-derived, otherwise a re-ordered submission
  // would mint a NEW key and proceed as a second independent operation instead
  // of failing closed as a conflict.
  const base = {
    leadId: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f',
    mode: 'automatic',
    actorKind: 'system',
    actorId: null,
    replacementRequestId: null,
    reasonCode: 'automatic_match',
    operationScope: 'auto_match',
  };
  const keyForward = buildAssignmentOperationKey({ ...base, candidateVendorIds: [V.v9, V.v5, V.v4] });
  const keyReversed = buildAssignmentOperationKey({ ...base, candidateVendorIds: [V.v4, V.v5, V.v9] });
  const keyOtherSet = buildAssignmentOperationKey({ ...base, candidateVendorIds: [V.v9, V.v5, V.v3] });

  check('F6 [pure] a re-ordered SAME SET keeps the SAME operation key (so it collides)', keyForward === keyReversed);
  check('F7 [pure] a genuinely different SET produces a different operation key', keyForward !== keyOtherSet);
  check(
    'E4 [pure] same order + same inputs is the same request end to end',
    buildAssignmentOperationKey({ ...base, candidateVendorIds: [V.v9, V.v5, V.v4] }) === keyForward,
  );

  // G — normalization.
  check(
    'G1 [pure] duplicates collapse to their FIRST (best-ranked) occurrence',
    eq(normalizeRankedVendorIds([V.v9, V.v5, V.v9, V.v4, V.v5]), [V.v9, V.v5, V.v4]),
  );
  check(
    'G2 [pure] null / undefined / blank / non-uuid entries are dropped',
    eq(normalizeRankedVendorIds([null, V.v9, undefined, '', 'not-a-uuid', 42, V.v5]), [V.v9, V.v5]),
  );
  check(
    'G3 [pure] case and surrounding whitespace do not create a second candidate',
    eq(normalizeRankedVendorIds([` ${V.v9.toUpperCase()} `, V.v9]), [V.v9]),
  );
  check(
    'G4 [pure] MatchCore and the transport contract normalize identically',
    [
      [V.v9, V.v5, V.v9, V.v4],
      [null, '', 'nope', V.v3],
      [` ${V.v1.toUpperCase()} `, V.v1, V.v2],
      [],
    ].every((input) => eq(normalizeRankedVendorIds(input), normalizeCandidateVendorIds(input))),
  );
  check(
    'G5 [static] the SQL normalization keeps the first occurrence and preserves order',
    /select coalesce\(array_agg\(d\.vid order by d\.first_rank\), '\{\}'::uuid\[\]\) into v_ranked/.test(flat) &&
      /min\(item\.ordinality\) as first_rank/.test(flat) &&
      /group by item\.vendor_id/.test(flat),
  );
  check(
    'G6 [model] a duplicate cannot consume two slots',
    eq(simulateAuthorityFill([V.v9, V.v9, V.v5, V.v5, V.v4], () => true).assigned, [V.v9, V.v5, V.v4]),
  );
}

// ===========================================================================
section('H. EXISTING CAPS UNCHANGED');
// ===========================================================================
{
  check('H1 [static] active cap is still 3', /c_active_cap   constant integer := 3;/.test(MIGRATION));
  check('H2 [static] lifetime cap is still 6', /c_lifetime_cap constant integer := 6;/.test(MIGRATION));
  check('H3 [static] credit cost is still 1', /c_credit_cost  constant integer := 1;/.test(MIGRATION));
  check('H4 [pure] the contract mirrors active 3 / lifetime 6 / cost 1',
    CANONICAL_ACTIVE_ASSIGNMENT_CAP === 3 &&
      CANONICAL_LIFETIME_ASSIGNMENT_CAP === 6 &&
      CANONICAL_ASSIGNMENT_CREDIT_COST === 1);
  check('H5 [pure] candidate pool cap is still 20', MAX_CANONICAL_CANDIDATE_POOL === 20);
  check(
    'H6 [static] no caller-supplied ceiling was introduced',
    !/p_max|p_limit|p_active_cap|p_slots/.test(MIGRATION),
  );
  check(
    'H7 [model] a 20-candidate pool still yields at most 3 assignments',
    simulateAuthorityFill(
      Array.from({ length: 20 }, (_, i) => `${String(i + 10).padStart(8, '0')}-0000-4000-8000-000000000000`),
      () => true,
    ).assigned.length === 3,
  );
  check(
    'H8 [pure] splitRankedPool bounds the submitted pool at 20 and keeps the tail',
    (() => {
      const ids = Array.from({ length: 26 }, (_, i) => `${String(i + 10).padStart(8, '0')}-0000-4000-8000-000000000000`);
      const out = splitRankedPool(ids, MAX_CANONICAL_CANDIDATE_POOL);
      return out.pool.length === 20 && out.beyondPool.length === 6 && eq([...out.pool, ...out.beyondPool], ids);
    })(),
  );
}

// ===========================================================================
section('I. ELIGIBILITY ALIGNMENT (canonical automatic path)');
// ===========================================================================
{
  const NOW = Date.parse('2026-08-27T12:00:00.000Z');
  const APPROVED = {
    id: V.v1,
    status: 'approved',
    is_active: true,
    accepting_leads: true,
    remaining_credits: 5,
  };

  check('I1 [pure] a clean approved vendor is still eligible with zero reasons',
    (() => {
      const r = evaluateVendorAutomaticLeadEligibility(APPROVED, { nowMs: NOW });
      return r.eligible && r.reasons.length === 0 && r.assignmentSuspended === false;
    })());
  check('I2 [pure] an OPEN-ENDED assignment suspension is rejected',
    (() => {
      const r = evaluateVendorAutomaticLeadEligibility(
        { ...APPROVED, assignment_suspended_at: '2026-08-01T00:00:00.000Z', assignment_suspended_until: null },
        { nowMs: NOW },
      );
      return !r.eligible && r.reasons.includes('vendor_assignment_suspended');
    })());
  check('I3 [pure] a suspension whose window is still open is rejected',
    (() => {
      const r = evaluateVendorAutomaticLeadEligibility(
        { ...APPROVED, assignment_suspended_at: '2026-08-01T00:00:00.000Z', assignment_suspended_until: '2026-08-28T00:00:00.000Z' },
        { nowMs: NOW },
      );
      return !r.eligible && r.reasons.includes('vendor_assignment_suspended');
    })());
  check('I4 [pure] a LAPSED suspension is not a rejection',
    (() => {
      const r = evaluateVendorAutomaticLeadEligibility(
        { ...APPROVED, assignment_suspended_at: '2026-07-01T00:00:00.000Z', assignment_suspended_until: '2026-08-01T00:00:00.000Z' },
        { nowMs: NOW },
      );
      return r.eligible && r.assignmentSuspended === false;
    })());
  check('I5 [pure] the boundary is strictly greater-than, exactly as the SQL compares',
    isVendorAssignmentSuspended(
      { assignment_suspended_at: '2026-08-01T00:00:00.000Z', assignment_suspended_until: new Date(NOW).toISOString() },
      NOW,
    ) === false &&
      isVendorAssignmentSuspended(
        { assignment_suspended_at: '2026-08-01T00:00:00.000Z', assignment_suspended_until: new Date(NOW + 1).toISOString() },
        NOW,
      ) === true);
  check('I6 [pure] absent suspension columns never suspend (un-migrated rows behave as before)',
    isVendorAssignmentSuspended({}, NOW) === false && isVendorAssignmentSuspended(null, NOW) === false);
  check('I7 [pure] a present-but-unreadable `until` fails CLOSED',
    isVendorAssignmentSuspended(
      { assignment_suspended_at: '2026-08-01T00:00:00.000Z', assignment_suspended_until: 'not-a-timestamp' },
      NOW,
    ) === true);
  check(
    'I8 [static] the SQL hard gate this mirrors still exists, unchanged by 75.01',
    /v_vendor\.assignment_suspended_at is not null/.test(OLD_AUTHORITY) &&
      /v_vendor\.assignment_suspended_until is null or v_vendor\.assignment_suspended_until > now\(\)/
        .test(OLD_AUTHORITY.replace(/\s+/g, ' ')) &&
      !/assignment_suspended_at/.test(MIGRATION),
  );
  check(
    'I9 [pure] every automatic reject reason is an explicit contract code',
    (() => {
      const produced = new Set();
      const rows = [
        { ...APPROVED, status: 'pending' },
        { ...APPROVED, status: 'suspended' },
        { ...APPROVED, is_active: false },
        { ...APPROVED, accepting_leads: false },
        { ...APPROVED, remaining_credits: 0 },
        { ...APPROVED, assignment_suspended_at: '2026-08-01T00:00:00.000Z' },
      ];
      for (const row of rows) {
        for (const r of evaluateVendorAutomaticLeadEligibility(row, { nowMs: NOW }).reasons) produced.add(r);
      }
      return [...produced].every((r) => isAutomaticMatchRejectReason(r)) && produced.size === 6;
    })(),
  );
  check(
    'I10 [pure] the reason vocabulary covers city and category too, so nothing collapses',
    AUTOMATIC_MATCH_REJECT_REASONS.includes('city_mismatch') &&
      AUTOMATIC_MATCH_REJECT_REASONS.includes('category_mismatch') &&
      !AUTOMATIC_MATCH_REJECT_REASONS.includes('vendor_not_eligible'),
  );
  check(
    'I11 [static] the matcher records those explicit reasons, not a collapsed code',
    (() => {
      const src = stripTs(read('services/leadMatchingEngine.ts'));
      return /reasons: AutomaticMatchRejectReason\[\]/.test(src) &&
        /reasons\.push\("city_mismatch"\)/.test(src) &&
        /reasons\.push\("category_mismatch"\)/.test(src);
    })(),
  );
}

// ===========================================================================
section('J. NO COMMERCIAL REGRESSION');
// ===========================================================================
{
  const matcher = stripTs(read('services/leadMatchingEngine.ts'));
  const elig = stripTs(read('lib/vendors/vendorAutomaticEligibility.ts'));
  const matchcore = stripTs(read('lib/matchcore/automaticMatchDecision.ts'));

  check(
    'J1 [pure] package/paid status is not an automatic eligibility input',
    (() => {
      const withPackage = evaluateVendorAutomaticLeadEligibility(
        { status: 'approved', is_active: true, accepting_leads: true, remaining_credits: 1, package_status: 'expired', paid_status: 'Unpaid' },
        { nowMs: Date.parse('2026-08-27T12:00:00.000Z') },
      );
      return withPackage.eligible && withPackage.reasons.length === 0;
    })(),
  );
  check('J2 [static] the automatic eligibility helper reads no package/paid field',
    !/package_status|paid_status|package_expires_at|vendor_packages/.test(elig));
  check('J3 [static] the MatchCore comparator has no package/paid/commercial key',
    !/package|paid_status|credits/i.test(matchcore.split('export function compareAutomaticMatchDecisions')[1] ?? ''));
  check('J4 [static] the authority gained no package/paid/priority input',
    !/package|paid_status|priority/i.test(MIGRATION));
  check('J5 [static] the matcher still uses the canonical automatic helper',
    /evaluateVendorAutomaticLeadEligibility/.test(matcher) && !/evaluateVendorContactAccessEligibility/.test(matcher));
}

// ===========================================================================
section('K. DETERMINISTIC TOTAL ORDER');
// ===========================================================================
{
  const mk = () => [
    decision(V.v1, { distance_km: 5 }),
    decision(V.v9, { distance_km: 5 }),
    decision(V.v4, { distance_km: 2 }),
    decision(V.v5, { distance_km: 2, area_affinity: 1 }),
    decision(V.v2, { match_tier: 1 }),
    decision(V.v3, { has_coordinates: false, distance_km: null }),
  ];
  const first = rankAutomaticMatchDecisions(mk(), true).map((d) => d.vendor_id);

  check('K1 [pure] the same inputs always produce the same exact ranked ids',
    Array.from({ length: 25 }, () => rankAutomaticMatchDecisions(mk(), true).map((d) => d.vendor_id))
      .every((run) => eq(run, first)),
    JSON.stringify(first));
  check('K2 [pure] input permutation does not change the result',
    (() => {
      const shuffles = [[5, 4, 3, 2, 1, 0], [2, 0, 4, 1, 5, 3], [1, 3, 5, 0, 2, 4]];
      return shuffles.every((order) => {
        const rows = mk();
        return eq(rankAutomaticMatchDecisions(order.map((i) => rows[i]), true).map((d) => d.vendor_id), first);
      });
    })());
  check('K3 [pure] uuid is the stable final tiebreak when every other key ties',
    eq(rankAutomaticMatchDecisions([decision(V.v9), decision(V.v1), decision(V.v5)], true).map((d) => d.vendor_id),
      [V.v1, V.v5, V.v9]));
  check('K4 [pure] the comparator returns 0 only for the same vendor',
    (() => {
      const rows = mk();
      return rows.every((a, i) => rows.every((b, j) =>
        (compareAutomaticMatchDecisions(a, b, true) === 0) === (i === j)));
    })());
  check('K5 [pure] an unparseable last_assigned_at cannot produce a NaN sort key',
    Number.isFinite(fairnessKey('2026-01-01T00:00:00.000Z')) &&
      fairnessKey('garbage') === Number.NEGATIVE_INFINITY &&
      fairnessKey(null) === Number.NEGATIVE_INFINITY &&
      fairnessKey('') === Number.NEGATIVE_INFINITY);
  check('K6 [pure] a never-assigned vendor still sorts ahead of an assigned one',
    eq(rankAutomaticMatchDecisions([
      decision(V.v1, { last_assigned_at: '2026-01-01T00:00:00.000Z' }),
      decision(V.v9, { last_assigned_at: null }),
    ], true).map((d) => d.vendor_id), [V.v9, V.v1]));
  check('K7 [static] no randomness anywhere in the decision path',
    !/Math\.random|random\(\)/.test(stripTs(read('lib/matchcore/automaticMatchDecision.ts'))) &&
      !/random\(\)/.test(MIGRATION));
  check('K8 [static] no clock in the pure MatchCore module',
    !/Date\.now|new Date\(/.test(stripTs(read('lib/matchcore/automaticMatchDecision.ts'))));
}

// ===========================================================================
section('L. SECURITY / ACL / SCOPE');
// ===========================================================================
{
  // Statement-level only: the self-verification block legitimately contains the
  // word "grant" inside its diagnostic message, and `acldefault` reads the ACL.
  // What must not exist is an executable GRANT/REVOKE statement.
  check('L1 [static] the migration issues no GRANT and no REVOKE statement',
    !/^\s*(grant|revoke)\s/im.test(MIGRATION));
  check('L2 [static] the migration creates/alters/drops no table, index, trigger or policy',
    !/\b(create|alter|drop)\s+(table|index|trigger|policy|type|schema|role)\b/i.test(MIGRATION));
  check('L3 [static] exactly one function object is replaced',
    (MIGRATION.match(/create or replace function/gi) || []).length === 1 &&
      /create or replace function public\.qf_assign_lead_vendors_v2\(/.test(MIGRATION));
  check('L4 [static] the signature is reproduced exactly',
    /public\.qf_assign_lead_vendors_v2\( p_lead_id uuid, p_mode text, p_candidate_vendors uuid\[\], p_operation_key text, p_actor_kind text, p_actor_id uuid, p_replacement_ref uuid, p_reason_code text \) returns jsonb/
      .test(MIGRATION.replace(/\s+/g, ' ')));
  check('L5 [static] SECURITY DEFINER and the pinned search_path are preserved',
    /security definer/.test(MIGRATION) && /set search_path = pg_catalog, public, pg_temp/.test(MIGRATION));
  check('L6 [static] the self-verification proves the NEGATIVE ACL half (no PUBLIC/anon/authenticated EXECUTE)',
    /aclexplode/.test(MIGRATION) && /'anon', 'authenticated'/.test(MIGRATION) && /a\.grantee = 0/.test(MIGRATION));
  // A forbidden-grants-only proof would also pass on an ACL that had lost
  // service_role entirely, leaving the sole assignment authority unreachable.
  check('L6a [static] the self-verification proves the POSITIVE ACL half (service_role retains EXECUTE)',
    /=\s*'service_role'/.test(MIGRATION) &&
      /v_svc_acl/.test(MIGRATION) &&
      /does not grant EXECUTE to service_role/.test(MIGRATION));
  check('L6b [static] the positive proof excludes the PUBLIC pseudo-grantee',
    /a\.grantee <> 0\s*and pg_catalog\.pg_get_userbyid\(a\.grantee\) = 'service_role'/.test(MIGRATION.replace(/\s+/g, ' ')));
  check('L6c [static] the pinned search_path is proven at apply time, not assumed',
    /proconfig/.test(MIGRATION) &&
      /cfg\.entry like 'search_path=%'/.test(MIGRATION) &&
      /lost its pinned search_path/.test(MIGRATION));
  check('L6d [static] the search_path proof requires all three pinned entries',
    (() => {
      const flat = MIGRATION.replace(/\s+/g, ' ');
      return /like '%pg_catalog%' and cfg\.entry like '%public%' and cfg\.entry like '%pg_temp%'/.test(flat);
    })());
  check('L7 [static] the self-verification does NOT pattern-match the function body',
    !/pg_get_functiondef/.test(MIGRATION));
  check('L8 [static] client_selected stays fail-closed before any write',
    /if p_mode = 'client_selected' then\s*return jsonb_build_object\('status','unauthorized','reason_code','unauthorized'\);/
      .test(MIGRATION.replace(/\s+/g, ' ').replace(/ then /g, ' then ')) ||
      /p_mode = 'client_selected' then return jsonb_build_object\('status','unauthorized','reason_code','unauthorized'\);/
        .test(MIGRATION.replace(/\s+/g, ' ')));
  check('L9 [static] no PostGIS / H3 / routing / lifecycle / reserve scope crept in',
    !/postgis|geography\(|geometry\(|\bh3_|route_matrix|distancematrix|primary_vendor|reserve_pool|lifecycle_transition/i.test(MIGRATION));
  check('L10 [static] credit debit timing and the ledger contract are untouched',
    /qf_apply_credit_mutation_v2\(\s*v_candidate, -c_credit_cost, 'lead_assignment_debit'/.test(MIGRATION.replace(/\s+/g, ' ')) &&
      /QF_ASSIGN_CREDIT_FAILED:/.test(MIGRATION));
}

// ===========================================================================
section('M. EVIDENCE (matching run can prove what decided the outcome)');
// ===========================================================================
{
  const matcher = stripTs(read('services/leadMatchingEngine.ts'));

  check('M1 [static] the submitted ranked order is persisted', /ranked_candidate_order: selectedVendorIds/.test(matcher));
  check('M2 [static] the snapshot states that the order is binding', /candidate_order_is_binding: true/.test(matcher));
  check('M3 [static] the snapshot records the fingerprint version it was built for',
    /request_fingerprint_version: CANONICAL_REQUEST_FINGERPRINT_VERSION/.test(matcher));
  check('M4 [static] cap-deferred candidates are recorded on every terminal outcome',
    /cap_deferred_vendor_ids: classifyCapDeferred\(/.test(matcher) &&
      (matcher.match(/\.\.\.outcomeAudit/g) || []).length === 3);
  check('M5 [pure] cap-deferred = submitted, not assigned, and never evaluated',
    eq(classifyCapDeferred([V.v9, V.v5, V.v4, V.v3, V.v2], [V.v9, V.v5, V.v4], []), [V.v3, V.v2]));
  check('M6 [pure] a candidate the authority SKIPPED is not reported as cap-deferred',
    eq(classifyCapDeferred([V.v9, V.v5, V.v4, V.v3], [V.v5, V.v4, V.v3], [V.v9]), []));
  check('M7 [pure] cap-deferred order follows rank, best first',
    eq(classifyCapDeferred([V.v9, V.v5, V.v4, V.v3, V.v2, V.v1], [V.v9, V.v5, V.v4], [])[0], V.v3));
  check('M8 [static] selected_vendor_ids is still the submitted ranked pool',
    /const selectedVendorIds = rankedPool\.pool;/.test(matcher));
}

// ===========================================================================
section('N. LIVE CALLER ORDER CONTRACT');
// ===========================================================================
{
  // QF-MVP-75.01 makes candidate order binding for EVERY caller of the single
  // authority, so each live caller's submitted order must be a defensible
  // business order. These assertions pin what the pre-commit review proved, so a
  // later edit cannot silently turn a ranked list into an arbitrary one.
  const delivery = stripTs(read('services/leadDeliveryService.ts'));
  const matcher = stripTs(read('services/leadMatchingEngine.ts'));
  const delayed = stripTs(read('services/delayedLeadFillService.ts'));
  const manual = stripTs(read('services/manualLeadAssignmentService.ts'));
  const group = stripTs(read('services/clientRequirementGroupService.ts'));
  const leadSvc = stripTs(read('services/leadService.ts'));

  const seamCallers = [
    'services/leadDeliveryService.ts',
    'services/leadService.ts',
    'services/manualLeadAssignmentService.ts',
    'services/delayedLeadFillService.ts',
    'services/clientRequirementGroupService.ts',
  ];
  check(
    'N1 [static] each of the five known live callers reaches the authority exactly once, through the seam',
    seamCallers.every((rel) => (stripTs(read(rel)).match(/await executeCanonicalAssignment\(\{/g) || []).length === 1),
  );

  // 1. CANONICAL AUTOMATIC — ranked, order intentionally meaningful.
  check('N2 [static] the automatic path submits the MatchCore ranked pool verbatim',
    /const selectedVendorIds = rankedPool\.pool;/.test(matcher) &&
      /assignLeadToMatchedVendors\(leadId, selectedVendorIds\)/.test(matcher) &&
      /candidateVendorIds: vendorIds,/.test(delivery));

  // 2. DELAYED FILL — ranked by descending score, then sliced to the free slots.
  check('N3 [static] the delayed-fill path submits a descending-score ranked slice',
    /scored\.sort\(\(a, b\) => b\.score - a\.score\);/.test(delayed) &&
      /return scored\.slice\(0, slots\)\.map\(\(candidate\) => candidate\.id\);/.test(delayed));

  // 3. CLIENT REQUIREMENT GROUP — a single vendor; order is vacuous.
  check('N4 [static] the requirement-group path submits exactly one vendor id',
    /candidateVendorIds: \[vendorId\],/.test(group));

  // 4. ADMIN MANUAL — bounded by the REMAINING headroom, so every submitted
  //    candidate is attempted and order cannot change the assigned set.
  check('N5 [static] the manual path bounds the submission by remaining slots',
    /const slots = maxSelectableFor\(mode, counts\);/.test(manual) &&
      /if \(selected\.length > slots\) \{/.test(manual));
  check('N6 [static] primary-mode slots are the authority headroom (3 - already assigned)',
    /const pendingPrimary = NORMAL_PRIMARY_VENDOR_LIMIT - primary;/.test(manual) &&
      /if \(mode === "recovery"\) return counts\.recovery_slots_remaining;/.test(manual) &&
      /return counts\.pending_primary_slots;/.test(manual));
  check('N7 [static] the manual path pre-validates every submitted vendor server-side',
    /Re-validate every selected vendor server-side/.test(read('services/manualLeadAssignmentService.ts')) ||
      /if \(!candidate\.assignable\)/.test(manual));

  // 5. leadService admin path — bounded by an ABSOLUTE cap, not by the lead's
  //    remaining headroom. Against an empty lead every submitted candidate is
  //    attempted and order cannot change the outcome. Against a PARTIALLY FILLED
  //    lead the submission can exceed the free slots, and the order that then
  //    decides is the admin's own submitted order over vendors the admin
  //    explicitly chose — never an arbitrary machine order. That is defensible,
  //    but only while the bound stays at the authority's active cap: raising it
  //    would let an admin submit more vendors than can ever be assigned and make
  //    an unranked list decide which of them win.
  check('N8 [static] the leadService admin path is bounded by an absolute submission cap',
    /if \(selectedVendorIds\.length > MAX_VENDORS_PER_LEAD\) throw appError\("MAX_VENDORS_EXCEEDED"\);/.test(leadSvc));
  check('N9 [static] that absolute bound is never larger than the authority active cap',
    (() => {
      const declared = /export const MAX_VENDORS_PER_LEAD = (\d+);/.exec(stripTs(read('lib/config.ts')));
      return declared !== null && Number(declared[1]) <= CANONICAL_ACTIVE_ASSIGNMENT_CAP;
    })());

  // No live caller may reach a legacy assignment RPC.
  check('N10 [static] no live caller reaches a legacy assignment RPC',
    [delivery, matcher, delayed, manual, group, leadSvc].every((src) =>
      !/assign_lead_to_paid_vendors_phase26a|admin_smart_assign_lead_to_vendors|assign_lead_to_preferred_vendor|assign_vendor_to_requirement_group|assign_client_selected_vendor_to_group|\.rpc\("assign_lead_to_vendors"/.test(src)));
}

// ===========================================================================
section('MUTATION REJECTION — the checks above must actually bite');
// ===========================================================================
{
  const flatten = (s) => s.replace(/\s+/g, ' ');
  const mutants = [
    ['business pass reverted to ascending uuid', (s) =>
      s.replace('select u.vid from unnest(v_ranked) with ordinality as u(vid, ord) order by u.ord',
        'select u.vid from unnest(v_ranked) as u(vid) order by u.vid'),
      (s) => /for v_candidate in select u\.vid from unnest\(v_ranked\) with ordinality as u\(vid, ord\) order by u\.ord/.test(flatten(s))],
    ['lock pass deleted', (s) => s.replace(/for v_lock_id in[\s\S]*?end loop;\n/, ''),
      (s) => /for v_lock_id in/.test(s)],
    ['lock pass reordered to rank order', (s) =>
      s.replace('select u.vid from unnest(v_ranked) as u(vid) order by u.vid',
        'select u.vid from unnest(v_ranked) with ordinality as u(vid, o2) order by u.o2'),
      (s) => /for v_lock_id in select u\.vid from unnest\(v_ranked\) as u\(vid\) order by u\.vid/.test(flatten(s))],
    ['fingerprint version left at 1', (s) => s.replace('c_fingerprint_version constant integer := 2;', 'c_fingerprint_version constant integer := 1;'),
      (s) => /c_fingerprint_version constant integer := 2;/.test(s)],
    ['fingerprint re-sorted (order dropped)', (s) =>
      s.replace('jsonb_agg(to_jsonb(u.vid::text) order by u.ord)', 'jsonb_agg(to_jsonb(u.vid::text) order by u.vid)'),
      (s) => /jsonb_agg\(to_jsonb\(u\.vid::text\) order by u\.ord\)/.test(flatten(s))],
    ['active cap raised to 4', (s) => s.replace('c_active_cap   constant integer := 3;', 'c_active_cap   constant integer := 4;'),
      (s) => /c_active_cap   constant integer := 3;/.test(s)],
    ['lifetime cap raised to 9', (s) => s.replace('c_lifetime_cap constant integer := 6;', 'c_lifetime_cap constant integer := 9;'),
      (s) => /c_lifetime_cap constant integer := 6;/.test(s)],
    ['credit cost changed to 2', (s) => s.replace('c_credit_cost  constant integer := 1;', 'c_credit_cost  constant integer := 2;'),
      (s) => /c_credit_cost  constant integer := 1;/.test(s)],
    ['ineligible candidate exits instead of continuing', (s) =>
      s.replace(/reason_code', coalesce\(v_eligible->>'reason_code','vendor_not_eligible'\)\)\);\n      continue;/,
        "reason_code', coalesce(v_eligible->>'reason_code','vendor_not_eligible')));\n      exit;"),
      (s) => (flatten(s).match(/exit when/g) || []).length === 1 && !/\)\)\);\s*exit;/.test(flatten(s))],
    ['public execute granted', (s) => `${s}\ngrant execute on function public.qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text) to public;\n`,
      (s) => !/^\s*(grant|revoke)\s/im.test(stripSql(s))],
    ['security invoker substituted', (s) => s.replace('security definer', 'security invoker'),
      (s) => /security definer/.test(s)],
    ['caller-supplied ceiling added', (s) => s.replace('p_reason_code       text\n)', 'p_reason_code       text,\n  p_max_vendors       integer\n)'),
      (s) => !/p_max|p_limit|p_active_cap|p_slots/.test(s)],
    ['a second function slipped in', (s) => `${s}\ncreate or replace function public.qf_side_effect_v1() returns void language sql as $x$ select 1 $x$;\n`,
      (s) => (s.match(/create or replace function/gi) || []).length === 1],
    ['self-verification ACL proof removed', (s) => s.replace(/aclexplode/g, 'no_acl_check'),
      (s) => /aclexplode/.test(s)],
    ['positive service_role EXECUTE proof removed', (s) => s.replace(/= 'service_role'/g, "= 'no_such_role'"),
      (s) => /=\s*'service_role'/.test(s)],
    ['service_role proof relaxed to accept the PUBLIC pseudo-grantee', (s) => s.replace('a.grantee <> 0\n     and pg_catalog.pg_get_userbyid(a.grantee) = \'service_role\'', "pg_catalog.pg_get_userbyid(a.grantee) = 'service_role'"),
      (s) => /a\.grantee <> 0\s*and pg_catalog\.pg_get_userbyid\(a\.grantee\) = 'service_role'/.test(s.replace(/\s+/g, ' '))],
    ['search_path proof removed', (s) => s.replace(/cfg\.entry like 'search_path=%'/g, "cfg.entry like '%'"),
      (s) => /cfg\.entry like 'search_path=%'/.test(s)],
    ['search_path proof no longer requires pg_temp', (s) => s.replace(/\s*and cfg\.entry like '%pg_temp%'/, ''),
      (s) => /like '%pg_catalog%' and cfg\.entry like '%public%' and cfg\.entry like '%pg_temp%'/.test(s.replace(/\s+/g, ' '))],
    ['body-text self-verification reintroduced', (s) => `${s}\n-- pg_get_functiondef\nselect pg_get_functiondef('public.qf_assign_lead_vendors_v2'::regproc);\n`,
      (s) => !/pg_get_functiondef/.test(stripSql(s))],
  ];

  let rejected = 0;
  for (const [name, mutate, stillHolds] of mutants) {
    const mutated = mutate(MIGRATION_RAW);
    const changed = mutated !== MIGRATION_RAW;
    // The check must PASS on the real file and FAIL on the mutant.
    const holdsOnReal = stillHolds(MIGRATION_RAW);
    const holdsOnMutant = stillHolds(mutated);
    const ok = changed && holdsOnReal && !holdsOnMutant;
    if (ok) rejected += 1;
    check(`MUT reject: ${name}`, ok,
      ok ? '' : `changed=${changed} real=${holdsOnReal} mutant=${holdsOnMutant}`);
  }
  console.log(`   ..    ${rejected}/${mutants.length} mutants rejected`);
}

// ===========================================================================
console.log('');
if (failures.length > 0) {
  console.log('Failures:');
  for (const line of failures) console.log(line);
}
console.log(`\nQF-MVP-75.01 matchcore binding rank order: ${passed} passed, ${failed} failed`);
console.log('offline: no database, no network, no provider, no secret, no clock-dependent assertion');
if (failed > 0) process.exitCode = 1;
else console.log('QF_MVP_75_01_MATCHCORE_BINDING_RANK_ORDER_SOURCE_READY');
