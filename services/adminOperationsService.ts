// ============================================================================
// QuickFurno — services/adminOperationsService.ts   (QF-MVP-70.01, SERVER ONLY)
//
// The Operations & Launch Control read layer.
//
// READ-ONLY BY CONSTRUCTION. There is no write surface anywhere in this file —
// no row creation, no row modification, no row removal and no stored-procedure
// call — and no provider adapter, transport service or recovery service is
// imported. No code path here can therefore send a message, arm a canary,
// activate a mapping, claim a job, open a retry attempt, finalize an attempt,
// mutate a runtime setting or reach n8n. QF-MVP-70.01 observes; it controls
// nothing.
//
// AUTHORITIES REUSED (none of them changed by this slice):
//   stale threshold   lib/automation/recoveryContract.ts (PURE)
//   paging policy     lib/adminPaging.ts
//   relation probe    lib/errors.ts  isMissingRelationError
//
// FAIL CLOSED — THE CENTRAL RULE OF THIS FILE
//   services/adminService.ts exports safeCount(), which answers 0 when the
//   count query errors, when the call throws, and when PostgREST returns a null
//   count. For a commercial KPI that degradation is tolerable. For operational
//   health it is not: it renders "we could not read the failure table" as
//   "there are no failures", which is the single most dangerous thing an
//   operations console can do. safeCount is therefore NEVER imported here.
//
//   Instead every read answers one of exactly two things:
//       a proven number   the query succeeded and returned an exact count
//       null + a fault    the value is UNKNOWN
//   null is never coerced to 0, never sorted as 0, never rendered as 0 and
//   never allowed to produce a HEALTHY verdict.
//
// COUNT AND LIST CANNOT DISAGREE
//   Each incident class owns exactly ONE predicate builder, and both the
//   overview count and the paged list apply that same builder. A class can
//   therefore never report a count the list cannot reproduce.
//
// WHY A BOUNDED REAL SELECT AND NOT A HEAD-COUNT
//   PostgREST does not raise for `head: true` against a MISSING relation — it
//   answers `{ count: null, error: null }`, which is exactly the silent false
//   zero this file exists to prevent. A bounded real select against the same
//   missing relation DOES raise PGRST205, so every read below is a bounded
//   select carrying `count: "exact"`. One round trip yields both the exact
//   total and the oldest row, and a missing table is loud instead of silent.
//
// DERIVED, NOT STORED
//   OperationalIncident is a projection over existing canonical rows. Nothing
//   here persists an incident, opens one, resolves one, or keeps a second state
//   machine beside the ones automation, communication and lead assignment
//   already own.
// ============================================================================

import "server-only";

import { adminClient } from "../lib/supabase";
import { isMissingRelationError } from "../lib/errors";
import {
  ADMIN_DIRECTORY_PAGE_SIZE,
  boundPage,
  pageRange,
  type DirectoryPage,
} from "../lib/adminPaging";
import { AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS } from "../lib/automation/recoveryContract";

type Row = Record<string, unknown>;

// ===========================================================================
// FAULTS
// ===========================================================================

/**
 * A source that could not be read. `NOT_PROVISIONED` means the relation does
 * not exist in this environment — a deployment fact, not a failure, and never
 * a zero. `UNAVAILABLE` means the read itself failed.
 */
export type SectionFault = "NOT_PROVISIONED" | "UNAVAILABLE";

function faultFor(error: unknown): SectionFault {
  return isMissingRelationError(error) ? "NOT_PROVISIONED" : "UNAVAILABLE";
}

/** Server-side diagnostic. Logs the error CLASS only — never `message`, never a
 *  row value, never SQL, never a credential. */
function logOperationsReadFailure(scope: string, error: unknown): void {
  const safe = error as { name?: string; code?: string } | null;
  console.error("[admin-operations] read failed", {
    scope,
    name: safe?.name ?? "Error",
    code: safe?.code ?? "UNKNOWN",
  });
}

// ===========================================================================
// VOCABULARY
// ===========================================================================

export const OPERATIONAL_SUBSYSTEMS = Object.freeze([
  "automation",
  "communication",
  "webhook",
  "lead_assignment",
] as const);
export type OperationalSubsystem = (typeof OPERATIONAL_SUBSYSTEMS)[number];

export const OPERATIONAL_SUBSYSTEM_LABELS: Readonly<Record<OperationalSubsystem, string>> =
  Object.freeze({
    automation: "Automation",
    communication: "Communications",
    webhook: "Webhooks",
    lead_assignment: "Lead assignment",
  });

export type OperationalSeverity = "critical" | "warning" | "info";

/** HEALTHY is only reachable when every required read SUCCEEDED and every
 *  proven count is zero. Partial data can never produce it. */
export type OperationalHealth = "HEALTHY" | "ATTENTION" | "UNAVAILABLE";

