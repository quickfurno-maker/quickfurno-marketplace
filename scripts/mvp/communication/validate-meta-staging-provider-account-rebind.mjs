// ============================================================================
// QF-MVP-40-R7C — validator for the ONE-SHOT staging provider-account rebind authority.
// OFFLINE. Opens no database connection, calls no Meta endpoint, reads no credential,
// and never reads the owner's external production deny-digest proof (that file lives
// outside the repository and may legitimately be absent on any given machine).
//
// Every rule is paired with a MUTATION that must be killed: a rule that cannot fail
// proves nothing. The decision, identity, pre-state and patch layers are pure and are
// driven here with fixtures; the non-negotiable structural properties (no INSERT/DELETE/
// RPC, no network, no readiness column in the patch) are proved by scanning the operator
// source, because those are properties of the FILE, not of any one execution.
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHANNEL, DENY_PROOF_ENV, OWNER_ACK_FLAG, Outcome, PROVIDER_KEY, PreState,
  REBINDABLE_COLUMNS, REQUIRED_READINESS, RebindFailure, SEND_CAPABLE_READINESS,
  STAGING_IDENTITY_DIGESTS, buildCasPredicate, buildRebindPatch, classifyPreState, decide,
  isInsideRepository, loadDenyProof, makeDb, parseDenyProof, parseFlags, sha256Hex,
  validateNewIdentity, verifyPostState,
} from "./rebind-meta-staging-provider-account-once.mjs";
import {
  EXPECTED_IDENTITY_DIGESTS as R7B_DIGESTS,
} from "./create-meta-staging-vendor-onboarding-reminder-once.mjs";

const OPERATOR = "scripts/mvp/communication/rebind-meta-staging-provider-account-once.mjs";
const EVIDENCE = "docs/provider-manifests/meta-staging-provider-account-rebind.json";

const code = readFileSync(resolve(OPERATOR), "utf8");
/**
 * Executable code only. The header deliberately DISCUSSES the things this operator must
 * not do ("no INSERT, no DELETE, no RPC", "no fetch"), so a raw-text scan would be
 * satisfied by prose and defeated by it in equal measure. Behavioural rules are asserted
 * against the comment-stripped source; the prose is documentation, not proof.
 */
const codeOnly = code
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");

// ---------------------------------------------------------------------------
// Fixtures. The staging ids are the real (non-secret, public) Meta asset ids whose
// digests the R7B authority pinned. The PRODUCTION digests here are SYNTHETIC — the
// real ones live only in the owner's external proof and are never committed.
// ---------------------------------------------------------------------------
const REAL = { waba: "27861262223494153", phone: "1333595106493545" };
const FAKE_PROD = {
  appId: sha256Hex("synthetic-production-app"),
  wabaId: sha256Hex("synthetic-production-waba"),
  phoneNumberId: sha256Hex("synthetic-production-phone"),
};
const PROD_RAW = { waba: "synthetic-production-waba", phone: "synthetic-production-phone" };

const goodEnv = () => ({ QF_META_WABA_ID: REAL.waba, QF_META_PHONE_NUMBER_ID: REAL.phone });
const goodProofText = () => JSON.stringify({
  schema_version: 1,
  production_app_id_sha256: FAKE_PROD.appId,
  production_waba_id_sha256: FAKE_PROD.wabaId,
  production_phone_number_id_sha256: FAKE_PROD.phoneNumberId,
});
const prodRow = (over = {}) => ({
  id: "row-1", provider_key: PROVIDER_KEY, channel: CHANNEL,
  readiness_status: REQUIRED_READINESS,
  business_account_reference: PROD_RAW.waba,
  phone_number_reference: PROD_RAW.phone,
  ...over,
});
const stagingRow = (over = {}) => prodRow({
  business_account_reference: REAL.waba, phone_number_reference: REAL.phone, ...over,
});
const okFlags = () => parseFlags(["--execute", OWNER_ACK_FLAG]);
const okProof = () => parseDenyProof(goodProofText());
const okIdentity = () => validateNewIdentity(goodEnv(), FAKE_PROD);
const ctx = (preState, over = {}) => ({
  flags: okFlags(), identity: okIdentity(), denyProof: okProof(), preState, ...over,
});

