// ============================================================================
// QF-MVP-40.10A-R — Meta template submission operator.  DRY RUN BY DEFAULT.
//
// It CREATES message templates. It can never send a WhatsApp message, edit a
// template or delete one: there is no messaging endpoint, no DELETE, no PUT and no
// PATCH anywhere in this file.
//
//   node scripts/mvp/communication/submit-meta-templates.mjs --wave 0
//     -> DRY RUN. Prints exactly what WOULD be posted. No network call at all.
//
//   node scripts/mvp/communication/submit-meta-templates.mjs --wave 0 --execute
//     -> Performs the create call. Requires QF_META_GRAPH_API_VERSION,
//        QF_META_WABA_ID and QF_META_ACCESS_TOKEN. No value is ever printed.
//
// SAFETY RULES, all enforced below:
//   * --execute must be explicit; the default is always dry run;
//   * a wave must be named explicitly — there is no submit-everything mode;
//   * templates with submit_now=false are refused even inside a selected wave;
//   * the Graph API version is REQUIRED and validated; there is NO default and no
//     hardcoded historical version, because a version the QuickFurno app has not
//     enabled would fail (or behave differently) in ways a default would hide;
//   * WABA identity is proved by a non-mutating GET before anything else;
//   * an existing template is matched by an EXACT-NAME lookup and compared
//     SEMANTICALLY (see canonicaliseTemplate) — never by name+language+category
//     alone, which would accept a same-name template whose body had changed;
//   * the first ambiguous response stops the run; an ambiguous POST triggers ONE
//     read-only lookup and NEVER a second POST;
//   * responses are recorded sanitized: internal key, provider name, language,
//     requested/returned category, status, template id, outcome, fingerprint, UTC,
//     HTTP status, request id, API version. Never a token, WABA id or raw body.
// ============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";
const GRAPH = "https://graph.facebook.com";

export const API_VERSION_PATTERN = /^v[0-9]+\.[0-9]+$/;
export const WABA_ID_PATTERN = /^[0-9]{5,32}$/;

/** Meta template statuses we accept as known. Anything else stops for owner review. */
export const KNOWN_TEMPLATE_STATUSES = Object.freeze([
  "APPROVED", "PENDING", "IN_APPEAL", "REJECTED", "PENDING_DELETION",
  "DELETED", "DISABLED", "PAUSED", "LIMIT_EXCEEDED",
]);
/** Statuses an EXISTING exact template may hold and still be treated as usable. */
export const USABLE_EXISTING_STATUSES = Object.freeze(["APPROVED", "PENDING"]);

export const MAX_ERROR_TYPE_LENGTH = 128;

/** Closed create-response classifications. */
export const CreateClassification = Object.freeze({
  SUCCESS: "SUCCESS",
  DETERMINISTIC_4XX_REJECTION: "DETERMINISTIC_4XX_REJECTION",
  AMBIGUOUS: "AMBIGUOUS",
});

/**
 * SAFE Meta error extraction.
 *
 * The 2026-07-30 incident lost the reason for an HTTP 400 because the operator kept
 * only the HTTP status and request id. These four STRUCTURED fields are enough to
 * diagnose a rejection, and none of them is free text.
 *
 * DELIBERATELY NEVER COPIED: error.message, error_data, error_user_title,
 * error_user_msg, fbtrace_id, the raw body, headers, the authorization header, the
 * token, the WABA id or a phone number. Unknown error objects are never stringified,
 * and `type` is length-bounded, so an attacker-influenced or oversized value cannot
 * become unbounded evidence.
 */
