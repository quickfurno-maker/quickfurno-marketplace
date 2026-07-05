// ============================================================================
// QuickFurno — services/leadProcessingDiagnosticsCore.ts
// Phase 3A: READ-ONLY lead-processing diagnostics — PURE compose + anomaly engine.
//
// This module has ZERO runtime dependencies (no Supabase, no Next, no I/O). It
// takes already-loaded rows (LeadProcessingDiagnosticSources) and DETERMINISTICALLY
// composes the end-to-end pipeline picture + anomaly list + health classification.
//
// WHY a separate pure core:
//   • It is the single diagnostic "engine" reused by BOTH the single-lead path and
//     the recent-lead scanner (no parallel anomaly logic anywhere).
//   • Being import-free, it is directly unit-testable under Node with in-memory
//     fixtures (see scripts/phase3a-diagnostics-harness.ts) — no DB, no network.
//   • The I/O shell (leadProcessingDiagnosticsService.ts) only loads rows and calls
//     composeLeadDiagnostic(); it performs NO mutation.
//
// Phase 3A is OBSERVE → COMPOSE → DIAGNOSE → DETECT. It never repairs, rescores,
// retries, assigns, or touches credits/packages/status.
// ============================================================================

// ---- Version contracts (mirror the producers; keep in sync) ----------------
// Mirrors SCORE_MODEL_VERSION in services/leadQualityService.ts.
export const EXPECTED_SCORE_MODEL_VERSION = "lead_quality_v2";
// Mirrors MATCHING_MODEL_VERSION in services/leadMatchingEngine.ts.
export const EXPECTED_MATCHING_MODEL_VERSION = "distance_category_matching_phase2";
// Deterministic contract for matching runs created before Phase 3A tagging.
export const LEGACY_MATCHING_MODEL_VERSION = "legacy_or_unknown";
// vendor_credit_logs has NO lead_id / assignment_id (audited), so per-lead credit
// correlation is impossible without a heuristic. We expose this mode instead of
// fabricating certainty.
export const ACCOUNTING_CORRELATION_MODE_NONE = "no_lead_or_assignment_link_on_vendor_credit_logs";

export const MAX_VENDORS_PER_LEAD = 3;
// A lead "passes quality" for auto-distribution exactly per canAutoDistributeLead
// in leadQualityService: score >= 70, class A/A+, no hard block, action auto_distribute.
export const QUALITY_PASS_MIN_SCORE = 70;

// ---- Public unions ---------------------------------------------------------
export type AnomalySeverity = "critical" | "high" | "medium" | "low";
export type HealthStatus = "healthy" | "warning" | "unhealthy";

export type LeadProcessingAnomalyCode =
  | "assignment_without_quality_pass"
  | "matching_started_without_quality_pass"
  | "duplicate_lead_assigned"
  | "more_than_3_assignments"
  | "assigned_status_without_assignments"
  | "matched_run_without_assignments"
  | "selected_but_unassigned"
  | "selected_vendor_not_reflected_in_assignment"
  | "dashboard_delivery_without_assignment"
  | "duplicate_dashboard_delivery"
  | "lead_quality_mirror_mismatch"
  | "score_row_missing_but_mirror_present"
  | "score_row_present_but_mirror_missing"
  | "waiting_with_eligible_vendors"
  | "matched_assignment_count_mismatch"
  | "assigned_vendor_id_not_in_selected_set"
  | "legacy_observability_limited";

export interface LeadProcessingAnomaly {
  code: LeadProcessingAnomalyCode;
  severity: AnomalySeverity;
  detail: string;
}

export interface LeadProcessingHealth {
  status: HealthStatus;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
}

// ---- Raw source row shapes (loose; mirror the real tables) -----------------
export interface DiagnosticLeadRow {
  id: string;
  created_at?: string | null;
  name?: string | null;
  status?: string | null;
  verification_status?: string | null;
  is_duplicate?: boolean | null;
  duplicate_of?: string | null;
  city?: string | null;
  area?: string | null;
  service_required?: string | null;
  subcategory?: string | null;
  lead_quality_score?: number | null;
  lead_quality_class?: string | null;
  lead_quality_status?: string | null;
  lead_quality_hard_block_reason?: string | null;
  lead_quality_recommended_action?: string | null;
}

