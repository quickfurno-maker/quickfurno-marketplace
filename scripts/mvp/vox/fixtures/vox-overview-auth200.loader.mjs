// ============================================================================
// VOX P0-1 — test-only ESM loader for the synthetic authenticated-200 harness.
//
// Scope: ONLY the auth200 harness registers this. It is NOT part of production,
// NOT part of any other test, and NOT the repo MVP loader. It exists so the harness
// can execute the REAL app/api/vox/v1/overview/route.ts and REAL
// services/vox/verifiedStaffBearer.ts in-process, unmodified, by:
//   1. resolving the "@/..." path alias to real repo files,
//   2. substituting "@supabase/supabase-js" / "@supabase/ssr" with the fixture
//      double (deterministic in-memory data; no network, no credentials),
//   3. stubbing the "server-only" marker package (absent in this environment),
//   4. transpiling .ts via the repo's pinned TypeScript, matching the repo loader.
//
// No production source is altered. The real bearer verification (JWT shape check,
// remote getUser, AAL2 claim check, admin + Superadmin checks) all run for real;
// only the network boundary is a fixture. This is a test double, NOT an auth bypass.
// ============================================================================
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Prefer the repo's pinned TypeScript (present in CI after `npm ci`, matching the
// repo MVP loader and the Node 20 production runtime). If it is not installed
// (e.g. a worktree without node_modules on a Node >=22 runtime), fall back to
// Node's native type-stripping. Either way the real .ts source executes.
let ts = null;
try { ts = (await import("typescript")).default; } catch { ts = null; }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", ".."); // scripts/mvp/vox/fixtures -> repo root
const FIXTURE_SUPABASE = pathToFileURL(path.join(HERE, "vox-overview-supabase-fixture.mjs")).href;

function aliasToFileUrl(specifier) {
  // "@/lib/supabase" -> <root>/lib/supabase ; add .ts if extensionless and present.
  const rel = specifier.slice(2);
  let abs = path.join(REPO_ROOT, rel);
  if (!path.extname(abs)) abs += ".ts";
  return pathToFileURL(abs).href;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@supabase/supabase-js" || specifier === "@supabase/ssr") {
    return { url: FIXTURE_SUPABASE, shortCircuit: true };
  }
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export default {};", shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    return { url: aliasToFileUrl(specifier), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (ts && url.startsWith("file:") && (url.endsWith(".ts") || url.endsWith(".tsx"))) {
    const source = await fs.readFile(new URL(url), "utf8");
    const out = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: new URL(url).pathname,
    });
    return { format: "module", source: out.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
