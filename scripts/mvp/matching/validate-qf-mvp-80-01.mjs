// ============================================================================
// QuickFurno — scripts/mvp/matching/validate-qf-mvp-80-01.mjs
//
// QF-MVP-80.01 — THE AUTOMATIC ASSIGNMENT KILL SWITCH (GATE-10).
//
// The QF-MVP-80.00 launch audit found that
// `marketplace_runtime_settings.auto_assignment_mode` was read by the PREVIEW
// engine alone. The canonical live matcher —
// services/leadMatchingEngine.runAutoLeadMatchingForLead, the one
// services/leadService calls for every new lead — never read it, so the Launch
// Control console claimed a rollback control that stopped nothing. This harness
// locks the fix and locks what the fix must NOT do.
//
// OFFLINE BY CONSTRUCTION. No database, no network, no provider, no secret, no
// clock-dependent assertion.
//
// VERIFICATION LEVELS — never conflated:
//   [pure]   executes a real production module.
//   [static] reads production source text for a required contract.
//   [mutant] mutates that text and asserts the static checks REJECT it, so a
//            green run cannot be an artefact of a check that never bites.
//
// WHY THE KILL SWITCH IS PROVED [static] + [mutant] AND NOT BY EXECUTION —
// AND WHY THAT IS THE CORRECT ANSWER HERE, NOT A SHORTCUT.
//   scripts/mvp/loader/tsResolveHooks.mjs REFUSES, on purpose, to resolve the
//   "@/..." alias and refuses to `.ts`-resolve any `supabase/` or `services/`
//   specifier (its safety properties 2 and 3). That guard is the reason this
//   whole suite is provably DB-free and network-free, so importing the matcher
//   here would mean weakening the one mechanism that keeps every other harness
//   honest. QF-MVP-75.02, 75.03 and 75.04 prove their matcher-integration
//   claims about this exact file the same way, for the same reason.
//
//   What that costs, stated plainly: these checks prove the ORDER and the
//   CONTENT of the code paths, not a executed run. What makes that sufficient
//   is that the claim is itself structural — "the halt happens before anything
//   that could evaluate, route, assign, debit or deliver" is a statement about
//   ordering, and every ordering assertion below is paired with a mutant that
//   proves the assertion bites.
//
// Run: npm run test:mvp:80-01
// ============================================================================
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  CANONICAL_ACTIVE_ASSIGNMENT_CAP,
  CANONICAL_ASSIGNMENT_CREDIT_COST,
  CANONICAL_LIFETIME_ASSIGNMENT_CAP,
  MAX_CANONICAL_CANDIDATE_POOL,
} from '../../../lib/marketplace/canonicalAssignmentContract.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const stripTs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const flat = (src) => src.replace(/\s+/g, ' ');

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

const MATCHER_RAW = read('services/leadMatchingEngine.ts');
const MATCHER = stripTs(MATCHER_RAW);
const SETTINGS_RAW = read('lib/lead-assignment/runtimeSettings.ts');
const SETTINGS = stripTs(SETTINGS_RAW);
const PREVIEW_RAW = read('lib/lead-assignment/autoAssignmentEngine.ts');
const PREVIEW = stripTs(PREVIEW_RAW);
const LAUNCH_RAW = read('services/adminLaunchControlService.ts');
const LAUNCH = stripTs(LAUNCH_RAW);
const RECOVERY = stripTs(read('services/leadQualityRecoveryCore.ts'));
const PKG = JSON.parse(read('package.json'));

/** The stable reason code this phase makes canonical. */
const REASON = 'auto_assignment_off';

/**
 * The kill-switch gate and the first step that can lead anywhere. Every ordering
 * assertion in this file is expressed against these two anchors, so a moved gate
 * fails loudly rather than silently.
 */
const GATE = 'const runtimeSettings = await loadMarketplaceRuntimeSettings();';
const FIRST_ACTING_STEP = 'const evaluation = await evaluateVendorsForLead(leadRow);';

const iGate = MATCHER.indexOf(GATE);
const iEval = MATCHER.indexOf(FIRST_ACTING_STEP);

/**
 * The off branch, as source text: from the gate up to the first step that could
 * act. Anything dangerous inside this slice is a defect, and the slice is used
 * rather than the whole function so a legitimate downstream call is never
 * mistaken for one made while the switch is off.
 */
const OFF_BRANCH = iGate >= 0 && iEval > iGate ? MATCHER.slice(iGate, iEval) : '';

