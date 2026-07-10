// ============================================================================
// QuickFurno — lib/communication/httpTransport.ts  (Phase 5F-B)
//
// Injectable, abortable, bounded HTTP transport for provider adapters.
//
// The production implementation uses native fetch with an AbortController whose
// timeout CANCELS THE ACTUAL REQUEST (never a Promise.race pseudo-timeout), and it
// reads at most `maxResponseBytes` of the response body so a hostile/huge response
// cannot exhaust memory. Tests inject a fake transport — no real network is ever
// used in tests.
//
// The transport returns a discriminated result rather than throwing, so a provider
// adapter can classify outcome certainty deterministically (response vs aborted vs
// network_error).
// ============================================================================

export interface HttpTransportRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Record<string, string>;
  readonly body?: string;
  /** Bounded, positive timeout in ms — enforced by AbortController. */
  readonly timeoutMs: number;
  /** Hard cap on bytes read from the response body. */
  readonly maxResponseBytes: number;
}

export type HttpTransportResult =
  | { readonly kind: "response"; readonly status: number; readonly bodyText: string; readonly truncated: boolean }
  | { readonly kind: "aborted" }
  | { readonly kind: "network_error"; readonly code: string | null };

export interface HttpTransport {
  request(req: HttpTransportRequest): Promise<HttpTransportResult>;
}

/** Reads at most `maxBytes` from a web ReadableStream, decoding as UTF-8. */
async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  if (!body) return { text: "", truncated: false };
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let received = 0;
  let text = "";
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - received;
      if (value.byteLength > remaining) {
        text += decoder.decode(value.subarray(0, Math.max(0, remaining)), { stream: false });
        truncated = true;
        break;
      }
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* best effort */
    }
  }
  return { text, truncated };
}

/**
 * Production transport over native fetch. The AbortController aborts the ACTUAL
 * request when the timeout elapses; the response body is read with a hard byte cap.
 */
export class FetchHttpTransport implements HttpTransport {
  async request(req: HttpTransportRequest): Promise<HttpTransportResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });
      const { text, truncated } = await readBounded(res.body, req.maxResponseBytes);
      return { kind: "response", status: res.status, bodyText: text, truncated };
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name === "AbortError") return { kind: "aborted" };
      const code = (err as { code?: string } | null)?.code ?? null;
      return { kind: "network_error", code: typeof code === "string" ? code : null };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Default response-body cap for provider calls (generous; content is never persisted). */
export const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

/** Never let a request run for less than this once a ceiling has been applied. */
export const MIN_REQUEST_TIMEOUT_MS = 1;

/**
 * The single definition of "the effective request timeout": it is NEVER above the
 * adapter's configured timeout, and NEVER above a caller-supplied ceiling (the
 * remaining safe network budget of an enclosing request deadline). Absent a ceiling
 * the configured timeout is used unchanged — so no lane without a deadline is
 * affected. The result still drives the AbortController, so the ACTUAL request is
 * cancelled; this only shortens it.
 */
export function effectiveRequestTimeoutMs(
  configuredMs: number,
  ceilingMs?: number | null
): number {
  if (typeof ceilingMs !== "number" || !Number.isFinite(ceilingMs)) return configuredMs;
  return Math.max(MIN_REQUEST_TIMEOUT_MS, Math.min(configuredMs, Math.floor(ceilingMs)));
}
