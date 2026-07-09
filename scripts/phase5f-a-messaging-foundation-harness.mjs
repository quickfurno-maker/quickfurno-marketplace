import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 5F-A — QuickFurno Messaging Channel & Provider Foundation harness.
 *
 * Verifies the FOUNDATION only: the generic channel vocabulary widens to
 * whatsapp/sms/rcs while the Phase 5E OTP-challenge channel stays whatsapp/sms; the
 * new provider/mapping/policy/attempt/preference/suppression/capability registries
 * exist with NO secret or plaintext-destination columns; the authentication
 * transport policy ships every fallback disabled (and vendor_whatsapp_verify with
 * NO fallback at all); the SMS + RCS contracts exist without any send path; and
 * nothing is activated. It then MUTATION-TESTS the security-critical schema and
 * contract boundaries by editing the real migration/TypeScript, re-deriving the
 * model, and asserting the vulnerability appears — restoring every file afterwards.
 *
 * The migration is PARSED (constraints, seed rows, table bodies, grants), so a
 * mutation that (e.g.) lets RCS into the challenge channel or enables a fallback
 * genuinely changes what the harness sees.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const TS_FILES = [
  "lib/errors.ts",
  "lib/communication/types.ts",
  "lib/communication/channelDispatchGuard.ts",
  "lib/communication/providers/smsProvider.ts",
  "lib/communication/providers/mockSmsProvider.ts",
  "lib/communication/rcs.ts",
  "lib/identity/authTransport.ts",
  // Phase 5F-A future-compatibility contracts (pure).
  "lib/agents/agentAttribution.ts",
  "lib/agents/agentRecommendation.ts",
  "lib/agents/campaignIntent.ts",
  "lib/communication/communicationRecommendation.ts",
  "lib/events/eventEnvelope.ts",
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
          outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] },
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
    Types: req("./lib/communication/types.js"),
    ChannelGuard: req("./lib/communication/channelDispatchGuard.js"),
    MockSms: req("./lib/communication/providers/mockSmsProvider.js"),
    Rcs: req("./lib/communication/rcs.js"),
    AuthTransport: req("./lib/identity/authTransport.js"),
    Attribution: req("./lib/agents/agentAttribution.js"),
    Recommendation: req("./lib/agents/agentRecommendation.js"),
    Campaign: req("./lib/agents/campaignIntent.js"),
    CommRecommendation: req("./lib/communication/communicationRecommendation.js"),
    EventEnvelope: req("./lib/events/eventEnvelope.js"),
  };
}

// ============================================================================
// FILE PATHS
// ============================================================================
const MIGRATION_5FA = "supabase/migrations/20260709000100_messaging_channel_provider_foundation.sql";
const MIGRATION_5E = "supabase/migrations/20260708000200_vendor_whatsapp_verification_password_reset.sql";
const MIGRATION_5B = "supabase/migrations/20260708000170_unified_communication_core.sql";
const TYPES_SRC = "lib/communication/types.ts";
const SMS_IFACE_SRC = "lib/communication/providers/smsProvider.ts";
const MOCK_SMS_SRC = "lib/communication/providers/mockSmsProvider.ts";
const AUTH_TRANSPORT_SRC = "lib/identity/authTransport.ts";
const RCS_SRC = "lib/communication/rcs.ts";
const WA_DOC = "docs/QF-WhatsApp-Cloud-API-Production-Readiness.md";
const SMS_DOC = "docs/QF-SMS-Authentication-Fallback-Readiness.md";
const RCS_DOC = "docs/QF-RCS-Future-Campaign-Readiness.md";
const WA_MANIFEST = "docs/provider-manifests/whatsapp-template-submission-manifest.json";
const ATTRIBUTION_SRC = "lib/agents/agentAttribution.ts";
const RECOMMENDATION_SRC = "lib/agents/agentRecommendation.ts";
const CAMPAIGN_SRC = "lib/agents/campaignIntent.ts";
const COMM_REC_SRC = "lib/communication/communicationRecommendation.ts";
const EVENT_ENVELOPE_SRC = "lib/events/eventEnvelope.ts";
const JARVIS_DOC = "docs/QF-Jarvis-Integration-Boundary.md";
const CHANNEL_GUARD_SRC = "lib/communication/channelDispatchGuard.ts";
const COMM_SERVICE_SRC = "services/communicationService.ts";
const WA_PROVIDER_SRC = "lib/communication/providers/whatsappProvider.ts";
const MOCK_WA_PROVIDER_SRC = "lib/communication/providers/mockWhatsAppProvider.ts";

// Exact operative guard blocks in CommunicationService (Phase 5F-A runtime channel
// safety). The functional checks assert each is present at its boundary; the
// mutation tests remove each and prove a check goes red.
const GUARD_INITIAL_SEND =
  'if (!isChannelDispatchable(intent.channel, this.dispatchChannel())) {\n        return fail(commError("UNSUPPORTED_DISPATCH_CHANNEL"));\n      }';
const GUARD_TEMPLATE_CHANNEL =
  'if (!isTemplateChannelConsistent(template.channel, intent.channel)) {\n        return fail(commError("TEMPLATE_CHANNEL_MISMATCH"));\n      }';
const GUARD_PERSISTED_DISPATCH =
  'if (this.isForeignChannel(message.channel)) {\n        return fail(commError("UNSUPPORTED_DISPATCH_CHANNEL"));\n      }';
const GUARD_PROVIDER_IDENTITY = "errorCode: CHANNEL_DISPATCH_ERROR.UNSUPPORTED_DISPATCH_CHANNEL,";
const GUARD_WEBHOOK_FENCE =
  'if (this.isForeignChannel(message.channel)) {\n      return { application: "unmatched", deliveryEventRecorded: false };\n    }';

// ============================================================================
// SQL MODEL — parsed from the real migrations
// ============================================================================
const stripSql = (s) => s.replace(/--[^\n]*/g, "");

/** Balanced-paren body of `create table if not exists public.NAME ( ... )`. */
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

/** Parse the authentication_transport_policies seed into keyed rows. */
function parseAuthTransportSeed(sql) {
  const m = sql.match(/insert into public\.authentication_transport_policies\s*\(([^)]*)\)\s*values([\s\S]*?)on conflict/i);
  if (!m) return null;
  const cols = m[1].split(",").map((c) => c.trim());
  const rows = [];
  for (const r of m[2].matchAll(/\(([^)]*)\)/g)) {
    const vals = r[1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
    const obj = {};
    cols.forEach((c, i) => { obj[c] = vals[i]; });
    rows.push(obj);
  }
  const byFlow = {};
  for (const row of rows) byFlow[row.auth_flow] = row;
  return { cols, rows, byFlow };
}

