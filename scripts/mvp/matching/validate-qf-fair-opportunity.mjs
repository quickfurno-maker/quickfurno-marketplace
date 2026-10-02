// ============================================================================
// QuickFurno — fair opportunity distribution certification
// OFFLINE: no DB, network, provider, secrets or current-time assertions.
// ============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FAIRNESS_ACTIVE_SLOT_CAP,
  FAIRNESS_BALANCE_CAP,
  FAIRNESS_MODEL_VERSION,
  buildFairnessScope,
  clampFairnessBalance,
  distanceBand,
  fairShareForDeliveredCount,
  fairSharePerDelivery,
  normalizeFairOpportunityGroups,
} from "../../../lib/matchcore/fairOpportunity.ts";
import {
  compareAutomaticMatchDecisions,
  rankAutomaticMatchDecisions,
} from "../../../lib/matchcore/automaticMatchDecision.ts";
import {
  orderPublicVendorCandidates,
} from "../../../lib/marketplace/publicVendorFairOrdering.ts";
import {
  evaluateVendorAutomaticLeadEligibility,
  LEAD_CREDIT_COST,
} from "../../../lib/vendors/vendorAutomaticEligibility.ts";
import {
  CANONICAL_ACTIVE_ASSIGNMENT_CAP,
  CANONICAL_ASSIGNMENT_CREDIT_COST,
} from "../../../lib/marketplace/canonicalAssignmentContract.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const migration = read("supabase/migrations/20261002071500_vendor_fair_opportunity_distribution.sql");
const reconcile = read("supabase/migrations/20261002090000_vendor_fair_opportunity_group_reconcile.sql");
const indexHardening = read("supabase/migrations/20261002091500_vendor_fair_opportunity_fk_indexes.sql");
const matcher = read("services/leadMatchingEngine.ts");
const matchcore = read("lib/matchcore/automaticMatchDecision.ts");
const fairness = read("lib/matchcore/fairOpportunity.ts");
const fairService = read("services/vendorFairOpportunityService.ts");
const publicVendors = read("services/publicVendorService.ts");
const publicOrdering = read("lib/marketplace/publicVendorFairOrdering.ts");

let passed = 0;
let failed = 0;
const failures = [];
function section(name) { console.log("\n── " + name + " ──"); }
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log("   ok    " + name); }
  else {
    failed++;
    const msg = "   FAIL  " + name + (detail ? " — " + detail : "");
    failures.push(msg);
    console.log(msg);
  }
}
const eq = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a,b,eps=1e-6) => Math.abs(a-b) <= eps;

const V = {
  a: "11111111-1111-4111-8111-111111111111",
  b: "22222222-2222-4222-8222-222222222222",
  c: "33333333-3333-4333-8333-333333333333",
  d: "44444444-4444-4444-8444-444444444444",
};

function decision(id, overrides={}) {
  return {
    vendor_id:id,
    eligible:true,
    reason_codes:[],
    match_tier:0,
    match_type:"exact",
    has_coordinates:true,
    coordinate_source:"office_coordinates",
    distance_km:2,
    distance_band:0,
    area_affinity:0,
    fair_share_balance:0,
    delivered_7d:0,
    last_delivered_at:null,
    last_assigned_at:null,
    rating:0,
    rank_position:null,
    ...overrides,
  };
}

console.log("QuickFurno fair-opportunity distribution certification");
console.log("model=" + FAIRNESS_MODEL_VERSION);

section("A. PROVIDER-DELIVERY FAIR-SHARE MATH");
check("A01 one comparable vendor earns 1 per confirmed delivery", fairSharePerDelivery(1) === 1);
check("A02 two comparable vendors earn 0.5 each", fairSharePerDelivery(2) === 0.5);
check("A03 three comparable vendors earn 1/3 each", near(fairSharePerDelivery(3), 1/3));
check("A04 six comparable vendors earn 1/6 each", near(fairSharePerDelivery(6), 1/6));
check("A05 three delivered slots across six comparable vendors = 0.5 each",
  near(fairShareForDeliveredCount(6,3),0.5));
