#!/usr/bin/env node
/**
 * QF-MVP-30.4D-A1 — the ONLY accepted build command for staging evidence and
 * smoke workflows.
 *
 *   npm run build:staging:safe
 *
 * It does not replace `npm run build`. Normal production builds and deployments
 * keep using `npm run build` and are NOT required to carry staging markers —
 * this wrapper adds staging-only preconditions on top of that same command.
 *
 * The effective environment is resolved through @next/env exactly as `next build`
 * resolves it, so this refuses the contamination recorded in QF-MVP-30.4D-A:
 * a bare build silently loading a production `.env.local`.
 *
 * Exit 0 = PASS. Any gate failure is non-zero, and a pre-build failure means
 * Next was never invoked.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runStagingBuild } from "./runStagingBuild.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Resolve .env* the way Next will. Note @next/env only assigns keys that are
// UNDEFINED in process.env, so wrapper-provided process vars always win — which
// is exactly why a wrapper-mediated build is trustworthy and a bare one is not.
const requireFromRepo = createRequire(path.join(ROOT, "package.json"));
try {
  const { loadEnvConfig } = requireFromRepo("@next/env");
  loadEnvConfig(ROOT);
} catch {
  const { loadEnvConfig } = requireFromRepo("next/dist/compiled/@next/env");
  loadEnvConfig(ROOT);
}

const result = runStagingBuild({
  env: process.env,
  root: ROOT,
  fsApi: fs,
  // On Windows `npm` is a .cmd shim, which Node refuses to exec without a shell.
  // The command and arguments here are fixed literals — no caller-supplied text
  // reaches the shell — so enabling it on win32 introduces no injection surface.
  spawnChild: ({ command, args, cwd, env }) =>
    spawnSync(command, args, {
      cwd, env, stdio: "inherit", shell: process.platform === "win32",
    }),
  log: (line) => console.log(line),
});

process.exit(result.code);
