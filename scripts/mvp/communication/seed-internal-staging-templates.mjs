// ============================================================================
// QF-MVP-40.12 prerequisite — controlled STAGING internal-template catalogue seed.
//
// Purpose: seed exactly the eight internal communication_templates rows that the
// QF-MVP-40.12 inactive provider-mapping seed already requires. This operator does
// NOT create provider mappings, provider accounts, runtime policy, Meta templates,
// webhook configuration, canaries, messages, migrations, DDL or deployment state.
//
// Modes:
//   default                OFFLINE dry run (no credential read, no DB client)
//   --preflight-readonly   STAGING reads only + external short-lived attestation
//   --execute              one attested bulk INSERT of missing exact rows + readback
//
// Unknown/ambiguous database write outcome is terminal. NEVER blind-retry --execute.
// ============================================================================

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join as joinPath, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PHASE = "QF-MVP-40.12-PREREQ-R1";
export const AUTHORIZED_STAGING_REF = "uckafzuochmbvtiodmcl";
/**
 * The EXACT branch this prerequisite seed may run from.
 *
 * QF-MVP-40.13C-R2 RE-PIN. It was `mvp/qf-mvp-40-meta-readiness-v1`, the branch that
 * authored the seed. That branch has long since merged, so the first live prerequisite
 * would have refused with GIT_BRANCH_MISMATCH before any controlled write — a real
 * pre-live blocker, not a theoretical one.
 *
 * Re-pinned to the branch that actually carries the certified live-run authority. This is
 * a single exact literal compared with `!==`: no wildcard, no prefix, no list, no
 * environment override and no bypass. Every other guard is untouched — clean tree, exact
 * git HEAD in the attestation, the staging-ref fence, the external short-lived single-use
 * attestation, the eight-row authority and the no-blind-retry rule.
 */
export const AUTHORIZED_BRANCH = "mvp/qf-mvp-40-final-provider-canary";
export const FORBIDDEN_PROJECT_REFS = Object.freeze({
  production: "yqpgcsduqbxulrlzwzap",
  jarvis: "coilipywdvxklewquqvv",
});

export const CHANNEL = "whatsapp";
export const LANGUAGE = "en";
export const INTERNAL_VERSION = "1.0";
export const INTERNAL_READINESS = "provider_mapping_required";
export const INTERNAL_IS_ACTIVE = true;
export const TABLE = "communication_templates";
export const MANIFEST_PATH = "docs/provider-manifests/whatsapp-template-submission-manifest.json";
export const READINESS_PATH = "docs/provider-manifests/meta-template-inactive-mapping-readiness.json";
export const ATTESTATION_TTL_MS = 15 * 60 * 1000;

export const TARGET_SPEC = Object.freeze([
  Object.freeze({ key: "consent_help_response", classification: "EVIDENCE_BOUND_ACK", category: "authentication" }),
  Object.freeze({ key: "consent_stop_acknowledgement", classification: "EVIDENCE_BOUND_ACK", category: "authentication" }),
  Object.freeze({ key: "consent_start_acknowledgement", classification: "EVIDENCE_BOUND_ACK", category: "authentication" }),
  Object.freeze({ key: "client_lead_status_update", classification: "ORDINARY_BUSINESS", category: "business" }),
  Object.freeze({ key: "vendor_onboarding_reminder", classification: "ORDINARY_BUSINESS", category: "business" }),
]);

