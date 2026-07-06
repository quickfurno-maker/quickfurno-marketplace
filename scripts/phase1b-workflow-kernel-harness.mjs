import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const outDir = resolve(".phase1b-test-build");
rmSync(outDir, { recursive: true, force: true });

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) {
  throw new Error("TypeScript compiler not found. Run npm install first.");
}

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
    "--outDir",
    outDir,
    "--rootDir",
    ".",
    "lib/aos/workflow/workflowState.ts",
    "lib/aos/workflow/retryPolicy.ts",
    "lib/aos/workflow/workflowRegistry.ts",
    "lib/aos/workflow/workflowValidation.ts",
    "lib/aos/workflow/failureRedaction.ts",
    "lib/aos/workflow/qfKernelTestWorkflow.ts",
  ],
  { stdio: "pipe" },
);

const requireFromBuild = createRequire(`${outDir}/`);
const state = requireFromBuild("./lib/aos/workflow/workflowState.js");
const retry = requireFromBuild("./lib/aos/workflow/retryPolicy.js");
const registryMod = requireFromBuild("./lib/aos/workflow/workflowRegistry.js");
const validation = requireFromBuild("./lib/aos/workflow/workflowValidation.js");
const redaction = requireFromBuild("./lib/aos/workflow/failureRedaction.js");
const mock = requireFromBuild("./lib/aos/workflow/qfKernelTestWorkflow.js");

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

const testDefinition = mock.createQfKernelTestWorkflowDefinition();

check("transition map accepts valid transition", () => {
  const result = state.validateWorkflowTransition(testDefinition, "CREATED", "READY", "active");
  assert(result.ok === true, "CREATED -> READY should be valid");
});

check("invalid transition rejected", () => {
  const result = state.validateWorkflowTransition(testDefinition, "CREATED", "COMPLETED", "active");
  assert(result.ok === false && result.code === "INVALID_TRANSITION", "CREATED -> COMPLETED should fail");
});

check("retry policy first attempt schedules one minute", () => {
  const result = retry.calculateRetryDecision(0, true, new Date("2026-07-06T00:00:00.000Z"));
  assert(result.shouldRetry === true, "first attempt should retry");
  assert(result.nextRetryAt === "2026-07-06T00:01:00.000Z", `unexpected retry time ${result.nextRetryAt}`);
});

check("max attempts produce dead-letter decision", () => {
  const result = retry.calculateRetryDecision(4, true, new Date("2026-07-06T00:00:00.000Z"));
  assert(result.shouldDeadLetter === true, "fifth attempt should dead-letter");
});

check("sensitive error keys are redacted", () => {
  const sanitized = redaction.sanitizeWorkflowMetadata({
    authorization: "Bearer abc123",
    nested: { access_token: "token", safe: "ok" },
  });
  assert(sanitized.authorization === "[REDACTED]", "authorization should redact");
  assert(sanitized.nested.access_token === "[REDACTED]", "access_token should redact");
  assert(sanitized.nested.safe === "ok", "safe value should remain");
});

check("duplicate workflow registration rejected", () => {
  const registry = registryMod.createWorkflowRegistry();
  registry.register(testDefinition);
  let rejected = false;
  try {
    registry.register(testDefinition);
  } catch (error) {
    rejected = String(error.message).includes("WORKFLOW_DEFINITION_ALREADY_REGISTERED");
  }
  assert(rejected, "duplicate registration must throw");
});

check("unknown workflow type handled safely", () => {
  const registry = registryMod.createWorkflowRegistry();
  assert(registry.resolve("missing") === null, "unknown workflow should resolve null");
});

check("handler result validation rejects missing next state", () => {
  const result = validation.validateHandlerResult({ nextState: "" });
  assert(result.ok === false && result.message === "HANDLER_NEXT_STATE_REQUIRED", "blank next state should fail");
});

check("outbox test command remains persistence-only", () => {
  const handlerResult = testDefinition.handler({
    workflow: {
      id: "wf_test",
      workflow_type: mock.QF_KERNEL_TEST_WORKFLOW_TYPE,
      entity_type: "test",
      entity_id: "entity",
      current_state: "PROCESSING",
      status: "active",
      version: 1,
      context_json: {},
      started_at: "2026-07-06T00:00:00.000Z",
      updated_at: "2026-07-06T00:00:00.000Z",
      completed_at: null,
      last_error: null,
      created_at: "2026-07-06T00:00:00.000Z",
    },
    event: {
      id: "evt_test",
      event_type: mock.QF_KERNEL_TEST_WORKFLOW_TYPE,
      entity_type: "test",
      entity_id: "entity",
      payload_version: 1,
      payload_json: { path: "outbox" },
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
    },
    definition: testDefinition,
    now: "2026-07-06T00:00:00.000Z",
  });
  assert(handlerResult.outboxCommands?.[0]?.commandType === "test.noop", "expected test.noop command");
});

check("kernel test workflow does not reference real lead/vendor services", () => {
  const serialized = JSON.stringify(testDefinition);
  assert(!/leadService|leadMatching|vendor|credit|whatsapp|n8n/i.test(serialized), "mock workflow references real services");
});

for (const item of checks) {
  console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
  if (!item.ok) console.error(item.error);
}

rmSync(outDir, { recursive: true, force: true });

const failures = checks.filter((item) => !item.ok);
if (failures.length > 0) {
  console.error(`\n${failures.length} Phase 1B harness check(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} Phase 1B workflow kernel harness checks passed.`);

