import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

/**
 * Phase 4B-2 — QuickFurno Lifecycle Decision Integration & Unified Authorization
 * Execution harness.
 *
 * SOURCE/STATIC harness. Compiles the lifecycle + policy modules to a throwaway
 * CommonJS build and exercises: the new policy-evaluation task, task mapping,
 * PII-free fact building, durable config loading, decision mapping, retry-stable
 * result pre-read/replay, the unified authorization snapshot in the assignment
 * task, route-change handling, the neutral completed contract, and the PII-free
 * policy audit. NO DB, NO real event publish, NO assignment, NO credit math, NO
 * matching rerun, NO WhatsApp, NO n8n, NO outbox, NO worker.
 */

const outDir = resolve(".phase4b2-test-build");
rmSync(outDir, { recursive: true, force: true });

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const files = [
  "lib/lead-quality/budgetFit.ts",
  "lib/supabase.ts",
  "services/leadQualityService.ts",
  "lib/aos/workflow/workflowPersistenceTypes.ts",
  "lib/aos/workflows/leadLifecycle/leadLifecycleStates.ts",
  "lib/aos/workflows/leadLifecycle/leadLifecycleEvents.ts",
  "lib/aos/workflows/leadLifecycle/leadLifecycleTypes.ts",
  "lib/aos/workflows/leadLifecycle/leadLifecycleValidation.ts",
  "lib/aos/workflows/leadLifecycle/leadLifecycleTaskIntents.ts",
  "lib/aos/workflows/leadLifecycle/leadLifecycleHandler.ts",
  "lib/aos/workflows/leadLifecycle/adapters/leadLifecycleServicePorts.ts",
  "lib/aos/workflows/leadLifecycle/events/leadLifecycleResultMapper.ts",
  "lib/aos/workflows/leadLifecycle/events/leadLifecycleEventPublisher.ts",
  "lib/aos/workflows/leadLifecycle/execution/leadLifecycleTaskExecutionTypes.ts",
  "lib/aos/workflows/leadLifecycle/execution/leadLifecycleTaskExecutor.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionTypes.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionValidation.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionRecommendationResolver.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionRouteGuard.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionApprovedSnapshotResolver.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAuthorizationSnapshotResolver.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAutoAuthorizationValidation.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionPolicyAudit.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionPolicyEvaluationExecutor.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAssignmentTypes.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAssignmentValidation.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAssignmentResultMapper.ts",
  "lib/aos/policy/policyTypes.ts",
  "lib/aos/policy/policyDecisionReasons.ts",
  "lib/aos/policy/policyConfig.ts",
  "lib/aos/policy/policyValidation.ts",
  "lib/aos/policy/policyFingerprint.ts",
  "lib/aos/policy/distributionAuthorizationPolicy.ts",
  "lib/aos/policy/policyRegistry.ts",
  "lib/aos/policy/index.ts",
  "lib/aos/policy/runtime/policyConfigStoreTypes.ts",
  "lib/aos/policy/runtime/policyConfigStoreValidation.ts",
  "lib/aos/policy/runtime/policyConfigStoreAdapter.ts",
];

const tsconfigPath = resolve(".phase4b2-tsconfig.json");
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

function writeAliasProxy(aliasPath, targetPath) {
  const proxy = resolve(outDir, `node_modules/@/${aliasPath}.js`);
  mkdirSync(dirname(proxy), { recursive: true });
  writeFileSync(proxy, `module.exports = require('${targetPath}');\n`);
}
writeAliasProxy("lib/lead-quality/budgetFit", "../../../../lib/lead-quality/budgetFit.js");
writeAliasProxy("lib/lead-quality/clarificationPresets", "../../../../lib/lead-quality/clarificationPresets.js");
writeAliasProxy("lib/quickfurno-data", "../../../lib/quickfurno-data.js");
writeAliasProxy("lib/config", "../../../lib/config.js");
writeAliasProxy("lib/categories", "../../../lib/categories.js");

const requireFromBuild = createRequire(`${outDir}/`);
const D = "./lib/aos/workflows/leadLifecycle";
const states = requireFromBuild(`${D}/leadLifecycleStates.js`);
const events = requireFromBuild(`${D}/leadLifecycleEvents.js`);
const tasks = requireFromBuild(`${D}/leadLifecycleTaskIntents.js`);
const handlerMod = requireFromBuild(`${D}/leadLifecycleHandler.js`);
const executorMod = requireFromBuild(`${D}/execution/leadLifecycleTaskExecutor.js`);
const publisherMod = requireFromBuild(`${D}/events/leadLifecycleEventPublisher.js`);
const validationMod = requireFromBuild(`${D}/distribution/leadDistributionValidation.js`);
const autoMod = requireFromBuild(`${D}/distribution/leadDistributionAutoAuthorizationValidation.js`);
const auditMod = requireFromBuild(`${D}/distribution/leadDistributionPolicyAudit.js`);
const policyEvalMod = requireFromBuild(`${D}/distribution/leadDistributionPolicyEvaluationExecutor.js`);
const authResolverMod = requireFromBuild(`${D}/distribution/leadDistributionAuthorizationSnapshotResolver.js`);
const distTypes = requireFromBuild(`${D}/distribution/leadDistributionTypes.js`);
const assignTypes = requireFromBuild(`${D}/distribution/leadDistributionAssignmentTypes.js`);
const policyTypes = requireFromBuild("./lib/aos/policy/policyTypes.js");
const policyReasons = requireFromBuild("./lib/aos/policy/policyDecisionReasons.js");
const policyConfigMod = requireFromBuild("./lib/aos/policy/policyConfig.js");
const fpMod = requireFromBuild("./lib/aos/policy/policyFingerprint.js");
const storeValidation = requireFromBuild("./lib/aos/policy/runtime/policyConfigStoreValidation.js");
const storeAdapter = requireFromBuild("./lib/aos/policy/runtime/policyConfigStoreAdapter.js");
const storeTypes = requireFromBuild("./lib/aos/policy/runtime/policyConfigStoreTypes.js");

const E = events.LeadLifecycleEventType;
const T = tasks.LeadLifecycleTaskIntent;
const S = states.LeadLifecycleState;
const WF_TYPE = states.LEAD_LIFECYCLE_WORKFLOW_TYPE;
const KEY = policyTypes.AutomationPolicyKey.LEAD_DISTRIBUTION_AUTHORIZATION;
const MODE = policyTypes.AutomationPolicyMode;
const DECISION = policyTypes.DistributionAuthorizationDecision;
const REASON = policyReasons.PolicyDecisionReason;
const VERSION = policyConfigMod.LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_VERSION;
const SAFE = policyConfigMod.SAFE_DEFAULT_LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_CONFIG;
const ROUTE = distTypes.LeadDistributionRoute;
const AUTH_SOURCE = distTypes.LeadDistributionAuthorizationSource;
const MR = assignTypes.DistributionAssignmentManualReviewReason;
const SOURCE = storeTypes.AutomationPolicyConfigSource;

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
async function expectRejects(fn, pattern) {
  try { await fn(); } catch (error) {
    const message = String(error?.message ?? error);
    if (!pattern || pattern.test(message)) return;
    throw new Error(`wrong rejection: ${message}`);
  }
  throw new Error("Expected rejection");
}

const LEAD_ID = "lead_std_1";
const WORKFLOW_ID = "wf_std_1";
const REC_EVENT_ID = "evt_match_1";
const ABC = ["vA", "vB", "vC"];
const QUALITY_APLUS = { score_class: "A+", total_score: 95, hard_block_reason: null, recommended_action: "auto_distribute" };
const QUALITY_B = { score_class: "B", total_score: 60, hard_block_reason: null, recommended_action: "clarification_required" };

let counter = 0;
function makeDomainEvent(input, n = ++counter) {
  return {
    id: input.id ?? `evt_out_${n}`, event_type: input.eventType, entity_type: input.entityType ?? "lead",
    entity_id: input.entityId ?? LEAD_ID, payload_version: 1, payload_json: input.payload ?? {},
    trace_id: input.traceId ?? null, correlation_id: input.correlationId ?? null,
    causation_id: input.causationId ?? null, idempotency_key: input.idempotencyKey ?? null,
    processing_status: "pending", processed_at: null,
    created_at: "2026-07-08T00:00:00.000Z", updated_at: "2026-07-08T00:00:00.000Z",
    locked_at: null, locked_by: null, attempt_count: 0, max_attempts: 5, next_retry_at: null,
  };
}

