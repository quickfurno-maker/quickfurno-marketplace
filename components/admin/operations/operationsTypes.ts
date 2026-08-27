// ============================================================================
// QuickFurno Admin — Operations Control Center shared view types (QF-MVP-70.01).
//
// PURE type/vocabulary module. It imports ONLY types from the server-only read
// layer (erased at compile time), so nothing here can pull the service_role
// client, a provider adapter or a transport service into a client bundle.
// ============================================================================

import type {
  OperationalHealth,
  OperationalIncidentClass,
  OperationalIncidentClassDescription,
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
}

export type OperationsQuery = {
  readonly tab: OperationsTab;
  readonly incidentClass?: string;
  readonly page?: string;
};

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
  OperationalIncidentClass,
  OperationalIncidentClassDescription,
  SectionFault,
};
