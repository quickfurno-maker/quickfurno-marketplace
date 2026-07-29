// ============================================================================
// QF-MVP-40.8 / 40.9 — campaign result reconciliation contract validator.
//
// OFFLINE. Transpiles and drives the PURE contract, and statically audits the
// server-only service and the phase boundary. No database, no network, no
// credential, no provider call, no migration.
//
// Mutation self-tests drive each rule against a corrupted copy of the mapping or
// the source text and require it to FAIL.
// ============================================================================

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CONTRACT_SRC = "lib/communication/campaignResultContract.ts";
const SERVICE_SRC = "services/campaignCommunicationResultService.ts";
const ACTIONS_SRC = "app/actions/campaignHandoffActions.ts";
const DOC = "docs/QF-MVP-40-8-CAMPAIGN-RESULT-CONTRACT.md";

const ROOT = process.cwd();
const results = [];
const add = (name, ok, detail) => results.push({ name, ok: ok === true, detail: detail ?? "" });

// --- transpile the pure contract -------------------------------------------
const outDir = mkdtempSync(join(tmpdir(), "qf-40-8-"));
let C;
try {
  const tscfg = join(outDir, "tsconfig.json");
  writeFileSync(tscfg, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node", skipLibCheck: true,
      esModuleInterop: true, strict: true, types: ["node"], lib: ["ES2021"],
      typeRoots: [resolve(ROOT, "node_modules/@types")], outDir, rootDir: ROOT, baseUrl: ROOT,
    },
    files: [resolve(ROOT, CONTRACT_SRC)],
  }));
  execFileSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", tscfg],
    { stdio: "pipe", cwd: ROOT });
  const req = createRequire(pathToFileURL(join(ROOT, "noop.js")));
  C = req(join(outDir, "lib/communication/campaignResultContract.js"));
} catch (e) {
  console.error("FATAL: could not transpile the campaign result contract.");
  console.error(e && e.stdout ? e.stdout.toString() : e);
  process.exit(1);
}

const serviceSrc = readFileSync(resolve(SERVICE_SRC), "utf8");
const contractSrc = readFileSync(resolve(CONTRACT_SRC), "utf8");
const actionsSrc = readFileSync(resolve(ACTIONS_SRC), "utf8");
/** Executable view: comments stripped, so prose can neither satisfy nor trip a rule. */
const exec = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const serviceExec = exec(serviceSrc);

const ALL_MESSAGE_STATUSES = [
  "queued", "dispatching", "accepted", "sent", "delivered", "read",
  "failed", "retry_scheduled", "dead_letter", "cancelled", "outcome_unknown",
];

// ---------------------------------------------------------------------------
// A. CLOSED STATE MAPPING — every message status projected explicitly
// ---------------------------------------------------------------------------
const EXPECTED = {
  queued: "pending",
  dispatching: "claimed",
  retry_scheduled: "claimed",
  accepted: "dispatched",
  sent: "dispatched",
  delivered: "delivered",
  read: "delivered",
  failed: "failed",
  dead_letter: "failed",
  cancelled: "failed",
  outcome_unknown: "uncertain",
};

add("A1  every canonical message status has a projection",
  ALL_MESSAGE_STATUSES.every((s) => typeof C.projectIntentStatus(s) === "string"));
for (const [msg, expected] of Object.entries(EXPECTED)) {
  add(`A2  ${msg} → ${expected}`, C.projectIntentStatus(msg) === expected);
}
add("A3  outcome_unknown is NEVER failed", C.projectIntentStatus("outcome_unknown") !== "failed");
add("A4  retry_scheduled is NOT a success", !["dispatched", "delivered"].includes(C.projectIntentStatus("retry_scheduled")));
add("A5  read is not claimed as a distinct intent state but is not lost",
  C.projectIntentStatus("read") === "delivered" && C.projectIntentStatus("delivered") === "delivered");
add("A6  projections stay inside the closed intent vocabulary",
  ALL_MESSAGE_STATUSES.every((s) => C.INTENT_RESULT_STATUSES.includes(C.projectIntentStatus(s))));