export function safeMetaError(body) {
  const empty = { code: null, subcode: null, type: null, is_transient: null };
  if (!body || typeof body !== "object") return empty;
  const e = body.error;
  if (!e || typeof e !== "object" || Array.isArray(e)) return empty;

  const int = (v) => (typeof v === "number" && Number.isInteger(v) ? v : null);
  const type = typeof e.type === "string" && e.type.length > 0
    ? e.type.slice(0, MAX_ERROR_TYPE_LENGTH)
    : null;
  const transient = typeof e.is_transient === "boolean" ? e.is_transient : null;

  return { code: int(e.code), subcode: int(e.error_subcode), type, is_transient: transient };
}

/**
 * PURE classification of a create attempt. No network, no side effects.
 *
 * `threw` covers "fetch rejected / no HTTP response at all". A 4xx is DETERMINISTIC —
 * it must never be laundered into a generic ambiguous/manual-reconciliation outcome
 * merely because `res.ok` was false, which is exactly what hid the 400 reason before.
 * Meta's error.message text is never interpreted.
 */
export function classifyCreateResponse({ threw = false, httpStatus = null, body = null } = {}) {
  if (threw || typeof httpStatus !== "number") {
    return { classification: CreateClassification.AMBIGUOUS, error: safeMetaError(body) };
  }
  if (httpStatus >= 200 && httpStatus < 300) {
    const ok = body && typeof body === "object" && !Array.isArray(body)
      && typeof body.id === "string" && body.id.length > 0
      && typeof body.status === "string"
      && KNOWN_TEMPLATE_STATUSES.includes(body.status.toUpperCase());
    return ok
      ? { classification: CreateClassification.SUCCESS, error: safeMetaError(body) }
      : { classification: CreateClassification.AMBIGUOUS, error: safeMetaError(body) };
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    return { classification: CreateClassification.DETERMINISTIC_4XX_REJECTION, error: safeMetaError(body) };
  }
  // 5xx, unexpected 3xx and anything else non-2xx.
  return { classification: CreateClassification.AMBIGUOUS, error: safeMetaError(body) };
}

// ---------------------------------------------------------------------------
// QF-MVP-40.10B — PURE CLI CONTRACT HELPERS.
//
// Exported so the validator can prove every invalid combination offline, with no
// credentials and no network. `resolveMode` and `selectTemplate` are the single
// source of truth for which template (if any) an invocation may touch.
// ---------------------------------------------------------------------------

/** Closed operation modes recorded in evidence. Dry run writes no evidence at all. */
export const OperationMode = Object.freeze({
  EXECUTE_CREATE: "EXECUTE_CREATE",
  RECONCILE_ONLY: "RECONCILE_ONLY",
});

/** Closed read-only reconciliation outcomes. None may be inferred from a local file. */
export const ReconcileOutcome = Object.freeze({
  RECONCILED_APPROVED: "RECONCILED_APPROVED",
  RECONCILED_PENDING: "RECONCILED_PENDING",
  RECONCILED_NOT_FOUND: "RECONCILED_NOT_FOUND",
  RECONCILED_COLLISION: "RECONCILED_COLLISION",
  RECONCILED_UNUSABLE_STATUS: "RECONCILED_UNUSABLE_STATUS",
  RECONCILED_UNKNOWN_STATUS: "RECONCILED_UNKNOWN_STATUS",
  RECONCILED_LOOKUP_FAILED: "RECONCILED_LOOKUP_FAILED",
  RECONCILED_CATEGORY_MISMATCH: "RECONCILED_CATEGORY_MISMATCH",
});

export const MAX_FILENAME_KEY_LENGTH = 64;

/**
 * Bounded, filename-safe transform of an INTERNAL key. Never copies provider or
 * remote input into a path: anything outside [a-z0-9_-] becomes "_" and the result
 * is length-capped, so a hostile or oversized value cannot shape a filename.
 */
export function filenameSafeKey(key) {
  if (typeof key !== "string" || key.length === 0) return "unknown";
  const safe = key.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, MAX_FILENAME_KEY_LENGTH);
  return safe.length > 0 ? safe : "unknown";
}

