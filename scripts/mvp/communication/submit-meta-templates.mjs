// ============================================================================
// QF-MVP-40.10A — Meta template submission operator script.  DRY RUN BY DEFAULT.
//
// It creates message templates. It can NEVER send a message, edit a template or
// delete a template: no /messages endpoint, no DELETE, no PUT and no PATCH exists
// anywhere in this file, and there is no code path that could add one at runtime.
//
//   node scripts/mvp/communication/submit-meta-templates.mjs --wave 0
//     -> DRY RUN. Prints exactly what WOULD be posted. No network call at all.
//
//   node scripts/mvp/communication/submit-meta-templates.mjs --wave 0 --execute
//     -> Performs the create calls. Requires QF_META_WABA_ID and
//        QF_META_ACCESS_TOKEN in the environment. Neither is ever printed.
//
// Safety rules, all enforced below:
//   * --execute must be explicit; the default is always dry run;
//   * a wave must be named explicitly — there is no "submit everything";
//   * templates with submit_now=false are refused even inside a selected wave;
//   * existing templates are fetched FIRST; an identical one is treated as
//     idempotent-existing, and a SAME NAME with DIFFERENT content fails closed;
//   * the first ambiguous response stops the run;
//   * responses are recorded sanitized — internal key, provider name, status,
//     category, template id if returned, UTC. Never a token or a raw error body.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";
const GRAPH = "https://graph.facebook.com";
const API_VERSION = "v21.0";

const argv = process.argv.slice(2);
const EXECUTE = argv.includes("--execute");          // default: DRY RUN
const waveArg = argv[argv.indexOf("--wave") + 1];
const WAVE = argv.includes("--wave") ? Number(waveArg) : NaN;

if (!Number.isInteger(WAVE)) {
  console.error("Refusing to run: an explicit --wave <n> is required. There is no submit-everything mode.");
  process.exit(2);
}

const packet = JSON.parse(readFileSync(resolve(PACKET), "utf8"));
const selected = packet.templates.filter((t) => t.submission_wave === WAVE);
if (selected.length === 0) {
  console.error(`Refusing to run: wave ${WAVE} contains no templates.`);
  process.exit(2);
}

const blocked = selected.filter((t) => t.submit_now !== true);
const submittable = selected.filter((t) => t.submit_now === true);

console.log(`Mode           : ${EXECUTE ? "EXECUTE" : "DRY RUN (no network call)"}`);
console.log(`Wave           : ${WAVE}`);
console.log(`Selected       : ${selected.length}`);
console.log(`Submittable    : ${submittable.length}`);
console.log(`Held (submit_now=false): ${blocked.length}${blocked.length ? " -> " + blocked.map((t) => t.internal_template_key).join(", ") : ""}`);
console.log("");

if (!EXECUTE) {
  for (const t of submittable) {
    console.log(`WOULD CREATE  ${t.internal_template_key}`);
    console.log(`  name        ${t.provider_template_name}`);
    console.log(`  language    ${t.provider_language}`);
    console.log(`  category    ${t.category}`);
    console.log(`  profile     ${t.component_profile}`);
    console.log(`  fingerprint ${t.payload_fingerprint}`);
    console.log(`  payload     ${JSON.stringify(t.creation_payload)}`);
    console.log("");
  }
  console.log("DRY RUN COMPLETE. Nothing was submitted, sent, edited or deleted.");
  console.log("Re-run with --execute (and QF_META_WABA_ID / QF_META_ACCESS_TOKEN set) to create these templates.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// EXECUTE path. Reached only with an explicit --execute.
// ---------------------------------------------------------------------------
const WABA_ID = process.env.QF_META_WABA_ID;
const TOKEN = process.env.QF_META_ACCESS_TOKEN;
if (!WABA_ID || !TOKEN) {
  console.error("Refusing to execute: QF_META_WABA_ID and QF_META_ACCESS_TOKEN must both be set. Neither is printed.");
  process.exit(2);
}

const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const stamp = () => new Date().toISOString();

/** Fetch existing templates first, so a create is never blind. */
async function listExisting() {
  const res = await fetch(`${GRAPH}/${API_VERSION}/${WABA_ID}/message_templates?limit=200`, { headers: auth });
  if (!res.ok) {
    console.error(`Refusing to continue: could not list existing templates (HTTP ${res.status}).`);
    process.exit(3);
  }
  const body = await res.json();
  return new Map((body.data ?? []).map((t) => [`${t.name}::${t.language}`, t]));
}

const existing = await listExisting();
const record = [];

for (const t of submittable) {
  const key = `${t.provider_template_name}::${t.provider_language}`;
  const already = existing.get(key);

  if (already) {
    // Same name+language already exists. Only an EXACT category match is treated
    // as idempotent; anything else is a collision and stops the run.
    if (String(already.category).toUpperCase() !== String(t.category).toUpperCase()) {
      console.error(`STOP: ${t.provider_template_name} exists with category ${already.category}, expected ${t.category}. Refusing to edit or replace.`);
      process.exit(4);
    }
    record.push({ internal_key: t.internal_template_key, provider_name: t.provider_template_name,
                  status: already.status ?? "EXISTING", category: already.category,
                  template_id: already.id ?? null, utc: stamp(), outcome: "idempotent_existing" });
    console.log(`EXISTING      ${t.internal_template_key} (${already.status ?? "unknown"})`);
    continue;
  }

  const res = await fetch(`${GRAPH}/${API_VERSION}/${WABA_ID}/message_templates`, {
    method: "POST", headers: auth, body: JSON.stringify(t.creation_payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || typeof body !== "object") {
    console.error(`STOP: ambiguous or failed response for ${t.internal_template_key} (HTTP ${res.status}). No further template is attempted.`);
    process.exit(5);
  }
  record.push({ internal_key: t.internal_template_key, provider_name: t.provider_template_name,
                status: body.status ?? "SUBMITTED", category: body.category ?? t.category,
                template_id: body.id ?? null, utc: stamp(), outcome: "created" });
  console.log(`CREATED       ${t.internal_template_key} -> ${body.status ?? "SUBMITTED"}`);
}

console.log("\nSanitized record:");
console.log(JSON.stringify(record, null, 2));
console.log("\nNo message was sent. No template was edited or deleted. No provider mapping was activated.");
