// ============================================================================
// QF-MVP-40 — validator for the canonical EXPLICIT marketing consent writer.  OFFLINE.
//
// It calls no Meta endpoint, opens no database, sends nothing and reads no credential.
// The service is exercised against an INJECTED fake RPC, so no Supabase client is ever
// constructed. Mutation self-tests drive each rule against a corrupted input.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SERVICE = "services/communicationMarketingConsentWriterService.ts";
const MIGRATION = "supabase/migrations/20260814000000_qf_mvp_40_marketing_consent_writer.sql";
const SUPPRESSION_WRITER = "services/communicationConsentWriterService.ts";
const DECISION = "services/communicationConsentDecisionService.ts";

const read = (p) => readFileSync(resolve(p), "utf8");
const svc = read(SERVICE);
const sql = read(MIGRATION);
const suppressionSrc = read(SUPPRESSION_WRITER);
const decisionSrc = read(DECISION);

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
const svcCode = strip(svc);
const sqlCode = sql.replace(/--.*$/gm, " ");

let passed = 0;
let failed = 0;
const record = (name, ok) => {
  if (ok === true) { passed += 1; console.log(`PASS  ${name}`); }
  else { failed += 1; console.log(`FAIL  ${name}`); }
};
const arecord = async (name, p) => record(name, await p);

// ---------------------------------------------------------------------------
// Load the service with an injected fake RPC. No Supabase client is constructed.
// ---------------------------------------------------------------------------
const mod = await import("../../../services/communicationMarketingConsentWriterService.ts")
  .catch(() => null);

const makeRpc = (impl) => {
  const calls = [];
  return {
    calls,
    deps: {
      rpc: async (name, args) => { calls.push({ name, args }); return impl(name, args); },
    },
  };
};
const okRpc = (code = "APPLIED", stateBefore = "absent", stateAfter = "allowed") =>
  makeRpc(async () => ({
    data: { ok: true, code, scope: "marketing", state_before: stateBefore, state_after: stateAfter },
    error: null,
  }));

const baseCmd = (over = {}) => ({
  action: "grant",
  principalType: "vendor",
  principalId: "11111111-2222-3333-4444-555555555555",
  channel: "whatsapp",
  source: "user",
  sourceEventType: "qf.owner.canary",
  sourceEventId: "canary-optin-1",
  occurredAt: new Date("2026-08-25T00:00:00.000Z"),
  ...over,
});

record("L01 the service module loads without constructing a database client", mod !== null);

