import fs from "node:fs/promises";
import ts from "typescript";
import { resolve as resolveBase } from "./tsResolveHooks.mjs";

export async function resolve(specifier, context, nextResolve) {
  return resolveBase(specifier, context, nextResolve);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".ts") || url.endsWith(".tsx")) {
    const source = await fs.readFile(new URL(url), "utf8");
    const result = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: new URL(url).pathname,
    });
    return { format: "module", source: result.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
