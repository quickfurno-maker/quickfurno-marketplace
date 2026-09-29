"use client";

// ============================================================================
// QF-MVP-82A — the conversation sidebar.
//
// Every row is a real button, so the list is keyboard-navigable and the selected
// conversation is announced rather than merely tinted. "Needs reply" is a
// DERIVED state — the last event in the conversation came from the contact — and
// is deliberately not called "unread", because 82A stores no read state that
// could make such a claim true.
// ============================================================================

import type { InboxConversationView, InboxFilterValue } from "@/lib/communication/whatsappInboxReadModel";
import { InboxFilter, InboxParticipantKind } from "@/lib/communication/whatsappInboxReadModel";

const FILTERS: ReadonlyArray<{ value: InboxFilterValue; label: string }> = [
  { value: InboxFilter.ALL, label: "All" },
  { value: InboxFilter.CLIENTS, label: "Clients" },
  { value: InboxFilter.VENDORS, label: "Vendors" },
  { value: InboxFilter.UNKNOWN, label: "Unknown" },
  { value: InboxFilter.NEEDS_REPLY, label: "Needs reply" },
  { value: InboxFilter.FAILED, label: "Failed" },
];

const KIND_LABEL: Record<string, string> = {
  [InboxParticipantKind.CLIENT]: "Client",
  [InboxParticipantKind.VENDOR]: "Vendor",
  [InboxParticipantKind.ADMIN]: "Admin",
  [InboxParticipantKind.UNKNOWN]: "Unknown",
  [InboxParticipantKind.CONFLICT]: "Identity conflict",
};

function relative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function WhatsAppConversationList({
  conversations,
  selectedId,
  filter,
  search,
  page,
  pageSize,
  total,
  onSelect,
  onFilter,
  onSearch,
  onPage,
}: {
  conversations: readonly InboxConversationView[];
  selectedId: string | null;
  filter: InboxFilterValue;
  search: string | null;
  page: number;
  pageSize: number;
  total: number;
  onSelect: (conversationId: string) => void;
  onFilter: (filter: InboxFilterValue) => void;
  onSearch: (term: string) => void;
  onPage: (page: number) => void;
}) {
  const lastPage = Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-white/10 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get("q");
            onSearch(typeof value === "string" ? value : "");
          }}
        >
          <label htmlFor="qf-inbox-search" className="sr-only">
            Search conversations by masked number
          </label>
          <input
            id="qf-inbox-search"
            name="q"
            type="search"
            defaultValue={search ?? ""}
            // Truthful placeholder: this searches the masked contact across ALL
            // conversations, not participant names, and not just this page.
            placeholder="Search masked number…"
            className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
          />
        </form>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Conversation filters">
          {FILTERS.map((f) => {
            const active = f.value === filter;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => onFilter(f.value)}
                aria-pressed={active}
                className={[
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                  active
                    ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
                    : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-slate-100",
                ].join(" ")}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Conversations">
        {conversations.length === 0 && (
          <li className="p-6 text-center text-sm text-slate-400">
            No conversations match this view.
          </li>
        )}

        {conversations.map((c) => {
          const active = c.conversationId === selectedId;
          return (
            <li key={c.conversationId}>
              <button
                type="button"
                onClick={() => onSelect(c.conversationId)}
                aria-current={active ? "true" : undefined}
                className={[
                  "block w-full border-b border-white/5 px-3 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/50",
                  active ? "bg-emerald-500/10" : "hover:bg-white/[0.04]",
                ].join(" ")}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-100">{c.displayName}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{relative(c.lastActivityAt)}</span>
                </span>

                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5">
                    {KIND_LABEL[c.participantKind] ?? "Unknown"}
                  </span>
                  {c.maskedDestination !== null && <span className="truncate">{c.maskedDestination}</span>}
                </span>

                <span className="mt-1 flex items-center gap-2">
                  {c.needsReply && (
                    <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                      Needs reply
                    </span>
                  )}
                  {c.hasFailure && (
                    <span className="shrink-0 rounded-full border border-rose-400/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-200">
                      Failed send
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-2 border-t border-white/10 p-2 text-[11px] text-slate-400">
        <span>
          Page {page} of {lastPage} · {total} conversation{total === 1 ? "" : "s"}
        </span>
        <span className="flex gap-1">
          <button
            type="button"
            onClick={() => onPage(page - 1)}
            disabled={page <= 1}
            className="rounded border border-white/10 px-2 py-1 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => onPage(page + 1)}
            disabled={page >= lastPage}
            className="rounded border border-white/10 px-2 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </span>
      </div>
    </div>
  );
}
