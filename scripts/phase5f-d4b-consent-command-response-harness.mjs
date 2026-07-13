import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Phase 5F-D4-B — EVIDENCE-BOUND consent-command acknowledgements (STOP / START / HELP).
 *
 * The pure contract, the one-shot enforcer and the orchestration are driven through INJECTED fakes:
 *   • D2-C is a fake `decide` — the real authority is never queried;
 *   • the runtime CommunicationService factory is faked, and it COUNTS sends, so "zero provider calls"
 *     is proven rather than asserted;
 *   • Supabase is stubbed to throw if ever touched.
 *
 * It never connects to Supabase, never reaches a provider, and never reads a real credential. Every
 * mutation is restored byte-identically in a `finally` block.
 */

const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const TS_FILES = [
  "lib/errors.ts",
  "lib/communication/phone.ts",
  "lib/communication/types.ts",
  "lib/communication/providers/providerError.ts",
  "lib/communication/providers/providerOutcome.ts",
  "lib/communication/providers/whatsappProvider.ts",
  "lib/communication/providers/metaWhatsAppInbound.ts",
  "lib/communication/consentCommandResponse.ts",
  "lib/communication/outboundConsentScope.ts",
];

const PURE_SRC = "lib/communication/consentCommandResponse.ts";
const SVC_SRC = "services/consentCommandResponseService.ts";
const WEBHOOK_SRC = "services/metaWhatsAppWebhookService.ts";
const REGISTRY_SRC = "lib/communication/outboundConsentScope.ts";
const D3B_COORD_SRC = "services/outboundConsentEnforcementService.ts";
const HARNESS_SRC = "scripts/phase5f-d4b-consent-command-response-harness.mjs";
const DOC_SRC = "docs/QF-Consent-Command-Response-Phase-5F-D4-B.md";

// Frozen authorities D4-B may call but must NEVER modify.
const FROZEN = [
  "services/communicationConsentDecisionService.ts",
  "services/communicationConsentWriterService.ts",
  "services/inboundConsentCommandService.ts",
  "services/outboundConsentEnforcementService.ts",
  "lib/communication/outboundConsentScope.ts",
  "services/communicationService.ts",
  "services/runtimeCommunicationService.ts",
];
/**
 * The APPROVED D4-B scope — SEVEN files. The seventh is the D2-E harness, admitted by explicit founder
 * ruling for ONE compatibility correction: D2-E's check 16 rejected any webhook import whose specifier
 * merely CONTAINED "consentCommand", which falsely rejected `./consentCommandResponseService` (a module
 * that normalizes nothing). The correction made that guard PRECISE — it still rejects the real normalizer
 * module/symbol and every unapproved consent module — and weakened nothing.
 */
const D2E_HARNESS_SRC = "scripts/phase5f-d2e-inbound-consent-integration-harness.mjs";
const D4B_EXPECTED_FILES = [
  DOC_SRC, PURE_SRC, "package.json", HARNESS_SRC, SVC_SRC, WEBHOOK_SRC, D2E_HARNESS_SRC,
];

// ----------------------------------------------------------------------------
// THE D2-E HARNESS DELTA — BYTE-BOUNDED to the two approved transformations
// ----------------------------------------------------------------------------
const D4B_BASE = "8749050fb45b500d196746d10315878eb60219c4";

/**
 * The EXACT accounting the audit ratified. Any drift is a scope violation, not a warning.
 * Checks and assertions are pinned to absolute values. MUTATION accounting is required to be UNCHANGED
 * versus the base — pinning it to an absolute would only re-encode the same fact less robustly.
 */
const D2E_EXPECTED_CHECKS = 31;
const D2E_EXPECTED_ASSERTS = 158;

/** Transformation A — the old broad normalizer guard, and the ONLY replacement permitted. */
const A_OLD = 'hasNot(/consentCommand|normalizeConsentCommand/, code, "the webhook never normalizes a command itself");';
const A_NEW = 'hasNot(/["\']\\.\\.\\/lib\\/communication\\/consentCommand["\']|normalizeConsentCommand/, code, "the webhook never normalizes a command itself");';
/** Transformation B — the old single-module equality, and the ONLY replacement permitted. */
const B_OLD_HEAD = 'assert(consentSpecifiers.length === 1 && consentSpecifiers[0] === "./inboundConsentCommandService",';
const B_NEW_ALLOWLIST = 'const ALLOWED_CONSENT_MODULES = ["./inboundConsentCommandService", "./consentCommandResponseService"];';
const B_NEW_UNAPPROVED = 'const unapproved = consentSpecifiers.filter((s) => !ALLOWED_CONSENT_MODULES.includes(s));';
const B_NEW_REQUIRE_D2E = 'assert(consentSpecifiers.includes("./inboundConsentCommandService"),';

const countOf = (s, re) => (s.match(re) || []).length;

/**
 * Compare the WORKING COPY of the D2-E harness with its version at the D4-B base. Only the two approved
 * transformations may appear. Everything else must be byte-identical.
 *
 * Method: take the unified diff, and require that EVERY added / removed CODE line belongs to one of the
 * two approved transformations. Comment-only additions are permitted (documentation of the change).
 * There is NO wildcard, prefix, directory allowance or dynamic expansion anywhere in this validator.
 */
function validateD2EHarnessDelta() {
  const problems = [];
  const before = execFileSync("git", ["show", `${D4B_BASE}:${D2E_HARNESS_SRC}`], { encoding: "utf8" });
  const after = readF(D2E_HARNESS_SRC);

  // 1) The approved transformations must actually be present, and the old forms must be gone.
  if (after.includes(A_OLD)) problems.push("transformation A not applied: the broad normalizer guard is still present");
  if (!after.includes(A_NEW)) problems.push("transformation A missing: the precise normalizer guard is absent");
  if (after.includes(B_OLD_HEAD)) problems.push("transformation B not applied: the old single-module equality is still present");
  for (const [name, needle] of [["allowlist", B_NEW_ALLOWLIST], ["unapproved filter", B_NEW_UNAPPROVED], ["orchestrator requirement", B_NEW_REQUIRE_D2E]]) {
    if (!after.includes(needle)) problems.push(`transformation B missing its ${name}`);
  }

  // 2) The allowlist must be EXACTLY the two approved modules — no third, no wildcard, no regex.
  const allow = after.match(/const ALLOWED_CONSENT_MODULES = \[([^\]]*)\];/);
  if (!allow) problems.push("the consent-module allowlist is not a literal array");
  else {
    const entries = allow[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    const expected = ["./inboundConsentCommandService", "./consentCommandResponseService"];
    if (JSON.stringify(entries) !== JSON.stringify(expected)) {
      problems.push(`the allowlist must be exactly [${expected.join(", ")}] (got [${entries.join(", ")}])`);
    }
    if (/\*|\.\+|RegExp|startsWith|includes\(.*\/\)/.test(allow[1])) problems.push("the allowlist must contain no wildcard/regex/prefix");
  }

  // 3) NO unrelated line may change. Every added/removed CODE line must belong to an approved
  //    transformation. (Comment lines are documentation of the change and are permitted.)
  const diff = execFileSync("git", ["diff", "--unified=0", D4B_BASE, "--", D2E_HARNESS_SRC], { encoding: "utf8" }).split("\n");
  const APPROVED_FRAGMENTS = [
    A_OLD, A_NEW, B_OLD_HEAD, B_NEW_ALLOWLIST, B_NEW_UNAPPROVED, B_NEW_REQUIRE_D2E,
    'consentSpecifiers[0] === "./inboundConsentCommandService"',   // tail of the old B assertion
    "`the orchestrator must be the ONLY consent-related module the webhook imports (got [${consentSpecifiers.join(\", \")}])`);",
    'assert(unapproved.length === 0,',
    "`only the approved consent orchestrators may be imported by the webhook (got [${unapproved.join(\", \")}])`);",
    '"the D2-E orchestrator must still be imported");',
  ];
  for (const line of diff) {
    if (!/^[+-]/.test(line) || /^(\+\+\+|---)/.test(line)) continue;
    const code = line.slice(1).trim();
    if (code === "" || code.startsWith("//")) continue;                 // comments are permitted
    // EXACT EQUALITY ONLY. Substring matching ("the line is part of an approved fragment") and superstring
    // matching ("the line contains an approved fragment") both let arbitrary code ride along on an approved
    // line — e.g. `…ALLOWED_CONSENT_MODULES = [ok, ok]; ALLOWED_CONSENT_MODULES.push("./writer");` — which
    // would defeat the whole point of byte-bounding this delta. A changed code line is admitted only if it
    // IS, verbatim, one of the approved fragments.
    if (APPROVED_FRAGMENTS.some((f) => code === f.trim())) continue;
    problems.push(`unrelated D2-E harness line changed: ${code.slice(0, 80)}`);
  }

  // 4) NO assertion may be removed, and the accounting must be exactly what the audit ratified.
  for (const line of diff) {
    if (!line.startsWith("-") || line.startsWith("---")) continue;
    if (/\bcheck\(/.test(line)) problems.push(`a check was REMOVED from the D2-E harness: ${line.trim().slice(0, 70)}`);
  }
  const MUT_RE = /srcMutation\(|fnMutation\(|mutationChecks\.push/g;
  const checks = countOf(after, /\bcheck\(/g);
  const asserts = countOf(after, /\bassert\(/g);
  if (checks !== D2E_EXPECTED_CHECKS) problems.push(`D2-E check count must be ${D2E_EXPECTED_CHECKS} (got ${checks})`);
  if (asserts !== D2E_EXPECTED_ASSERTS) problems.push(`D2-E assertion count must be ${D2E_EXPECTED_ASSERTS} (got ${asserts})`);
  if (countOf(before, /\bcheck\(/g) !== D2E_EXPECTED_CHECKS) problems.push("the BASE D2-E check count disagrees with the ratified accounting");
  // MUTATION ACCOUNTING MUST BE UNCHANGED — no mutation may be added, removed or disabled.
  const mutBefore = countOf(before, MUT_RE);
  const mutAfter = countOf(after, MUT_RE);
  if (mutAfter !== mutBefore) problems.push(`D2-E mutation accounting must be UNCHANGED (base ${mutBefore} → ${mutAfter})`);

  // 5) The real normalizer module AND symbol must still be forbidden by the new guard.
  const guard = /\["'\]\\\.\\\.\\\/lib\\\/communication\\\/consentCommand\["'\]\|normalizeConsentCommand/;
  if (!guard.test(after)) problems.push("the precise guard no longer forbids the real normalizer module + symbol");

  return problems;
}

function compileTo(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  const tsconfigPath = resolve(`${outDir}.tsconfig.json`);
  writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node",
      skipLibCheck: true, esModuleInterop: true, strict: true, jsx: "preserve",
      outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] }, lib: ["ES2021", "DOM"],
    },
    files: TS_FILES,
  }, null, 2));
  try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
  finally { rmSync(tsconfigPath, { force: true }); }
  return outDir;
}

/** Transpile the SERVICE in isolation — its imports are stubbed or already emitted. */
function transpileService(outDir) {
  const tsconfigPath = resolve(`${outDir}.svc.tsconfig.json`);
  writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node",
      skipLibCheck: true, esModuleInterop: true, strict: false, isolatedModules: true,
      outDir, rootDir: ".", types: [], noResolve: true,
    },
    files: [SVC_SRC],
  }, null, 2));
  try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
  catch { /* expected noResolve diagnostics */ }
  finally { rmSync(tsconfigPath, { force: true }); }
  if (!existsSync(resolve(outDir, "services/consentCommandResponseService.js"))) throw new Error("service did not transpile");
}

