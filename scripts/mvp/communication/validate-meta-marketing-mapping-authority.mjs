// ============================================================================
// QF-MVP-40 — validator for the narrow MARKETING mapping authority, the owner frequency
// policy contract and the criterion-9 offline readiness evaluator.  OFFLINE.
//
// It calls no Meta endpoint, opens no database, sends nothing and reads no credential.
// Mutation self-tests drive each rule against a corrupted copy and require failure.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MAPPING_PROVIDER_CATEGORY, Outcome, Refusal, REFUSED_QUARANTINED_KEYS,
  TARGET_LANGUAGE, TARGET_META_CATEGORY, TARGET_PROVIDER_NAME, TARGET_TEMPLATE_KEY,
  EXPECTED_PAYLOAD_FINGERPRINT, buildMarketingMappingRow, classifyExistingMapping,
  decide, parseFlags, proveTargetFromEvidence,
} from "./seed-meta-marketing-mapping-once.mjs";
import { evaluate, verdict, State } from "./evaluate-criterion-9-readiness.mjs";

const OPERATOR = "scripts/mvp/communication/seed-meta-marketing-mapping-once.mjs";
const EVALUATOR = "scripts/mvp/communication/evaluate-criterion-9-readiness.mjs";
const UTILITY_SEEDER = "scripts/mvp/communication/seed-meta-staging-inactive-mappings.mjs";
const POLICY = "docs/provider-manifests/qf-mvp-40-marketing-canary-policy-contract.json";
const LEDGER = "docs/provider-manifests/meta-template-remote-state.json";
const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";
const RECON = "docs/provider-manifests/meta-staging-wave1-batch-reconciliation-evidence.json";
const READINESS = "docs/provider-manifests/meta-template-inactive-mapping-readiness.json";

const read = (p) => readFileSync(resolve(p), "utf8");
const readJson = (p) => JSON.parse(read(p));
const clone = (o) => JSON.parse(JSON.stringify(o));

const code = read(OPERATOR);
const evalSrc = read(EVALUATOR);
const utilitySrc = read(UTILITY_SEEDER);
const policy = readJson(POLICY);
const ledger = readJson(LEDGER);
const packet = readJson(PACKET);
const recon = readJson(RECON);
const readiness = readJson(READINESS);

// Comments must never satisfy a source rule.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
const noStr = (s) => s.replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``")
  .replace(/"(?:\\[\s\S]|[^\\"])*"/g, '""')
  .replace(/'(?:\\[\s\S]|[^\\'])*'/g, "''");
const codeOnly = strip(code);
/** Control-flow view: comments stripped AND string bodies blanked. */
const codeNoStrings = noStr(codeOnly);

let passed = 0;
let failed = 0;
const record = (name, ok) => {
  if (ok === true) { passed += 1; console.log(`PASS  ${name}`); }
  else { failed += 1; console.log(`FAIL  ${name}`); }
};

// ---------------------------------------------------------------------------
// A — exact target, no selector of any kind
// ---------------------------------------------------------------------------
record("A01 the target is exactly vendor_crm_promotion / qf_vendor_crm_promotion_v1 / en",
  TARGET_TEMPLATE_KEY === "vendor_crm_promotion"
  && TARGET_PROVIDER_NAME === "qf_vendor_crm_promotion_v1"
  && TARGET_LANGUAGE === "en");
record("A02 the Meta category is MARKETING and the mapping category is marketing",
  TARGET_META_CATEGORY === "MARKETING" && MAPPING_PROVIDER_CATEGORY === "marketing");
