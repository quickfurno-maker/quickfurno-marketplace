// ============================================================================
// QF-MVP-80.17A-R1 — narrow PRODUCTION-OPERATOR loader.
//
// WHY THIS EXISTS, AND WHY IT IS NOT THE MVP LOADER
//   scripts/mvp/loader/register.mjs + tsResolveHooks.mjs are the OFFLINE test
//   loaders. Their refusal to resolve "@/..." and anything under supabase/ or
//   services/ is exactly what keeps every MVP suite database- and network-free,
//   so they are NOT touched, NOT weakened and NOT reused here.
//
//   This file is the opposite tool for one job: letting the already-reviewed,
//   already-deployed QF-MVP-80.17A reconciliation service be invoked ONCE from a
//   CLI process. It is loaded only by
//   scripts/mvp/communication/reconcile-qf-mvp-80-17a-r1-once.mjs, and only in
//   its --preflight-readonly and --execute modes.
//
// THREE KNOWN BLOCKERS IT SOLVES (and nothing else)
//   1. Production runs Node 20, which cannot load `.ts` at all. A CommonJS
//      require hook transpiles with the repository's own installed TypeScript.
//   2. Node does not honour the "@/*" tsconfig alias.
//   3. @supabase/supabase-js builds Realtime eagerly in createClient() and
//      throws on Node < 22 without a global WebSocket. Next installs that global
//      from its own bundled ws before app code runs; a bare CLI must too. No new
//      dependency is added and nothing is installed on the server.
//
// EXACT ALLOWLIST — the load-bearing containment
//   An earlier revision used a DENYLIST of send-capable modules plus a generic
//   "@/..." mapper. Two things were wrong with that. It was broader than this
//   operator's authority: every repository file not explicitly named as
//   dangerous was reachable, and a future import inside an allowed module would
//   silently gain a new local capability. And it was WRONG — it denied the whole
//   `communication/providers/` directory, which meant it refused its own
//   required dependency, the PURE `whatsappTemplateBinding`, that the canonical
//   `leadAssignmentDispatchContract` reaches through `businessTemplateVariables`.
//
//   The boundary is therefore an exact, file-by-file allowlist of the real
//   runtime graph. Node built-ins and node_modules packages resolve normally;
//   ANY other file inside this repository is refused, including one a future
//   edit starts importing. Such an import fails closed until the allowlist is
//   explicitly reviewed. A pure binding module being permitted is not the same
//   as permitting its directory: every send-capable provider adapter beside it
//   remains unreachable.
//
// Installation happens only inside loadR1Runtime(). Requiring this file is inert,
// which is what lets the offline validator execute the predicates below.
// ============================================================================

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const Module = require("node:module");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const NODE_MODULES = `${path.join(REPO_ROOT, "node_modules")}${path.sep}`;

/**
 * The EXACT repository files the real runtime graph needs, each with the reason
 * it is here. Nothing resolves from this repository unless it is on this list.
 *
 *   services/leadAssignmentResultService.ts       the ONE write authority
 *   lib/supabase.ts                               its service-role client factory
 *   lib/communication/leadAssignmentResultContract.ts   the 80.17A pure decision
 *   lib/communication/leadAssignmentDispatchContract.ts lane identity + idempotency key
 *   lib/communication/campaignResultContract.ts    the shared projection authority
 *   lib/communication/types.ts                     RECIPIENT_REFERENCE_DESTINATION (a value)
 *   lib/communication/businessTemplateVariables.ts required by the dispatch contract
 *   lib/communication/providers/whatsappTemplateBinding.ts  PURE; required by the above
 *   lib/communication/inboundConsentCommandInput.ts the persisted Meta adapter key
 */
const ALLOWED_R1_REPO_MODULES = Object.freeze([
  "services/leadAssignmentResultService.ts",
  "lib/supabase.ts",
  "lib/communication/leadAssignmentResultContract.ts",
  "lib/communication/leadAssignmentDispatchContract.ts",
  "lib/communication/campaignResultContract.ts",
  "lib/communication/types.ts",
  "lib/communication/businessTemplateVariables.ts",
  "lib/communication/providers/whatsappTemplateBinding.ts",
  "lib/communication/inboundConsentCommandInput.ts",
]);