function makeMatchingEvent(opts = {}) {
  const ids = opts.recommendedVendorIds ?? ABC;
  return makeDomainEvent({
    id: opts.id ?? REC_EVENT_ID, eventType: E.MATCHING_COMPLETED, entityType: "lead",
    entityId: opts.leadId ?? LEAD_ID,
    payload: { workflow_type: WF_TYPE, lead_id: opts.leadId ?? LEAD_ID, recommended_vendor_count: opts.count ?? ids.length, recommended_vendor_ids: ids },
    correlationId: opts.workflowId ?? WORKFLOW_ID,
  });
}

function makeTask(taskType, payload = {}) {
  return {
    id: payload.__taskId ?? `task_${taskType.replace(/\W/g, "_")}_${(++counter).toString(16)}`,
    workflow_instance_id: WORKFLOW_ID, task_type: taskType, status: "processing", priority: 100,
    due_at: "2026-07-08T00:00:00.000Z", attempt_count: 0, max_attempts: 5, next_retry_at: null,
    locked_at: "2026-07-08T00:00:00.000Z", locked_by: "worker_test", idempotency_key: null,
    payload_json: {
      lead_id: LEAD_ID, workflow_instance_id: WORKFLOW_ID,
      triggered_by_event: payload.triggered_by_event !== undefined ? payload.triggered_by_event : REC_EVENT_ID,
    },
    result_json: {}, last_error: null,
    created_at: "2026-07-08T00:00:00.000Z", started_at: "2026-07-08T00:00:00.000Z", completed_at: null,
    updated_at: "2026-07-08T00:00:00.000Z",
  };
}

const STANDARD_ROUTING = { leadIntent: "general_auto_match", targetVendorId: null, preferredVendorId: null, requirementGroupId: null, selectedVendorId: null, assignmentIntent: null };
const PREFERRED_ROUTING = { leadIntent: "preferred_vendor", targetVendorId: null, preferredVendorId: null, requirementGroupId: null, selectedVendorId: null, assignmentIntent: null };
const SELECTED_ROUTING = { leadIntent: null, targetVendorId: null, preferredVendorId: null, requirementGroupId: null, selectedVendorId: "vSel", assignmentIntent: null };

function safeDefaultSnapshot() {
  return storeValidation.buildSafeDefaultAutomationPolicyConfigSnapshot(KEY);
}
function activeSnapshot(overrides = {}) {
  const cfg = { ...SAFE, enabled: true, ...overrides };
  const fingerprint = fpMod.computePolicyConfigFingerprint(cfg);
  const active = {
    policy_key: KEY, config_id: overrides.__configId ?? "cfg_active_1",
    config: { id: overrides.__configId ?? "cfg_active_1", policy_key: KEY, policy_version: VERSION, config_json: cfg, config_fingerprint: fingerprint },
  };
  return storeValidation.validateActiveAutomationPolicyConfigSnapshot(KEY, active);
}
function autoGuardedSnapshot() {
  return activeSnapshot({ mode: MODE.GUARDED_AUTO_AUTHORIZE, minimumAutoAuthorizeScore: 90, allowedAutoAuthorizeScoreClasses: ["A+"] });
}
function manualReviewSnapshot() {
  return activeSnapshot({ mode: MODE.MANUAL_REVIEW_ONLY });
}
function guardedButDeniedSnapshot() {
  // guarded + enabled but A+ facts with score below threshold → human approval.
  return activeSnapshot({ mode: MODE.GUARDED_AUTO_AUTHORIZE, minimumAutoAuthorizeScore: 99, allowedAutoAuthorizeScoreClasses: ["A+"] });
}

// --- executor deps for the policy-evaluation task ---------------------------
function stubPublisher(calls) {
  return {
    async publish(input) {
      const stamped = { workflow_type: WF_TYPE, lead_id: input.leadId, ...(input.payload ?? {}) };
      calls.published.push({ eventType: input.eventType, payload: stamped, correlationId: input.correlationId, causationId: input.causationId, workflowTaskId: input.workflowTaskId });
      return makeDomainEvent({ eventType: input.eventType, entityId: input.leadId, payload: stamped, correlationId: input.correlationId, causationId: input.causationId });
    },
  };
}

function nullReader(calls) {
  return { async findResultEventByIdempotencyKey() { calls.resultReads += 1; return null; } };
}

function makePolicyDeps(opts = {}) {
  const calls = { published: [], eventLookups: [], configLoads: 0, qualityReads: 0, scoreCalls: 0, matching: 0, assign: 0, routeReads: 0, resultReads: 0 };
  const events = opts.events ?? [makeMatchingEvent(opts.rec ?? {})];
  const eventMap = new Map();
  for (const e of events) eventMap.set(e.id, e);
  const snapshot = opts.snapshot ?? safeDefaultSnapshot();
  // Correction 1: the normal default policy dependency set ALWAYS supplies a
  // result-event reader (returning null when no prior result exists). Only the
  // dedicated missing-reader tests omit it via { omitReader: true }.
  const reader = opts.omitReader ? undefined : (opts.resultEventReader ?? nullReader(calls));
  return {
    calls,
    deps: {
      ports: {
        quality: { async scoreLead() { calls.scoreCalls += 1; return QUALITY_APLUS; } },
        latestQuality: { async readLatestQualityResult() { calls.qualityReads += 1; return opts.quality ?? QUALITY_APLUS; } },
        clarification: { async prepareClarification() { return { requestId: "c", status: "s", missingFields: [], questionsCount: 0 }; } },
        matchingRecommendation: { async prepareRecommendations() { calls.matching += 1; return { leadId: LEAD_ID, eligibleVendorCount: 0, recommendedVendorIds: [] }; } },
      },
      resultEventPublisher: opts.publisher ?? stubPublisher(calls),
      distribution: {
        recommendationEventPort: { async getDomainEventById(id) { calls.eventLookups.push(id); return eventMap.get(id) ?? null; } },
        routingPort: { async readLeadRouting() { calls.routeReads += 1; return opts.routing ?? STANDARD_ROUTING; } },
        policyConfig: opts.policyConfig ?? { async loadSnapshot() { calls.configLoads += 1; if (opts.configThrow) throw new Error(opts.configThrow); return snapshot; } },
        resultEventReader: reader,
      },
    },
  };
}

async function runPolicy(opts = {}) {
  const { deps, calls } = makePolicyDeps(opts);
  const result = await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_POLICY_EVALUATE, { triggered_by_event: opts.triggeredBy ?? REC_EVENT_ID, __taskId: opts.taskId }), deps);
  return { result, calls };
}

// In-memory durable repository + result-event reader (retry-stability tests).
class InMemoryRepo {
  constructor() { this.byKey = new Map(); this.insertCount = 0; }
  async insert(input) {
    this.insertCount += 1;
    if (this.byKey.has(input.idempotencyKey)) throw { code: "23505", message: "duplicate key violates idempotency index" };
    const event = makeDomainEvent({
      eventType: input.eventType, entityType: input.entityType, entityId: input.entityId,
      payload: input.payload, correlationId: input.correlationId, causationId: input.causationId, idempotencyKey: input.idempotencyKey,
    });
    this.byKey.set(input.idempotencyKey, event);
    return event;
  }
  async findByIdempotencyKey(key) { return this.byKey.get(key) ?? null; }
}
function readerFor(repo) {
  return { async findResultEventByIdempotencyKey(key) { return repo.findByIdempotencyKey(key); } };
}

