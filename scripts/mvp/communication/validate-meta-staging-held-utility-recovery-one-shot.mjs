// ============================================================================
// QF-MVP-40-R7L — validator for the BOUNDED held-Utility recovery operator.
// OFFLINE. Calls no Meta endpoint, submits nothing, sends nothing, reads no credential.
//
// The bounded selector is the whole point of this operator, so the registry, the CLI and
// the "a sixth target needs a code change" property are all proved explicitly, and every
// packet/pre-state rule is driven across ALL FIVE targets rather than a representative one.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CliFailure, EXPECTED_IDENTITY_DIGESTS, ExitCode, HeldPreState, OWNER_ACK_FLAG, Outcome, PreState,
  RECOVERABLE_KEYS, RECOVERABLE_TARGETS, REQUIRED_PACKET_STATE, REQUIRED_TEMPLATE_FIELDS,
  classifyPreState, decide, exitCodeForOutcome, loadCanonicalPayload, parseCli,
} from "./create-meta-staging-held-utility-recovery-once.mjs";
import {
  classifyLiveAssets, makeHttp, sha256Hex, validateIdentity,
} from "./create-meta-staging-vendor-onboarding-reminder-once.mjs";

const OPERATOR = "scripts/mvp/communication/create-meta-staging-held-utility-recovery-once.mjs";
const VENDOR_OPERATOR = "scripts/mvp/communication/create-meta-staging-vendor-onboarding-reminder-once.mjs";
const R7I_OPERATOR = "scripts/mvp/communication/create-meta-staging-client-matching-update-once.mjs";
const R7K_OPERATOR = "scripts/mvp/communication/create-meta-staging-client-lead-status-update-once.mjs";
const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";

const code = readFileSync(resolve(OPERATOR), "utf8");
const codeOnly = code
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
const codeNoStrings = codeOnly
  .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``")
  .replace(/"(?:\\[\s\S]|[^\\"])*"/g, '""')
  .replace(/'(?:\\[\s\S]|[^\\'])*'/g, "''");

const packet = JSON.parse(readFileSync(resolve(PACKET), "utf8"));
const vendorSrc = readFileSync(resolve(VENDOR_OPERATOR), "utf8");
const r7iSrc = readFileSync(resolve(R7I_OPERATOR), "utf8");
const r7kSrc = readFileSync(resolve(R7K_OPERATOR), "utf8");

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
const entryOf = (p, key) => p.templates.find((t) => t.internal_template_key === key);
const T = RECOVERABLE_TARGETS;
const ALL = RECOVERABLE_KEYS.map((k) => T[k]);
const payloadFor = (t) => loadCanonicalPayload(packet, t).payload;
const rowFor = (t, over = {}) => ({
  id: "1234567890",
  name: t.providerName,
  language: t.language,
  status: "APPROVED",
  category: t.category,
  components: JSON.parse(JSON.stringify(payloadFor(t).components)),
  ...over,
});
const stateFor = (t, lookupOrRows) =>
  classifyPreState(Array.isArray(lookupOrRows) ? okGet({ data: lookupOrRows }) : lookupOrRows, t, payloadFor(t)).state;

let passed = 0;
let failed = 0;
const record = (label, ok) => {
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.log(`FAIL  ${label}`); }
};

// ---------------------------------------------------------------------------
// REGISTRY — the bounded allow-list is the core safety property.
// ---------------------------------------------------------------------------
const EXPECTED_REGISTRY = {
  consent_help_response: ["qf_consent_help_response_v3", 0, "12f98c8b9504194ef9d983a606c9edd1c083dab1ba187915bdbea85fbc3e6c87", 0],
  consent_stop_acknowledgement: ["qf_consent_stop_acknowledgement_v1", 1, "850a4c01a48b78e237a85e186a448d8395abfb1e5049aaf6d8176b8628747268", 0],
  consent_start_acknowledgement: ["qf_consent_start_acknowledgement_v1", 1, "70c0ce994180c2ea62ff3413d12d460734f5c004c40eb4d056925feec7e7251a", 0],
  lead_received: ["qf_lead_received_v1", 1, "dd818e01d293a683b3685f1f246f8cba6b1e4f8e6e106bcab72c4739af640e16", 1],
  lead_assignment_alert: ["qf_lead_assignment_alert_v1", 1, "3f7997be7b8e1b019ba306a058b96f2d68aa84b7a014ea96407510030bb02453", 1],
};
record("R01 the registry holds EXACTLY five targets", RECOVERABLE_KEYS.length === 5);
record("R02 the key set is exactly the five authorised keys",
  RECOVERABLE_KEYS.slice().sort().join(",") === Object.keys(EXPECTED_REGISTRY).sort().join(","));
