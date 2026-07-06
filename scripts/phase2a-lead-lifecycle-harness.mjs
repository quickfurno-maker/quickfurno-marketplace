import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 2A — QuickFurno Lead Lifecycle harness.
 *
 * This is a SOURCE/STATIC test harness. It compiles the pure lifecycle modules
 * plus the generic kernel validators to a throwaway build, then exercises the
 * deterministic handler and cross-checks every produced transition against the
 * kernel's own `validateWorkflowTransition` and `validateHandlerResult`.
 *
 * It does NOT connect to any database and does NOT claim real database
 * integration. Runtime DB integration is intentionally deferred to a later phase.
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
const validation = requireFromBuild(`./${LIFECYCLE_DIR}/leadLifecycleValidation.js`);
const taskIntents = requireFromBuild(`./${LIFECYCLE_DIR}/leadLifecycleTaskIntents.js`);
const handlerMod = requireFromBuild(`./${LIFECYCLE_DIR}/leadLifecycleHandler.js`);
const definitionMod = requireFromBuild(`./${LIFECYCLE_DIR}/leadLifecycleDefinition.js`);
const registrationMod = requireFromBuild(`./${LIFECYCLE_DIR}/leadLifecycleRegistration.js`);

const S = states.LeadLifecycleState;
const E = events.LeadLifecycleEventType;
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

let seq = 0;
function makeContext(currentState, eventType, payload = {}) {
  seq += 1;
  const workflowId = `wf_${seq}`;
  const eventId = `evt_${seq}`;
  return {
    workflow: {
      id: workflowId,
      workflow_type: states.LEAD_LIFECYCLE_WORKFLOW_TYPE,
      entity_type: "lead",
      entity_id: "lead_1",
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
      id: eventId,
      event_type: eventType,
      entity_type: "lead",
      entity_id: "lead_1",
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
function runValidStep(currentState, eventType, payload) {
  const context = makeContext(currentState, eventType, payload);
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

function expectThrows(fn) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  return threw;
}

// ------------------------------------------------------------------
// 1. Lifecycle start
// ------------------------------------------------------------------
check("1. lifecycle start enters QUALITY_SCORING_PENDING", () => {
  const result = runValidStep(S.RECEIVED, E.LIFECYCLE_STARTED, { lead_id: "L1" });
  assert(result.nextState === S.QUALITY_SCORING_PENDING, `got ${result.nextState}`);
  assert(result.workflowStatus === "active", "start should stay active");
  assert(result.tasks?.[0]?.taskType === taskIntents.LeadLifecycleTaskIntent.QUALITY_SCORE, "should open quality score task");
});

// ------------------------------------------------------------------
// 2-7. Quality routing (initial)
// ------------------------------------------------------------------
check("2. A+ routes to READY_FOR_MATCHING", () => {
  const result = runValidStep(S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "A+" });
  assert(result.nextState === S.READY_FOR_MATCHING, `got ${result.nextState}`);
});

check("3. A routes to READY_FOR_MATCHING", () => {
  const result = runValidStep(S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "A" });
  assert(result.nextState === S.READY_FOR_MATCHING, `got ${result.nextState}`);
});

check("4. B routes to CLARIFICATION_PENDING", () => {
  const result = runValidStep(S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "B" });
  assert(result.nextState === S.CLARIFICATION_PENDING, `got ${result.nextState}`);
  assert(result.tasks?.[0]?.taskType === taskIntents.LeadLifecycleTaskIntent.CLARIFICATION_PREPARE, "should open clarification prepare task");
});

check("5. C routes to NURTURE_PENDING", () => {
  const result = runValidStep(S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "C" });
  assert(result.nextState === S.NURTURE_PENDING, `got ${result.nextState}`);
});

check("6. D routes to REJECTED", () => {
  const result = runValidStep(S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "D" });
  assert(result.nextState === S.REJECTED, `got ${result.nextState}`);
  assert(result.workflowStatus === "cancelled", "rejected should be cancelled status");
});

check("7. D + manual_review_required routes to MANUAL_REVIEW_PENDING", () => {
  const result = runValidStep(S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, {
    tier: "D",
    manual_review_required: true,
  });
  assert(result.nextState === S.MANUAL_REVIEW_PENDING, `got ${result.nextState}`);
});

