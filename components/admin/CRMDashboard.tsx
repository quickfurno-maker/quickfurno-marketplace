"use client";

// ============================================================================
// QuickFurno Operations CRM (command center)
//
// C-PERF2: ACTIVE-TAB data loading. The CRM route no longer receives the
// broad every-table snapshot — it gets only the config vocabularies (cities
// + categories). Each tab fetches its own bounded payload when activated:
//   * Overview        — real database-wide KPI counts
//   * Lead Inbox      — server-paged 20/page (C-PERF1)
//   * Pipeline Board  — real stage counts + labelled latest-50 lane cards
//   * Follow-ups      — per-group bounded rows + live group counts
//   * Assignment Queue— server-paged 20/page + live counts
//   * Vendor Activity — server-paged delivery logs + progress projection
//   * Source Analytics— labelled latest-50 sample
//   * Nurture         — server-paged 20/page
// Drawer histories and vendor identities load on demand per lead.
//
// QuickFurno owns lead quality, matching and verified delivery only. Quotation,
// site visit, negotiation, sale and project execution are intentionally absent.
// ============================================================================

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminCrmTabData,
  adminLeadContext,
  adminPrepareLeadClarification,
} from "@/app/actions";
import { NoteBar, TabPanel, Tabs } from "./AdminPrimitives";
import { Pagination } from "./Pagination";
import type { Category, City, Lead, Vendor } from "./adminTypes";
import { emptySnapshot } from "./adminTypes";
import { formatNumber, uniqueOptions } from "./adminUtils";
import {
  AssignmentQueue,
  LeadDrawer,
  LeadInbox,
  Nurture,
  Overview,
  PipelineBoard,
  SourceAnalytics,
  TABS,
  VendorResponse,
  buildRows,
  type CrmRow,
  type Kpi,
  type QuickFilter,
} from "./crm/lead";

export type CrmBaseData = {
  cities: City[];
  categories: Category[];
};

type CrmTabKey = "overview" | "pipeline" | "queue" | "vendor_activity" | "sources" | "nurture";

const TAB_LOADER: Record<string, CrmTabKey | null> = {
  Overview: "overview",
  "Lead Inbox": null, // self-fetching (C-PERF1)
  "Lead Flow": "pipeline",
  "Assignment Queue": "queue",
  "Delivery Evidence": "vendor_activity",
  "Source Analytics": "sources",
  Nurture: "nurture",
};

/** Tabs whose payload is a paged directory. */
const PAGED_TABS = new Set<CrmTabKey>(["queue", "vendor_activity", "nurture"]);

function rowsFromLeads(leads: unknown[], clarifications: unknown[] = []): CrmRow[] {
  return buildRows({
    ...emptySnapshot(),
    leads: (leads ?? []) as any[],
    leadClarificationRequests: (clarifications ?? []) as any[],
  });
}

