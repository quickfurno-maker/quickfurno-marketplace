import { randomUUID } from "crypto";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  getAdminSession,
  humanWhatsAppReleaseToAiFromForm,
  humanWhatsAppReplyFromForm,
} from "@/app/actions";
import { PageHeader } from "@/components/admin/AdminPrimitives";
import {
  getHumanDeskThread,
  listHumanDeskConversations,
} from "@/services/whatsAppHumanDeskService";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function when(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
    : "—";
}

function returnActor(subject: string): string | null {
  return subject === "client" ? "Riya"
    : subject === "vendor" ? "Anisha"
      : subject === "prospect" ? "Aarohi"
        : null;
}

export default async function WhatsAppHumanDeskPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await getAdminSession();
  if (!session.isLoggedIn) redirect("/admin/login");
  if (!session.isSuperadmin) redirect("/admin/login?error=unauthorized");

  const selectedId = first(searchParams?.conversation);
  const [queue, thread] = await Promise.all([
    listHumanDeskConversations(),
    selectedId ? getHumanDeskThread(selectedId) : Promise.resolve(null),
  ]);
  const selected = thread?.conversation ?? null;
  const nextActor = selected ? returnActor(selected.subjectType) : null;
  const error = first(searchParams?.error);
  const sent = first(searchParams?.sent) === "1";
  const released = first(searchParams?.released);

  return (
    <div className="space-y-5">
      <PageHeader
        title="WhatsApp Human Desk"
        description="Superadmin-only takeover workspace. Human replies use the governed QuickFurno conversation outbox; Jarvis stays suppressed until an explicit return-to-AI action."
        actions={
          <Link
            href="/admin/whatsapp"
            className="qfa-focus inline-flex h-10 items-center rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            WhatsApp control center
          </Link>
        }
      />

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          The requested Human Desk action was refused safely ({error.replaceAll("_", " ")}).
        </div>
      ) : sent ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Human reply accepted into the governed WhatsApp outbox.
        </div>
      ) : released ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Human takeover released. Future inbound turns will route to {released}.
        </div>
      ) : null}

      <div className="grid min-h-[520px] gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-950">Active takeovers</h2>
              <p className="text-xs text-slate-500">{queue.length} conversation{queue.length === 1 ? "" : "s"}</p>
            </div>
          </div>
          <div className="space-y-2">
            {queue.length === 0 ? (
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                No conversation is currently assigned to the QuickFurno Team.
              </div>
            ) : queue.map((item) => (
              <Link
                key={item.id}
                href={`/admin/whatsapp/human-desk?conversation=${encodeURIComponent(item.id)}`}
                className={`block rounded-xl border p-3 transition-colors ${
                  selectedId === item.id
                    ? "border-emerald-300 bg-emerald-50"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-slate-700">{item.destinationMasked}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                    {item.subjectType}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500">Last inbound {when(item.lastInboundAt)}</p>
                <p className={`mt-1 text-[11px] font-medium ${item.canFreeformReply ? "text-emerald-700" : "text-amber-700"}`}>
                  {item.canFreeformReply ? "Free-form service window open" : "Service window closed"}
                </p>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          {!selected || !thread ? (
            <div className="flex min-h-[480px] items-center justify-center text-center">
              <div>
                <h2 className="font-semibold text-slate-950">Select a takeover</h2>
                <p className="mt-1 max-w-sm text-sm text-slate-500">
                  Open a conversation to review its bounded thread, reply as QuickFurno Team, or explicitly return it to the trusted AI actor.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <h2 className="font-semibold text-slate-950">{selected.destinationMasked}</h2>
                  <p className="text-xs text-slate-500">
                    {selected.subjectType} · revision {selected.revision} · service window until {when(selected.serviceWindowExpiresAt)}
                  </p>
                </div>
                {nextActor ? (
                  <form action={humanWhatsAppReleaseToAiFromForm}>
                    <input type="hidden" name="conversationId" value={selected.id} />
                    <input type="hidden" name="expectedRevision" value={selected.revision} />
                    <button
                      type="submit"
                      className="qfa-focus inline-flex h-10 items-center rounded-lg border border-amber-300 bg-amber-50 px-3 text-sm font-semibold text-amber-900 hover:bg-amber-100"
                    >
                      Return future turns to {nextActor}
                    </button>
                  </form>
                ) : (
                  <span className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    AI release blocked until trusted party type is known
                  </span>
                )}
              </div>

              <div className="max-h-[500px] space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-3">
                {thread.events.length === 0 ? (
                  <p className="p-4 text-center text-sm text-slate-500">No thread events are available.</p>
                ) : thread.events.map((event) => (
                  <div
                    key={event.id}
                    className={`max-w-[88%] rounded-2xl border px-3 py-2 ${
                      event.direction === "inbound"
                        ? "mr-auto border-slate-200 bg-white"
                        : "ml-auto border-emerald-100 bg-emerald-50"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-4 text-[10px] uppercase tracking-wide text-slate-400">
                      <span>{event.actor}</span>
                      <span>{event.status}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-5 text-slate-800">{event.body}</p>
                    <p className="mt-1 text-[10px] text-slate-400">{when(event.occurredAt)}</p>
                  </div>
                ))}
              </div>

              {selected.canFreeformReply ? (
                <form action={humanWhatsAppReplyFromForm} className="space-y-2">
                  <input type="hidden" name="conversationId" value={selected.id} />
                  <input type="hidden" name="expectedRevision" value={selected.revision} />
                  <input type="hidden" name="operationId" value={randomUUID()} />
                  <label htmlFor="human-whatsapp-reply" className="text-sm font-semibold text-slate-800">
                    Reply as QuickFurno Team
                  </label>
                  <textarea
                    id="human-whatsapp-reply"
                    name="body"
                    required
                    maxLength={3072}
                    rows={4}
                    className="qfa-focus w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900"
                    placeholder="Write the human response. The message is still subject to QuickFurno suppression, service-window and provider gates."
                  />
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] leading-4 text-slate-500">
                      Submitting queues one encrypted HUMAN proposal. The browser never receives Meta credentials or the destination number.
                    </p>
                    <button
                      type="submit"
                      className="qfa-focus inline-flex h-10 shrink-0 items-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                      Queue reply
                    </button>
                  </div>
                </form>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  The 24-hour customer-service window is closed. Free-form human replies are blocked here; use a separately approved WhatsApp template workflow to re-open contact lawfully.
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
