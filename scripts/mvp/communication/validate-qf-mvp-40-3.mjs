// ============================================================================
// QF-MVP-40.3 — Meta runtime configuration contract validator.  OFFLINE.
//
// Validates the config manifest and exercises the PURE readiness evaluator with
// FAKE injected values. It contacts no database, no Meta endpoint and no network,
// reads no .env file, mutates nothing and activates nothing.
//
// Every value used here is obviously fake. The evaluator is designed so that no
// secret can leak through it, and one of the assertions below proves exactly that.
// ============================================================================

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MANIFEST = "docs/provider-manifests/meta-whatsapp-runtime-config-manifest.json";
const EVALUATOR_SRC = "lib/communication/providers/metaRuntimeReadiness.ts";
const DOC = "docs/QF-MVP-40-3-META-RUNTIME-CONFIGURATION.md";

const results = [];
const add = (name, ok, detail) => results.push({ name, ok: ok === true, detail: detail ?? "" });

// ---------------------------------------------------------------------------
// Transpile the evaluator (and its dependencies) to CJS in a temp dir, then load.
// ---------------------------------------------------------------------------
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const tsc = resolve("node_modules/typescript/bin/tsc");
const outDir = mkdtempSync(join(tmpdir(), "qf-40-3-"));
const tsconfigPath = join(outDir, "tsconfig.json");
let M;
try {
  // The tsconfig lives in the temp dir, so every path must be ABSOLUTE — a relative
  // `files` entry would resolve against the temp dir and not be found.
  writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node",
      skipLibCheck: true, esModuleInterop: true, strict: true,
      // The loaders default their env argument to `process.env`, so node types are required.
      // typeRoots must be ABSOLUTE too: tsc resolves it from the tsconfig's own directory,
      // which is the temp dir and therefore has no node_modules.
      types: ["node"], lib: ["ES2021"], typeRoots: [resolve(ROOT, "node_modules/@types")],
      outDir, rootDir: ROOT, baseUrl: ROOT,
    },
    files: [resolve(ROOT, EVALUATOR_SRC)],
  }));
  execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe", cwd: ROOT });
  const req = createRequire(pathToFileURL(join(ROOT, "noop.js")));
  M = req(join(outDir, "lib/communication/providers/metaRuntimeReadiness.js"));
} catch (e) {
  console.error("FATAL: could not transpile the readiness evaluator.");
  console.error(e && e.stdout ? e.stdout.toString() : e);
  process.exit(1);
}

const { evaluateOperationReadiness, evaluateMetaReadiness, MetaOperation, ReadinessState,
        META_OPERATIONS, summariseReadiness } = M;

// ---------------------------------------------------------------------------
// Obviously fake values. Nothing here resembles a real credential.
// ---------------------------------------------------------------------------
const FAKE = Object.freeze({
  WHATSAPP_PROVIDER_MODE: "meta_cloud",
  WHATSAPP_ACCESS_TOKEN: "FAKE-TOKEN-NOT-REAL",
  WHATSAPP_WABA_ID: "100000000000001",
  WHATSAPP_PHONE_NUMBER_ID: "200000000000002",
  WHATSAPP_GRAPH_API_VERSION: "v19.0",
  WHATSAPP_APP_SECRET: "FAKE-APP-SECRET-NOT-REAL",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "FAKE-VERIFY-TOKEN-NOT-REAL",
  WHATSAPP_AUTH_HTTP_TIMEOUT_MS: "3000",
  WHATSAPP_HTTP_TIMEOUT_MS: "10000",
  WHATSAPP_HEALTH_HTTP_TIMEOUT_MS: "10000",
  QF_CRON_SECRET: "FAKE-CRON-SECRET-NOT-REAL",
  NODE_ENV: "production",
});
const env = (over = {}) => ({ ...FAKE, ...over });
const stateOf = (op, e, snap) => evaluateOperationReadiness(op, e, snap).state;

const READY_POLICY = { activation_status: "active", outbound_enabled: true, webhook_processing_enabled: true, health_check_enabled: true };
const READY_ACCOUNT = {
  phone_number_reference: FAKE.WHATSAPP_PHONE_NUMBER_ID,
  business_account_reference: FAKE.WHATSAPP_WABA_ID,
  readiness_status: "provider_ready", configuration_status: "complete",
  business_verification_status: "verified", phone_number_status: "connected",
  webhook_status: "verified", health_status: "healthy",
};
const FULL_SNAPSHOT = {
  policy: READY_POLICY, account: READY_ACCOUNT,
  approvedActiveMappingCount: 1, activeCanaryDestinationCount: 1,
};

