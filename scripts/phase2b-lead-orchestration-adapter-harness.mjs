import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const outDir = resolve(".phase2b-test-build");
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
  "lib/aos/workflows/leadLifecycle/adapters/leadLifecycleServicePorts.ts",
  "lib/aos/workflows/leadLifecycle/events/leadLifecycleResultMapper.ts",
  "lib/aos/workflows/leadLifecycle/events/leadClarificationCompletedBridge.ts",
  "lib/aos/workflows/leadLifecycle/events/leadLifecycleEventPublisher.ts",
  "lib/aos/workflows/leadLifecycle/execution/leadLifecycleTaskExecutionTypes.ts",
  "lib/aos/workflows/leadLifecycle/execution/leadLifecycleTaskExecutor.ts",
  "services/leadQualityService.ts",
];

const tsconfigPath = resolve(".phase2b-tsconfig.json");
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
const mapper = requireFromBuild("./lib/aos/workflows/leadLifecycle/events/leadLifecycleResultMapper.js");
const bridge = requireFromBuild("./lib/aos/workflows/leadLifecycle/events/leadClarificationCompletedBridge.js");
const publisherMod = requireFromBuild("./lib/aos/workflows/leadLifecycle/events/leadLifecycleEventPublisher.js");
const executorMod = requireFromBuild("./lib/aos/workflows/leadLifecycle/execution/leadLifecycleTaskExecutor.js");
const events = requireFromBuild("./lib/aos/workflows/leadLifecycle/leadLifecycleEvents.js");
const tasks = requireFromBuild("./lib/aos/workflows/leadLifecycle/leadLifecycleTaskIntents.js");
const states = requireFromBuild("./lib/aos/workflows/leadLifecycle/leadLifecycleStates.js");

