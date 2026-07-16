// ============================================================================
// QuickFurno — lib/communication/providers/metaWebhookRawBody.ts  (Phase 8B-1A)
//
// Meta-specific BOUNDED RAW-BYTE reader. Unlike the auth-hook string reader, this
// returns the EXACT request bytes as a `Uint8Array` and NEVER decodes them: the Meta
// `X-Hub-Signature-256` HMAC is computed over the exact bytes on the wire, so a
// decode-then-reencode round trip (which is lossy for non-UTF-8 input) must never
// happen before the signature is verified. The fatal UTF-8 decode happens LATER, in
// the webhook pipeline, and only AFTER the signature is proven.
//
// The reader enforces a byte ceiling BEFORE unbounded buffering: it honours a
// Content-Length pre-check and otherwise counts bytes as it streams, cancelling the
// moment the cap is exceeded. It never logs the body.
// ============================================================================

/** BYTE ceiling for a Meta webhook body. A Meta callback is small (a handful of delivery
 *  statuses or one inbound message); 16 KiB is a generous ceiling that bounds memory. */
export const META_MAX_WEBHOOK_BODY_BYTES = 16 * 1024;

export type MetaWebhookRawBodyResult =
  | { readonly ok: true; readonly rawBytes: Uint8Array }
  | { readonly ok: false; readonly reason: "oversized_body" | "read_failed" };

/** The minimal request surface the reader needs. */
export interface MetaWebhookBodySource {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly headers: { get(name: string): string | null };
  /** Fallback when no stream is exposed (small/empty bodies only). */
  arrayBuffer?(): Promise<ArrayBuffer>;
}

/**
 * Read the request body under a strict byte ceiling, returning the EXACT bytes.
 *
 *   1. If Content-Length is present and exceeds the limit, reject BEFORE reading.
 *   2. Otherwise stream the body, counting BYTES, and reject the instant the count
 *      exceeds the limit (protects a chunked / missing-Content-Length body from
 *      buffering unboundedly).
 *   3. The accepted bytes are concatenated into ONE exact `Uint8Array`. They are NOT
 *      decoded, normalized, reserialized, or parsed here.
 */
export async function readMetaWebhookRawBytes(
  source: MetaWebhookBodySource,
  maxBytes: number = META_MAX_WEBHOOK_BODY_BYTES
): Promise<MetaWebhookRawBodyResult> {
  const declared = Number(source.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "oversized_body" };
  }

  const stream = source.body;
  if (!stream) {
    // No stream exposed: fall back to arrayBuffer() (empty / very small bodies only).
    if (!source.arrayBuffer) return { ok: true, rawBytes: new Uint8Array(0) };
    try {
      const buf = new Uint8Array(await source.arrayBuffer());
      if (buf.byteLength > maxBytes) return { ok: false, reason: "oversized_body" };
      return { ok: true, rawBytes: buf };
    } catch {
      return { ok: false, reason: "read_failed" };
    }
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        total += value.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            /* best effort — we are rejecting anyway */
          }
          return { ok: false, reason: "oversized_body" };
        }
        // Copy each chunk so a stream implementation that reuses its backing buffer
        // across reads cannot corrupt bytes we have already accepted.
        chunks.push(value.slice());
      }
    }
  } catch {
    return { ok: false, reason: "read_failed" };
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, rawBytes: out };
}
