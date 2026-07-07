import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 2A — QuickFurno Lead Lifecycle harness (corrected).
 *
 * SOURCE/STATIC harness. It compiles the pure lifecycle modules plus the generic
 * kernel validators to a throwaway build, then exercises the deterministic
 * handler and cross-checks every produced transition against the kernel's own
 * `validateWorkflowTransition` and `validateHandlerResult`.
 *
 * It does NOT connect to any database and does NOT claim real database
 * integration; runtime DB integration is intentionally deferred to a later phase.
 */

const outDir = resolve(".phase2a-test-build");
rmSync(outDir, { recursive: true, force: true });

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) {
  throw new Error("TypeScript compiler not found. Run npm install first.");
}

const LIFECYCLE_DIR = "lib/aos/workflows/leadLifecycle";
const lifecycleFiles = [
  "leadLifecycleStates.ts",
  "leadLifecycleEvents.ts",
  "leadLifecycleTypes.ts",
  "leadLifecycleValidation.ts",
  "leadLifecycleTaskIntents.ts",
  "leadLifecycleHandler.ts",
  "leadLifecycleDefinition.ts",
  "leadLifecycleRegistration.ts",
];

execFileSync(
  process.execPath,
  [
    tsc,
    "--module",
    "commonjs",
    "--target",
    "ES2020",
    "--moduleResolution",
    "node",
    "--skipLibCheck",
    "--esModuleInterop",
    "--strict",
    "--outDir",
    outDir,
    "--rootDir",
    ".",
    "lib/aos/workflow/workflowState.ts",
    "lib/aos/workflow/workflowValidation.ts",
    "lib/aos/workflow/workflowRegistry.ts",
    "lib/aos/workflow/qfKernelTestWorkflow.ts",
    ...lifecycleFiles.map((file) => `${LIFECYCLE_DIR}/${file}`),
  ],
  { stdio: "pipe" },
);

const requireFromBuild = createRequire(`${outDir}/`);
const state = requireFromBuild("./lib/aos/workflow/workflowState.js");
const kernelValidation = requireFromBuild("./lib/aos/workflow/workflowValidation.js");
const registryMod = requireFromBuild("./lib/aos/workflow/workflowRegistry.js");
const kernelTest = requireFromBuild("./lib/aos/workflow/qfKernelTestWorkflow.js");

const states = requireFromBuild(`./${LIFECYCLE_DIR}/leadLifecycleStates.js`);
const events = requireFromBuild(`./${LIFECYCLE_DIR}/leadLifecycleEvents.js`);
const types = requireFromBuild(`./${LIFECYCLE_DIR}/leadLifecycleTypes.js`);
const validation = requireFromBuild(`./${LIFECYCLE_DIR}/leadLifecycleValidation.js`);
const taskIntents = requireFromBuild(`./${LIFECYCLE_DIR}/leadLifecycleTaskIntents.js`);
const handlerMod = requireFromBuild(`./${LIFECYCLE_DIR}/leadLifecycleHandler.js`);
const definitionMod = requireFromBuild(`./${LIFECYCLE_DIR}/leadLifecycleDefinition.js`);
const registrationMod = requireFromBuild(`./${LIFECYCLE_DIR}/leadLifecycleRegistration.js`);