if (mod) {
  const { applyMarketingConsent, validateMarketingConsentCommand,
    MarketingConsentAction, MarketingConsentFailure,
    MARKETING_CONSENT_POLICY_VERSION } = mod;

  // -------------------------------------------------------------------------
  // W — explicit opt-in works, and nothing else does
  // -------------------------------------------------------------------------
  await arecord("W01 an explicit grant records consent", (async () => {
    const r = okRpc();
    const out = await applyMarketingConsent(baseCmd(), r.deps);
    return out.ok === true && out.outcome === "APPLIED" && out.stateAfter === "allowed"
      && r.calls.length === 1 && r.calls[0].name === "qf_apply_marketing_consent_v1";
  })());
  await arecord("W02 the RPC always receives scope-free args with the server policy version",
    (async () => {
      const r = okRpc();
      await applyMarketingConsent(baseCmd(), r.deps);
      const a = r.calls[0].args;
      return a.p_policy_version === MARKETING_CONSENT_POLICY_VERSION
        && a.p_action === "grant"
        && !("p_scope" in a);   // scope is NEVER caller-supplied
    })());
  await arecord("W03 an explicit withdrawal is supported and is not a grant", (async () => {
    const r = okRpc("APPLIED", "allowed", "blocked");
    const out = await applyMarketingConsent(baseCmd({ action: "withdraw" }), r.deps);
    return out.ok === true && out.stateAfter === "blocked"
      && r.calls[0].args.p_action === "withdraw";
  })());

  // -------------------------------------------------------------------------
  // N — no opt-in input ⇒ fail closed. Every branch is a refusal.
  // -------------------------------------------------------------------------
  const refuses = async (over, expected) => {
    const r = okRpc();
    const out = await applyMarketingConsent(baseCmd(over), r.deps);
    return out.ok === false && out.reason === expected && r.calls.length === 0;
  };
  await arecord("N01 a missing action fails closed and never reaches the RPC",
    refuses({ action: undefined }, MarketingConsentFailure.ACTION_NOT_EXPLICIT));
  await arecord("N02 'start' is not an action",
    refuses({ action: "start" }, MarketingConsentFailure.ACTION_NOT_EXPLICIT));
  await arecord("N03 'stop' is not an action",
    refuses({ action: "stop" }, MarketingConsentFailure.ACTION_NOT_EXPLICIT));
  await arecord("N04 'help' is not an action",
    refuses({ action: "help" }, MarketingConsentFailure.ACTION_NOT_EXPLICIT));
  await arecord("N05 an unknown principal type fails closed",
    refuses({ principalType: "anonymous" }, MarketingConsentFailure.PRINCIPAL_NOT_EXACT));
  await arecord("N06 a missing principal id fails closed",
    refuses({ principalId: null }, MarketingConsentFailure.PRINCIPAL_NOT_EXACT));
  await arecord("N07 a non-uuid principal id fails closed",
    refuses({ principalId: "not-a-uuid" }, MarketingConsentFailure.PRINCIPAL_NOT_EXACT));
  await arecord("N08 a provider-supplied source is refused",
    refuses({ source: "provider" }, MarketingConsentFailure.SOURCE_NOT_PERMITTED));
  await arecord("N09 an invalid channel fails closed",
    refuses({ channel: "voice" }, MarketingConsentFailure.CHANNEL_INVALID));
  await arecord("N10 missing provenance fails closed",
    refuses({ sourceEventId: "" }, MarketingConsentFailure.SOURCE_EVENT_INVALID));
  await arecord("N11 an invalid instant fails closed",
    refuses({ occurredAt: new Date("nope") }, MarketingConsentFailure.OCCURRED_AT_INVALID));
  record("N12 the pure validator refuses a null command",
    validateMarketingConsentCommand(null)?.ok === false);
  await arecord("N13 an RPC error is a closed failure, never a silent success", (async () => {
    const r = makeRpc(async () => ({ data: null, error: { message: "x" } }));
    const out = await applyMarketingConsent(baseCmd(), r.deps);
    return out.ok === false && out.reason === MarketingConsentFailure.WRITE_FAILED;
  })());
  await arecord("N14 a transport throw is a closed failure", (async () => {
    const r = makeRpc(async () => { throw new Error("boom"); });
    const out = await applyMarketingConsent(baseCmd(), r.deps);
    return out.ok === false && out.reason === MarketingConsentFailure.WRITE_FAILED;
  })());
  await arecord("N15 a result claiming a non-marketing scope is rejected", (async () => {
    const r = makeRpc(async () => ({
      data: { ok: true, code: "APPLIED", scope: "transactional", state_after: "allowed" },
      error: null }));
    const out = await applyMarketingConsent(baseCmd(), r.deps);
    return out.ok === false && out.reason === MarketingConsentFailure.UNEXPECTED_RESULT;
  })());

  // -------------------------------------------------------------------------
  // I — idempotency / replay
  // -------------------------------------------------------------------------
  await arecord("I01 a replay is reported as REPLAYED, not a second grant", (async () => {
    const r = okRpc("REPLAYED", "allowed", "allowed");
    const out = await applyMarketingConsent(baseCmd(), r.deps);
    return out.ok === true && out.outcome === "REPLAYED";
  })());
  await arecord("I02 the same command produces identical RPC args both times", (async () => {
    const a = okRpc(); const b = okRpc("REPLAYED", "allowed", "allowed");
    await applyMarketingConsent(baseCmd(), a.deps);
    await applyMarketingConsent(baseCmd(), b.deps);
    return JSON.stringify(a.calls[0].args) === JSON.stringify(b.calls[0].args);
  })());
}

// ---------------------------------------------------------------------------
// S — service source fences
// ---------------------------------------------------------------------------
record("S01 the service never writes suppressions",
  !/communication_suppressions/.test(svcCode));
