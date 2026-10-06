#!/usr/bin/env node
import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const OUT = join(ROOT, "docs/scale/phase22-auth-callsite-manifest.json");
const roots = ["app", "lib", "services"];
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const operations = [
  ["getUser", /\.auth\.getUser\s*\(/gu],
  ["getSession", /\.auth\.getSession\s*\(/gu],
  ["signInWithPassword", /\.auth\.signInWithPassword\s*\(/gu],
  ["signInWithOtp", /\.auth\.signInWithOtp\s*\(/gu],
  ["verifyOtp", /\.auth\.verifyOtp\s*\(/gu],
  ["signOut", /\.auth\.signOut\s*\(/gu],
  ["updateUser", /\.auth\.updateUser\s*\(/gu],
  ["resetPasswordForEmail", /\.auth\.resetPasswordForEmail\s*\(/gu],
  ["admin", /\.auth\.admin\./gu],
];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", "dist"].includes(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (entry.isFile() && extensions.has(extname(entry.name))) out.push(p);
  }
  return out;
}
const files = [];
for (const root of roots) {
  for (const abs of await walk(join(ROOT, root))) {
    const source = await readFile(abs, "utf8");
    const found = {};
    for (const [name, re] of operations) {
      const count = [...source.matchAll(re)].length;
      if (count) found[name] = count;
    }
    const usesAppMetadata = /\.app_metadata\b/u.test(source);
    const usesUserMetadata = /\.user_metadata\b/u.test(source);
    if (Object.keys(found).length || usesAppMetadata || usesUserMetadata) {
      files.push({
        file: relative(ROOT, abs).replaceAll("\\", "/"),
        operations: found,
        usesAppMetadata,
        usesUserMetadata,
      });
    }
  }
}
for (const extra of ["middleware.ts"]) {
  const abs = join(ROOT, extra);
  const source = await readFile(abs, "utf8").catch(() => null);
  if (!source) continue;
  const found = {};
  for (const [name, re] of operations) {
    const count = [...source.matchAll(re)].length;
    if (count) found[name] = count;
  }
  if (Object.keys(found).length) {
    files.push({
      file: extra,
      operations: found,
      usesAppMetadata: /\.app_metadata\b/u.test(source),
      usesUserMetadata: /\.user_metadata\b/u.test(source),
    });
  }
}
files.sort((a, b) => a.file.localeCompare(b.file));
const totals = {};
for (const [name] of operations)
  totals[name] = files.reduce((n, f) => n + (f.operations[name] || 0), 0);
const manifest = {
  schemaVersion: 1,
  generator: "scripts/scale/generate-phase22-auth-callsite-manifest.mjs",
  classification: {
    getUser: "CURRENT_PROVIDER_ADAPTER_OR_LEGACY_COEXISTENCE",
    getSession: "SESSION_TRANSPORT_ONLY_NEVER_AUTHORIZATION",
    signInWithPassword: "CREDENTIAL_PROVIDER_ADAPTER",
    signInWithOtp: "CREDENTIAL_PROVIDER_ADAPTER",
    verifyOtp: "CREDENTIAL_PROVIDER_ADAPTER",
    signOut: "SESSION_INVALIDATION_PROVIDER_ADAPTER",
    updateUser: "CREDENTIAL_RECOVERY_PROVIDER_ADAPTER",
    resetPasswordForEmail: "CREDENTIAL_RECOVERY_PROVIDER_ADAPTER",
    admin: "SERVER_SIDE_PROVIDER_PROVISIONING_ONLY",
    appMetadata:
      "LEGACY_TRUSTED_PROVIDER_METADATA_MUST_NOT_BE_NEW_CORE_AUTHORITY",
    userMetadata: "NEVER_AUTHORIZATION",
  },
  totals,
  files,
};
const text = JSON.stringify(manifest, null, 2) + "\n";
if (process.argv.includes("--check")) {
  const existing = await readFile(OUT, "utf8");
  if (existing !== text) {
    console.error("Phase22 auth callsite manifest is stale.");
    process.exit(1);
  }
  console.log("Phase22 auth callsite manifest PASS");
} else {
  await writeFile(OUT, text);
  console.log(
    "wrote " +
      relative(ROOT, OUT).replaceAll("\\", "/") +
      " runtimeFiles=" +
      files.length +
      " getUser=" +
      totals.getUser,
  );
}