export const OPERATIONAL_INCIDENT_CLASSES = Object.freeze([
  "automation.dead_letter",
  "automation.failed",
  "automation.uncertain",
  "automation.retry_overdue",
  "automation.processing_stale",
  "communication.dead_letter",
  "communication.failed",
  "webhook.failed",
  "webhook.rejected",
  "lead_assignment.queue_overdue",
  "lead_assignment.queue_unresolved",
] as const);
export type OperationalIncidentClass = (typeof OPERATIONAL_INCIDENT_CLASSES)[number];

export function isOperationalIncidentClass(value: unknown): value is OperationalIncidentClass {
  return (
    typeof value === "string" &&
    (OPERATIONAL_INCIDENT_CLASSES as readonly string[]).includes(value)
  );
}

/**
 * The exact status strings queried below, centralized once.
 *
 * These MIRROR the canonical database CHECK constraints and are not a second
 * vocabulary:
 *   automation_jobs.status                  20260801110000 automation action persistence
 *   communication_messages.status           20260708000170 unified communication core
 *   communication_webhook_receipts.processing_status   (same migration)
 *   lead_assignment_queue.queue_status      written by lib/lead-assignment/leadQueueService.ts
 *                                           and services/delayedLeadFillService.ts
 * They live here so no component ever holds a loose operational status literal.
 */
const AUTOMATION_JOB_STATUS = Object.freeze({
  DEAD_LETTER: "dead_letter",
  FAILED: "failed",
  UNCERTAIN: "uncertain",
  RETRY_SCHEDULED: "retry_scheduled",
  PROCESSING: "processing",
});

const COMMUNICATION_MESSAGE_STATUS = Object.freeze({
  DEAD_LETTER: "dead_letter",
  FAILED: "failed",
});

const WEBHOOK_PROCESSING_STATUS = Object.freeze({
  FAILED: "failed",
  REJECTED: "rejected",
});

/** The only terminal value of lead_assignment_queue.queue_status. Anything else
 *  ('queued', 'matched_preview', or a future value) is still open work — which
 *  is why the predicate is "not resolved" rather than an allow-list a new status
 *  could silently fall out of. */
const LEAD_QUEUE_RESOLVED = "resolved";

// ===========================================================================
// THE DERIVED INCIDENT
// ===========================================================================

export interface OperationalIncident {
  /** `<class>:<row id>` — unique across classes, stable across reloads. */
  readonly id: string;
  readonly class: OperationalIncidentClass;
  readonly severity: OperationalSeverity;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly subsystem: OperationalSubsystem;
  /** The canonical instant this incident's evidence carries. Never invented. */
  readonly openedAt: string | null;
  readonly ageSeconds: number | null;
  readonly currentStatus: string;
  /** A short non-secret code from the row. Never a raw provider payload. */
  readonly safeCode: string | null;
  /** QF-MVP-70.01 exposes no operational control. This is structurally false. */
  readonly actionable: false;
  /** An EXISTING admin route, or null. Never a fabricated per-incident route. */
  readonly evidenceHref: string | null;
}

// ===========================================================================
// CLOCK
// ===========================================================================

interface OperationsClock {
  readonly nowIso: string;
  readonly nowMs: number;
  /** Attempts locked before this instant are stale under the FROZEN QF-MVP-50.5
   *  threshold. This module imports that constant rather than choosing one. */
  readonly staleBeforeIso: string;
}

function operationsClock(): OperationsClock {
  const now = new Date();
  return {
    nowIso: now.toISOString(),
    nowMs: now.getTime(),
    staleBeforeIso: new Date(
      now.getTime() - AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS * 1_000,
    ).toISOString(),
  };
}

function ageSecondsFrom(openedAt: string | null, nowMs: number): number | null {
  if (!openedAt) return null;
  const parsed = Date.parse(openedAt);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((nowMs - parsed) / 1_000));
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ===========================================================================
// CLASS DESCRIPTORS
// ===========================================================================

interface IncidentClassDescriptor {
  readonly key: OperationalIncidentClass;
  readonly label: string;
  readonly detail: string;
  readonly subsystem: OperationalSubsystem;
  readonly severity: OperationalSeverity;
  readonly table: string;
  readonly entityType: string;
  readonly selectColumns: string;
  /** The column whose value becomes `openedAt`. */
  readonly openedAtColumn: string;
  /** Plain words for what that instant means. Rendered next to the age. */
  readonly openedAtLabel: string;
  /** An EXISTING admin route proved from source, or null. */
  readonly evidenceHref: string | null;
  /** The SINGLE predicate for this class. Used by the count read AND the list
   *  read, so the two can never disagree. */
  readonly apply: (query: any, clock: OperationsClock) => any;
  readonly project: (row: Row) => {
    rowId: string;
    entityId: string | null;
    currentStatus: string;
    safeCode: string | null;
  };
}

