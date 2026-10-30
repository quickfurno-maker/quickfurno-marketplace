import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
  INTEGRATION_STEP_IDS, ROUTE_PROBES, SOURCE_STEP_IDS, STATUS, aggregate, analyzeGateSource, classifyProbe,
  comparePinned, evaluateSuiteRun, gateBeforeAuth, listingDigest, loopbackOrigin, makeStep, parseTapSummary,
  redact, scrubbedEnv, sha256Hex, staticSqlDryRun, summarizeJwt
} from "./rc4-qa-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const orchestrator = readFileSync(resolve(here, "rc4-qa-orchestrator.mjs"), "utf8");
const libSource = readFileSync(resolve(here, "rc4-qa-lib.mjs"), "utf8");
const pass = id => makeStep(id, id, STATUS.PASS);
const blocked = id => makeStep(id, id, STATUS.BLOCKED, {blockers: ["x"]});
const fail = id => makeStep(id, id, STATUS.FAIL, {failures: ["x"]});

test("makeStep refuses a PASS carrying problems and a FAIL/BLOCKED without a reason", () => {
  assert.throws(() => makeStep("a", "a", STATUS.PASS, {failures: ["x"]}));
  assert.throws(() => makeStep("a", "a", STATUS.PASS, {blockers: ["x"]}));
  assert.throws(() => makeStep("a", "a", STATUS.FAIL));
  assert.throws(() => makeStep("a", "a", STATUS.BLOCKED));
  assert.throws(() => makeStep("a", "a", "GREEN"));
});

test("source-only can never report plain PASS and is never GO", () => {
  const v = aggregate(SOURCE_STEP_IDS.map(pass), "source-only");
  assert.equal(v.overall, "SOURCE_PASS");
  assert.equal(v.exitCode, 0);
  assert.equal(v.goEligible, false);
  assert.equal(v.releaseDecision, "HOLD");
  assert.equal(v.integrationEvidenceComplete, false);
});

test("full mode: blocked integration step is BLOCKED, not PASS", () => {
  const steps = [...SOURCE_STEP_IDS.map(pass), pass(INTEGRATION_STEP_IDS[0]), blocked(INTEGRATION_STEP_IDS[1])];
  const v = aggregate(steps, "full");
  assert.equal(v.overall, "BLOCKED");
  assert.equal(v.exitCode, 2);
  assert.deepEqual(v.blockedRequiredSteps, [INTEGRATION_STEP_IDS[1]]);
});

test("full mode: everything passing is the only route to PASS, and it is still HOLD", () => {
  const v = aggregate([...SOURCE_STEP_IDS, ...INTEGRATION_STEP_IDS].map(pass), "full");
  assert.equal(v.overall, "PASS");
  assert.equal(v.goEligible, false);
  assert.equal(v.releaseDecision, "HOLD");
});

test("a missing step is FAIL, and FAIL outranks BLOCKED", () => {
  const missing = aggregate(SOURCE_STEP_IDS.slice(1).map(pass), "source-only");
  assert.equal(missing.overall, "FAIL");
  assert.deepEqual(missing.missingSteps, [SOURCE_STEP_IDS[0]]);
  const mixed = aggregate([fail(SOURCE_STEP_IDS[0]), ...SOURCE_STEP_IDS.slice(1, 4).map(blocked), pass(SOURCE_STEP_IDS[4])], "source-only");
  assert.equal(mixed.overall, "FAIL");
  assert.equal(mixed.exitCode, 1);
  assert.throws(() => aggregate([], "partial"));
});

