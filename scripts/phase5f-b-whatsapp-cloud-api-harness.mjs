import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import crypto from "node:crypto";

/**
 * Phase 5F-B — QuickFurno WhatsApp Cloud API production-readiness harness.
 *
 * Verifies the real Meta adapter + gates WITHOUT activating sending: the config
 * contract (env names only, fail-closed, no silent mock fallback), provider
 * selection, runtime/account/canary gates, provider identity fence, approved-mapping
 * resolver, strict variable binding, the abortable Meta adapter with conservative
 * outcome certainty, and the webhook (GET verify, POST fail-closed order, dedupe,
 * normalization, classification). It compiles the PURE contracts, drives them with a
 * FAKE injected transport (no network), parses the migration, and mutation-tests the
 * security-critical boundaries by editing the real files and asserting red.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const TS_FILES = [
  "lib/errors.ts",
  "lib/supabase.ts",
  "lib/identity/authSecurityEvent.ts",
  "lib/identity/clientOtpAutomation.ts",
  "lib/auth/hookDeadline.ts",
  "lib/auth/supabaseSendSmsHook.ts",
  "lib/communication/types.ts",
  "lib/communication/phone.ts",
  "lib/communication/dbErrors.ts",
  "lib/communication/recipientResolver.ts",
  "lib/communication/channelDispatchGuard.ts",
  "lib/communication/httpTransport.ts",
  "lib/communication/canonicalJson.ts",
  "lib/communication/whatsappTemplate.ts",
  "lib/communication/providerMappingFingerprint.ts",
  "lib/communication/approvedTemplateOutbound.ts",
  "lib/communication/providers/providerOutcome.ts",
  "lib/communication/providers/whatsappProvider.ts",
  "lib/communication/providers/providerError.ts",
  "lib/communication/providers/mockWhatsAppProvider.ts",
  "lib/communication/providers/metaCloudWhatsAppConfig.ts",
  "lib/communication/providers/metaRuntimeGate.ts",
  "lib/communication/providers/whatsappTemplateBinding.ts",
  "lib/communication/providers/metaWhatsAppWebhook.ts",
  "lib/communication/providers/metaCloudWhatsAppProvider.ts",
  "services/communicationRecipientResolver.ts",
  "services/communicationService.ts",
  "services/communicationProviderRuntimeService.ts",
  "services/providerTemplateMappingService.ts",
  "services/metaWhatsAppOutboundService.ts",
  "services/runtimeCommunicationService.ts",
  "services/metaWhatsAppWebhookService.ts",
  "services/whatsAppProviderSelection.ts",
  "services/clientOtpAutomationService.ts",
  "services/supabaseSendSmsHookService.ts",
  "services/communicationAdminService.ts",
];

function compileTo(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  const tsconfigPath = resolve(`${outDir}.tsconfig.json`);
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          module: "commonjs", target: "ES2020", moduleResolution: "node",
          skipLibCheck: true, esModuleInterop: true, strict: true, jsx: "preserve",
          outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] }, lib: ["ES2021", "DOM"],
        },
        files: TS_FILES,
      },
      null,
      2
    )
  );
  try {
    execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" });
  } finally {
    rmSync(tsconfigPath, { force: true });
  }
  return outDir;
}

function wireBuild(outDir) {
  const req = createRequire(`${outDir}/`);
  return {
    req,
    Config: req("./lib/communication/providers/metaCloudWhatsAppConfig.js"),
    Gate: req("./lib/communication/providers/metaRuntimeGate.js"),
    Binding: req("./lib/communication/providers/whatsappTemplateBinding.js"),
    Template: req("./lib/communication/whatsappTemplate.js"),
    Webhook: req("./lib/communication/providers/metaWhatsAppWebhook.js"),
    Provider: req("./lib/communication/providers/metaCloudWhatsAppProvider.js"),
    Mock: req("./lib/communication/providers/mockWhatsAppProvider.js"),
    Selection: req("./services/whatsAppProviderSelection.js"),
    Comm: req("./services/communicationService.js"),
    Runtime: req("./services/runtimeCommunicationService.js"),
    Outbound: req("./services/metaWhatsAppOutboundService.js"),
    WebhookSvc: req("./services/metaWhatsAppWebhookService.js"),
    Resolver: req("./lib/communication/recipientResolver.js"),
    Phone: req("./lib/communication/phone.js"),
    Supabase: req("./lib/supabase.js"),
    Transport: req("./lib/communication/httpTransport.js"),
    Types: req("./lib/communication/types.js"),
    Admin: req("./services/communicationAdminService.js"),
    Canonical: req("./lib/communication/canonicalJson.js"),
    Fingerprint: req("./lib/communication/providerMappingFingerprint.js"),
    Deadline: req("./lib/auth/hookDeadline.js"),
    HookLib: req("./lib/auth/supabaseSendSmsHook.js"),
    HookSvc: req("./services/supabaseSendSmsHookService.js"),
  };
}

// ============================================================================
// FILE PATHS
// ============================================================================
const MIGRATION_5FB = "supabase/migrations/20260709000200_whatsapp_cloud_api_runtime_control.sql";
const CONFIG_SRC = "lib/communication/providers/metaCloudWhatsAppConfig.ts";
const GATE_SRC = "lib/communication/providers/metaRuntimeGate.ts";
const BINDING_SRC = "lib/communication/providers/whatsappTemplateBinding.ts";
const TEMPLATE_SRC = "lib/communication/whatsappTemplate.ts";
const WEBHOOK_LIB_SRC = "lib/communication/providers/metaWhatsAppWebhook.ts";
const PROVIDER_SRC = "lib/communication/providers/metaCloudWhatsAppProvider.ts";
const TRANSPORT_SRC = "lib/communication/httpTransport.ts";
const SELECTION_SRC = "services/whatsAppProviderSelection.ts";
const RUNTIME_SERVICE_SRC = "services/communicationProviderRuntimeService.ts";
const MAPPING_SERVICE_SRC = "services/providerTemplateMappingService.ts";
const HEALTH_SERVICE_SRC = "services/communicationProviderHealthService.ts";
const WEBHOOK_SERVICE_SRC = "services/metaWhatsAppWebhookService.ts";
const ROUTE_SRC = "app/api/webhooks/whatsapp/meta/route.ts";
const COMM_SERVICE_SRC = "services/communicationService.ts";
const MANIFEST_SRC = "docs/provider-manifests/whatsapp-template-submission-manifest.json";
const READINESS_DOC = "docs/QF-WhatsApp-Cloud-API-Production-Readiness.md";
const RUNBOOK_DOC = "docs/QF-WhatsApp-Cloud-API-Activation-Runbook.md";

// ============================================================================
// SQL MODEL
// ============================================================================
const stripSql = (s) => s.replace(/--[^\n]*/g, "");
function createTableBody(sql, name) {
  const marker = `create table if not exists public.${name} (`;
  const start = sql.indexOf(marker);
  if (start < 0) return "";
  let i = sql.indexOf("(", start);
  let depth = 0;
  let out = "";
  for (; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "(") { depth += 1; if (depth === 1) continue; }
    if (ch === ")") { depth -= 1; if (depth === 0) break; }
    out += ch;
  }
  return out;
}
function parseRuntimeSeed(sql) {
  const m = sql.match(/insert into public\.communication_provider_runtime_policies\s*\(([^)]*)\)\s*values([\s\S]*?)on conflict/i);
  if (!m) return null;
  const cols = m[1].split(",").map((c) => c.trim());
  const row = {};
  const vm = m[2].match(/\(([^)]*)\)/);
  if (!vm) return null;
  const vals = vm[1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
  cols.forEach((c, i) => { row[c] = vals[i]; });
  return row;
}
function loadSql() {
  const raw = readFileSync(MIGRATION_5FB, "utf8");
  const stripped = stripSql(raw);
  return {
    raw, stripped,
    tables: {
      runtime: createTableBody(stripped, "communication_provider_runtime_policies"),
      canary: createTableBody(stripped, "communication_provider_canary_destinations"),
    },
    runtimeSeed: parseRuntimeSeed(stripped),
  };
}
let SQL = loadSql();
function rebuildSqlModel() { SQL = loadSql(); }

// ============================================================================
// REGISTRY + HELPERS
// ============================================================================
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertNoForbidden(body, patterns, label) {
  for (const re of patterns) assert(!re.test(body), `${label}: forbidden pattern ${re}`);
}

// A fully-populated MetaProviderRuntime (send + webhook-verify + health capable).
const META_CONFIG = {
  accessToken: "SUPER_SECRET_TOKEN_VALUE", phoneNumberId: "PN_123", wabaId: "WABA_456",
  graphApiVersion: "v19.0", appSecret: "APP_SECRET_VALUE",
  authHttpTimeoutMs: 3000, businessHttpTimeoutMs: 5000, healthHttpTimeoutMs: 5000,
};
function completeMetaEnv(overrides = {}) {
  return {
    WHATSAPP_PROVIDER_MODE: "meta_cloud",
    WHATSAPP_ACCESS_TOKEN: "SUPER_SECRET_TOKEN_VALUE",
    WHATSAPP_PHONE_NUMBER_ID: "PN_123",
    WHATSAPP_WABA_ID: "WABA_456",
    WHATSAPP_APP_SECRET: "APP_SECRET_VALUE",
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: "VERIFY_TOKEN_VALUE",
    WHATSAPP_GRAPH_API_VERSION: "v19.0",
    WHATSAPP_AUTH_HTTP_TIMEOUT_MS: "3000",
    WHATSAPP_HTTP_TIMEOUT_MS: "5000",
    ...overrides,
  };
}
function fakeTransport(responder) {
  const calls = [];
  return { calls, async request(req) { calls.push(req); return responder(req, calls.length); } };
}
function okAccount(overrides = {}) {
  return {
    provider_key: "meta_whatsapp_cloud", channel: "whatsapp",
    phone_number_reference: "PN_123", business_account_reference: "WABA_456",
    readiness_status: "provider_ready", configuration_status: "complete",
    business_verification_status: "verified", phone_number_status: "connected",
    webhook_status: "verified", health_status: "healthy", ...overrides,
  };
}
function okPolicy(overrides = {}) {
  return {
    provider_key: "meta_whatsapp_cloud", channel: "whatsapp", activation_status: "active",
    outbound_enabled: true, webhook_processing_enabled: true, health_check_enabled: true, ...overrides,
  };
}

