// ============================================================================
// QuickFurno — scripts/phase3a-diagnostics-harness.ts
// Phase 3A deterministic test harness (no DB, no network).
//
// Runs the PURE diagnostic engine (services/leadProcessingDiagnosticsCore.ts)
// against in-memory fixtures A1–A17, plus a static read-only proof (A16) that the
// diagnostic services contain no row-writing calls.
//
// HOW IT RUNS: Node 24 executes TypeScript natively. Types are imported with
// `import type` (fully erased at runtime); the engine's runtime functions are
// loaded via a dynamic import of the `.ts` core module (extension required by
// Node's resolver) while the `typeof import(...)` cast keeps full type-safety for
// tsc / next build. Run with:  node scripts/phase3a-diagnostics-harness.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  DiagnosticAssignmentRow,
  DiagnosticDeliveryRow,
  DiagnosticLeadRow,
  DiagnosticMatchingRunRow,
  DiagnosticNotificationRow,
  DiagnosticScoreRow,
  LeadProcessingAnomalyCode,
  LeadProcessingDiagnostic,
  LeadProcessingDiagnosticSources,
  AnomalySeverity,
  ScanCandidate,
} from "../services/leadProcessingDiagnosticsCore";

// Runtime load of the pure core (the string specifier keeps tsc from checking the
// `.ts` extension; the cast restores full types).
const coreUrl = new URL("../services/leadProcessingDiagnosticsCore.ts", import.meta.url).href;
const core = (await import(coreUrl)) as typeof import("../services/leadProcessingDiagnosticsCore");
const { composeLeadDiagnostic, selectAnomalousScanCandidates } = core;

// ---- tiny assertion framework ---------------------------------------------
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
function severityOf(d: LeadProcessingDiagnostic, code: LeadProcessingAnomalyCode): AnomalySeverity | null {
  return d.anomalies.find((a) => a.code === code)?.severity ?? null;
}
function noneOfSeverity(d: LeadProcessingDiagnostic, ...severities: AnomalySeverity[]): boolean {
  return !d.anomalies.some((a) => severities.includes(a.severity));
}
function codes(d: LeadProcessingDiagnostic): string {
  return d.anomalies.map((a) => `${a.code}:${a.severity}`).join(", ") || "(none)";
}

// ---- fixture builders ------------------------------------------------------
function mkLead(over: Partial<DiagnosticLeadRow> = {}): DiagnosticLeadRow {
  return {
    id: "lead-x",
    created_at: "2026-07-05T10:00:00.000Z",
    name: "Fixture Client",
    status: "New",
    verification_status: "Quality Checked",
    is_duplicate: false,
    duplicate_of: null,
    city: "Pune",
    area: "Kharadi",
    service_required: "Full Home Interior",
    subcategory: "Interior Designers",
    lead_quality_score: null,
    lead_quality_class: null,
    lead_quality_status: null,
    lead_quality_hard_block_reason: null,
    lead_quality_recommended_action: null,
    ...over,
  };
}
function passMirror(over: Partial<DiagnosticLeadRow> = {}): Partial<DiagnosticLeadRow> {
  return {
    lead_quality_score: 76,
    lead_quality_class: "A",
    lead_quality_status: "qualified",
    lead_quality_hard_block_reason: null,
    lead_quality_recommended_action: "auto_distribute",
    ...over,
  };
}
function mkScore(over: Partial<DiagnosticScoreRow> = {}): DiagnosticScoreRow {
  return {
    id: "score-1",
    lead_id: "lead-x",
    total_score: 76,
    score_class: "A",
    hard_block_reason: null,
    recommended_action: "auto_distribute",
    score_breakdown: { score_model_version: "lead_quality_v2" },
    created_at: "2026-07-05T10:00:01.000Z",
    ...over,
  };
}
function mkRun(over: Partial<DiagnosticMatchingRunRow> = {}): DiagnosticMatchingRunRow {
  return {
    id: "run-1",
    lead_id: "lead-x",
    run_status: "matched",
    eligible_vendor_count: 2,
    selected_vendor_ids: ["v1", "v2"],
    assigned_vendor_ids: ["v1", "v2"],
    failure_reason: null,
    matching_snapshot: { matching_model_version: "distance_category_matching_phase2", assignment: { skipped: [] } },
    created_at: "2026-07-05T10:00:02.000Z",
    ...over,
  };
}
function mkAssignment(over: Partial<DiagnosticAssignmentRow> = {}): DiagnosticAssignmentRow {
  return { id: "a1", lead_id: "lead-x", vendor_id: "v1", assignment_type: "auto_assigned", credit_deducted: true, assigned_at: "2026-07-05T10:00:03.000Z", ...over };
}
function mkDelivery(over: Partial<DiagnosticDeliveryRow> = {}): DiagnosticDeliveryRow {
  return { id: "d1", lead_id: "lead-x", vendor_id: "v1", assignment_id: "a1", delivery_channel: "vendor_dashboard", delivery_status: "delivered", credit_deducted: true, ...over };
}
function mkNotification(over: Partial<DiagnosticNotificationRow> = {}): DiagnosticNotificationRow {
  return { id: "n1", lead_id: "lead-x", notification_type: "assigned_vendors_preview", channel: "dashboard_preview", status: "preview_created", ...over };
}
function mkSources(over: Partial<LeadProcessingDiagnosticSources> & { lead: DiagnosticLeadRow | null }): LeadProcessingDiagnosticSources {
  return {
    lead_id: over.lead?.id ?? "lead-x",
    lead: over.lead,
    latest_score: over.latest_score ?? null,
    latest_matching_run: over.latest_matching_run ?? null,
    assignments: over.assignments ?? [],
    delivery_logs: over.delivery_logs ?? [],
    client_notifications: over.client_notifications ?? [],
  };
}

