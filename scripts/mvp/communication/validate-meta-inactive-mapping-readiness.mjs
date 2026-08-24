// ============================================================================
// QF-MVP-40.11 — inactive provider-mapping readiness validator.  OFFLINE.
//
// Audits the readiness artefact, the staging seed PLAN and the existing runtime mapping
// gates. It calls no Meta endpoint, reads no database, sends nothing and reads no
// credential. Mutation self-tests drive each rule against a corrupted copy and require
// failure, so a rule that stops discriminating is caught rather than trusted.
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { selectApprovedProviderMapping } from "../../../lib/communication/whatsappTemplate.ts";

/**
 * The provider adapter uses a TS parameter property, which the strip-only loader cannot
 * import. Rather than duplicate the constant blindly, it is READ OUT of the adapter
 * source, so a change there fails here instead of silently diverging.
 */
const PROVIDER_KEY_SRC = "lib/communication/providers/metaCloudWhatsAppProvider.ts";
const providerKeyMatch = readFileSync(resolve(PROVIDER_KEY_SRC), "utf8")
  .match(/export const META_WHATSAPP_CLOUD_PROVIDER_KEY\s*=\s*"([a-z0-9_]+)"/);
if (!providerKeyMatch) {
  console.error("REFUSING TO VALIDATE: META_WHATSAPP_CLOUD_PROVIDER_KEY could not be read from source.");
  process.exit(2);
}
const META_WHATSAPP_CLOUD_PROVIDER_KEY = providerKeyMatch[1];

const READINESS = "docs/provider-manifests/meta-template-inactive-mapping-readiness.json";
const SEED_PLAN = "docs/provider-manifests/meta-staging-inactive-mapping-seed-plan.json";
const MANIFEST = "docs/provider-manifests/whatsapp-template-submission-manifest.json";
const REMOTE_STATE = "docs/provider-manifests/meta-template-remote-state.json";
const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";
const SUBSET2 = "docs/provider-manifests/meta-wave1-next-utility-subset-2-review.json";
const SUBSET3 = "docs/provider-manifests/meta-wave1-next-utility-subset-3-review.json";
const REGISTRY_SRC = "lib/communication/outboundConsentScope.ts";
const DOC = "docs/QF-MVP-40-11-INACTIVE-PROVIDER-MAPPING-READINESS.md";
const GEN = "scripts/mvp/communication/generate-meta-inactive-mapping-readiness.mjs";

const EXPECTED_ORDER = [
  "consent_help_response", "consent_stop_acknowledgement",
  "lead_received", "client_lead_status_update", "client_matching_update",
  "lead_assignment_alert", "vendor_onboarding_reminder",
];
const EVIDENCE_BOUND = ["consent_help_response", "consent_stop_acknowledgement",
  ];
const ORDINARY = ["lead_received", "client_lead_status_update", "client_matching_update",
  "lead_assignment_alert", "vendor_onboarding_reminder"];
/** Lanes that must not be dragged into a mapping plan. */
const FORBIDDEN_KEYS = ["client_login_otp", "vendor_whatsapp_verify", "vendor_password_reset",
  "client_nurture_followup", "dormant_requirement_reactivation", "vendor_crm_promotion",
  "low_credit_warning", "recharge_reminder", "vendor_package_expiry_warning"];

const results = [];
const add = (n, ok, d) => results.push({ name: n, ok: ok === true, detail: d ?? "" });
const clone = (o) => JSON.parse(JSON.stringify(o));
const sha256 = (x) => createHash("sha256").update(x).digest("hex");

const readiness = JSON.parse(readFileSync(resolve(READINESS), "utf8"));
const plan = JSON.parse(readFileSync(resolve(SEED_PLAN), "utf8"));
const packet = JSON.parse(readFileSync(resolve(PACKET), "utf8"));
const registrySrc = readFileSync(resolve(REGISTRY_SRC), "utf8");
const genSrc = readFileSync(resolve(GEN), "utf8");