const S = states.LeadLifecycleState;
const E = events.LeadLifecycleEventType;
const O = types.ManualReviewOutcome;
const T = taskIntents.LeadLifecycleTaskIntent;
const definition = definitionMod.createLeadLifecycleWorkflowDefinition();

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error });
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function expectThrows(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const LEAD_ID = "lead_1";
let seq = 0;
function makeContext(currentState, eventType, payload = {}, overrides = {}) {
  seq += 1;
  return {
    workflow: {
      id: `wf_${seq}`,
      workflow_type: states.LEAD_LIFECYCLE_WORKFLOW_TYPE,
      entity_type: overrides.wfEntityType ?? "lead",
      entity_id: overrides.wfEntityId ?? LEAD_ID,
      current_state: currentState,
      status: state.normalizeWorkflowStatus(states.leadLifecycleStatusForState(currentState)),
      version: 1,
      context_json: {},
      started_at: "2026-07-06T00:00:00.000Z",
      updated_at: "2026-07-06T00:00:00.000Z",
      completed_at: null,
      last_error: null,
      created_at: "2026-07-06T00:00:00.000Z",
    },
    event: {
      id: `evt_${seq}`,
      event_type: eventType,
      entity_type: overrides.eventEntityType ?? "lead",
      entity_id: overrides.eventEntityId ?? LEAD_ID,
      payload_version: 1,
      payload_json: payload,
      trace_id: null,
      correlation_id: null,
      causation_id: null,
      idempotency_key: null,
      processing_status: "processing",
      processed_at: null,
      created_at: "2026-07-06T00:00:00.000Z",
      updated_at: "2026-07-06T00:00:00.000Z",
      locked_at: null,
      locked_by: null,
      attempt_count: 0,
      max_attempts: 5,
    },
    definition,
    now: "2026-07-06T00:00:00.000Z",
  };
}

/** Run the handler and assert the produced step is a kernel-valid transition. */
function runValidStep(currentState, eventType, payload, overrides) {
  const context = makeContext(currentState, eventType, payload, overrides);
  const result = handlerMod.leadLifecycleHandler(context);

  const handlerValidation = kernelValidation.validateHandlerResult(result);
  assert(handlerValidation.ok, `handler result invalid: ${handlerValidation.message}`);

  const transitionValidation = state.validateWorkflowTransition(
    definition,
    currentState,
    result.nextState,
    context.workflow.status,
  );
  assert(
    transitionValidation.ok,
    `transition ${currentState} -> ${result.nextState} rejected by kernel: ${transitionValidation.code}`,
  );
  return result;
}

// ==================================================================
// CORRECTION 1 — Canonical lead identity
// ==================================================================
check("C1a. canonical lead identity accepted; canonical id used in task + metadata", () => {
  const result = runValidStep(S.RECEIVED, E.LIFECYCLE_STARTED, {});
  assert(result.metadata.lead_id === LEAD_ID, "metadata must carry canonical lead id");
  assert(result.tasks[0].payload.lead_id === LEAD_ID, "task payload must carry canonical lead id");
});

check("C1b. missing payload.lead_id accepted via entity identity", () => {
  const id = validation.resolveCanonicalLeadIdentity(
    { entity_type: "lead", entity_id: LEAD_ID },
    { entity_type: "lead", entity_id: LEAD_ID, payload_json: {} },
  );
  assert(id.ok === true && id.value.leadId === LEAD_ID, "entity identity should resolve without payload lead_id");
});

check("C1c. matching payload.lead_id (== entity_id) accepted", () => {
  const result = runValidStep(S.RECEIVED, E.LIFECYCLE_STARTED, { lead_id: LEAD_ID });
  assert(result.metadata.lead_id === LEAD_ID, "matching payload lead_id should be accepted");
});

check("C1d. mismatched payload.lead_id rejected (LEAD_IDENTITY_MISMATCH)", () => {
  const id = validation.resolveCanonicalLeadIdentity(
    { entity_type: "lead", entity_id: "LEAD-A" },
    { entity_type: "lead", entity_id: "LEAD-A", payload_json: { lead_id: "LEAD-B" } },
  );
  assert(id.ok === false && id.message === "LEAD_IDENTITY_MISMATCH", "payload lead mismatch must reject");
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.RECEIVED, E.LIFECYCLE_STARTED, { lead_id: "LEAD-B" }))), "handler must throw on mismatch");
});

check("C1e. event/workflow entity mismatch rejected", () => {
  const id = validation.resolveCanonicalLeadIdentity(
    { entity_type: "lead", entity_id: "LEAD-A" },
    { entity_type: "lead", entity_id: "LEAD-B", payload_json: {} },
  );
  assert(id.ok === false && id.message === "WORKFLOW_EVENT_ENTITY_MISMATCH", "workflow/event entity mismatch must reject");
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.RECEIVED, E.LIFECYCLE_STARTED, {}, { wfEntityId: "LEAD-A", eventEntityId: "LEAD-B" }))), "handler must throw on entity mismatch");
});

check("C1f. non-lead entity_type rejected", () => {
  const id = validation.resolveCanonicalLeadIdentity(
    { entity_type: "lead", entity_id: LEAD_ID },
    { entity_type: "vendor", entity_id: LEAD_ID, payload_json: {} },
  );
  assert(id.ok === false && id.message === "LEAD_ENTITY_TYPE_REQUIRED", "non-lead event entity_type must reject");
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.RECEIVED, E.LIFECYCLE_STARTED, {}, { eventEntityType: "vendor" }))), "handler must throw on non-lead entity");
});

check("C1g. empty entity id rejected", () => {
  const id = validation.resolveCanonicalLeadIdentity(
    { entity_type: "lead", entity_id: "" },
    { entity_type: "lead", entity_id: "", payload_json: {} },
  );
  assert(id.ok === false && id.message === "LEAD_ENTITY_ID_REQUIRED", "empty entity id must reject");
});

check("C1h. workflow entity_type mismatch rejected", () => {
  const id = validation.resolveCanonicalLeadIdentity(
    { entity_type: "unknown", entity_id: LEAD_ID },
    { entity_type: "lead", entity_id: LEAD_ID, payload_json: {} },
  );
  assert(id.ok === false && id.message === "WORKFLOW_ENTITY_TYPE_MISMATCH", "workflow entity_type mismatch must reject");
});

// ==================================================================
// Lifecycle start + quality routing (retained)
// ==================================================================
check("1. lifecycle start enters QUALITY_SCORING_PENDING", () => {
  const result = runValidStep(S.RECEIVED, E.LIFECYCLE_STARTED, {});
  assert(result.nextState === S.QUALITY_SCORING_PENDING, `got ${result.nextState}`);
  assert(result.tasks[0].taskType === T.QUALITY_SCORE, "should open quality score task");
});

