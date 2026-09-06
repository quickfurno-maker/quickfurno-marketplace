// ============================================================================
// QuickFurno — QF-MVP-82A WhatsApp inbox live-update bridge.   GET only.
//
// WHAT THIS IS
//   An authenticated, same-origin Server-Sent Events channel that tells an open
//   inbox "something changed, re-read yourself". The Supabase Realtime
//   subscription lives HERE, on the server, holding a service-role credential
//   the browser never sees and could not be given.
//
// IT IS AN INVALIDATION CHANNEL, NOT A SECOND DATA AUTHORITY.
//   The only thing that ever crosses the wire is a fixed, sanitized marker. The
//   postgres_changes payload is deliberately never bound, never read and never
//   serialized: `payload.new`, `payload.old`, the schema and table names, row
//   ids, `content_minimized`, `destination_hash`, `sender_hash`,
//   `provider_account_id`, variables and metadata do not leave this file. The
//   browser reacts by refreshing the server-rendered inbox, which re-runs the
//   same read layer under the same Superadmin session — so the sanitization
//   rules can only ever be applied in one place.
//
// EVENT-DRIVEN, NOT POLLED.
//   An earlier revision detected change with a bounded server-side watermark
//   poll, because neither communication table was a member of the
//   `supabase_realtime` publication. QF-MVP-82A-R0 added exactly those two
//   tables, and QF-MVP-82A-R0-S1 certified that apply on staging, so the poll is
//   gone: there is no interval here that touches the database, and no query at
//   all outside the change subscription itself.
//
// AUTHENTICATION HAPPENS FIRST.
//   The session is proved before any Supabase client is constructed, before any
//   channel is created and before any subscription is opened. An unauthorized
//   request therefore creates ZERO channels and issues ZERO database work; it is
//   refused with a status code and nothing else happens.
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

/** Coalesces a burst of row changes into a single browser refresh. */
const DEBOUNCE_MS = 400;
/** Keeps proxies from closing an idle connection, and proves liveness. */
const HEARTBEAT_MS = 20_000;
/** Five minutes. Reconnecting is how the session gets re-proved. */
const MAX_STREAM_MS = 5 * 60_000;

/**
 * The EXACT two tables QF-MVP-82A-R0 added to the `supabase_realtime`
 * publication, and the only two this route may observe.
 *
 * `communication_delivery_events` is deliberately absent: a Meta delivery
 * callback already updates `communication_messages`, so that UPDATE is the
 * signal, and subscribing to the append-only event ledger as well would widen
 * the surface without adding one.
 */
const INBOX_TABLES = ["communication_inbound_messages", "communication_messages"] as const;

/** The ONLY message body this route ever emits for a change. */
const INBOX_CHANGED = { type: "inbox_changed", scope: "whatsapp_inbox" } as const;

export async function GET(request: Request) {
  // ---- 1. Authenticate BEFORE constructing or subscribing to anything ------
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
      let debounce: ReturnType<typeof setTimeout> | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let expiry: ReturnType<typeof setTimeout> | null = null;
      let db: ReturnType<typeof adminClient> | null = null;
      let channel: ReturnType<ReturnType<typeof adminClient>["channel"]> | null = null;

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

      /** Idempotent: safe to call from abort, expiry, failure and write errors. */
      function cleanup() {
        if (closed) return;
        closed = true;
        if (debounce !== null) { clearTimeout(debounce); debounce = null; }
        if (heartbeat !== null) { clearInterval(heartbeat); heartbeat = null; }
        if (expiry !== null) { clearTimeout(expiry); expiry = null; }
        // Removing the channel is what releases the server-side subscription and
        // its socket; without it an abandoned tab would leave one running per
        // reload. removeChannel also unsubscribes, so this is the single call.
        if (db !== null && channel !== null) {
          try { void db.removeChannel(channel); } catch { /* already gone */ }
        }
        channel = null;
        db = null;
        try { controller.close(); } catch { /* already closed */ }
      }

      /**
       * A change arrived. The payload is NOT inspected — the callback takes no
       * argument at all — because nothing in it may reach the browser.
       */
      const onDatabaseChange = () => {
        if (closed || debounce !== null) return;
        debounce = setTimeout(() => {
          debounce = null;
          emit("inbox", INBOX_CHANGED);
        }, DEBOUNCE_MS);
      };

      // ---- 2. Open the stream --------------------------------------------
      // Deliberately NOT "ready" yet: the browser may only claim Live once the
      // subscription is actually established, which happens below.
      heartbeat = setInterval(() => write(`: heartbeat\n\n`), HEARTBEAT_MS);
      expiry = setTimeout(() => {
        emit("expired", { type: "expired", scope: "whatsapp_inbox" });
        cleanup();
      }, MAX_STREAM_MS);

      request.signal.addEventListener("abort", cleanup);

      // ---- 3. Subscribe, server-side, with the service-role credential -----
      try {
        db = adminClient();
        let subscription = db.channel("qf-mvp-82a-whatsapp-inbox", {
          config: { broadcast: { self: false }, presence: { key: "" } },
        });
        for (const table of INBOX_TABLES) {
          subscription = subscription.on(
            "postgres_changes",
            { event: "*", schema: "public", table },
            onDatabaseChange,
          );
        }
        channel = subscription.subscribe((status: string) => {
          if (closed) return;
          if (status === "SUBSCRIBED") {
            // Live is claimed ONLY here — when the server actually holds a
            // working subscription. Anything else is reported as unavailable.
            emit("ready", { type: "ready", scope: "whatsapp_inbox" });
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            // A failed subscription is never silently treated as live: the
            // operator would then trust a stale screen, which is worse than
            // knowing updates are not arriving. No driver detail is emitted.
            emit("unavailable", { type: "unavailable", scope: "whatsapp_inbox" });
            cleanup();
          }
        });
      } catch {
        // Sanitized: a connection error can carry host and credential detail.
        console.error("[admin-whatsapp-inbox-stream] realtime subscribe failed");
        emit("unavailable", { type: "unavailable", scope: "whatsapp_inbox" });
        cleanup();
      }
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
