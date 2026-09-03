#!/usr/bin/env node
// QF-MVP-50.3 / 50.4 real staging orchestration certification gate.
// OFFLINE ONLY: no database, network, provider, n8n or deployment access.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), "utf8");
const digest = (buffer) => createHash("sha256").update(buffer).digest("hex");
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const clone = (value) => structuredClone(value);

const EVIDENCE_PATH = "docs/QF-MVP-50-3-50-4-STAGING-ORCHESTRATION-CERTIFICATION.md";
const FORENSIC_PATH = "docs/QF-MVP-50-3-50-4-STAGING-FORENSIC-RECONCILIATION.md";
const MANIFEST_PATH = "supabase/staging-history/qf-mvp-staging-history-manifest.json";
const CLAIM_MIGRATION = "supabase/migrations/20260811000000_qf_mvp_50_3_50_4_family_aware_claim_routing.sql";
const SCRIPT_NAME = "test:mvp:50-3-50-4-cert";
const SCRIPT_COMMAND = "node scripts/mvp/automation/validate-qf-mvp-50-3-50-4-staging-orchestration-certification.mjs";
const CI_PATH = ".github/workflows/qf-mvp-50-quality-gate.yml";

const WORKFLOWS = [
  {
    family: "client_whatsapp",
    path: "automation/n8n/QF-MVP-50-02-Client-Whatsapp-Executor.50.2E-selfhost-env.workflow.json",
    sha: "79716cd979aedaaa06aced84d843cad3ca15b47580bbbed8f85175b8c916dad4",
  },
  {
    family: "vendor_whatsapp",
    path: "automation/n8n/QF-MVP-50-03-Vendor-Whatsapp-Executor.workflow.json",
    sha: "27d4831d157a6da31118d864a350766f90bf124b54f364a008e3b88cf6072926",
  },
  {
    family: "campaign_execution",
    path: "automation/n8n/QF-MVP-50-04-Campaign-Execution-Executor.workflow.json",
    sha: "0e820de0ffb7bf399fed4a8025b166b1663568a0e1e441e112e599d323a21a18",
  },
];

const EXPECTED_APPLIED = [
  ["20260804000000", 21],
  ["20260805000000", 22],
  ["20260806000000", 23],
  ["20260807000000", 24],
  ["20260808000000", 25],
  ["20260808500000", 26],
  ["20260809000000", 27],
  ["20260810000000", 28],
  ["20260811000000", 29],
  ["20260812000000", 30],
];

const VENDOR_ACTIONS = [
  "vendor.lead_offer",
  "vendor.response_reminder",
  "vendor.onboarding_reminder",
  "vendor.package_expiry_warning",
  "vendor.low_credit_warning",
];

function countEdges(connections) {
  let count = 0;
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (value && typeof value === "object") {
      if (typeof value.node === "string") count += 1;
      else for (const item of Object.values(value)) visit(item);
    }
  };
  visit(connections);
  return count;
}