const AUTOMATION_COLUMNS =
  "id, status, attempt_count, max_attempts, last_result_classification, last_safe_code, next_retry_at, locked_at, completed_at, created_at";

/** Terminal automation jobs. `completed_at` is guaranteed non-null for these
 *  statuses by the automation_jobs_completion_shape_check constraint, so the age
 *  reported is the true age of the failure — not the age of the job. */
function terminalAutomationClass(
  key: OperationalIncidentClass,
  status: string,
  label: string,
  detail: string,
  severity: OperationalSeverity,
): IncidentClassDescriptor {
  return {
    key,
    label,
    detail,
    subsystem: "automation",
    severity,
    table: "automation_jobs",
    entityType: "automation_job",
    selectColumns: AUTOMATION_COLUMNS,
    openedAtColumn: "completed_at",
    openedAtLabel: "Failed",
    evidenceHref: "/admin/whatsapp?tab=automation",
    apply: (query) => query.eq("status", status),
    project: (row) => ({
      rowId: String(row.id ?? ""),
      entityId: text(row.id),
      currentStatus: String(row.status ?? status),
      safeCode: text(row.last_safe_code) ?? text(row.last_result_classification),
    }),
  };
}

const INCIDENT_CLASS_DESCRIPTORS: Readonly<
  Record<OperationalIncidentClass, IncidentClassDescriptor>
