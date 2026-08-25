// ============================================================================
// QF-MVP-40 — CRITERION 9 OFFLINE READINESS EVALUATOR.  OFFLINE. READ-ONLY.
//
// Criterion 9 ("campaign canary succeeds") is a locked live exit criterion. This evaluator
// reports how much of it is SOURCE-READY and, just as importantly, refuses to let source
// readiness be mistaken for live readiness.
//
// THE DISTINCTION THIS FILE EXISTS TO ENFORCE
//   SOURCE_READY  — the code, schema and governance artifact exist and are proven offline.
//   LIVE_REQUIRED — a staging DB write, a live consent record, a mapping seed, an active
//                   frequency policy, a frozen audience, a provider arm or a live
//                   send/callback is still needed. NOTHING here can satisfy those.
//
// No item may be reported COMPLETE or live-certified. The overall verdict is deliberately
// hard-capped: while any item carries a live requirement, criterion 9 is BLOCKED.
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const read = (p) => readFileSync(resolve(p), "utf8");
const readJson = (p) => JSON.parse(read(p));
const has = (p) => existsSync(resolve(p));

export const State = Object.freeze({
  SOURCE_READY: "SOURCE_READY",
  EXISTS_BUT_REQUIRES_CONFIGURATION: "EXISTS_BUT_REQUIRES_CONFIGURATION",
  SOURCE_GAP: "SOURCE_GAP",
  OWNER_DECISION_REQUIRED: "OWNER_DECISION_REQUIRED",
  LIVE_PROOF_REQUIRED: "LIVE_PROOF_REQUIRED",
});

const LEDGER = "docs/provider-manifests/meta-template-remote-state.json";
const READINESS = "docs/provider-manifests/meta-template-inactive-mapping-readiness.json";
const POLICY = "docs/provider-manifests/qf-mvp-40-marketing-canary-policy-contract.json";
const MARKETING_OP = "scripts/mvp/communication/seed-meta-marketing-mapping-once.mjs";
const CONSENT_SVC = "services/communicationMarketingConsentWriterService.ts";
const CONSENT_MIGRATION = "supabase/migrations/20260814000000_qf_mvp_40_marketing_consent_writer.sql";

/**
 * PURE. Builds the nine-item matrix from committed source facts. Every `liveRequired`
 * entry names the exact live act still outstanding, so no item can be quietly upgraded.
 */
