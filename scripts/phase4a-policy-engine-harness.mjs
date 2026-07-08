import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 4A — QuickFurno Central Automation Policy Engine (Deterministic Policy
 * Foundation) harness.
 *
 * SOURCE/STATIC harness. Compiles the pure Phase 4A policy engine to a throwaway
 * CommonJS build and exercises: config contract + fail-closed validation, PII-free
 * facts validation, deterministic decision precedence, guarded auto-authorization
 * gates, determinism/fingerprint, the typed registry, and static side-effect
 * guards. NO DB, NO events, NO assignment, NO matching, NO quality scoring, NO
 * WhatsApp, NO n8n, NO fetch, NO worker, NO migration.
 *
 * The policy modules only `import type` from services/leadQualityService, so the
 * emitted policy JS never requires Supabase; nothing here touches the database.
 */

const outDir = resolve(".phase4a-test-build");
rmSync(outDir, { recursive: true, force: true });

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const files = [
  // Type-only dependencies (erased at runtime, needed only for type-checking).
  "lib/lead-quality/budgetFit.ts",
  "lib/supabase.ts",
  "services/leadQualityService.ts",
  "lib/aos/workflow/workflowPersistenceTypes.ts",
  "lib/aos/workflows/leadLifecycle/leadLifecycleEvents.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionTypes.ts",
  // The Phase 4A policy engine.
  "lib/aos/policy/policyTypes.ts",
  "lib/aos/policy/policyDecisionReasons.ts",
  "lib/aos/policy/policyConfig.ts",
  "lib/aos/policy/policyValidation.ts",
  "lib/aos/policy/policyFingerprint.ts",
  "lib/aos/policy/distributionAuthorizationPolicy.ts",
  "lib/aos/policy/policyRegistry.ts",
  "lib/aos/policy/index.ts",
];

const tsconfigPath = resolve(".phase4a-tsconfig.json");
writeFileSync(tsconfigPath, JSON.stringify({
  compilerOptions: {
    module: "commonjs", target: "ES2020", moduleResolution: "node",
    skipLibCheck: true, esModuleInterop: true, strict: true, jsx: "preserve",
    outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] },
  },
  files,
}, null, 2));

try {
  execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" });
} finally {
  rmSync(tsconfigPath, { force: true });
}

const requireFromBuild = createRequire(`${outDir}/`);
const P = requireFromBuild("./lib/aos/policy/index.js");
const routeMod = requireFromBuild(
  "./lib/aos/workflows/leadLifecycle/distribution/leadDistributionTypes.js",
);

const KEY = P.AutomationPolicyKey;
const MODE = P.AutomationPolicyMode;
const DECISION = P.DistributionAuthorizationDecision;
const REASON = P.PolicyDecisionReason;
const GATE = P.PolicyGate;
const ROUTE = routeMod.LeadDistributionRoute;
const VERSION = P.LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_VERSION;
const SAFE_DEFAULT = P.SAFE_DEFAULT_LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_CONFIG;

const validateConfig = P.validateLeadDistributionAuthorizationConfig;
const validateFacts = P.validateLeadDistributionAuthorizationFacts;
const evaluate = P.evaluateDistributionAuthorizationPolicy;
const evaluateSafely = P.evaluateDistributionAuthorizationPolicySafely;
const fingerprint = P.computePolicyConfigFingerprint;

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

// --- fixtures ---------------------------------------------------------------
function config(o = {}) {
  const base = {
    policyVersion: VERSION,
    mode: MODE.GUARDED_AUTO_AUTHORIZE,
    enabled: true,
    minimumAutoAuthorizeScore: 90,
    allowedAutoAuthorizeScoreClasses: ["A+"],
    requireNoHardBlock: true,
    requiredRecommendedAction: "auto_distribute",
    minimumRecommendationCount: 1,
    maximumRecommendationCount: 3,
  };
  return { ...base, ...o };
}
function facts(o = {}) {
  return {
    policyKey: KEY.LEAD_DISTRIBUTION_AUTHORIZATION,
    workflowType: "qf_lead_lifecycle",
    workflowInstanceId: "wf_std_1",
    leadId: "lead_std_1",
    currentLifecycleState: "MATCH_RECOMMENDATION_READY",
    routeClassification: ROUTE.STANDARD,
    quality: {
      scoreClass: "A+",
      totalScore: 95,
      hardBlockReason: null,
      recommendedAction: "auto_distribute",
      ...(o.quality ?? {}),
    },
    recommendation: {
      recommendationEventId: "evt_match_1",
      recommendedVendorCount: 2,
      recommendedVendorIds: ["vA", "vB"],
      ...(o.recommendation ?? {}),
    },
    ...stripSub(o),
  };
}
function stripSub(o) {
  const { quality, recommendation, ...rest } = o;
  return rest;
}
function without(obj, field) {
  const clone = JSON.parse(JSON.stringify(obj));
  delete clone[field];
  return clone;
}