> = Object.freeze({
  "automation.dead_letter": terminalAutomationClass(
    "automation.dead_letter",
    AUTOMATION_JOB_STATUS.DEAD_LETTER,
    "Dead-lettered jobs",
    "Automation work that exhausted every attempt. The existing recovery contract will never retry it.",
    "critical",
  ),
  "automation.failed": terminalAutomationClass(
    "automation.failed",
    AUTOMATION_JOB_STATUS.FAILED,
    "Failed jobs",
    "Automation work that finished in a definite failure.",
    "critical",
  ),
  "automation.uncertain": terminalAutomationClass(
    "automation.uncertain",
    AUTOMATION_JOB_STATUS.UNCERTAIN,
    "Uncertain jobs",
    "Automation work whose outcome could not be proven either way. Treated as unresolved, never as success.",
    "warning",
  ),

  "automation.retry_overdue": {
    key: "automation.retry_overdue",
    label: "Overdue retries",
    detail:
      "Jobs whose Core-computed retry instant has already passed and which have not yet been picked up.",
    subsystem: "automation",
    severity: "warning",
    table: "automation_jobs",
    entityType: "automation_job",
    selectColumns: AUTOMATION_COLUMNS,
    // Guaranteed non-null for this status by automation_jobs_retry_shape_check.
    openedAtColumn: "next_retry_at",
    openedAtLabel: "Due since",
    evidenceHref: "/admin/whatsapp?tab=automation",
    apply: (query, clock) =>
      query
        .eq("status", AUTOMATION_JOB_STATUS.RETRY_SCHEDULED)
        .not("next_retry_at", "is", null)
        .lte("next_retry_at", clock.nowIso),
    project: (row) => ({
      rowId: String(row.id ?? ""),
      entityId: text(row.id),
      currentStatus: String(row.status ?? AUTOMATION_JOB_STATUS.RETRY_SCHEDULED),
      safeCode: text(row.last_safe_code) ?? text(row.last_result_classification),
    }),
  },

  "automation.processing_stale": {
    key: "automation.processing_stale",
    label: "Stale in-flight jobs",
    detail: `Jobs locked in processing for longer than the frozen ${AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS}-second reconciliation threshold.`,
    subsystem: "automation",
    severity: "warning",
    table: "automation_jobs",
    entityType: "automation_job",
    selectColumns: AUTOMATION_COLUMNS,
    openedAtColumn: "locked_at",
    openedAtLabel: "Locked since",
    evidenceHref: "/admin/whatsapp?tab=automation",
    apply: (query, clock) =>
      query
        .eq("status", AUTOMATION_JOB_STATUS.PROCESSING)
        .not("locked_at", "is", null)
        .lte("locked_at", clock.staleBeforeIso),
    project: (row) => ({
      rowId: String(row.id ?? ""),
      entityId: text(row.id),
      currentStatus: String(row.status ?? AUTOMATION_JOB_STATUS.PROCESSING),
      safeCode: text(row.last_safe_code) ?? text(row.last_result_classification),
    }),
  },

  "communication.dead_letter": {
    key: "communication.dead_letter",
    label: "Dead-lettered messages",
    detail: "Messages that exhausted every delivery attempt.",
    subsystem: "communication",
    severity: "critical",
    table: "communication_messages",
    entityType: "communication_message",
    // NO destination column is selected. `destination_hash` must never reach a
    // browser, and an operations view needs no recipient at all.
    selectColumns:
      "id, status, lane, message_type, failure_code, failed_at, updated_at, created_at",
    // `failed_at` is stamped for `failed` only; a dead-lettered row carries its
    // transition instant in `updated_at`.
    openedAtColumn: "updated_at",
    openedAtLabel: "Last changed",
    evidenceHref: "/admin/whatsapp?tab=messages",
    apply: (query) => query.eq("status", COMMUNICATION_MESSAGE_STATUS.DEAD_LETTER),
    project: (row) => ({
      rowId: String(row.id ?? ""),
      entityId: text(row.id),
      currentStatus: String(row.status ?? COMMUNICATION_MESSAGE_STATUS.DEAD_LETTER),
      safeCode: text(row.failure_code),
    }),
  },

  "communication.failed": {
    key: "communication.failed",
    label: "Failed messages",
    detail: "Messages the provider or Core recorded as a definite delivery failure.",
    subsystem: "communication",
    severity: "warning",
    table: "communication_messages",
    entityType: "communication_message",
    selectColumns:
      "id, status, lane, message_type, failure_code, failed_at, updated_at, created_at",
    openedAtColumn: "failed_at",
    openedAtLabel: "Failed",
    evidenceHref: "/admin/whatsapp?tab=messages",
    apply: (query) => query.eq("status", COMMUNICATION_MESSAGE_STATUS.FAILED),
    project: (row) => ({
      rowId: String(row.id ?? ""),
      entityId: text(row.id),
      currentStatus: String(row.status ?? COMMUNICATION_MESSAGE_STATUS.FAILED),
      safeCode: text(row.failure_code),
    }),
  },

  "webhook.failed": {
    key: "webhook.failed",
    label: "Failed webhook receipts",
    detail: "Inbound provider callbacks that could not be processed.",
    subsystem: "webhook",
    severity: "warning",
    table: "communication_webhook_receipts",
    entityType: "communication_webhook_receipt",
    selectColumns:
      "id, provider, processing_status, normalized_event_type, failure_reason_sanitized, received_at",
    openedAtColumn: "received_at",
    openedAtLabel: "Received",
    evidenceHref: "/admin/whatsapp?tab=provider",
    apply: (query) => query.eq("processing_status", WEBHOOK_PROCESSING_STATUS.FAILED),
    project: (row) => ({
      rowId: String(row.id ?? ""),
      entityId: text(row.id),
      currentStatus: String(row.processing_status ?? WEBHOOK_PROCESSING_STATUS.FAILED),
      safeCode: text(row.failure_reason_sanitized) ?? text(row.normalized_event_type),
    }),
  },

  "webhook.rejected": {
    key: "webhook.rejected",
    label: "Rejected webhook receipts",
    detail:
      "Inbound callbacks refused before processing — most often a signature that did not verify.",
    subsystem: "webhook",
    severity: "warning",
    table: "communication_webhook_receipts",
    entityType: "communication_webhook_receipt",
    selectColumns:
      "id, provider, processing_status, normalized_event_type, failure_reason_sanitized, received_at",
    openedAtColumn: "received_at",
    openedAtLabel: "Received",
    evidenceHref: "/admin/whatsapp?tab=provider",
    apply: (query) => query.eq("processing_status", WEBHOOK_PROCESSING_STATUS.REJECTED),
    project: (row) => ({
      rowId: String(row.id ?? ""),
      entityId: text(row.id),
      currentStatus: String(row.processing_status ?? WEBHOOK_PROCESSING_STATUS.REJECTED),
      safeCode: text(row.failure_reason_sanitized) ?? text(row.normalized_event_type),
    }),
  },

  "lead_assignment.queue_overdue": {
    key: "lead_assignment.queue_overdue",
    label: "Overdue queued leads",
    detail:
      "Unresolved queue rows whose own next-retry instant has already passed. Overdue is proved by that timestamp, never estimated.",
    subsystem: "lead_assignment",
    severity: "critical",
    table: "lead_assignment_queue",
    entityType: "lead",
    selectColumns:
      "id, lead_id, queue_status, queue_reason, required_vendor_count, eligible_vendor_count, matching_attempt_count, next_retry_at, created_at",
    openedAtColumn: "next_retry_at",
    openedAtLabel: "Due since",
    evidenceHref: "/admin/lead-distribution",
    apply: (query, clock) =>
      query
        .neq("queue_status", LEAD_QUEUE_RESOLVED)
        .not("next_retry_at", "is", null)
        .lte("next_retry_at", clock.nowIso),
    project: (row) => ({
      rowId: String(row.id ?? ""),
      entityId: text(row.lead_id),
      currentStatus: String(row.queue_status ?? ""),
      safeCode: text(row.queue_reason),
    }),
  },

  "lead_assignment.queue_unresolved": {
    key: "lead_assignment.queue_unresolved",
    label: "Unresolved queued leads",
    detail:
      "Every queue row that has not reached 'resolved'. This is a superset of the overdue rows above.",
    subsystem: "lead_assignment",
    severity: "info",
    table: "lead_assignment_queue",
    entityType: "lead",
    selectColumns:
      "id, lead_id, queue_status, queue_reason, required_vendor_count, eligible_vendor_count, matching_attempt_count, next_retry_at, created_at",
    openedAtColumn: "created_at",
    openedAtLabel: "Queued",
    evidenceHref: "/admin/lead-distribution",
    apply: (query) => query.neq("queue_status", LEAD_QUEUE_RESOLVED),
    project: (row) => ({
      rowId: String(row.id ?? ""),
      entityId: text(row.lead_id),
      currentStatus: String(row.queue_status ?? ""),
      safeCode: text(row.queue_reason),
    }),
  },
});

