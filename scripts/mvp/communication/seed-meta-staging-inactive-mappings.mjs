// ============================================================================
// QF-MVP-40.12 — controlled STAGING inactive-mapping seed operator.
//
// Seeds exactly EIGHT approved-but-INACTIVE rows into the EXISTING
// public.communication_provider_template_mappings table, and ensures exactly ONE
// deliberately DISABLED public.communication_provider_accounts row — in STAGING ONLY.
//
// SAFETY SHAPE
//   default              OFFLINE DRY RUN — no credential, no network, no database.
//   --preflight-readonly STAGING reads + Meta GET-only verification. ZERO writes.
//   --execute            ONE controlled staging write. Requires --preflight-readonly
//                        to have been satisfied in the same process.
//
// This operator can never send a WhatsApp message: it contains no `/messages`
// endpoint and issues no Meta POST/PUT/PATCH/DELETE. Every Meta call is a GET. It
// runs no migration and no DDL. It never activates a mapping, a provider account or a
// runtime policy, and it never retries after an uncertain write.
// ============================================================================

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Authorized target. The staging ref is the ONLY permitted project, and the two
// forbidden refs are named explicitly so a mistyped or swapped URL cannot pass by
// merely failing to look like production.
// ---------------------------------------------------------------------------
export const AUTHORIZED_STAGING_REF = "uckafzuochmbvtiodmcl";
export const FORBIDDEN_PROJECT_REFS = Object.freeze({
  production: "yqpgcsduqbxulrlzwzap",
  jarvis: "coilipywdvxklewquqvv",
});

export const PROVIDER_KEY = "meta_whatsapp_cloud";
export const CHANNEL = "whatsapp";
export const LANGUAGE = "en";
export const PROVIDER_CATEGORY = "utility";

/** The exact eight, in the exact reviewed order. A ninth is never seeded. */
export const SEED_SET = Object.freeze([
  { key: "consent_help_response", name: "qf_consent_help_response_v3",
    fingerprint: "12f98c8b9504194ef9d983a606c9edd1c083dab1ba187915bdbea85fbc3e6c87",
    classification: "EVIDENCE_BOUND_ACK" },
  { key: "consent_stop_acknowledgement", name: "qf_consent_stop_acknowledgement_v1",
    fingerprint: "850a4c01a48b78e237a85e186a448d8395abfb1e5049aaf6d8176b8628747268",
    classification: "EVIDENCE_BOUND_ACK" },
  { key: "consent_start_acknowledgement", name: "qf_consent_start_acknowledgement_v1",
    fingerprint: "70c0ce994180c2ea62ff3413d12d460734f5c004c40eb4d056925feec7e7251a",
    classification: "EVIDENCE_BOUND_ACK" },
  { key: "lead_received", name: "qf_lead_received_v1",
    fingerprint: "dd818e01d293a683b3685f1f246f8cba6b1e4f8e6e106bcab72c4739af640e16",
    classification: "ORDINARY_BUSINESS" },
  { key: "client_lead_status_update", name: "qf_client_lead_status_update_v1",
    fingerprint: "ce8982c652515e2434abb2159a4024a199de54cede0bd1f95552eb8d6270e7ac",
    classification: "ORDINARY_BUSINESS" },
  { key: "client_matching_update", name: "qf_client_matching_update_v1",
    fingerprint: "c0930db5a9beee61de0076caf234b36f950554bc21c60b697845028a8d057e1c",
    classification: "ORDINARY_BUSINESS" },
  { key: "lead_assignment_alert", name: "qf_lead_assignment_alert_v1",
    fingerprint: "3f7997be7b8e1b019ba306a058b96f2d68aa84b7a014ea96407510030bb02453",
    classification: "ORDINARY_BUSINESS" },
  { key: "vendor_onboarding_reminder", name: "qf_vendor_onboarding_reminder_v1",
    fingerprint: "c6e95a38dde899f717999520082feddf4c91f2a33c84650c72538ef2c111199a",
    classification: "ORDINARY_BUSINESS" },
]);

