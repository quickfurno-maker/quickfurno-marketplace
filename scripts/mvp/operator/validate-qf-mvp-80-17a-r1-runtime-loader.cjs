// ============================================================================
// QF-MVP-80.17A-R1 — RUNTIME LOADER SMOKE.  OFFLINE.
//
// WHY THIS EXISTS
//   The R1 suite proved every operator DECISION but never called
//   loadR1Runtime(), and that omission hid a real production blocker: the first
//   revision's denylist refused `communication/providers/`, which is where the
//   PURE `whatsappTemplateBinding` lives — a module the canonical
//   `leadAssignmentDispatchContract` reaches through `businessTemplateVariables`.
//   The loader would have refused its own dependency on the production VPS, and
//   a 76/76 green suite would still have said nothing about it.
//
//   This file therefore executes the loader for real. It is CommonJS on purpose:
//   production runs Node 20, which cannot load `.ts` natively at all, so this is
//   the same code path the operator will take there.
//
// WHAT IT MUST NOT DO
//   No database call, no adminClient(), no network request, no credential read,
//   no send. `fetch` is replaced with a trap and the Supabase environment
//   variables are deleted before anything loads, so an accidental connection
//   would fail loudly rather than silently succeed.
// ============================================================================

"use strict";

const assert = require("node:assert");
const path = require("node:path");

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

// --- Containment for this process itself ------------------------------------
// Anything that tried to reach the network or build a client would now throw.
let networkAttempts = 0;
globalThis.fetch = () => { networkAttempts += 1; throw new Error("network attempted"); };
for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "QF_CRON_SECRET",
]) {
  delete process.env[key];
}

// Force the Node-20 branch on every Node version: with no global WebSocket the
// loader must install one from Next's own bundled ws.
const hadNativeWebSocket = typeof globalThis.WebSocket === "function";
delete globalThis.WebSocket;
const webSocketWasAbsent = typeof globalThis.WebSocket !== "function";

const loaderPath = path.resolve(__dirname, "qf-mvp-80-17a-r1-runtime-register.cjs");
const loader = require(loaderPath);
const { REPO_ROOT, R1Resolution, ALLOWED_R1_REPO_MODULES } = loader;

const repoFile = (rel) => path.join(REPO_ROOT, ...rel.split("/"));
const verdict = (rel) => loader.r1ResolutionVerdict(repoFile(rel), REPO_ROOT);

// --- The load itself --------------------------------------------------------

let runtime = null;
let loadError = null;
try {
  runtime = loader.loadR1Runtime();
} catch (err) {
  loadError = err;
}

check("L1 loadR1Runtime() succeeds offline", () => {
  assert.strictEqual(loadError, null, `loadR1Runtime threw: ${loadError && loadError.message}`);
  assert.ok(runtime && typeof runtime === "object", "a runtime object is returned");
});

check("L2 the runtime object is exactly the narrow shape the operator needs", () => {
  assert.strictEqual(typeof runtime.reconcile, "function", "reconcile");
  assert.strictEqual(typeof runtime.evaluate, "function", "evaluate");
  assert.strictEqual(typeof runtime.adminClient, "function", "adminClient factory (never called here)");
  assert.strictEqual(typeof runtime.appliedOutcome, "string", "appliedOutcome");
  assert.ok(runtime.canon && typeof runtime.canon === "object", "canon");
  // Nothing else is exposed — in particular no client, no provider, no sender.
  assert.deepStrictEqual(
    Object.keys(runtime).sort(),
    ["adminClient", "appliedOutcome", "canon", "evaluate", "reconcile"],
    "no extra capability is handed out"
  );
});

check("L3 the real reconciliation authority is the deployed service export", () => {
  assert.strictEqual(runtime.reconcile.name, "reconcileLeadAssignmentDeliveryResults",
    "the function is the service's own export, not a wrapper");
});