for (const [key, [name, wave, fp, ph]] of Object.entries(EXPECTED_REGISTRY)) {
  record(`R03 ${key} pins name/lang/category/wave/fingerprint/arity exactly`,
    T[key].key === key && T[key].providerName === name && T[key].language === "en"
    && T[key].category === "UTILITY" && T[key].wave === wave
    && T[key].fingerprint === fp && T[key].placeholders === ph);
}
record("R04 the registry and every entry are frozen",
  Object.isFrozen(RECOVERABLE_TARGETS) && ALL.every((t) => Object.isFrozen(t))
  && Object.isFrozen(RECOVERABLE_KEYS) && Object.isFrozen(REQUIRED_PACKET_STATE));
record("R05 a sixth target cannot be added at runtime", (() => {
  try { RECOVERABLE_TARGETS.some_new_key = { key: "some_new_key" }; } catch { /* strict mode */ }
  try { T.lead_received.providerName = "hacked"; } catch { /* strict mode */ }
  return RECOVERABLE_KEYS.length === 5
    && !Object.prototype.hasOwnProperty.call(RECOVERABLE_TARGETS, "some_new_key")
    && T.lead_received.providerName === "qf_lead_received_v1";
})());
record("R06 a sixth target requires a code edit — the registry is a literal in source", (() => {
  const block = codeOnly.match(/export const RECOVERABLE_TARGETS = Object\.freeze\(\{[\s\S]*?\n\}\);/);
  if (!block) return false;
  const keys = [...block[0].matchAll(/^\s{2}([a-z_]+):\s*Object\.freeze\(\{/gm)].map((m) => m[1]);
  return keys.length === 5 && keys.sort().join(",") === Object.keys(EXPECTED_REGISTRY).sort().join(",");
})());
record("R07 the registry is never built from argv or env",
  !/RECOVERABLE_TARGETS\s*\[[^\]]*(argv|env)/.test(codeOnly)
  && !/(providerName|fingerprint|category|language|wave)\s*:\s*(process\.)?(argv|env)/.test(codeOnly));
record("R08 the five keys are exactly the still-absent held set — not R7B/R7I/R7K targets",
  !RECOVERABLE_KEYS.includes("vendor_onboarding_reminder")
  && !RECOVERABLE_KEYS.includes("client_matching_update")
  && !RECOVERABLE_KEYS.includes("client_lead_status_update"));

// ---------------------------------------------------------------------------
// CLI — the selector is bounded and mandatory.
// ---------------------------------------------------------------------------
record("C01 a valid target parses and defaults to dry run", (() => {
  const r = parseCli(["--target", "lead_received"]);
  return r.ok === true && r.target.key === "lead_received" && r.mayPost === false;
})());
record("C02 the `--target=key` form is equivalent",
  parseCli(["--target=lead_received"]).target?.key === "lead_received");
record("C03 a missing target is refused", parseCli([]).reason === CliFailure.TARGET_MISSING);
record("C04 a missing target is refused even with both mutation flags",
  parseCli(["--execute", OWNER_ACK_FLAG]).reason === CliFailure.TARGET_MISSING);
record("C05 a target flag with no value is refused",
  parseCli(["--target"]).reason === CliFailure.TARGET_VALUE_MISSING
  && parseCli(["--target", "--execute"]).reason === CliFailure.TARGET_VALUE_MISSING
  && parseCli(["--target="]).reason === CliFailure.TARGET_VALUE_MISSING);
record("C06 a duplicated target is refused",
  parseCli(["--target", "lead_received", "--target", "lead_received"]).reason === CliFailure.TARGET_DUPLICATED
  && parseCli(["--target=lead_received", "--target=lead_assignment_alert"]).reason === CliFailure.TARGET_DUPLICATED);
record("C07 an unknown target is refused",
  parseCli(["--target", "vendor_new_lead"]).reason === CliFailure.TARGET_UNKNOWN
  && parseCli(["--target", "client_matching_update"]).reason === CliFailure.TARGET_UNKNOWN
  && parseCli(["--target", "anything_at_all"]).reason === CliFailure.TARGET_UNKNOWN);
record("C08 a prototype key is not a target",
  parseCli(["--target", "constructor"]).reason === CliFailure.TARGET_UNKNOWN
  && parseCli(["--target", "__proto__"]).reason === CliFailure.TARGET_UNKNOWN
  && parseCli(["--target", "toString"]).reason === CliFailure.TARGET_UNKNOWN);
record("C09 an unknown flag is refused",
  parseCli(["--target", "lead_received", "--force"]).reason === CliFailure.UNKNOWN_FLAG
  && parseCli(["--target", "lead_received", "--all"]).reason === CliFailure.UNKNOWN_FLAG);
record("C10 positional garbage is refused",
  parseCli(["lead_received"]).reason === CliFailure.POSITIONAL_ARGUMENT
  && parseCli(["--target", "lead_received", "extra"]).reason === CliFailure.POSITIONAL_ARGUMENT);
record("C11 there is NO batch/all mode",
  !/--all\b/.test(codeOnly) && !/\bbatch\b/i.test(codeNoStrings)
  && !/for\s*\([^)]*RECOVERABLE_KEYS/.test(codeNoStrings)
  && !/RECOVERABLE_KEYS\.(map|forEach|reduce)\(/.test(codeNoStrings));
record("C12 target alone cannot post", parseCli(["--target", "lead_received"]).mayPost === false);
record("C13 target + --execute alone cannot post",
  parseCli(["--target", "lead_received", "--execute"]).mayPost === false);
record("C14 target + owner flag alone cannot post",
  parseCli(["--target", "lead_received", OWNER_ACK_FLAG]).mayPost === false);
record("C15 both mutation flags are necessary and sufficient",
  parseCli(["--target", "lead_received", "--execute", OWNER_ACK_FLAG]).mayPost === true
  && OWNER_ACK_FLAG === "--owner-authorized-once");
record("C16 every registry key is individually selectable",
  RECOVERABLE_KEYS.every((k) => parseCli(["--target", k]).target?.key === k));

// ---------------------------------------------------------------------------
// PACKET / PAYLOAD — driven across ALL FIVE targets.
// ---------------------------------------------------------------------------
record("P01 the committed packet passes for all five targets",
  ALL.every((t) => {
    const r = loadCanonicalPayload(packet, t);
    return r.ok === true && r.fingerprint === t.fingerprint;
  }));
record("P02 an unregistered target object is refused",
  loadCanonicalPayload(packet, { key: "vendor_new_lead", providerName: "x", language: "en", category: "UTILITY", wave: 1, fingerprint: "x", placeholders: 1 }).reason === "target_not_recoverable");
record("P03 a wrong provider name fails for every target",
  ALL.every((t) => {
    const p = clonePacket(); entryOf(p, t.key).provider_template_name = "qf_wrong_v9";
    return loadCanonicalPayload(p, t).reason === "name_mismatch";
  }));
record("P04 a wrong wave fails for every target",
  ALL.every((t) => {
    const p = clonePacket(); entryOf(p, t.key).submission_wave = 4;
    return loadCanonicalPayload(p, t).reason === "wave_mismatch";
  }));
record("P05 a wrong language fails for every target",
  ALL.every((t) => {
    const p = clonePacket(); entryOf(p, t.key).creation_payload.language = "en_US";
    return loadCanonicalPayload(p, t).reason === "language_mismatch";
  }));
record("P06 a wrong category fails for every target",
  ALL.every((t) => {
    const p = clonePacket(); entryOf(p, t.key).creation_payload.category = "MARKETING";
    return loadCanonicalPayload(p, t).reason === "category_mismatch";
  }));
record("P07 a changed body fails for every target (fingerprint backstop)",
  ALL.every((t) => {
    const p = clonePacket(); entryOf(p, t.key).creation_payload.components[0].text += " Extra.";
    return loadCanonicalPayload(p, t).ok === false;
  }));
record("P08 submit_now flipped to true fails for every target",
  ALL.every((t) => {
    const p = clonePacket(); entryOf(p, t.key).submit_now = true;
    return loadCanonicalPayload(p, t).reason === "submit_now_not_held";
  }));
record("P09 approval_status drift fails for every target",
  ALL.every((t) => {
    const p = clonePacket(); entryOf(p, t.key).local_state.approval_status = "pending";
    return loadCanonicalPayload(p, t).reason === "approval_status_unexpected";
  }));
record("P10 submission_state drift fails for every target",
  ALL.every((t) => {
    const p = clonePacket(); entryOf(p, t.key).local_state.submission_state = "APPROVED_MAPPED";
    return loadCanonicalPayload(p, t).reason === "submission_state_unexpected";
  }));
record("P11 a missing local_state fails for every target",
  ALL.every((t) => {
    const p = clonePacket(); delete entryOf(p, t.key).local_state;
    return loadCanonicalPayload(p, t).reason === "local_state_missing";
  }));
record("P12 a duplicate packet entry fails for every target",
  ALL.every((t) => {
    const p = clonePacket(); p.templates.push(JSON.parse(JSON.stringify(entryOf(p, t.key))));
    return loadCanonicalPayload(p, t).reason === "target_entry_not_unique";
  }));
record("P13 a missing packet entry fails for every target",
  ALL.every((t) => {
    const p = clonePacket(); p.templates = p.templates.filter((x) => x.internal_template_key !== t.key);
    return loadCanonicalPayload(p, t).reason === "target_entry_not_unique";
  }));
record("P14 an unreadable packet fails for every target",
  ALL.every((t) => loadCanonicalPayload(null, t).reason === "packet_unreadable"));
record("P15 an added parameter_format fails for every target",
  ALL.every((t) => {
    const p = clonePacket(); entryOf(p, t.key).creation_payload.parameter_format = "POSITIONAL";
    return loadCanonicalPayload(p, t).reason === "payload_shape_unexpected";
  }));
record("P16 an extra component fails for every target",
  ALL.every((t) => {
    const p = clonePacket(); entryOf(p, t.key).creation_payload.components.push({ type: "footer", text: "x" });
    return loadCanonicalPayload(p, t).reason === "component_count_unexpected";
  }));
record("P17 a buttons block fails for every target",
  ALL.every((t) => {
    const p = clonePacket(); entryOf(p, t.key).creation_payload.components[0].buttons = [{ type: "QUICK_REPLY", text: "Hi" }];
    return loadCanonicalPayload(p, t).reason === "buttons_present";
  }));
record("P18 placeholder arity is enforced PER TARGET — adding one to a zero-variable ack fails",
  ALL.filter((t) => t.placeholders === 0).every((t) => {
    const p = clonePacket(); entryOf(p, t.key).creation_payload.components[0].text += " Ref {{1}}.";
    return loadCanonicalPayload(p, t).reason === "variable_shape_unexpected";
  }));
record("P19 removing the placeholder from a variable-bearing target fails",
  ALL.filter((t) => t.placeholders === 1).every((t) => {
    const p = clonePacket();
    const b = entryOf(p, t.key).creation_payload.components[0];
    b.text = b.text.replace(/\{\{1\}\}/, "there");
    return loadCanonicalPayload(p, t).reason === "variable_shape_unexpected";
  }));
record("P20 a zero-variable target must NOT carry an example block",
  ALL.filter((t) => t.placeholders === 0).every((t) => {
    const p = clonePacket();
    entryOf(p, t.key).creation_payload.components[0].example = { body_text: [["x"]] };
    return loadCanonicalPayload(p, t).reason === "body_shape_unexpected";
  }));
record("P21 a variable-bearing target must carry a correctly-sized example",
  ALL.filter((t) => t.placeholders === 1).every((t) => {
    const p = clonePacket();
    entryOf(p, t.key).creation_payload.components[0].example.body_text[0].push("extra");
    return loadCanonicalPayload(p, t).reason === "example_arity_unexpected";
  }));
record("P22 the pinned fingerprints equal the packet's committed fingerprints",
  ALL.every((t) => {
    const e = entryOf(packet, t.key);
    return e.payload_fingerprint === t.fingerprint
      && createHash("sha256").update(JSON.stringify(e.creation_payload)).digest("hex") === t.fingerprint;
  }));
record("P23 the committed packet still holds all five entries",
  ALL.every((t) => {
    const e = entryOf(packet, t.key);
    return e.submit_now === REQUIRED_PACKET_STATE.submitNow
      && e.local_state.approval_status === REQUIRED_PACKET_STATE.approvalStatus
      && e.local_state.submission_state === REQUIRED_PACKET_STATE.submissionState;
  }));
record("P24 the operator never WRITES submit_now", !/submit_now\s*=[^=]/.test(codeOnly));
record("P25 no payload is ever constructed from argv or env",
  !/creation_payload\s*=/.test(codeOnly) && !/components\s*:\s*\[/.test(codeOnly));

// ---------------------------------------------------------------------------
// PRE-STATE — R7K-R1 fail-closed rules, across all five targets.
// ---------------------------------------------------------------------------
record("S01 a proven empty array is ABSENT for every target",
  ALL.every((t) => stateFor(t, []) === HeldPreState.ABSENT));
record("S02 an exact APPROVED row is ALREADY_CREATED for every target",
  ALL.every((t) => stateFor(t, [rowFor(t)]) === HeldPreState.ALREADY_CREATED));
record("S03 an exact PENDING row is ALREADY_CREATED for every target",
  ALL.every((t) => stateFor(t, [rowFor(t, { status: "PENDING" })]) === HeldPreState.ALREADY_CREATED));
record("S04 an unsafe status refuses for every target",
  ALL.every((t) => stateFor(t, [rowFor(t, { status: "REJECTED" })]) === HeldPreState.PRESENT_OTHER_STATUS));
record("S05 a MARKETING category refuses for every target",
  ALL.every((t) => stateFor(t, [rowFor(t, { category: "MARKETING" })]) === HeldPreState.PRESENT_CATEGORY_MISMATCH));
record("S06 missing remote components refuse for every target",
  ALL.every((t) => {
    const r = rowFor(t); delete r.components;
    return stateFor(t, [r]) === HeldPreState.PRESENT_COMPONENTS_UNUSABLE;
  }));
record("S07 null remote components refuse for every target",
  ALL.every((t) => stateFor(t, [rowFor(t, { components: null })]) === HeldPreState.PRESENT_COMPONENTS_UNUSABLE));
record("S08 different remote content refuses for every target",
  ALL.every((t) => {
    const r = rowFor(t); r.components[0].text = "Totally different body.";
    return stateFor(t, [r]) === HeldPreState.PRESENT_CONTENT_MISMATCH;
  }));
record("S09 duplicate exact rows are AMBIGUOUS for every target",
  ALL.every((t) => stateFor(t, [rowFor(t), rowFor(t)]) === HeldPreState.AMBIGUOUS));
record("S10 a different-name row leaves the target ABSENT",
  ALL.every((t) => stateFor(t, [rowFor(t, { name: "qf_unrelated_v1" })]) === HeldPreState.ABSENT));
record("S11 a different-language row leaves the target ABSENT",
  ALL.every((t) => stateFor(t, [rowFor(t, { language: "hi" })]) === HeldPreState.ABSENT));
record("S12 one target's row never satisfies another target", (() => {
  const a = T.lead_received;
  const b = T.lead_assignment_alert;
  return stateFor(b, [rowFor(a)]) === HeldPreState.ABSENT
    && stateFor(a, [rowFor(b)]) === HeldPreState.ABSENT;
})());

const malformed200 = [
  ["body null", { ok: true, status: 200, body: null }],
  ["body {}", { ok: true, status: 200, body: {} }],
  ["body is an array", { ok: true, status: 200, body: [] }],
  ["body is a string", { ok: true, status: 200, body: "ok" }],
  ["data null", okGet({ data: null })],
  ["data {}", okGet({ data: {} })],
  ["data is a string", okGet({ data: "none" })],
  ["data contains null row", okGet({ data: [null] })],
  ["data contains a non-object row", okGet({ data: ["qf_lead_received_v1"] })],
  ["data contains an array row", okGet({ data: [[]] })],
  ["row without a name", okGet({ data: [{ language: "en", status: "APPROVED" }] })],
  ["row with a non-string name", okGet({ data: [{ name: 123, language: "en" }] })],
  ["row with an empty name", okGet({ data: [{ name: "", language: "en" }] })],
];
for (const [label, lookup] of malformed200) {
  record(`S13 malformed HTTP-200 (${label}) => UNREADABLE for every target`,
    ALL.every((t) => classifyPreState(lookup, t, payloadFor(t)).state === HeldPreState.UNREADABLE));
}
record("S14 a target-named row missing language => UNREADABLE for every target",
  ALL.every((t) => classifyPreState(okGet({ data: [{ name: t.providerName, status: "APPROVED" }] }), t, payloadFor(t)).state
    === HeldPreState.UNREADABLE));
record("S15 a failed GET => UNREADABLE for every target",
  ALL.every((t) => classifyPreState({ ok: false, status: 500, body: null }, t, payloadFor(t)).state === HeldPreState.UNREADABLE));
record("S16 EVERY malformed HTTP-200 case refuses at the decision layer — zero POST",
  ALL.every((t) => malformed200.every(([, lookup]) => decide({
    cli: parseCli(["--target", t.key, "--execute", OWNER_ACK_FLAG]),
    identity: validateIdentity(goodEnv()),
    payloadResult: loadCanonicalPayload(packet, t),
    preState: classifyPreState(lookup, t, payloadFor(t)).state,
  }).post === false)));
record("S17 the fail-open `? ... : []` fallback is absent from the source",
  !/Array\.isArray\(lookup\.body\?\.data\)\s*\?/.test(codeOnly)
  && !/\?\s*lookup\.body\.data\s*:\s*\[\]/.test(codeOnly)
  && /if \(!Array\.isArray\(body\.data\)\) return unreadable;/.test(codeOnly));
record("S18 no local-components fallback exists",
  !/row\.components\s*\?\?/.test(codeOnly)
  && !/\?\?\s*(expectedPayload|payloadResult)\.?(payload)?\.components/.test(codeOnly)
  && /components:\s*row\.components\s*\}/.test(codeOnly));

// ---------------------------------------------------------------------------
// DECISION
// ---------------------------------------------------------------------------
const decideFor = (t, argv, preState, over = {}) => decide({
  cli: parseCli(["--target", t.key, ...argv]),
  identity: over.identity ?? validateIdentity(goodEnv()),
  payloadResult: over.payloadResult ?? loadCanonicalPayload(packet, t),
  preState,
});
record("D01 ABSENT + both flags is the ONLY POST decision, for every target",
  ALL.every((t) => decideFor(t, ["--execute", OWNER_ACK_FLAG], HeldPreState.ABSENT).post === true));
record("D02 dry run never posts, for every target",
  ALL.every((t) => {
    const d = decideFor(t, [], HeldPreState.ABSENT);
    return d.post === false && d.outcome === Outcome.DRY_RUN_WOULD_POST;
  }));
record("D03 --execute alone never posts",
  ALL.every((t) => decideFor(t, ["--execute"], HeldPreState.ABSENT).post === false));
record("D04 owner flag alone never posts",
  ALL.every((t) => decideFor(t, [OWNER_ACK_FLAG], HeldPreState.ABSENT).post === false));
record("D05 ALREADY_CREATED never posts",
  ALL.every((t) => {
    const d = decideFor(t, ["--execute", OWNER_ACK_FLAG], HeldPreState.ALREADY_CREATED);
    return d.post === false && d.outcome === Outcome.ALREADY_CREATED;
  }));
record("D06 every refusing pre-state blocks the POST", (() => {
  const refusing = Object.values(HeldPreState).filter((s) => s !== HeldPreState.ABSENT && s !== HeldPreState.ALREADY_CREATED);
  return refusing.length >= 6 && ALL.every((t) => refusing.every((s) =>
    decideFor(t, ["--execute", OWNER_ACK_FLAG], s).post === false));
})());
record("D07 an unauthorised identity never posts",
  ALL.every((t) => decideFor(t, ["--execute", OWNER_ACK_FLAG], HeldPreState.ABSENT, {
    identity: validateIdentity({ ...goodEnv(), QF_META_WABA_ID: "1" }) }).post === false));
record("D08 a drifted payload never posts",
  ALL.every((t) => {
    const p = clonePacket(); entryOf(p, t.key).creation_payload.components[0].text += "!";
    return decideFor(t, ["--execute", OWNER_ACK_FLAG], HeldPreState.ABSENT, {
      payloadResult: loadCanonicalPayload(p, t) }).post === false;
  }));

// ---------------------------------------------------------------------------
// IDENTITY
// ---------------------------------------------------------------------------
record("V01 the exact staging triple passes; wrong ids fail",
  validateIdentity(goodEnv()).ok === true
  && validateIdentity({ ...goodEnv(), QF_META_WABA_ID: "27861262223494154" }).ok === false
  && validateIdentity({ ...goodEnv(), QF_META_APP_ID: "2097008694503518" }).ok === false
  && validateIdentity({ ...goodEnv(), QF_META_PHONE_NUMBER_ID: "1333595106493546" }).ok === false);
record("V02 live asset proof passes on the exact triple and fails when unreadable",
  classifyLiveAssets(goodAssets()).ok === true
  && classifyLiveAssets({ waba: { ok: false }, phones: { ok: false }, subs: { ok: false } }).ok === false);
record("V03 the operator declares NO second identity pin set — it imports R7B's",
  !/EXPECTED_IDENTITY_DIGESTS\s*=\s*Object\.freeze/.test(codeOnly)
  && /import\s*\{[\s\S]*?EXPECTED_IDENTITY_DIGESTS[\s\S]*?\}\s*from\s*["'][^"']*create-meta-staging-vendor-onboarding-reminder-once\.mjs["']/.test(codeOnly));
record("V04 no raw staging id literal appears in the operator",
  !new RegExp(REAL.waba).test(code) && !new RegExp(REAL.app).test(code) && !new RegExp(REAL.phone).test(code));
record("V05 the pinned digests match the public staging asset ids",
  sha256Hex(REAL.app) === EXPECTED_IDENTITY_DIGESTS.appId
  && sha256Hex(REAL.waba) === EXPECTED_IDENTITY_DIGESTS.wabaId
  && sha256Hex(REAL.phone) === EXPECTED_IDENTITY_DIGESTS.phoneNumberId);

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
record("T04 exactly one `await http.createOnce(` call exists",
  (codeOnly.match(/await http\.createOnce\(/g) ?? []).length === 1
  && (codeOnly.match(/createOnce/g) ?? []).length === 1);
record("T05 the PRE-STATE GET requests the explicit field set", (() => {
  const m = codeOnly.match(/const lookup = await http\.get\(\s*[\s\S]{0,240}?\);/);
  return m !== null && /fields=\$\{REQUIRED_TEMPLATE_FIELDS\}/.test(m[0])
    && /encodeURIComponent\(target\.providerName\)/.test(m[0]);
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
  /const confirmed = after\.state === HeldPreState\.ALREADY_CREATED;/.test(codeOnly));
record("T10 the create endpoint is the inherited message_templates POST only",
  !/fetch\(/.test(codeOnly) && !/https?:\/\/graph\.facebook\.com/.test(codeOnly)
  && (codeOnly.match(/method:\s*["'][A-Z]+["']/gi) ?? []).length === 0
  && /import\s*\{[\s\S]*?makeHttp[\s\S]*?\}\s*from\s*["'][^"']*create-meta-staging-vendor-onboarding-reminder-once\.mjs["']/.test(codeOnly));

// ---------------------------------------------------------------------------
// EXIT CODES + terminal catch
// ---------------------------------------------------------------------------
record("E01 CREATED / ALREADY_CREATED / DRY_RUN_WOULD_POST exit 0",
  exitCodeForOutcome(Outcome.CREATED) === 0
  && exitCodeForOutcome(Outcome.ALREADY_CREATED) === 0
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
record("E06 zero-post unexpected failure => REFUSED / exit 1",
  exitCodeForOutcome(terminalOutcome(0)) === 1);
record("E07 post-consumed unexpected failure => CREATE_AMBIGUOUS / exit 2",
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

// ---------------------------------------------------------------------------
// ERROR HANDLING / STRUCTURAL
// ---------------------------------------------------------------------------
record("X01 the operator reads e.subcode and never e.error_subcode",
  /e\.subcode/.test(codeOnly) && !/\.error_subcode/.test(codeOnly));
record("X02 only sanitized structured error fields are printed",
  /safeMetaError\(/.test(codeOnly)
  && !/JSON\.stringify\(res\.body/.test(codeOnly)
  && !/console\.log\([^)]*res\.body/.test(codeOnly));
record("X03 no secret or raw asset id is interpolated into output",
  !/\$\{[^}]*ACCESS_TOKEN/.test(codeOnly)
  && !/\$\{[^}]*QF_META_WABA_ID/.test(codeOnly)
  && !/\$\{[^}]*PHONE_NUMBER_ID/.test(codeOnly)
  && !/\$\{[^}]*APP_SECRET/.test(codeOnly)
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
  // Loops exist only in parseCli and classifyPreState — both pure, neither touches http.
  const pureFns = (codeNoStrings.match(/export function (parseCli|loadCanonicalPayload|classifyPreState)\([\s\S]*?\n\}/g) ?? []).join("\n");
  const totalFor = (codeNoStrings.match(/\bfor\s*\(/g) ?? []).length;
  const forInPure = (pureFns.match(/\bfor\s*\(/g) ?? []).length;
  return noWhile && noScheduler && noRetryIdentifier
    && totalFor > 0 && totalFor === forInPure
    && !/http\.|createOnce|fetch\(/.test(pureFns)
    && (codeNoStrings.match(/createOnce/g) ?? []).length === 1;
})());
record("F07 the structural scanners are live, not vacuous", (() => {
  const injected = `${codeOnly}\nconst c = createClient(); await c.rpc("x");\nawait fetch(u,{method:"DELETE"});`;
  return /supabase|createClient|\.rpc\(/i.test(injected)
    && /method:\s*["'](DELETE|PUT|PATCH)["']/i.test(injected)
    && !/supabase|createClient|\.rpc\(/i.test(codeOnly);
})());
record("F08 comment-stripping leaves substance and removes prose",
  codeOnly.length > 3000 && /export function parseCli\(/.test(codeOnly)
  && /DELETE \/ PUT \/ PATCH/.test(code) && !/DELETE \/ PUT \/ PATCH/.test(codeOnly));

// ---------------------------------------------------------------------------
// PRIOR PHASES UNCHANGED
// ---------------------------------------------------------------------------
record("Z01 R7B is unchanged",
  /TARGET_TEMPLATE_KEY = "vendor_onboarding_reminder"/.test(vendorSrc)
  && /"c6e95a38dde899f717999520082feddf4c91f2a33c84650c72538ef2c111199a"/.test(vendorSrc));
record("Z02 R7I is unchanged",
  /TARGET_TEMPLATE_KEY = "client_matching_update"/.test(r7iSrc)
  && /"c0930db5a9beee61de0076caf234b36f950554bc21c60b697845028a8d057e1c"/.test(r7iSrc));
record("Z03 R7K is unchanged",
  /TARGET_TEMPLATE_KEY = "client_lead_status_update"/.test(r7kSrc)
  && /"ce8982c652515e2434abb2159a4024a199de54cede0bd1f95552eb8d6270e7ac"/.test(r7kSrc));
record("Z04 HeldPreState extends R7B's PreState without redefining any member",
  Object.entries(PreState).every(([k, v]) => HeldPreState[k] === v) && Object.isFrozen(HeldPreState));

console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
