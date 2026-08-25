// ============================================================================
// QF-MVP-40-R7B — validator for the ONE-SHOT staging template creation authority.
// OFFLINE. Calls no Meta endpoint, submits nothing, sends nothing, reads no credential.
//
// Every rule is paired with a MUTATION that must be killed: a rule that cannot fail
// proves nothing. The live-asset, payload and decision layers are pure and are driven
// here with fixtures; the non-negotiable structural properties (no messaging endpoint,
// no DELETE/PUT/PATCH, no DB, no generic selector) are proved by scanning the operator
// source, because those are properties of the FILE, not of any one execution.
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyCreateResponse as classifyCreateResponseLocal } from "./submit-meta-templates.mjs";
import {
  EXPECTED_IDENTITY_DIGESTS, EXPECTED_PAYLOAD_FINGERPRINT, OWNER_ACK_FLAG, Outcome, PreState,
  TARGET_TEMPLATE_KEY, TARGET_TEMPLATE_NAME, classifyLiveAssets, classifyPreState, decide,
  loadCanonicalPayload, makeHttp, parseFlags, sha256Hex, validateIdentity,
} from "./create-meta-staging-vendor-onboarding-reminder-once.mjs";

const OPERATOR = "scripts/mvp/communication/create-meta-staging-vendor-onboarding-reminder-once.mjs";
const EVIDENCE = "docs/provider-manifests/meta-staging-one-shot-template-creation.json";
const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";
const PACKET_VALIDATOR = "scripts/mvp/communication/validate-meta-template-submission-packet.mjs";

const code = readFileSync(resolve(OPERATOR), "utf8");
/**
 * Executable code only. The header deliberately DISCUSSES the things this operator must
 * not do ("no provider activation RPC", "never … relies on `submit_now`"), so a raw-text
 * scan would be satisfied by prose and defeated by it in equal measure. Behavioural rules
 * are asserted against the comment-stripped source; the prose is documentation, not proof.
 */
const codeOnly = code
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
const packet = JSON.parse(readFileSync(resolve(PACKET), "utf8"));
const evidence = JSON.parse(readFileSync(resolve(EVIDENCE), "utf8"));

// QF-MVP-40-R8 - THESE ARE THE HISTORICAL MIXED IDENTITY IDS, NOT STAGING IDS.
// The app id is the genuine QuickFurno Staging app; the WABA and phone ids are the
// PRODUCTION assets. They are public Meta ids, not secrets, and they appear here only
// so this operator's pins can be driven with the values it actually executed against.
// The ACTUAL staging identity lives in metaStagingIdentity.mjs and is never used here.
const HISTORICAL = { app: "2097008694503517", waba: "27861262223494153", phone: "1333595106493545" };
const goodEnv = () => ({
  QF_META_GRAPH_API_VERSION: "v26.0",
  QF_META_WABA_ID: HISTORICAL.waba,
  QF_META_PHONE_NUMBER_ID: HISTORICAL.phone,
  QF_META_APP_ID: HISTORICAL.app,
  QF_META_ACCESS_TOKEN: "irrelevant-not-a-real-token",
});
const okGet = (body) => ({ ok: true, status: 200, body });
const goodAssets = () => ({
  waba: okGet({ id: HISTORICAL.waba }),
  phones: okGet({ data: [{ id: HISTORICAL.phone, verified_name: "quickfurno.in", quality_rating: "GREEN", code_verification_status: "VERIFIED" }] }),
  subs: okGet({ data: [{ whatsapp_business_api_data: { id: HISTORICAL.app, name: "QuickFurno Staging" } }] }),
});
const clonePacket = () => JSON.parse(JSON.stringify(packet));
const entryOf = (p) => p.templates.find((t) => t.internal_template_key === TARGET_TEMPLATE_KEY);

let passed = 0;
let failed = 0;
const record = (label, ok) => {
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.log(`FAIL  ${label}`); }
};

