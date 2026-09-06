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
// CAPABILITY DENYLIST — the load-bearing containment
//   The hook REFUSES to load any send-capable module: every provider adapter,
//   CommunicationService, the lead-assignment dispatcher, the webhook service
//   and the campaign result service. The historical repair therefore cannot even
//   construct the machinery that could send a WhatsApp message, quite apart from
//   the operator never calling it.
//
// Installation happens only inside loadR1Runtime(). Requiring this file is inert,
// which is what lets the OFFLINE validator execute the two predicates below.
// ============================================================================

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const Module = require("node:module");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Send-capable / out-of-scope modules. A match is a hard error, never a silent
 * skip: if the reconciliation graph ever grows one of these, the operator must
 * stop and be re-reviewed rather than quietly gaining the capability.
 */
const DENIED_MODULE = new RegExp(
  [
    "communication[\\\\/]+providers[\\\\/]+",
    "services[\\\\/]+communicationService",
    "services[\\\\/]+leadAssignmentDispatchService",
    "services[\\\\/]+metaWhatsAppWebhookService",
    "services[\\\\/]+campaignCommunicationResultService",
    "services[\\\\/]+inboundWhatsAppMessageService",
    "services[\\\\/]+consentCommandResponseService",
    "services[\\\\/]+leadAssignmentSchedulerService",
    "n8n",
  ].join("|"),
  "i"
);

/** True when the resolved file is one this operator must never be able to load. */
function r1LoaderDeniesModule(filename) {
  if (typeof filename !== "string" || filename === "") return false;
  return DENIED_MODULE.test(filename);
}

/** Maps the "@/x" tsconfig alias to a repo-root path. Everything else is untouched. */
function r1MapAliasSpecifier(request, repoRoot) {
  if (typeof request !== "string" || !request.startsWith("@/")) return null;
  return path.join(repoRoot || REPO_ROOT, request.slice(2));
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
    if (r1LoaderDeniesModule(filename)) {
      throw new Error(
        `[qf-mvp-80-17a-r1] Refusing to load a send-capable or out-of-scope module: ` +
          `${path.relative(REPO_ROOT, filename)}`
      );
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

  // 3. Resolve "@/..." and extensionless siblings that only exist as `.ts`.
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function resolveWithAlias(request, parent, isMain, options) {
    const aliased = r1MapAliasSpecifier(request, REPO_ROOT);
    const candidate = aliased === null ? request : aliased;
    try {
      const resolved = originalResolve.call(this, candidate, parent, isMain, options);
      if (r1LoaderDeniesModule(resolved)) {
        throw new Error(
          `[qf-mvp-80-17a-r1] Refusing to resolve a send-capable or out-of-scope module: ` +
            `${path.relative(REPO_ROOT, resolved)}`
        );
      }
      return resolved;
    } catch (err) {
      if (err && err.code !== "MODULE_NOT_FOUND") throw err;
      if (path.isAbsolute(candidate) || candidate.startsWith(".")) {
        const base = path.isAbsolute(candidate)
          ? candidate
          : path.resolve(path.dirname(parent && parent.filename ? parent.filename : REPO_ROOT), candidate);
        for (const suffix of [".ts", "/index.ts"]) {
          const withExt = `${base}${suffix}`;
          if (fs.existsSync(withExt)) {
            if (r1LoaderDeniesModule(withExt)) {
              throw new Error(
                `[qf-mvp-80-17a-r1] Refusing to resolve a send-capable or out-of-scope module: ` +
                  `${path.relative(REPO_ROOT, withExt)}`
              );
            }
            return withExt;
          }
        }
      }
      throw err;
    }
  };
}

/**
 * Loads exactly what the one-shot repair needs from the REAL repository:
 *   • the deployed reconciliation service (the only thing that may write),
 *   • the pure 80.17A decision contract (so the preflight can prove the plan),
 *   • the canonical lane identifiers,
 *   • the service-role Supabase client factory (read-back SELECTs only).
 *
 * There is no send path in this object, and no way to obtain one through it.
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

module.exports = { loadR1Runtime, r1LoaderDeniesModule, r1MapAliasSpecifier, REPO_ROOT };
