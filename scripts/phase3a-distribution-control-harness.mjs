import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

/**
 * Phase 3A — QuickFurno Distribution Control & Approval Contract harness.
 *
 * SOURCE/STATIC harness. Compiles the pure distribution modules plus the Phase 2B
 * executor chain to a throwaway build, then exercises the controlled STANDARD-route
 * distribution decision and human approval contract with injected in-memory ports.
 *
 * It does NOT connect to any database, assign vendors, deduct credits, deliver
 * leads, send WhatsApp, call n8n, execute any outbox command, or start a worker.
 */

const outDir = resolve(".phase3a-test-build");
rmSync(outDir, { recursive: true, force: true });

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const files = [
  "lib/lead-quality/budgetFit.ts",
  "lib/supabase.ts",
  "lib/aos/workflow/workflowPersistenceTypes.ts",
  "lib/aos/workflows/leadLifecycle/leadLifecycleStates.ts",
  "lib/aos/workflows/leadLifecycle/leadLifecycleEvents.ts",
  "lib/aos/workflows/leadLifecycle/leadLifecycleTaskIntents.ts",
  "lib/aos/workflows/leadLifecycle/leadLifecycleTypes.ts",
  "lib/aos/workflows/leadLifecycle/leadLifecycleValidation.ts",
  "lib/aos/workflows/leadLifecycle/adapters/leadLifecycleServicePorts.ts",
  "lib/aos/workflows/leadLifecycle/events/leadLifecycleResultMapper.ts",
  "lib/aos/workflows/leadLifecycle/events/leadLifecycleEventPublisher.ts",
  "lib/aos/workflows/leadLifecycle/execution/leadLifecycleTaskExecutionTypes.ts",
  "lib/aos/workflows/leadLifecycle/execution/leadLifecycleTaskExecutor.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionTypes.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionValidation.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionRecommendationResolver.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionRouteGuard.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionApprovalPublisher.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionApprovalBinding.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionApprovalService.ts",
  "services/leadQualityService.ts",
];

