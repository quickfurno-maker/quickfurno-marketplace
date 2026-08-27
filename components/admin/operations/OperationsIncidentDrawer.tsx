"use client";

// ============================================================================
// QuickFurno Admin — read-only incident detail (QF-MVP-70.02).
//
// Presentational only. It receives one already-derived OperationalIncident from
// the server payload and renders its proven fields. It fetches nothing, resolves
// nothing by id, and exposes no control: `incident.actionable` is typed literal
// `false` in the read model, so a retry, cancel, pause, resume, acknowledge or
// resolve button is not something this panel chose to omit — it is something the
// contract has no way to express.
//
// Accessibility, focus trapping and the close control come from the shared
// Drawer primitive, which is what every other admin detail surface uses.
//
// NO STORAGE VOCABULARY. Table and column names never reach this panel: the
// entity is named in plain words and the timestamp carries the class's own
// founder-facing label.
// ============================================================================

import Link from "next/link";
import type { OperationalIncident } from "@/services/adminOperationsService";
import { Drawer, EmptyState, InfoGrid, Muted, NoteBar, StatusBadge } from "../AdminPrimitives";
import { formatDateTime } from "../adminUtils";
import {
  entityTypeLabel,
  formatAge,
  severityTone,
  whyListed,
  type IncidentSelection,
  type OperationalIncidentClassDescription,
} from "./operationsTypes";

/** The standing authority statement. Identical wording wherever it appears. */
const READ_ONLY_STATEMENT = "Read-only — no operational action is exposed in this phase.";
const AUTHORITY_STATEMENT =
  "No retry, cancel, send, provider, or runtime-setting authority is exposed here.";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function ResolvedDetail({
  incident,
  description,
}: {
  incident: OperationalIncident;
  description: OperationalIncidentClassDescription;
}) {
  return (
    <div className="space-y-5">
      <Section title="Identity">
        <InfoGrid
          rows={[
            ["Class", description.label],
            ["Severity", <StatusBadge key="sev" value={incident.severity} tone={severityTone(incident.severity)} />],
            ["Subsystem", incident.subsystem.replace(/_/g, " ")],
            ["Entity", entityTypeLabel(incident.entityType)],
            [
              "Entity ID",
              incident.entityId ? (
                <span className="font-mono text-[12px] break-all">{incident.entityId}</span>
              ) : (
                <Muted>Not recorded</Muted>
              ),
            ],
          ]}
        />
      </Section>

      <Section title="Status">
        <InfoGrid
          rows={[
            [
              "Current status",
              <StatusBadge key="status" value={incident.currentStatus} tone={severityTone(incident.severity)} />,
            ],
          ]}
        />
        <p className="text-[12px] leading-5 text-slate-600">{description.detail}</p>
        <p className="text-[12px] leading-5 text-slate-500">{whyListed(incident.class)}</p>
      </Section>

      <Section title="Timing">
        <InfoGrid
          rows={[
            [
              description.openedAtLabel,
              incident.openedAt ? formatDateTime(incident.openedAt) : <Muted>Unknown</Muted>,
            ],
            ["Age", formatAge(incident.ageSeconds)],
          ]}
        />
      </Section>

      <Section title="Safe diagnostic code">
        {incident.safeCode ? (
          <p className="qfa-quiet break-all px-3 py-2 font-mono text-[12px] text-slate-700">
            {incident.safeCode}
          </p>
        ) : (
          <p className="text-[12px] text-slate-500">
            No diagnostic code was recorded against this item.
          </p>
        )}
      </Section>

      <Section title="Evidence">
        {incident.evidenceHref ? (
          <Link
            href={incident.evidenceHref}
            className="qfa-focus inline-flex items-center gap-1 text-[13px] font-semibold text-slate-600 hover:text-emerald-700"
          >
            Open the supporting records
            <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <p className="text-[12px] text-slate-500">No dedicated evidence route exists.</p>
        )}
      </Section>

      <Section title="Authority">
        <NoteBar>
          Observation only. {READ_ONLY_STATEMENT} {AUTHORITY_STATEMENT}
        </NoteBar>
      </Section>
    </div>
  );
}

/**
 * The fail-closed branch.
 *
 * The URL named an incident that is not in the bounded payload this view loaded.
 * Nothing is fetched to satisfy it and no field is guessed — the panel says what
 * happened and offers the way out.
 */
function NotInView({ requestedId }: { requestedId: string }) {
  return (
    <div className="space-y-4">
      <EmptyState
        title="Incident not available in this view"
        message="This item is not part of the records currently loaded here. Nothing is shown rather than detail assembled from an unverified lookup. Open the matching class from the Incidents tab, or close this panel."
      />
      <InfoGrid rows={[["Requested", <span key="id" className="font-mono text-[11px] break-all">{requestedId}</span>]]} />
      <NoteBar>
        Observation only. {READ_ONLY_STATEMENT} {AUTHORITY_STATEMENT}
      </NoteBar>
    </div>
  );
}

export function OperationsIncidentDrawer({
  selection,
  onClose,
}: {
  selection: IncidentSelection;
  onClose: () => void;
}) {
  if (selection.state === "none") return null;

  const title =
    selection.state === "resolved" ? selection.description.label : "Incident not available";

  return (
    <Drawer
      title={title}
      subtitle={
        selection.state === "resolved"
          ? `${entityTypeLabel(selection.incident.entityType)} · open ${formatAge(selection.incident.ageSeconds)}`
          : "Nothing was loaded for the requested item."
      }
      onClose={onClose}
      header={<StatusBadge value="Read-only" tone="slate" />}
    >
      {selection.state === "resolved" ? (
        <ResolvedDetail incident={selection.incident} description={selection.description} />
      ) : (
        <NotInView requestedId={selection.requestedId} />
      )}
    </Drawer>
  );
}