check("A06 a hypothetical fourth delivery is capped by max-3 contract",
  near(fairShareForDeliveredCount(6,4),0.5));
check("A07 active slot cap stays three",
  FAIRNESS_ACTIVE_SLOT_CAP === 3 && CANONICAL_ACTIVE_ASSIGNMENT_CAP === 3);
check("A08 effective fairness carryover is bounded",
  FAIRNESS_BALANCE_CAP === 3
  && clampFairnessBalance(99) === 3
  && clampFairnessBalance(-99) === -3);
check("A09 one assignment still costs exactly one credit",
  LEAD_CREDIT_COST === 1 && CANONICAL_ASSIGNMENT_CREDIT_COST === 1);

section("B. GEOGRAPHIC RELEVANCE BANDS");
check("B01 <=3km is band 0", distanceBand(0) === 0 && distanceBand(3) === 0);
check("B02 >3 through 7km is band 1", distanceBand(3.0001) === 1 && distanceBand(7) === 1);
check("B03 >7 through 12km is band 2", distanceBand(7.0001) === 2 && distanceBand(12) === 2);
check("B04 farther valid distance is band 3", distanceBand(12.0001) === 3 && distanceBand(50) === 3);
check("B05 missing distance is no-coordinate band 4",
  distanceBand(null) === 4 && distanceBand(Number.NaN) === 4);

section("C. POOL SCOPE + GROUP NORMALIZATION");
{
  const city = buildFairnessScope({ city:"Pune", service_required:"Full Home Interior" });
  const zone = buildFairnessScope({
    city:"Pune",
    service_zone_id:"ABC-123",
    service_required:"Full Home Interior",
  });
  const same = buildFairnessScope({ city:"pune", service_required:"Interior Designers" });
  check("C01 unresolved geography scopes by city + parent category",
    /^city:pune\|category:/.test(city.scopeKey));
  check("C02 resolved geography scopes by service zone + category",
    zone.scopeKey.startsWith("zone:abc-123|category:"));
  check("C03 equivalent interior labels resolve to same category scope",
    city.categoryKey === same.categoryKey);

  const groups = normalizeFairOpportunityGroups([
    {vendor_id:V.b,match_tier:0,distance_band:1},
    {vendor_id:V.a,match_tier:0,distance_band:0},
    {vendor_id:V.a.toUpperCase(),match_tier:1,distance_band:4},
  ]);
  check("C04 group normalization is deterministic and first occurrence wins",
    eq(groups,[
      {vendor_id:V.a,match_tier:0,distance_band:0},
      {vendor_id:V.b,match_tier:0,distance_band:1},
    ]));
}

