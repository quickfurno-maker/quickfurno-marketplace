// ============================================================================
// QF-MVP-40.4-R / 40.6 — template ↔ consent-registry reconciliation validator.
//
// OFFLINE. Reads the manifest and the real registry module (transpiled), asserts they
// agree, and proves the special evidence-bound acknowledgement boundary holds.
// No database, no network, no credential, no provider call.
//
// Mutation self-tests drive each rule against a corrupted copy and require it to FAIL.
// ============================================================================

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MANIFEST = "docs/provider-manifests/whatsapp-template-submission-manifest.json";
const REGISTRY_SRC = "lib/communication/outboundConsentScope.ts";
const ACK_SRC = "lib/communication/consentCommandResponse.ts";
const DOC = "docs/QF-MVP-40-5-6-7-TRANSPORT-COMPLETION.md";

const ROOT = process.cwd();
const ACK_KEYS = Object.freeze(["consent_stop_acknowledgement", "consent_start_acknowledgement", "consent_help_response"]);
const FOUNDER_MARKETING = Object.freeze(["client_nurture_followup", "dormant_requirement_reactivation"]);
/**
 * QF-MVP-40.10E: the closed set is now TWO templates — Wave 0 consent_help_response and
 * the Wave 1 canary lead_received, both APPROVED by Meta as UTILITY and both HELD from
 * creation. It is expressed as a SET so that admitting a third approval must be a
 * deliberate edit here, not something a per-key test silently tolerates.
 */
const CLOSED_KEYS_40_10E = Object.freeze(["consent_help_response", "lead_received"]);

const results = [];
const add = (name, ok, detail) => results.push({ name, ok: ok === true, detail: detail ?? "" });
const clone = (o) => JSON.parse(JSON.stringify(o));

// --- transpile the real registry so assertions run against executable behaviour -------------
const outDir = mkdtempSync(join(tmpdir(), "qf-40-6-"));
let R;
try {
  const tscfg = join(outDir, "tsconfig.json");
  writeFileSync(tscfg, JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "ES2020", moduleResolution: "node", skipLibCheck: true,
      esModuleInterop: true, strict: true, types: ["node"], lib: ["ES2021"],
      typeRoots: [resolve(ROOT, "node_modules/@types")],
      outDir, rootDir: ROOT, baseUrl: ROOT,
    },
    files: [resolve(ROOT, REGISTRY_SRC)],
  }));
  execFileSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", tscfg],
    { stdio: "pipe", cwd: ROOT });
  const req = createRequire(pathToFileURL(join(ROOT, "noop.js")));
  R = req(join(outDir, "lib/communication/outboundConsentScope.js"));
} catch (e) {
  console.error("FATAL: could not transpile the consent-scope registry.");
  console.error(e && e.stdout ? e.stdout.toString() : e);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(resolve(MANIFEST), "utf8"));
const registrySrc = readFileSync(resolve(REGISTRY_SRC), "utf8");
const ackSrc = readFileSync(resolve(ACK_SRC), "utf8");
const entries = Object.values(manifest.groups).flat();
const byKey = new Map(entries.map((t) => [t.internal_template_key, t]));

/** Resolve a key through the REAL registry using its own approved template key and lane. */
function resolveKey(key, over = {}) {
  return R.resolveOutboundConsentScope({
    messageType: key,
    templateKey: over.templateKey ?? key,
    lane: over.lane ?? (byKey.get(key)?.qf_mvp_40?.consent_scope === "authentication" &&
                        byKey.get(key)?.category === "authentication" ? "authentication" : "business"),
  });
}

