#!/usr/bin/env node
// Node 20+ CI contract: pure fs, no credentials, network, Kubernetes, or mutation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(p,"utf8");
const stageUrl = "https://uckafzuochmbvtiodmcl.supabase.co";
const dockerGuard=read("ops/container/entrypoint.sh");
const runtimeGuard=read("lib/runtime/deploymentConfig.ts");
assert.match(dockerGuard,/case "\$runtime_env" in/);
assert.match(dockerGuard,/production\)/);
assert.match(dockerGuard,/staging\)/);
assert.match(dockerGuard,/QF_ALLOW_STAGING_RUNTIME/);
assert.ok(dockerGuard.includes(stageUrl));
console.log("PASS container admits only gated Staging or existing Production identity");
assert.ok(runtimeGuard.includes('env.QF_ALLOW_STAGING_RUNTIME === "1"'));
assert.ok(runtimeGuard.includes('env.NEXT_PUBLIC_SUPABASE_URL?.trim() === stagingUrl'));
assert.ok(runtimeGuard.includes('environment === "production"'));
console.log("PASS application identity mirrors staging pin and rejects prod-to-stage mismatch");
const overlay=read("ops/kubernetes/overlays/staging/kustomization.yaml");
const targets=[
  ["quickfurno-web","staging-web.yaml","web"],
  ["quickfurno-automation-worker","staging-worker.yaml","worker"],
  ["quickfurno-conversation-transport","staging-transport.yaml","transport"],
  ["quickfurno-aarohi-acquisition","staging-aarohi.yaml","aarohi"],
];
for(const [deployment,file,container] of targets){
 const yaml=read("ops/kubernetes/overlays/staging/"+file);
 assert.ok(overlay.includes("path: "+file));
 assert.ok(yaml.includes("name: "+deployment));
 assert.ok(yaml.includes("name: "+container));
 assert.ok(yaml.includes("name: QF_RUNTIME_ENV\n              value: staging"));
 assert.ok(yaml.includes('name: QF_ALLOW_STAGING_RUNTIME\n              value: "1"'));
 assert.ok(yaml.includes(stageUrl));
}
console.log("PASS four Staging workloads carry explicit isolated identity and endpoint");
const worker=read("ops/kubernetes/overlays/staging/staging-worker.yaml");
assert.match(worker,/name: QF_NATIVE_AUTOMATION_MODE\n\s+value: shadow/);
assert.match(worker,/name: QF_NATIVE_AUTOMATION_WORKER_ID/);
assert.doesNotMatch(worker,/value: active/);
console.log("PASS Staging automation worker starts in non-delivering shadow mode");
assert.doesNotMatch(overlay,/quickfurno-production/);
console.log("PASS Staging overlay does not select the Production namespace");
console.log("VL-05 Staging static runtime contract: 5/5 PASS");