const tsconfigPath = resolve(".phase3a-tsconfig.json");
writeFileSync(tsconfigPath, JSON.stringify({
  compilerOptions: {
    module: "commonjs",
    target: "ES2020",
    moduleResolution: "node",
    skipLibCheck: true,
    esModuleInterop: true,
    strict: true,
    jsx: "preserve",
    outDir,
    rootDir: ".",
    baseUrl: ".",
    paths: { "@/*": ["./*"] },
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
const publisherMod = requireFromBuild(`${D}/events/leadLifecycleEventPublisher.js`);
const executorMod = requireFromBuild(`${D}/execution/leadLifecycleTaskExecutor.js`);
const validationMod = requireFromBuild(`${D}/distribution/leadDistributionValidation.js`);
const resolverMod = requireFromBuild(`${D}/distribution/leadDistributionRecommendationResolver.js`);
const routeGuardMod = requireFromBuild(`${D}/distribution/leadDistributionRouteGuard.js`);
const approvalPubMod = requireFromBuild(`${D}/distribution/leadDistributionApprovalPublisher.js`);
const approvalSvcMod = requireFromBuild(`${D}/distribution/leadDistributionApprovalService.js`);
const bindingMod = requireFromBuild(`${D}/distribution/leadDistributionApprovalBinding.js`);
const typesMod = requireFromBuild(`${D}/distribution/leadDistributionTypes.js`);

const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function expectRejects(fn, pattern) {
  try {
    await fn();
  } catch (error) {
    if (!pattern || pattern.test(String(error?.message ?? error))) return;
    throw new Error(`wrong rejection: ${String(error?.message ?? error)}`);
  }
  throw new Error("Expected rejection");
}

const E = events.LeadLifecycleEventType;
const T = tasks.LeadLifecycleTaskIntent;
const S = states.LeadLifecycleState;
const WF_TYPE = states.LEAD_LIFECYCLE_WORKFLOW_TYPE;

const LEAD_ID = "lead_std_1";
const WORKFLOW_ID = "wf_std_1";
const MATCH_EVENT_ID = "evt_match_std_1";
function routing(o = {}) {
  return {
    leadIntent: o.leadIntent ?? null,
    targetVendorId: o.targetVendorId ?? null,
    preferredVendorId: o.preferredVendorId ?? null,
    requirementGroupId: o.requirementGroupId ?? null,
    selectedVendorId: o.selectedVendorId ?? null,
    assignmentIntent: o.assignmentIntent ?? null,
  };
}
const STANDARD_ROUTING = routing({ leadIntent: "general_auto_match" });

let counter = 0;
const allPublished = [];

function quality(overrides = {}) {
  return {
    contact_score: 20, location_score: 20, requirement_score: 25, intent_score: 25,
    fraud_penalty: 0, total_score: 90, location_confidence: 4, score_class: "A+",
    hard_block_reason: null, recommended_action: "auto_distribute", score_breakdown: {}, ...overrides,
  };
}

function makeDomainEvent(input, n = ++counter) {
  return {
    id: input.id ?? `evt_out_${n}`,
    event_type: input.eventType,
    entity_type: input.entityType,
    entity_id: input.entityId,
    payload_version: 1,
    payload_json: input.payload,
    trace_id: input.traceId ?? null,
    correlation_id: input.correlationId ?? null,
    causation_id: input.causationId ?? null,
    idempotency_key: input.idempotencyKey ?? null,
    processing_status: "pending",
    processed_at: null,
    created_at: "2026-07-07T00:00:00.000Z",
    updated_at: "2026-07-07T00:00:00.000Z",
    locked_at: null, locked_by: null, attempt_count: 0, max_attempts: 5, next_retry_at: null,
  };
}

function makeMatchingEvent(opts = {}) {
  const ids = opts.ids ?? ["vA", "vB", "vC"];
  const count = opts.count ?? ids.length;
  return {
    id: opts.id ?? MATCH_EVENT_ID,
    event_type: opts.eventType ?? E.MATCHING_COMPLETED,
    entity_type: opts.entityType ?? "lead",
    entity_id: opts.entityId ?? LEAD_ID,
    payload_version: 1,
    payload_json: {
      workflow_type: opts.workflowType ?? WF_TYPE,
      lead_id: opts.payloadLeadId ?? (opts.entityId ?? LEAD_ID),
      recommended_vendor_count: count,
      recommended_vendor_ids: ids,
      ...(opts.extraPayload ?? {}),
    },
    trace_id: null,
    correlation_id: opts.correlationId === undefined ? WORKFLOW_ID : opts.correlationId,
    causation_id: null, idempotency_key: null,
    processing_status: "processed", processed_at: null,
    created_at: "2026-07-07T00:00:00.000Z", updated_at: "2026-07-07T00:00:00.000Z",
    locked_at: null, locked_by: null, attempt_count: 0, max_attempts: 5, next_retry_at: null,
  };
}

function expectation(opts = {}) {
  return {
    recommendationEventId: opts.recommendationEventId ?? MATCH_EVENT_ID,
    expectedWorkflowInstanceId: opts.expectedWorkflowInstanceId ?? WORKFLOW_ID,
    expectedLeadId: opts.expectedLeadId ?? LEAD_ID,
  };
}

function makeTask(taskType, payload = {}) {
  return {
    id: `task_${taskType.replace(/\W/g, "_")}_${(++counter).toString(16)}`,
    workflow_instance_id: WORKFLOW_ID,
    task_type: taskType,
    status: "processing",
    priority: 100,
    due_at: "2026-07-07T00:00:00.000Z",
    attempt_count: 0, max_attempts: 5, next_retry_at: null,
    locked_at: "2026-07-07T00:00:00.000Z", locked_by: "worker_phase3a", idempotency_key: null,
    payload_json: { lead_id: LEAD_ID, workflow_instance_id: WORKFLOW_ID, triggered_by_event: MATCH_EVENT_ID, ...payload },
    result_json: {}, last_error: null,
    created_at: "2026-07-07T00:00:00.000Z", started_at: "2026-07-07T00:00:00.000Z", completed_at: null,
    updated_at: "2026-07-07T00:00:00.000Z",
  };
}

function makeExecutorDeps(opts = {}) {
  const calls = { quality: 0, latestQuality: 0, clarification: 0, matching: 0, published: [], routingReads: [], eventLookups: [] };
  const publisher = {
    async publish(input) {
      calls.published.push(input);
      const evt = makeDomainEvent({
        eventType: input.eventType, entityType: "lead", entityId: input.leadId,
        payload: { workflow_type: WF_TYPE, lead_id: input.leadId, ...(input.payload ?? {}) },
        correlationId: input.correlationId ?? null, causationId: input.causationId ?? null,
        idempotencyKey: publisherMod.buildLeadLifecycleResultEventIdempotencyKey(input.workflowTaskId),
      });
      allPublished.push({ eventType: input.eventType, payload: evt.payload_json });
      return evt;
    },
  };
  const eventMap = new Map();
  for (const e of (opts.events ?? [makeMatchingEvent()])) eventMap.set(e.id, e);
  return {
    calls,
    deps: {
      ports: {
        quality: { async scoreLead() { calls.quality += 1; return quality(); } },
        latestQuality: { async readLatestQualityResult() { calls.latestQuality += 1; return quality(); } },
        clarification: { async prepareClarification() { calls.clarification += 1; return { requestId: "c", status: "s", missingFields: [], questionsCount: 0 }; } },
        matchingRecommendation: { async prepareRecommendations() { calls.matching += 1; return { leadId: LEAD_ID, eligibleVendorCount: 0, recommendedVendorIds: [] }; } },
      },
      resultEventPublisher: opts.publisher ?? publisher,
      distribution: {
        recommendationEventPort: { async getDomainEventById(id) { calls.eventLookups.push(id); return eventMap.get(id) ?? null; } },
        routingPort: { async readLeadRouting(leadId) { calls.routingReads.push(leadId); return opts.routing ?? STANDARD_ROUTING; } },
      },
    },
  };
}

class InMemoryDomainEventRepository {
  constructor() { this.byKey = new Map(); this.insertCount = 0; this.failUnrelated = false; }
  async insert(input) {
    this.insertCount += 1;
    if (this.failUnrelated) throw new Error("POSTGREST_UNRELATED_FAILURE");
    if (this.byKey.has(input.idempotencyKey)) throw { code: "23505", message: "duplicate key violates idempotency index" };
    const event = makeDomainEvent(input, this.insertCount);
    this.byKey.set(input.idempotencyKey, event);
    allPublished.push({ eventType: input.eventType, payload: event.payload_json });
    return event;
  }
  async findByIdempotencyKey(key) { return this.byKey.get(key) ?? null; }
}

function makeWorkflow(opts = {}) {
  return {
    id: opts.id ?? WORKFLOW_ID,
    workflow_type: opts.workflow_type ?? WF_TYPE,
    entity_type: opts.entity_type ?? "lead",
    entity_id: opts.entity_id ?? LEAD_ID,
    current_state: opts.current_state ?? S.DISTRIBUTION_APPROVAL_PENDING,
    status: "active", version: 1, context_json: {},
    started_at: "2026-07-07T00:00:00.000Z", updated_at: "2026-07-07T00:00:00.000Z",
    completed_at: null, last_error: null, created_at: "2026-07-07T00:00:00.000Z",
  };
}

function makeTransition(metadata_json) {
  return {
    id: "tr_1",
    workflow_instance_id: WORKFLOW_ID,
    from_state: S.MATCH_RECOMMENDATION_READY,
    to_state: S.DISTRIBUTION_APPROVAL_PENDING,
    event_type: E.DISTRIBUTION_APPROVAL_REQUIRED,
    reason: null,
    metadata_json,
    created_by: "workflow_kernel",
    created_at: "2026-07-07T00:00:00.000Z",
  };
}

function makeApprovalDeps(opts = {}) {
  const repo = opts.repo ?? new InMemoryDomainEventRepository();
  const eventMap = new Map();
  for (const e of (opts.recEvents ?? [opts.recEvent ?? makeMatchingEvent({ ids: ["vA", "vB", "vC"] })])) eventMap.set(e.id, e);
  const recEvent = opts.recEvent ?? [...eventMap.values()][0];
  // Approval binding: the recommendation snapshot currently awaiting approval.
  const bindingRecId = opts.bindingRecId !== undefined ? opts.bindingRecId : recEvent.id;
  const bindingTransition = opts.bindingNull
    ? null
    : makeTransition(opts.bindingMetadata !== undefined ? opts.bindingMetadata : { recommendation_event_id: bindingRecId, lead_id: LEAD_ID });
  const deps = {
    recommendationEventPort: { async getDomainEventById(id) { return eventMap.get(id) ?? null; } },
    routingPort: { async readLeadRouting() { return opts.routing ?? STANDARD_ROUTING; } },
    workflowStatePort: { async getWorkflowInstanceById() { return opts.workflow === null ? null : (opts.workflow ?? makeWorkflow()); } },
    bindingPort: { async readCurrentApprovalBindingTransition() { return bindingTransition; } },
    approvalPublisher: opts.approvalPublisher ?? new approvalPubMod.DurableLeadDistributionApprovalPublisher(repo),
  };
  return { deps, repo, recEvent };
}

function approveInput(opts = {}) {
  return {
    workflowInstanceId: opts.workflowInstanceId ?? WORKFLOW_ID,
    leadId: opts.leadId ?? LEAD_ID,
    recommendationEventId: opts.recommendationEventId ?? MATCH_EVENT_ID,
    approvedVendorIds: opts.approvedVendorIds ?? ["vA", "vB"],
    approvedBy: opts.approvedBy ?? "admin_1",
    reason: opts.reason,
  };
}

// ==========================================================================
// RECOMMENDATION SNAPSHOT
// ==========================================================================
check("1. valid 1-vendor snapshot resolves", async () => {
  const r = validationMod.validateRecommendationEventSnapshot(makeMatchingEvent({ ids: ["vA"] }), expectation());
  assert(r.ok && r.value.recommendedVendorCount === 1 && r.value.recommendedVendorIds.join() === "vA", "1-vendor snapshot invalid");
});
check("2. valid 3-vendor snapshot resolves", () => {
  const r = validationMod.validateRecommendationEventSnapshot(makeMatchingEvent({ ids: ["vA", "vB", "vC"] }), expectation());
  assert(r.ok && r.value.recommendedVendorCount === 3, "3-vendor snapshot invalid");
});
check("3. valid zero-vendor snapshot resolves", () => {
  const r = validationMod.validateRecommendationEventSnapshot(makeMatchingEvent({ ids: [], count: 0 }), expectation());
  assert(r.ok && r.value.recommendedVendorCount === 0 && r.value.recommendedVendorIds.length === 0, "zero snapshot invalid");
});
check("4. count/array length mismatch rejected", () => {
  const r = validationMod.validateRecommendationEventSnapshot(makeMatchingEvent({ ids: ["vA", "vB"], count: 3 }), expectation());
  assert(!r.ok && r.message === "RECOMMENDATION_VENDOR_IDS_COUNT_MISMATCH", `got ${r.message}`);
});
check("5. count > 3 rejected", () => {
  const r = validationMod.validateRecommendationEventSnapshot(makeMatchingEvent({ ids: ["vA", "vB", "vC", "vD"], count: 4 }), expectation());
  assert(!r.ok && r.message === "RECOMMENDATION_VENDOR_COUNT_INVALID", `got ${r.message}`);
});
check("6. duplicate vendor IDs rejected", () => {
  const r = validationMod.validateRecommendationEventSnapshot(makeMatchingEvent({ ids: ["vA", "vA"], count: 2 }), expectation());
  assert(!r.ok && r.message === "VENDOR_IDS_MUST_BE_UNIQUE", `got ${r.message}`);
});
check("6b. blank/non-string vendor id rejected", () => {
  const r1 = validationMod.validateRecommendationEventSnapshot(makeMatchingEvent({ ids: ["vA", "  "], count: 2 }), expectation());
  const r2 = validationMod.validateRecommendationEventSnapshot(makeMatchingEvent({ ids: ["vA", 7], count: 2 }), expectation());
  assert(!r1.ok && !r2.ok, "blank/non-string vendor id must reject");
});
check("7. wrong event type rejected", () => {
  const r = validationMod.validateRecommendationEventSnapshot(makeMatchingEvent({ eventType: E.QUALITY_RESULTED }), expectation());
  assert(!r.ok && r.message === "RECOMMENDATION_EVENT_TYPE_INVALID", `got ${r.message}`);
});
check("8. wrong lead identity rejected", () => {
  const r = validationMod.validateRecommendationEventSnapshot(makeMatchingEvent({ entityId: "lead_OTHER", payloadLeadId: "lead_OTHER" }), expectation());
  assert(!r.ok && r.message === "RECOMMENDATION_EVENT_LEAD_MISMATCH", `got ${r.message}`);
});
check("9. wrong workflow type rejected", () => {
  const r = validationMod.validateRecommendationEventSnapshot(makeMatchingEvent({ workflowType: "qf_other" }), expectation());
  assert(!r.ok && r.message === "RECOMMENDATION_EVENT_WORKFLOW_TYPE_INVALID", `got ${r.message}`);
});
check("9b. wrong workflow instance (correlation) rejected", () => {
  const r = validationMod.validateRecommendationEventSnapshot(makeMatchingEvent({ correlationId: "wf_OTHER" }), expectation());
  assert(!r.ok && r.message === "RECOMMENDATION_EVENT_WORKFLOW_MISMATCH", `got ${r.message}`);
});
check("9c. wrong entity_type rejected", () => {
  const r = validationMod.validateRecommendationEventSnapshot(makeMatchingEvent({ entityType: "vendor" }), expectation());
  assert(!r.ok && r.message === "RECOMMENDATION_EVENT_ENTITY_TYPE_INVALID", `got ${r.message}`);
});
check("10. recommendation order preserved exactly", () => {
  const r = validationMod.validateRecommendationEventSnapshot(makeMatchingEvent({ ids: ["vZ", "vM", "vA"] }), expectation());
  assert(r.ok && r.value.recommendedVendorIds.join(",") === "vZ,vM,vA", "order changed");
});
check("10b. snapshot is immutable (frozen)", () => {
  const r = validationMod.validateRecommendationEventSnapshot(makeMatchingEvent({ ids: ["vA", "vB"] }), expectation());
  assert(r.ok && Object.isFrozen(r.value) && Object.isFrozen(r.value.recommendedVendorIds), "snapshot not frozen");
});
check("10c. resolver loads event via port then validates", async () => {
  const port = { async getDomainEventById() { return makeMatchingEvent({ ids: ["vA", "vB"] }); } };
  const r = await resolverMod.resolveLeadDistributionRecommendation(expectation(), port);
  assert(r.ok && r.value.recommendedVendorCount === 2, "resolver failed valid load");
});
check("10d. resolver rejects missing event (not found)", async () => {
  const port = { async getDomainEventById() { return null; } };
  const r = await resolverMod.resolveLeadDistributionRecommendation(expectation(), port);
  assert(!r.ok && r.message === "RECOMMENDATION_EVENT_NOT_FOUND", `got ${r.message}`);
});

// ==========================================================================
// APPROVAL PREPARATION (executor prepare_approval)
// ==========================================================================
for (const [n, ids] of [["11a", ["vA"]], ["11b", ["vA", "vB"]], ["11c", ["vA", "vB", "vC"]]]) {
  check(`${n}. ${ids.length} recommendation(s) -> approval_required`, async () => {
    const { deps, calls } = makeExecutorDeps({ events: [makeMatchingEvent({ ids })] });
    const result = await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE_APPROVAL), deps);
    assert(result.status === "completed", `status ${result.status}`);
    assert(calls.published[0].eventType === E.DISTRIBUTION_APPROVAL_REQUIRED, "expected approval_required");
    assert(calls.published[0].payload.recommended_vendor_ids.join(",") === ids.join(","), "snapshot ids not bound");
  });
}
check("12. zero recommendations -> manual_review.required", async () => {
  const { deps, calls } = makeExecutorDeps({ events: [makeMatchingEvent({ ids: [], count: 0 })] });
  await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE_APPROVAL), deps);
  assert(calls.published[0].eventType === E.MANUAL_REVIEW_REQUIRED, "expected manual_review.required");
  assert(calls.published[0].payload.reason === "no_distribution_recommendations", "wrong reason");
});
check("13. zero recommendations NEVER emits approval_required", async () => {
  const { deps, calls } = makeExecutorDeps({ events: [makeMatchingEvent({ ids: [], count: 0 })] });
  await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE_APPROVAL), deps);
  assert(!calls.published.some((p) => p.eventType === E.DISTRIBUTION_APPROVAL_REQUIRED), "must not emit approval_required for zero");
});
check("14. preparation uses triggered_by_event as recommendation source", async () => {
  const { deps, calls } = makeExecutorDeps({ events: [makeMatchingEvent({ id: "evt_specific", ids: ["vA"] })] });
  await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE_APPROVAL, { triggered_by_event: "evt_specific" }), deps);
  assert(calls.eventLookups[0] === "evt_specific", "did not resolve the triggering event");
  assert(calls.published[0].payload.recommendation_event_id === "evt_specific", "bound wrong recommendation event");
});
check("14b. missing triggered_by_event rejected", async () => {
  const { deps } = makeExecutorDeps();
  await expectRejects(() => executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE_APPROVAL, { triggered_by_event: "" }), deps), /RECOMMENDATION_EVENT_ID_REQUIRED/);
});
check("15. no matching rerun during preparation", async () => {
  const { deps, calls } = makeExecutorDeps();
  await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE_APPROVAL), deps);
  assert(calls.matching === 0 && calls.quality === 0 && calls.latestQuality === 0, "must not rerun matching/scoring");
});
const cls = (o) => routeGuardMod.classifyLeadDistributionRoute(routing(o));

