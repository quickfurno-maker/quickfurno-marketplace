// ============================================================================
// QF-MVP-40-R7N — validator for the client matching update Utility category repair.
// OFFLINE. Calls no Meta endpoint, submits nothing, sends nothing, reads no credential.
//
// It proves the SUPERSESSION boundary (R7I owns the quarantined v1, R7N owns v2), the
// two-placeholder runtime contract this target is bound to, and that the v2 copy carries
// no promotional concept — the defect that caused Meta to classify v1 as MARKETING.
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
} from "./create-meta-staging-client-matching-update-v2-once.mjs";
import {
  classifyLiveAssets, decide, makeHttp, parseFlags, sha256Hex, validateIdentity,
} from "./create-meta-staging-vendor-onboarding-reminder-once.mjs";
import { templatesAreIdentical } from "./submit-meta-templates.mjs";

const OPERATOR = "scripts/mvp/communication/create-meta-staging-client-matching-update-v2-once.mjs";
const VENDOR_OPERATOR = "scripts/mvp/communication/create-meta-staging-vendor-onboarding-reminder-once.mjs";
const R7I_OPERATOR = "scripts/mvp/communication/create-meta-staging-client-matching-update-once.mjs";
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
const r7iSrc = readFileSync(resolve(R7I_OPERATOR), "utf8");
const seederSrc = readFileSync(resolve(SEEDER), "utf8");
const EVIDENCE = "docs/provider-manifests/meta-staging-client-matching-category-mismatch-evidence.json";
const evidence = JSON.parse(readFileSync(resolve(EVIDENCE), "utf8"));
const READINESS = "docs/provider-manifests/meta-template-inactive-mapping-readiness.json";
const readiness = JSON.parse(readFileSync(resolve(READINESS), "utf8"));
const internalSeedSrc = readFileSync(resolve("scripts/mvp/communication/seed-internal-staging-templates.mjs"), "utf8");
const SWEEP = "docs/provider-manifests/meta-staging-current-waba-truth-sweep-evidence.json";
const sweep = JSON.parse(readFileSync(resolve(SWEEP), "utf8"));
const readinessGenSrc = readFileSync(resolve("scripts/mvp/communication/generate-meta-inactive-mapping-readiness.mjs"), "utf8");
/** QF-MVP-40 strict current-WABA proof for vendor_onboarding_reminder (2026-08-25). */
const STRICT_PROOF = "docs/provider-manifests/meta-staging-vendor-onboarding-reminder-strict-proof-evidence.json";
const strictProof = JSON.parse(readFileSync(resolve(STRICT_PROOF), "utf8"));
const STRICT_RECON = "docs/provider-manifests/meta-staging-vendor-onboarding-reminder-strict-reconciliation.json";
const strictReconRaw = readFileSync(resolve(STRICT_RECON), "utf8");
const strictRecon = JSON.parse(strictReconRaw);
const submitterSrc = readFileSync(resolve("scripts/mvp/communication/submit-meta-templates.mjs"), "utf8");
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
  /marketing/i, /\bdeal\b/i, /\bsale\b/i, /subscribe/i, /advertis/i, /verified/i,
  /recommend/i, /browse/i, /purchase/i, /explore/i, /discover/i, /exclusive/i];
/** The exact v1 copy R7I created, kept only so the Y-series is provably non-vacuous. */
const V1_BODY = "Hi {{1}}, QuickFurno has matched your enquiry with {{2}} verified vendors. They may contact you shortly.";
record("Y01 the v2 body carries NO promotional concept",
  BANNED.every((r) => !r.test(EXPECTED_BODY_TEXT)));
record("Y02 the quarantined v1 body DID carry a promotional adjective — so Y01 is not vacuous",
  /verified/i.test(V1_BODY) && BANNED.some((r) => r.test(V1_BODY)));
record("Y03 the v2 body is transactional: it names the recipient's existing enquiry and progress only",
  /your QuickFurno enquiry/i.test(EXPECTED_BODY_TEXT)
  && /matched/i.test(EXPECTED_BODY_TEXT)
  && /your request/i.test(EXPECTED_BODY_TEXT));
