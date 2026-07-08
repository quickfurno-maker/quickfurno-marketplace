import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

/**
 * Phase 4B-1 - QuickFurno durable policy inputs and authorization contracts.
 *
 * SOURCE/STATIC harness. Compiles the new runtime/config/distribution contract
 * modules to a throwaway CommonJS build and exercises durable config loading,
 * integrity failures, PII-free policy audit validation, strict future
 * auto-authorized payload validation, and the neutral authorization resolver.
 * No DB connection, no event publishing, no assignment, no credit mutation, no
 * matching rerun, no WhatsApp, no n8n, no outbox execution, no worker.
 */

const outDir = resolve(".phase4b1-test-build");
rmSync(outDir, { recursive: true, force: true });

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const files = [
  "lib/lead-quality/budgetFit.ts",
  "lib/supabase.ts",
  "services/leadQualityService.ts",
  "lib/aos/workflow/workflowPersistenceTypes.ts",
  "lib/aos/workflows/leadLifecycle/leadLifecycleStates.ts",
  "lib/aos/workflows/leadLifecycle/leadLifecycleEvents.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionTypes.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionValidation.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionPolicyAudit.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAutoAuthorizationValidation.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionApprovedSnapshotResolver.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAuthorizationSnapshotResolver.ts",
  "lib/aos/policy/policyTypes.ts",
  "lib/aos/policy/policyDecisionReasons.ts",
  "lib/aos/policy/policyConfig.ts",
  "lib/aos/policy/policyValidation.ts",
  "lib/aos/policy/policyFingerprint.ts",
  "lib/aos/policy/runtime/policyConfigStoreTypes.ts",
  "lib/aos/policy/runtime/policyConfigStoreValidation.ts",
  "lib/aos/policy/runtime/policyConfigStoreAdapter.ts",
];

const tsconfigPath = resolve(".phase4b1-tsconfig.json");
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
writeAliasProxy("lib/supabase", "../../../lib/supabase.js");

const requireFromBuild = createRequire(`${outDir}/`);
const policy = requireFromBuild("./lib/aos/policy/policyConfig.js");
const policyTypes = requireFromBuild("./lib/aos/policy/policyTypes.js");
const policyReasons = requireFromBuild("./lib/aos/policy/policyDecisionReasons.js");
const fpMod = requireFromBuild("./lib/aos/policy/policyFingerprint.js");
const storeTypes = requireFromBuild("./lib/aos/policy/runtime/policyConfigStoreTypes.js");
const storeValidation = requireFromBuild("./lib/aos/policy/runtime/policyConfigStoreValidation.js");
const storeAdapter = requireFromBuild("./lib/aos/policy/runtime/policyConfigStoreAdapter.js");
const states = requireFromBuild("./lib/aos/workflows/leadLifecycle/leadLifecycleStates.js");
const events = requireFromBuild("./lib/aos/workflows/leadLifecycle/leadLifecycleEvents.js");
const distTypes = requireFromBuild("./lib/aos/workflows/leadLifecycle/distribution/leadDistributionTypes.js");
const auditMod = requireFromBuild("./lib/aos/workflows/leadLifecycle/distribution/leadDistributionPolicyAudit.js");
const autoMod = requireFromBuild("./lib/aos/workflows/leadLifecycle/distribution/leadDistributionAutoAuthorizationValidation.js");
const authResolver = requireFromBuild("./lib/aos/workflows/leadLifecycle/distribution/leadDistributionAuthorizationSnapshotResolver.js");

