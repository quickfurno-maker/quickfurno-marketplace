#!/usr/bin/env node
// ============================================================================
// QF-MVP-40-R7D — the executable entry point for the staging canary operator.
//
// WHY THIS FILE EXISTS
//   The bootstrap used to live at the bottom of `activate-meta-staging-canary.mjs`,
//   guarded by `isDirect`, and its first act was a TOP-LEVEL `await import()` of
//   `./canaryActivationRuntime.mjs`. That runtime module statically imports back from
//   the operator, so whenever the operator was the process entry the two modules waited
//   on each other forever: Node reported an unsettled top-level await and exited 13 with
//   no output, in EVERY mode — including the `--disable` emergency closure. The operator
//   CLI had never once executed.
//
//   Nothing imports THIS file. That is the whole repair: with the bootstrap outside the
//   import graph, no cycle can form, and the two library modules keep their existing
//   relationship untouched.
//
// THIS FILE IS A PURE BOOTSTRAP AND NOTHING ELSE
//   It owns no argv parsing — `runCli` already parses, and a second parser is exactly how
//   a CLI and its tests drift apart. It owns no environment logic, no staging fence, no
//   adapter construction and no credential handling. Every dependency below is the SAME
//   exported factory the audited operator module already defines, so there is still ONE
//   implementation of each and still ONE activation authority.
//
//   Consequently this file cannot arm anything, cannot send anything, and cannot reach
//   Meta or the database except through the factories it merely passes along.
// ============================================================================

import { runCli } from "./canaryActivationRuntime.mjs";
import {
  buildAttestationIo,
  buildIndexProofAdapter,
  buildRealAdapters,
  buildStagingAssetProofAdapter,
  randomNonce,
  resolveGitHead,
} from "./activate-meta-staging-canary.mjs";

const result = await runCli({
  argv: process.argv.slice(2),
  env: process.env,
  headResolver: resolveGitHead,
  adapterFactory: buildRealAdapters,
  attestationIoFactory: ({ mode }) => buildAttestationIo(mode),
  indexProofFactory: buildIndexProofAdapter,
  stagingAssetProofFactory: buildStagingAssetProofAdapter,
  now: () => Date.now(),
  nonce: randomNonce(),
  log: (line) => console.log(line),
});

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  console.error(`REFUSED: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`);
}

// The exit CODES are exactly the ones the bootstrap always promised — 0 on success, 3 on
// refusal. Only the mechanism differs: `process.exitCode` lets Node drain naturally,
// whereas calling `process.exit()` while a supabase-js/undici socket is mid-close aborts
// the process on Windows and reports 127 AFTER a correct result line, turning a good run
// into an apparently failed one.
process.exitCode = result.ok ? 0 : 3;