console.log("QuickFurno Phase 3A — diagnostics harness\n");

// A1 — Kirth Praji healthy canonical flow.
{
  const d = composeLeadDiagnostic(
    mkSources({
      lead: mkLead({ id: "kirth", status: "Assigned", ...passMirror() }),
      latest_score: mkScore({ lead_id: "kirth" }),
      latest_matching_run: mkRun({ lead_id: "kirth" }),
      assignments: [mkAssignment({ id: "a1", vendor_id: "v1" }), mkAssignment({ id: "a2", vendor_id: "v2" })],
      delivery_logs: [
        mkDelivery({ id: "d1", vendor_id: "v1", assignment_id: "a1" }),
        mkDelivery({ id: "d2", vendor_id: "v2", assignment_id: "a2" }),
        mkDelivery({ id: "w1", vendor_id: "v1", assignment_id: "a1", delivery_channel: "whatsapp_preview", delivery_status: "preview_created", credit_deducted: false }),
        mkDelivery({ id: "w2", vendor_id: "v2", assignment_id: "a2", delivery_channel: "whatsapp_preview", delivery_status: "preview_created", credit_deducted: false }),
      ],
      client_notifications: [mkNotification()],
    }),
  );
  console.log(`A1 Kirth healthy — anomalies: ${codes(d)}`);
  check("A1 captured", d.captured);
  check("A1 not duplicate", d.lead.is_duplicate === false);
  check("A1 quality_pass", d.quality.quality_pass === true);
  check("A1 score model v2", d.quality.score_model_version === "lead_quality_v2");
  check("A1 mirror_consistent", d.quality.mirror_consistent === true);
  check("A1 matching model tagged", d.matching.matching_model_version === "distance_category_matching_phase2");
  check("A1 assignments=2", d.assignments.count === 2);
  check("A1 max_3_respected", d.assignments.max_3_respected === true);
  check("A1 dashboard=2", d.delivery.dashboard_delivery_count === 2);
  check("A1 whatsapp=2", d.delivery.whatsapp_preview_count === 2);
  check("A1 client_notif=1", d.delivery.client_notification_count === 1);
  check("A1 accounting mode exposed", d.accounting.accounting_correlation_mode.length > 0 && d.accounting.accounting_consistent === null);
  check("A1 NO critical/high anomalies", noneOfSeverity(d, "critical", "high"), codes(d));
  check("A1 zero anomalies (fully healthy)", d.anomalies.length === 0, codes(d));
  check("A1 health healthy", d.health.status === "healthy");
}

