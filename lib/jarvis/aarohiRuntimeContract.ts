export const QFJ_AAROHI_RUNTIME_PROTOCOL = "qfj.aarohi.runtime-context" as const;
export const QFJ_AAROHI_RUNTIME_VERSION = 1 as const;
export const QFJ_AAROHI_RUNTIME_PATH = "/api/internal/jarvis/aarohi-runtime-context" as const;
export const QFJ_AAROHI_RUNTIME_SIGNING_DOMAIN = "qfj.aarohi.runtime-context.http.sig.v1" as const;

export type QfjAarohiRuntimeContextRequest = Readonly<{
  protocol: typeof QFJ_AAROHI_RUNTIME_PROTOCOL;
  version: 1;
  caller: "qf-jarvis";
  audience: "quickfurno-core";
  requestId: string;
  issuedAt: string;
  tenantId: "quickfurno";
  conversationId: string;
  revision: number;
}>;

const ID=/^[A-Za-z0-9._:-]{1,128}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANT=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function parseQfjAarohiRuntimeContextRequest(value:unknown):QfjAarohiRuntimeContextRequest|null{
  if(!value||typeof value!=="object"||Array.isArray(value)) return null;
  const r=value as Record<string,unknown>;
  const expected=["protocol","version","caller","audience","requestId","issuedAt","tenantId","conversationId","revision"].sort();
  const actual=Object.keys(r).sort();
  if(actual.length!==expected.length||!actual.every((k,i)=>k===expected[i])) return null;
  if(r.protocol!==QFJ_AAROHI_RUNTIME_PROTOCOL||r.version!==1||r.caller!=="qf-jarvis"||r.audience!=="quickfurno-core"||r.tenantId!=="quickfurno") return null;
  if(typeof r.requestId!=="string"||!ID.test(r.requestId)) return null;
  if(typeof r.issuedAt!=="string"||!INSTANT.test(r.issuedAt)||!Number.isFinite(Date.parse(r.issuedAt))) return null;
  if(typeof r.conversationId!=="string"||!UUID.test(r.conversationId)) return null;
  if(typeof r.revision!=="number"||!Number.isSafeInteger(r.revision)||r.revision<0) return null;
  return Object.freeze({
    protocol:QFJ_AAROHI_RUNTIME_PROTOCOL,
    version:1,
    caller:"qf-jarvis",
    audience:"quickfurno-core",
    requestId:r.requestId,
    issuedAt:r.issuedAt,
    tenantId:"quickfurno",
    conversationId:r.conversationId,
    revision:r.revision,
  });
}