/** A mapping row fixture in the EXACT shape the production selector consumes. */
const row = (over = {}) => ({
  id: "m-fixture", template_key: "lead_received", channel: "whatsapp",
  provider_key: META_WHATSAPP_CLOUD_PROVIDER_KEY, language: "en",
  provider_template_name: "qf_lead_received_v1", provider_template_id: null,
  approval_status: "approved", is_active: false, version: "1.0",
  variables_schema: { bindingVersion: 1, bindings: [] }, ...over,
});
const CRIT = { templateKey: "lead_received", providerKey: META_WHATSAPP_CLOUD_PROVIDER_KEY, language: "en" };

/**
 * Capability check for an offline generator: its ENTIRE import list must be three pure
 * node builtins, so it cannot reach a database client or an HTTP module, plus no dynamic
 * import, no I/O call shape and no credential read.
 */
const offlineCheck = (src) => {
  const exec = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const imports = [...exec.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  const allowed = ["node:crypto", "node:fs", "node:path"];
  if (imports.length !== allowed.length) return false;
  if (imports.slice().sort().join(",") !== allowed.slice().sort().join(",")) return false;
  return !/\bimport\s*\(/.test(exec)
    && !/\bfetch\s*\(|\bXMLHttpRequest\b|require\s*\(\s*["']https?["']/.test(exec)
    && !/\badminClient\s*\(|\bcreateClient\s*\(/.test(exec)
    && !/process\.env\.QF_META/.test(exec);
};

const R = {
  // ---- A. Readiness artefact ---------------------------------------------
  exactEightKeysInOrder: (r) => r.templates.length === 7
    && r.templates.map((t) => t.internal_template_key).join(",") === EXPECTED_ORDER.join(","),
  matchesPacketVerbatim: (r) => r.templates.every((t) => {
    const p = packet.templates.find((x) => x.internal_template_key === t.internal_template_key);
    return !!p && t.provider_template_name === p.provider_template_name
      && t.provider_language === p.provider_language
      && t.requested_category === p.category && p.category === "UTILITY"
      && t.component_profile === p.component_profile
      && t.payload_fingerprint === p.payload_fingerprint
      && /^[0-9a-f]{64}$/.test(t.payload_fingerprint);
  }),
  sourceFingerprintsExact: (r) =>
    r.source_manifest_fingerprint === sha256(readFileSync(resolve(MANIFEST)))
    && r.source_remote_state_fingerprint === sha256(readFileSync(resolve(REMOTE_STATE)))
    && r.source_packet_fingerprint === sha256(readFileSync(resolve(PACKET))),
  provenRemoteTruthExact: (r) => r.templates.every((t) =>
    t.proven_remote_status === "APPROVED" && t.proven_remote_category === "UTILITY"
    && t.readback_semantic_match === true && t.local_submission_state === "APPROVED_UNMAPPED"),
  /** The whole point of the phase: nothing may be planned ACTIVE. */
  everyMappingInactive: (r) => r.templates.every((t) => t.desired_mapping_state === "INACTIVE")
    && r.counts.desired_active === 0,
  everyRuntimeDisabled: (r) => r.templates.every((t) => t.runtime_activation_state === "DISABLED"),
  everyAuthorityDenied: (r) => r.templates.every((t) => t.send_authority === "DENIED"
    && t.mapping_write_authority === "NOT_GRANTED"
    && t.mapping_activation_authority === "NOT_GRANTED"),
  topLevelAuthorizesNothing: (r) => [
    "authorizes_meta_calls", "authorizes_database_reads", "authorizes_database_writes",
    "authorizes_mapping_creation", "authorizes_mapping_activation",
    "authorizes_provider_account_activation", "authorizes_runtime_activation",
    "authorizes_sending", "authorizes_staging_canary", "authorizes_deployment",
  ].every((k) => r[k] === false)
    && r.contains_secrets === false
    && r.status === "OFFLINE_READY_FOR_CONTROLLED_STAGING_SEED",
  classificationExact: (r) => r.templates.every((t) => {
    const bound = EVIDENCE_BOUND.includes(t.internal_template_key);
    return t.flow_classification === (bound ? "EVIDENCE_BOUND_ACK" : "ORDINARY_BUSINESS")
      && t.ordinary_registry_entry === !bound
      && (bound ? t.consent_lane === null && t.consent_scope === null
                : t.consent_lane === "business" && t.consent_scope === "transactional");
  }) && r.counts.evidence_bound_ack === 2 && r.counts.ordinary_business === 5,
  /**
   * The acknowledgements' absence from the ordinary registry IS the security mechanism.
   * A Meta approval, and later a mapping row, must never smuggle them into it.
   */
  acksStayOutOfOrdinaryRegistry: () => EVIDENCE_BOUND.every(
    (k) => !new RegExp(`^\\s*${k}\\s*:`, "m").test(registrySrc)),
  ordinaryLanesUnchanged: () => ORDINARY.every(
    (k) => new RegExp(`^\\s*${k}:.*lane: "business".*scope: "transactional"`, "m").test(registrySrc)),
  noForbiddenLaneLeaked: (r) => {
    const keys = r.templates.map((t) => t.internal_template_key);
    return !keys.some((k) => FORBIDDEN_KEYS.includes(k));
  },
  /** No remote, provider, database or secret-shaped identifier anywhere. */
  noRemoteOrSecretIdentifiers: (r) => {
    const raw = JSON.stringify(r);
    if (r.templates.some((t) => t.provider_template_id !== null)) return false;
    if (r.templates.some((t) => t.provider_account_reference !== null)) return false;
    if (/"(provider_template_id|template_id|waba_id|phone_number_id|request_id|access_token|app_secret|verify_token)"\s*:\s*"/i.test(raw)) return false;
    if (/EAA[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9._-]{20,}|Bearer\s+[A-Za-z0-9._-]{12,}/.test(raw)) return false;
    if (/\+\d[\d\s-]{8,}/.test(raw)) return false;
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(raw)) return false; // uuid
    if (/https:\/\/[a-z0-9]+\.supabase\.(co|in)/i.test(raw)) return false;
    return !/(?<![\w.])\d{10,}(?![\w.])/.test(raw);
  },
  prerequisitesComplete: (r) => {
    const p = (r.future_staging_seed_prerequisites ?? []).join(" ").toLowerCase();
    return r.future_staging_seed_prerequisites.length >= 10
      && /branch/.test(p) && /sha/.test(p) && /staging/.test(p)
      && /provider account/.test(p) && /disabled/.test(p) && /reconcil/.test(p)
      && /collision|duplicate/.test(p) && /inactive/.test(p)
      && /transaction|rollback/.test(p) && /readback/.test(p)
      && /zero message sends|zero send/.test(p) && /owner authorization/.test(p);
  },
  reusesExistingArchitecture: (r) => {
    const a = r.reused_architecture ?? {};
    return a.mapping_table === "public.communication_provider_template_mappings"
      && /selectApprovedProviderMapping/.test(a.pure_selector ?? "")
      && /providerTemplateMappingService/.test(a.mapping_service ?? "")
      && /approvedTemplateOutbound/.test(a.final_outbound_gate ?? "")
      && /outboundConsentScope/.test(a.consent_authority ?? "")
      && /No new mapping system/i.test(a.note ?? "");
  },
  symbolicProviderKeyOnly: (r) => r.templates.every((t) =>
    t.provider_key_symbolic === META_WHATSAPP_CLOUD_PROVIDER_KEY && t.channel === "whatsapp"),

  // ---- B. Seed plan (PLAN ONLY) -------------------------------------------
  planAuthorizesNothing: (p) => p.status === "PLAN_ONLY_NOT_AUTHORIZED"
    && p.authorizes_database_access === false && p.authorizes_database_write === false
    && p.authorizes_provider_call === false && p.authorizes_mapping_activation === false
    && p.authorizes_send === false,
  planStepsOrdered: (p) => Array.isArray(p.steps) && p.steps.length >= 15
    && p.steps.every((s, i) => s.step === i + 1)
    && /staging/i.test(JSON.stringify(p.steps))
    && /rollback/i.test(JSON.stringify(p.steps))
    && /inactive/i.test(JSON.stringify(p.steps)),
  planCarriesNoExecutableSqlOrIds: (p) => {
    const raw = JSON.stringify(p);
    if (/\b(insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|drop\s+table)\b/i.test(raw)) return false;
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(raw)) return false;
    if (/EAA[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9._-]{20,}/.test(raw)) return false;
    if (/https:\/\/[a-z0-9]+\.supabase\.(co|in)/i.test(raw)) return false;
    return !/(?<![\w.])\d{10,}(?![\w.])/.test(raw);
  },
  planRecordsUniquenessBasis: (p) => /uq_comm_provider_template_mapping/.test(JSON.stringify(p))
    && /uq_comm_provider_template_active/.test(JSON.stringify(p)),
  planNeverReplacesActive: (p) => /never.*(replace|flip).*active/i.test(JSON.stringify(p)),

  // ---- C. EXISTING runtime mapping gates (real production selector) -------
  gateNoMapping: () => selectApprovedProviderMapping([], CRIT).ok === false,
  gateInactiveMappingBlocked: () => {
    const r = selectApprovedProviderMapping([row({ is_active: false })], CRIT);
    return r.ok === false && r.reason === "not_active";
  },
  gateNotApprovedBlocked: () => {
    const r = selectApprovedProviderMapping([row({ is_active: true, approval_status: "draft" })], CRIT);
    return r.ok === false && r.reason === "not_approved";
  },
  gateAmbiguousActiveBlocked: () => {
    const a = row({ id: "a", is_active: true }), b = row({ id: "b", is_active: true });
    const r = selectApprovedProviderMapping([a, b], CRIT);
    return r.ok === false && r.reason === "ambiguous_active_mapping";
  },
  gateMissingProviderNameBlocked: () => {
    const r = selectApprovedProviderMapping([row({ is_active: true, provider_template_name: "  " })], CRIT);
    return r.ok === false && r.reason === "missing_provider_template_name";
  },
  /** Key / language / provider / channel mismatch must never resolve. */
  gateMismatchBlocked: () => {
    const active = row({ is_active: true });
    return selectApprovedProviderMapping([active], { ...CRIT, templateKey: "other_key" }).ok === false
      && selectApprovedProviderMapping([active], { ...CRIT, language: "hi" }).ok === false
      && selectApprovedProviderMapping([active], { ...CRIT, providerKey: "other_provider" }).ok === false
      && selectApprovedProviderMapping([row({ is_active: true, channel: "sms" })], CRIT).ok === false;
  },
  /** No prefix / wildcard / default-provider behaviour: selection is EXACT equality. */
  gateNoPrefixOrWildcard: () => {
    const active = row({ is_active: true, template_key: "lead_received_extra" });
    return selectApprovedProviderMapping([active], CRIT).ok === false
      && selectApprovedProviderMapping([row({ is_active: true })], { ...CRIT, templateKey: "lead_" }).ok === false
      && selectApprovedProviderMapping([row({ is_active: true })], { ...CRIT, templateKey: "*" }).ok === false;
  },
  /**
   * A null provider_template_id must still resolve: the Meta send is keyed on template
   * NAME + language, so the remote id is never required at dispatch. This is exactly why
   * no remote id needs to live in Git.
   */
  gateNullProviderIdStillResolves: () => {
    const r = selectApprovedProviderMapping([row({ is_active: true, provider_template_id: null })], CRIT);
    return r.ok === true && r.template.providerTemplateId === null
      && r.template.providerTemplateName === "qf_lead_received_v1";
  },
  /** An inactive row can never be reached even when an approved sibling exists. */
  gateInactiveNeverFallsBack: () => {
    const inactive = row({ id: "inactive", is_active: false });
    const wrongLang = row({ id: "other", is_active: true, language: "hi" });
    const r = selectApprovedProviderMapping([inactive, wrongLang], CRIT);
    return r.ok === false && r.reason === "not_active";
  },

  // ---- D. Boundary --------------------------------------------------------
  /**
   * Word-scanning the source for "supabase" was too blunt — the generator legitimately
   * mentions Supabase inside a prerequisite STRING. The stronger guarantee is capability:
   * pin the ENTIRE import list to three pure node builtins, so the generator cannot reach
   * a database client or an HTTP module at all, then check I/O call shapes on top.
   */
  generatorIsOffline: () => offlineCheck(genSrc),
  submissionStillPaused: () => {
    const s = JSON.parse(readFileSync(resolve(SUBSET2), "utf8")).submission_pause;
    return !!s && s.status === "PAUSED" && s.successor_subset_proposed === false
      && s.successor_subset_authorized === false;
  },
  noSubset3Artifact: () => !existsSync(resolve(SUBSET3)),
  laterWavesUntouched: () => packet.templates.filter((t) => t.submission_wave >= 2)
    .every((t) => t.local_state.approval_status === "draft"
      && t.local_state.submission_state === "DRAFT_NOT_SUBMITTED"),
  docExists: () => existsSync(resolve(DOC)),
};

const RULES = [
  ["I1  readiness names exactly the eight approved keys in order", R.exactEightKeysInOrder, readiness],
  ["I2  every record quotes the packet verbatim", R.matchesPacketVerbatim, readiness],
  ["I3  manifest / remote-state / packet fingerprints are exact", R.sourceFingerprintsExact, readiness],
  ["I4  proven remote truth is APPROVED / UTILITY / semantic match", R.provenRemoteTruthExact, readiness],
  ["I5  every desired mapping state is INACTIVE", R.everyMappingInactive, readiness],
  ["I6  every runtime activation state is DISABLED", R.everyRuntimeDisabled, readiness],
  ["I7  send / write / activation authority is denied everywhere", R.everyAuthorityDenied, readiness],
  ["I8  the artefact authorizes nothing at top level", R.topLevelAuthorizesNothing, readiness],
  ["I9  classification is exact (2 evidence-bound, 5 ordinary)", R.classificationExact, readiness],
  ["I10 consent acknowledgements stay OUT of the ordinary registry", R.acksStayOutOfOrdinaryRegistry, readiness],
  ["I11 ordinary templates keep their business/transactional lane", R.ordinaryLanesUnchanged, readiness],
  ["I12 no auth / marketing / commercial lane leaked in", R.noForbiddenLaneLeaked, readiness],
  ["I13 no remote, provider, database or secret identifier", R.noRemoteOrSecretIdentifiers, readiness],
  ["I14 future staging-seed prerequisites are complete", R.prerequisitesComplete, readiness],
  ["I15 the artefact reuses the existing architecture by name", R.reusesExistingArchitecture, readiness],
  ["I16 only a symbolic provider key is recorded", R.symbolicProviderKeyOnly, readiness],
  ["I17 the seed plan authorizes nothing", R.planAuthorizesNothing, plan],
  ["I18 the seed plan is an ordered, staging-scoped, rollback-aware sequence", R.planStepsOrdered, plan],
  ["I19 the seed plan carries no executable SQL and no live identifier", R.planCarriesNoExecutableSqlOrIds, plan],
  ["I20 the seed plan names the real uniqueness constraints", R.planRecordsUniquenessBasis, plan],
  ["I21 the seed plan never replaces an active mapping", R.planNeverReplacesActive, plan],
  ["I22 gate: no mapping blocks resolution", R.gateNoMapping, readiness],
  ["I23 gate: an INACTIVE mapping blocks resolution", R.gateInactiveMappingBlocked, readiness],
  ["I24 gate: a non-approved mapping blocks resolution", R.gateNotApprovedBlocked, readiness],
  ["I25 gate: duplicate active mappings fail closed", R.gateAmbiguousActiveBlocked, readiness],
  ["I26 gate: a missing provider template name fails closed", R.gateMissingProviderNameBlocked, readiness],
  ["I27 gate: key/language/provider/channel mismatch fails closed", R.gateMismatchBlocked, readiness],
  ["I28 gate: no prefix, wildcard or default-provider selection", R.gateNoPrefixOrWildcard, readiness],
  ["I29 gate: a null provider template id still resolves (send keys on name)", R.gateNullProviderIdStillResolves, readiness],
  ["I30 gate: an inactive mapping never falls back to another row", R.gateInactiveNeverFallsBack, readiness],
  ["I31 the generator performs no network or database I/O", R.generatorIsOffline, readiness],
  ["I32 template submission remains PAUSED", R.submissionStillPaused, readiness],
  ["I33 no subset-3 artefact exists", R.noSubset3Artifact, readiness],
  ["I34 waves 2/3/4 remain unapproved", R.laterWavesUntouched, readiness],
  ["I35 the QF-MVP-40.11 document exists", R.docExists, readiness],
];
for (const [n, fn, arg] of RULES) add(n, fn(arg));

// ---- Mutation self-tests ---------------------------------------------------
const MUT = [
  ["M1  a ninth mapping record is rejected", R.exactEightKeysInOrder, readiness, (r) => {
    r.templates.push(r.templates[0]); }],
  ["M2  a reordered record set is rejected", R.exactEightKeysInOrder, readiness, (r) => {
    r.templates.reverse(); }],
  ["M3  a drifted provider template name is rejected", R.matchesPacketVerbatim, readiness, (r) => {
    r.templates[3].provider_template_name = "qf_lead_received_v2"; }],
  ["M4  a MARKETING category is rejected", R.matchesPacketVerbatim, readiness, (r) => {
    r.templates[3].requested_category = "MARKETING"; }],
  ["M5  a mutated payload fingerprint is rejected", R.matchesPacketVerbatim, readiness, (r) => {
    r.templates[0].payload_fingerprint = "0".repeat(64); }],
  ["M6  a stale source fingerprint is rejected", R.sourceFingerprintsExact, readiness, (r) => {
    r.source_packet_fingerprint = "0".repeat(64); }],
  ["M7  a semantic mismatch is rejected", R.provenRemoteTruthExact, readiness, (r) => {
    r.templates[0].readback_semantic_match = false; }],
  ["M8  a template planned ACTIVE is rejected", R.everyMappingInactive, readiness, (r) => {
    r.templates[4].desired_mapping_state = "ACTIVE"; }],
  ["M9  a stale desired_active count is rejected", R.everyMappingInactive, readiness, (r) => {
    r.counts.desired_active = 1; }],
  ["M10 an ENABLED runtime state is rejected", R.everyRuntimeDisabled, readiness, (r) => {
    r.templates[2].runtime_activation_state = "ENABLED"; }],
  ["M11 a granted send authority is rejected", R.everyAuthorityDenied, readiness, (r) => {
    r.templates[1].send_authority = "GRANTED"; }],
  ["M12 a granted mapping write authority is rejected", R.everyAuthorityDenied, readiness, (r) => {
    r.templates[1].mapping_write_authority = "GRANTED"; }],
  ["M13 a granted mapping activation authority is rejected", R.everyAuthorityDenied, readiness, (r) => {
    r.templates[1].mapping_activation_authority = "GRANTED"; }],
  ["M14 an artefact claiming database write authority is rejected", R.topLevelAuthorizesNothing, readiness, (r) => {
    r.authorizes_database_writes = true; }],
  ["M15 an artefact claiming send authority is rejected", R.topLevelAuthorizesNothing, readiness, (r) => {
    r.authorizes_sending = true; }],
  ["M16 an acknowledgement reclassified as ordinary business is rejected", R.classificationExact, readiness, (r) => {
    const t = r.templates.find((x) => x.internal_template_key === "consent_stop_acknowledgement");
    t.flow_classification = "ORDINARY_BUSINESS"; }],
  ["M17 an acknowledgement granted an ordinary registry entry is rejected", R.classificationExact, readiness, (r) => {
    r.templates[0].ordinary_registry_entry = true; }],
  ["M18 an acknowledgement given a transactional consent scope is rejected", R.classificationExact, readiness, (r) => {
    r.templates[0].consent_scope = "transactional"; }],
  ["M19 an ordinary template moved to the marketing scope is rejected", R.classificationExact, readiness, (r) => {
    r.templates[3].consent_scope = "marketing"; }],
  ["M20 a drifted classification count is rejected", R.classificationExact, readiness, (r) => {
    r.counts.evidence_bound_ack = 3; }],
  ["M21 an authentication template in the plan is rejected", R.noForbiddenLaneLeaked, readiness, (r) => {
    r.templates[0].internal_template_key = "client_login_otp"; }],
  ["M22 a commercial template in the plan is rejected", R.noForbiddenLaneLeaked, readiness, (r) => {
    r.templates[0].internal_template_key = "recharge_reminder"; }],
  ["M23 a marketing template in the plan is rejected", R.noForbiddenLaneLeaked, readiness, (r) => {
    r.templates[0].internal_template_key = "vendor_crm_promotion"; }],
  ["M24 a committed provider template id is rejected", R.noRemoteOrSecretIdentifiers, readiness, (r) => {
    r.templates[0].provider_template_id = "1234567890123"; }],
  ["M25 a database uuid is rejected", R.noRemoteOrSecretIdentifiers, readiness, (r) => {
    r.templates[0].provider_account_reference = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"; }],
  ["M26 a Supabase project URL is rejected", R.noRemoteOrSecretIdentifiers, readiness, (r) => {
    r.note = "see https://abcdefghij.supabase.co for the project"; }],
  ["M27 a truncated prerequisite list is rejected", R.prerequisitesComplete, readiness, (r) => {
    r.future_staging_seed_prerequisites = ["do it"]; }],
  ["M28 dropping the rollback prerequisite is rejected", R.prerequisitesComplete, readiness, (r) => {
    r.future_staging_seed_prerequisites = r.future_staging_seed_prerequisites
      .filter((x) => !/transaction|rollback/i.test(x)); }],
  ["M29 a fabricated parallel mapping system is rejected", R.reusesExistingArchitecture, readiness, (r) => {
    r.reused_architecture.mapping_table = "public.qf_new_mapping_table"; }],
  ["M30 a non-symbolic provider key is rejected", R.symbolicProviderKeyOnly, readiness, (r) => {
    r.templates[0].provider_key_symbolic = "some_other_provider"; }],
  ["M31 a plan claiming database write authority is rejected", R.planAuthorizesNothing, plan, (p) => {
    p.authorizes_database_write = true; }],
  ["M32 a plan claiming send authority is rejected", R.planAuthorizesNothing, plan, (p) => {
    p.authorizes_send = true; }],
  ["M33 an out-of-order plan is rejected", R.planStepsOrdered, plan, (p) => {
    p.steps.reverse(); }],
  ["M34 a truncated plan is rejected", R.planStepsOrdered, plan, (p) => {
    p.steps = p.steps.slice(0, 3); }],
  ["M35 executable SQL in the plan is rejected", R.planCarriesNoExecutableSqlOrIds, plan, (p) => {
    p.steps[0].detail = "INSERT INTO communication_provider_template_mappings VALUES (...)"; }],
  ["M36 a live uuid in the plan is rejected", R.planCarriesNoExecutableSqlOrIds, plan, (p) => {
    p.steps[0].detail = "account 3f2504e0-4f89-11d3-9a0c-0305e82c3301"; }],
  ["M37 dropping the uniqueness basis from the plan is rejected", R.planRecordsUniquenessBasis, plan, (p) => {
    p.collision_basis = {}; p.steps.forEach((s) => { s.detail = (s.detail ?? "").replace(/uq_comm_\w+/g, "x"); }); }],
  ["M38 a plan that may replace an active mapping is rejected", R.planNeverReplacesActive, plan, (p) => {
    p.steps.forEach((s) => { s.detail = (s.detail ?? "").replace(/never/gi, "may"); });
    p.invariants = (p.invariants ?? []).map((x) => x.replace(/never/gi, "may")); }],
];
for (const [n, fn, base, mutate] of MUT) {
  const copy = clone(base);
  mutate(copy);
  add(n, fn(copy) === false);
}

// The offline rule reads the generator from disk, so it is exercised against SYNTHETIC
// sources rather than a cloned object: a generator that could reach a client, the network
// or a credential must fail even though the real one passes.
const OFFLINE_MUTANTS = [
  ["M39 a generator importing a database client is rejected",
    `${genSrc}\nimport { adminClient } from "../../../lib/supabase";\n`],
  ["M40 a generator calling fetch is rejected", `${genSrc}\nawait fetch(base);\n`],
  ["M41 a generator using dynamic import is rejected", `${genSrc}\nawait import(mod);\n`],
  ["M42 a generator reading a Meta credential is rejected",
    `${genSrc}\nconst t = process.env.QF_META_ACCESS_TOKEN;\n`],
];
for (const [n, src] of OFFLINE_MUTANTS) add(n, offlineCheck(src) === false);

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  [${r.detail}]` : ""}`);
console.log(`\nMapping candidates: ${readiness.templates.length} · evidence-bound: `
  + `${readiness.counts.evidence_bound_ack} · ordinary: ${readiness.counts.ordinary_business} `
  + `· desired active: ${readiness.counts.desired_active}`);
console.log(`Summary: ${results.length - failed.length} passed, ${failed.length} failed `
  + `(rules: ${RULES.length}, mutation self-tests: ${MUT.length + OFFLINE_MUTANTS.length}).`);
process.exit(failed.length === 0 ? 0 : 1);