let passed = 0;
let failed = 0;
const record = (label, ok) => {
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.log(`FAIL  ${label}`); }
};

// ===========================================================================
// BASELINE — the happy path must actually work, or every "rejected" test is vacuous.
// ===========================================================================
record("B01 authorised staging identity passes", okIdentity().ok === true);
record("B02 well-formed owner proof parses", okProof().ok === true);
record("B03 production-bound disabled row is the writable pre-state",
  classifyPreState([prodRow()], { denyDigests: FAKE_PROD }).state === PreState.BOUND_TO_PRODUCTION);
record("B04 the happy path actually authorises the write",
  decide(ctx(PreState.BOUND_TO_PRODUCTION)).write === true);
record("B05 the pinned staging triple is the SAME one R7B pinned",
  STAGING_IDENTITY_DIGESTS.wabaId === R7B_DIGESTS.wabaId
  && STAGING_IDENTITY_DIGESTS.phoneNumberId === R7B_DIGESTS.phoneNumberId);
record("B06 the pinned digests actually match the real staging ids",
  sha256Hex(REAL.waba) === STAGING_IDENTITY_DIGESTS.wabaId
  && sha256Hex(REAL.phone) === STAGING_IDENTITY_DIGESTS.phoneNumberId);
/**
 * ANTI-VACUITY. The structural rules below scan `codeOnly`. If comment-stripping ever
 * over-matched and gutted the file, every "no X exists" rule would pass for the wrong
 * reason. So prove the stripped source still contains the real executable substance,
 * and that stripping actually removed the prose it was meant to remove.
 */
