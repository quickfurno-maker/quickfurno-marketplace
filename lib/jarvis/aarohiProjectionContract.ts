export const QFJ_AAROHI_PROJECTION_PROTOCOL="qfj.aarohi.projection" as const;
export const QFJ_AAROHI_PROJECTION_VERSION=1 as const;
export const QFJ_AAROHI_PROJECTION_PATH="/api/internal/jarvis/aarohi-projection" as const;
export const QFJ_AAROHI_PROJECTION_SIGNING_DOMAIN="qfj.aarohi.projection.http.sig.v1" as const;
export const QFJ_AAROHI_OPERATION_KINDS=["DISCOVER_PROSPECT","SOURCE_OBSERVED","CHANNEL_OBSERVED","CONVERSATION_PROJECT","TASK_PROJECT","SCORE_PROJECT","IDENTITY_MATCH_RECOMMENDED","EVENT_APPEND"] as const;
export type QfjAarohiOperationKind=typeof QFJ_AAROHI_OPERATION_KINDS[number];
export type QfjAarohiOperation={operationId:string;kind:QfjAarohiOperationKind;prospectId?:string;payload:Record<string,unknown>};
export type QfjAarohiProjectionRequest={protocol:typeof QFJ_AAROHI_PROJECTION_PROTOCOL;version:1;caller:"qf-jarvis";audience:"quickfurno-core";requestId:string;issuedAt:string;tenantId:"quickfurno";operations:QfjAarohiOperation[]};
const ID=/^[A-Za-z0-9._:-]{1,128}$/; const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function exact(r:Record<string,unknown>,keys:string[]){return Object.keys(r).sort().join(",")===keys.sort().join(",");}
export function parseQfjAarohiProjectionRequest(value:unknown):QfjAarohiProjectionRequest|null{
 if(!value||typeof value!=="object"||Array.isArray(value))return null;const r=value as Record<string,unknown>;
 if(!exact(r,["protocol","version","caller","audience","requestId","issuedAt","tenantId","operations"]))return null;
 if(r.protocol!==QFJ_AAROHI_PROJECTION_PROTOCOL||r.version!==1||r.caller!=="qf-jarvis"||r.audience!=="quickfurno-core"||r.tenantId!=="quickfurno")return null;
 if(typeof r.requestId!=="string"||!ID.test(r.requestId)||typeof r.issuedAt!=="string"||!Number.isFinite(Date.parse(r.issuedAt)))return null;
 if(!Array.isArray(r.operations)||r.operations.length<1||r.operations.length>50)return null;const seen=new Set<string>();const operations:QfjAarohiOperation[]=[];
 for(const raw of r.operations){if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;const o=raw as Record<string,unknown>;const keys=Object.keys(o);if(!keys.every(k=>["operationId","kind","prospectId","payload"].includes(k))||!keys.includes("operationId")||!keys.includes("kind")||!keys.includes("payload"))return null;
  if(typeof o.operationId!=="string"||!ID.test(o.operationId)||seen.has(o.operationId)||typeof o.kind!=="string"||!QFJ_AAROHI_OPERATION_KINDS.includes(o.kind as QfjAarohiOperationKind))return null;
  if(o.prospectId!==undefined&&(typeof o.prospectId!=="string"||!UUID.test(o.prospectId)))return null;if(!o.payload||typeof o.payload!=="object"||Array.isArray(o.payload))return null;
  seen.add(o.operationId);operations.push({operationId:o.operationId,kind:o.kind as QfjAarohiOperationKind,...(o.prospectId?{prospectId:o.prospectId as string}:{}),payload:o.payload as Record<string,unknown>});}
 return {protocol:QFJ_AAROHI_PROJECTION_PROTOCOL,version:1,caller:"qf-jarvis",audience:"quickfurno-core",requestId:r.requestId,issuedAt:r.issuedAt,tenantId:"quickfurno",operations};
}