export function evaluate({ ledger, readiness, policy, marketingOpSrc, consentSvcSrc, migrationSrc }) {
  const crm = (ledger.entries ?? [])
    .find((e) => e.provider_template_name === "qf_vendor_crm_promotion_v1");
  const emitted = (readiness.templates ?? []).map((t) => t.provider_template_name);

  return [
    {
      id: 1,
      item: "provider template APPROVED/MARKETING",
      state: (crm && crm.last_proven_status === "APPROVED"
        && crm.last_proven_remote_category === "MARKETING"
        && crm.reconciliation_outcome === "RECONCILED_APPROVED")
        ? State.SOURCE_READY : State.SOURCE_GAP,
      evidence: "meta-staging-vendor-crm-promotion-v1-reconciliation.json",
      liveRequired: null,
    },
    {
      id: 2,
      item: "inactive marketing mapping source-ready",
      state: (/is_active: false/.test(marketingOpSrc)
        && /TARGET_TEMPLATE_KEY = "vendor_crm_promotion"/.test(marketingOpSrc)
        && /MAPPING_PROVIDER_CATEGORY = "marketing"/.test(marketingOpSrc))
        ? State.SOURCE_READY : State.SOURCE_GAP,
      evidence: MARKETING_OP,
      liveRequired: "a staging DB write to create the INACTIVE mapping row (separately authorized)",
    },
    {
      id: 3,
      item: "explicit marketing consent writer source-ready",
      state: (/qf_apply_marketing_consent_v1/.test(consentSvcSrc)
        && /qf_apply_marketing_consent_v1/.test(migrationSrc)
        && /scope.*hard-coded|hard-coded 'marketing'/.test(migrationSrc))
        ? State.SOURCE_READY : State.SOURCE_GAP,
      evidence: `${CONSENT_SVC} + ${CONSENT_MIGRATION}`,
      liveRequired: "the migration must be applied, and a real explicit opt-in recorded for the "
        + "owner-controlled canary principal (both separately authorized)",
    },
    {
      id: 4,
      item: "owner frequency policy locked",
      state: (policy.policy?.max_per_window === 1
        && policy.policy?.window_length === "30 days"
        && policy.policy?.min_interval === "30 days"
        && policy.schema_constraint_verification?.all_satisfied === true
        && policy.applied === false)
        ? State.SOURCE_READY : State.OWNER_DECISION_REQUIRED,
      evidence: POLICY,
      liveRequired: "an ACTIVE row in communication_frequency_policies (separately authorized)",
    },
    {
      id: 5,
      item: "frozen audience capability exists",
      state: has("services/campaignHandoffService.ts")
        ? State.EXISTS_BUT_REQUIRES_CONFIGURATION : State.SOURCE_GAP,
      evidence: "QF-MVP-30.5 segment/snapshot path",
      liveRequired: "a frozen audience fixture containing exactly the owner-controlled canary recipient",
    },
    {
      id: 6,
      item: "campaign approval / handoff exists",
      state: has("services/campaignHandoffService.ts") ? State.SOURCE_READY : State.SOURCE_GAP,
      evidence: "services/campaignHandoffService.ts + qf_handoff_vendor_campaign_intents_v1",
      liveRequired: "an approved campaign and a handoff run (separately authorized)",
    },
    {
      id: 7,
      item: "canary arm / disable exists",
      state: has("scripts/mvp/communication/activate-meta-staging-canary-cli.mjs")
        ? State.SOURCE_READY : State.SOURCE_GAP,
      evidence: "activate-meta-staging-canary-cli.mjs + canaryActivationRuntime.mjs",
      liveRequired: "a provider arm and a restore cycle (separately authorized)",
    },
    {
      id: 8,
      item: "delivery / result reconciliation exists",
      state: has("services/campaignCommunicationResultService.ts")
        ? State.SOURCE_READY : State.SOURCE_GAP,
      evidence: "services/campaignCommunicationResultService.ts + QF-MVP-40.8 contract",
      liveRequired: "live delivery callbacks",
    },
    {
      id: 9,
      item: "fail-closed restoration exists",
      state: has("scripts/mvp/communication/canaryActivationRuntime.mjs")
        ? State.SOURCE_READY : State.SOURCE_GAP,
      evidence: "canaryActivationRuntime.mjs --disable path",
      liveRequired: "a live disable + fail-closed readback",
    },
  ].map((r) => Object.freeze({
    ...r,
    // A marketing template must never be reachable through Utility mapping readiness.
    marketingLeakedIntoUtilityReadiness: emitted.includes("qf_vendor_crm_promotion_v1"),
  }));
}

/**
 * The verdict is hard-capped. Source readiness NEVER becomes live readiness here, and the
 * only value this can return while any live act is outstanding is BLOCKED.
 */
export function verdict(matrix) {
  const liveOutstanding = matrix.filter((r) => r.liveRequired !== null);
  const sourceGaps = matrix.filter((r) => r.state === State.SOURCE_GAP);
  const leaked = matrix.some((r) => r.marketingLeakedIntoUtilityReadiness);
  return Object.freeze({
    criterion: 9,
    status: "BLOCKED",
    complete: false,
    live_certified: false,
    source_ready_count: matrix.filter((r) => r.state === State.SOURCE_READY).length,
    source_gap_count: sourceGaps.length,
    live_acts_outstanding: liveOutstanding.length,
    marketing_leaked_into_utility_readiness: leaked,
  });
}

const isEntry = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntry) {
  const matrix = evaluate({
    ledger: readJson(LEDGER),
    readiness: readJson(READINESS),
    policy: readJson(POLICY),
    marketingOpSrc: read(MARKETING_OP),
    consentSvcSrc: read(CONSENT_SVC),
    migrationSrc: read(CONSENT_MIGRATION),
  });
  console.log("== QF-MVP-40 CRITERION 9 — OFFLINE READINESS (source only) ==\n");
  for (const r of matrix) {
    console.log(`${String(r.id).padStart(2)}. ${r.item}`);
    console.log(`    state         : ${r.state}`);
    console.log(`    evidence      : ${r.evidence}`);
    console.log(`    still LIVE-req: ${r.liveRequired ?? "none"}`);
  }
  const v = verdict(matrix);
  console.log("\n" + JSON.stringify(v, null, 2));
  console.log("\nCRITERION 9 IS BLOCKED. Source readiness is not live readiness: no item above");
  console.log("is complete or live-certified, and criterion 1 (staging webhook verified) remains");
  console.log("the FIRST live blocker for the whole phase — nothing in the live campaign path");
  console.log("may begin before it passes.");
  const sha = createHash("sha256").update(JSON.stringify(matrix)).digest("hex");
  console.log(`\nmatrix digest: ${sha}`);
  process.exit(0);
}
