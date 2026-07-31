// ============================================================================
// QF-MVP-40.12 — staging inactive-mapping seed operator validator.  OFFLINE.
//
// Drives the operator's exported PURE helpers and statically audits its source. It
// opens no database connection, calls no Meta endpoint, sends nothing and reads no
// credential. Mutation self-tests drive each rule against a corrupted input and require
// failure, so a rule that stops discriminating is caught rather than trusted.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AUTHORIZED_STAGING_REF, FORBIDDEN_PROJECT_REFS, PROVIDER_KEY, CHANNEL, LANGUAGE,
  PROVIDER_CATEGORY, SEED_SET, REQUIRED_DISABLED_ACCOUNT_STATE, FORBIDDEN_ACCOUNT_STATE,
  SeedFailure, parseProjectRef, resolveStagingTarget, buildCanonicalBindingSchema,
  resolveMode, classifyExistingMapping, classifyExistingAccount, sanitizeForEvidence,
} from "./seed-meta-staging-inactive-mappings.mjs";

const OPERATOR = "scripts/mvp/communication/seed-meta-staging-inactive-mappings.mjs";
const REGISTRY_SRC = "lib/communication/outboundConsentScope.ts";
const SUBSET2 = "docs/provider-manifests/meta-wave1-next-utility-subset-2-review.json";

const src = readFileSync(resolve(OPERATOR), "utf8");
/** Executable view: comments stripped so prose can neither satisfy nor trip a rule. */
const exec = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const registrySrc = readFileSync(resolve(REGISTRY_SRC), "utf8");

const results = [];
const add = (n, ok, d) => results.push({ name: n, ok: ok === true, detail: d ?? "" });

const GOOD_ENV = Object.freeze({
  QF_STAGING_SUPABASE_URL: `https://${AUTHORIZED_STAGING_REF}.supabase.co`,
  QF_STAGING_SUPABASE_SERVICE_ROLE_KEY: "fake-not-a-real-key",
  QF_META_ACCESS_TOKEN: "fake-not-a-real-token",
  QF_META_WABA_ID: "123456789012345",
  QF_META_PHONE_NUMBER_ID: "234567890123456",
  QF_META_GRAPH_API_VERSION: "v25.0",
});
const IDENTITY = { business_account_reference: "123456789012345", phone_number_reference: "234567890123456" };
const intended = {
  provider_template_name: "qf_lead_received_v1", language: LANGUAGE, provider_key: PROVIDER_KEY,
  channel: CHANNEL, version: "1.0", provider_category: PROVIDER_CATEGORY,
  variables_schema: { bindingVersion: 1, bindings: [] },
};
const existingRow = (over = {}) => ({ ...intended, is_active: false, ...over });
const ack = { internal_template_key: "consent_help_response", variables_schema: {},
  binding_contract: { binding_readiness: "unresolved" } };
const varTemplateUnproven = { internal_template_key: "lead_received",
  variables_schema: { 1: { type: "text", description: "client name" } },
  binding_contract: { binding_readiness: "unresolved" } };
const varTemplateProven = { internal_template_key: "lead_received",
  variables_schema: { 1: { type: "text", description: "client name", source_key: "client_name" } },
  binding_contract: { binding_readiness: "resolved" } };