// walk a plain object tree, invoking cb("key"|"value", value, path).
function walk(obj, cb, path = "") {
  if (Array.isArray(obj)) obj.forEach((v, i) => walk(v, cb, `${path}[${i}]`));
  else if (obj && typeof obj === "object") {
    for (const k of Object.keys(obj)) { cb("key", k, path); walk(obj[k], cb, `${path}.${k}`); }
  } else cb("value", obj, path);
}

// ==========================================================================
// POLICY CONFIG
// ==========================================================================
check("1. safe default is human_approval_only", () =>
  assert(SAFE_DEFAULT.mode === MODE.HUMAN_APPROVAL_ONLY, `got ${SAFE_DEFAULT.mode}`));
check("2. safe default enabled=false", () =>
  assert(SAFE_DEFAULT.enabled === false, "safe default must be disabled"));
check("3. unknown mode rejected", () =>
  assert(!validateConfig(config({ mode: "turbo_mode" })).ok, "unknown mode must reject"));
check("4. negative minimum score rejected", () =>
  assert(!validateConfig(config({ minimumAutoAuthorizeScore: -1 })).ok, "negative score must reject"));
check("5. score >100 rejected", () =>
  assert(!validateConfig(config({ minimumAutoAuthorizeScore: 101 })).ok, "score>100 must reject"));
check("6. empty allowed class list rejected", () =>
  assert(!validateConfig(config({ allowedAutoAuthorizeScoreClasses: [] })).ok, "empty allowed list must reject"));
check("7. unknown quality class rejected", () =>
  assert(!validateConfig(config({ allowedAutoAuthorizeScoreClasses: ["Z"] })).ok, "unknown class must reject"));
check("8. minimum recommendation count <0 rejected", () =>
  assert(!validateConfig(config({ minimumRecommendationCount: -1 })).ok, "min<0 must reject"));
check("9. maximum recommendation count >3 rejected", () =>
  assert(!validateConfig(config({ maximumRecommendationCount: 4 })).ok, "max>3 must reject"));
check("10. minimum > maximum rejected", () =>
  assert(!validateConfig(config({ minimumRecommendationCount: 3, maximumRecommendationCount: 2 })).ok, "min>max must reject"));
check("11. unknown required action rejected", () =>
  assert(!validateConfig(config({ requiredRecommendedAction: "frobnicate" })).ok, "unknown action must reject"));
check("12. valid guarded config accepted", () => {
  const r = validateConfig(config());
  assert(r.ok && r.value.mode === MODE.GUARDED_AUTO_AUTHORIZE && Object.isFrozen(r.value), "valid guarded config rejected");
});

// ==========================================================================
// FACT VALIDATION
// ==========================================================================
check("13. valid standard facts accepted", () => {
  const r = validateFacts(facts());
  assert(r.ok && Object.isFrozen(r.value) && r.value.recommendation.recommendedVendorCount === 2, "valid facts rejected");
});
check("14. missing workflow type rejected", () =>
  assert(!validateFacts(without(facts(), "workflowType")).ok, "missing workflowType must reject"));
check("15. missing workflow id rejected", () =>
  assert(!validateFacts(without(facts(), "workflowInstanceId")).ok, "missing workflowInstanceId must reject"));
check("16. missing lead id rejected", () =>
  assert(!validateFacts(without(facts(), "leadId")).ok, "missing leadId must reject"));
check("17. missing lifecycle state rejected", () =>
  assert(!validateFacts(without(facts(), "currentLifecycleState")).ok, "missing lifecycle state must reject"));
check("18. unknown route rejected", () =>
  assert(!validateFacts(facts({ routeClassification: "mystery_route" })).ok, "unknown route must reject"));
check("19. score below 0 rejected", () =>
  assert(!validateFacts(facts({ quality: { totalScore: -1 } })).ok, "score<0 must reject"));
check("20. score above 100 rejected", () =>
  assert(!validateFacts(facts({ quality: { totalScore: 101 } })).ok, "score>100 must reject"));
check("21. NaN score rejected", () =>
  assert(!validateFacts(facts({ quality: { totalScore: NaN } })).ok, "NaN score must reject"));
check("22. unknown score class rejected", () =>
  assert(!validateFacts(facts({ quality: { scoreClass: "Z" } })).ok, "unknown class must reject"));
check("23. unknown recommended action rejected", () =>
  assert(!validateFacts(facts({ quality: { recommendedAction: "frob" } })).ok, "unknown action must reject"));
check("24. missing recommendation event id rejected", () =>
  assert(!validateFacts(facts({ recommendation: { recommendationEventId: "", recommendedVendorCount: 1, recommendedVendorIds: ["vA"] } })).ok, "missing event id must reject"));
check("25. recommendation count >3 rejected", () =>
  assert(!validateFacts(facts({ recommendation: { recommendationEventId: "e", recommendedVendorCount: 4, recommendedVendorIds: ["vA", "vB", "vC", "vD"] } })).ok, "count>3 must reject"));