// ==========================================================================
// TASK MAPPING
// ==========================================================================
function makeHandlerContext(fromState, event) {
  return {
    workflow: { id: WORKFLOW_ID, current_state: fromState, entity_type: "lead", entity_id: LEAD_ID },
    event: { id: event.id, event_type: event.event_type, entity_type: "lead", entity_id: LEAD_ID, payload_json: event.payload_json ?? {} },
  };
}
function matchingCompletedContext() {
  return makeHandlerContext(S.MATCHING_PENDING, { id: REC_EVENT_ID, event_type: E.MATCHING_COMPLETED, payload_json: { recommended_vendor_count: 3 } });
}
check("1. MATCH_RECOMMENDATION_READY creates policy evaluation task", () => {
  const result = handlerMod.leadLifecycleHandler(matchingCompletedContext());
  assert(result.nextState === S.MATCH_RECOMMENDATION_READY, `wrong next state ${result.nextState}`);
  assert(result.tasks.length === 1 && result.tasks[0].taskType === T.DISTRIBUTION_POLICY_EVALUATE, "must create policy evaluate task");
});
check("2. newly generated transition does not create prepare_approval task", () => {
  const result = handlerMod.leadLifecycleHandler(matchingCompletedContext());
  assert(!result.tasks.some((t) => t.taskType === T.DISTRIBUTION_PREPARE_APPROVAL), "must not create prepare_approval task");
});
check("3. exactly one task created", () => {
  const result = handlerMod.leadLifecycleHandler(matchingCompletedContext());
  assert(result.tasks.length === 1, `expected exactly one task, got ${result.tasks.length}`);
});
check("4. task idempotency deterministic (no timestamp/random)", () => {
  const a = handlerMod.leadLifecycleHandler(matchingCompletedContext());
  const b = handlerMod.leadLifecycleHandler(matchingCompletedContext());
  assert(a.tasks[0].idempotencyKey === b.tasks[0].idempotencyKey, "idempotency key not deterministic");
  assert(a.tasks[0].idempotencyKey === `${WF_TYPE}:task:${WORKFLOW_ID}:${REC_EVENT_ID}:${T.DISTRIBUTION_POLICY_EVALUATE}`, `unexpected key ${a.tasks[0].idempotencyKey}`);
  assert(!/\d{4}-\d{2}-\d{2}T|random|uuid/i.test(a.tasks[0].idempotencyKey), "key contains timestamp/random");
});
check("5. old prepare_approval executor compatibility preserved", async () => {
  const { deps, calls } = makePolicyDeps({ snapshot: safeDefaultSnapshot() });
  // The legacy prepare_approval task path still resolves + publishes without policy config.
  const legacyDeps = { ports: deps.ports, resultEventPublisher: deps.resultEventPublisher, distribution: { recommendationEventPort: deps.distribution.recommendationEventPort, routingPort: deps.distribution.routingPort } };
  const result = await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE_APPROVAL, { triggered_by_event: REC_EVENT_ID }), legacyDeps);
  assert(result.status === "completed" && calls.published[0].eventType === E.DISTRIBUTION_APPROVAL_REQUIRED, "legacy prepare_approval must still publish approval_required");
});

// ==========================================================================
// FACT BUILDING
// ==========================================================================
const RECO_SNAPSHOT = { recommendationEventId: REC_EVENT_ID, leadId: LEAD_ID, workflowInstanceId: WORKFLOW_ID, recommendedVendorIds: ABC, recommendedVendorCount: 3 };
check("6. exact recommendation event id used", async () => {
  const { calls } = await runPolicy({ snapshot: safeDefaultSnapshot() });
  assert(calls.eventLookups[0] === REC_EVENT_ID, "did not resolve the triggering matching event");
  assert(calls.published[0].payload.recommendation_event_id === REC_EVENT_ID, "wrong recommendation event id in output");
});
check("7. recommendation order preserved", async () => {
  const { calls } = await runPolicy({ snapshot: safeDefaultSnapshot(), rec: { recommendedVendorIds: ["vC", "vA", "vB"] } });
  assert(calls.published[0].payload.recommended_vendor_ids.join(",") === "vC,vA,vB", "recommendation order not preserved");
});
check("8. current route classification used (standard proceeds; special defers)", async () => {
  const standard = await runPolicy({ snapshot: safeDefaultSnapshot(), routing: STANDARD_ROUTING });
  const special = await runPolicy({ snapshot: safeDefaultSnapshot(), routing: PREFERRED_ROUTING });
  assert(standard.calls.published.length === 1, "standard route must proceed to a decision event");
  assert(special.result.status === "deferred_special_route" && special.calls.published.length === 0, "special route must defer");
});
check("9. latest persisted quality used", async () => {
  const { calls } = await runPolicy({ snapshot: autoGuardedSnapshot(), quality: QUALITY_APLUS });
  assert(calls.qualityReads === 1, "latest persisted quality must be read exactly once");
});
check("10. scoreLead not called", async () => {
  const { calls } = await runPolicy({ snapshot: autoGuardedSnapshot() });
  assert(calls.scoreCalls === 0, "policy evaluation must not rescore");
});
check("11. matching not rerun", async () => {
  const { calls } = await runPolicy({ snapshot: autoGuardedSnapshot() });
  assert(calls.matching === 0, "policy evaluation must not rerun matching");
});
check("12. no PII in facts", () => {
  const facts = policyEvalMod.buildLeadDistributionAuthorizationFacts({ workflowInstanceId: WORKFLOW_ID, leadId: LEAD_ID, routeClassification: ROUTE.STANDARD, quality: QUALITY_APLUS, recommendation: RECO_SNAPSHOT });
  const json = JSON.stringify(facts);
  assert(!/phone|email|whatsapp|address|client_name|"name"|budget_text|latitude|longitude|gps/i.test(json), "PII-looking field in facts");
  assert(facts.quality.scoreClass === "A+" && facts.quality.totalScore === 95, "facts must consume authoritative quality");
});

// ==========================================================================
// CONFIG
// ==========================================================================
check("13. active config loaded", async () => {
  const readPort = { async readActiveConfig() { const s = autoGuardedSnapshot(); return { policy_key: KEY, config_id: s.configId, config: { id: s.configId, policy_key: KEY, policy_version: VERSION, config_json: s.config, config_fingerprint: s.fingerprint } }; } };
  const snap = await storeAdapter.loadAutomationPolicyConfigSnapshot(KEY, readPort);
  assert(snap.source === SOURCE.ACTIVE_CONFIG && snap.configId === "cfg_active_1", "active config not loaded");
});
check("14. missing active pointer uses safe default", async () => {
  const readPort = { async readActiveConfig() { return null; } };
  const snap = await storeAdapter.loadAutomationPolicyConfigSnapshot(KEY, readPort);
  assert(snap.source === SOURCE.SAFE_DEFAULT_NO_ACTIVE_CONFIG && snap.configId === null && snap.config.enabled === false, "missing pointer must use safe default");
});
check("15. DB error throws (never 'no active config')", async () => {
  const readPort = { async readActiveConfig() { throw new Error("POSTGREST_DB_OUTAGE"); } };
  await expectRejects(() => storeAdapter.loadAutomationPolicyConfigSnapshot(KEY, readPort), /POSTGREST_DB_OUTAGE/);
});
check("16. integrity error throws", async () => {
  const readPort = { async readActiveConfig() { return { policy_key: KEY, config_id: "cfg_x", config: { id: "cfg_x", policy_key: KEY, policy_version: VERSION, config_json: { ...SAFE }, config_fingerprint: "deadbeef" } }; } };
  await expectRejects(() => storeAdapter.loadAutomationPolicyConfigSnapshot(KEY, readPort), /POLICY_CONFIG_(STORED_FINGERPRINT_INVALID|FINGERPRINT_MISMATCH)/);
});
check("17. safe default requires human approval", async () => {
  const { calls } = await runPolicy({ snapshot: safeDefaultSnapshot() });
  assert(calls.published[0].eventType === E.DISTRIBUTION_APPROVAL_REQUIRED && calls.published[0].payload.policy_reason_code === REASON.AUTOMATION_POLICY_DISABLED, "safe default must require human approval (disabled)");
});
check("18. policy fingerprint binding checked (mismatch fails loudly)", async () => {
  // Inject a config port whose snapshot fingerprint does not match its config.
  const good = autoGuardedSnapshot();
  const tampered = { ...good, fingerprint: "0".repeat(64) };
  await expectRejects(() => runPolicy({ policyConfig: { async loadSnapshot() { return tampered; } }, quality: QUALITY_APLUS }), /POLICY_DECISION_CONFIG_FINGERPRINT_MISMATCH/);
});

