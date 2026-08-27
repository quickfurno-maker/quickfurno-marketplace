// ============================================================================
// QuickFurno Admin — Operations Control Center shared view types (QF-MVP-70.01).
//
// PURE type/vocabulary module. It imports ONLY types from the server-only read
// layer (erased at compile time), so nothing here can pull the service_role
// client, a provider adapter or a transport service into a client bundle.
// ============================================================================

import type {
  OperationalHealth,
  OperationalIncident,
  OperationalIncidentClass,
  OperationalIncidentClassDescription,
  OperationalSeverity,
  OperationsIncidentPage,
  OperationsOverview,
  SectionFault,
} from "@/services/adminOperationsService";

export const OPERATIONS_TABS = ["overview", "incidents"] as const;
export type OperationsTab = (typeof OPERATIONS_TABS)[number];

export const OPERATIONS_TAB_LABELS: Readonly<Record<OperationsTab, string>> = Object.freeze({
  overview: "Overview",
  incidents: "Incidents",
});

/**
 * Only the ACTIVE tab's slice is ever populated — this shape is what makes the
 * lazy loading visible in the type system rather than merely intended.
 */
export interface OperationsControlCenterPayload {
  readonly tab: OperationsTab;
  readonly overview?: OperationsOverview;
  readonly incidents?: OperationsIncidentPage;
  /** The closed class vocabulary, supplied by the server so the browser never
   *  holds a loose incident-class literal. */
  readonly classOptions?: readonly OperationalIncidentClassDescription[];
  /** QF-MVP-70.02 — the resolved detail selection for `?incident=`. */
  readonly selection?: IncidentSelection;
}

export type OperationsQuery = {
  readonly tab: OperationsTab;
  readonly incidentClass?: string;
  readonly page?: string;
  readonly incident?: string;
};

// ---------------------------------------------------------------------------
// Detail selection (QF-MVP-70.02)
// ---------------------------------------------------------------------------

/** The base path, declared once so no component re-spells the route. */
export const OPERATIONS_BASE_PATH = "/admin/operations";

/** The query parameter that opens the read-only incident detail panel. */
export const OPERATIONS_INCIDENT_PARAM = "incident";

/**
 * A closed selection vocabulary.
 *
 * `not_in_view` is the fail-closed state: the URL named an incident that is not
 * in the bounded payload this page already loaded. Nothing is fetched by id to
 * satisfy it and no detail is fabricated — the panel says so and can be closed.
 */
export type IncidentSelection =
  | { readonly state: "none" }
  | {
      readonly state: "resolved";
      readonly incident: OperationalIncident;
      readonly description: OperationalIncidentClassDescription;
    }
  | { readonly state: "not_in_view"; readonly requestedId: string };

/** Opens the detail panel for one incident, staying on the current view. */
export function incidentSelectionHref(incidentId: string): string {
  return `${OPERATIONS_BASE_PATH}?${OPERATIONS_INCIDENT_PARAM}=${encodeURIComponent(incidentId)}`;
}

/**
 * Founder-facing entity names.
 *
 * The read model's `entityType` mirrors the storage vocabulary; the panel shows
 * plain words instead, so no table or column name reaches the founder UI.
 */
const ENTITY_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  automation_job: "Automation job",
  communication_message: "Message",
  communication_webhook_receipt: "Webhook receipt",
  lead: "Lead",
});

export function entityTypeLabel(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType] ?? "Operational record";
}

/**
 * Why this incident is listed in Operations at all.
 *
 * KEYED BY CLASS, NEVER BY SEVERITY. Severity is a priority ordering; it says
 * how soon a founder should look, not what is true of the record. Two classes
 * can share a severity and prove entirely different things — an overdue lead
 * queue row and a dead-lettered job are both `critical`, but only one of them
 * has stopped being retried — so severity cannot supply this sentence.
 *
 * Each line below states ONLY what that class's canonical predicate proves.
 * None of them asserts permanent failure, absence of automatic recovery, an
 * external outage, or fault on the part of a vendor or client: no predicate
 * here establishes any of those, and this text never reaches beyond its own
 * evidence. Storage vocabulary stays out of it too — no table or column name.
 */
const WHY_LISTED: Readonly<Record<OperationalIncidentClass, string>> = Object.freeze({
  "automation.dead_letter": "Listed because the automation job reached dead-letter state.",
  "automation.failed": "Listed because the automation job is recorded as failed.",
  "automation.uncertain":
    "Listed because the automation outcome is recorded as uncertain and was never proven either way.",
  "automation.retry_overdue":
    "Listed because its scheduled retry time has already passed and the job is still waiting to be picked up.",
  "automation.processing_stale":
    "Listed because its processing lock is older than the canonical stale threshold.",
  "communication.dead_letter": "Listed because the message reached dead-letter state.",
  "communication.failed": "Listed because the message is recorded as failed.",
  "webhook.failed": "Listed because the webhook receipt is recorded as failed.",
  "webhook.rejected": "Listed because the webhook receipt was rejected before it was processed.",
  "lead_assignment.queue_overdue":
    "Listed because the queue row is unresolved and its next retry time has passed.",
  "lead_assignment.queue_unresolved":
    "Listed because the queue row has not reached resolved state.",
});

export function whyListed(incidentClass: OperationalIncidentClass): string {
  return WHY_LISTED[incidentClass];
}

/** Fixed, non-technical text for a source that could not be read. */
export function faultCopy(fault: SectionFault): { title: string; message: string } {
  return fault === "NOT_PROVISIONED"
    ? {
        title: "Not provisioned in this environment",
        message:
          "The underlying table does not exist here, so there is nothing to report. This is a deployment state, not an empty result — no figure on this card should be read as zero.",
      }
    : {
        title: "Temporarily unavailable",
        message:
          "This source could not be read. Please retry — if it persists, contact engineering. No value is shown rather than a value that might be wrong.",
      };
}

export const HEALTH_LABELS: Readonly<Record<OperationalHealth, string>> = Object.freeze({
  HEALTHY: "Healthy",
  ATTENTION: "Needs attention",
  UNAVAILABLE: "Unavailable",
});

/**
 * Health tone.
 *
 * UNAVAILABLE is deliberately NOT emerald. It is neutral, and the word beside
 * it carries the meaning — severity is never conveyed by colour alone.
 */
export function healthTone(health: OperationalHealth): "emerald" | "amber" | "slate" {
  if (health === "HEALTHY") return "emerald";
  if (health === "ATTENTION") return "amber";
  return "slate";
}

export function severityTone(severity: "critical" | "warning" | "info"): "rose" | "amber" | "slate" {
  if (severity === "critical") return "rose";
  if (severity === "warning") return "amber";
  return "slate";
}

/**
 * Human age. `null` means the instant is unknown and renders as "Unknown" —
 * never as "0s", which would read as "just happened".
 */
export function formatAge(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "Unknown";
  if (seconds < 60) return `${Math.floor(seconds)}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const restMinutes = minutes % 60;
    return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days}d ${restHours}h` : `${days}d`;
}

export type {
  OperationalHealth,
  OperationalIncident,
  OperationalIncidentClass,
  OperationalIncidentClassDescription,
  OperationalSeverity,
  SectionFault,
};