// ============================================================================
// MAIN BUILD
// ============================================================================
const MAIN_DIR = resolve(".phase5fb-build-main");
compileTo(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

// ---- In-memory adminClient stub (for behavioral CommunicationService tests) ----
const DB_TABLES = [
  "communication_messages", "communication_templates", "communication_webhook_receipts",
  "communication_delivery_events", "communication_provider_runtime_policies",
  "communication_provider_accounts", "communication_provider_template_mappings",
  "communication_provider_canary_destinations", "communication_automation_catalog",
];
const db = {};
function resetDb() { for (const t of DB_TABLES) db[t] = []; }
resetDb();
class QB {
  constructor(table) { this.table = table; this.filters = []; this.limitVal = null; this.action = "select"; this.data = null; }
  select() { return this; }
  order() { return this; }
  limit(n) { this.limitVal = n; return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
  insert(row) { this.action = "insert"; this.data = row; return this; }
  update(u) { this.action = "update"; this.data = u; return this; }
  maybeSingle() { return this.single(); }
  async single() { const { data, error } = await this.exec(); return { data: Array.isArray(data) ? (data[0] ?? null) : data, error }; }
  async exec() {
    let list = db[this.table] || (db[this.table] = []);
    if (this.action === "insert") {
      const rows = Array.isArray(this.data) ? this.data : [this.data];
      const inserted = [];
      for (const r of rows) {
        const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r };
        db[this.table].push(row);
        inserted.push(row);
      }
      return { data: Array.isArray(this.data) ? inserted : inserted[0], error: null };
    }
    if (this.action === "update") {
      let sel = list;
      for (const f of this.filters) sel = sel.filter(f);
      for (const item of sel) Object.assign(item, this.data);
      return { data: sel, error: null };
    }
    for (const f of this.filters) list = list.filter(f);
    if (this.limitVal !== null) list = list.slice(0, this.limitVal);
    return { data: list, error: null };
  }
  async then(resolve2) { const { data, error } = await this.exec(); return resolve2({ data, error }); }
}
M.Supabase.adminClient = () => ({ from: (t) => new QB(t) });

// ============================================================================
// CONFIG (1–8) — narrow purpose-specific loaders
// ============================================================================
check("1-3. default mode mock (non-prod); outbound needs complete config; missing fails closed", () => {
  const C = M.Config;
  assert(C.resolveWhatsAppProviderMode({}) === "mock", "absent mode → mock");
  const r1 = C.resolveOutboundMetaConfig(completeMetaEnv());
  assert(r1.ok && r1.config.phoneNumberId === "PN_123", "complete outbound config resolves");
  const missing = C.resolveOutboundMetaConfig({});
  assert(!missing.ok && missing.missing.length >= 5, "outbound with no vars fails closed with names");
});

check("4-5. config error reports NAMES only; secret values never appear", () => {
  const C = M.Config;
  const env = completeMetaEnv({ WHATSAPP_ACCESS_TOKEN: undefined, WHATSAPP_GRAPH_API_VERSION: "19" });
  const res = C.resolveOutboundMetaConfig(env);
  assert(!res.ok, "incomplete/invalid fails");
  assert(res.missing.includes("WHATSAPP_ACCESS_TOKEN"), "missing name reported");
  assert(res.invalid.includes("WHATSAPP_GRAPH_API_VERSION"), "invalid version name reported");
  const desc = C.describeConfigFailure(res);
  const blob = desc + JSON.stringify(res.missing) + JSON.stringify(res.invalid);
  for (const secret of ["APP_SECRET_VALUE", "VERIFY_TOKEN_VALUE", "SUPER_SECRET_TOKEN_VALUE"]) {
    assert(!blob.includes(secret), `secret value ${secret} must never appear`);
  }
});

check("6-7. Graph API version explicit + validated; business timeout finite/positive/bounded", () => {
  const C = M.Config;
  for (const bad of ["19", "v19", "vNINETEEN", "19.0", ""]) {
    const r = C.resolveOutboundMetaConfig(completeMetaEnv({ WHATSAPP_GRAPH_API_VERSION: bad || undefined }));
    assert(!r.ok, `graph version '${bad}' rejected`);
  }
  assert(C.GRAPH_API_VERSION_PATTERN.test("v19.0") && C.GRAPH_API_VERSION_PATTERN.test("v21.5"), "valid versions pass");
  for (const bad of ["0", "-5", "500", "999999999", "abc", "5000.5"]) {
    const r = C.resolveOutboundMetaConfig(completeMetaEnv({ WHATSAPP_HTTP_TIMEOUT_MS: bad }));
    assert(!r.ok && r.invalid.includes("WHATSAPP_HTTP_TIMEOUT_MS"), `business timeout '${bad}' rejected`);
  }
  const good = C.resolveOutboundMetaConfig(completeMetaEnv({ WHATSAPP_HTTP_TIMEOUT_MS: "8000" }));
  assert(good.ok && good.config.businessHttpTimeoutMs === 8000, "valid business timeout accepted");
});

check("8. config reads process.env only; no .env / .env.local read or write", () => {
  const code = stripTs(readFileSync(CONFIG_SRC, "utf8"));
  assert(/process\.env/.test(readFileSync(CONFIG_SRC, "utf8")), "config reads process.env");
  assert(!/readFileSync|writeFile|dotenv|readFile\(|\.env\.local/i.test(code), "config never reads/writes an env file");
});

// ============================================================================
// PROVIDER SELECTION (9–12)
// ============================================================================
check("9-12. mock mode → mock; meta mode no silent fallback; meta identity + channel exact", () => {
  const S = M.Selection;
  const transport = fakeTransport(() => ({ kind: "response", status: 200, bodyText: "{}", truncated: false }));
  const mockSel = S.selectWhatsAppProvider({}, transport);
  assert(mockSel.ok && mockSel.mode === "mock" && mockSel.provider.providerKey === "mock", "mock mode → MockWhatsAppProvider");
  const metaSel = S.selectWhatsAppProvider(completeMetaEnv(), transport);
  assert(metaSel.ok && metaSel.mode === "meta_cloud", "meta mode selects meta");
  assert(metaSel.provider.providerKey === "meta_whatsapp_cloud", "meta provider identity exact");
  assert(metaSel.provider.channel === "whatsapp", "meta provider channel whatsapp");
  // Incomplete meta config → fail closed, NO provider, NO mock fallback.
  const bad = S.selectWhatsAppProvider({ WHATSAPP_PROVIDER_MODE: "meta_cloud" }, transport);
  assert(bad.ok === false, "incomplete meta fails closed");
  assert(!("provider" in bad), "no provider object on failure (never a mock)");
  // Unknown mode never silently becomes mock.
  const weird = S.selectWhatsAppProvider({ WHATSAPP_PROVIDER_MODE: "sms_cloud" }, transport);
  assert(weird.ok === false && weird.reason === "invalid_mode", "unknown mode fails closed, not mock");
});

// ============================================================================
// RUNTIME POLICY + MIGRATION SEED (13–26 partial)
// ============================================================================
check("13-16. migration seeds ONE Meta runtime policy fully disabled", () => {
  const seed = SQL.runtimeSeed;
  assert(seed, "runtime seed parsed");
  assert(seed.provider_key === "meta_whatsapp_cloud" && seed.channel === "whatsapp", "seed is the Meta whatsapp policy");
  assert(seed.activation_status === "disabled", "activation disabled");
  assert(seed.outbound_enabled === "false", "outbound disabled");
  assert(seed.webhook_processing_enabled === "false", "webhook processing disabled");
  assert(seed.health_check_enabled === "false", "health check disabled");
  // Exactly one seeded row.
  const inserts = SQL.stripped.match(/insert into public\.communication_provider_runtime_policies/gi) || [];
  assert(inserts.length === 1, "exactly one runtime policy insert");
});

check("17-21. provider_ready never activates; non-canary/active states cannot send (pure gate)", () => {
  const G = M.Gate;
  // provider_ready account alone, but policy disabled → no send.
  const disabled = G.evaluateRuntimeActivation(okPolicy({ activation_status: "disabled", outbound_enabled: false }));
  assert(!disabled.ok && disabled.reason === "outbound_disabled", "disabled → outbound_disabled");
  for (const st of ["readiness_only", "shadow", "paused"]) {
    const r = G.evaluateRuntimeActivation(okPolicy({ activation_status: st, outbound_enabled: true }));
    assert(!r.ok && r.reason === "activation_not_sendable", `${st} cannot send`);
  }
  // outbound_enabled false always blocks, even if active.
  const off = G.evaluateRuntimeActivation(okPolicy({ activation_status: "active", outbound_enabled: false }));
  assert(!off.ok && off.reason === "outbound_disabled", "outbound flag required");
  // missing policy fails closed.
  assert(G.evaluateRuntimeActivation(null).reason === "runtime_policy_missing", "missing policy fails closed");
  // canary/active are the only sendable states.
  assert(G.evaluateRuntimeActivation(okPolicy({ activation_status: "active", outbound_enabled: true })).ok, "active sendable");
  assert(G.evaluateRuntimeActivation(okPolicy({ activation_status: "canary", outbound_enabled: true })).ok, "canary sendable");
});

check("22-25. canary requires active unexpired allowlist; active does not; expired/inactive rejected", () => {
  const G = M.Gate;
  const hash = "abc123hash";
  const future = new Date(Date.now() + 3600000).toISOString();
  const past = new Date(Date.now() - 3600000).toISOString();
  const activeRow = { provider_key: "meta_whatsapp_cloud", channel: "whatsapp", destination_hash: hash, is_active: true, expires_at: null };
  // canary + allowlisted → ok
  assert(G.evaluateCanaryGate("canary", hash, [activeRow]).ok, "canary + active allowlist ok");
  assert(G.evaluateCanaryGate("canary", hash, [{ ...activeRow, expires_at: future }]).ok, "unexpired ok");
  // canary + none → rejected
  assert(!G.evaluateCanaryGate("canary", hash, []).ok, "canary without allowlist rejected");
  // expired rejected
  assert(!G.evaluateCanaryGate("canary", hash, [{ ...activeRow, expires_at: past }]).ok, "expired rejected");
  // inactive rejected
  assert(!G.evaluateCanaryGate("canary", hash, [{ ...activeRow, is_active: false }]).ok, "inactive rejected");
  // active activation does NOT require allowlist
  assert(G.evaluateCanaryGate("active", hash, []).ok, "active needs no allowlist");
});

check("26. canary table stores destination HASH only — no plaintext phone", () => {
  const body = SQL.tables.canary;
  assert(body.length > 0, "canary table exists");
  assert(/destination_hash\s+text not null/i.test(body), "destination_hash present");
  assertNoForbidden(body, [/\bphone\b/i, /\bphone_e164\b/i, /\bmsisdn\b/i, /\bdestination\s+text/i, /\botp\b/i, /\btoken\b/i, /secret/i], "canary");
});

// ============================================================================
// PROVIDER ACCOUNT READINESS (27–34)
// ============================================================================
check("27-34. provider-account readiness gate is exact and fails closed on any field", () => {
  const G = M.Gate;
  const expected = { phoneNumberId: "PN_123", wabaId: "WABA_456" };
  assert(!G.evaluateProviderAccountReadiness(null, expected).ok, "missing account fails closed");
  assert(G.evaluateProviderAccountReadiness(okAccount(), expected).ok, "fully ready account passes");
  const mismatchPhone = G.evaluateProviderAccountReadiness(okAccount({ phone_number_reference: "PN_OTHER" }), expected);
  assert(!mismatchPhone.ok && mismatchPhone.reason === "provider_account_reference_mismatch", "wrong phone id fails");
  const mismatchWaba = G.evaluateProviderAccountReadiness(okAccount({ business_account_reference: "WABA_OTHER" }), expected);
  assert(!mismatchWaba.ok && mismatchWaba.reason === "provider_account_reference_mismatch", "wrong WABA id fails");
  for (const [field, bad] of [
    ["readiness_status", "account_ready"], ["configuration_status", "partial"],
    ["business_verification_status", "pending"], ["phone_number_status", "disconnected"],
    ["webhook_status", "pending"], ["health_status", "unhealthy"],
  ]) {
    const r = G.evaluateProviderAccountReadiness(okAccount({ [field]: bad }), expected);
    assert(!r.ok && r.reason === "provider_account_not_ready", `${field}=${bad} fails closed`);
  }
});

check("composed gate fails closed end to end", () => {
  const G = M.Gate;
  const hash = "h1";
  const base = {
    account: okAccount(), canaryRows: [], destinationHash: hash,
    expected: { phoneNumberId: "PN_123", wabaId: "WABA_456" },
  };
  assert(!G.evaluateMetaOutboundGate({ policy: okPolicy({ activation_status: "disabled", outbound_enabled: false }), ...base }).ok, "disabled blocked");
  // active + ready + no canary needed → ok
  assert(G.evaluateMetaOutboundGate({ policy: okPolicy(), ...base }).ok, "active ready → ok");
  // canary + no allowlist → blocked
  assert(!G.evaluateMetaOutboundGate({ policy: okPolicy({ activation_status: "canary" }), ...base }).ok, "canary no allowlist blocked");
});

// ============================================================================
// PROVIDER IDENTITY FENCE (35–38)
// ============================================================================
check("35-38. provider identity fence exact; CommunicationService fences at 2 boundaries", () => {
  const G = M.Gate;
  assert(G.providerIdentityMatches("meta_whatsapp_cloud", "meta_whatsapp_cloud") === true, "exact match");
  assert(G.providerIdentityMatches("mock", "meta_whatsapp_cloud") === false, "mock message vs meta provider blocked");
  assert(G.providerIdentityMatches("meta_whatsapp_cloud", "mock") === false, "meta message vs mock provider blocked");
  assert(G.providerIdentityMatches("", "mock") === false && G.providerIdentityMatches(null, "mock") === false, "empty/null not a match");
  // CommunicationService has the fence at the final dispatch boundary AND before invocation.
  const svc = readFileSync(COMM_SERVICE_SRC, "utf8");
  assert(/isForeignProvider\(message\.provider\)/.test(svc), "provider fence wired");
  assert((svc.match(/this\.isForeignProvider\(message\.provider\)/g) || []).length >= 2, "fence at both boundaries");
  assert(/UNSUPPORTED_DISPATCH_PROVIDER/.test(svc), "provider fence error code present");
});

// ============================================================================
// TEMPLATE MAPPING RESOLVER (39–52)
// ============================================================================
function mappingRow(overrides = {}) {
  return {
    template_key: "client_login_otp", channel: "whatsapp", provider_key: "meta_whatsapp_cloud",
    language: "en", version: "1.0", provider_template_name: "qf_login_otp", provider_template_id: "tid_1",
    approval_status: "approved", is_active: true,
    variables_schema: { bindingVersion: 1, bindings: [{ component: "body", position: 1, sourceKey: "otp", parameterType: "text" }] },
    ...overrides,
  };
}
check("39-51. Meta mapping resolver requires approved+active exact match; no legacy fallback", () => {
  const T = M.Template;
  const crit = { templateKey: "client_login_otp", providerKey: "meta_whatsapp_cloud", language: "en" };
  assert(!T.selectApprovedProviderMapping([], crit).ok, "no mapping → fail (no legacy fallback)");
  for (const st of ["draft", "ready_for_submission", "submitted", "rejected", "paused", "disabled", "superseded"]) {
    const r = T.selectApprovedProviderMapping([mappingRow({ approval_status: st, is_active: false })], crit);
    assert(!r.ok, `${st} mapping rejected`);
  }
  // approved but inactive → rejected
  assert(!T.selectApprovedProviderMapping([mappingRow({ is_active: false })], crit).ok, "approved+inactive rejected");
  // wrong provider / channel / language → rejected
  assert(!T.selectApprovedProviderMapping([mappingRow({ provider_key: "mock" })], crit).ok, "wrong provider rejected");
  assert(!T.selectApprovedProviderMapping([mappingRow({ channel: "sms" })], crit).ok, "wrong channel rejected");
  assert(!T.selectApprovedProviderMapping([mappingRow({ language: "hi" })], crit).ok, "wrong language rejected");
  // missing provider_template_name rejected
  assert(!T.selectApprovedProviderMapping([mappingRow({ provider_template_name: "" })], crit).ok, "missing provider template name rejected");
  assert(!T.selectApprovedProviderMapping([mappingRow({ provider_template_name: null })], crit).ok, "null provider template name rejected");
  // approved + active exact → accepted
  const okRes = T.selectApprovedProviderMapping([mappingRow()], crit);
  assert(okRes.ok && okRes.template.providerTemplateName === "qf_login_otp", "approved active exact accepted");
  assert(okRes.template.providerKey === "meta_whatsapp_cloud" && okRes.template.channel === "whatsapp", "resolved descriptor identity");
  // Meta resolver + mapping service never reference legacy communication_templates.provider_template_name.
  const svc = stripTs(readFileSync(MAPPING_SERVICE_SRC, "utf8"));
  assert(!/communication_templates/.test(svc), "mapping service never reads legacy communication_templates for Meta");
});

check("52. mock behavior preserved: mock uses internal_template mode", () => {
  const mock = new M.Mock.MockWhatsAppProvider();
  assert(mock.templateResolutionMode === "internal_template", "mock resolution mode internal_template");
  assert(M.Provider.MetaCloudWhatsAppProvider.name === "MetaCloudWhatsAppProvider", "meta provider present");
});

// ============================================================================
// VARIABLE BINDING (53–61)
// ============================================================================
check("53-61. strict binding: order by position not object keys; strict validation; no partial", () => {
  const B = M.Binding;
  const schema = { bindingVersion: 1, bindings: [
    { component: "body", position: 2, sourceKey: "b", parameterType: "text" },
    { component: "body", position: 1, sourceKey: "a", parameterType: "text" },
  ] };
  // Insertion order and alphabetical order are BOTH irrelevant — only position matters.
  const r1 = B.renderWhatsAppTemplateComponents(schema, { b: "SECOND", a: "FIRST" });
  assert(r1.ok, "renders");
  const params = r1.components[0].parameters;
  assert(params[0].text === "FIRST" && params[1].text === "SECOND", "ordered by position, not key order");
  const r2 = B.renderWhatsAppTemplateComponents(schema, { a: "FIRST", b: "SECOND" });
  assert(JSON.stringify(r1.components) === JSON.stringify(r2.components), "object insertion order irrelevant");
  // missing source key rejected
  assert(!B.renderWhatsAppTemplateComponents(schema, { a: "x" }).ok, "missing source key rejected");
  // duplicate position rejected
  assert(!B.renderWhatsAppTemplateComponents({ bindingVersion: 1, bindings: [
    { component: "body", position: 1, sourceKey: "a", parameterType: "text" },
    { component: "body", position: 1, sourceKey: "b", parameterType: "text" },
  ] }, { a: "1", b: "2" }).ok, "duplicate position rejected");
  // duplicate source binding rejected
  assert(!B.renderWhatsAppTemplateComponents({ bindingVersion: 1, bindings: [
    { component: "body", position: 1, sourceKey: "a", parameterType: "text" },
    { component: "body", position: 2, sourceKey: "a", parameterType: "text" },
  ] }, { a: "1" }).ok, "duplicate source binding rejected");
  // malformed schema / wrong version rejected
  assert(!B.renderWhatsAppTemplateComponents({ bindingVersion: 2, bindings: [] }, {}).ok, "wrong version rejected");
  assert(!B.renderWhatsAppTemplateComponents(null, {}).ok, "malformed schema rejected");
  // unsupported component / parameter type rejected
  assert(!B.renderWhatsAppTemplateComponents({ bindingVersion: 1, bindings: [{ component: "footer", position: 1, sourceKey: "a", parameterType: "text" }] }, { a: "1" }).ok, "unsupported component rejected");
  assert(!B.renderWhatsAppTemplateComponents({ bindingVersion: 1, bindings: [{ component: "body", position: 1, sourceKey: "a", parameterType: "image" }] }, { a: "1" }).ok, "unsupported parameter type rejected");
  // undeclared (extra) source variable rejected
  assert(!B.renderWhatsAppTemplateComponents({ bindingVersion: 1, bindings: [{ component: "body", position: 1, sourceKey: "a", parameterType: "text" }] }, { a: "1", extra: "2" }).ok, "undeclared source variable rejected");
  // the proven OTP binding renders exactly one body param from source_key otp
  const otp = B.renderWhatsAppTemplateComponents({ bindingVersion: 1, bindings: [{ component: "body", position: 1, sourceKey: "otp", parameterType: "text" }] }, { otp: "483920" });
  assert(otp.ok && otp.components[0].parameters[0].text === "483920", "otp body binding renders");
});

check("61b. render failure means ZERO provider calls (adapter fails closed pre-network)", async () => {
  const transport = fakeTransport(() => ({ kind: "response", status: 200, bodyText: '{"messages":[{"id":"x"}]}', truncated: false }));
  const provider = new M.Provider.MetaCloudWhatsAppProvider(META_CONFIG, transport);
  const badResolved = {
    internalTemplateKey: "client_login_otp", providerTemplateName: "qf", providerTemplateId: null,
    language: "en", version: "1.0", providerKey: "meta_whatsapp_cloud", channel: "whatsapp",
    variablesSchema: { bindingVersion: 1, bindings: [{ component: "body", position: 1, sourceKey: "otp", parameterType: "text" }] },
  };
  const res = await provider.sendResolvedTemplate("+15550001111", badResolved, { wrong: "x" });
  assert(res.accepted === false && /RENDER/.test(res.errorCode), "render failure surfaced");
  assert(transport.calls.length === 0, "ZERO network calls on render failure");
});

// ============================================================================
// HTTP + META SEND (62–79)
// ============================================================================
const RESOLVED_OTP = {
  internalTemplateKey: "client_login_otp", providerTemplateName: "qf_login_otp", providerTemplateId: "tid_1",
  language: "en", version: "1.0", providerKey: "meta_whatsapp_cloud", channel: "whatsapp",
  variablesSchema: { bindingVersion: 1, bindings: [{ component: "body", position: 1, sourceKey: "otp", parameterType: "text" }] },
};
check("62-65. correct endpoint + Bearer header + content-type + template payload structure", async () => {
  const transport = fakeTransport(() => ({ kind: "response", status: 200, bodyText: '{"messages":[{"id":"wamid.ABC"}]}', truncated: false }));
  const provider = new M.Provider.MetaCloudWhatsAppProvider(META_CONFIG, transport);
  await provider.sendResolvedTemplate("+15550001111", RESOLVED_OTP, { otp: "483920" });
  const req = transport.calls[0];
  assert(req.url === "https://graph.facebook.com/v19.0/PN_123/messages", `endpoint correct, got ${req.url}`);
  assert(req.headers.Authorization === "Bearer SUPER_SECRET_TOKEN_VALUE", "Bearer header present");
  assert(req.headers["Content-Type"] === "application/json", "content type json");
  const body = JSON.parse(req.body);
  assert(body.messaging_product === "whatsapp" && body.type === "template", "template message type");
  assert(body.to === "15550001111", "recipient digits without +");
  assert(body.template.name === "qf_login_otp" && body.template.language.code === "en", "template name + language");
  assert(body.template.components[0].parameters[0].text === "483920", "rendered otp param");
});

check("66-71. token never in result; abort signal attached; timeout aborts; no Promise.race; no retry; bounded read", async () => {
  // 66 — token never appears in a RESULT/error (it travels only in the request header).
  const transport = fakeTransport(() => ({ kind: "response", status: 400, bodyText: '{"error":{"code":131026}}', truncated: false }));
  const provider = new M.Provider.MetaCloudWhatsAppProvider(META_CONFIG, transport);
  const res = await provider.sendResolvedTemplate("+15550001111", RESOLVED_OTP, { otp: "1" });
  assert(!JSON.stringify(res).includes("SUPER_SECRET_TOKEN_VALUE"), "token never in send result/error");
  // 67-69 — transport source uses AbortController/signal, not Promise.race.
  const tsrc = readFileSync(TRANSPORT_SRC, "utf8");
  assert(/new AbortController\(\)/.test(tsrc) && /signal: controller\.signal/.test(tsrc), "AbortController + signal attached");
  assert(/setTimeout\(\(\) => controller\.abort\(\)/.test(tsrc), "timeout aborts the actual request");
  assert(!/Promise\.race/.test(stripTs(tsrc)), "no Promise.race pseudo-timeout");
  // 70 — no retry loop inside the adapter.
  const psrc = stripTs(readFileSync(PROVIDER_SRC, "utf8"));
  assert(!/for\s*\(|while\s*\(|\.retry|retryLoop/i.test(psrc.replace(/retryable/g, "")), "no retry loop inside the adapter");
  // 71 — bounded response reading.
  assert(/maxResponseBytes/.test(tsrc) && /readBounded/.test(tsrc), "response reading is bounded");
  // 68 — the timeout aborts a REAL fake transport: a transport returning aborted → unknown.
  const aborter = fakeTransport(() => ({ kind: "aborted" }));
  const p2 = new M.Provider.MetaCloudWhatsAppProvider(META_CONFIG, aborter);
  const r2 = await p2.sendResolvedTemplate("+15550001111", RESOLVED_OTP, { otp: "1" });
  assert(r2.outcomeCertainty === "unknown_outcome", "aborted → unknown_outcome");
});

check("72-79. outcome certainty conservative; unknown never auto-fallback; no SMS fallback", async () => {
  const P = M.Provider;
  const mk = (t) => new P.MetaCloudWhatsAppProvider(META_CONFIG, fakeTransport(() => t));
  const send = (prov) => prov.sendResolvedTemplate("+15550001111", RESOLVED_OTP, { otp: "1" });
  // 72 valid acceptance → accepted
  const acc = await send(mk({ kind: "response", status: 200, bodyText: '{"messages":[{"id":"wamid.OK"}]}', truncated: false }));
  assert(acc.accepted === true && acc.providerMessageId === "wamid.OK" && acc.outcomeCertainty === "accepted", "acceptance");
  // 73 2xx without usable id → unknown
  const noid = await send(mk({ kind: "response", status: 200, bodyText: '{"messages":[]}', truncated: false }));
  assert(noid.accepted === false && noid.outcomeCertainty === "unknown_outcome", "2xx no id → unknown");
  // 74 timeout → unknown ; 75 network ambiguity → unknown ; 76 5xx → unknown
  assert((await send(mk({ kind: "aborted" }))).outcomeCertainty === "unknown_outcome", "timeout unknown");
  assert((await send(mk({ kind: "network_error", code: "ECONNRESET" }))).outcomeCertainty === "unknown_outcome", "network unknown");
  assert((await send(mk({ kind: "response", status: 503, bodyText: "", truncated: false }))).outcomeCertainty === "unknown_outcome", "5xx unknown");
  // 77 explicit rejection → definitive_failure
  const rej = await send(mk({ kind: "response", status: 400, bodyText: '{"error":{"code":131047}}', truncated: false }));
  assert(rej.accepted === false && rej.outcomeCertainty === "definitive_failure", "4xx definitive_failure");
  // 78 unknown never retryable/fallback-eligible from the adapter ; 79 no SMS fallback in 5F-B files
  for (const t of [{ kind: "aborted" }, { kind: "network_error", code: null }, { kind: "response", status: 500, bodyText: "", truncated: false }]) {
    assert((await send(mk(t))).retryable === false, "unknown outcome never retryable inside adapter");
  }
  for (const f of [PROVIDER_SRC, WEBHOOK_SERVICE_SRC, SELECTION_SRC]) {
    const code = stripTs(readFileSync(f, "utf8"));
    assert(!/sendSms|smsFallback|MockSmsProvider|SmsProvider\b|fallbackChannel/i.test(code), `${f} has no SMS fallback path`);
  }
});

// ============================================================================
// WEBHOOK GET (80–84)
// ============================================================================
check("80-84. GET verification echoes challenge only on valid mode+token; token never leaked", () => {
  const W = M.Webhook;
  const ok = W.verifyMetaWebhookGetChallenge({ mode: "subscribe", verifyToken: "VERIFY_TOKEN_VALUE", challenge: "CHAL_123" }, "VERIFY_TOKEN_VALUE");
  assert(ok.ok && ok.challenge === "CHAL_123", "valid → challenge echoed");
  assert(!W.verifyMetaWebhookGetChallenge({ mode: "subscribe", verifyToken: "WRONG", challenge: "C" }, "VERIFY_TOKEN_VALUE").ok, "wrong token rejected");
  assert(!W.verifyMetaWebhookGetChallenge({ mode: "unsubscribe", verifyToken: "VERIFY_TOKEN_VALUE", challenge: "C" }, "VERIFY_TOKEN_VALUE").ok, "wrong mode rejected");
  assert(!W.verifyMetaWebhookGetChallenge({ mode: "subscribe", verifyToken: "VERIFY_TOKEN_VALUE", challenge: "" }, "VERIFY_TOKEN_VALUE").ok, "empty challenge rejected");
  assert(!W.verifyMetaWebhookGetChallenge({ mode: "subscribe", verifyToken: "V", challenge: "C" }, "").ok, "empty expected token rejected");
  // route never logs/returns the token
  const route = stripTs(readFileSync(ROUTE_SRC, "utf8"));
  assert(!/console\.(log|error|warn|info)/.test(route), "route does not log");
  // challenge only returned after valid verification (route returns FORBIDDEN otherwise)
  assert(/if \(!result\.ok\) return FORBIDDEN/.test(readFileSync(ROUTE_SRC, "utf8")), "challenge gated on verification");
});

// ============================================================================
// WEBHOOK POST + SIGNATURE (85–92)
// ============================================================================
check("85-92. POST fail-closed order; signature before parse; app secret never logged; gates", () => {
  const W = M.Webhook;
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const sig = W.computeMetaWebhookSignature(body, "APP_SECRET_VALUE");
  assert(W.verifyMetaWebhookSignature(body, sig, "APP_SECRET_VALUE") === true, "valid signature accepted");
  assert(W.verifyMetaWebhookSignature(body, "sha256=deadbeef", "APP_SECRET_VALUE") === false, "invalid signature rejected");
  assert(W.verifyMetaWebhookSignature(body, sig, "WRONG_SECRET") === false, "wrong secret rejected");
  assert(W.verifyMetaWebhookSignature(body, "", "APP_SECRET_VALUE") === false, "missing signature rejected");
  // Service enforces order: config → verify → gate → parse → classify. Verify precedes parse.
  const svc = readFileSync(WEBHOOK_SERVICE_SRC, "utf8");
  const verifyIdx = svc.indexOf("verifyMetaWebhookSignature(input.rawBody");
  const gateIdx = svc.indexOf("isWebhookProcessingEnabled(");
  const parseIdx = svc.indexOf("safeParse(input.rawBody)");
  assert(verifyIdx > 0 && parseIdx > 0 && verifyIdx < parseIdx, "signature verified before JSON parse");
  assert(gateIdx > verifyIdx && gateIdx < parseIdx, "runtime gate after verify, before parse");
  assert(/missing_signature/.test(svc), "missing signature header rejected");
  // exact raw body used for HMAC (no re-serialize before verify)
  assert(!/JSON\.stringify[\s\S]{0,40}verifyMetaWebhookSignature/.test(svc), "raw body used, not re-serialized");
  // app secret never logged
  const svcStripped = stripTs(svc);
  assert(!/console\./.test(svcStripped), "webhook service does not log");
  // 92 outbound flag independent from webhook-processing flag: gate reads webhook_processing_enabled only.
  const runtimeSvc = readFileSync(RUNTIME_SERVICE_SRC, "utf8");
  assert(/webhook_processing_enabled === true/.test(runtimeSvc), "webhook gate reads webhook_processing_enabled");
  assert(/isWebhookProcessingEnabled/.test(svc) && !/outbound_enabled/.test(svcStripped), "webhook path does not require outbound_enabled");
});

// ============================================================================
// NORMALIZATION (93–100)
// ============================================================================
function deliveryPayload(statuses) {
  return { object: "whatsapp_business_account", entry: [{ id: "WABA_456", changes: [{ field: "messages", value: { statuses } }] }] };
}
check("93-100. Meta status normalization conservative; drop unknown/incomplete; multi-status", () => {
  const W = M.Webhook;
  const ev = (id, status, ts) => ({ id, status, timestamp: ts, recipient_id: "15550001111" });
  const out = W.normalizeMetaDeliveryWebhook(deliveryPayload([
    ev("m1", "sent", "1700000000"), ev("m2", "delivered", "1700000001"),
    ev("m3", "read", "1700000002"), ev("m4", "failed", "1700000003"),
  ]));
  const byId = Object.fromEntries(out.map((e) => [e.providerMessageId, e.normalizedEventType]));
  assert(byId.m1 === "sent" && byId.m2 === "delivered" && byId.m3 === "read" && byId.m4 === "failed", "statuses map 1:1");
  assert(out.length === 4, "multiple statuses supported");
  // unknown status dropped
  assert(W.normalizeMetaDeliveryWebhook(deliveryPayload([ev("m", "accepted", "1700000000")])).length === 0, "unknown status dropped");
  assert(W.normalizeMetaDeliveryWebhook(deliveryPayload([ev("m", "bogus", "1700000000")])).length === 0, "bogus status dropped");
  // missing message id dropped
  assert(W.normalizeMetaDeliveryWebhook(deliveryPayload([{ status: "sent", timestamp: "1700000000" }])).length === 0, "missing id dropped");
  // invalid timestamp dropped
  assert(W.normalizeMetaDeliveryWebhook(deliveryPayload([ev("m", "sent", "notanumber")])).length === 0, "invalid timestamp dropped");
  assert(W.normalizeMetaDeliveryWebhook(deliveryPayload([ev("m", "sent", "0")])).length === 0, "zero timestamp dropped");
  // no phone/PII in the event or its derived id
  const single = W.normalizeMetaDeliveryWebhook(deliveryPayload([ev("m1", "sent", "1700000000")]))[0];
  assert(!JSON.stringify(single).includes("15550001111"), "no recipient phone in normalized event");
});

// ============================================================================
// CLASSIFICATION + DEDUP EVENT ID (non-delivery + 101-108 partial)
// ============================================================================
check("109-111. classification distinguishes delivery/inbound/template/account/unknown", () => {
  const W = M.Webhook;
  assert(W.classifyMetaWebhook(deliveryPayload([{ id: "m", status: "sent", timestamp: "1700000000" }])) === "delivery_status", "delivery classified");
  const inbound = { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messages: [{ id: "x" }] } }] }] };
  assert(W.classifyMetaWebhook(inbound) === "inbound_message", "inbound classified");
  const tpl = { object: "whatsapp_business_account", entry: [{ changes: [{ field: "message_template_status_update", value: { event: "APPROVED" } }] }] };
  assert(W.classifyMetaWebhook(tpl) === "template_status", "template status classified");
  const acct = { object: "whatsapp_business_account", entry: [{ changes: [{ field: "account_update", value: { x: 1 } }] }] };
  assert(W.classifyMetaWebhook(acct) === "account_status", "account status classified");
  assert(W.classifyMetaWebhook({ object: "other" }) === "unknown", "unknown object → unknown");
  assert(W.classifyMetaWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "weird", value: {} }] }] }) === "unknown", "unknown field → unknown");
});

check("22-dedup. deterministic PII-free event ids; identical payload → identical id", () => {
  const W = M.Webhook;
  const p = deliveryPayload([{ id: "m1", status: "sent", timestamp: "1700000000", recipient_id: "15550001111" }]);
  const id1 = W.deriveMetaWebhookEventId(p);
  const id2 = W.deriveMetaWebhookEventId(JSON.parse(JSON.stringify(p)));
  assert(id1 === id2, "same payload → same id");
  assert(!id1.includes("15550001111"), "no phone in derived id");
  const evId = W.deriveMetaDeliveryEventId("m1", "sent", "1700000000");
  assert(evId === W.deriveMetaDeliveryEventId("m1", "sent", "1700000000"), "per-event id deterministic");
  assert(!evId.includes("15550001111"), "per-event id PII-free");
});

