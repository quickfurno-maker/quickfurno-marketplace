// ============================================================================
// VOX P0-3 — test-only ESM loader for the REAL local-GoTrue auth harness.
//
// Unlike fixtures/vox-overview-auth200.loader.mjs (which substitutes
// @supabase/supabase-js/@supabase/ssr with an in-memory fixture), this loader
// changes NOTHING about the Supabase network boundary: the real npm packages
// run unmodified, making genuine HTTP calls to the disposable local GoTrue +
// PostgREST stack the harness boots. It only:
//   1. resolves the "@/..." path alias to the real repo files,
//   2. stubs the "server-only" marker package (absent outside Next.js),
//   3. transpiles .ts via the repo's pinned TypeScript, matching the repo loader.
//
// No production source is altered and no auth boundary is bypassed.
// ============================================================================
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let ts = null;
try { ts = (await import("typescript")).default; } catch { ts = null; }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", ".."); // scripts/mvp/vox/fixtures -> repo root

function aliasToFileUrl(specifier) {
  const rel = specifier.slice(2);
  let abs = path.join(REPO_ROOT, rel);
  if (!path.extname(abs)) abs += ".ts";
  return pathToFileURL(abs).href;
}

export async function resolve(specifier, context, nextResolve) {
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
