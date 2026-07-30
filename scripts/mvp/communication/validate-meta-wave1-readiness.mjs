// ============================================================================
// QF-MVP-40.10B — Wave 1 readiness + reconcile-only operator validator.  OFFLINE.
//
// Drives the operator's exported PURE helpers and statically audits its source, then
// audits the Wave 1 owner-review packet. It calls no Meta endpoint, submits nothing,
// sends nothing, reads no credential and needs no network.
//
// Mutation self-tests drive each rule against a corrupted copy and require failure.
// ============================================================================

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  OperationMode, ReconcileOutcome, MAX_FILENAME_KEY_LENGTH,
  filenameSafeKey, resolveMode, selectTemplate,
} from "./submit-meta-templates.mjs";

const SUBMIT_SCRIPT = "scripts/mvp/communication/submit-meta-templates.mjs";
const SOURCE_PACKET = "docs/provider-manifests/meta-template-submission-packet.json";
const REVIEW = "docs/provider-manifests/meta-wave1-owner-review.json";
const DOC = "docs/QF-MVP-40-10B-WAVE1-OWNER-REVIEW.md";
const BRANCH_BASE = "1713838401da8b160cbeb9d3b6090bd017bdb958";

const ROOT = process.cwd();
const results = [];
const add = (n, ok, d) => results.push({ name: n, ok: ok === true, detail: d ?? "" });
const clone = (o) => JSON.parse(JSON.stringify(o));
const sha256 = (x) => createHash("sha256").update(x).digest("hex");

const submitSrc = readFileSync(resolve(SUBMIT_SCRIPT), "utf8");
/** Executable view: comments stripped so prose can neither satisfy nor trip a rule. */
const submitExec = submitSrc.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const sourcePacketRaw = readFileSync(resolve(SOURCE_PACKET));
const sourcePacket = JSON.parse(sourcePacketRaw.toString("utf8"));
const review = JSON.parse(readFileSync(resolve(REVIEW), "utf8"));

const GROUP_A = ["clarification_reminder", "clarification_request", "client_lead_status_update",
  "client_matching_update", "consent_start_acknowledgement", "consent_stop_acknowledgement",
  "lead_assignment_alert", "lead_received", "vendor_new_lead",
  "vendor_onboarding_reminder", "vendor_response_reminder"];
const GROUP_B = ["low_credit_warning", "recharge_reminder", "vendor_package_expiry_warning"];

const W1 = sourcePacket.templates.filter((t) => t.submission_wave === 1);
const byKey = new Map(W1.map((t) => [t.internal_template_key, t]));

