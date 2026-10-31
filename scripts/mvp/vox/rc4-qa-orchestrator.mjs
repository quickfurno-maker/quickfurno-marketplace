#!/usr/bin/env node
// VOX RC4 Track F - integrated, non-mutating QA orchestrator.
//
//   node scripts/mvp/vox/rc4-qa-orchestrator.mjs [--mode source-only|full]
//        [--with-pg17] [--out <path>] [--suite-timeout-ms <n>]
//
// Never writes to a database, never calls a hosted API, never reads .env files.
// Missing prerequisites yield BLOCKED, never PASS. Exit: 0 pass, 1 fail, 2 blocked, 3 usage.
// Optional local identity inputs (loopback only, session env, never persisted):
//   RC4_QA_LOCAL_APP_URL  RC4_QA_LOCAL_GOTRUE_URL  RC4_QA_LOCAL_POSTGREST_URL
//   RC4_QA_TOKEN_NONSTAFF RC4_QA_TOKEN_STAFF       RC4_QA_TOKEN_OWNER
import {spawnSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from "node:fs";
import {dirname, join, resolve, sep} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath, pathToFileURL} from "node:url";
import {
  INTEGRATION_STEP_IDS, ROUTE_PROBES, SOURCE_STEP_IDS, STATUS, aggregate, analyzeGateSource, classifyProbe,
  comparePinned, evaluateSuiteRun, gateBeforeAuth, jwtSub, listingDigest, loopbackOrigin, makeStep, redact,
  scrubbedEnv, sha256Hex, staticSqlDryRun, summarizeJwt
} from "./rc4-qa-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const vox = join(root, "scripts", "mvp", "vox");
const rel = p => p.slice(root.length + 1).split(sep).join("/");
const read = p => readFileSync(p, "utf8");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "test-results"]);

function walk(dir, accept, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, accept, out);
    else if (accept(name)) out.push(p);
  }
  return out;
}
const codeFile = n => /\.(ts|tsx|mjs|js)$/.test(n);

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const o = {mode: "source-only", withPg17: false, out: null, suiteTimeoutMs: 240000};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode") o.mode = argv[++i];
    else if (a === "--with-pg17") o.withPg17 = true;
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--suite-timeout-ms") o.suiteTimeoutMs = Number(argv[++i]);
    else throw new Error("UNKNOWN_ARGUMENT:" + a);
  }
  if (!["source-only", "full"].includes(o.mode)) throw new Error("INVALID_MODE");
  if (!Number.isInteger(o.suiteTimeoutMs) || o.suiteTimeoutMs < 1000) throw new Error("INVALID_TIMEOUT");
  return o;
}

function safeOutPath(out) {
  const p = resolve(out);
  const ok = [resolve(tmpdir()), join(root, "test-results")].some(b => p.startsWith(b + sep));
  if (!ok) throw new Error("OUT_MUST_BE_UNDER_TMPDIR_OR_TEST_RESULTS");
  if (existsSync(p)) throw new Error("OUT_EXISTS_CREATE_ONLY");
  return p;
}

// ---------------------------------------------------------------- step 1: migration hashes
const FINGERPRINT = "docs/vox/VOX-AB7K-REVIEWED-SOURCE-FINGERPRINT.json";
function pinnedFiles() {
  const pinned = JSON.parse(read(join(root, FINGERPRINT)));
  const actual = pinned.files.map(f => {
    const p = resolve(root, f.path);
    if (!p.startsWith(join(root, "ops", "vox") + sep)) throw new Error("PINNED_PATH_OUTSIDE_OPS_VOX:" + f.path);
    const bytes = readFileSync(p);
    return {order: f.order, path: f.path, sha256: sha256Hex(bytes), bytes: bytes.length, crlf: bytes.includes(Buffer.from("\r\n")), text: bytes.toString("utf8")};
  });
  return {pinned, actual};
}

