// ============================================================================
// QF-MVP-40.12 â€” controlled STAGING inactive-mapping seed operator.
//
// Seeds exactly EIGHT approved-but-INACTIVE rows into the EXISTING
// public.communication_provider_template_mappings table, and ensures exactly ONE
// deliberately DISABLED public.communication_provider_accounts row â€” in STAGING ONLY.
//
// SAFETY SHAPE
//   default              OFFLINE DRY RUN â€” no credential, no network, no database.
//   --preflight-readonly STAGING reads + Meta GET-only verification. ZERO writes.
//   --execute            ONE controlled staging write. Because every npm invocation is a
//                        SEPARATE process, this cannot rely on an in-memory flag: it
//                        reruns the FULL read-only preflight AND requires a fresh,
//                        single-use, 15-minute attestation written by that preflight,
//                        stored outside the repository.
//
// This operator can never send a WhatsApp message: it contains no `/messages`
// endpoint and issues no Meta POST/PUT/PATCH/DELETE. Every Meta call is a GET. It
// runs no migration and no DDL. It never activates a mapping, a provider account or a
// runtime policy, and it never retries after an uncertain write.
// ============================================================================

import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve as resolvePath } from "node:path";
// The REAL semantic comparator, reused rather than re-implemented: a weaker local copy
// is exactly how a "semantic match" stops meaning anything.
import { templatesAreIdentical } from "./submit-meta-templates.mjs";

/** True when a path resolves inside this repository â€” evidence/proofs must not. */
export function isInsideRepository(p, root = process.cwd()) {
  if (typeof p !== "string" || p.trim() === "") return false;
  const abs = isAbsolute(p) ? p : resolvePath(root, p);
  const rel = relative(resolvePath(root), abs);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

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

/** The provider account must land in â€” and stay in â€” a non-sendable state. */
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
  INDEX_PROOF_UNAVAILABLE: "INDEX_PROOF_UNAVAILABLE",
  ATTESTATION_MISSING: "ATTESTATION_MISSING",
  ATTESTATION_EXPIRED: "ATTESTATION_EXPIRED",
  ATTESTATION_MISMATCH: "ATTESTATION_MISMATCH",
  ATTESTATION_ALREADY_CONSUMED: "ATTESTATION_ALREADY_CONSUMED",
  ATTESTATION_TAMPERED: "ATTESTATION_TAMPERED",
});

/** An attestation is single-use and short-lived: a stale plan must never authorize a write. */
export const ATTESTATION_TTL_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// PURE helpers â€” exported so the validator can drive them without any network,
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
 * the first database request. It never returns, prints or logs a secret value â€” only
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
export function buildCanonicalBindingSchema(manifestEntry, codeContract = null) {
  const key = manifestEntry?.internal_template_key;
  const vars = manifestEntry?.variables_schema ?? {};
  const positions = Object.keys(vars);
  const readiness = manifestEntry?.binding_contract?.binding_readiness ?? null;
  const fail = (detail) => ({ ok: false, reason: SeedFailure.BINDING_SCHEMA_UNPROVEN, detail });

  if (positions.length === 0) {
    // A zero-variable template is authoritative on its own: there is no name to prove.
    if (codeContract) return fail(`${key}: declares no variables but a code contract exists for it.`);
    return { ok: true, schema: { bindingVersion: 1, bindings: [] }, basis: "NO_VARIABLES" };
  }
  if (readiness !== "resolved") {
    return fail(`${key}: declares ${positions.length} variable(s) but binding_readiness is `
      + `"${readiness}" â€” source keys are not proven from repository call sites, so a canonical `
      + "variables_schema cannot be derived without fabricating it.");
  }

  // QF-MVP-40.12-R1: a docs-only source_key is NOT sufficient. The manifest is one
  // authority; the typed code contract is the other, and both must agree exactly. A
  // manifest edit alone can therefore never unlock a seed.
  if (!codeContract) {
    return fail(`${key}: the manifest says resolved, but no canonical code contract was supplied `
      + "for it â€” a docs-only source_key is never accepted.");
  }
  if (codeContract.templateKey !== key) return fail(`${key}: code contract is for a different template.`);
  if (codeContract.bindingVersion !== 1) return fail(`${key}: code contract binding version is not 1.`);

  const manifestBindings = positions
    .map((p) => Number(p))
    .sort((a, b) => a - b)
    .map((position) => {
      const sourceKey = vars[String(position)]?.source_key;
      return sourceKey ? { component: "body", position, sourceKey, parameterType: "text" } : null;
    });
  if (manifestBindings.some((b) => b === null)) {
    return fail(`${key}: a declared variable has no proven source_key.`);
  }
  const seen = new Set(manifestBindings.map((b) => b.sourceKey));
  if (seen.size !== manifestBindings.length) return fail(`${key}: duplicate source_key in the manifest.`);

  const codeBindings = codeContract.bindings.slice().sort((a, b) => a.position - b.position);
  if (codeBindings.length !== manifestBindings.length) {
    return fail(`${key}: manifest declares ${manifestBindings.length} binding(s) but the code `
      + `contract declares ${codeBindings.length}.`);
  }
  for (let i = 0; i < codeBindings.length; i += 1) {
    const m = manifestBindings[i], c = codeBindings[i];
    if (m.position !== c.position) return fail(`${key}: binding position mismatch (manifest ${m.position} vs code ${c.position}).`);
    if (m.sourceKey !== c.sourceKey) return fail(`${key}: source_key mismatch at position ${m.position} (manifest "${m.sourceKey}" vs code "${c.sourceKey}").`);
    if (m.parameterType !== c.parameterType) return fail(`${key}: parameter_type mismatch at position ${m.position}.`);
    if (m.component !== c.component) return fail(`${key}: component mismatch at position ${m.position}.`);
  }
  return { ok: true, schema: { bindingVersion: 1, bindings: manifestBindings }, basis: "PROVEN_SOURCE_KEYS" };
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

/**
 * Canonical semantic JSON equality for values round-tripped through PostgreSQL jsonb.
 *
 * jsonb preserves JSON meaning but does NOT preserve object-key insertion order.
 * Arrays remain ordered because array order is semantically significant.
 */
export function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJsonValue(value[key])])
    );
  }
  return value;
}