check("L4 canon is populated from the real authorities", async () => {
  const contract = await import("../communication/qf-mvp-80-17a-r1-operator-contract.mjs");
  const agreed = contract.assertCanonAgrees(runtime.canon);
  assert.strictEqual(agreed.ok, true, `assertCanonAgrees: ${agreed.reason} ${agreed.missing ?? ""}`);
  for (const key of ["aggregateType", "intentChannel", "templatePurpose", "templateKey",
    "intentEntityType", "provider", "reconcileTable", "reconcileColumn"]) {
    assert.ok(typeof runtime.canon[key] === "string" && runtime.canon[key].length > 0, `canon.${key}`);
  }
  assert.strictEqual(typeof runtime.canon.idempotencyKeyFor, "function", "the deterministic key builder");
  assert.strictEqual(typeof runtime.canon.project, "function", "the projection authority");
});

check("L5 the transitive PURE dependency chain actually loaded", () => {
  // dispatch contract -> businessTemplateVariables -> providers/whatsappTemplateBinding.
  // The first revision denied that last file and would have failed here.
  const loaded = Object.keys(require.cache).map((f) => f.split(path.sep).join("/"));
  const need = [
    "lib/communication/leadAssignmentDispatchContract.ts",
    "lib/communication/businessTemplateVariables.ts",
    "lib/communication/providers/whatsappTemplateBinding.ts",
    "lib/communication/campaignResultContract.ts",
    "lib/communication/types.ts",
    "lib/communication/leadAssignmentResultContract.ts",
    "lib/communication/inboundConsentCommandInput.ts",
    "services/leadAssignmentResultService.ts",
    "lib/supabase.ts",
  ];
  for (const rel of need) {
    assert.ok(loaded.some((f) => f.endsWith(rel)), `${rel} was actually required`);
  }
});

check("L6 the Next-bundled WebSocket fallback was exercised", () => {
  assert.strictEqual(webSocketWasAbsent, true, "the global was removed before loading");
  assert.strictEqual(typeof globalThis.WebSocket, "function", "the loader installed one");
  // It came from Next's bundled ws, not from a new dependency.
  const ws = require(path.join(REPO_ROOT, "node_modules", "next", "dist", "compiled", "ws"));
  assert.strictEqual(globalThis.WebSocket, ws.WebSocket || ws, "it is Next's bundled ws");
  void hadNativeWebSocket;
});

// --- Fail-closed boundary ---------------------------------------------------

check("L7 every required R1 module is on the exact allowlist", () => {
  for (const rel of ALLOWED_R1_REPO_MODULES) {
    assert.strictEqual(verdict(rel), R1Resolution.ALLOW_ALLOWLISTED, rel);
  }
  assert.strictEqual(ALLOWED_R1_REPO_MODULES.length, 9, "the allowlist is exactly the audited graph");
});

check("L8 the PURE template binding is allowed; every provider ADAPTER is refused", () => {
  assert.strictEqual(verdict("lib/communication/providers/whatsappTemplateBinding.ts"),
    R1Resolution.ALLOW_ALLOWLISTED, "the pure binding the dispatch contract needs");
  for (const rel of [
    "lib/communication/providers/metaCloudWhatsAppProvider.ts",
    "lib/communication/providers/metaWhatsAppInbound.ts",
    "lib/communication/providers/metaWhatsAppWebhook.ts",
    "lib/communication/providers/providerAccountOwnership.ts",
  ]) {
    assert.strictEqual(verdict(rel), R1Resolution.REFUSE_NOT_ALLOWLISTED, rel);
  }
});

check("L9 send-capable and unrelated services are refused", () => {
  for (const rel of [
    "services/communicationService.ts",
    "services/leadAssignmentDispatchService.ts",
    "services/metaWhatsAppWebhookService.ts",
    "services/campaignCommunicationResultService.ts",
    "services/inboundWhatsAppMessageService.ts",
  ]) {
    assert.strictEqual(verdict(rel), R1Resolution.REFUSE_NOT_ALLOWLISTED, rel);
  }
});

