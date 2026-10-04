#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const RUNTIME_ROOTS = ["app", "lib", "services", "worker"];
const EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const STORAGE_ADAPTER = "lib/storage/supabaseObjectStorage.ts";
const VENDOR_MEDIA_ROUTE = "app/api/vendor/media/route.ts";
const failures = [];

function fail(code, file, detail) {
  failures.push({ code, file: file.replaceAll("\\", "/"), detail });
}

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (entry.isFile() && EXTENSIONS.has(extname(entry.name))) files.push(child);
  }
  return files;
}

const runtimeFiles = [];
for (const root of RUNTIME_ROOTS) runtimeFiles.push(...(await walk(join(ROOT, root))));

const durableWritePattern =
  /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|rename|renameSync|copyFile|copyFileSync|unlink|unlinkSync|rm|rmSync)\s*\(/u;
const storageSdkPattern = /\.storage\s*\.\s*from\s*\(/u;

for (const absolute of runtimeFiles) {
  const file = relative(ROOT, absolute).replaceAll("\\", "/");
  const source = await readFile(absolute, "utf8");

  if (durableWritePattern.test(source)) {
    fail(
      "RUNTIME_LOCAL_WRITE",
      file,
      "Runtime code contains a filesystem write primitive. Durable application state must live outside the container.",
    );
  }

  if (storageSdkPattern.test(source) && file !== STORAGE_ADAPTER) {
    fail(
      "DIRECT_OBJECT_STORAGE_PROVIDER",
      file,
      "Provider SDK object-storage access must stay inside the reviewed storage adapter.",
    );
  }
}

const route = await readFile(join(ROOT, VENDOR_MEDIA_ROUTE), "utf8");
const adapter = await readFile(join(ROOT, STORAGE_ADAPTER), "utf8");
const port = await readFile(join(ROOT, "lib/storage/objectStorage.ts"), "utf8");
const compose = await readFile(join(ROOT, "ops/container/compose.production.yml"), "utf8");

if (!route.includes('createSupabaseObjectStorage({ bucket: BUCKET })')) {
  fail("OBJECT_STORAGE_BOUNDARY_MISSING", VENDOR_MEDIA_ROUTE, "Vendor media must use the object-storage capability boundary.");
}
if (route.includes("adminClient().storage") || route.includes(".storage.from(")) {
  fail("VENDOR_MEDIA_PROVIDER_LEAK", VENDOR_MEDIA_ROUTE, "Vendor media route must not know provider storage SDK details.");
}
if (!route.includes("mediaStorage.keyFromPublicUrl(url)")) {
  fail("PROVIDER_URL_PARSING_LEAK", VENDOR_MEDIA_ROUTE, "Provider public-URL parsing must stay inside the adapter.");
}
if (!route.includes('"STORAGE_UNAVAILABLE"')) {
  fail("STORAGE_LIMIT_FAIL_OPEN", VENDOR_MEDIA_ROUTE, "Upload quota lookup failures must fail closed.");
}
if (!adapter.includes("adminClient().storage.from(bucket)")) {
  fail("SUPABASE_ADAPTER_MISSING", STORAGE_ADAPTER, "Supabase implementation must be isolated in the reviewed adapter.");
}
for (const method of ["list(", "put(", "publicUrl(", "keyFromPublicUrl(", "remove("]) {
  if (!port.includes(method)) {
    fail("OBJECT_STORAGE_PORT_INCOMPLETE", "lib/storage/objectStorage.ts", `ObjectStorage port is missing ${method}`);
  }
}
if (/\n\s*volumes\s*:/u.test(compose)) {
  fail("BUSINESS_HOST_VOLUME", "ops/container/compose.production.yml", "QuickFurno application containers must not depend on host volumes for business state.");
}

if (failures.length) {
  console.error("QuickFurno stateless runtime contract FAILED");
  for (const item of failures) console.error(`- [${item.code}] ${item.file}: ${item.detail}`);
  process.exit(1);
}

console.log("QuickFurno Phase 05 stateless runtime contract PASS");
console.log(
  JSON.stringify(
    {
      runtimeFilesChecked: runtimeFiles.length,
      objectStoragePort: "lib/storage/objectStorage.ts",
      providerAdapter: STORAGE_ADAPTER,
      vendorMediaRoute: VENDOR_MEDIA_ROUTE,
      durableRuntimeLocalWrites: 0,
      businessHostVolumes: 0,
    },
    null,
    2,
  ),
);