/** The provider account must land in — and stay in — a non-sendable state. */
export const REQUIRED_DISABLED_ACCOUNT_STATE = Object.freeze({
  readiness_status: "disabled",
  configuration_status: "partial",
  webhook_status: "pending",
  health_status: "unknown",
  billing_status: "unknown",
  business_verification_status: "unknown",
  phone_number_status: "unknown",
});
/** Values that would make the account send-capable. Writing any of them is a bug. */
export const FORBIDDEN_ACCOUNT_STATE = Object.freeze({
  readiness_status: "provider_ready",
  configuration_status: "complete",
  webhook_status: "verified",
  health_status: "healthy",
});

export const SeedFailure = Object.freeze({
  MODE_MISSING: "MODE_MISSING",
  UNKNOWN_FLAG: "UNKNOWN_FLAG",
  MODE_CONFLICT: "MODE_CONFLICT",
  ENV_MISSING: "ENV_MISSING",
  STAGING_URL_MALFORMED: "STAGING_URL_MALFORMED",
  PROJECT_REF_NOT_AUTHORIZED: "PROJECT_REF_NOT_AUTHORIZED",
  PROJECT_REF_FORBIDDEN_PRODUCTION: "PROJECT_REF_FORBIDDEN_PRODUCTION",
  PROJECT_REF_FORBIDDEN_JARVIS: "PROJECT_REF_FORBIDDEN_JARVIS",
  GRAPH_API_VERSION_INVALID: "GRAPH_API_VERSION_INVALID",
  IDENTIFIER_MALFORMED: "IDENTIFIER_MALFORMED",
  SCHEMA_MISSING: "SCHEMA_MISSING",
  INDEX_MISSING: "INDEX_MISSING",
  INTERNAL_TEMPLATE_MISSING: "INTERNAL_TEMPLATE_MISSING",
  ACTIVE_MAPPING_PRESENT: "ACTIVE_MAPPING_PRESENT",
  MAPPING_CONFLICT: "MAPPING_CONFLICT",
  BINDING_SCHEMA_UNPROVEN: "BINDING_SCHEMA_UNPROVEN",
  ACCOUNT_AMBIGUOUS: "ACCOUNT_AMBIGUOUS",
  ACCOUNT_IDENTITY_CONFLICT: "ACCOUNT_IDENTITY_CONFLICT",
  ACCOUNT_SEND_CAPABLE: "ACCOUNT_SEND_CAPABLE",
  RUNTIME_POLICY_SENDABLE: "RUNTIME_POLICY_SENDABLE",
  META_TEMPLATE_UNRESOLVED: "META_TEMPLATE_UNRESOLVED",
  META_TEMPLATE_AMBIGUOUS: "META_TEMPLATE_AMBIGUOUS",
  META_CATEGORY_MISMATCH: "META_CATEGORY_MISMATCH",
  META_STATUS_NOT_APPROVED: "META_STATUS_NOT_APPROVED",
  META_IDENTITY_MISMATCH: "META_IDENTITY_MISMATCH",
  PREFLIGHT_NOT_SATISFIED: "PREFLIGHT_NOT_SATISFIED",
  WRITE_OUTCOME_UNCERTAIN: "WRITE_OUTCOME_UNCERTAIN",
  READBACK_MISMATCH: "READBACK_MISMATCH",
});

// ---------------------------------------------------------------------------
// PURE helpers — exported so the validator can drive them without any network,
// database or credential.
// ---------------------------------------------------------------------------

/** Parse the project ref out of an https Supabase project URL. Null when malformed. */
export function parseProjectRef(url) {
  if (typeof url !== "string" || url.trim() === "") return null;
  let parsed;
  try { parsed = new URL(url.trim()); } catch { return null; }
  if (parsed.protocol !== "https:") return null;
  const m = parsed.hostname.match(/^([a-z0-9]{20})\.supabase\.(co|in)$/);
  return m ? m[1] : null;
}

