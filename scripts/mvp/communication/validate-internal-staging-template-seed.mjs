// ============================================================================
// QF-MVP-40.12 prerequisite R1 — OFFLINE validator.
// No network, no Supabase client, no credential, no database write.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PHASE,
  AUTHORIZED_STAGING_REF,
  AUTHORIZED_BRANCH,
  FORBIDDEN_PROJECT_REFS,
  CHANNEL,
  LANGUAGE,
  INTERNAL_VERSION,
  INTERNAL_READINESS,
  INTERNAL_IS_ACTIVE,
  TARGET_SPEC,
  SeedFailure,
  resolveMode,
  parseProjectRef,
  validateServiceRoleKey,
  resolveStagingTarget,
  loadAuthorityFiles,
  classifyExistingTemplate,
  buildPlan,
  verifyReadback,
  buildAttestation,
  verifyAttestation,
  pathIsInsideRepository,
  runReadOnlyPreflight,
} from "./seed-internal-staging-templates.mjs";

const OPERATOR = "scripts/mvp/communication/seed-internal-staging-templates.mjs";
const src = readFileSync(resolve(OPERATOR), "utf8");
const exec = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");

const results = [];
const add = (name, ok, detail = "") => results.push({ name, ok: ok === true, detail });

function fakeJwt(role) {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ role })}.signature`;
}

const GOOD_ENV = Object.freeze({
  QF_STAGING_SUPABASE_URL: `https://${AUTHORIZED_STAGING_REF}.supabase.co`,
  QF_STAGING_SUPABASE_SERVICE_ROLE_KEY: fakeJwt("service_role"),
  USERPROFILE: "C:\\Users\\operator",
});

const authority = loadAuthorityFiles();
const expectedRows = authority.ok ? authority.rows : [];
const exactRows = expectedRows.map((r) => ({ ...r }));