export function CRMDashboard({ base, notify, error }: { base: CrmBaseData | null; notify: (message: string, tone?: "success" | "error" | "info") => void; error?: string | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [active, setActive] = useState(TABS[0]);
  const [selected, setSelected] = useState<CrmRow | null>(null);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [reloadToken, setReloadToken] = useState(0);

  // Per-tab payload cache + per-tab page. A tab's data loads when it becomes
  // active (or its page/reload changes) — hidden tabs are never fetched.
  const [tabPayload, setTabPayload] = useState<Record<string, any>>({});
  const [tabPage, setTabPage] = useState<Record<string, number>>({});
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const loaderKey = TAB_LOADER[active] ?? null;
  const activePage = loaderKey && PAGED_TABS.has(loaderKey) ? tabPage[loaderKey] ?? 1 : 1;

  useEffect(() => {
    if (!loaderKey) {
      setTabLoading(false);
      setTabError(null);
      return;
    }
    let cancelled = false;
    const seq = ++requestSeq.current;
    setTabLoading(true);
    (async () => {
      const result = await adminCrmTabData(loaderKey, activePage);
      if (cancelled || seq !== requestSeq.current) return;
      if (!result.ok) {
        setTabError(result.error ?? "Could not load this tab.");
        setTabLoading(false);
        return;
      }
      setTabError(null);
      setTabPayload((current) => ({ ...current, [loaderKey]: result.data }));
      setTabLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loaderKey, activePage, reloadToken]);

  // Inbox filter vocabularies come from the config reference tables.
  const inboxFilterOptions = useMemo(
    () => ({
      cities: (base?.cities ?? []).filter((c) => c.is_active !== false).map((c) => String(c.name ?? "")).filter(Boolean),
      services: (base?.categories ?? []).filter((c) => c.is_active !== false).map((c) => String(c.name ?? "")).filter(Boolean),
      sources: uniqueOptions(["Website", "WhatsApp", "Google Ads", "Referral", "Manual"]).filter((v) => v !== "All"),
    }),
    [base?.cities, base?.categories],
  );

  // Drawer context on demand — including the vendor identities referenced by
  // the selected lead's assignments (bounded IN lookup, C-PERF2 §35).
  const [drawerContext, setDrawerContext] = useState<{ leadId: string; deliveryLogs: any[]; notificationLogs: any[] } | null>(null);
  const [knownVendors, setKnownVendors] = useState<Map<string, Vendor>>(new Map());
  useEffect(() => {
    if (!selected) {
      setDrawerContext(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await adminLeadContext(selected.id);
      if (cancelled || !result.ok) return;
      const payload = result.data as { deliveryLogs: any[]; notificationLogs: any[]; vendors?: Vendor[] };
      setDrawerContext({ leadId: selected.id, deliveryLogs: payload.deliveryLogs, notificationLogs: payload.notificationLogs });
      if (payload.vendors?.length) {
        setKnownVendors((current) => {
          const next = new Map(current);
          payload.vendors!.forEach((vendor) => next.set(vendor.id, vendor));
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Vendor identities arriving with tab payloads also feed the shared map.
  const activityVendors = tabPayload.vendor_activity?.vendors as Vendor[] | undefined;
  useEffect(() => {
    if (!activityVendors?.length) return;
    setKnownVendors((current) => {
      const next = new Map(current);
      activityVendors.forEach((vendor) => next.set(vendor.id, vendor));
      return next;
    });
  }, [activityVendors]);

  function prepareClarification(leadId: string) {
    startTransition(async () => {
      const result = await adminPrepareLeadClarification(leadId);
      if (!result.ok) {
        notify(result.error ?? "Could not prepare clarification preview.", "error");
        return;
      }
      notify("Clarification preview prepared.", "success");
      setReloadToken((token) => token + 1);
      router.refresh();
    });
  }

  function openInbox(filter: QuickFilter) {
    setQuickFilter(filter);
    setActive("Lead Inbox");
  }

  // Overview KPIs from real database-wide counts (null = count unavailable →
  // the tile is omitted rather than showing a false zero).
  const overviewKpis: Kpi[] = useMemo(() => {
    const counts = tabPayload.overview?.counts;
    if (!counts) return [];
    const kpis: Array<Kpi | null> = [
      { key: "total", label: "Total leads", value: counts.total, helper: "All captured leads (live count)", tone: "indigo" },
      { key: "new_today", label: "New today", value: counts.newToday, helper: "Created today (live count)", tone: "emerald" },
      { key: "quality_ready", label: "Quality ready", value: counts.qualityReady, helper: "A+/A leads ready for matching", tone: "emerald" },
      { key: "clarification", label: "Needs clarification", value: counts.clarification, helper: "Missing or unclear lead details", tone: "amber" },
      counts.unassigned === null ? null : { key: "unassigned", label: "Unassigned", value: counts.unassigned, helper: "No vendor yet", tone: "amber" },
      counts.assigned === null ? null : { key: "assigned", label: "Assigned", value: counts.assigned, helper: "At least one vendor", tone: "emerald" },
      { key: "vendor_selected", label: "Vendor-selected", value: counts.vendorSelected, helper: "Client picked a vendor", tone: "indigo" },
      { key: "nurture", label: "Nurture", value: counts.nurture, helper: "Not ready for delivery yet", tone: "slate" },
      { key: "invalid_dup", label: "Invalid / duplicate", value: counts.invalidDup, helper: "Lead-validity exceptions", tone: "rose" },
    ];
    return kpis.filter((k): k is Kpi => Boolean(k));
  }, [tabPayload.overview]);

  const pipelineRows = useMemo(() => rowsFromLeads(tabPayload.pipeline?.sample ?? []), [tabPayload.pipeline]);
  const sourceRows = useMemo(() => rowsFromLeads(tabPayload.sources?.sample ?? []), [tabPayload.sources]);
  const nurtureRows = useMemo(() => rowsFromLeads(tabPayload.nurture?.result?.rows ?? []), [tabPayload.nurture]);

  const setPagedTabPage = (key: CrmTabKey) => (page: number) => setTabPage((current) => ({ ...current, [key]: page }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Server-paged CRM — search and filters cover the full database
        </span>
        <span aria-hidden="true" className="text-slate-300">·</span>
        <span>Priority labels are computed for display only and are never written to the database.</span>
        {error ? <span role="alert" className="font-medium text-amber-700">Some data was limited: {error}</span> : null}
      </div>

      <Tabs id="lead-crm-tabs" tabs={TABS} active={active} onChange={setActive} label="Lead CRM sections" />

      <TabPanel id="lead-crm-tabs" active={active}>

      {tabError && active !== "Lead Inbox" ? (
        <p role="alert" className="rounded-[var(--qfa-radius)] border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">{tabError}</p>
      ) : null}

      {active === "Overview" ? (
        overviewKpis.length ? (
          <Overview kpis={overviewKpis} onCard={openInbox} />
        ) : (
          <p className="text-[13px] text-slate-500" aria-busy={tabLoading}>{tabLoading ? "Loading live counts…" : "Counts unavailable."}</p>
        )
      ) : null}

      {active === "Lead Inbox" ? (
        <LeadInbox
          quickFilter={quickFilter}
          setQuickFilter={setQuickFilter}
          onSelect={setSelected}
          onAssign={() => {
            notify("Opening Lead Distribution for manual vendor assignment…", "info");
            router.push("/admin/lead-distribution");
          }}
          isPending={isPending}
          filterOptions={inboxFilterOptions}
          reloadToken={reloadToken}
        />
      ) : null}

      {active === "Lead Flow" ? (
        <div className="space-y-3" aria-busy={tabLoading}>
          {tabPayload.pipeline?.stageCounts ? (
            <NoteBar>
              Lead-generation flow only. Across {formatNumber(tabPayload.pipeline.stageCounts.total)} leads: quality ready{" "}
              {formatNumber(tabPayload.pipeline.stageCounts.qualityReady)} → clarification {formatNumber(tabPayload.pipeline.stageCounts.clarification)} → assigned{" "}
              {formatNumber(tabPayload.pipeline.stageCounts.assigned)} → nurture {formatNumber(tabPayload.pipeline.stageCounts.nurture)} → invalid/duplicate{" "}
              {formatNumber(tabPayload.pipeline.stageCounts.invalidDup)}. Post-delivery sales stages are not tracked.
            </NoteBar>
          ) : null}
          <PipelineBoard rows={pipelineRows} onSelect={setSelected} />
        </div>
      ) : null}


      {active === "Assignment Queue" ? (
        <AssignmentQueue
          result={tabPayload.queue?.result ?? { rows: [], page: 1, pageSize: 20, total: 0 }}
          counts={tabPayload.queue?.counts ?? { total: 0, active: 0, resolved: 0, dueNow: 0 }}
          isPending={tabLoading}
          onPageChange={setPagedTabPage("queue")}
        />
      ) : null}

      {active === "Delivery Evidence" ? (
        <VendorResponse
          result={tabPayload.vendor_activity?.result ?? { rows: [], page: 1, pageSize: 20, total: 0 }}
          counts={tabPayload.vendor_activity?.counts ?? { logsTotal: 0, contactShared: 0, creditDeducted: 0 }}
          vendorsById={knownVendors}
          isPending={tabLoading}
          onPageChange={setPagedTabPage("vendor_activity")}
        />
      ) : null}

      {active === "Source Analytics" ? (
        <div className="space-y-3" aria-busy={tabLoading}>
          <SourceAnalytics rows={sourceRows} />
        </div>
      ) : null}

      {active === "Nurture" ? (
        <div className="space-y-3" aria-busy={tabLoading}>
          <Nurture rows={nurtureRows} onSelect={setSelected} />
          {tabPayload.nurture?.result ? (
            <Pagination
              page={tabPayload.nurture.result.page}
              pageSize={tabPayload.nurture.result.pageSize}
              total={tabPayload.nurture.result.total}
              noun="nurture leads"
              isPending={tabLoading}
              onPageChange={setPagedTabPage("nurture")}
            />
          ) : null}
        </div>
      ) : null}

      </TabPanel>

      {selected ? (
        <LeadDrawer
          row={selected}
          vendorsById={knownVendors}
          deliveryLogs={drawerContext?.leadId === selected.id ? drawerContext.deliveryLogs : []}
          notificationLogs={drawerContext?.leadId === selected.id ? drawerContext.notificationLogs : []}
          onPrepareClarification={prepareClarification}
          onRefresh={() => router.refresh()}
          notify={notify}
          isPending={isPending}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
