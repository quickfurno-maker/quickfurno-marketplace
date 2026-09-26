import { CURRENT_MIGRATION_TREE } from "./currentMigrationTruth.mjs";

let n = 0;
for (const result of CURRENT_MIGRATION_TREE.checks) {
  n += 1;
  console.log(`${result.ok ? "PASS" : "FAIL"} ${String(n).padStart(2, "0")} ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
}
if (!CURRENT_MIGRATION_TREE.ok) {
  console.error("QF-PHASE1-MIGRATIONS: FAIL");
  process.exit(1);
}
console.log(`QF-PHASE1-MIGRATIONS: ${n}/${n} PASS — canonical=${CURRENT_MIGRATION_TREE.canonicalCount} excluded=${CURRENT_MIGRATION_TREE.excludedCount} total=${CURRENT_MIGRATION_TREE.totalCount}`);