export function jsonSemanticEqual(left, right) {
  return JSON.stringify(canonicalJsonValue(left ?? null))
    === JSON.stringify(canonicalJsonValue(right ?? null));
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
    && jsonSemanticEqual(existing.variables_schema, intended.variables_schema);
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

// ===========================================================================
// RUNTIME â€” read-only preflight, cross-process attestation, controlled execute.
//
// Every external effect goes through an injected PORT (deps.db, deps.meta,
// deps.store, deps.now). The CLI wires the real Supabase/fetch adapters; the
// validator wires fakes, so the test suite makes no live call whatsoever.
// ===========================================================================

/** Canonical mapping row for one template. Never carries a remote id. */
export function buildMappingRow(seed, version, variablesSchema) {
  return {
    template_key: seed.key,
    channel: CHANNEL,
    provider_key: PROVIDER_KEY,
    language: LANGUAGE,
    version,
    provider_template_name: seed.name,
    provider_template_id: null,
    provider_category: PROVIDER_CATEGORY,
    approval_status: "approved",
    variables_schema: variablesSchema,
    is_active: false,
  };
}


// ===========================================================================
// QF-MVP-40.12-R3 â€” external index proof, whole-set mapping scan.
// ===========================================================================

/**
 * The exact index definitions the seed depends on. The row-level unique index is the
 * deterministic conflict target; the PARTIAL one makes two competing active mappings
 * structurally impossible. Both must be proven â€” never assumed, never permanently
 * excepted.
 */
export const REQUIRED_INDEXES = Object.freeze([
  Object.freeze({
    name: "uq_comm_provider_template_active",
    unique: true,
    columns: Object.freeze(["template_key", "channel", "provider_key", "language"]),
    predicate: "is_active",
  }),
  Object.freeze({
    name: "uq_comm_provider_template_mapping",
    unique: true,
    columns: Object.freeze(["template_key", "channel", "provider_key", "language", "version"]),
    predicate: null,
  }),
]);
export const INDEX_PROOF_TABLE = "public.communication_provider_template_mappings";
/** A small tolerance for clock skew; a proof from the future is otherwise refused. */
export const INDEX_PROOF_CLOCK_TOLERANCE_MS = 60 * 1000;

/** Deterministic digest of an index proof body (its own signature excluded). */
export function indexProofDigest(proof) {
  const body = { ...proof };
  delete body.proof_sha256;
  return sha256(JSON.stringify(body));
}

/**
 * Verify a FRESH external index proof.
 *
 * PostgREST cannot read pg_indexes, and this phase may add no RPC, DDL or migration â€”
 * so the proof is produced out of band by direct read-only SQL and handed in by path.
 * It is deliberately NOT a standing exception: it expires, it is pinned into the
 * attestation, and --execute re-verifies it. A missing, expired, future-dated,
 * malformed, tampered, wrong-project or wrong-definition proof is refused.
 */
export function verifyIndexProof(proof, opts = {}) {
  const now = opts.now ?? (() => Date.now());
  const projectRef = opts.projectRef ?? AUTHORIZED_STAGING_REF;
  const bad = (detail) => ({ ok: false, reason: SeedFailure.INDEX_PROOF_UNAVAILABLE, detail });

  if (!proof || typeof proof !== "object") return bad("no proof supplied");
  if (proof.artifact !== "qf-mvp-40-12-staging-index-proof") return bad("wrong artifact");
  if (proof.environment !== "STAGING") return bad("not a staging proof");
  if (proof.project_ref !== projectRef) return bad("wrong project ref");
  if (proof.table !== INDEX_PROOF_TABLE) return bad("wrong table");
  if (proof.source !== "SUPABASE_DIRECT_READ_ONLY_SQL") return bad("unrecognised source");
  if (typeof proof.nonce !== "string" || proof.nonce.length === 0) return bad("missing nonce");

  if (typeof proof.proof_sha256 !== "string" || proof.proof_sha256 !== indexProofDigest(proof)) {
    return bad("digest mismatch â€” the proof was altered after it was issued");
  }
  const t = now();
  if (typeof proof.issued_at_ms !== "number" || typeof proof.expires_at_ms !== "number") {
    return bad("missing issued/expiry timestamps");
  }
  if (proof.issued_at_ms > t + INDEX_PROOF_CLOCK_TOLERANCE_MS) return bad("issued in the future");
  if (proof.expires_at_ms - proof.issued_at_ms > ATTESTATION_TTL_MS) return bad("ttl exceeds 15 minutes");
  if (t > proof.expires_at_ms) return bad("expired");

  const got = Array.isArray(proof.indexes) ? proof.indexes : null;
  if (!got) return bad("indexes is not an array");
  if (got.length !== REQUIRED_INDEXES.length) return bad(`expected ${REQUIRED_INDEXES.length} indexes`);
  for (const want of REQUIRED_INDEXES) {
    const found = got.filter((i) => i && i.name === want.name);
    if (found.length !== 1) return bad(`index ${want.name}: expected exactly one entry`);
    const i = found[0];
    if (i.unique !== true) return bad(`index ${want.name}: not unique`);
    if (!Array.isArray(i.columns)) return bad(`index ${want.name}: columns missing`);
    // Column ORDER is part of the definition: a reordered index is a different index.
    if (i.columns.join(",") !== want.columns.join(",")) return bad(`index ${want.name}: column order`);
    if ((i.predicate ?? null) !== want.predicate) return bad(`index ${want.name}: predicate`);
  }
  return { ok: true, proof_hash: proof.proof_sha256, nonce: proof.nonce,
           expires_at_ms: proof.expires_at_ms };
}

/**
 * WHOLE-SET scan across every row for the eight keys â€” not just the canonical tuple.
 * An active row on ANOTHER version or language, a duplicate tuple, an extra
 * non-canonical row, a populated remote id or a non-approved row would all be invisible
 * to a per-tuple check, yet any of them makes the seed unsafe.
 */
export function scanMappingSet(rows, canonicalByKey) {
  const keys = new Set(SEED_SET.map((t) => t.key));
  const mine = (rows ?? []).filter((r) => r.provider_key === PROVIDER_KEY && r.channel === CHANNEL);
  const bad = (reason, detail) => ({ ok: false, reason, detail });

  for (const r of mine) {
    if (!keys.has(r.template_key)) continue;                 // not ours to judge
    if (r.is_active === true) {
      return bad(SeedFailure.ACTIVE_MAPPING_PRESENT,
        `${r.template_key}: an ACTIVE row exists (language ${r.language}, version ${r.version})`);
    }
    if (r.provider_template_id !== null && r.provider_template_id !== undefined) {
      return bad(SeedFailure.MAPPING_CONFLICT, `${r.template_key}: a remote template id is stored`);
    }
    if (r.approval_status !== "approved") {
      return bad(SeedFailure.MAPPING_CONFLICT, `${r.template_key}: approval_status ${r.approval_status}`);
    }
    const canonical = canonicalByKey.get(r.template_key);
    if (!canonical) return bad(SeedFailure.MAPPING_CONFLICT, `${r.template_key}: no canonical row`);
    // Any row outside the canonical language/version is an extra we did not plan for.
    if (r.language !== canonical.language || r.version !== canonical.version) {
      return bad(SeedFailure.MAPPING_CONFLICT,
        `${r.template_key}: non-canonical row (language ${r.language}, version ${r.version})`);
    }
    if (r.provider_template_name !== canonical.provider_template_name) {
      return bad(SeedFailure.MAPPING_CONFLICT, `${r.template_key}: provider name differs`);
    }
    if ((r.provider_category ?? null) !== canonical.provider_category) {
      return bad(SeedFailure.MAPPING_CONFLICT, `${r.template_key}: category differs`);
    }
    if (!jsonSemanticEqual(r.variables_schema, canonical.variables_schema)) {
      return bad(SeedFailure.MAPPING_CONFLICT, `${r.template_key}: variables_schema differs`);
    }
  }

  // Duplicate canonical tuples: the row-level unique index should prevent this, but the
  // seed must not depend on the constraint it is about to rely on.
  const seen = new Map();
  for (const r of mine) {
    if (!keys.has(r.template_key)) continue;
    const tuple = `${r.template_key}|${r.language}|${r.version}`;
    seen.set(tuple, (seen.get(tuple) ?? 0) + 1);
  }
  for (const [tuple, n] of seen) {
    if (n > 1) return bad(SeedFailure.MAPPING_CONFLICT, `duplicate rows for ${tuple}`);
  }
  return { ok: true, existing: mine.filter((r) => keys.has(r.template_key)) };
}

/** Every internal template row must be unique, English and carry a canonical version. */
export function verifyInternalTemplates(rows) {
  const bad = (detail) => ({ ok: false, reason: SeedFailure.INTERNAL_TEMPLATE_MISSING, detail });
  const byKey = new Map();
  for (const r of rows ?? []) {
    if (byKey.has(r.template_key)) return bad(`${r.template_key}: duplicate internal template row`);
    byKey.set(r.template_key, r);
  }
  for (const t of SEED_SET) {
    const r = byKey.get(t.key);
    if (!r) return bad(`${t.key}: missing`);
    if (r.language !== LANGUAGE) return bad(`${t.key}: language is ${r.language}, expected ${LANGUAGE}`);
    if (typeof r.version !== "string" || r.version.trim() === "") {
      return bad(`${t.key}: canonical version is empty`);
    }
  }
  return { ok: true, byKey };
}

/** A runtime policy may exist, but it must never be in a sendable posture. */
export function runtimePolicyIsNonSendable(policy) {
  if (!policy) return true;                       // missing is the safest state
  if (policy.outbound_enabled === true) return false;
  return !["canary", "active"].includes(policy.activation_status);
}

/** Deterministic hash of the attestation body (the signature field excluded). */
export function attestationDigest(payload) {
  const body = { ...payload };
  delete body.attestation_sha256;
  return sha256(JSON.stringify(body));
}

/**
 * READ-ONLY preflight. Performs staging reads and Meta GETs through the injected
 * ports and returns a sanitized attestation payload. It issues ZERO writes: the db
 * port's write methods are never called on this path.
 */
export async function runReadOnlyPreflight(deps) {
  const { db, meta, now, head, branch, projectRef, manifestHash, readinessHash,
          bindingContractHash, nonce } = deps;
  const fail = (reason, detail) => ({ ok: false, reason, detail });

  // 1) Schema + index proof. Never repaired here, only proven.
  const schema = await db.proveSchema();
  if (!schema.ok) return fail(schema.reason ?? SeedFailure.SCHEMA_MISSING, schema.detail);
  const indexes = await db.proveIndexes();
  if (!indexes.ok) return fail(indexes.reason ?? SeedFailure.INDEX_PROOF_UNAVAILABLE, indexes.detail);

  // 2) The eight internal templates: unique, English, with a canonical version.
  const internal = await db.selectInternalTemplates(SEED_SET.map((t) => t.key));
  const internalCheck = verifyInternalTemplates(internal);
  if (!internalCheck.ok) return fail(internalCheck.reason, internalCheck.detail);
  const byInternal = internalCheck.byKey;

  // 3) Meta identity + GET-only reconciliation of all eight.
  const identity = await meta.verifyIdentity();
  if (!identity.ok) return fail(SeedFailure.META_IDENTITY_MISMATCH, identity.detail);
  const metaResults = [];
  for (const t of SEED_SET) {
    const r = await meta.getTemplateByName(t.name, deps.expectedPayloadFor(t.key));
    if (!r.ok) return fail(r.reason ?? SeedFailure.META_TEMPLATE_UNRESOLVED, t.key);
    if (r.matches !== 1) return fail(SeedFailure.META_TEMPLATE_AMBIGUOUS, t.key);
    if (r.status !== "APPROVED") return fail(SeedFailure.META_STATUS_NOT_APPROVED, t.key);
    if (r.category !== "UTILITY") return fail(SeedFailure.META_CATEGORY_MISMATCH, t.key);
    if (r.language !== LANGUAGE) return fail(SeedFailure.META_CATEGORY_MISMATCH, t.key + ": language");
    if (r.semanticMatch !== true) return fail(SeedFailure.META_TEMPLATE_UNRESOLVED, t.key + ": semantic");
    metaResults.push({ internal_template_key: t.key, status: "APPROVED", category: "UTILITY" });
  }

  // 4) Build the canonical rows, then scan the WHOLE set before classifying.
  const canonicalByKey = new Map();
  for (const t of SEED_SET) {
    const version = byInternal.get(t.key).version;
    const schemaForKey = deps.variablesSchemaFor(t.key);
    if (!schemaForKey) return fail(SeedFailure.BINDING_SCHEMA_UNPROVEN, t.key);
    canonicalByKey.set(t.key, buildMappingRow(t, version, schemaForKey));
  }
  const existing = await db.selectMappings(SEED_SET.map((t) => t.key));
  const scan = scanMappingSet(existing, canonicalByKey);
  if (!scan.ok) return fail(scan.reason, scan.detail);

  const mappingPlan = [];
  for (const t of SEED_SET) {
    const intended = canonicalByKey.get(t.key);
    const found = scan.existing.find((r) => r.template_key === t.key
      && r.language === intended.language && r.version === intended.version) ?? null;
    const c = classifyExistingMapping(found, intended);
    if (c.outcome === "CONFLICT") return fail(c.reason, t.key);
    mappingPlan.push({ key: t.key,
      outcome: c.outcome === "MISSING" ? "CREATE_INACTIVE" : c.outcome, intended });
  }

  // 5) Classify the provider account.
  const accounts = await db.selectAccounts();
  const accountClass = classifyExistingAccount(accounts, {
    business_account_reference: deps.wabaRef, phone_number_reference: deps.phoneRef });
  if (accountClass.outcome === "ABORT") return fail(accountClass.reason, "provider account");

  // 6) Runtime policy must not be sendable.
  const policy = await db.selectRuntimePolicy();
  if (!runtimePolicyIsNonSendable(policy)) return fail(SeedFailure.RUNTIME_POLICY_SENDABLE);

  const payload = {
    artifact: "qf-mvp-40-12-preflight-attestation",
    phase: "QF-MVP-40.12",
    head,
    branch,
    environment: "STAGING",
    project_ref: projectRef,
    issued_at_ms: now(),
    expires_at_ms: now() + ATTESTATION_TTL_MS,
    nonce,
    manifest_hash: manifestHash,
    readiness_hash: readinessHash,
    binding_contract_hash: bindingContractHash,
    template_keys: SEED_SET.map((t) => t.key),
    schema_proof: schema.proof,
    index_proof: indexes.proof,
    index_proof_hash: indexes.proof_hash ?? null,
    index_proof_expires_at_ms: indexes.expires_at_ms ?? null,
    meta_reconciliation: metaResults,
    mapping_plan: mappingPlan.map((m) => ({ key: m.key, outcome: m.outcome })),
    account_classification: accountClass.outcome,
    runtime_policy_non_sendable: true,
    writes_performed: 0,
  };
  payload.attestation_sha256 = attestationDigest(payload);
  return { ok: true, payload, mappingPlan, accountClass, byInternal };
}

/**
 * Verify a stored attestation against a FRESH preflight. Both must agree: the stored
 * one proves an owner-reviewed plan existed, and the fresh one proves the world has
 * not changed since. A replayed, expired, consumed or tampered attestation is refused.
 */
export function verifyAttestation(stored, fresh, now, consumedNonces = []) {
  if (!stored) return { ok: false, reason: SeedFailure.ATTESTATION_MISSING };
  if (stored.attestation_sha256 !== attestationDigest(stored)) {
    return { ok: false, reason: SeedFailure.ATTESTATION_TAMPERED };
  }
  if (typeof stored.expires_at_ms !== "number" || now() > stored.expires_at_ms) {
    return { ok: false, reason: SeedFailure.ATTESTATION_EXPIRED };
  }
  if (consumedNonces.includes(stored.nonce)) {
    return { ok: false, reason: SeedFailure.ATTESTATION_ALREADY_CONSUMED };
  }
  const mustMatch = ["head", "branch", "project_ref", "manifest_hash", "readiness_hash",
    "binding_contract_hash", "account_classification", "schema_proof", "index_proof_hash",
    "runtime_policy_non_sendable"];
  for (const f of mustMatch) {
    if (stored[f] !== fresh[f]) return { ok: false, reason: SeedFailure.ATTESTATION_MISMATCH, field: f };
  }
  if (stored.template_keys.join(",") !== fresh.template_keys.join(",")) {
    return { ok: false, reason: SeedFailure.ATTESTATION_MISMATCH, field: "template_keys" };
  }
  if (JSON.stringify(stored.mapping_plan) !== JSON.stringify(fresh.mapping_plan)) {
    return { ok: false, reason: SeedFailure.ATTESTATION_MISMATCH, field: "mapping_plan" };
  }
  if (JSON.stringify(stored.meta_reconciliation) !== JSON.stringify(fresh.meta_reconciliation)) {
    return { ok: false, reason: SeedFailure.ATTESTATION_MISMATCH, field: "meta_reconciliation" };
  }
  return { ok: true };
}

/**
 * A single write attempt. An error or an ambiguous result is terminal: the outcome is
 * UNCERTAIN and is never retried, because a blind retry could double-write.
 */
async function attemptWrite(fn) {
  try {
    const r = await fn();
    if (r === undefined || r === null) {
      return { ok: false, reason: SeedFailure.WRITE_OUTCOME_UNCERTAIN, detail: "no result" };
    }
    return { ok: true, result: r };
  } catch {
    // Deliberately no raw error: it can carry connection strings or row data.
    return { ok: false, reason: SeedFailure.WRITE_OUTCOME_UNCERTAIN, detail: "write threw" };
  }
}

/**
 * ONE controlled staging execution. It reruns the FULL read-only preflight, requires a
 * fresh matching attestation, then performs at most two writes: the disabled account and
 * one bulk insert of the missing inactive mappings. Any uncertainty stops without retry.
 */
export async function runControlledExecute(deps) {
  const fresh = await runReadOnlyPreflight(deps);
  if (!fresh.ok) return fresh;

  const stored = await deps.store.read();
  const consumed = await deps.store.consumedNonces();
  const v = verifyAttestation(stored, fresh.payload, deps.now, consumed);
  if (!v.ok) return { ok: false, reason: v.reason, detail: v.field };

  // --- Write 1: the provider account, DISABLED and never send-capable ------
  const accountOutcome = fresh.accountClass.outcome;
  if (accountOutcome === "CREATE_DISABLED" || accountOutcome === "NORMALIZED_DISABLED") {
    const row = {
      provider_key: PROVIDER_KEY,
      channel: CHANNEL,
      display_name: "QuickFurno Meta WhatsApp Cloud â€” Staging",
      business_account_reference: deps.wabaRef,
      phone_number_reference: deps.phoneRef,
      ...REQUIRED_DISABLED_ACCOUNT_STATE,
      metadata: { phase: "QF-MVP-40.12", environment: "staging", note: "seeded disabled; not sendable" },
    };
    for (const [k, bad] of Object.entries(FORBIDDEN_ACCOUNT_STATE)) {
      if (row[k] === bad) return { ok: false, reason: SeedFailure.ACCOUNT_SEND_CAPABLE, detail: k };
    }
    const w = await attemptWrite(accountOutcome === "CREATE_DISABLED"
      ? () => deps.db.insertAccount(row)
      : () => deps.db.normalizeAccountDisabled(row));
    if (!w.ok) return w;
  }

  // --- Write 2: exactly the missing mappings, in one bulk insert ----------
  const toCreate = fresh.mappingPlan.filter((m) => m.outcome === "CREATE_INACTIVE")
    .map((m) => m.intended);
  if (toCreate.some((r) => r.is_active !== false || r.provider_template_id !== null)) {
    return { ok: false, reason: SeedFailure.MAPPING_CONFLICT, detail: "unsafe row shape" };
  }
  if (toCreate.length > 0) {
    const w = await attemptWrite(() => deps.db.insertMappings(toCreate));
    if (!w.ok) return w;
  }

  // --- Readback proofs -----------------------------------------------------
  const after = await deps.db.selectMappings(SEED_SET.map((t) => t.key));
  const mineAfter = after.filter((r) => r.provider_key === PROVIDER_KEY && r.channel === CHANNEL
    && SEED_SET.some((t) => t.key === r.template_key));
  // Exactly eight rows in total â€” an extra version or language row is a failure, not noise.
  if (mineAfter.length !== SEED_SET.length) {
    return { ok: false, reason: SeedFailure.READBACK_MISMATCH, detail: "total " + mineAfter.length };
  }
  const relevant = mineAfter;
  for (const t of SEED_SET) {
    const forKey = relevant.filter((r) => r.template_key === t.key);
    if (forKey.length !== 1) {
      return { ok: false, reason: SeedFailure.READBACK_MISMATCH, detail: t.key + ": " + forKey.length + " rows" };
    }
    const r = forKey[0];
    const canonical = fresh.mappingPlan.find((m) => m.key === t.key).intended;
    if (r.is_active !== false) return { ok: false, reason: SeedFailure.READBACK_MISMATCH, detail: "active row" };
    if (r.approval_status !== "approved") return { ok: false, reason: SeedFailure.READBACK_MISMATCH, detail: "not approved" };
    if (r.provider_template_id !== null) return { ok: false, reason: SeedFailure.READBACK_MISMATCH, detail: "remote id" };
    if (r.provider_template_name !== t.name) return { ok: false, reason: SeedFailure.READBACK_MISMATCH, detail: "name" };
    if (r.provider_category !== PROVIDER_CATEGORY) return { ok: false, reason: SeedFailure.READBACK_MISMATCH, detail: "category" };
    if (r.language !== canonical.language) return { ok: false, reason: SeedFailure.READBACK_MISMATCH, detail: "language" };
    if (r.version !== canonical.version) return { ok: false, reason: SeedFailure.READBACK_MISMATCH, detail: "version" };
    if (!jsonSemanticEqual(r.variables_schema, canonical.variables_schema)) {
      return { ok: false, reason: SeedFailure.READBACK_MISMATCH, detail: "variables_schema" };
    }
  }
  const accountAfter = await deps.db.selectAccounts();
  if (accountAfter.length !== 1 || accountAfter[0].readiness_status !== "disabled") {
    return { ok: false, reason: SeedFailure.ACCOUNT_SEND_CAPABLE, detail: "post-write account" };
  }
  const policyAfter = await deps.db.selectRuntimePolicy();
  if (!runtimePolicyIsNonSendable(policyAfter)) {
    return { ok: false, reason: SeedFailure.RUNTIME_POLICY_SENDABLE, detail: "post-write policy" };
  }

  await deps.store.consume(fresh.payload.nonce);
  return {
    ok: true,
    account_outcome: accountOutcome,
    mapping_outcomes: fresh.mappingPlan.map((m) => ({
      key: m.key,
      outcome: m.outcome === "CREATE_INACTIVE" ? "CREATED_INACTIVE" : "ALREADY_PRESENT_INACTIVE",
    })),
    mapping_count: relevant.length,
    active_mapping_count: relevant.filter((r) => r.is_active).length,
    message_send_count: 0,
    meta_write_count: 0,
  };
}


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
  console.log(`Forbidden refs : production, jarvis â€” both rejected by exact ref`);
  console.log(`Templates      : ${SEED_SET.length}`);
  console.log("");

  // ---- Canonical binding-schema fence (offline; runs in EVERY mode) --------
  // This is checked before anything else touches the network, because a seed that
  // cannot build an authoritative variables_schema must never reach a database.
  const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { resolve, join: joinPath } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const manifest = JSON.parse(readFileSync(
    resolve("docs/provider-manifests/whatsapp-template-submission-manifest.json"), "utf8"));
  const byKey = new Map(Object.values(manifest.groups).flat()
    .map((t) => [t.internal_template_key, t]));

  // The SECOND authority: the typed contract that owns these source keys. It is loaded
  // through the repository's existing TS loader, never duplicated as a hand-maintained
  // list here â€” a copy in the operator would be one more thing that can silently drift.
  const contracts = (await import("../../../lib/communication/businessTemplateVariables.ts"))
    .BUSINESS_TEMPLATE_CONTRACTS;

  const unproven = [];
  for (const t of SEED_SET) {
    const built = buildCanonicalBindingSchema(byKey.get(t.key), contracts[t.key] ?? null);
    const label = built.ok ? `OK (${built.basis})` : `BLOCKED (${built.reason})`;
    console.log(`  ${t.key.padEnd(30)} ${t.classification.padEnd(19)} binding: ${label}`);
    if (!built.ok) unproven.push(built.detail);
  }
  console.log("");

  if (unproven.length > 0) {
    console.error("BLOCKED â€” CANONICAL BINDING SCHEMA UNPROVEN");
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
  console.log(`Target ref     : ${target.projectRef} (${target.environment}) â€” identity proven`);
  console.log("");

  // ---- Real adapters, constructed ONLY after the fence passed --------------
  const { createHash: hash } = await import("node:crypto");
  const { execFileSync } = await import("node:child_process");
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(process.env.QF_STAGING_SUPABASE_URL,
    process.env.QF_STAGING_SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });

  const MAPPINGS = "communication_provider_template_mappings";
  const ACCOUNTS = "communication_provider_accounts";
  const POLICIES = "communication_provider_runtime_policies";
  const TEMPLATES = "communication_templates";

  const db = {
    async proveSchema() {
      // A bounded probe per table: readable â‡’ present with the columns we select.
      for (const [t, cols] of [
        [MAPPINGS, "template_key,channel,provider_key,language,version,provider_template_name,provider_template_id,provider_category,approval_status,variables_schema,is_active"],
        [ACCOUNTS, "id,provider_key,channel,readiness_status,configuration_status,webhook_status,health_status,billing_status,business_account_reference,phone_number_reference"],
        [POLICIES, "provider_key,channel,activation_status,outbound_enabled"],
        [TEMPLATES, "template_key,version,language"],
      ]) {
        const { error } = await client.from(t).select(cols).limit(1);
        if (error) return { ok: false, reason: SeedFailure.SCHEMA_MISSING, detail: t };
      }
      return { ok: true, proof: "four required tables readable with the exact selected columns" };
    },
    async proveIndexes() {
      // PostgREST cannot read pg_indexes and this phase may add no RPC/DDL/migration, so
      // the proof is produced out of band by direct read-only SQL and handed in by path.
      // It is NOT a standing exception: it expires, it is pinned into the attestation,
      // and --execute re-verifies it.
      const path = process.env.QF_STAGING_INDEX_PROOF_PATH;
      if (!path) {
        return { ok: false, reason: SeedFailure.INDEX_PROOF_UNAVAILABLE,
          detail: "QF_STAGING_INDEX_PROOF_PATH is not set. Produce a fresh proof by direct "
            + "read-only SQL against the staging project and point this at it." };
      }
      if (isInsideRepository(path)) {
        return { ok: false, reason: SeedFailure.INDEX_PROOF_UNAVAILABLE,
          detail: "the index proof must live OUTSIDE the repository" };
      }
      let parsed;
      try { parsed = JSON.parse(readFileSync(path, "utf8")); }
      catch { return { ok: false, reason: SeedFailure.INDEX_PROOF_UNAVAILABLE,
        detail: "proof file is unreadable or not valid JSON" }; }
      const v = verifyIndexProof(parsed, { now: () => Date.now(), projectRef: target.projectRef });
      if (!v.ok) return v;
      return { ok: true, proof: "two required indexes proven by fresh external read-only SQL",
        proof_hash: v.proof_hash, expires_at_ms: v.expires_at_ms };
    },
    async selectInternalTemplates(keys) {
      const { data, error } = await client.from(TEMPLATES)
        .select("template_key,version,language").in("template_key", keys);
      if (error) throw new Error("read failed");
      return data ?? [];
    },
    async selectMappings(keys) {
      const { data, error } = await client.from(MAPPINGS).select("*")
        .in("template_key", keys).eq("channel", CHANNEL).eq("provider_key", PROVIDER_KEY);
      if (error) throw new Error("read failed");
      return data ?? [];
    },
    async selectAccounts() {
      const { data, error } = await client.from(ACCOUNTS).select("*")
        .eq("provider_key", PROVIDER_KEY).eq("channel", CHANNEL);
      if (error) throw new Error("read failed");
      return data ?? [];
    },
    async selectRuntimePolicy() {
      const { data, error } = await client.from(POLICIES).select("*")
        .eq("provider_key", PROVIDER_KEY).eq("channel", CHANNEL).maybeSingle();
      if (error) throw new Error("read failed");
      return data ?? null;
    },
    async insertAccount(row) {
      const { data, error } = await client.from(ACCOUNTS).insert(row).select().single();
      if (error) throw new Error("write failed");
      return data;
    },
    async normalizeAccountDisabled(row) {
      const { data, error } = await client.from(ACCOUNTS)
        .update({ ...REQUIRED_DISABLED_ACCOUNT_STATE,
                  business_account_reference: row.business_account_reference,
                  phone_number_reference: row.phone_number_reference })
        .eq("provider_key", PROVIDER_KEY).eq("channel", CHANNEL)
        .neq("readiness_status", FORBIDDEN_ACCOUNT_STATE.readiness_status)
        .select().single();
      if (error) throw new Error("write failed");
      return data;
    },
    async insertMappings(rows) {
      const { data, error } = await client.from(MAPPINGS).insert(rows).select();
      if (error) throw new Error("write failed");
      return data;
    },
  };

  const graph = `https://graph.facebook.com/${process.env.QF_META_GRAPH_API_VERSION}`;
  const authHeaders = { Authorization: `Bearer ${process.env.QF_META_ACCESS_TOKEN}` };
  const metaPort = {
    async verifyIdentity() {
      // GET only. Prove the phone number belongs to the exact WABA.
      const res = await fetch(`${graph}/${process.env.QF_META_WABA_ID}/phone_numbers?fields=id`,
        { headers: authHeaders });
      if (!res.ok) return { ok: false, detail: `identity http ${res.status}` };
      const body = await res.json();
      const owned = (body.data ?? []).some((p) => p.id === process.env.QF_META_PHONE_NUMBER_ID);
      return owned ? { ok: true } : { ok: false, detail: "phone number is not owned by this WABA" };
    },
    async getTemplateByName(name, expectedPayload) {
      // `components` is REQUESTED: without it there is nothing to compare, and the
      // previous adapter returned semanticMatch:true unconditionally â€” a claim it had no
      // basis for. Fields mirror the submission operator's reconcile read.
      const res = await fetch(
        `${graph}/${process.env.QF_META_WABA_ID}/message_templates`
        + `?name=${encodeURIComponent(name)}&fields=name,language,status,category,components`,
        { headers: authHeaders });
      if (!res.ok) return { ok: false, reason: SeedFailure.META_TEMPLATE_UNRESOLVED };
      const body = await res.json();
      const exact = (body.data ?? []).filter((t) => t.name === name && t.language === LANGUAGE);
      if (exact.length !== 1) return { ok: true, matches: exact.length };
      const t = exact[0];
      // Fail closed when the remote row carries no components to compare.
      if (!Array.isArray(t.components) || t.components.length === 0) {
        return { ok: false, reason: SeedFailure.META_TEMPLATE_UNRESOLVED };
      }
      // The REAL comparator already used by the submission/reconciliation operator â€”
      // exact body text, component order and buttons. No weaker local duplicate.
      const semanticMatch = templatesAreIdentical(
        { name: t.name, language: t.language, category: t.category, components: t.components },
        expectedPayload);
      return { ok: true, matches: 1, status: t.status, category: t.category,
               language: t.language, semanticMatch };
    },
  };

  // ---- Cross-process attestation store (external to the repository) --------
  const evidenceDir = joinPath(process.env.USERPROFILE ?? process.env.HOME ?? ".",
    "Desktop", "QuickFurno-Operator-Evidence", "QF-MVP-40", "Staging-Mapping-Seed-2026-08-01");
  const attestationPath = joinPath(evidenceDir, "preflight-attestation.json");
  const consumedPath = joinPath(evidenceDir, "consumed-nonces.json");
  const store = {
    async read() {
      try { return JSON.parse(readFileSync(attestationPath, "utf8")); } catch { return null; }
    },
    async write(payload) {
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(attestationPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
    },
    async consumedNonces() {
      try { return JSON.parse(readFileSync(consumedPath, "utf8")); } catch { return []; }
    },
    async consume(nonce) {
      const all = await this.consumedNonces();
      all.push(nonce);
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(consumedPath, JSON.stringify(all, null, 2) + "\n", "utf8");
    },
  };

  const readinessRaw = readFileSync(
    resolve("docs/provider-manifests/meta-template-inactive-mapping-readiness.json"));
  const manifestRaw = readFileSync(
    resolve("docs/provider-manifests/whatsapp-template-submission-manifest.json"));
  const deps = {
    db, meta: metaPort, store,
    now: () => Date.now(),
    head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    branch: execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(),
    projectRef: target.projectRef,
    manifestHash: hash("sha256").update(manifestRaw).digest("hex"),
    readinessHash: hash("sha256").update(readinessRaw).digest("hex"),
    bindingContractHash: hash("sha256").update(JSON.stringify(contracts)).digest("hex"),
    nonce: randomUUID(),
    wabaRef: process.env.QF_META_WABA_ID,
    phoneRef: process.env.QF_META_PHONE_NUMBER_ID,
    expectedPayloadFor: (key) => {
      const pkt = JSON.parse(readFileSync(
        resolve("docs/provider-manifests/meta-template-submission-packet.json"), "utf8"));
      return pkt.templates.find((x) => x.internal_template_key === key)?.creation_payload ?? null;
    },
    variablesSchemaFor: (key) => {
      const built = buildCanonicalBindingSchema(byKey.get(key), contracts[key] ?? null);
      return built.ok ? built.schema : null;
    },
  };

  if (mode === "PREFLIGHT_READONLY") {
    const r = await runReadOnlyPreflight(deps);
    if (!r.ok) {
      console.error(`PREFLIGHT BLOCKED: ${r.reason}${r.detail ? ` â€” ${sanitizeForEvidence(String(r.detail))}` : ""}`);
      console.error("ZERO writes were performed.");
      process.exit(4);
    }
    await store.write(r.payload);
    console.log("READ-ONLY PREFLIGHT PASSED â€” zero writes performed.");
    console.log(`  account classification : ${r.payload.account_classification}`);
    for (const m of r.payload.mapping_plan) console.log(`  ${m.key.padEnd(30)} ${m.outcome}`);
    console.log(`  runtime policy         : non-sendable`);
    console.log(`  attestation            : ${attestationPath}`);
    console.log(`  expires in             : ${Math.round(ATTESTATION_TTL_MS / 60000)} minutes (single use)`);
    console.log("");
    console.log("Review the plan above, then run exactly one: npm run seed:mvp:40-12 -- --execute");
    process.exit(0);
  }

  // ---- EXECUTE: reruns the full preflight, then at most two writes ---------
  const r = await runControlledExecute(deps);
  if (!r.ok) {
    console.error(`EXECUTE BLOCKED: ${r.reason}${r.detail ? ` â€” ${sanitizeForEvidence(String(r.detail))}` : ""}`);
    console.error("No retry is attempted. Inspect the sanitized reason before re-running.");
    process.exit(5);
  }
  console.log("STAGING SEED COMPLETE â€” all mappings INACTIVE.");
  console.log(`  provider account   : ${r.account_outcome} (disabled)`);
  for (const m of r.mapping_outcomes) console.log(`  ${m.key.padEnd(30)} ${m.outcome}`);
  console.log(`  mapping count      : ${r.mapping_count}`);
  console.log(`  active mappings    : ${r.active_mapping_count}`);
  console.log(`  messages sent      : ${r.message_send_count}`);
  console.log(`  Meta write calls   : ${r.meta_write_count}`);
  process.exit(0);
}