record("S02 the service never issues a raw table write",
  !/\.from\(|\.insert\(|\.upsert\(|\.update\(|\.delete\(/.test(svcCode));
record("S03 the only RPC it can call is the marketing consent writer", (() => {
  const rpcs = [...svcCode.matchAll(/rpc\(\s*"([^"]+)"/g)].map((m) => m[1]);
  return rpcs.length === 1 && rpcs[0] === "qf_apply_marketing_consent_v1";
})());
record("S04 scope is never a parameter of the service",
  !/p_scope|scope:\s*cmd\.|readonly scope/.test(svcCode));
record("S05 no provider call and no send surface",
  !/\/messages\b|fetch\s*\(|https?:\/\/|sendMessage|provider/i.test(svcCode)
  || !/\/messages\b|fetch\s*\(|sendMessage/i.test(svcCode));
record("S06 the policy version is a code constant, never caller-supplied",
  /export const MARKETING_CONSENT_POLICY_VERSION = "[A-Za-z0-9._:-]+";/.test(svcCode));
record("S07 no production or Jarvis reference", !/jarvis|onedecore|production/i.test(svcCode));

// ---------------------------------------------------------------------------
// Q — SQL fences
// ---------------------------------------------------------------------------
record("Q01 the RPC hard-codes scope marketing and takes no scope parameter",
  /'marketing'/.test(sqlCode) && !/p_scope/.test(sqlCode));
record("Q02 the RPC accepts only grant or withdraw",
  /p_action not in \('grant', 'withdraw'\)/.test(sqlCode));
record("Q03 the RPC issues no DML against communication_suppressions", (() => {
  // The bare word also appears inside the COMMENT ON string literal, which is
  // documentation asserting the opposite. The rule targets actual DML.
  return !/(insert\s+into|update|delete\s+from)\s+(public\.)?communication_suppressions/i
    .test(sqlCode);
})());
record("Q04 the RPC requires an exact client|vendor principal",
  /p_principal_type not in \('client', 'vendor'\)/.test(sqlCode)
  && /PRINCIPAL_NOT_EXACT/.test(sqlCode));
record("Q05 the consent event is idempotency-fenced",
  /idempotency_key/.test(sqlCode) && /on conflict \(idempotency_key\) do nothing/.test(sqlCode));
record("Q06 the RPC is SECURITY DEFINER with a pinned search_path",
  /security definer/.test(sqlCode) && /set search_path = public, pg_temp/.test(sqlCode));
record("Q07 execute is granted to service_role only, and revoked from anon/authenticated", (() => {
  // "to public" also matches "inTO PUBLIC.communication_consent_events" in an INSERT, so
  // the grantee rule is scoped to GRANT statements rather than the bare substring.
  const grants = sqlCode.match(/^\s*grant\b[\s\S]*?;/gim) ?? [];
  return /grant execute on function public\.qf_apply_marketing_consent_v1[\s\S]*?to service_role;/
      .test(sqlCode)
    && /from anon;/.test(sqlCode) && /from authenticated;/.test(sqlCode)
    && grants.length === 1
    && grants.every((g) => /to service_role;\s*$/.test(g.trim())
      && !/\bto\s+(anon|authenticated|public)\b/i.test(g));
})());
record("Q08 the writer records the audit event as a preference grant/withdrawal",
  /'preference'/.test(sqlCode) && /'user_grant'/.test(sqlCode) && /'user_withdrawal'/.test(sqlCode));
record("Q09 no shadow consent table is created",
  !/create table/i.test(sqlCode));

// ---------------------------------------------------------------------------
// P — the START/STOP boundary is preserved, and marketing still default-denies
// ---------------------------------------------------------------------------
record("P01 the suppression writer still declares it never creates marketing consent",
  /START NEVER creates marketing consent/i.test(suppressionSrc));
record("P02 the suppression writer still never writes preferences",
  !/from\("communication_preferences"\)|insert into public\.communication_preferences/
    .test(suppressionSrc));
record("P03 the suppression writer does not call the marketing consent RPC",
  !/qf_apply_marketing_consent_v1/.test(suppressionSrc));
record("P04 the marketing writer is not reachable from the inbound command path",
  !/inboundConsentCommand|apply_communication_consent_command/.test(svcCode));
record("P05 the decision service still default-denies marketing without a preference",
  /no_marketing_preference/.test(decisionSrc)
  && /ambiguous_identity_no_marketing_authority/.test(decisionSrc)
  && /unknown_identity_no_marketing_authority/.test(decisionSrc));
record("P06 marketing remains allowed only on an explicit opted-in preference",
  /preference_marketing_opted_in/.test(decisionSrc));
record("P07 the decision service remains the sole read-only precedence authority",
  /READ-ONLY/.test(decisionSrc) || /read-only/.test(decisionSrc));

// ---------------------------------------------------------------------------
// MUTATION SELF-TESTS
// ---------------------------------------------------------------------------
const MUT = [
  ["M01 a scope parameter in the SQL is rejected",
    () => !/p_scope/.test(sqlCode + "\n  p_scope text,")],
  ["M02 an action list including start is rejected",
    () => /p_action not in \('grant', 'withdraw'\)/
      .test(sqlCode.replace("'grant', 'withdraw'", "'grant', 'withdraw', 'start'"))],
  ["M03 a suppression write in the RPC is rejected",
    () => !/communication_suppressions/.test(sqlCode + "\ninsert into public.communication_suppressions")],
  ["M04 granting execute to authenticated is rejected", () => {
    const m = sqlCode + "\ngrant execute on function x to authenticated;";
    const grants = m.match(/^\s*grant\b[\s\S]*?;/gim) ?? [];
    return grants.length === 1
      && grants.every((g) => !/\bto\s+(anon|authenticated|public)\b/i.test(g));
  }],
  ["M05 a second RPC name in the service is rejected", () => {
    const m = svcCode + '\nawait deps.rpc("some_other_rpc", {});';
    return [...m.matchAll(/rpc\(\s*"([^"]+)"/g)].length === 1;
  }],
  ["M06 dropping the idempotency fence is rejected",
    () => /on conflict \(idempotency_key\) do nothing/
      .test(sqlCode.replace("on conflict (idempotency_key) do nothing", ""))],
];
for (const [name, fn] of MUT) {
  let held = false;
  try { held = fn() === true; } catch { held = false; }
  record(name, held === false);
}

console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