const ALLOWED_SET = new Set(ALLOWED_R1_REPO_MODULES);

/** Closed verdict vocabulary for one resolved path. */
const R1Resolution = Object.freeze({
  ALLOW_EXTERNAL: "ALLOW_EXTERNAL",
  ALLOW_ALLOWLISTED: "ALLOW_ALLOWLISTED",
  REFUSE_NOT_ALLOWLISTED: "REFUSE_NOT_ALLOWLISTED",
});

/**
 * Repo-relative POSIX path, or null when the file is not repository-local
 * source (a Node built-in, or anything under node_modules).
 */
function r1NormalizeRepoRelative(filename, repoRoot) {
  if (typeof filename !== "string" || filename === "") return null;
  if (!path.isAbsolute(filename)) return null;
  const root = repoRoot || REPO_ROOT;
  const nodeModules = `${path.join(root, "node_modules")}${path.sep}`;
  if (filename.startsWith(nodeModules)) return null;
  const rel = path.relative(root, filename);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/**
 * The single decision every resolution passes through. Built-ins and package
 * dependencies are external and resolve normally; repository source resolves
 * ONLY when it is on the exact allowlist.
 */
function r1ResolutionVerdict(filename, repoRoot) {
  const rel = r1NormalizeRepoRelative(filename, repoRoot);
  if (rel === null) return R1Resolution.ALLOW_EXTERNAL;
  return ALLOWED_SET.has(rel) ? R1Resolution.ALLOW_ALLOWLISTED : R1Resolution.REFUSE_NOT_ALLOWLISTED;
}

function refusal(filename) {
  const rel = r1NormalizeRepoRelative(filename, REPO_ROOT) ?? filename;
  return new Error(
    `[qf-mvp-80-17a-r1] Refusing to load "${rel}": it is not on the R1 runtime allowlist. ` +
      `Adding a repository module to this operator's reach requires an explicit review.`
  );
}

/**
 * Resolves the "@/x" tsconfig alias, but ONLY onto an allowlisted file. There is
 * deliberately no general-purpose alias mapper: "@/services/leadService" and
 * every other unlisted repository path refuses here rather than resolving and
 * being caught later.
 */
function resolveAllowedR1Alias(request) {
  if (typeof request !== "string" || !request.startsWith("@/")) return null;
  const base = path.join(REPO_ROOT, request.slice(2));
  for (const candidate of [base, `${base}.ts`, path.join(base, "index.ts")]) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
    if (r1ResolutionVerdict(candidate, REPO_ROOT) === R1Resolution.REFUSE_NOT_ALLOWLISTED) {
      throw refusal(candidate);
    }
    return candidate;
  }
  throw refusal(base);
}

let installed = false;

function installRuntimeHooks() {
  if (installed) return;
  installed = true;

  // 1. Node 20 has no global WebSocket; supabase-js throws at construction.
  if (typeof globalThis.WebSocket !== "function") {
    const bundled = require(path.join(REPO_ROOT, "node_modules", "next", "dist", "compiled", "ws"));
    globalThis.WebSocket = bundled.WebSocket || bundled;
  }

  // 2. Transpile `.ts` with the repository's own TypeScript. transpileModule is
  //    syntax-complete, so parameter properties and enums load fine on Node 20.
  const ts = require(path.join(REPO_ROOT, "node_modules", "typescript"));
  Module._extensions[".ts"] = function compileTypeScript(module, filename) {
    if (r1ResolutionVerdict(filename, REPO_ROOT) === R1Resolution.REFUSE_NOT_ALLOWLISTED) {
      throw refusal(filename);
    }
    const source = fs.readFileSync(filename, "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        allowJs: false,
        isolatedModules: true,
        verbatimModuleSyntax: false,
      },
    });
    module._compile(outputText, filename);
  };

  // 3. Resolve the alias and extensionless `.ts` siblings — allowlisted only.
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function resolveForR1(request, parent, isMain, options) {
    const aliased = resolveAllowedR1Alias(request);
    const candidate = aliased === null ? request : aliased;
    let resolved;
    try {
      resolved = originalResolve.call(this, candidate, parent, isMain, options);
    } catch (err) {
      if (err && err.code !== "MODULE_NOT_FOUND") throw err;
      if (!path.isAbsolute(candidate) && !candidate.startsWith(".")) throw err;
      const base = path.isAbsolute(candidate)
        ? candidate
        : path.resolve(path.dirname(parent && parent.filename ? parent.filename : REPO_ROOT), candidate);
      resolved = null;
      for (const suffix of [".ts", "/index.ts"]) {
        if (fs.existsSync(`${base}${suffix}`)) { resolved = `${base}${suffix}`; break; }
      }
      if (resolved === null) throw err;
    }
    if (r1ResolutionVerdict(resolved, REPO_ROOT) === R1Resolution.REFUSE_NOT_ALLOWLISTED) {
      throw refusal(resolved);
    }
    return resolved;
  };
}