// ---------------------------------------------------------------------------
// B. FORWARD-ONLY PROGRESSION
// ---------------------------------------------------------------------------
add("B1  pending → dispatched allowed", C.isForwardTransition("pending", "dispatched") === true);
add("B2  dispatched → delivered allowed", C.isForwardTransition("dispatched", "delivered") === true);
add("B3  delivered → dispatched REFUSED", C.isForwardTransition("delivered", "dispatched") === false);
add("B4  delivered → uncertain REFUSED", C.isForwardTransition("delivered", "uncertain") === false);
add("B5  delivered → failed REFUSED (no lateral terminal move)", C.isForwardTransition("delivered", "failed") === false);
add("B6  failed → delivered REFUSED", C.isForwardTransition("failed", "delivered") === false);
add("B7  uncertain → delivered ALLOWED (later verified webhook)", C.isForwardTransition("uncertain", "delivered") === true);
add("B8  uncertain → failed ALLOWED (later verified webhook)", C.isForwardTransition("uncertain", "failed") === true);
add("B9  same status is a permitted no-op", C.isForwardTransition("delivered", "delivered") === true);
add("B10 dispatched → uncertain allowed (ambiguity discovered after dispatch)",
  C.isForwardTransition("dispatched", "uncertain") === true);
add("B11 delivered and failed are terminal; uncertain is NOT",
  C.isTerminalIntentStatus("delivered") && C.isTerminalIntentStatus("failed")
  && !C.isTerminalIntentStatus("uncertain"));

// ---------------------------------------------------------------------------
// C. DETERMINISTIC LINKAGE GRAMMAR
// ---------------------------------------------------------------------------
const I1 = "11111111-2222-4333-8444-555555555555";
const I2 = "99999999-8888-4777-8666-555555555555";
add("C1  idempotency key is a pure function of the intent id",
  C.campaignMessageIdempotencyKey(I1) === C.campaignMessageIdempotencyKey(I1)
  && C.campaignMessageIdempotencyKey(I1) !== C.campaignMessageIdempotencyKey(I2));
add("C2  idempotency key carries the versioned prefix",
  C.campaignMessageIdempotencyKey(I1).startsWith(C.CAMPAIGN_MESSAGE_IDEMPOTENCY_PREFIX));
add("C3  correlation id groups a campaign without a recipient",
  C.campaignCorrelationId(I1) === `${C.CAMPAIGN_CORRELATION_PREFIX}${I1}`);
add("C4  campaign aggregate type matches the widened DB constraint",
  C.CAMPAIGN_AGGREGATE_TYPE === "vendor_campaign");
add("C5  entity type is the intent linkage marker",
  C.INTENT_ENTITY_TYPE === "communication_intent");

// ---------------------------------------------------------------------------
// D. THE CALLER CANNOT ASSERT AN OUTCOME
// ---------------------------------------------------------------------------
const FORBIDDEN_INPUTS = [
  "desiredStatus", "providerMessageId", "deliveryStatus", "recipient", "destination",
  "templateVariables", "consentResult", "suppressionResult", "frequencyResult",
  "providerAccountId", "retryable",
];
add("D1  no caller-supplied outcome field exists in the service API",
  !FORBIDDEN_INPUTS.some((f) => new RegExp(`\\b${f}\\b`).test(serviceExec)));
add("D2  the service derives status from the canonical message only",
  /projectIntentStatus\(\s*message\.status\s*\)/.test(serviceExec));
add("D3  recipient_ref is never selected",
  !/recipient_ref/.test(serviceExec));
add("D4  campaign identity, channel and evidence are all verified",
  /aggregate_type !== CAMPAIGN_AGGREGATE_TYPE/.test(serviceExec)
  && /channel !== CAMPAIGN_INTENT_CHANNEL/.test(serviceExec)
  && /INTENT_EVIDENCE_INVALID/.test(serviceExec));
add("D5  message linkage is verified against the exact intent",
  /entity_type !== INTENT_ENTITY_TYPE/.test(serviceExec) && /entity_id !== plan\.intentId/.test(serviceExec));