// ------------------------------------------------------------------
// 8-11. Clarification + rescore + loop safety
// ------------------------------------------------------------------
check("8. clarification completed routes to RESCORE_PENDING", () => {
  const result = runValidStep(S.CLARIFICATION_PENDING, E.CLARIFICATION_COMPLETED, { lead_id: "L1" });
  assert(result.nextState === S.RESCORE_PENDING, `got ${result.nextState}`);
  assert(result.tasks?.[0]?.taskType === taskIntents.LeadLifecycleTaskIntent.QUALITY_RESCORE, "should open rescore task");
});

check("9. rescore A routes to READY_FOR_MATCHING", () => {
  const result = runValidStep(S.RESCORE_PENDING, E.QUALITY_RESULTED, { tier: "A" });
  assert(result.nextState === S.READY_FOR_MATCHING, `got ${result.nextState}`);
});

check("10. rescore B without permission does NOT re-enter clarification (loop safe)", () => {
  const result = runValidStep(S.RESCORE_PENDING, E.QUALITY_RESULTED, { tier: "B" });
  assert(result.nextState !== S.CLARIFICATION_PENDING, "must not loop back into clarification");
  assert(result.nextState === S.MANUAL_REVIEW_PENDING, `got ${result.nextState}`);
  assert(result.metadata?.quality?.loop_safety_applied === true, "loop safety flag should be recorded");
});

check("11. rescore B with explicit clarification_allowed routes to CLARIFICATION_PENDING", () => {
  const result = runValidStep(S.RESCORE_PENDING, E.QUALITY_RESULTED, {
    tier: "B",
    clarification_allowed: true,
    clarification_cycle: 1,
  });
  assert(result.nextState === S.CLARIFICATION_PENDING, `got ${result.nextState}`);
});

check("11b. rescore B with clarification_allowed but cap exhausted routes to MANUAL_REVIEW_PENDING", () => {
  const result = runValidStep(S.RESCORE_PENDING, E.QUALITY_RESULTED, {
    tier: "B",
    clarification_allowed: true,
    clarification_cycle: handlerMod.MAX_CLARIFICATION_CYCLES,
  });
  assert(result.nextState === S.MANUAL_REVIEW_PENDING, `got ${result.nextState}`);
});

// ------------------------------------------------------------------
// 12-13. Matching lifecycle
// ------------------------------------------------------------------
check("12. matching requested: READY_FOR_MATCHING -> MATCHING_PENDING", () => {
  const result = runValidStep(S.READY_FOR_MATCHING, E.MATCHING_REQUESTED, { lead_id: "L1" });
  assert(result.nextState === S.MATCHING_PENDING, `got ${result.nextState}`);
  assert(result.tasks?.[0]?.taskType === taskIntents.LeadLifecycleTaskIntent.MATCHING_PREPARE, "should open matching prepare task");
});

check("13. matching completed: MATCHING_PENDING -> MATCH_RECOMMENDATION_READY", () => {
  const result = runValidStep(S.MATCHING_PENDING, E.MATCHING_COMPLETED, { lead_id: "L1" });
  assert(result.nextState === S.MATCH_RECOMMENDATION_READY, `got ${result.nextState}`);
});

// ------------------------------------------------------------------
// 14-16. Distribution approval lifecycle + future auto authorization
// ------------------------------------------------------------------
check("14. approval required: MATCH_RECOMMENDATION_READY -> DISTRIBUTION_APPROVAL_PENDING", () => {
  const result = runValidStep(S.MATCH_RECOMMENDATION_READY, E.DISTRIBUTION_APPROVAL_REQUIRED, {});
  assert(result.nextState === S.DISTRIBUTION_APPROVAL_PENDING, `got ${result.nextState}`);
});

check("15. explicit approval: DISTRIBUTION_APPROVAL_PENDING -> DISTRIBUTION_PENDING", () => {
  const result = runValidStep(S.DISTRIBUTION_APPROVAL_PENDING, E.DISTRIBUTION_APPROVED, {});
  assert(result.nextState === S.DISTRIBUTION_PENDING, `got ${result.nextState}`);
});