export function describeIncidentClass(key: OperationalIncidentClass) {
  const descriptor = INCIDENT_CLASS_DESCRIPTORS[key];
  return {
    key: descriptor.key,
    label: descriptor.label,
    detail: descriptor.detail,
    subsystem: descriptor.subsystem,
    severity: descriptor.severity,
    openedAtLabel: descriptor.openedAtLabel,
    evidenceHref: descriptor.evidenceHref,
  };
}

export type OperationalIncidentClassDescription = ReturnType<typeof describeIncidentClass>;

/**
 * The full closed class vocabulary, as plain data.
 *
 * The Operations route hands this to the client so the browser never holds a
 * loose incident-class literal and never imports this server-only module.
 */
export function listIncidentClassDescriptions(): readonly OperationalIncidentClassDescription[] {
  return OPERATIONAL_INCIDENT_CLASSES.map((key) => describeIncidentClass(key));
}

function toIncident(
  descriptor: IncidentClassDescriptor,
  row: Row,
  clock: OperationsClock,
): OperationalIncident {
  const projected = descriptor.project(row);
  const openedAt = text(row[descriptor.openedAtColumn]);
  return {
    id: `${descriptor.key}:${projected.rowId}`,
    class: descriptor.key,
    severity: descriptor.severity,
    entityType: descriptor.entityType,
    entityId: projected.entityId,
    subsystem: descriptor.subsystem,
    openedAt,
    ageSeconds: ageSecondsFrom(openedAt, clock.nowMs),
    currentStatus: projected.currentStatus,
    safeCode: projected.safeCode,
    actionable: false,
    evidenceHref: descriptor.evidenceHref,
  };
}

// ===========================================================================
// THE ONE READ PRIMITIVE
// ===========================================================================

export interface OperationalClassSummary {
  readonly key: OperationalIncidentClass;
  readonly label: string;
  readonly detail: string;
  readonly severity: OperationalSeverity;
  readonly openedAtLabel: string;
  readonly evidenceHref: string | null;
  /** A PROVEN count, or null meaning unknown. Never 0-as-fallback. */
  readonly count: number | null;
  readonly fault: SectionFault | null;
  readonly oldest: OperationalIncident | null;
}

/**
 * One bounded read per class yielding BOTH the exact count and the oldest open
 * row. `limit(1)` bounds the transfer at the database; the total comes from
 * PostgREST's exact count over the same predicate, so "oldest" never requires
 * loading the set in application memory to find a minimum.
 */
async function readClassSummary(
  descriptor: IncidentClassDescriptor,
  clock: OperationsClock,
): Promise<OperationalClassSummary> {
  const shared = {
    key: descriptor.key,
    label: descriptor.label,
    detail: descriptor.detail,
    severity: descriptor.severity,
    openedAtLabel: descriptor.openedAtLabel,
    evidenceHref: descriptor.evidenceHref,
  };

  try {
    const base = adminClient()
      .from(descriptor.table)
      .select(descriptor.selectColumns, { count: "exact" });

    const { data, error, count } = await descriptor
      .apply(base, clock)
      .order(descriptor.openedAtColumn, { ascending: true, nullsFirst: false })
      .limit(1);

    if (error) throw error;

    // A read that could not produce a count is UNKNOWN, never zero.
    if (typeof count !== "number") {
      logOperationsReadFailure(`${descriptor.key}.count`, { code: "COUNT_UNAVAILABLE" });
      return { ...shared, count: null, fault: "UNAVAILABLE", oldest: null };
    }

    const rows = (data ?? []) as Row[];
    return {
      ...shared,
      count,
      fault: null,
      oldest: rows.length > 0 ? toIncident(descriptor, rows[0], clock) : null,
    };
  } catch (error) {
    logOperationsReadFailure(`${descriptor.key}.count`, error);
    return { ...shared, count: null, fault: faultFor(error), oldest: null };
  }
}

