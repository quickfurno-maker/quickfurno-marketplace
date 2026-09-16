export const QFJ_HANDSHAKE_PROTOCOL = "qfj.handshake" as const;
export const QFJ_HANDSHAKE_VERSION = 1 as const;
export const QFJ_HANDSHAKE_PATH = "/api/internal/jarvis/handshake" as const;
export const QFJ_HANDSHAKE_SIGNING_DOMAIN = "qfj.handshake.http.sig.v1" as const;

export interface QfjHandshakeRequestV1 {
  readonly protocol: typeof QFJ_HANDSHAKE_PROTOCOL;
  readonly version: typeof QFJ_HANDSHAKE_VERSION;
  readonly caller: "qf-jarvis";
  readonly audience: "quickfurno-core";
  readonly requestId: string;
  readonly issuedAt: string;
  readonly jarvisInstanceId: string;
}

export interface QfjHandshakeResponseV1 {
  readonly protocol: typeof QFJ_HANDSHAKE_PROTOCOL;
  readonly version: typeof QFJ_HANDSHAKE_VERSION;
  readonly requestId: string;
  readonly status: "READY" | "SAFE_DISABLED";
  readonly mode: "off" | "shadow" | "active";
  readonly capabilities: Readonly<Record<string, boolean>>;
  readonly protocols: Readonly<Record<string, string>>;
}
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function parseQfjHandshakeRequest(value: unknown): QfjHandshakeRequestV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (!exact(r, ["protocol", "version", "caller", "audience", "requestId", "issuedAt", "jarvisInstanceId"])) return null;
  if (r.protocol !== QFJ_HANDSHAKE_PROTOCOL || r.version !== QFJ_HANDSHAKE_VERSION) return null;
  if (r.caller !== "qf-jarvis" || r.audience !== "quickfurno-core") return null;
  if (typeof r.requestId !== "string" || !ID.test(r.requestId)) return null;
  if (typeof r.jarvisInstanceId !== "string" || !ID.test(r.jarvisInstanceId)) return null;
  if (typeof r.issuedAt !== "string" || !INSTANT.test(r.issuedAt) || !Number.isFinite(Date.parse(r.issuedAt))) return null;
  return Object.freeze(r as unknown as QfjHandshakeRequestV1);
}
