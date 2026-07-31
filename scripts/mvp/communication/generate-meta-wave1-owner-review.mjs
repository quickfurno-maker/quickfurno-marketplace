// ============================================================================
// QF-MVP-40.10B — deterministic Wave 1 OWNER-REVIEW packet generator.  OFFLINE.
//
// Derives a non-secret review artefact from the already-generated full submission
// packet. It contacts no network, calls no Meta endpoint, submits nothing and reads
// no credential.
//
// THIS ARTEFACT AUTHORIZES ZERO META CALLS. It exists so the owner can review 14
// external templates one at a time — exact copy, category and fingerprint — before
// any of them is submitted. It copies content verbatim from the source packet and
// never rewrites copy, category, language, profile, payload or fingerprint.
//
// Deterministic on purpose: no timestamp is embedded, so regenerating an unchanged
// source yields a byte-identical file and a review diff shows only real changes.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = "docs/provider-manifests/meta-template-submission-packet.json";
const OUT = "docs/provider-manifests/meta-wave1-owner-review.json";

/** Ordinary launch workflow copy. */
const GROUP_A = Object.freeze([
  "clarification_reminder", "clarification_request", "client_lead_status_update",
  "client_matching_update", "consent_start_acknowledgement", "consent_stop_acknowledgement",
  "lead_assignment_alert", "lead_received", "vendor_new_lead",
  "vendor_onboarding_reminder", "vendor_response_reminder",
]);
/**
 * Credit / recharge / package-renewal calls to action. Grouped separately ONLY as a
 * review boundary — this asserts nothing about whether their category is correct.
 */
const GROUP_B = Object.freeze([
  "low_credit_warning", "recharge_reminder", "vendor_package_expiry_warning",
]);

const raw = readFileSync(resolve(SOURCE));
const sourceFingerprint = createHash("sha256").update(raw).digest("hex");
const packet = JSON.parse(raw.toString("utf8"));

const wave1 = packet.templates
  .filter((t) => t.submission_wave === 1)
  .sort((a, b) => a.internal_template_key.localeCompare(b.internal_template_key));

if (wave1.length !== 14) {
  console.error(`Refusing to generate: expected exactly 14 Wave 1 templates, found ${wave1.length}.`);
  process.exit(2);
}

const expected = [...GROUP_A, ...GROUP_B].sort();
const actual = wave1.map((t) => t.internal_template_key).sort();
if (JSON.stringify(expected) !== JSON.stringify(actual)) {
  console.error("Refusing to generate: the Wave 1 key set does not match the reviewed grouping.");
  process.exit(2);
}

/**
 * QF-MVP-40.10E: an entry that Meta has already APPROVED is no longer "pending review" —
 * its authorization was CONSUMED by the single submission that produced the approval.
 * The closed state is DERIVED from the packet, not hard-coded to a key, so the next
 * approval closes itself and a template can never be reported as both approved-remote
 * and awaiting-review. `CONSUMED` is deliberately not `AUTHORIZED`: it records that the
 * one-shot authorization has been spent, and it re-authorizes nothing.
 */
const isClosed = (t) => t.local_state.approval_status === "approved"
  && t.local_state.submission_state === "APPROVED_UNMAPPED";

const templates = wave1.map((t) => {
  const inA = GROUP_A.includes(t.internal_template_key);
  const closed = isClosed(t);
  return {
    internal_template_key: t.internal_template_key,
    provider_template_name: t.provider_template_name,
    provider_language: t.provider_language,
    requested_category: t.category,
    component_profile: t.component_profile,
    creation_payload: t.creation_payload,        // verbatim, never rewritten
    payload_fingerprint: t.payload_fingerprint,  // verbatim, never recomputed here
    submission_group: inA ? "WAVE1A_ORDINARY_LAUNCH" : "WAVE1B_COMMERCIAL_CATEGORY_REVIEW",
    owner_copy_decision: closed ? "APPROVED_BY_OWNER" : "PENDING_OWNER_REVIEW",
    category_review_decision: closed
      ? "UTILITY_MACHINE_PROVEN"
      : (inA ? "REVIEW_REQUIRED" : "HOLD_FOR_EXPLICIT_CATEGORY_REVIEW"),
    submission_authorization: closed ? "CONSUMED" : "NOT_AUTHORIZED",
    remote_submission_state: closed ? "APPROVED_UNMAPPED" : "NOT_SUBMITTED",
  };
});

const closedEntries = templates.filter((t) => t.remote_submission_state === "APPROVED_UNMAPPED");
const pendingEntries = templates.filter((t) => t.owner_copy_decision === "PENDING_OWNER_REVIEW");

const review = {
  artifact: "meta-wave1-owner-review",
  schema_version: "1.0",
  phase: "QF-MVP-40.10G",
  status: closedEntries.length === 0 ? "OWNER_REVIEW_PENDING"
    : (pendingEntries.length === 0 ? "FULLY_REVIEWED" : "PARTIALLY_REVIEWED"),
  authorizes_meta_calls: false,
  note: "NON-SECRET owner-review artefact. It AUTHORIZES ZERO META CALLS. Every entry is copied "
    + "verbatim from the source submission packet: copy, category, language, component profile, "
    + "payload and fingerprint are never rewritten here. Group B is a REVIEW BOUNDARY only and "
    + "asserts nothing about whether its category is correct. "
    + `${closedEntries.map((t) => t.internal_template_key).join(", ") || "No entry"} `
    + "was submitted once and is now APPROVED / UNMAPPED / HELD FROM CREATION — its one-shot "
    + "authorization is CONSUMED, and being approved grants no consent, mapping, activation or "
    + `send authority. The other ${pendingEntries.length} entries authorize ZERO Meta calls and `
    + "remain NOT_AUTHORIZED / NOT_SUBMITTED. Nothing here is a blanket Wave 1 authorization: "
    + "each further submission needs its own explicit owner authorization.",
  source_packet: SOURCE,
  source_packet_fingerprint: sourceFingerprint,
  counts: {
    total: templates.length,
    approved_unmapped: closedEntries.length,
    pending_owner_review: pendingEntries.length,
    WAVE1A_ORDINARY_LAUNCH: templates.filter((t) => t.submission_group === "WAVE1A_ORDINARY_LAUNCH").length,
    WAVE1B_COMMERCIAL_CATEGORY_REVIEW: templates.filter((t) => t.submission_group === "WAVE1B_COMMERCIAL_CATEGORY_REVIEW").length,
  },
  submission_protocol: [
    "Owner reviews every entry: exact copy, requested category and fingerprint.",
    "Run Wave 0 read-only reconciliation and PROVE approval before touching Wave 1.",
    "Authorize a specific subset explicitly — never the whole wave at once.",
    "Submit ONE exact internal_template_key per operator run (--template).",
    "Stop on the first non-success. No retries.",
    "Reconcile each remote status read-only.",
    "Seed provider mappings INACTIVE only in a later separately authorized step.",
    "No send or canary until mappings and staging gates are ready.",
  ],
  templates,
};

writeFileSync(resolve(OUT), JSON.stringify(review, null, 2) + "\n", "utf8");
console.log(`wave 1 owner-review packet written: ${OUT}`);
console.log(`entries: ${templates.length} · A=${review.counts.WAVE1A_ORDINARY_LAUNCH} · B=${review.counts.WAVE1B_COMMERCIAL_CATEGORY_REVIEW}`);
console.log(`source packet fingerprint: ${sourceFingerprint}`);