check("16. standard route accepted (publishes approval_required)", async () => {
  const { deps, calls } = makeExecutorDeps({ routing: STANDARD_ROUTING });
  const result = await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE_APPROVAL), deps);
  assert(result.status === "completed" && calls.published[0].eventType === E.DISTRIBUTION_APPROVAL_REQUIRED, "standard route not accepted");
});
check("16b. classifier: plain standard lead -> standard_route", () => {
  const d = cls({ leadIntent: "general_auto_match" });
  assert(d.classification === "standard_route" && d.isStandardRoute === true, "standard misclassified");
});
check("16c. classifier: no routing fields at all -> standard_route", () => {
  assert(cls({}).classification === "standard_route", "empty routing must be standard");
});
check("17. classifier: requirement_group_id -> requirement_group_route", () => {
  const d = cls({ requirementGroupId: "grp_1" });
  assert(d.classification === "requirement_group_route" && d.isStandardRoute === false, "req group misclassified");
});
check("17b. classifier: selected_vendor_id (no req group) -> client_selected_route", () => {
  const d = cls({ selectedVendorId: "vSel" });
  assert(d.classification === "client_selected_route" && d.isStandardRoute === false, `got ${d.classification}`);
});
check("17c. classifier: assignment_intent=client_selected_vendor -> client_selected_route", () => {
  const d = cls({ assignmentIntent: "client_selected_vendor" });
  assert(d.classification === "client_selected_route" && d.isStandardRoute === false, `got ${d.classification}`);
});
check("17d. classifier precedence: selected_vendor + preferred fields -> client_selected_route", () => {
  const d = cls({ selectedVendorId: "vSel", preferredVendorId: "vP", targetVendorId: "vT", leadIntent: "preferred_vendor" });
  assert(d.classification === "client_selected_route", `client-selected must win over preferred, got ${d.classification}`);
});
check("17e. classifier precedence: requirement_group wins over client_selected", () => {
  const d = cls({ requirementGroupId: "grp_1", selectedVendorId: "vSel", assignmentIntent: "client_selected_vendor" });
  assert(d.classification === "requirement_group_route", `req group must win, got ${d.classification}`);
});
check("17f. arbitrary assignment_intent (not client_selected_vendor) is not client-selected", () => {
  // No broad fuzzy matching: only the exact value routes to client_selected.
  const d = cls({ assignmentIntent: "auto_match", leadIntent: "general_auto_match" });
  assert(d.classification === "standard_route", `unexpected ${d.classification}`);
});
check("18. classifier: lead_intent=preferred_vendor -> preferred_vendor_route", () => {
  assert(cls({ leadIntent: "preferred_vendor" }).classification === "preferred_vendor_route", "preferred intent misclassified");
});
check("18b. classifier: target_vendor_id -> preferred_vendor_route", () => {
  assert(cls({ targetVendorId: "vT" }).classification === "preferred_vendor_route", "target vendor misclassified");
});
check("18c. classifier: preferred_vendor_id -> preferred_vendor_route", () => {
  assert(cls({ preferredVendorId: "vP" }).classification === "preferred_vendor_route", "preferred vendor id misclassified");
});
check("19. executor: preferred-vendor route deferred (no event)", async () => {
  const { deps, calls } = makeExecutorDeps({ routing: routing({ leadIntent: "preferred_vendor", preferredVendorId: "vP" }) });
  const result = await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE_APPROVAL), deps);
  assert(result.status === "deferred_special_route" && result.result.route_classification === "preferred_vendor_route", `got ${result.result.route_classification}`);
  assert(calls.published.length === 0, "deferred route must publish nothing");
});
check("19b. executor: requirement-group route deferred (no event)", async () => {
  const { deps, calls } = makeExecutorDeps({ routing: routing({ requirementGroupId: "grp_1" }) });
  const result = await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE_APPROVAL), deps);
  assert(result.status === "deferred_special_route" && result.result.route_classification === "requirement_group_route", `got ${result.result.route_classification}`);
  assert(calls.published.length === 0, "deferred route must publish nothing");
});
check("19c. executor: client-selected (selected_vendor_id) prepare -> deferred_special_route", async () => {
  const { deps } = makeExecutorDeps({ routing: routing({ selectedVendorId: "vSel" }) });
  const result = await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE_APPROVAL), deps);
  assert(result.status === "deferred_special_route" && result.result.route_classification === "client_selected_route", `got ${result.result.route_classification}`);
});
check("19d. executor: client-selected prepare publishes no event", async () => {
  const { deps, calls } = makeExecutorDeps({ routing: routing({ assignmentIntent: "client_selected_vendor" }) });
  await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE_APPROVAL), deps);
  assert(calls.published.length === 0, "client-selected route must publish nothing");
});
check("19e. executor: client-selected prepare performs no assignment", async () => {
  const { deps } = makeExecutorDeps({ routing: routing({ selectedVendorId: "vSel" }) });
  const result = await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE_APPROVAL), deps);
  assert(result.result.assignment_executed === false && result.result.credit_mutation_executed === false && result.result.delivery_executed === false, "client-selected route claims a side effect");
});
check("20. deferred special route performs no assignment/side effect", async () => {
  const { deps } = makeExecutorDeps({ routing: routing({ leadIntent: "preferred_vendor" }) });
  const result = await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE_APPROVAL), deps);
  assert(result.result.assignment_executed === false && result.result.credit_mutation_executed === false && result.result.delivery_executed === false, "deferred route claims a side effect");
});
check("20b. Supabase routing adapter reads selected_vendor_id and assignment_intent", () => {
  const src = readFileSync("lib/aos/workflows/leadLifecycle/distribution/leadDistributionAdapters.ts", "utf8");
  assert(/selected_vendor_id/.test(src) && /assignment_intent/.test(src), "adapter must read the new routing columns");
});