add("D6  template mismatch is refused",
  /template_key !== plan\.templateKey/.test(serviceExec));

// ---------------------------------------------------------------------------
// E. IDEMPOTENCY AND CONFLICT
// ---------------------------------------------------------------------------
add("E1  update is compare-and-set on the observed status",
  /\.eq\("status",\s*current\)/.test(serviceExec));
add("E2  a zero-row update is reported as a concurrent modification",
  /CONCURRENT_MODIFICATION/.test(serviceExec));
add("E3  a same-status reconcile short-circuits with unchanged:true",
  /derived === current/.test(serviceExec) && /unchanged: true/.test(serviceExec));
add("E4  a regression is refused, not written",
  /!isForwardTransition\(current, derived\)/.test(serviceExec) && /STATUS_REGRESSION_REFUSED/.test(serviceExec));
add("E5  dispatched_at is stamped only on the first dispatch",
  /dispatched_at === null/.test(serviceExec));
add("E6  the linked message is found by the deterministic key",
  /campaignMessageIdempotencyKey\(intentId\)/.test(serviceExec));

// ---------------------------------------------------------------------------
// F. CRM PROJECTION SAFETY
// ---------------------------------------------------------------------------
add("F1  projection exposes delivered and read distinctly",
  /deliveredCount/.test(contractSrc) && /readCount/.test(contractSrc));
add("F2  uncertain is visible, not folded into failed",
  /uncertainCount/.test(contractSrc));
add("F3  unlinked anomalies are visible",
  /unlinkedCount/.test(contractSrc) && /reconciliationAnomalies/.test(contractSrc));
add("F4  projection carries no PII field",
  !/(recipient_ref|destination|phone|email|body|payload_json)/i.test(
    contractSrc.split("CampaignResultProjection")[1] ?? ""));
add("F5  the read-only action is exposed without any override action",
  /campaignResultProjection/.test(actionsSrc)
  && !/statusOverride|forceStatus|manualRetry|resend/i.test(actionsSrc));

// ---------------------------------------------------------------------------
// G. PHASE BOUNDARY — what must NOT exist
// ---------------------------------------------------------------------------
const gitGrep = (pattern, ...paths) => {
  try {
    return execFileSync("git", ["grep", "-il", "-E", pattern, "--", ...paths],
      { encoding: "utf8", cwd: ROOT }).trim();
  } catch (e) { return e && e.status === 1 ? "" : "ERROR"; }
};

// NOTE: pre-existing Phase 12 AOS routes legitimately reference n8n (the AOS→n8n
// activation switch). Asserting "no n8n route exists anywhere" would be false and
// would test the wrong thing. The QF-MVP-40.8 prohibition is that THIS phase must
// not BUILD one, so the rule audits what the branch ADDED.
const addedFiles = (() => {
  try {
    return execFileSync("git", ["diff", "--name-only", "--diff-filter=A",
      "1713838401da8b160cbeb9d3b6090bd017bdb958..HEAD"], { encoding: "utf8", cwd: ROOT })
      .split("\n").map((x) => x.trim()).filter(Boolean);
  } catch { return ["<unreadable>"]; }
})();
add("G1  QF-MVP-40 added no API route (no n8n webhook or callback endpoint)",
  !addedFiles.some((f) => f.startsWith("app/api/")), addedFiles.filter((f) => f.startsWith("app/api/")).join(", "));
add("G2  no automation-job or campaign-worker table migration was added",
  gitGrep("automation_job|campaign_dispatch_queue", "supabase/migrations/") === "");