check("2. A+ routes to READY_FOR_MATCHING", () => {
  assert(runValidStep(S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "A+" }).nextState === S.READY_FOR_MATCHING);
});
check("3. A routes to READY_FOR_MATCHING", () => {
  assert(runValidStep(S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "A" }).nextState === S.READY_FOR_MATCHING);
});
check("4. B routes to CLARIFICATION_PENDING_1", () => {
  const result = runValidStep(S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "B" });
  assert(result.nextState === S.CLARIFICATION_PENDING_1, `got ${result.nextState}`);
  assert(result.tasks[0].taskType === T.CLARIFICATION_PREPARE, "should open clarification prepare task");
});
check("5. C routes to NURTURE_PENDING", () => {
  assert(runValidStep(S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "C" }).nextState === S.NURTURE_PENDING);
});
check("6. D routes to REJECTED", () => {
  const result = runValidStep(S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "D" });
  assert(result.nextState === S.REJECTED && result.workflowStatus === "cancelled", `got ${result.nextState}`);
});
check("7. D + manual_review_required routes to MANUAL_REVIEW_PENDING", () => {
  assert(runValidStep(S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "D", manual_review_required: true }).nextState === S.MANUAL_REVIEW_PENDING);
});

// ==================================================================
// CORRECTION 2 — Durable bounded clarification rounds
// ==================================================================
check("8. clarification (round 1) completed -> RESCORE_PENDING_1", () => {
  const result = runValidStep(S.CLARIFICATION_PENDING_1, E.CLARIFICATION_COMPLETED, {});
  assert(result.nextState === S.RESCORE_PENDING_1, `got ${result.nextState}`);
  assert(result.tasks[0].taskType === T.QUALITY_RESCORE, "should open rescore task");
});
check("9. rescore A -> READY_FOR_MATCHING", () => {
  assert(runValidStep(S.RESCORE_PENDING_1, E.QUALITY_RESULTED, { tier: "A" }).nextState === S.READY_FOR_MATCHING);
});
check("10. rescore B (round 1) without authorization -> MANUAL_REVIEW_PENDING", () => {
  const result = runValidStep(S.RESCORE_PENDING_1, E.QUALITY_RESULTED, { tier: "B" });
  assert(result.nextState === S.MANUAL_REVIEW_PENDING, `got ${result.nextState}`);
});
check("11. rescore B (round 1) with authorization -> CLARIFICATION_PENDING_2", () => {
  const result = runValidStep(S.RESCORE_PENDING_1, E.QUALITY_RESULTED, { tier: "B", clarification_allowed: true });
  assert(result.nextState === S.CLARIFICATION_PENDING_2, `got ${result.nextState}`);
});
check("C2a. clarification (round 2) completed -> RESCORE_PENDING_2", () => {
  assert(runValidStep(S.CLARIFICATION_PENDING_2, E.CLARIFICATION_COMPLETED, {}).nextState === S.RESCORE_PENDING_2);
});
check("C2b. rescore B (round 2) with authorization -> MANUAL_REVIEW_PENDING (cap)", () => {
  const result = runValidStep(S.RESCORE_PENDING_2, E.QUALITY_RESULTED, { tier: "B", clarification_allowed: true });
  assert(result.nextState === S.MANUAL_REVIEW_PENDING, `got ${result.nextState}`);
  assert(result.metadata.quality.loop_safety_applied === true, "cap fallback must flag loop safety");
});
check("C2c. repeated B cannot bypass cap by RESETTING payload clarification_cycle", () => {
  // Full path; every rescore resets clarification_cycle to 0, yet the cap holds
  // because the round is derived from durable state, not the payload.
  const walk = [
    [S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "B", clarification_cycle: 0 }, S.CLARIFICATION_PENDING_1],
    [S.CLARIFICATION_PENDING_1, E.CLARIFICATION_COMPLETED, {}, S.RESCORE_PENDING_1],
    [S.RESCORE_PENDING_1, E.QUALITY_RESULTED, { tier: "B", clarification_allowed: true, clarification_cycle: 0 }, S.CLARIFICATION_PENDING_2],
    [S.CLARIFICATION_PENDING_2, E.CLARIFICATION_COMPLETED, {}, S.RESCORE_PENDING_2],
    [S.RESCORE_PENDING_2, E.QUALITY_RESULTED, { tier: "B", clarification_allowed: true, clarification_cycle: 0 }, S.MANUAL_REVIEW_PENDING],
  ];
  for (const [from, evt, payload, expected] of walk) {
    assert(runValidStep(from, evt, payload).nextState === expected, `expected ${expected} from ${from}`);
  }
});
check("C2d. structural cap: RESCORE_PENDING_2 has no clarification edge; no round-3 state", () => {
  const edges = states.LEAD_LIFECYCLE_TRANSITIONS[S.RESCORE_PENDING_2];
  assert(!edges.includes(S.CLARIFICATION_PENDING_1) && !edges.includes(S.CLARIFICATION_PENDING_2), "no clarification re-entry from final rescore round");
  assert(states.CLARIFICATION_STATE_BY_ROUND[states.MAX_CLARIFICATION_CYCLES + 1] === undefined, "there must be no clarification round beyond the cap");
  assert(states.MAX_CLARIFICATION_CYCLES === 2, "cap constant retained at 2");
});
check("C2e. even the kernel blocks a round-3 attempt from RESCORE_PENDING_2", () => {
  const v = state.validateWorkflowTransition(definition, S.RESCORE_PENDING_2, S.CLARIFICATION_PENDING_2, "active");
  assert(v.ok === false && v.code === "INVALID_TRANSITION", "kernel must reject re-clarification from final rescore round");
});

