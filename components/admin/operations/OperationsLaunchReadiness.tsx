"use client";

// ============================================================================
// QuickFurno Admin — Core operations readiness + health (QF-MVP-70.03).
//
// Presentational only. The verdict and every figure arrive already derived —
// and already marked unknown where they could not be proven — by
// services/adminLaunchControlService.ts.
//
// SCOPE IS PART OF THE VERDICT. This panel reports CORE operational readiness:
// the health of the four operational subsystems plus the controls classified
// launch-critical here. It is NOT a full launch certification — WhatsApp/Meta
// readiness is advisory in this phase and is tracked on its own surface — so the
// title, the READY label and a disclosure beside the badge all say so. A bare
// "Ready" here would be read as "QuickFurno is ready to launch", which this
// verdict has no basis to claim.
//
// NOTHING HERE IS A CHART, A TREND OR A HISTORY. There is no metric-history
// table in the product, so no delta, arrow or sparkline is rendered. Each value
// is a current count or a current age, or an explicit Unavailable.
// ============================================================================

import type { LaunchHealthFacts } from "@/services/adminLaunchControlService";
import type { OperationsLaunchSnapshot } from "@/services/adminLaunchControlService";
import { NoteBar, SectionCard, StatusBadge } from "../AdminPrimitives";
import { formatDateTime } from "../adminUtils";
import {
  LAUNCH_READINESS_LABELS,
  READINESS_SCOPE_DISCLOSURE,
  formatAge,
  readinessTone,
} from "./operationsTypes";

/**
 * One launch figure. A null value renders "Unavailable", never 0 — "we could
 * not count" and "there are none" are different facts and are never merged.
 */
function Fact({
  label,
  value,
  helper,
}: {
  label: string;
  value: number | null;
  helper?: string;
}) {
  return (
    <div className="min-w-0 border-b border-[color:var(--qfa-line-soft)] py-2 last:border-b-0 sm:border-b-0">
      <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-[20px] font-semibold leading-none tabular-nums text-slate-950">
        {value === null ? (
          <span className="text-[13px] font-medium text-slate-400">Unavailable</span>
        ) : (
          value.toLocaleString("en-IN")
        )}
      </p>
      {helper ? <p className="mt-1 truncate text-[11px] text-slate-500">{helper}</p> : null}
    </div>
  );
}

/** An age figure. Null ages render "Unknown" via the shared formatter. */
function AgeFact({ label, seconds }: { label: string; seconds: number | null }) {
  return (
    <div className="min-w-0 border-b border-[color:var(--qfa-line-soft)] py-2 last:border-b-0 sm:border-b-0">
      <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-[20px] font-semibold leading-none tabular-nums text-slate-950">
        {seconds === null ? (
          <span className="text-[13px] font-medium text-slate-400">Unknown</span>
        ) : (
          formatAge(seconds)
        )}
      </p>
    </div>
  );
}

function LaunchHealth({ health }: { health: LaunchHealthFacts }) {
  return (
    <SectionCard
      title="Core operations health"
      description="Current counts and ages over the same reads as the queue below. No trend, no history, no service-level target is asserted."
    >
      <div className="grid gap-x-4 sm:grid-cols-2 xl:grid-cols-3">
        <Fact
          label="Open incidents"
          value={health.totalIncidents}
          helper="Across all four subsystems"
        />
        <AgeFact label="Oldest open item" seconds={health.oldestAttentionAgeSeconds} />
        <Fact
          label="Unreadable subsystems"
          value={health.unavailableSubsystems}
          helper="Sources that could not be read"
        />
        <Fact
          label="Overdue queued leads"
          value={health.leadQueueOverdueCount}
          helper="Retry time already passed"
        />
        <AgeFact
          label="Oldest overdue lead"
          seconds={health.leadQueueOldestOverdueAgeSeconds}
        />
        <Fact
          label="Overdue automation retries"
          value={health.automationOverdueRetryCount}
          helper="Retry time already passed"
        />
        <AgeFact
          label="Oldest overdue retry"
          seconds={health.automationOldestOverdueRetryAgeSeconds}
        />
        <Fact
          label="Failed messages"
          value={health.communicationFailedCount}
          helper="Failed and dead-lettered"
        />
        <Fact
          label="Failed webhooks"
          value={health.webhookFailedCount}
          helper="Failed and rejected"
        />
      </div>
    </SectionCard>
  );
}

export function OperationsLaunchReadiness({ launch }: { launch: OperationsLaunchSnapshot }) {
  const { readiness } = launch;

  return (
    <div className="space-y-4">
      <SectionCard
        title="Core Operations Readiness"
        description={readiness.reason}
        action={
          <StatusBadge
            value={LAUNCH_READINESS_LABELS[readiness.verdict]}
            tone={readinessTone(readiness.verdict)}
          />
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge value={`Read ${formatDateTime(launch.generatedAt)}`} tone="slate" />
          {readiness.blockingControls.length > 0 ? (
            <StatusBadge
              value={`Blocking: ${readiness.blockingControls.join(", ")}`}
              tone="rose"
            />
          ) : null}
        </div>

        {/* Scope sits directly under the verdict so the two are read together:
            this is not a full launch certification and must never be mistaken
            for one. */}
        <p className="mt-2.5 text-[12px] leading-5 text-slate-600">
          {READINESS_SCOPE_DISCLOSURE}
        </p>

        {readiness.unreadableControls.length > 0 ? (
          <div className="mt-3" role="alert">
            <NoteBar tone="warning">
              {readiness.unreadableControls.join(", ")} could not be read, so this verdict is based
              on incomplete control data. Treat it as unconfirmed, not as clear.
            </NoteBar>
          </div>
        ) : null}

        <p className="mt-3 text-[11px] leading-4 text-slate-500">
          This verdict is derived for display only. It is recomputed on every load and stored
          nowhere. It uses existing canonical facts alone — overdue means a stored retry time has
          passed, and failed, dead-letter and uncertain are stored statuses. No response-time target
          is invented here.
        </p>
      </SectionCard>

      <LaunchHealth health={launch.health} />
    </div>
  );
}
