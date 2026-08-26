// ============================================================================
// QF-MVP-40-R8A — validator for the ONE-SHOT staging provider-account IDENTITY REPAIR.
// OFFLINE. Opens no database connection, calls no Meta endpoint, reads no credential,
// and never reads the owner's external production deny-digest proof (that file lives
// outside the repository and may legitimately be absent on any machine).
//
// Every rule is paired with a MUTATION that must be killed: a rule that cannot fail
// proves nothing. The decision, identity, pre-state, patch and post-state layers are
// pure and are driven here with fixtures. The non-negotiable STRUCTURAL properties
// (no INSERT/DELETE/RPC, no network, no readiness column in the patch, one UPDATE) are
// proved by scanning the operator source, because those are properties of the FILE
// rather than of any one execution.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CHANNEL,
  DENY_PROOF_ENV,
  OWNER_ACK_FLAG,
  Outcome,
  PROVIDER_KEY,
  PreState,
  REBINDABLE_COLUMNS,
  REQUIRED_READINESS,
  RepairFailure,
  SEND_CAPABLE_READINESS,
  buildCasPredicate,
  buildRepairPatch,
  classifyPreState,
  decide,
  isInsideRepository,
  makeDb,
  parseFlags,
  sha256Hex,
  validateRepairIdentity,
  verifyDenyProofAgreesWithBoundary,
  verifyPostState,
} from "./repair-meta-staging-account-identity-once.mjs";
import {
  ACTUAL_STAGING_IDENTITY_DIGESTS,
  HISTORICAL_MIXED_IDENTITY_DIGESTS,
  KNOWN_PRODUCTION_IDENTITY_DIGESTS,
} from "./metaStagingIdentity.mjs";

const OPERATOR = "scripts/mvp/communication/repair-meta-staging-account-identity-once.mjs";
const EVIDENCE = "docs/provider-manifests/meta-staging-identity-boundary-correction.json";

const code = readFileSync(resolve(OPERATOR), "utf8");
/**
 * Executable code only. The header deliberately DISCUSSES the things this operator must
 * not do ("no INSERT, no DELETE, no rpc", "no Meta network call"), so a raw-text scan
 * would be satisfied by prose and defeated by it in equal measure.
 */
const codeOnly = code
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");

// Public Meta asset ids, not secrets. They appear only here so the rules can be driven.
const ACTUAL = { app: "2097008694503517", waba: "1780494096277768", phone: "1179556411918086" };
const HISTORICAL = { waba: "27861262223494153", phone: "1333595106493545" };

let passed = 0;
let failed = 0;
const record = (label, ok) => {
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.log(`FAIL  ${label}`); }
};

const okEnv = () => ({
  QF_META_APP_ID: ACTUAL.app,
  QF_META_WABA_ID: ACTUAL.waba,
  QF_META_PHONE_NUMBER_ID: ACTUAL.phone,
});
/** The refreshed owner deny-proof: it must now name the historical pins as production. */
const okDeny = () => ({
  ok: true,
  digests: {
    appId: KNOWN_PRODUCTION_IDENTITY_DIGESTS.appId,
    wabaId: HISTORICAL_MIXED_IDENTITY_DIGESTS.wabaId,
    phoneNumberId: HISTORICAL_MIXED_IDENTITY_DIGESTS.phoneNumberId,
  },
});
const row = (over = {}) => ({
  id: "row-1",
  provider_key: PROVIDER_KEY,
  channel: CHANNEL,
  readiness_status: REQUIRED_READINESS,
  configuration_status: "partial",
  webhook_status: "pending",
  health_status: "unknown",
  billing_status: null,
  business_account_reference: HISTORICAL.waba,
  phone_number_reference: HISTORICAL.phone,
  ...over,
});
const repairedRow = (over = {}) => row({
  business_account_reference: ACTUAL.waba, phone_number_reference: ACTUAL.phone, ...over });