check("16. auto-authorized exists but does not activate real distribution", () => {
  const result = runValidStep(S.MATCH_RECOMMENDATION_READY, E.DISTRIBUTION_AUTO_AUTHORIZED, {});
  assert(result.nextState === S.DISTRIBUTION_PENDING, `got ${result.nextState}`);
  assert(result.metadata?.auto_authorized === true, "should flag auto authorization");
  // No external side effects: only a persistence-only prepare task intent, no outbox commands.
  assert(!result.outboxCommands || result.outboxCommands.length === 0, "auto-authorize must not emit outbox/provider commands");
  assert(result.tasks?.[0]?.taskType === taskIntents.LeadLifecycleTaskIntent.DISTRIBUTION_PREPARE, "should only open a prepare intent");
});

// ------------------------------------------------------------------
// 17. Distribution completion + closure
// ------------------------------------------------------------------
check("17. distribution completed: DISTRIBUTION_PENDING -> DISTRIBUTED", () => {
  const result = runValidStep(S.DISTRIBUTION_PENDING, E.DISTRIBUTION_COMPLETED, {});
  assert(result.nextState === S.DISTRIBUTED, `got ${result.nextState}`);
});

check("17b. distributed can close: DISTRIBUTED -> CLOSED", () => {
  const result = runValidStep(S.DISTRIBUTED, E.CLOSED, {});
  assert(result.nextState === S.CLOSED, `got ${result.nextState}`);
  assert(result.workflowStatus === "completed", "closed should complete workflow");
});

// ------------------------------------------------------------------
// 18-21. Validation + invalid combinations + terminal safety
// ------------------------------------------------------------------
check("18. invalid quality tier rejected by validation and handler", () => {
  const invalid = validation.validateQualityResult({ tier: "Z" });
  assert(invalid.ok === false && invalid.message === "QUALITY_TIER_INVALID", "validation must reject unknown tier");
  const threw = expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "Z" })));
  assert(threw, "handler must throw on invalid tier");
});

check("18b. arbitrary score strings are not accepted", () => {
  assert(validation.validateQualityResult({ tier: "92" }).ok === false, "numeric-string score must reject");
  assert(validation.validateQualityResult({ tier: "great" }).ok === false, "freeform tier must reject");
  assert(validation.validateQualityResult({}).ok === false, "missing tier must reject");
});

check("18c. clarification_cycle must be a non-negative integer", () => {
  assert(validation.validateQualityResult({ tier: "B", clarification_cycle: -1 }).ok === false, "negative cycle must reject");
  assert(validation.validateQualityResult({ tier: "B", clarification_cycle: 1.5 }).ok === false, "fractional cycle must reject");
  assert(validation.validateQualityResult({ tier: "B", clarification_cycle: 0 }).ok === true, "zero cycle must accept");
});

check("19. invalid event/state combination rejected", () => {
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.READY_FOR_MATCHING, E.QUALITY_RESULTED, { tier: "A" }))), "quality result is invalid in READY_FOR_MATCHING");
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.RECEIVED, E.MATCHING_REQUESTED, {}))), "matching request is invalid in RECEIVED");
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.MATCH_RECOMMENDATION_READY, E.DISTRIBUTION_APPROVED, {}))), "approval is invalid without approval-pending");
});

check("20. terminal REJECTED workflow cannot continue into matching", () => {
  assert(expectThrows(() => handlerMod.leadLifecycleHandler(makeContext(S.REJECTED, E.MATCHING_REQUESTED, {}))), "handler must refuse to leave REJECTED");
  const validationResult = state.validateWorkflowTransition(definition, S.REJECTED, S.MATCHING_PENDING, "cancelled");
  assert(validationResult.ok === false && validationResult.code === "TERMINAL_WORKFLOW", "kernel must block terminal REJECTED transitions");
});

check("21. CLOSED is terminal", () => {
  assert(states.LEAD_LIFECYCLE_TERMINAL_STATES.includes(S.CLOSED), "CLOSED must be terminal");
  assert(state.isTerminalState(definition, S.CLOSED), "definition must mark CLOSED terminal");
  const validationResult = state.validateWorkflowTransition(definition, S.CLOSED, S.READY_FOR_MATCHING, "completed");
  assert(validationResult.ok === false, "no transition allowed out of CLOSED");
  assert(!states.LEAD_LIFECYCLE_TRANSITIONS[S.CLOSED], "terminal states have no outgoing edges");
});

