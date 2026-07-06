import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
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
const migration148 = readFileSync("supabase/migrations/20260706000148_workflow_kernel_safety_hardening.sql", "utf8");
const kernelSource = readFileSync("lib/aos/workflow/workflowKernel.ts", "utf8");
const taskServiceSource = readFileSync("lib/aos/workflow/workflowTaskService.ts", "utf8");
const outboxServiceSource = readFileSync("lib/aos/workflow/outboxService.ts", "utf8");
const repositorySource = readFileSync("lib/aos/workflow/workflowRepository.ts", "utf8");

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

check("retry policy event scheduling is deterministic", () => {
  const result = retry.calculateRetryDecision(1, true, new Date("2026-07-06T00:00:00.000Z"));
  assert(result.nextRetryAt === "2026-07-06T00:05:00.000Z", `unexpected second retry time ${result.nextRetryAt}`);
});

check("event retry exhaustion dead-letters", () => {
  const result = retry.calculateRetryDecision(4, true, new Date("2026-07-06T00:00:00.000Z"));
  assert(result.reason === "max_attempts_exhausted", "expected max attempts exhaustion reason");
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

check("sensitive error strings are redacted", () => {
  const message = redaction.safeErrorMessage(
    "Authorization: Bearer abc.def.ghi password=swordfish api_key=key123 postgres://user:pass@localhost/db eyJhbGci.eyJzdWIi.signature",
  );
  assert(!message.includes("swordfish"), "password value should redact");
  assert(!message.includes("key123"), "api_key value should redact");
  assert(!message.includes("user:pass@"), "database URL password should redact");
  assert(message.includes("[REDACTED]") || message.includes("[REDACTED_JWT]"), "message should contain redaction markers");
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
      attempt_count: 0,
      max_attempts: 5,
      next_retry_at: null,
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

check("already-processing acquisition is non-mutating/skipped", () => {
  assert(migration148.includes("'already_processing'::text"), "migration must return already_processing");
  assert(kernelSource.includes('event.acquisition_status === "already_processing"'), "kernel must branch on already_processing");
  assert(!kernelSource.includes("DOMAIN_EVENT_ALREADY_PROCESSING"), "kernel must not rely on active-processing exceptions");
});

check("domain event retry lifecycle exists", () => {
  assert(migration148.includes("retry_scheduled"), "retry_scheduled status must exist");
  assert(migration148.includes("attempt_count"), "domain event attempt_count must exist");
  assert(migration148.includes("next_retry_at"), "domain event next_retry_at must exist");
  assert(kernelSource.includes("scheduleDomainEventRetry"), "kernel must schedule owned retryable failures");
});

check("worker ownership conflict handling is present", () => {
  assert(migration148.includes("DOMAIN_EVENT_OWNERSHIP_CONFLICT"), "event ownership conflict must exist");
  assert(taskServiceSource.includes("WORKFLOW_TASK_OWNERSHIP_CONFLICT"), "task ownership conflict must exist");
  assert(outboxServiceSource.includes("OUTBOX_OWNERSHIP_CONFLICT"), "outbox ownership conflict must exist");
});

check("workflow get-or-create race handles expected unique conflict", () => {
  assert(repositorySource.includes("isActiveWorkflowUniqueConflict"), "race helper must exist");
  assert(repositorySource.includes("uq_workflow_instances_active_entity"), "partial unique constraint must be targeted");
  assert(repositorySource.includes("findActiveWorkflowInstance(input.workflowType"), "loser must refetch active winner");
});

check("task idempotency scope includes execution definition", () => {
  assert(migration148.includes("v_existing_task.priority is distinct from v_task_priority"), "priority must be compared");
  assert(migration148.includes("v_existing_task.max_attempts is distinct from v_task_max_attempts"), "max attempts must be compared");
  assert(migration148.includes("v_existing_task.due_at is distinct from v_task_due_at"), "due_at must be compared when explicit");
});

check("successful step completes idempotency inside atomic RPC", () => {
  assert(migration148.includes("p_idempotency_key"), "RPC must accept idempotency key");
  assert(migration148.includes("update public.idempotency_records"), "RPC must update idempotency record");
  assert(!kernelSource.includes("completeIdempotentOperation"), "kernel should not complete idempotency after the atomic step");
});

check("runtime harness does not claim concurrency pass from smoke", () => {
  const runtimeHarness = readFileSync("scripts/phase1b-workflow-runtime-db-harness.mjs", "utf8");
  assert(runtimeHarness.includes("DB CONNECTION SMOKE: PASSED"), "smoke status should be explicit");
  assert(runtimeHarness.includes("RUNTIME DB CONCURRENCY TESTS: NOT RUN"), "smoke-only path must be not-run");
  assert(!runtimeHarness.includes("PASSED - safe database smoke"), "old misleading pass message must be gone");
});

check("no provider execution added", () => {
  const combined = `${kernelSource}\n${readFileSync("lib/aos/workflow/outboxService.ts", "utf8")}`;
  assert(!/fetch\(|axios|whatsapp\.send|n8n|meta\.|twilio|sendgrid/i.test(combined), "kernel/outbox service must not execute providers");
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
