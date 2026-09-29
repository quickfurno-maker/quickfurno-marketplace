"use client";

// ============================================================================
// QF-MVP-82A — the live-connection indicator.
//
// It reports what is actually true. "Live" is shown only when the server has
// acknowledged the stream; a dropped or refused subscription says so plainly,
// because an operator who believes a stale screen is live is worse off than one
// who knows updates have stopped.
//
// State is carried by text and shape, not by colour alone.
// ============================================================================

import type { InboxRealtimeState } from "./useWhatsAppInboxRealtime";

const COPY: Record<InboxRealtimeState, { label: string; detail: string; dot: string; tone: string }> = {
  connecting: {
    label: "Connecting",
    detail: "Opening the live update channel",
    dot: "bg-amber-400",
    tone: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  },
  live: {
    label: "Live",
    detail: "New messages appear automatically",
    dot: "bg-emerald-400",
    tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  },
  reconnecting: {
    label: "Reconnecting",
    detail: "Live updates unavailable — reconnecting",
    dot: "bg-amber-400",
    tone: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  },
  unavailable: {
    label: "Not live",
    detail: "Live updates unavailable — reload to see new messages",
    dot: "bg-rose-400",
    tone: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  },
};

export function WhatsAppInboxRealtimeStatus({ state }: { state: InboxRealtimeState }) {
  const copy = COPY[state];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${copy.tone}`}
      role="status"
      aria-live="polite"
      title={copy.detail}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${copy.dot}`} />
      <span>{copy.label}</span>
      <span className="sr-only">{copy.detail}</span>
    </span>
  );
}
