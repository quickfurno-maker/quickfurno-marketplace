#!/usr/bin/env node
/**
 * QF-MVP-30.4D-A1 — offline validator for the staging build environment gate.
 *
 * Executes the REAL guard against controlled fixtures. There are no
 * source-text-only assertions here: every case runs the actual decision code,
 * and every mutation case loads a genuinely modified copy of the guard to prove
 * the check under test is load-bearing.
 *
 * Hermetic: an in-memory fs shim and a fake child stand in for the filesystem
 * and the build, so this never runs a real build and never touches the network
 * or a database.
 *
 * Usage:  npm run test:mvp:build-gate                          (exit 0 = PASS)
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  evaluatePreBuildGates, scanBuildOutput, isFlagEnabled, refFromUrl,
  AUTHORIZED_REF, PRODUCTION_REF, JARVIS_REF, OUTBOUND_FLAG_VARS,
} from "./stagingBuildGate.mjs";
import { runStagingBuild, removeBuildOutput } from "./runStagingBuild.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const GATE_SRC = path.join(HERE, "stagingBuildGate.mjs");
const RUNNER_SRC = path.join(HERE, "runStagingBuild.mjs");

const results = [];
const record = (name, ok, detail = "") => results.push({ name, ok, detail });

/* ===========================================================================
 * Fixtures
 * ========================================================================= */

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.${"s".repeat(24)}`;
const ANON_JWT = jwt({ iss: "supabase", ref: AUTHORIZED_REF, role: "anon" });
const SERVICE_JWT = jwt({ iss: "supabase", ref: AUTHORIZED_REF, role: "service_role" });

const baseEnv = (over = {}) => {
  const env = {
    QF_STAGING_SAFE_SESSION: "1",
    QF_STAGING_COMMAND_WRAPPER: "1",
    QF_AUTHORIZED_SUPABASE_PROJECT_REF: AUTHORIZED_REF,
    QF_PROHIBITED_SUPABASE_PROJECT_REFS: `${PRODUCTION_REF},${JARVIS_REF}`,
    NEXT_PUBLIC_SUPABASE_URL: `https://${AUTHORIZED_REF}.supabase.co`,
    SUPABASE_URL: `https://${AUTHORIZED_REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_JWT,
  };
  for (const f of OUTBOUND_FLAG_VARS) env[f] = "false";
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
};

const cleanClient = () => `self.__c=1;var u="https://${AUTHORIZED_REF}.supabase.co",k="${ANON_JWT}";`;
const cleanServer = () => `exports.u="https://${AUTHORIZED_REF}.supabase.co";`;

/** Minimal in-memory fs: no disk is touched by any test in this file. */
function memFs(files) {
  const store = new Map();
  for (const [p, text] of Object.entries(files)) store.set(path.resolve(p), text);
  const dirsOf = (dir) => {
    const base = path.resolve(dir);
    const names = new Map();
    for (const key of store.keys()) {
      if (!key.startsWith(base + path.sep)) continue;
      const rest = key.slice(base.length + 1);
      const seg = rest.split(path.sep)[0];
      const isDir = rest.includes(path.sep);
      if (!names.has(seg)) names.set(seg, isDir);
    }
    return [...names.entries()].map(([name, isDir]) => ({ name, isDirectory: () => isDir }));
  };
  return {
    store,
    existsSync: (p) => {
      const base = path.resolve(p);
      if (store.has(base)) return true;
      for (const key of store.keys()) if (key.startsWith(base + path.sep)) return true;
      return false;
    },
    readdirSync: (d, _opts) => {
      const entries = dirsOf(d);
      if (entries.length === 0 && !store.has(path.resolve(d))) {
        const err = new Error(`ENOENT: ${d}`);
        err.code = "ENOENT";
        throw err;
      }
      return entries;
    },
    readFileSync: (p) => {
      const key = path.resolve(p);
      if (!store.has(key)) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = "ENOENT";
        throw err;
      }
      return store.get(key);
    },
    rmSync: (p) => {
      const base = path.resolve(p);
      for (const key of [...store.keys()]) {
        if (key === base || key.startsWith(base + path.sep)) store.delete(key);
      }
    },
  };
}

const outputFiles = ({ client = cleanClient(), server = cleanServer(), extra = {} } = {}) => ({
  [path.join(ROOT, ".next/static/chunks/main.js")]: client,
  [path.join(ROOT, ".next/server/app/page.js")]: server,
  ...extra,
});

/** A fake build child that "produces" output by writing into the mem fs. */
const fakeChild = (fsApi, files, status = 0, signal = null) => () => {
  for (const [p, text] of Object.entries(files)) fsApi.store.set(path.resolve(p), text);
  return { status, signal };
};

const run = (env, files, { status = 0, signal = null } = {}) => {
  const fsApi = memFs({});
  return runStagingBuild({
    env, root: ROOT, fsApi,
    spawnChild: fakeChild(fsApi, files, status, signal),
    log: () => {},
  });
};

/** Load a MUTATED copy of a guard module (relative imports rewritten to absolute). */
async function loadMutated(srcPath, mutate) {
  let src = readFileSync(srcPath, "utf8");
  const mutated = mutate(src);
  if (mutated === src) throw new Error(`mutation for ${path.basename(srcPath)} changed nothing`);
  const withAbsoluteImports = mutated.replace(
    /from\s+"\.\/([A-Za-z0-9_.-]+\.mjs)"/g,
    (_m, file) => `from "${pathToFileURL(path.join(path.dirname(srcPath), file)).href}"`,
  );
  const url = `data:text/javascript;base64,${Buffer.from(withAbsoluteImports, "utf8").toString("base64")}`;
  return import(url);
}

const codes = (r) => (r.failures ?? []).map((f) => f.code);
const failedWith = (r, code) => !r.ok && codes(r).includes(code);

/* ===========================================================================
 * 1. Unit behaviour of the primitives
 * ========================================================================= */

record("01 truthiness is fail-closed: only absent/''/0/false/no/off are disabled",
  ["", "0", "false", "FALSE", " off ", "no"].every((v) => !isFlagEnabled(v))
  && isFlagEnabled(undefined) === false
  && ["1", "true", "yes", "maybe", "0.0"].every((v) => isFlagEnabled(v)),
  "an unrecognised value must count as ENABLED");

record("02 project ref is derived from the URL host",
  refFromUrl(`https://${AUTHORIZED_REF}.supabase.co`) === AUTHORIZED_REF
  && refFromUrl("not-a-url") === ""
  && refFromUrl(undefined) === "");