const migrationPath = "supabase/migrations/20260706000150_automation_policy_config_foundation.sql";
const migration = readFileSync(migrationPath, "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const KEY = policyTypes.AutomationPolicyKey.LEAD_DISTRIBUTION_AUTHORIZATION;
const VERSION = policy.LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_VERSION;
const SAFE = policy.SAFE_DEFAULT_LEAD_DISTRIBUTION_AUTHORIZATION_POLICY_CONFIG;
const FINGERPRINT = fpMod.computePolicyConfigFingerprint(SAFE);
const SOURCE = storeTypes.AutomationPolicyConfigSource;
const DECISION = policyTypes.DistributionAuthorizationDecision;
const REASON = policyReasons.PolicyDecisionReason;
const AUTH_SOURCE = distTypes.LeadDistributionAuthorizationSource;
const E = events.LeadLifecycleEventType;
const WF_TYPE = states.LEAD_LIFECYCLE_WORKFLOW_TYPE;

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
async function expectRejects(fn, pattern) {
  try { await fn(); } catch (error) {
    const message = String(error?.message ?? error);
    if (!pattern || pattern.test(message)) return;
    throw new Error(`wrong rejection: ${message}`);
  }
  throw new Error("Expected rejection");
}

function config(overrides = {}) {
  return { ...SAFE, ...overrides };
}
function activeRow(overrides = {}) {
  const cfg = overrides.config_json ?? config();
  return {
    policy_key: overrides.activePolicyKey ?? KEY,
    config_id: overrides.configId ?? "cfg_active_1",
    config: overrides.config === null ? null : {
      id: overrides.rowId ?? (overrides.configId ?? "cfg_active_1"),
      policy_key: overrides.rowPolicyKey ?? KEY,
      policy_version: overrides.policyVersion ?? VERSION,
      config_json: cfg,
      config_fingerprint: overrides.fingerprint ?? fpMod.computePolicyConfigFingerprint(cfg),
    },
  };
}
function makePort({ row = activeRow(), error = null } = {}) {
  return {
    calls: 0,
    async readActiveConfig() {
      this.calls += 1;
      if (error) throw error;
      return row;
    },
  };
}
function validFactsSummary() {
  return {
    policyKey: KEY,
    workflowType: WF_TYPE,
    workflowInstanceId: "wf_std_1",
    leadId: "lead_std_1",
    currentLifecycleState: "MATCH_RECOMMENDATION_READY",
    routeClassification: "standard_route",
    scoreClass: "A+",
    totalScore: 95,
    hardBlockReasonPresent: false,
    recommendedAction: "auto_distribute",
    recommendationEventId: "evt_match_1",
    recommendedVendorCount: 2,
  };
}
function validAuditWithFacts(factsSummary) {
  return validAudit({ policy_facts_summary: factsSummary });
}
function validAudit(overrides = {}) {
  return {
    policy_key: KEY,
    policy_version: VERSION,
    policy_fingerprint: FINGERPRINT,
    policy_decision: DECISION.AUTO_AUTHORIZE,
    policy_reason_code: REASON.GUARDED_AUTO_AUTHORIZATION_ELIGIBLE,
    policy_config_id: "cfg_active_1",
    policy_config_source: SOURCE.ACTIVE_CONFIG,
    policy_facts_summary: validFactsSummary(),
    policy_passed_gates: ["facts_valid", "standard_route"],
    policy_failed_gates: [],
    ...overrides,
  };
}
function validAutoPayload(overrides = {}) {
  return {
    workflow_type: WF_TYPE,
    lead_id: "lead_std_1",
    recommendation_event_id: "evt_match_1",
    recommended_vendor_count: 2,
    recommended_vendor_ids: ["vA", "vB"],
    authorized_vendor_count: 2,
    authorized_vendor_ids: ["vA", "vB"],
    authorization_source: AUTH_SOURCE.POLICY_AUTO_AUTHORIZATION,
    ...validAudit(),
    ...overrides,
  };
}
function domainEvent(opts = {}) {
  return {
    id: opts.id ?? "evt_auth_1",
    event_type: opts.eventType ?? E.DISTRIBUTION_AUTO_AUTHORIZED,
    entity_type: opts.entityType ?? "lead",
    entity_id: opts.entityId ?? "lead_std_1",
    payload_version: 1,
    payload_json: opts.payload ?? validAutoPayload(),
    trace_id: null,
    correlation_id: opts.correlationId ?? "wf_std_1",
    causation_id: null,
    idempotency_key: null,
    processing_status: "processed",
    processed_at: null,
    created_at: "2026-07-08T00:00:00.000Z",
    updated_at: "2026-07-08T00:00:00.000Z",
    locked_at: null,
    locked_by: null,
    attempt_count: 0,
    max_attempts: 5,
    next_retry_at: null,
  };
}
function humanApprovedEvent(opts = {}) {
  return domainEvent({
    id: opts.id ?? "evt_human_1",
    eventType: E.DISTRIBUTION_APPROVED,
    payload: {
      workflow_type: WF_TYPE,
      lead_id: opts.leadId ?? "lead_std_1",
      recommendation_event_id: "evt_match_1",
      recommended_vendor_count: 3,
      recommended_vendor_ids: ["vA", "vB", "vC"],
      approved_vendor_count: 2,
      approved_vendor_ids: ["vA", "vC"],
      approved_by: "admin_1",
      ...(opts.payloadOverride ?? {}),
    },
    entityId: opts.entityId,
    correlationId: opts.correlationId,
  });
}
function resolverPort(event, calls = {}) {
  calls.eventLookups = [];
  calls.matching = 0;
  calls.assignment = 0;
  calls.credit = 0;
  return {
    async getDomainEventById(id) {
      calls.eventLookups.push(id);
      return event && event.id === id ? event : null;
    },
  };
}
function without(obj, key) {
  const clone = structuredClone(obj);
  delete clone[key];
  return clone;
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}
function activePointerSeedSql() {
  const match = migration.match(/insert into\s+public\.automation_policy_active_configs[\s\S]*?;/i);
  return match?.[0] ?? "";
}
function gitPorcelain(paths = []) {
  const output = execFileSync("git", ["status", "--porcelain", "--", ...paths], { encoding: "utf8" });
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

// CONFIG MIGRATION / STORAGE
check("1. migration creates automation_policy_configs", () => assert(/create table if not exists public\.automation_policy_configs/i.test(migration), "configs table missing"));
check("2. migration creates automation_policy_active_configs", () => assert(/create table if not exists public\.automation_policy_active_configs/i.test(migration), "active table missing"));
check("3. config rows are immutable", () => assert(/before update or delete on public\.automation_policy_configs/i.test(migration) && /AUTOMATION_POLICY_CONFIG_IMMUTABLE/.test(migration), "immutability trigger missing"));
check("4. active pointer is separate from config row", () => assert(/config_id uuid not null/.test(migration) && /automation_policy_active_configs/.test(migration), "active pointer missing"));
check("5. composite policy-key\/config-id integrity exists", () => assert(/foreign key \(policy_key, config_id\)[\s\S]*references public\.automation_policy_configs\(policy_key, id\)/i.test(migration), "composite fk missing"));
check("6. RLS enabled on both", () => assert(/alter table public\.automation_policy_configs enable row level security/i.test(migration) && /alter table public\.automation_policy_active_configs enable row level security/i.test(migration), "RLS missing"));
check("7. no anonymous write policy", () => {
  const sql = stripComments(migration);
  assert(!/grant\s+(insert|update|delete|all)[^;]*\s+to\s+(anon|authenticated)/i.test(sql), "anon/auth write grant found");
});
check("8. safe default config seeded", () => assert(/lead_distribution_authorization/.test(migration) && /lead_distribution_authorization_v1/.test(migration), "safe seed missing"));
check("9. safe default mode human_approval_only", () => assert(/"mode":\s*"human_approval_only"/.test(migration), "safe mode missing"));
check("10. safe default enabled=false", () => assert(/"enabled":\s*false/.test(migration), "safe enabled=false missing"));
check("11. safe default fingerprint equals Phase 4A computed fingerprint", () => assert(migration.includes(FINGERPRINT) && FINGERPRINT === "1ecca567b6564e9188d4aab7cb7557614c87f2131c947b42929475b4e592901c", `fingerprint mismatch ${FINGERPRINT}`));
check("11a. seed SQL does not update an existing active pointer", () => assert(!/set\s+config_id\s*=|activated_at\s*=\s*now\(\)|excluded\.config_id/i.test(activePointerSeedSql()), "active pointer seed contains update assignment"));
check("11b. active pointer conflict path is DO NOTHING", () => assert(/on conflict\s*\(\s*policy_key\s*\)\s*do nothing/i.test(activePointerSeedSql()), "active pointer conflict path is not DO NOTHING"));
check("11c. no DO UPDATE exists for the active-pointer seed", () => assert(!/on conflict\s*\(\s*policy_key\s*\)\s*do update/i.test(activePointerSeedSql()), "active pointer seed still uses DO UPDATE"));

// CONFIG ADAPTER
check("12. valid active config loads", async () => {
  const snap = await storeAdapter.loadAutomationPolicyConfigSnapshot(KEY, makePort());
  assert(snap.source === SOURCE.ACTIVE_CONFIG && snap.configId === "cfg_active_1", "active snapshot did not load");
});
check("13. exact policy key required", async () => {
  await expectRejects(() => storeAdapter.loadAutomationPolicyConfigSnapshot("unknown_policy", makePort()), /POLICY_CONFIG_KEY_UNSUPPORTED/);
});
check("14. exact supported version required", async () => {
  await expectRejects(() => storeAdapter.loadAutomationPolicyConfigSnapshot(KEY, makePort({ row: activeRow({ policyVersion: "lead_distribution_authorization_v2" }) })), /POLICY_CONFIG_VERSION_UNSUPPORTED/);
});
check("15. config schema validated", async () => {
  await expectRejects(() => storeAdapter.loadAutomationPolicyConfigSnapshot(KEY, makePort({ row: activeRow({ config_json: { ...config(), enabled: "yes" } }) })), /POLICY_CONFIG_SCHEMA_INVALID/);
});
check("16. stored/computed fingerprint must match", async () => {
  await expectRejects(() => storeAdapter.loadAutomationPolicyConfigSnapshot(KEY, makePort({ row: activeRow({ fingerprint: "0".repeat(64) }) })), /POLICY_CONFIG_FINGERPRINT_MISMATCH/);
});
check("17. no active pointer -> safe default fallback", async () => {
  const snap = await storeAdapter.loadAutomationPolicyConfigSnapshot(KEY, makePort({ row: null }));
  assert(snap.source === SOURCE.SAFE_DEFAULT_NO_ACTIVE_CONFIG && snap.configId === null && snap.config.enabled === false, "safe fallback mismatch");
});
check("18. DB error throws, not fallback", async () => {
  await expectRejects(() => storeAdapter.loadAutomationPolicyConfigSnapshot(KEY, makePort({ error: new Error("POSTGREST_TEMPORARY_FAILURE") })), /POSTGREST_TEMPORARY_FAILURE/);
});
check("19. corrupted active config never auto-authorizes", async () => {
  await expectRejects(() => storeAdapter.loadAutomationPolicyConfigSnapshot(KEY, makePort({ row: activeRow({ rowPolicyKey: "wrong_policy" }) })), /POLICY_CONFIG_ROW_POLICY_KEY_MISMATCH/);
});
check("20. loaded snapshot frozen", async () => {
  const snap = await storeAdapter.loadAutomationPolicyConfigSnapshot(KEY, makePort());
  assert(Object.isFrozen(snap) && Object.isFrozen(snap.config) && Object.isFrozen(snap.config.allowedAutoAuthorizeScoreClasses), "snapshot not frozen");
});

// POLICY AUDIT CONTRACT
check("21. valid policy audit accepted", () => assert(auditMod.validatePolicyDecisionAuditContract(validAudit()).ok, "valid audit rejected"));
check("22. missing key rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(without(validAudit(), "policy_key")).ok, "missing key accepted"));
check("23. missing version rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(without(validAudit(), "policy_version")).ok, "missing version accepted"));
check("24. missing fingerprint rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(without(validAudit(), "policy_fingerprint")).ok, "missing fingerprint accepted"));
check("25. invalid fingerprint rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAudit({ policy_fingerprint: "abc" })).ok, "bad fingerprint accepted"));
check("26. unknown decision rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAudit({ policy_decision: "ship_it" })).ok, "unknown decision accepted"));
check("27. missing reason rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(without(validAudit(), "policy_reason_code")).ok, "missing reason accepted"));
check("28. config source validated", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAudit({ policy_config_source: "ambient_default" })).ok, "bad source accepted"));
check("29. facts summary required", () => assert(!auditMod.validatePolicyDecisionAuditContract(without(validAudit(), "policy_facts_summary")).ok, "missing facts accepted"));
check("30. passed gates array required", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAudit({ policy_passed_gates: "facts_valid" })).ok, "bad passed gates accepted"));
check("31. failed gates array required", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAudit({ policy_failed_gates: "none" })).ok, "bad failed gates accepted"));
check("32. PII-looking fields rejected by strict allowlist", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAudit({ policy_facts_summary: { ...validFactsSummary(), client_phone: "999" } })).ok, "PII field accepted"));
check("32a. empty facts summary rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({})).ok, "empty facts summary accepted"));
check("32b. missing required facts-summary field rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts(without(validFactsSummary(), "workflowType"))).ok, "missing required summary field accepted"));
check("32c. unknown facts-summary field rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({ ...validFactsSummary(), unexpectedField: "x" })).ok, "unknown summary field accepted"));
check("32d. wrong facts-summary policy key rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({ ...validFactsSummary(), policyKey: "wrong_policy" })).ok, "wrong summary policy key accepted"));
check("32e. blank workflowInstanceId rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({ ...validFactsSummary(), workflowInstanceId: "  " })).ok, "blank workflow id accepted"));
check("32f. blank leadId rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({ ...validFactsSummary(), leadId: "  " })).ok, "blank lead id accepted"));
check("32g. invalid lifecycle state rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({ ...validFactsSummary(), currentLifecycleState: "NOT_A_STATE" })).ok, "invalid lifecycle state accepted"));
check("32h. invalid route classification rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({ ...validFactsSummary(), routeClassification: "mystery_route" })).ok, "invalid route accepted"));
check("32i. invalid score class rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({ ...validFactsSummary(), scoreClass: "Z" })).ok, "invalid score class accepted"));
check("32j. totalScore string rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({ ...validFactsSummary(), totalScore: "95" })).ok, "string score accepted"));
check("32k. totalScore below 0 rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({ ...validFactsSummary(), totalScore: -1 })).ok, "negative score accepted"));
check("32l. totalScore above 100 rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({ ...validFactsSummary(), totalScore: 101 })).ok, "score >100 accepted"));
check("32m. non-integer totalScore rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({ ...validFactsSummary(), totalScore: 95.5 })).ok, "fractional score accepted"));
check("32n. non-boolean hardBlockReasonPresent rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({ ...validFactsSummary(), hardBlockReasonPresent: "false" })).ok, "non-boolean hard-block flag accepted"));
check("32o. unknown recommendedAction rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({ ...validFactsSummary(), recommendedAction: "ship_now" })).ok, "unknown action accepted"));
check("32p. blank recommendationEventId rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({ ...validFactsSummary(), recommendationEventId: " " })).ok, "blank recommendation event accepted"));
check("32q. recommendation count below 0 rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({ ...validFactsSummary(), recommendedVendorCount: -1 })).ok, "negative recommendation count accepted"));
check("32r. recommendation count above 3 rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({ ...validFactsSummary(), recommendedVendorCount: 4 })).ok, "recommendation count >3 accepted"));
check("32s. non-integer recommendation count rejected", () => assert(!auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts({ ...validFactsSummary(), recommendedVendorCount: 1.5 })).ok, "fractional recommendation count accepted"));
check("32t. valid complete facts summary passes and is frozen", () => {
  const result = auditMod.validatePolicyDecisionAuditContract(validAuditWithFacts(validFactsSummary()));
  assert(result.ok && Object.isFrozen(result.value.policy_facts_summary), "valid normalized facts summary rejected or not frozen");
});

// AUTO AUTHORIZED CONTRACT
check("33. valid auto-authorized payload accepted", () => assert(autoMod.validateDistributionAutoAuthorized(validAutoPayload()).ok, "valid auto payload rejected"));
check("34. zero recommendation rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ recommended_vendor_count: 0, recommended_vendor_ids: [] })).ok, "zero rec accepted"));
check("35. count >3 rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ recommended_vendor_count: 4, recommended_vendor_ids: ["vA", "vB", "vC", "vD"], authorized_vendor_count: 4, authorized_vendor_ids: ["vA", "vB", "vC", "vD"] })).ok, "rec >3 accepted"));
check("36. duplicate recommendation IDs rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ recommended_vendor_ids: ["vA", "vA"], authorized_vendor_ids: ["vA", "vA"] })).ok, "duplicate rec accepted"));
check("37. count/list mismatch rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ recommended_vendor_count: 2, recommended_vendor_ids: ["vA"] })).ok, "rec mismatch accepted"));
check("38. zero authorized rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ authorized_vendor_count: 0, authorized_vendor_ids: [] })).ok, "zero auth accepted"));
check("39. authorized count >3 rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ authorized_vendor_count: 4, authorized_vendor_ids: ["vA", "vB", "vC", "vD"] })).ok, "auth >3 accepted"));
check("40. duplicate authorized IDs rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ authorized_vendor_ids: ["vA", "vA"] })).ok, "duplicate auth accepted"));
check("41. authorized count/list mismatch rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ authorized_vendor_count: 2, authorized_vendor_ids: ["vA"] })).ok, "auth mismatch accepted"));
check("42. authorized subset smaller than recommendation rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ authorized_vendor_count: 1, authorized_vendor_ids: ["vA"] })).ok, "subset accepted"));
check("43. authorized reordered list rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ authorized_vendor_ids: ["vB", "vA"] })).ok, "reorder accepted"));
check("44. authorized replacement vendor rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ authorized_vendor_ids: ["vA", "vZ"] })).ok, "replacement accepted"));
check("45. exact authorized==recommended accepted", () => assert(autoMod.validateDistributionAutoAuthorized(validAutoPayload({ recommended_vendor_ids: ["vA", "vC"], authorized_vendor_ids: ["vA", "vC"] })).ok, "exact equality rejected"));
check("46. wrong authorization_source rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ authorization_source: "human_approval" })).ok, "wrong source accepted"));
check("47. policy_decision other than auto_authorize rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ policy_decision: DECISION.REQUIRE_HUMAN_APPROVAL })).ok, "wrong decision accepted"));
check("48. wrong policy reason rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ policy_reason_code: REASON.HUMAN_APPROVAL_MODE })).ok, "wrong reason accepted"));
check("49. unsupported policy version rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ policy_version: "lead_distribution_authorization_v2" })).ok, "v2 accepted"));
check("50. failed gates non-empty rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ policy_failed_gates: ["policy_enabled"] })).ok, "failed gate accepted"));
check("51. safe-default config source rejected for auto authorization", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ policy_config_source: SOURCE.SAFE_DEFAULT_NO_ACTIVE_CONFIG })).ok, "safe default source accepted"));
check("52. missing config id rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ policy_config_id: null })).ok, "null config id accepted"));
check("52a. auto-authorized payload with malformed facts summary rejected", () => assert(!autoMod.validateDistributionAutoAuthorized(validAutoPayload({ policy_facts_summary: {} })).ok, "auto payload malformed facts summary accepted"));

// UNIFIED AUTHORIZATION SNAPSHOT
check("53. human approved event maps to human authorization source", async () => {
  const event = humanApprovedEvent();
  const result = await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event));
  assert(result.ok && result.value.authorizationSource === AUTH_SOURCE.HUMAN_APPROVAL, "human source mismatch");
});
check("54. human approved subset maps exactly to authorized ids", async () => {
  const event = humanApprovedEvent();
  const result = await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event));
  assert(result.ok && result.value.authorizedVendorIds.join(",") === "vA,vC", "human subset mismatch");
});
check("55. human approved_by preserved", async () => {
  const event = humanApprovedEvent();
  const result = await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event));
  assert(result.ok && result.value.humanApprovedBy === "admin_1", "approved_by lost");
});
check("56. human policy audit null", async () => {
  const event = humanApprovedEvent();
  const result = await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event));
  assert(result.ok && result.value.policyAudit === null, "human policy audit must be null");
});
check("57. auto event maps to policy auto source", async () => {
  const event = domainEvent();
  const result = await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event));
  assert(result.ok && result.value.authorizationSource === AUTH_SOURCE.POLICY_AUTO_AUTHORIZATION, "auto source mismatch");
});
check("58. auto authorized ids preserved exactly", async () => {
  const event = domainEvent({ payload: validAutoPayload({ recommended_vendor_ids: ["vB", "vC"], authorized_vendor_ids: ["vB", "vC"] }) });
  const result = await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event));
  assert(result.ok && result.value.authorizedVendorIds.join(",") === "vB,vC", "auto ids mismatch");
});
check("59. auto humanApprovedBy null", async () => {
  const event = domainEvent();
  const result = await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event));
  assert(result.ok && result.value.humanApprovedBy === null, "auto humanApprovedBy must be null");
});
check("60. auto policy audit preserved", async () => {
  const event = domainEvent();
  const result = await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event));
  assert(result.ok && result.value.policyAudit.policy_decision === DECISION.AUTO_AUTHORIZE, "policy audit missing");
});
check("61. event id mismatch rejected", async () => {
  const event = domainEvent();
  const result = await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: "evt_other", expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event));
  assert(!result.ok && result.message === "AUTHORIZATION_EVENT_NOT_FOUND", `got ${result.message}`);
});
check("62. lead mismatch rejected", async () => {
  const event = domainEvent({ entityId: "lead_other", payload: validAutoPayload({ lead_id: "lead_other" }) });
  const result = await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event));
  assert(!result.ok && result.message === "AUTHORIZATION_EVENT_LEAD_MISMATCH", `got ${result.message}`);
});
check("63. workflow mismatch rejected", async () => {
  const event = domainEvent({ correlationId: "wf_other" });
  const result = await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event));
  assert(!result.ok && result.message === "AUTHORIZATION_EVENT_WORKFLOW_MISMATCH", `got ${result.message}`);
});
check("64. wrong entity type rejected", async () => {
  const event = domainEvent({ entityType: "vendor" });
  const result = await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event));
  assert(!result.ok && result.message === "AUTHORIZATION_EVENT_ENTITY_TYPE_INVALID", `got ${result.message}`);
});
check("65. unsupported event type rejected", async () => {
  const event = domainEvent({ eventType: E.MATCHING_COMPLETED });
  const result = await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event));
  assert(!result.ok && result.message === "AUTHORIZATION_EVENT_TYPE_INVALID", `got ${result.message}`);
});
check("66. malformed human approval rejected", async () => {
  const event = humanApprovedEvent({ payloadOverride: { approved_vendor_ids: ["vZ"] } });
  const result = await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event));
  assert(!result.ok, "malformed human accepted");
});
check("67. malformed auto authorization rejected", async () => {
  const event = domainEvent({ payload: validAutoPayload({ authorized_vendor_ids: ["vB", "vA"] }) });
  const result = await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event));
  assert(!result.ok, "malformed auto accepted");
});
check("67a. unified auto resolver rejects malformed policy facts summary", async () => {
  const event = domainEvent({ payload: validAutoPayload({ policy_facts_summary: {} }) });
  const result = await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event));
  assert(!result.ok, "malformed policy facts summary accepted by resolver");
});
check("68. no matching function called", async () => {
  const calls = {};
  const event = domainEvent();
  await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event, calls));
  assert(calls.matching === 0, "matching called");
});
check("69. no assignment function called", async () => {
  const calls = {};
  const event = domainEvent();
  await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event, calls));
  assert(calls.assignment === 0, "assignment called");
});
check("70. no credit code called", async () => {
  const calls = {};
  const event = domainEvent();
  await authResolver.resolveLeadDistributionAuthorizationSnapshot({ authorizationEventId: event.id, expectedWorkflowInstanceId: "wf_std_1", expectedLeadId: "lead_std_1" }, resolverPort(event, calls));
  assert(calls.credit === 0, "credit called");
});

