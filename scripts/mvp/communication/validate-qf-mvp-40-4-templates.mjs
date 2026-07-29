// ============================================================================
// QF-MVP-40.4 — Meta template catalogue validator.  OFFLINE. READ-ONLY.
//
// Validates docs/provider-manifests/whatsapp-template-submission-manifest.json.
// Contacts no database, no provider and no network; reads no credential. It asserts only
// properties that must hold BEFORE anything is submitted to Meta.
//
// Every rule below is followed by MUTATION SELF-TESTS: the rule is re-run against a deliberately
// corrupted copy of the manifest in memory and must FAIL. A validator that cannot fail is not a
// validator, and this file refuses to pose as one.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MANIFEST = "docs/provider-manifests/whatsapp-template-submission-manifest.json";
const DRAFT = "DRAFT_NOT_SUBMITTED";

const results = [];
const add = (name, ok, detail) => results.push({ name, ok: ok === true, detail: detail ?? "" });

function load() {
  return JSON.parse(readFileSync(resolve(MANIFEST), "utf8"));
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const allEntries = (m) => Object.values(m.groups).flat();

// ----------------------------------------------------------------------------
// Rule implementations — pure functions of the manifest, so a mutated copy can be fed in.
// ----------------------------------------------------------------------------

/** {{n}} occurrences in a body, in order of appearance. */
function bodyVars(body) {
  return [...String(body).matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
}

const R = {
  uniqueKeys(m) {
    const keys = allEntries(m).map((t) => t.internal_template_key);
    return new Set(keys).size === keys.length;
  },

  uniqueProviderNames(m) {
    // Unassigned (null) is expected pre-approval; any ASSIGNED name must be unique.
    const named = allEntries(m).map((t) => t.provider_template_name).filter((n) => n !== null && n !== undefined);
    return new Set(named).size === named.length;
  },

  variableNumbering(m) {
    // Declared keys must be exactly 1..N with no gaps and no zero/negative index.
    return allEntries(m).every((t) => {
      const nums = Object.keys(t.variables_schema ?? {}).map(Number).sort((a, b) => a - b);
      return nums.every((n, i) => Number.isInteger(n) && n === i + 1);
    });
  },

  noUndeclaredVariables(m) {
    return allEntries(m).every((t) => {
      const declared = new Set(Object.keys(t.variables_schema ?? {}).map(Number));
      return bodyVars(t.body_spec).every((n) => declared.has(n));
    });
  },

  noUnusedDeclaredVariables(m) {
    return allEntries(m).every((t) => {
      const used = new Set(bodyVars(t.body_spec));
      return Object.keys(t.variables_schema ?? {}).map(Number).every((n) => used.has(n));
    });
  },

  validCategoryAndRecipient(m) {
    const CATEGORIES = new Set(["authentication", "utility", "marketing"]);
    const RECIPIENTS = new Set(["client", "vendor", "admin", "system", "client_or_vendor"]);
    const SCOPES = new Set(["authentication", "transactional", "marketing"]);
    return allEntries(m).every((t) => {
      if (!CATEGORIES.has(t.category)) return false;
      const q = t.qf_mvp_40;
      if (!q) return false;
      return RECIPIENTS.has(q.recipient_type) && SCOPES.has(q.consent_scope)
        && typeof q.purpose === "string" && q.purpose.length > 0;
    });
  },

  /** A marketing-category template must not hide behind a transactional/authentication scope. */
  marketingScopeIntegrity(m) {
    return allEntries(m).every((t) =>
      t.category !== "marketing" || t.qf_mvp_40?.consent_scope === "marketing");
  },

  /** ...and the converse: a marketing consent scope must not be attached to a non-marketing category. */
  marketingCategoryIntegrity(m) {
    return allEntries(m).every((t) =>
      t.qf_mvp_40?.consent_scope !== "marketing" || t.category === "marketing");
  },

  /** STOP/START/HELP must never carry promotional content. */
  consentAcksNotPromotional(m) {
    const PROMO = /\b(offer|discount|sale|deal|promo|promotion|upgrade now|buy|limited time|hurry)\b/i;
    const acks = allEntries(m).filter((t) => t.internal_template_key.startsWith("consent_"));
    if (acks.length !== 3) return false;
    return acks.every((t) => !PROMO.test(t.body_spec) && t.category !== "marketing");
  },

  /** The vendor lead offer must not present itself as a completed assignment. */
  leadOfferIsNotAssignment(m) {
    const t = allEntries(m).find((x) => x.internal_template_key === "vendor_new_lead");
    if (!t) return false;
    const body = t.body_spec.toLowerCase();
    const claimsAssignment = /(has been assigned|you have been assigned|assigned to you|lead is yours)/.test(body);
    return !claimsAssignment && /offer/.test(body);
  },

  allDraft(m) {
    return allEntries(m).every((t) =>
      t.submission_state === DRAFT && t.approval_status === "draft" && t.provider_template_id === null);
  },

  /** Nothing in the manifest may assert an active/approved provider mapping. */
  noActiveMapping(m) {
    const raw = JSON.stringify(m).toLowerCase();
    if (/"(approval_status|submission_state)"\s*:\s*"(approved|active|submitted)"/.test(raw)) return false;
    return allEntries(m).every((t) => t.binding_contract?.binding_readiness !== "active");
  },

  /** Example fixtures must be fake: no digits that could be a phone number, no @, no real-looking id. */
  fixturesHaveNoPii(m) {
    const PHONE = /\+?\d[\d\s-]{7,}/;
    const EMAIL = /@/;
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    return allEntries(m).every((t) => {
      const fx = JSON.stringify(t.qf_mvp_40?.example_fixture ?? {});
      return !PHONE.test(fx) && !EMAIL.test(fx) && !UUID.test(fx);
    });
  },

  deterministicOrdering(m) {
    const groupNames = Object.keys(m.groups);
    const groupsSorted = groupNames.every((n, i) => i === 0 || groupNames[i - 1] <= n);
    const entriesSorted = Object.values(m.groups).every((g) =>
      g.every((t, i) => i === 0 || g[i - 1].internal_template_key <= t.internal_template_key));
    return groupsSorted && entriesSorted;
  },

  /**
   * Fingerprint inputs must be STABLE and fully present. lib/communication/providerMappingFingerprint
   * hashes the resolved template's identity + content, so every field feeding it must be declared
   * here and must not be undefined — an undefined field would hash differently per environment.
   */
  fingerprintInputsStable(m) {
    return allEntries(m).every((t) =>
      typeof t.internal_template_key === "string" && t.internal_template_key.length > 0 &&
      typeof t.language === "string" && t.language.length > 0 &&
      typeof t.category === "string" && t.category.length > 0 &&
      typeof t.body_spec === "string" && t.body_spec.length > 0 &&
      t.variables_schema !== undefined && t.variables_schema !== null);
  },

  /** Every locked 40.4 family is represented. */
  requiredFamiliesPresent(m) {
    const keys = new Set(allEntries(m).map((t) => t.internal_template_key));
    const required = [
      "lead_received", "clarification_request", "clarification_reminder",
      "lead_assignment_alert", "client_lead_status_update", "client_nurture_followup",
      "vendor_new_lead", "vendor_response_reminder", "vendor_onboarding_reminder",
      "vendor_package_expiry_warning", "low_credit_warning", "vendor_crm_promotion",
      "consent_stop_acknowledgement", "consent_start_acknowledgement", "consent_help_response",
    ];
    return required.every((k) => keys.has(k));
  },

  /** The ack template keys are fixed by code and may not drift from it. */
  ackKeysMatchCode(m) {
    const src = readFileSync(resolve("lib/communication/consentCommandResponse.ts"), "utf8");
    const keys = ["consent_stop_acknowledgement", "consent_start_acknowledgement", "consent_help_response"];
    const manifestKeys = new Set(allEntries(m).map((t) => t.internal_template_key));
    return keys.every((k) => src.includes(`"${k}"`) && manifestKeys.has(k));
  },
};

// ----------------------------------------------------------------------------
// Run every rule against the real manifest.
// ----------------------------------------------------------------------------
const manifest = load();
const RULES = [
  ["T1  internal template keys are unique", R.uniqueKeys],
  ["T2  assigned provider template names are unique", R.uniqueProviderNames],
  ["T3  declared variables are numbered 1..N with no gaps", R.variableNumbering],
  ["T4  no body variable is undeclared", R.noUndeclaredVariables],
  ["T5  no declared variable is unused", R.noUnusedDeclaredVariables],
  ["T6  category / recipient / consent scope are all valid", R.validCategoryAndRecipient],
  ["T7  a marketing category requires the marketing consent scope", R.marketingScopeIntegrity],
  ["T8  a marketing consent scope requires the marketing category", R.marketingCategoryIntegrity],
  ["T9  STOP/START/HELP carry no promotional content", R.consentAcksNotPromotional],
  ["T10 the vendor lead offer never claims an assignment", R.leadOfferIsNotAssignment],
  ["T11 every entry is DRAFT_NOT_SUBMITTED with no provider template id", R.allDraft],
  ["T12 no active or approved provider mapping is asserted", R.noActiveMapping],
  ["T13 example fixtures contain no PII", R.fixturesHaveNoPii],
  ["T14 groups and entries are deterministically ordered", R.deterministicOrdering],
  ["T15 provider-mapping fingerprint inputs are present and stable", R.fingerprintInputsStable],
  ["T16 every locked QF-MVP-40.4 family is represented", R.requiredFamiliesPresent],
  ["T17 consent ack keys match lib/communication/consentCommandResponse.ts", R.ackKeysMatchCode],
];
for (const [name, fn] of RULES) add(name, fn(manifest));

// ----------------------------------------------------------------------------
// MUTATION SELF-TESTS — each rule must FAIL on a manifest that violates it.
// ----------------------------------------------------------------------------
const MUTATIONS = [
  ["M1  duplicate key is rejected", R.uniqueKeys, (m) => {
    m.groups.marketing.push(clone(m.groups.marketing[0])); }],
  ["M2  duplicate assigned provider name is rejected", R.uniqueProviderNames, (m) => {
    m.groups.authentication[0].provider_template_name = "dup";
    m.groups.authentication[1].provider_template_name = "dup"; }],
  ["M3  gap in variable numbering is rejected", R.variableNumbering, (m) => {
    const t = m.groups.transactional_business.find((x) => Object.keys(x.variables_schema).length === 2);
    t.variables_schema["5"] = t.variables_schema["2"]; delete t.variables_schema["2"]; }],
  ["M4  undeclared body variable is rejected", R.noUndeclaredVariables, (m) => {
    m.groups.transactional_business[0].body_spec += " {{9}}"; }],
  ["M5  unused declared variable is rejected", R.noUnusedDeclaredVariables, (m) => {
    m.groups.transactional_business[0].variables_schema["9"] = { type: "text" }; }],
  ["M6  invalid category is rejected", R.validCategoryAndRecipient, (m) => {
    m.groups.transactional_business[0].category = "promotional"; }],
  ["M7  marketing category with transactional scope is rejected", R.marketingScopeIntegrity, (m) => {
    m.groups.marketing[0].qf_mvp_40.consent_scope = "transactional"; }],
  ["M8  marketing scope on a utility category is rejected", R.marketingCategoryIntegrity, (m) => {
    m.groups.transactional_business[0].qf_mvp_40.consent_scope = "marketing"; }],
  ["M9  promotional content in a consent ack is rejected", R.consentAcksNotPromotional, (m) => {
    m.groups.consent_service[0].body_spec += " Special discount just for you!"; }],
  ["M10 a lead offer claiming assignment is rejected", R.leadOfferIsNotAssignment, (m) => {
    const t = m.groups.transactional_business.find((x) => x.internal_template_key === "vendor_new_lead");
    t.body_spec = "This lead has been assigned to you."; }],
  ["M11 a non-draft entry is rejected", R.allDraft, (m) => {
    m.groups.marketing[0].submission_state = "APPROVED"; }],
  ["M12 an active binding readiness is rejected", R.noActiveMapping, (m) => {
    m.groups.marketing[0].binding_contract.binding_readiness = "active"; }],
  ["M13 a phone number in a fixture is rejected", R.fixturesHaveNoPii, (m) => {
    m.groups.marketing[0].qf_mvp_40.example_fixture["1"] = "+91 98765 43210"; }],
  ["M14 out-of-order entries are rejected", R.deterministicOrdering, (m) => {
    m.groups.transactional_business.reverse(); }],
  ["M15 a missing fingerprint input is rejected", R.fingerprintInputsStable, (m) => {
    m.groups.marketing[0].body_spec = ""; }],
  ["M16 a missing required family is rejected", R.requiredFamiliesPresent, (m) => {
    m.groups.marketing.length = 0; }],
  ["M17 an ack key that drifts from code is rejected", R.ackKeysMatchCode, (m) => {
    m.groups.consent_service[0].internal_template_key = "consent_stop_ack_renamed"; }],
];
for (const [name, fn, mutate] of MUTATIONS) {
  const copy = clone(manifest);
  mutate(copy);
  add(name, fn(copy) === false);
}

// ----------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
const total = sum(manifest);
function sum(m) { return Object.values(m.groups).reduce((a, g) => a + g.length, 0); }
console.log(`\nTemplates: ${total} across ${Object.keys(manifest.groups).length} groups`);
console.log(`Summary: ${results.length - failed.length} passed, ${failed.length} failed ` +
  `(rules: ${RULES.length}, mutation self-tests: ${MUTATIONS.length}).`);
process.exit(failed.length === 0 ? 0 : 1);