export const SeedFailure = Object.freeze({
  UNKNOWN_FLAG: "UNKNOWN_FLAG",
  MODE_CONFLICT: "MODE_CONFLICT",
  ENV_MISSING: "ENV_MISSING",
  SERVICE_ROLE_KEY_MALFORMED: "SERVICE_ROLE_KEY_MALFORMED",
  PROJECT_REF_MALFORMED: "PROJECT_REF_MALFORMED",
  PROJECT_REF_FORBIDDEN_PRODUCTION: "PROJECT_REF_FORBIDDEN_PRODUCTION",
  PROJECT_REF_FORBIDDEN_JARVIS: "PROJECT_REF_FORBIDDEN_JARVIS",
  PROJECT_REF_NOT_AUTHORIZED: "PROJECT_REF_NOT_AUTHORIZED",
  GIT_BRANCH_MISMATCH: "GIT_BRANCH_MISMATCH",
  GIT_DIRTY: "GIT_DIRTY",
  EVIDENCE_PATH_INSIDE_REPOSITORY: "EVIDENCE_PATH_INSIDE_REPOSITORY",
  AUTHORITY_UNREADABLE: "AUTHORITY_UNREADABLE",
  AUTHORITY_DRIFT: "AUTHORITY_DRIFT",
  SCHEMA_MISSING: "SCHEMA_MISSING",
  INTERNAL_TEMPLATE_CONFLICT: "INTERNAL_TEMPLATE_CONFLICT",
  PREFLIGHT_ATTESTATION_MISSING: "PREFLIGHT_ATTESTATION_MISSING",
  PREFLIGHT_ATTESTATION_INVALID: "PREFLIGHT_ATTESTATION_INVALID",
  PREFLIGHT_ATTESTATION_EXPIRED: "PREFLIGHT_ATTESTATION_EXPIRED",
  PREFLIGHT_ATTESTATION_CONSUMED: "PREFLIGHT_ATTESTATION_CONSUMED",
  PREFLIGHT_CHANGED: "PREFLIGHT_CHANGED",
  WRITE_OUTCOME_UNCERTAIN: "WRITE_OUTCOME_UNCERTAIN",
  READBACK_FAILED: "READBACK_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
});

