// VOX RC4 Track F - pure QA helpers. No I/O, no network, no process access.
// Every verdict rule that decides PASS / FAIL / BLOCKED lives here so it can be
// unit-tested without running the orchestrator.
import {createHash} from "node:crypto";

export const sha256Hex = v => createHash("sha256").update(v).digest("hex");

export const STATUS = Object.freeze({PASS: "PASS", FAIL: "FAIL", BLOCKED: "BLOCKED"});

export const SOURCE_STEP_IDS = Object.freeze([
  "migration-hashes", "sql-static-dry-run", "feature-gates-fail-closed",
  "portal-core-api-contract", "source-test-suites"
]);
export const INTEGRATION_STEP_IDS = Object.freeze(["pg17-disposable-dry-run", "local-real-auth-harness"]);

/** A step can only be PASS with zero failures/blockers, FAIL needs a failure, BLOCKED needs a reason. */
export function makeStep(id, title, status, {evidence = {}, failures = [], blockers = []} = {}) {
  if (!Object.values(STATUS).includes(status)) throw new Error("INVALID_STATUS:" + status);
  if (status === STATUS.PASS && (failures.length || blockers.length)) throw new Error("PASS_WITH_PROBLEMS:" + id);
  if (status === STATUS.FAIL && !failures.length) throw new Error("FAIL_WITHOUT_REASON:" + id);
  if (status === STATUS.BLOCKED && !blockers.length) throw new Error("BLOCKED_WITHOUT_REASON:" + id);
  return Object.freeze({id, title, status, evidence, failures: [...failures], blockers: [...blockers]});
}

/**
 * Overall verdict. A missing expected step is a FAIL (no green by omission).
 * source-only can at best say SOURCE_PASS; only `full` can say PASS.
 * releaseDecision is always HOLD and goEligible always false.
 */
export function aggregate(steps, mode) {
  if (mode !== "source-only" && mode !== "full") throw new Error("INVALID_MODE");
  const byId = new Map(steps.map(s => [s.id, s]));
  const expected = mode === "full" ? [...SOURCE_STEP_IDS, ...INTEGRATION_STEP_IDS] : [...SOURCE_STEP_IDS];
  const missing = expected.filter(id => !byId.has(id));
  const failed = steps.filter(s => s.status === STATUS.FAIL).map(s => s.id);
  const blockedRequired = expected.filter(id => byId.get(id)?.status === STATUS.BLOCKED);
  const notPassingOptional = INTEGRATION_STEP_IDS.filter(id => byId.get(id)?.status !== STATUS.PASS);
  let overall, exitCode;
  if (failed.length || missing.length) { overall = "FAIL"; exitCode = 1; }
  else if (blockedRequired.length) { overall = "BLOCKED"; exitCode = 2; }
  else if (mode === "source-only") { overall = "SOURCE_PASS"; exitCode = 0; }
  else { overall = "PASS"; exitCode = 0; }
  return Object.freeze({
    overall, exitCode, mode, releaseDecision: "HOLD", goEligible: false,
    failedSteps: failed, missingSteps: missing, blockedRequiredSteps: blockedRequired,
    integrationEvidenceComplete: notPassingOptional.length === 0
  });
}

/** Parse node:test TAP summary. Returns null if the summary is absent (never assume success). */
export function parseTapSummary(text) {
  const out = {};
  for (const key of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
    const m = new RegExp("^# " + key + " (\\d+)\\s*$", "m").exec(String(text));
    if (m) out[key] = Number(m[1]);
  }
  return ["tests", "pass", "fail"].every(k => Number.isInteger(out[k]))
    ? {cancelled: 0, skipped: 0, todo: 0, ...out} : null;
}

/** PASS requires exit 0 AND a parsed summary with every test passing and nothing skipped. */
export function evaluateSuiteRun({exitCode, signal, timedOut, stdout}) {
  const counts = parseTapSummary(stdout);
  if (timedOut) return {status: STATUS.FAIL, reason: "TIMEOUT", counts};
  if (signal) return {status: STATUS.FAIL, reason: "KILLED_BY_" + signal, counts};
  if (!counts) return {status: STATUS.FAIL, reason: "NO_TAP_SUMMARY", counts};
  if (exitCode !== 0) return {status: STATUS.FAIL, reason: "EXIT_" + exitCode, counts};
  if (counts.fail || counts.cancelled) return {status: STATUS.FAIL, reason: "TEST_FAILURES", counts};
  if (counts.tests === 0) return {status: STATUS.FAIL, reason: "ZERO_TESTS", counts};
  if (counts.pass !== counts.tests) return {status: STATUS.FAIL, reason: "PASS_COUNT_MISMATCH", counts};
  if (counts.skipped || counts.todo) return {status: STATUS.BLOCKED, reason: "SKIPPED_OR_TODO_TESTS", counts};
  return {status: STATUS.PASS, reason: "OK", counts};
}