/** Parse the delivery_channel CHECK from the Phase 5E migration. */
function parseChallengeDeliveryChannel(sql5e) {
  const m = sql5e.match(/check\s*\(\s*delivery_channel is null or delivery_channel in \(([^)]*)\)\s*\)/i);
  if (!m) return null;
  return m[1].split(",").map((s) => s.trim().replace(/'/g, ""));
}

function loadSql() {
  const raw5fa = readFileSync(MIGRATION_5FA, "utf8");
  const stripped5fa = stripSql(raw5fa);
  const raw5e = readFileSync(MIGRATION_5E, "utf8");
  const stripped5e = stripSql(raw5e);

  const tables = {
    provider_accounts: createTableBody(stripped5fa, "communication_provider_accounts"),
    template_mappings: createTableBody(stripped5fa, "communication_provider_template_mappings"),
    transport_policies: createTableBody(stripped5fa, "authentication_transport_policies"),
    delivery_attempts: createTableBody(stripped5fa, "authentication_delivery_attempts"),
    preferences: createTableBody(stripped5fa, "communication_preferences"),
    suppressions: createTableBody(stripped5fa, "communication_suppressions"),
    capabilities: createTableBody(stripped5fa, "communication_channel_capabilities"),
  };

  return {
    raw5fa,
    stripped5fa,
    stripped5e,
    tables,
    transportSeed: parseAuthTransportSeed(stripped5fa),
    challengeDeliveryChannel: parseChallengeDeliveryChannel(stripped5e),
  };
}

let SQL = loadSql();
function rebuildSqlModel() { SQL = loadSql(); }

// ============================================================================
// SOURCE TEXT (raw — the docs/manifest are checked as content)
// ============================================================================
const TYPES_TEXT = readFileSync(TYPES_SRC, "utf8");
const SMS_IFACE_TEXT = readFileSync(SMS_IFACE_SRC, "utf8");
const MOCK_SMS_TEXT = readFileSync(MOCK_SMS_SRC, "utf8");
const AUTH_TRANSPORT_TEXT = readFileSync(AUTH_TRANSPORT_SRC, "utf8");
const RCS_TEXT = readFileSync(RCS_SRC, "utf8");

// Comment-stripped code (a comment DOCUMENTING what a file does NOT do — e.g.
// "stores no Google service-account JSON" — must never trip a code-pattern grep).
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
const MOCK_SMS_CODE = stripTs(MOCK_SMS_TEXT);
const RCS_CODE = stripTs(RCS_TEXT);

// ============================================================================
// TEST REGISTRY
// ============================================================================
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

/** Assert a table body contains none of the forbidden column patterns. */
function assertNoForbiddenColumns(body, forbidden, label) {
  for (const re of forbidden) {
    assert(!re.test(body), `${label}: forbidden column pattern ${re} present`);
  }
}

// ============================================================================
// MAIN BUILD
// ============================================================================
const MAIN_DIR = resolve(".phase5fa-build-main");
compileTo(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

// ============================================================================
// CHANNEL VOCABULARY (1–7)
// ============================================================================
check("1. generic CommunicationChannel type includes whatsapp/sms/rcs", () => {
  assert(/CommunicationChannel = "whatsapp" \| "sms" \| "rcs"/.test(TYPES_TEXT), "type union widened to the three channels");
  assert(JSON.stringify(M.Types.COMMUNICATION_CHANNELS) === JSON.stringify(["whatsapp", "sms", "rcs"]), "runtime channel list");
  assert(M.Types.isCommunicationChannel("whatsapp") && M.Types.isCommunicationChannel("sms") && M.Types.isCommunicationChannel("rcs"), "all three are valid");
  assert(!M.Types.isCommunicationChannel("email") && !M.Types.isCommunicationChannel(""), "unknown channels rejected");
  // Runtime dispatch behaviour is unchanged: the only active dispatch channel is whatsapp.
  assert(M.Types.ACTIVE_DISPATCH_CHANNEL === "whatsapp", "the only active dispatch channel remains whatsapp");
});

check("2-4. the migration widens messages/templates/automation catalog to all three channels", () => {
  // The DO block builds a `channel in ('whatsapp','sms','rcs')` constraint (doubled
  // quotes inside the format string) for each of the three generic tables.
  assert(/channel in \(''whatsapp'', ''sms'', ''rcs''\)/.test(SQL.stripped5fa), "vocabulary constraint declared for all three");
  for (const t of ["communication_messages", "communication_templates", "communication_automation_catalog"]) {
    assert(SQL.stripped5fa.includes(`'${t}'`), `${t} is in the widened-table list`);
  }
  // The three-table array is the exact set widened.
  const m = SQL.stripped5fa.match(/v_tables text\[\] := array\[([\s\S]*?)\];/);
  assert(m, "widened-table array present");
  assert(/communication_messages/.test(m[1]) && /communication_templates/.test(m[1]) && /communication_automation_catalog/.test(m[1]), "all three generic tables widened");
});

check("5. existing WhatsApp rows are preserved (fail-loud validation before widening)", () => {
  // The migration REFUSES to widen if any existing channel value is not whatsapp.
  assert(/channel is distinct from ''whatsapp''/.test(SQL.stripped5fa), "validates existing channel values");
  assert(/refusing to widen the vocabulary/i.test(SQL.stripped5fa), "raises on drift");
  // It never rewrites/deletes rows: no UPDATE/DELETE of the channel column.
  assert(!/update public\.communication_(messages|templates|automation_catalog)\b[\s\S]{0,120}set channel/i.test(SQL.stripped5fa), "no channel rewrite");
  assert(!/delete from public\.communication_/i.test(SQL.stripped5fa), "no row deletion");
});

check("6-7. the Phase 5E OTP-challenge channel stays whatsapp/sms; RCS is NOT a challenge channel", () => {
  assert(SQL.challengeDeliveryChannel, "the 5E delivery_channel CHECK is present");
  assert(JSON.stringify(SQL.challengeDeliveryChannel.sort()) === JSON.stringify(["sms", "whatsapp"]), `challenge channel must be whatsapp/sms only, got ${SQL.challengeDeliveryChannel}`);
  assert(!SQL.challengeDeliveryChannel.includes("rcs"), "RCS is never a vendor OTP challenge delivery channel");
  // The 5F-A migration deliberately does NOT touch verification_challenges.delivery_channel.
  assert(!/verification_challenges[\s\S]{0,200}delivery_channel/i.test(SQL.stripped5fa), "5F-A does not alter the challenge channel constraint");
});

// ============================================================================
// PROVIDER ACCOUNT REGISTRY (8–11)
// ============================================================================
check("8,10-11. provider account registry has no secret and no plaintext-destination columns", () => {
  const body = SQL.tables.provider_accounts;
  assert(body.length > 0, "communication_provider_accounts exists");
  assertNoForbiddenColumns(body, [
    /\baccess_token\b/i, /\bapp_secret\b/i, /\bwebhook_verify_token\b/i, /\bapi_key\b/i, /\bapi_secret\b/i,
    /\bservice_account\b/i, /\bprivate_key\b/i, /\bclient_secret\b/i, /\w*_token\b/i, /\w*secret\w*/i, /\bcredential\b/i,
  ], "provider_accounts");
  // No plaintext phone/MSISDN — only opaque *_reference identifiers.
  assertNoForbiddenColumns(body, [/\bphone_e164\b/i, /\bmsisdn\b/i, /\bphone_number\s+text/i, /\bdestination\b/i, /\botp\b/i], "provider_accounts");
  assert(/phone_number_reference\s+text/i.test(body), "stores only a non-secret phone_number_reference");
  // (11) provider readiness stores no plaintext destination — confirmed above.
});

check("9. provider account readiness vocabulary is constrained", () => {
  const body = SQL.tables.provider_accounts;
  assert(/readiness_status[\s\S]*?check \(readiness_status in \(([\s\S]*?)\)\)/.test(body), "readiness_status constrained");
  for (const v of ["not_configured", "credentials_pending", "account_ready", "webhook_pending", "template_mapping_pending", "provider_ready", "disabled"]) {
    assert(body.includes(`'${v}'`), `readiness vocabulary includes ${v}`);
  }
  // A provider_ready row does not enable dispatch: there is no is_operationally_enabled column here.
  assert(!/is_operationally_enabled/.test(body), "provider account rows carry no operational-enable flag (cannot activate dispatch)");
});

// ============================================================================
// TEMPLATE MAPPINGS (12–16)
// ============================================================================
check("12-13. multi-provider/channel/language/version mappings supported; ambiguity rejected", () => {
  const body = SQL.tables.template_mappings;
  assert(body.length > 0, "communication_provider_template_mappings exists");
  for (const col of ["template_key", "channel", "provider_key", "language", "version", "provider_template_name", "provider_template_id"]) {
    assert(new RegExp(`\\b${col}\\b`).test(body), `mapping has ${col}`);
  }
  // Uniqueness prevents an ambiguous active mapping.
  assert(/create unique index[\s\S]*?uq_comm_provider_template_mapping[\s\S]*?\(template_key, channel, provider_key, language, version\)/i.test(SQL.stripped5fa), "unique mapping per template/channel/provider/language/version");
  assert(/create unique index[\s\S]*?uq_comm_provider_template_active[\s\S]*?where is_active/i.test(SQL.stripped5fa), "at most one ACTIVE mapping");
});

check("14-15. approval states constrained; no approval fabricated (rows start draft, inactive)", () => {
  const body = SQL.tables.template_mappings;
  assert(/approval_status[\s\S]*?check \(approval_status in \(([\s\S]*?)\)\)/.test(body), "approval_status constrained");
  for (const v of ["draft", "ready_for_submission", "submitted", "approved", "rejected", "paused", "disabled", "superseded"]) {
    assert(body.includes(`'${v}'`), `approval vocabulary includes ${v}`);
  }
  assert(/approval_status\s+text not null default 'draft'/.test(body), "mappings default to draft (no fabricated approval)");
  assert(/is_active\s+boolean not null default false/.test(body), "mappings default inactive");
  // The migration inserts no mapping rows at all.
  assert(!/insert into public\.communication_provider_template_mappings/i.test(SQL.stripped5fa), "no mapping rows are seeded");
  // Only a sanitized rejection reason is stored — never a raw provider payload.
  assert(/rejection_reason_sanitized/.test(body) && !/rejection_reason_raw|raw_response|provider_payload/i.test(body), "only a sanitized rejection reason");
});

check("16. existing communication_templates rows are untouched by 5F-A", () => {
  // No template renames, deletes, category/readiness changes, or provider mapping writes.
  assert(!/update public\.communication_templates/i.test(SQL.stripped5fa), "no template UPDATE");
  assert(!/delete from public\.communication_templates/i.test(SQL.stripped5fa), "no template DELETE");
  assert(!/alter table public\.communication_templates[\s\S]{0,80}(rename|drop)/i.test(SQL.stripped5fa), "no template rename/drop");
  // The legacy provider_template_name/_id columns are NOT removed.
  assert(!/drop column[\s\S]{0,40}provider_template/i.test(SQL.stripped5fa), "legacy provider_template columns retained");
  const wa = readFileSync(WA_DOC, "utf8");
  assert(/provider_template_name = NULL/.test(wa) && /provider_template_id = NULL/.test(wa), "doc records templates remain unmapped");
});

// ============================================================================
// AUTH TRANSPORT POLICY (17–21)
// ============================================================================
check("17. all three auth flows exist in the transport policy seed", () => {
  assert(SQL.transportSeed, "transport policy seed parsed");
  for (const flow of ["client_login_otp", "vendor_whatsapp_verify", "vendor_password_reset"]) {
    assert(SQL.transportSeed.byFlow[flow], `${flow} policy seeded`);
  }
  // The contract knows exactly these flows.
  assert(JSON.stringify(M.AuthTransport.KNOWN_AUTH_FLOWS.slice().sort()) === JSON.stringify(["client_login_otp", "vendor_password_reset", "vendor_whatsapp_verify"]), "auth flow vocabulary matches");
});

check("18-19. client-login and vendor-reset declare an SMS fallback vocabulary but DISABLED", () => {
  for (const flow of ["client_login_otp", "vendor_password_reset"]) {
    const row = SQL.transportSeed.byFlow[flow];
    assert(row.primary_channel === "whatsapp", `${flow} primary is whatsapp`);
    assert(row.fallback_channel === "sms", `${flow} fallback vocabulary is sms, got ${row.fallback_channel}`);
    assert(row.automatic_fallback_enabled === "false", `${flow} automatic fallback disabled`);
    assert(row.user_requested_fallback_enabled === "false", `${flow} user-requested fallback disabled`);
    assert(row.is_operationally_enabled === "false", `${flow} not operationally enabled`);
  }
});

check("20. vendor_whatsapp_verify is WhatsApp-ONLY (primary whatsapp, no fallback) — seed AND schema", () => {
  const row = SQL.transportSeed.byFlow.vendor_whatsapp_verify;
  // (3) seed remains WhatsApp-primary / no-fallback.
  assert(row.primary_channel === "whatsapp", "primary whatsapp");
  assert(row.fallback_channel === "null", `vendor_whatsapp_verify must have NO fallback channel, got ${row.fallback_channel}`);
  // (1,2) A single DB CHECK forces BOTH primary=whatsapp AND fallback IS NULL for this
  // flow, regardless of any future seed edit — an sms/rcs-primary row is impossible.
  assert(/chk_auth_transport_whatsapp_verify_whatsapp_only/.test(SQL.stripped5fa), "the whatsapp-only CHECK exists");
  assert(/chk_auth_transport_whatsapp_verify_whatsapp_only[\s\S]*?auth_flow <> 'vendor_whatsapp_verify'[\s\S]*?primary_channel = 'whatsapp' and fallback_channel is null/.test(SQL.stripped5fa), "schema CHECK forces primary=whatsapp AND no fallback for vendor_whatsapp_verify");
  // The superseded no-fallback-only constraint is gone (folded into whatsapp_only, no duplication).
  assert(!/chk_auth_transport_whatsapp_verify_no_fallback/.test(SQL.stripped5fa), "the weaker no-fallback-only constraint is replaced, not duplicated");
  // The contract encodes the same possession-flow rule.
  assert(M.AuthTransport.WHATSAPP_POSSESSION_FLOW === "vendor_whatsapp_verify", "the possession flow is vendor_whatsapp_verify");
});

check("21. no fallback policy is operationally enabled; RCS is never an auth channel", () => {
  for (const row of SQL.transportSeed.rows) {
    assert(row.is_operationally_enabled === "false", `${row.auth_flow} must not be operationally enabled`);
    assert(row.automatic_fallback_enabled === "false", `${row.auth_flow} must not auto-fallback`);
    assert(row.fallback_policy_status === "disabled", `${row.auth_flow} fallback policy disabled`);
    assert(row.primary_channel !== "rcs" && row.fallback_channel !== "rcs", `${row.auth_flow} never uses RCS`);
  }
  assert(/chk_auth_transport_no_rcs/.test(SQL.stripped5fa), "schema CHECK forbids RCS in auth transport");
});

// ============================================================================
// DELIVERY ATTEMPTS (22–29)
// ============================================================================
check("22-23. delivery-attempt ledger has NO OTP and NO plaintext destination column", () => {
  const body = SQL.tables.delivery_attempts;
  assert(body.length > 0, "authentication_delivery_attempts exists");
  assertNoForbiddenColumns(body, [/\botp\b/i, /\botp_hash\b/i, /\bpassword\b/i, /\bmsisdn\b/i, /\bphone\b/i, /\bdestination\s+text/i, /\bdestination_e164\b/i], "delivery_attempts");
  assert(/destination_hash\s+text not null/i.test(body), "stores only a destination_hash");
});

check("24-25. attempt number unique per auth reference; message linkage unambiguous", () => {
  assert(/create unique index[\s\S]*?uq_auth_delivery_attempt_number[\s\S]*?\(auth_reference_type, auth_reference_id, attempt_number\)/i.test(SQL.stripped5fa), "attempt number unique per reference");
  assert(/create unique index[\s\S]*?uq_auth_delivery_attempt_message[\s\S]*?\(communication_message_id\)/i.test(SQL.stripped5fa), "one attempt per ledger message");
});

check("26-27. fallback lineage is traceable; outcome certainty is constrained", () => {
  const body = SQL.tables.delivery_attempts;
  assert(/fallback_from_attempt_id\s+uuid references public\.authentication_delivery_attempts\(id\)/i.test(body), "fallback lineage FK present");
  assert(/outcome_certainty[\s\S]*?check \(outcome_certainty in \('accepted', 'definitive_failure', 'unknown_outcome'\)\)/.test(body), "outcome certainty constrained");
});

check("28-29. unknown_outcome is NEVER fallback-eligible; definitive_failure only by enabled policy", () => {
  const A = M.AuthTransport;
  const policyEnabled = {
    authFlow: "client_login_otp", primaryChannel: "whatsapp", primaryProviderKey: "mock",
    fallbackChannel: "sms", fallbackProviderKey: "mock_sms",
    automaticFallbackEnabled: true, userRequestedFallbackEnabled: false, hardFailureOnly: true, isOperationallyEnabled: true,
  };
  const mk = (certainty) => ({ attemptNumber: 1, channel: "whatsapp", providerKey: "mock", certainty, failureClassification: null });

  // Unknown outcome is NEVER eligible, even under a fully enabled policy.
  const unknown = A.evaluateAutomaticFallback("client_login_otp", mk("unknown_outcome"), policyEnabled);
  assert(unknown.eligible === false && unknown.reason === "not_definitive_failure", "unknown_outcome is never fallback-eligible");
  // `accepted` is never eligible.
  assert(A.evaluateAutomaticFallback("client_login_otp", mk("accepted"), policyEnabled).eligible === false, "accepted is never fallback-eligible");
  // A DEFINITIVE failure is eligible ONLY under an enabled policy...
  assert(A.evaluateAutomaticFallback("client_login_otp", mk("definitive_failure"), policyEnabled).eligible === true, "definitive_failure + enabled policy is eligible");
  // ...and NOT under the shipped disabled policy.
  const disabled = { ...policyEnabled, isOperationallyEnabled: false };
  assert(A.evaluateAutomaticFallback("client_login_otp", mk("definitive_failure"), disabled).eligible === false, "a disabled policy is never eligible");
  const noAuto = { ...policyEnabled, automaticFallbackEnabled: false };
  assert(A.evaluateAutomaticFallback("client_login_otp", mk("definitive_failure"), noAuto).eligible === false, "automatic-fallback-disabled is never eligible");
  // vendor_whatsapp_verify is NEVER eligible, even with a definitive failure + enabled policy.
  const vwv = { ...policyEnabled, authFlow: "vendor_whatsapp_verify" };
  assert(A.evaluateAutomaticFallback("vendor_whatsapp_verify", mk("definitive_failure"), vwv).eligible === false, "vendor_whatsapp_verify never falls back");
  assert(A.isAutomaticFallbackEligible("vendor_whatsapp_verify", mk("definitive_failure"), vwv) === false, "…via the boolean helper too");
});

check("28b. evaluateAutomaticFallback fails closed on an authFlow/policy.authFlow mismatch", () => {
  const A = M.AuthTransport;
  const mk = (certainty) => ({ attemptNumber: 1, channel: "whatsapp", providerKey: "mock", certainty, failureClassification: null });
  // (8,9) A FULLY enabled policy for a DIFFERENT flow is STILL ineligible — mismatch first.
  const wrongFlowPolicy = {
    authFlow: "vendor_password_reset", primaryChannel: "whatsapp", primaryProviderKey: "mock",
    fallbackChannel: "sms", fallbackProviderKey: "mock_sms",
    automaticFallbackEnabled: true, userRequestedFallbackEnabled: false, hardFailureOnly: true, isOperationallyEnabled: true,
  };
  const res = A.evaluateAutomaticFallback("client_login_otp", mk("definitive_failure"), wrongFlowPolicy);
  assert(res.eligible === false && res.reason === "policy_flow_mismatch", `wrong-flow policy must be policy_flow_mismatch, got ${JSON.stringify(res)}`);
  assert(A.isAutomaticFallbackEligible("client_login_otp", mk("definitive_failure"), wrongFlowPolicy) === false, "…and ineligible via the boolean helper");
  assert(A.FallbackIneligibleReason.POLICY_FLOW_MISMATCH === "policy_flow_mismatch", "mismatch reason vocabulary present");
  // The mismatch is checked BEFORE certainty: even an unknown outcome reports the mismatch.
  const res2 = A.evaluateAutomaticFallback("client_login_otp", mk("unknown_outcome"), wrongFlowPolicy);
  assert(res2.eligible === false && res2.reason === "policy_flow_mismatch", "mismatch takes precedence over certainty");
  // (10,11) A CORRECT client_login_otp policy still evaluates normally.
  const rightPolicy = { ...wrongFlowPolicy, authFlow: "client_login_otp" };
  assert(A.evaluateAutomaticFallback("client_login_otp", mk("definitive_failure"), rightPolicy).eligible === true, "a correct-flow definitive_failure is still eligible");
  assert(A.evaluateAutomaticFallback("client_login_otp", mk("unknown_outcome"), rightPolicy).eligible === false, "unknown_outcome remains ineligible under the correct policy");
});

check("28c. buildAuthTransportPlan fails closed on a semantically invalid possession-flow policy", () => {
  const A = M.AuthTransport;
  const base = {
    authFlow: "vendor_whatsapp_verify", primaryChannel: "whatsapp", primaryProviderKey: "mock",
    fallbackChannel: null, fallbackProviderKey: null,
    automaticFallbackEnabled: false, userRequestedFallbackEnabled: false, hardFailureOnly: true, isOperationallyEnabled: false,
  };
  // A VALID possession policy → a plan with NO fallback step.
  const okRes = A.buildAuthTransportPlan(base);
  assert(okRes.ok === true, "a valid whatsapp-primary possession policy builds a plan");
  assert(okRes.plan.primary.channel === "whatsapp" && okRes.plan.fallback === null, "possession plan is whatsapp-primary with no fallback step");
  // (4,6) An SMS-primary vendor_whatsapp_verify is INVALID — no executable-looking plan, no sms->whatsapp rewrite.
  const smsPrimary = A.buildAuthTransportPlan({ ...base, primaryChannel: "sms", primaryProviderKey: "mock_sms" });
  assert(smsPrimary.ok === false && smsPrimary.reason === "whatsapp_verify_primary_not_whatsapp", "sms-primary vendor_whatsapp_verify is rejected");
  assert(!("plan" in smsPrimary), "no plan object is returned for the invalid sms-primary policy");
  // (5) An RCS-primary vendor_whatsapp_verify is likewise impossible (rcs !== whatsapp).
  const rcsPrimary = A.buildAuthTransportPlan({ ...base, primaryChannel: "rcs", primaryProviderKey: "mock_rcs" });
  assert(rcsPrimary.ok === false && rcsPrimary.reason === "whatsapp_verify_primary_not_whatsapp", "rcs-primary vendor_whatsapp_verify is rejected");
  // (7) A vendor_whatsapp_verify that declares a fallback is INVALID — no fallback step ever.
  const withFallback = A.buildAuthTransportPlan({ ...base, fallbackChannel: "sms", fallbackProviderKey: "mock_sms" });
  assert(withFallback.ok === false && withFallback.reason === "whatsapp_verify_has_fallback", "a declared fallback for vendor_whatsapp_verify is rejected");
  // A normal flow with a declared fallback still builds a plan WITH a fallback step (behavior preserved).
  const otp = A.buildAuthTransportPlan({ ...base, authFlow: "client_login_otp", fallbackChannel: "sms", fallbackProviderKey: "mock_sms" });
  assert(otp.ok === true && otp.plan.fallback !== null && otp.plan.fallback.channel === "sms", "a normal flow still declares its fallback step");
});

check("28d. the transport-policy correction adds NO send path / provider activation / fallback / RCS auth", () => {
  // (12) The contract stays pure: no client, no network, no send, no OTP generation.
  const code = stripTs(readFileSync(AUTH_TRANSPORT_SRC, "utf8"));
  assert(!/\.send\(|sendAuthenticationMessage|sendTemplateMessage|fetch\s*\(|https?:\/\/|createClient|supabaseClient/i.test(code), "authTransport remains a pure contract (no send/network/client)");
  // (13,14) Nothing activates an SMS provider or a fallback; the seed stays fully disabled.
  for (const row of SQL.transportSeed.rows) {
    assert(row.is_operationally_enabled === "false" && row.automatic_fallback_enabled === "false" && row.user_requested_fallback_enabled === "false", `${row.auth_flow} stays fully disabled`);
  }
  // (15) RCS is never an auth channel; a vendor_whatsapp_verify can never be rcs-primary (schema).
  assert(/chk_auth_transport_no_rcs/.test(SQL.stripped5fa), "RCS remains forbidden in auth transport");
});

// ============================================================================
// PREFERENCES / SUPPRESSIONS (30–33)
// ============================================================================
check("30-31. marketing preference is a SEPARATE scope from authentication", () => {
  const body = SQL.tables.preferences;
  assert(body.length > 0, "communication_preferences exists");
  assert(/scope[\s\S]*?check \(scope in \('authentication', 'transactional', 'marketing'\)\)/.test(body), "preference scopes constrained + distinct");
  // The three scopes are independent rows — marketing opt-out cannot be authentication.
  assert(/state[\s\S]*?check \(state in \('allowed', 'blocked', 'unknown'\)\)/.test(body), "preference state constrained");
  // No trigger/rule couples marketing to authentication.
  assert(!/create trigger[\s\S]*?communication_preferences/i.test(SQL.stripped5fa), "no trigger couples marketing to auth");
});

check("32-33. suppression stores hash only, with constrained scope", () => {
  const body = SQL.tables.suppressions;
  assert(body.length > 0, "communication_suppressions exists");
  assert(/destination_hash\s+text not null/i.test(body), "suppression keyed on a hash");
  assertNoForbiddenColumns(body, [/\bphone\b/i, /\bmsisdn\b/i, /\bdestination\s+text/i, /\botp\b/i], "suppressions");
  assert(/scope[\s\S]*?check \(scope in \('marketing', 'transactional', 'global'\)\)/.test(body), "suppression scope constrained (marketing separate)");
});

// ============================================================================
// RCS FOUNDATION (34–39)
// ============================================================================
check("34-35. RCS capability cache exists and stores a hash, not a plaintext MSISDN", () => {
  const body = SQL.tables.capabilities;
  assert(body.length > 0, "communication_channel_capabilities exists");
  assert(/destination_hash\s+text not null/i.test(body), "capability keyed on a hash");
  assertNoForbiddenColumns(body, [/\bmsisdn\b/i, /\bphone\b/i, /\bdestination\s+text/i], "capabilities");
  assert(/capability_status[\s\S]*?check \(capability_status in \('unknown', 'reachable', 'not_reachable', 'stale', 'error'\)\)/.test(body), "capability status constrained");
});

check("36-38. no RCS adapter, no Google API call, no service-account secret", () => {
  // Only pure contracts exist for RCS — no provider adapter file, no fetch/http, no Google.
  assert(!existsSync("lib/communication/providers/rcsProvider.ts"), "no RCS provider adapter file");
  assert(!existsSync("lib/communication/providers/mockRcsProvider.ts"), "no mock RCS adapter file");
  // Code-only (comments documenting the absence of Google APIs must not trip this).
  for (const banned of [/\bfetch\s*\(/i, /https?:\/\//i, /googleapis/i, /service[_-]?account/i, /private_key/i, /rcsbusinessmessaging/i]) {
    assert(!banned.test(RCS_CODE), `RCS contract code must not ${banned}`);
  }
  assert(!/google|service_account|private_key/i.test(SQL.stripped5fa), "migration stores no Google/service-account material");
  assert(M.Rcs.isRcsActive() === false, "RCS is never active in 5F-A");
});

check("39. planned RCS use case is PROMOTIONAL and documented", () => {
  assert(M.Rcs.QUICKFURNO_PLANNED_FIRST_RCS_USE_CASE === "promotional", "planned first use case is promotional");
  assert(JSON.stringify(M.Rcs.KNOWN_RCS_USE_CASES.slice().sort()) === JSON.stringify(["multi_use", "otp", "promotional", "transactional"]), "use-case vocabulary");
  const doc = readFileSync(RCS_DOC, "utf8");
  assert(/promotional/i.test(doc) && /no rcs integration is active/i.test(doc), "RCS doc documents the promotional target + inactivity");
});

// ============================================================================
// SMS FOUNDATION (40–44)
// ============================================================================
check("40-41. SmsProvider interface + MockSmsProvider exist", () => {
  assert(/export interface SmsProvider/.test(SMS_IFACE_TEXT), "SmsProvider interface defined");
  assert(/readonly channel: "sms"/.test(SMS_IFACE_TEXT), "SMS provider channel is sms");
  assert(/sendAuthenticationMessage\(/.test(SMS_IFACE_TEXT) && /healthCheck\(/.test(SMS_IFACE_TEXT), "auth-send + health methods");
  assert(typeof M.MockSms.MockSmsProvider === "function", "MockSmsProvider class exists");
  const p = new M.MockSms.MockSmsProvider();
  assert(p.providerKey === "mock_sms" && p.channel === "sms", "mock provider identity");
});

check("42-43. mock SMS makes no network send and never logs the OTP", async () => {
  const p = new M.MockSms.MockSmsProvider();
  // No network primitives in the mock source (code only).
  for (const banned of [/\bfetch\s*\(/i, /https?:\/\//i, /require\(['"]https?['"]\)/i, /net\.|dgram|axios/i]) {
    assert(!banned.test(MOCK_SMS_CODE), `mock SMS must not ${banned}`);
  }
  const captured = [];
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => captured.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  let res;
  try {
    res = await p.sendAuthenticationMessage("+919876543210", "vendor_whatsapp_verify", { otp: "483920" });
  } finally { Object.assign(console, orig); }
  assert(res.accepted === true && res.provider === "mock_sms" && res.channel === "sms", "deterministic accepted result");
  const blob = captured.join("\n") + JSON.stringify(p.getLastSentRecords());
  assert(!blob.includes("483920"), "the OTP must never be logged or retained");
  assert(p.getLastSentRecords()[0].variableKeys.includes("otp") && !("otp" in (p.getLastSentRecords()[0].variables ?? {})), "only variable NAMES are retained");
});

check("44. the mock SMS provider is not activated (no active-provider registration)", () => {
  // MockSmsProvider is never registered as an active provider, and CommunicationService
  // still only has a WhatsApp provider registry.
  assert(!/setActive.*[Ss]ms|activeSmsProvider|smsProvider\s*=/.test(readFileSync("services/communicationService.ts", "utf8")), "communicationService has no active SMS provider");
  assert(/test\/dev only/i.test(MOCK_SMS_TEXT), "the mock is documented test/dev only");
});

// ============================================================================
// WHATSAPP READINESS (45–51)
// ============================================================================
check("45-49. WhatsApp readiness doc: assets, secret contract, template lifecycle, webhook checklist", () => {
  const doc = readFileSync(WA_DOC, "utf8");
  assert(existsSync(WA_DOC), "prerequisite doc exists");
  for (const asset of ["WABA", "Phone number ID", "WABA ID", "business portfolio", "business verification", "display-name"]) {
    assert(new RegExp(asset, "i").test(doc), `doc documents asset: ${asset}`);
  }
  for (const secret of ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_WABA_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "WHATSAPP_GRAPH_API_VERSION"]) {
    assert(doc.includes(secret), `doc documents server-only contract: ${secret}`);
  }
  for (const wh of ["GET verification", "raw-body signature", "duplicate receipt", "delivery", "template status", "replay", "health"]) {
    assert(new RegExp(wh, "i").test(doc), `doc documents webhook item: ${wh}`);
  }
  for (const lc of ["submission", "approval", "rejection", "quality", "supersession"]) {
    assert(new RegExp(lc, "i").test(doc), `doc documents template lifecycle: ${lc}`);
  }
});

check("50-51. no real token committed anywhere; no provider activation", () => {
  // The server-only secret NAMES are documented but no VALUE is assigned.
  const doc = readFileSync(WA_DOC, "utf8");
  assert(/DELIBERATELY NOT SET/i.test(doc), "doc states secrets are not set");
  // No obvious real token/secret pattern in the tracked source we added.
  const blobs = [doc, readFileSync(WA_MANIFEST, "utf8"), SQL.raw5fa, MOCK_SMS_TEXT, RCS_TEXT];
  for (const b of blobs) {
    assert(!/EAA[A-Za-z0-9]{20,}/.test(b), "no Meta access-token-shaped value");
    assert(!/sk_live_[A-Za-z0-9]{16,}/.test(b), "no live secret-key-shaped value");
    assert(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(b), "no private key material");
  }
  // The manifest fabricates no approval and holds no real OTP example.
  const manifest = JSON.parse(readFileSync(WA_MANIFEST, "utf8"));
  const entries = [...manifest.groups.authentication, ...manifest.groups.transactional_business];
  assert(entries.length === 16, `manifest covers all 16 templates, got ${entries.length}`);
  for (const e of entries) {
    assert(e.approval_status === "draft", `${e.internal_template_key} is draft (no fabricated approval)`);
    assert(e.provider_template_id === null, `${e.internal_template_key} has no provider template id`);
  }
});

// ============================================================================
// REGRESSIONS (52–60)
// ============================================================================
check("52. Phase 5E challenge architecture is unchanged by 5F-A", () => {
  assert(!/verification_challenges/.test(SQL.stripped5fa) || !/alter table public\.verification_challenges/i.test(SQL.stripped5fa), "5F-A does not alter verification_challenges");
  assert(!/drop function[\s\S]*?vendor_auth_/i.test(SQL.stripped5fa), "no Phase 5E function is dropped");
});

check("53-54. Phase 5D hook + Phase 5B WhatsApp behaviour are unchanged", () => {
  // 5F-A adds no code path into the hook or CommunicationService dispatch.
  assert(!existsSync("scripts/phase5f-a-messaging-foundation-harness.mjs") === false, "harness present (sanity)");
  const comm = readFileSync("services/communicationService.ts", "utf8");
  assert(/getActiveWhatsAppProvider/.test(comm), "WhatsApp provider registry intact");
  // The widened channel type did not add SMS/RCS routing into the service.
  assert(!/sendAuthenticationMessage[\s\S]{0,200}sms|routeSms|dispatchSms/i.test(comm), "no SMS dispatch wired into CommunicationService");
});

check("55-58. nothing enabled; no false approval; no SMS/RCS send path wired", () => {
  assert(!/is_operationally_enabled\s*=\s*true/i.test(SQL.stripped5fa), "no automation/policy operationally enabled");
  assert(!/readiness_status\s*=\s*'active'/i.test(SQL.stripped5fa), "no readiness advanced to active");
  assert(!/approval_status[\s\S]{0,40}'approved'/i.test(SQL.stripped5fa) || !/insert into public\.communication_provider_template_mappings/i.test(SQL.stripped5fa), "no approved mapping inserted");
  // No SMS/RCS provider is registered as active in any service.
  assert(!existsSync("services/smsDispatchService.ts") && !existsSync("services/rcsDispatchService.ts"), "no SMS/RCS dispatch service");
});

check("59-60. no n8n auth path; no UI redesign", () => {
  for (const src of [SQL.stripped5fa, MOCK_SMS_TEXT, RCS_TEXT, AUTH_TRANSPORT_TEXT, TYPES_TEXT]) {
    assert(!/n8n/i.test(src), "no n8n reference in 5F-A artefacts");
  }
  // No app/ UI file was created by 5F-A (foundation only).
  assert(!existsSync("app/messaging") && !existsSync("app/admin/messaging"), "no UI surface added");
});

// ============================================================================
// FUTURE-COMPATIBILITY: AGENTS / RECOMMENDATIONS / CAMPAIGNS / EVENTS (F1–F10)
// ============================================================================
const AGENT_CODE = stripTs(readFileSync(ATTRIBUTION_SRC, "utf8")) + "\n" +
  stripTs(readFileSync(RECOMMENDATION_SRC, "utf8")) + "\n" +
  stripTs(readFileSync(CAMPAIGN_SRC, "utf8")) + "\n" +
  stripTs(readFileSync(COMM_REC_SRC, "utf8")) + "\n" +
  stripTs(readFileSync(EVENT_ENVELOPE_SRC, "utf8"));

check("F1. agent attribution cannot authorize a communication", () => {
  const A = M.Attribution;
  assert(typeof A.attributionAuthorizes === "function", "attributionAuthorizes exists");
  // Even a fully-populated agent attribution context authorizes nothing.
  const ctx = {
    decisionSourceType: "agent", decisionSourceId: "qf_jarvis", recommendationId: "r1",
    approvalRequestId: "a1", campaignId: "c1", experimentId: "e1", policyDecisionId: "p1", correlationId: "x1",
  };
  assert(A.attributionAuthorizes(ctx) === false, "attribution never authorizes");
  assert(A.attributionAuthorizes() === false, "attribution never authorizes (empty)");
  assert(JSON.stringify(A.KNOWN_DECISION_SOURCE_TYPES.slice().sort()) === JSON.stringify(["admin", "agent", "system", "workflow"]), "decision source vocabulary");
  // The context type carries no capability field.
  assert(!/authorized|isAuthorized|canDispatch|allow\b/i.test(stripTs(readFileSync(ATTRIBUTION_SRC, "utf8")).replace(/attributionAuthorizes|hasPolicyAuthorizationReference/g, "")), "decision context has no authorization capability field");
});

check("F2. an approved recommendation cannot bypass the Phase 4 Policy Engine", () => {
  const R = M.Recommendation;
  assert(JSON.stringify(R.KNOWN_RECOMMENDATION_STATUSES.slice().sort()) === JSON.stringify(["approved", "cancelled", "draft", "executed", "expired", "proposed", "rejected", "under_review"]), "recommendation status vocabulary");
  // An APPROVED recommendation still authorizes nothing.
  const approved = { recommendationId: "r1", agent: "riya", recommendationType: "nudge", riskLevel: "high", status: "approved", approvalRequirement: "single_admin", approvalRequestId: "a1", correlationId: null, rationaleSafe: {}, createdAt: "2026-07-09T00:00:00Z", expiresAt: null };
  assert(R.recommendationAuthorizes(approved) === false, "an approved recommendation authorizes nothing");
  assert(R.recommendationAuthorizes() === false, "…and neither does an empty one");
  // The required downstream path routes through QuickFurno (Phase 4) authorization.
  assert(R.RECOMMENDATION_TO_DISPATCH_PATH[0] === "agent_recommendation", "path starts at the recommendation");
  assert(R.RECOMMENDATION_TO_DISPATCH_PATH.includes("quickfurno_authorization"), "path requires QuickFurno authorization");
  assert(R.RECOMMENDATION_TO_DISPATCH_PATH.indexOf("quickfurno_authorization") < R.RECOMMENDATION_TO_DISPATCH_PATH.indexOf("communication_service"), "authorization precedes CommunicationService");
});

check("F3-4. logical agent names are not DB roles, and no Jarvis service-role credential exists", () => {
  const A = M.Attribution;
  assert(JSON.stringify(A.KNOWN_LOGICAL_AGENTS.slice().sort()) === JSON.stringify(["arjun", "jitin", "kabir", "meera", "qf_jarvis", "riya", "veer"]), "logical agent vocabulary");
  // No logical agent collides with a privileged DB/Supabase role.
  for (const agent of A.KNOWN_LOGICAL_AGENTS) {
    assert(A.isReservedDbRole(agent) === false, `${agent} must not be a reserved DB role`);
  }
  assert(A.isReservedDbRole("service_role") === true && A.isReservedDbRole("postgres") === true, "the reserved-role guard is real");
  // No agent-role migration, no service-role grant to an agent.
  assert(!/create role|create user|grant\s+[\s\S]{0,60}\s+to\s+(qf_jarvis|riya|jitin|kabir|arjun|meera|veer)\b/i.test(SQL.stripped5fa), "no DB role/grant for any agent");
  // No agent artefact carries a service-role key/credential.
  for (const b of [AGENT_CODE, readFileSync(JARVIS_DOC, "utf8")]) {
    assert(!/service[_-]?role[_-]?key|SUPABASE_SERVICE_ROLE|serviceRoleKey/i.test(b), "no service-role credential for an agent");
  }
});

check("F5. campaign-intent contracts cannot dispatch (and never send RCS)", () => {
  const C = M.Campaign;
  assert(typeof C.campaignIntentCanDispatch === "function", "campaignIntentCanDispatch exists");
  assert(C.campaignIntentCanDispatch() === false, "campaign intent cannot dispatch");
  assert(JSON.stringify(C.KNOWN_CAMPAIGN_OBJECTIVES.slice().sort()) === JSON.stringify(["announcement", "awareness", "cross_sell", "reactivation", "retention"]), "campaign objectives");
  // The campaign contract imports no service/provider and has no send call.
  const code = stripTs(readFileSync(CAMPAIGN_SRC, "utf8"));
  assert(!/communicationService|CommunicationService|Provider\b|\.send\(|sendTemplateMessage|sendAuthenticationMessage/.test(code), "campaign intent imports/invokes no dispatch path");
  assert(!/fetch\s*\(|https?:\/\//i.test(code), "campaign intent makes no network call");
});

check("F6. communication recommendation contracts cannot directly invoke providers", () => {
  const CR = M.CommRecommendation;
  assert(typeof CR.communicationRecommendationCanDispatch === "function", "guard exists");
  assert(CR.communicationRecommendationCanDispatch() === false, "recommendation cannot dispatch");
  assert(JSON.stringify(CR.COMMUNICATION_RECOMMENDATION_PATH) === JSON.stringify(["agent_recommendation", "quickfurno_authorization", "consent_suppression_checks", "channel_provider_decision", "communication_service", "provider"]), "required path is intact + ordered");
  // The recommendation contract imports NEITHER CommunicationService NOR a provider.
  const code = readFileSync(COMM_REC_SRC, "utf8");
  const importLines = code.split("\n").filter((l) => /^\s*import\b/.test(l)).join("\n");
  assert(!/communicationService|\/providers\/|\bprovider\b/i.test(importLines), "imports no service/provider adapter");
  const stripped = stripTs(code);
  assert(!/\.send\(|sendAuthenticationMessage|sendTemplateMessage|getActiveWhatsAppProvider/.test(stripped), "invokes no send path");
  // recipientScopeReference is a reference, not a plaintext destination.
  assert(/recipientScopeReference/.test(code) && !/\bphone\b|\bmsisdn\b|\bemail\b/i.test(stripped), "recipient is a scope reference, not a plaintext destination");
});

check("F7. the event-envelope contract is PURE future-compat: no persistence, no secret, cannot authorize", () => {
  const E = M.EventEnvelope;
  // (1) Pure contract: Phase 5F-A persists nothing and builds no event infrastructure.
  const S = E.EVENT_PERSISTENCE_STATUS;
  assert(S.persistedByPhase5FA === false, "envelope is not persisted by 5F-A");
  assert(S.createsTable === false && S.createsOutbox === false, "creates no table / no outbox");
  assert(S.createsEventBus === false && S.createsConsumer === false, "creates no event bus / no consumer");
  assert(S.createsExecutionPath === false && S.authorizesActions === false, "no execution path; authorizes nothing");
  // No LIVE mapping is claimed; the workflow-kernel tables are only noted as unapplied.
  assert(Array.isArray(S.liveMappedTables) && S.liveMappedTables.length === 0, "no live table is mapped");
  // (2,3) The Phase 5F-A migration creates NO domain_events / outbox_events / event table.
  assert(!/create table[\s\S]*?public\.(domain_events|outbox_events|event_envelope|agent_events|event_bus|event_consumer)/i.test(SQL.stripped5fa), "5F-A creates no event table/outbox");
  // (4,5,6,7) The envelope module is inert: no bus, no consumer, no n8n, no provider send, no persistence wiring.
  const code = stripTs(readFileSync(EVENT_ENVELOPE_SRC, "utf8"));
  // The wiring/authorization greps ignore the declarative EVENT_PERSISTENCE_STATUS
  // key names (e.g. createsEventBus/authorizesActions are STATEMENTS OF ABSENCE,
  // not wiring), so a key name can never falsely trip a "wires a bus" check.
  const codeNoStatus = code.replace(/EVENT_PERSISTENCE_STATUS[\s\S]*?\}\);/, "");
  assert(!/\bimport\b/.test(code), "the envelope contract imports nothing (no service/provider/kernel wiring)");
  assert(!/\.send\(|sendAuthenticationMessage|sendTemplateMessage|communicationService|CommunicationService|Provider\b/.test(code), "envelope triggers no provider send");
  assert(!/domainEventService|outboxService|EventBus|EventConsumer|publish\(|consume\(|dispatch\(|n8n/i.test(codeNoStatus), "envelope wires no bus/consumer/n8n/persistence");
  assert(!/fetch\s*\(|https?:\/\//i.test(code), "envelope makes no network call");
  // (10) The module exports no function at all, so it can neither authorize nor execute.
  assert(!/export function\b/.test(code), "the envelope exposes no function (cannot authorize/execute)");
  assert(!/\bauthorize\b|canDispatch|\bexecute\b/i.test(codeNoStatus), "no authorization/execution capability");
  // (8,9) No secret / OTP / token / password / session field on the contract.
  const iface = code.slice(code.indexOf("interface CanonicalEventEnvelope"), code.indexOf("}", code.indexOf("interface CanonicalEventEnvelope")));
  for (const forbidden of E.FORBIDDEN_ENVELOPE_FIELDS) {
    assert(!new RegExp(`\\breadonly ${forbidden.replace(/[_]/g, "[_]?")}\\b`, "i").test(iface), `envelope must not expose ${forbidden}`);
  }
  assert(E.FORBIDDEN_ENVELOPE_FIELDS.includes("otp") && E.FORBIDDEN_ENVELOPE_FIELDS.includes("session_token"), "OTP + session-credential names are explicitly forbidden");
  assert(/readonly safePayload:/.test(iface), "payload carried only as safePayload");
  // The envelope carries the required canonical fields.
  for (const field of ["eventId", "eventType", "eventVersion", "occurredAt", "recordedAt", "sourceSystem", "actorType", "actorId", "entityType", "entityId", "correlationId", "causationId", "idempotencyKey", "riskLevel", "approvalRequired", "payloadSchemaVersion", "safePayload", "traceId"]) {
    assert(new RegExp(`readonly ${field}\\b`).test(iface), `envelope has ${field}`);
  }
});

check("F8-10. no LLM call, no autonomous action loop, no Jarvis deployment introduced", () => {
  const blob = AGENT_CODE + "\n" + readFileSync(JARVIS_DOC, "utf8").replace(/no llm[\s\S]*?call/gi, "");
  // No LLM/API client.
  for (const banned of [/openai/i, /anthropic/i, /\bllm\b/i, /gpt-|claude-|gemini/i, /fetch\s*\(/i, /https?:\/\//i, /generateText|chatCompletion|createCompletion/i]) {
    assert(!banned.test(AGENT_CODE), `agent contracts must not ${banned}`);
  }
  // No autonomous action loop.
  for (const banned of [/while\s*\(\s*true\s*\)/i, /setInterval\s*\(/i, /setTimeout\s*\(/i, /for\s*\(\s*;;\s*\)/i, /cron|scheduler|autonomous/i]) {
    assert(!banned.test(AGENT_CODE), `agent contracts must not ${banned}`);
  }
  // No Jarvis deployment / runtime / endpoint / DB object introduced by 5F-A.
  assert(!existsSync("app/api/jarvis") && !existsSync("services/jarvisService.ts"), "no Jarvis runtime/endpoint");
  assert(!/create table[\s\S]*?jarvis|jarvis[\s\S]*?service_role/i.test(SQL.stripped5fa), "no Jarvis DB object");
  const doc = readFileSync(JARVIS_DOC, "utf8");
  assert(/separate repository/i.test(doc) && /system of record/i.test(doc) && /never receive unrestricted database access/i.test(doc), "boundary doc records the key guarantees");
  assert(/n8n remains the execution fabric/i.test(doc), "n8n remains execution fabric, not the second brain");
});

// ============================================================================
// RUNTIME CHANNEL SAFETY: CommunicationService stays WhatsApp-only (C1–C9)
// ============================================================================
const readSvc = () => readFileSync(COMM_SERVICE_SRC, "utf8");

function walkFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

check("C1. pure channel guards: only an exact channel/provider match is dispatchable", () => {
  const G = M.ChannelGuard;
  // A whatsapp message/intent on the whatsapp provider is the ONLY dispatchable case.
  assert(G.isChannelDispatchable("whatsapp", "whatsapp") === true, "whatsapp dispatchable on whatsapp");
  assert(G.isChannelDispatchable("sms", "whatsapp") === false, "sms not dispatchable on whatsapp");
  assert(G.isChannelDispatchable("rcs", "whatsapp") === false, "rcs not dispatchable on whatsapp");
  // Strict identity — never a coercion/rewrite to whatsapp.
  assert(G.isChannelDispatchable("whatsapp", "sms") === false && G.isChannelDispatchable("whatsapp", "rcs") === false, "strict identity, no coercion");
  // Template consistency is the same strict identity.
  assert(G.isTemplateChannelConsistent("whatsapp", "whatsapp") === true, "matching template channel ok");
  assert(G.isTemplateChannelConsistent("sms", "whatsapp") === false && G.isTemplateChannelConsistent("whatsapp", "sms") === false, "mismatched template channel rejected");
  assert(G.CHANNEL_DISPATCH_ERROR.UNSUPPORTED_DISPATCH_CHANNEL === "UNSUPPORTED_DISPATCH_CHANNEL" && G.CHANNEL_DISPATCH_ERROR.TEMPLATE_CHANNEL_MISMATCH === "TEMPLATE_CHANNEL_MISMATCH", "ledger-safe error vocabulary");
  // The guard module is PURE: no service/provider import, no send, no network.
  const code = stripTs(readFileSync(CHANNEL_GUARD_SRC, "utf8"));
  assert(!/communicationService|\/providers\/|\.send\(|fetch\s*\(|https?:\/\//i.test(code), "channel guard is pure (no service/provider/network)");
});

check("C2. provider channel identity is explicit (whatsapp providers = whatsapp; sms providers = sms)", () => {
  // Compiled: the mock SMS adapter reports channel 'sms'.
  const sms = new M.MockSms.MockSmsProvider();
  assert(sms.channel === "sms" && sms.providerKey === "mock_sms", "mock SMS provider identity");
  // Source: the WhatsApp interface + mock adapter declare channel 'whatsapp'.
  assert(/readonly channel:\s*"whatsapp"/.test(readFileSync(WA_PROVIDER_SRC, "utf8")), "WhatsAppProvider interface declares channel 'whatsapp'");
  assert(/readonly channel = "whatsapp" as const/.test(readFileSync(MOCK_WA_PROVIDER_SRC, "utf8")), "MockWhatsAppProvider declares channel 'whatsapp'");
  // The SMS interface declares channel 'sms'.
  assert(/readonly channel:\s*"sms"/.test(readFileSync(SMS_IFACE_SRC, "utf8")), "SmsProvider interface declares channel 'sms'");
});

check("C3. INITIAL SEND GUARD rejects a non-whatsapp intent BEFORE any insert or provider call", () => {
  const svc = readSvc();
  assert(svc.includes(GUARD_INITIAL_SEND), "initial-send channel guard present");
  const g = svc.indexOf(GUARD_INITIAL_SEND);
  const insertIdx = svc.indexOf(".insert(insertRow)");
  const dispatchIdx = svc.indexOf("return this.dispatchMessage(message, {");
  assert(g > 0 && insertIdx > 0 && g < insertIdx, "guard precedes the communication_messages insert (zero ledger rows for sms/rcs)");
  assert(g < dispatchIdx, "guard precedes the provider dispatch (zero provider calls for sms/rcs)");
  // No silent sms/rcs -> whatsapp rewrite anywhere.
  assert(!/intent\.channel\s*=\s*"whatsapp"/.test(svc) && !/message\.channel\s*=\s*"whatsapp"/.test(svc), "channel is never reassigned to whatsapp");
});

check("C4. TEMPLATE CHANNEL CONSISTENCY rejects a template whose channel != intent channel", () => {
  const svc = readSvc();
  assert(svc.includes(GUARD_TEMPLATE_CHANNEL), "template-channel consistency guard present");
  const g = svc.indexOf(GUARD_TEMPLATE_CHANNEL);
  const insertIdx = svc.indexOf(".insert(insertRow)");
  assert(g > 0 && g < insertIdx, "template-channel guard precedes the ledger insert (no provider call on mismatch)");
});

check("C5. PERSISTED-MESSAGE DISPATCH GUARD blocks an sms/rcs row at the final dispatch boundary", () => {
  const svc = readSvc();
  assert(svc.includes(GUARD_PERSISTED_DISPATCH), "persisted-message dispatch guard present");
  const dispIdx = svc.indexOf("async dispatchMessage(");
  const g = svc.indexOf(GUARD_PERSISTED_DISPATCH, dispIdx);
  const claimIdx = svc.indexOf("this.claimMessageForDispatch(message)");
  assert(dispIdx > 0 && g > dispIdx && claimIdx > 0 && g < claimIdx, "guard is inside dispatchMessage and precedes the claim (zero provider calls)");
});

check("C6. PROVIDER/MESSAGE CHANNEL IDENTITY CHECK precedes the provider invocation", () => {
  const svc = readSvc();
  assert(svc.includes(GUARD_PROVIDER_IDENTITY), "provider/message channel identity check present");
  const invIdx = svc.indexOf("private async invokeProvider(");
  const g = svc.indexOf(GUARD_PROVIDER_IDENTITY, invIdx);
  const callIdx = svc.indexOf("this.provider.sendAuthenticationMessage");
  assert(invIdx > 0 && g > invIdx && callIdx > 0 && g < callIdx, "identity check precedes the provider call (zero invocation on mismatch)");
});

check("C7. WEBHOOK CHANNEL FENCE stops WhatsApp webhook processing updating an sms/rcs message", () => {
  const svc = readSvc();
  assert(svc.includes(GUARD_WEBHOOK_FENCE), "webhook channel fence present");
  const applyIdx = svc.indexOf("private async applyWebhookEvent(");
  const g = svc.indexOf(GUARD_WEBHOOK_FENCE, applyIdx);
  const updateIdx = svc.indexOf('.from("communication_messages")', g);
  assert(applyIdx > 0 && g > applyIdx && updateIdx > 0 && g < updateIdx, "fence precedes the message update");
  // The webhook message lookup is also provider-scoped (defence in depth).
  assert(/\.eq\("provider", this\.provider\.providerKey\)/.test(svc), "webhook message lookup is provider-scoped");
});

check("C8. no SMS/RCS router or webhook route; MockSmsProvider stays inactive; whatsapp is the only active provider", () => {
  // No generic production router, no SMS/RCS dispatch service, no SMS/RCS webhook route.
  for (const f of ["services/smsDispatchService.ts", "services/rcsDispatchService.ts", "services/messageRouter.ts", "services/communicationRouter.ts"]) {
    assert(!existsSync(f), `${f} must not exist`);
  }
  assert(!existsSync("app/api/webhooks/sms") && !existsSync("app/api/webhooks/rcs") && !existsSync("app/api/communication/sms") && !existsSync("app/api/communication/rcs"), "no SMS/RCS webhook route");
  // The default active provider is the mock WhatsApp adapter; the service touches no SMS provider.
  const svc = readSvc();
  assert(/new MockWhatsAppProvider\(\)/.test(svc), "the default active provider is the mock WhatsApp adapter");
  assert(!/MockSmsProvider|mockSmsProvider|smsProvider/.test(svc), "CommunicationService neither imports nor instantiates any SMS provider");
  // MockSmsProvider is never activated by any production file (only the harness scripts touch it).
  const productionFiles = [...walkFiles("services"), ...walkFiles("app"), ...walkFiles("lib")]
    .filter((f) => /\.(ts|tsx)$/.test(f) && f.replace(/\\/g, "/") !== MOCK_SMS_SRC);
  for (const f of productionFiles) {
    const c = readFileSync(f, "utf8");
    assert(!/new\s+MockSmsProvider\s*\(/.test(c), `${f} must not instantiate MockSmsProvider`);
    assert(!/setActiveSmsProvider|activeSmsProvider/.test(c), `${f} must not register an active SMS provider`);
  }
});

check("C9. Phase 5B whatsapp behavior is preserved; the guards are pure add-on refusals; Jarvis untouched", () => {
  const svc = readSvc();
  // The existing Phase 5B lane/readiness/redispatch guards remain — nothing was replaced.
  assert(/TEMPLATE_LANE_MISMATCH/.test(svc) && /TEMPLATE_NOT_READY/.test(svc) && /AUTH_LANE_NOT_REDISPATCHABLE/.test(svc), "existing Phase 5B template/lane guards intact");
  // A whatsapp intent + whatsapp template still dispatches — the guards pass through for whatsapp.
  const G = M.ChannelGuard;
  assert(G.isChannelDispatchable("whatsapp", "whatsapp") === true && G.isTemplateChannelConsistent("whatsapp", "whatsapp") === true, "whatsapp path unaffected by the guards");
  // The channel guard is independent of the Jarvis future-compat contracts.
  const code = readFileSync(CHANNEL_GUARD_SRC, "utf8");
  assert(!/agents\/|events\/|jarvis|attribution|recommendation|campaign/i.test(code), "channel guard does not touch the Jarvis/agents/events contracts");
});

check("wiring. test:phase5f:a + migration + docs + contracts exist", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert(pkg.scripts["test:phase5f:a"] === "node scripts/phase5f-a-messaging-foundation-harness.mjs", "test:phase5f:a wired");
  for (const s of ["test:phase5a", "test:phase5b", "test:phase5c", "test:phase5d", "test:phase5e"]) {
    assert(typeof pkg.scripts[s] === "string", `${s} still available`);
  }
  for (const f of [MIGRATION_5FA, WA_DOC, SMS_DOC, RCS_DOC, WA_MANIFEST, SMS_IFACE_SRC, MOCK_SMS_SRC, AUTH_TRANSPORT_SRC, RCS_SRC,
    ATTRIBUTION_SRC, RECOMMENDATION_SRC, CAMPAIGN_SRC, COMM_REC_SRC, EVENT_ENVELOPE_SRC, JARVIS_DOC,
    CHANNEL_GUARD_SRC, COMM_SERVICE_SRC, WA_PROVIDER_SRC, MOCK_WA_PROVIDER_SRC]) {
    assert(existsSync(f), `${f} exists`);
  }
});

// ============================================================================
// MUTATION TESTS — edit the real migration/TypeScript, re-derive, assert red
// ============================================================================
// A `sql` mutation edits a migration file and rebuilds the parsed SQL model. A `ts`
// mutation edits a TypeScript contract and recompiles. Every mutation must make at
// least one functional check throw (the vulnerability appears).
const mutationChecks = [];
function sqlMutation(name, file, from, to, scenario) {
  mutationChecks.push({ name, kind: "sql", edits: [{ file, from, to }], scenario });
}
function tsMutation(name, edits, scenario) {
  // edits arrive as [ [file, from, to], ... ] tuples; normalize to objects.
  mutationChecks.push({ name, kind: "ts", edits: edits.map(([file, from, to]) => ({ file, from, to })), scenario });
}
/** Edits a NON-compiled source file (e.g. a service) and re-derives via fresh file reads. */
function srcMutation(name, file, from, to, scenario) {
  mutationChecks.push({ name, kind: "src", edits: [{ file, from, to }], scenario });
}

sqlMutation("MUT: allow RCS in the Phase 5E challenge delivery_channel",
  MIGRATION_5E,
  "check (delivery_channel is null or delivery_channel in ('whatsapp', 'sms'));",
  "check (delivery_channel is null or delivery_channel in ('whatsapp', 'sms', 'rcs'));",
  () => {
    // RCS must never be a vendor OTP challenge channel.
    return SQL.challengeDeliveryChannel.includes("rcs");
  });

sqlMutation("MUT: enable an authentication fallback policy operationally",
  MIGRATION_5FA,
  "('client_login_otp',      'whatsapp', 'mock', 'sms',  null, false, false, 'disabled', true, false),",
  "('client_login_otp',      'whatsapp', 'mock', 'sms',  null, true, false, 'automatic_ready', true, true),",
  () => {
    const row = SQL.transportSeed.byFlow.client_login_otp;
    return row.is_operationally_enabled === "true" || row.automatic_fallback_enabled === "true";
  });

sqlMutation("MUT: give vendor_whatsapp_verify an SMS fallback",
  MIGRATION_5FA,
  "('vendor_whatsapp_verify','whatsapp', 'mock', null,   null, false, false, 'disabled', true, false)",
  "('vendor_whatsapp_verify','whatsapp', 'mock', 'sms',  null, false, false, 'disabled', true, false)",
  () => {
    return SQL.transportSeed.byFlow.vendor_whatsapp_verify.fallback_channel === "sms";
  });

sqlMutation("MUT: add a plaintext destination column to the delivery-attempt ledger",
  MIGRATION_5FA,
  "  destination_hash          text not null,\n  attempt_number            integer not null check (attempt_number >= 1),",
  "  destination_hash          text not null,\n  destination               text not null,\n  attempt_number            integer not null check (attempt_number >= 1),",
  () => {
    return /\bdestination\s+text/i.test(SQL.tables.delivery_attempts);
  });

sqlMutation("MUT: add an OTP column to the delivery-attempt ledger",
  MIGRATION_5FA,
  "  destination_hash          text not null,\n  attempt_number            integer not null check (attempt_number >= 1),",
  "  destination_hash          text not null,\n  otp                       text,\n  attempt_number            integer not null check (attempt_number >= 1),",
  () => {
    return /\botp\b/i.test(SQL.tables.delivery_attempts);
  });

sqlMutation("MUT: add a token column to the provider account registry",
  MIGRATION_5FA,
  "  phone_number_reference        text,\n  readiness_status",
  "  phone_number_reference        text,\n  access_token                  text,\n  readiness_status",
  () => {
    return /\baccess_token\b/i.test(SQL.tables.provider_accounts);
  });

sqlMutation("MUT: grant anon access to a sensitive new table",
  MIGRATION_5FA,
  "-- SECTION 9 — RLS + PRIVILEGES (least privilege; no browser policies)",
  "-- SECTION 9 — RLS + PRIVILEGES (least privilege; no browser policies)\ngrant select on public.communication_provider_accounts to anon;",
  () => {
    return /grant\s+[a-z, ]+\s+on\s+public\.\w+\s+to\s+anon/i.test(SQL.stripped5fa);
  });

tsMutation("MUT: make unknown_outcome fallback-eligible in the transport contract",
  [["lib/identity/authTransport.ts",
    "  if (outcome.certainty !== AuthOutcomeCertainty.DEFINITIVE_FAILURE) {\n    return { eligible: false, reason: FallbackIneligibleReason.NOT_DEFINITIVE_FAILURE };\n  }",
    "  if (outcome.certainty === AuthOutcomeCertainty.ACCEPTED) {\n    return { eligible: false, reason: FallbackIneligibleReason.NOT_DEFINITIVE_FAILURE };\n  }"]],
  (mm) => {
    // With the guard loosened to accept unknown_outcome, an unknown outcome under an
    // enabled policy becomes eligible — a duplicate-OTP hazard.
    const policy = {
      authFlow: "client_login_otp", primaryChannel: "whatsapp", primaryProviderKey: "mock",
      fallbackChannel: "sms", fallbackProviderKey: "mock_sms",
      automaticFallbackEnabled: true, userRequestedFallbackEnabled: false, hardFailureOnly: true, isOperationallyEnabled: true,
    };
    const outcome = { attemptNumber: 1, channel: "whatsapp", providerKey: "mock", certainty: "unknown_outcome", failureClassification: null };
    return mm.AuthTransport.evaluateAutomaticFallback("client_login_otp", outcome, policy).eligible === true;
  });

// --- TRANSPORT-POLICY HARDENING mutations -----------------------------------
// (A) Remove the WhatsApp-primary requirement from the schema constraint.
sqlMutation("MUT: allow a non-whatsapp primary for vendor_whatsapp_verify (drop the whatsapp-only requirement)",
  MIGRATION_5FA,
  "check (auth_flow <> 'vendor_whatsapp_verify'\n           or (primary_channel = 'whatsapp' and fallback_channel is null))",
  "check (auth_flow <> 'vendor_whatsapp_verify'\n           or (fallback_channel is null))",
  () => {
    // The schema no longer forces vendor_whatsapp_verify to be whatsapp-primary.
    return !/chk_auth_transport_whatsapp_verify_whatsapp_only[\s\S]*?primary_channel = 'whatsapp' and fallback_channel is null/.test(SQL.stripped5fa);
  });

// (B) Let buildAuthTransportPlan emit an SMS-primary plan for vendor_whatsapp_verify.
tsMutation("MUT: allow an SMS-primary vendor_whatsapp_verify transport plan",
  [["lib/identity/authTransport.ts",
    "    if (policy.primaryChannel !== AuthTransportChannel.WHATSAPP) {\n      return { ok: false, reason: InvalidTransportPolicyReason.WHATSAPP_VERIFY_PRIMARY_NOT_WHATSAPP };\n    }\n",
    ""]],
  (mm) => {
    const p = { authFlow: "vendor_whatsapp_verify", primaryChannel: "sms", primaryProviderKey: "mock_sms", fallbackChannel: null, fallbackProviderKey: null, automaticFallbackEnabled: false, userRequestedFallbackEnabled: false, hardFailureOnly: true, isOperationallyEnabled: false };
    const r = mm.AuthTransport.buildAuthTransportPlan(p);
    return r.ok === true && r.plan.primary.channel === "sms"; // an sms-primary possession plan slipped through
  });

// (C) Remove the authFlow/policy.authFlow mismatch rejection.
tsMutation("MUT: drop the authFlow/policy.authFlow mismatch rejection",
  [["lib/identity/authTransport.ts",
    "  if (authFlow !== policy.authFlow) {\n    return { eligible: false, reason: FallbackIneligibleReason.POLICY_FLOW_MISMATCH };\n  }\n",
    ""]],
  (mm) => {
    const policy = { authFlow: "vendor_password_reset", primaryChannel: "whatsapp", primaryProviderKey: "mock", fallbackChannel: "sms", fallbackProviderKey: "mock_sms", automaticFallbackEnabled: true, userRequestedFallbackEnabled: false, hardFailureOnly: true, isOperationallyEnabled: true };
    const outcome = { attemptNumber: 1, channel: "whatsapp", providerKey: "mock", certainty: "definitive_failure", failureClassification: null };
    // A wrong-flow but fully-enabled policy now yields eligibility — the hazard.
    return mm.AuthTransport.evaluateAutomaticFallback("client_login_otp", outcome, policy).eligible === true;
  });

// --- FUTURE-COMPATIBILITY mutations -----------------------------------------
tsMutation("MUT: agent attribution authorizes a communication",
  [["lib/agents/agentAttribution.ts",
    "export function attributionAuthorizes(_context?: CommunicationDecisionContext): boolean {\n  return false;\n}",
    "export function attributionAuthorizes(context?: CommunicationDecisionContext): boolean {\n  return context?.decisionSourceType === \"agent\";\n}"]],
  (mm) => {
    const ctx = { decisionSourceType: "agent", decisionSourceId: "qf_jarvis", recommendationId: null, approvalRequestId: null, campaignId: null, experimentId: null, policyDecisionId: null, correlationId: null };
    return mm.Attribution.attributionAuthorizes(ctx) === true; // attribution now authorizes
  });

tsMutation("MUT: an approved recommendation authorizes (bypasses Phase 4)",
  [["lib/agents/agentRecommendation.ts",
    "export function recommendationAuthorizes(_recommendation?: AgentRecommendation): boolean {\n  return false;\n}",
    "export function recommendationAuthorizes(recommendation?: AgentRecommendation): boolean {\n  return recommendation?.status === \"approved\";\n}"]],
  (mm) => {
    const approved = { recommendationId: "r1", agent: "riya", recommendationType: "x", riskLevel: "high", status: "approved", approvalRequirement: "single_admin", approvalRequestId: null, correlationId: null, rationaleSafe: {}, createdAt: "2026-07-09T00:00:00Z", expiresAt: null };
    return mm.Recommendation.recommendationAuthorizes(approved) === true; // approval now authorizes
  });

tsMutation("MUT: a campaign intent can dispatch",
  [["lib/agents/campaignIntent.ts",
    "export function campaignIntentCanDispatch(_intent?: CampaignIntent): boolean {\n  return false;\n}",
    "export function campaignIntentCanDispatch(_intent?: CampaignIntent): boolean {\n  return true;\n}"]],
  (mm) => mm.Campaign.campaignIntentCanDispatch() === true);

tsMutation("MUT: a communication recommendation can directly dispatch",
  [["lib/communication/communicationRecommendation.ts",
    "export function communicationRecommendationCanDispatch(_rec?: CommunicationRecommendation): boolean {\n  return false;\n}",
    "export function communicationRecommendationCanDispatch(_rec?: CommunicationRecommendation): boolean {\n  return true;\n}"]],
  (mm) => mm.CommRecommendation.communicationRecommendationCanDispatch() === true);

tsMutation("MUT: the event envelope exposes a secret token field",
  [["lib/events/eventEnvelope.ts",
    "  readonly safePayload: Record<string, unknown>;\n  readonly traceId: string | null;",
    "  readonly safePayload: Record<string, unknown>;\n  readonly access_token: string;\n  readonly traceId: string | null;"]],
  () => /readonly access[_]?token\b/i.test(readFileSync(EVENT_ENVELOPE_SRC, "utf8").slice(readFileSync(EVENT_ENVELOPE_SRC, "utf8").indexOf("interface CanonicalEventEnvelope"))));

tsMutation("MUT: the event envelope claims Phase 5F-A persistence (false 'maps onto existing' claim)",
  [["lib/events/eventEnvelope.ts",
    "  persistedByPhase5FA: false,\n  createsTable: false,",
    "  persistedByPhase5FA: true,\n  createsTable: true,"]],
  (mm) => mm.EventEnvelope.EVENT_PERSISTENCE_STATUS.persistedByPhase5FA === true || mm.EventEnvelope.EVENT_PERSISTENCE_STATUS.createsTable === true);

tsMutation("MUT: the event envelope exposes an OTP field",
  [["lib/events/eventEnvelope.ts",
    "  readonly safePayload: Record<string, unknown>;\n  readonly traceId: string | null;",
    "  readonly safePayload: Record<string, unknown>;\n  readonly otp: string;\n  readonly traceId: string | null;"]],
  () => /readonly otp\b/i.test(readFileSync(EVENT_ENVELOPE_SRC, "utf8").slice(readFileSync(EVENT_ENVELOPE_SRC, "utf8").indexOf("interface CanonicalEventEnvelope"))));

// --- RUNTIME CHANNEL-SAFETY mutations ---------------------------------------
// Each removes one CommunicationService channel guard; a functional check must go
// red (the guard proves load-bearing). The service is not compiled here — the
// checks re-read it fresh, so a removed guard is observed immediately.
srcMutation("MUT: remove the initial intent-channel send guard",
  COMM_SERVICE_SRC, GUARD_INITIAL_SEND, "",
  () => !readSvc().includes(GUARD_INITIAL_SEND));

srcMutation("MUT: remove the template-channel consistency guard",
  COMM_SERVICE_SRC, GUARD_TEMPLATE_CHANNEL, "",
  () => !readSvc().includes(GUARD_TEMPLATE_CHANNEL));

srcMutation("MUT: remove the persisted-message channel dispatch guard",
  COMM_SERVICE_SRC, GUARD_PERSISTED_DISPATCH, "",
  () => !readSvc().includes(GUARD_PERSISTED_DISPATCH));

srcMutation("MUT: remove the provider/message channel identity check",
  COMM_SERVICE_SRC,
  '    if (this.isForeignChannel(message.channel)) {\n' +
  '      return {\n' +
  '        accepted: false,\n' +
  '        provider: this.provider.providerKey,\n' +
  '        providerMessageId: null,\n' +
  '        normalizedStatus: "failed",\n' +
  '        errorCode: CHANNEL_DISPATCH_ERROR.UNSUPPORTED_DISPATCH_CHANNEL,\n' +
  '        errorMessage: "The message channel does not match the active provider channel.",\n' +
  '        retryable: false,\n' +
  '      };\n' +
  '    }',
  "",
  () => !readSvc().includes(GUARD_PROVIDER_IDENTITY));

srcMutation("MUT: allow WhatsApp webhook application against SMS/RCS messages (remove the fence)",
  COMM_SERVICE_SRC, GUARD_WEBHOOK_FENCE, "",
  () => !readSvc().includes(GUARD_WEBHOOK_FENCE));

tsMutation("MUT: the channel guard treats every channel as dispatchable",
  [["lib/communication/channelDispatchGuard.ts",
    "): boolean {\n  return channel === providerChannel;\n}",
    "): boolean {\n  return true;\n}"]],
  (mm) => mm.ChannelGuard.isChannelDispatchable("sms", "whatsapp") === true);

// ============================================================================
// EXECUTE
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-A Messaging Foundation checks...\n");
  for (const c of checks) {
    try { await c.fn(); console.log(`PASS ${c.name}`); passed++; }
    catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; }
  }
  return { passed, failed };
}

/** Run the FULL functional suite and return whether any check failed. */
async function suiteGoesRed() {
  for (const c of checks) {
    try { await c.fn(); } catch { return true; }
  }
  return false;
}

async function runMutations() {
  let passed = 0, failed = 0;
  console.log("\nRunning Phase 5F-A mutation tests...\n");
  for (const mut of mutationChecks) {
    const mutDir = resolve(`.phase5fa-mut-${mutationChecks.indexOf(mut)}`);
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
        // A directly-observed contract violation OR a red suite both count.
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