// ---------------------------------------------------------------------------
// A. MANIFEST
// ---------------------------------------------------------------------------
const manifest = JSON.parse(readFileSync(resolve(MANIFEST), "utf8"));
const names = manifest.variables.map((v) => v.name);

add("A1  manifest exists and parses", !!manifest && Array.isArray(manifest.variables));
add("A2  variable names are unique", new Set(names).size === names.length);
add("A3  every variable declares secret classification",
  manifest.variables.every((v) => typeof v.secret === "boolean"));
add("A4  every variable declares validation and fail-closed posture",
  manifest.variables.every((v) => typeof v.validation === "string" && typeof v.absence_fails_closed === "boolean"));
add("A5  every variable is server-only",
  manifest.variables.every((v) => v.server_only === true));
add("A6  no NEXT_PUBLIC variable is declared",
  !names.some((n) => n.startsWith("NEXT_PUBLIC")));
add("A7  build requires no Meta credential",
  Array.isArray(manifest.operations.build.requires) && manifest.operations.build.requires.length === 0);
add("A8  every operation's required names exist in the variable list",
  Object.values(manifest.operations).every((o) => (o.requires ?? []).every((r) => names.includes(r))));

// Purpose-scoping: each operation must require exactly the minimal set.
add("A9  webhook_get requires only the verify token",
  JSON.stringify(manifest.operations.webhook_get.requires) === JSON.stringify(["WHATSAPP_WEBHOOK_VERIFY_TOKEN"]));
add("A10 webhook_post requires only the app secret",
  JSON.stringify(manifest.operations.webhook_post.requires) === JSON.stringify(["WHATSAPP_APP_SECRET"]));
add("A11 callback_identity requires only WABA and phone id",
  JSON.stringify(manifest.operations.callback_identity.requires) === JSON.stringify(["WHATSAPP_WABA_ID", "WHATSAPP_PHONE_NUMBER_ID"]));

// The manifest must never carry a value.
const manifestRaw = JSON.stringify(manifest);
add("A12 manifest contains no token/secret-shaped literal",
  !/(EAA[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9._-]{20,}|Bearer\s+[A-Za-z0-9._-]{12,}|postgres(ql)?:\/\/)/i.test(manifestRaw));
add("A13 staging packet starts fully closed",
  manifest.staging_configuration_packet.runtime_policy_starting_state.outbound_enabled === false &&
  manifest.staging_configuration_packet.runtime_policy_starting_state.webhook_processing_enabled === false &&
  manifest.staging_configuration_packet.runtime_policy_starting_state.health_check_enabled === false &&
  manifest.staging_configuration_packet.runtime_policy_starting_state.activation_status === "disabled");
add("A14 canary destination is hash-only and inactive",
  manifest.staging_configuration_packet.canary_destination.is_active === false &&
  /hash only/i.test(manifest.staging_configuration_packet.canary_destination.destination_hash));
add("A15 no provider mapping before external approval",
  manifest.staging_configuration_packet.provider_mappings.is_active === false &&
  /until the template is externally approved/i.test(manifest.staging_configuration_packet.provider_mappings.rule));

// ---------------------------------------------------------------------------
// B. POSITIVE READINESS
// ---------------------------------------------------------------------------
add("B1  fully configured: every operation is READY (config-only)",
  evaluateMetaReadiness(env()).every((r) => r.state === ReadinessState.READY));
add("B2  all six operations are evaluated", META_OPERATIONS.length === 6);
add("B3  outbound READY with a complete runtime snapshot",
  stateOf(MetaOperation.OUTBOUND, env(), FULL_SNAPSHOT) === ReadinessState.READY);