// ==========================================================================
// HUMAN APPROVAL
// ==========================================================================
check("21. approved_by required", async () => {
  const { deps } = makeApprovalDeps();
  const input = { workflowInstanceId: WORKFLOW_ID, leadId: LEAD_ID, recommendationEventId: MATCH_EVENT_ID, approvedVendorIds: ["vA", "vB"] };
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(input, deps), /DISTRIBUTION_APPROVED_BY_REQUIRED/);
});
check("22. blank approved_by rejected", async () => {
  const { deps } = makeApprovalDeps();
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput({ approvedBy: "   " }), deps), /DISTRIBUTION_APPROVED_BY_REQUIRED/);
});
check("23. approved list minimum 1", async () => {
  const { deps } = makeApprovalDeps();
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput({ approvedVendorIds: [] }), deps), /DISTRIBUTION_APPROVED_COUNT_INVALID/);
});
check("24. approved list maximum 3", async () => {
  const { deps } = makeApprovalDeps();
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput({ approvedVendorIds: ["vA", "vB", "vC", "vD"] }), deps), /DISTRIBUTION_APPROVED_COUNT_INVALID/);
});
check("25. duplicate approved IDs rejected", async () => {
  const { deps } = makeApprovalDeps();
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput({ approvedVendorIds: ["vA", "vA"] }), deps), /VENDOR_IDS_MUST_BE_UNIQUE/);
});
check("26. un-recommended vendor rejected", async () => {
  const { deps } = makeApprovalDeps();
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput({ approvedVendorIds: ["vA", "vZ"] }), deps), /DISTRIBUTION_APPROVED_VENDOR_NOT_RECOMMENDED/);
});
check("27. ranked order reversal rejected", async () => {
  const { deps } = makeApprovalDeps();
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput({ approvedVendorIds: ["vB", "vA"] }), deps), /DISTRIBUTION_APPROVED_ORDER_NOT_PRESERVED/);
});
check("28. valid contiguous subset accepted", async () => {
  const { deps } = makeApprovalDeps();
  const r = await approvalSvcMod.approveLeadDistribution(approveInput({ approvedVendorIds: ["vA", "vB"] }), deps);
  assert(r.event.event_type === E.DISTRIBUTION_APPROVED && r.approvedVendorIds.join() === "vA,vB", "valid subset rejected");
});
check("29. valid non-contiguous ordered subset accepted ([A,C])", async () => {
  const { deps } = makeApprovalDeps();
  const r = await approvalSvcMod.approveLeadDistribution(approveInput({ approvedVendorIds: ["vA", "vC"] }), deps);
  assert(r.event.payload_json.approved_vendor_ids.join(",") === "vA,vC", "non-contiguous ordered subset rejected");
});
check("30. workflow must be DISTRIBUTION_APPROVAL_PENDING", async () => {
  const { deps } = makeApprovalDeps({ workflow: makeWorkflow({ current_state: S.MATCH_RECOMMENDATION_READY }) });
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput(), deps), /DISTRIBUTION_WORKFLOW_STATE_NOT_APPROVAL_PENDING/);
});
check("30b. missing workflow rejected", async () => {
  const { deps } = makeApprovalDeps({ workflow: null });
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput(), deps), /DISTRIBUTION_WORKFLOW_NOT_FOUND/);
});
check("31. wrong workflow type rejected", async () => {
  const { deps } = makeApprovalDeps({ workflow: makeWorkflow({ workflow_type: "qf_other" }) });
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput(), deps), /DISTRIBUTION_WORKFLOW_TYPE_MISMATCH/);
});
check("32. wrong lead rejected (workflow entity mismatch)", async () => {
  const { deps } = makeApprovalDeps({ workflow: makeWorkflow({ entity_id: "lead_OTHER" }) });
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput(), deps), /DISTRIBUTION_WORKFLOW_LEAD_MISMATCH/);
});
check("32b. special route cannot use approval service", async () => {
  const { deps } = makeApprovalDeps({ routing: { leadIntent: "preferred_vendor", targetVendorId: null, preferredVendorId: null, requirementGroupId: null } });
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput(), deps), /DISTRIBUTION_SPECIAL_ROUTE_NOT_ALLOWED/);
});