check("112-114. webhook service: inbound classified but NOT processed; no n8n/Jarvis; delivery-only processWebhook", () => {
  const svc = readFileSync(WEBHOOK_SERVICE_SRC, "utf8");
  const svcStripped = stripTs(svc);
  // Only delivery_status reaches processWebhook (lifecycle). Non-delivery is acknowledged.
  assert(/classification === MetaWebhookClassification\.DELIVERY_STATUS/.test(svc), "delivery-only lifecycle guard");
  assert(/acknowledged_ignored/.test(svc), "known non-delivery acknowledged only");
  assert(!/n8n/i.test(svcStripped) && !/jarvis/i.test(svcStripped), "no n8n / Jarvis in webhook service");
  // no outbound send is generated from an inbound payload (no send/provider dispatch call here)
  assert(!/sendResolvedTemplate|sendTemplateMessage|\.send\(/.test(svcStripped), "webhook path triggers no outbound send");
});

// ============================================================================
// HEALTH (115–120)
// ============================================================================
check("115-118. health check uses injected transport, abortable, sanitized, no plaintext phone", async () => {
  const transport = fakeTransport(() => ({ kind: "response", status: 200, bodyText: '{"id":"PN_123","quality_rating":"GREEN","display_phone_number":"+15550001111"}', truncated: false }));
  const provider = new M.Provider.MetaCloudWhatsAppProvider(META_CONFIG, transport);
  const health = await provider.healthCheck();
  assert(health.provider === "meta_whatsapp_cloud" && health.configured === true, "health identity");
  assert(health.detailsSanitized.phoneNumberIdMatches === true, "phone number id match reported");
  assert(!JSON.stringify(health).includes("15550001111"), "no display phone in health result");
  assert(!JSON.stringify(health).includes("SUPER_SECRET_TOKEN_VALUE"), "no token in health result");
  assert(transport.calls[0].url === "https://graph.facebook.com/v19.0/PN_123?fields=id,quality_rating,name_status,code_verification_status", "read-only lookup url");
  // timeout abortable
  const aborter = fakeTransport(() => ({ kind: "aborted" }));
  const h2 = await new M.Provider.MetaCloudWhatsAppProvider(META_CONFIG, aborter).healthCheck();
  assert(h2.reachable === false && h2.status === "unhealthy", "aborted health → unhealthy");
});

check("119-120. health disabled by default + persistence gated; no cron/background monitor", () => {
  const hsvc = readFileSync(HEALTH_SERVICE_SRC, "utf8");
  const hsvcStripped = stripTs(hsvc);
  assert(/health_check_enabled !== true/.test(hsvc), "health persistence requires health_check_enabled");
  assert(/health_check_disabled/.test(hsvc), "disabled reason present");
  assert(!/setInterval|setTimeout|\bcron\b|schedule|n8n/i.test(hsvcStripped), "no cron/interval/background monitor");
  // seed ships health_check_enabled false
  assert(SQL.runtimeSeed.health_check_enabled === "false", "seed disables health checks");
  // persistence never writes secrets
  assert(!/access_token|app_secret|display_phone|verify_token|raw_response/i.test(hsvcStripped), "health persistence writes no secret/phone");
});

// ============================================================================
// MIGRATION SAFETY (121–131)
// ============================================================================
check("121-131. migration: no secrets, RLS on, no browser policies, least-privilege grants, nothing seeded", () => {
  const s = SQL.stripped;
  for (const body of [SQL.tables.runtime, SQL.tables.canary]) {
    assertNoForbidden(body, [/\btoken\b/i, /secret/i, /access_token/i, /app_secret/i, /verify_token/i, /\bphone_e164\b/i, /\bmsisdn\b/i, /\botp\b/i, /credential/i, /private_key/i], "table");
  }
  // RLS enabled for both
  assert(/alter table public\.communication_provider_runtime_policies\s+enable row level security/i.test(s), "runtime RLS on");
  assert(/alter table public\.communication_provider_canary_destinations enable row level security/i.test(s), "canary RLS on");
  // zero browser policies
  assert(!/create policy/i.test(s), "no browser policies");
  // anon/authenticated revoked; service_role select/insert/update only, no delete/truncate
  assert(/revoke all on public\.communication_provider_runtime_policies\s+from anon/i.test(s), "revoke anon runtime");
  assert(/revoke all on public\.communication_provider_canary_destinations from authenticated/i.test(s), "revoke authenticated canary");
  assert(/grant select, insert, update on public\.communication_provider_runtime_policies\s+to service_role/i.test(s), "runtime least-privilege grant");
  assert(/grant select, insert, update on public\.communication_provider_canary_destinations to service_role/i.test(s), "canary least-privilege grant");
  assert(!/grant[^;]*delete[^;]*to service_role/i.test(s) && !/truncate/i.test(s), "no delete/truncate grant");
  // no automation enablement / no provider account / mapping / canary seeded
  assert(!/insert into public\.communication_provider_accounts/i.test(s), "no provider account seeded");
  assert(!/insert into public\.communication_provider_template_mappings/i.test(s), "no mapping seeded");
  assert(!/insert into public\.communication_provider_canary_destinations/i.test(s), "no canary seeded");
  assert(!/outbound_enabled\s*(=|,)\s*true/i.test(s) && !/webhook_processing_enabled\s*(=|,)\s*true/i.test(s), "nothing enabled in migration");
  // additive 'ignored' webhook status added fail-loud
  assert(/'ignored'/.test(s) && /refusing to widen/i.test(s), "additive ignored status with fail-loud guard");
  // no activation trigger / function
  assert(!/create trigger/i.test(s) && !/create (or replace )?function/i.test(s.replace(/do \$\$/gi, "")), "no activation trigger/function");
});

check("boundaries. WABA subscription + template governance boundaries documented; no auto-subscribe", () => {
  const runbook = readFileSync(RUNBOOK_DOC, "utf8");
  assert(/NOT COMPLETE/.test(runbook), "runbook clearly not complete");
  assert(/subscription/i.test(runbook) && /no code path/i.test(runbook), "no auto WABA subscription");
  // No code performs a WABA subscription call.
  for (const f of [PROVIDER_SRC, WEBHOOK_SERVICE_SRC, ROUTE_SRC, SELECTION_SRC, HEALTH_SERVICE_SRC]) {
    assert(!/subscribed_apps|\/subscribe/i.test(readFileSync(f, "utf8")), `${f} performs no WABA subscription`);
  }
  // manifest: still draft, no fabricated provider names/ids; OTP bindings resolved
  const manifest = JSON.parse(readFileSync(MANIFEST_SRC, "utf8"));
  const otp = manifest.groups.authentication.find((t) => t.internal_template_key === "client_login_otp");
  assert(otp.approval_status === "draft" && otp.provider_template_name === null && otp.provider_template_id === null, "no fabricated approval/name/id");
  assert(otp.binding_contract.binding_readiness === "resolved" && otp.binding_contract.bindings[0].source_key === "otp", "otp binding resolved from proven source key");
  const biz = manifest.groups.transactional_business.find((t) => t.internal_template_key === "vendor_new_lead");
  assert(biz.binding_contract.binding_readiness === "unresolved", "business binding unresolved (not guessed)");
});

// ============================================================================
// UNKNOWN-OUTCOME LEDGER STATE (G1–15)  — behavioral, via compiled CommunicationService
// ============================================================================
const DEST = "+15550009999";
const UNKNOWN_RESULT = { accepted: false, provider: "metafake", providerMessageId: null, normalizedStatus: "failed", errorCode: "META_TIMEOUT", errorMessage: "t", retryable: false, outcomeCertainty: "unknown_outcome" };
function seedMessage(over = {}) {
  const row = {
    id: crypto.randomUUID(), message_type: "vendor_new_lead", lane: "business", channel: "whatsapp",
    recipient_type: "vendor", recipient_id: "v1", destination_source: "recipient_reference",
    destination_hash: M.Phone.hashPhoneE164(DEST), destination_masked: "masked", template_key: null,
    entity_type: null, entity_id: null, correlation_id: null, idempotency_key: crypto.randomUUID(),
    policy_decision_id: null, status: "queued", priority: "normal", scheduled_at: null,
    attempt_count: 0, max_attempts: 5, next_retry_at: null, provider: "metafake",
    provider_message_id: null, failure_code: null, failure_reason_sanitized: null, variables: {},
    metadata: {}, created_at: new Date().toISOString(), accepted_at: null, sent_at: null,
    delivered_at: null, read_at: null, failed_at: null, updated_at: new Date().toISOString(), ...over,
  };
  db.communication_messages.push(row);
  return row;
}
function fakeProvider(sendResult) {
  return {
    providerKey: "metafake", channel: "whatsapp", templateResolutionMode: "internal_template",
    async sendAuthenticationMessage() { return sendResult; },
    async sendTemplateMessage() { return sendResult; },
    verifyWebhookSignature() { return false; }, deriveWebhookEventId() { return "x"; },
    normalizeWebhook() { return []; }, async healthCheck() { return {}; },
  };
}
function stubDb(build) { build.Supabase.adminClient = () => ({ from: (t) => new QB(t) }); }
async function runUnknownDispatch(build) {
  resetDb();
  const msg = seedMessage();
  const svc = new build.Comm.CommunicationService(fakeProvider(UNKNOWN_RESULT), new build.Resolver.StaticCommunicationRecipientResolver({ "vendor:v1": DEST }));
  await svc.dispatchMessage(msg, { rawVariables: {} });
  return db.communication_messages.find((m) => m.id === msg.id);
}

check("G1-8. unknown_outcome persists as outcome_unknown (no retry/dead_letter/failed_at)", async () => {
  const row = await runUnknownDispatch(M);
  assert(row.status === "outcome_unknown", `status outcome_unknown, got ${row.status}`); // G1-4
  assert(row.next_retry_at === null, "no next_retry_at");           // G5
  assert(!row.failed_at, "no failed_at stamped");                    // G6
  assert(row.status !== "retry_scheduled", "not retry-scheduled");   // G7
  assert(row.status !== "dead_letter", "not dead-lettered");         // G8
});

check("G9-10. outcome_unknown is not dispatchable by the retry worker; no SMS fallback path", async () => {
  resetDb();
  const msg = seedMessage({ status: "outcome_unknown" });
  const svc = new M.Comm.CommunicationService(fakeProvider(UNKNOWN_RESULT), new M.Resolver.StaticCommunicationRecipientResolver({ "vendor:v1": DEST }));
  const res = await svc.dispatchPersistedMessage(msg.id);
  assert(!res.ok, "outcome_unknown is not re-dispatchable by the retry worker"); // G9
  const commSrc = stripTs(readFileSync(COMM_SERVICE_SRC, "utf8"));
  assert(!/sendSms|smsFallback|SmsProvider|fallbackChannel/i.test(commSrc), "no SMS fallback path"); // G10
});

check("G11-15. outcome_unknown → sent/delivered/read/failed only; backwards + retry/dead_letter blocked", () => {
  const { isValidTransition } = M.Comm;
  for (const to of ["sent", "delivered", "read", "failed"]) assert(isValidTransition("outcome_unknown", to) === true, `outcome_unknown → ${to} allowed`); // G11-14
  for (const to of ["retry_scheduled", "dispatching", "dead_letter", "accepted", "queued"]) assert(isValidTransition("outcome_unknown", to) === false, `outcome_unknown → ${to} blocked`);
  assert(isValidTransition("dispatching", "outcome_unknown") === true, "dispatching → outcome_unknown allowed");
  for (const from of ["sent", "delivered", "read", "failed"]) assert(isValidTransition(from, "outcome_unknown") === false, `${from} → outcome_unknown blocked (backwards)`); // G15
});

// ============================================================================
// OUTCOME CONTRACT (16–21)
// ============================================================================
check("16-21. outcome certainty required + emitted; conservative normalization; contradiction fails closed", async () => {
  const WP = M.req("./lib/communication/providers/whatsappProvider.js");
  const PE = M.req("./lib/communication/providers/providerError.js");
  assert(typeof WP.effectiveOutcomeCertainty === "function" && typeof WP.isContradictorySendResult === "function", "certainty helpers exist"); // 16
  const mock = new M.Mock.MockWhatsAppProvider();
  assert((await mock.sendTemplateMessage("+15550001111", "t", { a: "1" })).outcomeCertainty === "accepted", "mock accepted → accepted"); // 17
  assert((await mock.sendTemplateMessage(M.Mock.MOCK_DESTINATIONS.PERMANENT_FAILURE, "t", {})).outcomeCertainty === "definitive_failure", "mock permanent → definitive_failure");
  const meta = new M.Provider.MetaCloudWhatsAppProvider(META_CONFIG, fakeTransport(() => ({ kind: "response", status: 200, bodyText: '{"messages":[{"id":"x"}]}', truncated: false })));
  assert((await meta.sendResolvedTemplate("+15550001111", RESOLVED_OTP, { otp: "1" })).outcomeCertainty === "accepted", "meta emits certainty"); // 18
  assert(PE.normalizeProviderException(new Error("boom"), "meta_whatsapp_cloud").outcomeCertainty === "unknown_outcome", "unclassified throw → unknown_outcome"); // 19
  const transport = PE.normalizeProviderException(Object.assign(new Error("x"), { code: "ECONNRESET" }), "meta_whatsapp_cloud");
  assert(transport.outcomeCertainty === "unknown_outcome" && transport.retryable === false, "ambiguous transport throw → unknown_outcome + never retried");
  const preconnect = PE.normalizeProviderException(Object.assign(new Error("x"), { code: "ENOTFOUND" }), "meta_whatsapp_cloud");
  assert(preconnect.outcomeCertainty === "definitive_failure" && preconnect.retryable === true, "proven pre-connect throw → definitive_failure + retryable");
  const aborted = PE.normalizeProviderException(Object.assign(new Error("x"), { name: "AbortError" }), "meta_whatsapp_cloud");
  assert(aborted.outcomeCertainty === "unknown_outcome" && aborted.retryable === false, "abort/timeout throw → unknown_outcome + never retried");
  assert(WP.effectiveOutcomeCertainty({ accepted: false }) === "unknown_outcome", "missing certainty on failure → unknown_outcome"); // 20
  assert(WP.effectiveOutcomeCertainty({ accepted: true }) === "unknown_outcome", "missing certainty on accepted → unknown_outcome (never inferred accepted)");
  assert(WP.isContradictorySendResult({ accepted: true, outcomeCertainty: "definitive_failure" }) === true, "accepted+definitive contradictory"); // 21
  assert(WP.effectiveOutcomeCertainty({ accepted: true, outcomeCertainty: "definitive_failure" }) === "unknown_outcome", "contradiction → unknown_outcome");
});

// ============================================================================
// AUTH TIMEOUT (22–29)
// ============================================================================
check("22-29. auth send uses auth timeout; business uses business; below hook budget; abortable; no Promise.race", async () => {
  const C = M.Config;
  assert(C.AUTH_TIMEOUT_MAX_MS <= 4000 && C.AUTH_TIMEOUT_MIN_MS >= 500, "auth timeout bounded well below the hook window"); // 24
  const bad = C.resolveOutboundMetaConfig(completeMetaEnv({ WHATSAPP_AUTH_HTTP_TIMEOUT_MS: "120000" }));
  assert(!bad.ok && bad.invalid.includes("WHATSAPP_AUTH_HTTP_TIMEOUT_MS"), "120000 rejected for auth timeout"); // 28
  const authT = fakeTransport(() => ({ kind: "response", status: 200, bodyText: '{"messages":[{"id":"a"}]}', truncated: false }));
  await new M.Provider.MetaCloudWhatsAppProvider(META_CONFIG, authT).sendResolvedTemplate("+15550001111", RESOLVED_OTP, { otp: "1" }, { lane: "authentication" });
  assert(authT.calls[0].timeoutMs === META_CONFIG.authHttpTimeoutMs, `auth send uses auth timeout ${authT.calls[0].timeoutMs}`); // 22, 25
  const bizT = fakeTransport(() => ({ kind: "response", status: 200, bodyText: '{"messages":[{"id":"b"}]}', truncated: false }));
  await new M.Provider.MetaCloudWhatsAppProvider(META_CONFIG, bizT).sendResolvedTemplate("+15550001111", RESOLVED_OTP, { otp: "1" }, { lane: "business" });
  assert(bizT.calls[0].timeoutMs === META_CONFIG.businessHttpTimeoutMs, "business send uses business timeout"); // 23, 26
  const tsrc = readFileSync(TRANSPORT_SRC, "utf8");
  assert(/signal: controller\.signal/.test(tsrc) && !/Promise\.race/.test(stripTs(tsrc)), "abortable, no Promise.race"); // 27
  const abortT = fakeTransport(() => ({ kind: "aborted" }));
  const r3 = await new M.Provider.MetaCloudWhatsAppProvider(META_CONFIG, abortT).sendResolvedTemplate("+15550001111", RESOLVED_OTP, { otp: "1" }, { lane: "authentication" });
  assert(r3.outcomeCertainty === "unknown_outcome", "auth timeout expiry → unknown_outcome"); // 29
});

// ============================================================================
// CONFIG SEPARATION (30–39)
// ============================================================================
check("30-39. purpose-specific loaders require only their own vars; errors are names-only", () => {
  const C = M.Config;
  assert(C.resolveWebhookVerifyConfig({ WHATSAPP_WEBHOOK_VERIFY_TOKEN: "V" }).ok, "GET verify works with verify token only"); // 30-33
  assert(!C.resolveWebhookVerifyConfig({}).ok, "GET verify needs verify token");
  assert(C.resolveWebhookSignatureConfig({ WHATSAPP_APP_SECRET: "S" }).ok, "POST signature works with app secret only"); // 34-35
  assert(!C.resolveWebhookSignatureConfig({}).ok, "POST signature needs app secret");
  const outEnv = { WHATSAPP_ACCESS_TOKEN: "T", WHATSAPP_PHONE_NUMBER_ID: "P", WHATSAPP_WABA_ID: "W", WHATSAPP_GRAPH_API_VERSION: "v19.0", WHATSAPP_AUTH_HTTP_TIMEOUT_MS: "3000", WHATSAPP_HTTP_TIMEOUT_MS: "5000" };
  assert(C.resolveOutboundMetaConfig(outEnv).ok, "outbound resolves WITHOUT app secret / verify token"); // 36-37
  const healthEnv = { WHATSAPP_ACCESS_TOKEN: "T", WHATSAPP_PHONE_NUMBER_ID: "P", WHATSAPP_GRAPH_API_VERSION: "v19.0", WHATSAPP_HTTP_TIMEOUT_MS: "5000" };
  assert(C.resolveHealthConfig(healthEnv).ok, "health resolves WITHOUT verify token / app secret"); // 38
  const f = C.resolveOutboundMetaConfig({ WHATSAPP_ACCESS_TOKEN: "SECRETV" });
  assert(!f.ok && JSON.stringify(f).indexOf("SECRETV") === -1, "errors reveal names only (no values)"); // 39
});

// ============================================================================
// WEBHOOK ACK (40–49)  — behavioral, via compiled webhook service
// ============================================================================
function seedWebhookPolicy(over = {}) {
  db.communication_provider_runtime_policies.push({ provider_key: "meta_whatsapp_cloud", channel: "whatsapp", activation_status: "canary", outbound_enabled: false, webhook_processing_enabled: true, health_check_enabled: false, ...over });
}
function setMetaEnv() {
  process.env.WHATSAPP_PROVIDER_MODE = "meta_cloud";
  process.env.WHATSAPP_APP_SECRET = "APP_SECRET_VALUE";
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "V";
}
const NON_DELIVERY = {
  inbound: JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messages: [{ id: "x" }] } }] }] }),
  template: JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "message_template_status_update", value: { event: "APPROVED" } }] }] }),
  account: JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "account_update", value: {} }] }] }),
  unknown: JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "weird", value: {} }] }] }),
};
check("40-49. verified non-delivery + unknown → 200 ack (no mutation/send/n8n/jarvis); malformed 400; bad sig 401", async () => {
  const W = M.Webhook, WS = M.WebhookSvc;
  resetDb(); seedWebhookPolicy(); setMetaEnv();
  const sign = (b) => W.computeMetaWebhookSignature(b, "APP_SECRET_VALUE");
  for (const [k, body] of [["inbound", NON_DELIVERY.inbound], ["template", NON_DELIVERY.template], ["account", NON_DELIVERY.account]]) {
    const res = await WS.handleMetaWhatsAppWebhookPost({ rawBody: body, signature: sign(body) });
    assert(res.status === 200 && res.result === "acknowledged_ignored", `${k} → 200 ack, got ${JSON.stringify(res)}`); // 40-42
  }
  const ures = await WS.handleMetaWhatsAppWebhookPost({ rawBody: NON_DELIVERY.unknown, signature: sign(NON_DELIVERY.unknown) });
  assert(ures.status === 200 && ures.result === "acknowledged_unknown", "unknown → 200 ack"); // 43
  assert(db.communication_messages.length === 0, "no message lifecycle mutation from ignored classes"); // 44-45
  assert(db.communication_webhook_receipts.length > 0 && db.communication_webhook_receipts.every((r) => r.processing_status === "ignored"), "only ignored receipts recorded");
  const mres = await WS.handleMetaWhatsAppWebhookPost({ rawBody: "{not json", signature: sign("{not json") });
  assert(mres.status === 400, "malformed JSON → 400"); // 48
  const badSig = await WS.handleMetaWhatsAppWebhookPost({ rawBody: NON_DELIVERY.inbound, signature: "sha256=deadbeef" });
  assert(badSig.status === 401, "invalid signature → 401"); // 49
  const svc = stripTs(readFileSync(WEBHOOK_SERVICE_SRC, "utf8"));
  assert(!/n8n/i.test(svc) && !/jarvis/i.test(svc), "no n8n / Jarvis"); // 46-47
});

// ============================================================================
// PRODUCTION PROVIDER MODE (50–54)
// ============================================================================
check("50-54. production fail-closed provider mode; lazy (no import-time validation)", () => {
  const C = M.Config, S = M.Selection;
  const t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: "{}", truncated: false }));
  const d1 = C.resolveProviderModeDecision({});
  assert(d1.ok && d1.mode === "mock" && d1.explicit === false, "non-prod missing → mock"); // 50
  assert(C.resolveProviderModeDecision({ NODE_ENV: "development" }).mode === "mock", "dev missing → mock");
  const d2 = C.resolveProviderModeDecision({ NODE_ENV: "production" });
  assert(!d2.ok && d2.reason === "mode_required_in_production", "production missing → fail closed"); // 51
  const d3 = C.resolveProviderModeDecision({ NODE_ENV: "production", WHATSAPP_PROVIDER_MODE: "mock" });
  assert(d3.ok && d3.mode === "mock" && d3.explicit === true, "production explicit mock → mock"); // 52
  const sel = S.selectWhatsAppProvider(completeMetaEnv({ NODE_ENV: "production" }), t);
  assert(sel.ok && sel.mode === "meta_cloud", "production explicit meta → meta (never mock)"); // 53
  const selNoMode = S.selectWhatsAppProvider({ NODE_ENV: "production" }, t);
  assert(!selNoMode.ok && selNoMode.reason === "mode_required_in_production", "production missing mode selection fails closed");
  // 54 — lazy: neither module executes resolution / throws at import time.
  assert(!/throw /.test(stripTs(readFileSync(CONFIG_SRC, "utf8"))), "config never throws (names-only failures)");
  assert(!/^(resolve|select)\w+\(/m.test(stripTs(readFileSync(SELECTION_SRC, "utf8"))), "selection has no top-level resolution call");
});

// ============================================================================
// CANONICAL OUTCOME DECISION ORDER (D1–16)  — behavioral
// ============================================================================
let providerCallCount = 0;
function countingProvider(result) {
  return {
    providerKey: "metafake", channel: "whatsapp", templateResolutionMode: "internal_template",
    async sendAuthenticationMessage() { providerCallCount += 1; return result; },
    async sendTemplateMessage() { providerCallCount += 1; return result; },
    verifyWebhookSignature() { return false; }, deriveWebhookEventId() { return "x"; },
    normalizeWebhook() { return []; }, async healthCheck() { return {}; },
  };
}
async function dispatchResult(result, over = {}) {
  resetDb(); providerCallCount = 0;
  const msg = seedMessage(over);
  const svc = new M.Comm.CommunicationService(countingProvider(result), new M.Resolver.StaticCommunicationRecipientResolver({ "vendor:v1": DEST }));
  await svc.dispatchMessage(msg, { rawVariables: {} });
  return db.communication_messages.find((m) => m.id === msg.id);
}
const ACCEPTED_MISSING = { accepted: true, provider: "metafake", providerMessageId: "x", normalizedStatus: "accepted", errorCode: null, errorMessage: null, retryable: false };
const FAIL_MISSING = { accepted: false, provider: "metafake", providerMessageId: null, normalizedStatus: "failed", errorCode: "X", errorMessage: "x", retryable: false };
const R = (over) => ({ ...FAIL_MISSING, outcomeCertainty: "unknown_outcome", ...over });

check("D1-16. canonical outcome decision order (unknown dominates; missing → unknown; contradictions fail closed)", async () => {
  assert((await dispatchResult(ACCEPTED_MISSING)).status === "outcome_unknown", "1: accepted=true + missing cert → outcome_unknown");
  assert((await dispatchResult(FAIL_MISSING)).status === "outcome_unknown", "2: accepted=false + missing cert → outcome_unknown");
  assert((await dispatchResult(R({ retryable: false }))).status === "outcome_unknown", "3: unknown + retryable=false");
  assert((await dispatchResult(R({ retryable: true }))).status === "outcome_unknown", "4: unknown + retryable=true (dominance)");
  assert((await dispatchResult(R({ accepted: true }))).status === "outcome_unknown", "5: unknown + accepted=true");
  assert((await dispatchResult(R({ accepted: false }))).status === "outcome_unknown", "6: unknown + accepted=false");
  const u = await dispatchResult(R({ retryable: true }));
  assert(u.next_retry_at === null, "7: unknown+retryable → no next_retry_at");
  assert(u.status !== "retry_scheduled", "8: unknown+retryable → not retry_scheduled");
  assert(u.status !== "dead_letter", "9: unknown+retryable → not dead_letter");
  assert(providerCallCount === 1, "10: exactly one provider call (no second)");
  assert(!/sendSms|smsFallback|SmsProvider|fallbackChannel/i.test(stripTs(readFileSync(COMM_SERVICE_SRC, "utf8"))), "11: no SMS fallback path");
  assert((await dispatchResult({ ...ACCEPTED_MISSING, outcomeCertainty: "accepted" })).status === "accepted", "12: valid accepted → success");
  assert((await dispatchResult({ ...FAIL_MISSING, outcomeCertainty: "accepted" })).status === "outcome_unknown", "13: accepted cert + accepted=false → outcome_unknown");
  const df = await dispatchResult({ ...FAIL_MISSING, retryable: true, outcomeCertainty: "definitive_failure" });
  assert(df.status === "retry_scheduled", `14: definitive_failure + accepted=false → existing lane rules (retry_scheduled), got ${df.status}`);
  assert((await dispatchResult({ ...ACCEPTED_MISSING, outcomeCertainty: "definitive_failure" })).status === "outcome_unknown", "15: definitive_failure + accepted=true → outcome_unknown");
  const auth = await dispatchResult({ ...FAIL_MISSING, retryable: true, outcomeCertainty: "definitive_failure" }, { lane: "authentication", max_attempts: 1 });
  assert(auth.status === "failed", `16: authentication single-shot definitive_failure → failed, got ${auth.status}`);
});