const R = {
  exactPhase: () => PHASE === "QF-MVP-40.12-PREREQ-R1",
  // QF-MVP-40.13C-R2 RE-PIN: exact equality against the branch that carries the certified
  // live-run authority. Still ONE literal — never a wildcard, prefix, list or env override.
  exactBranch: () => AUTHORIZED_BRANCH === "mvp/qf-mvp-40-final-provider-canary",
  // Asserted over the COMMENT-STRIPPED operator source, so the prose explaining the
  // re-pin can neither satisfy nor defeat the guard.
  branchIsExactSingleLiteral: () =>
    /export const AUTHORIZED_BRANCH = "mvp\/qf-mvp-40-final-provider-canary";/.test(exec)
    && !/AUTHORIZED_BRANCH\s*=\s*\[/.test(exec)
    && !/AUTHORIZED_BRANCH\.(startsWith|includes|test)/.test(exec)
    && !/process\.env\.[A-Z_]*BRANCH/.test(exec)
    && /git\.branch !== AUTHORIZED_BRANCH/.test(exec),
  cleanTreeAndHeadPinPreserved: () =>
    /if \(!git\.clean\)/.test(exec)
    && /GIT_DIRTY/.test(exec)
    && /rev-parse", "HEAD"/.test(exec)
    && /head: git\.head/.test(exec),
  exactTargetSet: () => TARGET_SPEC.length === 5 && TARGET_SPEC.map((t) => t.key).join(",") === [
    "consent_help_response", "consent_stop_acknowledgement", "consent_start_acknowledgement",
    "client_lead_status_update",
    "vendor_onboarding_reminder",
  ].join(","),
  exactClassificationSplit: () => TARGET_SPEC.filter((t) => t.classification === "EVIDENCE_BOUND_ACK").length === 3
    && TARGET_SPEC.filter((t) => t.classification === "ORDINARY_BUSINESS").length === 2,
  exactInternalCategories: () => TARGET_SPEC.filter((t) => t.category === "authentication").length === 3
    && TARGET_SPEC.filter((t) => t.category === "business").length === 2,
  canonicalConstants: () => CHANNEL === "whatsapp" && LANGUAGE === "en"
    && INTERNAL_VERSION === "1.0" && INTERNAL_READINESS === "provider_mapping_required"
    && INTERNAL_IS_ACTIVE === true,

  defaultDryRun: () => {
    const m = resolveMode([]);
    return m.ok && m.mode === "DRY_RUN" && m.network === false && m.writes === false;
  },
  preflightReadOnly: () => {
    const m = resolveMode(["--preflight-readonly"]);
    return m.ok && m.mode === "PREFLIGHT_READONLY" && m.network === true && m.writes === false;
  },
  executeExplicit: () => {
    const m = resolveMode(["--execute"]);
    return m.ok && m.mode === "EXECUTE" && m.writes === true;
  },
  unknownFlagRejected: () => resolveMode(["--activate"]).reason === SeedFailure.UNKNOWN_FLAG,
  conflictingModesRejected: () => resolveMode(["--execute", "--preflight-readonly"]).reason === SeedFailure.MODE_CONFLICT,

  exactRefParses: () => parseProjectRef(`https://${AUTHORIZED_STAGING_REF}.supabase.co`) === AUTHORIZED_STAGING_REF,
  malformedUrlsRejected: () => [
    `http://${AUTHORIZED_STAGING_REF}.supabase.co`,
    `https://${AUTHORIZED_STAGING_REF}.supabase.co/path`,
    `https://${AUTHORIZED_STAGING_REF}.supabase.co?x=1`,
    "not-a-url",
    "https://example.com",
  ].every((v) => parseProjectRef(v) === null),
  legacyServiceRoleAccepted: () => validateServiceRoleKey(fakeJwt("service_role")) === true,
  anonJwtRejected: () => validateServiceRoleKey(fakeJwt("anon")) === false,
  secretKeyAccepted: () => validateServiceRoleKey("sb_secret_test_only") === true,
  publishableRejected: () => validateServiceRoleKey("sb_publishable_test_only") === false,
  unknownKeyRejected: () => validateServiceRoleKey("random-secret") === false,
  stagingTargetAccepted: () => {
    const t = resolveStagingTarget(GOOD_ENV);
    return t.ok && t.projectRef === AUTHORIZED_STAGING_REF && t.environment === "STAGING";
  },
  missingUrlRejected: () => resolveStagingTarget({ QF_STAGING_SUPABASE_SERVICE_ROLE_KEY: fakeJwt("service_role") }).reason === SeedFailure.ENV_MISSING,
  missingKeyRejected: () => resolveStagingTarget({ QF_STAGING_SUPABASE_URL: GOOD_ENV.QF_STAGING_SUPABASE_URL }).reason === SeedFailure.ENV_MISSING,
  malformedKeyRejected: () => resolveStagingTarget({ ...GOOD_ENV, QF_STAGING_SUPABASE_SERVICE_ROLE_KEY: "wrong" }).reason === SeedFailure.SERVICE_ROLE_KEY_MALFORMED,
  productionRefRejected: () => resolveStagingTarget({ ...GOOD_ENV, QF_STAGING_SUPABASE_URL: `https://${FORBIDDEN_PROJECT_REFS.production}.supabase.co` }).reason === SeedFailure.PROJECT_REF_FORBIDDEN_PRODUCTION,
  jarvisRefRejected: () => resolveStagingTarget({ ...GOOD_ENV, QF_STAGING_SUPABASE_URL: `https://${FORBIDDEN_PROJECT_REFS.jarvis}.supabase.co` }).reason === SeedFailure.PROJECT_REF_FORBIDDEN_JARVIS,
  otherRefRejected: () => resolveStagingTarget({ ...GOOD_ENV, QF_STAGING_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" }).reason === SeedFailure.PROJECT_REF_NOT_AUTHORIZED,

  realAuthorityLoads: () => authority.ok === true && expectedRows.length === 5,
  realAuthorityExactShape: () => authority.ok && expectedRows.every((r) =>
    r.channel === "whatsapp"
    && r.language === "en"
    && r.version === "1.0"
    && r.provider_template_name === null
    && r.provider_template_id === null
    && r.readiness_status === "provider_mapping_required"
    && r.is_active === true
    && typeof r.description === "string" && r.description.length > 0),
  realAuthorityCategorySplit: () => authority.ok
    && expectedRows.filter((r) => r.category === "authentication").length === 3
    && expectedRows.filter((r) => r.category === "business").length === 2,

  missingClassifiesCreate: () => authority.ok && classifyExistingTemplate(null, expectedRows[0]).outcome === "MISSING",
  exactClassifiesIdempotent: () => authority.ok && classifyExistingTemplate({ ...expectedRows[0] }, expectedRows[0]).outcome === "ALREADY_PRESENT_EXACT",
  driftClassifiesConflict: () => authority.ok && [
    ["channel", "sms"], ["category", "business"], ["language", "hi"], ["version", "2.0"],
    ["provider_template_name", "legacy_name"], ["provider_template_id", "remote-id"],
    ["readiness_status", "provider_ready"], ["is_active", false], ["description", "drift"],
  ].every(([field, value]) => classifyExistingTemplate({ ...expectedRows[0], [field]: value }, expectedRows[0]).outcome === "CONFLICT"),
  emptyPlanCreatesEight: () => {
    const p = buildPlan([], expectedRows);
    return authority.ok && p.ok && p.missingRows.length === 5
      && p.actions.every((a) => a.action === "CREATE_INTERNAL_TEMPLATE");
  },
  exactPlanWritesZero: () => {
    const p = buildPlan(exactRows, expectedRows);
    return authority.ok && p.ok && p.missingRows.length === 0
      && p.actions.every((a) => a.action === "ALREADY_PRESENT_EXACT");
  },
  mixedPlanIsBounded: () => {
    const p = buildPlan(exactRows.slice(0, 3), expectedRows);
    return authority.ok && p.ok && p.missingRows.length === 2 && p.actions.length === 5;
  },
  duplicateTargetFailsClosed: () => {
    const p = buildPlan([exactRows[0], exactRows[0]], expectedRows);
    return authority.ok && p.ok === false && p.reason === SeedFailure.INTERNAL_TEMPLATE_CONFLICT;
  },
  readbackExactPasses: () => authority.ok && verifyReadback(exactRows, expectedRows).ok === true,
  readbackMissingFails: () => authority.ok && verifyReadback(exactRows.slice(0, 4), expectedRows).reason === SeedFailure.READBACK_FAILED,
  readbackExtraFails: () => authority.ok && verifyReadback([...exactRows, { ...exactRows[0], template_key: "extra" }], expectedRows).reason === SeedFailure.READBACK_FAILED,

  attestationRoundTrip: () => {
    const fresh = { projectRef: AUTHORIZED_STAGING_REF, branch: AUTHORIZED_BRANCH, head: "abc", authorityHash: "a", planHash: "p" };
    const a = buildAttestation(fresh, 1_000_000);
    return verifyAttestation(a, fresh, 1_000_001, []).ok === true;
  },
  attestationTamperRejected: () => {
    const fresh = { projectRef: AUTHORIZED_STAGING_REF, branch: AUTHORIZED_BRANCH, head: "abc", authorityHash: "a", planHash: "p" };
    const a = buildAttestation(fresh, 1_000_000);
    return verifyAttestation({ ...a, plan_hash: "tampered" }, fresh, 1_000_001, []).reason === SeedFailure.PREFLIGHT_ATTESTATION_INVALID;
  },
  attestationExpiryRejected: () => {
    const fresh = { projectRef: AUTHORIZED_STAGING_REF, branch: AUTHORIZED_BRANCH, head: "abc", authorityHash: "a", planHash: "p" };
    const a = buildAttestation(fresh, 1_000_000);
    return verifyAttestation(a, fresh, a.expires_at_ms + 1, []).reason === SeedFailure.PREFLIGHT_ATTESTATION_EXPIRED;
  },
  consumedAttestationRejected: () => {
    const fresh = { projectRef: AUTHORIZED_STAGING_REF, branch: AUTHORIZED_BRANCH, head: "abc", authorityHash: "a", planHash: "p" };
    const a = buildAttestation(fresh, 1_000_000);
    return verifyAttestation(a, fresh, 1_000_001, [a.nonce]).reason === SeedFailure.PREFLIGHT_ATTESTATION_CONSUMED;
  },
  changedHeadRejected: () => {
    const fresh = { projectRef: AUTHORIZED_STAGING_REF, branch: AUTHORIZED_BRANCH, head: "abc", authorityHash: "a", planHash: "p" };
    const a = buildAttestation(fresh, 1_000_000);
    return verifyAttestation(a, { ...fresh, head: "def" }, 1_000_001, []).reason === SeedFailure.PREFLIGHT_CHANGED;
  },

  externalEvidencePathRecognized: () => {
    const root = resolve(".validator-repo-root");
    return pathIsInsideRepository(resolve(root, "..", "external-evidence"), root) === false;
  },
  repoEvidencePathRejected: () => {
    const root = resolve(".validator-repo-root");
    return pathIsInsideRepository(resolve(root, "evidence"), root) === true;
  },

  injectedPreflightReadsOnly: async () => {
    if (!authority.ok) return false;
    let schemaReads = 0;
    let targetReads = 0;
    let writes = 0;
    const dbFactory = async () => ({
      async proveSchema() { schemaReads += 1; return { ok: true }; },
      async selectTargets() { targetReads += 1; return { ok: true, rows: [] }; },
      async insertMissing() { writes += 1; return { ok: true, rows: [] }; },
    });
    const r = await runReadOnlyPreflight({
      env: GOOD_ENV,
      dbFactory,
      gitState: () => ({ head: "abc", branch: AUTHORIZED_BRANCH, root: "C:\\repo", clean: true }),
      authorityLoader: () => authority,
    });
    return r.ok && schemaReads === 1 && targetReads === 1 && writes === 0 && r.missingRows.length === 5;
  },

  noMetaNetworkSurface: () => !/graph\.facebook|\/messages\b|\bfetch\s*\(/i.test(exec),
  noProviderMappingTableWrite: () => !/from\(["']communication_provider_template_mappings["']\)/.test(exec),
  noProviderAccountTableWrite: () => !/from\(["']communication_provider_accounts["']\)/.test(exec),
  noRuntimePolicyTableWrite: () => !/from\(["']communication_provider_runtime_policies["']\)/.test(exec),
  noUpdateUpsertDelete: () => !/client\.from\([^)]*\)[\s\S]{0,120}\.(update|upsert|delete)\s*\(/.test(exec),
  oneInsertCallSite: () => (exec.match(/\.insert\s*\(/g) ?? []).length === 1,
  noDdlOrMigrationCommand: () => !/\b(create\s+table|alter\s+table|drop\s+table|create\s+index|db\s+push|migration\s+up|db\s+reset)\b/i.test(exec),
  noEnvFileLoading: () => !/dotenv|["'][^"']*\.env(?:\.local)?["']/.test(exec),
  noPublicSupabaseFallback: () => !/NEXT_PUBLIC_SUPABASE_URL|(?<!QF_STAGING_)\bSUPABASE_SERVICE_ROLE_KEY\b/.test(exec),
  noRawErrorLogging: () => !/console\.(error|log)\s*\(\s*(e|err|error)\b|JSON\.stringify\(\s*(e|err|error)\b/i.test(exec),
  providerFieldsPinnedNull: () => /provider_template_name:\s*null/.test(exec) && /provider_template_id:\s*null/.test(exec),
  readinessPinned: () => /INTERNAL_READINESS\s*=\s*["']provider_mapping_required["']/.test(exec),
  internalActivePinned: () => /INTERNAL_IS_ACTIVE\s*=\s*true/.test(exec),
};

for (const [name, fn] of Object.entries(R)) {
  try {
    add(name, await fn());
  } catch (e) {
    add(name, false, e instanceof Error ? e.message : "exception");
  }
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
console.log("");
console.log(`QF-MVP-40.12 prerequisite validator: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
