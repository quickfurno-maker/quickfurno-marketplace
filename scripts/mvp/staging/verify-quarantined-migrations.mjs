// Fail-closed offline migration inventory: 162 deployable + seven SHA256-pinned quarantined SQL files.
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EXPECTED_LIVE_MIGRATION_COUNT } from "./live-migration-ledger.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const quarantine = join(root, "ops", "vox", "quarantined-migrations", "legacy-20261014");
const deployable = join(root, "supabase", "migrations");
const hashes = Object.freeze({
  "20261014010000_vox_v1_scoped_staff_authority.sql": "a5d0da20590b178b5e0aaff5045fe9957e367f9396baea4e86222bcc7d076c4c",
  "20261014020000_vox_v1_staff_review_workflow.sql": "4f7bb561c4aa7203e11a69672017fe97447a95a6c59ada5c8cfe24ffdd1ad166",
  "20261014030000_vox_v1_approved_grant_finalizer.sql": "1a556c638b9dfe038bdb9cf951e4ee4689c362e5632789c1b97edcd86439184a",
  "20261014040000_vox_v1_staff_emergency_revocation.sql": "fb68eec0f7a7ee2ea097461522aba7fbe3d239c112fc3ccffedbfbb68659934e",
  "20261014050000_vox_v1_team_leader_review_policy.sql": "b1423c1135891610ee6e55709fc088598678f8ee59a58fd9d80f732f481fe7e9",
  "20261014060000_vox_operational_intent_review.sql": "6484c66d9eec6ca699414ec97fc50962e22b685949d280ce3c2d2aeb21fa8dfb",
  "20261014070000_vox_approved_followup_executor.sql": "454fb0c07ca7589962eddaffa0001a9a2a7562a3304d70da8e091a0499918f01"
});
export function verifiedMigrationInventory(deployableFiles) {
  const files = [...deployableFiles].filter((s) => s.endsWith(".sql")).sort();
  const q = readdirSync(quarantine).filter((s) => s.endsWith(".sql")).sort();
  const approved = Object.keys(hashes).sort();
  if (JSON.stringify(q) !== JSON.stringify(approved)) return false;
  if (files.length + q.length !== EXPECTED_LIVE_MIGRATION_COUNT) return false;
  if (files.length !== readdirSync(deployable).filter((s) => s.endsWith(".sql")).length) return false;
  if (new Set(files).size !== files.length) return false;
  return q.every((name) => !files.includes(name) &&
    createHash("sha256").update(readFileSync(join(quarantine, name), "utf8").replace(/\r\n?/g, "\n")).digest("hex") === hashes[name]);
}