/**
 * Resolve the invocation mode. --execute and --reconcile-only are MUTUALLY
 * EXCLUSIVE: asking to both create and merely observe is a contradiction, and
 * guessing which one was meant is exactly the kind of silent choice this operator
 * must never make.
 */
export function resolveMode({ execute = false, reconcileOnly = false } = {}) {
  if (execute && reconcileOnly) {
    return { ok: false, reason: "MODE_CONFLICT_EXECUTE_AND_RECONCILE_ONLY" };
  }
  if (execute) return { ok: true, mode: OperationMode.EXECUTE_CREATE, network: true };
  if (reconcileOnly) return { ok: true, mode: OperationMode.RECONCILE_ONLY, network: true };
  return { ok: true, mode: null, network: false };   // dry run
}

/**
 * EXACT template selection. Matching is by full internal_template_key equality
 * only — never a prefix, substring, provider name or fuzzy match, so a typo can
 * never silently resolve to a different template.
 *
 * `requireSingle` is true for execute and reconcile-only: when the wave holds more
 * than one candidate and no --template was given, this fails BEFORE any network
 * call rather than picking one.
 */
export function selectTemplate({ templates = [], wave, templateKey = null, requireSingle = false } = {}) {
  const inWave = templates.filter((t) => t.submission_wave === wave);
  if (inWave.length === 0) return { ok: false, reason: "WAVE_EMPTY" };

  if (templateKey !== null && templateKey !== undefined) {
    if (typeof templateKey !== "string" || templateKey.length === 0) {
      return { ok: false, reason: "TEMPLATE_KEY_INVALID" };
    }
    const exact = inWave.filter((t) => t.internal_template_key === templateKey);
    if (exact.length === 0) {
      // Distinguish "not in THIS wave" from "not in the packet at all".
      const elsewhere = templates.some((t) => t.internal_template_key === templateKey);
      return { ok: false, reason: elsewhere ? "TEMPLATE_KEY_NOT_IN_WAVE" : "TEMPLATE_KEY_NOT_FOUND" };
    }
    if (exact.length > 1) return { ok: false, reason: "TEMPLATE_KEY_AMBIGUOUS" };
    return { ok: true, template: exact[0], candidates: inWave };
  }

  if (!requireSingle) return { ok: true, template: null, candidates: inWave };
  if (inWave.length > 1) return { ok: false, reason: "TEMPLATE_KEY_REQUIRED_MULTIPLE_IN_WAVE" };
  return { ok: true, template: inWave[0], candidates: inWave };
}

// ---------------------------------------------------------------------------
// PURE CANONICALISER — the semantic identity of a template.
//
// Normalises ONLY harmless representation differences: the casing of structural
// enums (category, component/button type) and an absent optional array versus an
// empty one. It deliberately does NOT normalise text, whitespace, ordering or
// content, so a single changed character in a body is a COLLISION, not a match.
//
// `example` blocks are excluded from identity because Meta does not return them
// reliably on a read — that exclusion is narrow and explicit, and no other field
// is dropped.
// ---------------------------------------------------------------------------
export function canonicaliseTemplate(t) {
  if (!t || typeof t !== "object") return null;
  const name = typeof t.name === "string" ? t.name : null;
  const language = typeof t.language === "string" ? t.language : null;
  const category = typeof t.category === "string" ? t.category.toUpperCase() : null;
  if (!name || !language || !category) return null;

  const rawComponents = Array.isArray(t.components) ? t.components : [];
  const components = rawComponents.map((c) => {
    if (!c || typeof c !== "object") return null;
    const type = typeof c.type === "string" ? c.type.toUpperCase() : null;
    if (!type) return null;
    const out = { type };
    // Text is compared EXACTLY — no trimming, no whitespace collapsing.
    if (typeof c.text === "string") out.text = c.text;
    if (typeof c.add_security_recommendation === "boolean") {
      out.add_security_recommendation = c.add_security_recommendation;
    }
    if (typeof c.code_expiration_minutes === "number") {
      out.code_expiration_minutes = c.code_expiration_minutes;
    }
    const buttons = Array.isArray(c.buttons) ? c.buttons : [];
    if (buttons.length > 0) {
      // Button ORDER is significant and is preserved.
      out.buttons = buttons.map((b) => {
        if (!b || typeof b !== "object") return null;
        const btn = { type: typeof b.type === "string" ? b.type.toUpperCase() : null };
        if (typeof b.text === "string") btn.text = b.text;
        if (typeof b.otp_type === "string") btn.otp_type = b.otp_type.toUpperCase();
        if (typeof b.url === "string") btn.url = b.url;
        if (typeof b.phone_number === "string") btn.phone_number = b.phone_number;
        return btn;
      });
    }
    return out;
  });

  return { name, language, category, components };
}