const ENV_ALLOW = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LANG", "CI"];
/** Allow-list child environment: no secrets, no VOX_* flags, no NODE_OPTIONS preload. */
export function scrubbedEnv(env) {
  const out = {NODE_ENV: "test", NO_COLOR: "1"};
  for (const k of ENV_ALLOW) if (typeof env[k] === "string") out[k] = env[k];
  return out;
}

/** Returns the origin for a plain http loopback URL, otherwise null. */
export function loopbackOrigin(value) {
  try {
    const u = new URL(String(value));
    if (u.protocol !== "http:" || u.username || u.password || u.search || u.hash) return null;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return null;
    if (u.pathname !== "/") return null;
    return u.origin;
  } catch { return null; }
}

/** Unverified JWT claim summary (signature trust comes only from the local GoTrue /user call). */
export function summarizeJwt(token, nowSec) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return {ok: false, reason: "NOT_A_JWT"};
  try {
    const dec = p => JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    const header = dec(parts[0]), c = dec(parts[1]);
    if (!header || String(header.alg).toLowerCase() === "none") return {ok: false, reason: "ALG_NONE"};
    const issHost = (() => { try { return new URL(c.iss).origin; } catch { return null; } })();
    return {
      ok: true, alg: header.alg, aal: c.aal ?? null, role: c.role ?? null,
      aud: c.aud ?? null, issuerOrigin: issHost,
      issuerIsLoopback: loopbackOrigin(issHost ? issHost + "/" : "") !== null,
      subHash: typeof c.sub === "string" ? sha256Hex(c.sub).slice(0, 12) : null,
      secondsToExpiry: Number.isFinite(c.exp) ? c.exp - nowSec : null
    };
  } catch { return {ok: false, reason: "UNDECODABLE"}; }
}