// ==========================================================================
// DECISION MAPPING
// ==========================================================================
check("19. require_human_approval -> approval_required", async () => {
  const { calls } = await runPolicy({ snapshot: safeDefaultSnapshot() });
  assert(calls.published[0].eventType === E.DISTRIBUTION_APPROVAL_REQUIRED, "must publish approval_required");
});
check("20. approval_required includes exact recommendation snapshot", async () => {
  const { calls } = await runPolicy({ snapshot: safeDefaultSnapshot(), rec: { recommendedVendorIds: ABC } });
  const p = calls.published[0].payload;
  assert(p.recommendation_event_id === REC_EVENT_ID && p.recommended_vendor_count === 3 && p.recommended_vendor_ids.join(",") === "vA,vB,vC", "approval_required missing exact snapshot");
});
check("21. approval_required includes audit fields", async () => {
  const { calls } = await runPolicy({ snapshot: safeDefaultSnapshot() });
  const audit = auditMod.validatePolicyDecisionAuditContract(auditMod.pickPolicyAuditFields(calls.published[0].payload));
  assert(audit.ok && audit.value.policy_decision === DECISION.REQUIRE_HUMAN_APPROVAL, "approval_required audit invalid");
});
check("22. auto_authorize -> auto_authorized", async () => {
  const { calls } = await runPolicy({ snapshot: autoGuardedSnapshot(), quality: QUALITY_APLUS });
  assert(calls.published[0].eventType === E.DISTRIBUTION_AUTO_AUTHORIZED, `expected auto_authorized, got ${calls.published[0].eventType}`);
});
check("23. auto-authorized ids exactly equal recommendation ids", async () => {
  const { calls } = await runPolicy({ snapshot: autoGuardedSnapshot(), quality: QUALITY_APLUS, rec: { recommendedVendorIds: ABC } });
  const p = calls.published[0].payload;
  assert(p.authorized_vendor_ids.join(",") === "vA,vB,vC" && p.recommended_vendor_ids.join(",") === "vA,vB,vC" && p.authorized_vendor_count === 3, "authorized must equal recommended exactly");
});
check("24. auto path cannot subset", async () => {
  const { calls } = await runPolicy({ snapshot: autoGuardedSnapshot(), quality: QUALITY_APLUS, rec: { recommendedVendorIds: ABC } });
  const p = calls.published[0].payload;
  assert(p.authorized_vendor_ids.length === p.recommended_vendor_ids.length, "auto path must not subset");
});
check("25. auto path cannot reorder", async () => {
  const { calls } = await runPolicy({ snapshot: autoGuardedSnapshot(), quality: QUALITY_APLUS, rec: { recommendedVendorIds: ["vC", "vA", "vB"] } });
  const p = calls.published[0].payload;
  assert(p.authorized_vendor_ids.join(",") === "vC,vA,vB", "auto path must preserve recommendation order");
});
check("26. auto path cannot replace vendor", async () => {
  const { calls } = await runPolicy({ snapshot: autoGuardedSnapshot(), quality: QUALITY_APLUS, rec: { recommendedVendorIds: ["vX", "vY"] } });
  const p = calls.published[0].payload;
  assert(p.authorized_vendor_ids.join(",") === "vX,vY", "auto path must not replace vendors");
});
check("27. manual_review -> manual_review.required", async () => {
  const { calls } = await runPolicy({ snapshot: manualReviewSnapshot(), quality: QUALITY_APLUS });
  assert(calls.published[0].eventType === E.MANUAL_REVIEW_REQUIRED && calls.published[0].payload.policy_decision === DECISION.MANUAL_REVIEW, "must publish manual_review.required");
});
check("28. manual-review reason deterministic (derived from policy reason)", async () => {
  const a = await runPolicy({ snapshot: manualReviewSnapshot(), quality: QUALITY_APLUS });
  const b = await runPolicy({ snapshot: manualReviewSnapshot(), quality: QUALITY_APLUS });
  assert(a.calls.published[0].payload.reason === REASON.MANUAL_REVIEW_MODE && b.calls.published[0].payload.reason === REASON.MANUAL_REVIEW_MODE, "manual review reason not deterministic/derived");
  const zero = await runPolicy({ snapshot: autoGuardedSnapshot(), quality: QUALITY_APLUS, rec: { recommendedVendorIds: [], count: 0 } });
  assert(zero.calls.published[0].payload.reason === REASON.NO_DISTRIBUTION_RECOMMENDATIONS, "zero recommendation manual review reason wrong");
});
for (const [n, routing, cls] of [["29", PREFERRED_ROUTING, ROUTE.PREFERRED_VENDOR], ["29b", SELECTED_ROUTING, ROUTE.CLIENT_SELECTED]]) {
  check(`${n}. defer_special_route publishes no standard lifecycle decision event`, async () => {
    const { result, calls } = await runPolicy({ snapshot: autoGuardedSnapshot(), routing });
    assert(result.status === "deferred_special_route" && calls.published.length === 0, "special route must publish no event");
    assert(result.result.policy_decision === DECISION.DEFER_SPECIAL_ROUTE && result.result.route_classification === cls, "defer metadata wrong");
  });
}
check("30. special route performs no assignment / config / quality read", async () => {
  const { calls } = await runPolicy({ snapshot: autoGuardedSnapshot(), routing: PREFERRED_ROUTING });
  assert(calls.assign === 0 && calls.configLoads === 0 && calls.qualityReads === 0, "special route must not assign / load config / read quality");
});

// ==========================================================================
// RETRY STABILITY
// ==========================================================================
const RESULT_KEY = (taskId) => publisherMod.buildLeadLifecycleResultEventIdempotencyKey(taskId);
async function runPolicyDurable(repo, opts = {}) {
  const publisher = new publisherMod.DurableLeadLifecycleEventPublisher(repo);
  return runPolicy({ ...opts, publisher, resultEventReader: readerFor(repo), taskId: opts.taskId ?? "task_policy_retry" });
}
check("31. no prior event -> evaluate once", async () => {
  const repo = new InMemoryRepo();
  const { calls } = await runPolicyDurable(repo, { snapshot: autoGuardedSnapshot(), quality: QUALITY_APLUS });
  assert(calls.configLoads === 1 && calls.qualityReads === 1 && repo.insertCount === 1, "first run must evaluate + publish exactly once");
});
async function seedThenReplay(opts) {
  const repo = new InMemoryRepo();
  await runPolicyDurable(repo, { ...opts, taskId: "task_replay" });
  // Second attempt: fresh deps (fresh counters), same repo/reader/task id.
  const { deps, calls } = makePolicyDeps({ ...opts, publisher: new publisherMod.DurableLeadLifecycleEventPublisher(repo), resultEventReader: readerFor(repo) });
  const result = await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_POLICY_EVALUATE, { triggered_by_event: opts.triggeredBy ?? REC_EVENT_ID, __taskId: "task_replay" }), deps);
  return { repo, result, calls };
}
check("32. existing valid approval_required event reused", async () => {
  const { result } = await seedThenReplay({ snapshot: safeDefaultSnapshot() });
  assert(result.result.policy_result_reused === true && result.result.published_event_type === E.DISTRIBUTION_APPROVAL_REQUIRED, "approval_required not reused");
});
check("33. existing valid auto_authorized event reused", async () => {
  const { result } = await seedThenReplay({ snapshot: autoGuardedSnapshot(), quality: QUALITY_APLUS });
  assert(result.result.policy_result_reused === true && result.result.published_event_type === E.DISTRIBUTION_AUTO_AUTHORIZED, "auto_authorized not reused");
});
check("34. existing valid manual_review event reused", async () => {
  const { result } = await seedThenReplay({ snapshot: manualReviewSnapshot(), quality: QUALITY_APLUS });
  assert(result.result.policy_result_reused === true && result.result.published_event_type === E.MANUAL_REVIEW_REQUIRED, "manual_review not reused");
});
check("35-38. replay does not reload config/reread quality/reevaluate/republish", async () => {
  const { repo, calls } = await seedThenReplay({ snapshot: autoGuardedSnapshot(), quality: QUALITY_APLUS });
  assert(calls.configLoads === 0, "replay must not reload config");
  assert(calls.qualityReads === 0, "replay must not reread quality");
  assert(calls.eventLookups.length === 0, "replay must not re-resolve recommendation / re-evaluate");
  assert(repo.insertCount === 1 && calls.published.length === 0, "replay must not republish");
});
function seedBadEvent(repo, taskId, event) { repo.byKey.set(RESULT_KEY(taskId), event); }
async function runWithSeededResult(event, opts = {}) {
  const repo = new InMemoryRepo();
  const taskId = "task_replay_bad";
  seedBadEvent(repo, taskId, event);
  const { deps } = makePolicyDeps({ ...opts, publisher: new publisherMod.DurableLeadLifecycleEventPublisher(repo), resultEventReader: readerFor(repo) });
  return executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_POLICY_EVALUATE, { triggered_by_event: REC_EVENT_ID, __taskId: taskId }), deps);
}
check("39. wrong replay event type rejected", async () => {
  const bad = makeDomainEvent({ eventType: E.MATCHING_COMPLETED, entityId: LEAD_ID, correlationId: WORKFLOW_ID, causationId: REC_EVENT_ID, payload: { workflow_type: WF_TYPE, lead_id: LEAD_ID, recommendation_event_id: REC_EVENT_ID } });
  await expectRejects(() => runWithSeededResult(bad), /POLICY_RESULT_REPLAY_INTEGRITY_ERROR:EVENT_TYPE/);
});
check("40. wrong lead rejected", async () => {
  const bad = makeDomainEvent({ eventType: E.MANUAL_REVIEW_REQUIRED, entityId: "lead_OTHER", correlationId: WORKFLOW_ID, causationId: REC_EVENT_ID, payload: { workflow_type: WF_TYPE, lead_id: "lead_OTHER", recommendation_event_id: REC_EVENT_ID } });
  await expectRejects(() => runWithSeededResult(bad), /POLICY_RESULT_REPLAY_INTEGRITY_ERROR:LEAD/);
});
check("41. wrong workflow rejected", async () => {
  const bad = makeDomainEvent({ eventType: E.MANUAL_REVIEW_REQUIRED, entityId: LEAD_ID, correlationId: "wf_OTHER", causationId: REC_EVENT_ID, payload: { workflow_type: WF_TYPE, lead_id: LEAD_ID, recommendation_event_id: REC_EVENT_ID } });
  await expectRejects(() => runWithSeededResult(bad), /POLICY_RESULT_REPLAY_INTEGRITY_ERROR:WORKFLOW/);
});
check("42. wrong causation/recommendation binding rejected", async () => {
  const bad = makeDomainEvent({ eventType: E.MANUAL_REVIEW_REQUIRED, entityId: LEAD_ID, correlationId: WORKFLOW_ID, causationId: "evt_OTHER", payload: { workflow_type: WF_TYPE, lead_id: LEAD_ID, recommendation_event_id: REC_EVENT_ID } });
  await expectRejects(() => runWithSeededResult(bad), /POLICY_RESULT_REPLAY_INTEGRITY_ERROR:CAUSATION/);
});
check("43. changed payload under same task scope rejected", async () => {
  // Correct scope, but an approval_required payload whose recommendation binding was changed.
  const bad = makeDomainEvent({ eventType: E.DISTRIBUTION_APPROVAL_REQUIRED, entityId: LEAD_ID, correlationId: WORKFLOW_ID, causationId: REC_EVENT_ID, payload: { workflow_type: WF_TYPE, lead_id: LEAD_ID, recommendation_event_id: "evt_TAMPERED", recommended_vendor_count: 2, recommended_vendor_ids: ABC.slice(0, 2) } });
  await expectRejects(() => runWithSeededResult(bad), /POLICY_RESULT_REPLAY_INTEGRITY_ERROR:RECOMMENDATION_BINDING/);
});