/* ===========================================================================
 * 2. PASS case
 * ========================================================================= */

const passRun = run(baseEnv(), outputFiles());
record("03 PASS: authorised ref + markers + deny-list + flags false + clean output",
  passRun.code === 0 && passRun.stage === "complete",
  `code=${passRun.code} stage=${passRun.stage} ${JSON.stringify(codes(passRun.preGates))}${passRun.scan ? JSON.stringify(codes(passRun.scan)) : ""}`);

record("04 PASS run attributes the build to exactly the authorised project",
  passRun.scan?.evidence.distinctProjectRefs.length === 1
  && passRun.scan?.evidence.distinctProjectRefs[0] === AUTHORIZED_REF,
  JSON.stringify(passRun.scan?.evidence.distinctProjectRefs));

/* ===========================================================================
 * 3. FAIL cases — pre-build (Next must never be invoked)
 * ========================================================================= */

const prodEnvRun = run(
  baseEnv({ NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`, SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`, QF_AUTHORIZED_SUPABASE_PROJECT_REF: undefined }),
  outputFiles(),
);
record("05 FAIL: production ref as the effective project",
  prodEnvRun.code !== 0 && prodEnvRun.stage === "pre-build" && failedWith(prodEnvRun.preGates, "EFFECTIVE_REF_NOT_AUTHORIZED"),
  `${prodEnvRun.stage} ${JSON.stringify(codes(prodEnvRun.preGates))}`);

record("06 the production-ref failure happens BEFORE any build is spawned",
  prodEnvRun.child === null && prodEnvRun.scan === null,
  "Next must not be invoked once a pre-build gate fails");

