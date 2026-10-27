import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("full VOX HTTP source suite installs pinned TypeScript before tests in each affected CI workflow", () => {
  const names = [
    "vox-ab2-eod-source.yml", "vox-ab2-scoped-queue.yml", "vox-ab2-staff-review.yml",
    "vox-ab3-core-release-hold.yml", "vox-l5-independent-review-gates.yml",
    "vox-phaseB-native-source-pg17.yml", "vox-to08r-metrics.yml",
    "vox-to08t-internal-worker-cycle.yml", "vox-ui04-core-runtime-readonly.yml",
    "vox-ui04-six-tracks-release-hold.yml"
  ];
  for (const name of names) {
    const s = read(".github/workflows/" + name);
    const testAt = s.indexOf("node --test scripts/mvp/vox/*.test.mjs");
    const npmAt = s.indexOf("npm ci --ignore-scripts --no-audit --no-fund");
    assert.ok(testAt > 0 && npmAt > 0 && npmAt < testAt, name);
    assert.equal(s.split("node --test scripts/mvp/vox/*.test.mjs").length - 1, 1, name + " must keep full test suite");
  }
});

test("seven frozen VOX migrations remain quarantined with original canonical hashes", () => {
  const ledger = JSON.parse(read("supabase/staging-history/qf-post-g1-migration-ledger-20260929.json"));
  const rows = ledger.records.filter((r) => String(r.version).startsWith("20261014") && String(r.name).startsWith("vox_"));
  assert.equal(rows.length, 7);
  for (const row of rows) {
    assert.match(row.path, /^supabase\/migrations\/20261014\d{6}_vox.*\.sql$/);
    const quarantined="ops/vox/quarantined-migrations/legacy-20261014/"+row.path.split("/").at(-1);
    assert.equal(existsSync(resolve(root, "supabase/migrations/" + row.path.split("/").at(-1))), false);
    const normalized=read(quarantined).replace(/\r\n?/g, "\n");
    assert.equal(createHash("sha256").update(normalized).digest("hex"), row.canonicalSha256);
    assert.equal(row.exactVersionPresence?.staging, false);
    assert.equal(row.exactVersionPresence?.production, false);
  }
});
