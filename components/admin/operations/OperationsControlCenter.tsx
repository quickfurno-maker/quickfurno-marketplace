"use client";

// ============================================================================
// QuickFurno Admin — Operations & Launch Control shell (QF-MVP-70.01).
//
// Tab state lives in the URL (`?tab=…`), so switching tabs is a server
// navigation that loads exactly one tab's data. A hidden tab has no data in
// props and issues no fetch of its own — there is no client-side data loading
// anywhere in this workspace.
//
// This shell renders NO retry, cancel, pause, resume, resolve, acknowledge or
// override control, because QF-MVP-70.01 introduces no operational write
// authority for one to be wired to.
// ============================================================================

import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader, TabPanel, Tabs } from "../AdminPrimitives";
import { OperationsOverviewTab } from "./OperationsOverviewTab";
import { OperationsIncidentsTab } from "./OperationsIncidentsTab";
import { OperationsIncidentDrawer } from "./OperationsIncidentDrawer";
import {
  OPERATIONS_BASE_PATH,
  OPERATIONS_INCIDENT_PARAM,
  OPERATIONS_TABS,
  OPERATIONS_TAB_LABELS,
  type OperationsControlCenterPayload,
  type OperationsTab,
} from "./operationsTypes";

const TAB_LABELS: string[] = OPERATIONS_TABS.map((tab) => OPERATIONS_TAB_LABELS[tab]);

function tabFromLabel(label: string): OperationsTab {
  return OPERATIONS_TABS.find((tab) => OPERATIONS_TAB_LABELS[tab] === label) ?? "overview";
}

export function OperationsControlCenter({
  payload,
  error,
}: {
  payload: OperationsControlCenterPayload;
  error: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();

  /**
   * Navigate by rewriting the URL. Changing tab drops every filter, so an
   * incident-class selection can never leak into the overview and silently
   * narrow it; changing the class resets paging.
   *
   * Selection state lives in the URL like everything else, so refresh, back and
   * forward all behave — opening a detail panel is a real history entry, not
   * hidden component state.
   */
  const setParam = (key: string, value?: string) => {
    if (key === "tab") {
      const next = new URLSearchParams();
      if (value && value !== "overview") next.set("tab", value);
      const search = next.toString();
      router.push(search ? `${OPERATIONS_BASE_PATH}?${search}` : OPERATIONS_BASE_PATH);
      return;
    }

    const sp = new URLSearchParams(params?.toString() ?? "");
    if (value === undefined || value === "") sp.delete(key);
    else sp.set(key, value);

    // Paging resets when the QUERY changes. Opening or closing a detail panel is
    // not a query change, so it must leave the current page where it is —
    // otherwise inspecting a row on page 3 would silently jump back to page 1.
    if (key !== "page" && key !== OPERATIONS_INCIDENT_PARAM) sp.delete("page");

    const search = sp.toString();
    router.push(search ? `${OPERATIONS_BASE_PATH}?${search}` : OPERATIONS_BASE_PATH);
  };

  const selection = payload.selection ?? { state: "none" as const };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Operations & Launch Control"
        titleHidden
        description="Read-only operational truth derived from the canonical automation, communication, webhook and lead-assignment tables. Every figure is a proven count or an explicit Unavailable — never a zero standing in for an unreadable source."
      />

      {error ? (
        <div role="alert">
          <p className="qfa-panel px-4 py-3 text-[13px] text-slate-700">{error}</p>
        </div>
      ) : null}

      <Tabs
        id="qf-operations"
        tabs={TAB_LABELS}
        active={OPERATIONS_TAB_LABELS[payload.tab]}
        onChange={(label) => setParam("tab", tabFromLabel(label))}
        label="Operations sections"
      />

      <TabPanel id="qf-operations" active={OPERATIONS_TAB_LABELS[payload.tab]}>
        {payload.tab === "overview" ? (
          <OperationsOverviewTab overview={payload.overview} launch={payload.launch} />
        ) : (
          <OperationsIncidentsTab
            incidents={payload.incidents}
            classOptions={payload.classOptions ?? []}
            selectedIncidentId={
              selection.state === "resolved" ? selection.incident.id : undefined
            }
            onClassChange={(incidentClass) => setParam("class", incidentClass)}
            onPageChange={(page) => setParam("page", String(page))}
            onSelectIncident={(incidentId) => setParam(OPERATIONS_INCIDENT_PARAM, incidentId)}
          />
        )}
      </TabPanel>

      {/* The panel renders whatever the SERVER already resolved. It performs no
          lookup of its own, so closing it is the only client-side effect. */}
      <OperationsIncidentDrawer
        selection={selection}
        onClose={() => setParam(OPERATIONS_INCIDENT_PARAM, undefined)}
      />
    </div>
  );
}