// A2 — selected-but-unassigned (Bharat / Ankit historical failure).
{
  const d = composeLeadDiagnostic(
    mkSources({
      lead: mkLead({ id: "bharat", status: "Hot Lead", ...passMirror() }),
      latest_score: mkScore({ lead_id: "bharat" }),
      latest_matching_run: mkRun({ lead_id: "bharat", run_status: "waiting", eligible_vendor_count: 2, selected_vendor_ids: ["v1", "v2"], assigned_vendor_ids: [], failure_reason: "no_eligible_vendors" }),
      assignments: [],
    }),
  );
  console.log(`A2 selected-but-unassigned — anomalies: ${codes(d)}`);
  check("A2 selected_but_unassigned high", severityOf(d, "selected_but_unassigned") === "high");
  check("A2 waiting_with_eligible_vendors high", severityOf(d, "waiting_with_eligible_vendors") === "high");
  check("A2 no critical", noneOfSeverity(d, "critical"));
  check("A2 health unhealthy", d.health.status === "unhealthy");
}

// A3 — healthy duplicate (Rohan / Kabira), skipped run.
{
  const d = composeLeadDiagnostic(
    mkSources({
      lead: mkLead({ id: "rohan", status: "Duplicate", is_duplicate: true, duplicate_of: "orig-1", lead_quality_score: 76, lead_quality_class: "A", lead_quality_status: "duplicate_no_bill", lead_quality_hard_block_reason: "duplicate_lead", lead_quality_recommended_action: "duplicate_no_bill" }),
      latest_score: mkScore({ lead_id: "rohan", hard_block_reason: "duplicate_lead", recommended_action: "duplicate_no_bill" }),
      latest_matching_run: mkRun({ lead_id: "rohan", run_status: "skipped", eligible_vendor_count: 0, selected_vendor_ids: [], assigned_vendor_ids: [], failure_reason: "duplicate_lead" }),
      assignments: [],
    }),
  );
  console.log(`A3 healthy duplicate — anomalies: ${codes(d)}`);
  check("A3 duplicate flagged in lead", d.lead.is_duplicate === true);
  check("A3 no assignment anomaly", !hasCode(d, "duplicate_lead_assigned"));
  check("A3 no matching_started_without_quality_pass (healthy skip)", !hasCode(d, "matching_started_without_quality_pass"));
  check("A3 zero anomalies", d.anomalies.length === 0, codes(d));
  check("A3 health healthy", d.health.status === "healthy");
}

// A4 — duplicate assigned.
{
  const d = composeLeadDiagnostic(
    mkSources({
      lead: mkLead({ id: "dupasg", is_duplicate: true, status: "Assigned" }),
      assignments: [mkAssignment({ id: "a1", vendor_id: "v1", assignment_type: "auto_assigned" })],
    }),
  );
  console.log(`A4 duplicate assigned — anomalies: ${codes(d)}`);
  check("A4 duplicate_lead_assigned critical", severityOf(d, "duplicate_lead_assigned") === "critical");
  check("A4 health unhealthy", d.health.status === "unhealthy");
}

// A5 — more than 3 assignments.
{
  const d = composeLeadDiagnostic(
    mkSources({
      lead: mkLead({ id: "over3", status: "Assigned", ...passMirror() }),
      latest_score: mkScore({ lead_id: "over3" }),
      latest_matching_run: mkRun({ lead_id: "over3", selected_vendor_ids: ["v1", "v2", "v3", "v4"], assigned_vendor_ids: ["v1", "v2", "v3", "v4"], eligible_vendor_count: 4 }),
      assignments: [
        mkAssignment({ id: "a1", vendor_id: "v1" }),
        mkAssignment({ id: "a2", vendor_id: "v2" }),
        mkAssignment({ id: "a3", vendor_id: "v3" }),
        mkAssignment({ id: "a4", vendor_id: "v4" }),
      ],
    }),
  );
  console.log(`A5 more-than-3 — anomalies: ${codes(d)}`);
  check("A5 more_than_3_assignments critical", severityOf(d, "more_than_3_assignments") === "critical");
  check("A5 max_3_respected false", d.assignments.max_3_respected === false);
  check("A5 health unhealthy", d.health.status === "unhealthy");
}

