#!/usr/bin/env node
import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const OUT = join(ROOT, "docs/scale/phase21-supabase-callsite-manifest.json");
const roots = ["app", "lib", "services", "worker"];
const exts = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const rows = [];

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", "dist"].includes(e.name)) continue;
    const child = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(child)));
    else if (e.isFile() && exts.has(extname(e.name))) out.push(child);
  }
  return out;
}
const uniq = (v) => [...new Set(v)].sort();
const matches = (src, re) => uniq([...src.matchAll(re)].map((m) => m[1]));

for (const root of roots) {
  for (const abs of await walk(join(ROOT, root))) {
    const src = await readFile(abs, "utf8");
    const directImports = matches(
      src,
      /from\s+["'](@supabase\/(?:supabase-js|ssr))["']/gu,
    );
    const rpc = matches(src, /\.rpc\(\s*["']([^"']+)["']/gu);
    const tables = matches(src, /\.from\(\s*["']([^"']+)["']/gu);
    const storageBuckets = matches(
      src,
      /\.storage\s*\.from\(\s*["']([^"']+)["']/gu,
    );
    const auth = /\.auth\b/u.test(src);
    const realtime =
      /\.channel\s*\(/u.test(src) || /postgres_changes/u.test(src);
    if (
      directImports.length ||
      rpc.length ||
      tables.length ||
      storageBuckets.length ||
      auth ||
      realtime
    ) {
      rows.push({
        file: relative(ROOT, abs).replaceAll("\\", "/"),
        directImports,
        rpc,
        tables,
        storageBuckets,
        auth,
        realtime,
      });
    }
  }
}
rows.sort((a, b) => a.file.localeCompare(b.file));
const manifest = {
  schemaVersion: 1,
  generator: "scripts/scale/generate-phase21-supabase-callsite-manifest.mjs",
  classification: {
    rpc: "PORTABLE_SQL_OR_PERSISTENCE_ADAPTER",
    tableAccess: "PERSISTENCE_BOUNDARY",
    auth: "PHASE22_PROVIDER_ADAPTER",
    storage: "OBJECT_STORAGE_ADAPTER",
    realtime: "EVENT_GATEWAY_OR_POSTGRES_NOTIFICATION",
  },
  totals: {
    files: rows.length,
    rpcNames: uniq(rows.flatMap((r) => r.rpc)).length,
    tableNames: uniq(rows.flatMap((r) => r.tables)).length,
    storageBuckets: uniq(rows.flatMap((r) => r.storageBuckets)).length,
    authFiles: rows.filter((r) => r.auth).length,
    realtimeFiles: rows.filter((r) => r.realtime).length,
  },
  rpcNames: uniq(rows.flatMap((r) => r.rpc)),
  tableNames: uniq(rows.flatMap((r) => r.tables)),
  storageBuckets: uniq(rows.flatMap((r) => r.storageBuckets)),
  files: rows,
};
const text = JSON.stringify(manifest, null, 2) + "\n";
if (process.argv.includes("--check")) {
  const existing = await readFile(OUT, "utf8");
  if (existing !== text) {
    console.error(
      "Phase21 Supabase call-site manifest is stale. Run the generator.",
    );
    process.exit(1);
  }
  console.log("Phase21 Supabase call-site manifest PASS");
} else {
  await writeFile(OUT, text);
  console.log(
    "wrote " +
      relative(ROOT, OUT).replaceAll("\\", "/") +
      " files=" +
      manifest.totals.files +
      " rpc=" +
      manifest.totals.rpcNames +
      " tables=" +
      manifest.totals.tableNames,
  );
}
