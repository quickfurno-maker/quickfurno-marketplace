#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dir = join(ROOT, "supabase/migrations");
const files = (await readdir(dir)).filter((x) => x.endsWith(".sql")).sort();
const providerPattern =
  /\b(auth\.[A-Za-z_][A-Za-z0-9_]*|storage\.[A-Za-z_][A-Za-z0-9_]*|supabase_realtime|vault\.[A-Za-z_][A-Za-z0-9_]*|realtime\.[A-Za-z_][A-Za-z0-9_]*|extensions\.[A-Za-z_][A-Za-z0-9_]*)\b/g;
const allowed = [
  /^auth\.(users|uid|admin|signInWithOtp|signUp|updateUser)$/,
  /^storage\.(buckets|objects)$/,
  /^supabase_realtime$/,
  /^extensions\.(geography|geometry|GeometryType|ST_[A-Za-z0-9_]+)$/,
];
const seen = new Map();
const unknown = [];
for (const file of files) {
  const source = await readFile(join(dir, file), "utf8");
  for (const match of source.matchAll(providerPattern)) {
    const token = match[1];
    if (!seen.has(token)) seen.set(token, new Set());
    seen.get(token).add(file);
    if (!allowed.some((r) => r.test(token))) unknown.push({ file, token });
  }
}
assert.equal(
  unknown.length,
  0,
  "unclassified provider tokens: " + JSON.stringify(unknown.slice(0, 20)),
);
assert.ok(seen.has("auth.users"));
assert.ok(seen.has("auth.uid"));
assert.ok(seen.has("storage.buckets"));
assert.ok(seen.has("storage.objects"));
assert.ok(seen.has("supabase_realtime"));
assert.ok([...seen.keys()].some((x) => x.startsWith("extensions.ST_")));
assert.equal(
  [...seen.keys()].some((x) => x.startsWith("vault.")),
  false,
);

console.log("QuickFurno Phase21 SQL portability audit PASS");
console.log(
  JSON.stringify(
    {
      migrationFiles: files.length,
      classifiedProviderTokens: [...seen.keys()].sort(),
      dispositions: {
        auth: "PHASE22_COMPATIBILITY_BOUNDARY",
        storage: "OBJECT_STORAGE_ADAPTER",
        supabase_realtime: "EVENT_GATEWAY_REPLACEMENT",
        extensions: "POSTGIS_COMPATIBILITY_SCHEMA",
        vault: "NO_REPOSITORY_MIGRATION_REFERENCE",
      },
    },
    null,
    2,
  ),
);