test("TAP parsing: PASS needs exit 0, a summary, all tests passing and nothing skipped", () => {
  const ok = "ok 1 - a\n# tests 3\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
  assert.equal(evaluateSuiteRun({exitCode: 0, stdout: ok}).status, STATUS.PASS);
  assert.equal(evaluateSuiteRun({exitCode: 1, stdout: ok}).status, STATUS.FAIL);
  assert.equal(evaluateSuiteRun({exitCode: 0, stdout: "ok 1 - a\n"}).reason, "NO_TAP_SUMMARY");
  assert.equal(evaluateSuiteRun({exitCode: 0, stdout: "# tests 0\n# pass 0\n# fail 0\n"}).reason, "ZERO_TESTS");
  assert.equal(evaluateSuiteRun({exitCode: 0, stdout: "# tests 3\n# pass 2\n# fail 1\n"}).reason, "TEST_FAILURES");
  assert.equal(evaluateSuiteRun({exitCode: 0, stdout: "# tests 3\n# pass 2\n# fail 0\n# skipped 1\n"}).reason, "PASS_COUNT_MISMATCH");
  const skipped = evaluateSuiteRun({exitCode: 0, stdout: "# tests 3\n# pass 3\n# fail 0\n# skipped 1\n"});
  assert.equal(skipped.status, STATUS.BLOCKED);
  assert.equal(evaluateSuiteRun({exitCode: 0, timedOut: true, stdout: ok}).reason, "TIMEOUT");
  assert.equal(evaluateSuiteRun({exitCode: null, signal: "SIGKILL", stdout: ok}).status, STATUS.FAIL);
  assert.equal(parseTapSummary("nothing"), null);
});

test("child environment is an allow-list: no secrets, VOX flags or NODE_OPTIONS survive", () => {
  const env = scrubbedEnv({
    PATH: "/bin", SUPABASE_SERVICE_ROLE_KEY: "s", DATABASE_URL: "d", VOX_STAFF_GRANTS_ENABLED: "staging",
    NODE_OPTIONS: "--require x", RC4_QA_TOKEN_STAFF: "t", PGPASSWORD: "p"
  });
  assert.deepEqual(Object.keys(env).sort(), ["NODE_ENV", "NO_COLOR", "PATH"]);
  assert.equal(env.NODE_ENV, "test");
});

test("only plain-http loopback origins are accepted", () => {
  assert.equal(loopbackOrigin("http://127.0.0.1:9999"), "http://127.0.0.1:9999");
  assert.equal(loopbackOrigin("http://localhost:3000/"), "http://localhost:3000");
  assert.equal(loopbackOrigin("http://[::1]:3000"), "http://[::1]:3000");
  for (const bad of [
    "https://127.0.0.1", "http://uckafzuochmbvtiodmcl.supabase.co", "http://127.0.0.1.evil.test", "http://user:pw@127.0.0.1",
    "http://127.0.0.1:3000/path", "http://127.0.0.1:3000/?a=1", "http://0.0.0.0:3000", "http://10.0.0.5", "", null, "not a url"
  ]) assert.equal(loopbackOrigin(bad), null, String(bad));
});

const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const fakeJwt = (claims, header = {alg: "HS256", typ: "JWT"}) => b64(header) + "." + b64(claims) + ".c2ln";

test("JWT summary: rejects alg none and junk, flags non-loopback issuer, never returns the subject", () => {
  assert.equal(summarizeJwt("abc", 0).ok, false);
  assert.equal(summarizeJwt(fakeJwt({}, {alg: "none"}), 0).reason, "ALG_NONE");
  const live = summarizeJwt(fakeJwt({iss: "https://uckafzuochmbvtiodmcl.supabase.co/auth/v1", sub: "u", exp: 100, aal: "aal2"}), 0);
  assert.equal(live.ok, true);
  assert.equal(live.issuerIsLoopback, false);
  const local = summarizeJwt(fakeJwt({iss: "http://127.0.0.1:9999/auth/v1", sub: "u-1", exp: 1000, aal: "aal2"}), 100);
  assert.equal(local.issuerIsLoopback, true);
  assert.equal(local.secondsToExpiry, 900);
  assert.equal("sub" in local, false);
  assert.match(local.subHash, /^[a-f0-9]{12}$/);
});

test("401/403/200 classification: a bypass is FAIL, a closed gate or missing identity is BLOCKED", () => {
  assert.equal(classifyProbe("DENY", 401).status, STATUS.PASS);
  assert.equal(classifyProbe("DENY", 403).status, STATUS.PASS);
  assert.equal(classifyProbe("DENY", 200).status, STATUS.FAIL);
  assert.equal(classifyProbe("DENY", 201).code, "AUTH_BYPASS_201");
  assert.equal(classifyProbe("DENY", 404).status, STATUS.FAIL);
  assert.equal(classifyProbe("DENY", 500).status, STATUS.FAIL);
  assert.equal(classifyProbe("DENY", 503).status, STATUS.BLOCKED);
  assert.equal(classifyProbe("DENY", null).status, STATUS.BLOCKED);
  assert.equal(classifyProbe("ALLOW", 200).status, STATUS.PASS);
  for (const s of [401, 403, 503]) assert.equal(classifyProbe("ALLOW", s).status, STATUS.BLOCKED);
  assert.equal(classifyProbe("ALLOW", 500).status, STATUS.FAIL);
  assert.equal(classifyProbe("ALLOW", null).status, STATUS.BLOCKED);
});

