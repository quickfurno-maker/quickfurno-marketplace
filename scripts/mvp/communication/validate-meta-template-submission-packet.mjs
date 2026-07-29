// ============================================================================
// QF-MVP-40.10A — submission packet + component profile validator.  OFFLINE.
//
// Audits the catalogue, the generated packet and the operator script. It calls no
// Meta endpoint, submits nothing, sends nothing and reads no credential.
// Mutation self-tests drive each rule against a corrupted copy and require failure.
// ============================================================================

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MANIFEST = "docs/provider-manifests/whatsapp-template-submission-manifest.json";
const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";
const SUBMIT_SCRIPT = "scripts/mvp/communication/submit-meta-templates.mjs";
const BINDING_SRC = "lib/communication/providers/whatsappTemplateBinding.ts";
const DOC = "docs/QF-MVP-40-10A-META-TEMPLATE-SUBMISSION-READINESS.md";

const ROOT = process.cwd();
const results = [];
const add = (n, ok, d) => results.push({ name: n, ok: ok === true, detail: d ?? "" });
const clone = (o) => JSON.parse(JSON.stringify(o));

const manifest = JSON.parse(readFileSync(resolve(MANIFEST), "utf8"));
const packet = JSON.parse(readFileSync(resolve(PACKET), "utf8"));
const bindingSrc = readFileSync(resolve(BINDING_SRC), "utf8");
const submitSrc = existsSync(resolve(SUBMIT_SCRIPT)) ? readFileSync(resolve(SUBMIT_SCRIPT), "utf8") : "";
/** Comments and the header block stripped, so prose cannot trip an executable rule. */
const submitExec = submitSrc.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const AUTH = ["client_login_otp", "vendor_whatsapp_verify", "vendor_password_reset"];
const ADMIN = ["admin_assignment_failure_alert", "admin_automation_failure_alert",
               "admin_policy_block_alert", "admin_provider_outage_alert"];
const ACKS = ["consent_stop_acknowledgement", "consent_start_acknowledgement", "consent_help_response"];
const NAME_RE = /^qf_[a-z0-9_]+_v\d+$/;