// ==========================================================================
// HUMAN + AUTO AUTHORIZATION EXECUTION (DISTRIBUTION_PREPARE, neutral snapshot)
// ==========================================================================
function makeApprovedEvent(opts = {}) {
  const recommended = opts.recommended ?? ABC;
  const approved = opts.approved ?? ABC;
  return makeDomainEvent({
    id: opts.id ?? "evt_appr_1", eventType: E.DISTRIBUTION_APPROVED, entityId: LEAD_ID, correlationId: WORKFLOW_ID,
    payload: { workflow_type: WF_TYPE, lead_id: LEAD_ID, recommendation_event_id: REC_EVENT_ID, recommended_vendor_count: recommended.length, recommended_vendor_ids: recommended, approved_vendor_count: approved.length, approved_vendor_ids: approved, approved_by: "admin_1" },
  });
}
async function buildAutoEvent(vendorIds) {
  const repo = new InMemoryRepo();
  await runPolicyDurable(repo, { snapshot: autoGuardedSnapshot(), quality: QUALITY_APLUS, rec: { recommendedVendorIds: vendorIds }, taskId: `task_make_auto_${vendorIds.join("")}` });
  return [...repo.byKey.values()].find((e) => e.event_type === E.DISTRIBUTION_AUTO_AUTHORIZED);
}
async function realAutoAuthorizedEvent() { return buildAutoEvent(ABC); }
function resolverPort(eventList) {
  const map = new Map(eventList.map((e) => [e.id, e]));
  return { async getDomainEventById(id) { return map.get(id) ?? null; } };
}
async function resolveAuth(authEvent, matchingEvent) {
  const list = matchingEvent === null ? [authEvent] : [authEvent, matchingEvent];
  return authResolverMod.resolveLeadDistributionAuthorizationSnapshot(
    { authorizationEventId: authEvent.id, expectedWorkflowInstanceId: WORKFLOW_ID, expectedLeadId: LEAD_ID },
    resolverPort(list),
  );
}
function assignedRecords(pairs) { return pairs.map(([v, a]) => ({ vendorId: v, assignmentId: a })); }
function rawResult(opts = {}) { return { status: opts.status ?? "ok", leadId: opts.leadId ?? LEAD_ID, assigned: opts.assigned ?? assignedRecords([["vA", "a1"], ["vB", "a2"], ["vC", "a3"]]) }; }
function makePrepareDeps(authEvent, opts = {}) {
  const calls = { published: [], assignInputs: [], assign: 0 };
  // Correction 2: the authoritative matching event must be resolvable so the auto
  // path can cross-bind to it. Default: the original ABC matching event under REC_EVENT_ID.
  const eventMap = new Map([[authEvent.id, authEvent]]);
  const matching = opts.matchingEvent ?? makeMatchingEvent({ recommendedVendorIds: opts.matchingIds ?? ABC });
  if (!eventMap.has(matching.id)) eventMap.set(matching.id, matching);
  return {
    calls,
    deps: {
      ports: { quality: {}, latestQuality: {}, clarification: {}, matchingRecommendation: { async prepareRecommendations() { calls.matching = (calls.matching ?? 0) + 1; return {}; } } },
      resultEventPublisher: stubPublisher(calls),
      distribution: {
        recommendationEventPort: { async getDomainEventById(id) { return eventMap.get(id) ?? null; } },
        routingPort: { async readLeadRouting() { return opts.routing ?? STANDARD_ROUTING; } },
        assignmentExecution: { async assignApprovedVendors(input) { calls.assign += 1; calls.assignInputs.push(input); return opts.assignmentResult ?? rawResult(); } },
      },
    },
  };
}
async function runPrepare(authEvent, opts = {}) {
  const { deps, calls } = makePrepareDeps(authEvent, opts);
  const result = await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE, { triggered_by_event: authEvent.id }), deps);
  return { result, calls };
}
check("44. human approval maps to neutral authorization snapshot", async () => {
  const { calls } = await runPrepare(makeApprovedEvent({ approved: ABC }), { assignmentResult: rawResult() });
  assert(calls.assign === 1, "human approval must reach the assignment boundary");
});
check("45. approved subset becomes authorized list", async () => {
  const { calls } = await runPrepare(makeApprovedEvent({ recommended: ABC, approved: ["vA", "vC"] }), { assignmentResult: rawResult({ assigned: assignedRecords([["vA", "a1"], ["vC", "a3"]]) }) });
  assert(calls.assignInputs[0].approvedVendorIds.join(",") === "vA,vC", "authorized list must be the approved subset");
});
check("46. only authorized human subset sent to assignment boundary", async () => {
  const { calls } = await runPrepare(makeApprovedEvent({ recommended: ABC, approved: ["vA", "vC"] }), { assignmentResult: rawResult({ assigned: assignedRecords([["vA", "a1"], ["vC", "a3"]]) }) });
  assert(!calls.assignInputs[0].approvedVendorIds.includes("vB"), "unapproved vendor must not be sent");
});
check("47. auto event maps to neutral snapshot", async () => {
  const autoEvent = await realAutoAuthorizedEvent();
  const { calls } = await runPrepare(autoEvent, { assignmentResult: rawResult() });
  assert(calls.assign === 1, "auto authorization must reach the assignment boundary");
});
check("48. auto authorized exact recommendations sent to assignment boundary", async () => {
  const autoEvent = await realAutoAuthorizedEvent();
  const { calls } = await runPrepare(autoEvent, { assignmentResult: rawResult() });
  assert(calls.assignInputs[0].approvedVendorIds.join(",") === "vA,vB,vC", "auto path must send the exact recommendation set");
});
check("49-51. auto execution: no matching rerun / rerank / replacement", async () => {
  const autoEvent = await realAutoAuthorizedEvent();
  const { calls } = await runPrepare(autoEvent, { assignmentResult: rawResult({ assigned: assignedRecords([["vA", "a1"], ["vB", "a2"], ["vC", "a3"]]) }) });
  assert((calls.matching ?? 0) === 0, "must not rerun matching");
  assert(calls.assignInputs[0].approvedVendorIds.join(",") === "vA,vB,vC", "must not rerank or replace vendors");
});