const bothFlags = () => parseFlags(["--execute", OWNER_ACK_FLAG]);
const decideWith = (over = {}) => decide({
  flags: bothFlags(),
  identity: validateRepairIdentity(okEnv()),
  denyProof: okDeny(),
  boundaryAgreement: verifyDenyProofAgreesWithBoundary(okDeny().digests),
  preState: PreState.BOUND_TO_HISTORICAL_MIXED,
  ...over,
});

// ===========================================================================
// BASELINE — the happy path must actually work, or every rejection test is vacuous.
// ===========================================================================
record("B01 the actual staging identity is authorised", validateRepairIdentity(okEnv()).ok === true);
record("B02 a refreshed deny-proof agrees with the corrected boundary",
  verifyDenyProofAgreesWithBoundary(okDeny().digests).ok === true);
record("B03 the historical-bound disabled row is the writable pre-state",
  classifyPreState([row()]).state === PreState.BOUND_TO_HISTORICAL_MIXED);
record("B04 the full happy path authorises exactly one write",
  decideWith().write === true && decideWith().outcome === null);
record("B05 the post-state of a correctly repaired row verifies",
  verifyPostState([repairedRow()]).ok === true);

// ===========================================================================
// FLAGS — dry run by default; a NEW acknowledgement; unknown flags refused.
// ===========================================================================
record("F01 no flags => dry run", parseFlags([]).mayWrite === false);
record("F02 --execute alone => no write", parseFlags(["--execute"]).mayWrite === false);
record("F03 the acknowledgement alone => no write", parseFlags([OWNER_ACK_FLAG]).mayWrite === false);
record("F04 both flags => may write", bothFlags().mayWrite === true);
record("F05 R7B's spent acknowledgement is REFUSED as unknown", (() => {
  const f = parseFlags(["--execute", "--owner-authorized-once"]);
  return f.ok === false && f.reason === RepairFailure.UNKNOWN_FLAG && f.mayWrite === false;
})());
record("F06 R7C's spent acknowledgement is REFUSED as unknown", (() => {
  const f = parseFlags(["--execute", "--owner-authorized-once-rebind"]);
  return f.ok === false && f.reason === RepairFailure.UNKNOWN_FLAG && f.mayWrite === false;
})());
record("F07 an unknown flag is refused, never silently ignored",
  parseFlags(["--execute", OWNER_ACK_FLAG, "--force"]).ok === false);
record("F08 a typo'd acknowledgement cannot degrade into a reported-success dry run", (() => {
  const f = parseFlags(["--execute", "--owner-authorized-once-identity-repai"]);
  return f.ok === false && decideWith({ flags: f }).outcome === Outcome.REFUSED;
})());
record("F09 the acknowledgement is this authority's own string",
  OWNER_ACK_FLAG === "--owner-authorized-once-identity-repair");
record("F10 no environment variable can substitute for the acknowledgement",
  !/process\.env\[[^\]]*(ACK|AUTHORI)/i.test(codeOnly) && !/env\.[A-Z_]*(ACK|AUTHORIZED)/.test(codeOnly));

// ===========================================================================
// IDENTITY — only the actual staging triple, never production.
// ===========================================================================
record("I01 the production WABA is refused as the new identity",
  validateRepairIdentity({ ...okEnv(), QF_META_WABA_ID: HISTORICAL.waba }).ok === false);
record("I02 the production phone is refused as the new identity",
  validateRepairIdentity({ ...okEnv(), QF_META_PHONE_NUMBER_ID: HISTORICAL.phone }).ok === false);
record("I03 writing the row BACK to the historical identity is impossible",
  validateRepairIdentity({ QF_META_APP_ID: ACTUAL.app,
    QF_META_WABA_ID: HISTORICAL.waba, QF_META_PHONE_NUMBER_ID: HISTORICAL.phone }).ok === false);
record("I04 a missing app id refuses even though no app column is written",
  validateRepairIdentity({ QF_META_WABA_ID: ACTUAL.waba, QF_META_PHONE_NUMBER_ID: ACTUAL.phone }).ok === false);
