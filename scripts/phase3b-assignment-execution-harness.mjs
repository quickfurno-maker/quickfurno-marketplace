import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

/**
 * Phase 3B — QuickFurno Credit-Safe Assignment Execution & Authoritative Dashboard
 * Delivery harness.
 *
 * SOURCE/STATIC harness. Compiles the pure Phase 3B distribution modules + the
 * executor to a throwaway build and exercises the approved-only assignment
 * execution, canonical result mapping, partition contract, and one-task→one-result
 * retry safety with injected in-memory ports. No DB, no real assignment, no
 * credit math, no delivery log, no WhatsApp, no n8n, no worker.
 */

const outDir = resolve(".phase3b-test-build");
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
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionApprovedSnapshotResolver.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAssignmentTypes.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAssignmentValidation.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAssignmentResultMapper.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAssignmentAdapter.ts",
  "lib/errors.ts",
  "services/leadDeliveryService.ts",
  "services/leadQualityService.ts",
];

const tsconfigPath = resolve(".phase3b-tsconfig.json");
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
const publisherMod = requireFromBuild(`${D}/events/leadLifecycleEventPublisher.js`);
const executorMod = requireFromBuild(`${D}/execution/leadLifecycleTaskExecutor.js`);
const validationMod = requireFromBuild(`${D}/distribution/leadDistributionValidation.js`);
const resolverMod = requireFromBuild(`${D}/distribution/leadDistributionApprovedSnapshotResolver.js`);
const assignValidationMod = requireFromBuild(`${D}/distribution/leadDistributionAssignmentValidation.js`);
const mapperMod = requireFromBuild(`${D}/distribution/leadDistributionAssignmentResultMapper.js`);
const adapterMod = requireFromBuild(`${D}/distribution/leadDistributionAssignmentAdapter.js`);
const assignTypesMod = requireFromBuild(`${D}/distribution/leadDistributionAssignmentTypes.js`);

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
async function expectRejects(fn, pattern) {
  try { await fn(); } catch (error) {
    if (!pattern || pattern.test(String(error?.message ?? error))) return;
    throw new Error(`wrong rejection: ${String(error?.message ?? error)}`);
  }
  throw new Error("Expected rejection");
}

const E = events.LeadLifecycleEventType;
const T = tasks.LeadLifecycleTaskIntent;
const WF_TYPE = states.LEAD_LIFECYCLE_WORKFLOW_TYPE;
const REASON = assignTypesMod.DistributionAssignmentManualReviewReason;

const LEAD_ID = "lead_std_1";
const WORKFLOW_ID = "wf_std_1";
const APPROVAL_EVENT_ID = "evt_appr_1";
const REC_EVENT_ID = "evt_match_1";
const ABC = ["vA", "vB", "vC"];
function routing(o = {}) {
  return {
    leadIntent: o.leadIntent ?? null, targetVendorId: o.targetVendorId ?? null,
    preferredVendorId: o.preferredVendorId ?? null, requirementGroupId: o.requirementGroupId ?? null,
    selectedVendorId: o.selectedVendorId ?? null, assignmentIntent: o.assignmentIntent ?? null,
  };
}
const STANDARD_ROUTING = routing({ leadIntent: "general_auto_match" });

let counter = 0;
const allPublished = [];

function makeDomainEvent(input, n = ++counter) {
  return {
    id: input.id ?? `evt_out_${n}`, event_type: input.eventType, entity_type: input.entityType,
    entity_id: input.entityId, payload_version: 1, payload_json: input.payload,
    trace_id: input.traceId ?? null, correlation_id: input.correlationId ?? null,
    causation_id: input.causationId ?? null, idempotency_key: input.idempotencyKey ?? null,
    processing_status: "pending", processed_at: null,
    created_at: "2026-07-07T00:00:00.000Z", updated_at: "2026-07-07T00:00:00.000Z",
    locked_at: null, locked_by: null, attempt_count: 0, max_attempts: 5, next_retry_at: null,
  };
}

function makeApprovedEvent(opts = {}) {
  const recommended = opts.recommended ?? ABC;
  const approved = opts.approved ?? ABC;
  const payload = {
    workflow_type: opts.workflowType ?? WF_TYPE,
    lead_id: opts.payloadLeadId ?? (opts.entityId ?? LEAD_ID),
    recommendation_event_id: opts.recommendationEventId ?? REC_EVENT_ID,
    recommended_vendor_count: opts.recommendedCount ?? recommended.length,
    recommended_vendor_ids: recommended,
    approved_vendor_count: opts.approvedCount ?? approved.length,
    approved_vendor_ids: approved,
    approved_by: opts.approvedBy ?? "admin_1",
    ...(opts.approvalReason ? { approval_reason: opts.approvalReason } : {}),
    ...(opts.payloadOverride ?? {}),
  };
  return {
    id: opts.id ?? APPROVAL_EVENT_ID,
    event_type: opts.eventType ?? E.DISTRIBUTION_APPROVED,
    entity_type: opts.entityType ?? "lead",
    entity_id: opts.entityId ?? LEAD_ID,
    payload_version: 1, payload_json: payload,
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
    approvalEventId: opts.approvalEventId ?? APPROVAL_EVENT_ID,
    expectedWorkflowInstanceId: opts.expectedWorkflowInstanceId ?? WORKFLOW_ID,
    expectedLeadId: opts.expectedLeadId ?? LEAD_ID,
  };
}

function assignedRecords(pairs) {
  return pairs.map(([v, a]) => ({ vendorId: v, assignmentId: a }));
}
function rawResult(opts = {}) {
  return {
    status: opts.status ?? "ok",
    leadId: opts.leadId ?? LEAD_ID,
    assigned: opts.assigned ?? assignedRecords([["vA", "a1"], ["vC", "a3"]]),
  };
}