section("D. DETERMINISTIC FAIR RANKING");
{
  const ranked = (rows) => rankAutomaticMatchDecisions(rows, true).map(x=>x.vendor_id);

  check("D01 fair deficit beats exact distance inside same band",
    eq(ranked([
      decision(V.a,{distance_km:2.9,distance_band:0,fair_share_balance:1}),
      decision(V.b,{distance_km:0.5,distance_band:0,fair_share_balance:0}),
    ]), [V.a,V.b]));

  check("D02 farther band cannot jump nearer band from fairness debt",
    eq(ranked([
      decision(V.a,{distance_km:2.9,distance_band:0,fair_share_balance:-3}),
      decision(V.b,{distance_km:7.1,distance_band:2,fair_share_balance:3}),
    ]), [V.a,V.b]));

  check("D03 fewer recent delivered opportunities wins after equal deficit",
    eq(ranked([
      decision(V.a,{delivered_7d:4}),
      decision(V.b,{delivered_7d:1}),
    ]), [V.b,V.a]));

  check("D04 never-delivered wins after equal balance and recent count",
    eq(ranked([
      decision(V.a,{last_delivered_at:"2026-10-01T00:00:00.000Z"}),
      decision(V.b,{last_delivered_at:null}),
    ]), [V.b,V.a]));

  check("D05 older delivered timestamp wins before newer one",
    eq(ranked([
      decision(V.a,{last_delivered_at:"2026-09-20T00:00:00.000Z"}),
      decision(V.b,{last_delivered_at:"2026-10-01T00:00:00.000Z"}),
    ]), [V.a,V.b]));

  check("D06 area affinity is only a later tie-break",
    eq(ranked([
      decision(V.a,{area_affinity:0}),
      decision(V.b,{area_affinity:1}),
    ]), [V.b,V.a]));

  check("D07 exact distance is only a later tie-break inside equal fair state",
    eq(ranked([
      decision(V.a,{distance_km:2.5,distance_band:0}),
      decision(V.b,{distance_km:1.5,distance_band:0}),
    ]), [V.b,V.a]));

  check("D08 vendor id is stable final tie-break",
    compareAutomaticMatchDecisions(decision(V.a), decision(V.b), true) < 0);

  check("D09 rating cannot change rank",
    eq(ranked([
      decision(V.b,{rating:99}),
      decision(V.a,{rating:0}),
    ]), [V.a,V.b]));

  check("D10 exact category remains stronger than fairness",
    eq(ranked([
      decision(V.a,{match_tier:1,fair_share_balance:3}),
      decision(V.b,{match_tier:0,fair_share_balance:-3}),
    ]), [V.b,V.a]));

  check("D11 raw historical debt is clamped before ranking",
    compareAutomaticMatchDecisions(
      decision(V.a,{fair_share_balance:999,delivered_7d:2}),
      decision(V.b,{fair_share_balance:3,delivered_7d:0}),
      true,
    ) > 0);
}

section("E. ACTIVE CREDIT IS A GATE, NOT A BID");
{
  const base = {
    status:"Approved",
    is_active:true,
    accepting_leads:true,
    assignment_suspended_at:null,
  };
  const zero = evaluateVendorAutomaticLeadEligibility({...base,remaining_credits:0},{nowMs:1});
  const one = evaluateVendorAutomaticLeadEligibility({...base,remaining_credits:1},{nowMs:1});
  const hundred = evaluateVendorAutomaticLeadEligibility({...base,remaining_credits:100},{nowMs:1});

  check("E01 zero-credit vendor is ineligible",
    !zero.eligible && zero.reasons.includes("no_credits"));
  check("E02 one-credit vendor is eligible", one.eligible);
  check("E03 extra credits do not create a different eligibility class",
    hundred.eligible && one.creditCost === hundred.creditCost && one.creditCost === 1);

  const cmpBody = stripComments(matchcore).split("export function compareAutomaticMatchDecisions")[1] ?? "";
  check("E04 comparator contains no credit key", !/credit/i.test(cmpBody));
  check("E05 comparator contains no package or paid priority",
    !/package|paid_status|premium|priority/i.test(cmpBody));
}

section("F. NO SUBJECTIVE VENDOR JUDGMENT");
{
  const cmpBody = stripComments(matchcore).split("export function compareAutomaticMatchDecisions")[1] ?? "";
  check("F01 rating is not comparator input", !/\.rating\b/.test(cmpBody));
  check("F02 capacity is not comparator input",
    !/capacity|team_size|monthly_capacity/i.test(cmpBody));
  check("F03 popularity/revenue/project count are not comparator inputs",
    !/popular|revenue|completed_projects|profile_click|review_count/i.test(cmpBody));
  check("F04 live matcher neutralizes legacy subjective score",
    !/function scoreVendor\b/.test(matcher) && /score:\s*0/.test(matcher));
}

section("G. REAL AUTOMATIC RUN SNAPSHOTS THE HARD-ELIGIBLE GROUPS");
check("G01 automatic assignment explicitly records fairness pool",
  /evaluateVendorsForLead\(leadRow, \{ recordFairOpportunityPool: true \}\)/.test(matcher));