// ==========================================================================
// APPROVAL IDEMPOTENCY
// ==========================================================================
check("33. deterministic approval key distinct from task-result key", () => {
  const k1 = approvalPubMod.buildLeadDistributionApprovalIdempotencyKey(" wf_1 ", " rec_1 ");
  const k2 = approvalPubMod.buildLeadDistributionApprovalIdempotencyKey("wf_1", "rec_1");
  assert(k1 === k2 && k1 === "qf_lead_lifecycle:distribution_approval:wf_1:rec_1", `unexpected key ${k1}`);
  assert(k1 !== publisherMod.buildLeadLifecycleResultEventIdempotencyKey("wf_1"), "approval key must differ from task-result key");
  assert(!/\d{13}|random|uuid/i.test(k1), "key must not embed random/timestamp");
});
check("34. same approval replay reuses event", async () => {
  const { deps, repo } = makeApprovalDeps();
  const first = await approvalSvcMod.approveLeadDistribution(approveInput({ approvedVendorIds: ["vA", "vB"] }), deps);
  const second = await approvalSvcMod.approveLeadDistribution(approveInput({ approvedVendorIds: ["vA", "vB"] }), deps);
  assert(first.event.id === second.event.id, "replay must reuse the approval event");
  assert(repo.byKey.size === 1, "replay must leave exactly one durable event");
});
check("35. changed approved vendors conflict", async () => {
  const { deps, repo } = makeApprovalDeps();
  await approvalSvcMod.approveLeadDistribution(approveInput({ approvedVendorIds: ["vA", "vB"] }), deps);
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput({ approvedVendorIds: ["vA", "vC"] }), deps), /DISTRIBUTION_APPROVAL_IDEMPOTENCY_CONFLICT/);
  assert(repo.byKey.size === 1, "conflict must not insert a second event");
});
check("36. changed lead conflicts (publisher integrity)", async () => {
  const repo = new InMemoryDomainEventRepository();
  const pub = new approvalPubMod.DurableLeadDistributionApprovalPublisher(repo);
  const base = { workflowInstanceId: WORKFLOW_ID, recommendationEventId: MATCH_EVENT_ID, recommendedVendorCount: 3, recommendedVendorIds: ["vA", "vB", "vC"], approvedVendorIds: ["vA"], approvedBy: "admin_1" };
  await pub.publish({ ...base, leadId: LEAD_ID });
  await expectRejects(() => pub.publish({ ...base, leadId: "lead_OTHER" }), /DISTRIBUTION_APPROVAL_IDEMPOTENCY_CONFLICT/);
  assert(repo.byKey.size === 1, "lead conflict must not insert second event");
});
check("37. changed recommendation snapshot conflicts (publisher integrity)", async () => {
  const repo = new InMemoryDomainEventRepository();
  const pub = new approvalPubMod.DurableLeadDistributionApprovalPublisher(repo);
  const base = { workflowInstanceId: WORKFLOW_ID, leadId: LEAD_ID, recommendationEventId: MATCH_EVENT_ID, approvedVendorIds: ["vA"], approvedBy: "admin_1" };
  await pub.publish({ ...base, recommendedVendorCount: 3, recommendedVendorIds: ["vA", "vB", "vC"] });
  await expectRejects(() => pub.publish({ ...base, recommendedVendorCount: 2, recommendedVendorIds: ["vA", "vB"] }), /DISTRIBUTION_APPROVAL_IDEMPOTENCY_CONFLICT/);
  assert(repo.byKey.size === 1, "snapshot conflict must not insert second event");
});
check("38. unrelated persistence errors rethrow (not swallowed)", async () => {
  const repo = new InMemoryDomainEventRepository();
  repo.failUnrelated = true;
  const { deps } = makeApprovalDeps({ repo, approvalPublisher: new approvalPubMod.DurableLeadDistributionApprovalPublisher(repo) });
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput(), deps), /POSTGREST_UNRELATED_FAILURE/);
});
check("38b. first valid approval wins for a recommendation snapshot", async () => {
  const { deps } = makeApprovalDeps();
  const first = await approvalSvcMod.approveLeadDistribution(approveInput({ approvedVendorIds: ["vA"] }), deps);
  const replay = await approvalSvcMod.approveLeadDistribution(approveInput({ approvedVendorIds: ["vA"] }), deps);
  assert(first.event.id === replay.event.id && first.event.payload_json.approved_vendor_ids.join() === "vA", "first approval must win");
});