function makeTask(taskType, payload = {}) {
  return {
    id: payload.__taskId ?? `task_${taskType.replace(/\W/g, "_")}_${(++counter).toString(16)}`,
    workflow_instance_id: WORKFLOW_ID, task_type: taskType, status: "processing", priority: 100,
    due_at: "2026-07-07T00:00:00.000Z", attempt_count: 0, max_attempts: 5, next_retry_at: null,
    locked_at: "2026-07-07T00:00:00.000Z", locked_by: "worker_phase3b", idempotency_key: null,
    payload_json: {
      lead_id: LEAD_ID, workflow_instance_id: WORKFLOW_ID,
      triggered_by_event: payload.triggered_by_event !== undefined ? payload.triggered_by_event : APPROVAL_EVENT_ID,
    },
    result_json: {}, last_error: null,
    created_at: "2026-07-07T00:00:00.000Z", started_at: "2026-07-07T00:00:00.000Z", completed_at: null,
    updated_at: "2026-07-07T00:00:00.000Z",
  };
}

function stubPublisher(calls) {
  return {
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
}

function makeExecutorDeps(opts = {}) {
  const calls = { published: [], assignInputs: [], eventLookups: [], routingReads: [], matching: 0 };
  const eventMap = new Map();
  for (const e of (opts.events ?? [makeApprovedEvent(opts.approvedEvent)])) eventMap.set(e.id, e);
  return {
    calls,
    deps: {
      ports: {
        quality: { async scoreLead() { return {}; } },
        latestQuality: { async readLatestQualityResult() { return {}; } },
        clarification: { async prepareClarification() { return { requestId: "c", status: "s", missingFields: [], questionsCount: 0 }; } },
        matchingRecommendation: { async prepareRecommendations() { calls.matching += 1; return { leadId: LEAD_ID, eligibleVendorCount: 0, recommendedVendorIds: [] }; } },
      },
      resultEventPublisher: opts.publisher ?? stubPublisher(calls),
      distribution: {
        recommendationEventPort: { async getDomainEventById(id) { calls.eventLookups.push(id); return eventMap.get(id) ?? null; } },
        routingPort: { async readLeadRouting(leadId) { calls.routingReads.push(leadId); return opts.routing ?? STANDARD_ROUTING; } },
        assignmentExecution: opts.assignmentExecution ?? {
          async assignApprovedVendors(input) {
            calls.assignInputs.push(input);
            if (opts.assignmentThrow) throw new Error(opts.assignmentThrow);
            return opts.assignmentResult ?? rawResult();
          },
        },
      },
    },
  };
}

// --- Real adapter DI helpers (boundary fn + truth port injected) --------------
function makeBoundary(opts = {}) {
  return async (leadId, vendorIds) => {
    if (opts.throwCode) return { ok: false, code: opts.throwCode, error: "boundary failed" };
    const assigned = opts.assigned ?? [{ vendor_id: "vA", assignment_id: "a1" }];
    return { ok: true, data: { status: opts.status ?? "ok", lead_id: opts.leadId ?? leadId, assigned, skipped: [], assigned_count: assigned.length } };
  };
}
function makeTruthPort(opts = {}) {
  return {
    async readAssignmentsForLead(leadId) {
      if (opts.throw) throw new Error(opts.throw);
      return opts.rows ?? [{ id: "a1", vendorId: "vA" }, { id: "a3", vendorId: "vC" }];
    },
  };
}
function makeAdapter(opts = {}) {
  return new adapterMod.SupabaseLeadDistributionAssignmentPort({
    boundary: makeBoundary(opts.boundary ?? {}),
    truthPort: makeTruthPort(opts.truth ?? {}),
  });
}

class InMemoryDomainEventRepository {
  constructor() { this.byKey = new Map(); this.insertCount = 0; }
  async insert(input) {
    this.insertCount += 1;
    if (this.byKey.has(input.idempotencyKey)) throw { code: "23505", message: "duplicate key violates idempotency index" };
    const event = makeDomainEvent(input, this.insertCount);
    this.byKey.set(input.idempotencyKey, event);
    allPublished.push({ eventType: input.eventType, payload: event.payload_json });
    return event;
  }
  async findByIdempotencyKey(key) { return this.byKey.get(key) ?? null; }
}

const snap = (approved) => ({ leadId: LEAD_ID, approvedVendorIds: approved ?? ABC });

// ==========================================================================
// APPROVED SNAPSHOT
// ==========================================================================
check("1. valid 1-vendor approval snapshot", () => {
  const r = validationMod.validateApprovedEventSnapshot(makeApprovedEvent({ recommended: ["vA"], approved: ["vA"] }), expectation());
  assert(r.ok && r.value.approvedVendorCount === 1 && r.value.approvedVendorIds.join() === "vA", "1-vendor approval invalid");
});
check("2. valid 3-vendor snapshot", () => {
  const r = validationMod.validateApprovedEventSnapshot(makeApprovedEvent(), expectation());
  assert(r.ok && r.value.approvedVendorCount === 3 && r.value.approvalEventId === APPROVAL_EVENT_ID, "3-vendor approval invalid");
});
check("3. wrong event type rejected", () => {
  const r = validationMod.validateApprovedEventSnapshot(makeApprovedEvent({ eventType: E.MATCHING_COMPLETED }), expectation());
  assert(!r.ok && r.message === "APPROVED_EVENT_TYPE_INVALID", `got ${r.message}`);
});
check("4. wrong lead rejected", () => {
  const r = validationMod.validateApprovedEventSnapshot(makeApprovedEvent({ entityId: "lead_OTHER", payloadLeadId: "lead_OTHER" }), expectation());
  assert(!r.ok && r.message === "APPROVED_EVENT_LEAD_MISMATCH", `got ${r.message}`);
});
check("5. wrong workflow rejected", () => {
  const r = validationMod.validateApprovedEventSnapshot(makeApprovedEvent({ correlationId: "wf_OTHER" }), expectation());
  assert(!r.ok && r.message === "APPROVED_EVENT_WORKFLOW_MISMATCH", `got ${r.message}`);
});
check("6. malformed recommended list rejected", () => {
  const r = validationMod.validateApprovedEventSnapshot(makeApprovedEvent({ recommended: ["vA", "vB"], recommendedCount: 3 }), expectation());
  assert(!r.ok && r.message === "DISTRIBUTION_RECOMMENDED_IDS_COUNT_MISMATCH", `got ${r.message}`);
});
check("7. malformed approved list rejected", () => {
  const r = validationMod.validateApprovedEventSnapshot(makeApprovedEvent({ approved: ["vA"], approvedCount: 2 }), expectation());
  assert(!r.ok && r.message === "DISTRIBUTION_APPROVED_IDS_COUNT_MISMATCH", `got ${r.message}`);
});
check("8. un-recommended approved vendor rejected", () => {
  const r = validationMod.validateApprovedEventSnapshot(makeApprovedEvent({ recommended: ABC, approved: ["vA", "vD"] }), expectation());
  assert(!r.ok && r.message === "DISTRIBUTION_APPROVED_VENDOR_NOT_RECOMMENDED", `got ${r.message}`);
});
check("9. reversed approved ordering rejected", () => {
  const r = validationMod.validateApprovedEventSnapshot(makeApprovedEvent({ recommended: ABC, approved: ["vB", "vA"] }), expectation());
  assert(!r.ok && r.message === "DISTRIBUTION_APPROVED_ORDER_NOT_PRESERVED", `got ${r.message}`);
});
check("10. approved order preserved (non-contiguous)", () => {
  const r = validationMod.validateApprovedEventSnapshot(makeApprovedEvent({ recommended: ABC, approved: ["vA", "vC"] }), expectation());
  assert(r.ok && r.value.approvedVendorIds.join(",") === "vA,vC", "approved order not preserved");
});
check("10b. approved snapshot is frozen", () => {
  const r = validationMod.validateApprovedEventSnapshot(makeApprovedEvent(), expectation());
  assert(r.ok && Object.isFrozen(r.value) && Object.isFrozen(r.value.approvedVendorIds), "snapshot not frozen");
});
check("10c. resolver loads via port then validates; not found rejected", async () => {
  const okPort = { async getDomainEventById() { return makeApprovedEvent(); } };
  const nf = { async getDomainEventById() { return null; } };
  const a = await resolverMod.resolveLeadDistributionApprovedSnapshot(expectation(), okPort);
  const b = await resolverMod.resolveLeadDistributionApprovedSnapshot(expectation(), nf);
  assert(a.ok && a.value.approvedVendorCount === 3, "resolver valid load failed");
  assert(!b.ok && b.message === "APPROVED_EVENT_NOT_FOUND", `got ${b.message}`);
});

// ==========================================================================
// EXECUTION BINDING
// ==========================================================================
check("11. executor uses task triggered_by_event as approved source", async () => {
  const { deps, calls } = makeExecutorDeps({ approvedEvent: { id: "evt_specific" }, events: [makeApprovedEvent({ id: "evt_specific" })] });
  await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE, { triggered_by_event: "evt_specific" }), deps);
  assert(calls.eventLookups[0] === "evt_specific", "did not resolve the triggering approval event");
  assert(calls.published[0].payload.approval_event_id === "evt_specific", "bound wrong approval event");
});
check("12. missing triggering approval event rejected (not found)", async () => {
  const { deps } = makeExecutorDeps({ events: [] });
  await expectRejects(() => executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE), deps), /APPROVED_EVENT_NOT_FOUND/);
});
check("12b. empty triggered_by_event rejected", async () => {
  const { deps } = makeExecutorDeps();
  await expectRejects(() => executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE, { triggered_by_event: "" }), deps), /APPROVAL_EVENT_ID_REQUIRED/);
});
check("13. assignment port receives approved IDs only", async () => {
  const { deps, calls } = makeExecutorDeps({ approvedEvent: { recommended: ABC, approved: ["vA", "vC"] }, events: [makeApprovedEvent({ recommended: ABC, approved: ["vA", "vC"] })], assignmentResult: rawResult({ assigned: assignedRecords([["vA", "a1"], ["vC", "a3"]]) }) });
  await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE), deps);
  assert(calls.assignInputs[0].approvedVendorIds.join(",") === "vA,vC", "assignment port got wrong ids");
});
check("14. no recommended-but-unapproved vendor sent to assignment", async () => {
  const { deps, calls } = makeExecutorDeps({ approvedEvent: { recommended: ABC, approved: ["vA", "vC"] }, events: [makeApprovedEvent({ recommended: ABC, approved: ["vA", "vC"] })], assignmentResult: rawResult({ assigned: assignedRecords([["vA", "a1"]]) }) });
  await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE), deps);
  assert(!calls.assignInputs[0].approvedVendorIds.includes("vB"), "unapproved vendor sent to assignment");
});
check("15. no matching rerun during execution", async () => {
  const { deps, calls } = makeExecutorDeps();
  await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE), deps);
  assert(calls.matching === 0, "must not rerun matching");
});
check("16. standard route executes -> distribution.completed", async () => {
  const { deps, calls } = makeExecutorDeps();
  await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE), deps);
  assert(calls.assignInputs.length === 1 && calls.published[0].eventType === E.DISTRIBUTION_COMPLETED, "standard route did not complete");
});
for (const [n, r] of [["17", routing({ leadIntent: "preferred_vendor" })], ["18", routing({ selectedVendorId: "vSel" })], ["19", routing({ requirementGroupId: "grp_1" })]]) {
  check(`${n}. special route does not execute assignment`, async () => {
    const { deps, calls } = makeExecutorDeps({ routing: r });
    await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE), deps);
    assert(calls.assignInputs.length === 0, "special route must not call assignment");
    assert(calls.published[0].eventType === E.MANUAL_REVIEW_REQUIRED, "special route must publish manual review");
  });
}
check("20. route changed after approval -> manual review with reason + classification", async () => {
  const { deps, calls } = makeExecutorDeps({ routing: routing({ leadIntent: "preferred_vendor" }) });
  await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE), deps);
  assert(calls.published[0].payload.reason === REASON.ROUTE_CHANGED, "wrong route-changed reason");
  assert(calls.published[0].payload.route_classification === "preferred_vendor_route", "missing route classification");
});