check("21b. FAILED and REJECTED are terminal with no outgoing edges", () => {
  for (const terminal of states.LEAD_LIFECYCLE_TERMINAL_STATES) {
    assert(!states.LEAD_LIFECYCLE_TRANSITIONS[terminal], `${terminal} must have no outgoing transitions`);
  }
  assert(states.leadLifecycleStatusForState(S.FAILED) === "failed", "FAILED maps to failed status");
});

// ------------------------------------------------------------------
// 22. Deterministic idempotency keys
// ------------------------------------------------------------------
check("22. task intents use deterministic idempotency keys", () => {
  const key1 = taskIntents.buildLeadLifecycleTaskIdempotencyKey("wf_x", "evt_y", taskIntents.LeadLifecycleTaskIntent.QUALITY_SCORE);
  const key2 = taskIntents.buildLeadLifecycleTaskIdempotencyKey("wf_x", "evt_y", taskIntents.LeadLifecycleTaskIntent.QUALITY_SCORE);
  assert(key1 === key2, "same identity must yield same key");
  assert(key1 === "qf_lead_lifecycle:task:wf_x:evt_y:lead.quality.score", `unexpected key: ${key1}`);

  // The handler produces reproducible keys from durable identity only.
  const ctx = makeContext(S.RECEIVED, E.LIFECYCLE_STARTED, { lead_id: "L1" });
  const first = handlerMod.leadLifecycleHandler(ctx);
  const second = handlerMod.leadLifecycleHandler(ctx);
  assert(first.tasks[0].idempotencyKey === second.tasks[0].idempotencyKey, "replay must reproduce identical key");
  assert(!/\d{13}|Math\.random|[0-9a-f]{8}-[0-9a-f]{4}/.test(first.tasks[0].idempotencyKey), "key must not embed timestamps/random/uuid");
});

// ------------------------------------------------------------------
// 23-29. No forbidden imports / no provider execution
// ------------------------------------------------------------------
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
const FORBIDDEN_IMPORT = /services\/|leadService|leadQualityService|leadClarificationService|leadMatchingEngine|leadDeliveryService|n8n|whatsapp|twilio|sendgrid|axios|node-fetch|@supabase|stripe|razorpay|credit/i;

check("23-25. no real lead/matching/delivery service imports", () => {
  const offenders = allSpecifiers.filter((spec) => /services\/|leadService|leadMatchingEngine|leadDeliveryService|leadClarificationService|leadQualityService/i.test(spec));
  assert(offenders.length === 0, `forbidden service imports: ${offenders.join(", ")}`);
});

check("26. no credit mutation imports", () => {
  const offenders = allSpecifiers.filter((spec) => /credit|wallet|ledger/i.test(spec));
  assert(offenders.length === 0, `forbidden credit imports: ${offenders.join(", ")}`);
});

check("27-28. no WhatsApp or n8n imports", () => {
  const offenders = allSpecifiers.filter((spec) => /whatsapp|n8n|meta|twilio/i.test(spec));
  assert(offenders.length === 0, `forbidden channel imports: ${offenders.join(", ")}`);
});

check("28b. every lifecycle import specifier is workflow-internal", () => {
  const offenders = allSpecifiers.filter((spec) => FORBIDDEN_IMPORT.test(spec));
  assert(offenders.length === 0, `forbidden imports: ${offenders.join(", ")}`);
});