// ===========================================================================
// SUBSYSTEM ROLLUP
// ===========================================================================

export interface OperationalSubsystemSummary {
  readonly subsystem: OperationalSubsystem;
  readonly label: string;
  readonly health: OperationalHealth;
  readonly classes: readonly OperationalClassSummary[];
  /** Sum of the classes that COUNT TOWARD the incident total. Null whenever any
   *  contributing class is unknown — a partial sum would understate. */
  readonly incidentCount: number | null;
  readonly oldest: OperationalIncident | null;
  readonly fault: SectionFault | null;
  readonly evidenceHref: string | null;
}

/**
 * Classes excluded from a subsystem's incident TOTAL because they are supersets
 * of a class already counted. `lead_assignment.queue_unresolved` contains every
 * `queue_overdue` row, so adding both would double-count the same lead.
 */
const NON_ADDITIVE_CLASSES: readonly OperationalIncidentClass[] = Object.freeze([
  "lead_assignment.queue_unresolved",
]);

function isAdditive(key: OperationalIncidentClass): boolean {
  return !NON_ADDITIVE_CLASSES.includes(key);
}

/**
 * The fail-closed verdict.
 *
 *   UNAVAILABLE  any class in this subsystem could not be read or counted
 *   ATTENTION    every class read cleanly AND at least one proven count > 0
 *   HEALTHY      every class read cleanly AND every proven count is 0
 *
 * There is deliberately no branch that reaches HEALTHY from partial data.
 */
function subsystemHealth(classes: readonly OperationalClassSummary[]): OperationalHealth {
  if (classes.some((entry) => entry.fault !== null || entry.count === null)) return "UNAVAILABLE";
  // Past the guard every count is a proven number. There is no `?? 0` fallback
  // anywhere in this file: a null is answered with UNAVAILABLE above, never
  // silently treated as an empty set here.
  return classes.some((entry) => entry.count !== null && entry.count > 0) ? "ATTENTION" : "HEALTHY";
}

function olderOf(
  left: OperationalIncident | null,
  right: OperationalIncident | null,
): OperationalIncident | null {
  if (!left) return right;
  if (!right) return left;
  if (left.ageSeconds === null) return right;
  if (right.ageSeconds === null) return left;
  return right.ageSeconds > left.ageSeconds ? right : left;
}

function rollUp(
  subsystem: OperationalSubsystem,
  classes: readonly OperationalClassSummary[],
): OperationalSubsystemSummary {
  const additive = classes.filter((entry) => isAdditive(entry.key));

  // Summed explicitly rather than with a null-coalescing reduce: ONE unknown
  // contributor makes the whole total unknown, because a partial sum would
  // understate the real number while looking exact.
  let incidentCount: number | null = 0;
  for (const entry of additive) {
    if (entry.count === null) {
      incidentCount = null;
      break;
    }
    incidentCount += entry.count;
  }

  const oldest = additive.reduce<OperationalIncident | null>(
    (acc, entry) => olderOf(acc, entry.oldest),
    null,
  );

  return {
    subsystem,
    label: OPERATIONAL_SUBSYSTEM_LABELS[subsystem],
    health: subsystemHealth(classes),
    classes,
    incidentCount,
    oldest,
    fault: classes.find((entry) => entry.fault !== null)?.fault ?? null,
    evidenceHref: classes.find((entry) => entry.evidenceHref)?.evidenceHref ?? null,
  };
}

// ===========================================================================
// FOUNDER ATTENTION PROJECTION  (QF-MVP-70.02)
// ===========================================================================
//
// A pure, in-memory projection over the class summaries the overview has ALREADY
// read. It issues no query of its own — there is deliberately no second
// per-class read loop — and it persists nothing: no incident row, no incident
// table, no acknowledgement state, no second state machine beside the ones
// automation, communication and lead assignment already own.

const ATTENTION_SEVERITY_RANK: Readonly<Record<OperationalSeverity, number>> = Object.freeze({
  critical: 0,
  warning: 1,
  info: 2,
});

/**
 * Identity of the UNDERLYING row, independent of which class projected it.
 *
 * `OperationalIncident.id` is `<class>:<row id>`, so stripping the class prefix
 * yields the source row. That makes cross-class duplicate detection exact rather
 * than heuristic — two classes describing the same row produce the same key.
 */
function sourceRowKey(incident: OperationalIncident): string {
  return `${incident.subsystem}|${incident.id.slice(incident.class.length + 1)}`;
}

/**
 * The deterministic founder-attention order.
 *
 *   1. severity           critical, then warning, then info
 *   2. older first        a longer-open incident outranks a newer one
 *   3. unknown age last   an unprovable age is never promoted above a proven one
 *   4. id                 a stable lexical tie-break, so the order never flickers
 *
 * Revenue, package tier and every other commercial signal are deliberately
 * absent: this ranks operational damage, not account value.
 */