const jarvisEnvRun = run(
  baseEnv({ NEXT_PUBLIC_SUPABASE_URL: `https://${JARVIS_REF}.supabase.co`, SUPABASE_URL: `https://${JARVIS_REF}.supabase.co`, QF_AUTHORIZED_SUPABASE_PROJECT_REF: undefined }),
  outputFiles(),
);
record("07 FAIL: QF-Jarvis ref as the effective project",
  jarvisEnvRun.code !== 0 && failedWith(jarvisEnvRun.preGates, "EFFECTIVE_REF_NOT_AUTHORIZED"),
  JSON.stringify(codes(jarvisEnvRun.preGates)));

const leakProd = evaluatePreBuildGates(baseEnv({ SOME_UNRELATED_URL: `https://${PRODUCTION_REF}.supabase.co/rest` }));
record("08 FAIL: production ref hiding in an unrelated effective variable",
  failedWith(leakProd, "PROHIBITED_REF_IN_ENVIRONMENT")
  && leakProd.failures.some((f) => f.detail.includes("SOME_UNRELATED_URL")),
  JSON.stringify(codes(leakProd)));

const leakJarvis = evaluatePreBuildGates(baseEnv({ LEGACY_WEBHOOK: JARVIS_REF }));
record("09 FAIL: QF-Jarvis ref hiding in an unrelated effective variable",
  failedWith(leakJarvis, "PROHIBITED_REF_IN_ENVIRONMENT"), JSON.stringify(codes(leakJarvis)));

record("10 the deny-list variable itself is the ONLY permitted carrier of those refs",
  evaluatePreBuildGates(baseEnv()).ok,
  "a correct deny-list must not itself trip the leak scan");

record("11 FAIL: missing safe-session marker",
  failedWith(evaluatePreBuildGates(baseEnv({ QF_STAGING_SAFE_SESSION: undefined })), "SAFE_SESSION_MARKER_MISSING"));

record("12 FAIL: missing command-wrapper marker",
  failedWith(evaluatePreBuildGates(baseEnv({ QF_STAGING_COMMAND_WRAPPER: undefined })), "COMMAND_WRAPPER_MARKER_MISSING"));

record("13 FAIL: deny-list missing the production ref",
  failedWith(evaluatePreBuildGates(baseEnv({ QF_PROHIBITED_SUPABASE_PROJECT_REFS: JARVIS_REF })), "DENY_LIST_INCOMPLETE"));

record("14 FAIL: deny-list missing the QF-Jarvis ref",
  failedWith(evaluatePreBuildGates(baseEnv({ QF_PROHIBITED_SUPABASE_PROJECT_REFS: PRODUCTION_REF })), "DENY_LIST_INCOMPLETE"));

record("15 FAIL: deny-list absent entirely",
  failedWith(evaluatePreBuildGates(baseEnv({ QF_PROHIBITED_SUPABASE_PROJECT_REFS: undefined })), "DENY_LIST_INCOMPLETE"));

// every outbound switch, one at a time
const flagFailures = OUTBOUND_FLAG_VARS.filter((flag) =>
  failedWith(evaluatePreBuildGates(baseEnv({ [flag]: "true" })), "OUTBOUND_FLAG_ENABLED"));
record("16 FAIL: any single outbound/n8n/provider flag set true",
  flagFailures.length === OUTBOUND_FLAG_VARS.length,
  `${flagFailures.length}/${OUTBOUND_FLAG_VARS.length} flags trip the gate`);

record("17 FAIL: required staging public credential absent",
  failedWith(evaluatePreBuildGates(baseEnv({
    NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
    SUPABASE_ANON_KEY: undefined, SUPABASE_PUBLISHABLE_KEY: undefined,
  })), "PUBLIC_CREDENTIAL_MISSING"));

record("18 FAIL: service credential absent",
  failedWith(evaluatePreBuildGates(baseEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined, SUPABASE_SECRET_KEY: undefined })), "SERVICE_CREDENTIAL_MISSING"));

record("19 FAIL: no resolvable project ref at all",
  failedWith(evaluatePreBuildGates(baseEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined, SUPABASE_URL: undefined })), "EFFECTIVE_REF_UNRESOLVABLE"));

