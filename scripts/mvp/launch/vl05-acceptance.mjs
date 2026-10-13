// VL-05 is an evidence evaluator, not a production release mechanism.
// It NEVER sends messages, edits vendors, activates memory, changes credits, or deploys.
export const VL05_PROTOCOL = "qf.vendor.vl05.acceptance.v1";
export const REQUIRED_GATES = Object.freeze([
  "core_auth_and_vendor_dashboard",
  "google_office_provider_and_core_zone",
  "vendor_identity_collision_reconciliation",
  "razorpay_sandbox_capture_signature_and_exact_once_wallet",
  "matching_three_vendor_cap_and_one_credit",
  "automation_workshop_durable_delivery_and_provider_receipt",
  "anisha_signed_core_context_and_whatsapp_handoff",
  "anisha_consent_optin_revocation_and_purge_ack",
  "aos_fresh_advisory_no_core_business_side_effect",
  "agni_signed_incident_to_owner_receipt",
  "security_rls_cross_vendor_and_adversarial_replay",
  "signed_release_rollback_rehearsal",
]);

const FULL_SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_EVIDENCE_AGE_MS = 60 * 60 * 1000;

export function assessVl05(evidence, { now = new Date(), coreMainSha = null } = {}) {
  const problems = [];
  const record = evidence && typeof evidence === "object" && !Array.isArray(evidence) ? evidence : {};
  if (record.protocol !== VL05_PROTOCOL) problems.push("invalid_or_missing_protocol");
  if (record.environment !== "staging") problems.push("staging_evidence_only");
  const observed = typeof record.observedAt === "string" ? Date.parse(record.observedAt) : NaN;
  const nowMs = now.getTime();
  if (!Number.isFinite(observed) || observed > nowMs + 60_000 ||
    nowMs - observed > MAX_EVIDENCE_AGE_MS) problems.push("missing_or_stale_observation");

  if (!FULL_SHA.test(record.coreMainSha ?? "") ||
      (coreMainSha && coreMainSha !== record.coreMainSha)) {
    problems.push("unverified_core_main_sha");
  }
  if (!DIGEST.test(record.signedCoreDigest ?? "")) problems.push("missing_exact_signed_digest");

  const provided = record.gates && typeof record.gates === "object" && !Array.isArray(record.gates)
    ? record.gates : {};
  for (const key of REQUIRED_GATES) {
    const gate = provided[key];
    if (!gate || gate.status !== "PASS") {
      problems.push(`gate_${key}_not_certified`);
      continue;
    }
    if (typeof gate.evidenceUrl !== "string" ||
        !/^https:\/\/(github\.com|app\.notion\.com)\//.test(gate.evidenceUrl) ||
        !Number.isFinite(Date.parse(gate.observedAt)) ||
        Date.parse(gate.observedAt) > nowMs + 60_000 ||
        nowMs - Date.parse(gate.observedAt) > MAX_EVIDENCE_AGE_MS) {
      problems.push(`gate_${key}_evidence_missing_or_stale`);
    }
  }
  // Canary facts must be proven and strictly synthetic/allowlisted. This
  // gate does not accept public phone numbers, vendor IDs or raw receipts.
  const c = record.canary || {};
  if (c.synthetic !== true || c.allowlisted !== true || !Number.isInteger(c.testVendorCount) || c.testVendorCount < 1 ||
      c.testVendorCount > 3 || c.authenticatedVendorCount !== c.testVendorCount ||
      c.googleVerifiedOfficeCount !== c.testVendorCount ||
      c.coreZoneResolvedCount !== c.testVendorCount) {
    problems.push("canary_vendor_identity_geo_not_proven");
  }
  if (!Number.isInteger(c.maxAssigneesPerLead) || c.maxAssigneesPerLead > 3 ||
      c.maxAssigneesPerLead < 1 || c.creditDebitsPerDeliveredVendor !== 1 ||
      c.duplicateAssignmentCount !== 0 || c.replayedCreditMutationCount !== 0) {
    problems.push("assignment_credit_replay_invariant_unproven");
  }
  if (c.actualProviderReceiptConfirmed !== true || c.sandboxPaymentConfirmed !== true ||
      c.consentAndErasureConfirmed !== true || c.agniOwnerReceiptConfirmed !== true) {
    problems.push("required_live_provider_consent_owner_evidence_missing");
  }
  // Historic jobs must be classified. The user must never unknowingly
  // reprocess Aug/Sep vendor sends while testing a new live worker.
  if (!Number.isInteger(c.stalePendingJobsClassified) ||
      !Number.isInteger(c.pendingJobsExisting) ||
      c.stalePendingJobsClassified < c.pendingJobsExisting) {
    problems.push("stale_pending_jobs_not_reconciled");
  }
  if (c.noProductionSideEffects !== true) problems.push("staging_effect_boundary_unverified");

  return Object.freeze({
    protocol: VL05_PROTOCOL,
    verdict: problems.length ? "HOLD" : "EVIDENCE_READY_FOR_HUMAN_REVIEW",
    eligibleForProductionPromotion: false,
    message: problems.length ? "VL-05 staging evidence incomplete; no production promotion authorized"
      : "All recorded acceptance fields appear complete; operator must independently verify every external receipt and authorize release separately",
    failures: Object.freeze(problems),
    passedGates: REQUIRED_GATES.filter(k => provided[k]?.status === "PASS").length,
    requiredGates: REQUIRED_GATES.length,
  });
}