// ==========================================================================
// ROUTE CHANGE
// ==========================================================================
check("52. route change after human approval -> manual review", async () => {
  const { calls } = await runPrepare(makeApprovedEvent(), { routing: PREFERRED_ROUTING });
  assert(calls.published[0].eventType === E.MANUAL_REVIEW_REQUIRED && calls.published[0].payload.reason === MR.ROUTE_CHANGED, "human route change must be manual review");
});
check("53. route change after auto authorization -> manual review", async () => {
  const autoEvent = await realAutoAuthorizedEvent();
  const { calls } = await runPrepare(autoEvent, { routing: PREFERRED_ROUTING });
  assert(calls.published[0].eventType === E.MANUAL_REVIEW_REQUIRED && calls.published[0].payload.reason === MR.ROUTE_CHANGED, "auto route change must be manual review");
  assert(calls.published[0].payload.authorization_source === AUTH_SOURCE.POLICY_AUTO_AUTHORIZATION && calls.published[0].payload.route_classification === ROUTE.PREFERRED_VENDOR, "route-change payload must identify neutral authorization + route");
});
check("54. no assignment on route change", async () => {
  const { calls } = await runPrepare(makeApprovedEvent(), { routing: PREFERRED_ROUTING });
  assert(calls.assign === 0, "route change must not assign");
});

// ==========================================================================
// ASSIGNMENT RESULT
// ==========================================================================
check("55. 1 assigned -> completed", async () => {
  const { calls } = await runPrepare(makeApprovedEvent(), { assignmentResult: rawResult({ assigned: assignedRecords([["vA", "a1"]]) }) });
  assert(calls.published[0].eventType === E.DISTRIBUTION_COMPLETED && calls.published[0].payload.distributed_vendor_ids.join() === "vA", "1 assigned must complete");
});
check("56. 2 assigned -> completed", async () => {
  const { calls } = await runPrepare(makeApprovedEvent(), { assignmentResult: rawResult({ assigned: assignedRecords([["vA", "a1"], ["vC", "a3"]]) }) });
  const p = calls.published[0].payload;
  assert(p.distributed_vendor_ids.join(",") === "vA,vC" && p.skipped_vendor_ids.join() === "vB", "2 assigned wrong");
});
check("57. 3 assigned -> completed", async () => {
  const { calls } = await runPrepare(makeApprovedEvent(), { assignmentResult: rawResult({ assigned: assignedRecords([["vA", "a1"], ["vB", "a2"], ["vC", "a3"]]) }) });
  assert(calls.published[0].payload.distributed_vendor_ids.join(",") === "vA,vB,vC" && calls.published[0].payload.skipped_vendor_ids.length === 0, "3 assigned wrong");
});
check("58. zero assigned -> manual review", async () => {
  const { calls } = await runPrepare(makeApprovedEvent(), { assignmentResult: rawResult({ status: "no_eligible_vendors", assigned: [] }) });
  assert(calls.published[0].eventType === E.MANUAL_REVIEW_REQUIRED && calls.published[0].payload.reason === MR.ZERO_ASSIGNABLE, "zero assigned must be manual review");
});
check("59. partial assignment preserves authorized order", async () => {
  const { calls } = await runPrepare(makeApprovedEvent(), { assignmentResult: rawResult({ assigned: assignedRecords([["vC", "a3"], ["vA", "a1"]]) }) });
  assert(calls.published[0].payload.distributed_vendor_ids.join(",") === "vA,vC", "distributed must be in authorized order");
});
check("60. skipped list is authorized-order complement", async () => {
  const { calls } = await runPrepare(makeApprovedEvent(), { assignmentResult: rawResult({ assigned: assignedRecords([["vB", "a2"]]) }) });
  assert(calls.published[0].payload.skipped_vendor_ids.join(",") === "vA,vC", "skipped must be authorized-order complement");
});
check("61. assignment outside authorized scope rejected", async () => {
  const { calls } = await runPrepare(makeApprovedEvent({ approved: ["vA", "vB"] }), { assignmentResult: rawResult({ assigned: assignedRecords([["vA", "a1"], ["vZ", "a9"]]) }) });
  assert(calls.published[0].eventType === E.MANUAL_REVIEW_REQUIRED && calls.published[0].payload.reason === MR.OUTSIDE_SCOPE, "outside-scope must be manual review");
});
check("62. replay already_assigned maps from authoritative truth", async () => {
  const { calls } = await runPrepare(makeApprovedEvent(), { assignmentResult: rawResult({ status: "already_assigned", assigned: assignedRecords([["vC", "a3"], ["vA", "a1"]]) }) });
  assert(calls.published[0].eventType === E.DISTRIBUTION_COMPLETED && calls.published[0].payload.distributed_vendor_ids.join(",") === "vA,vC", "already_assigned must canonicalize");
});
check("63. no AOS credit math", async () => {
  const { result } = await runPrepare(makeApprovedEvent(), { assignmentResult: rawResult() });
  assert(result.result.aos_credit_math_executed === false, "AOS must not do credit math");
});

// ==========================================================================
// COMPLETION CONTRACT
// ==========================================================================
const NEUTRAL_COMPLETED = { authorization_event_id: "evt_auth_1", authorization_source: AUTH_SOURCE.POLICY_AUTO_AUTHORIZATION, recommendation_event_id: "r", authorized_vendor_count: 3, authorized_vendor_ids: ABC, distributed_vendor_count: 2, distributed_vendor_ids: ["vA", "vC"], skipped_vendor_ids: ["vB"] };
const LEGACY_COMPLETED = { approval_event_id: "evt_appr_1", recommendation_event_id: "r", approved_vendor_count: 3, approved_vendor_ids: ABC, distributed_vendor_count: 2, distributed_vendor_ids: ["vA", "vC"], skipped_vendor_ids: ["vB"] };
check("64. neutral human completed payload valid", () => {
  const r = validationMod.validateDistributionAuthorizationCompleted({ ...NEUTRAL_COMPLETED, authorization_source: AUTH_SOURCE.HUMAN_APPROVAL });
  assert(r.ok && r.value.authorizationSource === AUTH_SOURCE.HUMAN_APPROVAL, "neutral human completed must validate");
});
check("65. neutral auto completed payload valid", () => {
  const r = validationMod.validateDistributionAuthorizationCompleted(NEUTRAL_COMPLETED);
  assert(r.ok && r.value.authorizedVendorIds.join(",") === "vA,vB,vC" && r.value.distributedVendorIds.join(",") === "vA,vC", "neutral auto completed must validate");
});
check("66. distributed + skipped exact partition", () => {
  const r = validationMod.validateDistributionAuthorizationCompleted(NEUTRAL_COMPLETED);
  assert(r.ok && r.value.distributedVendorIds.join(",") === "vA,vC" && r.value.skippedVendorIds.join() === "vB", "partition wrong");
});
check("67. reordered distributed rejected", () => {
  assert(!validationMod.validateDistributionAuthorizationCompleted({ ...NEUTRAL_COMPLETED, distributed_vendor_ids: ["vC", "vA"], skipped_vendor_ids: ["vB"] }).ok, "reordered distributed must reject");
});
check("68. overlap rejected", () => {
  assert(!validationMod.validateDistributionAuthorizationCompleted({ ...NEUTRAL_COMPLETED, distributed_vendor_ids: ["vA", "vB"], skipped_vendor_ids: ["vB"] }).ok, "overlap must reject");
});
check("69. incomplete partition rejected", () => {
  assert(!validationMod.validateDistributionAuthorizationCompleted({ ...NEUTRAL_COMPLETED, distributed_vendor_count: 1, distributed_vendor_ids: ["vA"], skipped_vendor_ids: ["vC"] }).ok, "incomplete partition must reject");
});
check("70. outside-authorization vendor rejected", () => {
  assert(!validationMod.validateDistributionAuthorizationCompleted({ ...NEUTRAL_COMPLETED, distributed_vendor_ids: ["vA", "vD"], skipped_vendor_ids: ["vB"] }).ok, "outside-authorization vendor must reject");
});
check("71. legacy human completed payload remains compatible", () => {
  const flex = validationMod.validateDistributionCompletedAuthorization(LEGACY_COMPLETED);
  assert(flex.ok && flex.value.authorizationSource === AUTH_SOURCE.HUMAN_APPROVAL && flex.value.authorizationEventId === "evt_appr_1", "legacy completed must normalize");
  assert(validationMod.validateDistributionCompleted(LEGACY_COMPLETED).ok, "legacy validator must still accept legacy payload");
});