// ==========================================================================
// APPROVAL BINDING (current-pending-snapshot authorization gate)
// ==========================================================================
check("B1. workflow pending for R1 + approve R1 -> accepted", async () => {
  const { deps } = makeApprovalDeps({ bindingRecId: MATCH_EVENT_ID });
  const r = await approvalSvcMod.approveLeadDistribution(approveInput({ recommendationEventId: MATCH_EVENT_ID, approvedVendorIds: ["vA"] }), deps);
  assert(r.event.event_type === E.DISTRIBUTION_APPROVED, "bound approval must succeed");
});
check("B2. workflow pending for R2 + approve stale R1 -> binding mismatch", async () => {
  const { deps } = makeApprovalDeps({ bindingRecId: "evt_R2" });
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput({ recommendationEventId: MATCH_EVENT_ID }), deps), /DISTRIBUTION_APPROVAL_RECOMMENDATION_BINDING_MISMATCH/);
});
check("B3. no transition binding -> rejected", async () => {
  const { deps } = makeApprovalDeps({ bindingNull: true });
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput(), deps), /DISTRIBUTION_APPROVAL_BINDING_NOT_FOUND/);
});
check("B4. binding metadata missing recommendation_event_id -> rejected", async () => {
  const { deps } = makeApprovalDeps({ bindingMetadata: { lead_id: LEAD_ID } });
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput(), deps), /DISTRIBUTION_APPROVAL_BINDING_INVALID/);
});
check("B5. blank recommendation_event_id in binding -> rejected", async () => {
  const { deps } = makeApprovalDeps({ bindingMetadata: { recommendation_event_id: "   " } });
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput(), deps), /DISTRIBUTION_APPROVAL_BINDING_INVALID/);
});
check("B6. bound valid approval replay still reuses event", async () => {
  const { deps, repo } = makeApprovalDeps();
  const first = await approvalSvcMod.approveLeadDistribution(approveInput({ approvedVendorIds: ["vA", "vB"] }), deps);
  const second = await approvalSvcMod.approveLeadDistribution(approveInput({ approvedVendorIds: ["vA", "vB"] }), deps);
  assert(first.event.id === second.event.id && repo.byKey.size === 1, "bound replay must reuse one event");
});
check("B7. bound approval changed approved vendors still conflict", async () => {
  const { deps, repo } = makeApprovalDeps();
  await approvalSvcMod.approveLeadDistribution(approveInput({ approvedVendorIds: ["vA", "vB"] }), deps);
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput({ approvedVendorIds: ["vA", "vC"] }), deps), /DISTRIBUTION_APPROVAL_IDEMPOTENCY_CONFLICT/);
  assert(repo.byKey.size === 1, "conflict must not insert second event");
});
check("B8. bound approval unrelated persistence errors still rethrow", async () => {
  const repo = new InMemoryDomainEventRepository();
  repo.failUnrelated = true;
  const { deps } = makeApprovalDeps({ repo, approvalPublisher: new approvalPubMod.DurableLeadDistributionApprovalPublisher(repo) });
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput(), deps), /POSTGREST_UNRELATED_FAILURE/);
});
check("B9. concurrency: pending R2, caller attempts R1 -> no approval event inserted", async () => {
  const repo = new InMemoryDomainEventRepository();
  const { deps } = makeApprovalDeps({ repo, bindingRecId: "evt_R2", approvalPublisher: new approvalPubMod.DurableLeadDistributionApprovalPublisher(repo) });
  await expectRejects(() => approvalSvcMod.approveLeadDistribution(approveInput({ recommendationEventId: MATCH_EVENT_ID }), deps), /DISTRIBUTION_APPROVAL_RECOMMENDATION_BINDING_MISMATCH/);
  assert(repo.byKey.size === 0, "stale-recommendation approval must insert no event");
});
check("B10. pure binding resolver fails safely + trims", () => {
  assert(bindingMod.resolveDistributionApprovalBinding(null).message === "DISTRIBUTION_APPROVAL_BINDING_NOT_FOUND", "null must be not found");
  assert(bindingMod.resolveDistributionApprovalBinding(makeTransition({})).message === "DISTRIBUTION_APPROVAL_BINDING_INVALID", "missing meta must be invalid");
  assert(!bindingMod.resolveDistributionApprovalBinding(makeTransition({ recommendation_event_id: "  " })).ok, "blank must be invalid");
  const ok = bindingMod.resolveDistributionApprovalBinding(makeTransition({ recommendation_event_id: " evt_x " }));
  assert(ok.ok && ok.value.recommendationEventId === "evt_x", "valid binding must trim + resolve");
});

