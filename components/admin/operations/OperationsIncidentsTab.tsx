"use client";

// ============================================================================
// QuickFurno Admin — Operations incident list (QF-MVP-70.01).
//
// One class at a time, server-paged at the locked admin page size. Every row
// answers: what happened, to which entity, when, how long ago, what the current
// canonical status is, what safe code the row carries, and which EXISTING admin
// route holds the underlying evidence.
//
// There is deliberately no per-row control. `incident.actionable` is typed
// `false` in the read model, so a retry, cancel or resolve button is not
// something this component chose to omit — it is something the contract has no
// way to express.
// ============================================================================

import Link from "next/link";
import type { OperationalIncident, OperationsIncidentPage } from "@/services/adminOperationsService";
import { DataTable, EmptyState, Muted, SectionCard, SelectFilter, StatusBadge } from "../AdminPrimitives";
import { formatDateTime, shortId } from "../adminUtils";
import { Pagination } from "../Pagination";
import {
  faultCopy,
  formatAge,
  severityTone,
  type OperationalIncidentClassDescription,
} from "./operationsTypes";

export function OperationsIncidentsTab({
  incidents,
  classOptions,
  onClassChange,
  onPageChange,
}: {
  incidents?: OperationsIncidentPage;
  classOptions: readonly OperationalIncidentClassDescription[];
  onClassChange: (incidentClass: string) => void;
  onPageChange: (page: number) => void;
}) {
  if (!incidents) {
    return (
      <EmptyState
        title="Incidents unavailable"
        message="The incident list could not be loaded. Nothing is shown rather than a partial set that might read as complete."
      />
    );
  }

  const { description } = incidents;
  const labels = classOptions.map((option) => option.label);
  const activeLabel = description.label;

  const columns = [
    {
      header: description.openedAtLabel,
      cell: (row: OperationalIncident) =>
        row.openedAt ? (
          <span className="whitespace-nowrap text-[13px] text-slate-700">
            {formatDateTime(row.openedAt)}
          </span>
        ) : (
          <Muted>Unknown</Muted>
        ),
    },
    {
      header: "Age",
      cell: (row: OperationalIncident) => (
        <span className="whitespace-nowrap tabular-nums text-[13px] font-semibold text-slate-900">
          {formatAge(row.ageSeconds)}
        </span>
      ),
    },
    {
      header: "Entity",
      cell: (row: OperationalIncident) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-slate-800">{row.entityType}</p>
          <p className="truncate font-mono text-[11px] text-slate-500">
            {row.entityId ? shortId(row.entityId) : "—"}
          </p>
        </div>
      ),
    },
    {
      header: "Status",
      cell: (row: OperationalIncident) => (
        <StatusBadge value={row.currentStatus} tone={severityTone(row.severity)} />
      ),
    },
    {
      header: "Safe code",
      cell: (row: OperationalIncident) =>
        row.safeCode ? (
          <span className="font-mono text-[11px] text-slate-600">{row.safeCode}</span>
        ) : (
          <Muted>None recorded</Muted>
        ),
    },
    {
      header: "Evidence",
      cell: (row: OperationalIncident) =>
        row.evidenceHref ? (
          <Link
            href={row.evidenceHref}
            className="qfa-focus whitespace-nowrap text-[12px] font-semibold text-slate-500 hover:text-emerald-700"
          >
            Open →
          </Link>
        ) : (
          <Muted>None</Muted>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <SectionCard
        title={description.label}
        description={description.detail}
        action={
          <SelectFilter
            label="Class"
            value={activeLabel}
            options={labels}
            onChange={(label) => {
              const match = classOptions.find((option) => option.label === label);
              if (match) onClassChange(match.key);
            }}
          />
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge value={description.severity} tone={severityTone(description.severity)} />
          <StatusBadge value={description.subsystem} tone="slate" />
          <StatusBadge
            value={incidents.fault ? "Count unavailable" : `${incidents.total.toLocaleString("en-IN")} open`}
            tone={incidents.fault ? "slate" : "emerald"}
          />
        </div>
      </SectionCard>

      {incidents.fault ? (
        <EmptyState {...faultCopy(incidents.fault)} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={incidents.rows}
            density="compact"
            getRowKey={(row) => row.id}
            emptyTitle="No open incidents in this class"
            emptyMessage="This is a proven zero: the source was read successfully and holds no matching rows."
          />
          <Pagination
            page={incidents.page}
            pageSize={incidents.pageSize}
            total={incidents.total}
            onPageChange={onPageChange}
            noun="incidents"
          />
        </>
      )}
    </div>
  );
}
