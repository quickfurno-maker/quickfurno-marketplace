// ============================================================================
// QuickFurno — scripts/phase3b-recovery-harness.ts
// Phase 3B deterministic test harness (no DB, no network).
//
// Exercises the PURE recovery core (services/leadQualityRecoveryCore.ts) and the
// Phase 3A diagnostics core for the before/after transition + accounting checks,
// plus static read/write-boundary proofs on the two recovery services.
//
// Quality V2 scoring and the Phase 2 matcher are REUSED verbatim by the services
// (not re-implemented), so the harness validates the NEW Phase 3B surface: input
// reconstruction, decision comparison, the retry gate/precondition, matcher-status
// mapping, rescore↔retry separation, and the read/write boundary. Run with:
//   node scripts/phase3b-recovery-harness.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RecoveryLeadRow, RecoveryQualityDecision, RescoreResult } from "../services/leadQualityRecoveryCore";
import type {
  DiagnosticAssignmentRow,
  DiagnosticDeliveryRow,
  DiagnosticLeadRow,
  DiagnosticMatchingRunRow,
  DiagnosticScoreRow,
  LeadProcessingAnomalyCode,
  LeadProcessingDiagnostic,
  LeadProcessingDiagnosticSources,
} from "../services/leadProcessingDiagnosticsCore";

const recoveryUrl = new URL("../services/leadQualityRecoveryCore.ts", import.meta.url).href;
const recovery = (await import(recoveryUrl)) as typeof import("../services/leadQualityRecoveryCore");
const diagUrl = new URL("../services/leadProcessingDiagnosticsCore.ts", import.meta.url).href;
const diag = (await import(diagUrl)) as typeof import("../services/leadProcessingDiagnosticsCore");

const { buildRescoreQualityInput, summarizeRescoreComparison, evaluateRetryQualityGate, classifyRetryPrecondition, mapMatcherStatusToRetryStatus } = recovery;
const { composeLeadDiagnostic } = diag;