record("I05 a malformed id is refused", validateRepairIdentity({ ...okEnv(), QF_META_WABA_ID: "nope" }).ok === false);
record("I06 an unauthorised identity blocks the write even with both flags",
  decideWith({ identity: validateRepairIdentity({ ...okEnv(), QF_META_WABA_ID: HISTORICAL.waba }) }).write === false);

// ===========================================================================
// THE OWNER PROOF MUST AGREE WITH THE BOUNDARY — the R7C inconsistency, closed.
// ===========================================================================
record("P01 a deny-proof naming a DIFFERENT production WABA is refused", (() => {
  const d = { ...okDeny().digests, wabaId: "f".repeat(64) };
  const r = verifyDenyProofAgreesWithBoundary(d);
  return r.ok === false && r.reason === RepairFailure.DENY_PROOF_CONTRADICTS_BOUNDARY;
})());
record("P02 a deny-proof naming a DIFFERENT production phone is refused",
  verifyDenyProofAgreesWithBoundary({ ...okDeny().digests, phoneNumberId: "e".repeat(64) }).ok === false);
record("P03 a deny-proof that calls the ACTUAL staging WABA 'production' is refused",
  verifyDenyProofAgreesWithBoundary({ ...okDeny().digests,
    wabaId: ACTUAL_STAGING_IDENTITY_DIGESTS.wabaId }).ok === false);
record("P04 an absent deny-proof is refused, not defaulted",
  verifyDenyProofAgreesWithBoundary(null).ok === false);
record("P05 a contradicting proof blocks the write even with both flags and a good identity",
  decideWith({ boundaryAgreement: verifyDenyProofAgreesWithBoundary({ ...okDeny().digests, wabaId: "0".repeat(64) }) })
    .write === false);
record("P06 an unreadable deny-proof blocks the write",
  decideWith({ denyProof: { ok: false, reason: RepairFailure.DENY_PROOF_UNREADABLE } }).write === false);
record("P07 the owner proof must live OUTSIDE the repository",
  isInsideRepository(resolve("docs/proof.json")) === true
  && isInsideRepository(resolve(process.platform === "win32" ? "C:/qf/proof.json" : "/tmp/proof.json")) === false);
record("P08 the proof is consumed from its own env var, not a literal path",
  DENY_PROOF_ENV === "QF_PRODUCTION_META_DENY_DIGESTS_PATH" && codeOnly.includes("loadDenyProof"));

// ===========================================================================
// PRE-STATE — exactly one writable state; everything else refuses.
// ===========================================================================
record("R01 an absent row refuses", classifyPreState([]).state === PreState.ABSENT);
record("R02 a null row list refuses", classifyPreState(null).state === PreState.ABSENT);
record("R03 more than one row refuses", classifyPreState([row(), row()]).state === PreState.AMBIGUOUS);
record("R04 a send-capable row refuses, whatever it is bound to",
  classifyPreState([row({ readiness_status: SEND_CAPABLE_READINESS })]).state === PreState.SEND_CAPABLE);
record("R05 a send-capable row ALREADY on the actual staging identity still refuses",
  classifyPreState([repairedRow({ readiness_status: SEND_CAPABLE_READINESS })]).state === PreState.SEND_CAPABLE);
record("R06 null references refuse — that case belongs to the audited seed",
  classifyPreState([row({ business_account_reference: null })]).state === PreState.REFERENCES_NULL
  && classifyPreState([row({ phone_number_reference: "" })]).state === PreState.REFERENCES_NULL);
record("R07 references already on the actual staging identity => ALREADY_REPAIRED",
  classifyPreState([repairedRow()]).state === PreState.ALREADY_REPAIRED);
record("R08 a HALF-migrated row (staging WABA, historical phone) is UNRECOGNIZED",
  classifyPreState([row({ business_account_reference: ACTUAL.waba })]).state === PreState.UNRECOGNIZED_BINDING);