// ---------------------------------------------------------------------------
// Baseline: the happy path must actually work, or every "rejected" test is vacuous.
// ---------------------------------------------------------------------------
record("B01 authorised identity passes", validateIdentity(goodEnv()).ok === true);
record("B02 canonical payload loads and fingerprints exactly", (() => {
  const r = loadCanonicalPayload(packet);
  return r.ok === true && r.fingerprint === EXPECTED_PAYLOAD_FINGERPRINT;
})());
record("B03 live asset proof passes on the exact staging triple", classifyLiveAssets(goodAssets()).ok === true);
/**
 * ANTI-VACUITY. The structural rules below scan `codeOnly`. If comment-stripping ever
 * over-matched and gutted the file, every "no X exists" rule would pass for the wrong
 * reason. So prove the stripped source still contains the real executable substance,
 * and that stripping actually removed the prose it was meant to remove.
 */
record("B05 comment-stripping leaves executable substance and removes prose",
  codeOnly.length > 2000
  && /export function decide\(/.test(codeOnly)
  && /await http\.createOnce\(/.test(codeOnly)
  && /message_templates/.test(codeOnly)
  && /submit_now/.test(code)          // the prose DOES discuss it …
  && !/submit_now/.test(codeOnly));   // … and stripping removed exactly that
record("B06 the structural scanners are live, not vacuous", (() => {
  const injected = `${codeOnly}\nconst c = createClient(); await c.rpc("arm");\nawait fetch(u, { method: "DELETE" });`;
  return /supabase|createClient|\.rpc\(/i.test(injected)
    && /method:\s*["'](DELETE|PUT|PATCH)["']/i.test(injected)
    && !/supabase|createClient|\.rpc\(/i.test(codeOnly);
})());
record("B04 absent target + both flags decides to POST", (() => {
  const d = decide({
    flags: parseFlags(["--execute", OWNER_ACK_FLAG]), identity: validateIdentity(goodEnv()),
    payloadResult: loadCanonicalPayload(packet), preState: PreState.ABSENT,
  });
  return d.post === true;
})());

// ---------------------------------------------------------------------------
// 1-3, 19: identity mutations. Any other asset — production included — is refused.
// ---------------------------------------------------------------------------
record("M01 a wrong WABA id is rejected",
  validateIdentity({ ...goodEnv(), QF_META_WABA_ID: "27861262223494154" }).ok === false);
record("M02 a wrong app id is rejected",
  validateIdentity({ ...goodEnv(), QF_META_APP_ID: "2097008694503518" }).ok === false);
record("M03 a wrong phone id is rejected",
  validateIdentity({ ...goodEnv(), QF_META_PHONE_NUMBER_ID: "1333595106493546" }).ok === false);
record("M19 an arbitrary/production-shaped identity is rejected (allow-list of one)", (() => {
  const r = validateIdentity({ ...goodEnv(), QF_META_WABA_ID: "999888777666555", QF_META_APP_ID: "111222333444555", QF_META_PHONE_NUMBER_ID: "555444333222111" });
  return r.ok === false && r.faults.filter((f) => f.startsWith("unauthorized_identity:")).length === 3;
})());
record("M19b a missing graph version is rejected",
  validateIdentity({ ...goodEnv(), QF_META_GRAPH_API_VERSION: undefined }).ok === false);
record("M19c a malformed graph version is rejected",
  validateIdentity({ ...goodEnv(), QF_META_GRAPH_API_VERSION: "26" }).ok === false);

// ---------------------------------------------------------------------------
// 4-9: canonical payload mutations. The pinned fingerprint is the backstop.
// ---------------------------------------------------------------------------
record("M04 a wrong provider template name is rejected", (() => {
  const p = clonePacket(); entryOf(p).provider_template_name = "qf_something_else_v1";
  return loadCanonicalPayload(p).ok === false;
})());
record("M04b a renamed payload name is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.name = "qf_something_else_v1";
  return loadCanonicalPayload(p).reason === "name_mismatch";
})());
record("M05 a changed body is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].text += " Extra.";
  return loadCanonicalPayload(p).reason === "fingerprint_drift";
})());
record("M06 a changed category is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.category = "MARKETING";
  return loadCanonicalPayload(p).reason === "category_mismatch";
})());
record("M07 a changed language is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.language = "en_US";
  return loadCanonicalPayload(p).reason === "language_mismatch";
})());
record("M08 a changed example is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].example.body_text[0][0] = "PAN card";
  return loadCanonicalPayload(p).reason === "fingerprint_drift";
})());
record("M09 an added parameter_format is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.parameter_format = "POSITIONAL";
  return loadCanonicalPayload(p).reason === "payload_shape_unexpected";
})());
record("M09b an added header component is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components.push({ type: "header", text: "hi" });
  return loadCanonicalPayload(p).reason === "component_count_unexpected";
})());
record("M09c added buttons are rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].buttons = [{ type: "QUICK_REPLY", text: "Yes" }];
  return loadCanonicalPayload(p).ok === false;
})());
record("M09d a second variable is rejected", (() => {
  const p = clonePacket(); const c = entryOf(p).creation_payload.components[0];
  c.text = c.text.replace("{{1}}", "{{1}} {{2}}");
  return loadCanonicalPayload(p).ok === false;
})());
record("M09e a duplicated target entry is rejected", (() => {
  const p = clonePacket(); p.templates.push(JSON.parse(JSON.stringify(entryOf(p))));
  return loadCanonicalPayload(p).reason === "target_entry_not_unique";
})());
record("M09f an absent target entry is rejected", (() => {
  const p = clonePacket();
  p.templates = p.templates.filter((t) => t.internal_template_key !== TARGET_TEMPLATE_KEY);
  return loadCanonicalPayload(p).reason === "target_entry_not_unique";
})());

