// ============================================================================
// QuickFurno — QF-MVP-82A WhatsApp inbox live-update bridge.   GET only.
//
// WHAT THIS IS
//   An authenticated, same-origin Server-Sent Events channel that tells an open
//   inbox "something changed, re-read yourself". All database access lives HERE,
//   on the server, holding service-role credentials the browser never sees and
//   could not be given.
//
// IT IS AN INVALIDATION CHANNEL, NOT A SECOND DATA AUTHORITY.
//   The only thing that ever crosses the wire is a fixed, sanitized marker. No
//   row, no id, no hash, no `content_minimized`, no provider message id and no
//   timestamp value is serialized. The browser reacts by refreshing the
//   server-rendered inbox, which re-runs the same read layer under the same
//   Superadmin session — so the sanitization rules can only ever be applied in
//   one place.
//
// HOW CHANGE IS DETECTED (and why it is not Postgres Changes yet)
//   Supabase Postgres Changes only observes tables that belong to the
//   `supabase_realtime` publication, and neither communication table does. Adding
//   them is a governed migration that also amends the staging-history
//   certification manifest, so it is deliberately NOT bundled into this
//   read-only UI phase — QF-MVP-82A-R1 owns that change and will swap the
//   detector below for a real subscription without touching this route's
//   contract with the browser.
//
//   Until then the detector is a BOUNDED server-side watermark: two tiny
//   ordered-limit-1 reads on a fixed interval, comparing only the newest
//   timestamp on each authority. It is not a data feed, it never grows with the
//   table, and it never reaches the browser.
//
// AUTHENTICATION HAPPENS FIRST.
//   The session is proved before any Supabase client is constructed and before
//   any interval is armed. An unauthorized request therefore opens no stream,
//   builds no client and issues ZERO database reads.
//
// BOUNDED LIFETIME.
//   Every stream heartbeats, and every stream expires. Expiry is what forces the
//   browser to reconnect and re-authenticate, so a session revoked mid-stream
//   stops receiving signals within one window rather than indefinitely.
// ============================================================================

import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import { adminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** How often the server looks for a change. Never a browser-side poll. */
const WATERMARK_INTERVAL_MS = 6_000;
/** Keeps proxies from closing an idle connection, and proves liveness. */
const HEARTBEAT_MS = 20_000;
/** Five minutes. Reconnecting is how the session gets re-proved. */
const MAX_STREAM_MS = 5 * 60_000;

/** The ONLY change message this route ever emits. */
const INBOX_CHANGED = { type: "inbox_changed", scope: "whatsapp_inbox" } as const;

/**
 * The newest timestamp on each authority, as an opaque comparison string. The
 * value is compared and then discarded — it is never emitted, because even a
 * timestamp tells an observer when a customer messaged.
 */
async function readWatermark(): Promise<string> {
  const db = adminClient();
  const [outbound, inbound] = await Promise.all([
    db.from("communication_messages").select("updated_at")
      .eq("channel", "whatsapp").order("updated_at", { ascending: false }).limit(1),
    db.from("communication_inbound_messages").select("received_at")
      .order("received_at", { ascending: false }).limit(1),
  ]);
  if (outbound.error) throw outbound.error;
  if (inbound.error) throw inbound.error;
  const out = (outbound.data ?? [])[0] as { updated_at?: string } | undefined;
  const inb = (inbound.data ?? [])[0] as { received_at?: string } | undefined;
  return `${out?.updated_at ?? ""}|${inb?.received_at ?? ""}`;
}

export async function GET(request: Request) {
  // ---- 1. Authenticate BEFORE constructing or reading anything -------------
  const session = await getAdminSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!session.isSuperadmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let watermark: string | null = null;
      let polling = false;
      let poll: ReturnType<typeof setInterval> | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let expiry: ReturnType<typeof setTimeout> | null = null;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client vanished between the check and the write.
          cleanup();
        }
      };

      const emit = (event: string, data: unknown) =>
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      function cleanup() {
        if (closed) return;
        closed = true;
        if (poll !== null) clearInterval(poll);
        if (heartbeat !== null) clearInterval(heartbeat);
        if (expiry !== null) clearTimeout(expiry);
        try { controller.close(); } catch { /* already closed */ }
      }

      const tick = async () => {
        // Never overlap: a slow read must not queue a second one behind it.
        if (closed || polling) return;
        polling = true;
        try {
          const next = await readWatermark();
          if (closed) return;
          if (watermark === null) {
            watermark = next;
          } else if (next !== watermark) {
            watermark = next;
            // ONE signal per interval, however many rows changed inside it.
            emit("inbox", INBOX_CHANGED);
          }
        } catch {
          // No driver text is logged or sent: it can carry connection detail.
          // The operator is told updates are not arriving rather than being
          // left to trust a screen that has silently stopped changing.
          emit("unavailable", { type: "unavailable", scope: "whatsapp_inbox" });
          cleanup();
        } finally {
          polling = false;
        }
      };

      // ---- 2. Open the stream --------------------------------------------
      emit("ready", { type: "ready", scope: "whatsapp_inbox" });
      heartbeat = setInterval(() => write(`: heartbeat\n\n`), HEARTBEAT_MS);
      expiry = setTimeout(() => {
        emit("expired", { type: "expired", scope: "whatsapp_inbox" });
        cleanup();
      }, MAX_STREAM_MS);

      request.signal.addEventListener("abort", cleanup);

      // ---- 3. Establish the baseline, then watch --------------------------
      void tick();
      poll = setInterval(() => void tick(), WATERMARK_INTERVAL_MS);
    },

    cancel() {
      // The consumer went away; `start`'s cleanup runs through the abort signal.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform, must-revalidate",
      "Connection": "keep-alive",
      "Pragma": "no-cache",
      // A private stream must never sit in a shared cache or a proxy buffer.
      "X-Accel-Buffering": "no",
    },
  });
}