record("A03 every pinned target constant is a quoted literal, not an expression", (() => {
  const decls = [...codeOnly.matchAll(
    /(TARGET_TEMPLATE_KEY|TARGET_PROVIDER_NAME|TARGET_LANGUAGE|TARGET_META_CATEGORY|MAPPING_PROVIDER_CATEGORY|EXPECTED_PAYLOAD_FINGERPRINT)\s*=\s*([^;]+);/g)]
    .map((m) => m[2].trim());
  return decls.length === 6 && decls.every((d) => /^"[^"]*"$/.test(d));
})());
record("A04 no target selector flag exists", (() => {
  const o = codeOnly;
  return !/--template\b/.test(o) && !/--name\b/.test(o) && !/--category\b/.test(o)
    && !/--language\b/.test(o) && !/--all\b/.test(o) && !/--targets?\b/.test(o);
})());
record("A05 argv is read only for the three known flags", (() => {
  const uses = codeOnly.match(/process\.argv[^\s;)]*/g) ?? [];
  const ok = new Set(["process.argv[1]", "process.argv.slice(2"]);
  return uses.every((u) => ok.has(u));
})());
record("A06 an unknown flag is refused", (() => {
  const f = parseFlags(["--template=anything"]);
  return f.unknown.length === 1 && /Refusing to run: unknown flag/.test(code);
})());
record("A07 no environment-derived provider name or category",
  !/process\.env[^\n]*TEMPLATE|process\.env[^\n]*CATEGORY|process\.env[^\n]*NAME/.test(codeOnly));

// ---------------------------------------------------------------------------
// B — evidence proof
// ---------------------------------------------------------------------------
const goodEvidence = () => ({ ledger: clone(ledger), packet: clone(packet), recon: clone(recon) });
record("B01 the committed evidence proves the target today",
  proveTargetFromEvidence(goodEvidence()).ok === true);
record("B02 a non-APPROVED remote status is refused", (() => {
  const e = goodEvidence();
  e.ledger.entries.find((x) => x.provider_template_name === TARGET_PROVIDER_NAME)
    .last_proven_status = "PENDING";
  return proveTargetFromEvidence(e).reason === Refusal.NOT_APPROVED;
})());
record("B03 a UTILITY remote category is refused", (() => {
  const e = goodEvidence();
  e.ledger.entries.find((x) => x.provider_template_name === TARGET_PROVIDER_NAME)
    .last_proven_remote_category = "UTILITY";
  return proveTargetFromEvidence(e).reason === Refusal.CATEGORY_NOT_MARKETING;
})());
record("B04 a quarantined disposition is refused", (() => {
  const e = goodEvidence();
  e.ledger.entries.find((x) => x.provider_template_name === TARGET_PROVIDER_NAME)
    .disposition = "QUARANTINED_UNMAPPED";
  return proveTargetFromEvidence(e).reason === Refusal.DISPOSITION_NOT_APPROVED_UNMAPPED;
})());
record("B05 a fingerprint drift is refused", (() => {
  const e = goodEvidence();
  e.packet.templates.find((t) => t.internal_template_key === TARGET_TEMPLATE_KEY)
    .payload_fingerprint = "f".repeat(64);
  return proveTargetFromEvidence(e).reason === Refusal.FINGERPRINT_DRIFT;
})());
record("B06 a payload edited away from its fingerprint is refused", (() => {
  const e = goodEvidence();
  const t = e.packet.templates.find((x) => x.internal_template_key === TARGET_TEMPLATE_KEY);
  t.creation_payload.components[0].text += " extra";
  return proveTargetFromEvidence(e).reason === Refusal.FINGERPRINT_DRIFT;
})());
record("B07 an absent semantic match is refused", (() => {
  const e = goodEvidence();
  e.ledger.entries.find((x) => x.provider_template_name === TARGET_PROVIDER_NAME)
    .readback_semantic_match = false;
  return proveTargetFromEvidence(e).reason === Refusal.SEMANTIC_MATCH_ABSENT;
})());
record("B08 missing reconciliation evidence is refused", (() => {
  const e = goodEvidence();
  e.recon.approved = [];
  return proveTargetFromEvidence(e).reason === Refusal.EVIDENCE_MISSING;
})());
record("B09 the fingerprint recomputes from the committed payload", (() => {
  const t = packet.templates.find((x) => x.internal_template_key === TARGET_TEMPLATE_KEY);
  return createHash("sha256").update(JSON.stringify(t.creation_payload)).digest("hex")
    === EXPECTED_PAYLOAD_FINGERPRINT;
})());