async function stepMigrationHashes() {
  const {pinned, actual} = pinnedFiles();
  const problems = comparePinned(pinned, actual);
  const contract = await import(pathToFileURL(join(root, "contracts", "vox", "ab7kFullMigrationManifest.mjs")).href);
  const inspected = contract.inspectAb7kFullVoxSources(root);
  if (!inspected.ok) problems.push("CONTRACT_INSPECT_FAILED:" + inspected.reason);
  else if (inspected.manifestDigest !== pinned.manifestDigest) problems.push("CONTRACT_DIGEST_DIFFERS_FROM_PIN");
  const recomputed = listingDigest(actual.map(a => ({...a})));
  if (recomputed !== pinned.manifestDigest) problems.push("RECOMPUTED_DIGEST_DIFFERS_FROM_PIN");
  const overlay = "ops/vox/identity-attestation-overlay/20261030010000_vox_ab7k_identity_attestation_fail_closed_overlay.sql";
  const evidence = {
    fingerprintFile: FINGERPRINT, fingerprintFileSha256: sha256Hex(readFileSync(join(root, FINGERPRINT))),
    pinnedManifestDigest: pinned.manifestDigest, recomputedManifestDigest: recomputed,
    contractManifestDigest: inspected.ok ? inspected.manifestDigest : null, fileCount: actual.length,
    files: actual.map(({text, ...rest}) => rest),
    identityOverlayPresent: existsSync(join(root, overlay)), identityOverlayPinned: false,
    note: "overlay is intentionally outside the 7+23 pin; pinning it is an open Owner/DBA decision"
  };
  return problems.length ? makeStep("migration-hashes", "Pinned 7+23 migration hashes", STATUS.FAIL, {evidence, failures: problems})
    : makeStep("migration-hashes", "Pinned 7+23 migration hashes", STATUS.PASS, {evidence});
}

// ---------------------------------------------------------------- step 2: static SQL dry-run
function stepSqlStaticDryRun() {
  const {actual} = pinnedFiles();
  const failures = [], perFile = [];
  for (const f of actual) {
    const findings = staticSqlDryRun(f.text);
    perFile.push({path: f.path, findings});
    for (const code of findings) failures.push(f.path.split("/").pop() + ":" + code);
  }
  const evidence = {executedAgainstDatabase: false, method: "comment/literal-stripped regex review; heuristic, not a PostgreSQL parse", perFile};
  return failures.length ? makeStep("sql-static-dry-run", "Static SQL dry-run (no database)", STATUS.FAIL, {evidence, failures})
    : makeStep("sql-static-dry-run", "Static SQL dry-run (no database)", STATUS.PASS, {evidence});
}