// ---------------------------------------------------------------------------
// 10: the target already existing must never post.
// ---------------------------------------------------------------------------
const preStateFor = (rows) => classifyPreState(okGet({ data: rows })).state;
record("M10 an existing APPROVED target yields ALREADY_CREATED and no POST", (() => {
  const st = preStateFor([{ name: TARGET_TEMPLATE_NAME, language: "en", status: "APPROVED", category: "UTILITY" }]);
  const d = decide({ flags: parseFlags(["--execute", OWNER_ACK_FLAG]), identity: validateIdentity(goodEnv()), payloadResult: loadCanonicalPayload(packet), preState: st });
  return st === PreState.ALREADY_CREATED && d.post === false && d.outcome === Outcome.ALREADY_CREATED;
})());
record("M10b an existing PENDING target yields ALREADY_CREATED and no POST", (() => {
  const st = preStateFor([{ name: TARGET_TEMPLATE_NAME, language: "en", status: "PENDING", category: "UTILITY" }]);
  const d = decide({ flags: parseFlags(["--execute", OWNER_ACK_FLAG]), identity: validateIdentity(goodEnv()), payloadResult: loadCanonicalPayload(packet), preState: st });
  return st === PreState.ALREADY_CREATED && d.post === false;
})());
record("M10c an existing REJECTED target hard stops with no POST", (() => {
  const st = preStateFor([{ name: TARGET_TEMPLATE_NAME, language: "en", status: "REJECTED", category: "UTILITY" }]);
  const d = decide({ flags: parseFlags(["--execute", OWNER_ACK_FLAG]), identity: validateIdentity(goodEnv()), payloadResult: loadCanonicalPayload(packet), preState: st });
  return st === PreState.PRESENT_OTHER_STATUS && d.post === false && d.outcome === Outcome.REFUSED;
})());
record("M10d a duplicate remote row is AMBIGUOUS and never posts", (() => {
  const rows = [{ name: TARGET_TEMPLATE_NAME, language: "en", status: "APPROVED" }, { name: TARGET_TEMPLATE_NAME, language: "en", status: "PENDING" }];
  const st = preStateFor(rows);
  const d = decide({ flags: parseFlags(["--execute", OWNER_ACK_FLAG]), identity: validateIdentity(goodEnv()), payloadResult: loadCanonicalPayload(packet), preState: st });
  return st === PreState.AMBIGUOUS && d.post === false;
})());
record("M10e an unreadable lookup never posts", (() => {
  const st = classifyPreState({ ok: false, status: 500, body: null }).state;
  const d = decide({ flags: parseFlags(["--execute", OWNER_ACK_FLAG]), identity: validateIdentity(goodEnv()), payloadResult: loadCanonicalPayload(packet), preState: st });
  return st === PreState.UNREADABLE && d.post === false;
})());

