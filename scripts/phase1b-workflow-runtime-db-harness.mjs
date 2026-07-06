import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databaseUrl = process.env.QF_WORKFLOW_TEST_DATABASE_URL;

if (!databaseUrl) {
  console.log("RUNTIME DB CONCURRENCY TESTS: SKIPPED - NO SAFE TEST DB CONFIGURED");
  process.exit(0);
}

let parsed;
try {
  parsed = new URL(databaseUrl);
} catch {
  console.log("RUNTIME DB CONCURRENCY TESTS: SKIPPED - QF_WORKFLOW_TEST_DATABASE_URL is not a valid URL");
  process.exit(0);
}

const host = parsed.hostname.toLowerCase();
const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();
const allowRemote = process.env.QF_WORKFLOW_TEST_ALLOW_REMOTE === "true";
const blocked = /quickfurno|prod|production|live/.test(host) || /quickfurno|prod|production|live/.test(dbName);

if (blocked) {
  console.log("RUNTIME DB CONCURRENCY TESTS: SKIPPED - database URL looks like production/live");
  process.exit(0);
}

if (!["localhost", "127.0.0.1", "::1"].includes(host) && !allowRemote) {
  console.log("RUNTIME DB CONCURRENCY TESTS: SKIPPED - remote DB requires QF_WORKFLOW_TEST_ALLOW_REMOTE=true");
  process.exit(0);
}

const psqlCheck = spawnSync("psql", ["--version"], { shell: true, encoding: "utf8" });
if (psqlCheck.status !== 0) {
  console.log("RUNTIME DB CONCURRENCY TESTS: SKIPPED - psql is not available");
  process.exit(0);
}

const sql = `
begin;
select 'phase1b runtime harness requires Phase 1A/1B migrations already applied' as note;
rollback;
`;

const dir = mkdtempSync(join(tmpdir(), "qf-phase1b-runtime-"));
const sqlPath = join(dir, "runtime-harness.sql");
writeFileSync(sqlPath, sql, "utf8");

try {
  execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", sqlPath], { stdio: "inherit", shell: true });
  console.log("DB CONNECTION SMOKE: PASSED");
  console.log("RUNTIME DB CONCURRENCY TESTS: NOT RUN - full ownership and concurrency scenarios require an applied safe test database harness.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