// ============================================================================
// PROVIDER EXCEPTION CERTAINTY (E1–24)  — provable-certainty classification
// ============================================================================
function throwingProvider(err) {
  return {
    providerKey: "metafake", channel: "whatsapp", templateResolutionMode: "internal_template",
    async sendAuthenticationMessage() { providerCallCount += 1; throw err; },
    async sendTemplateMessage() { providerCallCount += 1; throw err; },
    verifyWebhookSignature() { return false; }, deriveWebhookEventId() { return "x"; },
    normalizeWebhook() { return []; }, async healthCheck() { return {}; },
  };
}
async function dispatchThrow(err, over = {}) {
  resetDb(); providerCallCount = 0;
  const msg = seedMessage(over);
  const svc = new M.Comm.CommunicationService(throwingProvider(err), new M.Resolver.StaticCommunicationRecipientResolver({ "vendor:v1": DEST }));
  await svc.dispatchMessage(msg, { rawVariables: {} });
  return db.communication_messages.find((m) => m.id === msg.id);
}
check("E1-24. provider exceptions classified by PROVABLE certainty (ambiguous → unknown, never retried)", async () => {
  const PE = M.req("./lib/communication/providers/providerError.js");
  const cls = (e) => PE.classifyProviderException(e);
  const withCode = (code) => Object.assign(new Error("x"), { code });
  const withName = (name) => Object.assign(new Error("x"), { name });
  // 1-3 unclassified / arbitrary → unknown_outcome + retryable false
  assert(cls(new Error("unexpected")).outcomeCertainty === "unknown_outcome", "1: unclassified Error → unknown_outcome");
  assert(cls(new Error("unexpected")).retryable === false, "2: unclassified Error → retryable false");
  assert(cls({ weird: true }).outcomeCertainty === "unknown_outcome" && cls("str").outcomeCertainty === "unknown_outcome" && cls(null).outcomeCertainty === "unknown_outcome", "3: arbitrary thrown object → unknown_outcome");
  // 4-9 ambiguous transport codes → unknown_outcome
  for (const [n, code] of [[4, "ECONNRESET"], [5, "EPIPE"], [6, "ETIMEDOUT"], [7, "UND_ERR_HEADERS_TIMEOUT"], [8, "UND_ERR_BODY_TIMEOUT"], [9, "UND_ERR_SOCKET"]]) {
    assert(cls(withCode(code)).outcomeCertainty === "unknown_outcome", `${n}: ${code} → unknown_outcome`);
  }
  // 10-11 abort/timeout names → unknown_outcome
  assert(cls(withName("AbortError")).outcomeCertainty === "unknown_outcome", "10: AbortError → unknown_outcome");
  assert(cls(withName("TimeoutError")).outcomeCertainty === "unknown_outcome", "11: TimeoutError → unknown_outcome");
  // 12 every ambiguous outcome is non-retryable
  for (const code of [...PE.AMBIGUOUS_TRANSPORT_CODES]) assert(cls(withCode(code)).retryable === false, `12: ${code} non-retryable`);
  for (const name of [...PE.AMBIGUOUS_ERROR_NAMES]) assert(cls(withName(name)).retryable === false, `12: ${name} non-retryable`);
  assert(cls(new Error("x")).retryable === false, "12: unclassified non-retryable");
  // 13-16 ambiguous exception → outcome_unknown ledger state, no retry, single provider call
  const row = await dispatchThrow(withCode("ECONNRESET"));
  assert(row.status === "outcome_unknown", "13: ambiguous exception → outcome_unknown ledger state");
  assert(row.next_retry_at === null, "14: no next_retry_at");
  assert(row.status !== "retry_scheduled", "15: not retry_scheduled");
  assert(providerCallCount === 1, "16: no second provider invocation");
  // 17 outcome_unknown reconciles through a later verified delivery webhook (transition allowed)
  assert(M.Comm.isValidTransition("outcome_unknown", "delivered") === true && M.Comm.isValidTransition("outcome_unknown", "sent") === true, "17: outcome_unknown → delivery reconciliation");
  // 18 proven pre-connect may retain definitive_failure + retryable=true
  for (const code of [...PE.PROVEN_PRECONNECT_FAILURE_CODES]) {
    assert(cls(withCode(code)).outcomeCertainty === "definitive_failure" && cls(withCode(code)).retryable === true, `18: ${code} → definitive_failure + retryable`);
  }
  // 19 explicit permanent ProviderDispatchError → definitive_failure, retryable false
  const perm = cls(PE.definitivePermanentProviderError("P_CODE", "m"));
  assert(perm.outcomeCertainty === "definitive_failure" && perm.retryable === false, "19: definitive-permanent typed error");
  // 20 explicit retryable ProviderDispatchError requires definitive certainty
  const dr = cls(PE.definitiveRetryableProviderError("R_CODE", "m"));
  assert(dr.outcomeCertainty === "definitive_failure" && dr.retryable === true, "20: definitive-retryable typed error");
  // 21 ProviderDispatchError unknown_outcome forces retryable=false
  const uk = new PE.ProviderDispatchError("U_CODE", "m", "unknown_outcome", true);
  assert(uk.retryable === false && uk.outcomeCertainty === "unknown_outcome", "21: unknown typed error forces retryable=false");
  // 22 thrown ProviderDispatchError cannot use accepted certainty
  const bad = new PE.ProviderDispatchError("A_CODE", "m", "accepted", true);
  assert(bad.outcomeCertainty === "unknown_outcome" && bad.retryable === false, "22: accepted certainty on a thrown failure → unknown_outcome + retryable false");
  // 23 authentication lane single-shot: a definitive permanent throw → failed (no retry)
  const auth = await dispatchThrow(PE.definitivePermanentProviderError("P_CODE", "m"), { lane: "authentication", max_attempts: 1 });
  assert(auth.status === "failed", `23: auth single-shot definitive permanent → failed, got ${auth.status}`);
  // 24 existing valid business retry path preserved: a definitive-retryable throw → retry_scheduled
  const biz = await dispatchThrow(PE.definitiveRetryableProviderError("R_CODE", "m"));
  assert(biz.status === "retry_scheduled", `24: business definitive-retryable throw → retry_scheduled, got ${biz.status}`);
});

// ============================================================================
// OUTBOUND INTEGRATION (N1–N40) — runtime selection → gate → mapping → resolved send
// ============================================================================
const RUNTIME_SERVICE_FILE = "services/runtimeCommunicationService.ts";
const OUTBOUND_SERVICE_SRC = "services/metaWhatsAppOutboundService.ts";
const META_ACCEPTED_BODY = '{"messages":[{"id":"wamid.INTEG"}]}';

function seedTemplate(over = {}) {
  db.communication_templates.push({
    id: crypto.randomUUID(), template_key: "vendor_new_lead", channel: "whatsapp", category: "business",
    description: null, language: "en", version: "1.0", provider_template_name: null, provider_template_id: null,
    readiness_status: "mock_ready", is_active: true, created_at: "", updated_at: "", ...over,
  });
}
function seedRuntimePolicyRow(over = {}) { db.communication_provider_runtime_policies.push({ ...okPolicy(), ...over }); }
function seedAccount(over = {}) { db.communication_provider_accounts.push({ ...okAccount(), ...over }); }
function seedMapping(over = {}) {
  db.communication_provider_template_mappings.push({
    id: "map-1", template_key: "vendor_new_lead", channel: "whatsapp", provider_key: "meta_whatsapp_cloud",
    language: "en", version: "1.0", provider_template_name: "qf_vendor_new_lead", provider_template_id: "tid-1",
    approval_status: "approved", is_active: true,
    variables_schema: { bindingVersion: 1, bindings: [{ component: "body", position: 1, sourceKey: "city", parameterType: "text" }] },
    ...over,
  });
}
function seedCanary(over = {}) {
  db.communication_provider_canary_destinations.push({
    provider_key: "meta_whatsapp_cloud", channel: "whatsapp", destination_hash: M.Phone.hashPhoneE164(DEST),
    is_active: true, expires_at: null, ...over,
  });
}
function bizIntent(over = {}) {
  return { type: "vendor_new_lead", lane: "business", channel: "whatsapp", recipient_type: "vendor", recipient_id: "v1",
    template_key: "vendor_new_lead", variables: { city: "Delhi" }, entity_type: null, entity_id: null,
    correlation_id: null, idempotency_key: crypto.randomUUID(), priority: "normal", scheduled_at: null,
    policy_decision_id: null, metadata: {}, ...over };
}
function authIntent(over = {}) {
  return { type: "client_login_otp", lane: "authentication", channel: "whatsapp", recipient_type: "client", recipient_id: null,
    destination_source: { kind: "ephemeral_auth_destination", destination: DEST },
    template_key: "client_login_otp", variables: { otp: "483920" }, entity_type: null, entity_id: null,
    correlation_id: null, idempotency_key: crypto.randomUUID(), priority: "critical", scheduled_at: null,
    policy_decision_id: null, metadata: {}, ...over };
}
/** REAL Meta adapter, instrumented to count bare vs resolved-descriptor dispatch. */
function spyMetaProvider(transport, build = M) {
  const p = new build.Provider.MetaCloudWhatsAppProvider(META_CONFIG, transport);
  const spy = { bare: 0, resolved: 0, lanes: [], lastResolved: null, lastVars: null };
  const oAuth = p.sendAuthenticationMessage.bind(p), oTpl = p.sendTemplateMessage.bind(p), oRes = p.sendResolvedTemplate.bind(p);
  p.sendAuthenticationMessage = async (...a) => { spy.bare += 1; return oAuth(...a); };
  p.sendTemplateMessage = async (...a) => { spy.bare += 1; return oTpl(...a); };
  p.sendResolvedTemplate = async (to, r, v, o) => { spy.resolved += 1; spy.lanes.push(o && o.lane); spy.lastResolved = r; spy.lastVars = v; return oRes(to, r, v, o); };
  return { provider: p, spy };
}
const okMetaResponse = () => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false });
function metaService(transport, build = M, coordinator = null) {
  const { provider, spy } = spyMetaProvider(transport, build);
  const coord = coordinator ?? new build.Outbound.MetaWhatsAppOutboundCoordinator(completeMetaEnv());
  const svc = new build.Comm.CommunicationService(provider, new build.Resolver.StaticCommunicationRecipientResolver({ "vendor:v1": DEST }), coord);
  return { svc, spy, provider };
}
/**
 * The REAL coordinator, instrumented. `afterInitial` simulates an operator acting in
 * the window between the early preflight and the network request (pause, disable
 * outbound, un-ready the account, expire the canary row) — the exact race the FINAL
 * network-boundary gate exists to close.
 */
function countingCoordinator(build = M, hooks = {}) {
  const real = new build.Outbound.MetaWhatsAppOutboundCoordinator(completeMetaEnv());
  const counts = { initial: 0, final: 0 };
  return {
    counts,
    async prepareInitialOutbound(input) {
      counts.initial += 1;
      const result = await real.prepareInitialOutbound(input);
      if (hooks.afterInitial) hooks.afterInitial();
      return result;
    },
    async prepareFinalOutbound(input) {
      counts.final += 1;
      return real.prepareFinalOutbound(input);
    },
  };
}
/** Fully-green Meta infrastructure: active policy, ready account, approved active mapping. */
function seedGreenMetaInfra(over = {}) {
  resetDb();
  seedTemplate(over.template);
  seedRuntimePolicyRow(over.policy);
  seedAccount(over.account);
  if (over.mapping !== null) seedMapping(over.mapping);
  if (over.canary) seedCanary(over.canary);
}

check("N1-6. the runtime path uses the selector; prod fail-closed; Meta never becomes mock", () => {
  const R = M.Runtime;
  M.Comm.clearWhatsAppProviderOverride();
  // 1 — the runtime resolution boundary genuinely consults the selector.
  assert(/selectWhatsAppProvider\(/.test(readFileSync(RUNTIME_SERVICE_FILE, "utf8")), "1: runtime path uses selectWhatsAppProvider");
  // 2 — non-production implicit mock reaches mock.
  const implicit = R.resolveRuntimeWhatsAppProvider({});
  assert(implicit.ok && implicit.data.providerKey === "mock", "2: non-prod implicit mock");
  // 3 — production missing mode fails closed.
  const prodMissing = R.resolveRuntimeWhatsAppProvider({ NODE_ENV: "production" });
  assert(!prodMissing.ok && prodMissing.code === R.RUNTIME_PROVIDER_UNAVAILABLE, "3: production missing mode fails closed");
  // 4 — explicit production mock reaches mock.
  const prodMock = R.resolveRuntimeWhatsAppProvider({ NODE_ENV: "production", WHATSAPP_PROVIDER_MODE: "mock" });
  assert(prodMock.ok && prodMock.data.providerKey === "mock", "4: explicit production mock");
  // 5 — explicit Meta reaches the Meta candidate.
  const meta = R.resolveRuntimeWhatsAppProvider(completeMetaEnv({ NODE_ENV: "production" }));
  assert(meta.ok && meta.data.providerKey === "meta_whatsapp_cloud" && meta.data.templateResolutionMode === "approved_provider_mapping", "5: explicit Meta candidate");
  // 6 — invalid Meta config NEVER reaches mock.
  const bad = R.resolveRuntimeWhatsAppProvider({ WHATSAPP_PROVIDER_MODE: "meta_cloud" });
  assert(!bad.ok, "6: invalid Meta config fails closed");
  assert(!("data" in bad), "6: no provider on failure (never a mock)");
  // The explicit override always wins (test-injection compatibility preserved).
  const mockProvider = new M.Mock.MockWhatsAppProvider();
  M.Comm.setActiveWhatsAppProvider(mockProvider);
  const overridden = R.resolveRuntimeWhatsAppProvider(completeMetaEnv());
  assert(overridden.ok && overridden.data === mockProvider, "override wins over selection");
  M.Comm.clearWhatsAppProviderOverride();
  // Real auth/business callers go through the runtime factory.
  for (const f of ["services/supabaseSendSmsHookService.ts", "services/vendorVerificationService.ts", "services/vendorPasswordResetService.ts"]) {
    assert(/createRuntimeCommunicationService\(/.test(readFileSync(f, "utf8")), `${f} uses the runtime factory`);
    assert(!/new CommunicationService\(\)/.test(readFileSync(f, "utf8")), `${f} no longer constructs a default CommunicationService`);
  }
});

check("N7-15. Meta send chain: gate + mapping run, resolved dispatch only, zero calls on any gate failure", async () => {
  // 7-11 — happy path: resolved dispatch, never a bare method.
  seedGreenMetaInfra();
  let t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
  let { svc, spy } = metaService(t);
  let res = await svc.send(bizIntent());
  assert(res.ok, `happy-path send ok: ${res.ok ? "" : res.code}`);
  assert(spy.bare === 0, "7-8: bare sendAuthenticationMessage/sendTemplateMessage never used for Meta");
  assert(spy.resolved === 1, "11: sendResolvedTemplate called exactly once");
  assert(spy.lastResolved.providerTemplateName === "qf_vendor_new_lead" && spy.lastResolved.mappingId === "map-1", "9: approved mapping resolved");
  assert(t.calls.length === 1 && t.calls[0].url.endsWith("/PN_123/messages"), "10-11: Meta network call only after gate + mapping pass");
  const row = db.communication_messages[0];
  assert(row.provider === "meta_whatsapp_cloud", "persisted provider is the runtime-selected one");
  assert(row.provider_template_mapping_id === "map-1" && row.provider_template_version === "1.0", "mapping identity pinned for restart-safe retry");

  // 12 — missing mapping → zero Meta calls, zero ledger rows.
  seedGreenMetaInfra({ mapping: null });
  t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
  ({ svc, spy } = metaService(t));
  res = await svc.send(bizIntent());
  assert(!res.ok && res.code === "META_APPROVED_MAPPING_UNRESOLVED", `12: missing mapping fails closed, got ${res.ok ? "ok" : res.code}`);
  assert(t.calls.length === 0 && spy.resolved === 0, "12: zero Meta calls");
  assert(db.communication_messages.length === 0, "12: zero ledger rows (fails before persist)");

  // 13 — runtime gate failure (outbound disabled) → zero Meta calls, zero ledger rows.
  seedGreenMetaInfra({ policy: { outbound_enabled: false } });
  t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
  ({ svc, spy } = metaService(t));
  res = await svc.send(bizIntent());
  assert(!res.ok && res.code === "META_RUNTIME_GATE_BLOCKED", `13: gate blocked, got ${res.ok ? "ok" : res.code}`);
  assert(t.calls.length === 0 && db.communication_messages.length === 0, "13: zero Meta calls, zero ledger rows");

  // 14 — canary activation without an allowlisted destination → zero Meta calls.
  seedGreenMetaInfra({ policy: { activation_status: "canary" } });
  t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
  ({ svc } = metaService(t));
  res = await svc.send(bizIntent());
  assert(!res.ok && res.code === "META_RUNTIME_GATE_BLOCKED", "14: canary without allowlist fails closed");
  assert(t.calls.length === 0 && db.communication_messages.length === 0, "14: zero Meta calls");
  // …and WITH an allowlisted destination hash it proceeds.
  seedGreenMetaInfra({ policy: { activation_status: "canary" }, canary: {} });
  t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
  ({ svc, spy } = metaService(t));
  res = await svc.send(bizIntent());
  assert(res.ok && spy.resolved === 1, "14: canary + allowlisted hash dispatches");

  // 15 — provider-account readiness failure → zero Meta calls.
  seedGreenMetaInfra({ account: { webhook_status: "pending" } });
  t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
  ({ svc } = metaService(t));
  res = await svc.send(bizIntent());
  assert(!res.ok && res.code === "META_RUNTIME_GATE_BLOCKED", "15: unready provider account fails closed");
  assert(t.calls.length === 0 && db.communication_messages.length === 0, "15: zero Meta calls");
});

check("N16-22. auth Meta path: auth timeout, OTP request-memory only, never persisted, single-shot", async () => {
  const authTemplate = { template_key: "client_login_otp", category: "authentication", language: "en" };
  const authMapping = { id: "map-otp", template_key: "client_login_otp", provider_template_name: "qf_login_otp",
    variables_schema: { bindingVersion: 1, bindings: [{ component: "body", position: 1, sourceKey: "otp", parameterType: "text" }] } };
  for (const [n, tplKey] of [[16, "client_login_otp"], [17, "vendor_whatsapp_verify"], [18, "vendor_password_reset"]]) {
    seedGreenMetaInfra({ template: { ...authTemplate, template_key: tplKey }, mapping: { ...authMapping, template_key: tplKey } });
    const t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
    const { svc, spy } = metaService(t);
    const res = await svc.send(authIntent({ template_key: tplKey, type: tplKey }));
    assert(res.ok, `${n}: auth send ok for ${tplKey}`);
    assert(spy.lanes[0] === "authentication", `${n}: dispatched on the authentication lane`);
    assert(t.calls[0].timeoutMs === META_CONFIG.authHttpTimeoutMs, `${n}: auth send uses the AUTH timeout (${t.calls[0].timeoutMs})`);
    assert(spy.bare === 0 && spy.resolved === 1, `${n}: resolved-descriptor dispatch only`);
  }
  // 19 — the OTP reaches the binding from request memory (it is in the rendered body).
  const t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
  seedGreenMetaInfra({ template: authTemplate, mapping: authMapping });
  const { svc, spy } = metaService(t);
  const res = await svc.send(authIntent());
  assert(res.ok && spy.lastVars.otp === "483920", "19: OTP reaches binding from request memory");
  assert(JSON.parse(t.calls[0].body).template.components[0].parameters[0].text === "483920", "19: OTP rendered into the Meta body");
  // 20 — the OTP is NEVER persisted on the ledger row.
  const row = db.communication_messages[0];
  assert(JSON.stringify(row.variables) === "{}", "20: auth lane persists no variables");
  assert(!JSON.stringify(row).includes("483920"), "20: OTP never persisted");
  // 21 — auth unknown outcome → outcome_unknown (no retry).
  seedGreenMetaInfra({ template: authTemplate, mapping: authMapping });
  const t2 = fakeTransport(() => ({ kind: "aborted" }));
  const r2 = await metaService(t2).svc.send(authIntent());
  assert(r2.ok && r2.data.status === "outcome_unknown", `21: auth unknown outcome → outcome_unknown, got ${r2.ok ? r2.data.status : r2.code}`);
  assert(db.communication_messages[0].next_retry_at === null, "21: no next_retry_at");
  // 22 — auth never redispatches (single-shot).
  const authRow = db.communication_messages[0];
  authRow.status = "retry_scheduled";
  const again = await metaService(fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }))).svc.dispatchPersistedMessage(authRow.id);
  assert(!again.ok, "22: authentication lane never re-dispatches");
});

check("N23-28. business Meta path: business timeout, retry rules, restart-safe deterministic mapping", async () => {
  // 23 — business send uses the BUSINESS timeout.
  seedGreenMetaInfra();
  let t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
  let { svc, spy } = metaService(t);
  let res = await svc.send(bizIntent());
  assert(res.ok && spy.lanes[0] === "business", "23: business lane");
  assert(t.calls[0].timeoutMs === META_CONFIG.businessHttpTimeoutMs, "23: business send uses the BUSINESS timeout");

  // 24 — an explicit definitive retryable failure keeps the existing retry scheduling.
  seedGreenMetaInfra();
  // A PROVEN pre-connect failure (a thrown ENOTFOUND) is definitive + safely retryable.
  t = fakeTransport(() => { throw Object.assign(new Error("dns"), { code: "ENOTFOUND" }); });
  ({ svc } = metaService(t));
  res = await svc.send(bizIntent());
  assert(res.ok && res.data.status === "retry_scheduled", `24: proven pre-connect throw → retry_scheduled, got ${res.ok ? res.data.status : res.code}`);

  // 25 — business unknown outcome never retries.
  seedGreenMetaInfra();
  t = fakeTransport(() => ({ kind: "aborted" }));
  ({ svc } = metaService(t));
  res = await svc.send(bizIntent());
  assert(res.ok && res.data.status === "outcome_unknown" && res.data.next_retry_at === null, "25: business unknown outcome → outcome_unknown, no retry");

  // 26-28 — RESTART-SAFE retry: no in-memory descriptor; the pinned mapping is re-resolved.
  seedGreenMetaInfra();
  t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
  ({ svc, spy } = metaService(t));
  res = await svc.send(bizIntent());
  assert(res.ok, "initial business send ok");
  const msg = db.communication_messages[0];
  const providerBefore = msg.provider, channelBefore = msg.channel;
  msg.status = "retry_scheduled"; msg.attempt_count = 1; msg.next_retry_at = new Date(Date.now() - 1000).toISOString();
  // A FRESH service (fresh process): no in-memory resolved descriptor whatsoever.
  const t2 = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
  const fresh = metaService(t2);
  const retried = await fresh.svc.dispatchPersistedMessage(msg.id);
  assert(retried.ok, `26: restart-safe retry dispatched: ${retried.ok ? "" : retried.code}`);
  assert(fresh.spy.resolved === 1 && fresh.spy.bare === 0, "26: retry used the resolved-descriptor path");
  assert(fresh.spy.lastResolved.mappingId === "map-1" && fresh.spy.lastResolved.providerTemplateName === "qf_vendor_new_lead", "26: retry reproduced the pinned mapping deterministically");
  const after = db.communication_messages.find((m) => m.id === msg.id);
  assert(after.provider === providerBefore, "27: retry never changes provider");
  assert(after.channel === channelBefore, "28: retry never changes channel");

  // A superseded/de-activated pinned mapping fails closed on retry — never silently swapped.
  seedGreenMetaInfra();
  t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
  ({ svc } = metaService(t));
  await svc.send(bizIntent());
  const m2 = db.communication_messages[0];
  m2.status = "retry_scheduled"; m2.attempt_count = 1; m2.next_retry_at = new Date(Date.now() - 1000).toISOString();
  db.communication_provider_template_mappings[0].is_active = false;
  const t3 = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
  const blocked = metaService(t3);
  const blockedRes = await blocked.svc.dispatchPersistedMessage(m2.id);
  assert(blockedRes.ok && blockedRes.data.status === "failed", "de-activated pinned mapping fails closed on retry");
  assert(t3.calls.length === 0 && blocked.spy.resolved === 0, "…with zero Meta calls");
  assert(blockedRes.data.next_retry_at === null, "…and no retry scheduled for a standing configuration failure");
});