// ---------------------------------------------------------------------------
// 11-12: both flags are mandatory; there is no env-only bypass.
// ---------------------------------------------------------------------------
const wouldPost = (argv) => decide({
  flags: parseFlags(argv), identity: validateIdentity(goodEnv()),
  payloadResult: loadCanonicalPayload(packet), preState: PreState.ABSENT,
}).post;
record("M11 missing --execute does not post", wouldPost([OWNER_ACK_FLAG]) === false);
record("M12 missing the owner acknowledgement does not post", wouldPost(["--execute"]) === false);
record("M12b no flags at all does not post", wouldPost([]) === false);
record("M12c a near-miss acknowledgement flag does not post",
  wouldPost(["--execute", "--owner-authorized"]) === false);
record("M12d the operator declares no env-only bypass",
  evidence.execution_contract.env_only_bypass_permitted === false
  && !/process\.env\.[A-Z_]*(AUTHORIZ|CONFIRM|FORCE|YES)/.test(codeOnly));

// ---------------------------------------------------------------------------
// 13-14: one POST, ever — including after an ambiguous result.
// ---------------------------------------------------------------------------
const singlePostProof = await (async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, status: 200, json: async () => ({ id: "x" }) }; };
  const http = makeHttp({ version: "v26.0", wabaId: HISTORICAL.waba, token: "t", fetchImpl });
  await http.createOnce({ a: 1 });
  let threw = false;
  try { await http.createOnce({ a: 1 }); } catch { threw = true; }
  return { threw, calls, count: http.postCount() };
})();
record("M13 a second POST attempt throws and never reaches the network",
  singlePostProof.threw === true && singlePostProof.calls === 1 && singlePostProof.count === 1);
