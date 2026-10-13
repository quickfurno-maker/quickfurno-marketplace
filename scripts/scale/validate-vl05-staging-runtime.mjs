#!/usr/bin/env node
// VL-05: static staging identity/overlay contract. No network or database access.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { assertQfRuntimeIdentity } from "../../lib/runtime/deploymentConfig.ts";

const url = "https://uckafzuochmbvtiodmcl.supabase.co";
const serviceId = "quickfurno.automation-worker";
const base = {
  NODE_ENV: "production", QF_CONFIG_SCHEMA_VERSION: "1",
  QF_SERVICE_ID: serviceId
};
const identity = (env) => assertQfRuntimeIdentity(serviceId, { ...base, ...env });
const refuses = (env) => assert.throws(() => identity(env), /QF_RUNTIME_ENV_MISMATCH/);
const ok = identity({ QF_RUNTIME_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://example-production.supabase.co" });
assert.equal(ok.environment, "production");
console.log("PASS production default identity unchanged");
refuses({QF_RUNTIME_ENV:"staging", NEXT_PUBLIC_SUPABASE_URL:url});
console.log("PASS staging cannot start without explicit approval marker");
refuses({QF_RUNTIME_ENV:"staging", QF_ALLOW_STAGING_RUNTIME:"yes", NEXT_PUBLIC_SUPABASE_URL:url});
console.log("PASS staging rejects non-exact opt-in");
refuses({QF_RUNTIME_ENV:"staging", QF_ALLOW_STAGING_RUNTIME:"1", NEXT_PUBLIC_SUPABASE_URL:"https://example-production.supabase.co"});
console.log("PASS staging rejects another Supabase project URL");
assert.equal(identity({QF_RUNTIME_ENV:"staging", QF_ALLOW_STAGING_RUNTIME:"1", NEXT_PUBLIC_SUPABASE_URL:url}).environment, "staging");
console.log("PASS explicitly pinned staging worker passes runtime identity");
refuses({QF_RUNTIME_ENV:"production", NEXT_PUBLIC_SUPABASE_URL:url});
console.log("PASS production identity refuses Staging database endpoint");
assert.throws(() => identity({QF_RUNTIME_ENV:"staging",QF_SERVICE_ID:"quickfurno.web",QF_ALLOW_STAGING_RUNTIME:"1",NEXT_PUBLIC_SUPABASE_URL:url}),/QF_SERVICE_ID_INVALID/);
console.log("PASS worker cannot impersonate another service");

const entrypoint = readFileSync("ops/container/entrypoint.sh","utf8");
for(const str of ["QF_ALLOW_STAGING_RUNTIME","unsupported QF_RUNTIME_ENV","unpinned Staging runtime",url])
 assert.ok(entrypoint.includes(str),"missing entrypoint fence "+str);
console.log("PASS container entrypoint includes fail-closed staging fences");

const manifest=execFileSync("kubectl",["kustomize","ops/kubernetes/overlays/staging"],{encoding:"utf8"});
assert.equal((manifest.match(/name: QF_ALLOW_STAGING_RUNTIME/g)??[]).length,4);
assert.equal((manifest.match(/name: QF_RUNTIME_ENV\n\s+value: staging/g)??[]).length,4);
assert.equal((manifest.match(/value: https:\/\/uckafzuochmbvtiodmcl\.supabase\.co/g)??[]).length,4);
assert.equal((manifest.match(/name: QF_NATIVE_AUTOMATION_MODE\n\s+value: shadow/g)??[]).length,1);
console.log("PASS all four Staging deployments pinned and native worker SHADOW");
console.log("VL-05 Staging fail-closed runtime tests: 9/9 PASS");
