"use client";

// ============================================================================
// QuickFurno Admin — launch control state (QF-MVP-70.03).
//
// A COCKPIT, NOT A SECOND CONTROL PLANE. Every row reports state and names the
// ONE canonical admin surface that owns the control. There is no toggle, no
// switch, no save and no confirm anywhere in this file — a control is changed
// where it has always been changed, and this component only routes the founder
// there.
//
// Rows whose control has no mutation surface in the product say "Observation
// only" and link to read-only evidence instead of pretending an action exists.
// ============================================================================

import Link from "next/link";
import type { LaunchControl } from "@/services/adminLaunchControlService";
import { SectionCard, StatusBadge } from "../AdminPrimitives";
import { formatDateTime } from "../adminUtils";
import { LAUNCH_CONTROL_STATE_LABELS, controlStateTone } from "./operationsTypes";

function ControlRow({ control }: { control: LaunchControl }) {
  return (
    <div className="flex flex-col gap-2 border-b border-[color:var(--qfa-line-soft)] py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-[13px] font-semibold text-slate-900">{control.label}</p>
          <StatusBadge
            value={LAUNCH_CONTROL_STATE_LABELS[control.state]}
            tone={controlStateTone(control.state)}
          />
          {control.impact === "blocking" ? (
            <StatusBadge value="Launch-critical" tone="slate" />
          ) : null}
        </div>
        <p className="mt-1 text-[11px] leading-4 text-slate-500">{control.stateDetail}</p>
        {control.updatedAt ? (
          <p className="mt-0.5 text-[11px] text-slate-400">
            Changed {formatDateTime(control.updatedAt)}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 sm:pl-4">
        {control.href ? (
          <Link
            href={control.href}
            className="qfa-focus inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold text-slate-500 hover:text-emerald-700"
          >
            {control.actionLabel}
            <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <span className="text-[12px] text-slate-400">{control.actionLabel}</span>
        )}
      </div>
    </div>
  );
}

export function OperationsControlState({ controls }: { controls: readonly LaunchControl[] }) {
  return (
    <SectionCard
      title="Control state"
      description="Existing launch controls and where each one is changed. Operations reports state and routes you to the canonical page; it never changes a control itself."
    >
      <div>
        {controls.map((control) => (
          <ControlRow key={control.key} control={control} />
        ))}
      </div>
      <p className="mt-3 border-t border-[color:var(--qfa-line-soft)] pt-2.5 text-[11px] leading-4 text-slate-500">
        A control shown as Unavailable could not be read. Its state is unknown — it is never assumed
        to be off, on, or safe.
      </p>
    </SectionCard>
  );
}