/** Deterministic, order-preserving identity string for comparison. */
export function templateIdentity(t) {
  const c = canonicaliseTemplate(t);
  return c === null ? null : JSON.stringify(c);
}

/** True only when both canonicalise successfully AND are semantically identical. */
export function templatesAreIdentical(a, b) {
  const ia = templateIdentity(a);
  const ib = templateIdentity(b);
  return ia !== null && ib !== null && ia === ib;
}

// ---------------------------------------------------------------------------
// Environment validation. Fails BEFORE any network call.
// ---------------------------------------------------------------------------
export function validateEnvironment(env) {
  const missing = [];
  const invalid = [];
  const version = env.QF_META_GRAPH_API_VERSION;
  const waba = env.QF_META_WABA_ID;
  const token = env.QF_META_ACCESS_TOKEN;

  if (version === undefined || version === "") missing.push("QF_META_GRAPH_API_VERSION");
  else if (!API_VERSION_PATTERN.test(version)) invalid.push("QF_META_GRAPH_API_VERSION");
  if (waba === undefined || waba === "") missing.push("QF_META_WABA_ID");
  else if (!WABA_ID_PATTERN.test(waba)) invalid.push("QF_META_WABA_ID");
  if (token === undefined || token === "") missing.push("QF_META_ACCESS_TOKEN");

  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

// ---------------------------------------------------------------------------
// CLI. Only runs when this file is the entry point, so the pure helpers above can
// be imported by the validator without executing anything.
// ---------------------------------------------------------------------------
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntry) { await main(); }

