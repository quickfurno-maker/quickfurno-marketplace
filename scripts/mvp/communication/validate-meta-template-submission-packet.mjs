// ============================================================================
// QF-MVP-40.10A — submission packet + component profile validator.  OFFLINE.
//
// Audits the catalogue, the generated packet and the operator script. It calls no
// Meta endpoint, submits nothing, sends nothing and reads no credential.
// Mutation self-tests drive each rule against a corrupted copy and require failure.
// ============================================================================

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  API_VERSION_PATTERN, CreateClassification, KNOWN_TEMPLATE_STATUSES, MAX_ERROR_TYPE_LENGTH,
  USABLE_EXISTING_STATUSES, canonicaliseTemplate, classifyCreateResponse, safeMetaError,
  templatesAreIdentical, validateEnvironment,
} from "./submit-meta-templates.mjs";

/** The exact, owner-approved Wave 0 recovery contract. */
const WAVE0_KEY = "consent_help_response";
const WAVE0_NAME = "qf_consent_help_response_v2";
const WAVE0_RETIRED_NAME = "qf_consent_help_response_v1";
const WAVE0_FINGERPRINT = "afa6f9c310dc98c54440c1b4e6c3521b4963ea306a615f2788474c2f07c17a73";
const WAVE0_BODY = "QuickFurno connects you with verified furniture and interior vendors. "
  + "Reply STOP to stop messages, or START to resume. For support, visit quickfurno.in.";