// ---- assertion framework ---------------------------------------------------
let passed = 0;
let failed = 0;
const failureLines: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    const line = `  FAIL  ${name}${detail ? ` — ${detail}` : ""}`;
    failureLines.push(line);
    console.log(line);
  }
}
function hasCode(d: LeadProcessingDiagnostic, code: LeadProcessingAnomalyCode): boolean {
  return d.anomalies.some((a) => a.code === code);
}
function readSource(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// ---- fixture builders ------------------------------------------------------
function lead(over: Partial<RecoveryLeadRow> = {}): RecoveryLeadRow {
  return {
    id: "lead-x",
    name: "Fixture Client",
    phone: "9876543210",
    city: "Pune",
    area: "Kharadi",
    service_required: "Full Home Interior",
    subcategory: "Interior Designers",
    budget: "200000",
    timeline: "Within One Month",
    property_type: "Apartment",
    message: "Category: Interior | GPS: 18.55, 73.95",
    share_consent: true,
    location_consent: true,
    location_source: "google_place",
    latitude: 18.55,
    longitude: 73.95,
    google_place_id: "gp-1",
    formatted_address: "Kharadi, Pune",
    area_normalized: "kharadi",
    sublocality: "Kharadi",
    neighborhood: null,
    is_duplicate: false,
    lead_intent: null,
    assignment_intent: null,
    status: "New",
    ...over,
  };
}
const passDecision: RecoveryQualityDecision = { score: 76, class: "A", status: "qualified", hard_block_reason: null, recommended_action: "auto_distribute", score_model_version: "lead_quality_v2" };
const passCurrent: RescoreResult["current"] = { score: 76, class: "A", status: "qualified", hard_block_reason: null, recommended_action: "auto_distribute", score_model_version: "lead_quality_v2" };

// diagnostics source builders (compact).
function dLead(over: Partial<DiagnosticLeadRow> = {}): DiagnosticLeadRow {
  return { id: "lead-x", created_at: "2026-07-05T10:00:00.000Z", name: "Fixture", status: "New", verification_status: "Quality Checked", is_duplicate: false, duplicate_of: null, city: "Pune", area: "Kharadi", service_required: "Full Home Interior", subcategory: "Interior Designers", lead_quality_score: null, lead_quality_class: null, lead_quality_status: null, lead_quality_hard_block_reason: null, lead_quality_recommended_action: null, ...over };
}
function dScore(over: Partial<DiagnosticScoreRow> = {}): DiagnosticScoreRow {
  return { id: "s1", lead_id: "lead-x", total_score: 76, score_class: "A", hard_block_reason: null, recommended_action: "auto_distribute", score_breakdown: { score_model_version: "lead_quality_v2" }, created_at: "2026-07-05T10:00:01.000Z", ...over };
}
function dRun(over: Partial<DiagnosticMatchingRunRow> = {}): DiagnosticMatchingRunRow {
  return { id: "r1", lead_id: "lead-x", run_status: "matched", eligible_vendor_count: 2, selected_vendor_ids: ["v1", "v2"], assigned_vendor_ids: ["v1", "v2"], failure_reason: null, matching_snapshot: { matching_model_version: "distance_category_matching_phase2" }, created_at: "2026-07-05T10:00:02.000Z", ...over };
}
function dAssign(over: Partial<DiagnosticAssignmentRow> = {}): DiagnosticAssignmentRow {
  return { id: "a1", lead_id: "lead-x", vendor_id: "v1", assignment_type: "auto_assigned", credit_deducted: true, assigned_at: "2026-07-05T10:00:03.000Z", ...over };
}
function dDelivery(over: Partial<DiagnosticDeliveryRow> = {}): DiagnosticDeliveryRow {
  return { id: "d1", lead_id: "lead-x", vendor_id: "v1", assignment_id: "a1", delivery_channel: "vendor_dashboard", delivery_status: "delivered", credit_deducted: true, ...over };
}
function dSources(over: Partial<LeadProcessingDiagnosticSources> & { lead: DiagnosticLeadRow | null }): LeadProcessingDiagnosticSources {
  return { lead_id: over.lead?.id ?? "lead-x", lead: over.lead, latest_score: over.latest_score ?? null, latest_matching_run: over.latest_matching_run ?? null, assignments: over.assignments ?? [], delivery_logs: over.delivery_logs ?? [], client_notifications: over.client_notifications ?? [] };
}

console.log("QuickFurno Phase 3B — recovery harness\n");

// B1 — unchanged rescore.
{
  const { decision_changed, change_summary } = summarizeRescoreComparison(passDecision, passCurrent);
  check("B1 decision_changed false", decision_changed === false);
  check("B1 no field changed", !change_summary.score_changed && !change_summary.class_changed && !change_summary.action_changed && !change_summary.hard_block_changed);
}

// B2 — budget fit improves.
{
  const input = buildRescoreQualityInput(lead({ budget: "500000" }));
  check("B2 budget mapped from stored lead", input.budget === "500000");
  const { decision_changed, change_summary } = summarizeRescoreComparison(
    { score: 55, class: "C", status: "nurture", hard_block_reason: null, recommended_action: "nurture", score_model_version: "lead_quality_v2" },
    passCurrent,
  );
  check("B2 decision_changed true", decision_changed === true);
  check("B2 score+class+action changed", change_summary.score_changed && change_summary.class_changed && change_summary.action_changed);
}

// B3 — duplicate rescore (reconstruction carries duplicate → Quality V2 hard-blocks).
{
  const input = buildRescoreQualityInput(lead({ is_duplicate: true }));
  check("B3 is_duplicate mapped true", input.is_duplicate === true);
}

// B4 — no-consent rescore.
{
  const input = buildRescoreQualityInput(lead({ share_consent: false }));
  check("B4 share_consent mapped false", input.share_consent === false);
}

// B5 — invalid phone rescore (passed through; Quality V2 flags invalid_phone).
{
  const input = buildRescoreQualityInput(lead({ phone: "12345" }));
  check("B5 phone passed through unchanged", input.phone === "12345");
}

// B6 — inactive city (city passed through; serviceability computed by scoreAndStoreLead).
{
  const input = buildRescoreQualityInput(lead({ city: "Nowhereville" }));
  check("B6 city passed through", input.city === "Nowhereville");
  check("B6 serviceable_city not fabricated", input.serviceable_city === undefined);
}

// Provenance (Part 2): message verbatim, no email/pincode signals injected.
{
  const input = buildRescoreQualityInput(lead({ message: "Category: Interior | Notes: system generated" }));
  check("Prov message passed verbatim", input.message === "Category: Interior | Notes: system generated");
  check("Prov no email field in reconstructed input", !("email" in (input as Record<string, unknown>)));
}

// B7 — score persistence consistency (post-rescore: latest score == mirror).
{
  const d = composeLeadDiagnostic(
    dSources({
      lead: dLead({ lead_quality_score: 76, lead_quality_class: "A", lead_quality_status: "qualified", lead_quality_recommended_action: "auto_distribute" }),
      latest_score: dScore(),
    }),
  );
  check("B7 mirror_consistent true after consistent rescore", d.quality.mirror_consistent === true);
}

// B8 — valid A lead, no assignments → proceed.
check("B8 proceed (A, no assignments)", classifyRetryPrecondition({ leadExists: true, isDuplicate: false, gatePassed: true, assignmentCount: 0 }) === "proceed");

// B9 — B lead → quality_gate_hold.
{
  const gate = evaluateRetryQualityGate({ score: 66, class: "B", status: null, hard_block_reason: null, recommended_action: "clarification_required", score_model_version: null });
  check("B9 gate not passed for B", gate.passed === false);
  check("B9 quality_gate_hold", classifyRetryPrecondition({ leadExists: true, isDuplicate: false, gatePassed: gate.passed, assignmentCount: 0 }) === "quality_gate_hold");
}

// B10 — duplicate lead → duplicate_lead.
check("B10 duplicate_lead", classifyRetryPrecondition({ leadExists: true, isDuplicate: true, gatePassed: true, assignmentCount: 0 }) === "duplicate_lead");

// B11 — already-assigned lead → already_assigned (matcher NOT invoked).
check("B11 already_assigned", classifyRetryPrecondition({ leadExists: true, isDuplicate: false, gatePassed: true, assignmentCount: 2 }) === "already_assigned");

// B12 — waiting lead retry → proceed; matcher status maps through.
{
  check("B12 proceed for waiting lead (0 assignments)", classifyRetryPrecondition({ leadExists: true, isDuplicate: false, gatePassed: true, assignmentCount: 0 }) === "proceed");
  check("B12 map matched", mapMatcherStatusToRetryStatus("matched") === "matched");
  check("B12 map waiting", mapMatcherStatusToRetryStatus("waiting") === "waiting");
}

// B13 — repeated retry: first proceeds, second already_assigned.
{
  check("B13 first retry proceeds", classifyRetryPrecondition({ leadExists: true, isDuplicate: false, gatePassed: true, assignmentCount: 0 }) === "proceed");
  check("B13 second retry already_assigned", classifyRetryPrecondition({ leadExists: true, isDuplicate: false, gatePassed: true, assignmentCount: 2 }) === "already_assigned");
}

// B14 — concurrent retry model: both may observe 0 (Layer 1 TOCTOU); Layer 2 (RPC) protects.
{
  const a = classifyRetryPrecondition({ leadExists: true, isDuplicate: false, gatePassed: true, assignmentCount: 0 });
  const b = classifyRetryPrecondition({ leadExists: true, isDuplicate: false, gatePassed: true, assignmentCount: 0 });
  check("B14 both attempts may proceed (Layer 1 is best-effort)", a === "proceed" && b === "proceed");
  const retrySrc = stripComments(readSource("../services/leadProcessingRecoveryService.ts"));
  check("B14 retry has no direct credit/package write (relies on RPC idempotency)", !/vendor_credit_logs|vendor_packages/.test(retrySrc) && !/\.(insert|update|delete|upsert|rpc)\s*\(/.test(retrySrc));
}

// B15 — rescore ≠ retry separation.
{
  const { decision_changed } = summarizeRescoreComparison(
    { score: 66, class: "B", status: "clarification_required", hard_block_reason: null, recommended_action: "clarification_required", score_model_version: "lead_quality_v2" },
    passCurrent,
  );
  check("B15 rescore decision_changed true (B→A)", decision_changed === true);
  const rescoreSrc = readSource("../services/leadQualityRecoveryService.ts");
  const retrySrc = readSource("../services/leadProcessingRecoveryService.ts");
  check("B15 rescore does NOT invoke matcher/assignment", !/runAutoLeadMatchingForLead|assign_lead_to_paid_vendors/.test(rescoreSrc));
  check("B15 retry DOES invoke matcher", /runAutoLeadMatchingForLead/.test(retrySrc));
}

// B16 — diagnostic transition (before retry → after retry).
{
  const before = composeLeadDiagnostic(
    dSources({
      lead: dLead({ status: "Hot Lead", lead_quality_score: 76, lead_quality_class: "A", lead_quality_status: "qualified", lead_quality_recommended_action: "auto_distribute" }),
      latest_score: dScore(),
      latest_matching_run: dRun({ run_status: "waiting", eligible_vendor_count: 2, selected_vendor_ids: ["v1", "v2"], assigned_vendor_ids: [], failure_reason: "no_eligible_vendors" }),
      assignments: [],
    }),
  );
  check("B16 before: selected_but_unassigned", hasCode(before, "selected_but_unassigned"));
  check("B16 before: waiting_with_eligible_vendors", hasCode(before, "waiting_with_eligible_vendors"));

  const after = composeLeadDiagnostic(
    dSources({
      lead: dLead({ status: "Assigned", lead_quality_score: 76, lead_quality_class: "A", lead_quality_status: "qualified", lead_quality_recommended_action: "auto_distribute" }),
      latest_score: dScore(),
      latest_matching_run: dRun(),
      assignments: [dAssign({ id: "a1", vendor_id: "v1" }), dAssign({ id: "a2", vendor_id: "v2" })],
      delivery_logs: [dDelivery({ id: "d1", vendor_id: "v1", assignment_id: "a1" }), dDelivery({ id: "d2", vendor_id: "v2", assignment_id: "a2" })],
    }),
  );
  check("B16 after: matched", after.matching.run_status === "matched");
  check("B16 after: assignment_count > 0", after.assignments.count > 0);
  check("B16 after: no selected_but_unassigned", !hasCode(after, "selected_but_unassigned"));
  check("B16 after: no waiting_with_eligible_vendors", !hasCode(after, "waiting_with_eligible_vendors"));
}

// B17 — accounting safety (verify only; no accounting code touched).
{
  const after = composeLeadDiagnostic(
    dSources({
      lead: dLead({ status: "Assigned", lead_quality_score: 76, lead_quality_class: "A", lead_quality_status: "qualified", lead_quality_recommended_action: "auto_distribute" }),
      latest_score: dScore(),
      latest_matching_run: dRun(),
      assignments: [dAssign({ id: "a1", vendor_id: "v1", credit_deducted: true }), dAssign({ id: "a2", vendor_id: "v2", credit_deducted: true })],
      delivery_logs: [
        dDelivery({ id: "d1", vendor_id: "v1", assignment_id: "a1" }),
        dDelivery({ id: "d2", vendor_id: "v2", assignment_id: "a2" }),
        dDelivery({ id: "w1", vendor_id: "v1", assignment_id: "a1", delivery_channel: "whatsapp_preview", delivery_status: "preview_created", credit_deducted: false }),
        dDelivery({ id: "w2", vendor_id: "v2", assignment_id: "a2", delivery_channel: "whatsapp_preview", delivery_status: "preview_created", credit_deducted: false }),
      ],
    }),
  );
  check("B17 credit_deducted_assignment_count == 2", after.assignments.credit_deducted_assignment_count === 2);
  check("B17 whatsapp previews (credit_deducted=false) not charges", after.delivery.whatsapp_preview_count === 2);
  check("B17 accounting mode unchanged (verify-only)", after.accounting.accounting_correlation_mode.length > 0 && after.accounting.accounting_consistent === null);
}

// Read/write boundary proof (Part 21).
{
  const writeCall = /\.(insert|update|delete|upsert|rpc)\s*\(/;
  const rescoreSrc = stripComments(readSource("../services/leadQualityRecoveryService.ts"));
  const retrySrc = stripComments(readSource("../services/leadProcessingRecoveryService.ts"));
  const coreSrc = stripComments(readSource("../services/leadQualityRecoveryCore.ts"));
  check("Boundary rescore: no direct write calls (writes go via scoreAndStoreLead)", !writeCall.test(rescoreSrc));
  check("Boundary rescore: no assignment/credit/package/delivery/matching refs", !/lead_assignments|vendor_credit_logs|vendor_packages|lead_delivery_logs|client_notification_logs|lead_matching_runs|runAutoLeadMatchingForLead/.test(rescoreSrc));
  check("Boundary retry: no direct write calls", !writeCall.test(retrySrc));
  check("Boundary retry: no direct credit/package writes", !/vendor_credit_logs|vendor_packages/.test(retrySrc));
  check("Boundary core: pure (no write calls)", !writeCall.test(coreSrc));
}

// ---- summary ---------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const line of failureLines) console.log(line);
  process.exit(1);
}
console.log("All Phase 3B harness cases passed.");
