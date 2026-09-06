"use client";

// ============================================================================
// QF-MVP-82A — the selected conversation.
//
// Inbound and outbound are interleaved in one chronological timeline, which is
// the whole point of the phase: the forensic Messages ledger still shows the two
// directions separately, and this view shows what actually happened between
// QuickFurno and one contact, in order.
//
// The footer is where a composer will eventually live. It is a statement, not a
// disabled control: 82A has no send path at all, so there is no button here to
// enable by accident.
// ============================================================================

import type { InboxConversationView, InboxEventView } from "@/lib/communication/whatsappInboxReadModel";
import { InboxParticipantKind } from "@/lib/communication/whatsappInboxReadModel";
import { WhatsAppMessageBubble } from "./WhatsAppMessageBubble";

const KIND_LABEL: Record<string, string> = {
  [InboxParticipantKind.CLIENT]: "Client",
  [InboxParticipantKind.VENDOR]: "Vendor",
  [InboxParticipantKind.ADMIN]: "Admin",
  [InboxParticipantKind.UNKNOWN]: "Unknown contact",
  [InboxParticipantKind.CONFLICT]: "Identity conflict",
};

function dayLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function WhatsAppConversationThread({
  conversation,
  events,
  hasOlder,
  onBack,
}: {
  conversation: InboxConversationView;
  events: readonly InboxEventView[];
  hasOlder: boolean;
  onBack: () => void;
}) {
  let lastDay: string | null = null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[#0b1220]/95 p-3 backdrop-blur">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:text-slate-100 lg:hidden"
          >
            ← Back to inbox
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-slate-100">{conversation.displayName}</h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
              <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5">
                {KIND_LABEL[conversation.participantKind] ?? "Unknown contact"}
              </span>
              {conversation.maskedDestination !== null && <span>{conversation.maskedDestination}</span>}
              {conversation.needsReply && <span className="text-amber-200">Needs reply</span>}
            </p>
          </div>
        </div>

        {conversation.participantKind === InboxParticipantKind.CONFLICT && (
          <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
            This contact carries more than one proven identity. QuickFurno will not choose between
            them — review the linked records before acting on this conversation.
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {hasOlder && (
          <p className="mb-3 text-center text-[11px] text-slate-500">
            Showing the {events.length} most recent messages in this conversation. Older history stays
            in the Messages ledger.
          </p>
        )}

        <ul className="space-y-2">
          {events.map((event) => {
            const day = dayLabel(event.occurredAt);
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <div key={event.eventId} className="contents">
                {showDay && (
                  <li className="flex justify-center py-1">
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[10px] text-slate-400">
                      {day}
                    </span>
                  </li>
                )}
                <WhatsAppMessageBubble event={event} />
              </div>
            );
          })}
        </ul>

        {events.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">
            No messages are recorded for this conversation.
          </p>
        )}
      </div>

      <footer className="border-t border-white/10 bg-white/[0.02] p-3 text-center text-[11px] text-slate-400">
        Read-only in QF-MVP-82A. Reply controls will be added in QF-MVP-82B.
      </footer>
    </div>
  );
}