check("N29-36. mapping gates block the network; approved active exact mapping reaches binding", async () => {
  const cases = [
    [29, { approval_status: "draft", is_active: false }],
    [30, { approval_status: "submitted", is_active: false }],
    [31, { approval_status: "rejected", is_active: false }],
    [32, { approval_status: "approved", is_active: false }],
    [33, { provider_key: "mock" }],
    [34, { language: "hi" }],
  ];
  for (const [n, over] of cases) {
    seedGreenMetaInfra({ mapping: over });
    const t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
    const { svc, spy } = metaService(t);
    const res = await svc.send(bizIntent());
    assert(!res.ok && res.code === "META_APPROVED_MAPPING_UNRESOLVED", `${n}: mapping ${JSON.stringify(over)} blocks`);
    assert(t.calls.length === 0 && spy.resolved === 0 && db.communication_messages.length === 0, `${n}: zero network calls`);
  }
  // 35 — approved active exact mapping reaches deterministic binding.
  seedGreenMetaInfra();
  let t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
  let res = await metaService(t).svc.send(bizIntent());
  assert(res.ok, "35: approved active exact mapping dispatches");
  const body = JSON.parse(t.calls[0].body);
  assert(body.template.name === "qf_vendor_new_lead" && body.template.components[0].parameters[0].text === "Delhi", "35: declared position binding rendered");
  // 36 — a render failure (missing declared source key) produces ZERO network calls.
  seedGreenMetaInfra({ mapping: { variables_schema: { bindingVersion: 1, bindings: [{ component: "body", position: 1, sourceKey: "not_supplied", parameterType: "text" }] } } });
  t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
  const { svc, spy } = metaService(t);
  res = await svc.send(bizIntent());
  assert(res.ok && res.data.status === "failed" && /RENDER/.test(res.data.failure_code), `36: render failure recorded, got ${res.ok ? res.data.failure_code : res.code}`);
  assert(t.calls.length === 0, "36: zero network calls on render failure");
  assert(spy.resolved === 1, "36: the failure happened inside the resolved-descriptor path (pre-network)");
});

check("N37-40. provider identity fences hold across mock and Meta; no reroute, no rewrite", async () => {
  // 37 — a mock-owned message can never dispatch through Meta.
  seedGreenMetaInfra();
  const t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
  const { svc, spy } = metaService(t);
  const mockOwned = seedMessage({ provider: "mock", template_key: "vendor_new_lead" });
  const r1 = await svc.dispatchMessage(mockOwned, { rawVariables: { city: "Delhi" } });
  assert(!r1.ok && r1.code === "UNSUPPORTED_DISPATCH_PROVIDER", "37: mock-owned message cannot Meta dispatch");
  assert(t.calls.length === 0 && spy.resolved === 0, "37: zero provider calls");
  assert(db.communication_messages.find((m) => m.id === mockOwned.id).provider === "mock", "40: message.provider never rewritten");
  // 38 — a Meta-owned message can never dispatch through mock.
  resetDb();
  const metaOwned = seedMessage({ provider: "meta_whatsapp_cloud", template_key: "vendor_new_lead" });
  const mockSvc = new M.Comm.CommunicationService(new M.Mock.MockWhatsAppProvider(), new M.Resolver.StaticCommunicationRecipientResolver({ "vendor:v1": DEST }));
  const r2 = await mockSvc.dispatchMessage(metaOwned, { rawVariables: {} });
  assert(!r2.ok && r2.code === "UNSUPPORTED_DISPATCH_PROVIDER", "38: Meta-owned message cannot mock dispatch");
  assert(db.communication_messages.find((m) => m.id === metaOwned.id).provider === "meta_whatsapp_cloud", "39-40: no reroute, no rewrite");
});