// ==================================================================
// Matching lifecycle + CORRECTION 4 vendor count contract
// ==================================================================
check("12. matching requested: READY_FOR_MATCHING -> MATCHING_PENDING", () => {
  const result = runValidStep(S.READY_FOR_MATCHING, E.MATCHING_REQUESTED, {});
  assert(result.nextState === S.MATCHING_PENDING && result.tasks[0].taskType === T.MATCHING_PREPARE);
});
check("13. matching completed (count 3) -> MATCH_RECOMMENDATION_READY", () => {
  const result = runValidStep(S.MATCHING_PENDING, E.MATCHING_COMPLETED, { recommended_vendor_count: 3 });
  assert(result.nextState === S.MATCH_RECOMMENDATION_READY && result.metadata.recommended_vendor_count === 3);
});
check("C4a. matching count 0 accepted", () => {
  assert(validation.validateMatchingResult({ recommended_vendor_count: 0 }).ok === true);
});
check("C4b. matching count 1..3 accepted", () => {
  for (const n of [1, 2, 3]) assert(validation.validateMatchingResult({ recommended_vendor_count: n }).ok === true, `count ${n}`);
});
check("C4c. matching count 4 rejected", () => {
  const r = validation.validateMatchingResult({ recommended_vendor_count: 4 });
  assert(r.ok === false && r.message === "RECOMMENDED_VENDOR_COUNT_INVALID", "count > 3 must reject");
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.MATCHING_PENDING, E.MATCHING_COMPLETED, { recommended_vendor_count: 4 }))), "handler must throw on count 4");
});
check("C4d. matching count missing/fraction/string/negative rejected", () => {
  assert(validation.validateMatchingResult({}).ok === false, "missing count must reject");
  assert(validation.validateMatchingResult({ recommended_vendor_count: 1.5 }).ok === false, "fraction must reject");
  assert(validation.validateMatchingResult({ recommended_vendor_count: "3" }).ok === false, "string must reject");
  assert(validation.validateMatchingResult({ recommended_vendor_count: -1 }).ok === false, "negative must reject");
});
check("C4e. matching vendor_ids must agree with count", () => {
  assert(validation.validateMatchingResult({ recommended_vendor_count: 2, recommended_vendor_ids: ["v1", "v2"] }).ok === true, "matching ids accepted");
  assert(validation.validateMatchingResult({ recommended_vendor_count: 2, recommended_vendor_ids: ["v1"] }).ok === false, "id/count mismatch must reject");
});

// ==================================================================
// Distribution approval lifecycle + future auto authorization
// ==================================================================
// Phase 3A strengthened the approval contract: approval_required / approved
// events now carry a validated recommendation snapshot (empty payloads reject).
const APPROVAL_REQUIRED_PAYLOAD = {
  recommendation_event_id: "evt_match_1",
  recommended_vendor_count: 3,
  recommended_vendor_ids: ["v1", "v2", "v3"],
};
const APPROVED_PAYLOAD = {
  ...APPROVAL_REQUIRED_PAYLOAD,
  approved_vendor_count: 2,
  approved_vendor_ids: ["v1", "v2"],
  approved_by: "admin_1",
};
// Phase 3B strengthened distribution.completed: distributed + skipped must exactly
// partition the approved set (order-preserving, disjoint).
const DISTRIBUTION_COMPLETED_PAYLOAD = {
  approval_event_id: "evt_appr_1",
  recommendation_event_id: "evt_match_1",
  approved_vendor_count: 3,
  approved_vendor_ids: ["v1", "v2", "v3"],
  distributed_vendor_count: 3,
  distributed_vendor_ids: ["v1", "v2", "v3"],
  skipped_vendor_ids: [],
};
check("14. approval required: MATCH_RECOMMENDATION_READY -> DISTRIBUTION_APPROVAL_PENDING", () => {
  assert(runValidStep(S.MATCH_RECOMMENDATION_READY, E.DISTRIBUTION_APPROVAL_REQUIRED, APPROVAL_REQUIRED_PAYLOAD).nextState === S.DISTRIBUTION_APPROVAL_PENDING);
});
check("14b. empty approval_required payload is now rejected (Phase 3A contract)", () => {
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.MATCH_RECOMMENDATION_READY, E.DISTRIBUTION_APPROVAL_REQUIRED, {}))), "empty approval_required must reject");
});
check("15. explicit approval: DISTRIBUTION_APPROVAL_PENDING -> DISTRIBUTION_PENDING", () => {
  assert(runValidStep(S.DISTRIBUTION_APPROVAL_PENDING, E.DISTRIBUTION_APPROVED, APPROVED_PAYLOAD).nextState === S.DISTRIBUTION_PENDING);
});
check("15b. empty approved payload is now rejected (Phase 3A contract)", () => {
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.DISTRIBUTION_APPROVAL_PENDING, E.DISTRIBUTION_APPROVED, {}))), "empty approved must reject");
});
check("16. auto-authorized exists but activates no real distribution", () => {
  const result = runValidStep(S.MATCH_RECOMMENDATION_READY, E.DISTRIBUTION_AUTO_AUTHORIZED, {});
  assert(result.nextState === S.DISTRIBUTION_PENDING && result.metadata.auto_authorized === true);
  assert(!result.outboxCommands || result.outboxCommands.length === 0, "no outbox/provider commands");
  assert(result.tasks[0].taskType === T.DISTRIBUTION_PREPARE, "only a prepare intent");
});

