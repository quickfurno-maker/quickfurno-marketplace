// ============================================================================
// QF-MVP-30.4D-A1 — Staging build orchestration.
//
// Order is the whole point:
//   1. resolve the EFFECTIVE environment the way `next build` will see it;
//   2. refuse BEFORE spawning Next if any gate fails (nothing is ever baked);
//   3. remove stale output, so a previous contaminated build cannot be mistaken
//      for this one;
//   4. run the REAL existing production build command as a child;
//   5. preserve its exit code / signal;
//   6. rescan the produced output and refuse on contamination.
//
// Every dependency (fs, spawn, env, logger) is injected, so the self-tests
// exercise this exact control flow without a real build, network or database.
// ============================================================================

import path from "node:path";
import { evaluatePreBuildGates, scanBuildOutput, AUTHORIZED_REF } from "./stagingBuildGate.mjs";

/** Files under a directory as [{ path, text }]; unreadable/binary entries are skipped. */
export function readTree(fsApi, root, dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fsApi.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        let text;
        try {
          text = fsApi.readFileSync(p, "utf8");
        } catch {
          continue;
        }
        out.push({ path: path.relative(root, p).split(path.sep).join("/"), text });
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * Delete the build output directory.
 *
 * Refuses to remove anything that is not exactly <root>/.next — a guard against
 * a mis-set root ever turning this into a destructive command.
 */
export function removeBuildOutput(fsApi, root, outDir) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(outDir);
  const expected = path.resolve(resolvedRoot, ".next");
  if (resolved !== expected) {
    throw new Error(`refusing to remove ${resolved}: only ${expected} may be removed`);
  }
  if (!fsApi.existsSync(resolved)) return false;
  fsApi.rmSync(resolved, { recursive: true, force: true });
  return true;
}

/**
 * @param {object} o
 * @param {Record<string,string>} o.env       effective environment (post @next/env)
 * @param {string}  o.root                    repository root
 * @param {object}  o.fsApi                   node:fs-compatible surface
 * @param {Function} o.spawnChild             ({command,args,cwd,env}) => {status, signal}
 * @param {Function} [o.log]                  bounded, secret-free line logger
 * @returns {{code:number, stage:string, preGates:object, scan:object|null, child:object|null}}
 */
export function runStagingBuild({ env, root, fsApi, spawnChild, log = () => {} }) {
  const outDir = path.join(root, ".next");

  // -- 1/2. pre-build gates: nothing is spawned until these pass ---------------
  const preGates = evaluatePreBuildGates(env);
  log("== QF staging build gate — pre-build ==");
  log(`   authorized project ref      : ${AUTHORIZED_REF}`);
  log(`   effective project ref       : ${preGates.evidence.effectiveRef || "(unresolvable)"}`);
  log(`   safe-session marker         : ${preGates.evidence.safeSession}`);
  log(`   command-wrapper marker      : ${preGates.evidence.commandWrapper}`);
  log(`   deny-list complete          : ${preGates.evidence.denyListComplete}`);
  log(`   prohibited-ref leaks        : ${preGates.evidence.leakedVariableCount}`);
  log(`   prohibited-ref in JWT claims: ${preGates.evidence.jwtProhibitedVariableCount}`);
  log(`   credential project mismatch : ${preGates.evidence.credentialProjectMismatchCount}`);
  log(`   credential role faults      : ${preGates.evidence.credentialRoleFaultCount}`);
  log(`   enabled outbound flags      : ${preGates.evidence.enabledOutboundFlagCount}`);
  log(`   public credential present   : ${preGates.evidence.publicCredentialPresent}`);
  log(`   service credential present  : ${preGates.evidence.serviceCredentialPresent}`);

  if (!preGates.ok) {
    log("");
    for (const f of preGates.failures) log(`   FAIL ${f.code}: ${f.detail}`);
    log("");
    log("RESULT: FAIL (pre-build gate) — Next was NOT invoked, nothing was built");
    return { code: 1, stage: "pre-build", preGates, scan: null, child: null };
  }
  log("   pre-build gates             : PASS");

  // -- 3. stale output must not survive into the scan --------------------------
  const removed = removeBuildOutput(fsApi, root, outDir);
  log(`   previous .next removed      : ${removed}`);

  // -- 4/5. the REAL production build, exit code preserved ---------------------
  log("");
  log("== invoking the real production build ==");
  // The REAL production script, unchanged. Shim resolution (npm is a .cmd on
  // Windows, which Node refuses to exec without a shell) is the caller's job —
  // see build-staging-safe.mjs.
  const child = spawnChild({
    command: "npm",
    args: ["run", "build"],
    cwd: root,
    env,
  });
  if (child.error) {
    log(`RESULT: FAIL (build could not be started: ${child.error.message})`);
    return { code: 1, stage: "build", preGates, scan: null, child };
  }
  if (child.signal) {
    log(`RESULT: FAIL (build terminated by signal ${child.signal})`);
    return { code: 1, stage: "build", preGates, scan: null, child };
  }
  if (child.status !== 0) {
    log(`RESULT: FAIL (build exited ${child.status})`);
    return { code: typeof child.status === "number" ? child.status : 1, stage: "build", preGates, scan: null, child };
  }

  // -- 6. post-build scan ------------------------------------------------------
  const clientFiles = readTree(fsApi, root, path.join(outDir, "static"));
  const serverFiles = readTree(fsApi, root, path.join(outDir, "server"));
  // QF-MVP-75.03 adds GOOGLE_ROUTES_API_KEY: a SERVER-ONLY Google credential
  // that must never be inlined into a client chunk. It is scanned exactly like
  // the Supabase secrets — by value, so the check also catches the specific
  // mistake of pasting the PUBLIC browser Places key into the server variable
  // (the public key legitimately appears in client output, so an identical
  // value would trip this and be refused).
  const secrets = [
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.SUPABASE_SECRET_KEY,
    env.GOOGLE_ROUTES_API_KEY,
  ].filter(Boolean);
  const scan = scanBuildOutput({ clientFiles, serverFiles, secrets });

  log("");
  log("== QF staging build gate — post-build scan ==");
  log(`   client files scanned        : ${scan.evidence.clientFileCount}`);
  log(`   server files scanned        : ${scan.evidence.serverFileCount}`);
  log(`   distinct project refs       : ${scan.evidence.distinctProjectRefs.join(", ") || "(none)"}`);
  log(`   files with prohibited ref   : ${scan.evidence.prohibitedRefFileCount}`);
  log(`   client files with a secret  : ${scan.evidence.clientSecretFileCount}`);

  if (!scan.ok) {
    log("");
    for (const f of scan.failures) log(`   FAIL ${f.code}: ${f.detail}`);
    log("");
    log("RESULT: FAIL (post-build scan)");
    return { code: 1, stage: "post-build", preGates, scan, child };
  }

  log("   post-build scan             : PASS");
  log("");
  log("RESULT: PASS");
  return { code: 0, stage: "complete", preGates, scan, child };
}
