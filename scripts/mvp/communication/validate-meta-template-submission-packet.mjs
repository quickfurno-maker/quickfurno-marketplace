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
  USABLE_EXISTING_STATUSES, canonicaliseTemplate, classifyCreateResponse, modeLabel,
  safeMetaError, templatesAreIdentical, validateEnvironment,
} from "./submit-meta-templates.mjs";

/**
 * The exact Wave 0 contract. QF-MVP-40.10C: v2 was APPROVED BY META AS MARKETING
 * rather than the requested UTILITY, so it is quarantined and v3 is the strict
 * Utility candidate. Both earlier names are retired and must never reappear as a
 * CURRENT candidate — a historical note or the remote-state ledger may name them.
 */
const WAVE0_KEY = "consent_help_response";
const WAVE0_NAME = "qf_consent_help_response_v3";
const WAVE0_RETIRED_NAMES = ["qf_consent_help_response_v1", "qf_consent_help_response_v2"];
const WAVE0_FINGERPRINT = "12f98c8b9504194ef9d983a606c9edd1c083dab1ba187915bdbea85fbc3e6c87";
const WAVE0_BODY = "QuickFurno received your HELP request. Reply STOP to stop messages or "
  + "START to resume. Continue this chat for support.";
const REMOTE_STATE = "docs/provider-manifests/meta-template-remote-state.json";
/**
 * QF-MVP-40.10E: the closed set is now TWO templates, expressed as a SET so that adding a
 * third approval has to be a deliberate edit here rather than something a per-key test
 * silently tolerates.
 */
const CLOSED_KEYS = ["consent_help_response", "lead_received"];
const WAVE1_CANARY_KEY = "lead_received";
const WAVE1_CANARY_NAME = "qf_lead_received_v1";
const V1C_SUBMISSION_EVIDENCE = "QF-MVP-40-WAVE1-META-SUBMISSION-2026-07-30T18-46-18-281Z.json";
const V1C_RECONCILIATION_EVIDENCE =
  "QF-MVP-40-WAVE1-lead_received-META-RECONCILIATION-2026-07-31T02-01-53-804Z.json";
const NEXT_SUBSET = "docs/provider-manifests/meta-wave1-next-utility-subset-review.json";
/** Exact keys in the exact reviewed order — order is part of the contract. */
const NEXT_SUBSET_KEYS = ["client_lead_status_update", "client_matching_update", "lead_assignment_alert"];
const NEXT_SUBSET_NAMES = ["qf_client_lead_status_update_v1", "qf_client_matching_update_v1",
  "qf_lead_assignment_alert_v1"];
const NEXT_SUBSET_FINGERPRINTS = [
  "ce8982c652515e2434abb2159a4024a199de54cede0bd1f95552eb8d6270e7ac",
  "c0930db5a9beee61de0076caf234b36f950554bc21c60b697845028a8d057e1c",
  "3f7997be7b8e1b019ba306a058b96f2d68aa84b7a014ea96407510030bb02453",
];
/** A "next" candidate may never be a commercial-review or already-closed template. */
const COMMERCIAL_KEYS = ["low_credit_warning", "recharge_reminder", "vendor_package_expiry_warning"];
const V3_SUBMISSION_EVIDENCE = "QF-MVP-40-WAVE0-META-SUBMISSION-2026-07-30T17-24-12-392Z.json";
const V3_RECONCILIATION_EVIDENCE =
  "QF-MVP-40-WAVE0-consent_help_response-META-RECONCILIATION-2026-07-30T17-48-51-026Z.json";
const sha256 = (x) => createHash("sha256").update(x).digest("hex");
/**
 * Rules that read a sibling artefact from disk cannot be mutation-tested by cloning the
 * packet. Each takes an optional injected object and accepts it ONLY when its artifact
 * field matches, so a mutation can corrupt exactly one artefact while the rest stay real.
 */
const asArtifact = (inj, name, path) =>
  (inj && inj.artifact === name) ? inj : JSON.parse(readFileSync(resolve(path), "utf8"));