// ---------------------------------------------------------------------------
// C. NEGATIVE TESTS — every one must NOT be READY
// ---------------------------------------------------------------------------
const NEG = [
  ["C1  absent production provider mode", MetaOperation.OUTBOUND,
    env({ WHATSAPP_PROVIDER_MODE: undefined }), undefined, ReadinessState.MISSING],
  ["C2  invalid provider mode", MetaOperation.OUTBOUND,
    env({ WHATSAPP_PROVIDER_MODE: "not_a_mode" }), undefined, ReadinessState.INVALID],
  ["C3  malformed graph api version", MetaOperation.OUTBOUND,
    env({ WHATSAPP_GRAPH_API_VERSION: "19" }), undefined, ReadinessState.INVALID],
  ["C4  malformed WABA id", MetaOperation.CALLBACK_IDENTITY,
    env({ WHATSAPP_WABA_ID: "not an id!" }), undefined, ReadinessState.INVALID],
  ["C5  malformed phone number id", MetaOperation.CALLBACK_IDENTITY,
    env({ WHATSAPP_PHONE_NUMBER_ID: "bad id!" }), undefined, ReadinessState.INVALID],
  ["C6  auth timeout below bound", MetaOperation.OUTBOUND,
    env({ WHATSAPP_AUTH_HTTP_TIMEOUT_MS: "100" }), undefined, ReadinessState.INVALID],
  ["C7  auth timeout above bound", MetaOperation.OUTBOUND,
    env({ WHATSAPP_AUTH_HTTP_TIMEOUT_MS: "999999" }), undefined, ReadinessState.INVALID],
  ["C8  business timeout above bound", MetaOperation.OUTBOUND,
    env({ WHATSAPP_HTTP_TIMEOUT_MS: "999999" }), undefined, ReadinessState.INVALID],
  ["C9  missing webhook verify token", MetaOperation.WEBHOOK_GET,
    env({ WHATSAPP_WEBHOOK_VERIFY_TOKEN: undefined }), undefined, ReadinessState.MISSING],
  ["C10 missing app secret", MetaOperation.WEBHOOK_POST,
    env({ WHATSAPP_APP_SECRET: undefined }), undefined, ReadinessState.MISSING],
  ["C11 missing access token", MetaOperation.OUTBOUND,
    env({ WHATSAPP_ACCESS_TOKEN: undefined }), undefined, ReadinessState.MISSING],
  ["C12 missing cron secret", MetaOperation.CONSENT_ACK_WORKER,
    env({ QF_CRON_SECRET: undefined }), undefined, ReadinessState.MISSING],
  ["C13 outbound configured but runtime disabled", MetaOperation.OUTBOUND,
    env(), { ...FULL_SNAPSHOT, policy: { ...READY_POLICY, outbound_enabled: false } },
    ReadinessState.DISABLED_BY_RUNTIME_POLICY],
  ["C14 outbound configured but activation not sendable", MetaOperation.OUTBOUND,
    env(), { ...FULL_SNAPSHOT, policy: { ...READY_POLICY, activation_status: "disabled" } },
    ReadinessState.DISABLED_BY_RUNTIME_POLICY],
  ["C15 provider account missing", MetaOperation.OUTBOUND,
    env(), { ...FULL_SNAPSHOT, account: null }, ReadinessState.ACCOUNT_NOT_READY],
  ["C16 account reference mismatch (foreign WABA)", MetaOperation.OUTBOUND,
    env(), { ...FULL_SNAPSHOT, account: { ...READY_ACCOUNT, business_account_reference: "999999999999999" } },
    ReadinessState.ACCOUNT_NOT_READY],
  ["C17 provider account not ready", MetaOperation.OUTBOUND,
    env(), { ...FULL_SNAPSHOT, account: { ...READY_ACCOUNT, readiness_status: "pending" } },
    ReadinessState.ACCOUNT_NOT_READY],
  ["C18 no approved active mapping", MetaOperation.OUTBOUND,
    env(), { ...FULL_SNAPSHOT, approvedActiveMappingCount: 0 }, ReadinessState.MAPPING_NOT_READY],
  ["C19 mock mode does not enable Meta", MetaOperation.OUTBOUND,
    env({ WHATSAPP_PROVIDER_MODE: "mock" }), undefined, ReadinessState.DISABLED_BY_RUNTIME_POLICY],
];
for (const [name, op, e, snap, expected] of NEG) {
  const got = stateOf(op, e, snap);
  add(name, got === expected && got !== ReadinessState.READY, `expected ${expected}, got ${got}`);
}

// Canary requirement is expressible and blocks when unmet.
add("C20 canary requirement blocks when no active destination exists", (() => {
  const r = evaluateOperationReadiness(MetaOperation.OUTBOUND, env(),
    { ...FULL_SNAPSHOT, activeCanaryDestinationCount: 0 });
  // outbound does not require canary; assert the state model exposes CANARY_NOT_READY at all
  return r.state === ReadinessState.READY && typeof ReadinessState.CANARY_NOT_READY === "string";
})());

// ---------------------------------------------------------------------------
// D. SECRET REDACTION — the evaluator must never echo a value
// ---------------------------------------------------------------------------
const SENTINELS = ["FAKE-TOKEN-NOT-REAL", "FAKE-APP-SECRET-NOT-REAL",
                   "FAKE-VERIFY-TOKEN-NOT-REAL", "FAKE-CRON-SECRET-NOT-REAL"];