record("B07 comment-stripping leaves executable substance and removes prose",
  codeOnly.length > 2000
  && /export function decide\(/.test(codeOnly)
  && /await db\.rebindOnce\(/.test(codeOnly)
  && /communication_provider_accounts/.test(codeOnly)
  && /no INSERT, no DELETE, no RPC/.test(code)          // the prose DOES discuss it …
  && !/no INSERT, no DELETE, no RPC/.test(codeOnly));   // … and stripping removed exactly that
record("B08 the structural scanners are live, not vacuous", (() => {
  const injected = `${codeOnly}\nawait client.from(T).insert(r);\nawait client.rpc("arm");\n`
    + `await fetch("https://graph.facebook.com/x");\nawait client.from(T).delete();`;
  return /\.insert\s*\(/.test(injected) && /\.rpc\s*\(/.test(injected)
    && /graph\.facebook\.com/.test(injected) && /\.delete\s*\(/.test(injected);
})());

// ===========================================================================
// FLAGS — dry run is the default, and it takes BOTH flags to write.
// ===========================================================================
record("F01 no flags is a dry run", parseFlags([]).mayWrite === false);
record("F02 --execute alone is a dry run", parseFlags(["--execute"]).mayWrite === false);
record("F03 owner ack alone is a dry run", parseFlags([OWNER_ACK_FLAG]).mayWrite === false);
record("F04 both flags may write", parseFlags(["--execute", OWNER_ACK_FLAG]).mayWrite === true);
record("F05 an unknown flag is refused, not ignored", (() => {
  const f = parseFlags(["--execute", OWNER_ACK_FLAG, "--force"]);
  return f.ok === false && f.reason === RebindFailure.UNKNOWN_FLAG && f.mayWrite === false;
})());
record("F06 a refused flag set can never write",
  decide(ctx(PreState.BOUND_TO_PRODUCTION, { flags: parseFlags(["--yolo"]) })).write === false);
record("F07 the ack flag is rebind-specific, not R7B's template flag",
  parseFlags(["--execute", "--owner-authorized-once"]).ok === false);

// ===========================================================================
// OWNER PROOF — role-labelled, schema-pinned, external.
// ===========================================================================
record("P01 a UTF-8 BOM does not defeat the parser",
  parseDenyProof("\ufeff" + goodProofText()).ok === true);
record("P02 unparseable proof is refused",
  parseDenyProof("{not json").reason === RebindFailure.DENY_PROOF_UNREADABLE);
record("P03 an unsupported schema_version is refused", (() => {
  const p = JSON.parse(goodProofText()); p.schema_version = 2;
  return parseDenyProof(JSON.stringify(p)).reason === RebindFailure.DENY_PROOF_SCHEMA_UNSUPPORTED;
})());
record("P04 a missing role is refused", (() => {
  const p = JSON.parse(goodProofText()); delete p.production_waba_id_sha256;
  return parseDenyProof(JSON.stringify(p)).reason === RebindFailure.DENY_PROOF_INCOMPLETE;
})());
record("P05 a malformed digest is refused", (() => {
  const p = JSON.parse(goodProofText()); p.production_phone_number_id_sha256 = "not-a-digest";
  return parseDenyProof(JSON.stringify(p)).reason === RebindFailure.DENY_PROOF_MALFORMED_DIGEST;
})());
record("P06 roles collapsed onto one digest are refused", (() => {
  const p = JSON.parse(goodProofText());
  p.production_phone_number_id_sha256 = p.production_waba_id_sha256;
  return parseDenyProof(JSON.stringify(p)).reason === RebindFailure.DENY_PROOF_INCOMPLETE;
})());
record("P07 digests are read by ROLE, not by position", (() => {
  // Swapping waba/phone role values must change what the pre-state classifier accepts.
  const p = JSON.parse(goodProofText());
  const swapped = { ...p, production_waba_id_sha256: p.production_phone_number_id_sha256,
                          production_phone_number_id_sha256: p.production_waba_id_sha256 };
  const d = parseDenyProof(JSON.stringify(swapped));
  return d.ok === true
    && classifyPreState([prodRow()], { denyDigests: d.digests }).state === PreState.UNRECOGNIZED_BINDING;
})());
record("P08 a missing proof path is refused",
  loadDenyProof({}).reason === RebindFailure.DENY_PROOF_PATH_MISSING);
record("P09 a proof path INSIDE the repository is refused",
  loadDenyProof({ [DENY_PROOF_ENV]: resolve("docs/provider-manifests/x.json") }).reason
    === RebindFailure.DENY_PROOF_INSIDE_REPO);
record("P10 the repo-containment check is live, not vacuous",
  isInsideRepository(resolve("scripts/x.json")) === true
  && isInsideRepository("C:\\Users\\somebody\\outside\\proof.json") === false);
record("P11 a repo-sibling path is NOT treated as inside the repo",
  isInsideRepository(resolve("..", "quickfurno-evil", "proof.json")) === false);
record("P12 a bad proof can never write",
  decide(ctx(PreState.BOUND_TO_PRODUCTION, { denyProof: parseDenyProof("{") })).write === false);

// ===========================================================================
// NEW IDENTITY — digest-pinned, and independently cross-checked against production.
// ===========================================================================
record("I01 a wrong WABA is refused", (() => {
  const r = validateNewIdentity({ ...goodEnv(), QF_META_WABA_ID: "999999999999" }, FAKE_PROD);
  return r.ok === false && r.faults.some((f) => f.startsWith(RebindFailure.IDENTITY_UNAUTHORIZED));
})());
record("I02 a wrong phone number id is refused", (() => {
  const r = validateNewIdentity({ ...goodEnv(), QF_META_PHONE_NUMBER_ID: "999999999999" }, FAKE_PROD);
  return r.ok === false && r.faults.some((f) => f.startsWith(RebindFailure.IDENTITY_UNAUTHORIZED));
})());
record("I03 a missing id is refused", (() => {
  const r = validateNewIdentity({ QF_META_WABA_ID: REAL.waba }, FAKE_PROD);
  return r.ok === false && r.faults.some((f) => f.startsWith(RebindFailure.IDENTITY_MISSING));
})());
record("I04 an empty-string id is refused",
  validateNewIdentity({ ...goodEnv(), QF_META_WABA_ID: "" }, FAKE_PROD).ok === false);
record("I05 a PRODUCTION id is refused even if a pin were edited to allow it", (() => {
  // Simulate a carelessly-edited pin by denying the very digests the pins accept.
  const denyTheStaging = { appId: FAKE_PROD.appId, ...STAGING_IDENTITY_DIGESTS };
  const r = validateNewIdentity(goodEnv(), denyTheStaging);
  return r.ok === false && r.faults.some((f) => f.startsWith(RebindFailure.IDENTITY_IS_PRODUCTION));
})());
record("I06 an unauthorised identity can never write",
  decide(ctx(PreState.BOUND_TO_PRODUCTION, {
    identity: validateNewIdentity({ ...goodEnv(), QF_META_WABA_ID: "1" }, FAKE_PROD) })).write === false);

// ===========================================================================
// PRE-STATE — BOUND_TO_PRODUCTION is the only writable state.
// ===========================================================================
const pre = (rows) => classifyPreState(rows, { denyDigests: FAKE_PROD }).state;
record("S01 zero rows is ABSENT (creation is NOT this authority)", pre([]) === PreState.ABSENT);
record("S02 two rows is AMBIGUOUS", pre([prodRow(), prodRow()]) === PreState.AMBIGUOUS);
record("S03 a send-capable row is refused",
  pre([prodRow({ readiness_status: SEND_CAPABLE_READINESS })]) === PreState.SEND_CAPABLE);
record("S04 send-capability is checked BEFORE binding, so a send-capable production row is never writable",
  pre([prodRow({ readiness_status: SEND_CAPABLE_READINESS })]) !== PreState.BOUND_TO_PRODUCTION);
record("S05 NULL references defer to the audited 40.12 seed",
  pre([prodRow({ business_account_reference: null, phone_number_reference: null })])
    === PreState.REFERENCES_NULL);
record("S06 one NULL reference also defers",
  pre([prodRow({ phone_number_reference: null })]) === PreState.REFERENCES_NULL);
record("S07 an already-staging row is ALREADY_REBOUND", pre([stagingRow()]) === PreState.ALREADY_REBOUND);
record("S08 a HALF-migrated row is unrecognized, not close enough",
  pre([prodRow({ business_account_reference: REAL.waba })]) === PreState.UNRECOGNIZED_BINDING
  && pre([prodRow({ phone_number_reference: REAL.phone })]) === PreState.UNRECOGNIZED_BINDING);
record("S09 an unknown third-party binding is refused",
  pre([prodRow({ business_account_reference: "111", phone_number_reference: "222" })])
    === PreState.UNRECOGNIZED_BINDING);
record("S10 with NO deny proof, a production row is NOT writable",
  classifyPreState([prodRow()], { denyDigests: null }).state === PreState.UNRECOGNIZED_BINDING);

for (const [state, expected] of [
  [PreState.ABSENT, RebindFailure.ACCOUNT_ABSENT],
  [PreState.AMBIGUOUS, RebindFailure.ACCOUNT_AMBIGUOUS],
  [PreState.SEND_CAPABLE, RebindFailure.ACCOUNT_SEND_CAPABLE],
  [PreState.REFERENCES_NULL, RebindFailure.ACCOUNT_REFERENCES_NULL],
  [PreState.UNRECOGNIZED_BINDING, RebindFailure.UNRECOGNIZED_BINDING],
]) {
  const d = decide(ctx(state));
  record(`S11 ${state} refuses with ${expected} and never writes`,
    d.write === false && d.outcome === Outcome.REFUSED && d.reason === expected);
}
record("S12 ALREADY_REBOUND is a clean no-write, not a refusal", (() => {
  const d = decide(ctx(PreState.ALREADY_REBOUND));
  return d.write === false && d.outcome === Outcome.ALREADY_REBOUND;
})());
record("S13 the writable state still needs BOTH flags", (() => {
  const d = decide(ctx(PreState.BOUND_TO_PRODUCTION, { flags: parseFlags(["--execute"]) }));
  return d.write === false && d.outcome === Outcome.DRY_RUN_WOULD_REBIND;
})());

// ===========================================================================
// PATCH + CAS — exactly two columns, and the swap is compare-and-swap.
// ===========================================================================
record("C01 the patch is EXACTLY the two reference columns",
  Object.keys(buildRebindPatch(goodEnv())).sort().join(",") === [...REBINDABLE_COLUMNS].sort().join(","));
record("C02 the patch carries the staging identity", (() => {
  const p = buildRebindPatch(goodEnv());
  return sha256Hex(p.business_account_reference) === STAGING_IDENTITY_DIGESTS.wabaId
    && sha256Hex(p.phone_number_reference) === STAGING_IDENTITY_DIGESTS.phoneNumberId;
})());
record("C03 no readiness/status column can appear in the patch", (() => {
  const forbidden = ["readiness_status", "configuration_status", "webhook_status", "health_status",
    "billing_status", "business_verification_status", "phone_number_status"];
  const keys = Object.keys(buildRebindPatch(goodEnv()));
  return forbidden.every((f) => !keys.includes(f));
})());
record("C04 the CAS predicate pins the OLD references, not the new ones", (() => {
  const cas = buildCasPredicate(prodRow());
  return cas.business_account_reference === PROD_RAW.waba
    && cas.phone_number_reference === PROD_RAW.phone
    && cas.provider_key === PROVIDER_KEY && cas.channel === CHANNEL;
})());

// ===========================================================================
// DB PORT — one UPDATE, no other verb expressible.
// ===========================================================================
record("D02 the adapter exposes no insert/delete/upsert/rpc method", (() => {
  const db = makeDb({ from: () => ({}) });
  return typeof db.insert === "undefined" && typeof db.delete === "undefined"
    && typeof db.upsert === "undefined" && typeof db.rpc === "undefined"
    && Object.keys(db).sort().join(",") === "rebindOnce,selectAccount,updateCount";
})());

// The async port rules run together so a rejection cannot be silently swallowed.
const asyncRules = async () => {
  const client = {
    from: () => {
      const c = {
        update: () => c, eq: () => c, neq: () => c,
        select: async () => ({ data: [stagingRow()], error: null }),
      };
      return c;
    },
  };
  const db = makeDb(client);
  const patch = buildRebindPatch(goodEnv());
  const cas = buildCasPredicate(prodRow());

  const first = await db.rebindOnce(patch, cas);
  record("D03 the first UPDATE is accepted and counted",
    first.ok === true && db.updateCount() === 1);

  let threw = false;
  try { await db.rebindOnce(patch, cas); } catch (e) { threw = e.message === "SECOND_UPDATE_REFUSED"; }
  record("D04 a second UPDATE throws SECOND_UPDATE_REFUSED", threw === true);
  record("D05 the refused second UPDATE did not increment the counter", db.updateCount() === 1);

  const db2 = makeDb(client);
  let shapeThrew = false;
  try {
    await db2.rebindOnce({ ...patch, readiness_status: "provider_ready" }, cas);
  } catch (e) { shapeThrew = e.message === "PATCH_SHAPE_REFUSED"; }
  record("D06 a patch carrying readiness_status is refused by the port itself", shapeThrew === true);
  record("D07 the refused patch performed no write", db2.updateCount() === 0);

  const db3 = makeDb(client);
  let narrowThrew = false;
  try { await db3.rebindOnce({ business_account_reference: "x" }, cas); }
  catch (e) { narrowThrew = e.message === "PATCH_SHAPE_REFUSED"; }
  record("D08 a partial patch is refused too", narrowThrew === true);
};

// ===========================================================================
// POST-STATE — the write is only "done" if it landed AND did not escalate.
// ===========================================================================
record("V01 a correct readback passes", verifyPostState([stagingRow()]).ok === true);
record("V02 zero readback rows is a mismatch",
  verifyPostState([]).reason === RebindFailure.READBACK_MISMATCH);
record("V03 two readback rows is a mismatch",
  verifyPostState([stagingRow(), stagingRow()]).reason === RebindFailure.READBACK_MISMATCH);
record("V04 a row still on production references is a mismatch",
  verifyPostState([prodRow()]).reason === RebindFailure.READBACK_MISMATCH);
record("V05 a half-written row is a mismatch",
  verifyPostState([stagingRow({ phone_number_reference: PROD_RAW.phone })]).reason
    === RebindFailure.READBACK_MISMATCH);
record("V06 an escalated readiness is caught even though the refs are right",
  verifyPostState([stagingRow({ readiness_status: SEND_CAPABLE_READINESS })]).reason
    === RebindFailure.READINESS_ESCALATED);
record("V07 any non-disabled readiness is caught",
  verifyPostState([stagingRow({ readiness_status: "configured" })]).reason
    === RebindFailure.READINESS_ESCALATED);

// ===========================================================================
// STRUCTURAL — properties of the FILE, proved against comment-stripped source.
// ===========================================================================
record("X01 no INSERT anywhere in executable code", !/\.insert\s*\(/.test(codeOnly));
record("X02 no DELETE anywhere in executable code", !/\.delete\s*\(/.test(codeOnly));
record("X03 no UPSERT anywhere in executable code", !/\.upsert\s*\(/.test(codeOnly));
record("X04 no RPC anywhere in executable code", !/\.rpc\s*\(/.test(codeOnly));
record("X05 no network call of any kind", !/\bfetch\s*\(/.test(codeOnly));
record("X06 no Meta/Graph host reference", !/graph\.facebook\.com/.test(codeOnly));
record("X07 no messaging or send endpoint", !/\/messages\b/.test(codeOnly));
/**
 * Exactly one DATABASE update call site. `createHash(...).update(...)` is the crypto
 * digest builder, not a write, so it is neutralised first — otherwise the rule would
 * count hashing as writing and could be satisfied (or broken) for the wrong reason.
 */
const dbOnly = codeOnly.replace(/createHash\s*\([^)]*\)\s*\.update\s*\(/g, "createHash().digestFeed(");
record("X08 exactly one database .update( call site",
  (dbOnly.match(/\.update\s*\(/g) ?? []).length === 1);
record("X08b the single database update is the guarded one-shot, and it takes the patch",
  /\.update\(patch\)/.test(dbOnly)
  && /async rebindOnce\(patch, cas\)/.test(dbOnly));
record("X08c the neutraliser did not simply delete every update call",
  (dbOnly.match(/digestFeed\(/g) ?? []).length === 1);
record("X09 the row selector is pinned, not parameterised",
  /const PROVIDER_KEY = "meta_whatsapp_cloud"/.test(codeOnly)
  && /const CHANNEL = "whatsapp"/.test(codeOnly));
record("X10 the environment fence is imported from the audited seed, not reimplemented",
  /import \{ resolveStagingTarget \}/.test(codeOnly)
  && /resolveStagingTarget\(env\)/.test(codeOnly));
record("X11 the fence runs before any Supabase client is constructed", (() => {
  const fence = codeOnly.indexOf("resolveStagingTarget(env)");
  const client = codeOnly.indexOf("createClient(");
  return fence > 0 && client > fence;
})());
record("X12 the staging pin is imported from R7B, not duplicated as a literal",
  /EXPECTED_IDENTITY_DIGESTS as STAGING_IDENTITY_DIGESTS/.test(codeOnly));
/**
 * The operator must contain NO 64-hex literal at all. The staging pin is imported from R7B
 * and the production digests are loaded from the owner's external proof at runtime, so any
 * digest literal appearing here would mean an identity had been inlined — the exact thing
 * that would let a careless edit rebind to an unreviewed asset.
 */
record("X13 the operator hardcodes no digest literal whatsoever",
  (code.match(/[0-9a-f]{64}/g) ?? []).length === 0);
record("X14 no canary / activation / mapping authority is invoked",
  !/arm_|activate_|canary_destination|provider_template_mappings|runtime_policies/.test(codeOnly));
record("X15 the ack flag cannot be satisfied by an environment variable",
  !/process\.env\[[^\]]*AUTHORIZ/i.test(codeOnly) && !/env\.\w*OWNER_\w*AUTH/i.test(codeOnly));

// ===========================================================================
// EVIDENCE — the committed artifact must exist and must not overclaim.
// ===========================================================================
record("E01 the scoped evidence artifact exists", existsSync(resolve(EVIDENCE)));
if (existsSync(resolve(EVIDENCE))) {
  const ev = JSON.parse(readFileSync(resolve(EVIDENCE), "utf8"));
  record("E02 evidence grants no send authority",
    ev.owner_authorization?.send_authority === "DENIED");
  record("E03 evidence grants no provider activation",
    ev.owner_authorization?.activation_authority === "NOT_GRANTED");
  record("E04 evidence grants no production authority",
    ev.owner_authorization?.production_authority === "NOT_GRANTED");
  record("E05 evidence declares no secrets", ev.contains_secrets === false);
  record("E06 evidence caps the write at one UPDATE of two columns",
    ev.execution_contract?.max_update_count === 1
    && Array.isArray(ev.execution_contract?.rebindable_columns)
    && ev.execution_contract.rebindable_columns.length === 2);
  record("E07 evidence records the pinned staging digests, matching the operator",
    ev.staging_asset_identity?.waba_id_sha256 === STAGING_IDENTITY_DIGESTS.wabaId
    && ev.staging_asset_identity?.phone_number_id_sha256 === STAGING_IDENTITY_DIGESTS.phoneNumberId);
  /**
   * The ONLY digests permitted in the committed evidence are the three staging asset digests
   * (already public in the R7B evidence) and, optionally, a hash OF THE OWNER'S PROOF FILE —
   * which identifies which proof was used without revealing any production asset id.
   * Every other 64-hex literal is treated as a leak.
   */
  record("E08 evidence does NOT commit any production digest", (() => {
    const text = readFileSync(resolve(EVIDENCE), "utf8");
    const found = text.match(/[0-9a-f]{64}/g) ?? [];
    const allowed = new Set([
      STAGING_IDENTITY_DIGESTS.wabaId,
      STAGING_IDENTITY_DIGESTS.phoneNumberId,
      STAGING_IDENTITY_DIGESTS.appId,
      ev.owner_proof?.owner_proof_file_sha256,
    ].filter(Boolean));
    return found.every((h) => allowed.has(h));
  })());
  record("E09 evidence points at the real operator and validator",
    ev.execution_contract?.operator === OPERATOR
    && ev.execution_contract?.validator === "scripts/mvp/communication/validate-meta-staging-provider-account-rebind.mjs");
  record("E10 evidence keeps the owner proof external",
    ev.owner_proof?.committed_to_repository === false
    && ev.owner_proof?.env_var === DENY_PROOF_ENV);
}

// ---------------------------------------------------------------------------
asyncRules().then(() => {
  console.log("");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}).catch((e) => {
  console.log(`RESULT: validator crashed — ${e.message}`);
  process.exit(1);
});
