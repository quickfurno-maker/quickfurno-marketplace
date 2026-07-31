// ============================================================================
// QF-MVP-40.11 — deterministic INACTIVE provider-mapping readiness generator. OFFLINE.
//
// Reads the two authoritative committed artefacts (the submission manifest and the
// remote-state ledger) and emits ONE non-secret readiness record for the templates Meta
// has actually approved. It performs NO network call, NO database read or write, NO
// provider call, and reads no credential.
//
// It plans nothing executable: the output describes mappings that a LATER, separately
// authorized phase may seed as INACTIVE rows in the EXISTING
// `communication_provider_template_mappings` table. Nothing here creates, activates or
// authorizes a mapping, a provider account, a runtime policy or a send.
//
// NO REMOTE IDENTIFIER IS EMITTED. That is not merely policy: the Meta send payload is
// keyed on `template.name` + `language.code` (see providers/metaCloudWhatsAppProvider),
// so the remote template id is never required at dispatch and has no reason to exist in
// this repository.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MANIFEST = "docs/provider-manifests/whatsapp-template-submission-manifest.json";
const REMOTE_STATE = "docs/provider-manifests/meta-template-remote-state.json";
/**
 * The payload fingerprint lives in the GENERATED packet, not the manifest — it is
 * sha256 of the exact Meta creation payload. Reading it from the packet keeps a single
 * source of truth; recomputing it here would duplicate payload-construction logic and
 * could silently drift from what was actually submitted.
 */
const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";
const OUT = "docs/provider-manifests/meta-template-inactive-mapping-readiness.json";

/**
 * The exact expected approved set, in the reviewed emission order: the three
 * evidence-bound acknowledgements first, then the five ordinary business templates.
 * Pinned so a drifted approved set fails loudly instead of silently reshaping the plan.
 */
const EXPECTED_ORDER = [
  "consent_help_response",
  "consent_stop_acknowledgement",
  "consent_start_acknowledgement",
  "lead_received",
  "client_lead_status_update",
  "client_matching_update",
  "lead_assignment_alert",
  "vendor_onboarding_reminder",
];
/**
 * Evidence-bound acknowledgements. These are deliberately ABSENT from the ordinary
 * outbound consent registry (lib/communication/outboundConsentScope.ts) and must stay
 * that way: a Meta approval — and later a mapping row — grants them no ordinary
 * transactional authority. They are reachable only through their exact inbound
 * HELP/STOP/START evidence flow.
 */
const EVIDENCE_BOUND = new Set([
  "consent_help_response",
  "consent_stop_acknowledgement",
  "consent_start_acknowledgement",
]);

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const die = (msg) => { console.error(`REFUSING TO GENERATE: ${msg}`); process.exit(2); };

const manifestRaw = readFileSync(resolve(MANIFEST));
const remoteRaw = readFileSync(resolve(REMOTE_STATE));
const packetRaw = readFileSync(resolve(PACKET));
const manifest = JSON.parse(manifestRaw.toString("utf8"));
const remote = JSON.parse(remoteRaw.toString("utf8"));
const packet = JSON.parse(packetRaw.toString("utf8"));

const entries = Object.values(manifest.groups).flat();
const approved = entries.filter((t) => t.approval_status === "approved");

// ---- Fail-closed preconditions --------------------------------------------
const approvedKeys = approved.map((t) => t.internal_template_key).sort();
if (approvedKeys.join(",") !== EXPECTED_ORDER.slice().sort().join(",")) {
  die(`the approved set is not the expected eight templates (found: ${approvedKeys.join(", ")})`);
}
if (remote.authorizes_meta_calls !== false || remote.authorizes_mapping !== false
    || remote.authorizes_sending !== false) {
  die("the remote-state ledger claims an authority it must never claim");
}