record("Y04 the v2 body keeps the runtime's exact two-placeholder contract", (() => {
  const ph = (EXPECTED_BODY_TEXT.match(/\{\{\s*\d+\s*\}\}/g) ?? []).map((x) => x.replace(/\s/g, ""));
  return ph.length === 2 && ph[0] === "{{1}}" && ph[1] === "{{2}}";
})());
record("Y06 the runtime binding really is CLIENT_NAME + MATCHED_VENDOR_COUNT, in that order", (() => {
  const src = readFileSync(resolve("lib/communication/businessTemplateVariables.ts"), "utf8");
  const blk = src.match(/client_matching_update: Object\.freeze\(\{[\s\S]*?\}\),/);
  return !!blk && /body\(1, BusinessSourceKey\.CLIENT_NAME\)/.test(blk[0])
    && /body\(2, BusinessSourceKey\.MATCHED_VENDOR_COUNT\)/.test(blk[0]);
})());
record("Y05 the v2 body carries no URL or bare domain",
  !/https?:\/\//i.test(EXPECTED_BODY_TEXT) && !/quickfurno\.[a-z]{2,}/i.test(EXPECTED_BODY_TEXT));

// ---------------------------------------------------------------------------
// SUPERSESSION BOUNDARY — R7L owns v1, R7N owns v2.
// ---------------------------------------------------------------------------
record("Q01 the quarantined predecessor is recorded with its proven MARKETING category",
  QUARANTINED_PREDECESSOR.name === "qf_client_matching_update_v1"
  && QUARANTINED_PREDECESSOR.fingerprint === "c0930db5a9beee61de0076caf234b36f950554bc21c60b697845028a8d057e1c"
  && QUARANTINED_PREDECESSOR.provenRemoteCategory === "MARKETING");
record("Q02 R7N targets v2 and never the quarantined v1",
  TARGET_TEMPLATE_NAME !== QUARANTINED_PREDECESSOR.name
  && EXPECTED_PAYLOAD_FINGERPRINT !== QUARANTINED_PREDECESSOR.fingerprint);
record("Q03 R7L's frozen registry STILL pins v1 — history was not rewritten",
  /TARGET_TEMPLATE_NAME = "qf_client_matching_update_v1"/.test(r7iSrc)
  && /"c0930db5a9beee61de0076caf234b36f950554bc21c60b697845028a8d057e1c"/.test(r7iSrc));
record("Q04 R7L never names v2 — R7L execution authority is not reused",
  !/qf_client_matching_update_v2/.test(r7iSrc));
record("Q05 R7N refuses if the packet still pins the quarantined v1", (() => {
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
record("Q08 v2 has NO ledger entry yet — the ledger records only PROVEN remote state",
  !ledger.entries.some((x) => x.provider_template_name === TARGET_TEMPLATE_NAME));
record("Q09 the canonical packet now names v2 as the active client matching template",
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
  const p = clonePacket(); entryOf(p).local_state.approval_status = "approved";
  return loadCanonicalPayload(p).reason === "approval_status_unexpected";
})());
record("P08 submission_state drift is rejected", (() => {
  const p = clonePacket(); entryOf(p).local_state.submission_state = "APPROVED_UNMAPPED";
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
record("P14 a removed example block is rejected (this target is variable-bearing)", (() => {
  const p = clonePacket(); delete entryOf(p).creation_payload.components[0].example;
  return loadCanonicalPayload(p).reason === "body_shape_unexpected";
})());
record("P14b a wrong example arity is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].example.body_text[0].push("x");
  return loadCanonicalPayload(p).reason === "example_arity_unexpected";
})());
record("P14c a second example row is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].example.body_text.push(["a", "b"]);
  return loadCanonicalPayload(p).reason === "example_shape_unexpected";
})());
record("P15 a third placeholder is rejected", (() => {
  const p = clonePacket();
  const b = entryOf(p).creation_payload.components[0];
  b.text = `${b.text} Ref {{3}}.`;
  return loadCanonicalPayload(p).reason === "body_text_mismatch";
})());
record("P15b out-of-order placeholders are rejected", (() => {
  const p = clonePacket();
  const b = entryOf(p).creation_payload.components[0];
  b.text = "Hi {{2}}, update on your QuickFurno enquiry: {{1}} professionals have been matched to it and may contact you about your request.";
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
record("P20 the committed packet holds the required draft/held state",
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
  ["data contains a non-object row", okGet({ data: ["qf_client_matching_update_v2"] })],
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
  evidence.artifact === "meta-staging-client-matching-category-mismatch-evidence"
  && evidence.phase === "QF-MVP-40-R7N"
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
    && o.observation_method === "GET_ONLY_DRY_RUN";
})());
record("V02b the artifact does NOT overclaim what the older R7I classifier proved", (() => {
  // R7I's classifier predates the strict pre-state model: it matches on name+language+status
  // only, so its ALREADY_CREATED proves neither a category match nor a semantic match. The
  // artifact records that limitation explicitly instead of borrowing R7K/R7L/R7M semantics.
  const c = evidence.classifier_non_claim;
  return !!c && c.reported_pre_state === "ALREADY_CREATED"
    && c.semantic_match_asserted === false
    && c.category_match_asserted === false
    && /does not compare category or components/i.test(c.statement);
})());
record("V03 it grants no delete, appeal, recreation, mapping, arm or send authority", (() => {
  const a = evidence.authorities_explicitly_not_granted;
  return a.delete_authority === "NOT_GRANTED" && a.appeal_authority === "NOT_GRANTED"
    && a.recreation_authority === "NOT_GRANTED" && a.mapping_authority === "DENIED"
    && a.send_authority === "DENIED" && a.provider_arm_authority === "NOT_GRANTED"
    && a.activation_authority === "NOT_GRANTED" && a.production_authority === "DENIED";
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
record("V08 the OLD R7I evidence references remain byte-unchanged in the ledger", (() => {
  const e = ledger.entries.find((x) => x.provider_template_name === QUARANTINED_PREDECESSOR.name);
  const expected = [
    "QF-MVP-40-WAVE1-META-SUBMISSION-2026-07-31T04-02-38-833Z.json",
    "QF-MVP-40-WAVE1-client_matching_update-META-RECONCILIATION-2026-07-31T04-22-20-119Z.json",
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
// R7N issues no request itself: it imports `makeHttp` from the R7B operator, which is the
// single network adapter. These rules drive that ADAPTER with a recording transport and
// assert on the URLs and methods it actually emits — not on R7N source text.
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
// CURRENT-WABA TRUTH SWEEP (2026-08-24) — readiness must derive from present proof.
// ---------------------------------------------------------------------------
record("T01 the sweep artifact covers all eight SEED_SET keys and is secret-free", (() => {
  const seeded = ["consent_help_response","consent_stop_acknowledgement","consent_start_acknowledgement",
    "lead_received","client_lead_status_update","client_matching_update","lead_assignment_alert",
    "vendor_onboarding_reminder"];
  const got = sweep.results.map((r) => r.internal_template_key).sort();
  const raw = JSON.stringify(sweep);
  return sweep.contains_secrets === false && sweep.results.length === 8
    && got.join(",") === seeded.slice().sort().join(",")
    && !/(EAA[A-Za-z0-9]{20,}|Bearers|app_secret|access_token)/i.test(raw)
    && !new RegExp("2097008694503517|27861262223494153|1333595106493545").test(raw);
})());
record("T02 every sweep reading issued ZERO POSTs",
  sweep.method.post_attempt_count_total === 0
  && sweep.method.mutation_flags_used === "NONE"
  && sweep.results.every((r) => r.post_attempt_count === 0));
record("T03 every key carries an explicit current-WABA classification",
  sweep.results.every((r) => ["PRESENT_APPROVED_UTILITY", "ABSENT"].includes(r.current_waba_state)));
record("T04 lead_received is ABSENT on the current WABA",
  sweep.results.find((r) => r.internal_template_key === "lead_received").current_waba_state === "ABSENT");
record("T05 lead_assignment_alert is ABSENT on the current WABA",
  sweep.results.find((r) => r.internal_template_key === "lead_assignment_alert").current_waba_state === "ABSENT");
record("T06 client_matching_update v2 is ABSENT until it is created", (() => {
  const r = sweep.results.find((x) => x.internal_template_key === "client_matching_update");
  return r.provider_template_name === TARGET_TEMPLATE_NAME && r.current_waba_state === "ABSENT";
})());
record("T07 the ledger records the ABSENT keys as ABSENT, not as current APPROVED/UTILITY", (() => {
  const absent = ["qf_lead_received_v1", "qf_lead_assignment_alert_v1"];
  return absent.every((n) => {
    const e = ledger.entries.find((x) => x.provider_template_name === n);
    return !!e && e.current_waba_state === "ABSENT"
      && e.current_waba_evidence === sweep.artifact
      && /must NOT be read as current readiness/i.test(e.current_waba_note);
  });
})());
record("T08 the ABSENT keys keep their historical record intact", (() => {
  const absent = ["qf_lead_received_v1", "qf_lead_assignment_alert_v1"];
  return absent.every((n) => {
    const e = ledger.entries.find((x) => x.provider_template_name === n);
    return !!e && e.last_proven_status === "APPROVED" && e.create_post_count_at_submission === 1
      && Array.isArray(e.evidence) && e.evidence.length === 2;
  });
})());
record("T09 the five READY keys are each backed by current-WABA proof", (() => {
  const ready = ["qf_consent_help_response_v3", "qf_consent_stop_acknowledgement_v1",
    "qf_consent_start_acknowledgement_v2", "qf_client_lead_status_update_v1",
    "qf_vendor_onboarding_reminder_v1"];
  return ready.every((n) => {
    const e = ledger.entries.find((x) => x.provider_template_name === n);
    return !!e && e.current_waba_state === "PRESENT_APPROVED_UTILITY"
      && e.current_waba_evidence === sweep.artifact;
  });
})());
record("T10 the readiness manifest emits EXACTLY the proven-ready set", (() => {
  const expected = ["consent_help_response", "consent_stop_acknowledgement",
    "consent_start_acknowledgement", "client_lead_status_update", "vendor_onboarding_reminder"];
  const got = readiness.templates.map((t) => t.internal_template_key);
  return got.length === expected.length && got.slice().sort().join(",") === expected.slice().sort().join(",")
    && !got.includes("lead_received") && !got.includes("lead_assignment_alert")
    && !got.includes("client_matching_update");
})());
record("T11 readiness is GATED on current-WABA proof, not on the WABA-blind claim",
  /current_waba_state === CURRENT_READY/.test(readinessGenSrc)
  && /const CURRENT_READY = "PRESENT_APPROVED_UTILITY";/.test(readinessGenSrc)
  && /no current_waba_state recorded/.test(readinessGenSrc));
record("T12 a stale historical-only claim cannot make a key ready", (() => {
  // Both ABSENT keys still say last_proven_status APPROVED / category UTILITY. If readiness
  // were derived from those fields they would appear; they do not.
  const stale = ledger.entries.filter((e) => e.current_waba_state === "ABSENT"
    && e.last_proven_status === "APPROVED" && e.last_proven_remote_category === "UTILITY");
  const emitted = readiness.templates.map((t) => t.provider_template_name);
  return stale.length === 2 && stale.every((e) => !emitted.includes(e.provider_template_name));
})());
record("T13 SEED_SET is still exactly eight and still names v2 for this key", (() => {
  const rows = (seederSrc.match(/{ key: "/g) ?? []).length;
  return rows === 8 && seederSrc.includes(TARGET_TEMPLATE_NAME);
})());
record("T14 the mapping seeder is still all-or-nothing and fail-closed",
  /r.status !== "APPROVED"/.test(seederSrc) && /META_STATUS_NOT_APPROVED/.test(seederSrc)
  && /r.category !== "UTILITY"/.test(seederSrc) && /META_CATEGORY_MISMATCH/.test(seederSrc));
record("T15 the sweep does not rewrite historical evidence",
  sweep.historical_evidence_non_claim.prior_evidence_unchanged === true
  && /NOT amended/i.test(sweep.historical_evidence_non_claim.statement));
// Universally quantified: it holds when no loose reading remains, and still bites the
// moment one reappears. The earlier form required a loose reading to EXIST, so closing
// the last loose gap would have failed the suite for the wrong reason.
record("T16 no LOOSE-classifier reading claims a semantic match",
  sweep.results.every((r) => (r.classifier === "LOOSE" ? r.semantic_match_asserted === false : true)));
record("T17 no READY key rests on a LOOSE reading", (() => {
  const ready = sweep.results.filter((r) => r.current_waba_state === "PRESENT_APPROVED_UTILITY");
  return ready.length >= 1
    && ready.every((r) => r.classifier === "STRICT" && r.semantic_match_asserted === true);
})());

// ---------------------------------------------------------------------------
// STRICT CURRENT-WABA PROOF — vendor_onboarding_reminder (2026-08-25)
//
// This key was the last READY entry whose current-WABA reading came from the LOOSE
// R7B classifier, which matches name, language and status ONLY. The submitter's
// RECONCILE_ONLY mode supplied the missing strict semantics without any mutation.
// ---------------------------------------------------------------------------
record("V01 the sweep now classifies vendor_onboarding_reminder as STRICT", (() => {
  const r = sweep.results.find((x) => x.internal_template_key === "vendor_onboarding_reminder");
  return !!r && r.classifier === "STRICT" && r.semantic_match_asserted === true
    && r.current_waba_state === "PRESENT_APPROVED_UTILITY";
})());
record("V02 the sweep carries a zero-POST strict_proof block for that key", (() => {
  const r = sweep.results.find((x) => x.internal_template_key === "vendor_onboarding_reminder");
  const p = r && r.strict_proof;
  return !!p && p.outcome === "RECONCILED_APPROVED" && p.operation_mode === "RECONCILE_ONLY"
    && p.readback_semantic_match === true && p.identity_match === true
    && p.create_post_count === 0 && p.post_attempt_count === 0;
})());
record("V03 the sanitized reconciliation proves APPROVED / UTILITY / en for the right template",
  strictRecon.provider_template_name === "qf_vendor_onboarding_reminder_v1"
  && strictRecon.provider_language === "en"
  && strictRecon.status === "APPROVED"
  && strictRecon.returned_category === "UTILITY"
  && strictRecon.requested_category === "UTILITY"
  && strictRecon.outcome === "RECONCILED_APPROVED"
  && strictRecon.readback_semantic_match === true
  && strictRecon.identity_match === true);
record("V04 the strict reconciliation issued ZERO create POSTs",
  strictRecon.create_post_count === 0 && strictRecon.operation_mode === "RECONCILE_ONLY");
record("V05 the reconciliation pins the canonical vendor payload fingerprint", (() => {
  const t = packet.templates.find((x) => x.internal_template_key === "vendor_onboarding_reminder");
  return !!t && strictRecon.payload_fingerprint === t.payload_fingerprint
    && strictRecon.payload_fingerprint
      === "c6e95a38dde899f717999520082feddf4c91f2a33c84650c72538ef2c111199a";
})());
record("V06 the sanitized reconciliation leaks no credential", (() => {
  const banned = [/token/i, /secret/i, /waba/i, /phone/i, /bearer/i, /authorization/i, /app_id/i];
  return Object.keys(strictRecon).every((k) => !banned.some((r) => r.test(k)))
    && !/eyJ|Bearer\s/i.test(strictReconRaw);
})());
record("V07 the index wrapper addresses the sanitized record by content hash",
  strictProof.strict_evidence.path === STRICT_RECON
  && strictProof.strict_evidence.sha256
    === createHash("sha256").update(strictReconRaw).digest("hex")
  && strictProof.strict_evidence.relocated_byte_identical === true
  && strictProof.strict_evidence.content_rewritten === false);
record("V08 the wrapper declares no secrets and grants no authority",
  strictProof.contains_secrets === false
  && strictProof.authorizes_meta_calls === false
  && strictProof.authorizes_mapping === false
  && strictProof.authorizes_sending === false
  && strictProof.zero_mutation_proof.create_post_count === 0
  && strictProof.zero_mutation_proof.messages_sent === 0
  && strictProof.zero_mutation_proof.templates_created_edited_or_deleted === 0);
record("V09 RECONCILED_APPROVED is unreachable without a full semantic comparison",
  submitterSrc.includes("const semanticMatch = templatesAreIdentical(row, t.creation_payload);")
  && submitterSrc.includes("finish(ReconcileOutcome.RECONCILED_CATEGORY_MISMATCH, 6);")
  && submitterSrc.includes("if (!semanticMatch) finish(ReconcileOutcome.RECONCILED_COLLISION, 4);")
  && submitterSrc.indexOf("const semanticMatch = templatesAreIdentical(row, t.creation_payload);")
     < submitterSrc.indexOf("finish(ReconcileOutcome.RECONCILED_APPROVED, 0);"));
record("V10 the reconcile mode cannot reach a create POST", (() => {
  const branchEnd = submitterSrc.indexOf("finish(ReconcileOutcome.RECONCILED_UNUSABLE_STATUS, 4);");
  const firstPost = submitterSrc.indexOf('method: "POST"');
  return branchEnd > 0 && firstPost > 0 && branchEnd < firstPost
    && /execute && reconcileOnly/.test(submitterSrc);
})());
record("V11 the ledger row for the vendor template is backed by the strict evidence", (() => {
  const e = ledger.entries.find((x) => x.provider_template_name === "qf_vendor_onboarding_reminder_v1");
  return !!e && e.current_waba_state === "PRESENT_APPROVED_UTILITY"
    && e.current_waba_strict_outcome === "RECONCILED_APPROVED"
    && e.current_waba_strict_evidence === strictProof.artifact;
})());
record("V12 the sweep itself asserts every READY key now has strict semantic proof",
  sweep.summary.every_ready_key_has_strict_semantic_proof === true
  && Array.isArray(sweep.summary.ready_keys_without_strict_semantic_proof)
  && sweep.summary.ready_keys_without_strict_semantic_proof.length === 0
  && sweep.summary.ready_keys_with_strict_semantic_proof.length === sweep.summary.ready_count);

// A row with NO current-WABA field is the exact WABA-blind ambiguity this work removes:
// it would silently fall back to a 2026-07-31 claim. Every row must SAY something, and
// only one of those somethings can ever mean "ready".
record("V13 every ledger row carries explicit current-WABA truth from a closed vocabulary", (() => {
  const VOCAB = new Set([
    "PRESENT_APPROVED_UTILITY",
    "PRESENT_APPROVED_CATEGORY_MISMATCH",
    "ABSENT",
    "NOT_OBSERVED_ON_CURRENT_WABA",
    // Created live on 2026-08-25 and PROVEN present with remote status PENDING. It is a
    // present-and-real state, but it is NOT approved and must never satisfy readiness.
    "PRESENT_PENDING_UTILITY",
    // The single MARKETING template (vendor_crm_promotion), created live and PENDING.
    "PRESENT_PENDING_MARKETING",
    // Proven APPROVED at MARKETING by the 2026-08-25 reconciliation. Approved, but NEVER
    // admissible to Utility mapping readiness.
    "PRESENT_APPROVED_MARKETING",
  ]);
  return ledger.entries.length > 0
    && ledger.entries.every((e) => typeof e.current_waba_state === "string"
      && VOCAB.has(e.current_waba_state));
})());
record("V16 a PENDING current-WABA row is present but never ready", (() => {
  // Universally quantified: it holds when no PENDING row remains (every submission has now
  // been reconciled) and still bites the moment a new one appears.
  const pending = ledger.entries.filter((e) => String(e.current_waba_state).startsWith("PRESENT_PENDING_"));
  const emitted = readiness.templates.map((t) => t.provider_template_name);
  return pending.every((e) =>
    e.last_proven_status === "PENDING"
    && e.approval_evidence === null
    && e.mapping_authority === "DENIED"
    && e.send_authority === "DENIED"
    && e.creation_authority === "CONSUMED"
    && !emitted.includes(e.provider_template_name));
})());
// V16 above is now VACUOUS by design: every submission has been reconciled, so no PENDING
// row remains. These two keep the same ground covered non-vacuously.
record("V17 an approved-but-MARKETING row is present and never ready", (() => {
  const m = ledger.entries.filter((e) => e.current_waba_state === "PRESENT_APPROVED_MARKETING");
  const emitted = readiness.templates.map((t) => t.provider_template_name);
  return m.length > 0 && m.every((e) => e.last_proven_status === "APPROVED"
    && e.last_proven_remote_category === "MARKETING"
    && e.mapping_authority === "DENIED"
    && e.send_authority === "DENIED"
    && !emitted.includes(e.provider_template_name));
})());
record("V18 a category-mismatched row is quarantined and never ready", (() => {
  const q = ledger.entries.filter((e) => e.current_waba_state === "PRESENT_APPROVED_CATEGORY_MISMATCH");
  const emitted = readiness.templates.map((t) => t.provider_template_name);
  return q.length > 0 && q.every((e) => e.disposition === "QUARANTINED_UNMAPPED"
    && e.mapping_authority === "DENIED"
    && e.send_authority === "DENIED"
    && e.activation_authority === "NOT_GRANTED"
    // Absent OR null both mean "no approval is claimed". The pre-existing R7I quarantine row
    // predates the approval_evidence field, so requiring a literal null would fail on truth.
    && (e.approval_evidence ?? null) === null
    && !emitted.includes(e.provider_template_name));
})());
record("V14 only PRESENT_APPROVED_UTILITY rows reach the readiness manifest", (() => {
  const emitted = readiness.templates.map((t) => t.provider_template_name);
  return emitted.length > 0 && emitted.every((name) => {
    const e = ledger.entries.find((x) => x.provider_template_name === name);
    return !!e && e.current_waba_state === "PRESENT_APPROVED_UTILITY";
  });
})());
record("V15 a non-UTILITY current state can never be mappable", (() => {
  const quarantined = ledger.entries.find(
    (e) => e.provider_template_name === "qf_client_matching_update_v1");
  const emitted = readiness.templates.map((t) => t.provider_template_name);
  return !!quarantined
    && quarantined.current_waba_state === "PRESENT_APPROVED_CATEGORY_MISMATCH"
    && quarantined.current_waba_semantic_match_asserted === false
    && !emitted.includes(quarantined.provider_template_name);
})());


console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