record("R09 a HALF-migrated row (historical WABA, staging phone) is UNRECOGNIZED",
  classifyPreState([row({ phone_number_reference: ACTUAL.phone })]).state === PreState.UNRECOGNIZED_BINDING);
record("R10 an entirely unknown binding is UNRECOGNIZED",
  classifyPreState([row({ business_account_reference: "999888777666555",
    phone_number_reference: "888777666555444" })]).state === PreState.UNRECOGNIZED_BINDING);
record("R11 the send-capable check runs BEFORE the binding check", (() => {
  const idx = codeOnly.indexOf("SEND_CAPABLE_READINESS");
  const bind = codeOnly.indexOf("historicalDigests.wabaId");
  return idx > 0 && bind > 0 && idx < bind;
})());

// ===========================================================================
// DECISION — WOULD_WRITE only in the one exact state, with both flags.
// ===========================================================================
record("D01 the exact pre-state + both flags => WOULD write", decideWith().write === true);
record("D02 dry run in that same state => zero write, and says so", (() => {
  const d = decideWith({ flags: parseFlags([]) });
  return d.write === false && d.outcome === Outcome.DRY_RUN_WOULD_REPAIR;
})());
record("D03 only --execute => zero write", decideWith({ flags: parseFlags(["--execute"]) }).write === false);
record("D04 only the acknowledgement => zero write", decideWith({ flags: parseFlags([OWNER_ACK_FLAG]) }).write === false);
record("D05 ALREADY_REPAIRED => zero write, and is NOT an error", (() => {
  const d = decideWith({ preState: PreState.ALREADY_REPAIRED });
  return d.write === false && d.outcome === Outcome.ALREADY_REPAIRED;
})());
record("D06 ABSENT => refused", decideWith({ preState: PreState.ABSENT }).outcome === Outcome.REFUSED);
record("D07 AMBIGUOUS => refused", decideWith({ preState: PreState.AMBIGUOUS }).outcome === Outcome.REFUSED);
record("D08 SEND_CAPABLE => refused", decideWith({ preState: PreState.SEND_CAPABLE }).outcome === Outcome.REFUSED);
record("D09 REFERENCES_NULL => refused", decideWith({ preState: PreState.REFERENCES_NULL }).outcome === Outcome.REFUSED);
record("D10 UNRECOGNIZED_BINDING => refused",
  decideWith({ preState: PreState.UNRECOGNIZED_BINDING }).outcome === Outcome.REFUSED);
record("D11 an unknown pre-state string fails CLOSED",
  decideWith({ preState: "SOMETHING_NEW" }).outcome === Outcome.REFUSED);

// ===========================================================================
// THE PATCH — exactly two columns, and nothing that could make the row send-capable.
// ===========================================================================
const patch = buildRepairPatch(okEnv());
record("W01 the patch has EXACTLY two keys", Object.keys(patch).length === 2);
record("W02 the patch's keys are exactly the two reference columns",
  Object.keys(patch).sort().join(",") === [...REBINDABLE_COLUMNS].sort().join(","));
record("W03 the patch carries the actual staging values",
  sha256Hex(patch.business_account_reference) === ACTUAL_STAGING_IDENTITY_DIGESTS.wabaId
  && sha256Hex(patch.phone_number_reference) === ACTUAL_STAGING_IDENTITY_DIGESTS.phoneNumberId);
record("W04 no forbidden column can appear in the patch",
  ["readiness_status", "configuration_status", "business_verification_status", "phone_number_status",
   "webhook_status", "health_status", "billing_status", "activation_status", "outbound_enabled"]
    .every((c) => !Object.prototype.hasOwnProperty.call(patch, c)));
record("W05 buildRepairPatch has no branch that could add a third column",
  (codeOnly.match(/business_account_reference:\s*String/g) ?? []).length === 1);
