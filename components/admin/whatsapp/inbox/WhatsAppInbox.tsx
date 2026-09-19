"use client";

// ============================================================================
// QF-MVP-82A — the unified WhatsApp inbox.
//
// A two-pane workspace on the desktop, and a single pane that swaps between the
// list and the thread on a phone — so an operator can actually read a
// conversation on the device they carry.
//
// All data arrives as props from the server read layer. There is no client-side
// fetching of message data anywhere in this tree: the live channel only says
// "something changed", and the refreshed server render is what supplies it.
// ============================================================================

import type {
  InboxConversationView,
  InboxEventView,
  InboxFilterValue,
} from "@/lib/communication/whatsappInboxReadModel";
import { EmptyState } from "../../AdminPrimitives";
import { WhatsAppConversationList } from "./WhatsAppConversationList";
import { WhatsAppConversationThread } from "./WhatsAppConversationThread";
import { WhatsAppInboxRealtimeStatus } from "./WhatsAppInboxRealtimeStatus";
import { useWhatsAppInboxRealtime } from "./useWhatsAppInboxRealtime";

export interface WhatsAppInboxViewModel {
  readonly state: "ok" | "fault" | "not_provisioned";
  readonly conversations: readonly InboxConversationView[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly filter: InboxFilterValue;
  readonly search: string | null;
  readonly thread: {
    readonly conversation: InboxConversationView;
    readonly events: readonly InboxEventView[];
    readonly hasOlder: boolean;
  } | null;
  readonly selectionOutOfWindow: boolean;
  readonly scanWindow: number;
  readonly windowSaturated: boolean;
}

export function WhatsAppInbox({
  inbox,
  selectedId,
  setParam,
}: {
  inbox: WhatsAppInboxViewModel | undefined;
  selectedId: string | null;
  setParam: (key: string, value: string) => void;
}) {
  // The hook lives HERE, so it opens a connection only while the inbox tab is
  // actually mounted. Any other WhatsApp tab opens no EventSource at all.
  const realtime = useWhatsAppInboxRealtime(inbox?.state === "ok");

  if (inbox === undefined) {
    return <EmptyState title="Inbox unavailable" message="The inbox could not be loaded." />;
  }

  if (inbox.state === "not_provisioned") {
    return (
      <EmptyState
        title="Inbox projection not provisioned"
        message="The QF-MVP-82A read-only inbox views are not present in this environment. The message ledgers themselves are unaffected — open the Messages tab for the forensic view."
      />
    );
  }

  if (inbox.state === "fault") {
    return (
      <EmptyState
        title="Inbox could not be read"
        message="The conversation projection could not be read. Please retry — if this persists, contact engineering."
      />
    );
  }

  const hasThread = inbox.thread !== null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Unified inbox</h2>
          <p className="text-[11px] text-slate-400">
            Inbound and outbound WhatsApp in one chronological conversation, derived from the existing
            message authorities. Read-only.
          </p>
        </div>
        <WhatsAppInboxRealtimeStatus state={realtime.state} />
      </div>

      {inbox.windowSaturated && (
        <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-slate-300">
          Built from the {inbox.scanWindow} most recent messages in each direction, so conversations
          older than that window are not listed here. The Messages tab remains the complete ledger.
        </p>
      )}

      {inbox.selectionOutOfWindow && (
        <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
          That conversation is not in the recent activity window, so its thread could not be opened.
          Use search or the Messages ledger to reach older history.
        </p>
      )}

      <div className="grid min-h-[32rem] grid-cols-1 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] lg:grid-cols-[22rem_1fr]">
        {/* On a narrow screen exactly one pane is mounted, so there is no split
            view to scroll sideways and no hidden pane stealing the viewport. */}
        <div className={`min-h-0 border-white/10 lg:border-r ${hasThread ? "hidden lg:block" : "block"}`}>
          <WhatsAppConversationList
            conversations={inbox.conversations}
            selectedId={selectedId}
            filter={inbox.filter}
            search={inbox.search}
            page={inbox.page}
            pageSize={inbox.pageSize}
            total={inbox.total}
            onSelect={(id) => setParam("conversation", id)}
            onFilter={(f) => setParam("filter", f)}
            onSearch={(term) => setParam("search", term)}
            onPage={(p) => setParam("page", String(p))}
          />
        </div>

        <div className={`min-h-0 ${hasThread ? "block" : "hidden lg:block"}`}>
          {inbox.thread === null ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-slate-400">
              Select a conversation to read it.
            </div>
          ) : (
            <WhatsAppConversationThread
              conversation={inbox.thread.conversation}
              events={inbox.thread.events}
              hasOlder={inbox.thread.hasOlder}
              onBack={() => setParam("conversation", "")}
            />
          )}
        </div>
      </div>
    </section>
  );
}
