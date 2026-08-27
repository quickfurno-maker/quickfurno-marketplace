// ============================================================================
// QuickFurno Admin — Operations & Launch Control route (QF-MVP-70.01).
//
// Server-guarded, server-paged, LAZY BY TAB. Only the active tab's loader runs:
// opening Overview performs no incident-list query, and opening Incidents reads
// exactly one class.
//
// AUTHORIZATION IS SERVER-SIDE. The middleware only proves that SOMEONE is
// signed in; superadmin is proved here, before any loader runs, exactly as
// /admin/whatsapp does. A non-superadmin is redirected and receives no
// operational data — hiding the nav entry would not be authorization.
//
// This route reads. It never retries, cancels, pauses, resumes, sends,
// activates or mutates anything: every function it calls lives in the read-only
// services/adminOperationsService.ts boundary.
// ============================================================================

import { redirect } from "next/navigation";
import { getAdminSession } from "@/app/actions";
import { OperationsControlCenter } from "@/components/admin/operations/OperationsControlCenter";
import {
  describeIncidentClass,
  findIncidentInPool,
  getOperationsIncidentPage,
  getOperationsOverview,
  listIncidentClassDescriptions,
} from "@/services/adminOperationsService";
import type { OperationalIncident } from "@/services/adminOperationsService";
import type {
  IncidentSelection,
  OperationsControlCenterPayload,
  OperationsTab,
} from "@/components/admin/operations/operationsTypes";
import {
  OPERATIONS_INCIDENT_PARAM,
  OPERATIONS_TABS,
} from "@/components/admin/operations/operationsTypes";

export const metadata = { title: "Operations & Launch Control - QuickFurno" };
export const dynamic = "force-dynamic";

// Fixed administrator-facing text. A raw exception or database message is NEVER
// rendered: it can embed SQL, column names, row values or connection detail.
const OPERATIONS_LOAD_ERROR =
  "The operations control center could not be loaded. Please retry — if this persists, contact engineering.";

function logOperationsRouteFailure(scope: string, error: unknown) {
  const safe = error as { name?: string; code?: string } | null;
  console.error("[admin-operations-route] load failed", {
    scope,
    name: safe?.name ?? "Error",
    code: safe?.code ?? "UNKNOWN",
  });
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseTab(raw: unknown): OperationsTab {
  return typeof raw === "string" && (OPERATIONS_TABS as readonly string[]).includes(raw)
    ? (raw as OperationsTab)
    : "overview";
}

/** An incident id is `<class>:<uuid>`. Anything longer is not one, and is
 *  bounded here so a hostile URL cannot push an arbitrary string into the
 *  rendered payload. */
const MAX_INCIDENT_ID_LENGTH = 128;

function parseIncidentId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_INCIDENT_ID_LENGTH) return null;
  return trimmed;
}

/**
 * Resolve `?incident=` against the payload THIS REQUEST already loaded.
 *
 * The pool is whichever bounded set the active tab holds — the ranked attention
 * queue on Overview, the current page of one class on Incidents. There is no
 * by-id query anywhere: an id outside that pool resolves to `not_in_view` and
 * the panel says so, rather than a raw row being fetched by table and id to
 * satisfy an arbitrary URL.
 */
function resolveSelection(
  requestedId: string | null,
  pool: readonly OperationalIncident[],
): IncidentSelection {
  if (!requestedId) return { state: "none" };

  const incident = findIncidentInPool(pool, requestedId);
  if (!incident) return { state: "not_in_view", requestedId };

  return { state: "resolved", incident, description: describeIncidentClass(incident.class) };
}

export default async function AdminOperationsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await getAdminSession();
  if (!session.isLoggedIn) redirect("/admin/login");
  if (!session.isSuperadmin) redirect("/admin/login?error=unauthorized");

  const sp = searchParams ?? {};
  const tab = parseTab(first(sp.tab));
  const requestedIncidentId = parseIncidentId(first(sp[OPERATIONS_INCIDENT_PARAM]));

  let payload: OperationsControlCenterPayload = { tab };
  let error: string | null = null;

  try {
    if (tab === "overview") {
      const overview = await getOperationsOverview();
      payload = {
        tab,
        overview,
        // Resolved from the ranked queue the overview already computed in
        // memory — no additional read of any kind.
        selection: resolveSelection(requestedIncidentId, overview.attentionIncidents),
      };
    } else {
      // The class vocabulary is closed and validated inside the read layer; an
      // unknown ?class= falls back to the default rather than reaching PostgREST.
      const incidents = await getOperationsIncidentPage({
        incidentClass: first(sp.class),
        page: first(sp.page),
      });
      payload = {
        tab,
        incidents,
        classOptions: listIncidentClassDescriptions(),
        // Resolved from the bounded page already loaded above.
        selection: resolveSelection(requestedIncidentId, incidents.rows),
      };
    }
  } catch (caught) {
    logOperationsRouteFailure(`operations/${tab}`, caught);
    error = OPERATIONS_LOAD_ERROR;
  }

  return <OperationsControlCenter payload={payload} error={error} />;
}