/** Subject claim, used only for comparing with the GoTrue /user answer; never persisted. */
export function jwtSub(token) {
  try { return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8")).sub ?? null; } catch { return null; }
}

/** One cell of the 401/403/200 matrix. `expect` is "DENY" or "ALLOW". */
export function classifyProbe(expect, status) {
  if (status === null) return {status: STATUS.BLOCKED, code: "UNREACHABLE"};
  if (expect === "DENY") {
    if (status === 401 || status === 403) return {status: STATUS.PASS, code: "DENIED_" + status};
    if (status === 503) return {status: STATUS.BLOCKED, code: "GATE_OFF_AUTH_NOT_PROVEN"};
    if (status >= 200 && status < 300) return {status: STATUS.FAIL, code: "AUTH_BYPASS_" + status};
    return {status: STATUS.FAIL, code: "UNEXPECTED_" + status};
  }
  if (status === 200) return {status: STATUS.PASS, code: "ALLOWED_200"};
  if (status === 401 || status === 403 || status === 503) return {status: STATUS.BLOCKED, code: "FIXTURE_OR_GATE_NOT_READY_" + status};
  return {status: STATUS.FAIL, code: "UNEXPECTED_" + status};
}

/** Probe matrix: GET-only, read-only, verified against route source on 30 Oct 2026. */
export const ROUTE_PROBES = Object.freeze([
  {path: "/api/vox/v1/work-queue", cells: {anonymous: "DENY", nonStaff: "DENY", staff: "ALLOW"}},
  {path: "/api/vox/v1/staff-notifications", cells: {anonymous: "DENY", nonStaff: "DENY", staff: "ALLOW"}},
  {path: "/api/vox/v1/staff-directory", cells: {anonymous: "DENY", nonStaff: "DENY", staff: "DENY", owner: "ALLOW"}}
]);

/** Strip comments and single-quoted literals so keyword scans do not hit prose. */
export function stripSql(sql) {
  return String(sql).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

const SQL_RULES = Object.freeze([
  ["DESTRUCTIVE_DROP", /\bdrop\s+(table|schema|database|role|user|owned)\b/i],
  ["TRUNCATE", /\btruncate\b/i],
  ["ALTER_SYSTEM", /\balter\s+system\b/i],
  ["COPY_PROGRAM", /\bcopy\b[^;]*\bprogram\b/i],
  ["ROLE_MUTATION", /\b(alter|create)\s+(role|user)\b/i],
  ["BYPASSRLS", /\bbypassrls\b/i],
  ["RLS_DISABLED", /\bdisable\s+row\s+level\s+security\b/i],
  ["FORCE_RLS_REMOVED", /\bno\s+force\s+row\s+level\s+security\b/i],
  ["GRANT_TO_PUBLIC_OR_ANON", /\bgrant\b[^;]*\bto\b[^;]*\b(public|anon)\b/i]
]);

/** Static, non-executing review of one migration source. Findings are heuristics, not a PG parse. */
export function staticSqlDryRun(sql) {
  const body = stripSql(sql).trim();
  const findings = [];
  if (!/^begin\s*;/i.test(body)) findings.push("NO_LEADING_BEGIN");
  if (!/commit\s*;\s*$/i.test(body)) findings.push("NO_TRAILING_COMMIT");
  if ((body.match(/(^|;)\s*commit\s*;/gi) || []).length !== 1) findings.push("COMMIT_COUNT_NOT_ONE");
  for (const [code, re] of SQL_RULES) if (re.test(body)) findings.push(code);
  const chunks = body.split(/\bcreate\s+(?:or\s+replace\s+)?function\b/i).slice(1);
  chunks.forEach((chunk, i) => {
    const header = chunk.split("$")[0];
    if (/\bsecurity\s+definer\b/i.test(header) && !/\bsearch_path\b/i.test(header)) findings.push("SECURITY_DEFINER_WITHOUT_SEARCH_PATH#" + (i + 1));
  });
  return findings;
}

/** Independent recomputation of the pinned manifest digest (does not call the contract). */
export function listingDigest(files) {
  return sha256Hex(Buffer.from(files.map(f => f.order + "|" + f.path + "|" + f.sha256).join("\n")));
}

/** Compare freshly hashed files with the pinned fingerprint. Returns problems, [] means identical. */
export function comparePinned(pinned, actual) {
  const problems = [];
  if (!Array.isArray(pinned?.files) || pinned.files.length !== 30) problems.push("PINNED_FILE_COUNT_NOT_30");
  if (pinned?.canApply !== false) problems.push("PINNED_CAN_APPLY_NOT_FALSE");
  if (pinned?.releaseReady !== false) problems.push("PINNED_RELEASE_READY_NOT_FALSE");
  if (actual.length !== (pinned?.files?.length ?? -1)) problems.push("ACTUAL_FILE_COUNT_MISMATCH");
  pinned?.files?.forEach((p, i) => {
    const a = actual[i];
    if (!a) return;
    if (a.path !== p.path) problems.push("PATH_MISMATCH#" + p.order);
    if (a.sha256 !== p.sha256) problems.push("SHA256_MISMATCH#" + p.order + (a.crlf ? "(CRLF_PRESENT_CHECK_AUTOCRLF)" : ""));
    if (a.bytes !== p.bytes) problems.push("BYTES_MISMATCH#" + p.order);
  });
  if (pinned?.files && listingDigest(pinned.files) !== pinned.manifestDigest) problems.push("PINNED_DIGEST_INTERNALLY_INCONSISTENT");
  const stamps = (pinned?.files || []).map(f => /(\d{14})_/.exec(f.path)?.[1]);
  if (stamps.some((s, i) => !s || (i > 0 && s <= stamps[i - 1]))) problems.push("TIMESTAMPS_NOT_STRICTLY_INCREASING");
  return problems;
}

// These are actual HMAC signing secrets, not boolean feature controls. They must
// be read as secrets at runtime, not compared with an activation literal.
const NON_FLAG_VOX_CONFIG = new Set(["VOX_F1_EOD_SIGNING_KEY", "VOX_AGNI_OUTBOX_SIGNING_KEY"]);
const GATE_BAD_DEFAULT = /process\.env\.VOX_[A-Z0-9_]+\s*(\?\?|\|\|)/;
const GATE_BAD_NEGATIVE = /process\.env\.VOX_[A-Z0-9_]+\s*!==?\s*["'](off|false|0|disabled|no)["']/i;
/** Source-level fail-closed check for VOX env flags in one file. */
export function analyzeGateSource(text) {
  const problems = [];
  const names = [...new Set([...String(text).matchAll(/process\.env\.(VOX_[A-Z0-9_]+)/g)].map(m => m[1]))]
    .filter(n => !NON_FLAG_VOX_CONFIG.has(n));
  if (GATE_BAD_DEFAULT.test(text)) problems.push("GATE_HAS_DEFAULT_FALLBACK");
  if (GATE_BAD_NEGATIVE.test(text)) problems.push("GATE_DEFAULT_ON_NEGATIVE_COMPARE");
  for (const n of names) {
    if (!new RegExp("process\\.env\\." + n + "\\s*(===|!==)\\s*[\"'][^\"']+[\"']").test(text)) problems.push("GATE_NOT_STRICT_LITERAL:" + n);
    if (new RegExp("process\\.env\\." + n + "\\s*=[^=]").test(text)) problems.push("GATE_ASSIGNED_IN_SOURCE:" + n);
  }
  return {names, problems};
}

/** True if the route text refuses with 503 before reading an Authorization header or calling a client. */
export function gateBeforeAuth(text) {
  const t = String(text);
  const gate = t.search(/process\.env\.VOX_[A-Z0-9_]+\s*!==\s*["']/);
  if (gate < 0) return true;
  const first = [t.indexOf("headers.get(\"authorization\")"), t.indexOf("adminClient("), t.indexOf("request.text()")]
    .filter(i => i >= 0).sort((a, b) => a - b)[0];
  return first === undefined || gate < first;
}

/** Redact tokens/secrets from text that will be persisted. */
export function redact(text, secrets = []) {
  let out = String(text).replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, "[REDACTED_JWT]");
  for (const s of secrets) if (typeof s === "string" && s.length >= 8) out = out.split(s).join("[REDACTED]");
  return out;
}
