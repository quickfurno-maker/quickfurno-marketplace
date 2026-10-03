// ============================================================================
// QF-MVP-00 — Safe TypeScript loader for repository validation on Node 20+.
//
// The production VPS runs Node 20, while newer CI runtimes can natively strip
// TypeScript. Keep validator behaviour identical by transpiling already-resolved
// .ts/.tsx modules with the repository's pinned TypeScript dependency.
//
// Resolution safety remains unchanged: only failed extensionless RELATIVE imports
// may fall back to ".ts"; bare specifiers and aliases are never rewritten.
// It NEVER maps the "@/..." path alias.
// ============================================================================
import fs from "node:fs/promises";
import ts from "typescript";

const RELATIVE = /^\.\.?\//;
const HAS_EXTENSION = /\.[a-z0-9]+$/i;
const FORBIDDEN = /(^|\/)(supabase|services)(\/|$)/i;

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const code = err && err.code;
    const isMissing =
      code === "ERR_MODULE_NOT_FOUND" ||
      code === "ERR_UNSUPPORTED_DIR_IMPORT";

    if (isMissing && RELATIVE.test(specifier) && !HAS_EXTENSION.test(specifier)) {
      if (FORBIDDEN.test(specifier)) {
        throw new Error(
          `[qf-mvp-loader] Refusing to resolve "${specifier}" — the MVP runner must ` +
            "not import Supabase/services modules through fallback resolution.",
        );
      }
      return await nextResolve(`${specifier}.ts`, context);
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (
    url.startsWith("file:") &&
    (url.endsWith(".ts") || url.endsWith(".tsx"))
  ) {
    const source = await fs.readFile(new URL(url), "utf8");
    const result = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: new URL(url).pathname,
    });

    return {
      format: "module",
      source: result.outputText,
      shortCircuit: true,
    };
  }

  return nextLoad(url, context);
}