// A6 — Assigned status without assignment rows (no matching run to isolate).
{
  const d = composeLeadDiagnostic(
    mkSources({
      lead: mkLead({ id: "asgnorows", status: "Assigned", ...passMirror() }),
      latest_score: mkScore({ lead_id: "asgnorows" }),
      latest_matching_run: null,
      assignments: [],
    }),
  );
  console.log(`A6 assigned-without-rows — anomalies: ${codes(d)}`);
  check("A6 assigned_status_without_assignments high", severityOf(d, "assigned_status_without_assignments") === "high");
  check("A6 health unhealthy", d.health.status === "unhealthy");
}

// A7 — matched run without assignment rows.
{
  const d = composeLeadDiagnostic(
    mkSources({
      lead: mkLead({ id: "matchnorows", status: "Hot Lead", ...passMirror() }),
      latest_score: mkScore({ lead_id: "matchnorows" }),
      latest_matching_run: mkRun({ lead_id: "matchnorows", run_status: "matched", assigned_vendor_ids: ["v1", "v2"], selected_vendor_ids: ["v1", "v2"] }),
      assignments: [],
    }),
  );
  console.log(`A7 matched-without-rows — anomalies: ${codes(d)}`);
  const sev = severityOf(d, "matched_run_without_assignments");
  check("A7 matched_run_without_assignments high/critical", sev === "high" || sev === "critical");
  check("A7 health unhealthy", d.health.status === "unhealthy");
}

// A8 — quality mirror mismatch.
{
  const d = composeLeadDiagnostic(
    mkSources({
      lead: mkLead({ id: "mirror", status: "Quality Checked", lead_quality_score: 66, lead_quality_class: "B", lead_quality_status: "clarification_required", lead_quality_hard_block_reason: null, lead_quality_recommended_action: "clarification_required" }),
      latest_score: mkScore({ lead_id: "mirror", total_score: 76, score_class: "A", recommended_action: "auto_distribute" }),
    }),
  );
  console.log(`A8 mirror-mismatch — anomalies: ${codes(d)}`);
  check("A8 lead_quality_mirror_mismatch high", severityOf(d, "lead_quality_mirror_mismatch") === "high");
  check("A8 mirror_consistent false", d.quality.mirror_consistent === false);
  check("A8 health unhealthy", d.health.status === "unhealthy");
}

// A9 — score row missing but mirror present.
{
  const d = composeLeadDiagnostic(
    mkSources({ lead: mkLead({ id: "scoremiss", ...passMirror() }), latest_score: null }),
  );
  console.log(`A9 score-missing-mirror-present — anomalies: ${codes(d)}`);
  check("A9 score_row_missing_but_mirror_present", hasCode(d, "score_row_missing_but_mirror_present"));
  check("A9 not legacy", d.observability.legacy_quality_lead === false);
}

// A10 — score row present but mirror missing.
{
  const d = composeLeadDiagnostic(
    mkSources({ lead: mkLead({ id: "mirrormiss" }), latest_score: mkScore({ lead_id: "mirrormiss" }) }),
  );
  console.log(`A10 score-present-mirror-missing — anomalies: ${codes(d)}`);
  check("A10 score_row_present_but_mirror_missing", hasCode(d, "score_row_present_but_mirror_missing"));
}

// A11 — dashboard delivery without assignment.
{
  const d = composeLeadDiagnostic(
    mkSources({
      lead: mkLead({ id: "orphan", status: "Assigned", ...passMirror() }),
      latest_score: mkScore({ lead_id: "orphan" }),
      latest_matching_run: mkRun({ lead_id: "orphan", selected_vendor_ids: ["v1"], assigned_vendor_ids: ["v1"], eligible_vendor_count: 1 }),
      assignments: [mkAssignment({ id: "a1", vendor_id: "v1" })],
      delivery_logs: [
        mkDelivery({ id: "d1", vendor_id: "v1", assignment_id: "a1" }),
        mkDelivery({ id: "d9", vendor_id: "v9", assignment_id: "a9" }),
      ],
    }),
  );
  console.log(`A11 dashboard-without-assignment — anomalies: ${codes(d)}`);
  check("A11 dashboard_delivery_without_assignment high", severityOf(d, "dashboard_delivery_without_assignment") === "high");
}