/**
 * The environment identity fence. It runs BEFORE any client is constructed and before
 * the first database request. It never returns, prints or logs a secret value — only
 * presence booleans and the (non-secret) project ref.
 */
export function resolveStagingTarget(env = {}) {
  const url = env.QF_STAGING_SUPABASE_URL;
  if (!url) return { ok: false, reason: SeedFailure.ENV_MISSING, missing: "QF_STAGING_SUPABASE_URL" };
  const ref = parseProjectRef(url);
  if (!ref) return { ok: false, reason: SeedFailure.STAGING_URL_MALFORMED };
  if (ref === FORBIDDEN_PROJECT_REFS.production) {
    return { ok: false, reason: SeedFailure.PROJECT_REF_FORBIDDEN_PRODUCTION };
  }
  if (ref === FORBIDDEN_PROJECT_REFS.jarvis) {
    return { ok: false, reason: SeedFailure.PROJECT_REF_FORBIDDEN_JARVIS };
  }
  if (ref !== AUTHORIZED_STAGING_REF) {
    return { ok: false, reason: SeedFailure.PROJECT_REF_NOT_AUTHORIZED };
  }
  if (!env.QF_STAGING_SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, reason: SeedFailure.ENV_MISSING, missing: "QF_STAGING_SUPABASE_SERVICE_ROLE_KEY" };
  }
  for (const k of ["QF_META_ACCESS_TOKEN", "QF_META_WABA_ID", "QF_META_PHONE_NUMBER_ID",
                   "QF_META_GRAPH_API_VERSION"]) {
    if (!env[k]) return { ok: false, reason: SeedFailure.ENV_MISSING, missing: k };
  }
  if (!/^v\d+\.\d+$/.test(env.QF_META_GRAPH_API_VERSION)) {
    return { ok: false, reason: SeedFailure.GRAPH_API_VERSION_INVALID };
  }
  // Identifier-shaped only. The values are never echoed anywhere.
  for (const k of ["QF_META_WABA_ID", "QF_META_PHONE_NUMBER_ID"]) {
    if (!/^\d{6,}$/.test(env[k])) return { ok: false, reason: SeedFailure.IDENTIFIER_MALFORMED, field: k };
  }
  return { ok: true, projectRef: ref, environment: "STAGING" };
}

/**
 * Build the canonical binding schema for a mapping row.
 *
 * CRITICAL: it REFUSES to fabricate. A mapping's `variables_schema` drives
 * `renderWhatsAppTemplateComponents`, which resolves each positional parameter through a
 * named `sourceKey`. If a template declares variables but the repository has not proven
 * those source keys, an invented schema would silently render the WRONG value into a real
 * customer message once the mapping is activated. An empty schema is legitimate ONLY when
 * the authoritative template genuinely has no variables.
 */
export function buildCanonicalBindingSchema(manifestEntry) {
  const vars = manifestEntry?.variables_schema ?? {};
  const positions = Object.keys(vars);
  const readiness = manifestEntry?.binding_contract?.binding_readiness ?? null;

  if (positions.length === 0) {
    return { ok: true, schema: { bindingVersion: 1, bindings: [] }, basis: "NO_VARIABLES" };
  }
  if (readiness !== "resolved") {
    return {
      ok: false,
      reason: SeedFailure.BINDING_SCHEMA_UNPROVEN,
      detail: `${manifestEntry.internal_template_key}: declares ${positions.length} variable(s) but `
        + `binding_readiness is "${readiness}" — source keys are not proven from repository call `
        + "sites, so a canonical variables_schema cannot be derived without fabricating it.",
    };
  }
  const bindings = positions
    .map((p) => Number(p))
    .sort((a, b) => a - b)
    .map((position) => {
      const sourceKey = vars[String(position)]?.source_key;
      return sourceKey ? { component: "body", position, sourceKey, parameterType: "text" } : null;
    });
  if (bindings.some((b) => b === null)) {
    return { ok: false, reason: SeedFailure.BINDING_SCHEMA_UNPROVEN,
      detail: `${manifestEntry.internal_template_key}: a declared variable has no proven source_key.` };
  }
  return { ok: true, schema: { bindingVersion: 1, bindings }, basis: "PROVEN_SOURCE_KEYS" };
}