check("N-boundary. the coordinator prepares transport only — no authorization, OTP, n8n or Jarvis", () => {
  const src = stripTs(readFileSync(OUTBOUND_SERVICE_SRC, "utf8"));
  assert(!/n8n/i.test(src) && !/jarvis/i.test(src), "no n8n / Jarvis");
  assert(!/generateOtp|verifyOtp|policy_decision|authorize/i.test(src), "no OTP generation/verification, no authorization");
  assert(!/sendSms|smsFallback|SmsProvider|fallbackChannel/i.test(src), "no SMS fallback");
  // EARLY preflight ordering: outbound config → runtime gate → approved mapping.
  const raw = readFileSync(OUTBOUND_SERVICE_SRC, "utf8");
  assert(raw.indexOf("resolveOutboundMetaConfig") < raw.indexOf("evaluateMetaOutboundGateForMessage"), "config before gate");
  const initialBody = raw.slice(raw.indexOf("async prepareInitialOutbound"), raw.indexOf("async prepareFinalOutbound"));
  assert(initialBody.indexOf("this.gate(input.destinationHash") < initialBody.indexOf("resolveApprovedMetaMapping("), "early preflight: gate before mapping");
  // FINAL fence ordering: pinned mapping → FINAL gate → fingerprint verification.
  const finalBody = raw.slice(raw.indexOf("async prepareFinalOutbound"));
  assert(finalBody.indexOf("resolveApprovedMetaMappingById(") < finalBody.indexOf("this.gate(input.destinationHash"), "final fence: pinned mapping before gate");
  assert(finalBody.indexOf("this.gate(input.destinationHash") < finalBody.indexOf("mappingFingerprintMatches("), "final fence: gate before fingerprint");
  // CommunicationService branches on the CAPABILITY, never on a provider-key literal.
  const comm = stripTs(readFileSync(COMM_SERVICE_SRC, "utf8"));
  assert(/requiresApprovedMapping\(\)/.test(comm) && /supportsResolvedTemplate\(/.test(comm), "capability branch present");
  assert(!/meta_whatsapp_cloud/.test(comm), "no provider-key literal in CommunicationService");
});

// ============================================================================
// SAFETY CORRECTION — MAPPING REPLAY INTEGRITY (P1–P11)
// ============================================================================
const FINGERPRINT_SRC = "lib/communication/providerMappingFingerprint.ts";
const CANONICAL_SRC = "lib/communication/canonicalJson.ts";
const DEADLINE_SRC = "lib/auth/hookDeadline.ts";
const HOOK_SERVICE_SRC = "services/supabaseSendSmsHookService.ts";
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Initial Meta business send, then a FRESH-process retry after `mutate(db)`. */
async function retryAfter(mutate, over = {}) {
  seedGreenMetaInfra(over);
  const first = metaService(fakeTransport(okMetaResponse));
  const sent = await first.svc.send(bizIntent());
  if (!sent.ok) throw new Error(`initial send failed: ${sent.code}`);
  const msg = db.communication_messages[0];
  const pinned = { ...msg };
  msg.status = "retry_scheduled";
  msg.attempt_count = 1;
  msg.next_retry_at = new Date(Date.now() - 1000).toISOString();
  mutate(db);
  const transport = fakeTransport(okMetaResponse);
  const fresh = metaService(transport, M);
  const retried = await fresh.svc.dispatchPersistedMessage(msg.id);
  return { retried, transport, spy: fresh.spy, pinned, row: db.communication_messages.find((m) => m.id === msg.id) };
}
const firstMapping = (d) => d.communication_provider_template_mappings[0];

check("P1-3. canonical JSON is stable; the fingerprint is SHA-256 lowercase hex over the mapping content", () => {
  const C = M.Canonical, F = M.Fingerprint;
  // Key INSERTION order must never change the canonical form, at any nesting depth.
  const a = { b: 1, a: { z: [1, { q: 2, p: 3 }], y: "s" } };
  const b = { a: { y: "s", z: [1, { p: 3, q: 2 }] }, b: 1 };
  assert(C.canonicalJsonStringify(a) === C.canonicalJsonStringify(b), "key order irrelevant (nested)");
  // Array order IS significant.
  assert(C.canonicalJsonStringify([1, 2]) !== C.canonicalJsonStringify([2, 1]), "array order significant");
  // The serializer is not merely JSON.stringify.
  assert(C.canonicalJsonStringify({ b: 1, a: 2 }) === '{"a":2,"b":1}', "keys sorted");
  assert(JSON.stringify({ b: 1, a: 2 }) === '{"b":1,"a":2}', "…unlike JSON.stringify");
  const src = stripTs(readFileSync(FINGERPRINT_SRC, "utf8"));
  assert(/sha256/.test(src) && /digest\("hex"\)/.test(src), "sha256 lowercase hex");
  assert(!/accessToken|appSecret|verifyToken|otp|destination/i.test(src), "no secret/OTP/destination in the fingerprint input");
  const resolved = { mappingId: "m1", internalTemplateKey: "t", providerTemplateName: "p", providerTemplateId: null, language: "en", version: "1.0", variablesSchema: { bindingVersion: 1, bindings: [] }, providerKey: "meta_whatsapp_cloud", channel: "whatsapp" };
  assert(SHA256_HEX.test(F.computeMappingFingerprint(resolved)), "fingerprint is 64 lowercase hex chars");
  // Every dispatch-critical field is covered.
  const base = F.computeMappingFingerprint(resolved);
  for (const over of [
    { mappingId: "m2" }, { internalTemplateKey: "t2" }, { providerTemplateName: "p2" },
    { providerTemplateId: "x" }, { language: "hi" }, { version: "2.0" },
    { providerKey: "mock" }, { channel: "sms" },
    { variablesSchema: { bindingVersion: 1, bindings: [{ component: "body", position: 1, sourceKey: "a", parameterType: "text" }] } },
  ]) {
    assert(F.computeMappingFingerprint({ ...resolved, ...over }) !== base, `fingerprint covers ${Object.keys(over)[0]}`);
  }
  // A schema that differs only by key insertion order is the SAME mapping.
  const s1 = { bindingVersion: 1, bindings: [{ component: "body", position: 1, sourceKey: "a", parameterType: "text" }] };
  const s2 = { bindings: [{ parameterType: "text", sourceKey: "a", position: 1, component: "body" }], bindingVersion: 1 };
  assert(F.computeMappingFingerprint({ ...resolved, variablesSchema: s1 }) === F.computeMappingFingerprint({ ...resolved, variablesSchema: s2 }), "re-ordered schema keys are the same mapping");
  // Exact equality only.
  const fp = F.computeMappingFingerprint(resolved);
  assert(F.mappingFingerprintMatches(fp, fp) === true, "exact match");
  assert(F.mappingFingerprintMatches(fp, null) === false && F.mappingFingerprintMatches(null, fp) === false, "missing never matches");
  assert(F.mappingFingerprintMatches(fp, fp.toUpperCase()) === false, "case-shifted never matches");
  assert(F.mappingFingerprintMatches(fp.slice(0, 63), fp.slice(0, 63)) === false, "malformed never matches");
});

check("P1-4. initial Meta send pins mapping id + version + fingerprint; identical mapping replays", async () => {
  seedGreenMetaInfra();
  const t = fakeTransport(okMetaResponse);
  const { svc } = metaService(t);
  const res = await svc.send(bizIntent());
  assert(res.ok, "initial send ok");
  const row = db.communication_messages[0];
  assert(row.provider_template_mapping_id === "map-1", "1: mapping id persisted");
  assert(row.provider_template_version === "1.0", "2: mapping version persisted");
  assert(SHA256_HEX.test(row.provider_template_mapping_fingerprint), "3: mapping fingerprint persisted (sha256 hex)");
  // The pinned fingerprint is the fingerprint OF THE ROW THAT WAS SENT.
  const expected = M.Fingerprint.computeMappingFingerprint({
    mappingId: "map-1", internalTemplateKey: "vendor_new_lead", providerTemplateName: "qf_vendor_new_lead",
    providerTemplateId: "tid-1", language: "en", version: "1.0",
    variablesSchema: firstMapping(db).variables_schema, providerKey: "meta_whatsapp_cloud", channel: "whatsapp",
  });
  assert(row.provider_template_mapping_fingerprint === expected, "3: fingerprint covers the exact dispatched mapping");

  // 4 — an UNCHANGED mapping replays cleanly through fingerprint verification.
  const clean = await retryAfter(() => {});
  assert(clean.retried.ok && clean.spy.resolved === 1, "4: identical mapping retry dispatches");
  assert(clean.transport.calls.length === 1, "4: exactly one Meta request");
  assert(clean.row.provider_template_mapping_fingerprint === clean.pinned.provider_template_mapping_fingerprint, "4: fingerprint unchanged");
});

check("P5-11. an in-place mapping edit under the same id/version blocks the retry, with zero Meta calls", async () => {
  const cases = [
    [5, "META_MAPPING_FINGERPRINT_MISMATCH", (d) => { firstMapping(d).provider_template_name = "qf_hijacked"; }],
    [6, "META_MAPPING_FINGERPRINT_MISMATCH", (d) => { firstMapping(d).variables_schema = { bindingVersion: 1, bindings: [{ component: "body", position: 1, sourceKey: "city", parameterType: "text" }, { component: "body", position: 2, sourceKey: "city", parameterType: "text" }] }; }],
    [6.1, "META_MAPPING_FINGERPRINT_MISMATCH", (d) => { firstMapping(d).provider_template_id = "tid-swapped"; }],
    [7, "META_APPROVED_MAPPING_UNRESOLVED", (d) => { firstMapping(d).language = "hi"; }],
    [8, "META_APPROVED_MAPPING_UNRESOLVED", (d) => { firstMapping(d).provider_key = "mock"; }],
    [9, "META_MAPPING_IDENTITY_CHANGED", (d) => { firstMapping(d).version = "2.0"; }],
  ];
  for (const [n, code, mutate] of cases) {
    const { retried, transport, spy, row } = await retryAfter(mutate);
    assert(retried.ok, `${n}: dispatch resolved to a ledger state`);
    assert(row.failure_code === code, `${n}: expected ${code}, got ${row.failure_code}`);
    assert(transport.calls.length === 0 && spy.resolved === 0, `${n}/10: zero Meta calls`);
    assert(row.status === "failed", `${n}/11: deterministic failed, got ${row.status}`);
    assert(row.status !== "retry_scheduled" && row.status !== "outcome_unknown", `${n}/11: never retry_scheduled, never outcome_unknown`);
    assert(row.next_retry_at === null, `${n}/11: no retry scheduled`);
  }
  // A message pinned WITHOUT a fingerprint (pre-column row) also fails closed.
  const noFp = await retryAfter((d) => { d.communication_messages[0].provider_template_mapping_fingerprint = null; });
  assert(noFp.row.failure_code === "META_MAPPING_FINGERPRINT_MISSING", `missing fingerprint fails closed, got ${noFp.row.failure_code}`);
  assert(noFp.transport.calls.length === 0, "…with zero Meta calls");
  // As does a message with no pinned mapping identity at all.
  const noId = await retryAfter((d) => { d.communication_messages[0].provider_template_mapping_id = null; });
  assert(noId.row.failure_code === "META_MAPPING_IDENTITY_MISSING", `missing identity fails closed, got ${noId.row.failure_code}`);
  assert(noId.transport.calls.length === 0, "…with zero Meta calls");
});

// ============================================================================
// SAFETY CORRECTION — FINAL NETWORK-BOUNDARY GATE (P12–P20)
// ============================================================================
check("P12-15,19-20. an operator action AFTER the early preflight blocks the request (race closed)", async () => {
  const races = [
    [12, "runtime paused", {}, (d) => { d.communication_provider_runtime_policies[0].activation_status = "paused"; }],
    [13, "outbound disabled", {}, (d) => { d.communication_provider_runtime_policies[0].outbound_enabled = false; }],
    [14, "provider account un-readied", {}, (d) => { d.communication_provider_accounts[0].health_status = "unhealthy"; }],
    [14.1, "phone-number id changed", {}, (d) => { d.communication_provider_accounts[0].phone_number_reference = "PN_OTHER"; }],
    [15, "canary row expired", { policy: { activation_status: "canary" }, canary: {} }, (d) => { d.communication_provider_canary_destinations[0].expires_at = new Date(Date.now() - 1000).toISOString(); }],
    [15.1, "canary row de-activated", { policy: { activation_status: "canary" }, canary: {} }, (d) => { d.communication_provider_canary_destinations[0].is_active = false; }],
  ];
  for (const [n, label, infra, pause] of races) {
    seedGreenMetaInfra(infra);
    const transport = fakeTransport(okMetaResponse);
    // The early preflight passes; the operator acts; THEN the request would be issued.
    const coord = countingCoordinator(M, { afterInitial: () => pause(db) });
    const { svc, spy } = metaService(transport, M, coord);
    const res = await svc.send(bizIntent());
    assert(res.ok, `${n} (${label}): resolved to a ledger state`);
    assert(coord.counts.initial === 1 && coord.counts.final === 1, `${n}: early preflight AND final gate both ran`);
    assert(transport.calls.length === 0 && spy.resolved === 0, `${n} (${label}): ZERO Meta HTTP requests`);
    const row = db.communication_messages[0];
    assert(row.failure_code === "META_FINAL_RUNTIME_GATE_BLOCKED", `${n}: final gate reason, got ${row.failure_code}`);
    assert(row.status === "failed", `19: deterministic failure, got ${row.status}`);
    assert(row.status !== "outcome_unknown", "19: never outcome_unknown — no provider request occurred");
    assert(row.status !== "retry_scheduled" && row.status !== "dead_letter", "19: no retry, no dead_letter from the gate alone");
    assert(row.next_retry_at === null, "20: next_retry_at is null");
  }
});

check("P16-18. the final gate is invoked on initial auth send, initial business send, and restart retry", async () => {
  const authTpl = { template_key: "client_login_otp", category: "authentication", language: "en" };
  const authMap = { id: "map-otp", template_key: "client_login_otp", provider_template_name: "qf_login_otp",
    variables_schema: { bindingVersion: 1, bindings: [{ component: "body", position: 1, sourceKey: "otp", parameterType: "text" }] } };

  // 16 — INITIAL AUTH SEND: a pause after the preflight stops the OTP at the boundary.
  seedGreenMetaInfra({ template: authTpl, mapping: authMap });
  let transport = fakeTransport(okMetaResponse);
  let coord = countingCoordinator(M, { afterInitial: () => { db.communication_provider_runtime_policies[0].activation_status = "paused"; } });
  let { svc, spy } = metaService(transport, M, coord);
  let res = await svc.send(authIntent());
  assert(coord.counts.final === 1, "16: final gate ran on the initial auth send");
  assert(res.ok && res.data.status === "failed" && transport.calls.length === 0 && spy.resolved === 0, "16: auth OTP never left the process");
  assert(db.communication_messages[0].failure_code === "META_FINAL_RUNTIME_GATE_BLOCKED", "16: blocked by the final gate");

  // 17 — INITIAL BUSINESS SEND: the final gate runs even on the happy path.
  seedGreenMetaInfra();
  transport = fakeTransport(okMetaResponse);
  coord = countingCoordinator(M);
  ({ svc, spy } = metaService(transport, M, coord));
  res = await svc.send(bizIntent());
  assert(res.ok && spy.resolved === 1, "17: business send dispatches");
  assert(coord.counts.initial === 1 && coord.counts.final === 1, "17: early preflight once, final gate once");

  // 18 — RESTART-SAFE BUSINESS RETRY: the final gate runs again, with no early preflight.
  const msg = db.communication_messages[0];
  msg.status = "retry_scheduled"; msg.attempt_count = 1; msg.next_retry_at = new Date(Date.now() - 1000).toISOString();
  const retryTransport = fakeTransport(okMetaResponse);
  const retryCoord = countingCoordinator(M);
  const fresh = metaService(retryTransport, M, retryCoord);
  const retried = await fresh.svc.dispatchPersistedMessage(msg.id);
  assert(retried.ok && fresh.spy.resolved === 1, "18: restart retry dispatches");
  assert(retryCoord.counts.final === 1, "18: final gate ran on the restart retry");
  assert(retryCoord.counts.initial === 0, "18: no early preflight on a retry — the pinned identity is the source of truth");

  // The required send order is structural, not incidental.
  const comm = readFileSync(COMM_SERVICE_SRC, "utf8");
  const claim = comm.indexOf("const claim = await this.claimMessageForDispatch(message);");
  const invoke = comm.indexOf("const result = await this.invokeProvider(claimed, destination, providerTemplate, options);");
  assert(claim > 0 && invoke > claim, "atomic claim precedes provider invocation");
  const body = comm.slice(comm.indexOf("private async invokeProvider("));
  assert(body.indexOf("prepareFinalOutbound(") < body.indexOf("sendResolvedTemplate("), "final preparation precedes the provider request");
});

// ============================================================================
// SAFETY CORRECTION — AUTH outcome_unknown HTTP CONTRACT (P21–P27)
// ============================================================================
const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111";
const HOOK_SECRET_ENV = "SEND_SMS_HOOK_SECRETS";
const AUTH_TEMPLATE = { template_key: "client_login_otp", category: "authentication", language: "en" };
const AUTH_MAPPING = { id: "map-otp", template_key: "client_login_otp", provider_template_name: "qf_login_otp",
  variables_schema: { bindingVersion: 1, bindings: [{ component: "body", position: 1, sourceKey: "otp", parameterType: "text" }] } };

function passThroughVerifier() {
  return { verifierKey: "test-passthrough", verify(rawBody) { try { return { ok: true, payload: JSON.parse(rawBody) }; } catch { return { ok: false }; } } };
}
function enableOtpAutomation() {
  db.communication_automation_catalog.push({
    automation_key: "client_login_otp", lane: "authentication", channel: "whatsapp",
    template_key: "client_login_otp", readiness_status: "active",
    provider_required: "meta_whatsapp_cloud", is_operationally_enabled: true,
  });
}
function fullMetaProcessEnv() {
  const env = completeMetaEnv();
  const previous = {};
  for (const [k, v] of Object.entries(env)) { previous[k] = process.env[k]; process.env[k] = v; }
  previous[HOOK_SECRET_ENV] = process.env[HOOK_SECRET_ENV];
  process.env[HOOK_SECRET_ENV] = crypto.randomBytes(24).toString("base64");
  return () => { for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
}
function hookRequest(webhookId, deadline) {
  const rawBody = JSON.stringify({ user: { id: AUTH_USER_ID, phone: DEST.slice(1) }, sms: { otp: "483920" } });
  const h = { "webhook-id": webhookId, "webhook-timestamp": String(Math.floor(Date.now() / 1000)), "webhook-signature": "v1,placeholder" };
  return { rawBody, getHeader: (n) => (n.toLowerCase() in h ? h[n.toLowerCase()] : null), deadline };
}
const retryAfterHeader = (r) => Object.entries(r.headers).find(([k]) => k.toLowerCase() === "retry-after")?.[1];

check("P21-27. an uncertain auth outcome is delivery_uncertain: no Retry-After, no resend, no fallback", async () => {
  const restoreEnv = fullMetaProcessEnv();
  const previousVerifier = M.HookLib.getActiveSendSmsHookVerifier();
  try {
    seedGreenMetaInfra({ template: AUTH_TEMPLATE, mapping: AUTH_MAPPING });
    enableOtpAutomation();
    M.HookLib.setActiveSendSmsHookVerifier(passThroughVerifier());
    // The runtime factory resolves THIS provider; its transport times out mid-flight.
    const transport = fakeTransport(() => ({ kind: "aborted" }));
    const { provider, spy } = spyMetaProvider(transport);
    M.Comm.setActiveWhatsAppProvider(provider);

    // 21 — the auth Meta timeout parks the message in outcome_unknown.
    const first = await M.HookSvc.handleSupabaseSendSmsHook(hookRequest("wh_uncertain"));
    const row = db.communication_messages[0];
    assert(row.status === "outcome_unknown", `21: expected outcome_unknown, got ${row.status}`);
    assert(row.next_retry_at === null, "21: no retry scheduled");

    // 22 — the hook maps it to an EXPLICIT delivery-uncertain outcome, not in_progress.
    assert(first.kind === M.HookSvc.SendSmsHookOutcomeKind.DELIVERY_UNCERTAIN, `22: expected delivery_uncertain, got ${first.kind}`);
    assert(first.kind !== M.HookSvc.SendSmsHookOutcomeKind.IN_PROGRESS, "22: never in_progress");
    assert(first.kind !== M.HookSvc.SendSmsHookOutcomeKind.DELIVERED, "22: never reported as delivered");

    // 23 — the response carries NO Retry-After and no sensitive value.
    const r1 = M.HookSvc.sendSmsHookHttpResponse(first);
    assert(retryAfterHeader(r1) === undefined, "23: no Retry-After on an uncertain outcome");
    assert(r1.body && r1.body.ok === false && r1.body.code === "delivery_uncertain", `23: safe generic body, got ${JSON.stringify(r1.body)}`);
    const blob = `${JSON.stringify(r1.body)}|${JSON.stringify(r1.headers)}`;
    for (const secret of ["483920", DEST, DEST.slice(1), "SUPER_SECRET_TOKEN_VALUE", "APP_SECRET_VALUE", "META_TIMEOUT", "aborted"]) {
      assert(!blob.includes(secret), `23: response leaked ${secret.slice(0, 8)}…`);
    }

    // 24-26 — the idempotent replay observes the SAME parked row.
    const rowsBefore = db.communication_messages.length;
    const callsBefore = transport.calls.length;
    const second = await M.HookSvc.handleSupabaseSendSmsHook(hookRequest("wh_uncertain"));
    assert(db.communication_messages.length === rowsBefore, "24: replay creates zero new message rows");
    assert(transport.calls.length === callsBefore && spy.resolved === 1, "25: replay makes zero second provider calls");
    assert(second.kind === M.HookSvc.SendSmsHookOutcomeKind.DELIVERY_UNCERTAIN, "26: replay is still delivery_uncertain");
    assert(retryAfterHeader(M.HookSvc.sendSmsHookHttpResponse(second)) === undefined, "26: replay still has no Retry-After");

    // 27 — no fallback of any kind exists on this path. (The module is NAMED for the
    // Supabase "Send SMS" hook, so a bare /sms/i grep is meaningless here: what matters
    // is that no code ever selects an sms/rcs channel or a fallback transport.)
    const hookSrc = stripTs(readFileSync(HOOK_SERVICE_SRC, "utf8"));
    assert(!/fallback/i.test(hookSrc), "27: no fallback of any kind in the hook");
    assert(!/["'](sms|rcs)["']/.test(hookSrc), "27: the hook never selects an sms/rcs channel");
    assert(/channel: "whatsapp"/.test(hookSrc), "27: the OTP intent is always whatsapp");
    assert(!/n8n/i.test(hookSrc) && !/jarvis/i.test(hookSrc), "27: no n8n / Jarvis");
    assert(db.communication_messages.every((m) => m.channel === "whatsapp"), "27: no message left the whatsapp channel");
    // Only IN_PROGRESS may ever ask Supabase to retry.
    const K = M.HookSvc.SendSmsHookOutcomeKind;
    assert(retryAfterHeader(M.HookSvc.sendSmsHookHttpResponse({ kind: K.IN_PROGRESS, dispatchAttempted: true })) !== undefined, "in_progress remains the only retryable outcome");
    for (const kind of [K.DELIVERY_UNCERTAIN, K.DELIVERY_FAILED, K.SERVICE_UNAVAILABLE, K.DELIVERED]) {
      assert(retryAfterHeader(M.HookSvc.sendSmsHookHttpResponse({ kind, dispatchAttempted: true })) === undefined, `${kind} must not carry Retry-After`);
    }
  } finally {
    M.HookLib.setActiveSendSmsHookVerifier(previousVerifier);
    M.Comm.clearWhatsAppProviderOverride();
    restoreEnv();
  }
});

// ============================================================================
// SAFETY CORRECTION — AUTH HOOK TOTAL DEADLINE (P28–P34)
// ============================================================================
/** A frozen monotonic clock, so `remaining` is exactly `remainingMs`. */
function fixedDeadline(remainingMs) {
  return M.Deadline.startAuthHookDeadline({ totalBudgetMs: remainingMs + 100, responseReserveMs: 100, now: () => 1000 });
}

check("P28-29,32. the effective auth timeout is min(configured, remaining budget); business is untouched", async () => {
  const D = M.Deadline;
  // The pure formula.
  assert(D.computeRemainingNetworkBudgetMs({ startedAtMs: 100, nowMs: 1100, totalBudgetMs: 5000, responseReserveMs: 750 }) === 3250, "remaining = total − elapsed − reserve");
  assert(D.resolveAuthNetworkTimeoutMs(3000, 10000).timeoutMs === 3000, "28: never exceeds the configured timeout");
  assert(D.resolveAuthNetworkTimeoutMs(3000, 1100).timeoutMs === 1100, "29: never exceeds the remaining budget");
  assert(D.resolveAuthNetworkTimeoutMs(3000, 400).ok === false, "an exhausted budget resolves to no timeout at all");
  assert(M.Config.AUTH_TIMEOUT_MAX_MS <= 4000, "the configured auth maximum is still ≤ 4000 ms");

  // 28 — a generous budget leaves the configured auth timeout untouched.
  seedGreenMetaInfra({ template: AUTH_TEMPLATE, mapping: AUTH_MAPPING });
  let t = fakeTransport(okMetaResponse);
  let res = await metaService(t).svc.send(authIntent(), { authDeadline: fixedDeadline(10000) });
  assert(res.ok && t.calls[0].timeoutMs === META_CONFIG.authHttpTimeoutMs, `28: got ${t.calls[0].timeoutMs}`);

  // 29 — a tight budget shortens the ACTUAL request timeout.
  seedGreenMetaInfra({ template: AUTH_TEMPLATE, mapping: AUTH_MAPPING });
  t = fakeTransport(okMetaResponse);
  res = await metaService(t).svc.send(authIntent(), { authDeadline: fixedDeadline(1100) });
  assert(res.ok && t.calls[0].timeoutMs === 1100, `29: expected 1100, got ${t.calls[0].timeoutMs}`);
  assert(t.calls[0].timeoutMs < META_CONFIG.authHttpTimeoutMs, "29: strictly below the configured auth timeout");

  // 32 — business dispatch never consults a deadline and never changes its timeout.
  seedGreenMetaInfra();
  t = fakeTransport(okMetaResponse);
  res = await metaService(t).svc.send(bizIntent());
  assert(res.ok && t.calls[0].timeoutMs === META_CONFIG.businessHttpTimeoutMs, "32: business timeout unchanged (no deadline)");
  seedGreenMetaInfra();
  t = fakeTransport(okMetaResponse);
  res = await metaService(t).svc.send(bizIntent(), { authDeadline: fixedDeadline(600) });
  assert(res.ok && t.calls[0].timeoutMs === META_CONFIG.businessHttpTimeoutMs, "32: a deadline never shortens a business send");
  assert(M.Transport.effectiveRequestTimeoutMs(5000, null) === 5000 && M.Transport.effectiveRequestTimeoutMs(5000) === 5000, "no ceiling → configured timeout");
});

check("P30-31,33-34. an exhausted deadline fails locally before the network; abort still cancels the request", async () => {
  // 30-31 — below the minimum viable budget: refuse locally, zero Meta calls.
  seedGreenMetaInfra({ template: AUTH_TEMPLATE, mapping: AUTH_MAPPING });
  const t = fakeTransport(okMetaResponse);
  const { svc, spy } = metaService(t);
  const res = await svc.send(authIntent(), { authDeadline: fixedDeadline(400) });
  assert(res.ok, "resolved to a ledger state");
  assert(t.calls.length === 0 && spy.resolved === 0, "30: ZERO Meta calls on an exhausted deadline");
  const row = db.communication_messages[0];
  assert(row.failure_code === "AUTH_NETWORK_DEADLINE_EXHAUSTED", `31: expected AUTH_NETWORK_DEADLINE_EXHAUSTED, got ${row.failure_code}`);
  assert(row.status === "failed", `31: deterministic failure, got ${row.status}`);
  assert(row.status !== "outcome_unknown", "31: never outcome_unknown — no request was initiated");
  assert(row.next_retry_at === null, "31: no retry scheduled");
  // A budget exactly AT the minimum is still viable.
  seedGreenMetaInfra({ template: AUTH_TEMPLATE, mapping: AUTH_MAPPING });
  const t2 = fakeTransport(okMetaResponse);
  const ok2 = await metaService(t2).svc.send(authIntent(), { authDeadline: fixedDeadline(M.Deadline.MIN_VIABLE_AUTH_NETWORK_BUDGET_MS) });
  assert(ok2.ok && t2.calls.length === 1 && t2.calls[0].timeoutMs === M.Deadline.MIN_VIABLE_AUTH_NETWORK_BUDGET_MS, "a minimum-viable budget still dispatches, clamped");

  // 33 — no Promise.race anywhere on the auth path.
  for (const f of [HOOK_SERVICE_SRC, COMM_SERVICE_SRC, PROVIDER_SRC, TRANSPORT_SRC, DEADLINE_SRC]) {
    assert(!/Promise\.race/.test(stripTs(readFileSync(f, "utf8"))), `33: ${f} must not use Promise.race`);
  }
  // 34 — the ACTUAL request is still aborted by an AbortController/AbortSignal.
  const tsrc = readFileSync(TRANSPORT_SRC, "utf8");
  assert(/new AbortController\(\)/.test(tsrc) && /signal: controller\.signal/.test(tsrc), "34: AbortSignal attached to the real request");
  assert(/controller\.abort\(\)/.test(tsrc) && /setTimeout\(/.test(tsrc), "34: the timeout aborts the request");
  // …and the timeout the adapter hands the transport is the CLAMPED one.
  assert(/effectiveRequestTimeoutMs\(configuredMs, options\.maxNetworkTimeoutMs\)/.test(readFileSync(PROVIDER_SRC, "utf8")), "34: the adapter clamps before issuing the request");
  // The deadline is established on the VERIFIED path, before the gate and the dispatch.
  const hook = readFileSync(HOOK_SERVICE_SRC, "utf8");
  const verify = hook.indexOf("getActiveSendSmsHookVerifier().verify(");
  const start = hook.indexOf("startAuthHookDeadline()");
  const gate = hook.indexOf("await evaluateClientLoginOtpGate()");
  assert(verify > 0 && start > verify && gate > start, "the total deadline starts on the verified path, before the gate");
});

// ============================================================================
// SAFETY CORRECTION — PRODUCTION CONSTRUCTOR GUARD (P35–P38)
// ============================================================================
/** A default-constructed service resolves NO provider explicitly — never allowed in production. */
const DEFAULT_CONSTRUCTED = /new\s+CommunicationService\s*\(\s*\)/;
const PRODUCTION_SEND_SERVICES = [
  "services/supabaseSendSmsHookService.ts",
  "services/vendorVerificationService.ts",
  "services/vendorPasswordResetService.ts",
];
function productionSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) productionSourceFiles(path, out);
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}
/** Every production source file that default-constructs a CommunicationService. */
function defaultConstructorOffenders() {
  const files = [...productionSourceFiles("services"), ...productionSourceFiles("app"), ...productionSourceFiles("lib")];
  return files.filter((f) => DEFAULT_CONSTRUCTED.test(stripTs(readFileSync(f, "utf8"))));
}

check("P35-38. no production send service default-constructs CommunicationService", () => {
  // 36 — the structural guard: the runtime factory is the ONLY real-send construction path.
  const offenders = defaultConstructorOffenders();
  assert(offenders.length === 0, `36: default-constructed CommunicationService in ${offenders.join(", ")}`);
  // 35 — every current production auth send caller resolves through the runtime factory.
  for (const f of PRODUCTION_SEND_SERVICES) {
    const src = readFileSync(f, "utf8");
    assert(/createRuntimeCommunicationService\(/.test(src), `35: ${f} uses the runtime factory`);
    assert(!DEFAULT_CONSTRUCTED.test(stripTs(src)), `35: ${f} never default-constructs`);
  }
  // 37 — webhook processing may construct with an EXPLICITLY injected webhook-only provider.
  const webhookSrc = readFileSync(WEBHOOK_SERVICE_SRC, "utf8");
  assert(/new CommunicationService\(provider\)/.test(webhookSrc), "37: webhook constructs with an explicit provider");
  assert(!DEFAULT_CONSTRUCTED.test(stripTs(webhookSrc)), "37: …and never default-constructs");
  // 38 — explicit dependency injection (used by every behavioral test) still works.
  const svc = new M.Comm.CommunicationService(
    new M.Mock.MockWhatsAppProvider(),
    new M.Resolver.StaticCommunicationRecipientResolver({ "vendor:v1": DEST }),
    null
  );
  assert(svc instanceof M.Comm.CommunicationService, "38: 3-arg dependency injection preserved");
  assert(typeof M.Comm.setActiveWhatsAppProvider === "function" && typeof M.Comm.clearWhatsAppProviderOverride === "function", "38: test provider injection preserved");
});

// ============================================================================
// CONSISTENCY CORRECTION — ADMIN/TYPE STATUS VOCABULARY (Q1–Q7)
// ============================================================================
const TYPES_SRC = "lib/communication/types.ts";
const ADMIN_SERVICE_SRC = "services/communicationAdminService.ts";
const AUTH_HOOK_ROUTE_SRC = "app/api/auth/hooks/supabase-send-sms/route.ts";
/** The webhook processing union must carry `ignored` — the DB CHECK already does. */
const UNION_HAS_IGNORED = /CommunicationWebhookProcessingStatus =[\s\S]{0,600}?\|\s*"ignored";/;

function seedReceipt(over = {}) {
  db.communication_webhook_receipts.push({
    id: crypto.randomUUID(), provider: "meta_whatsapp_cloud", provider_event_id: crypto.randomUUID(),
    payload_hash: crypto.randomUUID(), signature_valid: true, processing_status: "processed",
    duplicate_count: 0, received_at: new Date().toISOString(), ...over,
  });
}

check("Q1-3,6-7. the message status vocabulary is complete and outcome_unknown is surfaced", async () => {
  // 1/A — the runtime vocabularies mirror the database CHECK constraints.
  const T = M.Types;
  assert(T.COMMUNICATION_WEBHOOK_PROCESSING_STATUSES.includes("ignored"), "1: webhook vocabulary includes ignored");
  assert(T.COMMUNICATION_MESSAGE_STATUSES.includes("outcome_unknown"), "message vocabulary includes outcome_unknown");
  assert(UNION_HAS_IGNORED.test(readFileSync(TYPES_SRC, "utf8")), "1: CommunicationWebhookProcessingStatus union includes ignored");

  // Exactly one message in every valid state.
  resetDb();
  for (const status of T.COMMUNICATION_MESSAGE_STATUSES) seedMessage({ status });
  const res = await M.Admin.getCommunicationOverview();
  assert(res.ok, "overview ok");
  const overview = res.data;
  const keys = Object.keys(overview.statusBreakdown);

  // 2/B — the Communication Center breakdown carries outcome_unknown…
  assert(keys.includes("outcome_unknown"), "2: statusBreakdown includes outcome_unknown");
  // …E — and every other status the ledger may hold.
  for (const status of T.COMMUNICATION_MESSAGE_STATUSES) {
    assert(keys.includes(status), `E: statusBreakdown accounts for ${status}`);
  }
  // 3/D — the overview exposes an explicit outcomeUnknownCount, populated from the breakdown.
  assert(typeof overview.outcomeUnknownCount === "number", "3: outcomeUnknownCount exposed");
  // 6 — an outcome_unknown message increments it.
  assert(overview.outcomeUnknownCount === 1, `6: outcomeUnknownCount === 1, got ${overview.outcomeUnknownCount}`);
  assert(overview.statusBreakdown.outcome_unknown === 1, "6: breakdown counts it too");
  // It is NOT folded into any other bucket.
  assert(overview.failedCount === 1 && overview.deadLetterCount === 1 && overview.dispatchingCount === 1, "6: not folded into failed/dead_letter/dispatching");

  // 7/E — the total counts every message, and the breakdown sums to the total.
  assert(overview.totalMessages === T.COMMUNICATION_MESSAGE_STATUSES.length, `7: totalMessages ${overview.totalMessages}`);
  const sum = Object.values(overview.statusBreakdown).reduce((a, b) => a + b, 0);
  assert(sum === overview.totalMessages, `7: breakdown sums to the total (${sum} vs ${overview.totalMessages})`);
});

check("Q4-5. the webhook processing summary counts ignored receipts rather than dropping them", async () => {
  resetDb();
  seedReceipt({ processing_status: "processed" });
  seedReceipt({ processing_status: "rejected", signature_valid: false });
  seedReceipt({ processing_status: "ignored" });
  seedReceipt({ processing_status: "ignored", duplicate_count: 2 });

  const res = await M.Admin.getWebhookProcessingSummary();
  assert(res.ok, "summary ok");
  const summary = res.data;
  // 4/C — the summary keys include ignored.
  assert(Object.keys(summary.processingBreakdown).includes("ignored"), "4: processingBreakdown includes ignored");
  // 5/F — an ignored receipt increments the ignored count instead of vanishing.
  assert(summary.processingBreakdown.ignored === 2, `5: two ignored receipts, got ${summary.processingBreakdown.ignored}`);
  assert(summary.processingBreakdown.processed === 1 && summary.processingBreakdown.rejected === 1, "other buckets unchanged");
  assert(summary.totalReceipts === 4, "every receipt counted");
  const sum = Object.values(summary.processingBreakdown).reduce((a, b) => a + b, 0);
  assert(sum === summary.totalReceipts, `every receipt lands in exactly one bucket (${sum} vs ${summary.totalReceipts})`);
  assert(summary.invalidSignatureCount === 1 && summary.duplicateRedeliveryCount === 2, "signature/redelivery counters unchanged");
  // The admin keys mirror the type vocabulary exactly.
  assert(Object.keys(summary.processingBreakdown).sort().join(",") === [...M.Types.COMMUNICATION_WEBHOOK_PROCESSING_STATUSES].sort().join(","), "admin webhook keys mirror the vocabulary");
});

// ============================================================================
// CONSISTENCY CORRECTION — ROUTE-BOUNDARY AUTH DEADLINE (Q8–Q15)
// ============================================================================
check("Q8-11,14-15. the auth hook deadline starts at the HTTP route boundary", () => {
  const route = readFileSync(AUTH_HOOK_ROUTE_SRC, "utf8");
  const hook = readFileSync(HOOK_SERVICE_SRC, "utf8");

  // 8 — created at POST entry, BEFORE the bounded body read.
  assert(/from "@\/lib\/auth\/hookDeadline"/.test(route), "8: the route imports the deadline");
  const post = route.indexOf("export async function POST(");
  const start = route.indexOf("const deadline = startAuthHookDeadline();");
  const read = route.indexOf("readBoundedRawBody(request, MAX_HOOK_BODY_BYTES)");
  assert(post > 0 && start > post, "8: the deadline is created inside POST");
  assert(start < read, "8: the deadline is created BEFORE the bounded body read");
  assert(route.indexOf("try {", post) > start, "8: …and before the handler's try block");

  // 9 — the SAME deadline object is handed to the service (not a fresh one).
  assert(/deadline,\s*\}\);/.test(route), "9: the route passes `deadline` into handleSupabaseSendSmsHook");
  assert((route.match(/startAuthHookDeadline\(\)/g) || []).length === 1, "9: exactly one deadline is created in the route");
  assert(read > 0, "the bounded body read is preserved");
  assert(/MAX_HOOK_BODY_BYTES/.test(route), "the body ceiling is preserved");

  // 10 — the service fallback deadline still exists for safe direct invocation.
  assert(/req\.deadline \?\? startAuthHookDeadline\(\)/.test(hook), "10: the service falls back to its own deadline");
  assert(!/Injected only by tests/.test(hook), "10: the misleading tests-only comment is gone");

  // 11 — signature verification still precedes JSON parsing; the route parses nothing.
  const verify = hook.indexOf("getActiveSendSmsHookVerifier().verify(");
  const parse = hook.indexOf("parseSendSmsHookEvent(verification.payload)");
  const adopt = hook.indexOf("req.deadline ?? startAuthHookDeadline()");
  assert(verify > 0 && parse > verify, "11: signature verification precedes parse/validate");
  assert(adopt > verify && adopt < parse, "11: the deadline is adopted after verification, before parsing");
  assert(!/JSON\.parse/.test(stripTs(route)), "11: the route never parses the body");

  // 14 — still no Promise.race anywhere on the auth path.
  for (const f of [AUTH_HOOK_ROUTE_SRC, HOOK_SERVICE_SRC, DEADLINE_SRC, TRANSPORT_SRC, PROVIDER_SRC, COMM_SERVICE_SRC]) {
    assert(!/Promise\.race/.test(stripTs(readFileSync(f, "utf8"))), `14: ${f} must not use Promise.race`);
  }
  // 15 — the ACTUAL provider request is still cancelled by an AbortController/AbortSignal.
  const tsrc = readFileSync(TRANSPORT_SRC, "utf8");
  assert(/new AbortController\(\)/.test(tsrc) && /signal: controller\.signal/.test(tsrc) && /controller\.abort\(\)/.test(tsrc), "15: AbortSignal controls the real request");
  assert(/effectiveRequestTimeoutMs\(configuredMs, options\.maxNetworkTimeoutMs\)/.test(readFileSync(PROVIDER_SRC, "utf8")), "15: the adapter clamps before issuing the request");
  assert(M.Config.AUTH_TIMEOUT_MAX_MS <= 4000, "the configured auth maximum is unchanged");
});

check("Q12-13. an externally supplied deadline reaches CommunicationService and bounds the request", async () => {
  const restoreEnv = fullMetaProcessEnv();
  const previousVerifier = M.HookLib.getActiveSendSmsHookVerifier();
  try {
    // 12 — a spent budget: the OTP never reaches the network.
    seedGreenMetaInfra({ template: AUTH_TEMPLATE, mapping: AUTH_MAPPING });
    enableOtpAutomation();
    M.HookLib.setActiveSendSmsHookVerifier(passThroughVerifier());
    let transport = fakeTransport(okMetaResponse);
    let spy = spyMetaProvider(transport);
    M.Comm.setActiveWhatsAppProvider(spy.provider);
    let out = await M.HookSvc.handleSupabaseSendSmsHook(hookRequest("wh_route_spent", fixedDeadline(400)));
    assert(transport.calls.length === 0 && spy.spy.resolved === 0, "12: zero Meta calls on an exhausted deadline");
    const spent = db.communication_messages[0];
    assert(spent.failure_code === "AUTH_NETWORK_DEADLINE_EXHAUSTED", `12: got ${spent.failure_code}`);
    assert(spent.status === "failed" && spent.status !== "outcome_unknown", "12: deterministic failure, never outcome_unknown");
    assert(out.kind === M.HookSvc.SendSmsHookOutcomeKind.DELIVERY_FAILED, `12: hook outcome ${out.kind}`);
    assert(retryAfterHeader(M.HookSvc.sendSmsHookHttpResponse(out)) === undefined, "12: no Retry-After");

    // 13 — a tight but viable budget clamps the ACTUAL request timeout.
    seedGreenMetaInfra({ template: AUTH_TEMPLATE, mapping: AUTH_MAPPING });
    enableOtpAutomation();
    transport = fakeTransport(okMetaResponse);
    spy = spyMetaProvider(transport);
    M.Comm.setActiveWhatsAppProvider(spy.provider);
    out = await M.HookSvc.handleSupabaseSendSmsHook(hookRequest("wh_route_tight", fixedDeadline(1100)));
    assert(out.kind === M.HookSvc.SendSmsHookOutcomeKind.DELIVERED, `13: delivered, got ${out.kind}`);
    assert(transport.calls.length === 1, "13: exactly one Meta request");
    assert(transport.calls[0].timeoutMs === 1100, `13: clamped to the remaining budget, got ${transport.calls[0].timeoutMs}`);
    assert(transport.calls[0].timeoutMs < META_CONFIG.authHttpTimeoutMs, "13: strictly below the configured auth timeout");

    // A generous budget leaves the configured auth timeout untouched.
    seedGreenMetaInfra({ template: AUTH_TEMPLATE, mapping: AUTH_MAPPING });
    enableOtpAutomation();
    transport = fakeTransport(okMetaResponse);
    spy = spyMetaProvider(transport);
    M.Comm.setActiveWhatsAppProvider(spy.provider);
    await M.HookSvc.handleSupabaseSendSmsHook(hookRequest("wh_route_roomy", fixedDeadline(10000)));
    assert(transport.calls[0].timeoutMs === META_CONFIG.authHttpTimeoutMs, "13: min(configured, remaining) never exceeds configured");
  } finally {
    M.HookLib.setActiveSendSmsHookVerifier(previousVerifier);
    M.Comm.clearWhatsAppProviderOverride();
    restoreEnv();
  }
});

check("wiring. test:phase5f:b + created files exist", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert(pkg.scripts["test:phase5f:b"] === "node scripts/phase5f-b-whatsapp-cloud-api-harness.mjs", "test:phase5f:b wired");
  for (const f of [MIGRATION_5FB, CONFIG_SRC, GATE_SRC, BINDING_SRC, TEMPLATE_SRC, WEBHOOK_LIB_SRC, PROVIDER_SRC, TRANSPORT_SRC, SELECTION_SRC, RUNTIME_SERVICE_SRC, MAPPING_SERVICE_SRC, HEALTH_SERVICE_SRC, WEBHOOK_SERVICE_SRC, ROUTE_SRC, RUNBOOK_DOC, FINGERPRINT_SRC, CANONICAL_SRC, DEADLINE_SRC]) {
    assert(existsSync(f), `${f} exists`);
  }
  // The migration carries the fingerprint column + its shape guard, and nothing secret.
  assert(/provider_template_mapping_fingerprint text/i.test(SQL.stripped), "migration adds the fingerprint column");
  assert(/\[0-9a-f\]\{64\}/.test(SQL.raw), "migration constrains the fingerprint to sha256 lowercase hex");
});

// ============================================================================
// MUTATIONS
// ============================================================================
const mutationChecks = [];
function sqlMutation(name, from, to, scenario) {
  mutationChecks.push({ name, kind: "sql", edits: [{ file: MIGRATION_5FB, from, to }], scenario });
}
function tsMutation(name, edits, scenario) {
  mutationChecks.push({ name, kind: "ts", edits: edits.map(([file, from, to]) => ({ file, from, to })), scenario });
}
function srcMutation(name, file, from, to, scenario) {
  mutationChecks.push({ name, kind: "src", edits: [{ file, from, to }], scenario });
}
const readF = (f) => readFileSync(f, "utf8");

// --- migration seed / schema mutations ---
sqlMutation("MUT: default Meta activation not disabled",
  "('meta_whatsapp_cloud', 'whatsapp', 'disabled', false, false, false)",
  "('meta_whatsapp_cloud', 'whatsapp', 'active', false, false, false)",
  () => { rebuildSqlModel(); return SQL.runtimeSeed.activation_status !== "disabled"; });
sqlMutation("MUT: outbound seed enabled",
  "('meta_whatsapp_cloud', 'whatsapp', 'disabled', false, false, false)",
  "('meta_whatsapp_cloud', 'whatsapp', 'disabled', true, false, false)",
  () => { rebuildSqlModel(); return SQL.runtimeSeed.outbound_enabled === "true"; });
sqlMutation("MUT: webhook processing seed enabled",
  "('meta_whatsapp_cloud', 'whatsapp', 'disabled', false, false, false)",
  "('meta_whatsapp_cloud', 'whatsapp', 'disabled', false, true, false)",
  () => { rebuildSqlModel(); return SQL.runtimeSeed.webhook_processing_enabled === "true"; });
sqlMutation("MUT: store a token column",
  "  metadata                    jsonb not null default '{}'::jsonb,\n  created_at                  timestamptz not null default now(),\n  updated_at                  timestamptz not null default now(),\n  constraint uq_comm_provider_runtime_policy",
  "  metadata                    jsonb not null default '{}'::jsonb,\n  access_token                text,\n  created_at                  timestamptz not null default now(),\n  updated_at                  timestamptz not null default now(),\n  constraint uq_comm_provider_runtime_policy",
  () => { rebuildSqlModel(); return /access_token/i.test(SQL.tables.runtime); });
sqlMutation("MUT: store plaintext canary destination",
  "  destination_hash  text not null,\n  is_active         boolean not null default true,",
  "  destination_hash  text not null,\n  phone_e164        text not null,\n  is_active         boolean not null default true,",
  () => { rebuildSqlModel(); return /phone_e164/i.test(SQL.tables.canary); });

// --- gate mutations ---
tsMutation("MUT: remove provider-account readiness check",
  [[GATE_SRC,
    "  if (\n    account.readiness_status !== REQUIRED_ACCOUNT_READINESS.readiness_status ||\n    account.configuration_status !== REQUIRED_ACCOUNT_READINESS.configuration_status ||\n    account.business_verification_status !== REQUIRED_ACCOUNT_READINESS.business_verification_status ||\n    account.phone_number_status !== REQUIRED_ACCOUNT_READINESS.phone_number_status ||\n    account.webhook_status !== REQUIRED_ACCOUNT_READINESS.webhook_status ||\n    account.health_status !== REQUIRED_ACCOUNT_READINESS.health_status\n  ) {\n    return { ok: false, reason: OutboundGateReason.PROVIDER_ACCOUNT_NOT_READY };\n  }",
    "  // readiness check removed by mutation"]],
  (mm) => mm.Gate.evaluateProviderAccountReadiness(
    { provider_key: "meta_whatsapp_cloud", channel: "whatsapp", phone_number_reference: "PN_123", business_account_reference: "WABA_456", readiness_status: "not_configured", configuration_status: "pending", business_verification_status: "unknown", phone_number_status: "unknown", webhook_status: "unknown", health_status: "unknown" },
    { phoneNumberId: "PN_123", wabaId: "WABA_456" }).ok === true);
tsMutation("MUT: remove canary allowlist check",
  [[GATE_SRC,
    "  const allowed = canaryRows.some(\n    (r) => r.destination_hash === destinationHash && isCanaryRowUsable(r, nowMs)\n  );",
    "  const allowed = true;"]],
  (mm) => mm.Gate.evaluateCanaryGate("canary", "nope", []).ok === true);
tsMutation("MUT: provider identity fence always matches",
  [[GATE_SRC,
    "    messageProvider === activeProviderKey\n  );",
    "    true\n  );"]],
  (mm) => mm.Gate.providerIdentityMatches("mock", "meta_whatsapp_cloud") === true);

// --- template / binding mutations ---
tsMutation("MUT: allow legacy fallback (mapping resolver returns ok with no rows)",
  [[TEMPLATE_SRC,
    "  if (matching.length === 0) return { ok: false, reason: MappingResolutionReason.NO_MAPPING_FOUND };",
    "  if (matching.length === 0) return { ok: true, template: { internalTemplateKey: criteria.templateKey, providerTemplateName: \"legacy\", providerTemplateId: null, language: criteria.language, version: \"1.0\", variablesSchema: { bindingVersion: 1, bindings: [] }, providerKey: criteria.providerKey, channel: \"whatsapp\" } };"]],
  (mm) => mm.Template.selectApprovedProviderMapping([], { templateKey: "client_login_otp", providerKey: "meta_whatsapp_cloud", language: "en" }).ok === true);
tsMutation("MUT: allow a draft mapping",
  [[TEMPLATE_SRC,
    "  if (row.approval_status !== \"approved\") return { ok: false, reason: MappingResolutionReason.NOT_APPROVED };",
    "  if (false) return { ok: false, reason: MappingResolutionReason.NOT_APPROVED };"]],
  (mm) => mm.Template.selectApprovedProviderMapping(
    [{ template_key: "client_login_otp", channel: "whatsapp", provider_key: "meta_whatsapp_cloud", language: "en", version: "1.0", provider_template_name: "x", provider_template_id: null, approval_status: "draft", is_active: true, variables_schema: { bindingVersion: 1, bindings: [] } }],
    { templateKey: "client_login_otp", providerKey: "meta_whatsapp_cloud", language: "en" }).ok === true);
tsMutation("MUT: infer parameter order from binding-array order (drop position sort)",
  [[BINDING_SRC,
    "    const positions = [...compMap.keys()].sort((a, b) => a - b);",
    "    const positions = [...compMap.keys()];"]],
  (mm) => {
    const schema = { bindingVersion: 1, bindings: [
      { component: "body", position: 2, sourceKey: "b", parameterType: "text" },
      { component: "body", position: 1, sourceKey: "a", parameterType: "text" },
    ] };
    const r = mm.Binding.renderWhatsAppTemplateComponents(schema, { b: "SECOND", a: "FIRST" });
    return r.ok && r.components[0].parameters[0].text === "SECOND"; // wrong order slipped through
  });

// --- provider / transport mutations ---
tsMutation("MUT: classify timeout as definitive_failure",
  [[PROVIDER_SRC,
    "      errorCode: \"META_TIMEOUT\", errorMessage: \"Meta request aborted by timeout; delivery outcome unknown.\",\n      retryable: false, outcomeCertainty: \"unknown_outcome\",",
    "      errorCode: \"META_TIMEOUT\", errorMessage: \"Meta request aborted by timeout; delivery outcome unknown.\",\n      retryable: false, outcomeCertainty: \"definitive_failure\","]],
  async (mm) => {
    const p = new mm.Provider.MetaCloudWhatsAppProvider(META_CONFIG, fakeTransport(() => ({ kind: "aborted" })));
    const r = await p.sendResolvedTemplate("+15550001111", RESOLVED_OTP, { otp: "1" });
    return r.outcomeCertainty === "definitive_failure";
  });
tsMutation("MUT: retry an unknown outcome (5xx retryable true)",
  [[PROVIDER_SRC,
    "    errorCode: `META_HTTP_${status}`, errorMessage: `Meta returned an ambiguous response (HTTP ${status}); outcome unknown.`,\n    retryable: false, outcomeCertainty: \"unknown_outcome\",",
    "    errorCode: `META_HTTP_${status}`, errorMessage: `Meta returned an ambiguous response (HTTP ${status}); outcome unknown.`,\n    retryable: true, outcomeCertainty: \"unknown_outcome\","]],
  async (mm) => {
    const p = new mm.Provider.MetaCloudWhatsAppProvider(META_CONFIG, fakeTransport(() => ({ kind: "response", status: 503, bodyText: "", truncated: false })));
    const r = await p.sendResolvedTemplate("+15550001111", RESOLVED_OTP, { otp: "1" });
    return r.retryable === true;
  });
srcMutation("MUT: remove AbortSignal from the transport",
  TRANSPORT_SRC, "        signal: controller.signal,\n", "",
  () => !/signal: controller\.signal/.test(readF(TRANSPORT_SRC)));

// --- webhook mutations ---
tsMutation("MUT: skip signature verification",
  [[WEBHOOK_LIB_SRC,
    "  const expected = \"sha256=\" + crypto.createHmac(\"sha256\", appSecret).update(rawBody).digest(\"hex\");\n  return secureEquals(signature, expected);",
    "  return true;"]],
  (mm) => mm.Webhook.verifyMetaWebhookSignature("body", "sha256=deadbeef", "APP_SECRET_VALUE") === true);
tsMutation("MUT: allow an unknown webhook status through",
  [[WEBHOOK_LIB_SRC, "      if (!normalized) continue;", "      if (!normalized) { /* allow */ }"]],
  (mm) => {
    // With the drop removed, an unknown status must no longer be silently dropped.
    // The map lookup is undefined for 'accepted'; without the guard the code would
    // attempt to use it — the render still yields >0 only if it does not throw.
    try {
      const out = mm.Webhook.normalizeMetaDeliveryWebhook(deliveryPayload([{ id: "m", status: "accepted", timestamp: "1700000000" }]));
      return out.length > 0;
    } catch { return false; }
  });
srcMutation("MUT: parse before signature verification (webhook service)",
  WEBHOOK_SERVICE_SRC,
  "  // Step 4 — verify the signature against the EXACT raw body, before any JSON parse.\n  if (!verifyMetaWebhookSignature(input.rawBody, input.signature, appSecret)) {\n    return { status: 401, code: \"invalid_signature\" };\n  }\n",
  "",
  () => {
    const svc = readF(WEBHOOK_SERVICE_SRC);
    const v = svc.indexOf("verifyMetaWebhookSignature(input.rawBody");
    const parse = svc.indexOf("safeParse(input.rawBody)");
    return v === -1 || (parse !== -1 && v > parse); // verification no longer precedes parse
  });
srcMutation("MUT: make inbound webhook trigger delivery processing",
  WEBHOOK_SERVICE_SRC,
  "if (classification === MetaWebhookClassification.DELIVERY_STATUS) {",
  "if (classification !== MetaWebhookClassification.UNKNOWN) {",
  () => !/classification === MetaWebhookClassification\.DELIVERY_STATUS/.test(readF(WEBHOOK_SERVICE_SRC)));

// --- communicationService provider/webhook fence mutations ---
srcMutation("MUT: remove the provider identity fence (final dispatch boundary)",
  COMM_SERVICE_SRC,
  "      if (this.isForeignProvider(message.provider)) {\n        return fail(commError(\"UNSUPPORTED_DISPATCH_PROVIDER\"));\n      }\n",
  "",
  () => (readF(COMM_SERVICE_SRC).match(/this\.isForeignProvider\(message\.provider\)/g) || []).length < 2);
srcMutation("MUT: remove the provider-scoped webhook message lookup",
  COMM_SERVICE_SRC,
  '.eq("provider", this.provider.providerKey)',
  "",
  () => !/\.eq\("provider", this\.provider\.providerKey\)/.test(readF(COMM_SERVICE_SRC)));

// --- correction-pass mutations (A–L) ---------------------------------------
tsMutation("MUT A: collapse unknown_outcome into failed",
  [[COMM_SERVICE_SRC,
    'if (effectiveOutcomeCertainty(result) === "unknown_outcome") {',
    "if (false) {"]],
  async (mm) => { stubDb(mm); const row = await runUnknownDispatch(mm); return row.status !== "outcome_unknown"; });

tsMutation("MUT B: allow outcome_unknown → retry_scheduled",
  [[COMM_SERVICE_SRC,
    'outcome_unknown: ["sent", "delivered", "read", "failed"],',
    'outcome_unknown: ["sent", "delivered", "read", "failed", "retry_scheduled"],']],
  (mm) => mm.Comm.isValidTransition("outcome_unknown", "retry_scheduled") === true);

tsMutation("MUT C: block outcome_unknown → delivered reconciliation",
  [[COMM_SERVICE_SRC,
    'outcome_unknown: ["sent", "delivered", "read", "failed"],',
    'outcome_unknown: ["sent", "read", "failed"],']],
  (mm) => mm.Comm.isValidTransition("outcome_unknown", "delivered") === false);

tsMutation("MUT D: missing certainty falls through to definitive_failure (must stay unknown)",
  // The ONE implementation lives in providerOutcome.ts (Phase 5F-C2); whatsappProvider.ts
  // re-exports it as `effectiveOutcomeCertainty`, so the scenario is unchanged.
  [["lib/communication/providers/providerOutcome.ts",
    '  if (!KNOWN_OUTCOME_CERTAINTIES.includes(c)) return "unknown_outcome";',
    '  if (!KNOWN_OUTCOME_CERTAINTIES.includes(c)) return "definitive_failure";']],
  (mm) => mm.req("./lib/communication/providers/whatsappProvider.js").effectiveOutcomeCertainty({ accepted: false }) === "definitive_failure");

// --- OUTCOME-CERTAINTY correction mutations (this pass) ---------------------
tsMutation("MUT cA: infer accepted certainty from accepted=true when certainty is missing",
  [["lib/communication/providers/providerOutcome.ts",
    '  if (!KNOWN_OUTCOME_CERTAINTIES.includes(c)) return "unknown_outcome";',
    '  if (!KNOWN_OUTCOME_CERTAINTIES.includes(c)) return result.accepted ? "accepted" : "unknown_outcome";']],
  (mm) => {
    const WP = mm.req("./lib/communication/providers/whatsappProvider.js");
    return WP.effectiveOutcomeCertainty({ accepted: true }) === "accepted"; // missing cert wrongly became accepted
  });

tsMutation("MUT cB: require retryable=false before routing unknown_outcome to outcome_unknown",
  [[COMM_SERVICE_SRC,
    'if (effectiveOutcomeCertainty(result) === "unknown_outcome") {',
    'if (effectiveOutcomeCertainty(result) === "unknown_outcome" && result.retryable === false) {']],
  async (mm) => {
    stubDb(mm); resetDb();
    const msg = seedMessage();
    const svc = new mm.Comm.CommunicationService(fakeProvider({ ...UNKNOWN_RESULT, retryable: true }), new mm.Resolver.StaticCommunicationRecipientResolver({ "vendor:v1": DEST }));
    await svc.dispatchMessage(msg, { rawVariables: {} });
    // With the retryable gate restored, an unknown+retryable result escapes outcome_unknown.
    return db.communication_messages.find((m) => m.id === msg.id).status !== "outcome_unknown";
  });

tsMutation("MUT cC: allow unknown_outcome + retryable=true to schedule a retry",
  [[COMM_SERVICE_SRC,
    'if (effectiveOutcomeCertainty(result) === "unknown_outcome") {',
    "if (false) {"]],
  async (mm) => {
    stubDb(mm); resetDb();
    const msg = seedMessage();
    const svc = new mm.Comm.CommunicationService(fakeProvider({ ...UNKNOWN_RESULT, retryable: true }), new mm.Resolver.StaticCommunicationRecipientResolver({ "vendor:v1": DEST }));
    await svc.dispatchMessage(msg, { rawVariables: {} });
    const row = db.communication_messages.find((m) => m.id === msg.id);
    return row.status === "retry_scheduled" || row.next_retry_at !== null; // unknown+retryable wrongly retried
  });

tsMutation("MUT cD: allow unknown_outcome + accepted=true to enter success handling",
  [[COMM_SERVICE_SRC,
    'return effectiveOutcomeCertainty(result) === "accepted"',
    "return (result.accepted || effectiveOutcomeCertainty(result) === \"accepted\")"]],
  async (mm) => {
    stubDb(mm); resetDb();
    const msg = seedMessage();
    const svc = new mm.Comm.CommunicationService(fakeProvider({ ...UNKNOWN_RESULT, accepted: true }), new mm.Resolver.StaticCommunicationRecipientResolver({ "vendor:v1": DEST }));
    await svc.dispatchMessage(msg, { rawVariables: {} });
    const row = db.communication_messages.find((m) => m.id === msg.id);
    return row.status === "accepted" || row.status === "sent"; // unknown+accepted wrongly succeeded
  });

tsMutation("MUT F: auth send uses the business timeout",
  [[PROVIDER_SRC,
    'const configuredMs = options.lane === "authentication" ? this.runtime.authHttpTimeoutMs : this.runtime.businessHttpTimeoutMs;',
    "const configuredMs = this.runtime.businessHttpTimeoutMs;"]],
  async (mm) => {
    const t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: '{"messages":[{"id":"a"}]}', truncated: false }));
    await new mm.Provider.MetaCloudWhatsAppProvider(META_CONFIG, t).sendResolvedTemplate("+15550001111", RESOLVED_OTP, { otp: "1" }, { lane: "authentication" });
    return t.calls[0].timeoutMs === META_CONFIG.businessHttpTimeoutMs; // auth now wrongly uses business
  });