check("29. no provider execution primitives in source", () => {
  assert(!/\bfetch\s*\(/.test(combinedSource), "no fetch() calls allowed");
  assert(!/\baxios\b/.test(combinedSource), "no axios usage allowed");
  assert(!/createClient\s*\(/.test(combinedSource), "no supabase client instantiation allowed");
  assert(!/\.send\s*\(/.test(combinedSource), "no channel .send() calls allowed");
  assert(!/Math\.random/.test(combinedSource), "no randomness allowed in a deterministic lifecycle");
});

// ------------------------------------------------------------------
// 30. Isolation from qf_kernel_test
// ------------------------------------------------------------------
check("30. qf_kernel_test remains isolated from the lead lifecycle", () => {
  assert(states.LEAD_LIFECYCLE_WORKFLOW_TYPE === "qf_lead_lifecycle", "stable workflow type");
  assert(states.LEAD_LIFECYCLE_WORKFLOW_TYPE !== kernelTest.QF_KERNEL_TEST_WORKFLOW_TYPE, "must differ from kernel test type");
  assert(!/qf_kernel_test/.test(combinedSource), "lifecycle source must not reference the test workflow");

  const registry = registryMod.createWorkflowRegistry();
  registry.register(kernelTest.createQfKernelTestWorkflowDefinition());
  registrationMod.registerLeadLifecycleWorkflow(registry);
  const types = registry.listWorkflowTypes();
  assert(types.includes("qf_kernel_test") && types.includes("qf_lead_lifecycle"), "both workflows coexist");
  assert(registry.resolve("qf_kernel_test").initialState === "CREATED", "kernel test unchanged");
  assert(registry.resolve("qf_lead_lifecycle").initialState === S.RECEIVED, "lifecycle initial state intact");
});

// ------------------------------------------------------------------
// Structural integrity checks
// ------------------------------------------------------------------
check("31. definition serializes without real service references", () => {
  const serialized = JSON.stringify({
    workflowType: definition.workflowType,
    initialState: definition.initialState,
    terminalStates: definition.terminalStates,
    transitions: definition.transitions,
  });
  assert(!/leadService|leadMatching|vendor|credit|whatsapp|n8n/i.test(serialized), "definition must not reference real services");
});

check("32. transition graph only targets known states", () => {
  const known = new Set(Object.values(S));
  for (const [from, targets] of Object.entries(states.LEAD_LIFECYCLE_TRANSITIONS)) {
    assert(known.has(from), `unknown source state ${from}`);
    for (const target of targets) {
      assert(known.has(target), `unknown target state ${target} from ${from}`);
    }
  }
});

check("33. registration rejects duplicate lead lifecycle", () => {
  const registry = registryMod.createWorkflowRegistry();
  registrationMod.registerLeadLifecycleWorkflow(registry);
  assert(expectThrows(() => registrationMod.registerLeadLifecycleWorkflow(registry)), "duplicate registration must throw");
});

check("34. full happy-path walk is kernel-valid end to end", () => {
  const steps = [
    [S.RECEIVED, E.LIFECYCLE_STARTED, {}, S.QUALITY_SCORING_PENDING],
    [S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "A+" }, S.READY_FOR_MATCHING],
    [S.READY_FOR_MATCHING, E.MATCHING_REQUESTED, {}, S.MATCHING_PENDING],
    [S.MATCHING_PENDING, E.MATCHING_COMPLETED, {}, S.MATCH_RECOMMENDATION_READY],
    [S.MATCH_RECOMMENDATION_READY, E.DISTRIBUTION_APPROVAL_REQUIRED, {}, S.DISTRIBUTION_APPROVAL_PENDING],
    [S.DISTRIBUTION_APPROVAL_PENDING, E.DISTRIBUTION_APPROVED, {}, S.DISTRIBUTION_PENDING],
    [S.DISTRIBUTION_PENDING, E.DISTRIBUTION_COMPLETED, {}, S.DISTRIBUTED],
    [S.DISTRIBUTED, E.CLOSED, {}, S.CLOSED],
  ];
  for (const [from, evt, payload, expected] of steps) {
    const result = runValidStep(from, evt, payload);
    assert(result.nextState === expected, `expected ${expected} got ${result.nextState}`);
  }
});

check("35. clarification loop path is kernel-valid end to end", () => {
  const steps = [
    [S.QUALITY_SCORING_PENDING, E.QUALITY_RESULTED, { tier: "B" }, S.CLARIFICATION_PENDING],
    [S.CLARIFICATION_PENDING, E.CLARIFICATION_COMPLETED, {}, S.RESCORE_PENDING],
    [S.RESCORE_PENDING, E.QUALITY_RESULTED, { tier: "A" }, S.READY_FOR_MATCHING],
  ];
  for (const [from, evt, payload, expected] of steps) {
    const result = runValidStep(from, evt, payload);
    assert(result.nextState === expected, `expected ${expected} got ${result.nextState}`);
  }
});

// ------------------------------------------------------------------
// Report
// ------------------------------------------------------------------
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