// ==========================================================================
// POLICY AUDIT
// ==========================================================================
check("72. audit fields preserved on approval_required", async () => {
  const { calls } = await runPolicy({ snapshot: safeDefaultSnapshot() });
  const p = calls.published[0].payload;
  for (const k of ["policy_key", "policy_version", "policy_fingerprint", "policy_decision", "policy_reason_code", "policy_config_id", "policy_config_source", "policy_facts_summary", "policy_passed_gates", "policy_failed_gates"]) {
    assert(k in p, `approval_required missing audit field ${k}`);
  }
});
check("73. audit fields preserved on auto_authorized", async () => {
  const { calls } = await runPolicy({ snapshot: autoGuardedSnapshot(), quality: QUALITY_APLUS });
  assert(autoMod.validateDistributionAutoAuthorized(calls.published[0].payload).ok, "auto_authorized must pass strict validator with audit");
});
check("74. audit fields preserved on manual review", async () => {
  const { calls } = await runPolicy({ snapshot: manualReviewSnapshot(), quality: QUALITY_APLUS });
  const audit = auditMod.validatePolicyDecisionAuditContract(auditMod.pickPolicyAuditFields(calls.published[0].payload));
  assert(audit.ok && audit.value.policy_decision === DECISION.MANUAL_REVIEW, "manual review audit invalid");
});
let AUTO_PAYLOAD;
check("75. auto event requires active config source", async () => {
  const { calls } = await runPolicy({ snapshot: autoGuardedSnapshot(), quality: QUALITY_APLUS });
  AUTO_PAYLOAD = calls.published[0].payload;
  assert(autoMod.validateDistributionAutoAuthorized(AUTO_PAYLOAD).ok, "baseline auto payload must be valid");
  assert(!autoMod.validateDistributionAutoAuthorized({ ...AUTO_PAYLOAD, policy_config_source: SOURCE.SAFE_DEFAULT_NO_ACTIVE_CONFIG }).ok, "safe-default source must reject auto");
});
check("76. auto event requires config id", () => {
  assert(!autoMod.validateDistributionAutoAuthorized({ ...AUTO_PAYLOAD, policy_config_id: null }).ok, "null config id must reject auto");
});
check("77. auto event requires zero failed gates", () => {
  assert(!autoMod.validateDistributionAutoAuthorized({ ...AUTO_PAYLOAD, policy_failed_gates: ["minimum_auto_authorize_score"] }).ok, "non-empty failed gates must reject auto");
});
check("77b. safe-default source can never produce a valid auto_authorized contract", async () => {
  // Force an auto decision facts but with a safe-default snapshot: policy must NOT auto-authorize.
  const { calls } = await runPolicy({ snapshot: safeDefaultSnapshot(), quality: QUALITY_APLUS });
  assert(calls.published[0].eventType !== E.DISTRIBUTION_AUTO_AUTHORIZED, "safe default must never auto-authorize");
});

// ==========================================================================
// SECURITY / NON-GOALS
// ==========================================================================
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""); }
const changedSourceFiles = [
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionPolicyEvaluationExecutor.ts",
  "lib/aos/workflows/leadLifecycle/execution/leadLifecycleTaskExecutor.ts",
  "lib/aos/workflows/leadLifecycle/leadLifecycleHandler.ts",
  "lib/aos/workflows/leadLifecycle/leadLifecycleTaskIntents.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionValidation.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAdapters.ts",
];
const changedSource = stripComments(changedSourceFiles.map((f) => readFileSync(f, "utf8")).join("\n"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

check("78. no production migration applied", () => assert(gitPorcelain(["supabase/migrations", "db"]).length === 0, "migration changed/applied"));
check("79. no new migration created", () => assert(gitPorcelain(["supabase/migrations"]).length === 0, "new migration created"));
check("80. no WhatsApp", () => assert(!/sendWhatsApp|whatsappTool|createVendorLeadWhatsappPreview|whatsapp-dispatch|whatsapp_status/i.test(changedSource), "WhatsApp integration reference found"));
check("81. no n8n", () => assert(!/n8nTool|n8nSync|n8n_dispatch|callN8n|n8nPreviewWorkflow/i.test(changedSource), "n8n integration reference found"));
check("82. no provider outbox execution", () => assert(!/outbox_events|outboxCommands|command_type|qf_claim_due_outbox_event/i.test(changedSource), "outbox execution found"));
check("83. no production worker", () => assert(!/setInterval|while\s*\(\s*true\s*\)|claimOneDueWorkflowTask|qf_claim_due_workflow_task/i.test(changedSource), "worker loop found"));
check("84. PM2 unchanged", () => assert(!gitPorcelain().some((f) => /pm2|ecosystem/i.test(f)), "PM2 changed"));
check("85. UI unchanged", () => assert(gitPorcelain(["app", "components", "public"]).length === 0, "UI changed"));
check("86. protected services unchanged", () => {
  const protectedPaths = [
    "services/leadService.ts", "services/leadQualityService.ts", "services/leadClarificationService.ts",
    "services/leadMatchingEngine.ts", "services/leadDeliveryService.ts", "services/preferredVendorLeadService.ts",
    "services/delayedLeadFillService.ts", "services/clientRequirementGroupService.ts", "services/vendorService.ts",
    "services/aosService.ts", "lib/lead-assignment/runtimeSettings.ts",
  ];
  assert(gitPorcelain(protectedPaths).length === 0, "a protected service/runtimeSettings changed");
});
check("87. no direct credit math in AOS integration", () => assert(!/deductCredits|credit_balance|credits_before|credits_after|creditWallet|\.rpc\s*\(/i.test(changedSource), "credit math / direct RPC in AOS integration"));
check("88. no matching engine assignment helper used", () => assert(!/runAutoLeadMatchingForLead|getEligibleVendorsForLead|evaluateVendorsForLead|assignLeadToMatchedVendors|assign_lead_to_paid_vendors/.test(changedSource), "matching-engine/assignment helper used in integration"));
check("88b. test:phase4b2 wired", () => assert(pkg.scripts["test:phase4b2"] === "node scripts/phase4b2-policy-lifecycle-integration-harness.mjs", "test:phase4b2 not wired"));
check("88c. Phase 4B-2 doc exists", () => assert(existsSync("docs/aos/QF-Policy-Authorization-Integration-Phase-4B2.md"), "Phase 4B-2 doc missing"));

// ==========================================================================
// CORRECTION 1 — MANDATORY RESULT-EVENT PRE-READ
// ==========================================================================
async function runPolicyOmitReader() {
  const { deps, calls } = makePolicyDeps({ omitReader: true, snapshot: autoGuardedSnapshot(), quality: QUALITY_APLUS });
  return { calls, run: () => executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_POLICY_EVALUATE, { triggered_by_event: REC_EVENT_ID }), deps) };
}
check("C1.1. policy task without resultEventReader fails loudly", async () => {
  const { run } = await runPolicyOmitReader();
  await expectRejects(run, /DISTRIBUTION_POLICY_RESULT_EVENT_READER_REQUIRED/);
});
check("C1.2. missing reader fails before recommendation lookup", async () => {
  const { calls, run } = await runPolicyOmitReader();
  await expectRejects(run, /DISTRIBUTION_POLICY_RESULT_EVENT_READER_REQUIRED/);
  assert(calls.eventLookups.length === 0, "recommendation must not be looked up");
});
check("C1.3. missing reader fails before route read", async () => {
  const { calls, run } = await runPolicyOmitReader();
  await expectRejects(run, /DISTRIBUTION_POLICY_RESULT_EVENT_READER_REQUIRED/);
  assert(calls.routeReads === 0, "route must not be read");
});
check("C1.4. missing reader fails before quality read", async () => {
  const { calls, run } = await runPolicyOmitReader();
  await expectRejects(run, /DISTRIBUTION_POLICY_RESULT_EVENT_READER_REQUIRED/);
  assert(calls.qualityReads === 0, "quality must not be read");
});
check("C1.5. missing reader fails before config load", async () => {
  const { calls, run } = await runPolicyOmitReader();
  await expectRejects(run, /DISTRIBUTION_POLICY_RESULT_EVENT_READER_REQUIRED/);
  assert(calls.configLoads === 0, "config must not be loaded");
});
check("C1.6. missing reader publishes no event", async () => {
  const { calls, run } = await runPolicyOmitReader();
  await expectRejects(run, /DISTRIBUTION_POLICY_RESULT_EVENT_READER_REQUIRED/);
  assert(calls.published.length === 0, "no event may be published");
});
check("C1.7. first attempt with reader returning null evaluates once", async () => {
  const { result, calls } = await runPolicy({ snapshot: autoGuardedSnapshot(), quality: QUALITY_APLUS });
  assert(calls.resultReads === 1, "pre-read must run exactly once");
  assert(calls.configLoads === 1 && calls.qualityReads === 1 && calls.published.length === 1, "must evaluate + publish once");
  assert(result.result.policy_result_reused === false, "first attempt must not be a reuse");
});
check("C1.8. replay pre-read runs before recommendation/config/quality and reuses (no republish)", async () => {
  const { repo, result, calls } = await seedThenReplay({ snapshot: autoGuardedSnapshot(), quality: QUALITY_APLUS });
  assert(result.result.policy_result_reused === true, "replay must reuse");
  assert(calls.eventLookups.length === 0, "replay must not resolve recommendation");
  assert(calls.configLoads === 0 && calls.qualityReads === 0, "replay must not reload config / reread quality");
  assert(repo.insertCount === 1 && calls.published.length === 0, "replay must not republish");
});

// ==========================================================================
// CORRECTION 2 — AUTO AUTHORIZATION CROSS-BOUND TO ORIGINAL MATCHING EVENT
// ==========================================================================
check("C2.1. valid auto event matching original matching snapshot passes", async () => {
  const authEvent = await buildAutoEvent(ABC);
  const r = await resolveAuth(authEvent, makeMatchingEvent({ recommendedVendorIds: ABC }));
  assert(r.ok && r.value.authorizedVendorIds.join(",") === "vA,vB,vC", "valid cross-bound auto must resolve");
});
check("C2.2. internally-consistent auto but different from matching snapshot rejected", async () => {
  const authEvent = await buildAutoEvent(["vA", "vC"]); // internally consistent [vA,vC]
  const r = await resolveAuth(authEvent, makeMatchingEvent({ recommendedVendorIds: ["vA", "vB"] }));
  assert(!r.ok && r.message === "AUTO_AUTH_RECOMMENDATION_SNAPSHOT_MISMATCH", `got ${r.message}`);
});
check("C2.3. reordered auto list relative to original matching rejected", async () => {
  const authEvent = await buildAutoEvent(["vB", "vA"]);
  const r = await resolveAuth(authEvent, makeMatchingEvent({ recommendedVendorIds: ["vA", "vB"] }));
  assert(!r.ok && r.message === "AUTO_AUTH_RECOMMENDATION_SNAPSHOT_MISMATCH", `got ${r.message}`);
});
check("C2.4. recommendation count mismatch rejected", async () => {
  const authEvent = await buildAutoEvent(["vA", "vB", "vC"]);
  const r = await resolveAuth(authEvent, makeMatchingEvent({ recommendedVendorIds: ["vA", "vB"] }));
  assert(!r.ok && r.message === "AUTO_AUTH_RECOMMENDATION_SNAPSHOT_MISMATCH", `got ${r.message}`);
});
check("C2.5. missing original recommendation event rejected", async () => {
  const authEvent = await buildAutoEvent(ABC);
  const r = await resolveAuth(authEvent, null); // matching event absent from the port
  assert(!r.ok && r.message === "RECOMMENDATION_EVENT_NOT_FOUND", `got ${r.message}`);
});
check("C2.6. wrong recommendation event lead rejected", async () => {
  const authEvent = await buildAutoEvent(ABC);
  const r = await resolveAuth(authEvent, makeMatchingEvent({ recommendedVendorIds: ABC, leadId: "lead_OTHER" }));
  assert(!r.ok && r.message === "RECOMMENDATION_EVENT_LEAD_MISMATCH", `got ${r.message}`);
});
check("C2.7. wrong recommendation event workflow rejected", async () => {
  const authEvent = await buildAutoEvent(ABC);
  const r = await resolveAuth(authEvent, makeMatchingEvent({ recommendedVendorIds: ABC, workflowId: "wf_OTHER" }));
  assert(!r.ok && r.message === "RECOMMENDATION_EVENT_WORKFLOW_MISMATCH", `got ${r.message}`);
});
check("C2.8. no assignment call after auto binding failure", async () => {
  const authEvent = await buildAutoEvent(["vA", "vC"]);
  const { deps, calls } = makePrepareDeps(authEvent, { matchingIds: ["vA", "vB"] });
  await expectRejects(() => executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE, { triggered_by_event: authEvent.id }), deps), /AUTO_AUTH_RECOMMENDATION_SNAPSHOT_MISMATCH/);
  assert(calls.assign === 0, "no assignment after binding failure");
});
check("C2.9. no credit mutation after auto binding failure", async () => {
  const authEvent = await buildAutoEvent(["vB", "vA"]);
  const { deps, calls } = makePrepareDeps(authEvent, { matchingIds: ["vA", "vB"] });
  await expectRejects(() => executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE, { triggered_by_event: authEvent.id }), deps), /AUTO_AUTH_RECOMMENDATION_SNAPSHOT_MISMATCH/);
  // Credits are only ever mutated inside the assignment boundary; no assignment ⇒ no credit mutation.
  assert(calls.assign === 0 && calls.published.length === 0, "no credit-affecting assignment/publish after binding failure");
});