// ==========================================================================
// EVENT CONTRACT
// ==========================================================================
check("39. approval_required payload validated (empty rejected)", () => {
  assert(validationMod.validateDistributionApprovalRequired({ recommendation_event_id: "r", recommended_vendor_count: 2, recommended_vendor_ids: ["vA", "vB"] }).ok, "valid approval_required rejected");
  assert(!validationMod.validateDistributionApprovalRequired({}).ok, "empty approval_required accepted");
  assert(!validationMod.validateDistributionApprovalRequired({ recommendation_event_id: "r", recommended_vendor_count: 0, recommended_vendor_ids: [] }).ok, "zero count must reject for approval_required");
});
check("40. approved payload validated (subset + order enforced)", () => {
  const good = { recommendation_event_id: "r", recommended_vendor_count: 3, recommended_vendor_ids: ["vA", "vB", "vC"], approved_vendor_count: 2, approved_vendor_ids: ["vA", "vC"], approved_by: "admin_1" };
  assert(validationMod.validateDistributionApproved(good).ok, "valid approved rejected");
  assert(!validationMod.validateDistributionApproved({ ...good, approved_vendor_ids: ["vC", "vA"], approved_vendor_count: 2 }).ok, "order reversal must reject");
  assert(!validationMod.validateDistributionApproved({}).ok, "empty approved accepted");
});
check("41. approved_by stored trimmed", async () => {
  const { deps } = makeApprovalDeps();
  const r = await approvalSvcMod.approveLeadDistribution(approveInput({ approvedBy: "  admin_9  " }), deps);
  assert(r.event.payload_json.approved_by === "admin_9", `approved_by not trimmed: ${r.event.payload_json.approved_by}`);
});
check("42. approved event contains no client PII", async () => {
  const { deps } = makeApprovalDeps();
  const r = await approvalSvcMod.approveLeadDistribution(approveInput({ reason: "controlled rollout batch 1" }), deps);
  const keys = Object.keys(r.event.payload_json);
  const allowed = new Set(["workflow_type", "lead_id", "recommendation_event_id", "recommended_vendor_count", "recommended_vendor_ids", "approved_vendor_count", "approved_vendor_ids", "approved_by", "approval_reason"]);
  assert(keys.every((k) => allowed.has(k)), `unexpected payload key(s): ${keys.filter((k) => !allowed.has(k)).join(",")}`);
  assert(!keys.some((k) => /phone|email|whatsapp|address|contact|client_name|mobile/i.test(k)), "PII-looking key present");
});
check("43. auto_authorized event never emitted", () => {
  assert(!allPublished.some((p) => p.eventType === E.DISTRIBUTION_AUTO_AUTHORIZED), "auto_authorized was emitted");
  assert(!/auto_authorized/.test(distributionCombined), "distribution source references auto_authorized");
});
check("43b. only approved/approval_required/manual_review emitted by Phase 3A", () => {
  const emitted = new Set(allPublished.map((p) => p.eventType));
  for (const t of emitted) {
    assert([E.DISTRIBUTION_APPROVAL_REQUIRED, E.DISTRIBUTION_APPROVED, E.MANUAL_REVIEW_REQUIRED].includes(t), `unexpected emitted event ${t}`);
  }
});

// ==========================================================================
// SIDE-EFFECT SAFETY (static source scans + workspace guards)
// ==========================================================================
const distributionFiles = [
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionTypes.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionValidation.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionRecommendationResolver.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionRouteGuard.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionApprovalPublisher.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionApprovalBinding.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionApprovalService.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAdapters.ts",
];
const distributionCombined = distributionFiles.map((f) => readFileSync(f, "utf8")).join("\n");
const executorSource = readFileSync("lib/aos/workflows/leadLifecycle/execution/leadLifecycleTaskExecutor.ts", "utf8");
const phase3aCombined = `${distributionCombined}\n${executorSource}`;

