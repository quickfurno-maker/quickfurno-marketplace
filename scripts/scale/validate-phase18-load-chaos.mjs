#!/usr/bin/env node
import { readFile } from "node:fs/promises";
const root = new URL("../../", import.meta.url);
const read = (p) => readFile(new URL(p, root), "utf8");
const [contractText, docs, phase00, p8scale, p8conc, p11, p12, p16, soak, matchingSloMigration] = await Promise.all([
  read("contracts/qfj-phase18-load-chaos-v1.json"),
  read("docs/operations/phase18-load-soak-chaos.md"),
  read("docs/scale/phase-00-baseline-2026-10-04.md"),
  read("scripts/scale/certify-matching-scale-postgres.mjs"),
  read("scripts/scale/certify-matching-concurrency-postgres.mjs"),
  read("scripts/scale/certify-phase11-resilience.mjs"),
  read("scripts/scale/certify-phase12-horizontal-messages-postgres.mjs"),
  read("scripts/scale/certify-phase16-host-loss.mjs"),
  read("scripts/scale/certify-phase18-soak.mjs"),
  read("supabase/migrations/20261006113000_scale_phase18_matching_slo.sql")
]);
const c = JSON.parse(contractText);
const checks=[]; const add=(n,v)=>checks.push([n,Boolean(v)]);
add("canonical Phase18 contract", c.contract === "qfj.phase18.cert.v1");
add("production load mutation forbidden", c.safety.isolatedCertificationOnly && c.safety.productionLoadTestForbidden && !c.safety.productionDatabaseMutation && !c.safety.productionTrafficCutover);
add("Phase00 SLOs are preserved", c.slo.leadMatchP95Ms===750 && c.slo.webhookAckP95Ms===250 && c.resourceGates.dbConnectionsSteadyPercentMax===70);
add("D1/D2 retain 100k/1M vendors", c.datasetTiers.D1.vendors===100000 && c.datasetTiers.D2.vendors===1000000);
add("overload is controlled and correctness-first", c.overloadPolicy.rateLimitedStatus===429 && c.overloadPolicy.saturatedStatus===503 && c.overloadPolicy.correctnessViolationAllowed===false);
add("lead/credit invariants are locked", c.correctness.maxVendorsPerLead===3 && c.correctness.oneCreditPerDeliveredLead && c.correctness.duplicateBusinessEffectForbidden);
add("failure matrix is complete", Object.values(c.failureInjection).every(Boolean));
add("audit scenarios are complete", c.auditScenarios.idleWorkersAtLeast>=10 && Object.entries(c.auditScenarios).filter(([k])=>k!=="idleWorkersAtLeast").every(([,v])=>v===true));
add("soak minimum and memory bound are locked", c.soak.minimumAutomatedSeconds>=60 && c.soak.heapGrowthBytesMax<=67108864 && c.soak.queueMustDrain);
add("real 100k/1M PostGIS certifier retained", p8scale.includes("100_000") && p8scale.includes("1_000_000") && p8scale.toLowerCase().includes("postgis"));
add("Phase00 matching SLO is a hard D1/D2 gate", p8scale.includes("certify(100_001, 750)") && p8scale.includes("certify(1_000_001, 1_500)"));
add("Phase18 matching hot path optimization is applied", p8scale.includes("PHASE18_MIGRATION") && matchingSloMigration.includes("cross join lateral") && matchingSloMigration.includes("asin(") && !matchingSloMigration.includes("public.qf_match_haversine_km_v1("));
add("canonical concurrency certifier retained", p8conc.includes("sameLeadConcurrentOperations") && p8conc.includes("totalCreditDebits"));
add("Jarvis resilience certifier retained", p11.toLowerCase().includes("timeout") || p11.toLowerCase().includes("circuit"));
add("horizontal durable message certifier retained", p12.toLowerCase().includes("postgres"));
add("real host loss certifier retained", p16.includes("docker") && p16.includes("failures"));
add("soak exercises scheduler provider queue and pool", soak.includes("schedulerEffects") && soak.includes("providerTimeouts") && soak.includes("peakDb") && soak.includes("massDuplicateReorderModeled"));
add("runbook binds Phase00 overload policy", docs.includes("Phase 00") && phase00.includes("Overload behavior contract"));
for (const [n,ok] of checks) console.log((ok?"PASS":"FAIL")+" "+n);
const failed=checks.filter(([,ok])=>!ok);
if(failed.length){ console.error("QuickFurno Phase18 failed: "+failed.length); process.exit(1); }
console.log("QuickFurno Phase18 contract PASS ("+checks.length+"/"+checks.length+")");