/** Parse and validate CLI flags. An unknown flag is refused rather than ignored. */
export function resolveMode(argv = []) {
  const known = new Set(["--preflight-readonly", "--execute"]);
  const unknown = argv.filter((a) => a.startsWith("--") && !known.has(a));
  if (unknown.length > 0) return { ok: false, reason: SeedFailure.UNKNOWN_FLAG, flag: unknown[0] };
  const preflight = argv.includes("--preflight-readonly");
  const execute = argv.includes("--execute");
  if (preflight && execute) return { ok: false, reason: SeedFailure.MODE_CONFLICT };
  if (execute) return { ok: true, mode: "EXECUTE", network: true, writes: true };
  if (preflight) return { ok: true, mode: "PREFLIGHT_READONLY", network: true, writes: false };
  return { ok: true, mode: "DRY_RUN", network: false, writes: false };
}

/** Classify an existing mapping row against the intended seed row. */
export function classifyExistingMapping(existing, intended) {
  if (!existing) return { outcome: "MISSING" };
  if (existing.is_active === true) {
    return { outcome: "CONFLICT", reason: SeedFailure.ACTIVE_MAPPING_PRESENT };
  }
  const same = existing.provider_template_name === intended.provider_template_name
    && existing.language === intended.language
    && existing.provider_key === intended.provider_key
    && existing.channel === intended.channel
    && existing.version === intended.version
    && (existing.provider_category ?? null) === intended.provider_category
    && JSON.stringify(existing.variables_schema ?? null) === JSON.stringify(intended.variables_schema);
  if (!same) return { outcome: "CONFLICT", reason: SeedFailure.MAPPING_CONFLICT };
  return { outcome: "ALREADY_PRESENT_INACTIVE" };
}

/** An account row may be reused only when it is unambiguous and not send-capable. */
export function classifyExistingAccount(rows, identity) {
  if (!Array.isArray(rows) || rows.length === 0) return { outcome: "CREATE_DISABLED" };
  if (rows.length > 1) return { outcome: "ABORT", reason: SeedFailure.ACCOUNT_AMBIGUOUS };
  const r = rows[0];
  if (r.readiness_status === FORBIDDEN_ACCOUNT_STATE.readiness_status) {
    return { outcome: "ABORT", reason: SeedFailure.ACCOUNT_SEND_CAPABLE };
  }
  const conflict = (a, b) => a != null && b != null && a !== b;
  if (conflict(r.business_account_reference, identity.business_account_reference)
      || conflict(r.phone_number_reference, identity.phone_number_reference)) {
    return { outcome: "ABORT", reason: SeedFailure.ACCOUNT_IDENTITY_CONFLICT };
  }
  const exact = r.readiness_status === REQUIRED_DISABLED_ACCOUNT_STATE.readiness_status
    && r.business_account_reference === identity.business_account_reference
    && r.phone_number_reference === identity.phone_number_reference;
  return exact ? { outcome: "ALREADY_PRESENT_DISABLED" } : { outcome: "NORMALIZED_DISABLED" };
}