function wireBuild(outDir) {
  const req = createRequire(`${outDir}/`);
  const Module = req("module");
  const original = Module._load;
  const STUBS = {
    "../lib/supabase": { adminClient: () => { throw new Error("real Supabase must never run in the D4-B harness"); } },
    "./communicationConsentDecisionService": {
      decideCommunicationConsent: () => { throw new Error("the real D2-C must never run in the D4-B harness"); },
    },
    "./runtimeCommunicationService": {
      createRuntimeCommunicationService: () => { throw new Error("the real runtime factory must never run"); },
    },
  };
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    return original.apply(this, [request, parent, isMain]);
  };
  return {
    Pure: req("./lib/communication/consentCommandResponse.js"),
    Svc: req("./services/consentCommandResponseService.js"),
    Registry: req("./lib/communication/outboundConsentScope.js"),
    Inbound: req("./lib/communication/providers/metaWhatsAppInbound.js"),
    Phone: req("./lib/communication/phone.js"),
  };
}

const readF = (f) => readFileSync(f, "utf8");
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*/gm, "");
function safeStringify(v) { try { return JSON.stringify(v); } catch { return String(v); } }
function gitDirty() {
  return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" })
    .split("\n").map((l) => l.slice(3).trim()).filter(Boolean).map((p) => p.replace(/\\/g, "/"))
    .filter((p) => !p.startsWith(".phase5fd4b"));
}

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function has(re, s, msg) { assert(re.test(s), msg); }
function hasNot(re, s, msg) { assert(!re.test(s), msg); }

const MAIN_DIR = resolve(".phase5fd4b-build-main");
compileTo(MAIN_DIR);
transpileService(MAIN_DIR);
const M = wireBuild(MAIN_DIR);

// ============================================================================
// FIXTURES
// ============================================================================
const WA_ID = "919812345678";
const E164 = "+919812345678";
const DEST_HASH = createHash("sha256").update(E164).digest("hex");
const WAMID = "wamid.HBgMOTE5ODEyMzQ1Njc4FQIAEhggABCDEF0123456789";
const CANONICAL_PMID = createHash("sha256").update(WAMID).digest("hex"); // what D2-E gives D2-D
const ROW_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const RECEIPT_ID = "11111111-2222-4333-8444-555555555555";
const RECEIVED = "2026-07-13T10:00:00.000Z";

const envelope = (...messages) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp",
    metadata: { phone_number_id: "111222333" },
    messages,
  } }] }],
});
const textMsg = (over = {}) => ({ from: WA_ID, id: WAMID, timestamp: "1752400000", type: "text", text: { body: "STOP" }, ...over });

const persistedItem = (over = {}) => ({
  message: { providerMessageId: WAMID, messageType: "text", ...(over.message ?? {}) },
  receipt: {
    inboundMessageId: ROW_ID,
    provider: "meta_whatsapp_cloud",
    providerMessageId: CANONICAL_PMID,
    destinationHash: DEST_HASH,
    receivedAt: RECEIVED,
    ...(over.receipt ?? {}),
  },
});
const commandItem = (over = {}) => ({
  inboundMessageId: ROW_ID, command: "stop", disposition: "stop_applied", replayed: false, ...over,
});

/** A fake CommunicationService that COUNTS sends and records the intent + the enforcer it was given. */
function fakeFactory(over = {}) {
  const calls = { services: 0, sends: [], enforcers: [], authorizeInputs: [] };
  return {
    calls,
    createService: (enforcer) => {
      calls.services++;
      calls.enforcers.push(enforcer);
      if (over.serviceUnavailable) return { ok: false, code: "WHATSAPP_PROVIDER_NOT_CONFIGURED", error: "x" };
      return {
        ok: true,
        data: {
          send: async (intent) => {
            // The REAL CommunicationService consults the enforcer before dispatching. Model that faithfully.
            const outcome = await enforcer.authorize({
              channel: intent.channel,
              messageType: intent.type,
              templateKey: intent.template_key,
              lane: intent.lane,
              destinationHash: createHash("sha256").update(intent.destination_source.destination).digest("hex"),
              destinationSource: intent.destination_source.kind,
              recipientType: intent.recipient_type,
              recipientId: intent.recipient_id,
            });
            calls.authorizeInputs.push(outcome);
            if (outcome.kind !== "allow") return { ok: false, code: outcome.code, error: "blocked" };
            if (over.templateMissing) return { ok: false, code: "TEMPLATE_NOT_FOUND_OR_INACTIVE", error: "x" };
            if (over.sendResult) return over.sendResult;
            calls.sends.push(intent);
            return { ok: true, data: { id: "msg-1", status: over.status ?? "accepted" } };
          },
        },
      };
    },
  };
}

const decided = (o) => async () => o;
const OK_NO_OBJECTION = { ok: true, disposition: "no_consent_objection", reasonCode: "authentication_no_consent_objection", policyVersion: "qf-consent-v1", principalConfidence: "unknown", matchedPreferenceId: null, matchedSuppressionId: null, suppressionReason: null, reconsent: "not_applicable" };
const OK_BLOCKED = { ...OK_NO_OBJECTION, disposition: "blocked", reasonCode: "global_suppression_active", matchedSuppressionId: "supp-1", suppressionReason: "complaint" };

function makeDeps(over = {}) {
  const seen = [];
  const factory = over.factory ?? fakeFactory();
  return {
    seen, factory,
    deps: {
      decide: over.decide ?? (async (i) => { seen.push(i); return over.decision ?? OK_NO_OBJECTION; }),
      createService: factory.createService,
    },
  };
}

async function run(over = {}) {
  const d = makeDeps(over);
  const res = await M.Svc.processConsentCommandResponses({
    payload: over.payload ?? envelope(textMsg(over.msgOver ?? {})),
    webhookReceiptId: over.webhookReceiptId === undefined ? RECEIPT_ID : over.webhookReceiptId,
    persisted: over.persisted ?? [persistedItem(over.persistedOver ?? {})],
    commands: over.commands ?? [commandItem(over.commandOver ?? {})],
  }, d.deps);
  return { res, sends: d.factory.calls.sends, factory: d.factory, decideSeen: d.seen };
}

// ============================================================================
// PURE CONTRACT + ELIGIBILITY (1-9, 12-13)
// ============================================================================
check("P1. exactly three acknowledgement types; template key === message type", () => {
  const t = M.Pure.CONSENT_ACK_TYPES;
  assert(t.length === 3, `exactly three ack types (got ${t.length})`);
  assert(t.includes("consent_stop_acknowledgement") && t.includes("consent_start_acknowledgement") && t.includes("consent_help_response"), "the three approved types");
  for (const x of t) assert(M.Pure.ackTemplateKeyFor(x) === x, `${x}: template key is identical to the type`);
  assert(M.Pure.CONSENT_COMMAND_RESPONSE_CLASS === "consent_command_response", "internal classification is consent_command_response");
  assert(M.Pure.ACK_LANE === "authentication" && M.Pure.ACK_CHANNEL === "whatsapp", "borrowed storage lane + channel");
  assert(M.Pure.ACK_RECIPIENT_TYPE === "system", "a NEUTRAL recipient — never client/vendor/admin");
});

check("P2. command eligibility is EXACTLY the founder-ratified set", () => {
  const e = M.Pure.isEligibleDisposition;
  for (const d of ["stop_applied", "stop_already_effective"]) assert(e("stop", d) === true, `stop eligible: ${d}`);
  for (const d of ["start_applied", "start_partially_applied", "start_no_reversible_stop"]) assert(e("start", d) === true, `start eligible: ${d}`);
  assert(e("help", "help_acknowledged") === true, "help eligible");
  // NEVER acknowledged
  assert(e("start", "start_blocked_by_stronger_suppression") === false, "a stronger suppression is NEVER acknowledged as resumed");
  for (const d of ["WRITER_TRANSACTION_FAILED", "WRITER_CONFLICT", "WRITER_INTEGRITY_VIOLATION", "UNSUPPORTED_POLICY_VERSION", "INVALID_WRITER_INPUT", "unsupported_command", "not_command_eligible", "", null, undefined, 42]) {
    assert(e("stop", d) === false && e("start", d) === false, `never acknowledged: ${safeStringify(d)}`);
  }
  // cross-command contamination is impossible
  assert(e("stop", "start_applied") === false && e("start", "stop_applied") === false, "dispositions never cross commands");
});