// ==========================================================================
// ASSIGNMENT RESULT
// ==========================================================================
async function runExec(opts) {
  const { deps, calls } = makeExecutorDeps(opts);
  const result = await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE), deps);
  return { result, calls };
}
check("21. valid 1 assigned", async () => {
  const { calls } = await runExec({ assignmentResult: rawResult({ assigned: assignedRecords([["vA", "a1"]]) }) });
  const p = calls.published[0].payload;
  assert(calls.published[0].eventType === E.DISTRIBUTION_COMPLETED && p.distributed_vendor_ids.join() === "vA" && p.skipped_vendor_ids.join(",") === "vB,vC", "1-assigned wrong");
});
check("22. valid 2 assigned", async () => {
  const { calls } = await runExec({ assignmentResult: rawResult({ assigned: assignedRecords([["vA", "a1"], ["vC", "a3"]]) }) });
  const p = calls.published[0].payload;
  assert(p.distributed_vendor_ids.join(",") === "vA,vC" && p.skipped_vendor_ids.join() === "vB", "2-assigned wrong");
});
check("23. valid 3 assigned", async () => {
  const { calls } = await runExec({ assignmentResult: rawResult({ assigned: assignedRecords([["vA", "a1"], ["vB", "a2"], ["vC", "a3"]]) }) });
  const p = calls.published[0].payload;
  assert(p.distributed_vendor_ids.join(",") === "vA,vB,vC" && p.skipped_vendor_ids.length === 0, "3-assigned wrong");
});
check("24. count >3 rejected (structural)", async () => {
  await expectRejects(() => runExec({ assignmentResult: rawResult({ assigned: assignedRecords([["vA", "a1"], ["vB", "a2"], ["vC", "a3"], ["vD", "a4"]]) }) }), /ASSIGNMENT_RESULT_COUNT_INVALID/);
});
check("25. duplicate assigned vendor rejected", async () => {
  await expectRejects(() => runExec({ assignmentResult: rawResult({ assigned: assignedRecords([["vA", "a1"], ["vA", "a2"]]) }) }), /ASSIGNMENT_VENDOR_IDS_NOT_UNIQUE/);
});
check("26. missing assignment id rejected", async () => {
  await expectRejects(() => runExec({ assignmentResult: rawResult({ assigned: assignedRecords([["vA", ""]]) }) }), /ASSIGNMENT_ID_INVALID/);
});
check("27. wrong lead result rejected", async () => {
  await expectRejects(() => runExec({ assignmentResult: rawResult({ leadId: "lead_OTHER" }) }), /ASSIGNMENT_RESULT_LEAD_MISMATCH/);
});
check("28. unapproved assigned vendor -> manual review (outside scope)", async () => {
  const { calls } = await runExec({ assignmentResult: rawResult({ assigned: assignedRecords([["vA", "a1"], ["vZ", "a9"]]) }) });
  assert(calls.published[0].eventType === E.MANUAL_REVIEW_REQUIRED && calls.published[0].payload.reason === REASON.OUTSIDE_SCOPE, "outside-scope not manual review");
});
check("29. already_assigned valid subset accepted as replay", async () => {
  const { calls } = await runExec({ assignmentResult: rawResult({ status: "already_assigned", assigned: assignedRecords([["vC", "a3"], ["vA", "a1"]]) }) });
  const p = calls.published[0].payload;
  assert(calls.published[0].eventType === E.DISTRIBUTION_COMPLETED && p.distributed_vendor_ids.join(",") === "vA,vC", "already_assigned replay wrong");
});
check("30. already_assigned outside approved scope -> manual review", async () => {
  const { calls } = await runExec({ assignmentResult: rawResult({ status: "already_assigned", assigned: assignedRecords([["vA", "a1"], ["vZ", "a9"]]) }) });
  assert(calls.published[0].eventType === E.MANUAL_REVIEW_REQUIRED && calls.published[0].payload.reason === REASON.EXISTING_OUTSIDE_SCOPE, "already_assigned outside scope wrong reason");
});