test("probe table is GET-only data pointing at real Core routes, with anonymous always denied", () => {
  for (const p of ROUTE_PROBES) {
    assert.match(p.path, /^\/api\/vox\/v1\/[a-z0-9-]+$/);
    assert.equal(p.cells.anonymous, "DENY");
    assert.equal(readFileSync(resolve(here, "../../../app" + p.path + "/route.ts"), "utf8").includes("export async function GET"), true, p.path);
  }
});

test("static SQL review flags unsafe statements and passes a clean transactional file", () => {
  const clean = "-- drop table in a comment\nbegin;\ncreate table t(a int);\nrevoke all on t from public, anon;\ncreate function f() returns int language sql security definer set search_path = public as $$ select 1 $$;\ncommit;\n";
  assert.deepEqual(staticSqlDryRun(clean), []);
  const bad = (sql) => staticSqlDryRun("begin;\n" + sql + "\ncommit;");
  assert.ok(bad("drop table x;").includes("DESTRUCTIVE_DROP"));
  assert.ok(bad("truncate x;").includes("TRUNCATE"));
  assert.ok(bad("grant select on t to anon;").includes("GRANT_TO_PUBLIC_OR_ANON"));
  assert.ok(bad("grant all on t to public;").includes("GRANT_TO_PUBLIC_OR_ANON"));
  assert.ok(bad("alter table t disable row level security;").includes("RLS_DISABLED"));
  assert.ok(bad("alter table t no force row level security;").includes("FORCE_RLS_REMOVED"));
  assert.ok(bad("alter role x bypassrls;").includes("BYPASSRLS"));
  assert.ok(bad("create function f() returns int language sql security definer as $$ select 1 $$;").some(x => x.startsWith("SECURITY_DEFINER_WITHOUT_SEARCH_PATH")));
  assert.ok(staticSqlDryRun("create table t(a int);").includes("NO_LEADING_BEGIN"));
  assert.ok(staticSqlDryRun("begin; create table t(a int);").includes("NO_TRAILING_COMMIT"));
  assert.deepEqual(staticSqlDryRun("begin; select 'drop table x'; commit;"), []);
});

test("pinned-hash comparison detects any byte, path, order, count or digest drift", () => {
  const mk = i => ({order: i, path: "ops/vox/sql-candidates/" + (20261015010000 + i * 10000) + "_x.sql", sha256: sha256Hex("f" + i), bytes: 100 + i});
  const files = Array.from({length: 30}, (_, i) => mk(i + 1));
  const pinned = {files, manifestDigest: listingDigest(files), canApply: false, releaseReady: false};
  const actual = files.map(f => ({...f}));
  assert.deepEqual(comparePinned(pinned, actual), []);
  assert.deepEqual(comparePinned(pinned, actual.slice(1)).includes("ACTUAL_FILE_COUNT_MISMATCH"), true);
  const flipped = actual.map((f, i) => i === 4 ? {...f, sha256: sha256Hex("other"), crlf: true} : f);
  assert.deepEqual(comparePinned(pinned, flipped), ["SHA256_MISMATCH#5(CRLF_PRESENT_CHECK_AUTOCRLF)"]);
  assert.ok(comparePinned({...pinned, manifestDigest: "0".repeat(64)}, actual).includes("PINNED_DIGEST_INTERNALLY_INCONSISTENT"));
  assert.ok(comparePinned({...pinned, canApply: true}, actual).includes("PINNED_CAN_APPLY_NOT_FALSE"));
  assert.ok(comparePinned({...pinned, releaseReady: true}, actual).includes("PINNED_RELEASE_READY_NOT_FALSE"));
});

