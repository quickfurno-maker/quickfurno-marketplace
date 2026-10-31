import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { adminClient } from "@/lib/supabase";
import { parseQfjVerificationKeys } from "@/lib/jarvis/coreDecisionAuth";
import { qfjScaleHeadersForResult, qfjScaleHttpStatus, verifyQfjScaleWebRequest } from "@/lib/jarvis/scaleRequestGuard";
import { signCoreOutboxMetricEnvelope } from "@/contracts/vox/outboxMetricsAttestation.mjs";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const PATH="/api/internal/agni/owner-outbox-metrics";
const ACTOR="qf-agni-control-plane";
const reply=(body:unknown,status:number,headers:Readonly<Record<string,string>>={})=>
 NextResponse.json(body,{status,headers:{"cache-control":"no-store, private",
 "x-content-type-options":"nosniff",...headers}});
/**
 * Signed private Core-to-AGNI status route. No browser Auth, no provider send.
 * Reuses existing QFJ Ed25519 M2M verifier and Core service-role aggregate RPC.
 * Default OFF until DBA/AppSec approve exact candidate schema and signing key.
 */
export async function POST(request:Request):Promise<Response>{
 if(process.env.VOX_AGNI_OUTBOX_METRICS_ENABLED!=="staging"||
    process.env.VOX_STAFF_GRANTS_ENABLED!=="staging")
  return reply({error:"outbox_metrics_disabled"},503);
 if(request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()!=="application/json")
  return reply({error:"invalid_request"},415);
 let raw:Uint8Array;
 try{raw=new Uint8Array(await request.arrayBuffer());}catch{
  return reply({error:"invalid_request"},400);
 }
 if(raw.byteLength<2||raw.byteLength>1024)return reply({error:"invalid_request"},413);
 let payload:unknown;
 try{payload=JSON.parse(Buffer.from(raw).toString("utf8"));}catch{
  return reply({error:"invalid_request"},400);
 }
 if(!payload||typeof payload!=="object"||Array.isArray(payload)||
    Object.keys(payload).join("|")!=="protocol"||
    (payload as {protocol?:unknown}).protocol!=="qf.vox.agni.outbox.read.request.v1")
  return reply({error:"invalid_request"},400);
 const keys=parseQfjVerificationKeys(process.env.QF_AGNI_VERIFICATION_KEYS_JSON);
 if(!keys)return reply({error:"service_unavailable"},503);
 const verified=verifyQfjScaleWebRequest({request,rawBody:raw,path:PATH,
  verificationKeys:keys,nowMs:Date.now(),allowLegacy:false});
 if(!verified.ok)
  return reply({error:"scale_contract_rejected",errorClass:verified.errorClass},
   qfjScaleHttpStatus(verified.errorClass));
 if(verified.mode!=="v1"||verified.metadata.actor!==ACTOR)
  return reply({error:"actor_refused"},403,
   qfjScaleHeadersForResult(verified,"QFJ_REMOTE_REFUSED"));
 const secret=process.env.VOX_AGNI_OUTBOX_SIGNING_KEY;
 if(typeof secret!=="string"||secret.length<32||secret.length>4096)
  return reply({error:"service_unavailable"},503,
   qfjScaleHeadersForResult(verified,"QFJ_UPSTREAM_UNAVAILABLE"));
 try{
  const response=await adminClient().rpc("qf_vox_staff_notification_outbox_metrics_v1");
  if(response.error||!response.data)throw Error("metric_reader_unavailable");
  const token=signCoreOutboxMetricEnvelope({
   metric:response.data,secret,jti:randomUUID(),now:Date.now()
  });
  return reply({protocol:"qf.vox.agni.outbox.metrics.response.v1",
   source:"quickfurno-core",token,mode:"READ_ONLY",actionsEnabled:false,
   providerMessagesSent:0},200,qfjScaleHeadersForResult(verified));
 }catch{
  return reply({error:"metric_reader_unavailable"},503,
   qfjScaleHeadersForResult(verified,"QFJ_UPSTREAM_UNAVAILABLE"));
 }
}
export function GET(){return reply({error:"method_not_allowed"},405);}
export function PUT(){return reply({error:"method_not_allowed"},405);}
export function PATCH(){return reply({error:"method_not_allowed"},405);}
export function DELETE(){return reply({error:"method_not_allowed"},405);}