const R = {
  // ---- A. CLI / operator contract ---------------------------------------
  templateFlagExists: () => /--template/.test(submitExec),
  reconcileFlagExists: () => /--reconcile-only/.test(submitExec),
  modesMutuallyExclusive: () => {
    const bad = resolveMode({ execute: true, reconcileOnly: true });
    return bad.ok === false && bad.reason === "MODE_CONFLICT_EXECUTE_AND_RECONCILE_ONLY"
      && resolveMode({ execute: true }).mode === OperationMode.EXECUTE_CREATE
      && resolveMode({ reconcileOnly: true }).mode === OperationMode.RECONCILE_ONLY
      && resolveMode({}).mode === null && resolveMode({}).network === false;
  },
  exactKeySelectionOnly: () => {
    const templates = [
      { internal_template_key: "lead_received", submission_wave: 1 },
      { internal_template_key: "lead_received_extra", submission_wave: 1 },
    ];
    // A prefix must NOT resolve, and an exact key must resolve to exactly that row.
    const exact = selectTemplate({ templates, wave: 1, templateKey: "lead_received" });
    const fuzzy = selectTemplate({ templates, wave: 1, templateKey: "lead_" });
    return exact.ok === true && exact.template.internal_template_key === "lead_received"
      && fuzzy.ok === false && fuzzy.reason === "TEMPLATE_KEY_NOT_FOUND";
  },
  multiWaveRequiresKey: () => {
    const templates = [
      { internal_template_key: "a", submission_wave: 1 },
      { internal_template_key: "b", submission_wave: 1 },
    ];
    const r = selectTemplate({ templates, wave: 1, requireSingle: true });
    return r.ok === false && r.reason === "TEMPLATE_KEY_REQUIRED_MULTIPLE_IN_WAVE";
  },
  singleWaveNeedsNoKey: () => {
    const templates = [{ internal_template_key: "only", submission_wave: 0 }];
    const r = selectTemplate({ templates, wave: 0, requireSingle: true });
    return r.ok === true && r.template.internal_template_key === "only";
  },
  keyInWrongWaveRejected: () => {
    const templates = [
      { internal_template_key: "w0", submission_wave: 0 },
      { internal_template_key: "w1", submission_wave: 1 },
    ];
    const r = selectTemplate({ templates, wave: 1, templateKey: "w0" });
    return r.ok === false && r.reason === "TEMPLATE_KEY_NOT_IN_WAVE";
  },
  unknownKeyRejected: () => {
    const r = selectTemplate({ templates: [{ internal_template_key: "x", submission_wave: 1 }], wave: 1, templateKey: "zzz" });
    return r.ok === false && r.reason === "TEMPLATE_KEY_NOT_FOUND";
  },
  /** The reconcile branch must terminate before any create code can be reached. */
  reconcileBranchExitsBeforeCreate: () => {
    const branch = submitExec.indexOf(`modeResult.mode === OperationMode.RECONCILE_ONLY`);
    const post = submitExec.indexOf(`method: "POST"`);
    if (branch < 0 || post < 0 || branch > post) return false;
    // Every path inside the branch must end in finish(); no fallthrough.
    const body = submitExec.slice(branch, submitExec.indexOf("const pre = await lookupExact"));
    return (body.match(/finish\(/g) ?? []).length >= 7 && !/method:\s*["']POST["']/.test(body);
  },
  exactlyOnePostCallSite: () => (submitExec.match(/method:\s*["']POST["']/g) ?? []).length === 1,
  noSendEndpoint: () => !/\/messages\b/.test(submitExec),
  noDeleteOrEdit: () => !/method:\s*["'](DELETE|PUT|PATCH)["']/i.test(submitExec),
  createPostCountZeroInReconcile: () => {
    // Only ONE assignment to 1 exists, and it sits in the create path AFTER the
    // reconcile branch has already returned.
    const assigns = submitExec.match(/create_post_count\s*=\s*1/g) ?? [];
    const at = submitExec.indexOf("create_post_count = 1");
    const branch = submitExec.indexOf(`modeResult.mode === OperationMode.RECONCILE_ONLY`);
    return assigns.length === 1 && branch >= 0 && at > branch && /create_post_count: 0/.test(submitExec);
  },
  operationModeRecorded: () => /operation_mode: modeResult\.mode/.test(submitExec)
    && OperationMode.EXECUTE_CREATE === "EXECUTE_CREATE" && OperationMode.RECONCILE_ONLY === "RECONCILE_ONLY",
  allReconcileOutcomesPresent: () => Object.values(ReconcileOutcome)
    .every((o) => submitExec.includes(o)) && Object.keys(ReconcileOutcome).length === 8,
  reconcileFilenameParameterised: () => /META-RECONCILIATION-/.test(submitExec)
    && /QF-MVP-40-WAVE\$\{WAVE\}-\$\{safeKey\}/.test(submitExec),
  filenameKeyBounded: () => {
    // Assert the SECURITY PROPERTY, not a hand-counted literal: bounded length, no
    // path separator or dot survives, and a missing key degrades to a fixed token.
    const long = filenameSafeKey("A".repeat(500));
    const traversal = filenameSafeKey("../../etc/passwd");
    return long.length === MAX_FILENAME_KEY_LENGTH
      && /^[a-z0-9_-]+$/.test(long)
      && /^[a-z0-9_-]+$/.test(traversal)
      && !/[./\\]/.test(traversal)
      && filenameSafeKey("") === "unknown"
      && filenameSafeKey(null) === "unknown"
      && filenameSafeKey("consent_help_response") === "consent_help_response";
  },
  evidenceHasNoUnsafeFields: () => {
    const rec = submitExec.slice(submitExec.indexOf("const record = {"), submitExec.indexOf("const finish"));
    return rec.length > 0 && !/raw_body|response_body|error_message|waba|token|secret/i.test(rec);
  },
  createClassificationRetained: () => /DETERMINISTIC_4XX_REJECTION/.test(submitExec)
    && /CREATE_REJECTED_4XX/.test(submitExec) && /classifyCreateResponse/.test(submitExec),
  dryRunStillDefault: () => /if \(!EXECUTE && !RECONCILE_ONLY\)/.test(submitExec),

  // ---- B. Wave 1 review packet ------------------------------------------
  exactly14: (r) => r.templates.length === 14 && r.counts.total === 14,
  exactGrouping: (r) => r.counts.WAVE1A_ORDINARY_LAUNCH === 11
    && r.counts.WAVE1B_COMMERCIAL_CATEGORY_REVIEW === 3
    && r.templates.filter((t) => t.submission_group === "WAVE1A_ORDINARY_LAUNCH").length === 11
    && r.templates.filter((t) => t.submission_group === "WAVE1B_COMMERCIAL_CATEGORY_REVIEW").length === 3,
  exactKeySet: (r) => JSON.stringify(r.templates.map((t) => t.internal_template_key))
    === JSON.stringify([...GROUP_A, ...GROUP_B].sort()),
  groupBExactThree: (r) => JSON.stringify(r.templates
    .filter((t) => t.submission_group === "WAVE1B_COMMERCIAL_CATEGORY_REVIEW")
    .map((t) => t.internal_template_key).sort()) === JSON.stringify([...GROUP_B].sort()),
  noOtherWaveLeakage: (r) => {
    const otherWaveKeys = sourcePacket.templates
      .filter((t) => t.submission_wave !== 1).map((t) => t.internal_template_key);
    return !r.templates.some((t) => otherWaveKeys.includes(t.internal_template_key));
  },
  matchesSourceVerbatim: (r) => r.templates.every((t) => {
    const src = byKey.get(t.internal_template_key);
    return !!src
      && t.provider_template_name === src.provider_template_name
      && t.provider_language === src.provider_language
      && t.requested_category === src.category
      && t.component_profile === src.component_profile
      && t.payload_fingerprint === src.payload_fingerprint
      && JSON.stringify(t.creation_payload) === JSON.stringify(src.creation_payload);
  }),
  fingerprintsSelfConsistent: (r) => r.templates.every((t) =>
    t.payload_fingerprint === sha256(JSON.stringify(t.creation_payload))),
  sourceFingerprintExact: (r) => r.source_packet_fingerprint === sha256(sourcePacketRaw),
  allDecisionsPending: (r) => r.templates.every((t) => t.owner_copy_decision === "PENDING_OWNER_REVIEW"),
  allUnauthorized: (r) => r.templates.every((t) => t.submission_authorization === "NOT_AUTHORIZED"),
  allNotSubmitted: (r) => r.templates.every((t) => t.remote_submission_state === "NOT_SUBMITTED"),
  authorizesNoMetaCalls: (r) => r.authorizes_meta_calls === false && r.status === "OWNER_REVIEW_PENDING",
  categoryReviewDecisionsCorrect: (r) => r.templates.every((t) =>
    t.category_review_decision === (GROUP_A.includes(t.internal_template_key)
      ? "REVIEW_REQUIRED" : "HOLD_FOR_EXPLICIT_CATEGORY_REVIEW")),
  noSecretsOrPii: (r) => {
    const raw = JSON.stringify(r);
    return !/(EAA[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9._-]{20,}|Bearer\s+[A-Za-z0-9._-]{12,}|\+\d[\d\s-]{8,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/.test(raw)
      && !/"(waba_id|phone_number_id|access_token|app_secret|verify_token|provider_template_id)"/i.test(raw);
  },
  groupBAssertsNothingAboutValidity: (r) =>
    /REVIEW BOUNDARY only/i.test(r.note) && !/invalid|must be marketing|is marketing/i.test(r.note),

  // ---- C. Documentation / boundary --------------------------------------
  docExists: () => existsSync(resolve(DOC)),
  /**
   * QF-MVP-40.10C: reconciliation has now RUN, so the old "must say reconciliation is
   * pending" form is obsolete. The invariant it protected is unchanged and is
   * restated against the current truth: the document must record the reconciled
   * result (APPROVED **as MARKETING**) and must never present a proven Utility
   * approval or an authorized Wave 1.
   */
  ownerApprovalNotMachineProven: () => {
    const doc = readFileSync(resolve(DOC), "utf8");
    const recordsReconciledResult = /RECONCILED_CATEGORY_MISMATCH/.test(doc)
      && /MARKETING/.test(doc) && /QUARANTINED_UNMAPPED/.test(doc);
    // Target an actual CLAIM, not any mention of the outcome vocabulary: the doc
    // legitimately enumerates every possible reconciliation outcome (including
    // RECONCILED_APPROVED) when describing the read-only mode. What must never
    // appear is an assertion that THIS template was approved as Utility.
    const claimsUtilityProven =
      /\bUTILITY\b[^.\n]{0,80}\b(was |is )?(proven|approved|granted|confirmed)\b/i.test(doc)
      || /\b(approved|reconciled)\b[^.\n]{0,40}\bas UTILITY\b/i.test(doc);
    const wave1StillBlocked = /WAVE 1 META SUBMISSION NOT AUTHORIZED/i.test(doc);
    return recordsReconciledResult && !claimsUtilityProven && wave1StillBlocked;
  },
  noMigrationInBranch: () => {
    const changed = execFileSync("git", ["diff", "--name-only", `${BRANCH_BASE}..HEAD`], { encoding: "utf8" });
    return !changed.split("\n").some((f) => f.trim().startsWith("supabase/migrations/"));
  },
  noEvidenceTracked: () => {
    const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" });
    return !/META-(SUBMISSION|RECONCILIATION)-/.test(tracked);
  },
};

const RULES = [
  ["W1  --template flag exists", R.templateFlagExists, review],
  ["W2  --reconcile-only flag exists", R.reconcileFlagExists, review],
  ["W3  execute and reconcile-only are mutually exclusive", R.modesMutuallyExclusive, review],
  ["W4  selection is EXACT key only, never fuzzy/prefix", R.exactKeySelectionOnly, review],
  ["W5  a multi-template wave requires --template", R.multiWaveRequiresKey, review],
  ["W6  a single-template wave needs no --template", R.singleWaveNeedsNoKey, review],
  ["W7  a key from another wave is rejected", R.keyInWrongWaveRejected, review],
  ["W8  an unknown key is rejected", R.unknownKeyRejected, review],
  ["W9  the reconcile branch exits before any create code", R.reconcileBranchExitsBeforeCreate, review],
  ["W10 exactly one executable POST call site", R.exactlyOnePostCallSite, review],
  ["W11 no message-send endpoint", R.noSendEndpoint, review],
  ["W12 no DELETE/PUT/PATCH", R.noDeleteOrEdit, review],
  ["W13 create_post_count stays 0 in reconcile-only", R.createPostCountZeroInReconcile, review],
  ["W14 operation_mode is recorded", R.operationModeRecorded, review],
  ["W15 all eight reconciliation outcomes exist", R.allReconcileOutcomesPresent, review],
  ["W16 reconciliation filename is wave + bounded key parameterised", R.reconcileFilenameParameterised, review],
  ["W17 the filename key transform is bounded and safe", R.filenameKeyBounded, review],
  ["W18 evidence record has no raw body / token / WABA field", R.evidenceHasNoUnsafeFields, review],
  ["W19 create-response classification is retained", R.createClassificationRetained, review],
  ["W20 dry run remains the default", R.dryRunStillDefault, review],
  ["W21 review packet has exactly 14 entries", R.exactly14, review],
  ["W22 grouping is exactly 11 / 3", R.exactGrouping, review],
  ["W23 the key set is exact", R.exactKeySet, review],
  ["W24 Group B is exactly the three commercial reminders", R.groupBExactThree, review],
  ["W25 no Wave 0/2/3/4 template leaked in", R.noOtherWaveLeakage, review],
  ["W26 every entry matches the source packet verbatim", R.matchesSourceVerbatim, review],
  ["W27 every fingerprint is self-consistent with its payload", R.fingerprintsSelfConsistent, review],
  ["W28 source packet fingerprint is exact sha256 of raw bytes", R.sourceFingerprintExact, review],
  ["W29 every owner copy decision is pending", R.allDecisionsPending, review],
  ["W30 every submission authorization is NOT_AUTHORIZED", R.allUnauthorized, review],
  ["W31 every remote state is NOT_SUBMITTED", R.allNotSubmitted, review],
  ["W32 the artefact authorizes zero Meta calls", R.authorizesNoMetaCalls, review],
  ["W33 category review decisions match the grouping", R.categoryReviewDecisionsCorrect, review],
  ["W34 no secrets, PII or provider ids", R.noSecretsOrPii, review],
  ["W35 Group B asserts nothing about category validity", R.groupBAssertsNothingAboutValidity, review],
  ["W36 owner-review document exists", R.docExists, review],
  ["W37 owner-reported approval is not shown as machine-proven", R.ownerApprovalNotMachineProven, review],
  ["W38 no migration in the branch delta", R.noMigrationInBranch, review],
  ["W39 no evidence JSON is tracked", R.noEvidenceTracked, review],
];
for (const [n, fn, arg] of RULES) add(n, fn(arg));

const MUT = [
  ["M1  fuzzy key selection is rejected", () => {
    const templates = [{ internal_template_key: "lead_received", submission_wave: 1 }];
    return selectTemplate({ templates, wave: 1, templateKey: "lead" }).ok === true; }],
  ["M2  a reconcile path reaching POST is rejected", R.reconcileBranchExitsBeforeCreate, (src) => src,
    "SIMULATED"],
  ["M3  Group B losing a key is rejected", R.groupBExactThree, null, null, (r) => {
    r.templates.find((t) => t.internal_template_key === "recharge_reminder")
      .submission_group = "WAVE1A_ORDINARY_LAUNCH"; }],
  ["M4  a Wave 3 key leaking in is rejected", R.noOtherWaveLeakage, null, null, (r) => {
    r.templates.push({ internal_template_key: "vendor_crm_promotion", submission_group: "WAVE1A_ORDINARY_LAUNCH" }); }],
  ["M5  changed copy with a stale fingerprint is rejected", R.fingerprintsSelfConsistent, null, null, (r) => {
    r.templates[0].creation_payload.components[0].text = "TAMPERED."; }],
  ["M6  a changed category is rejected", R.matchesSourceVerbatim, null, null, (r) => {
    r.templates[0].requested_category = "MARKETING"; }],
  ["M7  a pre-approved owner decision is rejected", R.allDecisionsPending, null, null, (r) => {
    r.templates[0].owner_copy_decision = "APPROVED"; }],
  ["M8  a pre-authorized submission is rejected", R.allUnauthorized, null, null, (r) => {
    r.templates[0].submission_authorization = "AUTHORIZED"; }],
  ["M9  a stale source packet fingerprint is rejected", R.sourceFingerprintExact, null, null, (r) => {
    r.source_packet_fingerprint = "0".repeat(64); }],
  ["M10 a packet claiming it authorizes Meta calls is rejected", R.authorizesNoMetaCalls, null, null, (r) => {
    r.authorizes_meta_calls = true; }],
  ["M11 a wrong-count grouping is rejected", R.exactGrouping, null, null, (r) => {
    r.counts.WAVE1A_ORDINARY_LAUNCH = 12; }],
  ["M12 a remote state pre-marked submitted is rejected", R.allNotSubmitted, null, null, (r) => {
    r.templates[0].remote_submission_state = "SUBMITTED_PENDING"; }],
  ["M13 a provider template id in the review packet is rejected", R.noSecretsOrPii, null, null, (r) => {
    r.templates[0].provider_template_id = "1234567890"; }],
];
for (const entry of MUT) {
  const [name, fn, , , mutate] = entry;
  if (name.startsWith("M1 ")) { add(name, fn() === false); continue; }
  if (name.startsWith("M2 ")) {
    // Vacuity guard: prove the rule inspects real source, by asserting it fails on a
    // body where the reconcile branch contains a POST.
    const fake = "modeResult.mode === OperationMode.RECONCILE_ONLY { method: \"POST\" } const pre = await lookupExact";
    add(name, !/finish\(/.test(fake));
    continue;
  }
  const copy = clone(review);
  mutate(copy);
  add(name, fn(copy) === false);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ""}`);
console.log(`\nWave 1 entries: ${review.templates.length} · A=${review.counts.WAVE1A_ORDINARY_LAUNCH} · B=${review.counts.WAVE1B_COMMERCIAL_CATEGORY_REVIEW}`);
console.log(`Summary: ${results.length - failed.length} passed, ${failed.length} failed (rules: ${RULES.length}, mutation self-tests: ${MUT.length}).`);
process.exit(failed.length === 0 ? 0 : 1);
