#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const image = process.env.PHASE17_POSTGRES_IMAGE || "postgres:16.4-bookworm";
const suffix = (Date.now().toString(36) + process.pid.toString(36)).toLowerCase();
const makeName = (prefix) => "qf-p17-" + prefix + "-" + suffix;
const names = {
  network: makeName("net"),
  primary: makeName("primary"),
  restore: makeName("restore"),
  primaryData: makeName("primary-data"),
  archive: makeName("archive"),
  backup: makeName("backup"),
  restoreData: makeName("restore-data"),
};
const db = "phase17";
const password = "phase17-ci-only-password";

function run(args, inherit = false) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
}
function out(args) {
  return String(run(args)).trim();
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitReady(container, database = db) {
  for (let i = 0; i < 90; i += 1) {
    try {
      const ready = out([
        "exec", container, "psql", "-U", "postgres", "-d", database,
        "-Atqc", "select 1",
      ]);
      if (ready === "1") return;
    } catch {}
    await sleep(500);
  }
  throw new Error("PHASE17_POSTGRES_NOT_READY:" + container + ":" + database);
}
function psql(container, sql, database = db) {
  return out(["exec", container, "psql", "-U", "postgres", "-d", database, "-Atqc", sql]);
}

run(["pull", image], true);
run(["network", "create", names.network]);
for (const volume of [names.primaryData, names.archive, names.backup, names.restoreData]) {
  run(["volume", "create", volume]);
}

run([
  "run", "--rm", "--entrypoint", "bash",
  "-v", names.archive + ":/archive",
  "-v", names.backup + ":/backup",
  image, "-lc", "chown postgres:postgres /archive /backup",
]);

run([
  "run", "-d", "--name", names.primary, "--network", names.network,
  "-e", "POSTGRES_PASSWORD=" + password,
  "-e", "POSTGRES_DB=" + db,
  "-v", names.primaryData + ":/var/lib/postgresql/data",
  "-v", names.archive + ":/archive",
  "-v", names.backup + ":/backup",
  image,
  "-c", "wal_level=replica",
  "-c", "archive_mode=on",
  "-c", "archive_timeout=1s",
  "-c", "max_wal_senders=5",
  "-c", "archive_command=test ! -f /archive/%f && cp %p /archive/%f",
]);
await waitReady(names.primary);

psql(
  names.primary,
  "create table dr_events(id integer primary key,label text not null,committed_at timestamptz not null default clock_timestamp()); insert into dr_events(id,label) values (1,'baseline');",
);

run([
  "exec", "-e", "PGPASSWORD=" + password, names.primary,
  "pg_basebackup", "-h", "127.0.0.1", "-U", "postgres",
  "-D", "/backup/base", "-Fp", "-Xs", "-P",
], true);

psql(names.primary, "insert into dr_events(id,label) values (2,'survives_target');");
const targetTime = psql(
  names.primary,
  "select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.MS') || '+00';",
);
await sleep(1400);
psql(names.primary, "insert into dr_events(id,label) values (3,'must_not_survive');");

run([
  "exec", names.primary, "pg_dump", "-U", "postgres", "-d", db,
  "-Fc", "-f", "/backup/logical.dump",
]);

psql(names.primary, "checkpoint; select pg_switch_wal();");
await sleep(2200);
run(["stop", "-t", "1", names.primary]);

const recoveryStart = process.hrtime.bigint();

run([
  "run", "--rm", "--entrypoint", "bash",
  "-v", names.backup + ":/backup:ro",
  "-v", names.restoreData + ":/restore",
  image, "-lc",
  "cp -a /backup/base/. /restore/ && chown -R postgres:postgres /restore",
]);

run([
  "run", "--rm", "--entrypoint", "bash",
  "-e", "TARGET_TIME=" + targetTime,
  "-v", names.restoreData + ":/restore",
  image, "-lc",
  "printf \"\\nrestore_command = 'cp /archive/%%f %%p'\\nrecovery_target_time = '%s'\\nrecovery_target_action = 'promote'\\n\" \"$TARGET_TIME\" >> /restore/postgresql.auto.conf && touch /restore/recovery.signal && chown -R postgres:postgres /restore",
]);

run([
  "run", "-d", "--name", names.restore, "--network", names.network,
  "-e", "POSTGRES_PASSWORD=" + password,
  "-v", names.restoreData + ":/var/lib/postgresql/data",
  "-v", names.archive + ":/archive:ro",
  "-v", names.backup + ":/backup:ro",
  image,
]);
await waitReady(names.restore);

let promoted = false;
for (let i = 0; i < 90; i += 1) {
  if (psql(names.restore, "select pg_is_in_recovery();") === "f") {
    promoted = true;
    break;
  }
  await sleep(500);
}
if (!promoted) throw new Error("PHASE17_PITR_DID_NOT_PROMOTE");
const pitrRtoMs = Number(process.hrtime.bigint() - recoveryStart) / 1e6;

const recoveredLabels = psql(
  names.restore,
  "select coalesce(string_agg(label,',' order by id),'') from dr_events;",
);
if (recoveredLabels !== "baseline,survives_target") {
  throw new Error("PHASE17_PITR_CONTENT_MISMATCH:" + recoveredLabels);
}

const logicalStart = process.hrtime.bigint();
psql(names.restore, "create database phase17_logical;", "postgres");
run([
  "exec", names.restore, "pg_restore", "-U", "postgres",
  "-d", "phase17_logical", "/backup/logical.dump",
]);
const logicalCount = psql(names.restore, "select count(*) from dr_events;", "phase17_logical");
const logicalRtoMs = Number(process.hrtime.bigint() - logicalStart) / 1e6;
if (logicalCount !== "3") throw new Error("PHASE17_LOGICAL_RESTORE_INCOMPLETE");

const archiveCount = Number(out([
  "run", "--rm", "--entrypoint", "bash",
  "-v", names.archive + ":/archive:ro",
  image, "-lc", "find /archive -type f | wc -l",
]));
if (!Number.isFinite(archiveCount) || archiveCount < 1) {
  throw new Error("PHASE17_WAL_ARCHIVE_EMPTY");
}

console.log(JSON.stringify({
  event: "PHASE17_POSTGRES_PITR_CERTIFIED",
  contract: "qfj.dr.phase17.v1",
  postgresImage: image,
  recoveryTarget: targetTime,
  archivedWalFiles: archiveCount,
  actualRpoSeconds: 0,
  pitrRtoMs: Math.round(pitrRtoMs * 100) / 100,
  logicalRestoreRtoMs: Math.round(logicalRtoMs * 100) / 100,
  preTargetCommitsRecovered: 2,
  postTargetCommitsRecovered: 0,
  pitrBoundary: "PASS",
  logicalBackupRestore: "PASS"
}));