// ==========================================================================
// CANONICALIZATION (mapper-level, order independence)
// ==========================================================================
check("31. approved [A,B,C], assigned [C,A] -> distributed [A,C]", () => {
  const m = mapperMod.mapAssignmentResultToOutcome(rawResult({ assigned: assignedRecords([["vC", "a3"], ["vA", "a1"]]) }), snap(ABC));
  assert(m.ok && m.value.kind === "completed" && m.value.distributedVendorIds.join(",") === "vA,vC", "canonical distributed wrong");
});
check("32. skipped exact complement [B]", () => {
  const m = mapperMod.mapAssignmentResultToOutcome(rawResult({ assigned: assignedRecords([["vC", "a3"], ["vA", "a1"]]) }), snap(ABC));
  assert(m.value.skippedVendorIds.join() === "vB", "skipped complement wrong");
});
check("33. 1/3 partial assignment", () => {
  const m = mapperMod.mapAssignmentResultToOutcome(rawResult({ assigned: assignedRecords([["vA", "a1"]]) }), snap(ABC));
  assert(m.value.distributedVendorIds.join() === "vA" && m.value.skippedVendorIds.join(",") === "vB,vC", "1/3 wrong");
});
check("34. 2/3 partial assignment", () => {
  const m = mapperMod.mapAssignmentResultToOutcome(rawResult({ assigned: assignedRecords([["vB", "a2"], ["vC", "a3"]]) }), snap(ABC));
  assert(m.value.distributedVendorIds.join(",") === "vB,vC" && m.value.skippedVendorIds.join() === "vA", "2/3 wrong");
});
check("35. 3/3 full assignment", () => {
  const m = mapperMod.mapAssignmentResultToOutcome(rawResult({ assigned: assignedRecords([["vA", "a1"], ["vB", "a2"], ["vC", "a3"]]) }), snap(ABC));
  assert(m.value.distributedVendorIds.join(",") === "vA,vB,vC" && m.value.skippedVendorIds.length === 0, "3/3 wrong");
});
check("36. canonical result independent of RPC ordering", () => {
  const a = mapperMod.mapAssignmentResultToOutcome(rawResult({ assigned: assignedRecords([["vC", "a3"], ["vA", "a1"]]) }), snap(ABC));
  const b = mapperMod.mapAssignmentResultToOutcome(rawResult({ assigned: assignedRecords([["vA", "a1"], ["vC", "a3"]]) }), snap(ABC));
  assert(JSON.stringify(a.value) === JSON.stringify(b.value), "canonical result depends on RPC order");
});