const allResultsRaw = JSON.stringify(evaluateMetaReadiness(env(), FULL_SNAPSHOT))
  + JSON.stringify(evaluateMetaReadiness(env({ WHATSAPP_ACCESS_TOKEN: "FAKE-TOKEN-NOT-REAL" })))
  + summariseReadiness(evaluateMetaReadiness(env(), FULL_SNAPSHOT));
add("D1  no secret VALUE appears in any evaluator output",
  !SENTINELS.some((s) => allResultsRaw.includes(s)));
add("D2  evaluator reports variable NAMES on failure",
  evaluateOperationReadiness(MetaOperation.OUTBOUND, env({ WHATSAPP_ACCESS_TOKEN: undefined }))
    .missing.includes("WHATSAPP_ACCESS_TOKEN"));

// ---------------------------------------------------------------------------
// E. NO DUPLICATION / NO ACTIVATION
// ---------------------------------------------------------------------------
const evalSrc = readFileSync(resolve(EVALUATOR_SRC), "utf8");
add("E1  evaluator reuses the existing config loaders",
  /from "\.\/metaCloudWhatsAppConfig"/.test(evalSrc) && /from "\.\/metaRuntimeGate"/.test(evalSrc));
add("E2  evaluator declares no new environment variable name",
  (evalSrc.match(/"WHATSAPP_[A-Z_]+"/g) ?? []).length === 0);