// ---------------------------------------------------------------------------
// RULES
// ---------------------------------------------------------------------------
const RULES = {
  // --- the special acknowledgement boundary ---------------------------------
  acksNotInOrdinaryRegistry: (m) => ACK_KEYS.every((k) => !new RegExp(`^\\s*${k}\\s*:`, "m").test(registrySrc)),

  acksResolveUnclassified: () => ACK_KEYS.every((k) => {
    const r = R.resolveOutboundConsentScope({ messageType: k, templateKey: k, lane: "authentication" });
    return r.ok === false && r.reason === R.ScopeResolutionFailure.UNCLASSIFIED_MESSAGE_TYPE;
  }),

  acksMarkedSpecialInManifest: (m) => ACK_KEYS.every((k) => {
    const q = m.groups.consent_service.find((t) => t.internal_template_key === k)?.qf_mvp_40;
    return q?.registry_expectation === "SPECIAL_EVIDENCE_BOUND_ACK" && q?.ordinary_registry_entry === false;
  }),

  ackAuthorityPathDocumented: () =>
    /consentCommandResponseService/.test(ackSrc) && /DELIBERATELY ABSENT/.test(ackSrc)
    && /DELIBERATELY ABSENT/.test(registrySrc),

  noWildcardOrBypass: () =>
    !/RegExp|startsWith\(|\.\.\.|test\(messageType\)|force|bypass|allowAll/i.test(
      registrySrc.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n")),

  // --- founder-ratified marketing ------------------------------------------
  founderMarketingInRegistry: () => FOUNDER_MARKETING.every((k) => {
    const r = resolveKey(k);
    return r.ok === true && r.scope === "marketing" && r.lane === "business";
  }),

  founderMarketingInManifest: (m) => FOUNDER_MARKETING.every((k) => {
    const t = [...Object.values(m.groups).flat()].find((x) => x.internal_template_key === k);
    return t && t.category === "marketing" && t.qf_mvp_40.consent_scope === "marketing";
  }),

  crmPromotionIsMarketing: (m) => {
    const t = [...Object.values(m.groups).flat()].find((x) => x.internal_template_key === "vendor_crm_promotion");
    const r = resolveKey("vendor_crm_promotion");
    return !!t && t.category === "marketing" && t.qf_mvp_40.consent_scope === "marketing"
      && r.ok === true && r.scope === "marketing";
  },

  // --- manifest ↔ registry consistency for ORDINARY entries -----------------
  everyOrdinaryEntryRegistered: (m) => [...Object.values(m.groups).flat()]
    .filter((t) => t.qf_mvp_40.registry_expectation === "ORDINARY_REGISTRY")
    .every((t) => resolveKey(t.internal_template_key).ok === true),

  ordinaryScopesAgree: (m) => [...Object.values(m.groups).flat()]
    .filter((t) => t.qf_mvp_40.registry_expectation === "ORDINARY_REGISTRY")
    .every((t) => {
      const r = resolveKey(t.internal_template_key);
      return r.ok === true && r.scope === t.qf_mvp_40.consent_scope;
    }),

  wrongTemplateKeyFailsClosed: () =>
    resolveKey("lead_received", { templateKey: "vendor_new_lead" }).ok === false,

  wrongLaneFailsClosed: () =>
    resolveKey("lead_received", { lane: "authentication" }).ok === false,

  unknownTypeFailsClosed: () =>
    R.resolveOutboundConsentScope({ messageType: "totally_made_up", templateKey: "totally_made_up", lane: "business" }).ok === false,

  // --- catalogue hygiene ----------------------------------------------------
/**
 * QF-MVP-40.10D: the catalogue is no longer uniformly draft. Wave 0
 * consent_help_response was approved by Meta as UTILITY and is now
 * approved / APPROVED_UNMAPPED / held from creation. Relaxing this to
 * "anything may be approved" would delete the guard, so it becomes a CLOSED
 * state model: Wave 0 must be EXACTLY that, every other entry must still be
 * draft, and no entry may ever carry a provider template id.
 */
  allDraft: (m) => {
    const all = [...Object.values(m.groups).flat()];
    if (all.filter((t) => CLOSED_KEYS_40_10E.includes(t.internal_template_key)).length
        !== CLOSED_KEYS_40_10E.length) return false;
    return all.every((t) => {
      if (t.provider_template_id !== null) return false;
      if (CLOSED_KEYS_40_10E.includes(t.internal_template_key)) {
        return t.submission_state === "APPROVED_UNMAPPED" && t.approval_status === "approved"
          && t.qf_mvp_40?.submit_now === false;
      }
      return t.submission_state === "DRAFT_NOT_SUBMITTED" && t.approval_status === "draft";
    });
  },

  noActiveMapping: (m) => {
    const raw = JSON.stringify(m).toLowerCase();
    if (/"(approval_status|submission_state)"\s*:\s*"(active|submitted)"/.test(raw)) return false;
    // Exactly one approval is permitted, and only for the Wave 0 entry Meta approved.
    const approved = [...Object.values(m.groups).flat()].filter((t) => t.approval_status === "approved");
    if (approved.length > CLOSED_KEYS_40_10E.length) return false;
    if (approved.some((t) => !CLOSED_KEYS_40_10E.includes(t.internal_template_key))) return false;
    return [...Object.values(m.groups).flat()].every((t) => t.binding_contract?.binding_readiness !== "active");
  },

  /**
   * QF-MVP-40.10D: this rule failed at HEAD 271c807 and the failure PRE-DATES this
   * phase. QF-MVP-40.10C rewrote the HELP body to strict minimal Utility copy that
   * names no domain at all, so "the domain must be present" contradicts the approved
   * copy. The invariant that still matters is kept and NOT weakened: the wrong domain
   * is never used, and any domain reference that IS present must be quickfurno.in and
   * must not invent a route that does not exist on disk.
   */
  helpUsesVerifiedDomain: (m) => {
    const t = m.groups.consent_service.find((x) => x.internal_template_key === "consent_help_response");
    if (!t) return false;
    if (/quickfurno\.com/i.test(t.body_spec)) return false;          // wrong domain, always
    const hosts = [...t.body_spec.matchAll(/quickfurno\.[a-z]{2,}/gi)].map((x) => x[0].toLowerCase());
    if (hosts.some((h) => h !== "quickfurno.in")) return false;      // no other TLD
    // No invented route: a route reference must exist under app/.
    const paths = [...t.body_spec.matchAll(/quickfurno\.in(\/[A-Za-z0-9/_-]+)/g)].map((x) => x[1]);
    return paths.every((p) => existsSync(resolve(ROOT, "app" + p)));
  },

  leadAssignmentAlertConsistent: (m) => {
    const t = [...Object.values(m.groups).flat()].find((x) => x.internal_template_key === "lead_assignment_alert");
    if (!t) return false;
    const q = t.qf_mvp_40;
    const body = t.body_spec.toLowerCase();
    // Committed migration 20260708000170 seeds this as vendor-facing.
    if (q.recipient_type !== "vendor") return false;
    if (/client/.test(q.purpose.toLowerCase())) return false;        // purpose must not say client
    if (!/to you/.test(body)) return false;                          // vendor-addressed body
    // Fixture must be a lead reference, not a bare count.
    return !/^\d+$/.test(String(q.example_fixture?.["1"] ?? ""));
  },

  offerVsAssignmentPreserved: (m) => {
    const offer = [...Object.values(m.groups).flat()].find((x) => x.internal_template_key === "vendor_new_lead");
    return !!offer && /offer/i.test(offer.body_spec) && !/has been assigned/i.test(offer.body_spec);
  },

  noSubmissionReadyAmbiguity: (m) => [...Object.values(m.groups).flat()].every((t) => {
    const q = t.qf_mvp_40;
    return typeof q.recipient_type === "string" && q.recipient_type.length > 0
      && typeof q.consent_scope === "string" && typeof q.registry_expectation === "string";
  }),

  ackCategoryNotFromStorageTerm: (m) => {
    // ACK_TEMPLATE_CATEGORY is storage terminology; the Meta candidate must stay utility.
    const acks = m.groups.consent_service;
    return acks.every((t) => t.category === "utility")
      && /storage/i.test(JSON.stringify(m.warnings));
  },

  noVoicePath: () => {
    try {
      const out = execFileSync("git", ["grep", "-il", "-E", "\\bvoice_call\\b|\\bcall_recording\\b|\\btranscription\\b",
        "--", "lib/", "services/", "app/"], { encoding: "utf8", cwd: ROOT }).trim();
      return out === "";
    } catch (e) { return e && e.status === 1 && String(e.stdout ?? "").trim() === ""; }
  },

  campaignStaysMvp50: (m) => /QF-MVP-50/.test(m.qf_mvp_40_decisions.campaign_ownership)
    && /QF-MVP-50/.test(registrySrc),

  docExists: () => existsSync(resolve(DOC)),
};

const ORDER = [
  ["G1  acknowledgements are absent from the ordinary registry", RULES.acksNotInOrdinaryRegistry],
  ["G2  ordinary resolution of an ack returns UNCLASSIFIED_MESSAGE_TYPE", RULES.acksResolveUnclassified],
  ["G3  manifest marks all three acks SPECIAL_EVIDENCE_BOUND_ACK", RULES.acksMarkedSpecialInManifest],
  ["G4  the evidence-bound authority path is documented in code", RULES.ackAuthorityPathDocumented],
  ["G5  registry has no wildcard, prefix or bypass path", RULES.noWildcardOrBypass],
  ["G6  founder-ratified marketing holds in the registry", RULES.founderMarketingInRegistry],
  ["G7  founder-ratified marketing holds in the manifest", RULES.founderMarketingInManifest],
  ["G8  vendor_crm_promotion is marketing in both", RULES.crmPromotionIsMarketing],
  ["G9  every ORDINARY_REGISTRY template resolves", RULES.everyOrdinaryEntryRegistered],
  ["G10 manifest and registry scopes agree for ordinary entries", RULES.ordinaryScopesAgree],
  ["G11 wrong template key fails closed", RULES.wrongTemplateKeyFailsClosed],
  ["G12 wrong lane fails closed", RULES.wrongLaneFailsClosed],
  ["G13 unknown message type fails closed", RULES.unknownTypeFailsClosed],
  ["G14 every catalogue entry remains draft / not submitted", RULES.allDraft],
  ["G15 no active or fabricated provider mapping", RULES.noActiveMapping],
  ["G16 HELP copy uses quickfurno.in and invents no route", RULES.helpUsesVerifiedDomain],
  ["G17 lead_assignment_alert is internally consistent (vendor-facing)", RULES.leadAssignmentAlertConsistent],
  ["G18 offer-vs-assignment truth preserved on vendor_new_lead", RULES.offerVsAssignmentPreserved],
  ["G19 no submission-ready template is ambiguous", RULES.noSubmissionReadyAmbiguity],
  ["G20 ack Meta category stays utility, not the storage term", RULES.ackCategoryNotFromStorageTerm],
  ["G21 no voice path", RULES.noVoicePath],
  ["G22 campaign orchestration stays QF-MVP-50", RULES.campaignStaysMvp50],
  ["G23 transport completion document exists", RULES.docExists],
];
for (const [name, fn] of ORDER) add(name, fn(manifest));

// ---------------------------------------------------------------------------
// MUTATION SELF-TESTS — each must make its rule FAIL.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  ["M1  an ack marked as an ordinary registry entry is rejected", RULES.acksMarkedSpecialInManifest, (m) => {
    m.groups.consent_service[0].qf_mvp_40.registry_expectation = "ORDINARY_REGISTRY";
    m.groups.consent_service[0].qf_mvp_40.ordinary_registry_entry = true; }],
  ["M2  nurture reclassified transactional is rejected", RULES.founderMarketingInManifest, (m) => {
    const t = [...Object.values(m.groups).flat()].find((x) => x.internal_template_key === "client_nurture_followup");
    t.qf_mvp_40.consent_scope = "transactional"; }],
  ["M3  reactivation reclassified transactional is rejected", RULES.founderMarketingInManifest, (m) => {
    const t = [...Object.values(m.groups).flat()].find((x) => x.internal_template_key === "dormant_requirement_reactivation");
    t.category = "utility"; }],
  ["M4  vendor_crm_promotion reclassified transactional is rejected", RULES.crmPromotionIsMarketing, (m) => {
    const t = [...Object.values(m.groups).flat()].find((x) => x.internal_template_key === "vendor_crm_promotion");
    t.qf_mvp_40.consent_scope = "transactional"; }],
  ["M5  a manifest/registry scope mismatch is rejected", RULES.ordinaryScopesAgree, (m) => {
    const t = [...Object.values(m.groups).flat()].find((x) => x.internal_template_key === "lead_received");
    t.qf_mvp_40.consent_scope = "marketing"; }],
  ["M6  an unregistered ordinary template is rejected", RULES.everyOrdinaryEntryRegistered, (m) => {
    m.groups.transactional_business.push({
      internal_template_key: "totally_unregistered_type", category: "utility",
      submission_state: "DRAFT_NOT_SUBMITTED", approval_status: "draft", provider_template_id: null,
      body_spec: "x", variables_schema: {},
      qf_mvp_40: { registry_expectation: "ORDINARY_REGISTRY", consent_scope: "transactional", recipient_type: "client" },
    }); }],
  ["M7  an approved / provider-ID-bearing entry is rejected", RULES.allDraft, (m) => {
    m.groups.marketing[0].submission_state = "APPROVED";
    m.groups.marketing[0].provider_template_id = "meta-123"; }],
  // These mutants used to string-replace "quickfurno.in" in the body. The approved
  // Utility copy no longer names a domain, so the replace silently became a no-op and
  // the mutants stopped proving anything. They now INJECT the defect outright.
  ["M8  the wrong support domain is rejected", RULES.helpUsesVerifiedDomain, (m) => {
    const t = m.groups.consent_service.find((x) => x.internal_template_key === "consent_help_response");
    t.body_spec = `${t.body_spec} Visit quickfurno.com for help.`; }],
  ["M8b any other quickfurno TLD is rejected", RULES.helpUsesVerifiedDomain, (m) => {
    const t = m.groups.consent_service.find((x) => x.internal_template_key === "consent_help_response");
    t.body_spec = `${t.body_spec} Visit quickfurno.net for help.`; }],
  ["M9  an invented support route is rejected", RULES.helpUsesVerifiedDomain, (m) => {
    const t = m.groups.consent_service.find((x) => x.internal_template_key === "consent_help_response");
    t.body_spec = `${t.body_spec} Visit quickfurno.in/contact for help.`; }],
  ["M9b a real on-disk route is accepted, proving the rule is not vacuous", RULES.helpUsesVerifiedDomain, (m) => {
    const t = m.groups.consent_service.find((x) => x.internal_template_key === "consent_help_response");
    t.body_spec = `${t.body_spec} Visit quickfurno.in/pricing for help.`; }, true],
  ["M10 a client-facing lead_assignment_alert is rejected", RULES.leadAssignmentAlertConsistent, (m) => {
    const t = [...Object.values(m.groups).flat()].find((x) => x.internal_template_key === "lead_assignment_alert");
    t.qf_mvp_40.recipient_type = "client"; }],
  ["M11 a bare-count fixture on lead_assignment_alert is rejected", RULES.leadAssignmentAlertConsistent, (m) => {
    const t = [...Object.values(m.groups).flat()].find((x) => x.internal_template_key === "lead_assignment_alert");
    t.qf_mvp_40.example_fixture = { "1": "3" }; }],
  ["M12 an offer template claiming assignment is rejected", RULES.offerVsAssignmentPreserved, (m) => {
    const t = [...Object.values(m.groups).flat()].find((x) => x.internal_template_key === "vendor_new_lead");
    t.body_spec = "This lead has been assigned to you."; }],
  ["M13 an ack with a marketing Meta category is rejected", RULES.ackCategoryNotFromStorageTerm, (m) => {
    m.groups.consent_service[0].category = "marketing"; }],
  ["M14 an ambiguous entry missing recipient_type is rejected", RULES.noSubmissionReadyAmbiguity, (m) => {
    delete m.groups.marketing[0].qf_mvp_40.recipient_type; }],
  ["M15 an active binding readiness is rejected", RULES.noActiveMapping, (m) => {
    m.groups.marketing[0].binding_contract.binding_readiness = "active"; }],
  ["M16 the Wave 1 canary reverted to draft is rejected", RULES.allDraft, (m) => {
    const t = [...Object.values(m.groups).flat()].find((x) => x.internal_template_key === "lead_received");
    t.approval_status = "draft"; t.submission_state = "DRAFT_NOT_SUBMITTED"; }],
  ["M17 an approval outside the closed set is rejected", RULES.noActiveMapping, (m) => {
    m.groups.marketing[0].approval_status = "approved"; }],
];
// A 4th element `true` marks a POSITIVE control: the mutation must still PASS, which
// proves the rule is discriminating rather than rejecting everything it is handed.
for (const [name, fn, mutate, expectPass] of MUTATIONS) {
  const copy = clone(manifest);
  mutate(copy);
  add(name, fn(copy) === (expectPass === true));
}

rmSync(outDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ""}`);
console.log(`\nTemplates: ${entries.length} · ordinary: ${entries.filter((t) => t.qf_mvp_40.registry_expectation === "ORDINARY_REGISTRY").length} · special acks: ${ACK_KEYS.length}`);
console.log(`Summary: ${results.length - failed.length} passed, ${failed.length} failed (rules: ${ORDER.length}, mutation self-tests: ${MUTATIONS.length}).`);
process.exit(failed.length === 0 ? 0 : 1);