// A12 — duplicate dashboard delivery.
{
  const d = composeLeadDiagnostic(
    mkSources({
      lead: mkLead({ id: "dupdel", status: "Assigned", ...passMirror() }),
      latest_score: mkScore({ lead_id: "dupdel" }),
      latest_matching_run: mkRun({ lead_id: "dupdel", selected_vendor_ids: ["v1"], assigned_vendor_ids: ["v1"], eligible_vendor_count: 1 }),
      assignments: [mkAssignment({ id: "a1", vendor_id: "v1" })],
      delivery_logs: [
        mkDelivery({ id: "d1", vendor_id: "v1", assignment_id: "a1" }),
        mkDelivery({ id: "d2", vendor_id: "v1", assignment_id: "a1" }),
      ],
    }),
  );
  console.log(`A12 duplicate-dashboard — anomalies: ${codes(d)}`);
  check("A12 duplicate_dashboard_delivery high", severityOf(d, "duplicate_dashboard_delivery") === "high");
  check("A12 dup pair count = 2", d.delivery.duplicate_dashboard_delivery_pairs.length === 1 && d.delivery.duplicate_dashboard_delivery_pairs[0].count === 2);
}

// A13 — waiting with eligible vendors (selected empty → isolate from A2).
{
  const d = composeLeadDiagnostic(
    mkSources({
      lead: mkLead({ id: "waiting", status: "Hot Lead", ...passMirror() }),
      latest_score: mkScore({ lead_id: "waiting" }),
      latest_matching_run: mkRun({ lead_id: "waiting", run_status: "waiting", eligible_vendor_count: 3, selected_vendor_ids: [], assigned_vendor_ids: [], failure_reason: "no_eligible_vendors" }),
      assignments: [],
    }),
  );
  console.log(`A13 waiting-with-eligible — anomalies: ${codes(d)}`);
  check("A13 waiting_with_eligible_vendors high", severityOf(d, "waiting_with_eligible_vendors") === "high");
  check("A13 no selected_but_unassigned (selected empty)", !hasCode(d, "selected_but_unassigned"));
}

// A14 — scanner returns anomalous leads only.
{
  const healthy = composeLeadDiagnostic(
    mkSources({
      lead: mkLead({ id: "healthy-1", status: "Assigned", ...passMirror() }),
      latest_score: mkScore({ lead_id: "healthy-1" }),
      latest_matching_run: mkRun({ lead_id: "healthy-1" }),
      assignments: [mkAssignment({ id: "a1", vendor_id: "v1" }), mkAssignment({ id: "a2", vendor_id: "v2" })],
    }),
  );
  const unhealthy = composeLeadDiagnostic(
    mkSources({ lead: mkLead({ id: "unhealthy-1", is_duplicate: true }), assignments: [mkAssignment({ id: "a1", vendor_id: "v1" })] }),
  );
  const candidates: ScanCandidate[] = [
    { lead_id: "healthy-1", created_at: "2026-07-05T09:00:00.000Z", name: "Healthy", diagnostic: healthy },
    { lead_id: "unhealthy-1", created_at: "2026-07-05T08:00:00.000Z", name: "Unhealthy", diagnostic: unhealthy },
  ];
  const results = selectAnomalousScanCandidates(candidates, 100);
  console.log(`A14 scanner filter — returned ${results.length}`);
  check("A14 only anomalous returned", results.length === 1 && results[0].lead_id === "unhealthy-1");
}

