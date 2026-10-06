#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const CLI_VERSION = "2.119.0";
const dbUrl = process.env.QF_PHASE21_SOURCE_DB_URL;
if (!dbUrl) {
  console.error(
    "QF_PHASE21_SOURCE_DB_URL is required. Production credentials are never stored in Git.",
  );
  process.exit(2);
}
const out = resolve(process.argv[2] || "phase21-private-export");
await mkdir(out, { recursive: true });

const artifacts = [
  ["roles.sql", ["db", "dump", "--db-url", dbUrl, "--role-only"]],
  ["schema.sql", ["db", "dump", "--db-url", dbUrl]],
  ["data.sql", ["db", "dump", "--db-url", dbUrl, "--data-only", "--use-copy"]],
];

for (const [name, args] of artifacts) {
  const file = join(out, name);
  const r = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["--yes", "supabase@" + CLI_VERSION, ...args, "--file", file],
    { stdio: "inherit", env: process.env },
  );
  if (r.status !== 0) process.exit(r.status || 1);
}

const manifest = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  tool: "supabase@" + CLI_VERSION,
  artifacts: {},
};
for (const [name] of artifacts) {
  const bytes = await readFile(join(out, name));
  manifest.artifacts[name] = {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
await writeFile(
  join(out, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  "Phase21 private database export complete. Keep this directory outside Git.",
);