function quotedValues(block) {
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function loadState() {
  const workflows = WORKFLOWS.map((expected) => {
    const bytes = readFileSync(path.join(ROOT, expected.path));
    const parsed = JSON.parse(bytes.toString("utf8"));
    return {
      ...expected,
      rawHash: digest(bytes),
      active: parsed.active,
      nodes: parsed.nodes?.length,
      connectionSources: Object.keys(parsed.connections ?? {}).length,
      edges: countEdges(parsed.connections ?? {}),
    };
  });
  return {
    evidenceExists: existsSync(path.join(ROOT, EVIDENCE_PATH)),
    evidence: read(EVIDENCE_PATH),
    forensic: read(FORENSIC_PATH),
    manifest: JSON.parse(read(MANIFEST_PATH)),
    pkg: JSON.parse(read("package.json")),
    ci: read(CI_PATH),
    migrationFiles: readdirSync(path.join(ROOT, "supabase/migrations"))
      .filter((name) => name.endsWith(".sql")).sort(),
    claimMigration: read(CLAIM_MIGRATION),
    actionRegistry: read("lib/automation/actionRegistry.ts"),
    vendorRegistry: read("lib/automation/vendorDispatchRegistry.ts"),
    transportTypes: read("lib/automation/transportTypes.ts"),
    vendorService: read("services/automationVendorExecutionService.ts"),
    workflows,
  };
}

function validateState(state) {
  const results = [];
  const check = (name, passed) => results.push({ name, passed: passed === true });
  const applied = state.manifest.appliedPostAnchorMigrations ?? [];
  const pending = state.manifest.pendingPostAnchorMigrations;
  // QF-MVP-80.05 RECONCILIATION: proved applied to BOTH environments, read-only.
  const reconciled = state.manifest.reconciledPostAnchorMigrations;

  // QF-MVP-50.5 STAGING GATE RE-PIN. Nothing this certification proved about the
  // 50.3/50.4 staging orchestration changes: histories 21..29 are still applied in
  // exact order. The 50.5 recovery transport cleared its own separate staging gate
  // and is appended at 30 — named explicitly, never allowed as "anything newer".
  // QF-MVP-40.13B RE-PIN: 97 -> 98 and the pending set gains exactly the SOURCE-PENDING
  // canary activation authority. Nothing about the applied 21..30 truth changes.
  // QF-MVP-40 MARKETING-CONSENT RE-PIN: 98 -> 99 and the pending set gains exactly the
  // SOURCE-PENDING marketing-consent writer RPC. The applied 21..30 truth is unchanged.
// QF-MVP-75.02 RE-PIN: 100 -> 101, adding ONLY the SOURCE-PENDING geo normalization /
// PostGIS shortlist foundation (20260816000000). No existing migration was changed,
// renamed, deleted or reordered. Still exact equality.
  // QF-MVP-80.14A RE-PIN: 102 -> 103, adding ONLY the SOURCE-PENDING Meta production
  // activation authority (20260903040000). Still exact equality.
  check("local migration count remains exactly 103", state.migrationFiles.length === 103);
  check("histories 21 through 30 remain applied in exact order",
    same(applied.map((record) => [record.version, record.remoteHistoryCountAfterApply]), EXPECTED_APPLIED));
  check("the governed pending set holds exactly the one pinned activation authority and the five governed authorities are reconciled as APPLIED",
    Array.isArray(pending) && pending.length === 1 &&
    pending[0].version === "20260903040000" && pending[0].operationalStatus === "PENDING" &&
    Array.isArray(reconciled) && reconciled.length === 5 &&
    reconciled[0].version === "20260813000000" &&
    reconciled[1].version === "20260814000000" &&
    reconciled[2].version === "20260815000000" &&
    reconciled.every((r) => r.operationalStatus === "APPLIED"
      && r.appliedByThisPhase === false
      && r.appliedToStaging === true && r.appliedToProduction === true));
  check("the 50.5 recovery migration is applied by its own phase at history 30",
    (() => {
      const pin = applied.find((record) => record.version === "20260812000000");
      return pin?.operationalStatus === "APPLIED" &&
        pin.remoteHistoryCountAfterApply === 30 &&
        pin.appliedByThisPhase === true;
    })());
  check("the forensic reconciliation remains preserved and provenance unknown",
    state.forensic.includes("exactly 29 rows") &&
    state.forensic.includes("APPLY_EXECUTOR_PROVENANCE: UNKNOWN") &&
    state.pkg.scripts?.["test:mvp:50-3-50-4-forensic"] ===
      "node scripts/mvp/automation/validate-qf-mvp-50-3-50-4-staging-forensic-reconciliation.mjs");

  check("the durable orchestration evidence exists", state.evidenceExists);
  check("evidence pins the exact heads and staging project",
    state.evidence.includes("0a52314f4f6f94ef449418be7c0bec87d6198c9e") &&
    state.evidence.includes("9bdb2be97c2dd7f85ea1428359cb01b2ec65c2f2") &&
    state.evidence.includes("uckafzuochmbvtiodmcl"));
  check("migration commands and applies are explicitly zero",
    state.evidence.includes("MIGRATION_COMMANDS_EXECUTED: 0") &&
    state.evidence.includes("MIGRATIONS_APPLIED_BY_THIS_PHASE: 0") &&
    !/MIGRATION_COMMANDS_EXECUTED:\s*[1-9]|MIGRATIONS_APPLIED_BY_THIS_PHASE:\s*[1-9]/.test(state.evidence));
  check("forensic executor provenance remains unknown",
    state.evidence.includes("APPLY_EXECUTOR_PROVENANCE: UNKNOWN") &&
    !/APPLY_EXECUTOR_PROVENANCE:\s*(?!UNKNOWN\b)[A-Z0-9_-]+/.test(state.evidence));

  check("exactly three closed claimable families remain", (() => {
    const match = /N8N_CLAIMABLE_WORKFLOW_FAMILIES\s*=\s*\[([\s\S]*?)\]\s*as const/
      .exec(state.transportTypes);
    return Boolean(match) && same(quotedValues(match[1]), WORKFLOWS.map((item) => item.family));
  })());
  check("all three workflow sources remain inactive with pinned bytes and graph sizes",
    state.workflows.every((workflow) =>
      workflow.rawHash === workflow.sha && workflow.active === false &&
      workflow.nodes === 52 && workflow.connectionSources === 44 && workflow.edges === 50));
  check("evidence pins graph equivalence, workflow hashes and runtime versions",
    /export from the isolated n8n database[\s\S]*compared to source/i.test(state.evidence) &&
    WORKFLOWS.every((workflow) => state.evidence.includes(workflow.sha)) &&
    state.evidence.includes("2.32.6") && state.evidence.includes("v24.18.0"));

  check("exactly five vendor actions remain active", (() => {
    const match = /VENDOR_AUTOMATION_ACTION_TYPES\s*=\s*\[([\s\S]*?)\]\s*as const/
      .exec(state.vendorRegistry);
    return Boolean(match) && same(quotedValues(match[1]), VENDOR_ACTIONS);
  })());
  check("vendor document reminder remains registered but not producible",
    state.evidence.includes("VENDOR_DOCUMENT_REMINDER_PRODUCIBLE: NO") &&
    state.evidence.includes("QF_PRODUCER_VENDOR_DOCUMENT_DOMAIN_ABSENT") &&
    state.vendorRegistry.includes("NO_CANONICAL_VENDOR_DOCUMENT_DOMAIN"));
  check("campaign execute batch remains registered but not produced",
    state.evidence.includes("CAMPAIGN_EXECUTE_BATCH_PRODUCIBLE: NO") &&
    state.evidence.includes("BATCH_ADVANCE_REMAINS_CORE_OWNED_HANDOFF"));
  check("vendor accept/reject remains absent",
    state.evidence.includes("VENDOR_ACCEPT_REJECT_PRESENT: NO") &&
    VENDOR_ACTIONS.every((action) => !/accept|reject|decline/i.test(action)) &&
    !/vendor\.(?:accept|reject|decline)/i.test(state.actionRegistry));
  check("the stale-assignment fix is definitive and pre-communication",
    /if \(!row\) return \{ ok: false, code: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" \}/
      .test(state.vendorService) &&
    state.evidence.includes("deleted test assignment"));

  check("real n8n three-family isolation is recorded",
    state.evidence.includes("legacy three-key claim") &&
    state.evidence.includes("AUTOMATION_EXECUTION_WORKFLOW_FAMILY_MISMATCH") &&
    state.evidence.includes("campaign claim returned") &&
    state.evidence.includes("combined run claimed one fresh job in each family"));
  check("security negatives and directional response verification are recorded",
    state.evidence.includes("malformed signature -> 401 unsigned") &&
    state.evidence.includes("body larger than 2048 bytes -> 413 unsigned") &&
    state.evidence.includes("failed validation with a different secret") &&
    state.evidence.includes("SecretValueLogged: false"));
  check("all five variable contracts remain truthfully unresolved",
    VENDOR_ACTIONS.every((action) => state.evidence.includes(action)) &&
    (state.evidence.match(/QF_EXEC_VARIABLES_UNRESOLVED/g) ?? []).length >= 6 &&
    state.evidence.includes("Variable binding remains owned by QF-MVP-40.12"));
  check("canonical campaign lifecycle and projection are recorded",
    state.evidence.includes("FREQUENCY_POLICY_NOT_CONFIGURED") &&
    state.evidence.includes("created 0 / existing 1") &&
    state.evidence.includes("reconcileCampaignIntent") &&
    state.evidence.includes("retired the temporary policy"));

  check("provider, billing, activation and production side effects remain zero",
    state.evidence.includes("WHATSAPP_MESSAGES_SENT: 0") &&
    state.evidence.includes("META_MESSAGES_CALLS: 0") &&
    state.evidence.includes("META_BILLING_WRITES: 0") &&
    state.evidence.includes("PROVIDER_ACTIVATION: NO") &&
    state.evidence.includes("PRODUCTION_DB_WRITES: 0") &&
    !/WHATSAPP_MESSAGES_SENT:\s*[1-9]|META_MESSAGES_CALLS:\s*[1-9]|META_BILLING_WRITES:\s*[1-9]/
      .test(state.evidence));
  check("no fabricated live-provider readiness is claimed",
    state.evidence.includes("LIVE_PROVIDER_READY: NO") &&
    !/LIVE_PROVIDER_READY:\s*YES|PROVIDER_ACTIVATION:\s*YES/.test(state.evidence));
  check("50.3 and 50.4 carry the exact frozen statuses",
    state.evidence.includes("QF_MVP_50_3_STATUS: COMPLETE / TESTED / FROZEN") &&
    state.evidence.includes("QF_MVP_50_4_STATUS: COMPLETE / TESTED / FROZEN"));
  check("QF-MVP-50 remains incomplete and 50.5 remains not started",
    state.evidence.includes("QF_MVP_50_TOP_LEVEL_COMPLETE: NO") &&
    state.evidence.includes("QF_MVP_50_5_STARTED: NO") &&
    state.evidence.includes("RETRY_SCHEDULED_RECOVERY_IMPLEMENTED: NO") &&
    !/create\s+or\s+replace\s+function\s+public\.[^(]*(?:due_?sweep|stale_?lease|retry_?recovery|dead_?letter)/i
      .test(state.claimMigration));
  check("post-state deltas and immutable residue are explicit",
    state.evidence.includes("| action requests | 30 | 73 | +43 |") &&
    state.evidence.includes("| communication messages | 0 | 0 | 0 |") &&
    state.evidence.includes("pre-fix stale-assignment probe leaves one processing"));

  check("the validator is registered and wired after the forensic gate",
    state.pkg.scripts?.[SCRIPT_NAME] === SCRIPT_COMMAND &&
    /staging forensic reconciliation[\s\S]*test:mvp:50-3-50-4-forensic[\s\S]*staging orchestration certification[\s\S]*test:mvp:50-3-50-4-cert/i
      .test(state.ci));
  check("CI remains offline and secret-free",
    !state.ci.includes("\u0024{{ secrets.") &&
    !/^\s*(?:run:\s*)?(?:npx\s+)?supabase\s+/mi.test(state.ci) &&
    !/\bdb push\b/i.test(state.ci) &&
    !/^\s*run:.*\bdeploy\b/mi.test(state.ci));

  return { results, failures: results.filter((result) => !result.passed) };
}

function runMutants(pristine) {
  const cases = [
    ["false top-level completion", (s) => { s.evidence = s.evidence.replace("QF_MVP_50_TOP_LEVEL_COMPLETE: NO", "QF_MVP_50_TOP_LEVEL_COMPLETE: YES"); }],
    ["false provider readiness", (s) => { s.evidence = s.evidence.replace("LIVE_PROVIDER_READY: NO", "LIVE_PROVIDER_READY: YES"); }],
    ["migration command invented", (s) => { s.evidence = s.evidence.replace("MIGRATION_COMMANDS_EXECUTED: 0", "MIGRATION_COMMANDS_EXECUTED: 1"); }],
    ["migration apply invented", (s) => { s.evidence = s.evidence.replace("MIGRATIONS_APPLIED_BY_THIS_PHASE: 0", "MIGRATIONS_APPLIED_BY_THIS_PHASE: 3"); }],
    ["50.5 falsely started", (s) => { s.evidence = s.evidence.replace("QF_MVP_50_5_STARTED: NO", "QF_MVP_50_5_STARTED: YES"); }],
    ["accept/reject enabled", (s) => { s.evidence = s.evidence.replace("VENDOR_ACCEPT_REJECT_PRESENT: NO", "VENDOR_ACCEPT_REJECT_PRESENT: YES"); }],
    ["source workflow activated", (s) => { s.workflows[1].active = true; }],
    ["fake WhatsApp sends", (s) => { s.evidence = s.evidence.replace("WHATSAPP_MESSAGES_SENT: 0", "WHATSAPP_MESSAGES_SENT: 2"); }],
    ["fake Meta call", (s) => { s.evidence = s.evidence.replace("META_MESSAGES_CALLS: 0", "META_MESSAGES_CALLS: 1"); }],
    ["workflow source hash changed", (s) => { s.workflows[2].rawHash = "0".repeat(64); }],
    ["real n8n version removed", (s) => { s.evidence = s.evidence.replaceAll("2.32.6", "unknown"); }],
    ["50.3 status demoted", (s) => { s.evidence = s.evidence.replace("QF_MVP_50_3_STATUS: COMPLETE / TESTED / FROZEN", "QF_MVP_50_3_STATUS: SOURCE READY"); }],
    ["document reminder made producible", (s) => { s.evidence = s.evidence.replace("VENDOR_DOCUMENT_REMINDER_PRODUCIBLE: NO", "VENDOR_DOCUMENT_REMINDER_PRODUCIBLE: YES"); }],
    ["campaign batch made producible", (s) => { s.evidence = s.evidence.replace("CAMPAIGN_EXECUTE_BATCH_PRODUCIBLE: NO", "CAMPAIGN_EXECUTE_BATCH_PRODUCIBLE: YES"); }],
    ["forensic executor invented", (s) => { s.evidence = s.evidence.replace("APPLY_EXECUTOR_PROVENANCE: UNKNOWN", "APPLY_EXECUTOR_PROVENANCE: SUPABASE_CLI"); }],
  ];
  return cases.map(([name, mutate]) => {
    const mutant = clone(pristine);
    mutate(mutant);
    return { name, rejected: validateState(mutant).failures.length > 0 };
  });
}

const state = loadState();
const validation = validateState(state);
const mutants = runMutants(state);

for (const [index, result] of validation.results.entries()) {
  console.log((result.passed ? "PASS" : "FAIL") + " " +
    String(index + 1).padStart(2, "0") + " " + result.name);
}
for (const [index, mutant] of mutants.entries()) {
  console.log((mutant.rejected ? "PASS" : "FAIL") + " M" +
    String(index + 1).padStart(2, "0") + " reject mutant: " + mutant.name);
}

const mutantFailures = mutants.filter((mutant) => !mutant.rejected);
console.log("SUMMARY assertions=" + validation.results.length +
  " passed=" + (validation.results.length - validation.failures.length) +
  " failed=" + validation.failures.length +
  " mutants=" + mutants.length +
  " mutants_rejected=" + (mutants.length - mutantFailures.length));
if (validation.failures.length || mutantFailures.length) process.exit(1);
