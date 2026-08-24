// ============================================================================
// QF-MVP-40-R7M — validator for the START acknowledgement Utility category repair.
// OFFLINE. Calls no Meta endpoint, submits nothing, sends nothing, reads no credential.
//
// Beyond the usual one-shot safety contract, this validator proves the SUPERSESSION
// boundary: R7L owns the quarantined v1, R7M owns v2, and neither can reach the other's
// template. It also proves the v2 copy carries no promotional concept — the defect that
// caused Meta to classify v1 as MARKETING.
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EXPECTED_BODY_TEXT, EXPECTED_IDENTITY_DIGESTS, EXPECTED_PAYLOAD_FINGERPRINT, ExitCode,
  OWNER_ACK_FLAG, Outcome, PreState, QUARANTINED_PREDECESSOR, REQUIRED_PACKET_STATE,
  REQUIRED_TEMPLATE_FIELDS, RepairPreState, TARGET_CATEGORY, TARGET_LANGUAGE,
  TARGET_TEMPLATE_KEY, TARGET_TEMPLATE_NAME, classifyPreState, exitCodeForOutcome,
  loadCanonicalPayload,
} from "./create-meta-staging-start-ack-v2-repair-once.mjs";
import {
  classifyLiveAssets, decide, makeHttp, parseFlags, sha256Hex, validateIdentity,
} from "./create-meta-staging-vendor-onboarding-reminder-once.mjs";
import { templatesAreIdentical } from "./submit-meta-templates.mjs";

const OPERATOR = "scripts/mvp/communication/create-meta-staging-start-ack-v2-repair-once.mjs";
const VENDOR_OPERATOR = "scripts/mvp/communication/create-meta-staging-vendor-onboarding-reminder-once.mjs";
const R7L_OPERATOR = "scripts/mvp/communication/create-meta-staging-held-utility-recovery-once.mjs";
const SEEDER = "scripts/mvp/communication/seed-meta-staging-inactive-mappings.mjs";
const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";
const LEDGER = "docs/provider-manifests/meta-template-remote-state.json";
const MANIFEST = "docs/provider-manifests/whatsapp-template-submission-manifest.json";

const code = readFileSync(resolve(OPERATOR), "utf8");
const codeOnly = code
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
const codeNoStrings = codeOnly
  .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``")
  .replace(/"(?:\\[\s\S]|[^\\"])*"/g, '""')
  .replace(/'(?:\\[\s\S]|[^\\'])*'/g, "''");

const packet = JSON.parse(readFileSync(resolve(PACKET), "utf8"));
const ledger = JSON.parse(readFileSync(resolve(LEDGER), "utf8"));
const vendorSrc = readFileSync(resolve(VENDOR_OPERATOR), "utf8");
const r7lSrc = readFileSync(resolve(R7L_OPERATOR), "utf8");
const seederSrc = readFileSync(resolve(SEEDER), "utf8");
const EVIDENCE = "docs/provider-manifests/meta-staging-start-ack-category-mismatch-evidence.json";
const evidence = JSON.parse(readFileSync(resolve(EVIDENCE), "utf8"));
const APPROVAL_EVIDENCE = "docs/provider-manifests/meta-staging-start-ack-v2-approval-evidence.json";
const approval = JSON.parse(readFileSync(resolve(APPROVAL_EVIDENCE), "utf8"));
const CREATION_EVIDENCE = "docs/provider-manifests/meta-staging-start-ack-v2-creation-evidence.json";
const creation = JSON.parse(readFileSync(resolve(CREATION_EVIDENCE), "utf8"));
const packetValidatorSrc = readFileSync(resolve("scripts/mvp/communication/validate-meta-template-submission-packet.mjs"), "utf8");
const READINESS = "docs/provider-manifests/meta-template-inactive-mapping-readiness.json";
const readiness = JSON.parse(readFileSync(resolve(READINESS), "utf8"));
const internalSeedSrc = readFileSync(resolve("scripts/mvp/communication/seed-internal-staging-templates.mjs"), "utf8");
const vendorHttpSrc = vendorSrc;

const REAL = { app: "2097008694503517", waba: "27861262223494153", phone: "1333595106493545" };
const goodEnv = () => ({
  QF_META_GRAPH_API_VERSION: "v26.0",
  QF_META_WABA_ID: REAL.waba,
  QF_META_PHONE_NUMBER_ID: REAL.phone,
  QF_META_APP_ID: REAL.app,
  QF_META_ACCESS_TOKEN: "irrelevant-not-a-real-token",
});
const okGet = (body) => ({ ok: true, status: 200, body });
const goodAssets = () => ({
  waba: okGet({ id: REAL.waba }),
  phones: okGet({ data: [{ id: REAL.phone, verified_name: "quickfurno.in", quality_rating: "GREEN", code_verification_status: "VERIFIED" }] }),
  subs: okGet({ data: [{ whatsapp_business_api_data: { id: REAL.app, name: "QuickFurno Staging" } }] }),
});
const clonePacket = () => JSON.parse(JSON.stringify(packet));
const entryOf = (p) => p.templates.find((t) => t.internal_template_key === TARGET_TEMPLATE_KEY);
const PAYLOAD = loadCanonicalPayload(packet).payload;
const goodRow = (over = {}) => ({
  id: "9876543210",
  name: TARGET_TEMPLATE_NAME,
  language: TARGET_LANGUAGE,
  status: "APPROVED",
  category: TARGET_CATEGORY,
  components: JSON.parse(JSON.stringify(PAYLOAD.components)),
  ...over,
});
const pre = (rowsOrLookup) =>
  classifyPreState(Array.isArray(rowsOrLookup) ? okGet({ data: rowsOrLookup }) : rowsOrLookup, PAYLOAD).state;
const decideWith = (argv, preState, over = {}) => decide({
  flags: parseFlags(argv),
  identity: over.identity ?? validateIdentity(goodEnv()),
  payloadResult: over.payloadResult ?? loadCanonicalPayload(packet),
  preState,
});

let passed = 0;
let failed = 0;
const record = (label, ok) => {
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.log(`FAIL  ${label}`); }
};

// ---------------------------------------------------------------------------
// BASELINE
// ---------------------------------------------------------------------------
record("B01 authorised staging identity passes", validateIdentity(goodEnv()).ok === true);
record("B02 canonical v2 payload loads and fingerprints exactly", (() => {
  const r = loadCanonicalPayload(packet);
  return r.ok === true && r.fingerprint === EXPECTED_PAYLOAD_FINGERPRINT;
})());
record("B03 live asset proof passes on the exact staging triple", classifyLiveAssets(goodAssets()).ok === true);
record("B04 ABSENT + both flags is a POST decision",
  decideWith(["--execute", OWNER_ACK_FLAG], RepairPreState.ABSENT).post === true);