/**
 * Loads exactly what the one-shot repair needs from the REAL repository:
 *   • the deployed reconciliation service (the only thing that may write),
 *   • the pure 80.17A decision contract (so the preflight can prove the plan),
 *   • the canonical lane identifiers,
 *   • the service-role Supabase client factory (read-back SELECTs only).
 *
 * There is no send path in this object, and no way to obtain one through it:
 * every provider adapter is off the allowlist and cannot be resolved at all.
 */
function loadR1Runtime() {
  installRuntimeHooks();

  const resultContract = require(path.join(REPO_ROOT, "lib", "communication", "leadAssignmentResultContract.ts"));
  const dispatchContract = require(path.join(REPO_ROOT, "lib", "communication", "leadAssignmentDispatchContract.ts"));
  const campaignContract = require(path.join(REPO_ROOT, "lib", "communication", "campaignResultContract.ts"));
  const consentInput = require(path.join(REPO_ROOT, "lib", "communication", "inboundConsentCommandInput.ts"));
  const service = require(path.join(REPO_ROOT, "services", "leadAssignmentResultService.ts"));
  const supabase = require(path.join(REPO_ROOT, "lib", "supabase.ts"));

  return {
    // The ONE write authority. Called at most once, by the operator, on execute.
    reconcile: service.reconcileLeadAssignmentDeliveryResults,
    // Pure. Used by the read-only preflight to prove the planned write.
    evaluate: resultContract.evaluateLeadAssignmentReconciliation,
    appliedOutcome: resultContract.LeadAssignmentReconcileOutcome.APPLIED,
    adminClient: supabase.adminClient,
    canon: {
      aggregateType: dispatchContract.LEAD_ASSIGNMENT_AGGREGATE_TYPE,
      intentChannel: dispatchContract.LEAD_ASSIGNMENT_INTENT_CHANNEL,
      templatePurpose: dispatchContract.LEAD_ASSIGNMENT_TEMPLATE_PURPOSE,
      templateKey: dispatchContract.LEAD_ASSIGNMENT_TEMPLATE_KEY,
      idempotencyKeyFor: dispatchContract.leadAssignmentMessageIdempotencyKey,
      intentEntityType: campaignContract.INTENT_ENTITY_TYPE,
      project: campaignContract.projectIntentStatus,
      dispatchedIntentStatus: campaignContract.IntentResultStatus.DISPATCHED,
      failedIntentStatus: campaignContract.IntentResultStatus.FAILED,
      // The ADAPTER key persisted in communication_messages.provider.
      provider: consentInput.META_WHATSAPP_ADAPTER_PROVIDER,
      reconcileTable: resultContract.LEAD_ASSIGNMENT_RECONCILE_TABLE,
      reconcileColumn: resultContract.LEAD_ASSIGNMENT_RECONCILE_COLUMN,
    },
  };
}

module.exports = {
  loadR1Runtime,
  resolveAllowedR1Alias,
  r1ResolutionVerdict,
  r1NormalizeRepoRelative,
  ALLOWED_R1_REPO_MODULES,
  R1Resolution,
  REPO_ROOT,
  NODE_MODULES,
};