check("26. count/list mismatch rejected", () =>
  assert(!validateFacts(facts({ recommendation: { recommendationEventId: "e", recommendedVendorCount: 3, recommendedVendorIds: ["vA", "vB"] } })).ok, "count/list mismatch must reject"));
check("27. duplicate vendor IDs rejected", () =>
  assert(!validateFacts(facts({ recommendation: { recommendationEventId: "e", recommendedVendorCount: 2, recommendedVendorIds: ["vA", "vA"] } })).ok, "duplicate ids must reject"));
check("28. blank vendor ID rejected", () =>
  assert(!validateFacts(facts({ recommendation: { recommendationEventId: "e", recommendedVendorCount: 2, recommendedVendorIds: ["vA", "  "] } })).ok, "blank id must reject"));

// ==========================================================================
// DECISION PRECEDENCE
// ==========================================================================
check("29. preferred route -> defer_special_route", () => {
  const r = evaluate(facts({ routeClassification: ROUTE.PREFERRED_VENDOR }), config());
  assert(r.decision === DECISION.DEFER_SPECIAL_ROUTE && r.reasonCode === REASON.SPECIAL_ROUTE_OWNED_ELSEWHERE, `got ${r.decision}/${r.reasonCode}`);
});
check("30. client-selected route -> defer_special_route", () => {
  const r = evaluate(facts({ routeClassification: ROUTE.CLIENT_SELECTED }), config());
  assert(r.decision === DECISION.DEFER_SPECIAL_ROUTE && r.reasonCode === REASON.SPECIAL_ROUTE_OWNED_ELSEWHERE, `got ${r.decision}`);
});
check("31. requirement-group route -> defer_special_route", () => {
  const r = evaluate(facts({ routeClassification: ROUTE.REQUIREMENT_GROUP }), config());
  assert(r.decision === DECISION.DEFER_SPECIAL_ROUTE && r.reasonCode === REASON.SPECIAL_ROUTE_OWNED_ELSEWHERE, `got ${r.decision}`);
});
check("32. zero recommendation -> manual_review", () => {
  const r = evaluate(facts({ recommendation: { recommendationEventId: "evt_match_1", recommendedVendorCount: 0, recommendedVendorIds: [] } }), config());
  assert(r.decision === DECISION.MANUAL_REVIEW && r.reasonCode === REASON.NO_DISTRIBUTION_RECOMMENDATIONS, `got ${r.decision}/${r.reasonCode}`);
});
check("32b. malformed recommendation snapshot -> manual_review (distinct reason)", () => {
  const r = evaluate(facts({ recommendation: { recommendationEventId: "evt_match_1", recommendedVendorCount: 2, recommendedVendorIds: ["vA"] } }), config());
  assert(r.decision === DECISION.MANUAL_REVIEW && r.reasonCode === REASON.RECOMMENDATION_SNAPSHOT_INVALID, `got ${r.decision}/${r.reasonCode}`);
});
check("33. invalid config -> human approval fail-closed", () => {
  const r = evaluate(facts(), config({ mode: "not_a_mode" }));
  assert(r.decision === DECISION.REQUIRE_HUMAN_APPROVAL && r.reasonCode === REASON.POLICY_CONFIG_INVALID_FAIL_CLOSED, `got ${r.decision}/${r.reasonCode}`);
});
check("34. disabled policy -> human approval", () => {
  const r = evaluate(facts(), config({ enabled: false }));
  assert(r.decision === DECISION.REQUIRE_HUMAN_APPROVAL && r.reasonCode === REASON.AUTOMATION_POLICY_DISABLED, `got ${r.decision}/${r.reasonCode}`);
});
check("35. human approval mode -> human approval", () => {
  const r = evaluate(facts(), config({ mode: MODE.HUMAN_APPROVAL_ONLY, enabled: true }));
  assert(r.decision === DECISION.REQUIRE_HUMAN_APPROVAL && r.reasonCode === REASON.HUMAN_APPROVAL_MODE, `got ${r.decision}/${r.reasonCode}`);
});
check("36. manual review mode -> manual review", () => {
  const r = evaluate(facts(), config({ mode: MODE.MANUAL_REVIEW_ONLY, enabled: true }));
  assert(r.decision === DECISION.MANUAL_REVIEW && r.reasonCode === REASON.MANUAL_REVIEW_MODE, `got ${r.decision}/${r.reasonCode}`);
});
check("36b. safe default (disabled, human_approval_only) -> human approval", () => {
  const r = evaluate(facts(), SAFE_DEFAULT);
  assert(r.decision === DECISION.REQUIRE_HUMAN_APPROVAL && r.reasonCode === REASON.AUTOMATION_POLICY_DISABLED, `got ${r.decision}/${r.reasonCode}`);
});

