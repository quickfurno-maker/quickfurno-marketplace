// ============================================================================
// QuickFurno — scripts/mvp/local/qfLocalIntegrationLoader.mjs
//
// A minimal ESM resolve hook for the QF-MVP-80.15C LOCAL integration harness.
//
// WHY NOT scripts/mvp/loader/register.mjs. That loader deliberately REFUSES to
// resolve Supabase and services modules, because the offline MVP runner must
// never perform I/O. That guard is correct and is not weakened here: this file
// is a separate, local-only loader used by exactly one integration harness whose
// entire purpose is to exercise the REAL service against a LOCAL container. The
// offline runner keeps its refusal.
//
// It does two things and nothing else:
//   • resolves the repo's extensionless relative imports ("../lib/supabase") and
//     the "@/..." alias to real .ts/.tsx files;
//   • leaves everything else to Node, which strips TS types natively.
// ============================================================================
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolvePath(fileURLToPath(import.meta.url), "../../../..");
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];

function firstExisting(basePath) {
  if (existsSync(basePath) && !basePath.endsWith("/")) {
    // A bare directory is not a module; only accept a real file here.
    if (!/[\\/]$/.test(basePath) && /\.[a-z]+$/i.test(basePath)) return basePath;
  }
  for (const ext of EXTENSIONS) {
    const candidate = basePath + ext;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // next/headers only exists inside the Next runtime. The stub RESOLVES but
  // THROWS when called, so a genuine request-scoped dependency would surface as
  // a loud failure rather than a silent no-op.
  if (specifier === "next/headers") {
    return {
      url: pathToFileURL(resolvePath(ROOT, "scripts/mvp/local/nextHeadersStub.mjs")).href,
      shortCircuit: true,
    };
  }

  // "@/lib/foo" -> <repo root>/lib/foo.ts
  if (specifier.startsWith("@/")) {
    const found = firstExisting(resolvePath(ROOT, specifier.slice(2)));
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }

  // "../lib/supabase" -> sibling .ts, resolved against the importing module.
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    const found = firstExisting(base);
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