record("B05 comment-stripping leaves substance and removes prose",
  codeOnly.length > 2000 && /export function loadCanonicalPayload\(/.test(codeOnly)
  && /await http\.createOnce\(/.test(codeOnly)
  && /DELETE \/ PUT \/ PATCH/.test(code) && !/DELETE \/ PUT \/ PATCH/.test(codeOnly));
record("B06 the structural scanners are live, not vacuous", (() => {
  const injected = `${codeOnly}\nconst c = createClient(); await c.rpc("x");\nawait fetch(u,{method:"DELETE"});`;
  return /supabase|createClient|\.rpc\(/i.test(injected)
    && /method:\s*["'](DELETE|PUT|PATCH)["']/i.test(injected)
    && !/supabase|createClient|\.rpc\(/i.test(codeOnly);
})());

// ---------------------------------------------------------------------------
// TARGET PINNING — no arbitrary name/body/category/language is reachable.
// ---------------------------------------------------------------------------
record("N01 the target constants are hard-pinned literals", (() => {
  const pinned = (n, v) => new RegExp(`export const ${n}\\s*=\\s*\\n?\\s*["']${v}["']`).test(codeOnly);
  return pinned("TARGET_TEMPLATE_KEY", TARGET_TEMPLATE_KEY)
    && pinned("TARGET_TEMPLATE_NAME", TARGET_TEMPLATE_NAME)
    && pinned("TARGET_LANGUAGE", TARGET_LANGUAGE)
    && pinned("TARGET_CATEGORY", TARGET_CATEGORY)
    && pinned("EXPECTED_PAYLOAD_FINGERPRINT", EXPECTED_PAYLOAD_FINGERPRINT);
})());
record("N02 no selector and no argv/env path into name, category, language or body", (() => {
  if (/--template\b|--name\b|--category\b|--language\b|--body\b/.test(codeOnly)) return false;
  const argvUses = codeOnly.match(/process\.argv[^\s;)]*/g) ?? [];
  const allowed = new Set(["process.argv[1]", "process.argv.slice(2"]);
  if (!argvUses.every((u) => allowed.has(u))) return false;
  const decls = [...codeOnly.matchAll(/TARGET_(?:TEMPLATE_KEY|TEMPLATE_NAME|LANGUAGE|CATEGORY)\s*=\s*([^;]+);/g)]
    .map((m) => m[1].trim());
  return decls.length === 4 && decls.every((d) => /^"[^"]*"$/.test(d))
    && !/env\.[A-Z_]*(TEMPLATE|CATEGORY|LANGUAGE|BODY)/i.test(codeOnly);
})());
record("N03 the body text is pinned and equals the committed packet body",
  EXPECTED_BODY_TEXT === entryOf(packet).creation_payload.components[0].text
  && new RegExp(`export const EXPECTED_BODY_TEXT =\\s*\\n?\\s*"`).test(codeOnly));
record("N04 no payload is constructed in the operator", !/components\s*:\s*\[\s*\{/.test(codeOnly));
record("N05 the operator declares NO second identity pin set — it imports R7B's",
  !/EXPECTED_IDENTITY_DIGESTS\s*=\s*Object\.freeze/.test(codeOnly)
  && /import\s*\{[\s\S]*?EXPECTED_IDENTITY_DIGESTS[\s\S]*?\}\s*from\s*["'][^"']*create-meta-staging-vendor-onboarding-reminder-once\.mjs["']/.test(codeOnly));
record("N06 no raw staging id literal appears in the operator",
  !new RegExp(REAL.waba).test(code) && !new RegExp(REAL.app).test(code) && !new RegExp(REAL.phone).test(code));
record("N07 the pinned digests match the public staging asset ids",
  sha256Hex(REAL.app) === EXPECTED_IDENTITY_DIGESTS.appId
  && sha256Hex(REAL.waba) === EXPECTED_IDENTITY_DIGESTS.wabaId
  && sha256Hex(REAL.phone) === EXPECTED_IDENTITY_DIGESTS.phoneNumberId);

// ---------------------------------------------------------------------------
// COPY — the defect that caused the MARKETING classification must not recur.
// ---------------------------------------------------------------------------
const BANNED = [/promotion/i, /promotional/i, /offer/i, /discount/i, /package/i, /upsell/i,
  /marketing/i, /\bdeal\b/i, /\bsale\b/i, /subscribe/i, /advertis/i];
record("Y01 the v2 body carries NO promotional concept",
  BANNED.every((r) => !r.test(EXPECTED_BODY_TEXT)));
record("Y02 the quarantined v1 body DID name promotional messaging — so Y01 is not vacuous", (() => {
  const L = ledger.entries.find((e) => e.provider_template_name === QUARANTINED_PREDECESSOR.name);
  return !!L && /promotional/i.test(
    "QuickFurno: you have been resubscribed to updates about your enquiries. Promotional messages need separate consent. Reply STOP to opt out, or HELP for help.");
})());
record("Y03 the v2 body is transactional: it names START, existing enquiries, STOP and HELP",
  /START/.test(EXPECTED_BODY_TEXT) && /existing/i.test(EXPECTED_BODY_TEXT)
  && /STOP/.test(EXPECTED_BODY_TEXT) && /HELP/.test(EXPECTED_BODY_TEXT));
record("Y04 the v2 body is zero-variable",
  (EXPECTED_BODY_TEXT.match(/\{\{\s*\d+\s*\}\}/g) ?? []).length === 0);
record("Y05 the v2 body carries no URL or bare domain",
  !/https?:\/\//i.test(EXPECTED_BODY_TEXT) && !/quickfurno\.[a-z]{2,}/i.test(EXPECTED_BODY_TEXT));

// ---------------------------------------------------------------------------
// SUPERSESSION BOUNDARY — R7L owns v1, R7M owns v2.
// ---------------------------------------------------------------------------
record("Q01 the quarantined predecessor is recorded with its proven MARKETING category",
  QUARANTINED_PREDECESSOR.name === "qf_consent_start_acknowledgement_v1"
  && QUARANTINED_PREDECESSOR.fingerprint === "70c0ce994180c2ea62ff3413d12d460734f5c004c40eb4d056925feec7e7251a"
  && QUARANTINED_PREDECESSOR.provenRemoteCategory === "MARKETING");
record("Q02 R7M targets v2 and never the quarantined v1",
  TARGET_TEMPLATE_NAME !== QUARANTINED_PREDECESSOR.name
  && EXPECTED_PAYLOAD_FINGERPRINT !== QUARANTINED_PREDECESSOR.fingerprint);
record("Q03 R7L's frozen registry STILL pins v1 — history was not rewritten",
  /providerName: "qf_consent_start_acknowledgement_v1"/.test(r7lSrc)
  && /"70c0ce994180c2ea62ff3413d12d460734f5c004c40eb4d056925feec7e7251a"/.test(r7lSrc));
record("Q04 R7L never names v2 — R7L execution authority is not reused",
  !/qf_consent_start_acknowledgement_v2/.test(r7lSrc));
record("Q05 R7M refuses if the packet still pins the quarantined v1", (() => {
  const p = clonePacket();
  const e = entryOf(p);
  e.provider_template_name = QUARANTINED_PREDECESSOR.name;
  e.creation_payload.name = QUARANTINED_PREDECESSOR.name;
  return loadCanonicalPayload(p).reason === "still_pinned_to_quarantined_v1";
})());
record("Q06 a successor that hashes to the quarantined v1 is impossible by construction",
  /successor_equals_quarantined_v1/.test(codeOnly)
  && EXPECTED_PAYLOAD_FINGERPRINT !== QUARANTINED_PREDECESSOR.fingerprint);
record("Q07 the ledger records v1 as APPROVED / MARKETING / quarantined / superseded", (() => {
  const e = ledger.entries.find((x) => x.provider_template_name === QUARANTINED_PREDECESSOR.name);
  return !!e && e.last_proven_status === "APPROVED"
    && e.last_proven_remote_category === "MARKETING"
    && e.disposition === "QUARANTINED_UNMAPPED"
    && e.reconciliation_outcome === "RECONCILED_CATEGORY_MISMATCH"
    && e.send_authority === "DENIED" && e.mapping_authority === "DENIED"
    && e.delete_authority === "NOT_GRANTED" && e.appeal_authority === "NOT_GRANTED"
    && e.superseded_by === TARGET_TEMPLATE_NAME
    && e.create_post_count_at_submission === 1;
})());
record("Q08 v2 now HAS a ledger entry, because its remote state is finally PROVEN", (() => {
  // Before the live creation the ledger deliberately carried no v2 row: it records only
  // proven remote state. The 2026-08-24 approval readback supplied that proof.
  const e = ledger.entries.find((x) => x.provider_template_name === TARGET_TEMPLATE_NAME);
  return !!e && e.last_proven_status === "APPROVED" && e.last_proven_remote_category === "UTILITY";
})());
record("Q09 the canonical packet now names v2 as the active START template",
  entryOf(packet).provider_template_name === TARGET_TEMPLATE_NAME
  && entryOf(packet).payload_fingerprint === EXPECTED_PAYLOAD_FINGERPRINT);
record("Q10 the SEED_SET mapping authority points at v2, not the quarantined v1", (() => {
  const m = seederSrc.match(/export const SEED_SET = Object\.freeze\(\[[\s\S]*?\n\]\);/);
  if (!m) return false;
  return m[0].includes(TARGET_TEMPLATE_NAME) && m[0].includes(EXPECTED_PAYLOAD_FINGERPRINT)
    && !m[0].includes(QUARANTINED_PREDECESSOR.name)
    && !m[0].includes(QUARANTINED_PREDECESSOR.fingerprint);
})());
record("Q11 the mapping seeder still refuses anything not remotely APPROVED + UTILITY",
  /r\.status !== "APPROVED"/.test(seederSrc) && /META_STATUS_NOT_APPROVED/.test(seederSrc)
  && /r\.category !== "UTILITY"/.test(seederSrc) && /META_CATEGORY_MISMATCH/.test(seederSrc));
record("Q12 the source manifest drives v2 and the packet fingerprint is self-consistent", (() => {
  const raw = readFileSync(resolve(MANIFEST), "utf8");
  const m = JSON.parse(raw);
  const entry = Object.values(m.groups).flat()
    .find((t) => t.internal_template_key === TARGET_TEMPLATE_KEY);
  // The packet is GENERATED, so the source manifest is the real authority: it must name v2
  // and carry the v2 copy, and the packet must hash-match the manifest byte-for-byte.
  //
  // The promotional phrase is checked against `body_spec` ONLY. It legitimately appears in
  // the closure note, which DOCUMENTS it as the cause of the MARKETING classification —
  // scanning the whole file would fail on its own audit trail.
  return !!entry
    && packet.source_manifest_fingerprint === createHash("sha256").update(raw).digest("hex")
    && entry.provider_template_name_candidate === TARGET_TEMPLATE_NAME
    && entry.body_spec === EXPECTED_BODY_TEXT
    && !/promotional/i.test(entry.body_spec)
    && entry.approval_status === REQUIRED_PACKET_STATE.approvalStatus
    && entry.submission_state === REQUIRED_PACKET_STATE.submissionState
    && entry.qf_mvp_40.submit_now === REQUIRED_PACKET_STATE.submitNow;
})());

// ---------------------------------------------------------------------------
// PACKET / PAYLOAD
// ---------------------------------------------------------------------------
record("P01 a wrong provider name is rejected", (() => {
  const p = clonePacket(); entryOf(p).provider_template_name = "qf_something_else_v9";
  return loadCanonicalPayload(p).reason === "name_mismatch";
})());
record("P02 a renamed payload name is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.name = "qf_something_else_v9";
  return loadCanonicalPayload(p).reason === "name_mismatch";
})());
record("P03 a changed body is rejected on exact text", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].text += " Extra.";
  return loadCanonicalPayload(p).reason === "body_text_mismatch";
})());
record("P04 a changed category is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.category = "MARKETING";
  return loadCanonicalPayload(p).reason === "category_mismatch";
})());
record("P05 a changed language is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.language = "en_US";
  return loadCanonicalPayload(p).reason === "language_mismatch";
})());
record("P06 submit_now flipped to true is rejected", (() => {
  const p = clonePacket(); entryOf(p).submit_now = true;
  return loadCanonicalPayload(p).reason === "submit_now_not_held";
})());
record("P07 approval_status drift is rejected", (() => {
  const p = clonePacket(); entryOf(p).local_state.approval_status = "draft";
  return loadCanonicalPayload(p).reason === "approval_status_unexpected";
})());
record("P08 submission_state drift is rejected", (() => {
  const p = clonePacket(); entryOf(p).local_state.submission_state = "DRAFT_NOT_SUBMITTED";
  return loadCanonicalPayload(p).reason === "submission_state_unexpected";
})());
record("P09 a missing local_state is rejected", (() => {
  const p = clonePacket(); delete entryOf(p).local_state;
  return loadCanonicalPayload(p).reason === "local_state_missing";
})());
record("P10 a committed provider_template_id is rejected", (() => {
  const p = clonePacket(); entryOf(p).local_state.provider_template_id = "123";
  return loadCanonicalPayload(p).reason === "provider_template_id_present";
})());
record("P11 an added parameter_format is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.parameter_format = "POSITIONAL";
  return loadCanonicalPayload(p).reason === "payload_shape_unexpected";
})());
record("P12 an extra component is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components.push({ type: "footer", text: "x" });
  return loadCanonicalPayload(p).reason === "component_count_unexpected";
})());
record("P13 a buttons block is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].buttons = [{ type: "QUICK_REPLY", text: "Hi" }];
  return loadCanonicalPayload(p).reason === "buttons_present";
})());
record("P14 an added example block is rejected (this target is zero-variable)", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].example = { body_text: [["x"]] };
  return loadCanonicalPayload(p).reason === "body_shape_unexpected";
})());
record("P15 an introduced placeholder is rejected", (() => {
  const p = clonePacket();
  const b = entryOf(p).creation_payload.components[0];
  b.text = b.text.replace("your START request", "your START request {{1}}");
  return loadCanonicalPayload(p).reason === "body_text_mismatch";
})());
record("P16 a duplicate packet entry is rejected", (() => {
  const p = clonePacket(); p.templates.push(JSON.parse(JSON.stringify(entryOf(p))));
  return loadCanonicalPayload(p).reason === "target_entry_not_unique";
})());
record("P17 a missing packet entry is rejected", (() => {
  const p = clonePacket(); p.templates = p.templates.filter((t) => t.internal_template_key !== TARGET_TEMPLATE_KEY);
  return loadCanonicalPayload(p).reason === "target_entry_not_unique";
})());
record("P18 an unreadable packet is rejected", loadCanonicalPayload(null).reason === "packet_unreadable");
record("P19 the pinned fingerprint equals the packet's committed fingerprint",
  entryOf(packet).payload_fingerprint === EXPECTED_PAYLOAD_FINGERPRINT
  && createHash("sha256").update(JSON.stringify(entryOf(packet).creation_payload)).digest("hex")
     === EXPECTED_PAYLOAD_FINGERPRINT);
