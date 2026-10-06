#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const read = async (p) => readFile(new URL(p, root), "utf8");
const contract = JSON.parse(await read("contracts/qfj-phase20-final-launch-v1.json"));
const finalDoc = await read("docs/scale/phase-20-final-launch-certification.md");
const exitDoc = await read("docs/scale/phase-21-supabase-exit-inventory-design.md");
const identityDoc = await read("docs/scale/phase-22-identity-provider-portability-decision.md");
const transport = await read("worker/conversationTransportWorker.ts");
const automationConfig = await read("services/nativeAutomationRuntimeService.ts");
const durable = await read("scripts/scale/certify-durable-jobs-postgres.mjs");
const security = await read("supabase/migrations/20260911000000_qf_launch_security_closeout.sql");
const phase19 = await read("scripts/scale/validate-phase19-kubernetes.mjs");
const workflow = await read(".github/workflows/phase20-final-launch.yml");
const lock = JSON.parse(await read("package-lock.json"));

const checks = [];
const check = (name, fn) => {
  try { assert.ok(fn()); checks.push([name, true]); }
  catch (error) { checks.push([name, false, error.message]); }
};

check("canonical Phase20 contract", () => contract.schema === "qfj.phase20.final-launch.v1" && contract.version === 1);
check("launch has no AWS/Kubernetes dependency", () => !contract.productionPolicy.awsRequiredAtLaunch && !contract.productionPolicy.kubernetesRequiredAtLaunch && !contract.productionPolicy.productionKubernetesAllowedByThisPhase);
check("production DB mutation is forbidden", () => contract.productionPolicy.productionDatabaseMutationAllowedByThisPhase === false);
check("AGNI authority cannot expand", () => contract.productionPolicy.agniAuthorityExpansionAllowedByThisPhase === false);
check("polling threshold is at least 50 percent lower", () => contract.pollingGate.phase00KnownCoordinationBaselineQps === 18 && contract.pollingGate.phase20MaximumKnownCoordinationQps <= 9 && contract.pollingGate.productionObservedQps <= contract.pollingGate.phase20MaximumKnownCoordinationQps && contract.pollingGate.observedReductionPercent >= 50);
check("conversation transport uses wakeup and 1s recovery poll", () => transport.includes("waitForDurableWorkWakeup") && /QF_CONVERSATION_TRANSPORT_IDLE_POLL_MS[\s\S]{0,80}\n\s*1000,/.test(transport));
check("native automation idle polling is bounded at 5s default", () => /QF_NATIVE_AUTOMATION_IDLE_POLL_MS, 5000, 500, 60000/.test(automationConfig));
check("distributed scheduler certificate races 20 replicas", () => /length: 20/.test(durable) && durable.includes("exactly one concurrent scheduler replica must acquire") && durable.includes("exactly one simulated business effect"));
check("migration rehearsal policy is expand/backfill/compatibility/contract", () => contract.migrationGate.pattern.join(",") === "expand,backfill,compatibility,contract" && !contract.migrationGate.productionMutation);
check("security advisor ERROR/WARN dispositions are explicit", () => contract.securityAdvisorGate.acceptedByDesign.length === 3 && contract.securityAdvisorGate.externalLaunchPrerequisites.includes("quickfurno.auth_leaked_password_protection"));
check("owner-rights public projection remains accepted and read-only", () => security.includes("EXPECTED AND ACCEPTED") && security.includes("revoke insert, update, delete, truncate, references, trigger") && security.includes("vendor_public_v"));
check("RLS helpers remain intentionally available only to signed-in/service roles", () => security.includes("DELIBERATELY NOT REVOKED") && security.includes("public.is_admin()") && security.includes("public.owns_vendor(uuid)"));
check("Phase21 exit inventory design exists", () => exitDoc.includes("Supabase Exit Inventory") && exitDoc.includes("vendor-media") && exitDoc.includes("supabase_vault") && exitDoc.includes("auth.users"));
check("identity provider decision uses stable internal principal", () => identityDoc.includes("principal_id") && identityDoc.includes("(provider, provider_subject) -> principal_id") && identityDoc.includes("expand/contract"));
check("final evidence records live production migration head", () => finalDoc.includes("20261003093648") && finalDoc.includes("Phase 20 performs no remote schema mutation"));
check("final evidence records infrastructure versions", () => finalDoc.includes("b1df3f6c19f45b761ce518f3c55f39849db7d216") && finalDoc.includes("9cd68f6cd0ce22c2f5f9d4a0dc0f7631fd8c748a"));
check("Supabase client remains Node20 compatible at pinned version", () => lock.packages?.["node_modules/@supabase/supabase-js"]?.version === "2.108.2" && lock.packages?.["node_modules/@supabase/supabase-js"]?.engines?.node === ">=20.0.0");
check("Phase19 Kubernetes evidence stays required", () => contract.finalEvidenceGate.phase19KubernetesEvidenceRequired && phase19.includes("no production Kubernetes operation"));
check("restore and load/chaos evidence stay required", () => contract.finalEvidenceGate.phase17RestoreEvidenceRequired && contract.finalEvidenceGate.phase18LoadSoakChaosEvidenceRequired);
check("focused CI reruns scheduler ownership and expand-contract rehearsal", () => workflow.includes("certify-durable-jobs-postgres.mjs") && workflow.includes("certify-phase20-expand-contract-postgres.mjs"));
check("post-merge signed evidence remains mandatory", () => contract.finalEvidenceGate.postMergeFullCiRequired && contract.finalEvidenceGate.postMergeSupplyChainRequired && contract.finalEvidenceGate.signedImmutableDigestsRequired);

for (const [name, ok, detail] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
const failed = checks.filter(([,ok]) => !ok);
if (failed.length) process.exit(1);
console.log(`QuickFurno Phase20 final launch contract PASS (${checks.length}/${checks.length})`);