tsMutation("MUT G: allow an auth timeout above the safe maximum",
  [[CONFIG_SRC, "export const AUTH_TIMEOUT_MAX_MS = 4000;", "export const AUTH_TIMEOUT_MAX_MS = 120000;"]],
  (mm) => mm.Config.resolveOutboundMetaConfig(completeMetaEnv({ WHATSAPP_AUTH_HTTP_TIMEOUT_MS: "120000" })).ok === true);

tsMutation("MUT H: GET verification requires the full outbound config",
  [[CONFIG_SRC,
    '  const v = readTrimmed(env, "WHATSAPP_WEBHOOK_VERIFY_TOKEN");\n  if (v === null) return { ok: false, missing: ["WHATSAPP_WEBHOOK_VERIFY_TOKEN"], invalid: [] };\n  return { ok: true, config: { webhookVerifyToken: v } };',
    '  const v = readTrimmed(env, "WHATSAPP_WEBHOOK_VERIFY_TOKEN");\n  const a = readTrimmed(env, "WHATSAPP_ACCESS_TOKEN");\n  if (v === null || a === null) return { ok: false, missing: ["WHATSAPP_WEBHOOK_VERIFY_TOKEN"], invalid: [] };\n  return { ok: true, config: { webhookVerifyToken: v } };']],
  (mm) => mm.Config.resolveWebhookVerifyConfig({ WHATSAPP_WEBHOOK_VERIFY_TOKEN: "V" }).ok === false);

tsMutation("MUT I: POST signature verification requires the access token",
  [[CONFIG_SRC,
    '  const v = readTrimmed(env, "WHATSAPP_APP_SECRET");\n  if (v === null) return { ok: false, missing: ["WHATSAPP_APP_SECRET"], invalid: [] };\n  return { ok: true, config: { appSecret: v } };',
    '  const v = readTrimmed(env, "WHATSAPP_APP_SECRET");\n  const a = readTrimmed(env, "WHATSAPP_ACCESS_TOKEN");\n  if (v === null || a === null) return { ok: false, missing: ["WHATSAPP_APP_SECRET"], invalid: [] };\n  return { ok: true, config: { appSecret: v } };']],
  (mm) => mm.Config.resolveWebhookSignatureConfig({ WHATSAPP_APP_SECRET: "S" }).ok === false);

tsMutation("MUT J: verified unknown event returns 400 instead of acknowledging",
  [[WEBHOOK_SERVICE_SRC,
    'await recordIgnoredReceipt(input.rawBody, payload, "ignored_unknown");\n    return { status: 200, result: "acknowledged_unknown" };',
    'return { status: 400, code: "unclassified_payload" };']],
  async (mm) => {
    stubDb(mm); resetDb(); seedWebhookPolicy(); setMetaEnv();
    const sig = M.Webhook.computeMetaWebhookSignature(NON_DELIVERY.unknown, "APP_SECRET_VALUE");
    const res = await mm.WebhookSvc.handleMetaWhatsAppWebhookPost({ rawBody: NON_DELIVERY.unknown, signature: sig });
    return res.status === 400;
  });

tsMutation("MUT L: production missing mode silently defaults to mock",
  [[CONFIG_SRC,
    '  if (raw === null) {\n    if (isProd) return { ok: false, reason: "mode_required_in_production", variable: WHATSAPP_PROVIDER_MODE_ENV };\n    return { ok: true, mode: "mock", explicit: false };\n  }',
    '  if (raw === null) {\n    return { ok: true, mode: "mock", explicit: false };\n  }']],
  (mm) => { const d = mm.Config.resolveProviderModeDecision({ NODE_ENV: "production" }); return d.ok === true && d.mode === "mock"; });

// --- EXCEPTION-CERTAINTY correction mutations (eA–eF) -----------------------
const PROVIDER_ERROR_SRC = "lib/communication/providers/providerError.ts";
tsMutation("MUT eA: unclassified exception → definitive_failure",
  [[PROVIDER_ERROR_SRC,
    '  return { code: PROVIDER_EXCEPTION_CODE, retryable: false, outcomeCertainty: "unknown_outcome" };',
    '  return { code: PROVIDER_EXCEPTION_CODE, retryable: false, outcomeCertainty: "definitive_failure" };']],
  (mm) => mm.req("./lib/communication/providers/providerError.js").classifyProviderException(new Error("x")).outcomeCertainty === "definitive_failure");

tsMutation("MUT eB: ambiguous transport code (ECONNRESET) → definitive_failure",
  [[PROVIDER_ERROR_SRC,
    '  if (nodeCode && AMBIGUOUS_TRANSPORT_CODES.has(nodeCode)) {\n    return { code: nodeCode, retryable: false, outcomeCertainty: "unknown_outcome" };\n  }',
    '  if (nodeCode && AMBIGUOUS_TRANSPORT_CODES.has(nodeCode)) {\n    return { code: nodeCode, retryable: true, outcomeCertainty: "definitive_failure" };\n  }']],
  (mm) => mm.req("./lib/communication/providers/providerError.js").classifyProviderException(Object.assign(new Error("x"), { code: "ECONNRESET" })).outcomeCertainty === "definitive_failure");

tsMutation("MUT eC: abort/timeout → definitive_failure",
  [[PROVIDER_ERROR_SRC,
    '  if (name && AMBIGUOUS_ERROR_NAMES.has(name)) {\n    return { code: name.toUpperCase(), retryable: false, outcomeCertainty: "unknown_outcome" };\n  }',
    '  if (name && AMBIGUOUS_ERROR_NAMES.has(name)) {\n    return { code: name.toUpperCase(), retryable: true, outcomeCertainty: "definitive_failure" };\n  }']],
  (mm) => mm.req("./lib/communication/providers/providerError.js").classifyProviderException(Object.assign(new Error("x"), { name: "AbortError" })).outcomeCertainty === "definitive_failure");