// ---------------------------------------------------------------- step 3: feature gates stay hard-off
function stepFeatureGates() {
  const failures = [];
  const scanFiles = [
    ...walk(join(root, "app", "api", "vox"), codeFile), ...walk(join(root, "app", "api", "internal"), codeFile),
    ...walk(join(root, "apps", "vox-web", "app", "api"), codeFile), ...walk(join(root, "services", "vox"), codeFile),
    join(root, "services", "jarvisOperatorCommandService.ts")
  ].filter(existsSync);
  const flags = new Set(), gatedFiles = [];
  for (const p of scanFiles) {
    const text = read(p), a = analyzeGateSource(text);
    a.names.forEach(n => flags.add(n));
    if (a.names.length) gatedFiles.push(rel(p));
    a.problems.forEach(x => failures.push(rel(p) + ":" + x));
    if (/app[\\/]api[\\/]vox[\\/]v1[\\/].+route\.ts$/.test(p) && !gateBeforeAuth(text)) failures.push(rel(p) + ":AUTH_OR_DB_BEFORE_GATE");
  }
  const norm = s => s.replace(/\s+/g, "").toLowerCase();
  const checks = {};
  const eod = read(join(root, "app/api/vox/v1/official-eod-publish/route.ts"));
  checks.eodWriterHardOff = /VERIFIED_APPROVAL_WRITER_INSTALLED\s*=\s*false\b/.test(eod) && !/VERIFIED_APPROVAL_WRITER_INSTALLED\s*=\s*true\b/.test(eod);
  checks.eodGuardPrecedesAuth = eod.indexOf("if(!VERIFIED_APPROVAL_WRITER_INSTALLED)") >= 0 &&
    eod.indexOf("if(!VERIFIED_APPROVAL_WRITER_INSTALLED)") < eod.indexOf("await verifyVoxOwnerBearer(");
  const binding = read(join(root, "contracts/vox/ab7kCoreConversationConsentBinding.mjs"));
  checks.consentBindingUnsigned = /signedOff\s*:\s*false/.test(binding) && !/signedOff\s*:\s*true/.test(binding);
  const nonwork = read(join(root, "ops/vox/sql-candidates/20261018020000_vox_ab7b_nonwork_native_source_candidate.sql"));
  checks.coreConversationSqlBlockPresent = norm(nonwork).includes("constraintvox_ab7b_core_conversation_blockedcheck(source<>'core_conversation')");
  const importers = walk(root, codeFile).filter(p => !/[\\/](scripts|contracts|docs|ops)[\\/]/.test(p.slice(root.length)))
    .filter(p => read(p).includes("ab7kSignedApprovalVerifier")).map(rel);
  checks.signedVerifierNotImportedByRuntime = importers.length === 0;
  const jarvis = existsSync(join(root, "services/jarvisOperatorCommandService.ts")) ? read(join(root, "services/jarvisOperatorCommandService.ts")) : "";
  checks.ab7hFlagNeverAssigned = !/process\.env\.VOX_AB7H_SIGNED_OPERATOR_ATOMIC_ENABLED\s*=[^=]/.test(jarvis);
  const deployFiles = ["vercel.json", "apps/vox-web/vercel.json", "next.config.js", "next.config.mjs", "next.config.ts",
    "apps/vox-web/next.config.js", "apps/vox-web/next.config.mjs", "apps/vox-web/next.config.ts", "Dockerfile", "apps/vox-web/Dockerfile"]
    .filter(f => existsSync(join(root, f)));
  const enabledInDeploy = deployFiles.filter(f => /VOX_[A-Z0-9_]*(ENABLED|PROOF)[A-Z0-9_]*["']?\s*[:=]\s*["']?(staging|true|1)\b/.test(read(join(root, f))));
  checks.noVoxEnableInDeployConfig = enabledInDeploy.length === 0;
  for (const [k, v] of Object.entries(checks)) if (!v) failures.push("HARD_OFF_CHECK_FAILED:" + k);
  if (importers.length) failures.push("VERIFIER_IMPORTED_BY:" + importers.join(","));
  if (enabledInDeploy.length) failures.push("DEPLOY_CONFIG_ENABLES_VOX_FLAG:" + enabledInDeploy.join(","));
  const evidence = {filesScanned: scanFiles.length, gatedFiles, flags: [...flags].sort(), checks, deployConfigsChecked: deployFiles,
    scope: "source text only; no route was executed, .env files were not read"};
  return failures.length ? makeStep("feature-gates-fail-closed", "Feature gates fail closed", STATUS.FAIL, {evidence, failures})
    : makeStep("feature-gates-fail-closed", "Feature gates fail closed", STATUS.PASS, {evidence});
}

// ---------------------------------------------------------------- step 4: portal navigation vs Core APIs
function stepPortalContract() {
  const failures = [];
  const web = join(root, "apps", "vox-web");
  const nav = read(join(web, "app/components/VoxWorkspaceNav.tsx"));
  const items = [...nav.matchAll(/href:\s*"(\/[^"]*)"(,\s*adminOnly:\s*true)?/g)].map(m => ({href: m[1], adminOnly: !!m[2]}));
  if (items.length < 10) failures.push("NAV_ITEMS_UNEXPECTEDLY_FEW:" + items.length);
  for (const it of items) {
    const page = join(web, "app", it.href === "/" ? "" : it.href, "page.tsx");
    if (!existsSync(page)) { failures.push("NAV_PAGE_MISSING:" + it.href); continue; }
    if (it.adminOnly && !/fetch(Owner|Admin)\w*\(/.test(read(page))) failures.push("ADMIN_PAGE_WITHOUT_OWNER_CORE_FETCH:" + it.href);
  }
  const refs = new Set();
  for (const p of [...walk(join(web, "lib"), codeFile), ...walk(join(web, "app"), codeFile)])
    for (const m of read(p).matchAll(/\/api\/vox\/v1\/([a-z0-9-]+)/g)) refs.add(m[1]);
  for (const name of refs) if (!existsSync(join(root, "app/api/vox/v1", name, "route.ts"))) failures.push("PORTAL_REFERENCES_MISSING_CORE_ROUTE:" + name);
  const routes = walk(join(root, "app", "api", "vox", "v1"), n => n === "route.ts");
  const surface = routes.map(p => {
    const t = read(p), owner = t.includes("verifyVoxOwnerBearer("), staff = t.includes("getVerifiedScopedStaff(");
    if (!owner && !staff) failures.push("CORE_ROUTE_WITHOUT_VERIFIER:" + rel(p));
    return {route: rel(p), auth: owner && staff ? "owner+staff" : owner ? "owner" : staff ? "staff" : "NONE"};
  });
  const evidence = {navItems: items, portalReferencedCoreRoutes: [...refs].sort(), coreRouteCount: routes.length, coreRouteAuth: surface};
  return failures.length ? makeStep("portal-core-api-contract", "Portal navigation and Owner/Staff Core API surface", STATUS.FAIL, {evidence, failures})
    : makeStep("portal-core-api-contract", "Portal navigation and Owner/Staff Core API surface", STATUS.PASS, {evidence});
}

// ---------------------------------------------------------------- step 5: source test suites
const REQUIRED_SUITES = [
  "validate-voxAB7K-manifest.test.mjs", "validate-voxAB7K-signed-approval-verifier.test.mjs",
  "validate-voxAB7K-identity-attestation.test.mjs", "validate-voxAB7K-core-conversation-consent-binding.test.mjs",
  "validate-voxAB7K-core-conversation-blocked.test.mjs", "ab7k-readonly-evidence.test.mjs",
  "ab7k-semantic-evidence.test.mjs", "rc4-qa.test.mjs"
];

function stepSourceSuites(opts) {
  const failures = [], blockers = [], suites = [];
  const files = readdirSync(vox).filter(n => n.endsWith(".test.mjs")).sort();
  for (const r of REQUIRED_SUITES) if (!files.includes(r)) failures.push("REQUIRED_SUITE_MISSING:" + r);
  for (const name of files) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", join(vox, name)], {
      cwd: root, env: scrubbedEnv(process.env), encoding: "utf8", shell: false,
      maxBuffer: 64 * 1024 * 1024, timeout: opts.suiteTimeoutMs, windowsHide: true
    });
    const stdout = (r.stdout || "") + (r.stderr || "");
    const ev = evaluateSuiteRun({exitCode: r.status, signal: r.signal, timedOut: r.error?.code === "ETIMEDOUT", stdout});
    suites.push({file: name, sourceSha256: sha256Hex(readFileSync(join(vox, name))), status: ev.status, reason: ev.reason,
      counts: ev.counts, durationMs: Date.now() - t0, outputSha256: sha256Hex(stdout),
      tail: ev.status === STATUS.PASS ? undefined : stdout.split("\n").slice(-30).join("\n")});
    process.stderr.write("RC4_QA suite=" + name + " status=" + ev.status + "\n");
    if (ev.status === STATUS.FAIL) failures.push(name + ":" + ev.reason);
    else if (ev.status === STATUS.BLOCKED) blockers.push(name + ":" + ev.reason);
  }
  const total = suites.reduce((a, s) => ({tests: a.tests + (s.counts?.tests ?? 0), pass: a.pass + (s.counts?.pass ?? 0), fail: a.fail + (s.counts?.fail ?? 0)}), {tests: 0, pass: 0, fail: 0});
  const evidence = {suiteCount: suites.length, totals: total, childEnv: "allow-list only (no secrets, no VOX_* flags, no NODE_OPTIONS)", suites,
    limit: "suites are source/in-process tests; this runner cannot prove they never open a socket"};
  if (failures.length) return makeStep("source-test-suites", "Source test suites (node --test)", STATUS.FAIL, {evidence, failures});
  if (blockers.length) return makeStep("source-test-suites", "Source test suites (node --test)", STATUS.BLOCKED, {evidence, blockers});
  return makeStep("source-test-suites", "Source test suites (node --test)", STATUS.PASS, {evidence});
}

