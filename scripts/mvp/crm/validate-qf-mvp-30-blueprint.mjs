#!/usr/bin/env node
/**
 * QF-MVP-30.1A — repository-only Vendor CRM V1 blueprint validator.
 *
 * Small + offline. Guards that the canonical blueprint keeps its required
 * sections and its LOCKED CRM/Core security boundaries, so a later edit cannot
 * silently delete them. It grades a design document only — no schema, no runtime,
 * no historical-hash governance burden.
 *
 * Usage:  node scripts/mvp/crm/validate-qf-mvp-30-blueprint.mjs
 * Exit 0 = PASS, exit 1 = FAIL.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DOC = "docs/QF-MVP-30-VENDOR-CRM-BLUEPRINT.md";

const doc = readFileSync(path.join(ROOT, DOC), "utf8");
const lc = doc.toLowerCase();
const results = [];
let failed = false;
const need = (name, ok, detail = "") => { results.push({ name, ok, detail }); if (!ok) failed = true; };
const has = (s) => lc.includes(s.toLowerCase());

// Required sections (headers) of the blueprint.
for (const [n, re] of [
  ["1 current-state inventory", /##\s*1\.\s*current-state inventory/i],
  ["2 reuse/replace matrix", /##\s*2\.\s*reuse/i],
  ["3 core-truth reference map", /##\s*3\.\s*core-truth reference map/i],
  ["4 minimum v1 data model", /##\s*4\.\s*minimum v1 data model/i],
  ["5 crm profile field classification", /##\s*5\.\s*crm profile field classification/i],
  ["6 directory & profile read model", /##\s*6\.\s*directory/i],
  ["7 notes/tags/tasks contracts", /##\s*7\.\s*notes ?\/ ?tags ?\/ ?tasks/i],
  ["8 deterministic segment contract", /##\s*8\.\s*deterministic segment/i],
  ["9 campaign readiness lifecycle", /##\s*9\.\s*campaign readiness/i],
  ["10 access/security/privacy matrix", /##\s*10\.\s*access ?\/ ?security ?\/ ?privacy/i],
  ["11 implementation sequence", /##\s*11\.\s*implementation sequence/i],
  ["12 decision & risk matrix", /##\s*12\.\s*decision ?& ?risk/i],
  ["13 non-goals", /##\s*13\.\s*non-goals/i],
  ["14 next phase", /##\s*14\.\s*next phase/i],
]) need(`section present :: ${n}`, re.test(doc));

// Locked product/security boundaries (must be stated).
need("boundary :: Core decides / CRM organizes", has("core decides") && has("crm organizes"));
need("boundary :: Jarvis recommends / n8n executes / Meta delivers", has("jarvis recommends") && has("n8n executes") && has("meta delivers"));
need("boundary :: CRM must not own/duplicate Core truth", has("must not own or duplicate") || has("no duplicate core truth") || has("authoritative copies prohibited") || has("copies prohibited"));
need("boundary :: campaign eligibility fails closed (Core recheck)", (has("fails closed") || has("fail-closed")) && has("core recheck"));
need("boundary :: immutable audience snapshot", has("immutable audience snapshot") || (has("audience") && has("immutable")));
need("boundary :: notes append-only", has("append-only"));
need("boundary :: no service-role key reaches Jarvis/n8n", has("no service-role key"));
need("boundary :: public projection / vendor_public_v unchanged", (has("public projection unchanged") || has("public projection remains unchanged") || has("`vendor_public_v` unchanged") || has("vendor_public_v` unchanged") || has("projection unchanged")) && has("vendor_public_v"));
need("boundary :: no arbitrary SQL / no AI score in segments", has("no arbitrary sql") && (has("no ai score") || has("no ai scoring")));
need("boundary :: no owner binding, no historical exception insert", has("owner binding") && has("historical exception"));

// Selected V1 CRM tables named.
for (const t of ["vendor_crm_profiles", "vendor_contacts", "vendor_tags", "vendor_tag_assignments",
  "vendor_notes", "vendor_tasks", "vendor_segments", "vendor_campaigns", "vendor_campaign_audiences"]) {
  need(`v1 table named :: ${t}`, has(t));
}

// Implementation subphases + effort target.
need("subphases 30.1B/30.2/30.3/30.4/30.5 present", has("30.1b") && has("30.2") && has("30.3") && has("30.4") && has("30.5"));
need("effort target 4-6 focused days", has("4–6") || has("4-6"));

// Final status string.
need("final status string present", has("vendor_crm_v1_blueprint_frozen_ready_for_foundation_implementation"));

const passed = results.filter((r) => r.ok).length;
console.log("== QF-MVP-30.1A Vendor CRM blueprint validator ==");
console.log(`doc: ${DOC}`);
for (const r of results) console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}${r.ok ? "" : "  <<" + r.detail}`);
console.log("");
console.log(`checks: ${passed} passed, ${results.length - passed} failed (of ${results.length})`);
console.log(`RESULT: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