async function main() {
  const argv = process.argv.slice(2);
  const EXECUTE = argv.includes("--execute");            // default: DRY RUN
  const RECONCILE_ONLY = argv.includes("--reconcile-only");
  const WAVE = argv.includes("--wave") ? Number(argv[argv.indexOf("--wave") + 1]) : NaN;
  const TEMPLATE_KEY = argv.includes("--template") ? argv[argv.indexOf("--template") + 1] ?? null : null;

  if (!Number.isInteger(WAVE)) {
    console.error("Refusing to run: an explicit --wave <n> is required. There is no submit-everything mode.");
    process.exit(2);
  }

  const modeResult = resolveMode({ execute: EXECUTE, reconcileOnly: RECONCILE_ONLY });
  if (!modeResult.ok) {
    console.error(`Refusing to run: ${modeResult.reason}. --execute creates; --reconcile-only only observes. Choose one.`);
    process.exit(2);
  }

  const packet = JSON.parse(readFileSync(resolve(PACKET), "utf8"));
  const selected = packet.templates.filter((t) => t.submission_wave === WAVE);
  if (selected.length === 0) {
    console.error(`Refusing to run: wave ${WAVE} contains no templates.`);
    process.exit(2);
  }
  const held = selected.filter((t) => t.submit_now !== true);
  const submittable = selected.filter((t) => t.submit_now === true);

  // EXACT selection. requireSingle for anything that touches the network, so a
  // multi-template wave without --template fails BEFORE a single request.
  const selection = selectTemplate({
    templates: packet.templates, wave: WAVE, templateKey: TEMPLATE_KEY,
    requireSingle: EXECUTE || RECONCILE_ONLY,
  });
  if (!selection.ok) {
    console.error(`Refusing to run: ${selection.reason}.`);
    if (selection.reason === "TEMPLATE_KEY_REQUIRED_MULTIPLE_IN_WAVE") {
      console.error(`  Wave ${WAVE} holds ${selected.length} templates. Pass --template <internal_template_key> to choose exactly one.`);
    }
    process.exit(2);
  }

  console.log(`Mode           : ${EXECUTE ? "EXECUTE" : "DRY RUN (no network call)"}`);
  console.log(`Wave           : ${WAVE}`);
  console.log(`Selected       : ${selected.length}`);
  console.log(`Submittable    : ${submittable.length}`);
  console.log(`Held (submit_now=false): ${held.length}${held.length ? " -> " + held.map((t) => t.internal_template_key).join(", ") : ""}`);
  console.log("");

  if (!EXECUTE && !RECONCILE_ONLY) {
    const dryList = selection.template ? [selection.template] : submittable;
    for (const t of dryList) {
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
    console.log("To create these, re-run with --execute and QF_META_GRAPH_API_VERSION, QF_META_WABA_ID and QF_META_ACCESS_TOKEN exported.");
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // NETWORK PATH — reached only by --execute or --reconcile-only.
  // -------------------------------------------------------------------------
  const envCheck = validateEnvironment(process.env);
  if (!envCheck.ok) {
    console.error("Refusing to execute. No value is printed.");
    if (envCheck.missing.length) console.error(`  missing: ${envCheck.missing.join(", ")}`);
    if (envCheck.invalid.length) console.error(`  invalid: ${envCheck.invalid.join(", ")}`);
    console.error("  QF_META_GRAPH_API_VERSION must match ^v[0-9]+\\.[0-9]+$ and must be a version");
    console.error("  currently enabled for the QuickFurno Meta app/WABA. There is no default.");
    process.exit(2);
  }
  // The selection above already guaranteed exactly one target. Creating additionally
  // requires that target to be submittable; reconciling is read-only and may observe
  // a held template.
  const target = selection.template;
  if (!target) {
    console.error("Refusing to run: no exact template was selected.");
    process.exit(2);
  }
  if (EXECUTE && target.submit_now !== true) {
    console.error(`Refusing to execute: ${target.internal_template_key} is held (submit_now=false).`);
    process.exit(2);
  }

  const API_VERSION = process.env.QF_META_GRAPH_API_VERSION;
  const WABA_ID = process.env.QF_META_WABA_ID;
  const auth = { Authorization: `Bearer ${process.env.QF_META_ACCESS_TOKEN}`, "Content-Type": "application/json" };
  const base = `${GRAPH}/${API_VERSION}/${WABA_ID}`;
  const stamp = () => new Date().toISOString();
  const reqId = (res) => res.headers.get("x-fb-request-id") ?? res.headers.get("x-fb-trace-id") ?? null;

  console.log(`API version    : ${API_VERSION}`);   // version is not a secret
  console.log(`Operation mode : ${modeResult.mode}`);
  const t = target;
  const record = {
    internal_template_key: t.internal_template_key,
    provider_template_name: t.provider_template_name,
    provider_language: t.provider_language,
    requested_category: t.category,
    returned_category: null,
    template_id: null,
    status: null,
    outcome: null,
    payload_fingerprint: t.payload_fingerprint,
    api_version: API_VERSION,
    request_utc: null,
    response_utc: null,
    http_status: null,
    request_id: null,
    identity_match: null,
    readback_semantic_match: null,
    // Which mode produced this record. RECONCILE_ONLY can never carry a create.
    operation_mode: modeResult.mode,
    // QF-MVP-40.10A-R2 — STRUCTURED Meta error fields only. The 2026-07-30 incident
    // lost an HTTP 400 reason because only status + request id were kept. There is
    // deliberately NO raw body and NO error message field here.
    meta_error_code: null,
    meta_error_subcode: null,
    meta_error_type: null,
    meta_error_is_transient: null,
    // Hard evidence of the one-POST invariant. Set to 1 immediately before the sole
    // attempt and never incremented again.
    create_post_count: 0,
  };

  const finish = (outcome, code) => {
    record.outcome = outcome;
    const ts = stamp().replace(/[:.]/g, "-");
    const safeKey = filenameSafeKey(t.internal_template_key);
    const path = modeResult.mode === OperationMode.RECONCILE_ONLY
      ? `QF-MVP-40-WAVE${WAVE}-${safeKey}-META-RECONCILIATION-${ts}.json`
      : `QF-MVP-40-WAVE${WAVE}-META-SUBMISSION-${ts}.json`;
    writeFileSync(path, JSON.stringify(record, null, 2) + "\n", "utf8");
    console.log(`\nOutcome: ${outcome}`);
    console.log(`Sanitized evidence: ${path}`);
    console.log("No message was sent. No template was edited or deleted. No mapping was activated.");
    process.exit(code);
  };

  // --- C. WABA identity preflight (non-mutating) --------------------------
  let idRes;
  try {
    idRes = await fetch(`${base}?fields=id`, { headers: auth });
  } catch {
    record.identity_match = false;
    finish("PREFLIGHT_NETWORK_ERROR", 3);
  }
  record.http_status = idRes.status;
  record.request_id = reqId(idRes);
  const idBody = await idRes.json().catch(() => null);
  const identityMatch = !!(idRes.ok && idBody && typeof idBody.id === "string" && idBody.id === WABA_ID);
  record.identity_match = identityMatch;
  console.log(`WABA identity  : identity_match=${identityMatch} http=${idRes.status}${record.request_id ? " request_id=" + record.request_id : ""}`);
  if (!identityMatch) {
    console.error("Refusing to continue: the supplied WABA identity could not be proved. No id is printed.");
    finish("WABA_IDENTITY_MISMATCH", 3);
  }

  // --- D. EXACT-NAME lookup (never a first-200 scan) ----------------------
  async function lookupExact() {
    const url = `${base}/message_templates?name=${encodeURIComponent(t.provider_template_name)}`
      + `&fields=id,name,language,status,category,components`;
    let res;
    try {
      res = await fetch(url, { headers: auth });
    } catch {
      // A transport exception must become a CLOSED failure result, never an
      // exception that escapes before the sanitized evidence is written.
      return { ok: false, httpStatus: null, requestId: null };
    }
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !Array.isArray(body.data)) {
      return { ok: false, httpStatus: res.status, requestId: reqId(res) };
    }
    const rows = body.data.filter((r) => r && r.name === t.provider_template_name
      && r.language === t.provider_language);
    return { ok: true, rows, httpStatus: res.status, requestId: reqId(res) };
  }

  // --- RECONCILE-ONLY: read-only, closed, and it ALWAYS finishes here ------
  //
  // This branch performs the WABA identity GET (already done above) plus ONE
  // exact-name GET, then exits through finish(). It is placed BEFORE any create
  // logic and terminates unconditionally, so a create can never be reached in this
  // mode and create_post_count stays 0. No outcome here is derived from the local
  // packet or an owner report — only from what Meta actually returns.
  if (modeResult.mode === OperationMode.RECONCILE_ONLY) {
    record.request_utc = stamp();
    const look = await lookupExact();
    record.response_utc = stamp();
    record.http_status = look.httpStatus;
    record.request_id = look.requestId;

    if (!look.ok) finish(ReconcileOutcome.RECONCILED_LOOKUP_FAILED, 3);
    if (look.rows.length === 0) finish(ReconcileOutcome.RECONCILED_NOT_FOUND, 4);
    if (look.rows.length > 1) finish(ReconcileOutcome.RECONCILED_COLLISION, 4);

    const row = look.rows[0];
    const status = typeof row.status === "string" ? row.status.toUpperCase() : null;
    const remoteCategory = typeof row.category === "string" ? row.category.toUpperCase() : null;
    record.status = status;
    record.returned_category = remoteCategory;
    record.template_id = typeof row.id === "string" ? row.id : null;

    const semanticMatch = templatesAreIdentical(row, t.creation_payload);
    record.readback_semantic_match = semanticMatch;

    // Category is compared EXPLICITLY as well as semantically, so a recategorisation
    // is reported as exactly that rather than as a vague collision.
    if (remoteCategory !== null && remoteCategory !== String(t.category).toUpperCase()) {
      finish(ReconcileOutcome.RECONCILED_CATEGORY_MISMATCH, 6);
    }
    if (!semanticMatch) finish(ReconcileOutcome.RECONCILED_COLLISION, 4);
    if (status === null || !KNOWN_TEMPLATE_STATUSES.includes(status)) {
      finish(ReconcileOutcome.RECONCILED_UNKNOWN_STATUS, 4);
    }
    if (status === "APPROVED") {
      if (!record.template_id) finish(ReconcileOutcome.RECONCILED_UNKNOWN_STATUS, 4);
      finish(ReconcileOutcome.RECONCILED_APPROVED, 0);
    }
    if (status === "PENDING") {
      if (!record.template_id) finish(ReconcileOutcome.RECONCILED_UNKNOWN_STATUS, 4);
      finish(ReconcileOutcome.RECONCILED_PENDING, 0);
    }
    finish(ReconcileOutcome.RECONCILED_UNUSABLE_STATUS, 4);
  }

  const pre = await lookupExact();
  if (!pre.ok) {
    record.http_status = pre.httpStatus; record.request_id = pre.requestId;
    console.error("Refusing to continue: the exact-name lookup response was malformed or failed.");
    finish("LOOKUP_MALFORMED", 3);
  }
  record.http_status = pre.httpStatus; record.request_id = pre.requestId;

  if (pre.rows.length > 1) {
    console.error(`Refusing to continue: ${pre.rows.length} rows share this exact name and language.`);
    finish("DUPLICATE_EXACT_ROWS", 4);
  }

  if (pre.rows.length === 1) {
    const existing = pre.rows[0];
    const status = typeof existing.status === "string" ? existing.status.toUpperCase() : null;
    record.status = status;
    record.returned_category = typeof existing.category === "string" ? existing.category.toUpperCase() : null;
    record.template_id = typeof existing.id === "string" ? existing.id : null;

    if (!templatesAreIdentical(existing, t.creation_payload)) {
      console.error("Refusing to continue: a template with this exact name and language exists but is NOT semantically identical (category, components, text or button order differ). Never edited, never replaced.");
      finish("COLLISION_SAME_NAME_DIFFERENT_CONTENT", 4);
    }
    if (status === null || !KNOWN_TEMPLATE_STATUSES.includes(status)) {
      console.error("Refusing to continue: the existing exact template has an unknown status.");
      finish("EXISTING_UNKNOWN_STATUS", 4);
    }
    if (!USABLE_EXISTING_STATUSES.includes(status)) {
      console.error(`Refusing to continue: the existing exact template is ${status} and is not usable. Owner review required.`);
      finish("EXISTING_NOT_USABLE", 4);
    }
    record.readback_semantic_match = true;
    console.log(`EXISTING       ${t.internal_template_key} (${status}) — semantically identical, no POST issued.`);
    finish(status === "APPROVED" ? "IDEMPOTENT_EXISTING_APPROVED" : "IDEMPOTENT_EXISTING_PENDING", 0);
  }

  // --- G. EXACTLY ONE create POST ----------------------------------------
  record.request_utc = stamp();
  record.create_post_count = 1;          // set BEFORE the sole attempt; never incremented again
  let createBody = null;
  let threw = false;
  let httpStatus = null;
  try {
    const createRes = await fetch(`${base}/message_templates`, {
      method: "POST", headers: auth, body: JSON.stringify(t.creation_payload),
    });
    httpStatus = createRes.status;
    record.http_status = httpStatus;
    record.request_id = reqId(createRes);
    createBody = await createRes.json().catch(() => null);
  } catch {
    threw = true;
  }
  record.response_utc = stamp();

  const verdict = classifyCreateResponse({ threw, httpStatus, body: createBody });
  record.meta_error_code = verdict.error.code;
  record.meta_error_subcode = verdict.error.subcode;
  record.meta_error_type = verdict.error.type;
  record.meta_error_is_transient = verdict.error.is_transient;

  // --- DETERMINISTIC 4xx: a real rejection, never "ambiguous" -------------
  if (verdict.classification === CreateClassification.DETERMINISTIC_4XX_REJECTION) {
    console.error(`Meta rejected the create: http=${httpStatus}`
      + ` code=${verdict.error.code ?? "null"} subcode=${verdict.error.subcode ?? "null"}`
      + ` type=${verdict.error.type ?? "null"} transient=${verdict.error.is_transient ?? "null"}`);
    console.error("No template was created. No retry is attempted and no second POST is issued.");
    finish("CREATE_REJECTED_4XX", 6);
  }

  // --- H. Ambiguity: ONE read-only lookup, NEVER a second POST -----------
  if (verdict.classification === CreateClassification.AMBIGUOUS) {
    console.error("The create response was ambiguous. Performing ONE read-only exact-name lookup. A second POST is never issued.");
    const post = await lookupExact();
    if (post.ok && post.rows.length === 1 && templatesAreIdentical(post.rows[0], t.creation_payload)) {
      const s = String(post.rows[0].status ?? "").toUpperCase();
      record.status = s;
      record.template_id = post.rows[0].id ?? null;
      record.returned_category = String(post.rows[0].category ?? "").toUpperCase();
      record.readback_semantic_match = true;
      finish("RECOVERED_AFTER_AMBIGUOUS_CREATE", 0);
    }
    finish("MANUAL_RECONCILIATION_REQUIRED", 5);
  }

  const id = typeof createBody.id === "string" ? createBody.id : null;
  const status = typeof createBody.status === "string" ? createBody.status.toUpperCase() : null;
  const returnedCategory = typeof createBody.category === "string" ? createBody.category.toUpperCase() : null;
  record.template_id = id;
  record.status = status;
  record.returned_category = returnedCategory;

  if (!id || !status || !KNOWN_TEMPLATE_STATUSES.includes(status)) {
    finish("CREATE_RESPONSE_MALFORMED", 5);
  }
  if (returnedCategory && returnedCategory !== String(t.category).toUpperCase()) {
    console.error(`Meta returned category ${returnedCategory}, requested ${t.category}. Recorded; stopping for owner review. Nothing edited or deleted.`);
    finish("META_RECATEGORISED", 6);
  }
  console.log(`CREATED       ${t.internal_template_key} -> ${status}`);

  // --- Post-create readback: prove the remote state semantically ----------
  const readback = await lookupExact();
  if (!readback.ok || readback.rows.length !== 1
      || !templatesAreIdentical(readback.rows[0], t.creation_payload)) {
    record.readback_semantic_match = false;
    finish("MANUAL_RECONCILIATION_REQUIRED", 5);
  }
  record.readback_semantic_match = true;
  record.status = String(readback.rows[0].status ?? status).toUpperCase();
  record.template_id = readback.rows[0].id ?? id;
  finish(record.status === "APPROVED" ? "CREATED_APPROVED" : "CREATED_PENDING", 0);
}