check("44. no standard assignment RPC", () => {
  assert(!/\b(assign_lead_to_paid_vendors_phase26a|admin_smart_assign_lead_to_vendors|assignLeadToMatchedVendors|assignLeadToVendors)\s*\(/.test(phase3aCombined), "standard assignment call found");
});
check("45. no preferred assignment RPC", () => {
  assert(!/\b(assign_lead_to_preferred_vendor|routePreferredVendorLead|holdPreferredVendorForQualityGate|queuePreferredVendorDelayedFill)\s*\(/.test(phase3aCombined), "preferred assignment call found");
});
check("46. no requirement-group assignment RPC", () => {
  assert(!/\b(assign_vendor_to_requirement_group|assign_client_selected_vendor_to_group|recordClientSelectedVendor|processRequirementAutoFill)\s*\(/.test(phase3aCombined), "requirement-group assignment call found");
});
check("47. no runAutoLeadMatchingForLead / re-ranking", () => {
  assert(!/\b(runAutoLeadMatchingForLead|getEligibleVendorsForLead)\s*\(/.test(phase3aCombined), "matching rerun/ranking call found");
});
check("48. no delivery functions", () => {
  assert(!/\b(deliverLeadToVendorDashboard|createVendorLeadWhatsappPreview|createClientAssignedVendorsPreview)\s*\(/.test(phase3aCombined), "delivery call found");
});
check("49. no credit mutation", () => {
  assert(!/\b(deduct_vendor_credit|restore_vendor_credit)\s*\(|remaining_credits\s*=|credit_deducted\s*:/.test(phase3aCombined), "credit mutation found");
});
check("50. no WhatsApp send primitive", () => {
  assert(!/\bwhatsappTool|whatsapp-dispatch|sendWhatsApp|\.send\s*\(/i.test(phase3aCombined), "WhatsApp send primitive found");
});
check("51. no n8n / webhook primitive", () => {
  assert(!/\bn8nTool|n8nSync|webhook|fetch\s*\(/i.test(phase3aCombined), "n8n/webhook primitive found");
});
check("52. no outbox provider command", () => {
  assert(!/outboxCommands|outbox_events|command_type/i.test(phase3aCombined), "outbox provider command found");
});
check("53. no production worker loop", () => {
  assert(!/setInterval|while\s*\(\s*true\s*\)|claimOneDueWorkflowTask\s*\(/.test(phase3aCombined), "worker loop/claim startup found");
});
check("53b. distribution modules import no protected business services", () => {
  assert(!/from\s+["'][^"']*services\/(leadService|leadMatchingEngine|leadDeliveryService|preferredVendorLeadService|clientRequirementGroupService|delayedLeadFillService|leadClarificationService)["']/.test(distributionCombined), "forbidden business service import");
});
check("54. no PM2 modification", () => {
  assert(!gitPorcelain().some((f) => /pm2|ecosystem/i.test(f)), "PM2 file changed");
});
check("55. live leadService.ts unchanged", () => {
  assert(gitPorcelain(["services/leadService.ts"]).length === 0, "leadService.ts changed");
});
check("56. preferredVendorLeadService.ts unchanged", () => {
  assert(gitPorcelain(["services/preferredVendorLeadService.ts"]).length === 0, "preferredVendorLeadService.ts changed");
});
check("57. delayedLeadFillService.ts unchanged", () => {
  assert(gitPorcelain(["services/delayedLeadFillService.ts"]).length === 0, "delayedLeadFillService.ts changed");
});
check("58. clientRequirementGroupService.ts unchanged", () => {
  assert(gitPorcelain(["services/clientRequirementGroupService.ts"]).length === 0, "clientRequirementGroupService.ts changed");
});
check("58b. leadMatchingEngine.ts + leadQualityService.ts unchanged (scoring/ranking)", () => {
  assert(gitPorcelain(["services/leadMatchingEngine.ts", "services/leadQualityService.ts", "services/leadClarificationService.ts"]).length === 0, "protected scoring/matching service changed");
});
check("59. no database migration created or changed", () => {
  assert(gitPorcelain(["supabase/migrations"]).length === 0, "migration changed/created");
});
check("60. Phase 2A tests remain available", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert(existsSync("scripts/phase2a-lead-lifecycle-harness.mjs") && Boolean(pkg.scripts["test:phase2a"]), "phase2a test missing");
});
check("61. Phase 2B tests remain available", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert(existsSync("scripts/phase2b-lead-orchestration-adapter-harness.mjs") && Boolean(pkg.scripts["test:phase2b"]), "phase2b test missing");
});
check("62. qf_kernel_test remains isolated", () => {
  assert(!/qf_kernel_test/.test(phase3aCombined), "Phase 3A source references qf_kernel_test");
});
check("62b. test:phase3a wired to this harness; diagnostics preserved", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert(pkg.scripts["test:phase3a"] === "node scripts/phase3a-distribution-control-harness.mjs", "test:phase3a not wired");
  assert(pkg.scripts["test:phase3a:diagnostics"] === "node scripts/phase3a-diagnostics-harness.ts", "diagnostics harness not preserved");
});
check("62c. Phase 3A doc exists", () => {
  assert(existsSync("docs/aos/QF-Distribution-Control-Phase-3A.md"), "Phase 3A doc missing");
});
check("62d. no UI files modified", () => {
  assert(gitPorcelain(["app", "components", "public"]).length === 0, "UI files changed");
});

function gitPorcelain(paths = []) {
  const args = ["status", "--porcelain", "--", ...paths];
  const output = execFileSync("git", args, { encoding: "utf8" });
  return output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// Sequential execution keeps the cross-test `allPublished` accumulator and check
// ordering deterministic.
const results = [];
for (const { name, fn } of checks) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
}
for (const item of results) {
  console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
  if (!item.ok) console.error(item.error);
}

rmSync(outDir, { recursive: true, force: true });

const failures = results.filter((item) => !item.ok);
if (failures.length > 0) {
  console.error(`\n${failures.length} Phase 3A distribution-control harness check(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${results.length} Phase 3A distribution-control checks passed.`);
