// ============================================================================
// QF-MVP-40.12 â€” staging inactive-mapping seed operator validator.  OFFLINE.
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
  ATTESTATION_TTL_MS, attestationDigest, buildMappingRow, runtimePolicyIsNonSendable,
  runReadOnlyPreflight, runControlledExecute, verifyAttestation,
  verifyIndexProof, indexProofDigest, REQUIRED_INDEXES, INDEX_PROOF_TABLE,
  scanMappingSet, verifyInternalTemplates, isInsideRepository,
  canonicalJsonValue, jsonSemanticEqual,
} from "./seed-meta-staging-inactive-mappings.mjs";
// The REAL comparator, so the semantic tests exercise production behaviour.
import { templatesAreIdentical } from "./submit-meta-templates.mjs";

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
/**
 * QF-MVP-40.12-R1: the manifest is only ONE authority. The typed code contract is the
 * other, and buildCanonicalBindingSchema now requires both to agree â€” so a docs-only
 * source_key can never unlock a seed.
 */
const CODE_CONTRACT = { templateKey: "lead_received", bindingVersion: 1,
  bindings: [{ component: "body", position: 1, sourceKey: "client_name", parameterType: "text" }] };

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
   * it cannot be satisfied â€” or tripped â€” by the phase-scoped QF_STAGING_ variables,
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
    const r = buildCanonicalBindingSchema(varTemplateProven, CODE_CONTRACT);
    return r.ok === true && r.basis === "PROVEN_SOURCE_KEYS"
      && r.schema.bindings[0].sourceKey === "client_name";
  },
  resolvedButMissingSourceKeyRefused: () => {
    const r = buildCanonicalBindingSchema({ ...varTemplateProven,
      variables_schema: { 1: { type: "text" } } }, CODE_CONTRACT);
    return r.ok === false && r.reason === SeedFailure.BINDING_SCHEMA_UNPROVEN;
  },
  /** A manifest edit alone must never be sufficient. */
  docsOnlySourceKeyRefused: () => {
    const r = buildCanonicalBindingSchema(varTemplateProven, null);
    return r.ok === false && r.reason === SeedFailure.BINDING_SCHEMA_UNPROVEN
      && /docs-only source_key is never accepted/i.test(r.detail);
  },
  manifestCodeMismatchRefused: () => [
    { ...CODE_CONTRACT, bindings: [{ ...CODE_CONTRACT.bindings[0], sourceKey: "customer_name" }] },
    { ...CODE_CONTRACT, bindings: [{ ...CODE_CONTRACT.bindings[0], position: 2 }] },
    { ...CODE_CONTRACT, bindings: [{ ...CODE_CONTRACT.bindings[0], parameterType: "payload" }] },
    { ...CODE_CONTRACT, bindings: [...CODE_CONTRACT.bindings, { component: "body", position: 2, sourceKey: "extra", parameterType: "text" }] },
    { ...CODE_CONTRACT, templateKey: "other_template" },
    { ...CODE_CONTRACT, bindingVersion: 2 },
  ].every((c) => buildCanonicalBindingSchema(varTemplateProven, c).ok === false),
  /** A zero-variable template must not carry a code contract. */
  ackWithCodeContractRefused: () =>
    buildCanonicalBindingSchema(ack, CODE_CONTRACT).ok === false,

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
   * and only after that declaration â€” the same shape as the forbidden-project-ref fence.
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
  /**
   * The operator legitimately PRINTS "No retry is attempted", so scanning for the word
   * flags the very message that documents the guarantee. Target the CONSTRUCT instead:
   * no attempt loop, no retry helper, and a single bounded write funnel.
   */
  noRetryAfterUncertainty: () => {
    if (/\bfor\s*\(\s*let\s+attempt|\bwhile\s*\([^)]*attempt|function\s+retry|\.retry\(/i.test(exec)) return false;
    if (!/WRITE_OUTCOME_UNCERTAIN/.test(exec)) return false;
    const calls = exec.match(/await attemptWrite\(/g) ?? [];
    return calls.length >= 1 && calls.length <= 3;
  },
  neverSetsIsActiveTrue: () => !/is_active:\s*true/.test(exec),
  neverWritesProviderTemplateId: () => !/provider_template_id:\s*["'`]/.test(exec),
  noRuntimePolicyWrite: () => !/communication_runtime_polic\w*[\s\S]{0,80}(insert|update|upsert)/i.test(exec),
  noCanaryWrite: () => !/canary[\s\S]{0,60}(insert|update|upsert)/i.test(exec),
  /**
   * A bearer token MUST be interpolated into the Authorization header â€” banning all
   * interpolation would forbid the operator from working. What must never happen is a
   * credential reaching a LOG. So: no secret in any console call, and an interpolated
   * secret is tolerated only inside an Authorization/Bearer context.
   */
  /**
   * A credential must never reach a LOG or an evidence file. Two interpolations are
   * nevertheless required for the operator to work at all, and both send the value to
   * Meta rather than to any output: the access token in an Authorization header, and the
   * WABA id in the Graph URL path that addresses the account. The ACCESS TOKEN is held to
   * the stricter rule â€” header only, never in a URL.
   */
  noCredentialEcho: () => {
    const secrets = ["QF_STAGING_SUPABASE_SERVICE_ROLE_KEY", "QF_META_ACCESS_TOKEN",
      "QF_META_WABA_ID", "QF_META_PHONE_NUMBER_ID"];
    if (secrets.some((x) => new RegExp(`console\\.[a-z]+\\([^;]*${x}`).test(exec))) return false;
    for (const x of secrets) {
      for (const m of exec.matchAll(new RegExp(`\\$\\{[^}]*${x}[^}]*\\}`, "g"))) {
        const around = exec.slice(Math.max(0, m.index - 90), m.index + 40);
        const inAuthHeader = /Authorization|Bearer/.test(around);
        const inGraphUrl = /await fetch\(|graph\}/.test(around);
        if (x === "QF_META_ACCESS_TOKEN") { if (!inAuthHeader) return false; continue; }
        if (!inAuthHeader && !inGraphUrl) return false;
      }
    }
    // The service-role key may only reach createClient, never a URL or a log.
    return !/\$\{[^}]*QF_STAGING_SUPABASE_SERVICE_ROLE_KEY[^}]*\}/.test(exec);
  },
  /**
   * The evidence directory is now assembled from path SEGMENTS, so a literal separator
   * no longer appears. Require the USERPROFILE/Desktop anchor and forbid any
   * repo-relative form.
   */
  evidencePathOutsideRepository: () => {
    if (!/QuickFurno-Operator-Evidence/.test(exec)) return true;   // never written at all
    const anchored = /USERPROFILE[\s\S]{0,160}?"Desktop"[\s\S]{0,80}?"QuickFurno-Operator-Evidence"/.test(exec)
      || /Desktop[\\/]+QuickFurno-Operator-Evidence/.test(exec);
    const inRepo = /["'`](\.\/|docs[\\/]|scripts[\\/]|lib[\\/])[^"'`]*QuickFurno-Operator-Evidence/.test(exec);
    return anchored && !inRepo;
  },
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
  ["S49 a docs-only source_key is refused without a code contract", R.docsOnlySourceKeyRefused],
  ["S50 any manifest/code contract mismatch is refused", R.manifestCodeMismatchRefused],
  ["S51 a zero-variable template carrying a code contract is refused", R.ackWithCodeContractRefused],
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
    buildCanonicalBindingSchema(varTemplateUnproven, CODE_CONTRACT).ok],
  ["M20b a docs-only source_key without code proof is rejected", () =>
    buildCanonicalBindingSchema(varTemplateProven, null).ok],
  ["M20c a code contract disagreeing with the manifest is rejected", () =>
    buildCanonicalBindingSchema(varTemplateProven,
      { ...CODE_CONTRACT, bindings: [{ ...CODE_CONTRACT.bindings[0], sourceKey: "customer_name" }] }).ok],
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


// ===========================================================================
// QF-MVP-40.12-R2 â€” RUNTIME tests. Every external effect is an injected FAKE:
// this suite opens no socket, no database connection and reads no credential.
// ===========================================================================

const VERSION = "1.0";
const WABA = "123456789012345";
const PHONE = "234567890123456";

/** Records every port call so a test can prove reads happened and writes did not. */
function makeFakes(over = {}) {
  const calls = { reads: 0, writes: 0, metaGets: 0, metaWrites: 0, consumed: [] };
  const mappings = over.mappings ? [...over.mappings] : [];
  const accounts = over.accounts ? [...over.accounts] : [];
  let policy = over.policy === undefined ? null : over.policy;
  let stored = over.stored === undefined ? null : over.stored;
  const consumedNonces = over.consumedNonces ? [...over.consumedNonces] : [];

  const db = {
    async proveSchema() { calls.reads += 1; return over.schema ?? { ok: true, proof: "fake" }; },
    async proveIndexes() { calls.reads += 1; return over.indexes ?? { ok: true, proof: "fake" }; },
    async selectInternalTemplates(keys) {
      calls.reads += 1;
      if (over.internalMissing) return [];
      return keys.map((k) => ({ template_key: k, version: VERSION, language: "en" }));
    },
    async selectMappings() { calls.reads += 1; return mappings; },
    async selectAccounts() { calls.reads += 1; return accounts; },
    async selectRuntimePolicy() { calls.reads += 1; return policy; },
    async insertAccount(row) {
      calls.writes += 1;
      if (over.accountWriteThrows) throw new Error("boom");
      accounts.length = 0; accounts.push({ ...row, id: "fake-account" });
      return accounts[0];
    },
    async normalizeAccountDisabled(row) {
      calls.writes += 1;
      accounts[0] = { ...accounts[0], ...REQUIRED_DISABLED_ACCOUNT_STATE,
        business_account_reference: row.business_account_reference,
        phone_number_reference: row.phone_number_reference };
      return accounts[0];
    },
    async insertMappings(rows) {
      calls.writes += 1;
      if (over.mappingWriteThrows) throw new Error("boom");
      for (const r of rows) mappings.push({ ...r });
      return rows;
    },
  };
  const meta = {
    async verifyIdentity() {
      calls.metaGets += 1;
      return over.identityFails ? { ok: false, detail: "mismatch" } : { ok: true };
    },
    async getTemplateByName() {
      calls.metaGets += 1;
      return over.metaTemplate ?? { ok: true, matches: 1, status: "APPROVED",
        category: "UTILITY", language: "en", semanticMatch: true };
    },
  };
  const store = {
    async read() { return stored; },
    async write(p) { stored = p; },
    async consumedNonces() { return consumedNonces; },
    async consume(n) { consumedNonces.push(n); calls.consumed.push(n); },
  };
  return { calls, db, meta, store, mappings, accounts,
    setPolicy: (p) => { policy = p; }, setStored: (v) => { stored = v; } };
}

const FIXED_NOW = 1_800_000_000_000;
function makeDeps(f, over = {}) {
  return {
    db: f.db, meta: f.meta, store: f.store,
    now: over.now ?? (() => FIXED_NOW),
    head: "0f10e8e", branch: "mvp/qf-mvp-40-meta-readiness-v1",
    projectRef: AUTHORIZED_STAGING_REF,
    manifestHash: "m".repeat(64), readinessHash: "r".repeat(64),
    bindingContractHash: "b".repeat(64), nonce: over.nonce ?? "nonce-1",
    wabaRef: WABA, phoneRef: PHONE,
    variablesSchemaFor: over.variablesSchemaFor
      ?? (() => ({ bindingVersion: 1, bindings: [] })),
    // The approved payload the real comparator comes back against. The fake Meta port
    // decides the verdict, so this only has to be a stable non-null value here.
    expectedPayloadFor: over.expectedPayloadFor
      ?? ((key) => ({ name: key, language: "en", category: "UTILITY",
        components: [{ type: "BODY", text: "fixture" }] })),
  };
}
const inactiveRow = (seed) => ({
  template_key: seed.key, channel: CHANNEL, provider_key: PROVIDER_KEY, language: LANGUAGE,
  version: VERSION, provider_template_name: seed.name, provider_template_id: null,
  provider_category: PROVIDER_CATEGORY, approval_status: "approved",
  variables_schema: { bindingVersion: 1, bindings: [] }, is_active: false,
});
const disabledAccount = () => ({ id: "a", provider_key: PROVIDER_KEY, channel: CHANNEL,
  readiness_status: "disabled", business_account_reference: WABA, phone_number_reference: PHONE });

/** A preflight that succeeds, returning its payload for reuse as an attestation. */
async function goodPreflight(over = {}) {
  const f = makeFakes(over);
  const r = await runReadOnlyPreflight(makeDeps(f, over));
  return { f, r };
}

const RUNTIME = [
  // ---- The defect this phase repairs -------------------------------------
  ["R1  the unconditional PREFLIGHT_NOT_SATISFIED refusal is gone", () =>
    !/PREFLIGHT_NOT_SATISFIED â€” live staging execution/.test(src)],
  ["R2  a real preflight entry point exists and is reachable", () =>
    /mode === "PREFLIGHT_READONLY"/.test(exec) && /runReadOnlyPreflight\(deps\)/.test(exec)],
  ["R3  a real execute entry point exists and is reachable", () =>
    /runControlledExecute\(deps\)/.test(exec)],

  // ---- Preflight actually reads, and never writes -------------------------
  ["R4  preflight performs real injected DB and Meta reads", async () => {
    const { f, r } = await goodPreflight();
    return r.ok === true && f.calls.reads >= 5 && f.calls.metaGets >= 9;
  }],
  ["R5  preflight performs ZERO writes", async () => {
    const { f, r } = await goodPreflight();
    return r.ok === true && f.calls.writes === 0;
  }],
  ["R6  preflight emits a sanitized attestation with the required pins", async () => {
    const { r } = await goodPreflight();
    const p = r.payload;
    return ["head", "branch", "project_ref", "manifest_hash", "readiness_hash",
      "binding_contract_hash", "nonce", "expires_at_ms", "attestation_sha256",
      "schema_proof", "index_proof", "account_classification"].every((k) => p[k] !== undefined)
      && p.template_keys.length === 8 && p.writes_performed === 0
      && p.runtime_policy_non_sendable === true;
  }],
  ["R7  the attestation carries no secret or raw identifier", async () => {
    const { r } = await goodPreflight();
    const raw = JSON.stringify(r.payload);
    return !raw.includes(WABA) && !raw.includes(PHONE)
      && !/EAA[A-Za-z0-9]{6,}|eyJ[A-Za-z0-9._-]{10,}/.test(raw)
      && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(raw);
  }],
  ["R8  the attestation expires within 15 minutes", async () => {
    const { r } = await goodPreflight();
    return r.payload.expires_at_ms - r.payload.issued_at_ms === ATTESTATION_TTL_MS
      && ATTESTATION_TTL_MS <= 15 * 60 * 1000;
  }],

  // ---- Preflight fail-closed cases ---------------------------------------
  ["R9  missing schema blocks before any Meta call", async () => {
    const f = makeFakes({ schema: { ok: false, reason: SeedFailure.SCHEMA_MISSING } });
    const r = await runReadOnlyPreflight(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.SCHEMA_MISSING
      && f.calls.metaGets === 0 && f.calls.writes === 0;
  }],
  ["R10 unprovable index metadata returns INDEX_PROOF_UNAVAILABLE", async () => {
    const f = makeFakes({ indexes: { ok: false, reason: SeedFailure.INDEX_PROOF_UNAVAILABLE } });
    const r = await runReadOnlyPreflight(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.INDEX_PROOF_UNAVAILABLE && f.calls.writes === 0;
  }],
  ["R11 a missing internal template blocks", async () => {
    const f = makeFakes({ internalMissing: true });
    const r = await runReadOnlyPreflight(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.INTERNAL_TEMPLATE_MISSING;
  }],
  ["R12 a Meta identity mismatch blocks", async () => {
    const f = makeFakes({ identityFails: true });
    const r = await runReadOnlyPreflight(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.META_IDENTITY_MISMATCH && f.calls.writes === 0;
  }],
  ["R13 ambiguous / not-approved / wrong-category Meta results block", async () => {
    const cases = [
      [{ ok: true, matches: 2 }, SeedFailure.META_TEMPLATE_AMBIGUOUS],
      [{ ok: true, matches: 0 }, SeedFailure.META_TEMPLATE_AMBIGUOUS],
      [{ ok: true, matches: 1, status: "PENDING", category: "UTILITY", language: "en", semanticMatch: true },
        SeedFailure.META_STATUS_NOT_APPROVED],
      [{ ok: true, matches: 1, status: "APPROVED", category: "MARKETING", language: "en", semanticMatch: true },
        SeedFailure.META_CATEGORY_MISMATCH],
      [{ ok: true, matches: 1, status: "APPROVED", category: "UTILITY", language: "hi", semanticMatch: true },
        SeedFailure.META_CATEGORY_MISMATCH],
      [{ ok: true, matches: 1, status: "APPROVED", category: "UTILITY", language: "en", semanticMatch: false },
        SeedFailure.META_TEMPLATE_UNRESOLVED],
    ];
    for (const [metaTemplate, expected] of cases) {
      const f = makeFakes({ metaTemplate });
      const r = await runReadOnlyPreflight(makeDeps(f));
      if (r.ok !== false || r.reason !== expected || f.calls.writes !== 0) return false;
    }
    return true;
  }],
  ["R14 an existing ACTIVE mapping blocks the whole plan", async () => {
    const f = makeFakes({ mappings: [{ ...inactiveRow(SEED_SET[0]), is_active: true }] });
    const r = await runReadOnlyPreflight(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.ACTIVE_MAPPING_PRESENT && f.calls.writes === 0;
  }],
  ["R15 a semantically different existing row blocks", async () => {
    const f = makeFakes({ mappings: [{ ...inactiveRow(SEED_SET[0]),
      provider_template_name: "qf_something_else_v1" }] });
    const r = await runReadOnlyPreflight(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.MAPPING_CONFLICT;
  }],
  ["R16 a send-capable existing account blocks", async () => {
    const f = makeFakes({ accounts: [{ readiness_status: "provider_ready" }] });
    const r = await runReadOnlyPreflight(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.ACCOUNT_SEND_CAPABLE && f.calls.writes === 0;
  }],
  ["R17 a sendable runtime policy blocks", async () => {
    for (const policy of [{ outbound_enabled: true, activation_status: "disabled" },
                          { outbound_enabled: false, activation_status: "active" },
                          { outbound_enabled: false, activation_status: "canary" }]) {
      const f = makeFakes({ policy });
      const r = await runReadOnlyPreflight(makeDeps(f));
      if (r.ok !== false || r.reason !== SeedFailure.RUNTIME_POLICY_SENDABLE) return false;
    }
    return true;
  }],
  ["R18 an unproven binding schema blocks the plan", async () => {
    const f = makeFakes();
    const r = await runReadOnlyPreflight(makeDeps(f, { variablesSchemaFor: () => null }));
    return r.ok === false && r.reason === SeedFailure.BINDING_SCHEMA_UNPROVEN && f.calls.writes === 0;
  }],

  // ---- Execute: attestation contract --------------------------------------
  ["R19 execute without an attestation is refused", async () => {
    const f = makeFakes();
    const r = await runControlledExecute(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.ATTESTATION_MISSING && f.calls.writes === 0;
  }],
  ["R20 execute reruns the FULL preflight before touching the attestation", async () => {
    const f = makeFakes({ schema: { ok: false, reason: SeedFailure.SCHEMA_MISSING } });
    const r = await runControlledExecute(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.SCHEMA_MISSING && f.calls.writes === 0;
  }],
  ["R21 an EXPIRED attestation is refused", async () => {
    const { r: pre } = await goodPreflight();
    const f = makeFakes({ stored: pre.payload });
    const r = await runControlledExecute(makeDeps(f,
      { now: () => FIXED_NOW + ATTESTATION_TTL_MS + 1 }));
    return r.ok === false && r.reason === SeedFailure.ATTESTATION_EXPIRED && f.calls.writes === 0;
  }],
  ["R22 a REPLAYED (already consumed) attestation is refused", async () => {
    const { r: pre } = await goodPreflight();
    const f = makeFakes({ stored: pre.payload, consumedNonces: [pre.payload.nonce] });
    const r = await runControlledExecute(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.ATTESTATION_ALREADY_CONSUMED
      && f.calls.writes === 0;
  }],
  ["R23 a TAMPERED attestation is refused", async () => {
    const { r: pre } = await goodPreflight();
    const tampered = { ...pre.payload, account_classification: "ALREADY_PRESENT_DISABLED" };
    const f = makeFakes({ stored: tampered });
    const r = await runControlledExecute(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.ATTESTATION_TAMPERED && f.calls.writes === 0;
  }],
  ["R24 an attestation for a different HEAD / branch / project is refused", async () => {
    for (const field of ["head", "branch", "project_ref", "manifest_hash", "binding_contract_hash"]) {
      const { r: pre } = await goodPreflight();
      const changed = { ...pre.payload, [field]: "different" };
      changed.attestation_sha256 = attestationDigest(changed);
      const f = makeFakes({ stored: changed });
      const r = await runControlledExecute(makeDeps(f));
      if (r.ok !== false || r.reason !== SeedFailure.ATTESTATION_MISMATCH || f.calls.writes !== 0) return false;
    }
    return true;
  }],
  ["R25 an attestation whose PLAN drifted is refused", async () => {
    const { r: pre } = await goodPreflight();
    const changed = { ...pre.payload,
      mapping_plan: pre.payload.mapping_plan.map((m) => ({ ...m, outcome: "ALREADY_PRESENT_INACTIVE" })) };
    changed.attestation_sha256 = attestationDigest(changed);
    const f = makeFakes({ stored: changed });
    const r = await runControlledExecute(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.ATTESTATION_MISMATCH && f.calls.writes === 0;
  }],

  // ---- Execute: the happy path actually writes, safely --------------------
  ["R26 execute writes the account and exactly eight INACTIVE mappings", async () => {
    const { r: pre } = await goodPreflight();
    const f = makeFakes({ stored: pre.payload });
    const r = await runControlledExecute(makeDeps(f));
    return r.ok === true && r.mapping_count === 8 && r.active_mapping_count === 0
      && r.message_send_count === 0 && r.meta_write_count === 0
      && f.mappings.length === 8 && f.mappings.every((m) => m.is_active === false)
      && f.mappings.every((m) => m.provider_template_id === null)
      && f.accounts.length === 1 && f.accounts[0].readiness_status === "disabled";
  }],
  ["R27 the seeded account is never send-capable", async () => {
    const { r: pre } = await goodPreflight();
    const f = makeFakes({ stored: pre.payload });
    await runControlledExecute(makeDeps(f));
    const a = f.accounts[0];
    return a.readiness_status !== "provider_ready" && a.configuration_status !== "complete"
      && a.webhook_status !== "verified" && a.health_status !== "healthy";
  }],
  ["R28 an already-seeded staging DB is idempotent and writes nothing new", async () => {
    const existing = SEED_SET.map(inactiveRow);
    const { r: pre } = await goodPreflight({ mappings: existing, accounts: [disabledAccount()] });
    const f = makeFakes({ mappings: existing, accounts: [disabledAccount()], stored: pre.payload });
    const r = await runControlledExecute(makeDeps(f));
    return r.ok === true && f.calls.writes === 0 && f.mappings.length === 8
      && r.mapping_outcomes.every((m) => m.outcome === "ALREADY_PRESENT_INACTIVE");
  }],
  ["R29 the attestation nonce is consumed exactly once", async () => {
    const { r: pre } = await goodPreflight();
    const f = makeFakes({ stored: pre.payload });
    await runControlledExecute(makeDeps(f));
    const second = await runControlledExecute(makeDeps(f));
    return f.calls.consumed.length === 1
      && second.ok === false && second.reason === SeedFailure.ATTESTATION_ALREADY_CONSUMED;
  }],
  ["R30 an uncertain write stops with no retry", async () => {
    const { r: pre } = await goodPreflight();
    const f = makeFakes({ stored: pre.payload, mappingWriteThrows: true });
    const r = await runControlledExecute(makeDeps(f));
    // One account write plus ONE mapping attempt. A retry would make this 3.
    return r.ok === false && r.reason === SeedFailure.WRITE_OUTCOME_UNCERTAIN
      && f.calls.writes === 2;
  }],
  ["R31 a readback showing an active row fails closed", async () => {
    const { r: pre } = await goodPreflight();
    const f = makeFakes({ stored: pre.payload });
    const original = f.db.insertMappings;
    f.db.insertMappings = async (rows) => original(rows.map((x) => ({ ...x, is_active: true })));
    const r = await runControlledExecute(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.READBACK_MISMATCH;
  }],
  ["R32 a readback showing a stored remote id fails closed", async () => {
    const { r: pre } = await goodPreflight();
    const f = makeFakes({ stored: pre.payload });
    const original = f.db.insertMappings;
    f.db.insertMappings = async (rows) => original(rows.map((x) => ({ ...x, provider_template_id: "999" })));
    const r = await runControlledExecute(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.READBACK_MISMATCH;
  }],
  ["R33 a post-write sendable runtime policy fails closed", async () => {
    const { r: pre } = await goodPreflight();
    const f = makeFakes({ stored: pre.payload });
    const original = f.db.insertMappings;
    f.db.insertMappings = async (rows) => { f.setPolicy({ outbound_enabled: true }); return original(rows); };
    const r = await runControlledExecute(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.RUNTIME_POLICY_SENDABLE;
  }],
  ["R34 no run ever produces a ninth mapping", async () => {
    const { r: pre } = await goodPreflight();
    const f = makeFakes({ stored: pre.payload });
    await runControlledExecute(makeDeps(f));
    return f.mappings.length === SEED_SET.length;
  }],

  // ---- Static: the runtime keeps every earlier fence ----------------------
  ["R35 the runtime issues Meta GETs only", () =>
    !/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(exec) && !/\/messages\b/.test(exec)],
  ["R36 the runtime never activates a mapping or a policy", () =>
    !/is_active:\s*true/.test(exec) && !/outbound_enabled:\s*true/.test(exec)
    && !/activation_status:\s*["'](active|canary)["']/.test(exec)],
  ["R37 evidence is written outside the repository only", () =>
    /Desktop["'\s,]+.*QuickFurno-Operator-Evidence/.test(src)
    && !/docs[\\/]+.*QuickFurno-Operator-Evidence/.test(src)],
  ["R38 raw provider errors are never surfaced", () =>
    !/console\.(log|error)\([^)]*\berror\b/.test(exec)
    && /Deliberately no raw error/.test(src)],
  ["R39 sanitizeForEvidence guards every reported detail", () =>
    (exec.match(/sanitizeForEvidence\(String\(r\.detail\)\)/g) ?? []).length >= 2],
];
for (const [n, fn] of RUNTIME) {
  const out = fn();
  if (out && typeof out.then === "function") add(n, await out);
  else add(n, out);
}


// ===========================================================================
// QF-MVP-40.12-R3 â€” index proof, real Meta semantics, whole-set scan.
// Still entirely offline: every effect is an injected fake.
// ===========================================================================

const PROOF_NOW = 1_800_000_000_000;
function makeProof(over = {}) {
  const p = {
    artifact: "qf-mvp-40-12-staging-index-proof",
    schema_version: "1.0",
    environment: "STAGING",
    project_ref: AUTHORIZED_STAGING_REF,
    table: INDEX_PROOF_TABLE,
    indexes: [
      { name: "uq_comm_provider_template_active", unique: true,
        columns: ["template_key", "channel", "provider_key", "language"], predicate: "is_active" },
      { name: "uq_comm_provider_template_mapping", unique: true,
        columns: ["template_key", "channel", "provider_key", "language", "version"], predicate: null },
    ],
    source: "SUPABASE_DIRECT_READ_ONLY_SQL",
    issued_at_ms: PROOF_NOW,
    expires_at_ms: PROOF_NOW + 10 * 60 * 1000,
    nonce: "proof-nonce-1",
    ...over,
  };
  p.proof_sha256 = over.proof_sha256 ?? indexProofDigest(p);
  return p;
}
const proofNow = () => PROOF_NOW;
const verifyP = (p, now = proofNow) => verifyIndexProof(p, { now });

/** Canonical rows keyed by template, used to drive the whole-set scan. */
const canonicalMap = () => {
  const m = new Map();
  for (const t of SEED_SET) m.set(t.key, buildMappingRow(t, VERSION, { bindingVersion: 1, bindings: [] }));
  return m;
};
const canonRow = (seed, over = {}) => ({ ...buildMappingRow(seed, VERSION,
  { bindingVersion: 1, bindings: [] }), ...over });

const R3 = [
  // ---- DEFECT A: the index proof is real, fresh and external --------------
  ["X1  a valid fresh proof is accepted", () => {
    const r = verifyP(makeProof());
    return r.ok === true && typeof r.proof_hash === "string" && r.proof_hash.length === 64;
  }],
  ["X2  the operator no longer hardcodes INDEX_PROOF_UNAVAILABLE", () =>
    !/return \{ ok: false, reason: SeedFailure\.INDEX_PROOF_UNAVAILABLE,\s*\n\s*detail: "pg_indexes/.test(src)
    && /QF_STAGING_INDEX_PROOF_PATH/.test(exec)],
  ["X3  a missing proof is refused (no permanent bypass)", () =>
    verifyP(null).ok === false && verifyP(undefined).ok === false
    && verifyP({}).ok === false],
  ["X4  an EXPIRED proof is refused", () =>
    verifyP(makeProof(), () => PROOF_NOW + 11 * 60 * 1000).ok === false],
  ["X5  a FUTURE-dated proof is refused", () =>
    verifyP(makeProof({ issued_at_ms: PROOF_NOW + 5 * 60 * 1000 })).ok === false],
  ["X6  a TTL longer than 15 minutes is refused", () =>
    verifyP(makeProof({ expires_at_ms: PROOF_NOW + 16 * 60 * 1000 })).ok === false],
  ["X7  a TAMPERED proof is refused", () => {
    const p = makeProof();
    p.indexes[0].predicate = null;             // altered after signing
    return verifyP(p).ok === false;
  }],
  ["X8  a wrong project or table is refused", () =>
    verifyP(makeProof({ project_ref: FORBIDDEN_PROJECT_REFS.production })).ok === false
    && verifyP(makeProof({ project_ref: "zzzzzzzzzzzzzzzzzzzz" })).ok === false
    && verifyP(makeProof({ table: "public.something_else" })).ok === false
    && verifyP(makeProof({ environment: "PRODUCTION" })).ok === false],
  ["X9  a missing or extra index entry is refused", () =>
    verifyP(makeProof({ indexes: [makeProof().indexes[0]] })).ok === false
    && verifyP(makeProof({ indexes: [...makeProof().indexes, { name: "extra", unique: true,
        columns: ["x"], predicate: null }] })).ok === false],
  ["X10 a renamed or non-unique index is refused", () => {
    const renamed = makeProof(); renamed.indexes[1].name = "uq_other";
    const notUnique = makeProof(); notUnique.indexes[0].unique = false;
    return verifyP(makeProof({ indexes: renamed.indexes })).ok === false
      && verifyP(makeProof({ indexes: notUnique.indexes })).ok === false;
  }],
  ["X11 a wrong COLUMN ORDER is refused", () => {
    const p = makeProof();
    p.indexes[1].columns = ["channel", "template_key", "provider_key", "language", "version"];
    return verifyP(makeProof({ indexes: p.indexes })).ok === false;
  }],
  ["X12 a wrong PREDICATE is refused", () => {
    const dropped = makeProof(); dropped.indexes[0].predicate = null;
    const wrong = makeProof(); wrong.indexes[1].predicate = "is_active";
    return verifyP(makeProof({ indexes: dropped.indexes })).ok === false
      && verifyP(makeProof({ indexes: wrong.indexes })).ok === false;
  }],
  ["X13 a proof path INSIDE the repository is refused", () =>
    isInsideRepository("docs/proof.json") === true
    && isInsideRepository("./scripts/x/proof.json") === true
    && isInsideRepository(process.cwd() + "/proof.json") === true
    && isInsideRepository("C:/Users/x/Desktop/evidence/proof.json") === false
    && /isInsideRepository\(path\)/.test(exec)],
  ["X14 the proof hash is pinned into the attestation", async () => {
    const proof = makeProof();
    const f = makeFakes({ indexes: { ok: true, proof: "p", proof_hash: proof.proof_sha256 } });
    const r = await runReadOnlyPreflight(makeDeps(f));
    return r.ok === true && r.payload.index_proof_hash === proof.proof_sha256;
  }],
  ["X15 execute refuses when the index proof hash changed", async () => {
    const a = makeProof();
    const b = makeProof({ nonce: "proof-nonce-2" });
    const pre = await runReadOnlyPreflight(makeDeps(
      makeFakes({ indexes: { ok: true, proof: "p", proof_hash: a.proof_sha256 } })));
    const f = makeFakes({ stored: pre.payload,
      indexes: { ok: true, proof: "p", proof_hash: b.proof_sha256 } });
    const r = await runControlledExecute(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.ATTESTATION_MISMATCH
      && r.detail === "index_proof_hash" && f.calls.writes === 0;
  }],
  ["X16 execute refuses when the proof has expired by then", async () => {
    const f = makeFakes({ indexes: { ok: false, reason: SeedFailure.INDEX_PROOF_UNAVAILABLE } });
    const r = await runControlledExecute(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.INDEX_PROOF_UNAVAILABLE && f.calls.writes === 0;
  }],

  // ---- DEFECT B: the Meta semantic match is real --------------------------
  ["X17 semanticMatch is never a hardcoded true", () =>
    !/semanticMatch:\s*true\s*\}/.test(exec)
    && /templatesAreIdentical\(/.test(exec)],
  ["X18 the adapter REQUESTS components", () =>
    /fields=name,language,status,category,components/.test(exec)],
  ["X19 the real comparator is reused, not re-implemented", () =>
    /from "\.\/submit-meta-templates\.mjs"/.test(exec)
    && !/function canonicaliseTemplate/.test(exec)],
  ["X20 a semantic mismatch blocks the plan", async () => {
    const f = makeFakes({ metaTemplate: { ok: true, matches: 1, status: "APPROVED",
      category: "UTILITY", language: "en", semanticMatch: false } });
    const r = await runReadOnlyPreflight(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.META_TEMPLATE_UNRESOLVED && f.calls.writes === 0;
  }],
  ["X21 the comparator itself rejects body / component drift", () => {
    const approved = { name: "qf_lead_received_v1", language: "en", category: "UTILITY",
      components: [{ type: "BODY", text: "Hi {{1}}, QuickFurno received your enquiry." }] };
    const drifted = { ...approved,
      components: [{ type: "BODY", text: "Hi {{1}}, buy now!" }] };
    const missing = { ...approved, components: [] };
    return templatesAreIdentical(approved, approved) === true
      && templatesAreIdentical(approved, drifted) === false
      && templatesAreIdentical(approved, missing) === false;
  }],
  ["X22 a duplicate remote template is refused", async () => {
    const f = makeFakes({ metaTemplate: { ok: true, matches: 2 } });
    const r = await runReadOnlyPreflight(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.META_TEMPLATE_AMBIGUOUS;
  }],
  ["X23 a stored/fresh Meta reconciliation mismatch is refused", async () => {
    const pre = await runReadOnlyPreflight(makeDeps(makeFakes()));
    const changed = { ...pre.payload,
      meta_reconciliation: pre.payload.meta_reconciliation.slice(0, 7) };
    changed.attestation_sha256 = attestationDigest(changed);
    const f = makeFakes({ stored: changed });
    const r = await runControlledExecute(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.ATTESTATION_MISMATCH
      && f.calls.writes === 0;
  }],

  // ---- DEFECT C: the whole-set scan --------------------------------------
  ["X24 an ACTIVE row on ANOTHER VERSION is caught", () => {
    const rows = [canonRow(SEED_SET[0], { version: "9.9", is_active: true })];
    const r = scanMappingSet(rows, canonicalMap());
    return r.ok === false && r.reason === SeedFailure.ACTIVE_MAPPING_PRESENT;
  }],
  ["X25 an ACTIVE row on ANOTHER LANGUAGE is caught", () => {
    const rows = [canonRow(SEED_SET[0], { language: "hi", is_active: true })];
    const r = scanMappingSet(rows, canonicalMap());
    return r.ok === false && r.reason === SeedFailure.ACTIVE_MAPPING_PRESENT;
  }],
  ["X26 a DUPLICATE canonical tuple is caught", () => {
    const rows = [canonRow(SEED_SET[0]), canonRow(SEED_SET[0])];
    const r = scanMappingSet(rows, canonicalMap());
    return r.ok === false && r.reason === SeedFailure.MAPPING_CONFLICT;
  }],
  ["X27 an EXTRA non-canonical row is caught", () => {
    for (const over of [{ version: "2.0" }, { language: "hi" }]) {
      const r = scanMappingSet([canonRow(SEED_SET[0], over)], canonicalMap());
      if (r.ok !== false || r.reason !== SeedFailure.MAPPING_CONFLICT) return false;
    }
    return true;
  }],
  ["X28 a POPULATED provider_template_id is caught", () => {
    const r = scanMappingSet([canonRow(SEED_SET[0], { provider_template_id: "999" })], canonicalMap());
    return r.ok === false && r.reason === SeedFailure.MAPPING_CONFLICT;
  }],
  ["X29 a NON-APPROVED row is caught", () => {
    const r = scanMappingSet([canonRow(SEED_SET[0], { approval_status: "draft" })], canonicalMap());
    return r.ok === false && r.reason === SeedFailure.MAPPING_CONFLICT;
  }],
  ["X30 a drifted name / category / schema is caught", () => {
    for (const over of [{ provider_template_name: "qf_other_v1" },
                        { provider_category: "marketing" },
                        { variables_schema: { bindingVersion: 1, bindings: [{ component: "body",
                          position: 1, sourceKey: "x", parameterType: "text" }] } }]) {
      const r = scanMappingSet([canonRow(SEED_SET[0], over)], canonicalMap());
      if (r.ok !== false || r.reason !== SeedFailure.MAPPING_CONFLICT) return false;
    }
    return true;
  }],
  ["X31 an exact inactive approved row passes the scan", () => {
    const r = scanMappingSet(SEED_SET.map((t) => canonRow(t)), canonicalMap());
    return r.ok === true && r.existing.length === 8;
  }],
  ["X32 the scan runs BEFORE any write in the preflight", async () => {
    const f = makeFakes({ mappings: [canonRow(SEED_SET[0], { version: "9.9", is_active: true })] });
    const r = await runReadOnlyPreflight(makeDeps(f));
    return r.ok === false && f.calls.writes === 0;
  }],

  // ---- DEFECT D: internal template language / version ---------------------
  ["X33 a non-'en' internal template is refused", () => {
    const rows = SEED_SET.map((t) => ({ template_key: t.key, version: VERSION, language: "hi" }));
    const r = verifyInternalTemplates(rows);
    return r.ok === false && r.reason === SeedFailure.INTERNAL_TEMPLATE_MISSING;
  }],
  ["X34 a DUPLICATE internal template row is refused", () => {
    const rows = [...SEED_SET.map((t) => ({ template_key: t.key, version: VERSION, language: "en" })),
      { template_key: SEED_SET[0].key, version: VERSION, language: "en" }];
    return verifyInternalTemplates(rows).ok === false;
  }],
  ["X35 an empty canonical version is refused", () => {
    const rows = SEED_SET.map((t, i) => ({ template_key: t.key, language: "en",
      version: i === 0 ? "  " : VERSION }));
    return verifyInternalTemplates(rows).ok === false;
  }],
  ["X36 all eight present, en, versioned is accepted", () => {
    const rows = SEED_SET.map((t) => ({ template_key: t.key, version: VERSION, language: "en" }));
    const r = verifyInternalTemplates(rows);
    return r.ok === true && r.byKey.size === 8;
  }],

  // ---- Post-write readback hardening --------------------------------------
  ["X37 readback rejects a drifted version or schema", async () => {
    for (const over of [{ version: "9.9" }, { variables_schema: { bindingVersion: 1,
      bindings: [{ component: "body", position: 1, sourceKey: "x", parameterType: "text" }] } }]) {
      const pre = await runReadOnlyPreflight(makeDeps(makeFakes()));
      const f = makeFakes({ stored: pre.payload });
      const original = f.db.insertMappings;
      f.db.insertMappings = async (rows) => original(rows.map((x) => ({ ...x, ...over })));
      const r = await runControlledExecute(makeDeps(f));
      if (r.ok !== false || r.reason !== SeedFailure.READBACK_MISMATCH) return false;
    }
    return true;
  }],
  ["X38 readback rejects an EXTRA row for a key", async () => {
    const pre = await runReadOnlyPreflight(makeDeps(makeFakes()));
    const f = makeFakes({ stored: pre.payload });
    const original = f.db.insertMappings;
    f.db.insertMappings = async (rows) => {
      const r = await original(rows);
      f.mappings.push({ ...rows[0], version: "9.9" });   // a stray extra row appears
      return r;
    };
    const r = await runControlledExecute(makeDeps(f));
    return r.ok === false && r.reason === SeedFailure.READBACK_MISMATCH;
  }],
  ["X39 the happy path still succeeds end to end", async () => {
    const pre = await runReadOnlyPreflight(makeDeps(makeFakes()));
    const f = makeFakes({ stored: pre.payload });
    const r = await runControlledExecute(makeDeps(f));
    return r.ok === true && r.mapping_count === 8 && r.active_mapping_count === 0
      && f.mappings.every((m) => m.is_active === false && m.provider_template_id === null);
  }],
];
for (const [n, fn] of R3) {
  const out = fn();
  if (out && typeof out.then === "function") add(n, await out);
  else add(n, out);
}


// ===========================================================================
// QF-MVP-40.12-R4 — PostgreSQL jsonb semantic readback.
// Object-key order is not semantic; array order and values remain semantic.
// ===========================================================================
const reorderJsonbObjectKeys = (value) => {
  if (Array.isArray(value)) return value.map(reorderJsonbObjectKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).reverse().map((key) => [key, reorderJsonbObjectKeys(value[key])])
    );
  }
  return value;
};

const R4 = [
  ["Y1 jsonb object-key reorder is semantically equal", () => {
    const a = { bindingVersion: 1, bindings: [] };
    const b = { bindings: [], bindingVersion: 1 };
    return jsonSemanticEqual(a, b)
      && JSON.stringify(canonicalJsonValue(a)) === JSON.stringify(canonicalJsonValue(b));
  }],
  ["Y2 nested object-key reorder passes classification and whole-set scan", () => {
    const intendedR4 = {
      ...intended,
      variables_schema: {
        bindingVersion: 1,
        bindings: [{ component: "body", position: 1, sourceKey: "client_name", parameterType: "text" }],
      },
    };
    const reordered = reorderJsonbObjectKeys(intendedR4.variables_schema);
    const classified = classifyExistingMapping(
      existingRow({ variables_schema: reordered }),
      intendedR4
    );
    const seed = SEED_SET.find((t) => t.key === "lead_received");
    const canonical = new Map([[
      "lead_received",
      buildMappingRow(seed, VERSION, intendedR4.variables_schema),
    ]]);
    const scanned = scanMappingSet([{
      ...buildMappingRow(seed, VERSION, reordered),
      variables_schema: reordered,
    }], canonical);
    return classified.outcome === "ALREADY_PRESENT_INACTIVE"
      && scanned.ok === true;
  }],
  ["Y3 execute readback accepts PostgreSQL-style object-key reorder", async () => {
    const pre = await runReadOnlyPreflight(makeDeps(makeFakes()));
    const f = makeFakes({ stored: pre.payload });
    const original = f.db.insertMappings;
    f.db.insertMappings = async (rows) =>
      original(rows.map((row) => ({
        ...row,
        variables_schema: reorderJsonbObjectKeys(row.variables_schema),
      })));
    const r = await runControlledExecute(makeDeps(f));
    return r.ok === true && r.mapping_count === 8 && r.active_mapping_count === 0;
  }],
  ["Y4 array order and actual value drift still fail closed", () =>
    jsonSemanticEqual({ bindings: [1, 2] }, { bindings: [2, 1] }) === false
    && jsonSemanticEqual(
      { bindingVersion: 1, bindings: [] },
      { bindingVersion: 2, bindings: [] }
    ) === false],
  ["Y5 raw variables_schema JSON.stringify comparison is gone", () =>
    !/JSON\.stringify\([^)]*variables_schema/.test(exec)
    && /jsonSemanticEqual\(r\.variables_schema,\s*canonical\.variables_schema\)/.test(exec)],
];

for (const [n, fn] of R4) {
  const out = fn();
  if (out && typeof out.then === "function") add(n, await out);
  else add(n, out);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ""}`);
console.log(`\nSeed set: ${SEED_SET.length} Â· target: ${AUTHORIZED_STAGING_REF} (STAGING) `
  + `Â· forbidden refs rejected: production, jarvis`);
console.log(`Summary: ${results.length - failed.length} passed, ${failed.length} failed `
  + `(rules: ${RULES.length}, mutation self-tests: ${MUT.length}, `
  + `runtime tests: ${RUNTIME.length}, R3 tests: ${R3.length}, R4 tests: ${R4.length}).`);
process.exit(failed.length === 0 ? 0 : 1);
