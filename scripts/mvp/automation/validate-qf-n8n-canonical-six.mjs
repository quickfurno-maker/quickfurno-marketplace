import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RETIRED_N8N_WORKFLOWS, readRetiredWorkflow } from "./historicalWorkflowSource.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DIR = path.join(ROOT, "automation/n8n");
const manifest = JSON.parse(readFileSync(path.join(DIR, "CANONICAL-WORKFLOWS.json"), "utf8"));
const results = [];
const record = (name, ok) => results.push({ name, ok: Boolean(ok) });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const workflowFiles = readdirSync(DIR).filter((f) => f.endsWith(".workflow.json")).sort();
const canonicalFiles = manifest.workflows.map((w) => w.file).sort();
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

record("01 manifest schema is v1", manifest.schemaVersion === 1);
record("02 manifest declares exactly six workflows", manifest.workflows.length === 6);
record("03 active workflow tree contains exactly six JSON definitions", workflowFiles.length === 6);
record("04 active workflow tree equals the manifest allowlist exactly", same(workflowFiles, canonicalFiles));
record("05 no retired Core Job Dispatcher workflow file remains active", !workflowFiles.some((f) => /Core-Job-Dispatcher/i.test(f)));
record("06 no extra workflow JSON can hide outside the exact allowlist", workflowFiles.every((f) => canonicalFiles.includes(f)));

for (const entry of manifest.workflows) {
  const full = path.join(DIR, entry.file);
  const bytes = existsSync(full) ? readFileSync(full) : null;
  const wf = bytes ? JSON.parse(bytes.toString("utf8")) : null;
  record(`${entry.role}: file exists`, Boolean(bytes));
  record(`${entry.role}: sha256 is pinned`, Boolean(bytes) && sha256(bytes) === entry.sha256);
  record(`${entry.role}: workflow name is pinned`, wf?.name === entry.name);
  record(`${entry.role}: repository definition remains inactive`, wf?.active === false);
  record(`${entry.role}: repository definition is unpublished`, wf && !Object.prototype.hasOwnProperty.call(wf, "published"));
  record(`${entry.role}: no embedded credentials object`, wf && !(JSON.stringify(wf.nodes ?? []).includes('"credentials"')));
}

const byRole = new Map(manifest.workflows.map((w) => [w.role, readFileSync(path.join(DIR, w.file), "utf8")]));
record("07 three executors contain claim route", ["client_executor", "vendor_executor", "campaign_executor"].every((r) => byRole.get(r)?.includes("/api/internal/automation/n8n/claim")));
record("08 three executors contain completion route", ["client_executor", "vendor_executor", "campaign_executor"].every((r) => byRole.get(r)?.includes("/api/internal/automation/n8n/complete")));
record("09 client executor alone contains execute-client", byRole.get("client_executor")?.includes("/api/internal/automation/n8n/execute-client") && !byRole.get("vendor_executor")?.includes("/api/internal/automation/n8n/execute-client") && !byRole.get("campaign_executor")?.includes("/api/internal/automation/n8n/execute-client"));
record("10 vendor executor alone contains execute-vendor", byRole.get("vendor_executor")?.includes("/api/internal/automation/n8n/execute-vendor") && !byRole.get("client_executor")?.includes("/api/internal/automation/n8n/execute-vendor") && !byRole.get("campaign_executor")?.includes("/api/internal/automation/n8n/execute-vendor"));
record("11 campaign executor alone contains execute-campaign", byRole.get("campaign_executor")?.includes("/api/internal/automation/n8n/execute-campaign") && !byRole.get("client_executor")?.includes("/api/internal/automation/n8n/execute-campaign") && !byRole.get("vendor_executor")?.includes("/api/internal/automation/n8n/execute-campaign"));
record("12 recovery supervisor owns recover route", byRole.get("recovery_supervisor")?.includes("/api/internal/automation/n8n/recover"));
record("13 recovery supervisor owns reconcile route", byRole.get("recovery_supervisor")?.includes("/api/internal/automation/n8n/reconcile"));
record("14 orphan supervisor owns only orphan maintenance route", byRole.get("orphan_cancellation_supervisor")?.includes("/api/internal/automation/n8n/cancel-orphan") && !byRole.get("orphan_cancellation_supervisor")?.includes("/api/internal/automation/n8n/cancel-stale"));
record("15 stale supervisor owns only stale maintenance route", byRole.get("stale_business_supervisor")?.includes("/api/internal/automation/n8n/cancel-stale") && !byRole.get("stale_business_supervisor")?.includes("/api/internal/automation/n8n/cancel-orphan"));

record("16 retired dispatcher artifacts are absent from active tree", Object.keys(RETIRED_N8N_WORKFLOWS).every((f) => !existsSync(path.join(DIR, f))));
record("17 retired dispatcher evidence remains recoverable from immutable Git history", Object.entries(RETIRED_N8N_WORKFLOWS).every(([f, e]) => sha256(Buffer.from(readRetiredWorkflow(f), "utf8")) === e.sha256));
record("18 manifest explicitly documents Git-history retirement", /Git history/i.test(manifest.policy) && /six/i.test(manifest.policy));

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}`);
console.log("");
console.log(`QF n8n canonical-six guard: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) process.exitCode = 1;
else console.log("QF_N8N_CANONICAL_SIX_SOURCE_GREEN");