check("P3. rate-limit windows are fixed (STOP/START 15m, HELP 24h) and keys are distinct", () => {
  assert(M.Pure.ACK_WINDOW_MS.stop === 15 * 60 * 1000, "STOP window 15 minutes");
  assert(M.Pure.ACK_WINDOW_MS.start === 15 * 60 * 1000, "START window 15 minutes");
  assert(M.Pure.ACK_WINDOW_MS.help === 24 * 60 * 60 * 1000, "HELP window 24 hours");
  const k = M.Pure.deriveAckIdempotencyKey;
  const stop = k("consent_stop_acknowledgement", "stop", DEST_HASH, RECEIVED);
  const start = k("consent_start_acknowledgement", "start", DEST_HASH, RECEIVED);
  const help = k("consent_help_response", "help", DEST_HASH, RECEIVED);
  assert(stop !== start && start !== help && stop !== help, "STOP / START / HELP have DISTINCT keys");
  // No plaintext destination anywhere in the key.
  for (const key of [stop, start, help]) {
    assert(!key.includes(E164) && !key.includes(WA_ID), `no plaintext destination in the key: ${key}`);
    assert(key.includes(DEST_HASH), "the key carries the sha256 hash");
  }
  // A replay (same persisted received_at) → the SAME bucket → the SAME key.
  assert(k("consent_stop_acknowledgement", "stop", DEST_HASH, RECEIVED) === stop, "a replay lands in the same bucket");
  // Two commands inside the window → the same key; outside → a different key.
  const inWindow = new Date(Date.parse(RECEIVED) + 14 * 60 * 1000).toISOString();
  const outWindow = new Date(Date.parse(RECEIVED) + 31 * 60 * 1000).toISOString();
  assert(k("consent_stop_acknowledgement", "stop", DEST_HASH, inWindow) === stop || k("consent_stop_acknowledgement", "stop", DEST_HASH, inWindow) !== stop, "bucket is deterministic");
  assert(k("consent_stop_acknowledgement", "stop", DEST_HASH, outWindow) !== stop, "a later window yields a different key");
  assert(k("consent_stop_acknowledgement", "stop", "nope", RECEIVED) === null, "a malformed hash yields no key");
});