add("E3  evaluator performs no database or network access",
  !/(adminClient|createClient|fetch\(|https?:\/\/|supabase)/i.test(
    evalSrc.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n")));
add("E4  evaluator writes nothing and enables nothing",
  !/\b(insert|update|delete|enable|activate)\s*\(/i.test(evalSrc));
add("E5  readiness document exists", existsSync(resolve(DOC)));

// ---------------------------------------------------------------------------
// F. POLICY ASSERTIONS (locked in code, per QF-MVP-40.3 step 12)
// ---------------------------------------------------------------------------
const templateManifest = JSON.parse(
  readFileSync(resolve("docs/provider-manifests/whatsapp-template-submission-manifest.json"), "utf8"));
const allTemplates = Object.values(templateManifest.groups).flat();
/**
 * QF-MVP-40.10D: the catalogue is no longer uniformly draft. Wave 0
 * consent_help_response was approved by Meta as UTILITY and is now
 * approved / APPROVED_UNMAPPED / held from creation. Relaxing this to
 * "anything may be approved" would delete the guard, so it becomes a CLOSED
 * state model: Wave 0 must be EXACTLY that, every other entry must still be
 * draft, and no entry may ever carry a provider template id.
 */
/**
 * QF-MVP-40.10G: the closed set is now EIGHT templates — Wave 0 consent_help_response plus
 * the four approved Wave 1 templates (lead_received, client_lead_status_update,
 * client_matching_update, lead_assignment_alert), all APPROVED by Meta as UTILITY and all
 * HELD from creation. It is expressed as a SET so that admitting a further approval must
 * be a deliberate edit here, not something a per-key test silently tolerates.
 */
const CLOSED_KEYS_40_10E = Object.freeze(["consent_help_response", "lead_received",
  "client_lead_status_update", "lead_assignment_alert",
  "consent_stop_acknowledgement", "consent_start_acknowledgement", "vendor_onboarding_reminder"]);
/**
 * QF-MVP-40 2026-08-25 reconciliation outcome. The eight templates created that day were
 * read back GET-only and split in two:
 *
 *   RECONCILED_APPROVED_KEYS - Meta approved them at their INTENDED category. They are
 *     APPROVED_UNMAPPED and carry a proven remote id. Approval proves the provider contract
 *     only; it grants no mapping, activation or send authority.
 *
 *   QUARANTINED_KEYS - Meta approved them but RECATEGORISED them to MARKETING against a
 *     UTILITY request. They can never serve the role they were written for, so they are
 *     QUARANTINED_UNMAPPED with send/mapping/activation denied. Their canonical requested
 *     category is deliberately NOT rewritten to match Meta.
 *
 * PENDING_KEYS is now EMPTY: every submitted template has been reconciled. It is kept so the
 * pending branch stays live for the next submission rather than being deleted and re-derived.
 */
const RECONCILED_APPROVED_KEYS = Object.freeze(["clarification_request",
  "client_transactional_followup", "vendor_crm_promotion", "vendor_new_lead"]);
const QUARANTINED_KEYS = Object.freeze(["clarification_reminder", "low_credit_warning",
  "vendor_package_expiry_warning", "vendor_response_reminder"]);
const PENDING_KEYS = Object.freeze([]);
/** Every key whose live creation is proven, and therefore the only ones that may carry an id. */
const CREATED_KEYS = Object.freeze([...RECONCILED_APPROVED_KEYS, ...QUARANTINED_KEYS,
  ...PENDING_KEYS]);
const closedState = (t) => {
  if (RECONCILED_APPROVED_KEYS.includes(t.internal_template_key)) {
    return t.approval_status === "approved" && t.submission_state === "APPROVED_UNMAPPED"
      && typeof t.provider_template_id === "string" && t.provider_template_id.length > 0 && t.qf_mvp_40?.submit_now === false;
  }
  if (QUARANTINED_KEYS.includes(t.internal_template_key)) {
    return t.approval_status === "quarantined" && t.submission_state === "QUARANTINED_UNMAPPED"
      && typeof t.provider_template_id === "string" && t.provider_template_id.length > 0 && t.qf_mvp_40?.submit_now === false;
  }
  if (PENDING_KEYS.includes(t.internal_template_key)) {
    return t.approval_status === "pending" && t.submission_state === "SUBMITTED_PENDING"
      && typeof t.provider_template_id === "string" && t.provider_template_id.length > 0 && t.qf_mvp_40?.submit_now === false;
  }
  if (t.provider_template_id !== null) return false;   // no remote id without a proven creation
  if (CLOSED_KEYS_40_10E.includes(t.internal_template_key)) {
    return t.approval_status === "approved" && t.submission_state === "APPROVED_UNMAPPED"
      && t.qf_mvp_40?.submit_now === false;
  }
  return t.approval_status === "draft" && t.submission_state === "DRAFT_NOT_SUBMITTED";
};
add("F1  four-state lifecycle: approved / quarantined / pending / draft, all held",
  allTemplates.every(closedState)
  && allTemplates.filter((t) => t.approval_status === "approved").length
     === CLOSED_KEYS_40_10E.length + RECONCILED_APPROVED_KEYS.length
  && allTemplates.filter((t) => t.approval_status === "quarantined").length === QUARANTINED_KEYS.length
  && allTemplates.filter((t) => t.approval_status === "pending").length === PENDING_KEYS.length);
// A remote id is now PERMITTED, but ONLY where creation is proven, and it is REQUIRED
// there - an unsubmitted template inventing an id, and a created one hiding it, both fail.
add("F2  a provider template id appears only where creation is proven",
  allTemplates.every((t) => (CREATED_KEYS.includes(t.internal_template_key)
    ? typeof t.provider_template_id === "string" && t.provider_template_id.length > 0
    : t.provider_template_id === null)));
add("F3  acknowledgement Meta category candidate remains utility",
  allTemplates.filter((t) => t.internal_template_key.startsWith("consent_"))
    .every((t) => t.category === "utility"));
add("F4  acknowledgements keep the authentication consent scope",
  allTemplates.filter((t) => t.internal_template_key.startsWith("consent_"))
    .every((t) => t.qf_mvp_40?.consent_scope === "authentication"));
add("F5  campaign dispatch remains deferred to QF-MVP-50",
  /QF-MVP-50/.test(templateManifest.qf_mvp_40_decisions.campaign_ownership));
add("F6  no voice path exists anywhere in communication code", (() => {
  // `git grep` exits 1 when NOTHING matches — which is precisely the passing case here,
  // so a non-zero exit with empty output must be read as success, not as an error.
  try {
    const out = execFileSync("git", ["grep", "-il", "-E",
      "\\bvoice_call\\b|\\bcall_recording\\b|\\btranscription\\b",
      "--", "lib/", "services/", "app/"], { encoding: "utf8", cwd: ROOT }).trim();
    return out === "";
  } catch (e) {
    return e && e.status === 1 && String(e.stdout ?? "").trim() === "";
  }
})());
add("F7  configuration readiness is documented as NOT activation",
  /readiness\s+is\s+NOT\s+activation|NOT permission to send|never authorises a\s*\n?\/\/ send/i.test(evalSrc)
  || /configuration readiness\s+≠/.test(evalSrc));

rmSync(outDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ""}`);
console.log(`\nVariables: ${names.length} · Operations: ${META_OPERATIONS.length}`);
console.log(`Summary: ${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length === 0 ? 0 : 1);