/**
 * The evidence block names its own STANDING NEGATIVES — `credits_debited: false`
 * and `assignment_authority_called: false` are assertions that a credit debit and
 * an authority call are ABSENT. A "does this branch touch credits?" scan must not
 * read its own denial as the thing it denies, so those keys are removed first.
 * Mirrors the same guard in the QF-MVP-75.04 harness.
 */
const withoutStandingNegatives = (src) =>
  src
    .replace(/credits_debited: false,/g, '')
    .replace(/assignment_authority_called: false,/g, '')
    .replace(/deliveries_created: false,/g, '')
    .replace(/route_provider_called: false,/g, '')
    .replace(/vendors_evaluated: false,/g, '');

console.log('\nQF-MVP-80.01 — automatic assignment kill switch (GATE-10)');

// ===========================================================================
section('A. THE STABLE REASON CODE + THE MODE VOCABULARY [static]');
// ===========================================================================
{
  check('A01 the reason code is exported ONCE from the canonical settings module',
    /export const AUTO_ASSIGNMENT_OFF_REASON = "auto_assignment_off";/.test(SETTINGS)
    && (SETTINGS.match(/export const AUTO_ASSIGNMENT_OFF_REASON/g) || []).length === 1);

  check('A02 the mode vocabulary is exactly off | preview | auto_suggest',
    /export type AutoAssignmentMode = "off" \| "preview" \| "auto_suggest";/.test(SETTINGS));

  check('A03 ONLY the exact literal "off" normalizes to off — an unknown value falls back',
    /mode === "off" \|\| mode === "preview" \|\| mode === "auto_suggest" \? mode : fallback/.test(flat(SETTINGS)));

  // QF-MVP-80.04 RE-PIN. QF-MVP-80.01 deliberately pinned a fail-OPEN default,
  // reasoning that the switch should be set rather than assumed. The QF-MVP-80.03
  // staging canary then proved the cost of that choice: with the settings table
  // empty, staging resolved to `preview`, and `preview` created real assignments
  // and debited real credits. Silence is not consent to spend, so the default is
  // now "off". The rule is INVERTED, not deleted.
  check('A04 the built-in default is "off", never "preview" — silence must not select a mutating mode',
    /auto_assignment_mode: "off",/.test(SETTINGS)
    && !/auto_assignment_mode: "preview",/.test(SETTINGS));

  check('A05 both engines record the SAME code: neither carries its own literal any more',
    /failure_reason: AUTO_ASSIGNMENT_OFF_REASON,/.test(MATCHER)
    && /failureReason: AUTO_ASSIGNMENT_OFF_REASON,/.test(MATCHER)
    && /const queueReason = AUTO_ASSIGNMENT_OFF_REASON;/.test(PREVIEW)
    && !new RegExp(`"${REASON}"`).test(MATCHER)
    && !new RegExp(`"${REASON}"`).test(PREVIEW));

  check('A06 the matcher imports the code and the reader from the canonical module',
    /AUTO_ASSIGNMENT_OFF_REASON,\s*loadMarketplaceRuntimeSettings,\s*\} from "\.\.\/lib\/lead-assignment\/runtimeSettings";/
      .test(flat(MATCHER)));

  check('A07 the matcher never re-parses the stored row itself',
    !/normalizeMarketplaceSettings|marketplace_runtime_settings/.test(MATCHER));
}