test("gate analysis rejects default-on, negative compares, non-literal compares and source assignment", () => {
  assert.deepEqual(analyzeGateSource('if(process.env.VOX_A_ENABLED!=="staging")return 503;').problems, []);
  assert.deepEqual(analyzeGateSource('if(process.env.VOX_A_ENABLED==="staging"){}').problems, []);
  assert.ok(analyzeGateSource('const on=process.env.VOX_A_ENABLED??"staging";').problems.includes("GATE_HAS_DEFAULT_FALLBACK"));
  assert.ok(analyzeGateSource('const on=process.env.VOX_A_ENABLED||"staging";').problems.includes("GATE_HAS_DEFAULT_FALLBACK"));
  assert.ok(analyzeGateSource('if(process.env.VOX_A_ENABLED!=="off"){}').problems.includes("GATE_DEFAULT_ON_NEGATIVE_COMPARE"));
  assert.ok(analyzeGateSource("if(process.env.VOX_A_ENABLED){}").problems.includes("GATE_NOT_STRICT_LITERAL:VOX_A_ENABLED"));
  assert.ok(analyzeGateSource('process.env.VOX_A_ENABLED="staging";').problems.includes("GATE_ASSIGNED_IN_SOURCE:VOX_A_ENABLED"));
});

test("known signing secrets are not feature flags; unknown VOX toggles still fail closed", () => {
  const secretOnly = 'const secret=process.env.VOX_F1_EOD_SIGNING_KEY;const outbox=process.env.VOX_AGNI_OUTBOX_SIGNING_KEY;';
  assert.deepEqual(analyzeGateSource(secretOnly), {names: [], problems: []});
  assert.ok(analyzeGateSource('if(process.env.VOX_UNREVIEWED_ENABLED){}').problems.includes('GATE_NOT_STRICT_LITERAL:VOX_UNREVIEWED_ENABLED'));
  assert.ok(analyzeGateSource('if(process.env.VOX_UNREVIEWED_SIGNING_KEY){}').problems.includes('GATE_NOT_STRICT_LITERAL:VOX_UNREVIEWED_SIGNING_KEY'));
});

test("gate must precede Authorization parsing and client construction", () => {
  assert.equal(gateBeforeAuth('if(process.env.VOX_A!=="staging")return 1;\nrequest.headers.get("authorization")'), true);
  assert.equal(gateBeforeAuth('request.headers.get("authorization");\nif(process.env.VOX_A!=="staging")return 1;'), false);
  assert.equal(gateBeforeAuth('const d=adminClient();\nif(process.env.VOX_A!=="staging")return 1;'), false);
});

test("redaction removes JWTs and literal secrets from persisted text", () => {
  const jwt = fakeJwt({sub: "u"});
  const out = redact("Bearer " + jwt + " and hunter2hunter2 and short", ["hunter2hunter2", "short"]);
  assert.equal(out.includes(jwt), false);
  assert.equal(out.includes("hunter2hunter2"), false);
  assert.equal(out.includes("short"), true);
});

test("real repo: the shipped orchestrator is read-only and loopback/local-only by source guard", () => {
  const both = orchestrator + libSource;
  assert.equal(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(both), false);
  assert.equal(/method:\s*"GET"/.test(orchestrator), true);
  assert.equal(/\.supabase\.(co|com)|api\.stripe|razorpay|twilio|whatsapp\.com/i.test(both.replace(/uckafzuochmbvtiodmcl\.supabase\.co/g, "")), false);
  assert.equal(/spawnSync\(\s*["']git["']/.test(orchestrator), false);
  assert.equal(/readFileSync\([^)]*\.env/.test(both), false);
  assert.equal(/shell:\s*true/.test(orchestrator), false);
  // every child process is spawned without a shell
  assert.equal((orchestrator.match(/spawnSync\(/g) || []).length, (orchestrator.match(/shell:\s*false/g) || []).length);
  assert.equal(/process\.env\.(SUPABASE|DATABASE|PG)/.test(orchestrator), false);
});

test("real repo: report is create-only and confined, and PASS cannot be fabricated for missing prerequisites", () => {
  assert.match(orchestrator, /flag:\s*"wx"/);
  assert.match(orchestrator, /OUT_MUST_BE_UNDER_TMPDIR_OR_TEST_RESULTS/);
  assert.match(orchestrator, /NOT_RUN_IN_SOURCE_ONLY_MODE/);
  assert.match(orchestrator, /NOT_REQUESTED: pass --with-pg17/);
  assert.match(orchestrator, /_NOT_SET/);
  assert.match(orchestrator, /IDENTITY_UNAVAILABLE_/);
});