export function compareAttentionIncidents(
  left: OperationalIncident,
  right: OperationalIncident,
): number {
  const bySeverity =
    ATTENTION_SEVERITY_RANK[left.severity] - ATTENTION_SEVERITY_RANK[right.severity];
  if (bySeverity !== 0) return bySeverity;

  if (left.ageSeconds !== right.ageSeconds) {
    if (left.ageSeconds === null) return 1;
    if (right.ageSeconds === null) return -1;
    return right.ageSeconds - left.ageSeconds;
  }

  return left.id.localeCompare(right.id);
}

/**
 * At most ONE concrete incident per class — the `oldest` each summary already
 * carries — ranked, then de-duplicated by underlying row.
 *
 * A class whose read faulted, or whose count is zero, contributes NOTHING here:
 * an incident that was never read is never invented. The aggregate unavailable
 * state stays visible through the class summaries themselves, which is where an
 * unreadable source is honestly reported.
 *
 * DE-DUPLICATION. Ranking happens BEFORE the de-duplication pass, so when two
 * classes describe the same row the survivor is the higher-ranked one. That is
 * what makes the required lead-queue rule fall out by construction rather than
 * by a special case: `lead_assignment.queue_unresolved` is a superset of
 * `lead_assignment.queue_overdue`, and because overdue is `critical` while
 * unresolved is `info`, the overdue projection always sorts first and the
 * unresolved duplicate is the one suppressed.
 *
 * Class COUNTS and the paged class lists are untouched by any of this — the
 * suppression applies to the founder attention queue alone.
 */
function projectAttentionIncidents(
  summaries: readonly OperationalClassSummary[],
): readonly OperationalIncident[] {
  const ranked = summaries
    .map((entry) => entry.oldest)
    .filter((incident): incident is OperationalIncident => incident !== null)
    .sort(compareAttentionIncidents);

  const seen = new Set<string>();
  const queue: OperationalIncident[] = [];

  for (const incident of ranked) {
    const key = sourceRowKey(incident);
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push(incident);
  }

  return Object.freeze(queue);
}

/**
 * Resolve a requested incident id against an ALREADY-LOADED pool.
 *
 * This is a lookup, not a query. There is no by-id read anywhere in this
 * service, so a URL cannot address an arbitrary row of an arbitrary table: an
 * id that is not in the bounded payload the page already holds resolves to
 * null, and the caller fails closed.
 */
export function findIncidentInPool(
  pool: readonly OperationalIncident[],
  incidentId: string,
): OperationalIncident | null {
  return pool.find((incident) => incident.id === incidentId) ?? null;
}

// ===========================================================================
// RECOVERY INFERENCE
// ===========================================================================

/**
 * Recovery liveness is an INFERENCE, never a probe.
 *
 * Core runs no scheduler: the QF-MVP-50.5 recovery and reconciliation lanes
 * execute only when the external supervisor calls the signed transport routes.
 * This module makes no such call and reaches no external system, so it cannot
 * and does not claim "n8n is down", "the worker is dead" or "the provider is
 * offline". The only honest statement available from durable Core rows is that
 * overdue retry work exists — which is exactly what is reported.
 */
export interface OperationalRecoveryInference {
  readonly overdueRetryCount: number | null;
  readonly oldestOverdueAgeSeconds: number | null;
  readonly staleThresholdSeconds: number;
  readonly fault: SectionFault | null;
  readonly note: string | null;
}

const UNREADABLE_OVERDUE_CLASS: OperationalClassSummary = Object.freeze({
  key: "automation.retry_overdue" as const,
  label: "Overdue retries",
  detail: "",
  severity: "warning" as const,
  openedAtLabel: "Due since",
  evidenceHref: null,
  count: null,
  fault: "UNAVAILABLE" as const,
  oldest: null,
});

function inferRecovery(overdue: OperationalClassSummary): OperationalRecoveryInference {
  const count = overdue.count;
  let note: string | null = null;

  if (overdue.fault !== null || count === null) {
    note = "Recovery cannot be assessed — the automation job table could not be read.";
  } else if (count > 0) {
    note =
      "Recovery may be delayed — overdue retry work exists. This is inferred from job timestamps only; no external system was contacted.";
  }

  return {
    overdueRetryCount: count,
    oldestOverdueAgeSeconds: overdue.oldest?.ageSeconds ?? null,
    staleThresholdSeconds: AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS,
    fault: overdue.fault,
    note,
  };
}

// ===========================================================================
// OVERVIEW
// ===========================================================================

