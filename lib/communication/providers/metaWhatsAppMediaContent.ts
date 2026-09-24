import { createHash } from "node:crypto";
import type { MetaOutboundConfig } from "./metaCloudWhatsAppConfig";
import type { QfjWhatsAppMediaKind } from "../../jarvis/whatsAppMediaContentContract";

const GRAPH_API_BASE = "https://graph.facebook.com";
const MEDIA_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const GRAPH_VERSION = /^v\d{1,3}\.\d{1,3}$/;
const MAX_METADATA_BYTES = 64 * 1024;

export const QF_JARVIS_MEDIA_MAX_BYTES: Readonly<Record<QfjWhatsAppMediaKind, number>> =
  Object.freeze({
    image: 8 * 1024 * 1024,
    document: 32 * 1024 * 1024,
    audio: 20 * 1024 * 1024,
    video: 20 * 1024 * 1024,
    sticker: 2 * 1024 * 1024,
  });

const TRUSTED_MEDIA_ROOTS = Object.freeze(["facebook.com", "fbsbx.com", "fbcdn.net"]);

export type MetaWhatsAppMediaContentResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly mimeType: string;
      readonly sha256: string;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "invalid_input"
        | "provider_unavailable"
        | "provider_refused"
        | "provider_invalid"
        | "untrusted_media_url"
        | "media_too_large"
        | "mime_mismatch"
        | "digest_mismatch";
    };

type FetchFn = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeMime(value: string | null | undefined): string | null {
  if (!value) return null;
  const mime = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime) ? mime : null;
}

function trustedMediaUrl(raw: string): URL | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
  const host = url.hostname.toLowerCase();
  const trusted = TRUSTED_MEDIA_ROOTS.some((root) => host === root || host.endsWith("." + root));
  return trusted ? url : null;
}
async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; tooLarge: boolean }> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    return { ok: false, tooLarge: true };
  }
  if (!response.body) return { ok: true, bytes: new Uint8Array() };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (!part.value) continue;
      total += part.value.byteLength;
      if (total > maxBytes) return { ok: false, tooLarge: true };
      chunks.push(part.value);
    }
  } finally {
    try { await reader.cancel(); } catch { /* best effort */ }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes: merged };
}

function digestMatches(expected: unknown, bytes: Uint8Array): boolean {
  if (typeof expected !== "string" || expected.length < 16 || expected.length > 128) return false;
  const hex = createHash("sha256").update(bytes).digest("hex");
  const base64 = createHash("sha256").update(bytes).digest("base64");
  const base64url = createHash("sha256").update(bytes).digest("base64url");
  return expected.toLowerCase() === hex || expected === base64 || expected === base64url;
}

function parseFileSize(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d{1,15}$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

export async function fetchMetaWhatsAppMediaContent(
  input: {
    readonly mediaId: string;
    readonly mediaKind: QfjWhatsAppMediaKind;
    readonly expectedMimeType?: string;
  },
  config: MetaOutboundConfig,
  fetchFn: FetchFn = fetch,
): Promise<MetaWhatsAppMediaContentResult> {
  if (!MEDIA_ID.test(input.mediaId) || !GRAPH_VERSION.test(config.graphApiVersion)) {
    return { ok: false, reason: "invalid_input" };
  }
  const expectedMime = input.expectedMimeType === undefined
    ? undefined
    : normalizeMime(input.expectedMimeType);
  if (input.expectedMimeType !== undefined && expectedMime === null) {
    return { ok: false, reason: "invalid_input" };
  }
  const maxBytes = QF_JARVIS_MEDIA_MAX_BYTES[input.mediaKind];

  let metadataResponse: Response;
  try {
    metadataResponse = await fetchFn(
      GRAPH_API_BASE + "/" + config.graphApiVersion + "/" + encodeURIComponent(input.mediaId),
      {
        method: "GET",
        redirect: "error",
        headers: { Authorization: "Bearer " + config.accessToken },
        signal: AbortSignal.timeout(config.businessHttpTimeoutMs),
      },
    );
  } catch {
    return { ok: false, reason: "provider_unavailable" };
  }
  if (!metadataResponse.ok) {
    return { ok: false, reason: metadataResponse.status < 500 ? "provider_refused" : "provider_unavailable" };
  }
  const metadataBody = await readBoundedBody(metadataResponse, MAX_METADATA_BYTES);
  if (!metadataBody.ok) return { ok: false, reason: "provider_invalid" };

  let metadata: unknown;
  try { metadata = JSON.parse(new TextDecoder().decode(metadataBody.bytes)); }
  catch { return { ok: false, reason: "provider_invalid" }; }
  if (!isRecord(metadata) || typeof metadata.url !== "string") {
    return { ok: false, reason: "provider_invalid" };
  }
  if (metadata.messaging_product !== undefined && metadata.messaging_product !== "whatsapp") {
    return { ok: false, reason: "provider_invalid" };
  }
  const metadataMime = normalizeMime(typeof metadata.mime_type === "string" ? metadata.mime_type : null);
  if (!metadataMime) return { ok: false, reason: "provider_invalid" };
  if (expectedMime !== undefined && metadataMime !== expectedMime) {
    return { ok: false, reason: "mime_mismatch" };
  }
  const fileSize = parseFileSize(metadata.file_size);
  if (fileSize === null) return { ok: false, reason: "provider_invalid" };
  if (fileSize > maxBytes) return { ok: false, reason: "media_too_large" };
  const mediaUrl = trustedMediaUrl(metadata.url);
  if (!mediaUrl) return { ok: false, reason: "untrusted_media_url" };

  let mediaResponse: Response;
  try {
    mediaResponse = await fetchFn(mediaUrl, {
      method: "GET",
      redirect: "error",
      headers: { Authorization: "Bearer " + config.accessToken },
      signal: AbortSignal.timeout(config.businessHttpTimeoutMs),
    });
  } catch {
    return { ok: false, reason: "provider_unavailable" };
  }
  if (!mediaResponse.ok) {
    return { ok: false, reason: mediaResponse.status < 500 ? "provider_refused" : "provider_unavailable" };
  }
  const body = await readBoundedBody(mediaResponse, maxBytes);
  if (!body.ok) return { ok: false, reason: "media_too_large" };
  if (body.bytes.byteLength !== fileSize) return { ok: false, reason: "provider_invalid" };

  const responseMime = normalizeMime(mediaResponse.headers.get("content-type"));
  if (responseMime !== null && responseMime !== metadataMime) {
    return { ok: false, reason: "mime_mismatch" };
  }
  if (!digestMatches(metadata.sha256, body.bytes)) {
    return { ok: false, reason: "digest_mismatch" };
  }

  return {
    ok: true,
    bytes: body.bytes,
    mimeType: metadataMime,
    sha256: createHash("sha256").update(body.bytes).digest("hex"),
  };
}