// A15 — scanner severity ordering (critical > high > medium > low; newest first within a tier).
{
  const critNew = composeLeadDiagnostic(mkSources({ lead: mkLead({ id: "crit-new", is_duplicate: true }), assignments: [mkAssignment({ id: "a1", vendor_id: "v1" })] }));
  const critOld = composeLeadDiagnostic(mkSources({ lead: mkLead({ id: "crit-old", is_duplicate: true }), assignments: [mkAssignment({ id: "a1", vendor_id: "v1" })] }));
  const high = composeLeadDiagnostic(
    mkSources({ lead: mkLead({ id: "high-1", status: "Hot Lead", ...passMirror() }), latest_score: mkScore({ lead_id: "high-1" }), latest_matching_run: mkRun({ lead_id: "high-1", run_status: "waiting", selected_vendor_ids: ["v1"], assigned_vendor_ids: [], eligible_vendor_count: 1, failure_reason: "no_eligible_vendors" }), assignments: [] }),
  );
  const medium = composeLeadDiagnostic(mkSources({ lead: mkLead({ id: "med-1" }), latest_score: mkScore({ lead_id: "med-1" }) }));
  const low = composeLeadDiagnostic(mkSources({ lead: mkLead({ id: "low-1", status: "Won" }), assignments: [mkAssignment({ id: "a1", vendor_id: "v1", assignment_type: "client_selected" })] }));
  const candidates: ScanCandidate[] = [
    { lead_id: "low-1", created_at: "2026-07-05T05:00:00.000Z", name: "L", diagnostic: low },
    { lead_id: "med-1", created_at: "2026-07-05T06:00:00.000Z", name: "M", diagnostic: medium },
    { lead_id: "high-1", created_at: "2026-07-05T07:00:00.000Z", name: "H", diagnostic: high },
    { lead_id: "crit-old", created_at: "2026-07-05T08:00:00.000Z", name: "CO", diagnostic: critOld },
    { lead_id: "crit-new", created_at: "2026-07-05T09:00:00.000Z", name: "CN", diagnostic: critNew },
  ];
  const order = selectAnomalousScanCandidates(candidates, 100).map((c) => c.lead_id);
  console.log(`A15 order — ${order.join(" > ")}`);
  check("A15 low-1 is legacy low only", low.health.status === "healthy" && low.anomalies.every((a) => a.severity === "low") && low.anomalies.length > 0);
  check("A15 ordering critical(new,old) > high > medium > low", JSON.stringify(order) === JSON.stringify(["crit-new", "crit-old", "high-1", "med-1", "low-1"]), order.join(","));
}

// A16 — read-only proof: the diagnostic services contain no write calls.
{
  const files = [
    "../services/leadProcessingDiagnosticsService.ts",
    "../services/leadProcessingDiagnosticsCore.ts",
  ];
  const writeCall = /\.(insert|update|delete|upsert|rpc)\s*\(/;
  let clean = true;
  const offenders: string[] = [];
  for (const rel of files) {
    const path = fileURLToPath(new URL(rel, import.meta.url));
    const raw = readFileSync(path, "utf8");
    // Strip comments so prose mentioning these words can't trip the scan.
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    if (writeCall.test(stripped)) {
      clean = false;
      offenders.push(rel);
    }
  }
  console.log(`A16 read-only proof — ${clean ? "no write calls found" : `offenders: ${offenders.join(", ")}`}`);
  check("A16 diagnostics are strictly read-only (no insert/update/delete/upsert/rpc)", clean, offenders.join(", "));
}

// A17 — historical legacy lead (no quality metadata) is not falsely critical.
{
  const d = composeLeadDiagnostic(
    mkSources({
      lead: mkLead({ id: "legacy-1", created_at: "2026-06-01T10:00:00.000Z", status: "Assigned" }),
      latest_score: null,
      latest_matching_run: null,
      assignments: [mkAssignment({ id: "a1", vendor_id: "v1", assignment_type: "client_selected" })],
    }),
  );
  console.log(`A17 legacy lead — anomalies: ${codes(d)}`);
  check("A17 legacy flagged", d.observability.legacy_quality_lead === true);
  check("A17 no critical/high", noneOfSeverity(d, "critical", "high"), codes(d));
  check("A17 legacy_observability_limited (low)", severityOf(d, "legacy_observability_limited") === "low");
  check("A17 health healthy (low-only)", d.health.status === "healthy");
}

// ---- summary ---------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const line of failureLines) console.log(line);
  process.exit(1);
}
console.log("All Phase 3A harness cases passed.");