// ==========================================================================
// GUARDED AUTO AUTHORIZATION
// ==========================================================================
check("37. all gates pass -> auto_authorize", () => {
  const r = evaluate(facts(), config());
  assert(r.decision === DECISION.AUTO_AUTHORIZE && r.reasonCode === REASON.GUARDED_AUTO_AUTHORIZATION_ELIGIBLE && r.failedGates.length === 0, `got ${r.decision}/${r.reasonCode}`);
});
check("38. score below threshold -> human approval", () => {
  const r = evaluate(facts({ quality: { scoreClass: "A+", totalScore: 85, hardBlockReason: null, recommendedAction: "auto_distribute" } }), config());
  assert(r.decision === DECISION.REQUIRE_HUMAN_APPROVAL && r.reasonCode === REASON.QUALITY_SCORE_BELOW_POLICY_THRESHOLD, `got ${r.decision}/${r.reasonCode}`);
});
check("39. class not allowed -> human approval", () => {
  const r = evaluate(
    facts({ quality: { scoreClass: "A", totalScore: 78, hardBlockReason: null, recommendedAction: "auto_distribute" } }),
    config({ minimumAutoAuthorizeScore: 70, allowedAutoAuthorizeScoreClasses: ["A+"] }),
  );
  assert(r.decision === DECISION.REQUIRE_HUMAN_APPROVAL && r.reasonCode === REASON.QUALITY_CLASS_NOT_ALLOWED, `got ${r.decision}/${r.reasonCode}`);
});
check("40. hard block present -> human approval", () => {
  const r = evaluate(facts({ quality: { scoreClass: "A+", totalScore: 95, hardBlockReason: "duplicate_lead", recommendedAction: "auto_distribute" } }), config());
  assert(r.decision === DECISION.REQUIRE_HUMAN_APPROVAL && r.reasonCode === REASON.QUALITY_HARD_BLOCK_PRESENT, `got ${r.decision}/${r.reasonCode}`);
});
check("41. wrong recommended action -> human approval", () => {
  const r = evaluate(facts({ quality: { scoreClass: "A+", totalScore: 95, hardBlockReason: null, recommendedAction: "clarification_required" } }), config());
  assert(r.decision === DECISION.REQUIRE_HUMAN_APPROVAL && r.reasonCode === REASON.QUALITY_RECOMMENDED_ACTION_NOT_ALLOWED, `got ${r.decision}/${r.reasonCode}`);
});
check("42. recommendation below configured minimum -> human approval", () => {
  const r = evaluate(
    facts({ recommendation: { recommendationEventId: "evt_match_1", recommendedVendorCount: 1, recommendedVendorIds: ["vA"] } }),
    config({ minimumRecommendationCount: 3, maximumRecommendationCount: 3 }),
  );
  assert(r.decision === DECISION.REQUIRE_HUMAN_APPROVAL && r.reasonCode === REASON.RECOMMENDATION_COUNT_BELOW_POLICY_MINIMUM, `got ${r.decision}/${r.reasonCode}`);
});
check("43. recommendation above configured maximum -> human approval", () => {
  const r = evaluate(facts(), config({ minimumRecommendationCount: 1, maximumRecommendationCount: 1 }));
  assert(r.decision === DECISION.REQUIRE_HUMAN_APPROVAL && r.reasonCode === REASON.RECOMMENDATION_COUNT_ABOVE_POLICY_MAXIMUM, `got ${r.decision}/${r.reasonCode}`);
});
check("44. A+ allowed + score threshold passes -> auto authorize", () => {
  const r = evaluate(
    facts({ quality: { scoreClass: "A+", totalScore: 95, hardBlockReason: null, recommendedAction: "auto_distribute" } }),
    config({ allowedAutoAuthorizeScoreClasses: ["A+"], minimumAutoAuthorizeScore: 90 }),
  );
  assert(r.decision === DECISION.AUTO_AUTHORIZE, `got ${r.decision}/${r.reasonCode}`);
});
check("45. A allowed only when config explicitly allows it", () => {
  const aFacts = facts({ quality: { scoreClass: "A", totalScore: 78, hardBlockReason: null, recommendedAction: "auto_distribute" } });
  const denied = evaluate(aFacts, config({ minimumAutoAuthorizeScore: 70, allowedAutoAuthorizeScoreClasses: ["A+"] }));
  const allowed = evaluate(aFacts, config({ minimumAutoAuthorizeScore: 70, allowedAutoAuthorizeScoreClasses: ["A", "A+"] }));
  assert(denied.decision === DECISION.REQUIRE_HUMAN_APPROVAL && denied.reasonCode === REASON.QUALITY_CLASS_NOT_ALLOWED, `A must be denied by default: ${denied.reasonCode}`);
  assert(allowed.decision === DECISION.AUTO_AUTHORIZE, `A must auto-authorize when allowed: ${allowed.reasonCode}`);
});

