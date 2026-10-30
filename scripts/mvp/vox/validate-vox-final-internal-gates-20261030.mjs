// VOX final internal regression gate. Source-only by default; optional public Staging DENIAL probes.
// This command never reads credentials, applies SQL, enables flags or mutates business data.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../../..");
const folder = "scripts/mvp/vox/";
const sourceTests = [
  ["transitions", "validate-vox-governed-transition-20261030.mjs", "VOX_GOVERNED_TRANSITION_SOURCE_PASS", 16],
  ["eod", "validate-vox-partial-eod-read-20261030.mjs", "VOX_PARTIAL_EOD_GUARD_SOURCE_PASS", 25],
  ["http-contract", "validate-vox-action-eod-negative-contract-20261030.mjs", "VOX_ACTION_EOD_NEGATIVE_HTTP_CONTRACT_PASS", 7],
  ["managed-db-guard", "validate-vox-managed-staging-readiness-20261030.mjs", "VOX_STAGING_GUARDS_SOURCE_PASS", 15],
  ["scoped-staff", "validate-vox-read-scoped-core-20261029.mjs", "VOX_STAFF_SCOPED_READ_SOURCE_PASS", 26],
  ["staff-admin-read", "validate-vox-staff-admin-read-20261029.mjs", "VOX_STAFF_ADMIN_READ_CONTRACT_PASS", 25],
  ["owner-approvals", "validate-vox-owner-approvals-read-20261029.mjs", "VOX_OWNER_APPROVALS_READ_CONTRACT_PASS", 18],
  ["workqueue", "validate-vox-safe-workqueue-read-20261030.mjs", "VOX_SAFE_WORK_QUEUE_AND_CATALOG_PASS", 24],
  ["owner-schema", "validate-vox-02b-overview-schema-contract.mjs", "VOX_02B_SCHEMA_CONTRACT_PASS", 5],
];
const liveTests = [
  ["existing-staging-denials", "validate-vox-live-staging-unauthed-20261030.mjs", "VOX_LIVE_STAGING_UNAUTH_NEGATIVE_MATRIX_PASS", 18, ["--post-deploy"]],
  ["new-route-not-deployed", "validate-vox-action-eod-disabled-20261030.mjs", "VOX_ACTION_EOD_DISABLED_STAGING_HTTP_PASS", 11],
];
const flag = process.argv[2] ?? "--source-only";
assert.ok(["--source-only", "--live-staging-denials", "--self-test"].includes(flag), "UNKNOWN_MODE");
assert.equal(process.argv.length, process.argv[2] ? 3 : 2, "UNEXPECTED_ARGUMENTS");
const sourceCount = sourceTests.reduce((sum, t) => sum + t[3], 0);
const liveCount = liveTests.reduce((sum, t) => sum + t[3], 0);
assert.equal(sourceCount, 161);
assert.equal(liveCount, 29);
for (const t of [...sourceTests, ...liveTests]) {
  assert.ok(existsSync(resolve(root, folder + t[1])), "MISSING_TEST_" + t[0]);
}
for (const t of liveTests) {
  const code = readFileSync(resolve(root, folder + t[1]), "utf8");
  assert.match(code, /const ORIGIN="https:\/\/staging-core\.quickfurno\.in"/, "UNPINNED_STAGING_ORIGIN_" + t[0]);
  assert.doesNotMatch(code, /process\.env\.(?:SUPABASE|SERVICE_ROLE)|body\s*:/i, "UNSAFE_LIVE_TEST_" + t[0]);
}
if (flag === "--self-test") {
  console.log("VOX_FINAL_INTERNAL_GATE_SELFTEST_PASS 11/11 source=161 live_opt_in=29");
  process.exit(0);
}
const selected = flag === "--live-staging-denials" ? [...sourceTests, ...liveTests] : sourceTests;
let passed = 0;
for (const [name, file, marker, count, extra = []] of selected) {
  const result = spawnSync(process.execPath, [resolve(root, folder + file), ...extra], {
    cwd: root, encoding: "utf8", timeout: 75000, maxBuffer: 256 * 1024,
    env: { NODE_ENV: "test" },
    windowsHide: true,
  });
  const output = result.stdout ?? "";
  const pattern = new RegExp("^" + marker + " " + count + "\\/" + count + "(?:\\s|$)", "m");
  if (result.error || result.status !== 0 || !pattern.test(output)) {
    // Do not print raw response bodies or process output (which may contain sensitive context).
    console.error("BLOCKED_VOX_FINAL_GATE", name, "exit=" + (result.status ?? "error"), "expected=" + count);
    process.exit(1);
  }
  passed += count;
  console.log("PASS", name, count + "/" + count);
}
console.log("VOX_FINAL_INTERNAL_REGRESSION_PASS " + passed + "/" + passed, "mode=" + flag);
console.log("RELEASE_HOLD_MANAGED_MIGRATION_INDEPENDENT_REVIEW_AND_REAL_AAL2_REQUIRED");