export interface OperationsOverview {
  readonly generatedAt: string;
  readonly overallHealth: OperationalHealth;
  readonly subsystems: readonly OperationalSubsystemSummary[];
  readonly recovery: OperationalRecoveryInference;
  /** Number of subsystems whose verdict is UNAVAILABLE. */
  readonly unavailableSubsystems: number;
  /**
   * QF-MVP-70.02 — the founder triage queue: at most one concrete incident per
   * class, ranked and de-duplicated, derived IN MEMORY from the summaries above.
   * It costs no additional database read and is never persisted.
   */
  readonly attentionIncidents: readonly OperationalIncident[];
}

/**
 * ATTENTION outranks UNAVAILABLE because a proven problem demands action now,
 * while an unreadable source demands investigation. HEALTHY requires that every
 * subsystem independently reached HEALTHY, so partial data can never roll up to
 * a green overall verdict.
 */
function overallHealth(subsystems: readonly OperationalSubsystemSummary[]): OperationalHealth {
  if (subsystems.some((entry) => entry.health === "ATTENTION")) return "ATTENTION";
  if (subsystems.some((entry) => entry.health === "UNAVAILABLE")) return "UNAVAILABLE";
  return "HEALTHY";
}

export async function getOperationsOverview(): Promise<OperationsOverview> {
  const clock = operationsClock();

  const summaries = await Promise.all(
    OPERATIONAL_INCIDENT_CLASSES.map((key) =>
      readClassSummary(INCIDENT_CLASS_DESCRIPTORS[key], clock),
    ),
  );

  const subsystems = OPERATIONAL_SUBSYSTEMS.map((subsystem) =>
    rollUp(
      subsystem,
      summaries.filter((entry) => INCIDENT_CLASS_DESCRIPTORS[entry.key].subsystem === subsystem),
    ),
  );

  const overdue = summaries.find((entry) => entry.key === "automation.retry_overdue");

  return {
    generatedAt: clock.nowIso,
    overallHealth: overallHealth(subsystems),
    subsystems,
    recovery: inferRecovery(overdue ?? UNREADABLE_OVERDUE_CLASS),
    unavailableSubsystems: subsystems.filter((entry) => entry.health === "UNAVAILABLE").length,
    // Derived from `summaries` — the reads above — not from any new query.
    attentionIncidents: projectAttentionIncidents(summaries),
  };
}

// ===========================================================================
// INCIDENT LIST
// ===========================================================================

export interface OperationsIncidentPage extends DirectoryPage<OperationalIncident> {
  readonly incidentClass: OperationalIncidentClass;
  readonly description: OperationalIncidentClassDescription;
  readonly fault: SectionFault | null;
}

export const DEFAULT_INCIDENT_CLASS: OperationalIncidentClass = "automation.dead_letter";

/**
 * One page of a single incident class, newest first.
 *
 * Bounded AT THE QUERY by the locked admin page size — there is no page-size
 * parameter, and no caller can request an unbounded read. The predicate is the
 * SAME builder the overview count used, so this list is exactly the set that
 * count described.
 */
export async function getOperationsIncidentPage(query: {
  incidentClass?: unknown;
  page?: unknown;
}): Promise<OperationsIncidentPage> {
  const incidentClass = isOperationalIncidentClass(query.incidentClass)
    ? query.incidentClass
    : DEFAULT_INCIDENT_CLASS;
  const descriptor = INCIDENT_CLASS_DESCRIPTORS[incidentClass];
  const description = describeIncidentClass(incidentClass);
  const page = boundPage(query.page);
  const { from, to } = pageRange(page);
  const clock = operationsClock();

  try {
    const base = adminClient()
      .from(descriptor.table)
      .select(descriptor.selectColumns, { count: "exact" });

    const { data, error, count } = await descriptor
      .apply(base, clock)
      .order(descriptor.openedAtColumn, { ascending: false, nullsFirst: false })
      .range(from, to);

    if (error) throw error;

    // A page that could not be counted is UNAVAILABLE in full. Returning the
    // loaded rows with a fabricated total of 0 would present an unknown-size set
    // as a complete one, so no rows are handed over at all.
    if (typeof count !== "number") {
      logOperationsReadFailure(`${incidentClass}.list`, { code: "COUNT_UNAVAILABLE" });
      return {
        rows: [],
        page,
        pageSize: ADMIN_DIRECTORY_PAGE_SIZE,
        total: 0,
        incidentClass,
        description,
        fault: "UNAVAILABLE",
      };
    }

    return {
      rows: ((data ?? []) as Row[]).map((row) => toIncident(descriptor, row, clock)),
      page,
      pageSize: ADMIN_DIRECTORY_PAGE_SIZE,
      total: count,
      incidentClass,
      description,
      fault: null,
    };
  } catch (error) {
    logOperationsReadFailure(`${incidentClass}.list`, error);
    return {
      rows: [],
      page,
      pageSize: ADMIN_DIRECTORY_PAGE_SIZE,
      total: 0,
      incidentClass,
      description,
      fault: faultFor(error),
    };
  }
}