tsMutation("MUT eD: unknown_outcome typed error marked retryable=true",
  [[PROVIDER_ERROR_SRC,
    '    this.retryable = certainty === "unknown_outcome" ? false : retryable;',
    "    this.retryable = retryable;"]],
  (mm) => new (mm.req("./lib/communication/providers/providerError.js").ProviderDispatchError)("U", "m", "unknown_outcome", true).retryable === true);

tsMutation("MUT eE: infer certainty solely from the retryable boolean",
  [[PROVIDER_ERROR_SRC,
    '    const certainty: ProviderOutcomeCertainty = err.outcomeCertainty === "accepted" ? "unknown_outcome" : err.outcomeCertainty;',
    '    const certainty: ProviderOutcomeCertainty = err.retryable ? "definitive_failure" : "unknown_outcome";']],
  (mm) => mm.req("./lib/communication/providers/providerError.js").classifyProviderException(mm.req("./lib/communication/providers/providerError.js").definitivePermanentProviderError("P", "m")).outcomeCertainty === "unknown_outcome");

tsMutation("MUT eF: allow a thrown ProviderDispatchError with accepted certainty",
  [[PROVIDER_ERROR_SRC,
    '    const certainty: ProviderOutcomeCertainty = outcomeCertainty === "accepted" ? "unknown_outcome" : outcomeCertainty;',
    "    const certainty: ProviderOutcomeCertainty = outcomeCertainty;"]],
  (mm) => new (mm.req("./lib/communication/providers/providerError.js").ProviderDispatchError)("A", "m", "accepted", false).outcomeCertainty === "accepted");

// --- OUTBOUND-INTEGRATION mutations (nA–nJ) --------------------------------
const RUNTIME_SVC_FILE = "services/runtimeCommunicationService.ts";
const OUTBOUND_SVC_FILE = "services/metaWhatsAppOutboundService.ts";

tsMutation("MUT nA: the runtime path ignores the provider selector (env not consulted)",
  [[RUNTIME_SVC_FILE, "  const selection = selectWhatsAppProvider(env);", "  const selection = selectWhatsAppProvider({});"]],
  (mm) => {
    mm.Comm.clearWhatsAppProviderOverride();
    const r = mm.Runtime.resolveRuntimeWhatsAppProvider(completeMetaEnv());
    return r.ok && r.data.providerKey === "mock"; // Meta env wrongly yielded mock
  });

tsMutation("MUT nJ: Meta falls back to mock when its config is invalid",
  [[RUNTIME_SVC_FILE,
    "  if (!selection.ok) {\n    return fail(new AppError(RUNTIME_PROVIDER_UNAVAILABLE, RUNTIME_PROVIDER_MESSAGE));\n  }",
    "  if (!selection.ok) {\n    return resolveRuntimeWhatsAppProvider({});\n  }"]],
  (mm) => {
    mm.Comm.clearWhatsAppProviderOverride();
    const r = mm.Runtime.resolveRuntimeWhatsAppProvider({ WHATSAPP_PROVIDER_MODE: "meta_cloud" });
    return r.ok && r.data.providerKey === "mock"; // silent Meta → mock downgrade
  });

tsMutation("MUT nB: the Meta path calls a bare provider method",
  [[COMM_SERVICE_SRC,
    '    return this.provider.templateResolutionMode === "approved_provider_mapping";',
    "    return false;"]],
  async (mm) => {
    stubDb(mm); seedGreenMetaInfra();
    const t = fakeTransport(okMetaResponse);
    const { svc, spy } = metaService(t, mm);
    await svc.send(bizIntent());
    return spy.bare > 0; // bare sendTemplateMessage was used for an approved-mapping adapter
  });

tsMutation("MUT nC: the coordinator skips the runtime gate",
  [[OUTBOUND_SVC_FILE,
    "    const blocked = await this.gate(input.destinationHash, OutboundPreparationReason.RUNTIME_GATE_BLOCKED);\n    if (blocked) return blocked;\n\n    const mapping = await resolveApprovedMetaMapping({",
    "    const mapping = await resolveApprovedMetaMapping({"]],
  async (mm) => {
    stubDb(mm); seedGreenMetaInfra({ policy: { outbound_enabled: false } });
    const coord = new mm.Outbound.MetaWhatsAppOutboundCoordinator(completeMetaEnv());
    const prep = await coord.prepareInitialOutbound({ templateKey: "vendor_new_lead", language: "en", destinationHash: M.Phone.hashPhoneE164(DEST) });
    return prep.ok === true; // a disabled runtime policy still prepared an outbound send
  });

tsMutation("MUT nD: the coordinator skips the approved-mapping resolver (fabricates a mapping)",
  [[OUTBOUND_SVC_FILE,
    "    const mapping = await resolveApprovedMetaMapping({\n      templateKey: input.templateKey,\n      language: input.language,\n    });\n    if (!mapping.ok) {\n      return { ok: false, reason: OutboundPreparationReason.MAPPING_UNRESOLVED, detail: mapping.reason };\n    }",
    "    const mapping = { ok: true as const, template: { mappingId: \"fabricated\", internalTemplateKey: input.templateKey, providerTemplateName: \"fabricated\", providerTemplateId: null, language: input.language, version: \"1.0\", variablesSchema: { bindingVersion: 1, bindings: [] }, providerKey: \"meta_whatsapp_cloud\", channel: \"whatsapp\" as const } };"]],
  async (mm) => {
    stubDb(mm); seedGreenMetaInfra({ mapping: null });
    const coord = new mm.Outbound.MetaWhatsAppOutboundCoordinator(completeMetaEnv());
    const prep = await coord.prepareInitialOutbound({ templateKey: "vendor_new_lead", language: "en", destinationHash: M.Phone.hashPhoneE164(DEST) });
    return prep.ok === true; // no approved mapping exists, yet one was fabricated
  });

tsMutation("MUT nE: the provider is called even though final preparation failed (fence bypassed)",
  [[COMM_SERVICE_SRC,
    "      if (!prepared.ok) {\n        return this.preflightFailure(prepared.reason, OUTBOUND_PREPARATION_MESSAGE);\n      }",
    "      if (!prepared.ok) {\n        return await this.provider.sendResolvedTemplate(\n          destination,\n          { mappingId: null, internalTemplateKey: \"\", providerTemplateName: \"bypass\", providerTemplateId: null, language, version: \"0\", variablesSchema: { bindingVersion: 1, bindings: [] }, providerKey: this.provider.providerKey, channel: \"whatsapp\" },\n          {},\n          { lane: \"business\" }\n        );\n      }"]],
  async (mm) => {
    stubDb(mm); seedGreenMetaInfra();
    const t = fakeTransport(okMetaResponse);
    const { svc } = metaService(t, mm);
    const res = await svc.send(bizIntent());
    if (!res.ok) return false;
    const msg = db.communication_messages[0];
    msg.status = "retry_scheduled"; msg.attempt_count = 1; msg.next_retry_at = new Date(Date.now() - 1000).toISOString();
    db.communication_provider_runtime_policies[0].outbound_enabled = false; // gate now blocks
    const t2 = fakeTransport(okMetaResponse);
    const fresh = metaService(t2, mm);
    await fresh.svc.dispatchPersistedMessage(msg.id);
    return fresh.spy.resolved > 0; // the provider was invoked despite a blocked gate
  });

tsMutation("MUT nH: the provider identity fence is removed (a mock-owned message reroutes to Meta)",
  [[COMM_SERVICE_SRC,
    "      if (this.isForeignProvider(message.provider)) {\n        return fail(commError(\"UNSUPPORTED_DISPATCH_PROVIDER\"));\n      }\n",
    ""]],
  async (mm) => {
    stubDb(mm); seedGreenMetaInfra();
    const t = fakeTransport(() => ({ kind: "response", status: 200, bodyText: META_ACCEPTED_BODY, truncated: false }));
    const { svc, spy } = metaService(t, mm);
    const mockOwned = seedMessage({ provider: "mock", template_key: "vendor_new_lead" });
    await svc.dispatchMessage(mockOwned, { rawVariables: { city: "Delhi" }, templateLanguage: "en" });
    return spy.resolved > 0; // a mock-owned message was rerouted through Meta
  });

/**
 * The restart-safe retry must reproduce the EXACT pinned mapping row. Both edits
 * together let a superseded-but-identical-looking mapping be substituted: the resolver
 * stops honouring the pinned id, and the fingerprint stops covering it.
 */
tsMutation("MUT nI: restart-safe retry silently swaps to a superseded mapping",
  [[MAPPING_SERVICE_SRC, '    .eq("id", input.mappingId)', '    .eq("is_active", true)'],
   [FINGERPRINT_SRC, "    mappingId: resolved.mappingId,", "    mappingId: null,"]],
  async (mm) => {
    stubDb(mm); seedGreenMetaInfra();
    const t = fakeTransport(okMetaResponse);
    const { svc } = metaService(t, mm);
    const res = await svc.send(bizIntent());
    if (!res.ok) return false;
    const msg = db.communication_messages[0];
    msg.status = "retry_scheduled"; msg.attempt_count = 1; msg.next_retry_at = new Date(Date.now() - 1000).toISOString();
    // The pinned mapping is retired and replaced by an identical-content successor.
    const superseded = { ...db.communication_provider_template_mappings[0] };
    db.communication_provider_template_mappings[0].is_active = false;
    db.communication_provider_template_mappings.push({ ...superseded, id: "map-2", is_active: true });
    const t2 = fakeTransport(okMetaResponse);
    const fresh = metaService(t2, mm);
    await fresh.svc.dispatchPersistedMessage(msg.id);
    return fresh.spy.resolved > 0; // a DIFFERENT mapping row was dispatched on retry
  });

// --- SAFETY-CORRECTION mutations (sA–sI) ------------------------------------
const HOOK_SVC_FILE = "services/supabaseSendSmsHookService.ts";
const FINGERPRINT_FILE = "lib/communication/providerMappingFingerprint.ts";

/** Initial send, mutate the pinned mapping/infra, retry from a fresh process. */
async function mutatedRetry(mm, mutate) {
  stubDb(mm); seedGreenMetaInfra();
  const t = fakeTransport(okMetaResponse);
  const res = await metaService(t, mm).svc.send(bizIntent());
  if (!res.ok) return { dispatched: false, calls: 0 };
  const msg = db.communication_messages[0];
  msg.status = "retry_scheduled"; msg.attempt_count = 1; msg.next_retry_at = new Date(Date.now() - 1000).toISOString();
  mutate(db);
  const t2 = fakeTransport(okMetaResponse);
  const fresh = metaService(t2, mm);
  await fresh.svc.dispatchPersistedMessage(msg.id);
  return { dispatched: fresh.spy.resolved > 0, calls: t2.calls.length };
}

tsMutation("MUT sA: a mapping fingerprint mismatch is ignored",
  [[OUTBOUND_SVC_FILE,
    "    if (!mappingFingerprintMatches(input.mappingFingerprint, recomputed)) {\n      return { ok: false, reason: OutboundPreparationReason.MAPPING_FINGERPRINT_MISMATCH };\n    }",
    "    if (false) {\n      return { ok: false, reason: OutboundPreparationReason.MAPPING_FINGERPRINT_MISMATCH };\n    }"]],
  async (mm) => {
    // The pinned row is edited in place, same id + version. It must never be replayed.
    const r = await mutatedRetry(mm, (d) => { d.communication_provider_template_mappings[0].provider_template_name = "qf_hijacked"; });
    return r.dispatched;
  });

tsMutation("MUT sB: the fingerprint hashes only the mapping identity, not the rendering-critical content",
  [[FINGERPRINT_FILE,
    "    providerTemplateName: resolved.providerTemplateName,\n    providerTemplateId: resolved.providerTemplateId,\n    variablesSchema: resolved.variablesSchema,",
    "    providerTemplateName: \"\",\n    providerTemplateId: null,\n    variablesSchema: null,"]],
  async (mm) => {
    const F = mm.req("./lib/communication/providerMappingFingerprint.js");
    const base = { mappingId: "m1", internalTemplateKey: "t", providerTemplateName: "p", providerTemplateId: null, language: "en", version: "1.0", variablesSchema: { bindingVersion: 1, bindings: [] }, providerKey: "meta_whatsapp_cloud", channel: "whatsapp" };
    const renamed = { ...base, providerTemplateName: "HIJACKED" };
    // Two DIFFERENT templates now share one fingerprint.
    return F.computeMappingFingerprint(base) === F.computeMappingFingerprint(renamed);
  });

tsMutation("MUT sC: the FINAL runtime infrastructure gate is removed",
  [[OUTBOUND_SVC_FILE,
    "    const blocked = await this.gate(input.destinationHash, OutboundPreparationReason.FINAL_RUNTIME_GATE_BLOCKED);\n    if (blocked) return blocked;",
    ""]],
  async (mm) => {
    const r = await mutatedRetry(mm, (d) => { d.communication_provider_runtime_policies[0].activation_status = "paused"; });
    return r.dispatched; // a paused provider still issued a Meta request
  });

tsMutation("MUT sD: the FINAL gate no longer precedes the request (its result is observed too late)",
  [[OUTBOUND_SVC_FILE,
    "    const blocked = await this.gate(input.destinationHash, OutboundPreparationReason.FINAL_RUNTIME_GATE_BLOCKED);\n    if (blocked) return blocked;",
    "    const deferred = this.gate(input.destinationHash, OutboundPreparationReason.FINAL_RUNTIME_GATE_BLOCKED);\n    void deferred;"]],
  async (mm) => {
    const r = await mutatedRetry(mm, (d) => { d.communication_provider_runtime_policies[0].outbound_enabled = false; });
    return r.calls > 0; // the Meta HTTP request was issued before the gate was enforced
  });

tsMutation("MUT sE: an uncertain auth outcome is reported as in_progress",
  [[HOOK_SVC_FILE,
    "    if (status === \"outcome_unknown\") {\n      return {\n        kind: SendSmsHookOutcomeKind.DELIVERY_UNCERTAIN,",
    "    if (status === \"outcome_unknown\") {\n      return {\n        kind: SendSmsHookOutcomeKind.IN_PROGRESS,"]],
  async (mm) => {
    const restoreEnv = fullMetaProcessEnv();
    const previousVerifier = mm.HookLib.getActiveSendSmsHookVerifier();
    try {
      stubDb(mm);
      seedGreenMetaInfra({ template: AUTH_TEMPLATE, mapping: AUTH_MAPPING });
      enableOtpAutomation();
      mm.HookLib.setActiveSendSmsHookVerifier(passThroughVerifier());
      const { provider } = spyMetaProvider(fakeTransport(() => ({ kind: "aborted" })), mm);
      mm.Comm.setActiveWhatsAppProvider(provider);
      const out = await mm.HookSvc.handleSupabaseSendSmsHook(hookRequest("wh_mut_se"));
      const r = mm.HookSvc.sendSmsHookHttpResponse(out);
      // An unproven OTP outcome now sits in the retryable branch and asks for a resend.
      return out.kind === "in_progress" && retryAfterHeader(r) !== undefined;
    } finally {
      mm.HookLib.setActiveSendSmsHookVerifier(previousVerifier);
      mm.Comm.clearWhatsAppProviderOverride();
      restoreEnv();
    }
  });

tsMutation("MUT sF: the uncertain-outcome response asks Supabase to retry",
  [[HOOK_SVC_FILE,
    "    case SendSmsHookOutcomeKind.DELIVERY_UNCERTAIN:\n      return jsonResponse(502, \"delivery_uncertain\");",
    "    case SendSmsHookOutcomeKind.DELIVERY_UNCERTAIN:\n      return jsonResponse(503, \"delivery_uncertain\", { [RETRY_AFTER_HEADER]: RETRY_AFTER_VALUE });"]],
  (mm) => {
    const r = mm.HookSvc.sendSmsHookHttpResponse({ kind: mm.HookSvc.SendSmsHookOutcomeKind.DELIVERY_UNCERTAIN, dispatchAttempted: true });
    return retryAfterHeader(r) !== undefined; // an OTP resend was requested
  });

tsMutation("MUT sG: the dispatcher ignores the remaining hook deadline",
  [[COMM_SERVICE_SRC, "        maxNetworkTimeoutMs = remainingMs;", "        maxNetworkTimeoutMs = undefined;"]],
  async (mm) => {
    stubDb(mm);
    seedGreenMetaInfra({ template: AUTH_TEMPLATE, mapping: AUTH_MAPPING });
    const t = fakeTransport(okMetaResponse);
    const deadline = mm.Deadline.startAuthHookDeadline({ totalBudgetMs: 1200, responseReserveMs: 100, now: () => 1000 });
    await metaService(t, mm).svc.send(authIntent(), { authDeadline: deadline });
    // The request now runs for the full configured auth timeout, past the hook budget.
    return t.calls.length === 1 && t.calls[0].timeoutMs === META_CONFIG.authHttpTimeoutMs;
  });

tsMutation("MUT sH: the adapter uses its configured timeout even when the remaining budget is lower",
  [[TRANSPORT_SRC,
    "  if (typeof ceilingMs !== \"number\" || !Number.isFinite(ceilingMs)) return configuredMs;\n  return Math.max(MIN_REQUEST_TIMEOUT_MS, Math.min(configuredMs, Math.floor(ceilingMs)));",
    "  return configuredMs;"]],
  (mm) => mm.req("./lib/communication/httpTransport.js").effectiveRequestTimeoutMs(4000, 900) === 4000);

srcMutation("MUT sI: a production send service default-constructs CommunicationService",
  "services/vendorVerificationService.ts",
  "    const runtime = createRuntimeCommunicationService();",
  "    const runtime = { ok: true, data: new CommunicationService() };",
  () => defaultConstructorOffenders().length > 0);

// --- CONSISTENCY-CORRECTION mutations (qA–qF) -------------------------------
const ADMIN_SVC_FILE = "services/communicationAdminService.ts";
const ROUTE_FILE = "app/api/auth/hooks/supabase-send-sms/route.ts";

/** Seed one message per status and read the Communication Center overview. */
async function overviewOf(mm) {
  stubDb(mm); resetDb();
  for (const status of mm.Types.COMMUNICATION_MESSAGE_STATUSES) seedMessage({ status });
  const res = await mm.Admin.getCommunicationOverview();
  return res.ok ? res.data : null;
}

srcMutation("MUT qA: `ignored` is dropped from the webhook processing type vocabulary",
  TYPES_SRC, "| \"ignored\";", "| \"removed_by_mutation\";",
  // The union no longer admits a status the database CHECK already writes, so an
  // `ignored` receipt has no place in the read model. (`npm run typecheck` rejects it
  // independently; the structural check keeps the harness itself honest.)
  () => !UNION_HAS_IGNORED.test(readF(TYPES_SRC)));

tsMutation("MUT qB: the admin webhook summary drops the ignored bucket",
  [[ADMIN_SVC_FILE, "  \"failed\",\n  \"ignored\",\n];", "  \"failed\",\n];"]],
  async (mm) => {
    stubDb(mm); resetDb();
    seedReceipt({ processing_status: "ignored" });
    const res = await mm.Admin.getWebhookProcessingSummary();
    // The receipt exists but is counted nowhere: total ≠ sum of the breakdown.
    const sum = Object.values(res.data.processingBreakdown).reduce((a, b) => a + b, 0);
    return res.ok && res.data.processingBreakdown.ignored === undefined && sum !== res.data.totalReceipts;
  });

tsMutation("MUT qC: the admin message breakdown drops outcome_unknown",
  [[ADMIN_SVC_FILE, "  \"cancelled\",\n  \"outcome_unknown\",\n];", "  \"cancelled\",\n];"]],
  async (mm) => {
    const overview = await overviewOf(mm);
    if (!overview) return false;
    const sum = Object.values(overview.statusBreakdown).reduce((a, b) => a + b, 0);
    // An outcome_unknown message is invisible: the breakdown no longer sums to the total.
    return overview.statusBreakdown.outcome_unknown === undefined && sum !== overview.totalMessages;
  });

tsMutation("MUT qD: CommunicationOverview stops exposing outcomeUnknownCount",
  [[ADMIN_SVC_FILE, "  outcomeUnknownCount: number;\n}", "}"],
   [ADMIN_SVC_FILE, "      outcomeUnknownCount: breakdown.outcome_unknown,\n", ""]],
  async (mm) => {
    const overview = await overviewOf(mm);
    return overview !== null && overview.outcomeUnknownCount === undefined;
  });

srcMutation("MUT qE: the deadline is created after the bounded body read",
  ROUTE_FILE,
  "  // FIRST statement of the handler: the hook budget is already running.\n  const deadline = startAuthHookDeadline();\n  try {\n    // Bounded read: Content-Length pre-check + streaming byte cap. Never buffers\n    // more than the ceiling, even without a Content-Length header.\n    const bounded = await readBoundedRawBody(request, MAX_HOOK_BODY_BYTES);",
  "  try {\n    // Bounded read: Content-Length pre-check + streaming byte cap. Never buffers\n    // more than the ceiling, even without a Content-Length header.\n    const bounded = await readBoundedRawBody(request, MAX_HOOK_BODY_BYTES);\n    const deadline = startAuthHookDeadline();",
  () => {
    const route = readF(ROUTE_FILE);
    // Time spent reading a slow/trickling body is no longer charged to the budget.
    return route.indexOf("const deadline = startAuthHookDeadline();") >
      route.indexOf("readBoundedRawBody(request, MAX_HOOK_BODY_BYTES)");
  });

srcMutation("MUT qF: the route never passes its deadline to the hook service",
  ROUTE_FILE,
  "      getHeader: (name) => request.headers.get(name),\n      deadline,\n    });",
  "      getHeader: (name) => request.headers.get(name),\n    });",
  () => !/getHeader: \(name\) => request\.headers\.get\(name\),\n      deadline,/.test(readF(ROUTE_FILE)));

// ============================================================================
// EXECUTE
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-B WhatsApp Cloud API checks...\n");
  for (const c of checks) {
    try { await c.fn(); console.log(`PASS ${c.name}`); passed++; }
    catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; }
  }
  return { passed, failed };
}
async function suiteGoesRed() {
  for (const c of checks) { try { await c.fn(); } catch { return true; } }
  return false;
}
async function runMutations() {
  let passed = 0, failed = 0;
  console.log("\nRunning Phase 5F-B mutation tests...\n");
  for (const mut of mutationChecks) {
    const mutDir = resolve(`.phase5fb-mut-${mutationChecks.indexOf(mut)}`);
    const originals = new Map();
    for (const edit of mut.edits) {
      const p = resolve(edit.file);
      if (!originals.has(p)) originals.set(p, readFileSync(p, "utf8"));
    }
    try {
      for (const edit of mut.edits) {
        const p = resolve(edit.file);
        const cur = readFileSync(p, "utf8");
        if (!cur.includes(edit.from)) throw new Error(`anchor not found in ${edit.file}`);
        writeFileSync(p, cur.replace(edit.from, edit.to));
      }
      let violation = false;
      if (mut.kind === "ts") {
        let mm;
        try { compileTo(mutDir); } catch { console.log(`PASS ${mut.name} (rejected at compile time)`); passed++; continue; }
        mm = wireBuild(mutDir);
        rebuildSqlModel();
        violation = await mut.scenario(mm);
        if (!violation) violation = await suiteGoesRed();
      } else {
        rebuildSqlModel();
        violation = await mut.scenario();
        if (!violation) violation = await suiteGoesRed();
      }
      if (violation) { console.log(`PASS ${mut.name}`); passed++; }
      else { console.log(`FAIL ${mut.name} (guard did not prove load-bearing)`); failed++; }
    } catch (e) {
      console.log(`FAIL ${mut.name}`); console.error(e); failed++;
    } finally {
      for (const [p, original] of originals) writeFileSync(p, original);
      rmSync(mutDir, { recursive: true, force: true });
      rebuildSqlModel();
    }
  }
  return { passed, failed };
}

const functional = await runFunctional();
const mutations = await runMutations();
rmSync(MAIN_DIR, { recursive: true, force: true });
const passed = functional.passed + mutations.passed;
const failed = functional.failed + mutations.failed;
console.log(`\nSummary: ${passed} passed, ${failed} failed (functional: ${functional.passed}/${functional.passed + functional.failed}, mutation: ${mutations.passed}/${mutations.passed + mutations.failed}).`);
process.exit(failed > 0 ? 1 : 0);