// ==========================================================================
// ZERO ASSIGNMENT
// ==========================================================================
check("37. zero assigned -> manual_review.required", async () => {
  const { calls } = await runExec({ assignmentResult: rawResult({ status: "no_eligible_vendors", assigned: [] }) });
  assert(calls.published[0].eventType === E.MANUAL_REVIEW_REQUIRED, "zero assigned must be manual review");
});
check("38. zero assigned never -> distribution.completed", async () => {
  const { calls } = await runExec({ assignmentResult: rawResult({ status: "no_eligible_vendors", assigned: [] }) });
  assert(!calls.published.some((p) => p.eventType === E.DISTRIBUTION_COMPLETED), "zero assigned must not complete");
});
check("39. zero-assignment manual review reason exact", async () => {
  const { calls } = await runExec({ assignmentResult: rawResult({ status: "skipped_duplicate", assigned: [] }) });
  assert(calls.published[0].payload.reason === REASON.ZERO_ASSIGNABLE, `wrong reason ${calls.published[0].payload.reason}`);
});
check("40. no reviewer fabricated on zero-assignment manual review", async () => {
  const { calls } = await runExec({ assignmentResult: rawResult({ status: "no_eligible_vendors", assigned: [] }) });
  const p = calls.published[0].payload;
  assert(p.reviewed_by === undefined && p.outcome === undefined, "must not fabricate reviewer");
});

// ==========================================================================
// DISTRIBUTION COMPLETED CONTRACT
// ==========================================================================
const goodCompleted = { approval_event_id: "a", recommendation_event_id: "r", approved_vendor_count: 3, approved_vendor_ids: ABC, distributed_vendor_count: 2, distributed_vendor_ids: ["vA", "vC"], skipped_vendor_ids: ["vB"] };
check("41. approval_event_id required", () => assert(!validationMod.validateDistributionCompleted({ ...goodCompleted, approval_event_id: "" }).ok, "missing approval_event_id must reject"));
check("42. recommendation_event_id required", () => assert(!validationMod.validateDistributionCompleted({ ...goodCompleted, recommendation_event_id: "" }).ok, "missing recommendation_event_id must reject"));
check("43. approved count/list match", () => assert(!validationMod.validateDistributionCompleted({ ...goodCompleted, approved_vendor_count: 2 }).ok, "approved count mismatch must reject"));
check("44. distributed count/list match", () => assert(!validationMod.validateDistributionCompleted({ ...goodCompleted, distributed_vendor_count: 1 }).ok, "distributed count mismatch must reject"));
check("45. distributed subset of approved", () => assert(!validationMod.validateDistributionCompleted({ ...goodCompleted, distributed_vendor_ids: ["vA", "vD"], skipped_vendor_ids: ["vB"] }).ok, "distributed non-subset must reject"));
check("46. distributed ordering preserved", () => assert(!validationMod.validateDistributionCompleted({ ...goodCompleted, distributed_vendor_ids: ["vC", "vA"], skipped_vendor_ids: ["vB"] }).ok, "distributed order must be preserved"));
check("47. distributed/skipped disjoint", () => assert(!validationMod.validateDistributionCompleted({ ...goodCompleted, distributed_vendor_ids: ["vA", "vB"], skipped_vendor_ids: ["vB"] }).ok, "overlap must reject"));
check("48. skipped complement complete (exact partition)", () => assert(!validationMod.validateDistributionCompleted({ ...goodCompleted, distributed_vendor_count: 1, distributed_vendor_ids: ["vA"], skipped_vendor_ids: ["vC"] }).ok, "incomplete partition must reject"));
check("49. skipped ordering preserved", () => assert(!validationMod.validateDistributionCompleted({ ...goodCompleted, distributed_vendor_count: 1, distributed_vendor_ids: ["vA"], skipped_vendor_ids: ["vC", "vB"] }).ok, "skipped order must be preserved"));
check("50. valid partial partition accepted", () => {
  const r = validationMod.validateDistributionCompleted(goodCompleted);
  assert(r.ok && r.value.distributedVendorIds.join(",") === "vA,vC" && r.value.skippedVendorIds.join() === "vB", "valid partition rejected");
});

// ==========================================================================
// RETRY SAFETY
// ==========================================================================
check("51. fresh ok assignment publishes distribution.completed", async () => {
  const { calls } = await runExec({ assignmentResult: rawResult({ status: "ok", assigned: assignedRecords([["vA", "a1"], ["vC", "a3"]]) }) });
  assert(calls.published[0].eventType === E.DISTRIBUTION_COMPLETED, "fresh ok must complete");
});
check("52. replay already_assigned canonicalizes identically to fresh", () => {
  const fresh = mapperMod.mapAssignmentResultToOutcome(rawResult({ status: "ok", assigned: assignedRecords([["vA", "a1"], ["vC", "a3"]]) }), snap(ABC));
  const replay = mapperMod.mapAssignmentResultToOutcome(rawResult({ status: "already_assigned", assigned: assignedRecords([["vC", "a3"], ["vA", "a1"]]) }), snap(ABC));
  assert(JSON.stringify(fresh.value) === JSON.stringify(replay.value), "replay canonicalization differs from fresh");
});
check("53/54. same task replay reuses exactly one durable result event", async () => {
  const repo = new InMemoryDomainEventRepository();
  const publisher = new publisherMod.DurableLeadLifecycleEventPublisher(repo);
  const taskId = "task_retry_1";
  // Attempt 1: fresh ok assignment [A,C].
  const d1 = makeExecutorDeps({ publisher, assignmentResult: rawResult({ status: "ok", assigned: assignedRecords([["vA", "a1"], ["vC", "a3"]]) }) });
  await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE, { __taskId: taskId }), d1.deps);
  // Attempt 2: same task, assignment now reports already_assigned in different DB order.
  const d2 = makeExecutorDeps({ publisher, assignmentResult: rawResult({ status: "already_assigned", assigned: assignedRecords([["vC", "a3"], ["vA", "a1"]]) }) });
  const r2 = await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE, { __taskId: taskId }), d2.deps);
  assert(repo.byKey.size === 1, `expected exactly one durable event, got ${repo.byKey.size}`);
  assert(r2.result.published_event_type === E.DISTRIBUTION_COMPLETED, "replay must resolve to completed");
});
const completedForKeys = (async () => {
  const { calls } = await runExec({ assignmentResult: rawResult({ status: "ok", assigned: assignedRecords([["vA", "a1"], ["vC", "a3"]]) }) });
  return calls.published[0].payload;
});
check("55-58. lifecycle payload carries no volatile retry facts", async () => {
  const payload = await completedForKeys();
  const allowed = new Set(["workflow_type", "lead_id", "approval_event_id", "recommendation_event_id", "approved_vendor_count", "approved_vendor_ids", "distributed_vendor_count", "distributed_vendor_ids", "skipped_vendor_ids"]);
  const keys = Object.keys(payload);
  assert(keys.every((k) => allowed.has(k)), `unexpected payload key(s): ${keys.filter((k) => !allowed.has(k)).join(",")}`);
  for (const forbidden of ["status", "rpc_status", "assignment_reused", "attempt_count", "worker_id", "assignment_id", "assignment_ids", "credits_before", "credits_after"]) {
    assert(!(forbidden in payload), `forbidden key ${forbidden} in lifecycle payload`);
  }
  assert(!keys.some((k) => /timestamp|_at$|random|uuid/i.test(k)), "timestamp/random field in payload");
});
check("58b. no client PII in completed payload", async () => {
  const payload = await completedForKeys();
  assert(!Object.keys(payload).some((k) => /phone|email|whatsapp|address|client_name|mobile|budget/i.test(k)), "PII-looking key present");
});