record("20 FAIL: advertised ref marker disagrees with the effective URL",
  failedWith(evaluatePreBuildGates(baseEnv({ QF_AUTHORIZED_SUPABASE_PROJECT_REF: PRODUCTION_REF })), "AUTHORIZED_REF_MARKER_WRONG"));

/* ===========================================================================
 * 4. FAIL cases — post-build output scan
 * ========================================================================= */

const clientProd = run(baseEnv(), outputFiles({ client: `${cleanClient()}var p="https://${PRODUCTION_REF}.supabase.co";` }));
record("21 FAIL: prohibited ref injected into a client chunk",
  clientProd.code !== 0 && clientProd.stage === "post-build" && failedWith(clientProd.scan, "PROHIBITED_REF_IN_OUTPUT"),
  `${clientProd.stage} ${clientProd.scan ? JSON.stringify(codes(clientProd.scan)) : ""}`);

const serverProd = run(baseEnv(), outputFiles({ server: `${cleanServer()}exports.p="https://${PRODUCTION_REF}.supabase.co";` }));
record("22 FAIL: prohibited ref injected into a server chunk",
  serverProd.code !== 0 && failedWith(serverProd.scan, "PROHIBITED_REF_IN_OUTPUT"),
  serverProd.scan ? JSON.stringify(codes(serverProd.scan)) : "");

const jarvisOut = run(baseEnv(), outputFiles({ server: `${cleanServer()}exports.j="https://${JARVIS_REF}.supabase.co";` }));
record("23 FAIL: QF-Jarvis ref in built output",
  jarvisOut.code !== 0 && failedWith(jarvisOut.scan, "PROHIBITED_REF_IN_OUTPUT"));

const secretOut = run(baseEnv(), outputFiles({ client: `${cleanClient()}var s="${SERVICE_JWT}";` }));
record("24 FAIL: service-role JWT injected into a client chunk",
  secretOut.code !== 0 && failedWith(secretOut.scan, "SERVICE_CREDENTIAL_IN_CLIENT_BUNDLE"),
  secretOut.scan ? JSON.stringify(codes(secretOut.scan)) : "");

record("25 a service-role JWT is detected from its own payload, without being told the secret",
  !scanBuildOutput({
    clientFiles: [{ path: "c.js", text: `var s="${SERVICE_JWT}";https://${AUTHORIZED_REF}.supabase.co` }],
    serverFiles: [], secrets: [],
  }).ok,
  "detection must not depend on the literal key being supplied");

record("26 an anon JWT in the client bundle is accepted (it is public by design)",
  scanBuildOutput({
    clientFiles: [{ path: "c.js", text: cleanClient() }],
    serverFiles: [{ path: "s.js", text: cleanServer() }], secrets: [],
  }).ok);

/* QF-MVP-40 — the MODERN Supabase key shapes.
 *
 * A `sb_secret_…` key is not a JWT, so the payload-decoding branch above cannot see it.
 * Before this repair, a leak of the newer credential was caught ONLY when the literal
 * was passed in `secrets` — a strictly weaker guarantee than the legacy key enjoyed.
 * These cases pass `secrets: []` on purpose, so they fail if that regresses. */
const MODERN_SECRET = `sb_secret_${"A".repeat(32)}`;
const MODERN_PAT = `sbp_${"b".repeat(40)}`;
const MODERN_PUBLISHABLE = `sb_publishable_${"C".repeat(32)}`;

record("26a FAIL: a modern sb_secret_ key in a client chunk is detected from its own shape",
  !scanBuildOutput({
    clientFiles: [{ path: "c.js", text: `${cleanClient()}var s="${MODERN_SECRET}";` }],
    serverFiles: [], secrets: [],
  }).ok,
  "detection must not depend on the literal key being supplied");

record("26b FAIL: a Supabase personal access token in a client chunk is detected",
  !scanBuildOutput({
    clientFiles: [{ path: "c.js", text: `${cleanClient()}var s="${MODERN_PAT}";` }],
    serverFiles: [], secrets: [],
  }).ok);

record("26c the modern-key failure is reported as a client-bundle credential leak",
  failedWith(scanBuildOutput({
    clientFiles: [{ path: "c.js", text: `${cleanClient()}var s="${MODERN_SECRET}";` }],
    serverFiles: [], secrets: [],
  }), "SERVICE_CREDENTIAL_IN_CLIENT_BUNDLE"));