export interface DiagnosticScoreRow {
  id?: string | null;
  lead_id?: string | null;
  total_score?: number | null;
  score_class?: string | null;
  hard_block_reason?: string | null;
  recommended_action?: string | null;
  score_breakdown?: Record<string, unknown> | null;
  created_at?: string | null;
}

export interface DiagnosticMatchingRunRow {
  id?: string | null;
  lead_id?: string | null;
  run_status?: string | null;
  eligible_vendor_count?: number | null;
  selected_vendor_ids?: string[] | null;
  assigned_vendor_ids?: string[] | null;
  failure_reason?: string | null;
  matching_snapshot?: Record<string, unknown> | null;
  created_at?: string | null;
}

export interface DiagnosticAssignmentRow {
  id?: string | null;
  lead_id?: string | null;
  vendor_id?: string | null;
  assignment_type?: string | null;
  credit_deducted?: boolean | null;
  assigned_at?: string | null;
}

export interface DiagnosticDeliveryRow {
  id?: string | null;
  lead_id?: string | null;
  vendor_id?: string | null;
  assignment_id?: string | null;
  delivery_channel?: string | null;
  delivery_status?: string | null;
  credit_deducted?: boolean | null;
}

export interface DiagnosticNotificationRow {
  id?: string | null;
  lead_id?: string | null;
  notification_type?: string | null;
  channel?: string | null;
  status?: string | null;
}

/** Everything the pure engine needs for ONE lead — loaded read-only by the shell. */
export interface LeadProcessingDiagnosticSources {
  lead_id: string;
  lead: DiagnosticLeadRow | null;
  latest_score: DiagnosticScoreRow | null;
  latest_matching_run: DiagnosticMatchingRunRow | null;
  assignments: DiagnosticAssignmentRow[];
  delivery_logs: DiagnosticDeliveryRow[];
  client_notifications: DiagnosticNotificationRow[];
}

// ---- Result contract -------------------------------------------------------
export interface LeadProcessingDiagnostic {
  lead_id: string;
  captured: boolean;
  lead: {
    created_at: string | null;
    status: string | null;
    verification_status: string | null;
    is_duplicate: boolean;
    duplicate_of: string | null;
    city: string | null;
    area: string | null;
    service_required: string | null;
    subcategory: string | null;
  };
  quality: {
    score_row_present: boolean;
    latest_score_created_at: string | null;
    total_score: number | null;
    score_class: string | null;
    hard_block_reason: string | null;
    recommended_action: string | null;
    score_model_version: string | null;
    quality_pass: boolean;
    mirror: {
      score: number | null;
      class: string | null;
      status: string | null;
      hard_block_reason: string | null;
      recommended_action: string | null;
    };
    mirror_present: boolean;
    mirror_consistent: boolean;
  };
  matching: {
    run_present: boolean;
    latest_run_id: string | null;
    run_status: string | null;
    eligible_vendor_count: number;
    selected_vendor_ids: string[];
    assigned_vendor_ids: string[];
    failure_reason: string | null;
    matching_model_version: string | null;
  };
  assignments: {
    count: number;
    vendor_ids: string[];
    auto_assigned_count: number;
    max_3_respected: boolean;
    credit_deducted_assignment_count: number;
  };
  accounting: {
    credit_log_count: number | null;
    accounting_correlation_mode: string;
    accounting_consistent: boolean | null;
    notes: string[];
  };
  delivery: {
    dashboard_delivery_count: number;
    whatsapp_preview_count: number;
    other_delivery_count: number;
    client_notification_count: number;
    duplicate_dashboard_delivery_pairs: Array<{
      vendor_id: string;
      assignment_id: string | null;
      count: number;
    }>;
  };
  observability: {
    legacy_quality_lead: boolean;
    current_system_lead: boolean;
    notes: string[];
  };
  anomalies: LeadProcessingAnomaly[];
  health: LeadProcessingHealth;
}

// ---- small pure helpers ----------------------------------------------------
const SEVERITY_RANK: Record<AnomalySeverity, number> = { critical: 3, high: 2, medium: 1, low: 0 };