/** Sanitize any value before it can reach a log or an evidence file. */
export function sanitizeForEvidence(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/EAA[A-Za-z0-9]{6,}/g, "[REDACTED_TOKEN]")
    .replace(/eyJ[A-Za-z0-9._-]{10,}/g, "[REDACTED_JWT]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[REDACTED_UUID]")
    .replace(/https:\/\/[a-z0-9]{20}\.supabase\.(co|in)/gi, "[REDACTED_PROJECT_URL]")
    .replace(/(?<![\w.])\d{10,}(?![\w.])/g, "[REDACTED_ID]");
}

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const isDirect = process.argv[1] && process.argv[1].endsWith("seed-meta-staging-inactive-mappings.mjs");
if (isDirect) {
  const modeResult = resolveMode(process.argv.slice(2));
  if (!modeResult.ok) {
    console.error(`REFUSED: ${modeResult.reason}${modeResult.flag ? ` (${modeResult.flag})` : ""}`);
    process.exit(2);
  }
  const { mode } = modeResult;

  console.log(`Phase          : QF-MVP-40.12`);
  console.log(`Mode           : ${mode}`);
  console.log(`Authorized ref : ${AUTHORIZED_STAGING_REF} (STAGING)`);
  console.log(`Forbidden refs : production, jarvis — both rejected by exact ref`);
  console.log(`Templates      : ${SEED_SET.length}`);
  console.log("");

  // ---- Canonical binding-schema fence (offline; runs in EVERY mode) --------
  // This is checked before anything else touches the network, because a seed that
  // cannot build an authoritative variables_schema must never reach a database.
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const manifest = JSON.parse(readFileSync(
    resolve("docs/provider-manifests/whatsapp-template-submission-manifest.json"), "utf8"));
  const byKey = new Map(Object.values(manifest.groups).flat()
    .map((t) => [t.internal_template_key, t]));

  const unproven = [];
  for (const t of SEED_SET) {
    const built = buildCanonicalBindingSchema(byKey.get(t.key));
    const label = built.ok ? `OK (${built.basis})` : `BLOCKED (${built.reason})`;
    console.log(`  ${t.key.padEnd(30)} ${t.classification.padEnd(19)} binding: ${label}`);
    if (!built.ok) unproven.push(built.detail);
  }
  console.log("");

  if (unproven.length > 0) {
    console.error("BLOCKED — CANONICAL BINDING SCHEMA UNPROVEN");
    console.error("");
    for (const d of unproven) console.error(`  - ${d}`);
    console.error("");
    console.error(`${unproven.length} of ${SEED_SET.length} templates cannot have an authoritative`);
    console.error("variables_schema derived. Seeding them would require FABRICATING binding source");
    console.error("keys. A fabricated schema renders the wrong value into a real customer message");
    console.error("once the mapping is activated, so the seed refuses rather than guesses.");
    console.error("");
    console.error("Resolve binding source keys from repository call sites (Phase 5F-D governance),");
    console.error("set binding_readiness to \"resolved\" with a proven source_key per variable, then");
    console.error("re-run. NO DATABASE CONNECTION WAS OPENED. NO WRITE WAS PERFORMED.");
    process.exit(3);
  }

  if (mode === "DRY_RUN") {
    console.log("Planned provider account : DISABLED (readiness_status=disabled, never provider_ready)");
    console.log("Planned mappings         : INACTIVE (is_active=false, provider_template_id=null)");
    console.log("Writes performed         : 0");
    console.log("Database connections     : 0");
    console.log("Meta calls               : 0");
    console.log("");
    console.log("DRY RUN COMPLETE. No credential was read, no client was constructed, nothing was written.");
    console.log("Next: --preflight-readonly (staging reads + Meta GET only), then a single --execute.");
    process.exit(0);
  }

  // ---- Environment identity fence (before ANY client construction) ---------
  const target = resolveStagingTarget(process.env);
  if (!target.ok) {
    console.error(`REFUSED: ${target.reason}${target.missing ? ` (${target.missing})` : ""}`);
    console.error("No Supabase client was constructed. No database request was issued.");
    process.exit(2);
  }
  console.error("REFUSED: PREFLIGHT_NOT_SATISFIED — live staging execution is gated on the "
    + "canonical binding schema fence above and on an explicit owner-authorized run.");
  process.exit(2);
}
