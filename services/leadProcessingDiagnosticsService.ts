// ============================================================================
// QuickFurno — services/leadProcessingDiagnosticsService.ts
// Phase 3A: READ-ONLY lead-processing diagnostics & observability (backend-only).
//
// This is the I/O SHELL around the pure engine in leadProcessingDiagnosticsCore.ts.
// It ONLY performs read-only Supabase SELECTs and then delegates ALL composition,
// anomaly detection, and health classification to composeLeadDiagnostic().
//
// STRICT READ-ONLY (Phase 3A): no row-writing calls (insert / update / delete /
// upsert) and no RPC calls to mutating functions anywhere in this module. It never
// rescinds credits, retries matching, rescores, updates status, or sends anything.
//
// Two entry points:
//   • diagnoseLeadProcessing(leadId)          — one lead, 6 parallel read queries.
//   • scanRecentLeadProcessingAnomalies(opts)  — recent leads, batch-loaded (no N+1),
//        diagnosed with the SAME engine, returns anomalous leads (highest severity
//        first, then newest first).
// ============================================================================
import { adminClient } from "../lib/supabase";
import { fail, isMissingRelationError, ok, type Result } from "../lib/errors";
import {
  composeLeadDiagnostic,
  highestSeverity,
  selectAnomalousScanCandidates,
  type AnomalySeverity,
  type DiagnosticAssignmentRow,
  type DiagnosticDeliveryRow,
  type DiagnosticLeadRow,
  type DiagnosticMatchingRunRow,
  type DiagnosticNotificationRow,
  type DiagnosticScoreRow,
  type HealthStatus,
  type LeadProcessingAnomaly,
  type LeadProcessingDiagnostic,
  type LeadProcessingDiagnosticSources,
  type ScanCandidate,
} from "./leadProcessingDiagnosticsCore";

// Re-export the whole public core surface so callers can import everything from
// the "service" entry point (types, unions, constants, and the pure engine).
export * from "./leadProcessingDiagnosticsCore";

export interface RecentLeadAnomalyScanItem {
  lead_id: string;
  created_at: string | null;
  name: string | null;
  health_status: HealthStatus;
  highest_severity: AnomalySeverity | null;
  anomalies: LeadProcessingAnomaly[];
}

export interface RecentLeadAnomalyScanResult {
  scanned_count: number;
  anomalous_count: number;
  generated_at: string;
  results: RecentLeadAnomalyScanItem[];
}

// Read-only column projections (never SELECT * on leads — avoids pulling phone/
// email into memory unnecessarily; only diagnostic-relevant fields are read).
const LEAD_COLUMNS =
  "id, created_at, name, status, verification_status, is_duplicate, duplicate_of, city, area, service_required, subcategory, " +
  "lead_quality_score, lead_quality_class, lead_quality_status, lead_quality_hard_block_reason, lead_quality_recommended_action";
const SCORE_COLUMNS = "id, lead_id, total_score, score_class, hard_block_reason, recommended_action, score_breakdown, created_at";
const RUN_COLUMNS =
  "id, lead_id, run_status, eligible_vendor_count, selected_vendor_ids, assigned_vendor_ids, failure_reason, matching_snapshot, created_at";
const ASSIGNMENT_COLUMNS = "id, lead_id, vendor_id, assignment_type, credit_deducted, assigned_at";
const DELIVERY_COLUMNS = "id, lead_id, vendor_id, assignment_id, delivery_channel, delivery_status, credit_deducted";
const NOTIFICATION_COLUMNS = "id, lead_id, notification_type, channel, status";

// Scanner bounds — keep it production-safe without a queue/worker/Redis.
const SCAN_HARD_CAP = 300; // max recent leads pulled into a single scan
const IN_CHUNK = 100; // max lead_ids per PostgREST `.in(...)` request (URL-length safe)

type Db = ReturnType<typeof adminClient>;