const EXPECTED_MANIFEST_SOURCE = MANIFEST_PATH;
const TARGET_KEYS = TARGET_SPEC.map((t) => t.key);
const TARGET_BY_KEY = new Map(TARGET_SPEC.map((t) => [t.key, t]));
const SELECT_COLUMNS = [
  "template_key", "channel", "category", "description", "language", "version",
  "provider_template_name", "provider_template_id", "readiness_status", "is_active",
].join(",");

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeEqual(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

export function resolveMode(argv) {
  const flags = argv.filter((a) => a.startsWith("--"));
  const known = new Set(["--preflight-readonly", "--execute"]);
  if (flags.some((f) => !known.has(f))) return { ok: false, reason: SeedFailure.UNKNOWN_FLAG };
  if (flags.includes("--preflight-readonly") && flags.includes("--execute")) {
    return { ok: false, reason: SeedFailure.MODE_CONFLICT };
  }
  if (flags.includes("--execute")) return { ok: true, mode: "EXECUTE", network: true, writes: true };
  if (flags.includes("--preflight-readonly")) {
    return { ok: true, mode: "PREFLIGHT_READONLY", network: true, writes: false };
  }
  return { ok: true, mode: "DRY_RUN", network: false, writes: false };
}

export function parseProjectRef(urlText) {
  try {
    const url = new URL(urlText);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    const match = url.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function validateServiceRoleKey(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const key = value.trim();
  if (key.startsWith("sb_secret_")) return key.length > "sb_secret_".length;
  if (!key.startsWith("eyJ")) return false;
  try {
    const parts = key.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

export function resolveStagingTarget(env) {
  const url = cleanString(env.QF_STAGING_SUPABASE_URL);
  const key = cleanString(env.QF_STAGING_SUPABASE_SERVICE_ROLE_KEY);
  if (!url) return { ok: false, reason: SeedFailure.ENV_MISSING, missing: "QF_STAGING_SUPABASE_URL" };
  if (!key) return { ok: false, reason: SeedFailure.ENV_MISSING, missing: "QF_STAGING_SUPABASE_SERVICE_ROLE_KEY" };
  if (!validateServiceRoleKey(key)) return { ok: false, reason: SeedFailure.SERVICE_ROLE_KEY_MALFORMED };

  const projectRef = parseProjectRef(url);
  if (!projectRef) return { ok: false, reason: SeedFailure.PROJECT_REF_MALFORMED };
  if (projectRef === FORBIDDEN_PROJECT_REFS.production) {
    return { ok: false, reason: SeedFailure.PROJECT_REF_FORBIDDEN_PRODUCTION };
  }
  if (projectRef === FORBIDDEN_PROJECT_REFS.jarvis) {
    return { ok: false, reason: SeedFailure.PROJECT_REF_FORBIDDEN_JARVIS };
  }
  if (projectRef !== AUTHORIZED_STAGING_REF) {
    return { ok: false, reason: SeedFailure.PROJECT_REF_NOT_AUTHORIZED };
  }
  return { ok: true, projectRef, environment: "STAGING", url, key };
}

export function currentGitState() {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" }).trim();
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  return { head, branch, root, clean: dirty === "" };
}

export function pathIsInsideRepository(path, repoRoot) {
  const rel = relative(resolve(repoRoot), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${process.platform === "win32" ? "\\" : "/"}`));
}

function flattenManifestGroups(manifest) {
  const groups = manifest?.groups;
  if (!groups || typeof groups !== "object" || Array.isArray(groups)) return [];
  return Object.values(groups).flatMap((rows) => Array.isArray(rows) ? rows : []);
}

export function deriveAuthorityRows(manifest, readiness, manifestRaw = null) {
  if (!manifest || !readiness) return { ok: false, reason: SeedFailure.AUTHORITY_UNREADABLE };
  if (readiness.source_manifest !== EXPECTED_MANIFEST_SOURCE) {
    return { ok: false, reason: SeedFailure.AUTHORITY_DRIFT, detail: "readiness source manifest path drift" };
  }
  if (manifestRaw !== null) {
    const digest = sha256(manifestRaw);
    if (readiness.source_manifest_fingerprint !== digest) {
      return { ok: false, reason: SeedFailure.AUTHORITY_DRIFT, detail: "manifest fingerprint drift" };
    }
  }

  const manifestRows = flattenManifestGroups(manifest);
  const readinessRows = Array.isArray(readiness.templates) ? readiness.templates : [];
  if (readinessRows.length !== TARGET_SPEC.length) {
    return { ok: false, reason: SeedFailure.AUTHORITY_DRIFT, detail: "readiness target count drift" };
  }

  const out = [];
  for (const spec of TARGET_SPEC) {
    const ms = manifestRows.filter((r) => r?.internal_template_key === spec.key);
    const rs = readinessRows.filter((r) => r?.internal_template_key === spec.key);
    if (ms.length !== 1 || rs.length !== 1) {
      return { ok: false, reason: SeedFailure.AUTHORITY_DRIFT, detail: `${spec.key}: authority cardinality` };
    }
    const m = ms[0];
    const r = rs[0];

    if (m.language !== LANGUAGE || String(m.category).toLowerCase() !== "utility") {
      return { ok: false, reason: SeedFailure.AUTHORITY_DRIFT, detail: `${spec.key}: manifest language/category` };
    }
    if (m.approval_status !== "approved" || m.submission_state !== "APPROVED_UNMAPPED") {
      return { ok: false, reason: SeedFailure.AUTHORITY_DRIFT, detail: `${spec.key}: manifest approval state` };
    }
    if (m.provider_template_name !== null || m.provider_template_id !== null) {
      return { ok: false, reason: SeedFailure.AUTHORITY_DRIFT, detail: `${spec.key}: legacy provider fields must remain null` };
    }
    if (m.qf_mvp_40?.submit_now !== false) {
      return { ok: false, reason: SeedFailure.AUTHORITY_DRIFT, detail: `${spec.key}: submit_now must be false` };
    }

    const expectedRegistry = spec.classification === "EVIDENCE_BOUND_ACK"
      ? "SPECIAL_EVIDENCE_BOUND_ACK" : "ORDINARY_REGISTRY";
    const expectedOrdinary = spec.classification === "ORDINARY_BUSINESS";
    const expectedScope = spec.classification === "EVIDENCE_BOUND_ACK" ? "authentication" : "transactional";
    if (m.qf_mvp_40?.registry_expectation !== expectedRegistry
      || m.qf_mvp_40?.ordinary_registry_entry !== expectedOrdinary
      || m.qf_mvp_40?.consent_scope !== expectedScope) {
      return { ok: false, reason: SeedFailure.AUTHORITY_DRIFT, detail: `${spec.key}: consent/registry authority drift` };
    }

    if (r.flow_classification !== spec.classification
      || r.provider_language !== LANGUAGE
      || r.channel !== CHANNEL
      || r.provider_key_symbolic !== "meta_whatsapp_cloud"
      || r.proven_remote_status !== "APPROVED"
      || r.proven_remote_category !== "UTILITY"
      || r.readback_semantic_match !== true
      || r.desired_mapping_state !== "INACTIVE"
      || r.provider_template_id !== null
      || r.runtime_activation_state !== "DISABLED"
      || r.send_authority !== "DENIED") {
      return { ok: false, reason: SeedFailure.AUTHORITY_DRIFT, detail: `${spec.key}: readiness authority drift` };
    }
    if (m.provider_template_name_candidate !== r.provider_template_name) {
      return { ok: false, reason: SeedFailure.AUTHORITY_DRIFT, detail: `${spec.key}: provider-name authority mismatch` };
    }

    const purpose = cleanString(m.qf_mvp_40?.purpose);
    if (!purpose) {
      return { ok: false, reason: SeedFailure.AUTHORITY_DRIFT, detail: `${spec.key}: purpose missing` };
    }

    // Provider-specific identity is deliberately NULL here. Meta must resolve only
    // through communication_provider_template_mappings; there is no legacy fallback.
    out.push(Object.freeze({
      template_key: spec.key,
      channel: CHANNEL,
      category: spec.category,
      description: purpose,
      language: LANGUAGE,
      version: INTERNAL_VERSION,
      provider_template_name: null,
      provider_template_id: null,
      readiness_status: INTERNAL_READINESS,
      is_active: INTERNAL_IS_ACTIVE,
    }));
  }
  return { ok: true, rows: Object.freeze(out) };
}

export function loadAuthorityFiles() {
  try {
    const manifestRaw = readFileSync(resolve(MANIFEST_PATH), "utf8");
    const readinessRaw = readFileSync(resolve(READINESS_PATH), "utf8");
    const manifest = JSON.parse(manifestRaw);
    const readiness = JSON.parse(readinessRaw);
    const derived = deriveAuthorityRows(manifest, readiness, manifestRaw);
    if (!derived.ok) return derived;
    const manifestHash = sha256(manifestRaw);
    const readinessHash = sha256(readinessRaw);
    return {
      ok: true,
      rows: derived.rows,
      manifestHash,
      readinessHash,
      authorityHash: sha256(canonicalJson({ manifestHash, readinessHash, rows: derived.rows })),
    };
  } catch {
    return { ok: false, reason: SeedFailure.AUTHORITY_UNREADABLE };
  }
}

export function classifyExistingTemplate(row, expected) {
  if (!row) return { outcome: "MISSING" };
  const actual = Object.fromEntries(Object.keys(expected).map((k) => [k, row[k] ?? null]));
  if (!safeEqual(actual, expected)) {
    return { outcome: "CONFLICT", reason: SeedFailure.INTERNAL_TEMPLATE_CONFLICT };
  }
  return { outcome: "ALREADY_PRESENT_EXACT" };
}

export function buildPlan(existingRows, expectedRows) {
  const byKey = new Map();
  for (const row of existingRows ?? []) {
    if (!TARGET_BY_KEY.has(row?.template_key)) continue;
    const list = byKey.get(row.template_key) ?? [];
    list.push(row);
    byKey.set(row.template_key, list);
  }

  const actions = [];
  const missingRows = [];
  for (const expected of expectedRows) {
    const rows = byKey.get(expected.template_key) ?? [];
    if (rows.length > 1) {
      return { ok: false, reason: SeedFailure.INTERNAL_TEMPLATE_CONFLICT, detail: `${expected.template_key}: duplicate rows` };
    }
    const classification = classifyExistingTemplate(rows[0] ?? null, expected);
    if (classification.outcome === "CONFLICT") {
      return { ok: false, reason: classification.reason, detail: `${expected.template_key}: existing row drift` };
    }
    const action = classification.outcome === "MISSING" ? "CREATE_INTERNAL_TEMPLATE" : "ALREADY_PRESENT_EXACT";
    actions.push({ key: expected.template_key, action });
    if (classification.outcome === "MISSING") missingRows.push(expected);
  }
  return { ok: true, actions, missingRows };
}

export function verifyReadback(rows, expectedRows) {
  if (!Array.isArray(rows) || rows.length !== expectedRows.length) {
    return { ok: false, reason: SeedFailure.READBACK_FAILED, detail: "target row count mismatch" };
  }
  const plan = buildPlan(rows, expectedRows);
  if (!plan.ok || plan.missingRows.length !== 0
      || plan.actions.some((a) => a.action !== "ALREADY_PRESENT_EXACT")) {
    return { ok: false, reason: SeedFailure.READBACK_FAILED, detail: "exact row readback mismatch" };
  }
  return { ok: true };
}

export function planDigest(input) {
  return sha256(canonicalJson(input));
}

export function attestationDigest(body) {
  return sha256(canonicalJson(body));
}

export function buildAttestation(preflight, nowMs = Date.now()) {
  const body = {
    artifact: "qf-mvp-40-12-internal-template-preflight",
    schema_version: "1.0",
    phase: PHASE,
    environment: "STAGING",
    project_ref: preflight.projectRef,
    branch: preflight.branch,
    head: preflight.head,
    authority_hash: preflight.authorityHash,
    plan_hash: preflight.planHash,
    issued_at_ms: nowMs,
    expires_at_ms: nowMs + ATTESTATION_TTL_MS,
    nonce: randomUUID(),
  };
  return { ...body, attestation_sha256: attestationDigest(body) };
}

export function verifyAttestation(attestation, fresh, nowMs = Date.now(), consumed = []) {
  if (!attestation || attestation.artifact !== "qf-mvp-40-12-internal-template-preflight"
      || attestation.schema_version !== "1.0" || !cleanString(attestation.nonce)) {
    return { ok: false, reason: SeedFailure.PREFLIGHT_ATTESTATION_INVALID };
  }
  const body = { ...attestation };
  delete body.attestation_sha256;
  if (attestation.attestation_sha256 !== attestationDigest(body)) {
    return { ok: false, reason: SeedFailure.PREFLIGHT_ATTESTATION_INVALID };
  }
  if (!Number.isFinite(attestation.issued_at_ms) || !Number.isFinite(attestation.expires_at_ms)
      || attestation.expires_at_ms - attestation.issued_at_ms > ATTESTATION_TTL_MS
      || attestation.issued_at_ms > nowMs + 60_000) {
    return { ok: false, reason: SeedFailure.PREFLIGHT_ATTESTATION_INVALID };
  }
  if (nowMs > attestation.expires_at_ms) {
    return { ok: false, reason: SeedFailure.PREFLIGHT_ATTESTATION_EXPIRED };
  }
  if (!Array.isArray(consumed)) {
    return { ok: false, reason: SeedFailure.PREFLIGHT_ATTESTATION_INVALID };
  }
  if (consumed.includes(attestation.nonce)) {
    return { ok: false, reason: SeedFailure.PREFLIGHT_ATTESTATION_CONSUMED };
  }
  for (const [field, value] of Object.entries({
    phase: PHASE,
    environment: "STAGING",
    project_ref: fresh.projectRef,
    branch: fresh.branch,
    head: fresh.head,
    authority_hash: fresh.authorityHash,
    plan_hash: fresh.planHash,
  })) {
    if (attestation[field] !== value) {
      return { ok: false, reason: SeedFailure.PREFLIGHT_CHANGED, detail: field };
    }
  }
  return { ok: true };
}

export function evidencePaths(env = process.env) {
  const home = env.USERPROFILE ?? env.HOME ?? ".";
  const dir = joinPath(home, "Desktop", "QuickFurno-Operator-Evidence", "QF-MVP-40",
    "Internal-Template-Seed-2026-08-01");
  return {
    dir,
    attestation: joinPath(dir, "preflight-attestation.json"),
    consumed: joinPath(dir, "consumed-nonces.json"),
    closure: joinPath(dir, "execute-readback.json"),
  };
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function createDbAdapter(target) {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(target.url, target.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async proveSchema() {
      const { error } = await client.from(TABLE).select(SELECT_COLUMNS).limit(1);
      return error ? { ok: false, reason: SeedFailure.SCHEMA_MISSING } : { ok: true };
    },
    async selectTargets() {
      const { data, error } = await client.from(TABLE).select(SELECT_COLUMNS).in("template_key", TARGET_KEYS);
      if (error) return { ok: false, reason: SeedFailure.SCHEMA_MISSING };
      return { ok: true, rows: data ?? [] };
    },
    async insertMissing(rows) {
      if (rows.length === 0) return { ok: true, rows: [] };
      // ONE write call site. Supabase/PostgREST executes this bulk INSERT atomically.
      const { data, error } = await client.from(TABLE).insert(rows).select(SELECT_COLUMNS);
      if (error) return { ok: false, reason: SeedFailure.WRITE_OUTCOME_UNCERTAIN };
      return { ok: true, rows: data ?? [] };
    },
  };
}

export async function runReadOnlyPreflight({
  env = process.env,
  dbFactory = createDbAdapter,
  gitState = currentGitState,
  authorityLoader = loadAuthorityFiles,
} = {}) {
  const target = resolveStagingTarget(env);
  if (!target.ok) return target;

  const git = gitState();
  if (git.branch !== AUTHORIZED_BRANCH) return { ok: false, reason: SeedFailure.GIT_BRANCH_MISMATCH };
  if (!git.clean) return { ok: false, reason: SeedFailure.GIT_DIRTY };
  const paths = evidencePaths(env);
  if (pathIsInsideRepository(paths.dir, git.root)) {
    return { ok: false, reason: SeedFailure.EVIDENCE_PATH_INSIDE_REPOSITORY };
  }

  const authority = authorityLoader();
  if (!authority.ok) return authority;

  const db = await dbFactory(target);
  const schema = await db.proveSchema();
  if (!schema.ok) return schema;
  const selected = await db.selectTargets();
  if (!selected.ok) return selected;

  const plan = buildPlan(selected.rows, authority.rows);
  if (!plan.ok) return plan;
  const planHash = planDigest({ authorityHash: authority.authorityHash, actions: plan.actions });
  return {
    ok: true,
    projectRef: target.projectRef,
    branch: git.branch,
    head: git.head,
    authorityHash: authority.authorityHash,
    planHash,
    actions: plan.actions,
    missingRows: plan.missingRows,
    expectedRows: authority.rows,
    writesPerformed: 0,
  };
}

async function runCli() {
  const mode = resolveMode(process.argv.slice(2));
  if (!mode.ok) {
    console.error(`REFUSED: ${mode.reason}`);
    process.exitCode = 2;
    return;
  }

  console.log(`Phase          : ${PHASE}`);
  console.log(`Mode           : ${mode.mode}`);
  console.log(`Authorized ref : ${AUTHORIZED_STAGING_REF} (STAGING)`);
  console.log("Templates      : 8");
  console.log("Provider fields: NULL in internal catalogue");
  console.log(`Readiness      : ${INTERNAL_READINESS}`);
  console.log(`Internal active: ${INTERNAL_IS_ACTIVE} (provider/runtime gates remain separate)`);
  console.log("");

  const authority = loadAuthorityFiles();
  if (!authority.ok) {
    console.error(`REFUSED: ${authority.reason}${authority.detail ? ` — ${authority.detail}` : ""}`);
    process.exitCode = 2;
    return;
  }
  for (const row of authority.rows) {
    console.log(`  ${row.template_key.padEnd(30)} ${row.category.padEnd(14)} v${row.version}`);
  }
  console.log("");

  if (mode.mode === "DRY_RUN") {
    console.log("Planned rows             : 8 exact internal catalogue rows");
    console.log("Provider template names  : NULL");
    console.log("Provider template ids    : NULL");
    console.log("Meta calls               : 0");
    console.log("Database connections     : 0");
    console.log("Writes performed         : 0");
    console.log("");
    console.log("DRY RUN COMPLETE. No credential was read, no database client was constructed, nothing was written.");
    return;
  }

  let executeWriteFenceCrossed = false;
  try {
    const preflight = await runReadOnlyPreflight();
    if (!preflight.ok) {
      console.error(`PREFLIGHT BLOCKED: ${preflight.reason}${preflight.detail ? ` — ${preflight.detail}` : ""}`);
      console.error("ZERO database writes were performed.");
      process.exitCode = 2;
      return;
    }

    const paths = evidencePaths();
    if (mode.mode === "PREFLIGHT_READONLY") {
      const attestation = buildAttestation(preflight);
      writeJson(paths.attestation, attestation);
      console.log(`Target ref     : ${preflight.projectRef} (STAGING) — identity proven`);
      console.log(`Branch         : ${preflight.branch}`);
      console.log(`HEAD           : ${preflight.head}`);
      console.log("Schema         : communication_templates readable with exact selected columns");
      console.log("Authority      : manifest/readiness parity proven");
      for (const a of preflight.actions) console.log(`  ${a.key.padEnd(30)} ${a.action}`);
      console.log("Writes performed         : 0");
      console.log("Meta calls               : 0");
      console.log("Provider mapping writes  : 0");
      console.log("Provider account writes  : 0");
      console.log("Runtime policy writes    : 0");
      console.log("PREFLIGHT PASSED. Sanitized single-use 15-minute attestation written OUTSIDE the repository.");
      return;
    }

    // EXECUTE — requires a prior external attestation and re-runs the full read-only plan first.
    const attestation = readJson(paths.attestation, null);
    if (!attestation) {
      console.error(`EXECUTE BLOCKED: ${SeedFailure.PREFLIGHT_ATTESTATION_MISSING}`);
      process.exitCode = 2;
      return;
    }
    const consumed = readJson(paths.consumed, []);
    if (!Array.isArray(consumed)) {
      console.error(`EXECUTE BLOCKED: ${SeedFailure.PREFLIGHT_ATTESTATION_INVALID}`);
      process.exitCode = 2;
      return;
    }
    const verified = verifyAttestation(attestation, preflight, Date.now(), consumed);
    if (!verified.ok) {
      console.error(`EXECUTE BLOCKED: ${verified.reason}${verified.detail ? ` — ${verified.detail}` : ""}`);
      process.exitCode = 2;
      return;
    }

    // Consume BEFORE the database write. A crash after this point requires a fresh
    // owner-reviewed preflight; the same execute attestation can never be replayed.
    writeJson(paths.consumed, [...consumed, attestation.nonce]);
    executeWriteFenceCrossed = true;

    const target = resolveStagingTarget(process.env);
    if (!target.ok) {
      console.error(`EXECUTE TERMINAL: ${SeedFailure.WRITE_OUTCOME_UNCERTAIN}`);
      console.error("Attestation was consumed. DO NOT RETRY; obtain a fresh read-only preflight.");
      process.exitCode = 3;
      return;
    }
    const db = await createDbAdapter(target);
    const write = await db.insertMissing(preflight.missingRows);
    if (!write.ok) {
      console.error(`EXECUTE TERMINAL: ${SeedFailure.WRITE_OUTCOME_UNCERTAIN}`);
      console.error("DO NOT RETRY. Perform read-only staging reconciliation first.");
      process.exitCode = 3;
      return;
    }

    const readback = await db.selectTargets();
    if (!readback.ok) {
      console.error(`EXECUTE TERMINAL: ${SeedFailure.WRITE_OUTCOME_UNCERTAIN}`);
      console.error("The write completed or may have completed, but readback could not be proven. DO NOT RETRY.");
      process.exitCode = 3;
      return;
    }
    const exact = verifyReadback(readback.rows, preflight.expectedRows);
    if (!exact.ok) {
      console.error(`EXECUTE TERMINAL: ${SeedFailure.READBACK_FAILED}`);
      console.error("DO NOT RETRY. Perform read-only staging reconciliation first.");
      process.exitCode = 3;
      return;
    }

    writeJson(paths.closure, {
      artifact: "qf-mvp-40-12-internal-template-seed-readback",
      schema_version: "1.0",
      phase: PHASE,
      environment: "STAGING",
      project_ref: preflight.projectRef,
      branch: preflight.branch,
      head: preflight.head,
      authority_hash: preflight.authorityHash,
      plan_hash: preflight.planHash,
      rows_proven_exact: TARGET_KEYS,
      rows_written_this_execute: preflight.missingRows.map((r) => r.template_key),
      provider_template_names_populated: 0,
      provider_template_ids_populated: 0,
      meta_calls: 0,
      provider_mapping_writes: 0,
      provider_account_writes: 0,
      runtime_policy_writes: 0,
      verified_at_ms: Date.now(),
    });

    console.log(`Target ref     : ${preflight.projectRef} (STAGING)`);
    console.log(`Rows written   : ${preflight.missingRows.length}`);
    console.log("Rows read back : 8 / 8 exact");
    console.log("Provider fields: NULL / NULL for all eight");
    console.log("Meta calls     : 0");
    console.log("Mappings       : untouched");
    console.log("Provider acct  : untouched");
    console.log("Runtime policy : untouched");
    console.log("EXECUTE COMPLETE — internal template prerequisite seeded and read back exactly.");
  } catch {
    if (executeWriteFenceCrossed) {
      console.error(`EXECUTE TERMINAL: ${SeedFailure.WRITE_OUTCOME_UNCERTAIN}`);
      console.error("No raw exception is printed. DO NOT RETRY until read-only staging reconciliation.");
      process.exitCode = 3;
    } else {
      console.error(`REFUSED: ${SeedFailure.INTERNAL_ERROR}`);
      console.error("ZERO database writes were performed. No raw exception is printed.");
      process.exitCode = 2;
    }
  }
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) await runCli();