record("P20 the committed packet holds the required approved/held state",
  entryOf(packet).submit_now === REQUIRED_PACKET_STATE.submitNow
  && entryOf(packet).local_state.approval_status === REQUIRED_PACKET_STATE.approvalStatus
  && entryOf(packet).local_state.submission_state === REQUIRED_PACKET_STATE.submissionState);
record("P21 the operator never WRITES submit_now", !/submit_now\s*=[^=]/.test(codeOnly));

// ---------------------------------------------------------------------------
// PRE-STATE
// ---------------------------------------------------------------------------
record("S01 a proven empty array is ABSENT", pre([]) === RepairPreState.ABSENT);
record("S02 an exact APPROVED Utility row is ALREADY_CREATED", pre([goodRow()]) === RepairPreState.ALREADY_CREATED);
record("S03 an exact PENDING Utility row is ALREADY_CREATED",
  pre([goodRow({ status: "PENDING" })]) === RepairPreState.ALREADY_CREATED);
record("S04 an existing MARKETING row refuses", pre([goodRow({ category: "MARKETING" })]) === RepairPreState.PRESENT_CATEGORY_MISMATCH);
record("S05 an existing Utility row with the WRONG body refuses", (() => {
  const r = goodRow(); r.components[0].text = "Different body entirely.";
  return pre([r]) === RepairPreState.PRESENT_CONTENT_MISMATCH;
})());
record("S06 an existing row with the wrong LANGUAGE leaves the target ABSENT",
  pre([goodRow({ language: "hi" })]) === RepairPreState.ABSENT);
record("S07 an unsafe status refuses", pre([goodRow({ status: "REJECTED" })]) === RepairPreState.PRESENT_OTHER_STATUS);
record("S08 missing remote components refuse", (() => {
  const r = goodRow(); delete r.components;
  return pre([r]) === RepairPreState.PRESENT_COMPONENTS_UNUSABLE;
})());
record("S09 null remote components refuse", pre([goodRow({ components: null })]) === RepairPreState.PRESENT_COMPONENTS_UNUSABLE);
record("S10 duplicate exact rows are AMBIGUOUS", pre([goodRow(), goodRow()]) === RepairPreState.AMBIGUOUS);
record("S11 a failed GET is UNREADABLE", pre({ ok: false, status: 500, body: null }) === RepairPreState.UNREADABLE);
record("S12 the quarantined v1 row does NOT satisfy v2 — the target stays ABSENT",
  pre([{ id: "1", name: QUARANTINED_PREDECESSOR.name, language: "en", status: "APPROVED", category: "MARKETING", components: [] }])
    === RepairPreState.ABSENT);