// ==================================================================
// Distribution completion + CORRECTION 4 distribution count contract
// ==================================================================
check("17. distribution completed (count 3) -> DISTRIBUTED", () => {
  const result = runValidStep(S.DISTRIBUTION_PENDING, E.DISTRIBUTION_COMPLETED, DISTRIBUTION_COMPLETED_PAYLOAD);
  assert(result.nextState === S.DISTRIBUTED && result.metadata.distributed_vendor_count === 3);
});
check("17c. empty distribution.completed payload now rejected (Phase 3B contract)", () => {
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.DISTRIBUTION_PENDING, E.DISTRIBUTION_COMPLETED, { distributed_vendor_count: 3 }))), "partial completed payload must reject");
});
check("17b. distributed can close: DISTRIBUTED -> CLOSED", () => {
  const result = runValidStep(S.DISTRIBUTED, E.CLOSED, {});
  assert(result.nextState === S.CLOSED && result.workflowStatus === "completed");
});
check("C4f. distribution count 1..3 accepted", () => {
  for (const n of [1, 2, 3]) assert(validation.validateDistributionResult({ distributed_vendor_count: n }).ok === true, `count ${n}`);
});
check("C4g. distribution count 0 rejected", () => {
  const r = validation.validateDistributionResult({ distributed_vendor_count: 0 });
  assert(r.ok === false && r.message === "DISTRIBUTED_VENDOR_COUNT_INVALID", "0 distributed must reject");
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.DISTRIBUTION_PENDING, E.DISTRIBUTION_COMPLETED, { distributed_vendor_count: 0 }))), "handler must throw on 0");
});
check("C4h. distribution count 4 rejected", () => {
  assert(validation.validateDistributionResult({ distributed_vendor_count: 4 }).ok === false, "count > 3 must reject");
});
check("C4i. distribution non-integer/string rejected", () => {
  assert(validation.validateDistributionResult({ distributed_vendor_count: 2.5 }).ok === false, "fraction must reject");
  assert(validation.validateDistributionResult({ distributed_vendor_count: "2" }).ok === false, "string must reject");
});
check("C4j. MAX_VENDORS_PER_LEAD constant is 3", () => {
  assert(types.MAX_VENDORS_PER_LEAD === 3, "shared max vendor constant must be 3");
});

