#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}
const contract = JSON.parse(await text("../../contracts/qfj-phase20-launch-cert-v1.json"));
const advisor = JSON.parse(await text("../../docs/scale/phase20-supabase-advisor-disposition.json"));
const phase20 = await text("../../docs/scale/phase-20-final-launch-certification.md");
const exitInventory = await text("../../docs/scale/phase21-supabase-exit-inventory.md");
const identityAdr = await text("../../docs/decisions/ADR-0200-identity-auth-provider-portability.md");
const transport = await text("../../worker/conversationTransportWorker.ts");
const automationRuntime = await text("../../services/nativeAutomationRuntimeService.ts");
const compose = await text("../../ops/container/compose.production.yml");
const dockerfile = await text("../../Dockerfile");
const pkg = JSON.parse(await text("../../package.json"));

const checks = [];
function check(name, fn) {
  try { fn(); checks.push([name, true]); }
  catch (error) { checks.push([name, false, error instanceof Error ? error.message : String(error)]); }
}

check("canonical contract identity", () => {
  assert.equal(contract.contract, "qfj.phase20.launch-cert.v1");
  assert.equal(contract.schemaVersion, 1);
});
check("authority boundaries preserved", () => {
  assert.equal(contract.authority.businessTruth, "QuickFurno Core + PostgreSQL");
  assert.match(contract.authority.jarvis, /no_business_authority/);
  assert.match(contract.authority.agni, /READ_ONLY_RECOMMEND/);
});
check("no AWS or Kubernetes launch dependency", () => {
  assert.equal(contract.launchTopology.awsRequired, false);
  assert.equal(contract.launchTopology.kubernetesRequired, false);
  assert.equal(contract.launchTopology.productionKubernetesPresent, false);
});
check("polling reduction gate", () => {
  assert.ok(contract.pollingGate.liveMeasuredQps <= contract.pollingGate.phase20MaxLowTrafficTrackedQps);
  assert.ok(contract.pollingGate.measuredReductionPercentApprox >= contract.pollingGate.minimumReductionPercent);
  assert.equal(contract.pollingGate.liveTrackedQueries, 266);
});
check("Redis wakeup + 1s jittered DB fallback", () => {
  assert.match(transport, /waitForDurableWorkWakeup/);
  assert.match(transport, /QF_CONVERSATION_TRANSPORT_IDLE_POLL_MS[\s\S]*?1000,[\s\S]*?250,[\s\S]*?5000/);
  assert.match(transport, /jitter\(idlePollMs\)/);
});
check("native automation idle poll is 5s by default", () => {
  assert.match(automationRuntime, /QF_NATIVE_AUTOMATION_IDLE_POLL_MS, 5000, 500, 60000/);
});
check("container hardening baseline", () => {
  assert.match(dockerfile, /USER 10001:10001/);
  assert.ok((compose.match(/read_only: true/g) ?? []).length >= 4);
  assert.ok((compose.match(/cap_drop:/g) ?? []).length >= 4);
  assert.ok((compose.match(/no-new-privileges:true/g) ?? []).length >= 4);
  assert.match(compose, /pids_limit:/);
  assert.match(compose, /mem_limit:/);
  assert.match(compose, /cpus:/);
});
check("all live security advisor warnings/errors have dispositions", () => {
  const important = advisor.security.filter((x) => x.level === "ERROR" || x.level === "WARN");
  assert.equal(important.length, 2);
  assert.deepEqual(important.map((x) => x.lint).sort(), [
    "authenticated_security_definer_function_executable",
    "security_definer_view",
  ]);
  for (const item of important) {
    assert.ok(item.disposition && item.rationale);
    assert.equal(item.launchBlocking, false);
  }
});
check("Phase 21 exit inventory exists", () => {
  for (const marker of ["139", "postgis", "supabase_vault", "vendor-media", "communication_inbound_messages", "Auth"]) {
    assert.ok(exitInventory.includes(marker), "missing exit inventory marker: " + marker);
  }
});
check("identity provider portability decision locked", () => {
  assert.match(identityAdr, /stable internal \*\*principal identity\*\*/);
  assert.match(identityAdr, /Do not mass-rewrite existing business IDs/);
  assert.match(identityAdr, /Authorization remains Core-owned/);
});
check("expand-contract drill wired", () => {
  assert.equal(pkg.scripts["test:scale:phase20:expand-contract"], "node scripts/scale/certify-phase20-expand-contract-postgres.mjs");
});
check("final launch document is explicit about no production mutation", () => {
  assert.match(phase20, /no production schema migration/i);
  assert.match(phase20, /No production table is touched/i);
});
check("prior scale contracts retained", async () => {});

const requiredPrior = [
  "../../contracts/qfj-scale-contract-v1.json",
  "../../contracts/qfj-observability-phase14-v1.json",
  "../../contracts/qfj-phase16-topology-v1.json",
  "../../contracts/qfj-phase17-dr-v1.json",
  "../../contracts/qfj-phase18-load-chaos-v1.json",
  "../../contracts/qfj-phase19-kubernetes-v1.json",
];
for (const p of requiredPrior) {
  await readFile(new URL(p, import.meta.url));
}

for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ": " + detail : ""}`);
}
const failed = checks.filter(([, ok]) => !ok);
if (failed.length) process.exit(1);
console.log(`QuickFurno Phase 20 final launch contract PASS (${checks.length}/${checks.length})`);
console.log(JSON.stringify({
  pollingQps: contract.pollingGate.liveMeasuredQps,
  pollingThresholdQps: contract.pollingGate.phase20MaxLowTrafficTrackedQps,
  securityImportantDispositions: advisor.security.filter((x) => x.level === "ERROR" || x.level === "WARN").length,
  productionMutation: false,
  nextPhase: contract.exit.nextPhase
}, null, 2));