// ---------------------------------------------------------------- step 6: disposable PG17 dry-run (opt-in)
function stepPg17(opts) {
  const id = "pg17-disposable-dry-run", title = "Disposable PostgreSQL 17 install of the 30 files";
  if (!opts.withPg17) return makeStep(id, title, STATUS.BLOCKED, {blockers: ["NOT_REQUESTED: pass --with-pg17 on a host with local Docker"]});
  const dh = process.env.DOCKER_HOST || "";
  if (/^(tcp|ssh|http|https):/i.test(dh)) return makeStep(id, title, STATUS.BLOCKED, {blockers: ["REMOTE_DOCKER_HOST_REFUSED"]});
  const env = scrubbedEnv(process.env);
  const run = (cmd, args, timeout = 15 * 60 * 1000) => spawnSync(cmd, args, {cwd: root, env, encoding: "utf8", shell: false, timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024});
  const dv = run("docker", ["version", "--format", "{{.Server.Version}}"], 30000);
  if (dv.error || dv.status !== 0) return makeStep(id, title, STATUS.BLOCKED, {blockers: ["DOCKER_ENGINE_UNAVAILABLE"]});
  const img = run("docker", ["image", "inspect", "postgres:17-alpine", "--format", "{{.Id}}"], 30000);
  if (img.status !== 0) return makeStep(id, title, STATUS.BLOCKED, {blockers: ["IMAGE_NOT_PRESENT_LOCALLY: the harness would pull from the network; pre-pull deliberately"]});
  const script = join(vox, "validate-voxAB7K-full-schema-pg17.ps1");
  const r = run("pwsh", ["-NoProfile", "-File", script]);
  if (r.error?.code === "ENOENT") return makeStep(id, title, STATUS.BLOCKED, {blockers: ["PWSH_UNAVAILABLE"]});
  const out = (r.stdout || "") + (r.stderr || "");
  const evidence = {script: rel(script), imageId: img.stdout.trim(), exitCode: r.status, outputSha256: sha256Hex(out), tail: out.split("\n").slice(-25).join("\n"),
    meaning: "synthetic Core fixture on a disposable local cluster; not Supabase, not a managed restore"};
  return r.status === 0 ? makeStep(id, title, STATUS.PASS, {evidence})
    : makeStep(id, title, STATUS.FAIL, {evidence, failures: ["HARNESS_EXIT_" + r.status]});
}