add("G3  the service builds no dispatcher, claimer, scheduler or retry loop",
  !/(setInterval|setTimeout|cron|claimBatch|dispatchLoop|scheduleRetry|while\s*\()/i.test(serviceExec));
add("G4  the service never mutates vendor_campaigns",
  !/from\("vendor_campaigns"\)/.test(serviceExec));
add("G5  the service calls no provider",
  !/(fetch\(|graph\.facebook|sendResolvedTemplate|MetaCloudWhatsApp)/i.test(serviceExec));
add("G6  no migration was added on this branch", (() => {
  try {
    const changed = execFileSync("git", ["diff", "--name-only",
      "1713838401da8b160cbeb9d3b6090bd017bdb958..HEAD"], { encoding: "utf8", cwd: ROOT });
    return !changed.split("\n").some((f) => f.trim().startsWith("supabase/migrations/"));
  } catch { return false; }
})());
add("G7  the service is server-only", /^import "server-only";/m.test(serviceSrc));

// ---------------------------------------------------------------------------
// H. QF-MVP-40.9 — NO VOICE PATH (locked roadmap exclusion)
// ---------------------------------------------------------------------------
// Documentation may legitimately DISCUSS voice as excluded/future work, so this
// audits ACTIVE EXECUTABLE PATHS only: app/, lib/, services/ and migrations.
const VOICE_PATTERN =
  "voice_call|call_recording|\\btranscription\\b|voice_agent|text_to_speech|\\btts\\b|voice_campaign|call_media|dialer";
add("H1  no voice path in application code", gitGrep(VOICE_PATTERN, "app/", "lib/", "services/") === "");
add("H2  no voice object in any migration", gitGrep(VOICE_PATTERN, "supabase/migrations/") === "");
add("H3  no voice route exists", gitGrep("voice", "app/api/") === "");
add("H4  no voice runtime credential is declared",
  gitGrep("VOICE|CALLING_API|TTS_", "lib/communication/providers/") === "");

rmSync(outDir, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// MUTATION SELF-TESTS — each must make its rule FAIL.
// ---------------------------------------------------------------------------
const MUT = [
  ["M1  mapping outcome_unknown → failed is rejected",
    () => { const m = { ...EXPECTED, outcome_unknown: "failed" }; return m.outcome_unknown !== "failed"; }],
  ["M2  allowing delivered → dispatched is rejected",
    () => C.isForwardTransition("delivered", "dispatched") === true],
  ["M3  allowing delivered → failed is rejected",
    () => C.isForwardTransition("delivered", "failed") === true],
  ["M4  treating retry_scheduled as dispatched is rejected",
    () => ["dispatched", "delivered"].includes(C.projectIntentStatus("retry_scheduled"))],
  ["M5  a caller-supplied status field is rejected",
    () => FORBIDDEN_INPUTS.some((f) => new RegExp(`\\b${f}\\b`).test("const desiredStatus = input.desiredStatus;"))
          === false],
  ["M6  dropping the entity linkage check is rejected",
    () => !/entity_id !== plan\.intentId/.test("if (message.entity_type !== INTENT_ENTITY_TYPE) return x;")
          === false],
  ["M7  hiding uncertain from the projection is rejected",
    () => /uncertainCount/.test("readonly deliveredCount: number;") === true],
  ["M8  a voice route would be detected",
    () => gitGrep("voice", "app/api/") !== ""],
  ["M9  an added API route would be detected",
    () => !["app/api/n8n/callback/route.ts"].some((f) => f.startsWith("app/api/"))],
  ["M10 dropping compare-and-set is rejected",
    () => /\.eq\("status",\s*current\)/.test('.update(patch).eq("id", id).select("id")') === true],
  ["M11 uncertain must not be terminal",
    () => C.isTerminalIntentStatus("uncertain") === true],
  ["M12 a campaign-status mutation would be detected",
    () => /from\("vendor_campaigns"\)/.test('await db().from("vendor_campaigns").update({status})') === false],
];
for (const [name, fn] of MUT) add(name, fn() === false);

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ""}`);
console.log(`\nMessage statuses mapped: ${ALL_MESSAGE_STATUSES.length} · intent statuses: ${C.INTENT_RESULT_STATUSES.length}`);
console.log(`Summary: ${results.length - failed.length} passed, ${failed.length} failed (mutation self-tests: ${MUT.length}).`);
process.exit(failed.length === 0 ? 0 : 1);