const checks = [];
function check(name, fn) {
  checks.push(Promise.resolve()
    .then(fn)
    .then(() => ({ name, ok: true }))
    .catch((error) => ({ name, ok: false, error })));
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function expectRejects(fn, pattern) {
  try {
    await fn();
  } catch (error) {
    if (!pattern || pattern.test(String(error?.message ?? error))) return;
    throw error;
  }
  throw new Error("Expected rejection");
}

const E = events.LeadLifecycleEventType;
const T = tasks.LeadLifecycleTaskIntent;
const LEAD_ID = "lead_123";
const WORKFLOW_ID = "wf_123";

function quality(overrides = {}) {
  return {
    contact_score: 20,
    location_score: 20,
    requirement_score: 25,
    intent_score: 25,
    fraud_penalty: 0,
    total_score: 90,
    location_confidence: 4,
    score_class: "A+",
    hard_block_reason: null,
    recommended_action: "auto_distribute",
    score_breakdown: {},
    ...overrides,
  };
}

function makeTask(taskType, payload = {}) {
  return {
    id: `task_${taskType.replace(/\W/g, "_")}_${Math.random().toString(16).slice(2)}`,
    workflow_instance_id: WORKFLOW_ID,
    task_type: taskType,
    status: "processing",
    priority: 100,
    due_at: "2026-07-07T00:00:00.000Z",
    attempt_count: 0,
    max_attempts: 5,
    next_retry_at: null,
    locked_at: "2026-07-07T00:00:00.000Z",
    locked_by: "worker_phase2b",
    idempotency_key: null,
    payload_json: {
      lead_id: LEAD_ID,
      workflow_instance_id: WORKFLOW_ID,
      triggered_by_event: "evt_driver",
      ...payload,
    },
    result_json: {},
    last_error: null,
    created_at: "2026-07-07T00:00:00.000Z",
    started_at: "2026-07-07T00:00:00.000Z",
    completed_at: null,
    updated_at: "2026-07-07T00:00:00.000Z",
  };
}

function makeDomainEvent(input, n = 1) {
  return {
    id: `evt_result_${n}`,
    event_type: input.eventType,
    entity_type: input.entityType,
    entity_id: input.entityId,
    payload_version: 1,
    payload_json: input.payload,
    trace_id: input.traceId,
    correlation_id: input.correlationId,
    causation_id: input.causationId,
    idempotency_key: input.idempotencyKey,
    processing_status: "pending",
    processed_at: null,
    created_at: "2026-07-07T00:00:00.000Z",
    updated_at: "2026-07-07T00:00:00.000Z",
    locked_at: null,
    locked_by: null,
    attempt_count: 0,
    max_attempts: 5,
    next_retry_at: null,
  };
}

class InMemoryDomainEventRepository {
  constructor() {
    this.byKey = new Map();
    this.insertCount = 0;
    this.failUnrelated = false;
  }
  async insert(input) {
    this.insertCount += 1;
    if (this.failUnrelated) throw new Error("POSTGREST_UNRELATED_FAILURE");
    if (this.byKey.has(input.idempotencyKey)) {
      throw { code: "23505", message: "duplicate key violates idempotency index" };
    }
    const event = makeDomainEvent(input, this.insertCount);
    this.byKey.set(input.idempotencyKey, event);
    return event;
  }
  async findByIdempotencyKey(key) {
    return this.byKey.get(key) ?? null;
  }
}

function makeDeps(overrides = {}) {
  const calls = {
    quality: 0,
    latestQuality: 0,
    clarification: 0,
    matching: 0,
    published: [],
  };
  const publisher = {
    async publish(input) {
      calls.published.push(input);
      return makeDomainEvent({
        eventType: input.eventType,
        entityType: "lead",
        entityId: input.leadId,
        payload: { workflow_type: states.LEAD_LIFECYCLE_WORKFLOW_TYPE, lead_id: input.leadId, ...(input.payload ?? {}) },
        traceId: input.traceId ?? null,
        correlationId: input.correlationId ?? null,
        causationId: input.causationId ?? null,
        idempotencyKey: publisherMod.buildLeadLifecycleResultEventIdempotencyKey(input.workflowTaskId),
      });
    },
  };
  return {
    calls,
    deps: {
      ports: {
        quality: {
          async scoreLead() {
            calls.quality += 1;
            return overrides.qualityResult ?? quality();
          },
        },
        latestQuality: {
          async readLatestQualityResult() {
            calls.latestQuality += 1;
            return overrides.latestQualityResult ?? quality({ score_class: "A", total_score: 75 });
          },
        },
        clarification: {
          async prepareClarification() {
            calls.clarification += 1;
            return { requestId: "clar_1", status: "preview_prepared", missingFields: ["budget"], questionsCount: 1 };
          },
        },
        matchingRecommendation: {
          async prepareRecommendations() {
            calls.matching += 1;
            return {
              leadId: LEAD_ID,
              eligibleVendorCount: overrides.eligibleVendorCount ?? (overrides.recommendations ?? ["v3", "v2", "v1", "v0"]).length,
              recommendedVendorIds: overrides.recommendations ?? ["v3", "v2", "v1", "v0"],
            };
          },
        },
      },
      resultEventPublisher: overrides.publisher ?? publisher,
    },
  };
}

check("1. quality task dispatches to quality port", async () => {
  const { deps, calls } = makeDeps();
  await executorMod.executeLeadLifecycleTask(makeTask(T.QUALITY_SCORE), deps);
  assert(calls.quality === 1, "quality port should be called once");
});

check("2. auto-distributable A+ maps to lead.quality.resulted A+", () => {
  const event = mapper.mapQualityResultToLifecycleEvent(quality(), "initial");
  assert(event.eventType === E.QUALITY_RESULTED, "expected quality result event");
  assert(event.payload.quality.tier === "A+", "expected A+ tier");
});

check("3. auto-distributable A maps correctly", () => {
  const event = mapper.mapQualityResultToLifecycleEvent(quality({ score_class: "A", total_score: 75 }), "initial");
  assert(event.eventType === E.QUALITY_RESULTED && event.payload.quality.tier === "A", "expected A tier");
});

check("4. B clarification result maps correctly", () => {
  const event = mapper.mapQualityResultToLifecycleEvent(quality({
    score_class: "B",
    total_score: 60,
    recommended_action: "clarification_required",
    hard_block_reason: "score_below_auto_distribution_threshold",
  }), "initial");
  assert(event.eventType === E.QUALITY_RESULTED && event.payload.quality.tier === "B", "expected B");
});

check("5. C nurture result maps correctly", () => {
  const event = mapper.mapQualityResultToLifecycleEvent(quality({
    score_class: "C",
    total_score: 45,
    recommended_action: "nurture",
    hard_block_reason: "score_below_auto_distribution_threshold",
  }), "initial");
  assert(event.payload.quality.tier === "C", "expected C");
});

check("6. D rejection result maps correctly", () => {
  const event = mapper.mapQualityResultToLifecycleEvent(quality({
    score_class: "D",
    total_score: 30,
    recommended_action: "reject_or_manual_review",
    hard_block_reason: "score_below_auto_distribution_threshold",
  }), "initial");
  assert(event.eventType === E.QUALITY_RESULTED && event.payload.quality.tier === "D", "expected D");
});

check("7. A/A+ with hard block does not map to matching path", () => {
  for (const tier of ["A+", "A"]) {
    const event = mapper.mapQualityResultToLifecycleEvent(quality({
      score_class: tier,
      total_score: tier === "A+" ? 90 : 75,
      hard_block_reason: "missing_share_consent",
    }), "initial");
    assert(event.eventType === E.MANUAL_REVIEW_REQUIRED, `${tier} hard block must require manual review`);
  }
});

check("8. manual-review condition maps to lead.manual_review.required", () => {
  const event = mapper.mapQualityResultToLifecycleEvent(quality({
    score_class: "A+",
    recommended_action: "manual_review_suspicious_name",
    hard_block_reason: "fake_or_test_name",
  }), "initial");
  assert(event.eventType === E.MANUAL_REVIEW_REQUIRED, "expected manual review");
});

check("9. every current recommended_action has explicit mapping behavior", () => {
  const expected = [
    "auto_distribute",
    "clarification_required",
    "nurture",
    "reject_or_manual_review",
    "duplicate_no_bill",
    "consent_required_no_distribution",
    "invalid_phone_no_distribution",
    "manual_review_suspicious_name",
  ];
  const actual = mapper.listExplicitlyMappedRecommendedActions();
  assert(expected.every((item) => actual.includes(item)), "missing explicit recommended action");
});

check("10. clarification prepare calls only clarification port", async () => {
  const { deps, calls } = makeDeps();
  await executorMod.executeLeadLifecycleTask(makeTask(T.CLARIFICATION_PREPARE), deps);
  assert(calls.clarification === 1 && calls.quality === 0 && calls.matching === 0, "wrong ports called");
});

check("11. clarification prepare does not emit clarification.completed", async () => {
  const { deps, calls } = makeDeps();
  await executorMod.executeLeadLifecycleTask(makeTask(T.CLARIFICATION_PREPARE), deps);
  assert(calls.published.length === 0, "clarification prepare must not publish completion");
});

check("12. clarification prepare does not send communication", async () => {
  const { deps } = makeDeps();
  const result = await executorMod.executeLeadLifecycleTask(makeTask(T.CLARIFICATION_PREPARE), deps);
  assert(result.result.communication_sent === false, "communication must remain disabled");
});

check("13. rescore task reads latest persisted result", async () => {
  const { deps, calls } = makeDeps();
  await executorMod.executeLeadLifecycleTask(makeTask(T.QUALITY_RESCORE), deps);
  assert(calls.latestQuality === 1, "latest quality port should be used");
});

check("14. rescore task does not call recalculateLeadAfterClarification", async () => {
  const { deps, calls } = makeDeps();
  const result = await executorMod.executeLeadLifecycleTask(makeTask(T.QUALITY_RESCORE), deps);
  assert(calls.quality === 0, "quality score port must not be called for rescore");
  assert(result.result.recalculated_in_executor === false, "executor must not recalculate");
});

check("15. matching prepare calls read-only recommendation port", async () => {
  const { deps, calls } = makeDeps();
  await executorMod.executeLeadLifecycleTask(makeTask(T.MATCHING_PREPARE), deps);
  assert(calls.matching === 1, "matching recommendation port not called");
});

check("16. matching recommendation preserves input ranking order", async () => {
  const { deps, calls } = makeDeps({ recommendations: ["v9", "v4", "v2"] });
  await executorMod.executeLeadLifecycleTask(makeTask(T.MATCHING_PREPARE), deps);
  assert(calls.published[0].payload.recommended_vendor_ids.join(",") === "v9,v4,v2", "rank order changed");
});

check("17. matching returns at most 3 recommendation IDs", async () => {
  const { deps, calls } = makeDeps({ recommendations: ["v1", "v2", "v3", "v4"] });
  await executorMod.executeLeadLifecycleTask(makeTask(T.MATCHING_PREPARE), deps);
  assert(calls.published[0].payload.recommended_vendor_ids.length === 3, "recommendation cap not applied");
});

for (const [number, ids] of [[18, []], [19, ["v1"]], [20, ["v1", "v2", "v3"]]]) {
  check(`${number}. matching count ${ids.length} event is valid`, async () => {
    const { deps, calls } = makeDeps({ recommendations: ids });
    await executorMod.executeLeadLifecycleTask(makeTask(T.MATCHING_PREPARE), deps);
    assert(calls.published[0].eventType === E.MATCHING_COMPLETED, "wrong event type");
    assert(calls.published[0].payload.recommended_vendor_count === ids.length, "wrong count");
  });
}

const phase2bSources = [
  "lib/aos/workflows/leadLifecycle/adapters/leadLifecycleServicePorts.ts",
  "lib/aos/workflows/leadLifecycle/adapters/leadQualityServiceAdapter.ts",
  "lib/aos/workflows/leadLifecycle/adapters/leadClarificationServiceAdapter.ts",
  "lib/aos/workflows/leadLifecycle/adapters/leadMatchingRecommendationAdapter.ts",
  "lib/aos/workflows/leadLifecycle/adapters/leadLifecycleAdapterFactory.ts",
  "lib/aos/workflows/leadLifecycle/events/leadLifecycleResultMapper.ts",
  "lib/aos/workflows/leadLifecycle/events/leadClarificationCompletedBridge.ts",
  "lib/aos/workflows/leadLifecycle/events/leadLifecycleEventPublisher.ts",
  "lib/aos/workflows/leadLifecycle/execution/leadLifecycleTaskExecutionTypes.ts",
  "lib/aos/workflows/leadLifecycle/execution/leadLifecycleTaskExecutor.ts",
  "lib/aos/workflows/leadLifecycle/execution/leadLifecycleTaskCoordinator.ts",
].map((path) => ({ path, source: readFileSync(path, "utf8") }));
const phase2bCombined = phase2bSources.map((item) => item.source).join("\n");

check("21. matching adapter never calls runAutoLeadMatchingForLead", () => {
  assert(!/\brunAutoLeadMatchingForLead\s*\(/.test(phase2bCombined), "runAutoLeadMatchingForLead call found");
});
check("22. matching adapter never calls assignment functions", () => {
  assert(!/\b(assignLeadToMatchedVendors|assignLeadToVendors)\s*\(/.test(phase2bCombined), "assignment call found");
});
check("23. no delivery functions called", () => {
  assert(!/\b(deliverLeadToVendorDashboard|createVendorLeadWhatsappPreview|createClientAssignedVendorsPreview)\s*\(/.test(phase2bCombined), "delivery call found");
});
check("24. no credit mutation", () => {
  assert(!/assign_lead_to_paid_vendors|assign_lead_to_vendors|credit_deducted|remaining_credits\s*=/.test(phase2bCombined), "credit mutation found");
});

check("25. durable lifecycle event identity contract is correct", async () => {
  const repo = new InMemoryDomainEventRepository();
  const publisher = new publisherMod.DurableLeadLifecycleEventPublisher(repo);
  const event = await publisher.publish({ workflowTaskId: "task_1", leadId: LEAD_ID, eventType: E.MATCHING_COMPLETED, payload: { recommended_vendor_count: 0, recommended_vendor_ids: [] } });
  assert(event.entity_type === "lead" && event.entity_id === LEAD_ID, "entity identity wrong");
  assert(event.payload_json.lead_id === LEAD_ID, "payload lead identity wrong");
});

check("26. payload.workflow_type is qf_lead_lifecycle", async () => {
  const repo = new InMemoryDomainEventRepository();
  const publisher = new publisherMod.DurableLeadLifecycleEventPublisher(repo);
  const event = await publisher.publish({ workflowTaskId: "task_2", leadId: LEAD_ID, eventType: E.MATCHING_COMPLETED, payload: { recommended_vendor_count: 0 } });
  assert(event.payload_json.workflow_type === states.LEAD_LIFECYCLE_WORKFLOW_TYPE, "workflow type missing");
});

check("27. task-only deterministic result event idempotency key", () => {
  const key1 = publisherMod.buildLeadLifecycleResultEventIdempotencyKey(" task_x ");
  const key2 = publisherMod.buildLeadLifecycleResultEventIdempotencyKey("task_x");
  assert(key1 === key2, "key not deterministic");
  assert(key1 === "qf_lead_lifecycle:task_result:task_x", `unexpected key ${key1}`);
  assert(!key1.includes(E.QUALITY_RESULTED), "key must not include event type");
  assert(!/\d{13}|random|uuid/i.test(key1), "key includes random/timestamp marker");
});

check("28. same task same event same payload reuses existing event safely", async () => {
  const repo = new InMemoryDomainEventRepository();
  const publisher = new publisherMod.DurableLeadLifecycleEventPublisher(repo);
  const first = await publisher.publish({ workflowTaskId: "task_dup", leadId: LEAD_ID, eventType: E.MATCHING_COMPLETED, payload: { recommended_vendor_count: 0 } });
  const second = await publisher.publish({ workflowTaskId: "task_dup", leadId: LEAD_ID, eventType: E.MATCHING_COMPLETED, payload: { recommended_vendor_count: 0 } });
  assert(first.id === second.id, "duplicate should reuse existing event");
  assert(repo.byKey.size === 1, "duplicate replay must leave one durable event");
});

check("29. same task same event different payload conflicts", async () => {
  const repo = new InMemoryDomainEventRepository();
  const publisher = new publisherMod.DurableLeadLifecycleEventPublisher(repo);
  await publisher.publish({ workflowTaskId: "task_conflict", leadId: LEAD_ID, eventType: E.MATCHING_COMPLETED, payload: { recommended_vendor_count: 0 } });
  await expectRejects(
    () => publisher.publish({ workflowTaskId: "task_conflict", leadId: LEAD_ID, eventType: E.MATCHING_COMPLETED, payload: { recommended_vendor_count: 1 } }),
    /DOMAIN_EVENT_IDEMPOTENCY_CONFLICT/,
  );
  assert(repo.byKey.size === 1, "payload conflict must not insert a second event");
});

check("30. same task different event type conflicts", async () => {
  const repo = new InMemoryDomainEventRepository();
  const publisher = new publisherMod.DurableLeadLifecycleEventPublisher(repo);
  await publisher.publish({ workflowTaskId: "task_event_conflict", leadId: LEAD_ID, eventType: E.QUALITY_RESULTED, payload: { quality: { tier: "A+" } } });
  await expectRejects(
    () => publisher.publish({ workflowTaskId: "task_event_conflict", leadId: LEAD_ID, eventType: E.MANUAL_REVIEW_REQUIRED, payload: { manual_review: { reason: "changed_on_retry" } } }),
    /DOMAIN_EVENT_IDEMPOTENCY_CONFLICT/,
  );
  assert(repo.byKey.size === 1, "event-type conflict must not insert a second event");
});

check("31. same task different lead identity conflicts", async () => {
  const repo = new InMemoryDomainEventRepository();
  const publisher = new publisherMod.DurableLeadLifecycleEventPublisher(repo);
  await publisher.publish({ workflowTaskId: "task_lead_conflict", leadId: LEAD_ID, eventType: E.MATCHING_COMPLETED, payload: { recommended_vendor_count: 0 } });
  await expectRejects(
    () => publisher.publish({ workflowTaskId: "task_lead_conflict", leadId: "lead_456", eventType: E.MATCHING_COMPLETED, payload: { recommended_vendor_count: 0 } }),
    /DOMAIN_EVENT_IDEMPOTENCY_CONFLICT/,
  );
  assert(repo.byKey.size === 1, "lead conflict must not insert a second event");
});

check("32. different task IDs produce independent events", async () => {
  const repo = new InMemoryDomainEventRepository();
  const publisher = new publisherMod.DurableLeadLifecycleEventPublisher(repo);
  const first = await publisher.publish({ workflowTaskId: "task_independent_1", leadId: LEAD_ID, eventType: E.MATCHING_COMPLETED, payload: { recommended_vendor_count: 0 } });
  const second = await publisher.publish({ workflowTaskId: "task_independent_2", leadId: LEAD_ID, eventType: E.MATCHING_COMPLETED, payload: { recommended_vendor_count: 0 } });
  assert(first.id !== second.id, "different tasks should create independent events");
  assert(repo.byKey.size === 2, "different tasks should leave two durable events");
});

check("33. cross-event retry conflict leaves exactly one durable event", async () => {
  const repo = new InMemoryDomainEventRepository();
  const publisher = new publisherMod.DurableLeadLifecycleEventPublisher(repo);
  await publisher.publish({
    workflowTaskId: "task_quality_1",
    leadId: LEAD_ID,
    eventType: E.QUALITY_RESULTED,
    payload: { quality: { tier: "A+", source: "first_attempt" } },
  });
  await expectRejects(
    () => publisher.publish({
      workflowTaskId: "task_quality_1",
      leadId: LEAD_ID,
      eventType: E.MANUAL_REVIEW_REQUIRED,
      payload: { manual_review: { reason: "retry_changed_mapping" } },
    }),
    /DOMAIN_EVENT_IDEMPOTENCY_CONFLICT/,
  );
  assert(repo.byKey.size === 1, "cross-event retry must leave exactly one durable event");
});

check("34. unrelated persistence errors are not swallowed", async () => {
  const repo = new InMemoryDomainEventRepository();
  repo.failUnrelated = true;
  const publisher = new publisherMod.DurableLeadLifecycleEventPublisher(repo);
  await expectRejects(
    () => publisher.publish({ workflowTaskId: "task_error", leadId: LEAD_ID, eventType: E.MATCHING_COMPLETED, payload: { recommended_vendor_count: 0 } }),
    /POSTGREST_UNRELATED_FAILURE/,
  );
});

check("35. executor never generates lead.manual_review.resolved", async () => {
  const { deps, calls } = makeDeps({ qualityResult: quality({ recommended_action: "manual_review_suspicious_name", hard_block_reason: "fake_or_test_name" }) });
  await executorMod.executeLeadLifecycleTask(makeTask(T.QUALITY_SCORE), deps);
  assert(calls.published[0].eventType !== E.MANUAL_REVIEW_RESOLVED, "manual review resolved generated");
});

check("36. distribution prepare performs no assignment without explicit assignment ports", async () => {
  // Phase 3B enabled lead.distribution.prepare, but it must never assign without
  // an explicitly injected assignment execution port — it fails loudly instead.
  const { deps } = makeDeps();
  await expectRejects(() => executorMod.executeLeadLifecycleTask(makeTask(T.DISTRIBUTION_PREPARE), deps), /DISTRIBUTION_ASSIGNMENT_PORTS_REQUIRED/);
});

check("37. deferred nurture task performs no provider send", async () => {
  const { deps } = makeDeps();
  const result = await executorMod.executeLeadLifecycleTask(makeTask(T.NURTURE_PREPARE), deps);
  assert(result.result.whatsapp_sent === false && result.result.n8n_called === false, "provider send enabled");
});

check("38. deferred manual review task fabricates no human decision", async () => {
  const { deps } = makeDeps();
  const result = await executorMod.executeLeadLifecycleTask(makeTask(T.MANUAL_REVIEW_PREPARE), deps);
  assert(result.result.manual_review_decision_fabricated === false, "manual review decision fabricated");
});

check("39. no WhatsApp", () => {
  assert(!/\bwhatsappTool|whatsapp-dispatch|sendWhatsApp|\.send\s*\(/i.test(phase2bCombined), "WhatsApp send primitive found");
});
check("40. no n8n", () => {
  assert(!/\bn8nTool|n8nSync|webhook|fetch\s*\(/i.test(phase2bCombined), "n8n/webhook primitive found");
});
check("41. no outbox provider command", () => {
  assert(!/outboxCommands|outbox_events|command_type/i.test(phase2bCombined), "outbox provider command found");
});
check("42. no production worker loop", () => {
  assert(!/setInterval|while\s*\(\s*true\s*\)|claimOneDueWorkflowTask\s*\(/.test(phase2bCombined), "worker loop or claim startup found");
});
check("43. no PM2 change", () => {
  const changed = gitDiffNames();
  assert(!changed.some((file) => /pm2|ecosystem/i.test(file)), "PM2 file changed");
});
check("44. no live leadService modification", () => {
  const changed = gitDiffNames(["--", "services/leadService.ts"]);
  assert(changed.length === 0, "leadService.ts modified");
});
check("45. Phase 2A lifecycle test script remains available", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert(Boolean(packageJson.scripts["test:phase2a"]), "test:phase2a missing");
});
check("46. qf_kernel_test remains isolated", () => {
  assert(!/qf_kernel_test/.test(phase2bCombined), "Phase 2B source references qf_kernel_test");
});

check("47. clarification completion bridge builds only completion event", () => {
  const draft = bridge.buildClarificationCompletedEvent({ leadId: LEAD_ID, requestId: "clar_1" });
  assert(draft.eventType === E.CLARIFICATION_COMPLETED, "wrong event");
  assert(draft.payload.workflow_type === states.LEAD_LIFECYCLE_WORKFLOW_TYPE, "workflow type missing");
  assert(!("reviewed_by" in draft.payload), "reviewer fabricated");
});

check("48. invalid task status is rejected", async () => {
  const { deps } = makeDeps();
  const task = makeTask(T.QUALITY_SCORE);
  task.status = "pending";
  await expectRejects(() => executorMod.executeLeadLifecycleTask(task, deps), /WORKFLOW_TASK_STATUS_INVALID/);
});

check("49. workflow payload identity mismatch is rejected", async () => {
  const { deps } = makeDeps();
  const task = makeTask(T.QUALITY_SCORE, { workflow_instance_id: "wrong_wf" });
  await expectRejects(() => executorMod.executeLeadLifecycleTask(task, deps), /WORKFLOW_TASK_WORKFLOW_INSTANCE_ID_MISMATCH/);
});

check("50. protected business services remain unmodified", () => {
  const changed = gitDiffNames(["--",
    "services/leadService.ts",
    "services/leadQualityService.ts",
    "services/leadClarificationService.ts",
    "services/leadMatchingEngine.ts",
    "services/leadDeliveryService.ts",
  ]);
  assert(changed.length === 0, `protected services modified: ${changed.join(", ")}`);
});

check("51. no database migration created", () => {
  const changed = gitDiffNames(["--", "supabase/migrations"]);
  assert(changed.length === 0, `migration changed: ${changed.join(", ")}`);
});

check("52. no UI files modified", () => {
  const changed = gitDiffNames(["--", "app", "components", "public"]);
  assert(changed.length === 0, `UI files changed: ${changed.join(", ")}`);
});

check("53. docs file exists", () => {
  assert(existsSync("docs/aos/QF-Lead-Orchestration-Adapter-Phase-2B.md"), "Phase 2B doc missing");
});

check("54. package script test:phase2b exists", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert(packageJson.scripts["test:phase2b"] === "node scripts/phase2b-lead-orchestration-adapter-harness.mjs", "script missing");
});

function gitDiffNames(args = []) {
  const output = execFileSync("git", ["diff", "--name-only", ...args], { encoding: "utf8" });
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

const results = await Promise.all(checks);
for (const item of results) {
  console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
  if (!item.ok) console.error(item.error);
}

rmSync(outDir, { recursive: true, force: true });

const failures = results.filter((item) => !item.ok);
if (failures.length > 0) {
  console.error(`\n${failures.length} Phase 2B harness check(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${results.length} Phase 2B lead orchestration adapter checks passed.`);