// ==========================================================================
// DETERMINISM
// ==========================================================================
check("46. same facts + config -> identical decision", () => {
  const a = evaluate(facts(), config());
  const b = evaluate(facts(), config());
  assert(JSON.stringify(a) === JSON.stringify(b), "decision not deterministic");
});
check("47. same semantic config -> same fingerprint", () => {
  const a = fingerprint(config({ allowedAutoAuthorizeScoreClasses: ["A+", "A"] }));
  const b = fingerprint({
    maximumRecommendationCount: 3, minimumRecommendationCount: 1,
    requiredRecommendedAction: "auto_distribute", requireNoHardBlock: true,
    allowedAutoAuthorizeScoreClasses: ["A", "A+"], minimumAutoAuthorizeScore: 90,
    enabled: true, mode: MODE.GUARDED_AUTO_AUTHORIZE, policyVersion: VERSION,
  });
  assert(a === b, "reordered semantic config must share a fingerprint");
});
check("48. changed threshold -> different fingerprint", () =>
  assert(fingerprint(config({ minimumAutoAuthorizeScore: 90 })) !== fingerprint(config({ minimumAutoAuthorizeScore: 80 })), "threshold change must change fingerprint"));
check("49. changed mode -> different fingerprint", () =>
  assert(fingerprint(config({ mode: MODE.GUARDED_AUTO_AUTHORIZE })) !== fingerprint(config({ mode: MODE.HUMAN_APPROVAL_ONLY })), "mode change must change fingerprint"));
check("50. array ordering policy deterministic (auto_authorize passedGates in order)", () => {
  const a = evaluate(facts(), config());
  const b = evaluate(facts(), config());
  const expected = [
    GATE.FACTS_VALID, GATE.STANDARD_ROUTE, GATE.RECOMMENDATION_SNAPSHOT_VALID, GATE.RECOMMENDATIONS_PRESENT,
    GATE.POLICY_CONFIG_VALID, GATE.POLICY_ENABLED, GATE.GUARDED_AUTO_AUTHORIZE_MODE, GATE.MINIMUM_AUTO_AUTHORIZE_SCORE,
    GATE.ALLOWED_AUTO_AUTHORIZE_SCORE_CLASS, GATE.NO_HARD_BLOCK, GATE.REQUIRED_RECOMMENDED_ACTION,
    GATE.RECOMMENDATION_WITHIN_MINIMUM_BOUND, GATE.RECOMMENDATION_WITHIN_MAXIMUM_BOUND,
  ];
  assert(a.passedGates.join(",") === expected.join(","), "passedGates not in documented order");
  assert(a.passedGates.join(",") === b.passedGates.join(","), "passedGates not deterministic");
});
check("51. no timestamp in result", () => {
  const r = evaluate(facts(), config());
  walk(r, (kind, value) => {
    if (kind === "key") assert(!/timestamp|_at$|(^|_)time($|_)|datetime/i.test(value), `timestamp-like key: ${value}`);
    if (kind === "value" && typeof value === "string") assert(!/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/i.test(value), `ISO datetime value: ${value}`);
  });
});
check("52. no random id in result", () => {
  const r = evaluate(facts(), config());
  walk(r, (kind, value) => {
    if (kind === "key") assert(!/uuid|random|nonce/i.test(value), `random-like key: ${value}`);
    if (kind === "value" && typeof value === "string") assert(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(value), `uuid value: ${value}`);
  });
});
check("53. no worker id in result", () => {
  const r = evaluate(facts(), config());
  walk(r, (kind, value) => {
    if (kind === "key") assert(!/worker|hostname|host_id|(^|_)pid($|_)|attempt/i.test(value), `worker-like key: ${value}`);
  });
});
check("54. result object frozen", () => {
  const r = evaluate(facts(), config());
  assert(Object.isFrozen(r) && Object.isFrozen(r.passedGates) && Object.isFrozen(r.failedGates) && Object.isFrozen(r.evaluatedFactsSummary), "result not deeply frozen");
});
check("55. passed gates deterministic", () => {
  const a = evaluate(facts({ quality: { scoreClass: "A+", totalScore: 85, hardBlockReason: null, recommendedAction: "auto_distribute" } }), config());
  const b = evaluate(facts({ quality: { scoreClass: "A+", totalScore: 85, hardBlockReason: null, recommendedAction: "auto_distribute" } }), config());
  assert(a.passedGates.join(",") === b.passedGates.join(","), "passedGates not deterministic");
});
check("56. failed gates deterministic", () => {
  const a = evaluate(facts({ quality: { scoreClass: "A+", totalScore: 85, hardBlockReason: null, recommendedAction: "auto_distribute" } }), config());
  const b = evaluate(facts({ quality: { scoreClass: "A+", totalScore: 85, hardBlockReason: null, recommendedAction: "auto_distribute" } }), config());
  assert(a.failedGates.length === 1 && a.failedGates[0] === GATE.MINIMUM_AUTO_AUTHORIZE_SCORE, `unexpected failedGates ${a.failedGates}`);
  assert(a.failedGates.join(",") === b.failedGates.join(","), "failedGates not deterministic");
});