// ===========================================================================
section('B. THE GATE EXISTS, IS READ ONCE, AND BRANCHES ON off ALONE [static]');
// ===========================================================================
{
  check('B01 the canonical runtime settings are read inside the matcher',
    iGate >= 0);

  check('B02 they are read EXACTLY ONCE per run',
    (MATCHER.match(/await loadMarketplaceRuntimeSettings\(\)/g) || []).length === 1);

  check('B03 the branch is an exact equality on "off"',
    /if \(runtimeSettings\.auto_assignment_mode === "off"\) \{/.test(MATCHER));

  check('B04 there is exactly ONE mode comparison — no second, contradicting branch',
    (MATCHER.match(/runtimeSettings\.auto_assignment_mode/g) || []).length === 1);

  check('B05 the matcher branches on NO other mode value',
    !/auto_assignment_mode === "preview"/.test(MATCHER)
    && !/auto_assignment_mode === "auto_suggest"/.test(MATCHER)
    && !/auto_assignment_mode !== /.test(MATCHER));

  check('B06 nothing else in the matcher reads the settings object',
    (MATCHER.match(/runtimeSettings\./g) || []).length === 1);
}

// ===========================================================================
section('C. PLACEMENT — the halt precedes EVERYTHING that could act [static]');
// ===========================================================================
{
  // Each anchor is a real call in the matcher. `-1` would make a comparison
  // vacuously true, so every anchor is asserted present first.
  const anchors = {
    consent: 'if (!leadRow.share_consent) {',
    duplicate: 'if (leadRow.is_duplicate) {',
    evaluate: FIRST_ACTING_STEP,
    geo: 'await fetchGeoVendorShortlist(leadRow)',
    route: 'const routeOutcome = await measureLeadRouteTimes(',
    pool: 'const rankedPool = splitRankedPool(',
    authority: 'const assignment = await assignLeadToMatchedVendors(leadId, selectedVendorIds);',
    dashboard: 'await deliverLeadToVendorDashboard(leadId, vendor.vendor_id, vendor.assignment_id);',
    whatsapp: 'await createVendorLeadWhatsappPreview(leadId, vendor.vendor_id, vendor.assignment_id);',
  };
  const idx = Object.fromEntries(Object.entries(anchors).map(([k, v]) => [k, MATCHER.indexOf(v)]));

  check('C01 every ordering anchor is present in the matcher',
    Object.values(idx).every((i) => i >= 0),
    JSON.stringify(idx));

  check('C02 the gate runs AFTER the consent refusal — "off" never overwrites "no share consent"',
    iGate > idx.consent && idx.consent >= 0);

  check('C03 the gate runs AFTER the duplicate refusal — "off" never overwrites "duplicate lead"',
    iGate > idx.duplicate && idx.duplicate >= 0);

  check('C04 the gate runs BEFORE any vendor is evaluated',
    iGate >= 0 && idx.evaluate > iGate);

  check('C05 the gate runs BEFORE the 75.02 geo shortlist read',
    iGate >= 0 && idx.geo > iGate);

  check('C06 the gate runs BEFORE the 75.03 route provider seam',
    iGate >= 0 && idx.route > iGate);

  check('C07 the gate runs BEFORE the ranked candidate pool is built',
    iGate >= 0 && idx.pool > iGate);

  check('C08 the gate runs BEFORE the canonical assignment authority',
    iGate >= 0 && idx.authority > iGate);

  check('C09 the gate runs BEFORE any vendor dashboard delivery or WhatsApp preview',
    iGate >= 0 && idx.dashboard > iGate && idx.whatsapp > iGate);

  check('C10 the gate runs BEFORE every client-facing preview write',
    iGate >= 0
    && (MATCHER.match(/createClientAssignedVendorsPreview\(/g) || []).length === 3
    && MATCHER.indexOf('createClientAssignedVendorsPreview(') > iGate);
}

// ===========================================================================
section('D. THE OFF BRANCH DOES NOTHING BUT RECORD [static]');
// ===========================================================================
{
  check('D01 the off branch was located as a bounded slice of real source',
    OFF_BRANCH.length > 0 && OFF_BRANCH.includes('=== "off"'));

  check('D02 no vendor evaluation happens inside it',
    !/evaluateVendorsForLead|rankVendorsForLead|getEligibleVendorsForLead/.test(OFF_BRANCH));

  check('D03 no Google route provider call happens inside it',
    !/measureLeadRouteTimes|reorderByGeoFrontier|routeOutcome/.test(OFF_BRANCH));

  check('D04 no geo shortlist read happens inside it',
    !/fetchGeoVendorShortlist|buildGeoMatchEvidence/.test(OFF_BRANCH));

  check('D05 no assignment authority call happens inside it',
    !/assignLeadToMatchedVendors|qf_assign_lead_vendors|\.rpc\(/.test(OFF_BRANCH));

  check('D06 no credit mutation path is reachable from inside it',
    !/credit|qf_apply_credit_mutation/i.test(withoutStandingNegatives(OFF_BRANCH)));

  check('D07 no communication / delivery / preview side effect happens inside it',
    !/deliverLeadToVendorDashboard|createVendorLeadWhatsappPreview|createClientAssignedVendorsPreview|whatsapp/i
      .test(OFF_BRANCH));

  check('D08 no idempotency / operation key is consumed, so a replay stays inert',
    !/buildAssignmentOperationKey|operation_key|request_fingerprint/.test(OFF_BRANCH));

  check('D09 the ONLY write is the matching-run record it was given',
    (OFF_BRANCH.match(/await updateMatchingRun\(runId, \{/g) || []).length === 1
    && !/\.from\(/.test(OFF_BRANCH)
    && !/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(OFF_BRANCH));

  check('D10 that record is a deterministic terminal SKIP carrying the stable reason',
    /run_status: "skipped",/.test(OFF_BRANCH)
    && /failure_reason: AUTO_ASSIGNMENT_OFF_REASON,/.test(OFF_BRANCH)
    && /eligible_vendor_count: 0,/.test(OFF_BRANCH)
    && /selected_vendor_ids: \[\],/.test(OFF_BRANCH)
    && /assigned_vendor_ids: \[\],/.test(OFF_BRANCH));

  check('D11 the evidence states its own standing negatives, so a reader can prove the halt',
    /auto_assignment_mode: "off",/.test(OFF_BRANCH)
    && /halted_before: "vendor_evaluation",/.test(OFF_BRANCH)
    && /vendors_evaluated: false,/.test(OFF_BRANCH)
    && /route_provider_called: false,/.test(OFF_BRANCH)
    && /assignment_authority_called: false,/.test(OFF_BRANCH)
    && /credits_debited: false,/.test(OFF_BRANCH)
    && /deliveries_created: false,/.test(OFF_BRANCH));

  check('D12 the outcome is FAIL-SAFE — an ok() skip, never a throw and never a rejection',
    /return ok\(\{/.test(OFF_BRANCH)
    && /status: "skipped",/.test(OFF_BRANCH)
    && /failureReason: AUTO_ASSIGNMENT_OFF_REASON,/.test(OFF_BRANCH)
    && !/throw |return fail\(|Promise\.reject/.test(OFF_BRANCH));

  check('D13 the replay of the same lead while off is deterministic — no clock, no randomness',
    !/Date\.now\(\)|Math\.random\(|new Date\(\)/.test(OFF_BRANCH));

  check('D14 "skipped" is a status the result contract already allows',
    /status: "matched" \| "waiting" \| "skipped" \| "failed";/.test(MATCHER));

  check('D15 the recovery mapper no longer claims "skipped" is unreachable',
    /kill switch/i.test(read('services/leadQualityRecoveryCore.ts'))
    && /case "matched":/.test(RECOVERY));
}

// ===========================================================================
section('E. NOT-OFF IS UNCHANGED — preview is NOT redefined [static]');
// ===========================================================================
{
  // The 80.00 audit proved what `preview` does today: it runs the canonical
  // matcher, which finalizes assignments and debits credits. Making it a real
  // dry run would be a product contract change, so these checks exist to make
  // such a change impossible to slip in under a "kill switch" heading.
  check('E01 the non-off path still reaches the canonical authority unconditionally',
    /const assignment = await assignLeadToMatchedVendors\(leadId, selectedVendorIds\);/.test(MATCHER));

  check('E02 no mode value gates the authority call',
    !/auto_assignment_mode[\s\S]{0,400}assignLeadToMatchedVendors/.test(
      MATCHER.slice(iEval >= 0 ? iEval : 0)));

  check('E03 no "dry run" / "preview only" short-circuit was introduced into the matcher',
    !/previewOnly|dry_run|dryRun|simulate/i.test(MATCHER));

  check('E04 the submitted pool is still the ranked pool, in rank order (75.01 preserved)',
    /const selectedVendorIds = rankedPool\.pool;/.test(MATCHER)
    && /candidate_order_is_binding: true/.test(MATCHER)
    && /ranked_candidate_order: selectedVendorIds/.test(MATCHER));

  check('E05 the 75.02 / 75.03 / 75.04 seams are untouched by this phase',
    (MATCHER.match(/await fetchGeoVendorShortlist\(/g) || []).length === 1
    && /geo: geoEvidence,/.test(MATCHER)
    && /route: routeEvidence,/.test(MATCHER)
    && /geofair: geoFairEvidence,/.test(MATCHER)
    && /reorderByGeoFrontier\(eligible, routeOutcome\.placements\)/.test(MATCHER));

  check('E06 the cap-deferred evidence is still recorded on every terminal outcome',
    /cap_deferred_vendor_ids: classifyCapDeferred\(/.test(MATCHER)
    && (MATCHER.match(/\.\.\.outcomeAudit/g) || []).length === 3);

  check('E07 the preview engine still QUEUES on off — its behaviour is untouched',
    /const queue = await queueLeadForAssignment\(\{/.test(PREVIEW)
    && /queueReason,/.test(PREVIEW)
    && /status: "queued",/.test(PREVIEW));

  check('E08 the preview engine still declares its own safety snapshot honestly',
    /previewOnly: true,/.test(PREVIEW)
    && /finalAssignment: false,/.test(PREVIEW)
    && /creditsDeducted: false,/.test(PREVIEW));
}

// ===========================================================================
section('F. LAUNCH CONTROL COPY IS NOW TRUE [static]');
// ===========================================================================
{
  const disabled = LAUNCH.split('if (mode === "off") {')[1]?.split('return {')[1]?.split('};')[0] ?? '';

  check('F01 the DISABLED copy no longer claims a queue placement the matcher never makes',
    disabled.length > 0
    && !/assignment queue/i.test(disabled)
    && /switched off/i.test(disabled));

  check('F02 the DISABLED copy states the three things that do NOT happen',
    /no vendor is evaluated, no assignment is created and no credit is charged/.test(LAUNCH));

  check('F03 the ACTIVE copy no longer claims a non-off mode does not finalize an assignment',
    !/it does not finalize an assignment on its own/.test(LAUNCH));

  check('F04 the ACTIVE copy states the truth the 80.00 audit proved: assignment + credit',
    /assigned to up to 3 vendors through the canonical assignment authority/.test(LAUNCH)
    && /charges that vendor 1 credit/.test(LAUNCH)
    && /is a label, not a dry run/.test(LAUNCH));

  check('F05 the control is still BLOCKING and still points at its ONE canonical home',
    /impact: "blocking" as const,/.test(LAUNCH)
    && /href: "\/admin\/settings",/.test(LAUNCH)
    && /const AUTO_ASSIGNMENT_KEY = "auto_assignment_mode";/.test(LAUNCH));

  check('F06 Launch Control remains READ-ONLY — no mutation writer was imported',
    !/updateMarketplaceRuntimeSetting|setAosN8nMasterRouterSetting/.test(LAUNCH)
    && !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(LAUNCH));

  check('F07 no new admin mutation surface was created by this phase',
    !/"use server"/.test(LAUNCH_RAW));
}

// ===========================================================================
section('G. MVP INVARIANTS UNCHANGED [pure] [static]');
// ===========================================================================
{
  check('G01 the active assignment cap is still 3',
    CANONICAL_ACTIVE_ASSIGNMENT_CAP === 3);

  check('G02 the lifetime assignment cap is still 6',
    CANONICAL_LIFETIME_ASSIGNMENT_CAP === 6);

  check('G03 the credit cost is still exactly 1 per successful assignment',
    CANONICAL_ASSIGNMENT_CREDIT_COST === 1);

  check('G04 the bounded candidate pool is unchanged and the matcher still imports it',
    MAX_CANONICAL_CANDIDATE_POOL === 20
    && /const MAX_ASSIGNMENT_CANDIDATE_POOL = MAX_CANONICAL_CANDIDATE_POOL;/.test(MATCHER)
    && /const MAX_VENDOR_MATCHES = 3;/.test(MATCHER));

  check('G05 QF-MVP-80.01 itself added NO migration — the repo set is 102 after the QF-MVP-80.03 audit repair',
    readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).length === 102);

  check('G06 the three migrations this phase rehearses exist on disk, unrenamed',
    ['20260814000000_qf_mvp_40_marketing_consent_writer.sql',
      '20260815000000_qf_mvp_75_01_matchcore_binding_rank_order.sql',
      '20260816000000_qf_mvp_75_02_geo_postgis_shortlist.sql']
      .every((f) => readdirSync(path.join(ROOT, 'supabase', 'migrations')).includes(f)));

  check('G07 the 80.01 suite is registered as a repo gate',
    typeof PKG.scripts['test:mvp:80-01'] === 'string'
    && PKG.scripts['test:mvp:80-01'].includes('validate-qf-mvp-80-01.mjs'));
}

// ===========================================================================
section('H. SECRET + ENVIRONMENT BOUNDARY [static]');
// ===========================================================================
{
  const changed = {
    'services/leadMatchingEngine.ts': MATCHER_RAW,
    'lib/lead-assignment/runtimeSettings.ts': SETTINGS_RAW,
    'lib/lead-assignment/autoAssignmentEngine.ts': PREVIEW_RAW,
    'services/adminLaunchControlService.ts': LAUNCH_RAW,
  };

  check('H01 no Supabase project ref appears in any file this phase changed',
    Object.values(changed).every((s) => !/uckafzuochmbvtiodmcl|yqpgcsduqbxulrlzwzap|coilipywdvxklewquqvv/.test(s)));

  check('H02 no key, token or bearer literal was introduced',
    Object.values(changed).every((s) => !/eyJ[A-Za-z0-9_-]{10,}|service_role_key\s*=|Bearer [A-Za-z0-9]/.test(s)));

  check('H03 the kill switch reads NO environment variable — the switch is the stored row alone',
    !/process\.env/.test(OFF_BRANCH)
    && !/process\.env/.test(MATCHER));

  // Scans the IMPORT STATEMENTS only. Scanning the whole body would read this
  // harness's own mutant fixtures — which deliberately quote forbidden
  // identifiers as strings — as if they were live imports.
  const ownImports = (read('scripts/mvp/matching/validate-qf-mvp-80-01.mjs')
    .match(/^import[\s\S]*?from '[^']+';$/gm) || []).map((s) => s.match(/from '([^']+)';$/)[1]);

  check('H04 this harness itself is offline: it imports only node builtins and ONE pure module',
    ownImports.length > 0
    && ownImports.every((s) => s.startsWith('node:') || s === '../../../lib/marketplace/canonicalAssignmentContract.ts'),
    JSON.stringify(ownImports));
}

// ===========================================================================
section('I. MUTANTS — every check above is proved to bite [mutant]');
// ===========================================================================
{
  function mutant(name, source, mutate, predicate) {
    const mutated = mutate(source);
    const changed = mutated !== source;
    const rejects = !predicate(mutated);
    check(`mutant ${name}`, changed && rejects,
      !changed ? 'mutation did not change the source' : 'the check still passed on mutated source');
  }

  // ---- the gate itself -----------------------------------------------------
  mutant('01 INVERTING the off check is rejected',
    MATCHER_RAW,
    (s) => s.replace('if (runtimeSettings.auto_assignment_mode === "off") {',
      'if (runtimeSettings.auto_assignment_mode !== "off") {'),
    (s) => /if \(runtimeSettings\.auto_assignment_mode === "off"\) \{/.test(stripTs(s)));

  mutant('02 treating PREVIEW as off is rejected',
    MATCHER_RAW,
    (s) => s.replace('if (runtimeSettings.auto_assignment_mode === "off") {',
      'if (runtimeSettings.auto_assignment_mode !== "auto_suggest") {'),
    (s) => /if \(runtimeSettings\.auto_assignment_mode === "off"\) \{/.test(stripTs(s))
      && !/auto_assignment_mode !== /.test(stripTs(s)));

  mutant('03 adding a SECOND, contradicting mode branch is rejected',
    MATCHER_RAW,
    (s) => s.replace('    const evaluation = await evaluateVendorsForLead(leadRow);',
      '    if (runtimeSettings.auto_assignment_mode === "preview") { /* noop */ }\n    const evaluation = await evaluateVendorsForLead(leadRow);'),
    (s) => (stripTs(s).match(/runtimeSettings\.auto_assignment_mode/g) || []).length === 1);

  mutant('04 reading the settings TWICE per run is rejected',
    MATCHER_RAW,
    (s) => s.replace('    const evaluation = await evaluateVendorsForLead(leadRow);',
      '    const again = await loadMarketplaceRuntimeSettings();\n    const evaluation = await evaluateVendorsForLead(leadRow);'),
    (s) => (stripTs(s).match(/await loadMarketplaceRuntimeSettings\(\)/g) || []).length === 1);

  // ---- placement -----------------------------------------------------------
  mutant('05 moving the gate AFTER vendor evaluation is rejected',
    MATCHER_RAW,
    (s) => {
      const g = s.indexOf(GATE);
      const e = s.indexOf(FIRST_ACTING_STEP);
      if (g < 0 || e < g) return s;
      const branch = s.slice(g, e);
      return `${s.slice(0, g)}${FIRST_ACTING_STEP}\n${branch}${s.slice(e + FIRST_ACTING_STEP.length)}`;
    },
    (s) => {
      const t = stripTs(s);
      return t.indexOf(GATE) >= 0 && t.indexOf(FIRST_ACTING_STEP) > t.indexOf(GATE);
    });

  mutant('06 moving the gate AFTER the assignment authority is rejected',
    MATCHER_RAW,
    (s) => {
      const AUTH = 'const assignment = await assignLeadToMatchedVendors(leadId, selectedVendorIds);';
      const g = s.indexOf(GATE);
      const e = s.indexOf(FIRST_ACTING_STEP);
      const a = s.indexOf(AUTH);
      if (g < 0 || e < g || a < e) return s;
      const branch = s.slice(g, e);
      const afterAuth = a + AUTH.length;
      return `${s.slice(0, g)}${s.slice(e, afterAuth)}${branch}${s.slice(afterAuth)}`;
    },
    (s) => {
      const t = stripTs(s);
      return t.indexOf('const assignment = await assignLeadToMatchedVendors(leadId, selectedVendorIds);') > t.indexOf(GATE);
    });

  mutant('07 a ROUTE PROVIDER call placed before the off gate is rejected',
    MATCHER_RAW,
    (s) => s.replace(`    ${GATE}`,
      '    const preRoute = await measureLeadRouteTimes({ leadOrigin: null, candidates: [] });\n'
      + `    void preRoute;\n    ${GATE}`),
    (s) => {
      const t = stripTs(s);
      return t.indexOf('measureLeadRouteTimes') > t.indexOf(GATE);
    });

  mutant('08 a GEO SHORTLIST read placed before the off gate is rejected',
    MATCHER_RAW,
    (s) => s.replace(`    ${GATE}`,
      '    const preGeo = await fetchGeoVendorShortlist(leadRow);\n'
      + `    void preGeo;\n    ${GATE}`),
    (s) => {
      const t = stripTs(s);
      return t.indexOf('await fetchGeoVendorShortlist(leadRow)') > t.indexOf(GATE);
    });

  // ---- the off branch body -------------------------------------------------
  const offSlice = (s) => {
    const t = stripTs(s);
    const g = t.indexOf(GATE);
    const e = t.indexOf(FIRST_ACTING_STEP);
    return g >= 0 && e > g ? t.slice(g, e) : '';
  };

  /**
   * Insert a statement immediately before the off branch's `return ok({`.
   *
   * Done by INDEX, not by String.replace: the consent and duplicate refusals
   * above return a byte-identical `return ok({ leadId, status: "skipped",`
   * block, so a textual replace would silently mutate one of THOSE instead and
   * the mutant would pass for the wrong reason.
   */
  const injectIntoOffBranch = (s, statement) => {
    const g = s.indexOf(GATE);
    if (g < 0) return s;
    const r = s.indexOf('      return ok({', g);
    if (r < 0) return s;
    return `${s.slice(0, r)}      ${statement}\n${s.slice(r)}`;
  };

  mutant('09 SKIPPING the matching-run evidence in the off branch is rejected',
    MATCHER_RAW,
    (s) => s.replace(`      await updateMatchingRun(runId, {
        run_status: "skipped",
        eligible_vendor_count: 0,`, `      await noopRun(runId, {
        run_status: "skipped",
        eligible_vendor_count: 0,`),
    (s) => (offSlice(s).match(/await updateMatchingRun\(runId, \{/g) || []).length === 1);

  mutant('10 dropping the standing negatives from the evidence is rejected',
    MATCHER_RAW,
    (s) => s.replace('          assignment_authority_called: false,\n', ''),
    (s) => /assignment_authority_called: false,/.test(offSlice(s)));

  mutant('11 recording a NON-terminal run status while off is rejected',
    MATCHER_RAW,
    // The three-line anchor is unique to the off branch; the two-line prefix is
    // shared with the consent refusal above.
    (s) => s.replace(`        run_status: "skipped",
        eligible_vendor_count: 0,`, `        run_status: "started",
        eligible_vendor_count: 0,`),
    (s) => /run_status: "skipped",/.test(offSlice(s)));

  mutant('12 renaming the stable reason code is rejected',
    SETTINGS_RAW,
    (s) => s.replace('export const AUTO_ASSIGNMENT_OFF_REASON = "auto_assignment_off";',
      'export const AUTO_ASSIGNMENT_OFF_REASON = "assignment_disabled";'),
    (s) => /export const AUTO_ASSIGNMENT_OFF_REASON = "auto_assignment_off";/.test(stripTs(s)));

  mutant('13 calling the authority from inside the off branch is rejected',
    MATCHER_RAW,
    (s) => injectIntoOffBranch(s, 'await assignLeadToMatchedVendors(leadId, []);'),
    (s) => !/assignLeadToMatchedVendors/.test(offSlice(s)));

  mutant('14 creating a client preview from inside the off branch is rejected',
    MATCHER_RAW,
    (s) => injectIntoOffBranch(s, 'await createClientAssignedVendorsPreview(leadId, []);'),
    (s) => !/createClientAssignedVendorsPreview/.test(offSlice(s)));

  mutant('15 THROWING instead of failing safe is rejected',
    MATCHER_RAW,
    (s) => injectIntoOffBranch(s, 'throw new Error("auto assignment off");'),
    (s) => !/throw /.test(offSlice(s)));

  // ---- what off must NOT shadow -------------------------------------------
  mutant('16 letting the switch overwrite the CONSENT refusal is rejected',
    MATCHER_RAW,
    (s) => {
      const g = s.indexOf(`    ${GATE}`);
      const c = s.indexOf('    if (!leadRow.share_consent) {');
      const e = s.indexOf(`    ${FIRST_ACTING_STEP}`);
      if (g < 0 || c < 0 || e < g) return s;
      const branch = s.slice(g, e);
      return `${s.slice(0, c)}${branch}${s.slice(c, g)}${s.slice(e)}`;
    },
    (s) => {
      const t = stripTs(s);
      return t.indexOf(GATE) > t.indexOf('if (!leadRow.share_consent) {');
    });

  mutant('17 turning the DEFAULT mode back into "preview" is rejected — QF-MVP-80.04 fails closed',
    SETTINGS_RAW,
    (s) => s.replace('  auto_assignment_mode: "off",\n};', '  auto_assignment_mode: "preview",\n};'),
    (s) => /auto_assignment_mode: "off",/.test(stripTs(s))
      && !/auto_assignment_mode: "preview",/.test(stripTs(s)));

  mutant('18 widening normalization so an unknown value means off is rejected',
    SETTINGS_RAW,
    (s) => s.replace('return (mode === "off" || mode === "preview" || mode === "auto_suggest" ? mode : fallback) as MarketplaceRuntimeSettings[K];',
      'return (mode === "preview" || mode === "auto_suggest" ? mode : "off") as MarketplaceRuntimeSettings[K];'),
    (s) => /mode === "off" \|\| mode === "preview" \|\| mode === "auto_suggest" \? mode : fallback/.test(flat(stripTs(s))));

  // ---- preview must not be silently redefined ------------------------------
  mutant('19 quietly making PREVIEW non-mutating is rejected',
    MATCHER_RAW,
    (s) => s.replace('    const assignment = await assignLeadToMatchedVendors(leadId, selectedVendorIds);',
      '    if (runtimeSettings.auto_assignment_mode === "preview") return ok({ leadId, status: "skipped", eligibleVendorCount: eligible.length, selectedVendorIds, assignedVendors: [] });\n'
      + '    const assignment = await assignLeadToMatchedVendors(leadId, selectedVendorIds);'),
    (s) => (stripTs(s).match(/runtimeSettings\.auto_assignment_mode/g) || []).length === 1);

  mutant('20 restoring the false "does not finalize an assignment" copy is rejected',
    LAUNCH_RAW,
    (s) => s.replace('New leads are matched and assigned to up to 3 vendors through the canonical assignment authority',
      'It selects and records suggested vendors for each lead; it does not finalize an assignment on its own'),
    (s) => !/it does not finalize an assignment on its own/.test(s)
      && /assigned to up to 3 vendors through the canonical assignment authority/.test(s));

  mutant('21 restoring the false "placed on the assignment queue" copy is rejected',
    LAUNCH_RAW,
    (s) => s.replace('New leads are recorded and left unmatched: no vendor is evaluated, no assignment is created and no credit is charged until this is switched back on.',
      'New leads are placed on the assignment queue instead of being matched to vendors.'),
    (s) => {
      const t = stripTs(s);
      const disabled = t.split('if (mode === "off") {')[1]?.split('return {')[1]?.split('};')[0] ?? '';
      return disabled.length > 0 && !/assignment queue/i.test(disabled);
    });

  mutant('22 adding a mutation writer to the read-only launch console is rejected',
    LAUNCH_RAW,
    (s) => s.replace('import { adminClient } from "../lib/supabase";',
      'import { adminClient } from "../lib/supabase";\nimport { updateMarketplaceRuntimeSetting } from "../lib/lead-assignment/runtimeSettings";'),
    (s) => !/updateMarketplaceRuntimeSetting/.test(stripTs(s)));

  mutant('23 letting the preview engine drift onto its own reason literal is rejected',
    PREVIEW_RAW,
    (s) => s.replace('const queueReason = AUTO_ASSIGNMENT_OFF_REASON;', 'const queueReason = "auto_assignment_off";'),
    (s) => /const queueReason = AUTO_ASSIGNMENT_OFF_REASON;/.test(stripTs(s)));
}

// ===========================================================================
console.log(`\n${'='.repeat(78)}`);
console.log(`QF-MVP-80.01 — passed ${passed}, failed ${failed}`);
if (failed > 0) {
  console.log('\nFAILURES:');
  for (const line of failures) console.log(line);
}
console.log('='.repeat(78));
process.exit(failed > 0 ? 1 : 0);
