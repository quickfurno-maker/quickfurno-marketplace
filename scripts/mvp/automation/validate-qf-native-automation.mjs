import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const read = (rel) => fs.readFileSync(path.resolve(rel), "utf8");
const worker = read("worker/nativeAutomationWorker.ts");
const runtime = read("services/nativeAutomationRuntimeService.ts");
const engine = read("services/nativeAutomationEngineService.ts");
const delayedFill = read("services/delayedLeadFillService.ts");
const authority = read("services/nativeAutomationAuthorityService.ts");
const studio = read("components/admin/AutomationStudio.tsx");
const studioService = read("services/automationStudioService.ts");
const pm2 = read("ops/production/quickfurno-automation-worker.config.cjs");
const ci = read(".github/workflows/qf-mvp-50-quality-gate.yml");
const supabase = read("lib/supabase.ts");
const pkg = JSON.parse(read("package.json"));
test("native worker defaults fail closed", () => assert.match(runtime, /QF_NATIVE_AUTOMATION_MODE \?\? "off"/));
test("worker has shadow and active modes", () => {
  assert.match(worker, /cfg\.mode !== "active"/);
  assert.match(worker, /cfg\.mode === "shadow"/);
});
test("native worker has graceful shutdown", () => {
  assert.match(worker, /SIGTERM/);
  assert.match(worker, /SIGINT/);
});
test("family claims use Core/Postgres authority directly", () => assert.match(engine, /claimNativeAutomationJob/));
test("recovery uses native Core authority directly", () => assert.match(engine, /recoverNativeAutomationRetry/));
test("orphan and stale cleanup use native Core authority", () => {
  assert.match(engine, /cancelNativeOrphanAutomationJob/);
  assert.match(engine, /cancelNativeStaleAutomationJob/);
});
test("Core family claim RPC remains SKIP LOCKED authority", () => assert.match(authority, /qf_claim_automation_job_for_family_v1/));
test("Automation Studio reads native worker health", () => {
  assert.match(studioService, /readNativeAutomationRuntimeSnapshot/);
  assert.match(studio, /QuickFurno Native Engine/);
  assert.doesNotMatch(studio, /n8n/i);
});
test("dedicated PM2 worker is single-instance", () => {
  assert.match(pm2, /quickfurno-automation-worker/);
  assert.match(pm2, /instances:\s*1/);
});
test("native worker has independent production build", () => {
  assert.match(pkg.scripts["build:automation-worker"], /esbuild/);
  assert.match(pkg.scripts["build:automation-worker"], /--alias:server-only=\.\/worker\/serverOnlyShim\.ts/);
  assert.match(pkg.scripts["start:automation-worker"], /dist\/automation-worker\.mjs/);
  assert.equal(fs.existsSync(path.resolve("worker/serverOnlyShim.ts")), true);
  assert.match(studioService, /^import ["']server-only["'];/m);
});
test("native worker defers Next request headers outside worker startup", () => {
  assert.doesNotMatch(supabase, /^import\s+\{\s*cookies\s*\}\s+from\s+["']next\/headers["']/m);
  assert.match(supabase, /await import\(["']next\/headers["']\)/);
});
test("native worker supplies a Node 20 WebSocket transport before Supabase loads", () => {
  assert.match(worker, /import WebSocket from ["']ws["']/);
  const installAt = worker.indexOf('Object.defineProperty(globalThis, "WebSocket"');
  const runtimeLoadAt = worker.indexOf('await import("@/services/nativeAutomationRuntimeService")');
  assert.ok(installAt >= 0 && runtimeLoadAt > installAt);
  assert.equal(typeof pkg.dependencies?.ws, "string");
  assert.equal(typeof pkg.devDependencies?.["@types/ws"], "string");
});
test("CI executes the native worker import graph on production Node 20", () => {
  assert.match(ci, /QuickFurno native worker startup smoke on production Node 20/);
  assert.match(ci, /QF_NATIVE_AUTOMATION_WORKER_ID='!'/);
  assert.match(ci, /NATIVE_AUTOMATION_WORKER_ID_INVALID/);
});
test("retired n8n API boundary is absent", () => {
  assert.equal(fs.existsSync(path.resolve("app/api/internal/automation/n8n")), false);
});
test("retired n8n workflow definitions are absent", () => {
  assert.equal(fs.existsSync(path.resolve("automation/n8n")), false);
});
test("native runtime has no n8n environment dependency", () => {
  for (const source of [worker, runtime, engine, authority, studio, studioService, pm2]) {
    assert.doesNotMatch(source, /QF_N8N_|N8N_WEBHOOK_URL|CORE_TO_N8N|N8N_TO_CORE/i);
  }
});
test("native engine test is the active automation guard", () => {
  assert.equal(typeof pkg.scripts["test:automation-native"], "string");
  assert.equal(pkg.scripts["test:automation:canonical-six"], undefined);
});

test("shadow/off modes cannot reach any execution lane", () => {
  const modeGate = worker.indexOf('if (cfg.mode !== "active")');
  const firstExecution = Math.min(
    worker.indexOf("runNativeFamilyClaimCycle"),
    worker.indexOf("runNativeLeadAssignmentDispatchCycle"),
    worker.indexOf("runNativeConsentAckCycle"),
  );
  assert.ok(modeGate >= 0 && firstExecution > modeGate);
});
test("global Studio kill switch gates all active lanes", () => {
  const globalGate = worker.indexOf("isAutomationStudioGlobalEnabled");
  const firstClaim = worker.indexOf("runNativeFamilyClaimCycle");
  assert.ok(globalGate >= 0 && firstClaim > globalGate);
  assert.match(worker, /snapshot\.state = "paused"/);
});
test("native worker owns all cron-ready system lanes", () => {
  assert.match(worker, /runNativeLeadAssignmentDispatchCycle/);
  assert.match(worker, /runNativeConsentAckCycle/);
  assert.match(worker, /runNativeDelayedFillCycle/);
  assert.match(engine, /runLeadAssignmentDispatchBatch/);
  assert.match(engine, /processConsentAckIntents/);
  assert.match(engine, /processDueLeadAssignmentQueue/);
});
test("native system lane batches stay bounded", () => {
  assert.match(runtime, /QF_NATIVE_AUTOMATION_LEAD_DISPATCH_BATCH, 3, 1, 25/);
  assert.match(runtime, /QF_NATIVE_AUTOMATION_CONSENT_ACK_BATCH, 25, 1, 25/);
  assert.match(runtime, /QF_NATIVE_AUTOMATION_DELAYED_FILL_BATCH, 25, 1, 100/);
});
test("delayed-fill retries remain selectable after the processor rewrites the queue reason", () => {
  assert.match(delayedFill, /queue_reason\.like\.delayed_fill_%/);
  assert.match(delayedFill, /\.or\(PROCESSOR_QUEUE_REASON_FILTER\)/);
  assert.match(delayedFill, /delayed_fill_waiting_no_eligible_vendors/);
  assert.match(delayedFill, /delayed_fill_partial_waiting_more_vendors/);
});

test("external production cron scheduler is retired", () => {
  assert.equal(fs.existsSync(path.resolve("ops/production/qf-lead-assignment-dispatch.sh")), false);
  assert.equal(fs.existsSync(path.resolve("ops/production/quickfurno-lead-assignment-dispatch.cron")), false);
  assert.equal(pkg.scripts["test:mvp:80-14c"], undefined);
});
test("legacy direct AOS automation endpoints are retired", () => {
  for (const rel of ["app/api/aos/events/route.ts","app/api/aos/failure/route.ts","app/api/aos/process-lead/route.ts","app/api/aos/whatsapp-status/route.ts"]) {
    assert.equal(fs.existsSync(path.resolve(rel)), false);
  }
  assert.equal(fs.existsSync(path.resolve("lib/aos/workflows/processLeadWorkflow.ts")), false);
});

test("retired signed external transport module is absent", () => {
  assert.equal(fs.existsSync(path.resolve("lib/automation/transportAuth.ts")), false);
});
test("production worker has no external workflow URL or HMAC secret dependency", () => {
  for (const source of [worker, runtime, engine, authority, pm2]) {
    assert.doesNotMatch(source, /webhook_url|hmac|inboundSecret|responseSecret|n8n/i);
  }
});

console.log(`QF Native Automation Engine guard: ${passed}/${passed} PASS`);