check("L10 an arbitrary '@/services/...' alias is refused", () => {
  assert.throws(() => loader.resolveAllowedR1Alias("@/services/communicationService"),
    /not on the R1 runtime allowlist/, "aliased service");
  assert.throws(() => loader.resolveAllowedR1Alias("@/services/leadAssignmentDispatchService"),
    /not on the R1 runtime allowlist/, "aliased dispatcher");
});

check("L11 an arbitrary '@/lib/...' alias not on the allowlist is refused", () => {
  assert.throws(() => loader.resolveAllowedR1Alias("@/lib/communication/providers/metaCloudWhatsAppProvider"),
    /not on the R1 runtime allowlist/, "aliased provider adapter");
  assert.throws(() => loader.resolveAllowedR1Alias("@/lib/communication/whatsappTemplate"),
    /not on the R1 runtime allowlist/, "an unlisted lib module");
  // The alias still works for what R1 genuinely needs.
  assert.strictEqual(loader.resolveAllowedR1Alias("@/lib/supabase"), repoFile("lib/supabase.ts"),
    "the allowlisted alias still resolves");
  assert.strictEqual(loader.resolveAllowedR1Alias("./relative"), null, "non-alias requests are not claimed");
});

check("L12 a repository module nobody reviewed is refused by default", () => {
  // The default answer for anything repo-local is NO, so a future import inside
  // an allowed module cannot silently widen this operator's reach.
  for (const rel of [
    "lib/communication/whatsappTemplate.ts",
    "app/api/webhooks/whatsapp/meta/route.ts",
    "scripts/mvp/communication/reconcile-qf-mvp-80-17a-r1-once.mjs",
    "lib/some/module/invented/tomorrow.ts",
  ]) {
    assert.strictEqual(verdict(rel), R1Resolution.REFUSE_NOT_ALLOWLISTED, rel);
  }
  assert.throws(() => require(repoFile("services/communicationService.ts")),
    /not on the R1 runtime allowlist/, "and the installed hook enforces it for real");
});

check("L13 node_modules dependencies and Node built-ins still resolve", () => {
  assert.strictEqual(loader.r1ResolutionVerdict(path.join(REPO_ROOT, "node_modules", "typescript", "lib", "typescript.js"), REPO_ROOT),
    R1Resolution.ALLOW_EXTERNAL, "a package dependency");
  assert.strictEqual(loader.r1ResolutionVerdict("node:fs", REPO_ROOT), R1Resolution.ALLOW_EXTERNAL, "a built-in");
  assert.ok(require("node:crypto").createHash, "a built-in really loads");
  assert.ok(require(path.join(REPO_ROOT, "node_modules", "typescript")).version, "a package really loads");
  assert.ok(require("@supabase/supabase-js").createClient, "the Supabase package really loads");
});

check("L14 nothing in this smoke touched the network, a client or a credential", () => {
  assert.strictEqual(networkAttempts, 0, "no fetch was attempted");
  assert.strictEqual(process.env.NEXT_PUBLIC_SUPABASE_URL, undefined, "no Supabase URL is present");
  assert.strictEqual(process.env.SUPABASE_SERVICE_ROLE_KEY, undefined, "no service-role key is present");
  // adminClient() is deliberately never called: with no environment it would
  // throw, and calling it is not what this smoke proves.
  assert.strictEqual(typeof runtime.adminClient, "function", "only its factory was handed over");
});

// ============================================================================
(async () => {
  let passed = 0;
  const failures = [];
  for (const { name, fn } of checks) {
    try { await fn(); passed += 1; console.log(`   ok    ${name}`); }
    catch (e) { failures.push(`   FAIL  ${name} — ${e.message}`); console.log(`   FAIL  ${name} — ${e.message}`); }
  }
  console.log(`\n${"=".repeat(78)}`);
  console.log(`QF-MVP-80.17A-R1 runtime loader smoke (node ${process.version}) — passed ${passed}, failed ${failures.length}`);
  if (failures.length) { console.log("\nFAILURES:"); for (const l of failures) console.log(l); }
  console.log("=".repeat(78));
  process.exit(failures.length ? 1 : 0);
})();