export function severityRank(severity: AnomalySeverity): number {
  return SEVERITY_RANK[severity];
}

function nStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function nNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ciEq(a: string | null, b: string | null): boolean {
  return (a === null ? "" : a.toLowerCase()) === (b === null ? "" : b.toLowerCase());
}

function ids(rows: Array<{ vendor_id?: string | null }>): string[] {
  return rows.map((r) => nStr(r.vendor_id)).filter((v): v is string => Boolean(v));
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * The single source of the matching model version contract:
 *   • no run            → null
 *   • run + tagged      → the tag (e.g. "distance_category_matching_phase2")
 *   • run + untagged    → "legacy_or_unknown"
 */
function readMatchingModelVersion(run: DiagnosticMatchingRunRow | null): string | null {
  if (!run) return null;
  const snapshot = run.matching_snapshot;
  const tagged = snapshot && typeof snapshot === "object" ? nStr((snapshot as Record<string, unknown>).matching_model_version) : null;
  return tagged ?? LEGACY_MATCHING_MODEL_VERSION;
}

function readScoreModelVersion(score: DiagnosticScoreRow | null): string | null {
  if (!score || !score.score_breakdown || typeof score.score_breakdown !== "object") return null;
  return nStr((score.score_breakdown as Record<string, unknown>).score_model_version);
}

// ============================================================================
// PURE COMPOSE + DIAGNOSE. No I/O. Deterministic for a given source set.
// ============================================================================
export function composeLeadDiagnostic(sources: LeadProcessingDiagnosticSources): LeadProcessingDiagnostic {
  const lead = sources.lead;
  const captured = lead !== null;

  const score = sources.latest_score;
  const run = sources.latest_matching_run;
  const assignments = sources.assignments ?? [];
  const deliveries = sources.delivery_logs ?? [];
  const notifications = sources.client_notifications ?? [];

  // ---- quality ------------------------------------------------------------
  const scorePresent = score !== null;
  const scoreTotal = nNum(score?.total_score);
  const scoreClass = nStr(score?.score_class);
  const scoreHardBlock = nStr(score?.hard_block_reason);
  const scoreAction = nStr(score?.recommended_action);
  const scoreModelVersion = readScoreModelVersion(score);

  const mirrorScore = nNum(lead?.lead_quality_score);
  const mirrorClass = nStr(lead?.lead_quality_class);
  const mirrorStatus = nStr(lead?.lead_quality_status);
  const mirrorHardBlock = nStr(lead?.lead_quality_hard_block_reason);
  const mirrorAction = nStr(lead?.lead_quality_recommended_action);
  // hard_block_reason alone is not "presence" (a passing lead has none). Presence is
  // signalled by the positive decision columns.
  const mirrorPresent = mirrorScore !== null || mirrorClass !== null || mirrorStatus !== null || mirrorAction !== null;

  // Deterministic quality-pass, read from the AUTHORITATIVE latest score row.
  const qualityPass =
    scorePresent &&
    (scoreTotal ?? 0) >= QUALITY_PASS_MIN_SCORE &&
    (scoreClass === "A" || scoreClass === "A+") &&
    scoreHardBlock === null &&
    scoreAction === "auto_distribute";

  let mirrorConsistent: boolean;
  if (scorePresent && mirrorPresent) {
    mirrorConsistent =
      mirrorScore === scoreTotal &&
      ciEq(scoreClass, mirrorClass) &&
      ciEq(scoreAction, mirrorAction) &&
      ciEq(scoreHardBlock, mirrorHardBlock);
  } else if (!scorePresent && !mirrorPresent) {
    mirrorConsistent = true; // nothing to reconcile (legacy / not yet scored)
  } else {
    mirrorConsistent = false; // exactly one side present → presence mismatch
  }

  // No quality data AT ALL → this lead predates Quality V2. We judge such legacy
  // leads leniently for the quality-dependent anomalies (Part 7).
  const legacyQualityLead = !scorePresent && !mirrorPresent;
  const currentSystemLead =
    scoreModelVersion === EXPECTED_SCORE_MODEL_VERSION ||
    readMatchingModelVersion(run) === EXPECTED_MATCHING_MODEL_VERSION ||
    (scorePresent && mirrorPresent);

  // ---- matching -----------------------------------------------------------
  const runPresent = run !== null;
  const runStatus = nStr(run?.run_status);
  const eligibleCount = nNum(run?.eligible_vendor_count) ?? 0;
  const selectedVendorIds = (run?.selected_vendor_ids ?? []).map(String).filter(Boolean);
  const runAssignedVendorIds = (run?.assigned_vendor_ids ?? []).map(String).filter(Boolean);
  const failureReason = nStr(run?.failure_reason);
  const matchingModelVersion = readMatchingModelVersion(run);

  // ---- assignments --------------------------------------------------------
  const assignmentVendorIds = ids(assignments);
  const assignmentCount = assignments.length;
  const autoAssignments = assignments.filter((a) => nStr(a.assignment_type) === "auto_assigned");
  const autoAssignedVendorIds = ids(autoAssignments);
  const creditDeductedCount = assignments.filter((a) => a.credit_deducted === true).length;

  // ---- delivery -----------------------------------------------------------
  const dashboardDeliveries = deliveries.filter((d) => nStr(d.delivery_channel) === "vendor_dashboard");
  const whatsappPreviews = deliveries.filter((d) => nStr(d.delivery_channel) === "whatsapp_preview");
  const otherDeliveries = deliveries.filter(
    (d) => nStr(d.delivery_channel) !== "vendor_dashboard" && nStr(d.delivery_channel) !== "whatsapp_preview",
  );

  const dupPairMap = new Map<string, { vendor_id: string; assignment_id: string | null; count: number }>();
  for (const d of dashboardDeliveries) {
    if (nStr(d.delivery_status) !== "delivered") continue;
    const vendorId = nStr(d.vendor_id);
    if (!vendorId) continue;
    const assignmentId = nStr(d.assignment_id);
    const key = `${vendorId}::${assignmentId ?? ""}`;
    const existing = dupPairMap.get(key);
    if (existing) existing.count += 1;
    else dupPairMap.set(key, { vendor_id: vendorId, assignment_id: assignmentId, count: 1 });
  }
  const duplicateDashboardPairs = [...dupPairMap.values()].filter((p) => p.count > 1);

  // ---- flags shared by anomaly rules --------------------------------------
  const isDuplicate = lead?.is_duplicate === true;
  const leadStatus = nStr(lead?.status);
  const healthyDuplicateSkip =
    isDuplicate && (!runPresent || (runStatus === "skipped" && ciEq(failureReason, "duplicate_lead")));

  const anomalies: LeadProcessingAnomaly[] = [];
  const observabilityNotes: string[] = [];
  const add = (code: LeadProcessingAnomalyCode, severity: AnomalySeverity, detail: string) =>
    anomalies.push({ code, severity, detail });

  if (captured) {
    // 3. duplicate lead assigned (hard invariant — any era).
    if (isDuplicate && assignmentCount > 0) {
      add("duplicate_lead_assigned", "critical", `Duplicate lead has ${assignmentCount} assignment(s); duplicates must never be assigned.`);
    }

    // 4. more than 3 assignments (hard cap — any era).
    if (assignmentCount > MAX_VENDORS_PER_LEAD) {
      add("more_than_3_assignments", "critical", `${assignmentCount} assignments exceed the hard cap of ${MAX_VENDORS_PER_LEAD}.`);
    }

    // 5. Assigned status but no assignment rows.
    if (ciEq(leadStatus, "assigned") && assignmentCount === 0) {
      add("assigned_status_without_assignments", "high", "lead.status = Assigned but there are 0 lead_assignments rows.");
    }

    // 6. Matched run but no assignment rows.
    if (runStatus === "matched" && assignmentCount === 0) {
      add("matched_run_without_assignments", "critical", "matching run_status = matched but there are 0 lead_assignments rows.");
    }

    // 16. Waiting run with eligible vendors and nothing assigned.
    if (runStatus === "waiting" && eligibleCount > 0 && assignmentCount === 0) {
      add("waiting_with_eligible_vendors", "high", `run_status = waiting with eligible_vendor_count = ${eligibleCount} but 0 assignments (failure_reason: ${failureReason ?? "none"}).`);
    }

    // 7. Selected vendors but nothing assigned (total unresolved selection).
    if (
      selectedVendorIds.length > 0 &&
      assignmentCount === 0 &&
      !healthyDuplicateSkip &&
      (runStatus === "waiting" || runStatus === "failed" || failureReason !== null)
    ) {
      add("selected_but_unassigned", "high", `${selectedVendorIds.length} vendor(s) selected but 0 assigned (run_status: ${runStatus ?? "none"}, failure_reason: ${failureReason ?? "none"}).`);
    }

    // 8. A selected vendor is missing from a PARTIAL assignment set. Downgrade to
    //    medium when the matching snapshot documents an RPC skip reason for it.
    if (assignmentCount > 0 && selectedVendorIds.length > 0) {
      const assignedSet = new Set(assignmentVendorIds);
      const missing = uniq(selectedVendorIds.filter((v) => !assignedSet.has(v)));
      if (missing.length > 0) {
        const documentedSkips = readDocumentedSkipVendorIds(run);
        const allDocumented = missing.every((v) => documentedSkips.has(v));
        add(
          "selected_vendor_not_reflected_in_assignment",
          allDocumented ? "medium" : "high",
          `${missing.length} selected vendor(s) not reflected in assignments${allDocumented ? " (documented RPC skip in snapshot)" : ""}.`,
        );
      }
    }

    // 17. Matched run's assigned set disagrees with actual assignment rows.
    if (runStatus === "matched") {
      const runSet = new Set(runAssignedVendorIds);
      const actualSet = new Set(assignmentVendorIds);
      const differs =
        runSet.size !== actualSet.size || [...runSet].some((v) => !actualSet.has(v)) || [...actualSet].some((v) => !runSet.has(v));
      if (differs) {
        add("matched_assignment_count_mismatch", "high", `matched run assigned_vendor_ids [${runAssignedVendorIds.length}] differ from lead_assignments [${assignmentVendorIds.length}].`);
      }
    }

    // 18. An auto_assigned vendor is not in the run's selected set. Client/admin
    //     assignment paths are excluded (assignment_type filter).
    if (runPresent && autoAssignedVendorIds.length > 0) {
      const selectedSet = new Set(selectedVendorIds);
      const notSelected = uniq(autoAssignedVendorIds.filter((v) => !selectedSet.has(v)));
      if (notSelected.length > 0) {
        add("assigned_vendor_id_not_in_selected_set", "high", `${notSelected.length} auto_assigned vendor(s) not present in matching selected_vendor_ids.`);
      }
    }

    // 1 / 2. Quality-pass anomalies — suppressed for legitimately legacy leads.
    if (legacyQualityLead) {
      if (assignmentCount > 0 || runPresent) {
        add(
          "legacy_observability_limited",
          "low",
          "Lead has no Quality V2 score row and no quality mirror (predates Quality V2); strict quality-pass anomalies are suppressed.",
        );
        observabilityNotes.push("legacy_quality_lead: quality-pass anomalies suppressed (no v2 score, no mirror).");
      }
    } else {
      // 1. Auto assignment(s) without a passing quality decision. Client/admin/
      //    preferred paths never use auto_assigned + a non-pass here, and duplicates
      //    are already flagged critically above, so exclude those.
      if (autoAssignments.length > 0 && !qualityPass && !isDuplicate) {
        add("assignment_without_quality_pass", "high", "Auto-assigned vendor(s) exist but the latest quality decision does not satisfy the auto-distribute gate.");
      }
      // 2. Matching started without a passing quality decision (not a healthy
      //    duplicate skip).
      if (runPresent && !qualityPass && !healthyDuplicateSkip) {
        add("matching_started_without_quality_pass", "medium", `A matching run exists but the latest quality decision is not a pass (run_status: ${runStatus ?? "none"}).`);
      }
    }

    // 13/14/15. Quality mirror integrity.
    if (scorePresent && mirrorPresent && !mirrorConsistent) {
      add(
        "lead_quality_mirror_mismatch",
        "high",
        `Latest score (${scoreTotal}/${scoreClass}/${scoreAction}) disagrees with lead mirror (${mirrorScore}/${mirrorClass}/${mirrorAction}).`,
      );
    }
    if (!scorePresent && mirrorPresent) {
      add("score_row_missing_but_mirror_present", "high", "lead has quality mirror fields but no lead_scores row.");
    }
    if (scorePresent && !mirrorPresent) {
      add("score_row_present_but_mirror_missing", "medium", "lead_scores row exists but the lead quality mirror fields are empty.");
    }

    // 11. Dashboard delivery with no backing assignment (neither assignment_id nor
    //     vendor_id maps to a real lead_assignments row).
    const assignmentIdSet = new Set(assignments.map((a) => nStr(a.id)).filter((v): v is string => Boolean(v)));
    const assignmentVendorSet = new Set(assignmentVendorIds);
    const orphanDashboard = dashboardDeliveries.filter((d) => {
      const aId = nStr(d.assignment_id);
      const vId = nStr(d.vendor_id);
      const backedByAssignment = aId !== null && assignmentIdSet.has(aId);
      const backedByVendor = vId !== null && assignmentVendorSet.has(vId);
      return !backedByAssignment && !backedByVendor;
    });
    if (orphanDashboard.length > 0) {
      add("dashboard_delivery_without_assignment", "high", `${orphanDashboard.length} vendor_dashboard delivery log(s) have no backing lead_assignments row.`);
    }

    // 12. Duplicate dashboard delivery for the same lead/vendor/assignment.
    if (duplicateDashboardPairs.length > 0) {
      add("duplicate_dashboard_delivery", "high", `${duplicateDashboardPairs.length} vendor/assignment pair(s) have more than one delivered vendor_dashboard log.`);
    }
  } else {
    observabilityNotes.push("lead_not_found: no leads row for this id; nothing to diagnose.");
  }

  // ---- accounting (honest, non-fabricated) --------------------------------
  const accountingNotes = [
    "vendor_credit_logs has no lead_id/assignment_id column; per-lead credit-ledger correlation is non-deterministic and intentionally NOT asserted.",
    `Deterministic signal only: ${creditDeductedCount} of ${assignmentCount} lead_assignments row(s) carry credit_deducted = true.`,
  ];

  // ---- health -------------------------------------------------------------
  const health = classifyHealth(anomalies);

  return {
    lead_id: sources.lead_id,
    captured,
    lead: {
      created_at: nStr(lead?.created_at),
      status: leadStatus,
      verification_status: nStr(lead?.verification_status),
      is_duplicate: isDuplicate,
      duplicate_of: nStr(lead?.duplicate_of),
      city: nStr(lead?.city),
      area: nStr(lead?.area),
      service_required: nStr(lead?.service_required),
      subcategory: nStr(lead?.subcategory),
    },
    quality: {
      score_row_present: scorePresent,
      latest_score_created_at: nStr(score?.created_at),
      total_score: scoreTotal,
      score_class: scoreClass,
      hard_block_reason: scoreHardBlock,
      recommended_action: scoreAction,
      score_model_version: scoreModelVersion,
      quality_pass: qualityPass,
      mirror: {
        score: mirrorScore,
        class: mirrorClass,
        status: mirrorStatus,
        hard_block_reason: mirrorHardBlock,
        recommended_action: mirrorAction,
      },
      mirror_present: mirrorPresent,
      mirror_consistent: mirrorConsistent,
    },
    matching: {
      run_present: runPresent,
      latest_run_id: nStr(run?.id),
      run_status: runStatus,
      eligible_vendor_count: eligibleCount,
      selected_vendor_ids: selectedVendorIds,
      assigned_vendor_ids: runAssignedVendorIds,
      failure_reason: failureReason,
      matching_model_version: matchingModelVersion,
    },
    assignments: {
      count: assignmentCount,
      vendor_ids: assignmentVendorIds,
      auto_assigned_count: autoAssignments.length,
      max_3_respected: assignmentCount <= MAX_VENDORS_PER_LEAD,
      credit_deducted_assignment_count: creditDeductedCount,
    },
    accounting: {
      credit_log_count: null,
      accounting_correlation_mode: ACCOUNTING_CORRELATION_MODE_NONE,
      accounting_consistent: null,
      notes: accountingNotes,
    },
    delivery: {
      dashboard_delivery_count: dashboardDeliveries.length,
      whatsapp_preview_count: whatsappPreviews.length,
      other_delivery_count: otherDeliveries.length,
      client_notification_count: notifications.length,
      duplicate_dashboard_delivery_pairs: duplicateDashboardPairs,
    },
    observability: {
      legacy_quality_lead: legacyQualityLead,
      current_system_lead: currentSystemLead,
      notes: observabilityNotes,
    },
    anomalies,
    health,
  };
}

/** Documented RPC skips for a run: matching_snapshot.assignment.skipped + snapshot.skipped[].vendor_id. */
function readDocumentedSkipVendorIds(run: DiagnosticMatchingRunRow | null): Set<string> {
  const out = new Set<string>();
  const snapshot = run?.matching_snapshot;
  if (!snapshot || typeof snapshot !== "object") return out;
  const snap = snapshot as Record<string, unknown>;
  const assignment = snap.assignment;
  if (assignment && typeof assignment === "object") {
    const skipped = (assignment as Record<string, unknown>).skipped;
    if (Array.isArray(skipped)) for (const v of skipped) { const s = nStr(v); if (s) out.add(s); }
  }
  const auditSkipped = snap.skipped;
  if (Array.isArray(auditSkipped)) {
    for (const entry of auditSkipped) {
      if (entry && typeof entry === "object") {
        const s = nStr((entry as Record<string, unknown>).vendor_id);
        if (s) out.add(s);
      } else {
        const s = nStr(entry);
        if (s) out.add(s);
      }
    }
  }
  return out;
}

/**
 * Deterministic health rule:
 *   unhealthy — any critical OR any high
 *   warning   — no critical/high AND at least one medium
 *   healthy   — no critical/high/medium (low-only anomalies stay healthy)
 */
export function classifyHealth(anomalies: LeadProcessingAnomaly[]): LeadProcessingHealth {
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  for (const a of anomalies) {
    if (a.severity === "critical") critical += 1;
    else if (a.severity === "high") high += 1;
    else if (a.severity === "medium") medium += 1;
    else low += 1;
  }
  let status: HealthStatus = "healthy";
  if (critical > 0 || high > 0) status = "unhealthy";
  else if (medium > 0) status = "warning";
  return { status, critical_count: critical, high_count: high, medium_count: medium, low_count: low };
}

/** Highest anomaly severity for a diagnostic (null when there are none). */
export function highestSeverity(anomalies: LeadProcessingAnomaly[]): AnomalySeverity | null {
  let best: AnomalySeverity | null = null;
  for (const a of anomalies) {
    if (best === null || SEVERITY_RANK[a.severity] > SEVERITY_RANK[best]) best = a.severity;
  }
  return best;
}

export interface ScanCandidate {
  lead_id: string;
  created_at: string | null;
  name: string | null;
  diagnostic: LeadProcessingDiagnostic;
}

/**
 * Scanner ranking (PURE): keep only anomalous candidates, order highest severity
 * first then newest (created_at DESC), and cap at `limit`. Shared by the recent
 * scanner AND its tests so there is exactly ONE ranking/selection rule.
 */
export function selectAnomalousScanCandidates(candidates: ScanCandidate[], limit: number): ScanCandidate[] {
  const anomalous = candidates.filter((c) => c.diagnostic.anomalies.length > 0);
  anomalous.sort((a, b) => {
    const ra = severityValue(highestSeverity(a.diagnostic.anomalies));
    const rb = severityValue(highestSeverity(b.diagnostic.anomalies));
    if (ra !== rb) return rb - ra; // highest severity first
    const av = a.created_at ?? "";
    const bv = b.created_at ?? "";
    if (av !== bv) return av > bv ? -1 : 1; // newest first
    return 0;
  });
  return anomalous.slice(0, Math.max(0, Math.floor(limit)));
}

function severityValue(severity: AnomalySeverity | null): number {
  return severity === null ? -1 : SEVERITY_RANK[severity];
}