record("M14 an ambiguous create is not retried (no retry/loop construct around the POST)",
  !/for\s*\(|while\s*\(|\.retry|retries|attempt\s*<|catch\s*\{[^}]*createOnce/.test(
    codeOnly.slice(codeOnly.indexOf("const res = await http.createOnce"))));
record("M14b exactly one readback follows the single create, and create appears once", (() => {
  const at = codeOnly.indexOf("await http.createOnce(");
  const after = codeOnly.slice(at + 1);
  return at !== -1
    && (codeOnly.match(/await http\.createOnce\(/g) ?? []).length === 1
    && (after.match(/await http\.get\(/g) ?? []).length === 1;
})());

// ---------------------------------------------------------------------------
// 15-18: structural properties of the FILE.
// ---------------------------------------------------------------------------
/**
 * classifyCreateResponse returns { classification, error }. The first execution of this
 * operator printed "[object Object]" and mislabelled a clean SUCCESS as CREATE_AMBIGUOUS
 * because the object was compared instead of its field. The POST count was unaffected —
 * but an outcome label that cannot say "created" is not evidence, so pin the field access.
 */
record("M14c the create classification is read as a FIELD, not as the object",
  /const \{ classification \} = classifyCreateResponse\(/.test(codeOnly)
  && !/=\s*classifyCreateResponse\([^)]*\);\s*\n[^\n]*classification ===/.test(codeOnly));
record("M14d a 2xx create with id+known status classifies SUCCESS end-to-end", (() => {
  const { classification } = classifyCreateResponseLocal({ threw: false, httpStatus: 200, body: { id: "123", status: "PENDING", category: "UTILITY" } });
  return classification === "SUCCESS";
})());

record("M15 no generic template/wave selector exists",
  !/--template\b/.test(codeOnly) && !/--wave\b/.test(codeOnly)
  && /export const TARGET_TEMPLATE_NAME = "qf_vendor_onboarding_reminder_v1"/.test(codeOnly));
record("M15b the target name is pinned, not derived from argv",
  !/argv[^\n]*(template|name)/i.test(codeOnly));
record("M16 no messaging/send endpoint exists",
  !/\/messages/.test(codeOnly.replace(/message_templates/g, "")));
record("M17 no DELETE, PUT or PATCH method exists",
  !/method:\s*["'](DELETE|PUT|PATCH)["']/i.test(codeOnly));
record("M17b POST is the only mutating method named",
  (codeOnly.match(/method:\s*["'][A-Z]+["']/g) ?? []).every((m) => /POST/.test(m)));
record("M18 no provider, mapping, canary or DB authority is reachable",
  !/supabase|createClient|\.rpc\(|from\(["']|activate|arm_canary|provider_mappings|is_active\s*=/i.test(codeOnly));
record("M18b the operator never reads or writes submit_now", !/submit_now/.test(codeOnly));
record("M18c the bearer token is never printed",
  !/console\.log\([^)]*(TOKEN|ACCESS_TOKEN|Bearer\s*\$)/.test(codeOnly));

// ---------------------------------------------------------------------------
// 20: subscriber-set and live-asset mutations.
// ---------------------------------------------------------------------------
record("M20 an extra subscriber app is rejected", (() => {
  const a = goodAssets();
  a.subs = okGet({ data: [{ whatsapp_business_api_data: { id: HISTORICAL.app } }, { whatsapp_business_api_data: { id: "999999999999999" } }] });
  return classifyLiveAssets(a).ok === false;
})());
record("M20b a wrong single subscriber app is rejected", (() => {
  const a = goodAssets();
  a.subs = okGet({ data: [{ whatsapp_business_api_data: { id: "999999999999999" } }] });
  return classifyLiveAssets(a).faults.includes("subscriber_app_mismatch");
})());
record("M20c an empty subscriber set is rejected", (() => {
  const a = goodAssets(); a.subs = okGet({ data: [] });
  return classifyLiveAssets(a).faults.includes("subscriber_set_not_exactly_one");
})());
record("M20d a live WABA id mismatch is rejected", (() => {
  const a = goodAssets(); a.waba = okGet({ id: "27861262223494154" });
  return classifyLiveAssets(a).faults.includes("waba_identity_mismatch");
})());
record("M20e an unverified phone is rejected", (() => {
  const a = goodAssets();
  a.phones = okGet({ data: [{ id: HISTORICAL.phone, code_verification_status: "NOT_VERIFIED", quality_rating: "GREEN" }] });
  return classifyLiveAssets(a).faults.includes("phone_not_code_verified");
})());
record("M20f an extra phone on the WABA is rejected", (() => {
  const a = goodAssets();
  a.phones = okGet({ data: [{ id: HISTORICAL.phone, code_verification_status: "VERIFIED" }, { id: "1333595106493546", code_verification_status: "VERIFIED" }] });
  return classifyLiveAssets(a).faults.includes("phone_set_mismatch");
})());
record("M20g an unreadable asset response is rejected", (() => {
  const a = goodAssets(); a.waba = { ok: false, status: 401, body: null };
  return classifyLiveAssets(a).ok === false;
})());

// ---------------------------------------------------------------------------
// The global model must be provably UNTOUCHED by this phase.
// ---------------------------------------------------------------------------
record("G01 the packet entry is still HELD (submit_now false)", entryOf(packet).submit_now === false);
record("G02 the packet entry local_state is still APPROVED_UNMAPPED",
  entryOf(packet).local_state.submission_state === "APPROVED_UNMAPPED"
  && entryOf(packet).local_state.provider_template_id === null);
record("G03 CLOSED_KEYS still contains the target key",
  /"vendor_onboarding_reminder"/.test(readFileSync(resolve(PACKET_VALIDATOR), "utf8")));
record("G04 the packet still carries no waba_id key",
  !/"waba_id"/i.test(JSON.stringify(packet)));
record("G05 the evidence artifact commits no raw Meta asset id",
  !new RegExp(`${HISTORICAL.waba}|${HISTORICAL.app}|${HISTORICAL.phone}`).test(JSON.stringify(evidence)));
record("G06 the evidence artifact pins the same digests as the operator",
  evidence.staging_asset_identity.waba_id_sha256 === EXPECTED_IDENTITY_DIGESTS.wabaId
  && evidence.staging_asset_identity.app_id_sha256 === EXPECTED_IDENTITY_DIGESTS.appId
  && evidence.staging_asset_identity.phone_number_id_sha256 === EXPECTED_IDENTITY_DIGESTS.phoneNumberId);
record("G07 the evidence digests actually match the real staging ids",
  sha256Hex(HISTORICAL.waba) === evidence.staging_asset_identity.waba_id_sha256
  && sha256Hex(HISTORICAL.app) === evidence.staging_asset_identity.app_id_sha256
  && sha256Hex(HISTORICAL.phone) === evidence.staging_asset_identity.phone_number_id_sha256);
record("G08 the evidence artifact denies every downstream authority",
  evidence.owner_authorization.send_authority === "DENIED"
  && evidence.owner_authorization.mapping_authority === "DENIED"
  && evidence.owner_authorization.provider_authority === "DENIED"
  && evidence.owner_authorization.canary_authority === "DENIED"
  && evidence.owner_authorization.allowed_action === "FIRST_CREATE_ONLY");
record("G09 the evidence artifact pins max_post_count 1 and a permanent post-hold",
  evidence.execution_contract.max_post_count === 1
  && evidence.execution_contract.second_post_possible === false
  && evidence.execution_contract.retry_after_ambiguous_permitted === false
  && evidence.execution_contract.post_state_hold === "PERMANENT_NO_RECREATE_IF_REMOTE_PRESENT");
record("G10 the evidence artifact disclaims the WABA-unbound historical approval",
  evidence.historical_evidence_non_claim.historical_approval_was_waba_unbound === true
  && evidence.historical_evidence_non_claim.used_as_proof_for_this_waba === false);
record("G11 the evidence artifact records the global model as unchanged",
  evidence.relationship_to_global_model.global_packet_changed === false
  && evidence.relationship_to_global_model.closed_keys_changed === false
  && evidence.relationship_to_global_model.closed_state_model_changed === false);
record("G12 the evidence artifact and operator exist where the contract says",
  existsSync(resolve(OPERATOR)) && existsSync(resolve(EVIDENCE))
  && evidence.execution_contract.operator === OPERATOR);
record("G14 the spent authority is recorded as CLOSED with exactly one POST",
  evidence.execution_record.status === "EXECUTED_ONCE"
  && evidence.execution_record.post_attempt_count === 1
  && evidence.execution_record.second_post_issued === false
  && evidence.execution_record.creation_authority === "CLOSED"
  && evidence.execution_record.post_creation_hold === "IN_EFFECT");
record("G15 the execution record commits no raw remote template id",
  evidence.execution_record.remote_template_id_raw_committed === false
  && !/"remote_template_id"\s*:\s*"/.test(JSON.stringify(evidence))
  && /^[0-9a-f]{64}$/.test(evidence.execution_record.remote_template_id_sha256));
record("G16 the spent record still denies every downstream authority",
  evidence.execution_record.downstream_authority_unchanged.send_authority === "DENIED"
  && evidence.execution_record.downstream_authority_unchanged.mapping_authority === "DENIED"
  && evidence.execution_record.downstream_authority_unchanged.provider_authority === "DENIED"
  && evidence.execution_record.downstream_authority_unchanged.canary_authority === "DENIED");
record("G13 the pinned fingerprint equals the packet's committed fingerprint",
  entryOf(packet).payload_fingerprint === EXPECTED_PAYLOAD_FINGERPRINT
  && evidence.target.payload_fingerprint === EXPECTED_PAYLOAD_FINGERPRINT
  && createHash("sha256").update(JSON.stringify(entryOf(packet).creation_payload)).digest("hex") === EXPECTED_PAYLOAD_FINGERPRINT);

console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