// ==========================================================================
// AUTHORITATIVE ASSIGNMENT TRUTH (post-assignment lead_assignments read-back)
// ==========================================================================
check("TR1. lifecycle truth comes from lead_assignments read-back, not lossy boundary response", async () => {
  const adapter = makeAdapter({ boundary: { status: "ok", assigned: [{ vendor_id: "vA", assignment_id: "a1" }] }, truth: { rows: [{ id: "a1", vendorId: "vA" }, { id: "a3", vendorId: "vC" }] } });
  const r = await adapter.assignApprovedVendors({ leadId: LEAD_ID, approvedVendorIds: ABC });
  assert(r.assigned.map((a) => a.vendorId).join(",") === "vA,vC" && r.assigned.map((a) => a.assignmentId).join(",") === "a1,a3", "adapter must use truth read-back");
  const m = mapperMod.mapAssignmentResultToOutcome(r, snap(ABC));
  assert(m.value.kind === "completed" && m.value.distributedVendorIds.join(",") === "vA,vC" && m.value.skippedVendorIds.join() === "vB", "mapper wrong from truth");
});
check("TR2. empty boundary response, truth [A] -> distributed [A]", async () => {
  const adapter = makeAdapter({ boundary: { status: "ok", assigned: [] }, truth: { rows: [{ id: "a1", vendorId: "vA" }] } });
  const r = await adapter.assignApprovedVendors({ leadId: LEAD_ID, approvedVendorIds: ABC });
  const m = mapperMod.mapAssignmentResultToOutcome(r, snap(ABC));
  assert(m.value.distributedVendorIds.join() === "vA" && m.value.skippedVendorIds.join(",") === "vB,vC", "truth [A] must distribute [A]");
});
check("TR3. already_assigned recovery: truth DB order [C,A] -> distributed [A,C]; status preserved", async () => {
  const adapter = makeAdapter({ boundary: { status: "already_assigned", assigned: [] }, truth: { rows: [{ id: "a3", vendorId: "vC" }, { id: "a1", vendorId: "vA" }] } });
  const r = await adapter.assignApprovedVendors({ leadId: LEAD_ID, approvedVendorIds: ABC });
  assert(r.status === "already_assigned", "boundary status must be preserved for diagnostics");
  const m = mapperMod.mapAssignmentResultToOutcome(r, snap(ABC));
  assert(m.value.distributedVendorIds.join(",") === "vA,vC", "already_assigned canonical wrong");
});
check("TR4. truth-read failure throws (no fallback to boundary response)", async () => {
  const adapter = makeAdapter({ boundary: { status: "ok", assigned: [{ vendor_id: "vA", assignment_id: "a1" }] }, truth: { throw: "POSTGREST_TEMPORARY_FAILURE" } });
  await expectRejects(() => adapter.assignApprovedVendors({ leadId: LEAD_ID, approvedVendorIds: ABC }), /POSTGREST_TEMPORARY_FAILURE/);
});
check("TR4b. truth-read failure via executor publishes no lifecycle event", async () => {
  const adapter = makeAdapter({ boundary: { status: "ok", assigned: [] }, truth: { throw: "POSTGREST_TEMPORARY_FAILURE" } });
  const { deps, calls } = makeExecutorDeps({ assignmentExecution: adapter });
  await expectRejects(() => executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE), deps), /POSTGREST_TEMPORARY_FAILURE/);
  assert(calls.published.length === 0, "no event may be published on truth-read failure");
});
check("TR5. boundary ok:false fails loudly (ASSIGNMENT_EXECUTION_FAILED)", async () => {
  await expectRejects(() => makeAdapter({ boundary: { throwCode: "MIGRATION_NOT_APPLIED" } }).assignApprovedVendors({ leadId: LEAD_ID, approvedVendorIds: ABC }), /ASSIGNMENT_EXECUTION_FAILED:MIGRATION_NOT_APPLIED/);
});
check("TR6. blank/unknown boundary status rejected", async () => {
  await expectRejects(() => makeAdapter({ boundary: { status: "unknown", assigned: [] } }).assignApprovedVendors({ leadId: LEAD_ID, approvedVendorIds: ABC }), /ASSIGNMENT_BOUNDARY_STATUS_INVALID/);
  await expectRejects(() => makeAdapter({ boundary: { status: "   ", assigned: [] } }).assignApprovedVendors({ leadId: LEAD_ID, approvedVendorIds: ABC }), /ASSIGNMENT_BOUNDARY_STATUS_INVALID/);
});
check("TR7. boundary lead mismatch rejected", async () => {
  await expectRejects(() => makeAdapter({ boundary: { status: "ok", leadId: "lead_OTHER", assigned: [] } }).assignApprovedVendors({ leadId: LEAD_ID, approvedVendorIds: ABC }), /ASSIGNMENT_BOUNDARY_LEAD_MISMATCH/);
});
check("TR8. truth row missing/blank assignment id fails loudly", () => {
  assert(assignValidationMod.validateAssignmentTruthRows([{ id: null, vendorId: "vA" }]).message === "ASSIGNMENT_TRUTH_ASSIGNMENT_ID_INVALID", "missing id");
  assert(assignValidationMod.validateAssignmentTruthRows([{ id: "  ", vendorId: "vA" }]).message === "ASSIGNMENT_TRUTH_ASSIGNMENT_ID_INVALID", "blank id");
});
check("TR9. truth row missing/blank vendor id fails loudly", () => {
  assert(assignValidationMod.validateAssignmentTruthRows([{ id: "a1", vendorId: null }]).message === "ASSIGNMENT_TRUTH_VENDOR_ID_INVALID", "missing vendor");
  assert(assignValidationMod.validateAssignmentTruthRows([{ id: "a1", vendorId: " " }]).message === "ASSIGNMENT_TRUTH_VENDOR_ID_INVALID", "blank vendor");
});
check("TR10. duplicate truth vendor id fails loudly", () => {
  assert(assignValidationMod.validateAssignmentTruthRows([{ id: "a1", vendorId: "vA" }, { id: "a2", vendorId: "vA" }]).message === "ASSIGNMENT_TRUTH_VENDOR_IDS_NOT_UNIQUE", "dup vendor");
});
check("TR11. malformed truth does not silently shrink the set (adapter throws)", async () => {
  const adapter = makeAdapter({ boundary: { status: "ok", assigned: [] }, truth: { rows: [{ id: "a1", vendorId: "vA" }, { id: null, vendorId: "vC" }] } });
  await expectRejects(() => adapter.assignApprovedVendors({ leadId: LEAD_ID, approvedVendorIds: ABC }), /ASSIGNMENT_TRUTH_ASSIGNMENT_ID_INVALID/);
});
check("TR12. >3 truth rows -> structural rejection via mapper", () => {
  const r = { status: "already_assigned", leadId: LEAD_ID, assigned: [["vA", "a1"], ["vB", "a2"], ["vC", "a3"], ["vD", "a4"]].map(([v, a]) => ({ vendorId: v, assignmentId: a })) };
  const m = mapperMod.mapAssignmentResultToOutcome(r, snap(ABC));
  assert(!m.ok && m.message === "ASSIGNMENT_RESULT_COUNT_INVALID", "structural count reject");
});
check("TR13. zero truth rows -> approved_vendors_no_longer_assignable manual review", async () => {
  const adapter = makeAdapter({ boundary: { status: "no_eligible_vendors", assigned: [] }, truth: { rows: [] } });
  const { deps, calls } = makeExecutorDeps({ assignmentExecution: adapter });
  await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE), deps);
  assert(calls.published[0].eventType === E.MANUAL_REVIEW_REQUIRED && calls.published[0].payload.reason === REASON.ZERO_ASSIGNABLE, "zero truth must be manual review");
});
check("TR14. truth contains an unapproved vendor -> outside-scope manual review", async () => {
  const adapter = makeAdapter({ boundary: { status: "ok", assigned: [] }, truth: { rows: [{ id: "a1", vendorId: "vA" }, { id: "a9", vendorId: "vZ" }] } });
  const { deps, calls } = makeExecutorDeps({ assignmentExecution: adapter });
  await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE), deps);
  assert(calls.published[0].payload.reason === REASON.OUTSIDE_SCOPE, "outside scope must come from truth");
});
check("TR15/TR16. adapter retry: lossy attempt1 + already_assigned attempt2 -> one identical durable event", async () => {
  const repo = new InMemoryDomainEventRepository();
  const publisher = new publisherMod.DurableLeadLifecycleEventPublisher(repo);
  const taskId = "task_truth_retry";
  const a1 = makeAdapter({ boundary: { status: "ok", assigned: [{ vendor_id: "vA", assignment_id: "a1" }] }, truth: { rows: [{ id: "a1", vendorId: "vA" }, { id: "a3", vendorId: "vC" }] } });
  await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE, { __taskId: taskId }), makeExecutorDeps({ publisher, assignmentExecution: a1 }).deps);
  const a2 = makeAdapter({ boundary: { status: "already_assigned", assigned: [] }, truth: { rows: [{ id: "a3", vendorId: "vC" }, { id: "a1", vendorId: "vA" }] } });
  const r2 = await executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE, { __taskId: taskId }), makeExecutorDeps({ publisher, assignmentExecution: a2 }).deps);
  assert(repo.byKey.size === 1, `expected exactly one durable event, got ${repo.byKey.size}`);
  assert(r2.result.distributed_vendor_ids.join(",") === "vA,vC" && r2.result.skipped_vendor_ids.join() === "vB", "retry canonical mismatch");
});
check("TR17. real adapter defaults are production impls (boundary + Supabase truth port)", () => {
  const src = readFileSync("lib/aos/workflows/leadLifecycle/distribution/leadDistributionAssignmentAdapter.ts", "utf8");
  assert(/assignLeadToMatchedVendors/.test(src) && /SupabaseLeadDistributionAssignmentTruthPort/.test(src), "adapter defaults must be production impls");
  assert(/lead_assignments/.test(src) && /select\(\s*["']id, vendor_id["']\s*\)/.test(src), "truth port must read id, vendor_id from lead_assignments");
});

// ==========================================================================
// SIDE-EFFECT SAFETY (static scans + workspace guards)
// ==========================================================================
const phase3bFiles = [
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAssignmentTypes.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAssignmentValidation.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAssignmentResultMapper.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionApprovedSnapshotResolver.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAssignmentAdapter.ts",
];
const phase3bCombined = phase3bFiles.map((f) => readFileSync(f, "utf8")).join("\n");
const executorSource = readFileSync("lib/aos/workflows/leadLifecycle/execution/leadLifecycleTaskExecutor.ts", "utf8");
const scanCombined = `${phase3bCombined}\n${executorSource}`;

check("59. no runAutoLeadMatchingForLead", () => assert(!/\brunAutoLeadMatchingForLead\s*\(/.test(scanCombined), "runAutoLeadMatchingForLead call found"));
check("60. no getEligibleVendorsForLead", () => assert(!/\bgetEligibleVendorsForLead\s*\(/.test(scanCombined), "getEligibleVendorsForLead call found"));
check("61. no evaluateVendorsForLead", () => assert(!/\bevaluateVendorsForLead\s*\(/.test(scanCombined), "evaluateVendorsForLead call found"));
check("62. no preferred-route service call", () => assert(!/\b(routePreferredVendorLead|holdPreferredVendorForQualityGate|queuePreferredVendorDelayedFill|processDueLeadAssignmentQueue|processPreferredVendorWindow|processDuePreferredVendorRechargeWindows)\s*\(/.test(scanCombined), "preferred-route service call found"));
check("63. no requirement-group service call", () => assert(!/\b(recordClientSelectedVendor|processRequirementAutoFill|processDueRequirementAutoFills|assign_vendor_to_requirement_group|assign_client_selected_vendor_to_group)\s*\(/.test(scanCombined), "requirement-group service call found"));
check("64. no legacy delivery-log service call", () => assert(!/\bdeliverLeadToVendorDashboard\s*\(/.test(scanCombined), "deliverLeadToVendorDashboard call found"));
check("65. no WhatsApp preview call", () => assert(!/\bcreateVendorLeadWhatsappPreview\s*\(/.test(scanCombined), "createVendorLeadWhatsappPreview call found"));
check("66. no client preview call", () => assert(!/\bcreateClientAssignedVendorsPreview\s*\(/.test(scanCombined), "createClientAssignedVendorsPreview call found"));
check("67. no n8n / webhook primitive", () => assert(!/\bn8nTool|n8nSync|webhook|fetch\s*\(/i.test(scanCombined), "n8n/webhook primitive found"));
check("68. no outbox provider command", () => assert(!/outboxCommands|outbox_events|command_type/i.test(scanCombined), "outbox provider command found"));
check("69. no production worker loop", () => assert(!/setInterval|while\s*\(\s*true\s*\)|claimOneDueWorkflowTask\s*\(/.test(scanCombined), "worker loop/claim startup found"));
check("69b. assignment adapter wraps only assignLeadToMatchedVendors (approved boundary)", () => {
  const adapter = readFileSync("lib/aos/workflows/leadLifecycle/distribution/leadDistributionAssignmentAdapter.ts", "utf8");
  assert(/assignLeadToMatchedVendors\b/.test(adapter), "adapter must default to the approved assignment boundary");
  assert(!/\.rpc\s*\(|deliverLeadToVendorDashboard|createVendorLeadWhatsappPreview|createClientAssignedVendorsPreview/.test(adapter), "adapter must not call RPC/delivery directly");
});
check("70. no PM2 modification", () => assert(!gitPorcelain().some((f) => /pm2|ecosystem/i.test(f)), "PM2 file changed"));
check("71. live leadService.ts unchanged", () => assert(gitPorcelain(["services/leadService.ts"]).length === 0, "leadService.ts changed"));
check("72. leadMatchingEngine.ts unchanged", () => assert(gitPorcelain(["services/leadMatchingEngine.ts"]).length === 0, "leadMatchingEngine.ts changed"));
check("73. leadDeliveryService.ts unchanged", () => assert(gitPorcelain(["services/leadDeliveryService.ts"]).length === 0, "leadDeliveryService.ts changed"));
check("74. vendorService.ts unchanged", () => assert(gitPorcelain(["services/vendorService.ts"]).length === 0, "vendorService.ts changed"));
check("74b. other protected services unchanged", () => assert(gitPorcelain(["services/leadQualityService.ts", "services/leadClarificationService.ts", "services/preferredVendorLeadService.ts", "services/delayedLeadFillService.ts", "services/clientRequirementGroupService.ts"]).length === 0, "a protected service changed"));
check("75. no unexpected database migration created or changed", () => {
  const unexpected = gitPorcelain(["supabase/migrations"]).filter(
    (line) => !line.includes("20260706000150_automation_policy_config_foundation.sql"),
  );
  assert(unexpected.length === 0, `unexpected migration changed/created: ${unexpected.join(", ")}`);
});

// ==========================================================================
// REGRESSION
// ==========================================================================
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
check("76. Phase 1A test available", () => assert(existsSync("scripts/phase1a-workflow-foundation-verify.mjs") && pkg.scripts["test:phase1a"], "phase1a missing"));
check("77. Phase 1B test available", () => assert(existsSync("scripts/phase1b-workflow-kernel-harness.mjs") && pkg.scripts["test:phase1b"], "phase1b missing"));
check("78. Phase 2A test available", () => assert(existsSync("scripts/phase2a-lead-lifecycle-harness.mjs") && pkg.scripts["test:phase2a"], "phase2a missing"));
check("79. Phase 2B test available", () => assert(existsSync("scripts/phase2b-lead-orchestration-adapter-harness.mjs") && pkg.scripts["test:phase2b"], "phase2b missing"));
check("80. Phase 3A test available", () => assert(existsSync("scripts/phase3a-distribution-control-harness.mjs") && pkg.scripts["test:phase3a"] === "node scripts/phase3a-distribution-control-harness.mjs", "phase3a missing"));
check("81. Phase 3A diagnostics available", () => assert(existsSync("scripts/phase3a-diagnostics-harness.ts") && pkg.scripts["test:phase3a:diagnostics"] === "node scripts/phase3a-diagnostics-harness.ts", "phase3a diagnostics missing"));
check("82. historical test:phase3b preserved (not orphaned)", () => assert(pkg.scripts["test:phase3b"] === "node scripts/phase3b-recovery-harness.ts" && existsSync("scripts/phase3b-recovery-harness.ts"), "historical test:phase3b not preserved"));
check("82b. test:phase3b:aos wired to this harness", () => assert(pkg.scripts["test:phase3b:aos"] === "node scripts/phase3b-assignment-execution-harness.mjs", "test:phase3b:aos not wired"));
check("83. qf_kernel_test remains isolated", () => assert(!/qf_kernel_test/.test(scanCombined), "Phase 3B source references qf_kernel_test"));
check("83b. auto_authorized never emitted by Phase 3B", () => assert(!allPublished.some((p) => p.eventType === E.DISTRIBUTION_AUTO_AUTHORIZED), "auto_authorized emitted"));
check("83c. Phase 3B doc exists", () => assert(existsSync("docs/aos/QF-Assignment-Execution-Phase-3B.md"), "Phase 3B doc missing"));
check("83d. no UI files modified", () => assert(gitPorcelain(["app", "components", "public"]).length === 0, "UI files changed"));

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
  console.error(`\n${failures.length} Phase 3B assignment-execution harness check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${results.length} Phase 3B assignment-execution checks passed.`);