// ==================================================================
// CORRECTION 3 — Manual review resolution contract
// ==================================================================
const REVIEWER = "admin_42";
check("C3a. manual review -> matching (APPROVE_FOR_MATCHING) with reviewer", () => {
  const r = runValidStep(S.MANUAL_REVIEW_PENDING, E.MANUAL_REVIEW_RESOLVED, { outcome: O.APPROVE_FOR_MATCHING, reviewed_by: REVIEWER });
  assert(r.nextState === S.READY_FOR_MATCHING, `got ${r.nextState}`);
  assert(r.metadata.reviewed_by === REVIEWER, "reviewer must be in metadata");
});
check("C3b. manual review -> clarification (ALLOW_CLARIFICATION) with reviewer", () => {
  assert(runValidStep(S.MANUAL_REVIEW_PENDING, E.MANUAL_REVIEW_RESOLVED, { outcome: O.ALLOW_CLARIFICATION, reviewed_by: REVIEWER }).nextState === S.CLARIFICATION_PENDING_1);
});
check("C3c. manual review -> nurture (SEND_TO_NURTURE) with reviewer", () => {
  assert(runValidStep(S.MANUAL_REVIEW_PENDING, E.MANUAL_REVIEW_RESOLVED, { outcome: O.SEND_TO_NURTURE, reviewed_by: REVIEWER }).nextState === S.NURTURE_PENDING);
});
check("C3d. manual review -> reject (REJECT) with reviewer", () => {
  assert(runValidStep(S.MANUAL_REVIEW_PENDING, E.MANUAL_REVIEW_RESOLVED, { outcome: O.REJECT, reviewed_by: REVIEWER }).nextState === S.REJECTED);
});
check("C3e. manual review -> close (CLOSE) with reviewer", () => {
  assert(runValidStep(S.MANUAL_REVIEW_PENDING, E.MANUAL_REVIEW_RESOLVED, { outcome: O.CLOSE, reviewed_by: REVIEWER }).nextState === S.CLOSED);
});
check("C3f. APPROVE_DISTRIBUTION removed; generic manual review cannot reach DISTRIBUTION_PENDING", () => {
  assert(O.APPROVE_DISTRIBUTION === undefined, "APPROVE_DISTRIBUTION outcome must not exist");
  assert(validation.validateManualReviewResolution({ outcome: "APPROVE_DISTRIBUTION", reviewed_by: REVIEWER }).ok === false, "APPROVE_DISTRIBUTION must be an invalid outcome");
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.MANUAL_REVIEW_PENDING, E.MANUAL_REVIEW_RESOLVED, { outcome: "APPROVE_DISTRIBUTION", reviewed_by: REVIEWER }))), "handler must reject APPROVE_DISTRIBUTION");
  assert(!states.LEAD_LIFECYCLE_TRANSITIONS[S.MANUAL_REVIEW_PENDING].includes(S.DISTRIBUTION_PENDING), "no direct manual-review distribution edge");
  const v = state.validateWorkflowTransition(definition, S.MANUAL_REVIEW_PENDING, S.DISTRIBUTION_PENDING, "active");
  assert(v.ok === false && v.code === "INVALID_TRANSITION", "kernel must reject manual review -> distribution");
});
check("C3g. invalid / missing manual review outcome rejected", () => {
  assert(validation.validateManualReviewResolution({ outcome: "FOO", reviewed_by: REVIEWER }).ok === false, "unknown outcome must reject");
  assert(validation.validateManualReviewResolution({ reviewed_by: REVIEWER }).ok === false, "missing outcome must reject");
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.MANUAL_REVIEW_PENDING, E.MANUAL_REVIEW_RESOLVED, { outcome: "FOO", reviewed_by: REVIEWER }))), "handler must throw on invalid outcome");
});
check("C3h. missing reviewed_by rejects (MANUAL_REVIEW_REVIEWER_REQUIRED)", () => {
  const r = validation.validateManualReviewResolution({ outcome: O.APPROVE_FOR_MATCHING });
  assert(r.ok === false && r.message === "MANUAL_REVIEW_REVIEWER_REQUIRED", "missing reviewer must reject with clear error");
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.MANUAL_REVIEW_PENDING, E.MANUAL_REVIEW_RESOLVED, { outcome: O.APPROVE_FOR_MATCHING }))), "handler must throw without reviewer");
});
check("C3i. blank / non-string reviewed_by rejects", () => {
  assert(validation.validateManualReviewResolution({ outcome: O.REJECT, reviewed_by: "   " }).ok === false, "whitespace reviewer must reject");
  assert(validation.validateManualReviewResolution({ outcome: O.REJECT, reviewed_by: "" }).ok === false, "empty reviewer must reject");
  assert(validation.validateManualReviewResolution({ outcome: O.REJECT, reviewed_by: 7 }).ok === false, "non-string reviewer must reject");
});
check("C3j. reviewed_by is trimmed and stored in result metadata", () => {
  const r = runValidStep(S.MANUAL_REVIEW_PENDING, E.MANUAL_REVIEW_RESOLVED, { outcome: O.CLOSE, reviewed_by: "  admin_7  " });
  assert(r.metadata.reviewed_by === "admin_7", `reviewer should be trimmed, got ${r.metadata.reviewed_by}`);
});
check("C3k. ALLOW_CLARIFICATION requires reviewer (human override only)", () => {
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.MANUAL_REVIEW_PENDING, E.MANUAL_REVIEW_RESOLVED, { outcome: O.ALLOW_CLARIFICATION }))), "ALLOW_CLARIFICATION without reviewer must reject");
  const r = runValidStep(S.MANUAL_REVIEW_PENDING, E.MANUAL_REVIEW_RESOLVED, { outcome: O.ALLOW_CLARIFICATION, reviewed_by: REVIEWER });
  assert(r.nextState === S.CLARIFICATION_PENDING_1 && r.metadata.reviewed_by === REVIEWER, "ALLOW_CLARIFICATION with reviewer must succeed");
});
check("C3l. MANUAL_REVIEW_PENDING edges exactly match final outcome destinations", () => {
  const edges = new Set(states.LEAD_LIFECYCLE_TRANSITIONS[S.MANUAL_REVIEW_PENDING]);
  const expected = new Set([S.READY_FOR_MATCHING, S.CLARIFICATION_PENDING_1, S.NURTURE_PENDING, S.REJECTED, S.CLOSED]);
  assert(edges.size === expected.size, `edge count mismatch: ${[...edges].join(",")}`);
  for (const e of expected) assert(edges.has(e), `missing edge ${e}`);
  assert(!edges.has(S.DISTRIBUTION_PENDING), "no distribution escape from generic manual review");
  assert(!edges.has(S.FAILED), "no FAILED escape from manual review");
});
check("C3m. manual review outcome enum is exactly the five safe outcomes", () => {
  const outcomes = new Set(Object.values(O));
  const expected = new Set(["APPROVE_FOR_MATCHING", "ALLOW_CLARIFICATION", "SEND_TO_NURTURE", "REJECT", "CLOSE"]);
  assert(outcomes.size === expected.size, `outcome count mismatch: ${[...outcomes].join(",")}`);
  for (const e of expected) assert(outcomes.has(e), `missing outcome ${e}`);
});

// ==================================================================
// Nurture requalification
// ==================================================================
check("C5a. nurture requalification: NURTURE_PENDING -> QUALITY_SCORING_PENDING", () => {
  const result = runValidStep(S.NURTURE_PENDING, E.NURTURE_REQUALIFICATION_REQUESTED, {});
  assert(result.nextState === S.QUALITY_SCORING_PENDING, `got ${result.nextState}`);
  assert(result.tasks[0].taskType === T.QUALITY_SCORE, "requalification should re-open the quality score task intent");
  assert(result.metadata.requalification === true, "should flag requalification");
});

