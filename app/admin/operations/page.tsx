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
  getOperationsIncidentPage,
  getOperationsOverview,
  listIncidentClassDescriptions,
} from "@/services/adminOperationsService";
import type {
  OperationsControlCenterPayload,
  OperationsTab,
} from "@/components/admin/operations/operationsTypes";
import { OPERATIONS_TABS } from "@/components/admin/operations/operationsTypes";

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

  let payload: OperationsControlCenterPayload = { tab };
  let error: string | null = null;

  try {
    if (tab === "overview") {
      payload = { tab, overview: await getOperationsOverview() };
    } else {
      payload = {
        tab,
        // The class vocabulary is closed and validated inside the read layer;
        // an unknown ?class= falls back to the default rather than reaching
        // PostgREST.
        incidents: await getOperationsIncidentPage({
          incidentClass: first(sp.class),
          page: first(sp.page),
        }),
        classOptions: listIncidentClassDescriptions(),
      };
    }
  } catch (caught) {
    logOperationsRouteFailure(`operations/${tab}`, caught);
    error = OPERATIONS_LOAD_ERROR;
  }

  return <OperationsControlCenter payload={payload} error={error} />;
}