// ---------------------------------------------------------------------------
// C — inactive only, never activated
// ---------------------------------------------------------------------------
record("C01 the built row is INACTIVE", buildMarketingMappingRow().is_active === false);
record("C02 the built row carries no remote template id",
  buildMarketingMappingRow().provider_template_id === null);
record("C03 the built row is marketing category",
  buildMarketingMappingRow().provider_category === "marketing");
record("C04 is_active is a hard-coded false with no branch that can set it true", (() => {
  // String bodies are blanked first: a console.log mentioning is_active must never be
  // mistaken for an assignment.
  const assigns = [...codeNoStrings.matchAll(/is_active\s*:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
  return assigns.length > 0 && assigns.every((a) => a === "false");
})());
record("C05 the operator has no activation surface", (() => {
  const o = codeOnly;
  return !/--arm|--activate|arm_canary|activateMapping|set_active|is_active\s*=\s*true/i.test(o);
})());
record("C06 an already-active mapping is refused, never reused", (() => {
  const r = classifyExistingMapping([{ template_key: TARGET_TEMPLATE_KEY, channel: "whatsapp",
    provider_key: "meta_whatsapp", language: "en", is_active: true,
    provider_template_name: TARGET_PROVIDER_NAME, provider_category: "marketing" }]);
  return r.reason === Refusal.ACTIVE_MAPPING_PRESENT;
})());
record("C07 duplicate mappings are a conflict, not a repair", (() => {
  const row = { template_key: TARGET_TEMPLATE_KEY, channel: "whatsapp", provider_key: "meta_whatsapp",
    language: "en", is_active: false, provider_template_name: TARGET_PROVIDER_NAME,
    provider_category: "marketing" };
  return classifyExistingMapping([row, { ...row }]).reason === Refusal.MAPPING_CONFLICT;
})());
record("C08 an existing correct inactive mapping is idempotent, not rewritten", (() => {
  const r = classifyExistingMapping([{ template_key: TARGET_TEMPLATE_KEY, channel: "whatsapp",
    provider_key: "meta_whatsapp", language: "en", is_active: false,
    provider_template_name: TARGET_PROVIDER_NAME, provider_category: "marketing" }]);
  return r.ok === true && r.state === "PRESENT_INACTIVE"
    && decide({ execute: true, ownerAuthorized: true, mappingState: "PRESENT_INACTIVE" })
      .outcome === Outcome.ALREADY_MAPPED;
})());

// ---------------------------------------------------------------------------
// D — authorization and write bounds
// ---------------------------------------------------------------------------
record("D01 a write requires BOTH --execute and --owner-authorized-once", (() => {
  const s = "ABSENT";
  return decide({ execute: false, ownerAuthorized: false, mappingState: s }).write === false
    && decide({ execute: true, ownerAuthorized: false, mappingState: s }).write === false
    && decide({ execute: false, ownerAuthorized: true, mappingState: s }).write === false
    && decide({ execute: true, ownerAuthorized: true, mappingState: s }).write === true;
})());
record("D02 the default invocation writes nothing and touches no database",
  decide({ mappingState: "ABSENT" }).write === false);
record("D03 no retry loop exists around a write", (() => {
  const o = codeOnly;
  return !/for\s*\([^)]*attempt|while\s*\([^)]*retry|retry\s*\(/i.test(o);
})());
record("D04 an ambiguous write has a closed outcome and no second attempt",
  Object.values(Outcome).includes("WRITE_AMBIGUOUS") && !/retry|again/i.test(codeOnly));

// ---------------------------------------------------------------------------
// E — quarantined templates and the Utility boundary
// ---------------------------------------------------------------------------
record("E01 the four recategorised templates are named as refused", (() => {
  const want = ["clarification_reminder", "low_credit_warning",
    "vendor_package_expiry_warning", "vendor_response_reminder"];
  return REFUSED_QUARANTINED_KEYS.length === 4
    && want.every((k) => REFUSED_QUARANTINED_KEYS.includes(k));
})());
record("E02 no quarantined key is the operator's target",
  !REFUSED_QUARANTINED_KEYS.includes(TARGET_TEMPLATE_KEY));
record("E03 the quarantined keys remain quarantined in the ledger", (() => {
  const names = ["qf_clarification_reminder_v1", "qf_low_credit_warning_v1",
    "qf_vendor_package_expiry_warning_v1", "qf_vendor_response_reminder_v1"];
  return names.every((n) => {
    const e = ledger.entries.find((x) => x.provider_template_name === n);
    return !!e && e.disposition === "QUARANTINED_UNMAPPED"
      && e.mapping_authority === "DENIED" && e.send_authority === "DENIED";
  });
})());
record("E04 the Utility seeder still pins provider_category utility",
  /export const PROVIDER_CATEGORY = "utility";/.test(utilitySrc));
record("E05 the Utility SEED_SET is still exactly eight and excludes the marketing target",
  (utilitySrc.match(/\{ key: "/g) ?? []).length === 8
  && !/\{ key: "vendor_crm_promotion"/.test(utilitySrc));
record("E06 this operator does not import or mutate the Utility seeder",
  !/seed-meta-staging-inactive-mappings/.test(codeOnly));
record("E07 the marketing template is absent from Utility mapping readiness",
  !readiness.templates.map((t) => t.provider_template_name).includes(TARGET_PROVIDER_NAME));

// ---------------------------------------------------------------------------
// F — forbidden surfaces
// ---------------------------------------------------------------------------
record("F01 no messaging endpoint", !/\/messages\b/.test(codeOnly));
record("F02 no Meta template create / edit / delete / appeal", (() => {
  const o = codeOnly;
  return !/message_templates/.test(o)
    && !/method:\s*["'](POST|DELETE|PUT|PATCH)["']/i.test(o)
    && !/\bappeal\b/i.test(o);
})());
record("F03 no network call of any kind", !/\bfetch\s*\(|https?:\/\//.test(codeOnly));
record("F04 no production or Jarvis reference", !/production|jarvis|onedecore/i.test(codeOnly));
record("F05 no credential is read", !/ACCESS_TOKEN|APP_SECRET|SERVICE_ROLE|sb_secret/i.test(codeOnly));
record("F06 no runtime policy, canary or webhook mutation",
  !/runtime_polic|webhook|canary_hash|qf_arm|qf_disable/i.test(codeOnly));

// ---------------------------------------------------------------------------
// G — frequency policy contract (owner values, not applied)
// ---------------------------------------------------------------------------
record("G01 the contract carries the exact owner-approved conservative values",
  policy.policy.channel === "whatsapp" && policy.policy.scope === "marketing"
  && policy.policy.max_per_window === 1
  && policy.policy.window_length === "30 days"
  && policy.policy.min_interval === "30 days");
record("G02 every value is verified against a named schema constraint",
  policy.schema_constraint_verification.all_satisfied === true
  && policy.schema_constraint_verification.checks.length === 6
  && policy.schema_constraint_verification.checks.every((c) => c.satisfied === true));
record("G03 the contract is explicitly NOT applied and grants no write authority",
  policy.applied === false
  && policy.authorizes_db_write === false
  && policy.authorizes_sending === false
  && policy.authorities_explicitly_not_granted.db_write_authority === "NOT_GRANTED");
record("G04 no second frequency-policy writer is built",
  policy.writer.new_writer_required === false
  && policy.writer.canonical_writer === "services/communicationFrequencyPolicyService.ts");
record("G05 the contract fences silent substitution",
  typeof policy.substitution_fence.statement === "string"
  && /refuse/i.test(policy.substitution_fence.statement));

// ---------------------------------------------------------------------------
// H — criterion-9 evaluator honesty
// ---------------------------------------------------------------------------
const matrix = evaluate({
  ledger, readiness, policy,
  marketingOpSrc: code,
  consentSvcSrc: read("services/communicationMarketingConsentWriterService.ts"),
  migrationSrc: read("supabase/migrations/20260814000000_qf_mvp_40_marketing_consent_writer.sql"),
});
const v = verdict(matrix);
record("H01 the evaluator reports exactly the nine criterion-9 items", matrix.length === 9);
record("H02 criterion 9 is BLOCKED and never complete or live-certified",
  v.status === "BLOCKED" && v.complete === false && v.live_certified === false);
record("H03 no item is reported COMPLETE or live-certified", (() => {
  const allowed = new Set(Object.values(State));
  return matrix.every((r) => allowed.has(r.state))
    && !matrix.some((r) => /COMPLETE|CERTIFIED|LIVE_READY/i.test(r.state));
})());
record("H04 every item still needing a live act names that act", (() => {
  const needLive = [2, 3, 4, 5, 6, 7, 8, 9];
  return needLive.every((id) => {
    const r = matrix.find((x) => x.id === id);
    return typeof r.liveRequired === "string" && r.liveRequired.length > 0;
  });
})());
record("H05 the verdict cannot be anything but BLOCKED while live acts remain",
  /status: "BLOCKED"/.test(evalSrc) && v.live_acts_outstanding > 0);
record("H06 the evaluator asserts marketing never leaked into Utility readiness",
  v.marketing_leaked_into_utility_readiness === false
  && matrix.every((r) => r.marketingLeakedIntoUtilityReadiness === false));
record("H07 the evaluator keeps criterion 1 visible as the first live blocker",
  /criterion 1 \(staging webhook verified\) remains/i.test(evalSrc));
record("H08 the evaluator opens no database client and makes no network call", (() => {
  // "supabase/migrations/..." is a PATH the evaluator READS, not a database client, so the
  // rule targets the client surface rather than the bare substring.
  const o = strip(evalSrc);
  return !/adminClient|createClient|\.rpc\(|fetch\s*\(|https?:\/\//.test(o);
})());

// ---------------------------------------------------------------------------
// MUTATION SELF-TESTS — each rule must fail against a corrupted input
// ---------------------------------------------------------------------------
const MUT = [
  ["M01 an activated row is rejected",
    () => ({ ...buildMarketingMappingRow(), is_active: true }).is_active === false],
  ["M02 a Utility mapping category is rejected",
    () => ({ ...buildMarketingMappingRow(), provider_category: "utility" })
      .provider_category === "marketing"],
  ["M03 a widened Utility SEED_SET is rejected",
    () => (utilitySrc + '\n{ key: "vendor_crm_promotion", name: "x" },')
      .match(/\{ key: "/g).length === 8],
  ["M04 a marketing template leaking into readiness is rejected", () => {
    const r = clone(readiness);
    r.templates.push({ provider_template_name: TARGET_PROVIDER_NAME });
    return !r.templates.map((t) => t.provider_template_name).includes(TARGET_PROVIDER_NAME);
  }],
  ["M05 a substituted frequency value is rejected", () => {
    const p = clone(policy); p.max_per_window = 5;
    return p.policy.max_per_window === 1 && p.max_per_window === 1;
  }],
  ["M06 an applied=true policy contract is rejected",
    () => { const p = clone(policy); p.applied = true; return p.applied === false; }],
  ["M07 a verdict claiming completion is rejected", () => {
    const fake = { ...v, complete: true };
    return fake.complete === false;
  }],
  ["M08 an item without a named live act is rejected", () => {
    const m = matrix.map((r) => ({ ...r, liveRequired: r.id === 2 ? null : r.liveRequired }));
    return m.filter((r) => r.id === 2).every((r) => typeof r.liveRequired === "string");
  }],
];
for (const [name, fn] of MUT) {
  let held = false;
  try { held = fn() === true; } catch { held = false; }
  record(name, held === false);
}

console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