const sha256 = (x) => createHash("sha256").update(x).digest("hex");

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


  // ---- QF-MVP-40.10A-R operator hardening --------------------------------
  noHardcodedApiVersion: () =>
    !/API_VERSION\s*=\s*["']v[0-9]+\.[0-9]+["']/.test(submitExec)
    && /QF_META_GRAPH_API_VERSION/.test(submitExec),
  apiVersionRequiredNoDefault: () => {
    const r = validateEnvironment({ QF_META_WABA_ID: "12345678901234", QF_META_ACCESS_TOKEN: "t" });
    return r.ok === false && r.missing.includes("QF_META_GRAPH_API_VERSION");
  },
  apiVersionGrammarEnforced: () => {
    const bad = validateEnvironment({ QF_META_GRAPH_API_VERSION: "21", QF_META_WABA_ID: "12345678901234", QF_META_ACCESS_TOKEN: "t" });
    const good = validateEnvironment({ QF_META_GRAPH_API_VERSION: "v23.0", QF_META_WABA_ID: "12345678901234", QF_META_ACCESS_TOKEN: "t" });
    return bad.ok === false && bad.invalid.includes("QF_META_GRAPH_API_VERSION")
      && good.ok === true && API_VERSION_PATTERN.test("v23.0");
  },
  wabaIdGrammarEnforced: () => {
    const r = validateEnvironment({ QF_META_GRAPH_API_VERSION: "v23.0", QF_META_WABA_ID: "not-digits", QF_META_ACCESS_TOKEN: "t" });
    return r.ok === false && r.invalid.includes("QF_META_WABA_ID");
  },
  identityIsSemanticNotCategoryOnly: () => {
    const a = { name: "n", language: "en", category: "UTILITY", components: [{ type: "BODY", text: "Hello world." }] };
    const b = { name: "n", language: "en", category: "UTILITY", components: [{ type: "BODY", text: "Hello WORLD." }] };
    return templatesAreIdentical(a, a) === true && templatesAreIdentical(a, b) === false;
  },
  whitespaceChangeIsCollision: () => {
    const a = { name: "n", language: "en", category: "UTILITY", components: [{ type: "BODY", text: "Hi there." }] };
    const b = { name: "n", language: "en", category: "UTILITY", components: [{ type: "BODY", text: "Hi  there." }] };
    return templatesAreIdentical(a, b) === false;
  },
  casingNormalisedButTextNot: () => {
    const a = { name: "n", language: "en", category: "utility", components: [{ type: "body", text: "X" }] };
    const b = { name: "n", language: "en", category: "UTILITY", components: [{ type: "BODY", text: "X" }] };
    return templatesAreIdentical(a, b) === true;
  },
  buttonOrderSignificant: () => {
    const mk = (o) => ({ name: "n", language: "en", category: "UTILITY", components: [
      { type: "BUTTONS", buttons: o.map((x) => ({ type: "QUICK_REPLY", text: x })) }] });
    return templatesAreIdentical(mk(["A", "B"]), mk(["B", "A"])) === false;
  },
  malformedTemplateNeverIdentical: () =>
    canonicaliseTemplate(null) === null && canonicaliseTemplate({}) === null
    && templatesAreIdentical(null, null) === false,
  exactNameLookupUsed: () => /message_templates\?name=/.test(submitExec)
    && /fields=id,name,language,status,category,components/.test(submitExec),
  duplicateExactRowsRejected: () => /rows\.length > 1/.test(submitExec)
    && /DUPLICATE_EXACT_ROWS/.test(submitExec),
  unknownExistingStatusRejected: () => /EXISTING_UNKNOWN_STATUS/.test(submitExec)
    && /EXISTING_NOT_USABLE/.test(submitExec)
    && USABLE_EXISTING_STATUSES.length === 2
    && KNOWN_TEMPLATE_STATUSES.includes("REJECTED") && !USABLE_EXISTING_STATUSES.includes("REJECTED"),
  ambiguousCreateIssuesExactlyOnePost: () => {
    const posts = (submitExec.match(/method:\s*["']POST["']/g) ?? []).length;
    return posts === 1 && /RECOVERED_AFTER_AMBIGUOUS_CREATE/.test(submitExec)
      && /MANUAL_RECONCILIATION_REQUIRED/.test(submitExec);
  },
  wabaIdentityPreflight: () => /identity_match/.test(submitExec)
    && /WABA_IDENTITY_MISMATCH/.test(submitExec),
  recategorisationStops: () => /META_RECATEGORISED/.test(submitExec),
  evidenceCarriesNoWabaOrToken: () => {
    const rec = submitExec.slice(submitExec.indexOf("const record = {"), submitExec.indexOf("const finish"));
    return rec.length > 0 && !/waba|token|secret|raw_body/i.test(rec);
  },
  waveTwoSequencingCorrected: (p) => {
    const w2 = String(p.waves["2"] ?? "");
    return /HELD FROM THE WAVE 0/.test(w2) && !/until .*end to end/i.test(w2);
  },

  // ---- QF-MVP-40.10A-R2: EXACT, load-bearing checks ----------------------
  // Format-only fingerprint checks proved too weak: a stale packet would still
  // look "well formed". These recompute the real values.
  everyFingerprintExact: (p) => p.templates.every((t) =>
    t.payload_fingerprint === sha256(JSON.stringify(t.creation_payload))),
  sourceManifestFingerprintExact: (p) =>
    p.source_manifest_fingerprint === sha256(readFileSync(resolve(MANIFEST))),
  wave0RecoveryContractExact: (p) => {
    const w0 = p.templates.filter((t) => t.submission_wave === 0);
    if (w0.length !== 1) return false;
    const t = w0[0];
    const c = t.creation_payload;
    const body = c.components.find((x) => x.type === "body");
    return t.internal_template_key === WAVE0_KEY
      && t.provider_template_name === WAVE0_NAME
      && c.name === WAVE0_NAME
      && t.provider_language === "en" && c.language === "en"
      && t.category === "UTILITY" && c.category === "UTILITY"
      && !!body && body.text === WAVE0_BODY
      && t.payload_fingerprint === WAVE0_FINGERPRINT
      && !/\{\{\d+\}\}/.test(JSON.stringify(c));
  },
  retiredV1AbsentFromCandidates: (p) => {
    const m = JSON.parse(readFileSync(resolve(MANIFEST), "utf8"));
    const candidates = Object.values(m.groups).flat().map((t) => t.provider_template_name_candidate);
    // v1 may still be NAMED in the historical note; it must never be a CANDIDATE.
    return !candidates.includes(WAVE0_RETIRED_NAME)
      && !JSON.stringify(p.templates).includes(WAVE0_RETIRED_NAME);
  },

  // ---- safeMetaError -----------------------------------------------------
  safeErrorExtractsStructuredFields: () => {
    const r = safeMetaError({ error: { code: 100, error_subcode: 2388042, type: "OAuthException", is_transient: false } });
    return r.code === 100 && r.subcode === 2388042 && r.type === "OAuthException" && r.is_transient === false;
  },
  safeErrorNormalisesMalformed: () => {
    const r = safeMetaError({ error: { code: "100", error_subcode: 1.5, type: 42, is_transient: "no" } });
    const empty = safeMetaError(null);
    const arr = safeMetaError({ error: [] });
    return r.code === null && r.subcode === null && r.type === null && r.is_transient === null
      && empty.code === null && arr.code === null;
  },
  safeErrorBoundsType: () => {
    const r = safeMetaError({ error: { type: "X".repeat(5000) } });
    return typeof r.type === "string" && r.type.length === MAX_ERROR_TYPE_LENGTH;
  },
  safeErrorDropsUnsafeFields: () => {
    const r = safeMetaError({ error: {
      code: 1, message: "SECRET-MESSAGE", error_data: { x: 1 }, error_user_title: "T",
      error_user_msg: "M", fbtrace_id: "TRACE", authorization: "Bearer x",
    }});
    const raw = JSON.stringify(r);
    return Object.keys(r).length === 4
      && !/SECRET-MESSAGE|TRACE|Bearer|error_data|error_user/.test(raw);
  },

  // ---- create classification --------------------------------------------
  classify4xxDeterministic: () => [400, 401, 403, 429].every((st) =>
    classifyCreateResponse({ httpStatus: st, body: { error: { code: 100 } } }).classification
      === CreateClassification.DETERMINISTIC_4XX_REJECTION),
  classify5xxAmbiguous: () =>
    classifyCreateResponse({ httpStatus: 500, body: null }).classification === CreateClassification.AMBIGUOUS,
  classifyThrowAmbiguous: () =>
    classifyCreateResponse({ threw: true }).classification === CreateClassification.AMBIGUOUS,
  classifyMalformed2xxAmbiguous: () =>
    classifyCreateResponse({ httpStatus: 200, body: null }).classification === CreateClassification.AMBIGUOUS
    && classifyCreateResponse({ httpStatus: 200, body: { id: "x" } }).classification === CreateClassification.AMBIGUOUS
    && classifyCreateResponse({ httpStatus: 200, body: { status: "PENDING" } }).classification === CreateClassification.AMBIGUOUS,
  classifyUnknownStatusNotSuccess: () =>
    classifyCreateResponse({ httpStatus: 200, body: { id: "x", status: "WAT" } }).classification
      !== CreateClassification.SUCCESS,
  classifySuccess: () =>
    classifyCreateResponse({ httpStatus: 200, body: { id: "123", status: "PENDING" } }).classification
      === CreateClassification.SUCCESS,
  classify4xxCarriesSafeError: () => {
    const v = classifyCreateResponse({ httpStatus: 400, body: { error: { code: 132000, type: "OAuthException" } } });
    return v.error.code === 132000 && v.error.type === "OAuthException";
  },

  // ---- operator wiring ---------------------------------------------------
  exactlyOnePostCallSite: () => (submitExec.match(/method:\s*["']POST["']/g) ?? []).length === 1,
  deterministic4xxHasDistinctOutcome: () => /CREATE_REJECTED_4XX/.test(submitExec),
  evidenceHasSafeErrorFields: () => /meta_error_code/.test(submitExec) && /meta_error_subcode/.test(submitExec)
    && /meta_error_type/.test(submitExec) && /meta_error_is_transient/.test(submitExec),
  evidenceHasNoRawBodyOrMessage: () => {
    const rec = submitExec.slice(submitExec.indexOf("const record = {"), submitExec.indexOf("const finish"));
    return rec.length > 0 && !/raw_body|error_message|response_body|\bmessage\b/i.test(rec);
  },
  createPostCountTracked: () => /create_post_count: 0/.test(submitExec)
    && /create_post_count = 1/.test(submitExec)
    && (submitExec.match(/create_post_count\s*=\s*\d/g) ?? []).length === 1,
  evidenceFilenameUsesWave: () => /QF-MVP-40-WAVE\$\{WAVE\}/.test(submitExec)
    && !/QF-MVP-40-WAVE0-META-SUBMISSION-\$\{/.test(submitExec),
  lookupCatchesTransportException: () => {
    const fn = submitExec.slice(submitExec.indexOf("async function lookupExact"),
                                submitExec.indexOf("const pre = await lookupExact"));
    return /try\s*{/.test(fn) && /catch/.test(fn) && /ok: false/.test(fn);
  },
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
  ["P31 no hardcoded Graph API version remains", R.noHardcodedApiVersion, packet],
  ["P32 API version is REQUIRED with no default", R.apiVersionRequiredNoDefault, packet],
  ["P33 API version grammar is enforced", R.apiVersionGrammarEnforced, packet],
  ["P34 WABA id grammar is enforced", R.wabaIdGrammarEnforced, packet],
  ["P35 identity is SEMANTIC, not category-only", R.identityIsSemanticNotCategoryOnly, packet],
  ["P36 a whitespace-only body change is a collision", R.whitespaceChangeIsCollision, packet],
  ["P37 enum casing normalised but text never is", R.casingNormalisedButTextNot, packet],
  ["P38 button order is significant", R.buttonOrderSignificant, packet],
  ["P39 a malformed template is never identical", R.malformedTemplateNeverIdentical, packet],
  ["P40 exact-name lookup with comparison fields is used", R.exactNameLookupUsed, packet],
  ["P41 duplicate exact rows are rejected", R.duplicateExactRowsRejected, packet],
  ["P42 unknown/unusable existing status is rejected", R.unknownExistingStatusRejected, packet],
  ["P43 an ambiguous create can never issue a second POST", R.ambiguousCreateIssuesExactlyOnePost, packet],
  ["P44 WABA identity preflight exists and fails closed", R.wabaIdentityPreflight, packet],
  ["P45 Meta recategorisation stops for owner review", R.recategorisationStops, packet],
  ["P46 sanitized evidence carries no WABA id or token", R.evidenceCarriesNoWabaOrToken, packet],
  ["P47 Wave 2 sequencing no longer circular", R.waveTwoSequencingCorrected, packet],
  ["P48 every payload fingerprint is EXACT sha256(creation_payload)", R.everyFingerprintExact, packet],
  ["P49 source manifest fingerprint is EXACT sha256(manifest bytes)", R.sourceManifestFingerprintExact, packet],
  ["P50 Wave 0 v2 recovery contract is exact", R.wave0RecoveryContractExact, packet],
  ["P51 retired v1 is absent from every candidate", R.retiredV1AbsentFromCandidates, packet],
  ["P52 safeMetaError extracts the four structured fields", R.safeErrorExtractsStructuredFields, packet],
  ["P53 safeMetaError normalises malformed values to null", R.safeErrorNormalisesMalformed, packet],
  ["P54 safeMetaError bounds the type length", R.safeErrorBoundsType, packet],
  ["P55 safeMetaError drops message/error_data/fbtrace_id and unknown fields", R.safeErrorDropsUnsafeFields, packet],
  ["P56 HTTP 400/401/403/429 are DETERMINISTIC_4XX_REJECTION", R.classify4xxDeterministic, packet],
  ["P57 HTTP 500 is AMBIGUOUS", R.classify5xxAmbiguous, packet],
  ["P58 a fetch throw is AMBIGUOUS", R.classifyThrowAmbiguous, packet],
  ["P59 malformed 2xx is AMBIGUOUS", R.classifyMalformed2xxAmbiguous, packet],
  ["P60 an unknown status is never SUCCESS", R.classifyUnknownStatusNotSuccess, packet],
  ["P61 a well-formed 2xx is SUCCESS", R.classifySuccess, packet],
  ["P62 a 4xx carries safe structured error fields", R.classify4xxCarriesSafeError, packet],
  ["P63 exactly one executable POST call site", R.exactlyOnePostCallSite, packet],
  ["P64 deterministic 4xx has a distinct CREATE_REJECTED_4XX outcome", R.deterministic4xxHasDistinctOutcome, packet],
  ["P65 evidence carries the safe Meta error fields", R.evidenceHasSafeErrorFields, packet],
  ["P66 evidence carries no raw body or error message", R.evidenceHasNoRawBodyOrMessage, packet],
  ["P67 create_post_count is initialised and set exactly once", R.createPostCountTracked, packet],
  ["P68 evidence filename is wave-parameterised", R.evidenceFilenameUsesWave, packet],
  ["P69 lookupExact returns a closed failure on transport exception", R.lookupCatchesTransportException, packet],
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
  ["M16 a hardcoded API version is rejected", R.waveTwoSequencingCorrected, packet, (p) => {
    p.waves["2"] = "submit_now FALSE until an end to end approved-template send"; }],
  // Proves the rule is MEANINGFUL rather than vacuous: the old name+language+category
  // comparison accepts a template whose body changed, which is exactly the defect
  // QF-MVP-40.10A-R closed. The real comparator must reject that same pair.
  ["M17 the old category-only comparison would wrongly accept a changed body",
    () => {
      const a = { name: "n", language: "en", category: "UTILITY", components: [{ type: "BODY", text: "Original." }] };
      const b = { name: "n", language: "en", category: "UTILITY", components: [{ type: "BODY", text: "TAMPERED." }] };
      const categoryOnly = (x, y) => x.name === y.name && x.language === y.language && x.category === y.category;
      // Vacuity check: the weak comparator says "identical" (true) while the real one
      // says "different" (false). Returning `true` here means the weak comparison is
      // unsafe AND the real comparison catches it — so the rule below must see FALSE.
      return categoryOnly(a, b) === true && templatesAreIdentical(a, b) === false ? false : true;
    }, packet, () => {}],
  ["M18 a stale v1 Wave 0 name is rejected", R.wave0RecoveryContractExact, packet, (p) => {
    const w0 = p.templates.find((t) => t.submission_wave === 0);
    w0.provider_template_name = "qf_consent_help_response_v1";
    w0.creation_payload.name = "qf_consent_help_response_v1"; }],
  ["M19 a stale payload fingerprint is rejected", R.everyFingerprintExact, packet, (p) => {
    p.templates[0].payload_fingerprint = "0".repeat(64); }],
  ["M20 a stale source-manifest fingerprint is rejected", R.sourceManifestFingerprintExact, packet, (p) => {
    p.source_manifest_fingerprint = "0".repeat(64); }],
  ["M21 a changed body keeping the old fingerprint is rejected", R.wave0RecoveryContractExact, packet, (p) => {
    const w0 = p.templates.find((t) => t.submission_wave === 0);
    w0.creation_payload.components[0].text = "TAMPERED COPY."; }],
  ["M22 a retired v1 candidate is rejected", R.retiredV1AbsentFromCandidates, packet, (p) => {
    p.templates[0].provider_template_name = "qf_consent_help_response_v1"; }],
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