// SECURITY / NON-GOALS
const newIntegrationFiles = [
  "lib/aos/policy/runtime/policyConfigStoreTypes.ts",
  "lib/aos/policy/runtime/policyConfigStoreValidation.ts",
  "lib/aos/policy/runtime/policyConfigStoreAdapter.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionPolicyAudit.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAutoAuthorizationValidation.ts",
  "lib/aos/workflows/leadLifecycle/distribution/leadDistributionAuthorizationSnapshotResolver.ts",
];
const newSource = newIntegrationFiles.map((file) => readFileSync(file, "utf8")).join("\n");
const executorSource = readFileSync("lib/aos/workflows/leadLifecycle/execution/leadLifecycleTaskExecutor.ts", "utf8");
const handlerSource = readFileSync("lib/aos/workflows/leadLifecycle/leadLifecycleHandler.ts", "utf8");

check("71. no live event publish", () => assert(!/LeadLifecycleEventPublisher\.publish|resultEventPublisher\.publish|approvalPublisher\.publish/.test(newSource), "publish call in new modules"));
check("72. no domain_events insert in new integration modules", () => assert(!/domain_events[\s\S]{0,120}\.insert|createDomainEvent\s*\(/i.test(newSource), "domain event insert found"));
check("73. no WhatsApp", () => assert(!/whatsappTool|createVendorLeadWhatsappPreview|sendWhatsApp|whatsapp-dispatch|whatsapp_status/i.test(newSource), "WhatsApp integration reference found"));
check("74. no n8n", () => assert(!/n8n/i.test(newSource), "n8n reference found"));
check("75. no provider outbox execution", () => assert(!/outbox_events|outboxCommands|command_type|qf_claim_due_outbox_event/i.test(newSource), "outbox execution found"));
check("76. no worker", () => assert(!/setInterval|while\s*\(\s*true\s*\)|claimOneDueWorkflowTask|qf_claim_due_workflow_task/i.test(newSource), "worker found"));
check("77. PM2 unchanged", () => assert(!gitPorcelain().some((line) => /pm2|ecosystem/i.test(line)), "PM2 changed"));
check("78. UI unchanged", () => assert(gitPorcelain(["app", "components", "public"]).length === 0, "UI changed"));
check("79. protected services unchanged", () => {
  const protectedPaths = [
    "services/leadService.ts",
    "services/leadQualityService.ts",
    "services/leadClarificationService.ts",
    "services/leadMatchingEngine.ts",
    "services/leadDeliveryService.ts",
    "services/preferredVendorLeadService.ts",
    "services/delayedLeadFillService.ts",
    "services/clientRequirementGroupService.ts",
    "services/vendorService.ts",
    "services/aosService.ts",
    "lib/lead-assignment/runtimeSettings.ts",
  ];
  assert(gitPorcelain(protectedPaths).length === 0, "protected service changed");
});
check("80. lifecycle task mapping updated to policy evaluation (Phase 4B-2)", () => assert(/\[LeadLifecycleState\.MATCH_RECOMMENDATION_READY\]: LeadLifecycleTaskIntent\.DISTRIBUTION_POLICY_EVALUATE/.test(handlerSource), "MATCH_RECOMMENDATION_READY must map to DISTRIBUTION_POLICY_EVALUATE"));
check("81. Phase 4B-2 neutral authorization resolver wired in executor", () => assert(/resolveLeadDistributionAuthorizationSnapshot/.test(executorSource) && /DISTRIBUTION_POLICY_EVALUATE/.test(executorSource), "executor must wire the neutral authorization resolver and the policy evaluate task"));
check("82. no production migration applied", () => assert(!/supabase\s+(db\s+push|migration\s+up|link)|--linked|--project-ref/i.test(newSource + migration) && pkg.scripts["test:phase4b1"] === "node scripts/phase4b1-policy-inputs-contract-harness.mjs", "production apply command or package wiring missing"));

const results = [];
for (const { name, fn } of checks) {
  try { await fn(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, error }); }
}
for (const item of results) {
  console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
  if (!item.ok) console.error(item.error);
}

rmSync(outDir, { recursive: true, force: true });

const failures = results.filter((item) => !item.ok);
if (failures.length > 0) {
  console.error(`\n${failures.length} Phase 4B-1 policy-inputs contract check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${results.length} Phase 4B-1 policy-inputs contract checks passed.`);