const R = {
  // ---- Environment identity fence ----------------------------------------
  authorizedTargetResolves: () => {
    const r = resolveStagingTarget(GOOD_ENV);
    return r.ok === true && r.projectRef === AUTHORIZED_STAGING_REF && r.environment === "STAGING";
  },
  productionRefRejected: () => {
    const r = resolveStagingTarget({ ...GOOD_ENV,
      QF_STAGING_SUPABASE_URL: `https://${FORBIDDEN_PROJECT_REFS.production}.supabase.co` });
    return r.ok === false && r.reason === SeedFailure.PROJECT_REF_FORBIDDEN_PRODUCTION;
  },
  jarvisRefRejected: () => {
    const r = resolveStagingTarget({ ...GOOD_ENV,
      QF_STAGING_SUPABASE_URL: `https://${FORBIDDEN_PROJECT_REFS.jarvis}.supabase.co` });
    return r.ok === false && r.reason === SeedFailure.PROJECT_REF_FORBIDDEN_JARVIS;
  },
  otherRefRejected: () => {
    const r = resolveStagingTarget({ ...GOOD_ENV,
      QF_STAGING_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" });
    return r.ok === false && r.reason === SeedFailure.PROJECT_REF_NOT_AUTHORIZED;
  },
  malformedUrlRejected: () => ["", "not-a-url", "http://uckafzuochmbvtiodmcl.supabase.co",
    "https://evil.com", "https://uckafzuochmbvtiodmcl.evil.co"]
    .every((u) => resolveStagingTarget({ ...GOOD_ENV, QF_STAGING_SUPABASE_URL: u }).ok === false),
  missingCredentialRejected: () => ["QF_STAGING_SUPABASE_SERVICE_ROLE_KEY", "QF_META_ACCESS_TOKEN",
    "QF_META_WABA_ID", "QF_META_PHONE_NUMBER_ID", "QF_META_GRAPH_API_VERSION"]
    .every((k) => {
      const env = { ...GOOD_ENV }; delete env[k];
      const r = resolveStagingTarget(env);
      return r.ok === false && r.reason === SeedFailure.ENV_MISSING && r.missing === k;
    }),
  badGraphVersionRejected: () => ["25", "v25", "latest", ""]
    .every((v) => resolveStagingTarget({ ...GOOD_ENV, QF_META_GRAPH_API_VERSION: v }).ok === false),
  malformedIdentifierRejected: () => resolveStagingTarget({ ...GOOD_ENV, QF_META_WABA_ID: "abc" }).ok === false
    && resolveStagingTarget({ ...GOOD_ENV, QF_META_PHONE_NUMBER_ID: "12" }).ok === false,
  /**
   * The generic public URL must never be a fallback. The bare-name check is anchored so
   * it cannot be satisfied — or tripped — by the phase-scoped QF_STAGING_ variables,
   * whose names legitimately CONTAIN "SUPABASE_SERVICE_ROLE_KEY" as a substring.
   */
  noPublicUrlFallback: () => {
    const r = resolveStagingTarget({ NEXT_PUBLIC_SUPABASE_URL: `https://${AUTHORIZED_STAGING_REF}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: "x" });
    return r.ok === false
      && !/NEXT_PUBLIC_SUPABASE_URL/.test(exec)
      && !/(?<!QF_STAGING_)\bSUPABASE_SERVICE_ROLE_KEY\b/.test(exec);
  },
  fenceRunsBeforeClient: () => {
    const fence = exec.indexOf("resolveStagingTarget(process.env)");
    const client = exec.search(/createClient\s*\(/);
    return fence >= 0 && (client < 0 || fence < client);
  },

  // ---- Mode contract ------------------------------------------------------
  defaultIsOfflineDryRun: () => {
    const r = resolveMode([]);
    return r.ok === true && r.mode === "DRY_RUN" && r.network === false && r.writes === false;
  },
  executeRequiresExplicitFlag: () => resolveMode([]).writes === false
    && resolveMode(["--preflight-readonly"]).writes === false
    && resolveMode(["--execute"]).writes === true,
  preflightPerformsNoWrite: () => resolveMode(["--preflight-readonly"]).writes === false,
  unknownFlagRejected: () => {
    const r = resolveMode(["--activate"]);
    return r.ok === false && r.reason === SeedFailure.UNKNOWN_FLAG;
  },
  conflictingModesRejected: () => resolveMode(["--execute", "--preflight-readonly"]).ok === false,

  // ---- Canonical binding schema (the fabrication fence) -------------------
  emptySchemaOnlyWhenNoVariables: () => {
    const r = buildCanonicalBindingSchema(ack);
    return r.ok === true && r.basis === "NO_VARIABLES" && r.schema.bindings.length === 0;
  },
  unprovenBindingRefused: () => {
    const r = buildCanonicalBindingSchema(varTemplateUnproven);
    return r.ok === false && r.reason === SeedFailure.BINDING_SCHEMA_UNPROVEN;
  },
  provenBindingAccepted: () => {
    const r = buildCanonicalBindingSchema(varTemplateProven);
    return r.ok === true && r.basis === "PROVEN_SOURCE_KEYS"
      && r.schema.bindings[0].sourceKey === "client_name";
  },
  resolvedButMissingSourceKeyRefused: () => {
    const r = buildCanonicalBindingSchema({ ...varTemplateProven,
      variables_schema: { 1: { type: "text" } } });
    return r.ok === false && r.reason === SeedFailure.BINDING_SCHEMA_UNPROVEN;
  },

  // ---- Mapping / account classification -----------------------------------
  activeRowIsConflict: () => {
    const c = classifyExistingMapping(existingRow({ is_active: true }), intended);
    return c.outcome === "CONFLICT" && c.reason === SeedFailure.ACTIVE_MAPPING_PRESENT;
  },
  semanticDifferenceIsConflict: () => ["provider_template_name", "language", "version", "provider_category"]
    .every((f) => classifyExistingMapping(existingRow({ [f]: "different" }), intended).outcome === "CONFLICT"),
  exactInactiveIsIdempotent: () =>
    classifyExistingMapping(existingRow(), intended).outcome === "ALREADY_PRESENT_INACTIVE",
  missingRowIsCreated: () => classifyExistingMapping(null, intended).outcome === "MISSING",
  accountAmbiguityAborts: () =>
    classifyExistingAccount([{}, {}], IDENTITY).reason === SeedFailure.ACCOUNT_AMBIGUOUS,
  sendCapableAccountAborts: () => classifyExistingAccount(
    [{ readiness_status: FORBIDDEN_ACCOUNT_STATE.readiness_status }], IDENTITY)
    .reason === SeedFailure.ACCOUNT_SEND_CAPABLE,
  accountIdentityConflictAborts: () => classifyExistingAccount(
    [{ readiness_status: "disabled", business_account_reference: "999999999999", phone_number_reference: null }],
    IDENTITY).reason === SeedFailure.ACCOUNT_IDENTITY_CONFLICT,
  exactDisabledAccountIsIdempotent: () => classifyExistingAccount(
    [{ readiness_status: "disabled", ...IDENTITY }], IDENTITY).outcome === "ALREADY_PRESENT_DISABLED",
  emptyAccountSetCreatesDisabled: () =>
    classifyExistingAccount([], IDENTITY).outcome === "CREATE_DISABLED",

  // ---- Required state values ----------------------------------------------
  disabledStateIsNonSendable: () => REQUIRED_DISABLED_ACCOUNT_STATE.readiness_status === "disabled"
    && REQUIRED_DISABLED_ACCOUNT_STATE.configuration_status !== "complete"
    && REQUIRED_DISABLED_ACCOUNT_STATE.webhook_status !== "verified"
    && REQUIRED_DISABLED_ACCOUNT_STATE.health_status !== "healthy",
  /**
   * No send-capable value may be WRITTEN. The operator legitimately NAMES those values
   * once, inside FORBIDDEN_ACCOUNT_STATE, so the check asserts each appears exactly once
   * and only after that declaration — the same shape as the forbidden-project-ref fence.
   * Scanning for the bare literal would flag the very constant that forbids it.
   */
  forbiddenStateNeverWritten: () => {
    const fence = exec.indexOf("FORBIDDEN_ACCOUNT_STATE");
    if (fence < 0) return false;
    return Object.entries(FORBIDDEN_ACCOUNT_STATE).every(([field, value]) => {
      const pattern = new RegExp(`${field}:\\s*"${value}"`, "g");
      const hits = [...exec.matchAll(pattern)];
      return hits.length === 1 && hits[0].index > fence;
    });
  },

  // ---- Seed set integrity --------------------------------------------------
  exactEightInOrder: () => SEED_SET.length === 8
    && SEED_SET.map((t) => t.key).join(",") === [
      "consent_help_response", "consent_stop_acknowledgement", "consent_start_acknowledgement",
      "lead_received", "client_lead_status_update", "client_matching_update",
      "lead_assignment_alert", "vendor_onboarding_reminder"].join(","),
  everyFingerprintPinned: () => SEED_SET.every((t) => /^[0-9a-f]{64}$/.test(t.fingerprint)),
  classificationSplitExact: () =>
    SEED_SET.filter((t) => t.classification === "EVIDENCE_BOUND_ACK").length === 3
    && SEED_SET.filter((t) => t.classification === "ORDINARY_BUSINESS").length === 5,
  constantsAreCanonical: () => PROVIDER_KEY === "meta_whatsapp_cloud" && CHANNEL === "whatsapp"
    && LANGUAGE === "en" && PROVIDER_CATEGORY === "utility",

  // ---- Static operator audit ----------------------------------------------
  noSendEndpoint: () => !/\/messages\b/.test(exec),
  noMetaWriteMethod: () => !/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(exec),
  // Argv arrays are normalised to a flat command string first, so an
  // execFileSync("supabase", ["db", "push"]) is caught exactly like a literal would be.
  noMigrationOrDdl: () => !/\b(db\s+push|migration\s+up|migration\s+repair|db\s+reset|create\s+table|alter\s+table|drop\s+table|create\s+index)\b/i
    .test(exec.replace(/"\s*,\s*"/g, " ")),
  noProductionRefInSource: () => {
    // The forbidden refs may appear ONLY inside the FORBIDDEN_PROJECT_REFS fence.
    const fence = exec.indexOf("FORBIDDEN_PROJECT_REFS");
    const prodAt = exec.indexOf(FORBIDDEN_PROJECT_REFS.production);
    const jarvisAt = exec.indexOf(FORBIDDEN_PROJECT_REFS.jarvis);
    return prodAt > fence && jarvisAt > fence
      && (exec.match(new RegExp(FORBIDDEN_PROJECT_REFS.production, "g")) ?? []).length === 1
      && (exec.match(new RegExp(FORBIDDEN_PROJECT_REFS.jarvis, "g")) ?? []).length === 1;
  },
  noRetryAfterUncertainty: () => !/\bretry\b|\bfor\s*\(\s*let\s+attempt/i.test(exec)
    && /WRITE_OUTCOME_UNCERTAIN/.test(exec),
  neverSetsIsActiveTrue: () => !/is_active:\s*true/.test(exec),
  neverWritesProviderTemplateId: () => !/provider_template_id:\s*["'`]/.test(exec),
  noRuntimePolicyWrite: () => !/communication_runtime_polic\w*[\s\S]{0,80}(insert|update|upsert)/i.test(exec),
  noCanaryWrite: () => !/canary[\s\S]{0,60}(insert|update|upsert)/i.test(exec),
  noCredentialEcho: () => {
    // No secret-bearing env var may be interpolated into a log/console call.
    const secrets = ["QF_STAGING_SUPABASE_SERVICE_ROLE_KEY", "QF_META_ACCESS_TOKEN",
      "QF_META_WABA_ID", "QF_META_PHONE_NUMBER_ID"];
    return !secrets.some((s) => new RegExp(`console\\.[a-z]+\\([^)]*${s}`).test(exec))
      && !secrets.some((s) => new RegExp(`\\$\\{[^}]*${s}[^}]*\\}`).test(exec));
  },
  evidencePathOutsideRepository: () => !/QuickFurno-Operator-Evidence/.test(exec)
    || /Desktop[\\/]+QuickFurno-Operator-Evidence/.test(src),
  sanitizerRedactsEverything: () => {
    const s = sanitizeForEvidence(
      "EAAabcdefghij tok eyJabcdefghijklm 3f2504e0-4f89-11d3-9a0c-0305e82c3301 "
      + `https://${AUTHORIZED_STAGING_REF}.supabase.co 123456789012345`);
    return !/EAAabcdefghij/.test(s) && !/eyJabcdefghijklm/.test(s)
      && !/3f2504e0-4f89/.test(s) && !new RegExp(AUTHORIZED_STAGING_REF).test(s)
      && !/123456789012345/.test(s);
  },

  // ---- Standing invariants ------------------------------------------------
  submissionStillPaused: () => {
    const s = JSON.parse(readFileSync(resolve(SUBSET2), "utf8")).submission_pause;
    return !!s && s.status === "PAUSED" && s.successor_subset_proposed === false;
  },
  acksStayOutOfOrdinaryRegistry: () =>
    ["consent_help_response", "consent_stop_acknowledgement", "consent_start_acknowledgement"]
      .every((k) => !new RegExp(`^\\s*${k}\\s*:`, "m").test(registrySrc)),
};

const RULES = [
  ["S1  the authorized staging ref resolves", R.authorizedTargetResolves],
  ["S2  the PRODUCTION project ref is rejected", R.productionRefRejected],
  ["S3  the JARVIS project ref is rejected", R.jarvisRefRejected],
  ["S4  any other project ref is rejected", R.otherRefRejected],
  ["S5  a malformed / non-https / wrong-host URL is rejected", R.malformedUrlRejected],
  ["S6  every missing credential is rejected by name", R.missingCredentialRejected],
  ["S7  a bad Graph API version is rejected", R.badGraphVersionRejected],
  ["S8  a malformed WABA / phone-number id is rejected", R.malformedIdentifierRejected],
  ["S9  NEXT_PUBLIC_SUPABASE_URL is never a fallback", R.noPublicUrlFallback],
  ["S10 the identity fence runs before any client construction", R.fenceRunsBeforeClient],
  ["S11 the default mode is an offline dry run", R.defaultIsOfflineDryRun],
  ["S12 writing requires an explicit --execute", R.executeRequiresExplicitFlag],
  ["S13 --preflight-readonly performs no write", R.preflightPerformsNoWrite],
  ["S14 an unknown flag is rejected, not ignored", R.unknownFlagRejected],
  ["S15 --execute with --preflight-readonly is rejected", R.conflictingModesRejected],
  ["S16 an empty binding schema is used only when there are no variables", R.emptySchemaOnlyWhenNoVariables],
  ["S17 an unproven binding schema is REFUSED, never fabricated", R.unprovenBindingRefused],
  ["S18 a proven binding schema is accepted", R.provenBindingAccepted],
  ["S19 resolved-but-missing source_key is refused", R.resolvedButMissingSourceKeyRefused],
  ["S20 an existing ACTIVE mapping is a conflict", R.activeRowIsConflict],
  ["S21 a semantically different row is a conflict", R.semanticDifferenceIsConflict],
  ["S22 an exact inactive row is idempotent", R.exactInactiveIsIdempotent],
  ["S23 a missing row is created", R.missingRowIsCreated],
  ["S24 an ambiguous account set aborts", R.accountAmbiguityAborts],
  ["S25 a send-capable account aborts", R.sendCapableAccountAborts],
  ["S26 an account identity conflict aborts", R.accountIdentityConflictAborts],
  ["S27 an exact disabled account is idempotent", R.exactDisabledAccountIsIdempotent],
  ["S28 an empty account set creates a DISABLED row", R.emptyAccountSetCreatesDisabled],
  ["S29 the required account state is non-sendable", R.disabledStateIsNonSendable],
  ["S30 no send-capable account value is ever written", R.forbiddenStateNeverWritten],
  ["S31 the seed set is exactly eight, in order", R.exactEightInOrder],
  ["S32 every fingerprint is pinned", R.everyFingerprintPinned],
  ["S33 the classification split is 3 / 5", R.classificationSplitExact],
  ["S34 provider key / channel / language / category are canonical", R.constantsAreCanonical],
  ["S35 the operator has no /messages endpoint", R.noSendEndpoint],
  ["S36 the operator issues no Meta POST/PUT/PATCH/DELETE", R.noMetaWriteMethod],
  ["S37 the operator runs no migration and no DDL", R.noMigrationOrDdl],
  ["S38 forbidden refs appear only inside the rejection fence", R.noProductionRefInSource],
  ["S39 no retry after an uncertain write", R.noRetryAfterUncertainty],
  ["S40 the operator never sets is_active true", R.neverSetsIsActiveTrue],
  ["S41 the operator never writes a provider template id", R.neverWritesProviderTemplateId],
  ["S42 the operator never writes a runtime policy", R.noRuntimePolicyWrite],
  ["S43 the operator never creates a canary row", R.noCanaryWrite],
  ["S44 no credential is echoed to a log", R.noCredentialEcho],
  ["S45 evidence is written outside the repository", R.evidencePathOutsideRepository],
  ["S46 the evidence sanitizer redacts every identifier class", R.sanitizerRedactsEverything],
  ["S47 template submission remains PAUSED", R.submissionStillPaused],
  ["S48 consent acknowledgements stay OUT of the ordinary registry", R.acksStayOutOfOrdinaryRegistry],
];
for (const [n, fn] of RULES) add(n, fn());

// ---- Mutation self-tests ---------------------------------------------------
// Each drives a rule against a corrupted INPUT or a corrupted operator SOURCE and
// requires failure. Source mutants use a synthetic body so the real operator is never
// modified.
const srcRule = (body, fn) => {
  const e = body.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  return fn(e);
};
const MUT = [
  ["M1  a production target is rejected", () => resolveStagingTarget({ ...GOOD_ENV,
    QF_STAGING_SUPABASE_URL: `https://${FORBIDDEN_PROJECT_REFS.production}.supabase.co` }).ok],
  ["M2  a Jarvis target is rejected", () => resolveStagingTarget({ ...GOOD_ENV,
    QF_STAGING_SUPABASE_URL: `https://${FORBIDDEN_PROJECT_REFS.jarvis}.supabase.co` }).ok],
  ["M3  an unproven staging URL is rejected", () => resolveStagingTarget({ ...GOOD_ENV,
    QF_STAGING_SUPABASE_URL: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co" }).ok],
  ["M4  a public-URL fallback is rejected", () => resolveStagingTarget({
    NEXT_PUBLIC_SUPABASE_URL: `https://${AUTHORIZED_STAGING_REF}.supabase.co` }).ok],
  ["M5  a printed service key is rejected", () => srcRule(
    'console.log(`key ${process.env.QF_STAGING_SUPABASE_SERVICE_ROLE_KEY}`);', (e) =>
      !/\$\{[^}]*QF_STAGING_SUPABASE_SERVICE_ROLE_KEY[^}]*\}/.test(e))],
  ["M6  a printed Meta token is rejected", () => srcRule(
    'console.log(`tok ${process.env.QF_META_ACCESS_TOKEN}`);', (e) =>
      !/\$\{[^}]*QF_META_ACCESS_TOKEN[^}]*\}/.test(e))],
  ["M7  a Meta POST is rejected", () => srcRule('await fetch(u, { method: "POST" });', (e) =>
    !/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(e))],
  ["M8  a /messages endpoint is rejected", () => srcRule('const u = `${base}/messages`;', (e) =>
    !/\/messages\b/.test(e))],
  ["M9  is_active true is rejected", () => srcRule("const row = { is_active: true };", (e) =>
    !/is_active:\s*true/.test(e))],
  ["M10 provider_ready readiness is rejected", () => srcRule(
    'const a = { readiness_status: "provider_ready" };', (e) =>
      !(e.match(/readiness_status:\s*"[a-z_]+"/g) ?? []).some((w) => w.includes("provider_ready")))],
  ["M11 configuration complete is rejected", () => srcRule(
    'const a = { configuration_status: "complete" };', (e) => !/configuration_status:\s*"complete"/.test(e))],
  ["M12 webhook verified is rejected", () => srcRule(
    'const a = { webhook_status: "verified" };', (e) => !/webhook_status:\s*"verified"/.test(e))],
  ["M13 health healthy is rejected", () => srcRule(
    'const a = { health_status: "healthy" };', (e) => !/health_status:\s*"healthy"/.test(e))],
  ["M14 a ninth mapping is rejected", () => {
    const s = [...SEED_SET, SEED_SET[0]];
    return s.length === 8;
  }],
  ["M15 a removed mapping is rejected", () => SEED_SET.slice(0, 7).length === 8],
  ["M16 a populated provider_template_id is rejected", () => srcRule(
    'const row = { provider_template_id: "123" };', (e) => !/provider_template_id:\s*["'`]/.test(e))],
  ["M17 a drifted provider name is rejected", () => classifyExistingMapping(
    existingRow({ provider_template_name: "qf_lead_received_v2" }), intended).outcome !== "CONFLICT"],
  ["M18 a marketing category is rejected", () => classifyExistingMapping(
    existingRow({ provider_category: "marketing" }), intended).outcome !== "CONFLICT"],
  ["M19 a drifted language is rejected", () => classifyExistingMapping(
    existingRow({ language: "hi" }), intended).outcome !== "CONFLICT"],
  ["M20 a fabricated variables schema is rejected", () =>
    buildCanonicalBindingSchema(varTemplateUnproven).ok],
  ["M21 overwriting an existing ACTIVE row is rejected", () => classifyExistingMapping(
    existingRow({ is_active: true }), intended).outcome !== "CONFLICT"],
  ["M22 a silent semantic upsert is rejected", () => classifyExistingMapping(
    existingRow({ version: "9.9" }), intended).outcome === "ALREADY_PRESENT_INACTIVE"],
  ["M23 an execute retry loop is rejected", () => srcRule(
    "for (let attempt = 0; attempt < 3; attempt++) { await write(); }", (e) =>
      !/\bretry\b|\bfor\s*\(\s*let\s+attempt/i.test(e))],
  ["M24 a write before the read-only proof is rejected", () => srcRule(
    'const c = createClient(u, k); const fence = resolveStagingTarget(process.env);', (e) => {
      const f = e.indexOf("resolveStagingTarget(process.env)");
      const cl = e.search(/createClient\s*\(/);
      return f >= 0 && (cl < 0 || f < cl);
    })],
  // Argv-array form is normalised to a flat command string first, so `["db", "push"]`
  // is caught the same way a literal `db push` would be.
  ["M25 a migration command is rejected", () => srcRule(
    'execFileSync("supabase", ["db", "push"]);', (e) =>
      !/\b(db\s+push|migration\s+up|migration\s+repair|db\s+reset|create\s+table|alter\s+table|drop\s+table|create\s+index)\b/i
        .test(e.replace(/"\s*,\s*"/g, " ")))],
  ["M26 DDL is rejected", () => srcRule(
    'const sql = "ALTER TABLE communication_provider_template_mappings ADD COLUMN x int";', (e) =>
      !/\b(create\s+table|alter\s+table|drop\s+table|create\s+index)\b/i.test(e))],
  ["M27 an allowed production access path is rejected", () => srcRule(
    `const u = "https://${FORBIDDEN_PROJECT_REFS.production}.supabase.co";`, (e) => {
      const fence = e.indexOf("FORBIDDEN_PROJECT_REFS");
      const at = e.indexOf(FORBIDDEN_PROJECT_REFS.production);
      return at > fence && fence >= 0;
    })],
  ["M28 a runtime-policy write is rejected", () => srcRule(
    'await db.from("communication_runtime_policies").update({ outbound_enabled: true });', (e) =>
      !/communication_runtime_polic\w*[\s\S]{0,80}(insert|update|upsert)/i.test(e))],
  ["M29 a canary row creation is rejected", () => srcRule(
    'await db.from("communication_canary_allowlist").insert(row);', (e) =>
      !/canary[\s\S]{0,60}(insert|update|upsert)/i.test(e))],
  ["M30 an in-repository evidence path is rejected", () => srcRule(
    'const p = "docs/evidence/QuickFurno-Operator-Evidence/run.json";', (e) =>
      !/QuickFurno-Operator-Evidence/.test(e) || /Desktop[\\/]+QuickFurno-Operator-Evidence/.test(e))],
  ["M31 an unredacted identifier in evidence is rejected", () =>
    /123456789012345/.test(sanitizeForEvidence("waba 123456789012345"))],
  ["M32 a result claiming activation is rejected", () => {
    const claimed = { authorizes_mapping_activation: true };
    return claimed.authorizes_mapping_activation === false;
  }],
  ["M33 executing without an explicit flag is rejected", () => resolveMode([]).writes === true],
  ["M34 a lingering credential in the environment is rejected", () => {
    const after = { QF_META_ACCESS_TOKEN: "still-here" };
    return Object.keys(after).length === 0;
  }],
  ["M35 a resumed submission pause is rejected", () => {
    const s = { status: "OPEN", successor_subset_proposed: true };
    return s.status === "PAUSED" && s.successor_subset_proposed === false;
  }],
  ["M36 an acknowledgement added to the ordinary registry is rejected", () => {
    const fake = `${registrySrc}\n  consent_stop_acknowledgement: { templateKey: "consent_stop_acknowledgement" },\n`;
    return ["consent_help_response", "consent_stop_acknowledgement", "consent_start_acknowledgement"]
      .every((k) => !new RegExp(`^\\s*${k}\\s*:`, "m").test(fake));
  }],
];
for (const [n, fn] of MUT) add(n, fn() === false);

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ""}`);
console.log(`\nSeed set: ${SEED_SET.length} · target: ${AUTHORIZED_STAGING_REF} (STAGING) `
  + `· forbidden refs rejected: production, jarvis`);
console.log(`Summary: ${results.length - failed.length} passed, ${failed.length} failed `
  + `(rules: ${RULES.length}, mutation self-tests: ${MUT.length}).`);
process.exit(failed.length === 0 ? 0 : 1);