// ==========================================================================
// REGISTRY
// ==========================================================================
check("57. known policy resolves", () => {
  const evaluator = P.resolvePolicyEvaluator(KEY.LEAD_DISTRIBUTION_AUTHORIZATION);
  assert(typeof evaluator === "function", "known key must resolve to a function");
  const r = evaluator(facts(), config());
  assert(r.decision === DECISION.AUTO_AUTHORIZE, "resolved evaluator produced wrong decision");
});
check("58. unknown policy rejected", () => {
  let threw = false;
  try { P.resolvePolicyEvaluator("no_such_policy"); } catch (e) { threw = /UNKNOWN_AUTOMATION_POLICY_KEY/.test(String(e?.message ?? e)); }
  assert(threw, "unknown key must throw");
});
check("59. registry has exactly expected Phase 4A policy scope", () => {
  const keys = P.listRegisteredPolicyKeys();
  assert(keys.length === 1 && keys[0] === KEY.LEAD_DISTRIBUTION_AUTHORIZATION, `unexpected registry scope: ${keys.join(",")}`);
});

// ==========================================================================
// SECURITY / SIDE EFFECTS (static scans + workspace guards)
// ==========================================================================
const policyFiles = [
  "lib/aos/policy/policyTypes.ts",
  "lib/aos/policy/policyDecisionReasons.ts",
  "lib/aos/policy/policyConfig.ts",
  "lib/aos/policy/policyValidation.ts",
  "lib/aos/policy/policyFingerprint.ts",
  "lib/aos/policy/distributionAuthorizationPolicy.ts",
  "lib/aos/policy/policyRegistry.ts",
  "lib/aos/policy/index.ts",
];
// Strip comments before scanning: the guards target actual CODE (imports, calls,
// side effects), never documentation prose. The PII-exclusion comments legitimately
// name fields like "WhatsApp number" / "phone" / "address" as things the contract
// must never carry, and those must not be misread as integration usage.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}
const policySource = stripComments(
  policyFiles.map((f) => readFileSync(f, "utf8")).join("\n"),
);

check("60. no Supabase client import in policy engine", () =>
  assert(!/supabase|adminClient|createClient/i.test(policySource), "Supabase client reference found"));
check("61. no domain_events write", () =>
  assert(!/domain_events/i.test(policySource), "domain_events reference found"));
check("62. no workflow_transition_history write", () =>
  assert(!/workflow_transition_history/i.test(policySource), "workflow_transition_history reference found"));
check("63. no assignment service call", () =>
  assert(!/assignLeadToMatchedVendors|assignApprovedVendors|deliverLeadToVendorDashboard|recordClientSelectedVendor/.test(policySource), "assignment service call found"));
check("64. no matching call", () =>
  assert(!/runAutoLeadMatchingForLead|getEligibleVendorsForLead|evaluateVendorsForLead|prepareRecommendations/.test(policySource), "matching call found"));