check("G02 generic/AOS/recovery evaluation defaults to read-only fairness",
  /options: \{ recordFairOpportunityPool\?: boolean \} = \{\}/.test(matcher)
  && /options\.recordFairOpportunityPool\s*\?/.test(matcher));
check("G03 snapshot receives id + match tier + distance band from hard-eligible rows",
  /snapshotFairOpportunityEligiblePool\([\s\S]*baseEvaluation\.eligible\.map/.test(matcher)
  && /match_tier: vendor\.match_tier/.test(matcher)
  && /distance_band: vendor\.distance_band/.test(matcher));
check("G04 snapshotting is balance-neutral",
  /Snapshotting does NOT move fairness balance/.test(fairService));
check("G05 snapshot service persists normalized vendor groups",
  /normalizeFairOpportunityGroups/.test(fairService)
  && /p_vendor_groups: groups/.test(fairService));
check("G06 service fails open to neutral fairness if ledger unavailable",
  /ledger unavailable; using neutral fairness/.test(fairService)
  && /ledgerAvailable: false/.test(fairService));

section("H. PERSISTENT IDEMPOTENT GROUP LEDGER");
check("H01 lead fairness snapshot is one-per-lead",
  /lead_id uuid primary key references public\.leads/.test(migration));
check("H02 snapshot stores immutable vendor relevance groups",
  /create table if not exists public\.lead_fairness_candidates/.test(migration)
  && /match_tier smallint not null/.test(migration)
  && /distance_band smallint not null/.test(migration)
  && /primary key \(lead_id, vendor_id\)/.test(migration));
check("H03 fairness ledger is keyed by vendor + scope",
  /primary key \(vendor_id, scope_key\)/.test(migration));
check("H04 delivered-slot fair share is unique per assignment + group vendor",
  /uq_vendor_opportunity_event_fair_share/.test(migration));
check("H05 delivered consumption is unique per assignment",
  /uq_vendor_opportunity_event_delivered/.test(migration));
check("H06 bad-lead peer-share reversal is unique per assignment + vendor",
  /uq_vendor_opportunity_event_fair_share_reversed/.test(migration));
check("H07 winner bad-lead restoration is unique per assignment",
  /uq_vendor_opportunity_event_restored/.test(migration));
check("H08 first snapshot is canonical on replay",
  /on conflict \(lead_id\) do nothing/.test(migration)
  && /if v_snapshot_inserted=1 then/.test(migration)
  && /insert into public\.lead_fairness_candidates/.test(migration));
check("H09 snapshot records participation but moves no fairness balance",
  (() => {
    const part = migration.split("create or replace function public.qf_snapshot_vendor_fair_opportunity_v1")[1]
      ?.split("revoke all on function public.qf_snapshot_vendor_fair_opportunity_v1")[0] ?? "";
    return /'eligible',[\s\S]*0,[\s\S]*v_existing\.created_at/.test(part)
      && !/'fair_share_accrued'|'delivered'|'restored_bad_lead'/.test(part);
  })());

section("I. DELIVERY TRUTH + RELEVANCE-GROUP FAIRNESS");
check("I01 fairness consumption requires real communication message",
  /new\.communication_message_id is not null/.test(migration));
check("I02 fairness consumption requires delivered status + provider timestamp",
  /new\.delivery_status='delivered'/.test(migration)
  && /new\.provider_delivered_at is not null/.test(migration));
check("I03 consume resolves delivered vendor's stored relevance group",
  /select \* into v_candidate[\s\S]*from public\.lead_fairness_candidates[\s\S]*vendor_id=v_assignment\.vendor_id/.test(migration)
  && /vendor_not_in_fairness_pool/.test(migration));
check("I04 comparable group is same match tier + distance band",
  /c\.match_tier=v_candidate\.match_tier/.test(migration)
  && /c\.distance_band=v_candidate\.distance_band/.test(migration));
check("I05 fair share is 1 divided by comparable group size",
  /v_share := round\(\(1::numeric \/ v_group_count::numeric\),6\)/.test(migration));
check("I06 far/non-comparable groups cannot accrue from this delivered slot",
  /for v_vendor in[\s\S]*match_tier[\s\S]*distance_band[\s\S]*loop/.test(migration));
check("I07 delivered vendor consumes exactly one fairness unit",
  /fair_share_balance=fair_share_balance-1/.test(migration)
  && /'delivered',[\s\S]*-1,[\s\S]*v_at/.test(migration));
check("I08 assignment creation alone cannot consume fairness",
  !/lead_assignments[\s\S]{0,500}qf_consume_vendor_fair_opportunity_v1/.test(migration));
check("I09 failed/missing provider delivery cannot create fair-share accrual",
  (() => {
    const snapshotStart = migration.indexOf("create or replace function public.qf_snapshot_vendor_fair_opportunity_v1");
    const consumeStart = migration.indexOf("create or replace function public.qf_consume_vendor_fair_opportunity_v1");
    const snapshotBody = migration.slice(snapshotStart, consumeStart);
    const consumeBody = migration.slice(consumeStart);
    return !snapshotBody.includes("'fair_share_accrued'") && consumeBody.includes("'fair_share_accrued'");
  })());
check("I10 human-validated bad lead restores winner turn",
  /reason_code='bad_lead_validated'/.test(migration)
  && /'restored_bad_lead',[\s\S]*1,[\s\S]*now\(\)/.test(migration));
check("I11 human-validated bad lead reverses peers' missed-turn share",
  /'fair_share_reversed_bad_lead',[\s\S]*-v_share\.balance_delta/.test(migration)
  && /fair_share_balance=fair_share_balance-v_share\.balance_delta/.test(migration));
check("I12 restored bad leads are excluded from delivered-7d cooldown",
  /event_type='restored_bad_lead'/.test(migration)
  && /not exists/.test(migration));
check("I13 restoration recalculates effective last-delivered time",
  /select max\(d\.occurred_at\)[\s\S]*v_last_effective_delivery/.test(migration)
  && /last_delivered_at=v_last_effective_delivery/.test(migration));

section("J. SECURITY + COMMERCIAL ISOLATION");
check("J01 browser roles get no direct mutation grants",
  !/grant (insert|update|delete|all)[^;]* to (public|anon|authenticated)/i.test(migration));
check("J02 fairness mutation RPCs are service-role only",
  [
    "qf_snapshot_vendor_fair_opportunity_v1",
    "qf_consume_vendor_fair_opportunity_v1",
    "qf_restore_vendor_fair_opportunity_v1",
  ].every(name =>
    migration.includes("revoke all on function public."+name)
    && migration.includes("grant execute on function public."+name)
  ));
check("J03 read RPC is browser-closed",
  migration.includes("revoke all on function public.qf_read_vendor_fair_opportunity_v1")
  && migration.includes("grant execute on function public.qf_read_vendor_fair_opportunity_v1"));
check("J04 no Routes API/traffic/road-distance dependency",
  !/routes\.googleapis|computeRoutes|routeMatrix|trafficModel|fetch\([^)]*google/i
    .test(stripComments(migration+fairness+matcher)));
check("J05 fairness migration does not mutate wallet/credit cost",
  !/credit_cost|remaining_credits\s*=|vendor_credit_logs/i.test(migration));
check("J06 canonical max-3 remains unchanged",
  CANONICAL_ACTIVE_ASSIGNMENT_CAP === 3);

section("K. EXPLAINABILITY + LEGACY BOOTSTRAP");
check("K01 matching snapshot records fairness model and scope",
  /fairness_model: FAIRNESS_MODEL_VERSION/.test(matcher)
  && /scope_key: fairnessScopeKey/.test(matcher));
check("K02 matching snapshot records per-vendor fairness evidence",
  /fair_share_balance: vendor\.fair_share_balance/.test(matcher)
  && /delivered_7d: vendor\.delivered_7d/.test(matcher));
check("K03 rank reason exposes band, balance, recent delivery and wait",
  /distance_band:/.test(matcher)
  && /fair_balance:/.test(matcher)
  && /delivered_7d:/.test(matcher)
  && /last_delivered:/.test(matcher));
check("K04 ledger availability is persisted for rollout diagnostics",
  /ledger_available: fairnessLedgerAvailable/.test(matcher));
check("K05 neutral/no-ledger vendors preserve historical provider-delivery clock",
  /fairness\?\.ledger_present[\s\S]*fairness\.last_delivered_at[\s\S]*vendor\.last_delivered_at/.test(matcher));
check("K06 effective rank balance is clamped without destroying reversible ledger truth",
  /clampFairnessBalance\(fairness\?\.fair_share_balance \?\? 0\)/.test(matcher)
  && /clampFairnessBalance\(/.test(matchcore));

section("L. MUTATION REJECTION");
{
  const comparatorBody = (s) =>
    stripComments(s).split("export function compareAutomaticMatchDecisions")[1] ?? "";

  const guards = {
    noRating: (s) => !/\ba\.rating\b|\bb\.rating\b/.test(comparatorBody(s)),
    fairnessBeforeExactDistance: (s) => {
      const body = comparatorBody(s);
      const fair = body.indexOf("const aBalance");
      const firstExact = body.indexOf("const ad =");
      return fair >= 0 && firstExact > fair;
    },
    noCredits: (s) => !/\.credits\b/.test(comparatorBody(s)),
  };

  const cases = [
    [
      "rating reintroduced as ranking",
      s => s.replace(
        "return a.vendor_id.localeCompare(b.vendor_id);",
        "if (a.rating !== b.rating) return b.rating - a.rating;\n  return a.vendor_id.localeCompare(b.vendor_id);"
      ),
      guards.noRating,
    ],
    [
      "exact distance moved ahead of fair balance",
      s => s.replace(
        "const aBalance = clampFairnessBalance(",
        "const ad = a.distance_km ?? 999; const bd = b.distance_km ?? 999; if (ad !== bd) return ad - bd;\n  const aBalance = clampFairnessBalance("
      ),
      guards.fairnessBeforeExactDistance,
    ],
    [
      "credit balance made a ranking key",
      s => s.replace(
        "const aBalance = clampFairnessBalance(",
        "const creditPriority = (a.credits ?? 0) - (b.credits ?? 0); if (creditPriority) return -creditPriority;\n  const aBalance = clampFairnessBalance("
      ),
      guards.noCredits,
    ],
  ];

  for (const [name, mutate, guard] of cases) {
    const mutant = mutate(matchcore);
    check("L MUT reject: "+name,
      mutant !== matchcore && guard(matchcore) && !guard(mutant));
  }

  const crossBandMutant = migration.replace(
    "and c.distance_band=v_candidate.distance_band",
    "",
  );
  const bandGuard = /c\.distance_band=v_candidate\.distance_band/g;
  const realBandGuards = (migration.match(bandGuard) || []).length;
  const mutantBandGuards = (crossBandMutant.match(bandGuard) || []).length;
  check("L MUT reject: cross-band missed-turn accrual",
    crossBandMutant !== migration
    && realBandGuards > 0
    && mutantBandGuards < realBandGuards);

  const deliveryMutant = migration.replace(
    "and new.communication_message_id is not null",
    "",
  );
  check("L MUT reject: provider message gate removed",
    deliveryMutant !== migration
    && /new\.communication_message_id is not null/.test(migration)
    && !/new\.communication_message_id is not null/.test(deliveryMutant));

  const reversalPair = /'fair_share_reversed_bad_lead',\s*-v_share\.balance_delta,/;
  const reverseMutant = migration.replace(
    reversalPair,
    "'fair_share_reversed_bad_lead', 0,",
  );
  check("L MUT reject: bad-lead peer-share reversal removed",
    reverseMutant !== migration
    && reversalPair.test(migration)
    && !reversalPair.test(reverseMutant));
}

section("M. STAGING/FRESH-INSTALL RECONCILIATION");
{
  const baseTail = migration.slice(
    migration.indexOf("create or replace function public.qf_read_vendor_fair_opportunity_v1"),
  );
  const reconcileTail = reconcile.slice(
    reconcile.indexOf("create or replace function public.qf_read_vendor_fair_opportunity_v1"),
  );

  check("M01 reconcile creates the normalized candidate table if staging lacks it",
    /create table if not exists public\.lead_fairness_candidates/.test(reconcile));
  check("M02 old staging NOT NULL pool columns are relaxed conditionally",
    /column_name='eligible_vendor_ids'/.test(reconcile)
    && /alter column eligible_vendor_ids drop not null/.test(reconcile)
    && /column_name='slot_count'/.test(reconcile)
    && /alter column slot_count drop not null/.test(reconcile)
    && /column_name='fair_share_delta'/.test(reconcile)
    && /alter column fair_share_delta drop not null/.test(reconcile));
  check("M03 legacy pool members are preserved without inventing proximity",
    /unnest\(coalesce\(o\.eligible_vendor_ids/.test(reconcile)
    && /select o\.lead_id, u\.vendor_id, 0, 4, o\.created_at/.test(reconcile));
  check("M04 reconciliation removes persistence +/-3 clamping",
    /drop constraint if exists vendor_opportunity_fairness_fair_share_balance_check/.test(reconcile)
    && !/least\(3::numeric,fair_share_balance/.test(reconcile)
    && !/greatest\(-3::numeric,fair_share_balance/.test(reconcile));
  check("M05 reconciliation expands event vocabulary for exact peer reversal",
    /fair_share_reversed_bad_lead/.test(reconcile)
    && /uq_vendor_opportunity_event_fair_share_reversed/.test(reconcile));
  check("M06 superseded staging accrual RPC is service-role revoked if present",
    /qf_accrue_vendor_fair_opportunity_v1/.test(reconcile)
    && /from public, anon, authenticated, service_role/.test(reconcile));
  check("M07 final function/trigger tail is byte-identical after reconciliation",
    baseTail.length > 0 && reconcileTail === baseTail);
  check("M08 reconcile cannot mutate credits or assignments",
    !/remaining_credits\s*=|vendor_credit_logs|qf_apply_credit_mutation|insert into public\.lead_assignments|update public\.lead_assignments/i.test(reconcile));
  check("M09 reconciliation is forward-only and deletes no marketplace rows",
    !/delete from public\./i.test(reconcile));
  check("M10 FK hardening covers candidate.vendor_id",
    /idx_lead_fairness_candidates_vendor/.test(indexHardening)
    && /lead_fairness_candidates\(vendor_id, lead_id\)/.test(indexHardening));
  check("M11 FK hardening covers opportunity_events.vendor_id",
    /idx_vendor_opportunity_events_vendor/.test(indexHardening)
    && /vendor_opportunity_events\(vendor_id, occurred_at desc\)/.test(indexHardening));
  check("M12 FK hardening is index-only",
    !/insert into|update\s+public\.|delete from|alter table|create trigger|create or replace function/i.test(indexHardening));
}

section("N. PUBLIC DISCOVERY USES THE SAME FAIR TURN READ-ONLY");
{
  const publicIds = (rows, withCoords) =>
    orderPublicVendorCandidates(rows, withCoords).map((row) => row.vendor_id);

  check("N01 assignment-eligible vendor always precedes public-only ineligible vendor",
    eq(publicIds([
      {
        vendor_id: V.a,
        assignment_eligible: false,
        has_coordinates: true,
        distance_km: 0.2,
        fair_share_balance: 99,
        delivered_7d: 0,
        last_delivered_at: null,
      },
      {
        vendor_id: V.b,
        assignment_eligible: true,
        has_coordinates: true,
        distance_km: 2.5,
        fair_share_balance: -3,
        delivered_7d: 9,
        last_delivered_at: "2026-10-02T00:00:00Z",
      },
    ], true), [V.b,V.a]));

  check("N02 public discovery lets fairness beat exact distance inside same band",
    eq(publicIds([
      {
        vendor_id: V.a,
        assignment_eligible: true,
        has_coordinates: true,
        distance_km: 2.8,
        fair_share_balance: 1,
        delivered_7d: 0,
        last_delivered_at: null,
      },
      {
        vendor_id: V.b,
        assignment_eligible: true,
        has_coordinates: true,
        distance_km: 0.5,
        fair_share_balance: 0,
        delivered_7d: 0,
        last_delivered_at: null,
      },
    ], true), [V.a,V.b]));

  check("N03 public discovery prevents far-band fairness debt from beating nearer band",
    eq(publicIds([
      {
        vendor_id: V.a,
        assignment_eligible: true,
        has_coordinates: true,
        distance_km: 2.9,
        fair_share_balance: -3,
        delivered_7d: 5,
        last_delivered_at: "2026-10-02T00:00:00Z",
      },
      {
        vendor_id: V.b,
        assignment_eligible: true,
        has_coordinates: true,
        distance_km: 8,
        fair_share_balance: 3,
        delivered_7d: 0,
        last_delivered_at: null,
      },
    ], true), [V.a,V.b]));

  check("N04 without client coordinates public order still follows canonical fairness",
    eq(publicIds([
      {
        vendor_id: V.a,
        assignment_eligible: true,
        has_coordinates: true,
        distance_km: null,
        fair_share_balance: 0,
        delivered_7d: 1,
        last_delivered_at: "2026-10-01T00:00:00Z",
      },
      {
        vendor_id: V.b,
        assignment_eligible: true,
        has_coordinates: true,
        distance_km: null,
        fair_share_balance: 1,
        delivered_7d: 4,
        last_delivered_at: "2026-10-02T00:00:00Z",
      },
    ], false), [V.b,V.a]));

  check("N05 live public service reads fairness but never records a fairness pool",
    /loadFairOpportunitySnapshots/.test(publicVendors)
    && !/snapshotFairOpportunityEligiblePool|qf_snapshot_vendor_fair_opportunity|qf_consume_vendor_fair_opportunity|qf_restore_vendor_fair_opportunity/.test(publicVendors));

  check("N06 public service uses canonical active-credit eligibility",
    /evaluateVendorAutomaticLeadEligibility/.test(publicVendors)
    && /assignmentEligibleIds/.test(publicVendors));

  check("N07 legacy rating-desc database ordering is removed",
    !/\.order\(["']rating["']/.test(publicVendors));

  check("N08 public ordering neutralizes rating and contains no commercial/subjective rank key",
    /rating:\s*0/.test(publicOrdering)
    && !/\.rating\b|package|paid|capacity|popular|review|revenue/i.test(
      stripComments(publicOrdering).replace(/rating:\s*0/g, ""),
    ));

  check("N09 public ordering reuses the canonical MatchCore comparator",
    /compareAutomaticMatchDecisions/.test(publicOrdering));

  check("N10 public service uses canonical coordinates + straight-line haversine only",
    /resolveVendorCanonicalCoordinate/.test(publicVendors)
    && /haversineKm/.test(publicVendors)
    && !/routes\.googleapis|computeRoutes|routeMatrix|trafficModel/i.test(publicVendors));

  check("N11 public discovery does not mutate credits or assignment rows",
    !/remaining_credits\s*=|vendor_credit_logs|insert into public\.lead_assignments|update public\.lead_assignments/i.test(publicVendors+publicOrdering));

  check("N12 ineligible public fallback never reads fairness debt",
    /assignment_eligible/.test(publicOrdering)
    && /eligible\.sort/.test(publicOrdering)
    && /ineligible\.sort/.test(publicOrdering));
}

console.log("\nFair opportunity certification: " + passed + "/" + (passed+failed) + " passed.");
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(f);
}
if (failed) process.exit(1);
console.log("QF_FAIR_OPPORTUNITY_DISTRIBUTION_SOURCE_READY");