const records = EXPECTED_ORDER.map((key) => {
  const t = approved.find((x) => x.internal_template_key === key);
  const name = t.provider_template_name_candidate;
  const led = remote.entries.find((e) => e.provider_template_name === name);
  const pkt = packet.templates.find((x) => x.internal_template_key === key);

  if (!led) die(`${key}: no remote-state ledger entry for ${name}`);
  if (!pkt) die(`${key}: no packet entry`);
  if (pkt.provider_template_name !== name) die(`${key}: packet/manifest provider name disagree`);
  if (typeof pkt.payload_fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(pkt.payload_fingerprint)) {
    die(`${key}: packet payload fingerprint is missing or malformed`);
  }
  if (pkt.local_state.provider_template_id !== null) die(`${key}: a provider template id is committed in the packet`);
  if (t.submission_state !== "APPROVED_UNMAPPED") die(`${key}: local submission_state is not APPROVED_UNMAPPED`);
  if (t.provider_template_id !== null) die(`${key}: a provider template id is committed locally`);
  if (t.qf_mvp_40.submit_now !== false) die(`${key}: creation is not held (submit_now must be false)`);
  if (led.last_proven_status !== "APPROVED") die(`${key}: remote status is not APPROVED`);
  if (led.last_proven_remote_category !== "UTILITY") die(`${key}: remote category is not UTILITY`);
  if (led.readback_semantic_match !== true) die(`${key}: readback_semantic_match is not true`);
  if (led.send_authority !== "DENIED") die(`${key}: send authority is not DENIED`);
  if (led.mapping_authority !== "DENIED") die(`${key}: mapping authority is not DENIED`);
  if (led.activation_authority !== "NOT_GRANTED") die(`${key}: activation authority is granted`);
  if (led.disposition !== "APPROVED_UNMAPPED") die(`${key}: ledger disposition is not APPROVED_UNMAPPED`);

  const evidenceBound = EVIDENCE_BOUND.has(key);
  return {
    internal_template_key: key,
    provider_template_name: name,
    provider_language: pkt.provider_language,
    requested_category: pkt.category,
    component_profile: pkt.component_profile,
    payload_fingerprint: pkt.payload_fingerprint,
    proven_remote_status: "APPROVED",
    proven_remote_category: "UTILITY",
    readback_semantic_match: true,
    local_submission_state: "APPROVED_UNMAPPED",
    desired_mapping_state: "INACTIVE",
    // Never a remote identifier: the send is keyed on name + language, so this stays null.
    provider_template_id: null,
    // The mapping table is keyed by a SYMBOLIC provider_key, not a provider-account row,
    // so no database identifier appears here.
    provider_account_reference: null,
    provider_key_symbolic: "meta_whatsapp_cloud",
    channel: "whatsapp",
    runtime_activation_state: "DISABLED",
    send_authority: "DENIED",
    mapping_write_authority: "NOT_GRANTED",
    mapping_activation_authority: "NOT_GRANTED",
    flow_classification: evidenceBound ? "EVIDENCE_BOUND_ACK" : "ORDINARY_BUSINESS",
    ordinary_registry_entry: evidenceBound ? false : true,
    consent_lane: evidenceBound ? null : "business",
    consent_scope: evidenceBound ? null : "transactional",
    classification_note: evidenceBound
      ? "Deliberately ABSENT from lib/communication/outboundConsentScope.ts. Neither Meta approval "
        + "nor a future mapping row grants ordinary transactional authority. Reachable only through "
        + "its exact evidence-bound inbound HELP/STOP/START flow."
      : "Retains its existing outbound registry lane (business / transactional). A mapping row "
        + "changes nothing about consent: suppression, runtime policy, an enabled provider account "
        + "and an ACTIVE exact mapping are all still required before any send.",
  };
});

