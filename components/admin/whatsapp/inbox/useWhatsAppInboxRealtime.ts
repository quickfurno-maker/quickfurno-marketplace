"use client";

// ============================================================================
// QF-MVP-82A — the browser half of the inbox live-update bridge.
//
// This hook holds NO data and NO credentials. It opens one same-origin
// EventSource against the authenticated server route, and when that route says
// "something changed" it asks Next to re-render the server component tree. The
// refreshed inbox therefore comes from the same server read layer that produced
// the first render — the browser never learns a hash, a payload or a key, and
// there is no second sanitization path that could drift from the first.
//
// It mounts only where the inbox itself mounts, so a different WhatsApp tab
// opens no connection at all.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export const INBOX_STREAM_PATH = "/api/admin/whatsapp/inbox/stream";

/** Coalesces a burst of change events into a single refresh. */
const REFRESH_DEBOUNCE_MS = 500;
/** Backoff after a dropped stream, so a failing server is not hammered. */
const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;

export type InboxRealtimeState = "connecting" | "live" | "reconnecting" | "unavailable";

export interface InboxRealtimeStatus {
  readonly state: InboxRealtimeState;
  /** Refreshes triggered since mount — the operator's proof it is really live. */
  readonly refreshes: number;
}

export function useWhatsAppInboxRealtime(enabled = true): InboxRealtimeStatus {
  const router = useRouter();
  const [state, setState] = useState<InboxRealtimeState>(enabled ? "connecting" : "unavailable");
  const [refreshes, setRefreshes] = useState(0);

  // Refs, not state: changing these must never itself cause a re-render, which
  // would tear down and rebuild the very connection they describe.
  const sourceRef = useRef<EventSource | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") {
      setState("unavailable");
      return;
    }
    stoppedRef.current = false;

    const clearTimers = () => {
      if (debounceRef.current !== null) { clearTimeout(debounceRef.current); debounceRef.current = null; }
      if (retryRef.current !== null) { clearTimeout(retryRef.current); retryRef.current = null; }
    };

    const closeSource = () => {
      if (sourceRef.current !== null) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
    };

    /** One refresh per burst, no matter how many rows changed. */
    const scheduleRefresh = () => {
      if (stoppedRef.current || debounceRef.current !== null) return;
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        if (stoppedRef.current) return;
        setRefreshes((n) => n + 1);
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    };

    const connect = () => {
      if (stoppedRef.current) return;
      // Exactly one EventSource is ever open for this hook: any previous one is
      // closed before another is created, so a remount cannot leak connections.
      closeSource();

      const source = new EventSource(INBOX_STREAM_PATH);
      sourceRef.current = source;

      source.addEventListener("ready", () => {
        attemptsRef.current = 0;
        setState("live");
      });
      source.addEventListener("inbox", scheduleRefresh);
      source.addEventListener("unavailable", () => setState("unavailable"));

      // The server expires every stream on purpose; reconnecting is what
      // re-proves the session, so this is a normal cycle, not a failure.
      source.addEventListener("expired", () => {
        closeSource();
        setState("reconnecting");
        retryRef.current = setTimeout(connect, RECONNECT_BASE_MS);
      });

      source.onerror = () => {
        closeSource();
        if (stoppedRef.current) return;
        setState("reconnecting");
        attemptsRef.current += 1;
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attemptsRef.current - 1), RECONNECT_MAX_MS);
        retryRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      stoppedRef.current = true;
      clearTimers();
      closeSource();
    };
  }, [enabled, router]);

  return { state, refreshes };
}