// ---------------------------------------------------------------------------
// PART 1 — single-lead diagnosis
// ---------------------------------------------------------------------------
export async function diagnoseLeadProcessing(leadId: string): Promise<Result<LeadProcessingDiagnostic>> {
  try {
    const id = (leadId ?? "").trim();
    if (!id) return fail(new Error("VALIDATION"));

    const db = adminClient();

    // 6 independent reads in parallel (no N+1 for a single lead).
    const [leadRes, scoreRes, runRes, assignRes, deliveryRes, notifyRes] = await Promise.all([
      db.from("leads").select(LEAD_COLUMNS).eq("id", id).maybeSingle(),
      db.from("lead_scores").select(SCORE_COLUMNS).eq("lead_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1),
      db.from("lead_matching_runs").select(RUN_COLUMNS).eq("lead_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1),
      db.from("lead_assignments").select(ASSIGNMENT_COLUMNS).eq("lead_id", id),
      db.from("lead_delivery_logs").select(DELIVERY_COLUMNS).eq("lead_id", id),
      db.from("client_notification_logs").select(NOTIFICATION_COLUMNS).eq("lead_id", id),
    ]);

    if (leadRes.error && !isMissingRelationError(leadRes.error)) throw leadRes.error;

    const sources: LeadProcessingDiagnosticSources = {
      lead_id: id,
      lead: (leadRes.data as DiagnosticLeadRow | null) ?? null,
      latest_score: firstRow<DiagnosticScoreRow>(scoreRes),
      latest_matching_run: firstRow<DiagnosticMatchingRunRow>(runRes),
      assignments: rowsOrEmpty<DiagnosticAssignmentRow>(assignRes),
      delivery_logs: rowsOrEmpty<DiagnosticDeliveryRow>(deliveryRes),
      client_notifications: rowsOrEmpty<DiagnosticNotificationRow>(notifyRes),
    };

    return ok(composeLeadDiagnostic(sources));
  } catch (e) {
    console.warn("[lead diagnostics] diagnose failed", { lead_id: leadId, message: e instanceof Error ? e.message : "unknown_error" });
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// PART 6 — recent-lead anomaly scanner (reuses the SAME engine)
// ---------------------------------------------------------------------------
export async function scanRecentLeadProcessingAnomalies(
  opts: { hours?: number; limit?: number } = {},
): Promise<Result<RecentLeadAnomalyScanResult>> {
  try {
    const hours = clampInt(opts.hours ?? 24, 1, 24 * 30);
    const limit = clampInt(opts.limit ?? 100, 1, 1000);
    const db = adminClient();

    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    // 1) recent lead rows only (bounded).
    const leadRes = await db
      .from("leads")
      .select(LEAD_COLUMNS)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(SCAN_HARD_CAP);
    if (leadRes.error && !isMissingRelationError(leadRes.error)) throw leadRes.error;

    const leads = ((leadRes.data as DiagnosticLeadRow[] | null) ?? []).filter((l) => Boolean(l?.id));
    if (leads.length === SCAN_HARD_CAP) {
      console.warn("[lead diagnostics] scan hit hard cap", { cap: SCAN_HARD_CAP, hours });
    }
    if (leads.length === 0) {
      return ok({ scanned_count: 0, anomalous_count: 0, generated_at: new Date().toISOString(), results: [] });
    }

    const leadIds = leads.map((l) => l.id);

    // 2) batch-load every dependent table for these lead ids (chunked `.in`, no N+1).
    const [scores, runs, assignments, deliveries, notifications] = await Promise.all([
      loadByLeadIds<DiagnosticScoreRow>(db, "lead_scores", SCORE_COLUMNS, leadIds),
      loadByLeadIds<DiagnosticMatchingRunRow>(db, "lead_matching_runs", RUN_COLUMNS, leadIds),
      loadByLeadIds<DiagnosticAssignmentRow>(db, "lead_assignments", ASSIGNMENT_COLUMNS, leadIds),
      loadByLeadIds<DiagnosticDeliveryRow>(db, "lead_delivery_logs", DELIVERY_COLUMNS, leadIds),
      loadByLeadIds<DiagnosticNotificationRow>(db, "client_notification_logs", NOTIFICATION_COLUMNS, leadIds),
    ]);

    // 3) group per lead in memory.
    const latestScoreByLead = groupLatest(scores);
    const latestRunByLead = groupLatest(runs);
    const assignmentsByLead = groupAll<DiagnosticAssignmentRow>(assignments);
    const deliveriesByLead = groupAll<DiagnosticDeliveryRow>(deliveries);
    const notificationsByLead = groupAll<DiagnosticNotificationRow>(notifications);

    // 4) diagnose each lead with the SAME pure engine.
    const candidates: ScanCandidate[] = leads.map((lead) => {
      const sources: LeadProcessingDiagnosticSources = {
        lead_id: lead.id,
        lead,
        latest_score: latestScoreByLead.get(lead.id) ?? null,
        latest_matching_run: latestRunByLead.get(lead.id) ?? null,
        assignments: assignmentsByLead.get(lead.id) ?? [],
        delivery_logs: deliveriesByLead.get(lead.id) ?? [],
        client_notifications: notificationsByLead.get(lead.id) ?? [],
      };
      return { lead_id: lead.id, created_at: lead.created_at ?? null, name: lead.name ?? null, diagnostic: composeLeadDiagnostic(sources) };
    });

    // 5/6) keep only anomalous, sort (severity desc, newest first) and cap — via
    //      the SAME pure ranker used by the tests (no parallel logic here).
    const anomalousCount = candidates.reduce((n, c) => (c.diagnostic.anomalies.length > 0 ? n + 1 : n), 0);
    const results: RecentLeadAnomalyScanItem[] = selectAnomalousScanCandidates(candidates, limit).map((c) => ({
      lead_id: c.lead_id,
      created_at: c.created_at,
      name: c.name,
      health_status: c.diagnostic.health.status,
      highest_severity: highestSeverity(c.diagnostic.anomalies),
      anomalies: c.diagnostic.anomalies,
    }));

    return ok({
      scanned_count: leads.length,
      anomalous_count: anomalousCount,
      generated_at: new Date().toISOString(),
      results,
    });
  } catch (e) {
    console.warn("[lead diagnostics] scan failed", { message: e instanceof Error ? e.message : "unknown_error" });
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// read helpers (all SELECT-only)
// ---------------------------------------------------------------------------
type SelectResult<T> = { data: T[] | null; error: { code?: string; message?: string } | null };

function firstRow<T>(res: SelectResult<unknown>): T | null {
  if (res.error) {
    if (isMissingRelationError(res.error)) return null;
    throw res.error;
  }
  const rows = (res.data ?? []) as T[];
  return rows.length > 0 ? rows[0] : null;
}

function rowsOrEmpty<T>(res: SelectResult<unknown>): T[] {
  if (res.error) {
    if (isMissingRelationError(res.error)) return [];
    throw res.error;
  }
  return (res.data ?? []) as T[];
}

async function loadByLeadIds<T extends { lead_id?: string | null }>(
  db: Db,
  table: string,
  columns: string,
  leadIds: string[],
): Promise<T[]> {
  const out: T[] = [];
  for (const chunk of chunkArray(leadIds, IN_CHUNK)) {
    const res = await db.from(table).select(columns).in("lead_id", chunk);
    if (res.error) {
      if (isMissingRelationError(res.error)) return []; // table not present → degrade to empty
      throw res.error;
    }
    // Dynamic table name → supabase-js widens .data to GenericStringError[]; bridge
    // through unknown (the error branch above already handled real failures).
    out.push(...((res.data as unknown as T[] | null) ?? []));
  }
  return out;
}

// ---------------------------------------------------------------------------
// grouping helpers (deterministic latest = created_at DESC, then id DESC)
// ---------------------------------------------------------------------------
function groupAll<T extends { lead_id?: string | null }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const leadId = typeof row.lead_id === "string" ? row.lead_id : null;
    if (!leadId) continue;
    const list = map.get(leadId);
    if (list) list.push(row);
    else map.set(leadId, [row]);
  }
  return map;
}

function groupLatest<T extends { lead_id?: string | null; created_at?: string | null; id?: string | null }>(
  rows: T[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const leadId = typeof row.lead_id === "string" ? row.lead_id : null;
    if (!leadId) continue;
    const current = map.get(leadId);
    if (!current || isNewer(row, current)) map.set(leadId, row);
  }
  return map;
}

function isNewer(
  candidate: { created_at?: string | null; id?: string | null },
  current: { created_at?: string | null; id?: string | null },
): boolean {
  const ca = candidate.created_at ?? "";
  const cb = current.created_at ?? "";
  if (ca !== cb) return ca > cb; // ISO strings sort chronologically
  return (candidate.id ?? "") > (current.id ?? ""); // stable id tiebreak
}

// ---------------------------------------------------------------------------
// tiny pure utilities
// ---------------------------------------------------------------------------
function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