record("W06 the CAS predicate pins provider, channel and BOTH old references", (() => {
  const cas = buildCasPredicate(row());
  return cas.provider_key === PROVIDER_KEY && cas.channel === CHANNEL
    && cas.business_account_reference === HISTORICAL.waba
    && cas.phone_number_reference === HISTORICAL.phone;
})());
record("W07 the row selector is pinned — there is no generic/parameterised selector",
  /\.eq\("provider_key", PROVIDER_KEY\)\.eq\("channel", CHANNEL\)/.test(codeOnly)
  && !/env\.[A-Z_]*PROVIDER_KEY|env\.[A-Z_]*CHANNEL/.test(codeOnly));

// ===========================================================================
// THE PORT — one UPDATE, ever; no INSERT/DELETE/upsert/rpc is even expressible.
// ===========================================================================
const fakeClient = () => {
  const calls = [];
  const chain = { calls };
  const api = {
    update(p) { calls.push(["update", p]); return api; },
    eq() { return api; },
    neq(c, v) { calls.push(["neq", c, v]); return api; },
    select() { return Promise.resolve({ data: [repairedRow()], error: null }); },
  };
  return { chain, from() { return api; } };
};
await (async () => {
  const c = fakeClient();
  const db = makeDb(c);
  await db.repairOnce(patch, buildCasPredicate(row()));
  let threw = false;
  try { await db.repairOnce(patch, buildCasPredicate(row())); } catch { threw = true; }
  record("A02 the SECOND UPDATE throws — a one-shot cannot become a two-shot",
    threw === true && db.updateCount() === 1);
})();
await (async () => {
  const db = makeDb(fakeClient());
  let threw = false;
  try { await db.repairOnce({ ...patch, readiness_status: "provider_ready" }, buildCasPredicate(row())); }
  catch { threw = true; }
  record("A03 a patch with a third column is REFUSED by the port itself",
    threw === true && db.updateCount() === 0);
})();
await (async () => {
  const db = makeDb(fakeClient());
  let threw = false;
  try { await db.repairOnce({ business_account_reference: ACTUAL.waba }, buildCasPredicate(row())); }
  catch { threw = true; }
  record("A04 a patch MISSING a column is refused too — shape is exact, not a subset",
    threw === true && db.updateCount() === 0);
})();
await (async () => {
  // Drive the real port and read back what it actually asked the client to do, so the
  // send-capable guard is proved as a CALL, not merely as text in the file.
  const c = fakeClient();
  const db = makeDb(c);
  await db.repairOnce(patch, buildCasPredicate(row()));
  const neq = c.chain.calls.find(([kind]) => kind === "neq");
  record("A05 the UPDATE also guards on 'not send-capable' at the database",
    Array.isArray(neq) && neq[1] === "readiness_status" && neq[2] === SEND_CAPABLE_READINESS);
})();
record("A06 the port exposes NO insert method", !/\.insert\(/.test(codeOnly));
record("A07 the port exposes NO delete method", !/\.delete\(/.test(codeOnly));
record("A08 the port exposes NO upsert method", !/\.upsert\(/.test(codeOnly));
record("A09 the port exposes NO rpc method", !/\.rpc\(/.test(codeOnly));
record("A10 the operator makes NO Meta / HTTP call at all",
  !/fetch\(|graph\.facebook|https?:\/\//.test(codeOnly));
record("A11 the operator sends NO message", !/message_templates|\/messages\b|sendMessage/.test(codeOnly));
record("A12 the operator arms nothing",
  !/arm[-_]?readiness|arm[-_]?canary|qf_arm_|activation_status|outbound_enabled/i.test(codeOnly));
record("A13 the operator touches NO mapping or template table",
  !/communication_template_mappings|communication_templates\b/.test(codeOnly));
record("A14 the operator touches exactly ONE table", (() => {
  const tables = [...codeOnly.matchAll(/\.from\(([^)]*)\)/g)].map((m) => m[1].trim());
  return tables.length > 0 && tables.every((t) => t === "ACCOUNTS_TABLE");
})());

// ===========================================================================
// NO RETRY, AND A POST-STATE THAT MUST BE PROVEN.
// ===========================================================================
record("N01 no loop or scheduler can drive a second attempt", (() => {
  const noStrings = codeOnly.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, "``");
  return !/\bfor\s*\(|\bwhile\s*\(|\bdo\s*\{/.test(noStrings)
    && !/setTimeout|setInterval|setImmediate|process\.nextTick/.test(noStrings)
    && !/\bretry\b/i.test(noStrings);
})());
record("N02 an uncertain write is reported, never retried",
  /WRITE_OUTCOME_UNCERTAIN/.test(codeOnly) && /REPAIR_AMBIGUOUS/.test(codeOnly));
record("N03 a lost compare-and-swap refuses rather than widening the predicate",
  /CAS_LOST/.test(codeOnly) && !/\.eq\("id",/.test(codeOnly));
record("O01 the post-state must carry the ACTUAL staging identity",
  verifyPostState([repairedRow()]).ok === true
  && verifyPostState([row()]).reason === RepairFailure.READBACK_MISMATCH);
record("O02 a post-state still on the historical identity is a READBACK_MISMATCH",
  verifyPostState([row()]).ok === false);
record("O03 a post-state that escalated readiness is REFUSED even if the ids are right",
  verifyPostState([repairedRow({ readiness_status: "provider_ready" })]).reason === RepairFailure.READINESS_ESCALATED);
record("O04 a post-state readback returning zero or many rows is refused",
  verifyPostState([]).ok === false && verifyPostState([repairedRow(), repairedRow()]).ok === false);
record("O05 readiness must still be exactly 'disabled'", REQUIRED_READINESS === "disabled");
record("O06 exactly one readback is performed after the write",
  (codeOnly.match(/await db\.selectAccount\(\)/g) ?? []).length === 2);

// ===========================================================================
// ENVIRONMENT FENCE + EVIDENCE
// ===========================================================================
record("E01 the environment fence runs BEFORE any client is constructed", (() => {
  const fence = codeOnly.indexOf("resolveStagingTarget(env)");
  const client = codeOnly.indexOf("createClient(");
  return fence > 0 && client > 0 && fence < client;
})());
record("E02 the fence is the audited one, imported not re-implemented",
  /import \{ resolveStagingTarget \} from "\.\/seed-meta-staging-inactive-mappings\.mjs"/.test(codeOnly));
record("E03 dry run is the default — mayWrite requires BOTH flags",
  /mayWrite: execute && ownerAck/.test(codeOnly));
record("E04 no raw production identifier is committed in the operator",
  !codeOnly.includes(HISTORICAL.waba) && !codeOnly.includes(HISTORICAL.phone));
record("E05 no raw staging identifier is committed in the operator",
  !codeOnly.includes(ACTUAL.waba) && !codeOnly.includes(ACTUAL.phone));

let ev = null;
try { ev = JSON.parse(readFileSync(resolve(EVIDENCE), "utf8")); } catch { ev = null; }
record("E10 the correction artifact exists and is machine-readable", ev !== null);
if (ev) {
  record("E11 the artifact grants no Meta, mapping or send authority",
    ev.authorizes_meta_calls === false && ev.authorizes_mapping === false
    && ev.authorizes_sending === false);
  record("E12 the artifact declares itself secret-free", ev.contains_secrets === false);
  record("E13 the artifact names this operator and this acknowledgement", (() => {
    const c = ev.new_authorities?.database_identity_repair;
    return c?.operator === OPERATOR && (c?.required_flags ?? []).includes(OWNER_ACK_FLAG);
  })());
  record("E14 the artifact records the repair as NOT YET EXECUTED",
    ev.new_authorities?.database_identity_repair?.execution_status === "NOT_EXECUTED");
  record("E15 the artifact does not delete or restate history",
    ev.supersession?.deletes_history === false);
}

// ===========================================================================
console.log("");
console.log(`QF-MVP-40-R8A ACCOUNT IDENTITY REPAIR: ${passed}/${passed + failed} PASS`);
if (failed === 0) console.log("QF_MVP_40_R8A_ACCOUNT_IDENTITY_REPAIR_PROVEN");
console.log(`RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