const readLedger = (inj) => asArtifact(inj, "meta-template-remote-state", REMOTE_STATE);
const readNext = (inj) => asArtifact(inj, "meta-wave1-next-utility-subset-review", NEXT_SUBSET);

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
  /**
   * QF-MVP-40.10D: the packet is no longer uniformly draft. Wave 0 closed as
   * APPROVED_UNMAPPED and is HELD from creation; every OTHER template must still be
   * draft. This is a CLOSED state model, not a relaxation — an unexpected approval
   * anywhere else still fails, and no entry may ever carry a real provider id.
   */
  closedStateModel: (p) => {
    const present = p.templates.filter((t) => CLOSED_KEYS.includes(t.internal_template_key));
    if (present.length !== CLOSED_KEYS.length) return false;      // the set itself is pinned
    return p.templates.every((t) => {
      const st = t.local_state;
      if (st.provider_template_id !== null) return false;         // never a remote id
      if (CLOSED_KEYS.includes(t.internal_template_key)) {
        return st.approval_status === "approved"
          && st.submission_state === "APPROVED_UNMAPPED"
          && t.submit_now === false;                               // create is HELD
      }
      return st.approval_status === "draft" && st.submission_state === "DRAFT_NOT_SUBMITTED";
    });
  },
  /** Exactly two approvals, and exactly the expected two. A third is a failure. */
  exactlyTwoApproved: (p) => {
    const approved = p.templates.filter((t) => t.local_state.approval_status === "approved");
    return approved.length === 2
      && approved.map((t) => t.internal_template_key).sort().join(",")
         === CLOSED_KEYS.slice().sort().join(",");
  },
  noRemoteIdAnywhere: (p) => {
    const raw = JSON.stringify(p) + readFileSync(resolve(REMOTE_STATE), "utf8");
    return !/"(provider_template_id|template_id)"\s*:\s*"/.test(raw);
  },
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
  retiredNamesAbsentFromCandidates: (p) => {
    const m = JSON.parse(readFileSync(resolve(MANIFEST), "utf8"));
    const candidates = Object.values(m.groups).flat().map((t) => t.provider_template_name_candidate);
    // A retired name may still be NAMED in a historical note or the remote ledger;
    // it must never be a CURRENT candidate or appear in a packet template entry.
    return WAVE0_RETIRED_NAMES.every((n) =>
      !candidates.includes(n) && !JSON.stringify(p.templates).includes(n));
  },
  /** The strict Utility rewrite must carry no promotional surface at all. */
  wave0BodyIsStrictUtility: (p) => {
    const w0 = p.templates.find((t) => t.submission_wave === 0);
    const body = w0?.creation_payload?.components?.find((c) => c.type === "body")?.text ?? "";
    if (body !== WAVE0_BODY) return false;
    // No external URL, and none of the promotional/vendor-discovery phrasing that
    // plausibly drew the MARKETING classification onto v2.
    return !/https?:\/\/|www\.|\.in\b|\.com\b/i.test(body)
      && !/verified|vendors|interior|furniture|connect|discover|offer|discount|promo/i.test(body);
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

  // ---- QF-MVP-40.10C remote-state ledger ---------------------------------
  ledgerExists: () => existsSync(resolve(REMOTE_STATE)),
  /**
   * QF-MVP-40.10D: the ledger now holds three entries (P81 pins the exact set), so
   * "exactly two" is obsolete. The invariant this rule actually protects — the two
   * HISTORICAL records must survive untouched and keep their dispositions — is
   * restated directly, so a later phase cannot quietly rewrite the v1/v2 history.
   */
  ledgerHistoricalPairIntact: () => {
    const L = JSON.parse(readFileSync(resolve(REMOTE_STATE), "utf8"));
    const v1 = L.entries.find((e) => e.provider_template_name === "qf_consent_help_response_v1");
    const v2 = L.entries.find((e) => e.provider_template_name === "qf_consent_help_response_v2");
    return !!v1 && !!v2
      && v1.disposition === "RETIRED_DELETED_BY_FORMER_PARTNER"
      && v2.disposition === "QUARANTINED_UNMAPPED"
      && v2.last_proven_remote_category === "MARKETING";
  },
  ledgerV1Retired: () => {
    const L = JSON.parse(readFileSync(resolve(REMOTE_STATE), "utf8"));
    const v1 = L.entries.find((e) => e.provider_template_name === "qf_consent_help_response_v1");
    return !!v1 && v1.last_proven_status === "DELETED"
      && v1.disposition === "RETIRED_DELETED_BY_FORMER_PARTNER"
      && v1.send_authority === "DENIED" && v1.mapping_authority === "DENIED";
  },
  ledgerV2QuarantinedMarketing: () => {
    const L = JSON.parse(readFileSync(resolve(REMOTE_STATE), "utf8"));
    const v2 = L.entries.find((e) => e.provider_template_name === "qf_consent_help_response_v2");
    return !!v2
      && v2.last_proven_status === "APPROVED"
      && v2.last_proven_remote_category === "MARKETING"
      && v2.requested_category === "UTILITY"
      && v2.disposition === "QUARANTINED_UNMAPPED"
      && v2.reconciliation_outcome === "RECONCILED_CATEGORY_MISMATCH"
      && v2.create_post_count_at_reconciliation === 0
      && v2.readback_semantic_match === false;
  },
  ledgerV2AuthoritiesDenied: () => {
    const L = JSON.parse(readFileSync(resolve(REMOTE_STATE), "utf8"));
    const v2 = L.entries.find((e) => e.provider_template_name === "qf_consent_help_response_v2");
    return !!v2 && v2.send_authority === "DENIED" && v2.mapping_authority === "DENIED"
      && v2.delete_authority === "NOT_GRANTED" && v2.appeal_authority === "NOT_GRANTED";
  },
  ledgerAuthorizesNothing: () => {
    const L = JSON.parse(readFileSync(resolve(REMOTE_STATE), "utf8"));
    return L.authorizes_meta_calls === false && L.authorizes_mapping === false
      && L.authorizes_sending === false && L.contains_secrets === false;
  },
  ledgerCitesReconciliationEvidence: () => {
    const L = JSON.parse(readFileSync(resolve(REMOTE_STATE), "utf8"));
    const v2 = L.entries.find((e) => e.provider_template_name === "qf_consent_help_response_v2");
    return !!v2 && Array.isArray(v2.evidence)
      && v2.evidence.includes("QF-MVP-40-WAVE0-consent_help_response-META-RECONCILIATION-2026-07-30T13-31-55-439Z.json");
  },
  /** The ledger must NOT claim body/component equality either way. */
  ledgerMakesNoBodyEqualityClaim: () => {
    const raw = readFileSync(resolve(REMOTE_STATE), "utf8");
    const L = JSON.parse(raw);
    const v2 = L.entries.find((e) => e.provider_template_name === "qf_consent_help_response_v2");
    return /does NOT separately prove/i.test(v2.notes)
      && !/only the category|body (is|was) identical|components (are|were) identical/i.test(raw);
  },
  ledgerCarriesNoIdentifiers: () => {
    const raw = readFileSync(resolve(REMOTE_STATE), "utf8");
    return !/"(template_id|waba_id|phone_number_id|request_id|access_token|app_secret|verify_token)"/i.test(raw)
      && !/(EAA[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9._-]{20,}|Bearer\s+[A-Za-z0-9._-]{12,}|\+\d[\d\s-]{8,})/.test(raw)
      && !/raw_body|response_body|error_message/i.test(raw);
  },

  // ---- QF-MVP-40.10D Wave 0 closure --------------------------------------
  ledgerHasFourEntries: (inj) => {
    const L = readLedger(inj);
    return L.entries.length === 4
      && L.entries.map((e) => e.provider_template_name).join(",")
         === "qf_consent_help_response_v1,qf_consent_help_response_v2,qf_consent_help_response_v3,"
            + "qf_lead_received_v1";
  },

  // ---- QF-MVP-40.10E Wave 1 canary closure --------------------------------
  ledgerCanaryApprovedUtility: (inj) => {
    const c = readLedger(inj).entries.find((e) => e.provider_template_name === WAVE1_CANARY_NAME);
    return !!c && c.internal_template_key === WAVE1_CANARY_KEY
      && c.requested_category === "UTILITY"
      && c.last_proven_status === "APPROVED"
      && c.last_proven_remote_category === "UTILITY"
      && c.readback_semantic_match === true
      && c.create_post_count_at_submission === 1
      && c.create_post_count_at_reconciliation === 0
      && c.submission_outcome === "CREATED_PENDING"
      && c.reconciliation_outcome === "RECONCILED_APPROVED"
      && c.disposition === "APPROVED_UNMAPPED";
  },
  ledgerCanaryAuthoritiesDenied: (inj) => {
    const c = readLedger(inj).entries.find((e) => e.provider_template_name === WAVE1_CANARY_NAME);
    return !!c && c.send_authority === "DENIED" && c.mapping_authority === "DENIED"
      && c.activation_authority === "NOT_GRANTED" && c.delete_authority === "NOT_GRANTED"
      && c.appeal_authority === "NOT_APPLICABLE";
  },
  ledgerCanaryCitesBothEvidenceFiles: (inj) => {
    const c = readLedger(inj).entries.find((e) => e.provider_template_name === WAVE1_CANARY_NAME);
    return !!c && Array.isArray(c.evidence) && c.evidence.length === 2
      && c.evidence.includes(V1C_SUBMISSION_EVIDENCE)
      && c.evidence.includes(V1C_RECONCILIATION_EVIDENCE);
  },
  ledgerCanaryApprovalGrantsNothing: (inj) => {
    const c = readLedger(inj).entries.find((e) => e.provider_template_name === WAVE1_CANARY_NAME);
    return !!c && /PROVIDER CONTRACT ONLY/i.test(c.notes)
      && /no consent authority/i.test(c.notes)
      && /authorizes no further Wave 1 submission/i.test(c.notes);
  },
  ledgerTopLevelAuthorizesNothing: (inj) => {
    const L = readLedger(inj);
    return L.authorizes_meta_calls === false && L.authorizes_mapping === false
      && L.authorizes_sending === false;
  },

  // ---- QF-MVP-40.10E next Utility subset ----------------------------------
  nextSubsetExactKeysInOrder: (inj) => {
    const N = readNext(inj);
    return N.templates.length === 3
      && N.templates.map((t) => t.internal_template_key).join(",") === NEXT_SUBSET_KEYS.join(",")
      && N.templates.map((t) => t.provider_template_name).join(",") === NEXT_SUBSET_NAMES.join(",");
  },
  nextSubsetMatchesPacketVerbatim: (inj) => {
    const N = readNext(inj);
    return N.templates.length === 3 && N.templates.every((t, i) => {
      const src = packet.templates.find((x) => x.internal_template_key === t.internal_template_key);
      return !!src && t.provider_template_name === src.provider_template_name
        && t.provider_language === src.provider_language
        && t.requested_category === src.category && src.category === "UTILITY"
        && t.component_profile === src.component_profile && src.component_profile === "STANDARD_TEXT"
        && t.payload_fingerprint === src.payload_fingerprint
        && t.payload_fingerprint === NEXT_SUBSET_FINGERPRINTS[i]
        && JSON.stringify(t.creation_payload) === JSON.stringify(src.creation_payload)
        && t.payload_fingerprint === sha256(JSON.stringify(t.creation_payload));
    });
  },
  nextSubsetAuthorizesNothing: (inj) => {
    const N = readNext(inj);
    return N.authorizes_meta_calls === false && N.status === "OWNER_REVIEW_PENDING"
      && N.counts.authorized === 0 && N.counts.total === 3 && N.counts.pending_owner_review === 3
      && N.templates.every((t) => t.owner_copy_decision === "PENDING_OWNER_REVIEW"
        && t.category_review_decision === "REVIEW_REQUIRED"
        && t.submission_authorization === "NOT_AUTHORIZED"
        && t.remote_submission_state === "NOT_SUBMITTED")
      && Array.isArray(N.explicit_non_authorizations) && N.explicit_non_authorizations.length >= 4;
  },
  /** Never propose a commercial template, an already-closed one, a button or a URL. */
  nextSubsetLeaksNothing: (inj) => {
    const N = readNext(inj);
    const keys = N.templates.map((t) => t.internal_template_key);
    return !keys.some((k) => COMMERCIAL_KEYS.includes(k) || CLOSED_KEYS.includes(k))
      && !N.templates.some((t) => /"type"\s*:\s*"buttons"/i.test(JSON.stringify(t.creation_payload)))
      && !N.templates.some((t) => /https?:\/\/|quickfurno\.[a-z]{2,}/i.test(t.body_spec));
  },
  nextSubsetPinsCurrentPacket: (inj) =>
    readNext(inj).source_packet_fingerprint === sha256(readFileSync(resolve(PACKET))),
  ledgerV3ApprovedUtility: () => {
    const L = JSON.parse(readFileSync(resolve(REMOTE_STATE), "utf8"));
    const v3 = L.entries.find((e) => e.provider_template_name === "qf_consent_help_response_v3");
    return !!v3 && v3.last_proven_status === "APPROVED"
      && v3.last_proven_remote_category === "UTILITY"
      && v3.requested_category === "UTILITY"
      && v3.readback_semantic_match === true
      && v3.create_post_count_at_submission === 1
      && v3.create_post_count_at_reconciliation === 0
      && v3.submission_outcome === "CREATED_PENDING"
      && v3.reconciliation_outcome === "RECONCILED_APPROVED"
      && v3.disposition === "APPROVED_UNMAPPED";
  },
  ledgerV3AuthoritiesDenied: () => {
    const L = JSON.parse(readFileSync(resolve(REMOTE_STATE), "utf8"));
    const v3 = L.entries.find((e) => e.provider_template_name === "qf_consent_help_response_v3");
    return !!v3 && v3.send_authority === "DENIED" && v3.mapping_authority === "DENIED"
      && v3.activation_authority === "NOT_GRANTED" && v3.delete_authority === "NOT_GRANTED";
  },
  ledgerV3CitesBothEvidenceFiles: () => {
    const L = JSON.parse(readFileSync(resolve(REMOTE_STATE), "utf8"));
    const v3 = L.entries.find((e) => e.provider_template_name === "qf_consent_help_response_v3");
    return !!v3 && Array.isArray(v3.evidence) && v3.evidence.length === 2
      && v3.evidence.includes(V3_SUBMISSION_EVIDENCE)
      && v3.evidence.includes(V3_RECONCILIATION_EVIDENCE);
  },
  /** Approval must never be presented as consent/mapping/send authority. */
  ledgerV3ApprovalGrantsNothing: () => {
    const L = JSON.parse(readFileSync(resolve(REMOTE_STATE), "utf8"));
    const v3 = L.entries.find((e) => e.provider_template_name === "qf_consent_help_response_v3");
    return !!v3 && /does not create ordinary consent authority/i.test(v3.notes)
      && /PROVIDER CONTRACT ONLY/i.test(v3.notes);
  },
  modeLabelsAreHonest: () => modeLabel({}) === "DRY RUN (no network call)"
    && modeLabel({ execute: true }) === "EXECUTE"
    && modeLabel({ reconcileOnly: true }) === "RECONCILE ONLY (read-only network)"
    && !/DRY RUN/.test(modeLabel({ reconcileOnly: true })),
  heldDryRunNeverSaysWouldCreate: () => {
    // The held branch must precede the WOULD CREATE loop and must exit.
    const held = submitExec.indexOf("HELD / CREATE NOT AUTHORIZED");
    const would = submitExec.indexOf("WOULD CREATE");
    const body = held >= 0 ? submitExec.slice(held, would) : "";
    return held >= 0 && would > held && /process\.exit\(0\)/.test(body)
      && !/WOULD CREATE/.test(body);
  },
  executeRejectsHeldBeforeNetwork: () => {
    const gate = submitExec.indexOf("EXECUTE && target.submit_now !== true");
    const post = submitExec.indexOf('method: "POST"');
    const fetchIdx = submitExec.indexOf("await fetch(");
    return gate >= 0 && gate < post && gate < fetchIdx;
  },
  packetNoteNotUniformlyDraft: (p) => /NOT uniformly draft/i.test(p.note)
    && /APPROVED_UNMAPPED/.test(p.note)
    // The note must NAME every approved entry, so it cannot go stale as the set grows.
    && p.templates.filter((t) => t.local_state.approval_status === "approved")
        .every((t) => p.note.includes(t.internal_template_key)),
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
  ["P15 closed state model: the closed set is approved+held, all others draft", R.closedStateModel, packet],
  ["P90 exactly two templates are approved, and they are the expected two", R.exactlyTwoApproved, packet],
  ["P80 no remote template id anywhere in packet or ledger", R.noRemoteIdAnywhere, packet],
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
  ["P51 retired v1 and v2 are absent from every candidate", R.retiredNamesAbsentFromCandidates, packet],
  ["P70 Wave 0 body is a strict Utility rewrite (no URL, no promo surface)", R.wave0BodyIsStrictUtility, packet],
  ["P71 remote-state ledger exists", R.ledgerExists, packet],
  ["P72 the two historical ledger records survive untouched", R.ledgerHistoricalPairIntact, packet],
  ["P73 ledger records v1 as retired/deleted", R.ledgerV1Retired, packet],
  ["P74 ledger records v2 APPROVED as MARKETING and quarantined", R.ledgerV2QuarantinedMarketing, packet],
  ["P75 ledger denies v2 send/mapping and withholds delete/appeal", R.ledgerV2AuthoritiesDenied, packet],
  ["P76 ledger authorizes no calls, mapping or sending", R.ledgerAuthorizesNothing, packet],
  ["P77 ledger cites the exact reconciliation evidence file", R.ledgerCitesReconciliationEvidence, packet],
  ["P78 ledger makes no body/component equality claim", R.ledgerMakesNoBodyEqualityClaim, packet],
  ["P79 ledger carries no template/WABA/request id, token or raw body", R.ledgerCarriesNoIdentifiers, packet],
  ["P81 ledger holds exactly the four historical entries", R.ledgerHasFourEntries, packet],
  ["P91 ledger records the canary APPROVED as UTILITY with proven counts", R.ledgerCanaryApprovedUtility, packet],
  ["P92 ledger denies canary send/mapping/activation/delete", R.ledgerCanaryAuthoritiesDenied, packet],
  ["P93 ledger cites both canary evidence files exactly", R.ledgerCanaryCitesBothEvidenceFiles, packet],
  ["P94 ledger states the canary approval grants nothing further", R.ledgerCanaryApprovalGrantsNothing, packet],
  ["P95 ledger top level authorizes no call, mapping or send", R.ledgerTopLevelAuthorizesNothing, packet],
  ["P96 next subset is the exact three keys in the exact order", R.nextSubsetExactKeysInOrder, packet],
  ["P97 next subset quotes the packet verbatim (copy/category/profile/payload/fingerprint)", R.nextSubsetMatchesPacketVerbatim, packet],
  ["P98 next subset authorizes zero Meta calls", R.nextSubsetAuthorizesNothing, packet],
  ["P99 next subset leaks no commercial, closed, button or URL template", R.nextSubsetLeaksNothing, packet],
  ["P100 next subset pins the current source packet fingerprint", R.nextSubsetPinsCurrentPacket, packet],
  ["P82 ledger records v3 APPROVED as UTILITY with proven counts", R.ledgerV3ApprovedUtility, packet],
  ["P83 ledger denies v3 send/mapping/activation/delete", R.ledgerV3AuthoritiesDenied, packet],
  ["P84 ledger cites both v3 evidence files exactly", R.ledgerV3CitesBothEvidenceFiles, packet],
  ["P85 ledger states approval grants no consent/mapping/send authority", R.ledgerV3ApprovalGrantsNothing, packet],
  ["P86 mode labels are honest (reconcile-only is not DRY RUN)", R.modeLabelsAreHonest, packet],
  ["P87 a held dry run never prints WOULD CREATE", R.heldDryRunNeverSaysWouldCreate, packet],
  ["P88 execute rejects a held target before any network call", R.executeRejectsHeldBeforeNetwork, packet],
  ["P89 packet note no longer claims all entries are draft", R.packetNoteNotUniformlyDraft, packet],
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
  // templates[0] is a Wave 1 entry (sorted by key), so an approval there must still
  // be rejected even though Wave 0 is legitimately approved now.
  ["M10 a non-Wave-0 template marked approved is rejected", R.closedStateModel, packet, (p) => {
    const other = p.templates.find((t) => t.internal_template_key !== "consent_help_response");
    other.local_state.approval_status = "approved"; }],
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
  ["M18 a stale v2 Wave 0 name is rejected", R.wave0RecoveryContractExact, packet, (p) => {
    const w0 = p.templates.find((t) => t.submission_wave === 0);
    w0.provider_template_name = "qf_consent_help_response_v2";
    w0.creation_payload.name = "qf_consent_help_response_v2"; }],
  ["M23 v2 remaining a current candidate is rejected", R.retiredNamesAbsentFromCandidates, packet, (p) => {
    p.templates[0].provider_template_name = "qf_consent_help_response_v2"; }],
  ["M24 the old vendor-discovery body is rejected", R.wave0BodyIsStrictUtility, packet, (p) => {
    const w0 = p.templates.find((t) => t.submission_wave === 0);
    w0.creation_payload.components[0].text =
      "QuickFurno connects you with verified furniture and interior vendors. Reply STOP to stop messages, or START to resume."; }],
  ["M25 an external URL in the Wave 0 body is rejected", R.wave0BodyIsStrictUtility, packet, (p) => {
    const w0 = p.templates.find((t) => t.submission_wave === 0);
    w0.creation_payload.components[0].text = WAVE0_BODY + " Visit https://quickfurno.in"; }],
  ["M26 a stale v3 fingerprint is rejected", R.wave0RecoveryContractExact, packet, (p) => {
    p.templates.find((t) => t.submission_wave === 0).payload_fingerprint = "0".repeat(64); }],
  ["M19 a stale payload fingerprint is rejected", R.everyFingerprintExact, packet, (p) => {
    p.templates[0].payload_fingerprint = "0".repeat(64); }],
  ["M20 a stale source-manifest fingerprint is rejected", R.sourceManifestFingerprintExact, packet, (p) => {
    p.source_manifest_fingerprint = "0".repeat(64); }],
  ["M21 a changed body keeping the old fingerprint is rejected", R.wave0RecoveryContractExact, packet, (p) => {
    const w0 = p.templates.find((t) => t.submission_wave === 0);
    w0.creation_payload.components[0].text = "TAMPERED COPY."; }],
  ["M22 a retired v1 candidate is rejected", R.retiredNamesAbsentFromCandidates, packet, (p) => {
    p.templates[0].provider_template_name = "qf_consent_help_response_v1"; }],
  ["M27 v3 reverted to draft is rejected", R.closedStateModel, packet, (p) => {
    const w0 = p.templates.find((t) => t.submission_wave === 0);
    w0.local_state.approval_status = "draft";
    w0.local_state.submission_state = "DRAFT_NOT_SUBMITTED"; }],
  ["M28 v3 submit_now true is rejected", R.closedStateModel, packet, (p) => {
    p.templates.find((t) => t.submission_wave === 0).submit_now = true; }],
  ["M29 any other template pre-approved is rejected", R.closedStateModel, packet, (p) => {
    const other = p.templates.find((t) => t.submission_wave === 1);
    other.local_state.approval_status = "approved"; }],
  ["M30 a committed provider template id is rejected", R.closedStateModel, packet, (p) => {
    p.templates.find((t) => t.submission_wave === 0).local_state.provider_template_id = "1234567890"; }],
  ["M31 a packet note claiming all entries draft is rejected", R.packetNoteNotUniformlyDraft, packet, (p) => {
    p.note = "Every entry here is a LOCAL CANDIDATE: none is approved."; }],

  // ---- QF-MVP-40.10E ------------------------------------------------------
  ["M32 the canary reverted to draft is rejected", R.closedStateModel, packet, (p) => {
    const t = p.templates.find((x) => x.internal_template_key === WAVE1_CANARY_KEY);
    t.local_state.approval_status = "draft";
    t.local_state.submission_state = "DRAFT_NOT_SUBMITTED"; }],
  ["M33 the canary re-armed for creation is rejected", R.closedStateModel, packet, (p) => {
    p.templates.find((x) => x.internal_template_key === WAVE1_CANARY_KEY).submit_now = true; }],
  ["M34 a committed provider id on the canary is rejected", R.closedStateModel, packet, (p) => {
    p.templates.find((x) => x.internal_template_key === WAVE1_CANARY_KEY)
      .local_state.provider_template_id = "1234567890"; }],
  ["M35 a THIRD approved template is rejected", R.exactlyTwoApproved, packet, (p) => {
    p.templates.find((x) => x.internal_template_key === "vendor_new_lead")
      .local_state.approval_status = "approved"; }],
  ["M36 a packet note omitting an approved key is rejected", R.packetNoteNotUniformlyDraft, packet, (p) => {
    p.note = "NOT uniformly draft. APPROVED_UNMAPPED: consent_help_response only."; }],

  ["M37 a canary ledger entry marked MARKETING is rejected", R.ledgerCanaryApprovedUtility, null, null, () => {
    const L = readLedger(); L.entries.find((e) => e.provider_template_name === WAVE1_CANARY_NAME)
      .last_proven_remote_category = "MARKETING"; return L; }],
  ["M38 a canary semantic mismatch is rejected", R.ledgerCanaryApprovedUtility, null, null, () => {
    const L = readLedger(); L.entries.find((e) => e.provider_template_name === WAVE1_CANARY_NAME)
      .readback_semantic_match = false; return L; }],
  ["M39 a second canary create POST is rejected", R.ledgerCanaryApprovedUtility, null, null, () => {
    const L = readLedger(); L.entries.find((e) => e.provider_template_name === WAVE1_CANARY_NAME)
      .create_post_count_at_reconciliation = 1; return L; }],
  ["M40 an enabled canary send authority is rejected", R.ledgerCanaryAuthoritiesDenied, null, null, () => {
    const L = readLedger(); L.entries.find((e) => e.provider_template_name === WAVE1_CANARY_NAME)
      .send_authority = "GRANTED"; return L; }],
  ["M41 a changed canary evidence filename is rejected", R.ledgerCanaryCitesBothEvidenceFiles, null, null, () => {
    const L = readLedger(); L.entries.find((e) => e.provider_template_name === WAVE1_CANARY_NAME)
      .evidence[0] = "QF-MVP-40-WAVE1-META-SUBMISSION-2026-07-30T18-46-18-999Z.json"; return L; }],
  ["M42 a ledger that authorizes sending is rejected", R.ledgerTopLevelAuthorizesNothing, null, null, () => {
    const L = readLedger(); L.authorizes_sending = true; return L; }],
  ["M43 a fifth ledger entry is rejected", R.ledgerHasFourEntries, null, null, () => {
    const L = readLedger(); L.entries.push({ ...L.entries[3], provider_template_name: "qf_x_v1" }); return L; }],

  ["M44 a fourth next-subset template is rejected", R.nextSubsetExactKeysInOrder, null, null, () => {
    const N = readNext(); N.templates.push(N.templates[0]); return N; }],
  ["M45 a reordered next subset is rejected", R.nextSubsetExactKeysInOrder, null, null, () => {
    const N = readNext(); N.templates.reverse(); return N; }],
  ["M46 a commercial template in the next subset is rejected", R.nextSubsetLeaksNothing, null, null, () => {
    const N = readNext(); N.templates[0].internal_template_key = "recharge_reminder"; return N; }],
  ["M47 an already-closed template in the next subset is rejected", R.nextSubsetLeaksNothing, null, null, () => {
    const N = readNext(); N.templates[0].internal_template_key = WAVE1_CANARY_KEY; return N; }],
  ["M48 a URL in next-subset copy is rejected", R.nextSubsetLeaksNothing, null, null, () => {
    const N = readNext(); N.templates[0].body_spec += " See https://example.com"; return N; }],
  ["M49 a pre-authorized next-subset entry is rejected", R.nextSubsetAuthorizesNothing, null, null, () => {
    const N = readNext(); N.templates[0].submission_authorization = "AUTHORIZED"; return N; }],
  ["M50 a next subset claiming it authorizes Meta calls is rejected", R.nextSubsetAuthorizesNothing, null, null, () => {
    const N = readNext(); N.authorizes_meta_calls = true; return N; }],
  ["M51 an edited next-subset payload with a stale fingerprint is rejected",
    R.nextSubsetMatchesPacketVerbatim, null, null, () => {
    const N = readNext(); N.templates[0].creation_payload.components[0].text = "Buy now, 50% off!"; return N; }],
  ["M52 a MARKETING category in the next subset is rejected",
    R.nextSubsetMatchesPacketVerbatim, null, null, () => {
    const N = readNext(); N.templates[0].requested_category = "MARKETING"; return N; }],
  ["M53 a stale next-subset source fingerprint is rejected", R.nextSubsetPinsCurrentPacket, null, null, () => {
    const N = readNext(); N.source_packet_fingerprint = "0".repeat(64); return N; }],
];
// A mutant either corrupts a clone of `base` (packet rules) or supplies a corrupted
// sibling artefact via `inject` (rules that otherwise read that artefact from disk).
for (const [n, fn, base, mutate, inject] of MUT) {
  if (typeof inject === "function") { add(n, fn(inject()) === false); continue; }
  const copy = clone(base);
  mutate(copy);
  add(n, fn(copy) === false);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ""}`);
console.log(`\nTemplates: ${packet.total_templates} · waves: ${JSON.stringify(packet.wave_counts)}`);
console.log(`Summary: ${results.length - failed.length} passed, ${failed.length} failed (rules: ${RULES.length}, mutation self-tests: ${MUT.length}).`);
process.exit(failed.length === 0 ? 0 : 1);
