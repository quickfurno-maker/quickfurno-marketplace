"use client";

// ============================================================================
// QuickFurno Admin — Operations overview (QF-MVP-70.01).
//
// Presentational only. Nothing here fetches, mutates, retries, cancels, pauses
// or authorizes. Every number arrives already proven — or already marked
// unknown — by services/adminOperationsService.ts.
// ============================================================================

import Link from "next/link";
import type {
  OperationalClassSummary,
  OperationalIncident,
  OperationalSubsystem,
  OperationalSubsystemSummary,
  OperationsOverview,
} from "@/services/adminOperationsService";
import type { OperationsLaunchSnapshot } from "@/services/adminLaunchControlService";
import type { AdminIconName } from "../adminConfig";
import { AdminIcon } from "../AdminIcon";
import { EmptyState, NoteBar, SectionCard, StatusBadge } from "../AdminPrimitives";
import { formatDateTime } from "../adminUtils";
import { AttentionCenter, type AttentionItem, type AttentionSeverity } from "../AttentionCenter";
import { OperationsControlState } from "./OperationsControlState";
import { OperationsLaunchReadiness } from "./OperationsLaunchReadiness";
import {
  HEALTH_LABELS,
  faultCopy,
  formatAge,
  healthTone,
  incidentSelectionHref,
  severityTone,
} from "./operationsTypes";

const SUBSYSTEM_ICONS: Readonly<Record<OperationalSubsystem, AdminIconName>> = Object.freeze({
  automation: "automations",
  communication: "whatsapp",
  webhook: "notifications",
  lead_assignment: "distribution",
});

/**
 * Class summary → attention row.
 *
 * An unknown count is passed through as `null`. AttentionCenter then forces the
 * row into its `unavailable` state, so an unreadable source can never be ranked,
 * labelled or coloured as a healthy zero.
 *
 * QF-MVP-70.02: `attentionIncident` is the class's concrete triage item, taken
 * from the already-computed `overview.attentionIncidents`. When present the row
 * opens that exact incident; when the class contributed none — because it is
 * clear, unreadable, or its oldest row was suppressed as a cross-class duplicate
 * — the row falls back to the existing evidence route, which is what it did
 * before this slice.
 */
function toAttentionItem(
  entry: OperationalClassSummary,
  icon: AdminIconName,
  attentionIncident: OperationalIncident | undefined,
): AttentionItem {
  // A single decision, made once: either the count is a proven number, or the
  // whole row is unknown. There is no third branch in which a null becomes 0.
  const value: number | null = entry.fault !== null ? null : entry.count;
  const unknown = value === null;
  const open = !unknown && value > 0;

  const severity: AttentionSeverity = unknown ? "unavailable" : open ? entry.severity : "clear";

  const detail = unknown
    ? faultCopy(entry.fault ?? "UNAVAILABLE").message
    : open && entry.oldest
      ? `${entry.detail} Oldest: ${formatAge(entry.oldest.ageSeconds)}.`
      : entry.detail;

  return {
    id: entry.key,
    label: entry.label,
    value,
    detail,
    severity,
    icon,
    // Ranking input only — the longer-open class sorts first inside its band.
    ageSeconds: attentionIncident?.ageSeconds ?? null,
    href: attentionIncident
      ? incidentSelectionHref(attentionIncident.id)
      : (entry.evidenceHref ?? undefined),
    actionLabel: attentionIncident ? "Open incident" : "Open evidence",
  };
}

function ClassRow({ entry }: { entry: OperationalClassSummary }) {
  const count: number | null = entry.fault !== null ? null : entry.count;
  const unknown = count === null;

  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[color:var(--qfa-line-soft)] py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-slate-900">{entry.label}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
          {unknown ? faultCopy(entry.fault ?? "UNAVAILABLE").title : entry.detail}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {count === null ? null : (
          <StatusBadge
            value={count > 0 ? entry.severity : "clear"}
            tone={count > 0 ? severityTone(entry.severity) : "emerald"}
          />
        )}
        <span className="text-right text-[15px] font-semibold tabular-nums text-slate-950">
          {count === null ? (
            <>
              <span aria-hidden="true" className="text-slate-400">
                —
              </span>
              <span className="sr-only">Unavailable</span>
            </>
          ) : (
            count.toLocaleString("en-IN")
          )}
        </span>
      </div>
    </div>
  );
}