record("26d a modern PUBLISHABLE key in the client bundle is accepted (public by design)",
  scanBuildOutput({
    clientFiles: [{ path: "c.js", text: `${cleanClient()}var p="${MODERN_PUBLISHABLE}";` }],
    serverFiles: [{ path: "s.js", text: cleanServer() }], secrets: [],
  }).ok,
  "sb_publishable_ must never be treated as privileged");

record("26e a modern secret key in a SERVER chunk is not a client-bundle leak",
  scanBuildOutput({
    clientFiles: [{ path: "c.js", text: cleanClient() }],
    serverFiles: [{ path: "s.js", text: `${cleanServer()}exports.k="${MODERN_SECRET}";` }],
    secrets: [],
  }).ok,
  "a server-only chunk is exactly where a service credential legitimately lives");

const modernRun = run(baseEnv(), outputFiles({ client: `${cleanClient()}var s="${MODERN_SECRET}";` }));
record("26f FAIL: the orchestrated build refuses a modern-key client leak end to end",
  modernRun.code !== 0 && modernRun.stage === "post-build" &&
  failedWith(modernRun.scan, "SERVICE_CREDENTIAL_IN_CLIENT_BUNDLE"),
  modernRun.scan ? JSON.stringify(codes(modernRun.scan)) : "");

const ambiguous = run(baseEnv(), outputFiles({
  extra: { [path.join(ROOT, ".next/server/app/other.js")]: `https://abcdefghijklmnopqrst.supabase.co` },
}));
record("27 FAIL: ambiguous/duplicate build-target evidence (two distinct project refs)",
  ambiguous.code !== 0 && failedWith(ambiguous.scan, "BUILD_TARGET_AMBIGUOUS"),
  ambiguous.scan ? JSON.stringify(ambiguous.scan.evidence.distinctProjectRefs) : "");

const unattributable = run(baseEnv(), outputFiles({ client: "self.__c=1;", server: "exports.x=1;" }));
record("28 FAIL: output cannot be positively attributed to any project",
  unattributable.code !== 0 && failedWith(unattributable.scan, "BUILD_TARGET_UNATTRIBUTABLE"),
  unattributable.scan ? JSON.stringify(codes(unattributable.scan)) : "");

/* ===========================================================================
 * 5. FAIL cases — child build
 * ========================================================================= */

const childFail = run(baseEnv(), outputFiles(), { status: 2 });
record("29 FAIL: child build exits non-zero, and its exit code is preserved",
  childFail.code === 2 && childFail.stage === "build" && childFail.scan === null,
  `code=${childFail.code} stage=${childFail.stage}`);

const childSignal = run(baseEnv(), outputFiles(), { status: null, signal: "SIGTERM" });
record("30 FAIL: child terminated by a signal is a failure, not a pass",
  childSignal.code !== 0 && childSignal.stage === "build",
  `code=${childSignal.code} stage=${childSignal.stage}`);

// A build that never STARTED reports status null. Treating that as anything but
// a failure would let a gate "pass" having produced nothing — observed for real
// on Windows, where npm is a .cmd shim that Node refuses to exec without a shell.
const spawnFs = memFs({});
const spawnErrRun = runStagingBuild({
  env: baseEnv(), root: ROOT, fsApi: spawnFs,
  spawnChild: () => ({ error: new Error("spawnSync npm ENOENT"), status: null, signal: null }),
  log: () => {},
});
record("30b FAIL: a child that could not be started is a failure, never a pass",
  spawnErrRun.code !== 0 && spawnErrRun.stage === "build" && spawnErrRun.scan === null,
  `code=${spawnErrRun.code} stage=${spawnErrRun.stage}`);

/* ===========================================================================
 * 6. Stale-output and destructive-path safety
 * ========================================================================= */

const staleFs = memFs({ [path.join(ROOT, ".next/static/chunks/old.js")]: `https://${PRODUCTION_REF}.supabase.co` });
const staleRun = runStagingBuild({
  env: baseEnv(), root: ROOT, fsApi: staleFs,
  spawnChild: fakeChild(staleFs, outputFiles(), 0, null), log: () => {},
});
record("31 a stale contaminated .next is removed and cannot leak into the scan",
  staleRun.code === 0 && !staleFs.existsSync(path.join(ROOT, ".next/static/chunks/old.js")),
  `code=${staleRun.code}`);