// ==================================================================
// Validation + invalid combinations + terminal safety (retained)
// ==================================================================
check("18. invalid quality tier rejected by validation and handler", () => {
  const invalid = validation.validateQualityResult({ tier: "Z" });
  assert(invalid.ok === false && invalid.message === "QUALITY_TIER_INVALID");
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "Z" }))));
});
check("18b. arbitrary score strings are not accepted", () => {
  assert(validation.validateQualityResult({ tier: "92" }).ok === false);
  assert(validation.validateQualityResult({ tier: "great" }).ok === false);
  assert(validation.validateQualityResult({}).ok === false);
});
check("18c. clarification_cycle must be a non-negative integer (payload hygiene)", () => {
  assert(validation.validateQualityResult({ tier: "B", clarification_cycle: -1 }).ok === false);
  assert(validation.validateQualityResult({ tier: "B", clarification_cycle: 1.5 }).ok === false);
  assert(validation.validateQualityResult({ tier: "B", clarification_cycle: 0 }).ok === true);
});
check("19. invalid event/state combination rejected", () => {
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.READY_FOR_MATCHING, E.QUALITY_RESULTED, { tier: "A" }))));
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.RECEIVED, E.MATCHING_REQUESTED, {}))));
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.MATCH_RECOMMENDATION_READY, E.DISTRIBUTION_APPROVED, {}))));
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.QUALITY_SCORING_PENDING, E.NURTURE_REQUALIFICATION_REQUESTED, {}))));
});
check("20. terminal REJECTED workflow cannot continue into matching", () => {
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.REJECTED, E.MATCHING_REQUESTED, {}))));
  const v = state.validateWorkflowTransition(definition, S.REJECTED, S.MATCHING_PENDING, "cancelled");
  assert(v.ok === false && v.code === "TERMINAL_WORKFLOW");
});
check("21. CLOSED is terminal", () => {
  assert(states.LEAD_LIFECYCLE_TERMINAL_STATES.includes(S.CLOSED));
  assert(state.isTerminalState(definition, S.CLOSED));
  assert(state.validateWorkflowTransition(definition, S.CLOSED, S.READY_FOR_MATCHING, "completed").ok === false);
  assert(!states.LEAD_LIFECYCLE_TRANSITIONS[S.CLOSED]);
});
check("21b. terminal states have no outgoing edges", () => {
  for (const terminal of states.LEAD_LIFECYCLE_TERMINAL_STATES) {
    assert(!states.LEAD_LIFECYCLE_TRANSITIONS[terminal], `${terminal} must have no outgoing transitions`);
  }
  assert(states.leadLifecycleStatusForState(S.FAILED) === "failed");
});

// ==================================================================
// Deterministic idempotency keys (retained)
// ==================================================================
check("22. task intents use deterministic idempotency keys", () => {
  const key1 = taskIntents.buildLeadLifecycleTaskIdempotencyKey("wf_x", "evt_y", T.QUALITY_SCORE);
  const key2 = taskIntents.buildLeadLifecycleTaskIdempotencyKey("wf_x", "evt_y", T.QUALITY_SCORE);
  assert(key1 === key2 && key1 === "qf_lead_lifecycle:task:wf_x:evt_y:lead.quality.score", `unexpected key: ${key1}`);
  const ctx = makeContext(S.RECEIVED, E.LIFECYCLE_STARTED, {});
  const first = handlerMod.leadLifecycleHandler(ctx);
  const second = handlerMod.leadLifecycleHandler(ctx);
  assert(first.tasks[0].idempotencyKey === second.tasks[0].idempotencyKey, "replay must reproduce identical key");
  assert(!/\d{13}|Math\.random|[0-9a-f]{8}-[0-9a-f]{4}/.test(first.tasks[0].idempotencyKey), "key must not embed timestamps/random/uuid");
});

// ==================================================================
// No forbidden imports / no provider execution (retained)
// ==================================================================
const lifecycleSources = lifecycleFiles.map((file) => readFileSync(`${LIFECYCLE_DIR}/${file}`, "utf8"));
const combinedSource = lifecycleSources.join("\n");

function collectModuleSpecifiers(source) {
  const specifiers = [];
  const importRe = /import[\s\S]*?from\s+['"]([^'"]+)['"]/g;
  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = importRe.exec(source)) !== null) specifiers.push(match[1]);
  while ((match = requireRe.exec(source)) !== null) specifiers.push(match[1]);
  return specifiers;
}

const allSpecifiers = lifecycleSources.flatMap(collectModuleSpecifiers);
const FORBIDDEN_IMPORT = /services\/|leadService|leadQualityService|leadClarificationService|leadMatchingEngine|leadDeliveryService|n8n|whatsapp|twilio|sendgrid|axios|node-fetch|@supabase|stripe|razorpay|credit|wallet|ledger/i;