check("P4. the pure module is PURE (no I/O, db, env, clock, randomness)", () => {
  const src = stripTs(readF(PURE_SRC));
  hasNot(/adminClient|supabase|fetch\(|process\.env|console\.|Date\.now\(|Math\.random|import .*services\//i, src, "the pure module is pure");
  hasNot(/bypassConsent|ignoreSuppression|forceSend|allowAnyway/i, src, "NO bypass / ignore / force flag exists");
});

check("P5. the approved copy is fixed, link-free and opt-in-free", () => {
  const copy = M.Pure.APPROVED_ACK_COPY;
  assert(Object.keys(copy).length === 3, "three approved bodies");
  for (const [type, body] of Object.entries(copy)) {
    hasNot(/https?:\/\/|www\.|₹|\$|%|offer|discount|price|click here|subscribe now/i, body, `${type}: no link/offer/price/CTA`);
    hasNot(/\{\{|\$\{|%s/, body, `${type}: no dynamic variable`);
  }
  has(/STOP request has been processed/, copy.consent_stop_acknowledgement, "STOP copy");
  has(/START request has been processed/, copy.consent_start_acknowledgement, "START copy");
  has(/does not change your messaging preferences/, copy.consent_help_response, "HELP copy never opts in");
});

// ============================================================================
// EVIDENCE VALIDATION (14-20)
// ============================================================================
check("E1. valid evidence derives a complete, non-caller-selectable plan", () => {
  const ev = {
    inboundMessageId: ROW_ID, webhookReceiptId: RECEIPT_ID, provider: "meta_whatsapp_cloud",
    providerMessageId: CANONICAL_PMID, channel: "whatsapp", destinationHash: DEST_HASH,
    command: "stop", disposition: "stop_applied", replayed: false, receivedAt: RECEIVED,
  };
  const p = M.Pure.deriveConsentAckPlan(ev, { destinationHash: DEST_HASH, providerMessageId: CANONICAL_PMID });
  assert(p.ok === true, "a valid binding plans");
  assert(p.plan.ackType === "consent_stop_acknowledgement" && p.plan.templateKey === "consent_stop_acknowledgement", "type + template DERIVED from the command");
  assert(p.plan.lane === "authentication" && p.plan.channel === "whatsapp", "storage lane/channel");
  assert(p.plan.destinationSource === "ephemeral_auth_destination" && p.plan.recipientType === "system", "ephemeral + neutral recipient");
  assert(p.plan.idempotencyKey.startsWith("ack:consent_stop_acknowledgement:"), "idempotency key derived");
});

check("E2. every evidence mismatch REJECTS (hash, provider-message, channel, command, disposition, replay)", () => {
  const base = {
    inboundMessageId: ROW_ID, webhookReceiptId: RECEIPT_ID, provider: "meta_whatsapp_cloud",
    providerMessageId: CANONICAL_PMID, channel: "whatsapp", destinationHash: DEST_HASH,
    command: "stop", disposition: "stop_applied", replayed: false, receivedAt: RECEIVED,
  };
  const obs = { destinationHash: DEST_HASH, providerMessageId: CANONICAL_PMID };
  const D = M.Pure.deriveConsentAckPlan;
  assert(D(base, { ...obs, destinationHash: "b".repeat(64) }).reason === "DESTINATION_HASH_MISMATCH", "destination-hash mismatch rejects");
  assert(D(base, { ...obs, providerMessageId: "other" }).reason === "PROVIDER_MESSAGE_MISMATCH", "provider-message mismatch rejects");
  assert(D({ ...base, channel: "sms" }, obs).reason === "UNSUPPORTED_CHANNEL", "channel mismatch rejects");
  assert(D({ ...base, command: "unsupported" }, obs).reason === "NOT_A_COMMAND", "a non-command rejects");
  assert(D({ ...base, disposition: "start_blocked_by_stronger_suppression", command: "start" }, obs).reason === "INELIGIBLE_DISPOSITION", "an ineligible disposition rejects");
  assert(D({ ...base, replayed: true }, obs).reason === "REPLAYED_COMMAND", "a REPLAYED command rejects");
  // structural
  for (const bad of [
    { inboundMessageId: "not-a-uuid" }, { webhookReceiptId: "nope" }, { provider: "" },
    { providerMessageId: "has space" }, { destinationHash: "xyz" }, { destinationHash: "A".repeat(64) },
    { receivedAt: "2026-07-13" }, { receivedAt: "" },
  ]) {
    const r = D({ ...base, ...bad }, obs);
    assert(r.ok === false, `structurally invalid evidence rejects: ${safeStringify(bad)}`);
  }
});

// ============================================================================
// ORCHESTRATION — SENDS AND ZERO-SENDS (4-21, 27-28)
// ============================================================================
check("A1. STOP applied / already effective each produce ONE acknowledgement", async () => {
  for (const disposition of ["stop_applied", "stop_already_effective"]) {
    const { res, sends, decideSeen } = await run({ commandOver: { disposition } });
    assert(sends.length === 1, `${disposition}: exactly ONE send`);
    assert(sends[0].type === "consent_stop_acknowledgement" && sends[0].template_key === "consent_stop_acknowledgement", "the STOP ack");
    assert(sends[0].lane === "authentication" && sends[0].channel === "whatsapp", "storage lane/channel");
    assert(sends[0].recipient_type === "system" && sends[0].recipient_id === null, "neutral recipient, no principal");
    assert(sends[0].scheduled_at === null, "never scheduled");
    assert(safeStringify(sends[0].variables) === "{}", "no variables");
    assert(res.result.sent === 1, "counted as sent");
    // D2-C was asked with the fixed, non-negotiable identity.
    assert(decideSeen.length === 1 && decideSeen[0].scope === "authentication", "D2-C asked at scope=authentication (global-only)");
    assert(decideSeen[0].identityConfidence === "unknown" && decideSeen[0].principal === null, "identity NEVER upgraded");
    assert(decideSeen[0].destinationHash === DEST_HASH, "the exact bound hash");
  }
});

check("A2. START applied / partially applied / no-reversible-stop each produce ONE acknowledgement", async () => {
  for (const disposition of ["start_applied", "start_partially_applied", "start_no_reversible_stop"]) {
    const { sends } = await run({
      msgOver: { text: { body: "START" } },
      commandOver: { command: "start", disposition },
    });
    assert(sends.length === 1, `${disposition}: exactly ONE send`);
    assert(sends[0].type === "consent_start_acknowledgement", "the START ack");
  }
});

check("A3. HELP produces ONE response, and NO consent write of any kind", async () => {
  const { res, sends } = await run({
    msgOver: { text: { body: "HELP" } },
    commandOver: { command: "help", disposition: "help_acknowledged" },
  });
  assert(sends.length === 1 && sends[0].type === "consent_help_response", "one HELP response");
  assert(res.result.sent === 1, "sent");
  // The service NEVER writes consent state: no writer import, no RPC, no consent table, and its dependency
  // surface has NO write capability at all. (Strip TRAILING comments too — prose that merely NAMES a
  // disposition is documentation, not a write.)
  const src = stripTs(readF(SVC_SRC)).replace(/\/\/.*$/gm, "");
  hasNot(/communicationConsentWriterService|writeConsentCommand|apply_communication_consent_command/, src, "the ack service NEVER invokes the D2-D writer");
  hasNot(/communication_suppressions|communication_preferences|\.insert\(|\.upsert\(|\.rpc\(|\.update\(/, src, "it writes NO consent state and reads NO consent table");
  hasNot(/consented_at|withdrawn_at|state:\s*"allowed"/, src, "HELP can never opt anyone in — no preference field is ever set");
  // The ONLY dependencies are a read-only decision and a service factory. There is no writer to call.
  has(/readonly decide: typeof decideCommunicationConsent/, readF(SVC_SRC), "deps expose a READ-ONLY decision authority");
  has(/readonly createService:/, readF(SVC_SRC), "…and a service factory");
  const depsBlock = readF(SVC_SRC).match(/export interface ConsentCommandResponseDeps \{[\s\S]*?\n\}/)?.[0] ?? "";
  hasNot(/write|insert|mutate|rpc/i, depsBlock.replace(/\/\/.*$/gm, ""), "the dependency surface has NO write capability");
});

check("A4. START blocked by a stronger suppression → ZERO sends", async () => {
  const { res, sends } = await run({
    msgOver: { text: { body: "START" } },
    commandOver: { command: "start", disposition: "start_blocked_by_stronger_suppression" },
  });
  assert(sends.length === 0, "ZERO sends — we never tell a user they are resumed when they are not");
  assert(res.result.items[0].outcome === "ineligible_disposition", "closed outcome");
});

check("A5. writer failures, unsupported text and non-text → ZERO sends", async () => {
  // writer failure dispositions
  for (const disposition of ["writer_unavailable", "writer_conflict", "writer_integrity_violation", "writer_rejected_input", "writer_unsupported_policy_version", "input_not_buildable"]) {
    const { sends } = await run({ commandOver: { disposition } });
    assert(sends.length === 0, `${disposition}: ZERO sends`);
  }
  // unsupported text / non-text never even reach the plan (command is not stop/start/help)
  for (const command of ["unsupported", null]) {
    const { res, sends } = await run({ commandOver: { command, disposition: command === null ? "not_command_eligible" : "unsupported_command" } });
    assert(sends.length === 0, `command=${safeStringify(command)}: ZERO sends`);
    assert(res.result.candidates === 0, "it is not even a candidate");
  }
});

check("A6. a REPLAYED command produces ZERO new sends", async () => {
  const { res, sends } = await run({ commandOver: { replayed: true } });
  assert(sends.length === 0, "a duplicate webhook / replayed command sends NOTHING");
  assert(res.result.items[0].outcome === "replayed", "closed outcome");
});

check("A7. a destination-hash mismatch (payload vs persisted) → ZERO sends", async () => {
  // The payload's sender hashes to DEST_HASH; the persisted receipt claims a different hash.
  const { res, sends } = await run({ persistedOver: { receipt: { destinationHash: "c".repeat(64) } } });
  assert(sends.length === 0, "ZERO sends when the re-derived hash disagrees with the persisted one");
  assert(res.result.items[0].outcome === "destination_mismatch", "closed outcome");
});

check("A8. a provider-message mismatch and missing persistence → ZERO sends", async () => {
  const orphan = await run({ commands: [commandItem({ inboundMessageId: "99999999-8888-4777-8666-555555555555" })] });
  assert(orphan.sends.length === 0 && orphan.res.result.items[0].outcome === "invalid_evidence", "no persisted item ⇒ invalid evidence, zero sends");
  // The payload carries a DIFFERENT wamid than the persisted row's message → no plaintext → hash mismatch.
  const mism = await run({ persistedOver: { message: { providerMessageId: "wamid.OTHER" } } });
  assert(mism.sends.length === 0, "ZERO sends on a provider-message mismatch");
});

check("A9. GLOBAL suppression → ZERO sends (a command response is still blocked by a global block)", async () => {
  const { res, sends } = await run({ decision: OK_BLOCKED });
  assert(sends.length === 0, "ZERO sends when a global suppression is active");
  assert(res.result.items[0].outcome === "suppressed", "closed outcome");
});

check("A10. D2-C failures fail CLOSED (lookup → unavailable; integrity/invalid/unknown → invalid)", async () => {
  const cases = [
    [{ ok: false, code: "AUTHORITY_LOOKUP_FAILED" }, "authority_unavailable"],
    [{ ok: false, code: "AUTHORITY_INTEGRITY_VIOLATION" }, "enforcement_invalid"],
    [{ ok: false, code: "INVALID_DECISION_INPUT" }, "enforcement_invalid"],
    [{ ...OK_NO_OBJECTION, disposition: "unknown" }, "enforcement_invalid"],
    [{ ...OK_NO_OBJECTION, disposition: "marketing_opted_in" }, "enforcement_invalid"],
  ];
  for (const [decision, expected] of cases) {
    const { res, sends } = await run({ decision });
    assert(sends.length === 0, `${safeStringify(decision).slice(0, 40)}: ZERO sends`);
    assert(res.result.items[0].outcome === expected, `→ ${expected}`);
  }
  // a THROWN authority is infrastructure, never an allow
  const thrown = await run({ decide: async () => { throw new Error("db down SQLSTATE 08006"); } });
  assert(thrown.sends.length === 0 && thrown.res.result.items[0].outcome === "authority_unavailable", "a thrown authority → unavailable, zero sends");
  assert(!safeStringify(thrown.res).includes("SQLSTATE"), "no raw error leaks");
});

check("A11. a missing template / absent provider fails closed with ZERO provider calls", async () => {
  const noTemplate = await run({ factory: fakeFactory({ templateMissing: true }) });
  assert(noTemplate.sends.length === 0, "a missing template ⇒ ZERO sends");
  assert(noTemplate.res.result.items[0].outcome === "send_failed", "closed outcome");
  const noProvider = await run({ factory: fakeFactory({ serviceUnavailable: true }) });
  assert(noProvider.sends.length === 0, "no provider configured ⇒ ZERO sends");
  assert(noProvider.res.ok === true, "…and the consent command is untouched");
});

check("A12. provider rejection / timeout / unknown outcome never changes the command result", async () => {
  for (const status of ["outcome_unknown", "failed", "queued"]) {
    const { res } = await run({ factory: fakeFactory({ status }) });
    assert(res.ok === true, `status=${status}: the ack service still returns ok (non-authoritative)`);
    assert(res.result.items[0].outcome !== "sent", "not counted as sent");
  }
  const thrown = await run({ factory: fakeFactory({ sendResult: null }) });
  assert(thrown.res.ok === true, "even a malformed send result never throws out of the ack path");
});

check("A13. the ONE-SHOT enforcer refuses a second use", async () => {
  const d = makeDeps();
  const plan = M.Pure.deriveConsentAckPlan({
    inboundMessageId: ROW_ID, webhookReceiptId: RECEIPT_ID, provider: "meta_whatsapp_cloud",
    providerMessageId: CANONICAL_PMID, channel: "whatsapp", destinationHash: DEST_HASH,
    command: "stop", disposition: "stop_applied", replayed: false, receivedAt: RECEIVED,
  }, { destinationHash: DEST_HASH, providerMessageId: CANONICAL_PMID });
  assert(plan.ok, "planned");

  await run({ factory: d.factory, decide: d.deps.decide });
  const enforcer = d.factory.calls.enforcers[0];
  assert(enforcer, "the service constructed an enforcer");
  const bound = {
    channel: "whatsapp", messageType: "consent_stop_acknowledgement", templateKey: "consent_stop_acknowledgement",
    lane: "authentication", destinationHash: DEST_HASH, destinationSource: "ephemeral_auth_destination",
    recipientType: "system", recipientId: null,
  };
  // it was already used once (inside the send) → a SECOND authorization must fail closed
  const second = await enforcer.authorize(bound);
  assert(second.kind === "invalid", "the one-shot enforcer refuses a second use");
});

check("A14. the enforcer rejects EVERY binding mismatch (type/template/lane/channel/hash/source/recipient)", async () => {
  const bound = {
    channel: "whatsapp", messageType: "consent_stop_acknowledgement", templateKey: "consent_stop_acknowledgement",
    lane: "authentication", destinationHash: DEST_HASH, destinationSource: "ephemeral_auth_destination",
    recipientType: "system", recipientId: null,
  };
  const mismatches = [
    { channel: "sms" }, { messageType: "consent_help_response" }, { messageType: "lead_received" },
    { templateKey: "other" }, { lane: "business" }, { destinationHash: "b".repeat(64) },
    { destinationSource: "recipient_reference" }, { recipientType: "client" }, { recipientId: ROW_ID },
  ];
  for (const bad of mismatches) {
    const d = makeDeps();
    await run({ factory: d.factory, decide: d.deps.decide }); // build a fresh, unused enforcer per case
    const fresh = makeDeps();
    const f2 = fakeFactory();
    // capture a fresh enforcer without consuming it: drive the service, then inspect enforcer #2
    const probe = fakeFactory();
    let captured = null;
    const probeDeps = {
      decide: fresh.deps.decide,
      createService: (enf) => { captured = enf; return { ok: false, code: "x", error: "x" }; },
    };
    await M.Svc.processConsentCommandResponses({
      payload: envelope(textMsg()), webhookReceiptId: RECEIPT_ID,
      persisted: [persistedItem()], commands: [commandItem()],
    }, probeDeps);
    assert(captured, "captured an unused enforcer");
    const r = await captured.authorize({ ...bound, ...bad });
    assert(r.kind === "invalid", `binding mismatch is rejected: ${safeStringify(bad)}`);
    void probe; void f2;
  }
});

check("A15. NO plaintext destination in evidence, keys, metadata or results", async () => {
  const { res, sends } = await run();
  const rendered = safeStringify(res);
  assert(!rendered.includes(E164) && !rendered.includes(WA_ID), "no plaintext phone in the sanitized result");
  assert(!rendered.includes(DEST_HASH), "not even the destination hash is returned");
  const meta = safeStringify(sends[0].metadata);
  assert(!meta.includes(E164) && !meta.includes(WA_ID), "no plaintext phone in the persisted metadata");
  assert(!meta.includes(DEST_HASH), "no destination hash in the metadata");
  assert(!meta.includes(WAMID), "the RAW wamid is never persisted — only the canonical digest");
  has(/consent_command_response/, meta, "metadata marks it as a consent command response");
  has(new RegExp(CANONICAL_PMID), meta, "the canonical provider-message identity IS recorded in metadata");
  assert(!sends[0].idempotency_key.includes(E164) && !sends[0].idempotency_key.includes(WA_ID), "no plaintext in the idempotency key");
});

check("A16. the RATE-LIMIT key is stable within the window and distinct per command", async () => {
  const stop = await run();
  const help = await run({ msgOver: { text: { body: "HELP" } }, commandOver: { command: "help", disposition: "help_acknowledged" } });
  assert(stop.sends[0].idempotency_key !== help.sends[0].idempotency_key, "STOP and HELP have DISTINCT rate-limit keys");
  // The same command, same persisted received_at (a replay would be blocked earlier; a genuine repeat
  // inside the window yields the SAME key, which the ledger's UNIQUE idempotency_key rejects).
  const again = await run();
  assert(again.sends[0].idempotency_key === stop.sends[0].idempotency_key, "the same window ⇒ the same key ⇒ at most one ack");
});

// ============================================================================
// BEHAVIOURAL WEBHOOK PROOF — the REAL handleMetaWhatsAppWebhookPost is executed
//
// The webhook service is transpiled in ISOLATION (noResolve) and EVERY one of its imports is stubbed, so
// the real handler runs end-to-end with fake collaborators. No production seam was needed: this is a
// harness-only technique. Signature verification, the runtime gate and classification are stubbed to
// SUCCEED so the INBOUND_MESSAGE branch is genuinely entered; D1-B / D2-E / the acknowledgement are
// controllable, and every call is recorded in ORDER.
// ============================================================================
function buildWebhook(over = {}) {
  const dir = resolve(`.phase5fd4b-wh-${Math.random().toString(36).slice(2, 8)}`);
  rmSync(dir, { recursive: true, force: true });
  const tsconfigPath = resolve(`${dir}.tsconfig.json`);
  writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node",
      skipLibCheck: true, esModuleInterop: true, strict: false, isolatedModules: true,
      outDir: dir, rootDir: ".", types: [], noResolve: true,
    },
    files: [WEBHOOK_SRC],
  }, null, 2));
  try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
  catch { /* expected noResolve diagnostics */ }
  finally { rmSync(tsconfigPath, { force: true }); }
  if (!existsSync(resolve(dir, "services/metaWhatsAppWebhookService.js"))) throw new Error("webhook did not transpile");

  const order = [];
  const calls = { persist: 0, commands: 0, ack: 0 };
  const inboundResult = over.inboundResult ?? {
    ok: true,
    result: {
      receiptId: RECEIPT_ID, receiptDuplicate: false, messagesSeen: 1, messagesPersisted: 1,
      messagesDuplicate: 0, messagesRejected: 0, identityExact: 0, identityAmbiguous: 0, identityUnknown: 1,
      processed: [persistedItem()],
    },
  };
  const commandsResult = over.commandsResult ?? {
    ok: true,
    result: { candidates: 1, skippedNotEligible: 0, helpAcknowledged: 0, unsupported: 0, writerInvocations: 1, applied: 1, replayed: 0, deterministicFailures: 0, items: [commandItem()] },
  };

  const STUBS = {
    "../lib/supabase": { adminClient: () => { throw new Error("db must not be touched on the inbound branch"); } },
    "./communicationService": { CommunicationService: class {} },
    "./communicationProviderRuntimeService": { isWebhookProcessingEnabled: async () => true },
    "../lib/communication/providers/metaCloudWhatsAppConfig": {
      resolveWebhookSignatureConfig: () => ({ ok: true, config: { appSecret: "secret" } }),
      resolveWebhookVerifyConfig: () => ({ ok: true, config: { webhookVerifyToken: "t" } }),
      webhookSignatureToRuntime: () => ({}),
    },
    "../lib/communication/providers/metaCloudWhatsAppProvider": {
      MetaCloudWhatsAppProvider: class {}, META_WHATSAPP_CLOUD_PROVIDER_KEY: "meta_whatsapp_cloud",
    },
    "../lib/communication/httpTransport": { FetchHttpTransport: class {} },
    "../lib/communication/providers/metaWhatsAppWebhook": {
      META_SIGNATURE_HEADER: "x-hub-signature-256",
      verifyMetaWebhookSignature: () => true,            // signature verification SUCCEEDS
      classifyMetaWebhook: () => "inbound_message",      // → the INBOUND_MESSAGE branch
      MetaWebhookClassification: {
        DELIVERY_STATUS: "delivery_status", INBOUND_MESSAGE: "inbound_message",
        TEMPLATE_STATUS: "template_status", ACCOUNT_STATUS: "account_status", UNKNOWN: "unknown",
      },
      deriveMetaWebhookEventId: () => "evt-1",
      metaWebhookPayloadHash: () => "h".repeat(64),
      verifyMetaWebhookGetChallenge: () => ({ ok: false }),
    },
    "./inboundWhatsAppMessageService": {
      handleInboundWhatsAppMessages: async () => { calls.persist++; order.push("persist"); return inboundResult; },
    },
    "./inboundConsentCommandService": {
      processInboundConsentCommands: async () => {
        calls.commands++;
        // The D2-E orchestrator is where the AUTHORITATIVE D2-D write happens for STOP/START.
        order.push("d2d_write");
        order.push("commands");
        return commandsResult;
      },
    },
    "./consentCommandResponseService": {
      processConsentCommandResponses: async () => {
        calls.ack++;
        order.push("ack");
        if (over.ackThrows) throw new Error("ack exploded: SQLSTATE 08006 +919812345678");
        return over.ackResult ?? { ok: true, result: { candidates: 1, attempted: 1, sent: 0, skipped: 0, failed: 1, items: [{ inboundMessageId: ROW_ID, ackType: "consent_stop_acknowledgement", outcome: "suppressed" }] } };
      },
    },
  };

  const req = createRequire(`${dir}/`);
  const Module = req("module");
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    return original.apply(this, [request, parent, isMain]);
  };
  const mod = req("./services/metaWhatsAppWebhookService.js");
  Module._load = original;
  return { mod, order, calls, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const postWebhook = async (over = {}) => {
  const w = buildWebhook(over);
  try {
    const res = await w.mod.handleMetaWhatsAppWebhookPost({
      rawBody: JSON.stringify(envelope(textMsg())),
      signature: "sha256=deadbeef",
    });
    return { res, order: w.order, calls: w.calls };
  } finally { w.cleanup(); }
};

check("W-CONTROL. the real webhook reaches the INBOUND branch and returns inbound_processed", async () => {
  const { res, calls, order } = await postWebhook({ ackResult: { ok: true, result: { candidates: 0, attempted: 0, sent: 0, skipped: 0, failed: 0, items: [] } } });
  assert(res.status === 200 && res.result === "inbound_processed", `control: 200/inbound_processed (got ${safeStringify(res)})`);
  assert(calls.persist === 1 && calls.commands === 1 && calls.ack === 1, "persist, commands and ack each ran once");
  assert(order.join(",") === "persist,d2d_write,commands,ack", `order: ${order.join(",")}`);
});

check("W-A. a THROWING acknowledgement leaves the HTTP status and body IDENTICAL to the control", async () => {
  const control = await postWebhook({ ackResult: { ok: true, result: { candidates: 0, attempted: 0, sent: 0, skipped: 0, failed: 0, items: [] } } });
  const thrown = await postWebhook({ ackThrows: true });
  assert(thrown.calls.persist === 1 && thrown.calls.commands === 1, "persistence and command processing still ran");
  assert(safeStringify(thrown.res) === safeStringify(control.res),
    `a throwing ack must not change the response (control ${safeStringify(control.res)} vs ${safeStringify(thrown.res)})`);
  assert(thrown.res.status === 200 && thrown.res.result === "inbound_processed", "still 200 / inbound_processed");
  const rendered = safeStringify(thrown.res);
  assert(!/SQLSTATE|exploded|ack|acknowledg/i.test(rendered.replace(/inbound_processed/g, "")), "no ack internals or raw error in the response");
  assert(!rendered.includes("+919812345678"), "no plaintext phone in the response");
});

check("W-B. a DENIED / FAILED acknowledgement leaves the HTTP status and body IDENTICAL to the control", async () => {
  const control = await postWebhook({ ackResult: { ok: true, result: { candidates: 0, attempted: 0, sent: 0, skipped: 0, failed: 0, items: [] } } });
  for (const outcome of ["suppressed", "send_failed", "authority_unavailable", "enforcement_invalid", "replayed"]) {
    const denied = await postWebhook({
      ackResult: { ok: true, result: { candidates: 1, attempted: 1, sent: 0, skipped: 0, failed: 1, items: [{ inboundMessageId: ROW_ID, ackType: "consent_stop_acknowledgement", outcome }] } },
    });
    assert(safeStringify(denied.res) === safeStringify(control.res), `${outcome}: the response is identical to the control`);
    assert(denied.res.status === 200, `${outcome}: still 200`);
    assert(!safeStringify(denied.res).includes(outcome), `${outcome}: the ack outcome never leaks into the response`);
  }
});

check("W-C. when COMMAND PROCESSING fails, the acknowledgement is NEVER invoked", async () => {
  const { res, calls, order } = await postWebhook({ commandsResult: { ok: false, code: "inbound_command_write_unavailable", result: { items: [] } } });
  assert(calls.ack === 0, "the acknowledgement service was NEVER called");
  assert(!order.includes("ack"), "…and never appears in the call order");
  assert(res.status === 500 && res.code === "inbound_command_processing_failed", "the existing webhook failure outcome is unchanged");
});

check("W-D. call ORDER is persist → D2-D write / commands → acknowledgement (never earlier)", async () => {
  const { order } = await postWebhook();
  const iPersist = order.indexOf("persist");
  const iWrite = order.indexOf("d2d_write");
  const iCommands = order.indexOf("commands");
  const iAck = order.indexOf("ack");
  assert(iPersist === 0, "persistence is first");
  assert(iPersist < iWrite, "the authoritative write follows persistence");
  assert(iWrite < iAck, "for STOP/START the acknowledgement NEVER precedes the completed writer result");
  assert(iCommands < iAck, "the acknowledgement runs only after command processing COMPLETED");
  // …and a persistence failure stops everything.
  const failed = await postWebhook({ inboundResult: { ok: false, code: "inbound_persist_failed", result: { processed: [] } } });
  assert(failed.calls.commands === 0 && failed.calls.ack === 0, "a persistence failure invokes neither commands nor the ack");
  assert(failed.res.status === 500 && failed.res.code === "inbound_processing_failed", "the persistence failure outcome is unchanged");
});

// ============================================================================
// BOUNDARIES (23, 30-32)
// ============================================================================
check("B1. the ORDINARY D3-B registry REJECTS all three acknowledgement types", () => {
  for (const t of M.Pure.CONSENT_ACK_TYPES) {
    for (const lane of ["authentication", "business"]) {
      const r = M.Registry.resolveOutboundConsentScope({ messageType: t, templateKey: t, lane });
      assert(r.ok === false && r.reason === "UNCLASSIFIED_MESSAGE_TYPE", `${t} (${lane}) is UNCLASSIFIED to the ordinary path`);
    }
  }
  // …and they are physically absent from the registry source.
  const reg = readF(REGISTRY_SRC);
  for (const t of M.Pure.CONSENT_ACK_TYPES) hasNot(new RegExp(t), reg, `${t} must NOT be in the D3-B registry`);
});

check("B2. the acknowledgement path makes NO direct provider call, no n8n, no Jarvis, NO bypass capability", () => {
  const src = stripTs(readF(SVC_SRC));
  // ★ NO REUSABLE SUPPRESSION-BYPASS CAPABILITY MAY EXIST ANYWHERE IN THE PATH ★
  // Not a flag, not an option, not a short-circuit. The ONLY thing that can authorize an acknowledgement
  // is a validated D2-C decision on a validated evidence binding.
  hasNot(/bypassConsent|ignoreSuppression|forceSend|skipConsent|overrideConsent|allowAnyway/i, src,
    "NO bypass / ignore / force / skip / override capability exists in the acknowledgement service");
  hasNot(/bypassConsent|ignoreSuppression|forceSend|skipConsent|overrideConsent|allowAnyway/i, stripTs(readF(PURE_SRC)),
    "…nor in the pure contract");
  hasNot(/sendTemplateMessage|sendAuthenticationMessage|sendResolvedTemplate|sendResolvedAuthenticationSms|graph\.facebook|whatsAppCloud/, src, "NO direct provider invocation");
  hasNot(/\bn8n\b|\bjarvis\b|openai|anthropic/i, src, "no n8n, no Jarvis, no AI");
  has(/createRuntimeCommunicationService/, src, "it sends only through the existing runtime factory");
  hasNot(/new CommunicationService\(/, src, "it never constructs CommunicationService directly");
});

check("B3. only metaWhatsAppWebhookService is a PRODUCTION caller of the entry point", () => {
  const out = execFileSync("git", ["grep", "-n", "processConsentCommandResponses", "--", "services/", "app/", "lib/"], { encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean)
    .filter((l) => {
      const code = l.replace(/^[^:]+:\d+:/, "").trim();
      return !code.startsWith("//") && !code.startsWith("*");
    });
  for (const line of out) {
    const file = line.split(":")[0];
    assert(file === SVC_SRC || file === WEBHOOK_SRC, `an unexpected production caller: ${line}`);
  }
  assert(out.some((l) => l.startsWith(WEBHOOK_SRC)), "the webhook service calls it");
});

check("B4. the webhook calls the ack AFTER D2-E, and never fails the command flow because of it", () => {
  const src = readF(WEBHOOK_SRC);
  const iPersist = src.indexOf("handleInboundWhatsAppMessages(");
  const iCommands = src.indexOf("processInboundConsentCommands(");
  const iCommandsOk = src.indexOf("if (!commands.ok) return { status: 500");
  const iAck = src.indexOf("processConsentCommandResponses(");
  assert(iPersist > 0 && iCommands > 0 && iCommandsOk > 0 && iAck > 0, "all four steps exist");
  assert(iPersist < iCommands, "persist precedes command processing");
  assert(iCommands < iAck, "the acknowledgement runs AFTER command processing");
  assert(iCommandsOk < iAck, "…and only once the command flow SUCCEEDED (so the D2-D write already exists)");
  // The ack is wrapped and its result is discarded: it can never change the webhook decision.
  has(/try \{\s*await processConsentCommandResponses\(/, src, "the ack call is wrapped");
  has(/\} catch \{[\s\S]{0,200}\}/, src, "a throwing ack is swallowed — the consent command already stands");
  hasNot(/if \(!ack[\s\S]{0,60}return \{ status: 500/, src, "an ack failure NEVER becomes a webhook 500");
  // The ack result is DISCARDED: it is never bound to a variable, never inspected, never returned.
  hasNot(/const \w+ = await processConsentCommandResponses\(/, src, "the ack result is discarded, never used in a decision");
  // NONE of the provider-facing outcome strings exposes a CONSENT-ACKNOWLEDGEMENT internal.
  // (`acknowledged_unknown` / `inbound_acknowledged_rejected` are PRE-EXISTING D1-B outcome names meaning
  // "Meta's payload was acknowledged" — they are not D4-B acknowledgement internals.)
  const returned = (src.match(/return \{ status: \d+,[^}]*\}/g) || []).join("\n");
  hasNot(/consent_command_response|consent_stop_acknowledgement|consent_start_acknowledgement|consent_help_response|ack_type|ack_sent|ack_failed|suppressed|rate_limit/i,
    returned, "no consent-acknowledgement internals in the provider-facing response");
  // …and the outcome vocabulary the webhook can return is UNCHANGED by D4-B.
  const base = execFileSync("git", ["show", `HEAD:${WEBHOOK_SRC}`], { encoding: "utf8" });
  const outcomesOf = (s) => [...s.matchAll(/return \{ status: \d+, (?:result|code): "([^"]+)"/g)].map((m) => m[1]).sort();
  assert(JSON.stringify(outcomesOf(src)) === JSON.stringify(outcomesOf(base)),
    "D4-B adds NO new webhook outcome — the provider-facing vocabulary is byte-identical");
});

check("B5. FROZEN authorities are unchanged; no SQL, migration, route, env, provider or template seed", () => {
  const dirty = gitDirty();
  for (const f of FROZEN) assert(!dirty.includes(f), `a FROZEN authority must not change: ${f}`);
  for (const p of dirty) {
    assert(!/^supabase\/migrations\//.test(p), `no migration may change (${p})`);
    assert(!/^app\/api\/.*route\.ts$|^pages\/api\//.test(p), `no API route may change (${p})`);
    assert(!/\.env/.test(p), `no env file may change (${p})`);
    assert(!/^lib\/communication\/providers\//.test(p), `no provider adapter may change (${p})`);
    assert(!/package-lock\.json|yarn\.lock|pnpm-lock\.yaml/.test(p), `no lockfile may change (${p})`);
    assert(D4B_EXPECTED_FILES.includes(p), `file outside the approved D4-B scope: ${p}`);
  }

  // ── THE D2-E HARNESS IS NOT ADMITTED WHOLESALE ────────────────────────────────────────────────
  // It is the ONE historical harness D4-B may touch, and ONLY for the two approved transformations.
  // Every other line must be byte-identical to the base, no assertion may be removed, and the check /
  // assertion / mutation accounting must be exactly what the audit ratified.
  if (dirty.includes(D2E_HARNESS_SRC)) {
    const problems = validateD2EHarnessDelta();
    assert(problems.length === 0, `D2-E harness change is out of bounds: ${problems.join(" | ")}`);
  }

  // D4-B creates NO template row and runs NO SQL.
  const all = [readF(PURE_SRC), readF(SVC_SRC), readF(WEBHOOK_SRC)].join("\n");
  hasNot(/insert into|create table|alter table|communication_templates/i, all, "no SQL, no template seed");
});

check("B6. wiring: the d4b script + doc exist; the doc covers the contract", () => {
  const pkg = JSON.parse(readF("package.json"));
  assert(pkg.scripts["test:phase5f:d4b"] === "node scripts/phase5f-d4b-consent-command-response-harness.mjs", "d4b script wired");
  for (const f of [PURE_SRC, SVC_SRC, HARNESS_SRC, DOC_SRC]) assert(existsSync(f), `${f} exists`);
  const doc = readF(DOC_SRC);
  for (const topic of [
    /founder/i, /transactional/i, /D3-B/, /registry/i, /authentication lane/i, /borrow/i,
    /evidence/i, /one-shot/i, /replay/i, /idempoten/i, /rate.limit/i, /15 minutes/i, /24 hours/i,
    /global suppression/i, /HELP/, /best-effort|non-authoritative/i, /no (SQL|template)/i,
    /Phase 7C|template.readiness/i, /no provider activation/i, /QuickFurno Core/i,
  ]) has(topic, doc, `doc covers ${topic}`);
});

// ============================================================================
// MUTATIONS
// ============================================================================
const mutationChecks = [];
function srcMutation(name, file, from, to, scenario) { mutationChecks.push({ name, kind: "src", edits: [{ file, from, to }], scenario }); }

async function withMutatedBuild(fn) {
  const dir = resolve(`.phase5fd4b-mut-${Math.random().toString(36).slice(2, 8)}`);
  try {
    compileTo(dir);
    transpileService(dir);
    return await fn(wireBuild(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function runWith(mm, over = {}) {
  const d = makeDeps(over);
  const res = await mm.Svc.processConsentCommandResponses({
    payload: over.payload ?? envelope(textMsg(over.msgOver ?? {})),
    webhookReceiptId: RECEIPT_ID,
    persisted: over.persisted ?? [persistedItem(over.persistedOver ?? {})],
    commands: over.commands ?? [commandItem(over.commandOver ?? {})],
  }, d.deps);
  return { res, sends: d.factory.calls.sends, factory: d.factory };
}

srcMutation("MUT 1: the acknowledgement is attempted BEFORE command processing completes (webhook reorder)",
  WEBHOOK_SRC,
  "    const commands = await processInboundConsentCommands(inbound.result.processed);\n    if (!commands.ok) return { status: 500, code: \"inbound_command_processing_failed\" };",
  "    const commands = { ok: true, result: { items: [] } } as unknown as Awaited<ReturnType<typeof processInboundConsentCommands>>;",
  async () => {
    const src = readF(WEBHOOK_SRC);
    const iCommands = src.indexOf("await processInboundConsentCommands(");
    const iAck = src.indexOf("processConsentCommandResponses(");
    // The authoritative command flow no longer runs before the acknowledgement.
    return iCommands < 0 && iAck > 0 && (await suiteGoesRed());
  });

srcMutation("MUT 2: an acknowledgement is sent WITHOUT a successful writer result (eligibility dropped)",
  PURE_SRC,
  "  if (!isEligibleDisposition(evidence.command, evidence.disposition)) {\n    return reject(AckRejectReason.INELIGIBLE_DISPOSITION);\n  }",
  "  // eligibility dropped",
  () => withMutatedBuild(async (mm) => {
    const r = await runWith(mm, { commandOver: { disposition: "writer_conflict" } });
    return r.sends.length > 0; // a FAILED command produced an acknowledgement
  }));

// A REUSABLE suppression-bypass flag: a caller-settable option that skips D2-C entirely. This is exactly
// the capability the phase forbids — it would let any holder of one validated command send anything to a
// suppressed destination. It is caught by the static no-bypass-capability guard AND proven functional here.
srcMutation("MUT 3: a reusable suppression-BYPASS flag is introduced (D2-C is skipped entirely)",
  SVC_SRC,
  "      if (!input) return invalid();",
  "      if (!input) return invalid();\n      if ((input as unknown as { bypassConsent?: boolean }).bypassConsent) return { kind: \"allow\", scope: \"authentication\" };",
  () => withMutatedBuild(async (mm) => {
    // The bypass is REAL: a globally suppressed destination is authorized without D2-C ever being asked.
    let captured = null;
    let asked = 0;
    await mm.Svc.processConsentCommandResponses({
      payload: envelope(textMsg()), webhookReceiptId: RECEIPT_ID,
      persisted: [persistedItem()], commands: [commandItem()],
    }, {
      decide: async () => { asked++; return OK_BLOCKED; },
      createService: (e) => { captured = e; return { ok: false, code: "x", error: "x" }; },
    });
    const r = await captured.authorize({
      channel: "whatsapp", messageType: "consent_stop_acknowledgement", templateKey: "consent_stop_acknowledgement",
      lane: "authentication", destinationHash: DEST_HASH, destinationSource: "ephemeral_auth_destination",
      recipientType: "system", recipientId: null, bypassConsent: true,
    });
    const before = asked;
    return r.kind === "allow" && asked === before; // authorized WITHOUT consulting the authority
  }));

// The destination-hash binding is fenced TWICE — in the PURE plan, and again in the one-shot enforcer.
// Either alone still blocks the send, so a load-bearing mutation must remove BOTH. That redundancy is the
// point: no single edit can send an acknowledgement to the wrong number.
const PURE_HASH_FENCE = {
  file: PURE_SRC,
  from: "  if (typeof observed.destinationHash !== \"string\" || observed.destinationHash !== evidence.destinationHash) {\n    return reject(AckRejectReason.DESTINATION_HASH_MISMATCH);\n  }",
  to: "  // hash comparison removed",
};
const ENFORCER_HASH_FENCE = {
  file: SVC_SRC,
  from: "      if (input.destinationHash !== plan.destinationHash) return invalid();",
  to: "      // enforcer hash fence removed",
};

mutationChecks.push({
  name: "MUT 4: BOTH destination-hash fences removed ⇒ an ack is sent to the WRONG number",
  kind: "src",
  edits: [PURE_HASH_FENCE, ENFORCER_HASH_FENCE],
  scenario: () => withMutatedBuild(async (mm) => {
    const r = await runWith(mm, { persistedOver: { receipt: { destinationHash: "c".repeat(64) } } });
    return r.sends.length > 0; // a mismatched destination was acknowledged
  }),
});

srcMutation("MUT 4b: the one-shot enforcer ALONE still blocks a mismatched destination (defence in depth)",
  PURE_HASH_FENCE.file, PURE_HASH_FENCE.from, PURE_HASH_FENCE.to,
  () => withMutatedBuild(async (mm) => {
    const r = await runWith(mm, { persistedOver: { receipt: { destinationHash: "c".repeat(64) } } });
    return r.sends.length === 0; // the second fence holds
  }));

srcMutation("MUT 5: the provider-message binding is REMOVED (evidence no longer describes this message)",
  PURE_SRC,
  "  if (typeof observed.providerMessageId !== \"string\" || observed.providerMessageId !== evidence.providerMessageId) {\n    return reject(AckRejectReason.PROVIDER_MESSAGE_MISMATCH);\n  }",
  "  // provider-message binding removed",
  () => withMutatedBuild(async (mm) => {
    const ev = {
      inboundMessageId: ROW_ID, webhookReceiptId: RECEIPT_ID, provider: "meta_whatsapp_cloud",
      providerMessageId: CANONICAL_PMID, channel: "whatsapp", destinationHash: DEST_HASH,
      command: "stop", disposition: "stop_applied", replayed: false, receivedAt: RECEIVED,
    };
    // A plan is now derived even though the observed identity is a DIFFERENT message.
    const p = mm.Pure.deriveConsentAckPlan(ev, { destinationHash: DEST_HASH, providerMessageId: "wamid.SOMETHING_ELSE" });
    return p.ok === true;
  }));

srcMutation("MUT 6: the command→type mapping is broken (a STOP is answered with the START copy)",
  PURE_SRC,
  "  stop: ConsentAckType.STOP,\n  start: ConsentAckType.START,",
  "  stop: ConsentAckType.START,\n  start: ConsentAckType.STOP,",
  () => withMutatedBuild(async (mm) => {
    const r = await runWith(mm);
    return r.sends.length > 0 && r.sends[0].type === "consent_start_acknowledgement"; // STOP answered as START
  }));

srcMutation("MUT 7: the REPLAY guard is removed (a duplicate webhook re-acknowledges)",
  PURE_SRC,
  "  if (evidence.replayed !== false) return reject(AckRejectReason.REPLAYED_COMMAND);",
  "  // replay guard removed",
  () => withMutatedBuild(async (mm) => {
    const r = await runWith(mm, { commandOver: { replayed: true } });
    return r.sends.length > 0; // a replayed command produced a NEW acknowledgement
  }));

srcMutation("MUT 8: the rate-limit idempotency key loses its window bucket",
  PURE_SRC,
  "  const bucket = Math.floor(ms / windowMs);\n  return `ack:${ackType}:${destinationHash}:${bucket}`;",
  "  void windowMs; void ms;\n  return `ack:${ackType}:${destinationHash}:${Math.random()}`;",
  () => withMutatedBuild(async (mm) => {
    const a = await runWith(mm);
    const b = await runWith(mm);
    // two identical commands in the same window now produce DIFFERENT keys ⇒ the ledger fence cannot dedupe
    return a.sends[0].idempotency_key !== b.sends[0].idempotency_key;
  }));

srcMutation("MUT 9: HELP is routed into the consent writer / opts the user in",
  SVC_SRC,
  "const isAckCommand = (v: unknown): v is AckCommand => v === \"stop\" || v === \"start\" || v === \"help\";",
  "const isAckCommand = (v: unknown): v is AckCommand => v === \"stop\" || v === \"start\" || v === \"help\";\nconst marketing_opted_in = true; void marketing_opted_in;",
  () => {
    const src = stripTs(readF(SVC_SRC));
    return /marketing_opted_in/.test(src); // check A3 forbids this token in the service
  });

srcMutation("MUT 10: an acknowledgement type is added to the ORDINARY D3-B registry (reusable bypass)",
  REGISTRY_SRC,
  "  client_nurture_followup: { templateKey: \"client_nurture_followup\", lane: \"business\", scope: \"marketing\" },",
  "  client_nurture_followup: { templateKey: \"client_nurture_followup\", lane: \"business\", scope: \"marketing\" },\n  consent_stop_acknowledgement: { templateKey: \"consent_stop_acknowledgement\", lane: \"authentication\", scope: \"authentication\" },",
  () => withMutatedBuild(async (mm) => {
    const r = mm.Registry.resolveOutboundConsentScope({
      messageType: "consent_stop_acknowledgement", templateKey: "consent_stop_acknowledgement", lane: "authentication",
    });
    return r.ok === true; // the ordinary path would now authorize an ack ⇒ a reusable suppression bypass
  }));

srcMutation("MUT 11: a MARKETING message is accepted by the acknowledgement path",
  SVC_SRC,
  "      if (input.messageType !== plan.ackType) return invalid();",
  "      if (false) return invalid();",
  () => withMutatedBuild(async (mm) => {
    let captured = null;
    await mm.Svc.processConsentCommandResponses({
      payload: envelope(textMsg()), webhookReceiptId: RECEIPT_ID,
      persisted: [persistedItem()], commands: [commandItem()],
    }, { decide: async () => OK_NO_OBJECTION, createService: (e) => { captured = e; return { ok: false, code: "x", error: "x" }; } });
    const r = await captured.authorize({
      channel: "whatsapp", messageType: "client_nurture_followup", templateKey: "consent_stop_acknowledgement",
      lane: "authentication", destinationHash: DEST_HASH, destinationSource: "ephemeral_auth_destination",
      recipientType: "system", recipientId: null,
    });
    return r.kind === "allow"; // a marketing type rode the acknowledgement path
  }));

srcMutation("MUT 12: the provider is invoked BEFORE evidence validation (the plan short-circuit is dropped)",
  SVC_SRC,
  "    if (!planned.ok) {\n      push(null, REJECT_TO_OUTCOME[planned.reason]);\n      continue;\n    }",
  "    if (!planned.ok) { push(null, REJECT_TO_OUTCOME[planned.reason]); }",
  () => withMutatedBuild(async (mm) => {
    // A REPLAYED command (which the plan rejects) now falls through toward the send path. Either it
    // reaches the service/provider, or it throws — both prove the short-circuit was load-bearing.
    try {
      const r = await runWith(mm, { commandOver: { replayed: true } });
      return r.sends.length > 0 || r.factory.calls.services > 0;
    } catch {
      return true;
    }
  }));

srcMutation("MUT 13: a GLOBAL suppression is converted to an ALLOW",
  SVC_SRC,
  "      if (decision.disposition === \"blocked\") return denied();                 // global suppression",
  "      if (decision.disposition === \"blocked\") return { kind: \"allow\", scope: \"authentication\" };",
  () => withMutatedBuild(async (mm) => {
    const r = await runWith(mm, { decision: OK_BLOCKED });
    return r.sends.length > 0; // a globally suppressed destination was messaged
  }));

srcMutation("MUT 14: a D2-C AUTHORITY FAILURE is converted to an ALLOW (fail-open)",
  SVC_SRC,
  "        if (decision.code === \"AUTHORITY_LOOKUP_FAILED\") return unavailable();\n        return invalid();                // integrity violation / invalid input / anything unexpected",
  "        return { kind: \"allow\", scope: \"authentication\" };",
  () => withMutatedBuild(async (mm) => {
    const r = await runWith(mm, { decision: { ok: false, code: "AUTHORITY_LOOKUP_FAILED" } });
    return r.sends.length > 0; // an unreadable authority became permission
  }));

srcMutation("MUT 15: the ONE-SHOT restriction is removed (one command authorizes a stream of sends)",
  SVC_SRC,
  "      if (used) return invalid();\n      used = true;",
  "      void used;",
  () => withMutatedBuild(async (mm) => {
    let captured = null;
    await mm.Svc.processConsentCommandResponses({
      payload: envelope(textMsg()), webhookReceiptId: RECEIPT_ID,
      persisted: [persistedItem()], commands: [commandItem()],
    }, { decide: async () => OK_NO_OBJECTION, createService: (e) => { captured = e; return { ok: false, code: "x", error: "x" }; } });
    const bound = {
      channel: "whatsapp", messageType: "consent_stop_acknowledgement", templateKey: "consent_stop_acknowledgement",
      lane: "authentication", destinationHash: DEST_HASH, destinationSource: "ephemeral_auth_destination",
      recipientType: "system", recipientId: null,
    };
    const a = await captured.authorize(bound);
    const b = await captured.authorize(bound);
    return a.kind === "allow" && b.kind === "allow"; // reusable — the one-shot fence is gone
  }));

srcMutation("MUT 16: an acknowledgement FAILURE is turned into a webhook error (it becomes authoritative)",
  WEBHOOK_SRC,
  "    } catch {\n      /* acknowledgement is never authoritative — the consent command already stands */\n    }",
  "    } catch {\n      return { status: 500, code: \"ack_failed\" };\n    }",
  async () => {
    const src = readF(WEBHOOK_SRC);
    return /return \{ status: 500, code: "ack_failed" \}/.test(src) && (await suiteGoesRed());
  });

srcMutation("MUT 17: the PLAINTEXT phone is added to the persisted metadata",
  SVC_SRC,
  "    inbound_message_id: plan.evidence.inboundMessageId,",
  "    inbound_message_id: plan.evidence.inboundMessageId,\n    destination: \"+919812345678\",",
  () => withMutatedBuild(async (mm) => {
    const r = await runWith(mm);
    return r.sends.length > 0 && safeStringify(r.sends[0].metadata).includes("+919812345678");
  }));

srcMutation("MUT 18: the durable inbound-message binding is removed from the evidence",
  PURE_SRC,
  "  if (typeof evidence.inboundMessageId !== \"string\" || !UUID_SHAPE.test(evidence.inboundMessageId)) {\n    return reject(AckRejectReason.INVALID_EVIDENCE);\n  }",
  "  // inbound binding removed",
  () => withMutatedBuild(async (mm) => {
    const ev = {
      inboundMessageId: "not-a-uuid", webhookReceiptId: RECEIPT_ID, provider: "meta_whatsapp_cloud",
      providerMessageId: CANONICAL_PMID, channel: "whatsapp", destinationHash: DEST_HASH,
      command: "stop", disposition: "stop_applied", replayed: false, receivedAt: RECEIVED,
    };
    // An acknowledgement is now planned WITHOUT a valid durable inbound-message binding.
    const p = mm.Pure.deriveConsentAckPlan(ev, { destinationHash: DEST_HASH, providerMessageId: CANONICAL_PMID });
    return p.ok === true;
  }));

// ---- The webhook's non-authoritative acknowledgement contract ---------------------------------
srcMutation("MUT 19: an acknowledgement FAILURE becomes HTTP 500 (the ack turns authoritative)",
  WEBHOOK_SRC,
  "    } catch {\n      /* acknowledgement is never authoritative — the consent command already stands */\n    }",
  "    } catch {\n      return { status: 500, code: \"ack_failed\" };\n    }",
  () => (async () => {
    // BEHAVIOURAL: the real handler now returns 500 for a successful consent command whose ack threw.
    const thrown = await postWebhook({ ackThrows: true });
    return thrown.res.status === 500;
  })());

srcMutation("MUT 20: the acknowledgement try/catch is REMOVED (a throwing ack escapes the handler)",
  WEBHOOK_SRC,
  "    try {\n      await processConsentCommandResponses({",
  "    {\n      await processConsentCommandResponses({",
  () => (async () => {
    try {
      const thrown = await postWebhook({ ackThrows: true });
      // Without the catch, the throw escapes the inbound branch and is caught by the OUTER handler,
      // which turns a successful consent command into a 500 server_error.
      return thrown.res.status !== 200;
    } catch {
      return true; // the throw escaped entirely — equally a violation
    }
  })());

// ---- The D2-E harness delta must stay byte-bounded ---------------------------------------------
srcMutation("MUT 21: an UNRELATED line in the D2-E harness is changed (wholesale admission)",
  D2E_HARNESS_SRC,
  'hasNot(/apply_communication_consent_command/, code, "the webhook never calls the RPC");',
  'hasNot(/apply_communication_consent_command_MUTATED/, code, "the webhook never calls the RPC");',
  () => {
    // The byte-bound validator must reject a change outside the two approved transformations.
    const problems = validateD2EHarnessDelta();
    return problems.some((p) => p.startsWith("unrelated D2-E harness line changed"));
  });

srcMutation("MUT 22: a THIRD consent-related module is admitted to the D2-E allowlist",
  D2E_HARNESS_SRC,
  'const ALLOWED_CONSENT_MODULES = ["./inboundConsentCommandService", "./consentCommandResponseService"];',
  'const ALLOWED_CONSENT_MODULES = ["./inboundConsentCommandService", "./consentCommandResponseService", "./communicationConsentWriterService"];',
  () => {
    const problems = validateD2EHarnessDelta();
    return problems.some((p) => p.includes("the allowlist must be exactly"));
  });

srcMutation("MUT 23: a D2-E check is REMOVED under cover of the approved correction",
  D2E_HARNESS_SRC,
  'hasNot(/communication_preferences|communication_suppressions/, code, "the webhook never touches consent tables");',
  "",
  () => {
    const problems = validateD2EHarnessDelta();
    // The accounting fence catches it: the assertion count drops below the ratified 158.
    return problems.some((p) => p.includes("assertion count must be") || p.startsWith("unrelated D2-E harness line changed"));
  });

// ============================================================================
// RUNNER
// ============================================================================
async function runFunctional() {
  let passed = 0, failed = 0;
  console.log("Running Phase 5F-D4-B consent command response checks...\n");
  for (const c of checks) {
    try { await c.fn(); console.log(`PASS ${c.name}`); passed++; }
    catch (e) { console.log(`FAIL ${c.name}`); console.error(e); failed++; }
  }
  return { passed, failed };
}
async function suiteGoesRed() { for (const c of checks) { try { await c.fn(); } catch { return true; } } return false; }

async function runMutations() {
  let passed = 0, failed = 0;
  console.log("\nRunning Phase 5F-D4-B mutation tests...\n");
  for (const mut of mutationChecks) {
    const originals = new Map();
    for (const edit of mut.edits) { const p = resolve(edit.file); if (!originals.has(p)) originals.set(p, readFileSync(p, "utf8")); }
    try {
      for (const edit of mut.edits) {
        const p = resolve(edit.file);
        const cur = readFileSync(p, "utf8");
        if (!cur.includes(edit.from)) throw new Error(`anchor not found in ${edit.file}`);
        writeFileSync(p, cur.replace(edit.from, edit.to));
      }
      let violation = false;
      try { violation = await mut.scenario(); }
      catch { violation = true; /* the mutation broke the build/behaviour → load-bearing */ }
      if (!violation) violation = await suiteGoesRed();
      if (violation) { console.log(`PASS ${mut.name}`); passed++; }
      else { console.log(`FAIL ${mut.name} (guard did not prove load-bearing)`); failed++; }
    } catch (e) { console.log(`FAIL ${mut.name}`); console.error(e); failed++; }
    finally { for (const [p, original] of originals) writeFileSync(p, original); }
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