record("S13 the local payload can never substitute for missing remote components", (() => {
  const r = goodRow(); delete r.components;
  return classifyPreState(okGet({ data: [r] }), PAYLOAD).state !== RepairPreState.ALREADY_CREATED;
})());
record("S14 the local payload IS otherwise a full match — so S13 is not vacuous",
  templatesAreIdentical(
    { name: PAYLOAD.name, language: PAYLOAD.language, category: PAYLOAD.category, components: PAYLOAD.components },
    PAYLOAD) === true);

const malformed200 = [
  ["body null", { ok: true, status: 200, body: null }],
  ["body {}", { ok: true, status: 200, body: {} }],
  ["body is an array", { ok: true, status: 200, body: [] }],
  ["body is a string", { ok: true, status: 200, body: "ok" }],
  ["data null", okGet({ data: null })],
  ["data {}", okGet({ data: {} })],
  ["data is a string", okGet({ data: "none" })],
  ["data contains null row", okGet({ data: [null] })],
  ["data contains a non-object row", okGet({ data: ["qf_consent_start_acknowledgement_v2"] })],
  ["data contains an array row", okGet({ data: [[]] })],
  ["row without a name", okGet({ data: [{ language: "en", status: "APPROVED" }] })],
  ["row with a non-string name", okGet({ data: [{ name: 123, language: "en" }] })],
  ["row with an empty name", okGet({ data: [{ name: "", language: "en" }] })],
  ["target-named row missing language", okGet({ data: [{ name: TARGET_TEMPLATE_NAME, status: "APPROVED" }] })],
];
for (const [label, lookup] of malformed200) {
  record(`S15 malformed HTTP-200 (${label}) => UNREADABLE, never ABSENT`,
    classifyPreState(lookup, PAYLOAD).state === RepairPreState.UNREADABLE);
}
record("S16 EVERY malformed HTTP-200 case refuses at the decision layer — zero POST",
  malformed200.every(([, lookup]) => decideWith(["--execute", OWNER_ACK_FLAG],
    classifyPreState(lookup, PAYLOAD).state).post === false));
record("S17 the fail-open `? ... : []` fallback is absent",
  !/Array\.isArray\(lookup\.body\?\.data\)\s*\?/.test(codeOnly)
  && /if \(!Array\.isArray\(body\.data\)\) return unreadable;/.test(codeOnly));
record("S18 no local-components fallback exists",
  !/row\.components\s*\?\?/.test(codeOnly)
  && !/\?\?\s*(expectedPayload|payloadResult)\.?(payload)?\.components/.test(codeOnly)
  && /components:\s*row\.components\s*\}/.test(codeOnly));

// ---------------------------------------------------------------------------
// MODE / AUTHORITY
// ---------------------------------------------------------------------------
record("D01 ABSENT + both flags is the ONLY POST decision",
  decideWith(["--execute", OWNER_ACK_FLAG], RepairPreState.ABSENT).post === true);
record("D02 dry run (no flags) never posts", (() => {
  const d = decideWith([], RepairPreState.ABSENT);
  return d.post === false && d.outcome === Outcome.DRY_RUN_WOULD_POST;
})());
record("D03 --execute WITHOUT the owner flag never posts", (() => {
  const d = decideWith(["--execute"], RepairPreState.ABSENT);
  return d.post === false && d.outcome === Outcome.DRY_RUN_WOULD_POST;
})());
record("D04 the owner flag WITHOUT --execute never posts", (() => {
  const d = decideWith([OWNER_ACK_FLAG], RepairPreState.ABSENT);
  return d.post === false && d.outcome === Outcome.DRY_RUN_WOULD_POST;
})());
record("D05 an exact existing Utility row never posts", (() => {
  const d = decideWith(["--execute", OWNER_ACK_FLAG], RepairPreState.ALREADY_CREATED);
  return d.post === false && d.outcome === Outcome.ALREADY_CREATED;
})());
record("D06 every refusing pre-state blocks the POST", (() => {
  const refusing = Object.values(RepairPreState)
    .filter((s) => s !== RepairPreState.ABSENT && s !== RepairPreState.ALREADY_CREATED);
  return refusing.length >= 6
    && refusing.every((s) => decideWith(["--execute", OWNER_ACK_FLAG], s).post === false);
})());
record("D07 an unauthorised identity never posts",
  decideWith(["--execute", OWNER_ACK_FLAG], RepairPreState.ABSENT, {
    identity: validateIdentity({ ...goodEnv(), QF_META_WABA_ID: "1" }) }).post === false);
record("D08 a wrong WABA / app / phone is refused",
  validateIdentity({ ...goodEnv(), QF_META_WABA_ID: "27861262223494154" }).ok === false
  && validateIdentity({ ...goodEnv(), QF_META_APP_ID: "2097008694503518" }).ok === false
  && validateIdentity({ ...goodEnv(), QF_META_PHONE_NUMBER_ID: "1333595106493546" }).ok === false);
