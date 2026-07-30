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
  const WAVE = argv.includes("--wave") ? Number(argv[argv.indexOf("--wave") + 1]) : NaN;

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
  const held = selected.filter((t) => t.submit_now !== true);
  const submittable = selected.filter((t) => t.submit_now === true);

  console.log(`Mode           : ${EXECUTE ? "EXECUTE" : "DRY RUN (no network call)"}`);
  console.log(`Wave           : ${WAVE}`);
  console.log(`Selected       : ${selected.length}`);
  console.log(`Submittable    : ${submittable.length}`);
  console.log(`Held (submit_now=false): ${held.length}${held.length ? " -> " + held.map((t) => t.internal_template_key).join(", ") : ""}`);
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
    console.log("To create these, re-run with --execute and QF_META_GRAPH_API_VERSION, QF_META_WABA_ID and QF_META_ACCESS_TOKEN exported.");
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // EXECUTE path.
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
  if (submittable.length !== 1) {
    console.error(`Refusing to execute: this operator creates ONE template per run; wave ${WAVE} has ${submittable.length} submittable.`);
    process.exit(2);
  }

  const API_VERSION = process.env.QF_META_GRAPH_API_VERSION;
  const WABA_ID = process.env.QF_META_WABA_ID;
  const auth = { Authorization: `Bearer ${process.env.QF_META_ACCESS_TOKEN}`, "Content-Type": "application/json" };
  const base = `${GRAPH}/${API_VERSION}/${WABA_ID}`;
  const stamp = () => new Date().toISOString();
  const reqId = (res) => res.headers.get("x-fb-request-id") ?? res.headers.get("x-fb-trace-id") ?? null;

  console.log(`API version    : ${API_VERSION}`);   // version is not a secret
  const t = submittable[0];
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
  };

  const finish = (outcome, code) => {
    record.outcome = outcome;
    const path = `QF-MVP-40-WAVE0-META-SUBMISSION-${stamp().replace(/[:.]/g, "-")}.json`;
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
    const res = await fetch(url, { headers: auth });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !Array.isArray(body.data)) {
      return { ok: false, httpStatus: res.status, requestId: reqId(res) };
    }
    const rows = body.data.filter((r) => r && r.name === t.provider_template_name
      && r.language === t.provider_language);
    return { ok: true, rows, httpStatus: res.status, requestId: reqId(res) };
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
  let createRes = null;
  let createBody = null;
  let ambiguous = false;
  try {
    createRes = await fetch(`${base}/message_templates`, {
      method: "POST", headers: auth, body: JSON.stringify(t.creation_payload),
    });
    record.http_status = createRes.status;
    record.request_id = reqId(createRes);
    createBody = await createRes.json().catch(() => null);
    if (!createRes.ok || !createBody || typeof createBody !== "object") ambiguous = true;
  } catch {
    ambiguous = true;
  }
  record.response_utc = stamp();

  // --- H. Ambiguity: ONE read-only lookup, NEVER a second POST -----------
  if (ambiguous) {
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