// ---------------------------------------------------------------- step 7: local real-auth matrix (GET only)
async function getJson(url, token) {
  try {
    const r = await fetch(url, {method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000),
      headers: {accept: "application/json", ...(token ? {authorization: "Bearer " + token} : {})}});
    return {status: r.status, text: (await r.text()).slice(0, 4000)};
  } catch (e) { return {status: null, error: e?.name || "ERROR"}; }
}

async function stepLocalAuth() {
  const id = "local-real-auth-harness", title = "Local GoTrue + PostgREST + app 401/403/200 matrix";
  const env = process.env, blockers = [], failures = [];
  const urls = {};
  for (const [k, v] of [["app", "RC4_QA_LOCAL_APP_URL"], ["gotrue", "RC4_QA_LOCAL_GOTRUE_URL"], ["postgrest", "RC4_QA_LOCAL_POSTGREST_URL"]]) {
    if (!env[v]) { blockers.push(v + "_NOT_SET"); continue; }
    const o = loopbackOrigin(env[v]);
    if (!o) failures.push(v + "_NOT_PLAIN_HTTP_LOOPBACK_REFUSED");
    else urls[k] = o;
  }
  if (failures.length) return makeStep(id, title, STATUS.FAIL, {failures, evidence: {requestsSent: 0}});
  if (blockers.length) return makeStep(id, title, STATUS.BLOCKED, {blockers, evidence: {requestsSent: 0, needs: "a local signed GoTrue + PostgREST + PG stack with the app pointed at it and gates deliberately enabled in that local process"}});
  const evidence = {components: {}, tokens: {}, probes: []};
  const gt = await getJson(urls.gotrue + "/health");
  evidence.components.gotrue = {status: gt.status};
  if (gt.status !== 200) blockers.push("GOTRUE_NOT_HEALTHY_" + gt.status);
  const pr = await getJson(urls.postgrest + "/");
  evidence.components.postgrest = {status: pr.status};
  if (pr.status === null || pr.status >= 500) blockers.push("POSTGREST_UNREACHABLE_" + pr.status);
  const app = await getJson(urls.app + "/");
  evidence.components.app = {status: app.status};
  if (app.status === null) blockers.push("APP_UNREACHABLE");
  if (blockers.length) return makeStep(id, title, STATUS.BLOCKED, {blockers, evidence});
  const now = Math.floor(Date.now() / 1000), genuine = {}, seenSubs = new Map();
  for (const [role, name] of [["nonStaff", "RC4_QA_TOKEN_NONSTAFF"], ["staff", "RC4_QA_TOKEN_STAFF"], ["owner", "RC4_QA_TOKEN_OWNER"]]) {
    const token = env[name];
    if (!token) { evidence.tokens[role] = {state: "NOT_PROVIDED"}; continue; }
    const s = summarizeJwt(token, now);
    if (!s.ok) { failures.push(role + ":TOKEN_" + s.reason); evidence.tokens[role] = {state: "REJECTED", reason: s.reason}; continue; }
    if (!s.issuerIsLoopback) { failures.push(role + ":TOKEN_ISSUER_NOT_LOOPBACK_NOT_SENT"); evidence.tokens[role] = {state: "REFUSED", issuerOrigin: s.issuerOrigin}; continue; }
    const sub = jwtSub(token);
    if (seenSubs.has(sub)) failures.push(role + ":SAME_IDENTITY_AS_" + seenSubs.get(sub));
    seenSubs.set(sub, role);
    const tokenState = {alg: s.alg, aal: s.aal, role: s.role, aud: s.aud, issuerOrigin: s.issuerOrigin, subHash: s.subHash, secondsToExpiry: s.secondsToExpiry};
    if (s.secondsToExpiry !== null && s.secondsToExpiry < 30) { evidence.tokens[role] = {...tokenState, state: "EXPIRED_OR_EXPIRING"}; continue; }
    if (role !== "nonStaff" && s.aal !== "aal2") { evidence.tokens[role] = {...tokenState, state: "NOT_AAL2"}; continue; }
    const me = await getJson(urls.gotrue + "/user", token);
    let id2 = null; try { id2 = JSON.parse(me.text).id; } catch { /* not JSON */ }
    if (me.status === 200 && id2 && id2 === sub) { genuine[role] = token; evidence.tokens[role] = {...tokenState, state: "ACCEPTED_BY_LOCAL_GOTRUE"}; }
    else evidence.tokens[role] = {...tokenState, state: "NOT_ACCEPTED_BY_LOCAL_GOTRUE", gotrueStatus: me.status};
  }
  if (failures.length) return makeStep(id, title, STATUS.FAIL, {failures, evidence});
  for (const probe of ROUTE_PROBES) {
    for (const [role, expect] of Object.entries(probe.cells)) {
      let status = null, usable = true;
      if (role === "anonymous") status = (await getJson(urls.app + probe.path)).status;
      else if (genuine[role]) status = (await getJson(urls.app + probe.path, genuine[role])).status;
      else usable = false;
      const cell = usable ? classifyProbe(expect, status) : {status: STATUS.BLOCKED, code: "IDENTITY_UNAVAILABLE_" + role};
      evidence.probes.push({path: probe.path, role, expect, httpStatus: status, verdict: cell.status, code: cell.code});
      const label = probe.path + "[" + role + "]:" + cell.code;
      if (cell.status === STATUS.FAIL) failures.push(label);
      else if (cell.status === STATUS.BLOCKED) blockers.push(label);
    }
  }
  evidence.limits = ["cannot prove the app under test is wired to this GoTrue/PostgREST", "GET only; no mutation was sent"];
  if (failures.length) return makeStep(id, title, STATUS.FAIL, {failures, blockers, evidence});
  if (blockers.length) return makeStep(id, title, STATUS.BLOCKED, {blockers, evidence});
  return makeStep(id, title, STATUS.PASS, {evidence});
}