let refusedBadPath = false;
try {
  removeBuildOutput(memFs({}), ROOT, path.join(ROOT, "..", "somewhere-else"));
} catch {
  refusedBadPath = true;
}
record("32 removal refuses any path that is not exactly <root>/.next", refusedBadPath);

/* ===========================================================================
 * 7. Mutation / negative controls — each check is proven LOAD-BEARING.
 *    A mutant that drops the check must PASS the input the real guard REFUSES.
 * ========================================================================= */

// A PRODUCTION url trips TWO independent guards (the allow-list check and the
// environment leak scan), so it cannot isolate either one. An UNLISTED third
// project is caught only by the allow-list — which is the point: the deny-list
// alone would happily build against an unknown project.
const UNLISTED_REF = "abcdefghijklmnopqrst";
const unlistedEnv = baseEnv({
  NEXT_PUBLIC_SUPABASE_URL: `https://${UNLISTED_REF}.supabase.co`,
  SUPABASE_URL: `https://${UNLISTED_REF}.supabase.co`,
  QF_AUTHORIZED_SUPABASE_PROJECT_REF: undefined,
});
const unlistedReal = evaluatePreBuildGates(unlistedEnv);
record("M0 an UNLISTED project is refused by the allow-list, not merely by the deny-list",
  failedWith(unlistedReal, "EFFECTIVE_REF_NOT_AUTHORIZED")
  && !codes(unlistedReal).includes("PROHIBITED_REF_IN_ENVIRONMENT"),
  JSON.stringify(codes(unlistedReal)));

const prodEnvGates = evaluatePreBuildGates(baseEnv({
  NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
  SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
  QF_AUTHORIZED_SUPABASE_PROJECT_REF: undefined,
}));
record("M0b a PRODUCTION url is caught by two independent guards (defence in depth)",
  codes(prodEnvGates).includes("EFFECTIVE_REF_NOT_AUTHORIZED")
  && codes(prodEnvGates).includes("PROHIBITED_REF_IN_ENVIRONMENT"),
  JSON.stringify(codes(prodEnvGates)));

const mutantNoRefCheck = await loadMutated(GATE_SRC, (s) =>
  s.replace(
    /} else if \(effectiveRef !== AUTHORIZED_REF\) \{[\s\S]*?\n  \}/,
    "}",
  ));
record("M1 removing the effective-ref check lets an UNLISTED project pass (check is load-bearing)",
  !unlistedReal.ok && mutantNoRefCheck.evaluatePreBuildGates(unlistedEnv).ok,
  `real=${unlistedReal.ok} mutant=${mutantNoRefCheck.evaluatePreBuildGates(unlistedEnv).ok}`);

const mutantNoScan = await loadMutated(RUNNER_SRC, (s) =>
  s.replace("if (!scan.ok) {", "if (false) {"));
const contaminatedOut = outputFiles({ client: `${cleanClient()}var p="https://${PRODUCTION_REF}.supabase.co";` });
const mutantScanFs = memFs({});
const mutantScanRun = mutantNoScan.runStagingBuild({
  env: baseEnv(), root: ROOT, fsApi: mutantScanFs,
  spawnChild: fakeChild(mutantScanFs, contaminatedOut, 0, null), log: () => {},
});
record("M2 skipping the post-build scan lets a contaminated build pass (scan is load-bearing)",
  run(baseEnv(), contaminatedOut).code !== 0 && mutantScanRun.code === 0,
  `real=${run(baseEnv(), contaminatedOut).code} mutant=${mutantScanRun.code}`);

const mutantNoFlagCheck = await loadMutated(GATE_SRC, (s) =>
  s.replace(
    /if \(enabledFlags\.length > 0\) \{[\s\S]*?\n  \}/,
    "if (false) { /* mutant */ }",
  ));