function SubsystemCard({ summary }: { summary: OperationalSubsystemSummary }) {
  const unknownTotal = summary.incidentCount === null;

  return (
    <SectionCard
      title={summary.label}
      description={
        unknownTotal
          ? "At least one source in this subsystem could not be read, so no total is shown."
          : `${summary.incidentCount?.toLocaleString("en-IN")} open ${summary.incidentCount === 1 ? "incident" : "incidents"}`
      }
      action={<StatusBadge value={HEALTH_LABELS[summary.health]} tone={healthTone(summary.health)} />}
    >
      <div className="flex items-center gap-2 pb-2">
        <AdminIcon name={SUBSYSTEM_ICONS[summary.subsystem]} className="h-4 w-4 shrink-0 text-slate-500" />
        <p className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
          {summary.oldest
            ? `Oldest open item: ${formatAge(summary.oldest.ageSeconds)} (${summary.oldest.class})`
            : unknownTotal
              ? "Oldest open item cannot be determined."
              : "No open items."}
        </p>
        {summary.evidenceHref ? (
          <Link
            href={summary.evidenceHref}
            className="qfa-focus shrink-0 text-[11px] font-semibold text-slate-500 hover:text-emerald-700"
          >
            Evidence →
          </Link>
        ) : null}
      </div>

      <div>
        {summary.classes.map((entry) => (
          <ClassRow key={entry.key} entry={entry} />
        ))}
      </div>
    </SectionCard>
  );
}

export function OperationsOverviewTab({
  overview,
  launch,
}: {
  overview?: OperationsOverview;
  launch?: OperationsLaunchSnapshot;
}) {
  if (!overview) {
    return (
      <EmptyState
        title="Overview unavailable"
        message="The operations overview could not be loaded. Nothing is shown rather than a figure that might be wrong."
      />
    );
  }

  // The triage queue is already ranked and de-duplicated server-side; indexing
  // it by class is all the view needs. A class absent from this map contributed
  // no concrete incident and keeps its evidence link.
  const attentionByClass = new Map(
    overview.attentionIncidents.map((incident) => [incident.class, incident]),
  );

  const items: AttentionItem[] = overview.subsystems.flatMap((summary) =>
    summary.classes.map((entry) =>
      toAttentionItem(entry, SUBSYSTEM_ICONS[summary.subsystem], attentionByClass.get(entry.key)),
    ),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2.5 border-b border-[color:var(--qfa-line)] pb-3.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <StatusBadge
            value={`System: ${HEALTH_LABELS[overview.overallHealth]}`}
            tone={healthTone(overview.overallHealth)}
          />
          {overview.unavailableSubsystems > 0 ? (
            <StatusBadge
              value={`${overview.unavailableSubsystems} of ${overview.subsystems.length} subsystems unreadable`}
              tone="slate"
            />
          ) : null}
          <StatusBadge value={`Read ${formatDateTime(overview.generatedAt)}`} tone="slate" />
        </div>
      </div>

      {overview.overallHealth === "UNAVAILABLE" ? (
        <div role="alert">
          <NoteBar tone="warning">
            One or more operational sources could not be read. Health cannot be confirmed — treat this
            page as incomplete, not as green.
          </NoteBar>
        </div>
      ) : null}

      {overview.recovery.note ? (
        <NoteBar tone="warning">
          {overview.recovery.note}
          {overview.recovery.oldestOverdueAgeSeconds !== null
            ? ` Oldest overdue retry: ${formatAge(overview.recovery.oldestOverdueAgeSeconds)}.`
            : ""}
        </NoteBar>
      ) : null}

      {/* QF-MVP-70.03 — launch cockpit. Rendered above the queue because the
          founder's first question is whether launch is safe at all; the 70.02
          attention queue below it is unchanged. */}
      {launch ? (
        <>
          <OperationsLaunchReadiness launch={launch} />
          <OperationsControlState controls={launch.controls} />
        </>
      ) : (
        <NoteBar tone="warning">
          Launch readiness could not be assembled. No verdict is shown rather than one that might be
          wrong.
        </NoteBar>
      )}

      <AttentionCenter items={items} />

      <section className="grid gap-4 xl:grid-cols-2">
        {overview.subsystems.map((summary) => (
          <SubsystemCard key={summary.subsystem} summary={summary} />
        ))}
      </section>

      <p className="text-[11px] leading-4 text-slate-500">
        Every figure above is an exact server-side count over the canonical table named in each row, or
        an explicit Unavailable. Nothing on this page is sampled, estimated or projected, and no
        external system was contacted to produce it — recovery status is inferred from job timestamps
        alone. Rows that name a concrete item open its details in place; the queue lists the
        longest-open item per class, and where two classes describe the same record it appears once,
        under the more specific one. This page is read-only: it exposes no retry, cancel, pause or
        resume control.
      </p>
    </div>
  );
}
