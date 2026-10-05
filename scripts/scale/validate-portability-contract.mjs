#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const RUNTIME_ROOTS = ["app", "lib", "services", "worker"];
const RUNTIME_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
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
    else if (entry.isFile() && RUNTIME_EXTENSIONS.has(extname(entry.name))) files.push(child);
  }
  return files;
}

const runtimeFiles = [];
for (const dir of RUNTIME_ROOTS) runtimeFiles.push(...(await walk(join(ROOT, dir))));
runtimeFiles.push(join(ROOT, "middleware.ts"));

const approvedSupabaseImports = new Set([
  "lib/identity/sessionInvalidation.ts",
  "lib/supabase.ts",
  "lib/supabaseBrowser.ts",
  "middleware.ts",
  "services/clientOtpAuthService.ts",
  "services/vendorAuthService.ts",
  "services/vendorLoginActivationService.ts",
]);

const fsWritePattern =
  /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|renameSync|mkdirSync|rmSync|unlinkSync)\b/u;
const supabaseImportPattern = /from\s+["']@supabase\/(?:supabase-js|ssr)["']/u;
const ipv4Pattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu;
const allowedLoopbackIpv4 = new Set(["127.0.0.1", "0.0.0.0"]);
const hostPathPattern = /(?:["'`])\/(?:var\/www|srv)\//u;
const cloudSdkImportPattern =
  /(?:from\s+["'](?:@aws-sdk\/|aws-sdk|@kubernetes\/|kubernetes-client)|require\(["'](?:@aws-sdk\/|aws-sdk|@kubernetes\/|kubernetes-client))/u;

for (const absolute of runtimeFiles) {
  const file = relative(ROOT, absolute).replaceAll("\\", "/");
  const source = await readFile(absolute, "utf8");

  if (supabaseImportPattern.test(source) && !approvedSupabaseImports.has(file)) {
    fail(
      "DIRECT_SUPABASE_COUPLING",
      file,
      "Import Supabase only through the approved persistence/auth boundary or update the reviewed boundary explicitly.",
    );
  }

  if (fsWritePattern.test(source)) {
    fail(
      "DURABLE_LOCAL_WRITE",
      file,
      "Runtime source contains a filesystem write primitive. Durable business state must not depend on app-host disk.",
    );
  }

  for (const match of source.matchAll(ipv4Pattern)) {
    if (!allowedLoopbackIpv4.has(match[0])) {
      fail(
        "FIXED_INFRASTRUCTURE_IP",
        file,
        `Runtime source contains fixed IPv4 literal ${match[0]}; use externally supplied service configuration/DNS.`,
      );
    }
  }

  if (hostPathPattern.test(source)) {
    fail(
      "FIXED_HOST_PATH",
      file,
      "Runtime source contains a /var/www or /srv deployment path. Host paths belong at the deployment boundary.",
    );
  }

  if (cloudSdkImportPattern.test(source)) {
    fail(
      "CLOUD_SDK_IN_RUNTIME",
      file,
      "Cloud/Kubernetes SDK imported directly in runtime business code; isolate infrastructure capability at the boundary.",
    );
  }
}

const signalWorkers = [
  "worker/nativeAutomationWorker.ts",
  "worker/conversationTransportWorker.ts",
  "worker/aarohiAcquisitionWorker.ts",
];
for (const file of signalWorkers) {
  const source = await readFile(join(ROOT, file), "utf8");
  if (!/process\.once\(["']SIGTERM["']/u.test(source) || !/process\.once\(["']SIGINT["']/u.test(source)) {
    fail(
      "WORKER_SIGNAL_REGRESSION",
      file,
      "Long-running worker must handle both SIGTERM and SIGINT so containers can drain/stop safely.",
    );
  }
}

const productionDir = join(ROOT, "ops", "production");
const productionFiles = (await readdir(productionDir))
  .filter((name) => name.endsWith(".cjs"))
  .sort();
const knownLocalEnvDebt = new Set();
for (const name of productionFiles) {
  const source = await readFile(join(productionDir, name), "utf8");
  if (source.includes(".env.local") && !knownLocalEnvDebt.has(name)) {
    fail(
      "NEW_PRODUCTION_DOTENV_DISCOVERY",
      `ops/production/${name}`,
      "New production roles must not discover .env.local from the working directory.",
    );
  }
}
for (const name of knownLocalEnvDebt) {
  const source = await readFile(join(productionDir, name), "utf8");
  if (!source.includes(".env.local")) {
    console.log(
      `[portability] known debt cleared: ops/production/${name} no longer references .env.local; remove it from knownLocalEnvDebt.`,
    );
  }
}

if (failures.length > 0) {
  console.error("QuickFurno portability contract FAILED");
  for (const item of failures) {
    console.error(`- [${item.code}] ${item.file}: ${item.detail}`);
  }
  process.exit(1);
}

console.log("QuickFurno portability contract PASS");
console.log(
  JSON.stringify(
    {
      runtimeFilesChecked: runtimeFiles.length,
      approvedSupabaseBoundaryFiles: [...approvedSupabaseImports].sort(),
      signalWorkers,
      knownSingleHostDebt: [...knownLocalEnvDebt].sort(),
    },
    null,
    2,
  ),
);