// ---------------------------------------------------------------- driver
const KNOWN_OPEN_ITEMS = Object.freeze([
  "Issue #444 stays open; release decision is HOLD regardless of this report",
  "vox_ab7b_current_consent_candidate_v1 has no reviewed Core-derived source (CORE_CONVERSATION stays blocked)",
  "No managed full-fidelity backup restore (owners, ACLs, roles) certified by a qualified DBA",
  "Two raw ACL paths on vox_ab7j_staff_suspend_intents_candidate_v1 need DBA interpretation",
  "No real Owner / independent first Team Leader AAL2 evidence; no Ed25519 enrolment ceremony; no durable replay store",
  "Identity-attestation overlay is not part of the 7+23 pinned set",
  "No independent DBA or AppSec sign-off (AI review is not sign-off)"
]);

async function guarded(id, fn) {
  try { return await fn(); } catch (e) {
    return makeStep(id, id, STATUS.FAIL, {failures: ["STEP_CRASHED:" + (e instanceof Error ? e.message : "UNKNOWN")]});
  }
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { process.stderr.write("USAGE_ERROR " + e.message + "\n"); return 3; }
  let outPath = null;
  if (opts.out) { try { outPath = safeOutPath(opts.out); } catch (e) { process.stderr.write("USAGE_ERROR " + e.message + "\n"); return 3; } }
  const steps = [];
  const record = s => { steps.push(s); process.stderr.write("RC4_QA step=" + s.id + " status=" + s.status + "\n"); };
  record(await guarded("migration-hashes", stepMigrationHashes));
  record(await guarded("sql-static-dry-run", stepSqlStaticDryRun));
  record(await guarded("feature-gates-fail-closed", stepFeatureGates));
  record(await guarded("portal-core-api-contract", stepPortalContract));
  record(await guarded("source-test-suites", () => stepSourceSuites(opts)));
  if (opts.mode === "full") {
    record(await guarded("pg17-disposable-dry-run", () => stepPg17(opts)));
    record(await guarded("local-real-auth-harness", stepLocalAuth));
  } else {
    for (const id of INTEGRATION_STEP_IDS) record(makeStep(id, id, STATUS.BLOCKED, {blockers: ["NOT_RUN_IN_SOURCE_ONLY_MODE"]}));
  }
  const verdict = aggregate(steps, opts.mode);
  const report = {
    schema: "qf.vox.rc4.qa-report.v1", generatedAt: new Date().toISOString(), node: process.version, platform: process.platform,
    sourceStepIds: SOURCE_STEP_IDS, verdict, steps, knownOpenItems: KNOWN_OPEN_ITEMS,
    disclaimers: ["PASS never means release GO", "source-only can only report SOURCE_PASS", "no managed Supabase, provider, payment or live data was contacted by this tool"]
  };
  const secrets = ["RC4_QA_TOKEN_NONSTAFF", "RC4_QA_TOKEN_STAFF", "RC4_QA_TOKEN_OWNER"].map(k => process.env[k]);
  const json = redact(JSON.stringify(report, null, 2), secrets);
  if (outPath) { mkdirSync(dirname(outPath), {recursive: true}); writeFileSync(outPath, json, {flag: "wx"}); process.stdout.write("RC4_QA_REPORT=" + outPath + "\nRC4_QA_REPORT_SHA256=" + sha256Hex(json) + "\n"); }
  else process.stdout.write(json + "\n");
  process.stdout.write("RC4_QA_OVERALL=" + verdict.overall + " exit=" + verdict.exitCode + " releaseDecision=HOLD\n");
  return verdict.exitCode;
}

main().then(code => { process.exitCode = code; }, e => { process.stderr.write("RC4_QA_FATAL " + (e?.message || "unknown") + "\n"); process.exitCode = 1; });