check("23-25. no real lead/matching/delivery service imports", () => {
  const offenders = allSpecifiers.filter((s) => /services\/|leadService|leadMatchingEngine|leadDeliveryService|leadClarificationService|leadQualityService/i.test(s));
  assert(offenders.length === 0, `forbidden service imports: ${offenders.join(", ")}`);
});
check("26. no credit mutation imports", () => {
  assert(allSpecifiers.filter((s) => /credit|wallet|ledger/i.test(s)).length === 0);
});
check("27-28. no WhatsApp or n8n imports", () => {
  assert(allSpecifiers.filter((s) => /whatsapp|n8n|meta|twilio/i.test(s)).length === 0);
});
check("28b. every lifecycle import specifier is workflow-internal", () => {
  const offenders = allSpecifiers.filter((s) => FORBIDDEN_IMPORT.test(s));
  assert(offenders.length === 0, `forbidden imports: ${offenders.join(", ")}`);
});
check("29. no provider execution primitives / assignment / credit mutation in source", () => {
  assert(!/\bfetch\s*\(/.test(combinedSource), "no fetch() calls");
  assert(!/\baxios\b/.test(combinedSource), "no axios");
  assert(!/createClient\s*\(/.test(combinedSource), "no supabase client");
  assert(!/\.send\s*\(/.test(combinedSource), "no channel .send()");
  assert(!/Math\.random/.test(combinedSource), "no randomness in a deterministic lifecycle");
  assert(!/assign_leads_to_vendors|insert\s+into|\.rpc\s*\(/i.test(combinedSource), "no assignment RPC / DB writes");
});

// ==================================================================
// Isolation + structural integrity (retained)
// ==================================================================
check("30. qf_kernel_test remains isolated from the lead lifecycle", () => {
  assert(states.LEAD_LIFECYCLE_WORKFLOW_TYPE === "qf_lead_lifecycle");
  assert(states.LEAD_LIFECYCLE_WORKFLOW_TYPE !== kernelTest.QF_KERNEL_TEST_WORKFLOW_TYPE);
  assert(!/qf_kernel_test/.test(combinedSource), "lifecycle source must not reference the test workflow");
  const registry = registryMod.createWorkflowRegistry();
  registry.register(kernelTest.createQfKernelTestWorkflowDefinition());
  registrationMod.registerLeadLifecycleWorkflow(registry);
  const list = registry.listWorkflowTypes();
  assert(list.includes("qf_kernel_test") && list.includes("qf_lead_lifecycle"));
  assert(registry.resolve("qf_kernel_test").initialState === "CREATED");
  assert(registry.resolve("qf_lead_lifecycle").initialState === S.RECEIVED);
});
check("31. definition serializes without real service references", () => {
  const serialized = JSON.stringify({
    workflowType: definition.workflowType,
    initialState: definition.initialState,
    terminalStates: definition.terminalStates,
    transitions: definition.transitions,
  });
  assert(!/leadService|leadMatching|vendor|credit|whatsapp|n8n/i.test(serialized));
});
check("32. transition graph only targets known states", () => {
  const known = new Set(Object.values(S));
  for (const [from, targets] of Object.entries(states.LEAD_LIFECYCLE_TRANSITIONS)) {
    assert(known.has(from), `unknown source state ${from}`);
    for (const target of targets) assert(known.has(target), `unknown target ${target} from ${from}`);
  }
});
check("33. registration rejects duplicate lead lifecycle", () => {
  const registry = registryMod.createWorkflowRegistry();
  registrationMod.registerLeadLifecycleWorkflow(registry);
  assert(expectThrows(() => registrationMod.registerLeadLifecycleWorkflow(registry)));
});
check("34. full happy path still kernel-valid end to end", () => {
  const steps = [
    [S.RECEIVED, E.LIFECYCLE_STARTED, {}, S.QUALITY_SCORING_PENDING],
    [S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "A+" }, S.READY_FOR_MATCHING],
    [S.READY_FOR_MATCHING, E.MATCHING_REQUESTED, {}, S.MATCHING_PENDING],
    [S.MATCHING_PENDING, E.MATCHING_COMPLETED, { recommended_vendor_count: 3 }, S.MATCH_RECOMMENDATION_READY],
    [S.MATCH_RECOMMENDATION_READY, E.DISTRIBUTION_APPROVAL_REQUIRED, APPROVAL_REQUIRED_PAYLOAD, S.DISTRIBUTION_APPROVAL_PENDING],
    [S.DISTRIBUTION_APPROVAL_PENDING, E.DISTRIBUTION_APPROVED, APPROVED_PAYLOAD, S.DISTRIBUTION_PENDING],
    [S.DISTRIBUTION_PENDING, E.DISTRIBUTION_COMPLETED, DISTRIBUTION_COMPLETED_PAYLOAD, S.DISTRIBUTED],
    [S.DISTRIBUTED, E.CLOSED, {}, S.CLOSED],
  ];
  for (const [from, evt, payload, expected] of steps) {
    assert(runValidStep(from, evt, payload).nextState === expected, `expected ${expected} from ${from}`);
  }
});
check("35. full clarification path still kernel-valid end to end", () => {
  const steps = [
    [S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "B" }, S.CLARIFICATION_PENDING_1],
    [S.CLARIFICATION_PENDING_1, E.CLARIFICATION_COMPLETED, {}, S.RESCORE_PENDING_1],
    [S.RESCORE_PENDING_1, E.QUALITY_RESULTED, { tier: "A" }, S.READY_FOR_MATCHING],
  ];
  for (const [from, evt, payload, expected] of steps) {
    assert(runValidStep(from, evt, payload).nextState === expected, `expected ${expected} from ${from}`);
  }
});

// ==================================================================
// Report
// ==================================================================
for (const item of checks) {
  console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
  if (!item.ok) console.error(item.error);
}

rmSync(outDir, { recursive: true, force: true });

const failures = checks.filter((item) => !item.ok);
if (failures.length > 0) {
  console.error(`\n${failures.length} Phase 2A harness check(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} Phase 2A lead lifecycle harness checks passed.`);
