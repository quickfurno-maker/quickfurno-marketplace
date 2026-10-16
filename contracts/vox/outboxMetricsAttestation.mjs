// VOX-08R SOURCE-ONLY. Core's private, service-role-only metric snapshot
// may later be signed for AGNI by the approved Core worker. NO HTTP route,
// no cron, no hardcoded secret, no privileged browser transport.
import {createHmac} from "node:crypto";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const OUTBOX_METRICS_ENVELOPE_SCHEMA="qf.vox.internal-outbox.metrics.envelope.v1";
const fields=[
 "schema","source","observedAt","collectionId","pending","leased",
 "completed","deadLetter","oldestPendingAgeSeconds","maxAttemptsObserved",
 "totalKnown","includesExternalProviderDelivery"
];
const obj=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const exact=(v,keys)=>obj(v)&&Object.keys(v).sort().join("|")===[...keys].sort().join("|");
const count=(x,max=1000000)=>Number.isSafeInteger(x)&&x>=0&&x<=max;
export function isCoreStaffOutboxMetric(metric,now=Date.now()){
 if(!exact(metric,fields)||metric.schema!=="qf.vox.internal-notification-outbox.metrics.v1"||
  metric.source!=="QUICKFURNO_CORE"||
  typeof metric.collectionId!=="string"||!UUID.test(metric.collectionId)||
  metric.totalKnown!==false||metric.includesExternalProviderDelivery!==false||
  !Number.isSafeInteger(now)||now<=0||
  typeof metric.observedAt!=="string"||metric.observedAt.length>40)return false;
 const t=Date.parse(metric.observedAt);
 if(!Number.isFinite(t)||t>now+30000||now-t>300000)return false;
 if(!count(metric.pending)||!count(metric.leased)||!count(metric.completed)||
  !count(metric.deadLetter)||!count(metric.maxAttemptsObserved,5)||
  (metric.oldestPendingAgeSeconds!==null&&
   !count(metric.oldestPendingAgeSeconds,86400))||
  (metric.pending===0&&metric.oldestPendingAgeSeconds!==null)||
  (metric.pending>0&&metric.oldestPendingAgeSeconds===null))return false;
 return true;
}
/** This signature is not permission to display metrics to a non-owner. AGNI
 * must independently verify current Owner and durable replay claims.
 */
export function signCoreOutboxMetricEnvelope({metric,secret,jti,now=Date.now()}={}){
 if(!isCoreStaffOutboxMetric(metric,now)||
  typeof secret!=="string"||secret.length<32||secret.length>4096||
  !UUID.test(String(jti))||!Number.isSafeInteger(now)||now<=0)
  throw Error("CORE_OUTBOX_METRIC_PROVENANCE_REQUIRED");
 const iat=Math.floor(now/1000);
 const body=Object.freeze({
  schema:OUTBOX_METRICS_ENVELOPE_SCHEMA,
  iss:"quickfurno-core",aud:"qf-agni-owner-gateway",
  jti,iat,exp:iat+90,metric
 });
 const bytes=Buffer.from(JSON.stringify(body)).toString("base64url");
 const mac=createHmac("sha256",secret).update(bytes).digest("base64url");
 const token=bytes+"."+mac;
 if(token.length>3600)throw Error("CORE_METRIC_TOKEN_OVERBOUND");
 return token;
}