check("65. no quality scoring call", () =>
  assert(!/calculateLeadQuality\s*\(|scoreAndStoreLead\s*\(|getLeadQualityDecision\s*\(|canAutoDistributeLead\s*\(/.test(policySource), "quality scoring call found"));
check("66. no WhatsApp", () =>
  assert(!/whatsapp/i.test(policySource), "WhatsApp reference found"));
check("67. no n8n", () =>
  assert(!/n8n/i.test(policySource), "n8n reference found"));
check("68. no fetch/webhook", () =>
  assert(!/\bfetch\s*\(|webhook/i.test(policySource), "fetch/webhook found"));
check("69. no outbox execution", () =>
  assert(!/outboxCommands|outbox_events|command_type/i.test(policySource), "outbox command found"));
check("70. no worker", () =>
  assert(!/setInterval|while\s*\(\s*true\s*\)|claimOneDueWorkflowTask\s*\(/.test(policySource), "worker loop found"));
check("71. no PM2 modification", () =>
  assert(!gitPorcelain().some((f) => /pm2|ecosystem/i.test(f)), "PM2 file changed"));
check("72. no unexpected migration created or changed", () => {
  const unexpected = gitPorcelain(["supabase/migrations", "db"]).filter(
    (line) => !line.includes("20260706000150_automation_policy_config_foundation.sql"),
  );
  assert(unexpected.length === 0, `unexpected migration changed/created: ${unexpected.join(", ")}`);
});
check("73. no UI change", () =>
  assert(gitPorcelain(["app", "components", "public"]).length === 0, "UI files changed"));
check("74. protected services unchanged", () => {
  const protectedPaths = [
    "services/leadService.ts", "services/leadQualityService.ts", "services/leadClarificationService.ts",
    "services/leadMatchingEngine.ts", "services/leadDeliveryService.ts", "services/preferredVendorLeadService.ts",
    "services/delayedLeadFillService.ts", "services/clientRequirementGroupService.ts", "services/vendorService.ts",
    "services/aosService.ts", "lib/lead-assignment/runtimeSettings.ts",
  ];
  assert(gitPorcelain(protectedPaths).length === 0, "a protected service/runtimeSettings changed");
});

// ==========================================================================
// REGRESSION AVAILABILITY
// ==========================================================================
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
check("75. Phase 1A test available", () =>
  assert(existsSync("scripts/phase1a-workflow-foundation-verify.mjs") && pkg.scripts["test:phase1a"], "phase1a missing"));
check("76. Phase 1B test available", () =>
  assert(existsSync("scripts/phase1b-workflow-kernel-harness.mjs") && pkg.scripts["test:phase1b"], "phase1b missing"));
check("77. Phase 2A test available", () =>
  assert(existsSync("scripts/phase2a-lead-lifecycle-harness.mjs") && pkg.scripts["test:phase2a"], "phase2a missing"));
check("78. Phase 2B test available", () =>
  assert(existsSync("scripts/phase2b-lead-orchestration-adapter-harness.mjs") && pkg.scripts["test:phase2b"], "phase2b missing"));
check("79. Phase 3A test available", () =>
  assert(existsSync("scripts/phase3a-distribution-control-harness.mjs") && pkg.scripts["test:phase3a"], "phase3a missing"));
check("80. Phase 3A diagnostics available", () =>
  assert(existsSync("scripts/phase3a-diagnostics-harness.ts") && pkg.scripts["test:phase3a:diagnostics"], "phase3a diagnostics missing"));
check("81. Phase 3B AOS test available", () =>
  assert(existsSync("scripts/phase3b-assignment-execution-harness.mjs") && pkg.scripts["test:phase3b:aos"], "phase3b aos missing"));
check("82. historical Phase 3B test available", () =>
  assert(existsSync("scripts/phase3b-recovery-harness.ts") && pkg.scripts["test:phase3b"], "historical phase3b missing"));

// ==========================================================================
// EXTRA BEHAVIORAL COVERAGE
// ==========================================================================
check("83. PII-free evaluated facts summary", () => {
  const r = evaluate(facts(), config());
  walk(r.evaluatedFactsSummary, (kind, value) => {
    if (kind === "key") assert(!/name|phone|email|whatsapp|address|budget|gps|latitude|longitude|\blat\b|\blng\b/i.test(value), `PII-looking key in summary: ${value}`);
  });
  assert(r.evaluatedFactsSummary.hardBlockReasonPresent === false, "summary must expose hard-block as a boolean");
});
check("84. every recommended action fails closed or authorizes (never throws)", () => {
  for (const action of P.KNOWN_RECOMMENDED_ACTIONS) {
    const r = evaluateSafely(facts({ quality: { scoreClass: "A+", totalScore: 95, hardBlockReason: null, recommendedAction: action } }), config());
    assert(Object.values(DECISION).includes(r.decision), `action ${action} produced invalid decision ${r.decision}`);
    if (action !== "auto_distribute") {
      assert(r.decision !== DECISION.AUTO_AUTHORIZE, `non-auto_distribute action ${action} must not auto-authorize`);
    }
  }
});
check("85. safe wrapper never throws on garbage input (fails closed)", () => {
  for (const [f, c] of [[null, null], [undefined, {}], [42, "x"], [{}, { mode: "bad" }]]) {
    const r = evaluateSafely(f, c);
    assert(r.decision === DECISION.REQUIRE_HUMAN_APPROVAL || r.decision === DECISION.MANUAL_REVIEW, `garbage input must fail closed, got ${r.decision}`);
    assert(r.decision !== DECISION.AUTO_AUTHORIZE, "garbage input must never auto-authorize");
  }
});
check("86. result carries stable policy version + fingerprint", () => {
  const r = evaluate(facts(), config());
  assert(r.policyVersion === VERSION && r.policyKey === KEY.LEAD_DISTRIBUTION_AUTHORIZATION, "version/key mismatch");
  assert(typeof r.policyFingerprint === "string" && /^[0-9a-f]{64}$/.test(r.policyFingerprint), "fingerprint must be a sha256 hex");
});
check("87. Phase 4A doc exists", () =>
  assert(existsSync("docs/aos/QF-Automation-Policy-Engine-Phase-4A.md"), "Phase 4A doc missing"));
check("88. test:phase4a wired to this harness", () =>
  assert(pkg.scripts["test:phase4a"] === "node scripts/phase4a-policy-engine-harness.mjs", "test:phase4a not wired"));

// ==========================================================================
// POLICY VERSION BINDING (correction)
// ==========================================================================
const V2 = "lead_distribution_authorization_v2";
const V99 = "lead_distribution_authorization_v99";

check("89. exact v1 accepted", () => {
  const r = validateConfig(config({ policyVersion: VERSION }));
  assert(r.ok && r.value.policyVersion === "lead_distribution_authorization_v1", "exact v1 must be accepted");
});
check("90. missing version rejected", () =>
  assert(!validateConfig(without(config(), "policyVersion")).ok, "missing version must reject"));
check("91. blank version rejected", () =>
  assert(!validateConfig(config({ policyVersion: "" })).ok, "blank version must reject"));
check("92. null version rejected", () =>
  assert(!validateConfig(config({ policyVersion: null })).ok, "null version must reject"));
check("93. non-string version rejected", () => {
  assert(!validateConfig(config({ policyVersion: 123 })).ok, "numeric version must reject");
  assert(!validateConfig(config({ policyVersion: undefined })).ok, "undefined version must reject");
});
check("94. v2 (lead_distribution_authorization_v2) rejected", () =>
  assert(!validateConfig(config({ policyVersion: V2 })).ok, "v2 must reject"));
check("95. v99 rejected", () =>
  assert(!validateConfig(config({ policyVersion: V99 })).ok, "v99 must reject"));
check("96. unknown / bare 'v2' rejected", () => {
  assert(!validateConfig(config({ policyVersion: "unknown" })).ok, "unknown must reject");
  assert(!validateConfig(config({ policyVersion: "v2" })).ok, "bare v2 must reject");
});
check("97. unsupported guarded-auto config fails closed", () => {
  const r = evaluate(facts(), config({ policyVersion: V2, mode: MODE.GUARDED_AUTO_AUTHORIZE, enabled: true }));
  assert(r.decision === DECISION.REQUIRE_HUMAN_APPROVAL, `expected human approval, got ${r.decision}`);
  assert(r.failedGates.length === 1 && r.failedGates[0] === GATE.POLICY_CONFIG_VALID, `unexpected failedGates ${r.failedGates}`);
});
check("98. unsupported guarded-auto config never auto-authorizes", () => {
  const cfg = config({ policyVersion: V2, mode: MODE.GUARDED_AUTO_AUTHORIZE, enabled: true });
  const direct = evaluate(facts(), cfg);
  const safe = evaluateSafely(facts(), cfg);
  const viaRegistry = P.resolvePolicyEvaluator(KEY.LEAD_DISTRIBUTION_AUTHORIZATION)(facts(), cfg);
  assert(direct.decision !== DECISION.AUTO_AUTHORIZE, "direct must not auto-authorize");
  assert(safe.decision !== DECISION.AUTO_AUTHORIZE, "safe must not auto-authorize");
  assert(viaRegistry.decision !== DECISION.AUTO_AUTHORIZE, "registry must not auto-authorize");
});
check("99. fail-closed reason is policy_config_invalid_fail_closed", () => {
  const r = evaluate(facts(), config({ policyVersion: V2, mode: MODE.GUARDED_AUTO_AUTHORIZE, enabled: true }));
  assert(r.reasonCode === REASON.POLICY_CONFIG_INVALID_FAIL_CLOSED, `got ${r.reasonCode}`);
});
check("100. v1 and v2 fingerprints differ, and v2 still fails closed", () => {
  const fpV1 = fingerprint(config({ policyVersion: VERSION }));
  const fpV2 = fingerprint(config({ policyVersion: V2 }));
  assert(fpV1 !== fpV2, "v1 and v2 fingerprints must differ");
  const r = evaluate(facts(), config({ policyVersion: V2, mode: MODE.GUARDED_AUTO_AUTHORIZE, enabled: true }));
  assert(r.decision === DECISION.REQUIRE_HUMAN_APPROVAL && r.reasonCode === REASON.POLICY_CONFIG_INVALID_FAIL_CLOSED, "v2 must fail closed despite distinct fingerprint");
});
check("101. v1 result reports evaluator v1", () => {
  const r = evaluate(facts(), config({ policyVersion: VERSION }));
  assert(r.policyVersion === "lead_distribution_authorization_v1", `got ${r.policyVersion}`);
});
check("102. invalid v2 fail-closed result still reports evaluator v1 (no echo)", () => {
  const r = evaluate(facts(), config({ policyVersion: V2, mode: MODE.GUARDED_AUTO_AUTHORIZE, enabled: true }));
  assert(r.policyVersion === "lead_distribution_authorization_v1", `must report evaluator v1, got ${r.policyVersion}`);
  assert(r.policyVersion !== V2, "must not echo unsupported config version into the result");
});
check("103. same v1 facts + config remain deterministic", () => {
  const a = evaluate(facts(), config());
  const b = evaluate(facts(), config());
  assert(JSON.stringify(a) === JSON.stringify(b), "v1 evaluation must stay deterministic");
});

function gitPorcelain(paths = []) {
  const output = execFileSync("git", ["status", "--porcelain", "--", ...paths], { encoding: "utf8" });
  return output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

const results = [];
for (const { name, fn } of checks) {
  try { await fn(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, error }); }
}
for (const item of results) {
  console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
  if (!item.ok) console.error(item.error);
}

rmSync(outDir, { recursive: true, force: true });

const failures = results.filter((item) => !item.ok);
if (failures.length > 0) {
  console.error(`\n${failures.length} Phase 4A policy-engine harness check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${results.length} Phase 4A policy-engine checks passed.`);