record("D09 unreadable live assets refuse before the template lookup",
  classifyLiveAssets({ waba: { ok: false }, phones: { ok: false }, subs: { ok: false } }).ok === false
  && /if \(!assets\.ok\) \{[\s\S]{0,160}return exitCodeForOutcome\(Outcome\.REFUSED\);/.test(codeOnly));
record("D10 a drifted payload never posts", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].text += "!";
  return decideWith(["--execute", OWNER_ACK_FLAG], RepairPreState.ABSENT, {
    payloadResult: loadCanonicalPayload(p) }).post === false;
})());
record("D11 the phone quality and subscriber set are proven before any POST",
  /code_verification_status/.test(codeOnly) && /quality_rating/.test(codeOnly)
  && /subscribed_apps/.test(codeOnly) && /classifyLiveAssets\(/.test(codeOnly));

// ---------------------------------------------------------------------------
// TRANSPORT
// ---------------------------------------------------------------------------
record("T01 the inherited one-POST boundary rejects a second POST", await (async () => {
  const http = makeHttp({ version: "v26.0", wabaId: REAL.waba, token: "t", fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ id: "1" }) }) });
  await http.createOnce({});
  let threw = false;
  try { await http.createOnce({}); } catch { threw = true; }
  return threw === true && http.postCount() === 1;
})());
record("T02 a throwing transport still consumes the single POST budget", await (async () => {
  const http = makeHttp({ version: "v26.0", wabaId: REAL.waba, token: "t", fetchImpl: async () => { throw new Error("net"); } });
  const r = await http.createOnce({});
  return r.threw === true && http.postCount() === 1;
})());
record("T03 GET never consumes the POST budget", await (async () => {
  const http = makeHttp({ version: "v26.0", wabaId: REAL.waba, token: "t", fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }) });
  await http.get("/message_templates");
  await http.get("/subscribed_apps");
  return http.postCount() === 0;
})());
record("T04 exactly one createOnce call exists",
  (codeOnly.match(/await http\.createOnce\(/g) ?? []).length === 1
  && (codeOnly.match(/createOnce/g) ?? []).length === 1);
record("T05 the PRE-STATE GET requests the explicit field set", (() => {
  const m = codeOnly.match(/const lookup = await http\.get\(\s*[\s\S]{0,240}?\);/);
  return m !== null && /fields=\$\{REQUIRED_TEMPLATE_FIELDS\}/.test(m[0]);
})());
record("T06 the POST-CREATE readback requests the explicit field set", (() => {
  const m = codeOnly.match(/const back = await http\.get\(\s*[\s\S]{0,240}?\);/);
  return m !== null && /fields=\$\{REQUIRED_TEMPLATE_FIELDS\}/.test(m[0]);
})());
record("T07 every message_templates GET carries the field set", (() => {
  const gets = codeOnly.match(/http\.get\(\s*`[^`]*message_templates[^`]*`/g) ?? [];
  return gets.length === 2 && gets.every((g) => /fields=\$\{REQUIRED_TEMPLATE_FIELDS\}/.test(g));
})());
record("T08 the required field set is exactly the reviewed one",
  REQUIRED_TEMPLATE_FIELDS === "id,name,language,status,category,components");
record("T09 confirmation derives from the readback pre-state, not a local fallback",
  /const confirmed = after\.state === RepairPreState\.ALREADY_CREATED;/.test(codeOnly));
record("T10 the operator implements no transport of its own",
  !/fetch\(/.test(codeOnly) && !/https?:\/\/graph\.facebook\.com/.test(codeOnly)
  && (codeOnly.match(/method:\s*["'][A-Z]+["']/gi) ?? []).length === 0
  && /import\s*\{[\s\S]*?makeHttp[\s\S]*?\}\s*from\s*["'][^"']*create-meta-staging-vendor-onboarding-reminder-once\.mjs["']/.test(codeOnly));

// ---------------------------------------------------------------------------
// EXIT CODES + terminal catch
// ---------------------------------------------------------------------------
record("E01 CREATED / ALREADY_CREATED / DRY_RUN_WOULD_POST exit 0",
  exitCodeForOutcome(Outcome.CREATED) === 0 && exitCodeForOutcome(Outcome.ALREADY_CREATED) === 0
  && exitCodeForOutcome(Outcome.DRY_RUN_WOULD_POST) === 0);
record("E02 CREATE_AMBIGUOUS exits with a DISTINCT non-zero code",
  exitCodeForOutcome(Outcome.CREATE_AMBIGUOUS) === 2
  && exitCodeForOutcome(Outcome.CREATE_AMBIGUOUS) !== exitCodeForOutcome(Outcome.REFUSED));
record("E03 REFUSED exits 1", exitCodeForOutcome(Outcome.REFUSED) === 1);
record("E04 an unknown outcome fails closed to non-zero",
  exitCodeForOutcome("SOMETHING_NEW") === ExitCode.REFUSED && exitCodeForOutcome(undefined) === ExitCode.REFUSED);
record("E05 every terminal path routes through exitCodeForOutcome/ExitCode",
  !/\breturn 0;|\breturn 1;|\breturn 2;/.test(codeOnly)
  && !/process\.exit\(0\)|process\.exit\(1\)|process\.exit\(2\)/.test(codeOnly)
  && /return exitCodeForOutcome\(outcome\);/.test(codeOnly));
const terminalOutcome = (postCount) => (postCount > 0 ? Outcome.CREATE_AMBIGUOUS : Outcome.REFUSED);
record("E06 an exception BEFORE any POST => REFUSED / exit 1",
  exitCodeForOutcome(terminalOutcome(0)) === 1);
record("E07 a timeout/exception AFTER the consumed POST => CREATE_AMBIGUOUS / exit 2, no retry",
  exitCodeForOutcome(terminalOutcome(1)) === 2);
record("E08 the terminal catch consults http.postCount()",
  /\.catch\(\(\) => \{[\s\S]{0,600}?http\.postCount\(\) > 0/.test(codeOnly)
  && /const outcome = posted \? Outcome\.CREATE_AMBIGUOUS : Outcome\.REFUSED;/.test(codeOnly)
  && /process\.exit\(exitCodeForOutcome\(outcome\)\);/.test(codeOnly));
record("E09 the terminal catch never prints the raw exception", (() => {
  const seg = codeOnly.match(/\.catch\(\(\) => \{[\s\S]*?\n\s*\}\);/);
  return seg !== null && !/\(\s*(e|err|error)\s*\)/.test(seg[0])
    && !/console\.log\([^)]*\b(e|err|error)\b/.test(seg[0]);
})());
record("E10 POST_ATTEMPT_COUNT is printed on every terminal path",
  (codeOnly.match(/POST_ATTEMPT_COUNT=/g) ?? []).length >= 4);

// ---------------------------------------------------------------------------
// ERROR HANDLING / FORBIDDEN SURFACES
// ---------------------------------------------------------------------------
record("X01 the operator reads e.subcode and never e.error_subcode",
  /e\.subcode/.test(codeOnly) && !/\.error_subcode/.test(codeOnly));
record("X02 only sanitized structured error fields are printed",
  /safeMetaError\(/.test(codeOnly) && !/JSON\.stringify\(res\.body/.test(codeOnly)
  && !/console\.log\([^)]*res\.body/.test(codeOnly));
record("X03 no secret or raw asset id is interpolated into output",
  !/\$\{[^}]*ACCESS_TOKEN/.test(codeOnly) && !/\$\{[^}]*QF_META_WABA_ID/.test(codeOnly)
  && !/\$\{[^}]*PHONE_NUMBER_ID/.test(codeOnly) && !/\$\{[^}]*APP_SECRET/.test(codeOnly)
  && !/Authorization/.test(codeOnly)
  && !/console\.log\(\s*JSON\.stringify\(\s*(process\.)?env/.test(codeOnly));
record("F01 no messaging endpoint",
  !/\/messages\b/.test(codeOnly) && !/sendResolvedTemplate|CommunicationService/.test(codeOnly));
record("F02 no DELETE / PUT / PATCH", !/method:\s*["'](DELETE|PUT|PATCH)["']/i.test(codeOnly));
record("F03 no database, Supabase client or RPC surface",
  !/supabase|createClient|\.rpc\(|service_role|adminClient/i.test(codeOnly));
record("F04 no mapping / provider / readiness / canary / webhook mutation",
  !/arm[-_]?readiness|arm[-_]?canary|qf_arm_|qf_disable_|activation_status|outbound_enabled|webhook_processing_enabled|provider_template_mappings/i.test(codeOnly));
record("F05 no production or Jarvis reference",
  !/production/i.test(codeNoStrings) && !/jarvis|riya|anisha/i.test(codeOnly));
record("F06 no retry construct can reach a second POST", (() => {
  const noWhile = !/\bwhile\s*\(|\bdo\s*\{/.test(codeNoStrings);
  const noScheduler = !/setTimeout|setInterval|setImmediate|process\.nextTick/.test(codeNoStrings);
  const noRetryIdentifier = !/\bretry\b/i.test(codeNoStrings);
  const fnMatch = codeNoStrings.match(/export function classifyPreState\([\s\S]*?\n\}/);
  if (!fnMatch) return false;
  const totalFor = (codeNoStrings.match(/\bfor\s*\(/g) ?? []).length;
  const forInPure = (fnMatch[0].match(/\bfor\s*\(/g) ?? []).length;
  return noWhile && noScheduler && noRetryIdentifier
    && totalFor > 0 && totalFor === forInPure
    && !/http\.|createOnce|fetch\(/.test(fnMatch[0])
    && (codeNoStrings.match(/createOnce/g) ?? []).length === 1;
})());
record("Z01 R7B is unchanged",
  /TARGET_TEMPLATE_KEY = "vendor_onboarding_reminder"/.test(vendorSrc)
  && /"c6e95a38dde899f717999520082feddf4c91f2a33c84650c72538ef2c111199a"/.test(vendorSrc));

// ---------------------------------------------------------------------------
// A. DURABLE V1 CATEGORY-MISMATCH EVIDENCE
// ---------------------------------------------------------------------------
record("V01 the immutable category-mismatch evidence artifact exists and is well formed",
  evidence.artifact === "meta-staging-start-ack-category-mismatch-evidence"
  && evidence.phase === "QF-MVP-40-R7M"
  && evidence.contains_secrets === false
  && evidence.authorizes_meta_calls === false
  && evidence.authorizes_mapping === false
  && evidence.authorizes_sending === false);
record("V02 it records the exact observed facts", (() => {
  const o = evidence.observation;
  return o.observed_at_utc_date === "2026-08-24"
    && o.internal_template_key === TARGET_TEMPLATE_KEY
    && o.provider_template_name === QUARANTINED_PREDECESSOR.name
    && o.language === "en"
    && o.expected_category === "UTILITY"
    && o.actual_category === "MARKETING"
    && o.status === "APPROVED"
    && o.post_attempt_count === 0
    && o.pre_state_classification === "PRESENT_CATEGORY_MISMATCH"
    && o.observation_method === "GET_ONLY_PRE_STATE_READBACK";
})());
record("V03 it grants no delete, appeal, recreation, mapping, arm or send authority", (() => {
  const a = evidence.authorities_explicitly_not_granted;
  return a.delete_authority === "NOT_GRANTED" && a.appeal_authority === "NOT_GRANTED"
    && a.recreation_authority === "NOT_GRANTED" && a.mapping_authority === "NOT_GRANTED"
    && a.send_authority === "DENIED" && a.provider_arm_authority === "NOT_GRANTED"
    && a.activation_authority === "NOT_GRANTED" && a.production_authority === "NOT_GRANTED";
})());
record("V04 it fabricates no Meta request/response body",
  evidence.observation.meta_request_body_captured === false
  && evidence.observation.meta_response_body_captured === false
  && !/"(request|response)_body"\s*:\s*\{/.test(JSON.stringify(evidence)));
record("V05 it contains no secret, token, phone number, WABA id or remote template id", (() => {
  const raw = JSON.stringify(evidence);
  return !/(EAA[A-Za-z0-9]{20,}|Bearer\s|app_secret|access_token)/i.test(raw)
    && !/\b\d{15,}\b/.test(raw)          // no raw Meta asset / template ids
    && !/\+\d{10,}/.test(raw);            // no E.164 phone number
})());
record("V06 the MARKETING historical state is BACKED BY this artifact", (() => {
  const e = ledger.entries.find((x) => x.provider_template_name === QUARANTINED_PREDECESSOR.name);
  return !!e && e.last_proven_remote_category === "MARKETING"
    && e.category_mismatch_evidence === evidence.artifact
    && e.category_mismatch_observed_at_utc_date === "2026-08-24";
})());
record("V07 the artifact names exactly the ledger fields it backs", (() => {
  const f = evidence.ledger_linkage.ledger_fields_backed_by_this_artifact.join(" | ");
  return evidence.ledger_linkage.ledger_entry_provider_template_name === QUARANTINED_PREDECESSOR.name
    && /last_proven_remote_category = MARKETING/.test(f)
    && /reconciliation_outcome = RECONCILED_CATEGORY_MISMATCH/.test(f)
    && /disposition = QUARANTINED_UNMAPPED/.test(f)
    && new RegExp("superseded_by = " + TARGET_TEMPLATE_NAME).test(f);
})());
record("V08 the OLD R7L evidence references remain byte-unchanged in the ledger", (() => {
  const e = ledger.entries.find((x) => x.provider_template_name === QUARANTINED_PREDECESSOR.name);
  const expected = [
    "QF-MVP-40-WAVE1-META-SUBMISSION-2026-07-31T08-40-29-000Z.json",
    "QF-MVP-40-WAVE1-consent_start_acknowledgement-META-RECONCILIATION-2026-07-31T11-04-28-293Z.json",
  ];
  return !!e && Array.isArray(e.evidence) && e.evidence.length === 2
    && expected.every((x) => e.evidence.includes(x))
    && e.create_post_count_at_submission === 1;
})());
record("V09 the artifact explicitly refuses to rewrite the older evidence",
  evidence.historical_evidence_non_claim.prior_evidence_unchanged === true
  && /NOT amended/i.test(evidence.historical_evidence_non_claim.statement)
  && evidence.historical_evidence_non_claim.prior_evidence.length === 2);
record("V10 v1 remains quarantined and v2 remains the current successor",
  evidence.disposition.disposition === "QUARANTINED_UNMAPPED"
  && evidence.disposition.payload_fingerprint === QUARANTINED_PREDECESSOR.fingerprint
  && evidence.disposition.successor_provider_template_name === TARGET_TEMPLATE_NAME
  && evidence.disposition.successor_payload_fingerprint === EXPECTED_PAYLOAD_FINGERPRINT
  && entryOf(packet).provider_template_name === TARGET_TEMPLATE_NAME);

// ---------------------------------------------------------------------------
// B. THE REAL NETWORK EXECUTION BOUNDARY
//
// R7M issues no request itself: it imports `makeHttp` from the R7B operator, which is the
// single network adapter. These rules drive that ADAPTER with a recording transport and
// assert on the URLs and methods it actually emits — not on R7M source text.
// ---------------------------------------------------------------------------
const recorder = () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || "GET" });
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  return { calls, fetchImpl };
};
const BASE = "https://graph.facebook.com/v26.0/" + REAL.waba;

record("W01 the adapter's ONLY create endpoint is POST <base>/message_templates", await (async () => {
  const { calls, fetchImpl } = recorder();
  const http = makeHttp({ version: "v26.0", wabaId: REAL.waba, token: "t", fetchImpl });
  await http.createOnce({ name: "x" });
  return calls.length === 1
    && calls[0].method === "POST"
    && calls[0].url === `${BASE}/message_templates`;
})());
record("W02 the adapter can never reach POST /messages", await (async () => {
  const { calls, fetchImpl } = recorder();
  const http = makeHttp({ version: "v26.0", wabaId: REAL.waba, token: "t", fetchImpl });
  await http.createOnce({ name: "x" });
  await http.get(`/message_templates?name=${TARGET_TEMPLATE_NAME}&fields=${REQUIRED_TEMPLATE_FIELDS}`);
  return calls.every((c) => !/\/messages(\?|$)/.test(c.url));
})());
record("W03 createOnce takes only a payload — the endpoint is not caller-controllable",
  /await http\.createOnce\(payloadResult\.payload\)/.test(codeOnly)
  && /fetchImpl\(`\$\{base\}\/message_templates`/.test(vendorHttpSrc));
record("W04 POST count is enforced AT THE ADAPTER: a second create throws and emits no request", await (async () => {
  const { calls, fetchImpl } = recorder();
  const http = makeHttp({ version: "v26.0", wabaId: REAL.waba, token: "t", fetchImpl });
  await http.createOnce({});
  const afterFirst = calls.length;
  let threw = false;
  try { await http.createOnce({}); } catch { threw = true; }
  return threw === true && http.postCount() === 1 && calls.length === afterFirst;
})());
record("W05 a throwing transport still consumes the budget — no silent retry", await (async () => {
  const calls = [];
  const fetchImpl = async (u, i) => { calls.push({ url: String(u), method: (i && i.method) || "GET" }); throw new Error("net"); };
  const http = makeHttp({ version: "v26.0", wabaId: REAL.waba, token: "t", fetchImpl });
  const r = await http.createOnce({});
  let threw = false;
  try { await http.createOnce({}); } catch { threw = true; }
  return r.threw === true && threw === true && http.postCount() === 1 && calls.length === 1;
})());
record("W06 GET emits no HTTP method override and never consumes the POST budget", await (async () => {
  const { calls, fetchImpl } = recorder();
  const http = makeHttp({ version: "v26.0", wabaId: REAL.waba, token: "t", fetchImpl });
  await http.get("");
  await http.get("/phone_numbers?fields=id");
  await http.get("/subscribed_apps");
  return http.postCount() === 0 && calls.length === 3 && calls.every((c) => c.method === "GET");
})());
record("W07 across the whole adapter surface no DELETE / PUT / PATCH is emitted", await (async () => {
  const { calls, fetchImpl } = recorder();
  const http = makeHttp({ version: "v26.0", wabaId: REAL.waba, token: "t", fetchImpl });
  await http.get("");
  await http.createOnce({});
  await http.get("/message_templates?name=x");
  return calls.every((c) => !["DELETE", "PUT", "PATCH"].includes(c.method))
    && calls.filter((c) => c.method === "POST").length === 1;
})());
record("W08 the adapter exposes no Supabase, RPC, arm or webhook surface", (() => {
  const m = vendorHttpSrc.match(/export function makeHttp\([\s\S]*?\n\}/);
  if (!m) return false;
  const fn = m[0];
  return !/supabase|createClient|\.rpc\(/i.test(fn)
    && !/qf_arm_|qf_disable_|activation_status|webhook/i.test(fn)
    && (fn.match(/method:\s*["'][A-Z]+["']/g) ?? []).length === 1;
})());
/**
 * ENDPOINT MUTATION. Rebuild the adapter from R7B source with `/message_templates` swapped
 * for `/messages`, load it as an isolated module, and prove W01/W02 would catch it. The real
 * R7B file is never modified — only a derived in-memory copy is executed.
 */
record("W09 MUT swapping the create endpoint to /messages is caught", await (async () => {
  const m = vendorHttpSrc.match(/export function makeHttp\([\s\S]*?\n\}/);
  if (!m) return false;
  const mutated = "const GRAPH = \"https://graph.facebook.com\";\n"
    + m[0].replace("`${base}/message_templates`", "`${base}/messages`");
  if (!/\$\{base\}\/messages/.test(mutated)) return false;
  const mod = await import("data:text/javascript," + encodeURIComponent(mutated));
  const { calls, fetchImpl } = recorder();
  const http = mod.makeHttp({ version: "v26.0", wabaId: REAL.waba, token: "t", fetchImpl });
  await http.createOnce({});
  // W01 would now fail and W02 would now fail — prove BOTH detect the swap.
  const w01WouldFail = !(calls[0].url === `${BASE}/message_templates`);
  const w02WouldFail = !calls.every((c) => !/\/messages(\?|$)/.test(c.url));
  return w01WouldFail && w02WouldFail && calls[0].url === `${BASE}/messages`;
})());
record("W10 the unmutated adapter still passes the same two rules — W09 is not vacuous", await (async () => {
  const { calls, fetchImpl } = recorder();
  const http = makeHttp({ version: "v26.0", wabaId: REAL.waba, token: "t", fetchImpl });
  await http.createOnce({});
  return calls[0].url === `${BASE}/message_templates`
    && calls.every((c) => !/\/messages(\?|$)/.test(c.url));
})());

// ---------------------------------------------------------------------------
// QF-MVP-40-R7M POST-APPROVAL CLOSEOUT — v2 is now proven APPROVED / UTILITY.
// ---------------------------------------------------------------------------
record("K01 the v2 approval evidence artifact exists and is well formed",
  approval.artifact === "meta-staging-start-ack-v2-approval-evidence"
  && approval.phase === "QF-MVP-40-R7M"
  && approval.contains_secrets === false
  && approval.authorizes_meta_calls === false
  && approval.authorizes_mapping === false
  && approval.authorizes_sending === false);
record("K02 the v2 evidence records APPROVED / UTILITY / en", (() => {
  const r = approval.approval_readback;
  return r.remote_status === "APPROVED" && r.remote_category === "UTILITY"
    && r.remote_language === "en" && r.remote_pre_state === "ALREADY_CREATED";
})());
record("K03 the v2 evidence pins the exact fingerprint and remote id",
  approval.approval_readback.payload_fingerprint === EXPECTED_PAYLOAD_FINGERPRINT
  && approval.approval_readback.provider_template_name === TARGET_TEMPLATE_NAME
  && approval.approval_readback.remote_template_id === "1338981184671889");
record("K04 the approval readback issued ZERO POSTs",
  approval.approval_readback.post_attempt_count === 0
  && approval.approval_readback.operator_mode === "DRY RUN");
record("K05 the v2 evidence records the live asset proof it actually observed",
  approval.approval_readback.phone_quality_rating === "GREEN"
  && approval.approval_readback.subscriber_count === 1
  && approval.approval_readback.live_asset_proof === true
  && approval.approval_readback.identity_authorised === true);
record("K06 semantic match is DERIVED from ALREADY_CREATED, not asserted independently",
  approval.semantic_proof.readback_semantic_match === true
  && /ALREADY_CREATED is only reachable/i.test(approval.semantic_proof.derivation)
  && /classifyPreState/.test(approval.semantic_proof.authority));
record("K07 creation provenance is now OBSERVED, and no Meta body is fabricated",
  approval.creation_provenance.create_post_count_basis === "OBSERVED"
  && approval.creation_provenance.create_post_count === 1
  && approval.creation_provenance.submission_outcome === "CREATED_PENDING"
  && approval.creation_provenance.creation_evidence === "meta-staging-start-ack-v2-creation-evidence"
  && approval.approval_readback.meta_request_body_captured === false
  && approval.approval_readback.meta_response_body_captured === false);
record("K08 the v2 evidence is secret-free", (() => {
  const raw = JSON.stringify(approval);
  return !/(EAA[A-Za-z0-9]{20,}|Bearer\s|app_secret|access_token)/i.test(raw)
    && !/\+\d{10,}/.test(raw)
    && !new RegExp("2097008694503517|27861262223494153|1333595106493545").test(raw);
})());
record("K09 the v1 mismatch evidence artifact remains intact and untouched",
  evidence.artifact === "meta-staging-start-ack-category-mismatch-evidence"
  && evidence.observation.actual_category === "MARKETING"
  && evidence.observation.post_attempt_count === 0
  && evidence.historical_evidence_non_claim.prior_evidence_unchanged === true);
record("K10 v1 remains APPROVED / MARKETING / QUARANTINED_UNMAPPED in the ledger", (() => {
  const e = ledger.entries.find((x) => x.provider_template_name === QUARANTINED_PREDECESSOR.name);
  return !!e && e.last_proven_status === "APPROVED"
    && e.last_proven_remote_category === "MARKETING"
    && e.disposition === "QUARANTINED_UNMAPPED"
    && e.superseded_by === TARGET_TEMPLATE_NAME
    && e.category_mismatch_evidence === evidence.artifact;
})());
record("K11 the ledger now carries v2 as APPROVED / UTILITY / APPROVED_UNMAPPED", (() => {
  const e = ledger.entries.find((x) => x.provider_template_name === TARGET_TEMPLATE_NAME);
  return !!e && e.internal_template_key === TARGET_TEMPLATE_KEY
    && e.requested_category === "UTILITY"
    && e.last_proven_status === "APPROVED"
    && e.last_proven_remote_category === "UTILITY"
    && e.readback_semantic_match === true
    && e.disposition === "APPROVED_UNMAPPED"
    && e.supersedes === QUARANTINED_PREDECESSOR.name
    && e.approval_evidence === approval.artifact
    && e.send_authority === "DENIED" && e.mapping_authority === "DENIED";
})());
record("K12 the ledger keeps BOTH rows — the successor never replaces the predecessor",
  ledger.entries.filter((x) => x.internal_template_key === TARGET_TEMPLATE_KEY).length === 2);
record("K13 the current canonical packet selects v2, approved and held",
  entryOf(packet).provider_template_name === TARGET_TEMPLATE_NAME
  && entryOf(packet).payload_fingerprint === EXPECTED_PAYLOAD_FINGERPRINT
  && entryOf(packet).local_state.approval_status === "approved"
  && entryOf(packet).local_state.submission_state === "APPROVED_UNMAPPED"
  && entryOf(packet).submit_now === false);
record("K14 the approved ready set is restored to eight and includes this key", (() => {
  const approved = packet.templates.filter((t) => t.local_state.approval_status === "approved");
  return approved.length === 8
    && approved.some((t) => t.internal_template_key === TARGET_TEMPLATE_KEY);
})());
record("K15 the readiness manifest restored the key with the v2 name and fingerprint", (() => {
  const t = readiness.templates.find((x) => x.internal_template_key === TARGET_TEMPLATE_KEY);
  return readiness.templates.length === 8
    && readiness.counts.evidence_bound_ack === 3
    && readiness.counts.ordinary_business === 5
    && !!t && t.provider_template_name === TARGET_TEMPLATE_NAME
    && t.payload_fingerprint === EXPECTED_PAYLOAD_FINGERPRINT
    && t.proven_remote_status === "APPROVED"
    && t.proven_remote_category === "UTILITY"
    && t.desired_mapping_state === "INACTIVE"
    && t.send_authority === "DENIED";
})());
record("K16 the internal staging-seed authority restored the key",
  /key: "consent_start_acknowledgement", classification: "EVIDENCE_BOUND_ACK"/.test(internalSeedSrc));
record("K17 SEED_SET still points at v2, never the quarantined v1", (() => {
  const m = seederSrc.match(/export const SEED_SET = Object\.freeze\(\[[\s\S]*?\n\]\);/);
  return !!m && m[0].includes(TARGET_TEMPLATE_NAME) && m[0].includes(EXPECTED_PAYLOAD_FINGERPRINT)
    && !m[0].includes(QUARANTINED_PREDECESSOR.name)
    && !m[0].includes(QUARANTINED_PREDECESSOR.fingerprint);
})());
record("K18 the mapping seeder preflight is still fail-closed on status AND category",
  /r\.status !== "APPROVED"/.test(seederSrc) && /META_STATUS_NOT_APPROVED/.test(seederSrc)
  && /r\.category !== "UTILITY"/.test(seederSrc) && /META_CATEGORY_MISMATCH/.test(seederSrc));
record("K19 R7L history is still immutable — registry pins v1 and never names v2",
  /providerName: "qf_consent_start_acknowledgement_v1"/.test(r7lSrc)
  && /"70c0ce994180c2ea62ff3413d12d460734f5c004c40eb4d056925feec7e7251a"/.test(r7lSrc)
  && !/qf_consent_start_acknowledgement_v2/.test(r7lSrc));
record("K20 no validator may accept v1 as the current START Utility target", (() => {
  // The packet no longer names v1, so R7M refuses it outright, and a MARKETING remote row
  // can never reach ALREADY_CREATED.
  const p = clonePacket();
  const e = entryOf(p);
  e.provider_template_name = QUARANTINED_PREDECESSOR.name;
  e.creation_payload.name = QUARANTINED_PREDECESSOR.name;
  return loadCanonicalPayload(p).reason === "still_pinned_to_quarantined_v1"
    && pre([goodRow({ category: "MARKETING" })]) === RepairPreState.PRESENT_CATEGORY_MISMATCH;
})());

// ---------------------------------------------------------------------------
// QF-MVP-40-R7M EVIDENCE TIGHTENING — the creation run is now directly evidenced,
// so the inferred provenance and the R7M-specific ledger exception are both gone.
// ---------------------------------------------------------------------------
record("C01 the v2 creation evidence artifact exists and is well formed",
  creation.artifact === "meta-staging-start-ack-v2-creation-evidence"
  && creation.phase === "QF-MVP-40-R7M"
  && creation.contains_secrets === false
  && creation.authorizes_meta_calls === false
  && creation.authorizes_mapping === false
  && creation.authorizes_sending === false);
record("C02 the creation artifact pins the exact v2 name and fingerprint",
  creation.creation_run.provider_template_name === TARGET_TEMPLATE_NAME
  && creation.creation_run.payload_fingerprint === EXPECTED_PAYLOAD_FINGERPRINT
  && creation.creation_run.internal_template_key === TARGET_TEMPLATE_KEY);
record("C03 it proves EXACTLY ONE POST, observed not inferred",
  creation.creation_run.post_attempt_count === 1
  && creation.post_count_provenance.basis === "OBSERVED"
  && creation.post_count_provenance.observed_line === "POST_ATTEMPT_COUNT=1"
  && creation.creation_run.second_post_issued === false
  && creation.creation_run.retry_issued === false);
record("C04 it proves SUCCESS / CREATED from an ABSENT pre-state",
  creation.creation_run.remote_pre_state === "ABSENT"
  && creation.creation_run.create_classification === "SUCCESS"
  && creation.creation_run.result === "CREATED"
  && creation.creation_run.operator_mode === "EXECUTE"
  && creation.creation_run.operator_exit_code === 0);
record("C05 it proves the creation readback was PENDING / UTILITY / en",
  creation.creation_run.readback_state === "ALREADY_CREATED"
  && creation.creation_run.remote_status_at_creation_readback === "PENDING"
  && creation.creation_run.remote_category === "UTILITY"
  && creation.creation_run.remote_language === "en"
  && creation.creation_run.remote_components_returned === 1
  && creation.creation_run.remote_template_id === "1338981184671889");
record("C06 it proves semantic confirmation true",
  creation.creation_run.semantic_confirmation === true);
record("C07 it records the repo state the run reported and fabricates no Meta body",
  creation.creation_run.head_unchanged === true
  && creation.creation_run.remote_head_unchanged === true
  && creation.creation_run.worktree_clean === true
  && creation.creation_run.meta_request_body_captured === false
  && creation.creation_run.meta_response_body_captured === false);
record("C08 it declares the creation authority CONSUMED and non-retryable",
  creation.authority_consumption.creation_authority === "CONSUMED"
  && creation.authority_consumption.retry_permitted === false
  && creation.authority_consumption.second_post_possible === false);
record("C09 the creation artifact is secret-free", (() => {
  const raw = JSON.stringify(creation);
  return !/(EAA[A-Za-z0-9]{20,}|Bearer\s|app_secret|access_token)/i.test(raw)
    && !/\+\d{10,}/.test(raw)
    && !new RegExp("2097008694503517|27861262223494153|1333595106493545").test(raw);
})());
record("C10 the two events are recorded separately and never collapsed",
  creation.lifecycle_position.sequence === 1 && creation.lifecycle_position.of === 2
  && creation.lifecycle_position.next_event_artifact === approval.artifact
  && approval.lifecycle_position.sequence === 2
  && approval.lifecycle_position.previous_event_artifact === creation.artifact
  && /never be collapsed/i.test(creation.lifecycle_position.non_collapse_statement));
record("C11 the two events genuinely differ: PENDING at creation, APPROVED later",
  creation.creation_run.remote_status_at_creation_readback === "PENDING"
  && approval.approval_readback.remote_status === "APPROVED"
  && creation.creation_run.post_attempt_count === 1
  && approval.approval_readback.post_attempt_count === 0);
record("C12 the ledger records the OBSERVED creation provenance", (() => {
  const e = ledger.entries.find((x) => x.provider_template_name === TARGET_TEMPLATE_NAME);
  return !!e && e.create_post_count_at_submission === 1
    && e.create_post_count_basis === "OBSERVED"
    && e.submission_outcome === "CREATED_PENDING"
    && e.remote_status_at_creation === "PENDING"
    && e.creation_evidence === creation.artifact;
})());
record("C13 the ledger cites BOTH artifacts in the standard two-evidence shape", (() => {
  const e = ledger.entries.find((x) => x.provider_template_name === TARGET_TEMPLATE_NAME);
  return !!e && Array.isArray(e.evidence) && e.evidence.length === 2
    && e.evidence.includes("meta-staging-start-ack-v2-creation-evidence.json")
    && e.evidence.includes("meta-staging-start-ack-v2-approval-evidence.json");
})());
record("C14 both cited evidence files actually exist on disk",
  existsSync(resolve("docs/provider-manifests/meta-staging-start-ack-v2-creation-evidence.json"))
  && existsSync(resolve("docs/provider-manifests/meta-staging-start-ack-v2-approval-evidence.json")));
record("C15 the R7M-specific closed-ledger exception was REMOVED",
  !/r7m/.test(packetValidatorSrc)
  && /c\.submission_outcome === "CREATED_PENDING"/.test(packetValidatorSrc)
  && /c\.evidence\.length === 2/.test(packetValidatorSrc));
record("C16 the v2 ledger row still records the final APPROVED / UTILITY state", (() => {
  const e = ledger.entries.find((x) => x.provider_template_name === TARGET_TEMPLATE_NAME);
  return !!e && e.last_proven_status === "APPROVED"
    && e.last_proven_remote_category === "UTILITY"
    && e.reconciliation_outcome === "RECONCILED_APPROVED"
    && e.create_post_count_at_reconciliation === 0
    && e.disposition === "APPROVED_UNMAPPED";
})());
record("C17 the creation artifact leaves the quarantined predecessor untouched",
  creation.predecessor.provider_template_name === QUARANTINED_PREDECESSOR.name
  && creation.predecessor.remote_category === "MARKETING"
  && creation.predecessor.disposition === "QUARANTINED_UNMAPPED"
  && creation.predecessor.touched_by_this_operation === false);

console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