// ==========================================================================
// CORRECTION 3 — MANUAL REVIEW REPLAY REASON MUST MATCH AUDIT
// ==========================================================================
async function realManualReviewPayload() {
  const { calls } = await runPolicy({ snapshot: manualReviewSnapshot(), quality: QUALITY_APLUS });
  return calls.published[0].payload;
}
check("C3.1. matching manual reason and policy reason reuses successfully", async () => {
  const { result } = await seedThenReplay({ snapshot: manualReviewSnapshot(), quality: QUALITY_APLUS });
  assert(result.result.policy_result_reused === true && result.result.published_event_type === E.MANUAL_REVIEW_REQUIRED, "matching manual reason must reuse");
});
check("C3.2. non-empty but different manual reason rejected", async () => {
  const payload = await realManualReviewPayload();
  const tampered = makeDomainEvent({ eventType: E.MANUAL_REVIEW_REQUIRED, entityId: LEAD_ID, correlationId: WORKFLOW_ID, causationId: REC_EVENT_ID, payload: { ...payload, reason: "some_other_nonempty_reason" } });
  await expectRejects(() => runWithSeededResult(tampered), /POLICY_RESULT_REPLAY_INTEGRITY_ERROR:MANUAL_REASON_MISMATCH/);
});
check("C3.3. manual-reason mismatch rejection performs no reevaluation", async () => {
  const payload = await realManualReviewPayload();
  const tampered = makeDomainEvent({ eventType: E.MANUAL_REVIEW_REQUIRED, entityId: LEAD_ID, correlationId: WORKFLOW_ID, causationId: REC_EVENT_ID, payload: { ...payload, reason: "another_reason" } });
  const repo = new InMemoryRepo();
  seedBadEvent(repo, "task_reason_mismatch", tampered);
  const { deps, calls } = makePolicyDeps({ publisher: new publisherMod.DurableLeadLifecycleEventPublisher(repo), resultEventReader: readerFor(repo) });
  await expectRejects(() => executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_POLICY_EVALUATE, { triggered_by_event: REC_EVENT_ID, __taskId: "task_reason_mismatch" }), deps), /MANUAL_REASON_MISMATCH/);
  assert(calls.configLoads === 0 && calls.qualityReads === 0 && calls.eventLookups.length === 0 && repo.insertCount === 0 && calls.published.length === 0, "mismatch must not reload config / reread quality / resolve recommendation / republish");
});

// ==========================================================================
// DEFAULT ADAPTER WIRING (Correction 1 runtime construction path)
// ==========================================================================
check("C1.9. default executor ports construct a Supabase result-event reader", () => {
  const adaptersSrc = readFileSync("lib/aos/workflows/leadLifecycle/distribution/leadDistributionAdapters.ts", "utf8");
  assert(/class SupabaseLeadLifecycleResultEventReaderPort/.test(adaptersSrc), "reader port class missing");
  assert(/resultEventReader:\s*new SupabaseLeadLifecycleResultEventReaderPort\(\)/.test(adaptersSrc), "default executor ports must construct the reader");
  assert(/policyConfig:\s*new SupabaseLeadLifecyclePolicyConfigPort\(\)/.test(adaptersSrc), "default executor ports must construct the policy config port");
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
  console.error(`\n${failures.length} Phase 4B-2 policy-lifecycle integration check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${results.length} Phase 4B-2 policy-lifecycle integration checks passed.`);