const flagEnv = baseEnv({ N8N_OUTBOUND_WEBHOOK_ENABLED: "true" });
record("M3 allowing a truthy outbound flag makes the gate pass (flag check is load-bearing)",
  !evaluatePreBuildGates(flagEnv).ok && mutantNoFlagCheck.evaluatePreBuildGates(flagEnv).ok,
  `real=${evaluatePreBuildGates(flagEnv).ok} mutant=${mutantNoFlagCheck.evaluatePreBuildGates(flagEnv).ok}`);

const mutantIgnoreChild = await loadMutated(RUNNER_SRC, (s) =>
  s.replace("if (child.status !== 0) {", "if (false) {"));
const ignoreFs = memFs({});
const ignoreRun = mutantIgnoreChild.runStagingBuild({
  env: baseEnv(), root: ROOT, fsApi: ignoreFs,
  spawnChild: fakeChild(ignoreFs, outputFiles(), 3, null), log: () => {},
});
record("M4 suppressing child failure turns a failed build into a pass (child check is load-bearing)",
  childFail.code === 2 && ignoreRun.code === 0,
  `real=${childFail.code} mutant=${ignoreRun.code}`);

/* ===========================================================================
 * 8. The gate must not print secrets
 * ========================================================================= */

const logged = [];
const loggingFs = memFs({});
runStagingBuild({
  env: baseEnv(), root: ROOT, fsApi: loggingFs,
  spawnChild: fakeChild(loggingFs, outputFiles(), 0, null),
  log: (l) => logged.push(l),
});
const loggedText = logged.join("\n");
record("33 no credential value ever appears in gate output",
  !loggedText.includes(SERVICE_JWT) && !loggedText.includes(ANON_JWT),
  "evidence must be bounded to refs, booleans, counts and paths");

record("34 gate output does report the authorised ref and bounded counts",
  loggedText.includes(AUTHORIZED_REF) && /client files scanned\s*:\s*\d+/.test(loggedText));

/* ===========================================================================
 * 8b. QF-MVP-40-R3 — the process-local staging build path
 *
 * The §7 live run refused because `.env.local` is production-attributed and @next/env
 * surfaced a production Supabase URL plus enabled n8n outbound flags. That refusal is
 * CORRECT and these prove each half of it is individually load-bearing — a weakened
 * gate would let a production-attributed build be published as staging evidence.
 * ========================================================================= */

const R3 = (over) => evaluatePreBuildGates(baseEnv(over));
const r3Failed = (over, code) => R3(over).failures.some((f) => f.code === code);