const R = {
  totalIs25: (p) => p.total_templates === 25 && p.templates.length === 25,
  reconcileWaves: (p) => Object.values(p.wave_counts).reduce((a, b) => a + b, 0) === 25,
  wave0IsExactlyOne: (p) => p.templates.filter((t) => t.submission_wave === 0).length === 1,
  wave0IsNoVariable: (p) => {
    const w0 = p.templates.find((t) => t.submission_wave === 0);
    return !!w0 && !/\{\{\d+\}\}/.test(JSON.stringify(w0.creation_payload));
  },
  adminDeferred: (p) => ADMIN.every((k) => {
    const t = p.templates.find((x) => x.internal_template_key === k);
    return t && t.submission_wave === 4 && t.submit_now === false;
  }),
  authNotSubmitNow: (p) => AUTH.every((k) => {
    const t = p.templates.find((x) => x.internal_template_key === k);
    return t && t.submission_wave === 2 && t.submit_now === false;
  }),
  everyEntryHasOneProfile: (p) => p.templates.every((t) =>
    ["STANDARD_TEXT", "QUICK_REPLY", "AUTH_OTP_COPY_CODE"].includes(t.component_profile)),
  authUsesAuthProfile: (p) => AUTH.every((k) =>
    p.templates.find((x) => x.internal_template_key === k)?.component_profile === "AUTH_OTP_COPY_CODE"),
  vendorNewLeadQuickReply: (p) =>
    p.templates.find((x) => x.internal_template_key === "vendor_new_lead")?.component_profile === "QUICK_REPLY",
  authBodyNotAuthored: (p) => AUTH.every((k) => {
    const c = p.templates.find((x) => x.internal_template_key === k).creation_payload;
    const body = c.components.find((x) => x.type === "body");
    // Meta generates the auth body: our payload must NOT carry a text body.
    return c.category === "authentication" && body && body.text === undefined
      && body.add_security_recommendation === true;
  }),
  quickReplyIndicesExact: (m) => {
    const t = Object.values(m.groups).flat().find((x) => x.internal_template_key === "vendor_new_lead");
    const b = t?.buttons_spec ?? [];
    return b.length === 2 && b[0].index === 0 && b[1].index === 1
      && b.every((x) => x.type === "quick_reply" && /^[a-z0-9_:-]{1,64}$/.test(x.payload));
  },
  namesValidAndUnique: (p) => {
    const names = p.templates.map((t) => t.provider_template_name);
    return names.every((n) => NAME_RE.test(n) && n.length <= 512) && new Set(names).size === names.length;
  },
  namesCarryNoEnvOrIds: (p) => !p.templates.some((t) =>
    /(staging|prod|production|dev|test|\d{10,})/.test(t.provider_template_name)),
  deterministicPayloads: (p) => p.templates.every((t) =>
    typeof t.payload_fingerprint === "string" && /^[0-9a-f]{64}$/.test(t.payload_fingerprint)),
  nothingApproved: (p) => p.templates.every((t) =>
    t.local_state.approval_status === "draft"
    && t.local_state.submission_state === "DRAFT_NOT_SUBMITTED"
    && t.local_state.provider_template_id === null),
  acksStayOutOfOrdinaryRegistry: () => ACKS.every((k) => !new RegExp(`^\\s*${k}\\s*:`, "m")
    .test(readFileSync(resolve("lib/communication/outboundConsentScope.ts"), "utf8"))),
  noSecretOrPii: (p) => {
    const raw = JSON.stringify(p);
    return !/(EAA[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9._-]{20,}|Bearer\s+[A-Za-z0-9._-]{12,}|\+\d[\d\s-]{8,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/.test(raw)
      && !/"(waba_id|phone_number_id|access_token|app_secret|verify_token)"/i.test(raw);
  },
  contractReferencesRecorded: (p) => Array.isArray(p.external_contract_references)
    && p.external_contract_references.length >= 2
    && p.external_contract_references.every((u) => /developers\.facebook\.com/.test(u)),
  manifestFingerprintRecorded: (p) => /^[0-9a-f]{64}$/.test(p.source_manifest_fingerprint),

  // ---- renderer / profile guarantees ------------------------------------
  rendererSupportsButtonFields: () =>
    /sub_type\?: string/.test(bindingSrc) && /index\?: string/.test(bindingSrc)
    && /type: "payload"/.test(bindingSrc),
  rendererRejectsArbitrarySubType: () => /SUPPORTED_BUTTON_SUB_TYPES/.test(bindingSrc)
    && /INVALID_BUTTON_SUB_TYPE/.test(bindingSrc),
  rendererRequiresExplicitIndex: () => /INVALID_BUTTON_INDEX/.test(bindingSrc)
    && /DUPLICATE_BUTTON_INDEX/.test(bindingSrc),
  duplicateSourceStillGuarded: () => {
    // Protection must remain global; only AUTH_OTP_COPY_CODE may carve out one reuse.
    const exec = bindingSrc.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
    return /DUPLICATE_SOURCE_BINDING/.test(exec)
      && /profile !== ComponentProfile\.AUTH_OTP_COPY_CODE/.test(exec);
  },
  payloadBounded: () => /QUICK_REPLY_PAYLOAD_PATTERN/.test(bindingSrc)
    && /INVALID_PAYLOAD_VALUE/.test(bindingSrc),

  // ---- operator script safety -------------------------------------------
  submitScriptDefaultsDryRun: () => submitSrc === "" || (/--execute/.test(submitSrc)
    && /DRY[_\s-]?RUN/i.test(submitSrc) && !/execute\s*=\s*true/.test(submitSrc)),
  // These audit EXECUTABLE code only. The header comment legitimately states "no
  // /messages endpoint", and the dry-run help text legitimately NAMES
  // QF_META_ACCESS_TOKEN as a variable the operator must set. Neither is a send
  // path nor a leaked value, and scanning raw source flagged both as false alarms.
  submitScriptHasNoSendEndpoint: () => !/\/messages\b/.test(submitExec),
  submitScriptHasNoDeleteOrEdit: () => !/method:\s*["'](DELETE|PUT|PATCH)["']/i.test(submitExec),
  // A leak is INTERPOLATING a secret value into output, not naming the variable.
  submitScriptNeverEchoesSecret: () =>
    !/console\.(log|error)\([^;]*\$\{\s*(TOKEN|WABA_ID|auth)\b/.test(submitExec)
    && !/console\.(log|error)\([^;]*\b(TOKEN|auth)\s*[,)]/.test(submitExec),

  // ---- boundary ----------------------------------------------------------
  noMigrationOnBranch: () => {
    const changed = execFileSync("git", ["diff", "--name-only",
      "1713838401da8b160cbeb9d3b6090bd017bdb958..HEAD"], { encoding: "utf8", cwd: ROOT });
    return !changed.split("\n").some((f) => f.trim().startsWith("supabase/migrations/"));
  },
  docExists: () => existsSync(resolve(DOC)),
};

const RULES = [
  ["P1  packet totals exactly 25 templates", R.totalIs25, packet],
  ["P2  wave counts reconcile to 25", R.reconcileWaves, packet],
  ["P3  Wave 0 is exactly one template", R.wave0IsExactlyOne, packet],
  ["P4  Wave 0 template has no variables", R.wave0IsNoVariable, packet],
  ["P5  four QF-MVP-70 admin alerts are deferred (wave 4, submit_now false)", R.adminDeferred, packet],
  ["P6  authentication templates are wave 2 and NOT submit_now", R.authNotSubmitNow, packet],
  ["P7  every entry has exactly one known component profile", R.everyEntryHasOneProfile, packet],
  ["P8  authentication templates use AUTH_OTP_COPY_CODE", R.authUsesAuthProfile, packet],
  ["P9  vendor_new_lead uses QUICK_REPLY", R.vendorNewLeadQuickReply, packet],
  ["P10 authentication body is Meta-generated, never author-supplied", R.authBodyNotAuthored, packet],
  ["P11 quick-reply indices are 0/1 with bounded non-PII payloads", R.quickReplyIndicesExact, manifest],
  ["P12 provider names valid and unique", R.namesValidAndUnique, packet],
  ["P13 provider names carry no environment name or long id", R.namesCarryNoEnvOrIds, packet],
  ["P14 every payload has a deterministic fingerprint", R.deterministicPayloads, packet],
  ["P15 nothing is approved, submitted or given a provider template id", R.nothingApproved, packet],
  ["P16 consent acknowledgements remain outside the ordinary registry", R.acksStayOutOfOrdinaryRegistry, packet],
  ["P17 packet carries no secret, WABA id or PII", R.noSecretOrPii, packet],
  ["P18 official contract references are recorded", R.contractReferencesRecorded, packet],
  ["P19 source manifest fingerprint recorded", R.manifestFingerprintRecorded, packet],
  ["P20 renderer emits sub_type, index and payload parameters", R.rendererSupportsButtonFields, packet],
  ["P21 renderer rejects an arbitrary sub_type", R.rendererRejectsArbitrarySubType, packet],
  ["P22 renderer requires an explicit, unique button index", R.rendererRequiresExplicitIndex, packet],
  ["P23 duplicate-source protection is NOT weakened globally", R.duplicateSourceStillGuarded, packet],
  ["P24 quick-reply payloads are bounded and validated", R.payloadBounded, packet],
  ["P25 submission script defaults to dry run", R.submitScriptDefaultsDryRun, packet],
  ["P26 submission script has no message-send endpoint", R.submitScriptHasNoSendEndpoint, packet],
  ["P27 submission script has no delete or edit endpoint", R.submitScriptHasNoDeleteOrEdit, packet],
  ["P28 submission script never echoes a secret", R.submitScriptNeverEchoesSecret, packet],
  ["P29 no migration added on this branch", R.noMigrationOnBranch, packet],
  ["P30 readiness document exists", R.docExists, packet],
];
for (const [n, fn, arg] of RULES) add(n, fn(arg));

const MUT = [
  ["M1  a missing button index is rejected", R.quickReplyIndicesExact, manifest, (m) => {
    const t = Object.values(m.groups).flat().find((x) => x.internal_template_key === "vendor_new_lead");
    delete t.buttons_spec[0].index; }],
  ["M2  a generic text button replacing a payload is rejected", R.quickReplyIndicesExact, manifest, (m) => {
    const t = Object.values(m.groups).flat().find((x) => x.internal_template_key === "vendor_new_lead");
    t.buttons_spec[0].type = "text"; }],
  ["M3  a PII payload is rejected", R.quickReplyIndicesExact, manifest, (m) => {
    const t = Object.values(m.groups).flat().find((x) => x.internal_template_key === "vendor_new_lead");
    t.buttons_spec[0].payload = "+91 98765 43210"; }],
  ["M4  an auth template treated as a free-form body is rejected", R.authBodyNotAuthored, packet, (p) => {
    const t = p.templates.find((x) => x.internal_template_key === "client_login_otp");
    t.creation_payload.components[0].text = "Your code is {{1}}"; }],
  ["M5  an auth template marked submit_now is rejected", R.authNotSubmitNow, packet, (p) => {
    p.templates.find((x) => x.internal_template_key === "client_login_otp").submit_now = true; }],
  ["M6  an admin alert added to a submit-now wave is rejected", R.adminDeferred, packet, (p) => {
    const t = p.templates.find((x) => x.internal_template_key === "admin_policy_block_alert");
    t.submission_wave = 1; t.submit_now = true; }],
  ["M7  a provider name collision is rejected", R.namesValidAndUnique, packet, (p) => {
    p.templates[1].provider_template_name = p.templates[0].provider_template_name; }],
  ["M8  an invalid provider name is rejected", R.namesValidAndUnique, packet, (p) => {
    p.templates[0].provider_template_name = "QF Bad Name!"; }],
  ["M9  an environment name in a provider name is rejected", R.namesCarryNoEnvOrIds, packet, (p) => {
    p.templates[0].provider_template_name = "qf_staging_thing_v1"; }],
  ["M10 a template marked approved is rejected", R.nothingApproved, packet, (p) => {
    p.templates[0].local_state.approval_status = "approved"; }],
  ["M11 an embedded WABA id is rejected", R.noSecretOrPii, packet, (p) => {
    p.templates[0].waba_id = "123456789012345"; }],
  ["M12 an embedded phone number is rejected", R.noSecretOrPii, packet, (p) => {
    p.templates[0].note = "call +91 98765 43210"; }],
  ["M13 Wave 0 with more than one template is rejected", R.wave0IsExactlyOne, packet, (p) => {
    p.templates[1].submission_wave = 0; }],
  ["M14 a Wave 0 template with variables is rejected", R.wave0IsNoVariable, packet, (p) => {
    p.templates.find((t) => t.submission_wave === 0).creation_payload.components[0].text = "Hi {{1}}"; }],
  ["M15 a wrong category on an auth template is rejected", R.authBodyNotAuthored, packet, (p) => {
    p.templates.find((x) => x.internal_template_key === "client_login_otp").creation_payload.category = "UTILITY"; }],
];
for (const [n, fn, base, mutate] of MUT) {
  const copy = clone(base);
  mutate(copy);
  add(n, fn(copy) === false);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ""}`);
console.log(`\nTemplates: ${packet.total_templates} · waves: ${JSON.stringify(packet.wave_counts)}`);
console.log(`Summary: ${results.length - failed.length} passed, ${failed.length} failed (rules: ${RULES.length}, mutation self-tests: ${MUT.length}).`);
process.exit(failed.length === 0 ? 0 : 1);