const readiness = {
  artifact: "meta-template-inactive-mapping-readiness",
  schema_version: "1.0",
  phase: "QF-MVP-40.11",
  status: "OFFLINE_READY_FOR_CONTROLLED_STAGING_SEED",
  contains_secrets: false,
  authorizes_meta_calls: false,
  authorizes_database_reads: false,
  authorizes_database_writes: false,
  authorizes_mapping_creation: false,
  authorizes_mapping_activation: false,
  authorizes_provider_account_activation: false,
  authorizes_runtime_activation: false,
  authorizes_sending: false,
  authorizes_staging_canary: false,
  authorizes_deployment: false,
  note: "NON-SECRET offline readiness record. It AUTHORIZES NOTHING. It pins the eight templates Meta "
    + "has approved as UTILITY so a LATER, separately authorized phase can seed them as INACTIVE rows "
    + "in the EXISTING public.communication_provider_template_mappings table. No provider template id, "
    + "WABA id, phone-number id, request id, token, phone number, raw provider response or database "
    + "identifier appears here. The Meta send payload is keyed on template name + language, so a remote "
    + "template id is never required at dispatch and has no reason to live in this repository.",
  reused_architecture: {
    mapping_table: "public.communication_provider_template_mappings",
    mapping_uniqueness: "uq_comm_provider_template_mapping (template_key, channel, provider_key, language, version)",
    active_uniqueness: "uq_comm_provider_template_active — partial unique WHERE is_active",
    inactive_default: "communication_provider_template_mappings.is_active DEFAULT false",
    pure_selector: "lib/communication/whatsappTemplate.ts :: selectApprovedProviderMapping",
    mapping_service: "services/providerTemplateMappingService.ts",
    final_outbound_gate: "lib/communication/approvedTemplateOutbound.ts",
    runtime_gate: "lib/communication/providers/metaRuntimeGate.ts",
    consent_authority: "lib/communication/outboundConsentScope.ts",
    provider_account_table: "public.communication_provider_accounts",
    note: "No new mapping system, provider-account abstraction, schema or migration is introduced. "
      + "The existing contracts are authoritative and already express an inactive mapping safely.",
  },
  source_manifest: MANIFEST,
  source_manifest_fingerprint: sha256(manifestRaw),
  source_remote_state: REMOTE_STATE,
  source_remote_state_fingerprint: sha256(remoteRaw),
  source_packet: PACKET,
  source_packet_fingerprint: sha256(packetRaw),
  counts: {
    total: records.length,
    evidence_bound_ack: records.filter((r) => r.flow_classification === "EVIDENCE_BOUND_ACK").length,
    ordinary_business: records.filter((r) => r.flow_classification === "ORDINARY_BUSINESS").length,
    desired_active: records.filter((r) => r.desired_mapping_state !== "INACTIVE").length,
  },
  future_staging_seed_prerequisites: [
    "Explicit owner authorization naming the exact branch and commit SHA.",
    "STAGING environment only — the effective Supabase project must be proven staging before any read.",
    "Provider account identity verified against public.communication_provider_accounts.",
    "The provider account must exist DISABLED, and stay disabled through the whole seed.",
    "Remote reconciliation per template: exact provider_template_name, language, category and semantic readback.",
    "Duplicate / collision check against uq_comm_provider_template_mapping before any write.",
    "INACTIVE mappings only — is_active false; never flip an existing active row.",
    "Single transaction with a proven rollback path; roll back on any uncertainty.",
    "Zero message sends, zero provider write calls.",
    "Post-write readback proving every seeded row is inactive and the account is still disabled.",
    "Runtime policy must remain disabled throughout.",
    "Sanitized evidence archived OUTSIDE the repository.",
  ],
  explicit_non_authorizations: [
    "This artefact does not authorize any Meta API call.",
    "It does not authorize a database read or write, in any environment.",
    "It does not create, upsert or activate a provider template mapping.",
    "It does not create or activate a provider account.",
    "It does not enable a runtime policy, webhook or canary.",
    "It does not authorize sending any WhatsApp message.",
    "It does not authorize a deployment.",
    "It does not add a consent acknowledgement to the ordinary outbound registry.",
    "It does not resume template submission, which remains PAUSED.",
  ],
  templates: records,
};

writeFileSync(resolve(OUT), JSON.stringify(readiness, null, 2) + "\n", "utf8");
console.log(`inactive-mapping readiness written: ${OUT}`);
console.log(`templates: ${records.length} · evidence-bound: ${readiness.counts.evidence_bound_ack} `
  + `· ordinary: ${readiness.counts.ordinary_business} · desired active: ${readiness.counts.desired_active}`);
console.log(`manifest fingerprint     : ${readiness.source_manifest_fingerprint}`);
console.log(`remote-state fingerprint : ${readiness.source_remote_state_fingerprint}`);
console.log(`packet fingerprint       : ${readiness.source_packet_fingerprint}`);