record("R3-B01 a production NEXT_PUBLIC ref cannot slip through",
  r3Failed({ NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` },
    "EFFECTIVE_REF_NOT_AUTHORIZED"),
  "the effective ref is derived from the URL the build would bake in");

record("R3-B02 a Jarvis ref cannot slip through either",
  r3Failed({ NEXT_PUBLIC_SUPABASE_URL: `https://${JARVIS_REF}.supabase.co` },
    "EFFECTIVE_REF_NOT_AUTHORIZED"));

record("R3-B03 a production ref ANYWHERE in the effective environment is caught",
  r3Failed({ SOME_OTHER_VAR: `postgres://${PRODUCTION_REF}.pooler.supabase.com` },
    "PROHIBITED_REF_IN_ENVIRONMENT"),
  "this is what caught the live .env.local contamination");

record("R3-B04 every known outbound/provider flag refuses when enabled",
  OUTBOUND_FLAG_VARS.every((f) => r3Failed({ [f]: "true" }, "OUTBOUND_FLAG_ENABLED")),
  `${OUTBOUND_FLAG_VARS.length} flags each proven individually load-bearing`);

record("R3-B05 the exact two n8n flags observed enabled in the live run refuse",
  r3Failed({ N8N_ENABLED: "true" }, "OUTBOUND_FLAG_ENABLED") &&
  r3Failed({ N8N_OUTBOUND_WEBHOOK_ENABLED: "true" }, "OUTBOUND_FLAG_ENABLED"));

record("R3-B06 a missing safe-session marker refuses",
  r3Failed({ QF_STAGING_SAFE_SESSION: undefined }, "SAFE_SESSION_MARKER_MISSING"));

record("R3-B07 a missing command-wrapper marker refuses",
  r3Failed({ QF_STAGING_COMMAND_WRAPPER: undefined }, "COMMAND_WRAPPER_MARKER_MISSING"));

record("R3-B08 an incomplete prohibited-ref deny list refuses",
  r3Failed({ QF_PROHIBITED_SUPABASE_PROJECT_REFS: PRODUCTION_REF }, "DENY_LIST_INCOMPLETE"),
  "both prohibited refs must be listed, not just one");

record("R3-B09 a marker that disagrees with the effective URL refuses",
  r3Failed({ QF_AUTHORIZED_SUPABASE_PROJECT_REF: JARVIS_REF }, "AUTHORIZED_REF_MARKER_WRONG"));

record("R3-B10 a missing staging public credential refuses",
  r3Failed({ NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }, "PUBLIC_CREDENTIAL_MISSING"));

record("R3-B11 a fully correct process-local staging environment PASSES",
  R3({}).ok === true,
  "so the documented operator sequence is achievable without touching .env.local");

// The wrapper-provided process environment must WIN over a dotenv file. @next/env only
// assigns keys that are undefined in process.env, which is precisely why a
// wrapper-mediated build is trustworthy and a bare one is not.
record("R3-B12 an explicit process-local staging URL wins over a production .env.local value",
  (() => {
    const env = baseEnv();                       // wrapper already set the staging URL
    const dotenvWouldSet = { NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` };
    for (const [k, v] of Object.entries(dotenvWouldSet)) if (env[k] === undefined) env[k] = v;
    return evaluatePreBuildGates(env).ok === true;
  })(),
  "@next/env never overwrites an already-defined process variable");

record("R3-B13 and if the wrapper did NOT set it, the dotenv value is caught, not trusted",
  (() => {
    const env = baseEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined, SUPABASE_URL: undefined });
    for (const [k, v] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` })) {
      if (env[k] === undefined) env[k] = v;
    }
    const out = evaluatePreBuildGates(env);
    return out.ok === false && out.failures.some((f) => f.code === "EFFECTIVE_REF_NOT_AUTHORIZED");
  })());

record("R3-B14 a privileged key shape in a BROWSER chunk is refused",
  (() => {
    const scan = scanBuildOutput({
      clientFiles: [{ path: "static/chunks/app.js", text: `var k="sb_secret_${"y".repeat(32)}";` }],
      serverFiles: [], secrets: [],
    });
    return scan.ok === false;
  })(),
  "modern sb_secret_ keys are detected by shape, not only by literal match");

record("R3-B15 a service_role JWT in a BROWSER chunk is refused",
  scanBuildOutput({
    clientFiles: [{ path: "static/chunks/app.js", text: `var k="${SERVICE_JWT}";` }],
    serverFiles: [], secrets: [],
  }).ok === false);

/* ===========================================================================
 * 9. The production build path is untouched
 * ========================================================================= */

const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
record("35 `npm run build` remains the plain production build",
  pkg.scripts.build === "next build", `build = ${JSON.stringify(pkg.scripts.build)}`);

record("36 the safe staging command exists and delegates to the real build",
  typeof pkg.scripts["build:staging:safe"] === "string"
  && pkg.scripts["build:staging:safe"].includes("build-staging-safe.mjs")
  && readFileSync(path.join(HERE, "runStagingBuild.mjs"), "utf8").includes('args: ["run", "build"]'),
  `build:staging:safe = ${JSON.stringify(pkg.scripts["build:staging:safe"])}`);

/* ===========================================================================
 * Report
 * ========================================================================= */
const failed = results.some((r) => !r.ok);
const passed = results.filter((r) => r.ok).length;
console.log("== QF-MVP-30.4D-A1 staging build environment gate validator ==");
for (const r of results) {
  console.log(`   ${r.ok ? "ok  " : "FAIL"}  ${r.name}`);
  if (!r.ok && r.detail) console.log(`         ${r.detail}`);
}
console.log("");
console.log(`checks: ${passed} passed, ${results.length - passed} failed (of ${results.length})`);
console.log("mutants: 4 (effective-ref check, post-build scan, outbound-flag check, child-failure check)");
console.log("no real build, network request or database access is performed by this validator");
console.log(`RESULT: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
