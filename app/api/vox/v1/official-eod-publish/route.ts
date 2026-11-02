import "server-only";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {adminClient} from "@/lib/supabase";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[a-f0-9]{64}$/;
const VERIFIED_APPROVAL_WRITER_INSTALLED=false as boolean;
// Review-only HTTP safety. Independent dual-human writer remains absent.
const EOD_OWNER_AUTH_TIMEOUT_MS=1500;
const EOD_PUBLISH_RPC_TIMEOUT_MS=4000;
const send=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0",
 "vary":"Authorization","x-content-type-options":"nosniff"
}});
export async function POST(request:Request){
 // AB7K: no verified Owner/TL attestation writer or pinned Ed25519 verifier
 // exists, and the publish RPC trusts a caller-supplied Owner UUID. Env flags
 // alone must never enable this route; flip only with reviewed writer + signoff.
 if(!VERIFIED_APPROVAL_WRITER_INSTALLED)
  return send({ok:false,error:"VERIFIED_APPROVAL_WRITER_NOT_INSTALLED"},503);
 if(process.env.VOX_AB7G_EOD_PUBLISH_ENABLED!=="staging"||
    process.env.VOX_AB7G_SIGNED_OWNER_PROOF_ENABLED!=="staging"||
    process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging")
  return send({ok:false,error:"INDEPENDENT_EOD_RELEASE_DISABLED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return send({ok:false,error:"CONTENT_TYPE_REQUIRED"},415);
 try{
  let ownerTimer:ReturnType<typeof setTimeout>|undefined;
  let ownerId:string|null;
  try{
   const outcome=await Promise.race([
    verifyVoxOwnerBearer(request.headers.get("authorization"))
     .then(value=>({timedOut:false as const,value})),
    new Promise<{timedOut:true}>(resolve=>{
     ownerTimer=setTimeout(()=>resolve({timedOut:true}),EOD_OWNER_AUTH_TIMEOUT_MS);
    })
   ]);
   if(outcome.timedOut)return send({ok:false,error:"EOD_OWNER_AUTH_TIMEOUT"},503);
   ownerId=outcome.value;
  }finally{if(ownerTimer!==undefined)clearTimeout(ownerTimer);}
  if(!ownerId)return send({ok:false,error:"CURRENT_OWNER_AAL2_REQUIRED"},403);
  const raw=await request.text();
  if(!raw||raw.length>330)return send({ok:false,error:"INVALID_SIZE"},413);
  const unknown:unknown=JSON.parse(raw);
  if(!unknown||typeof unknown!=="object"||Array.isArray(unknown))
   return send({ok:false,error:"INVALID_EOD_INTENT"},400);
  const input=unknown as Record<string,unknown>;
  if(Object.keys(input).sort().join("|")!==
    "nonce|reportId|sourceDigest|teamLeaderId"||
   typeof input.reportId!=="string"||!UUID.test(input.reportId)||
   typeof input.nonce!=="string"||!UUID.test(input.nonce)||
   typeof input.teamLeaderId!=="string"||!UUID.test(input.teamLeaderId)||
   input.teamLeaderId===ownerId||
   typeof input.sourceDigest!=="string"||!HEX.test(input.sourceDigest))
   return send({ok:false,error:"INVALID_EOD_INTENT"},400);
  // After a mutating RPC is attempted, loss of its HTTP receipt cannot prove
  // rollback. NEVER authorize another nonce or claim no publication occurred.
  const uncertain=()=>send({ok:false,error:"OFFICIAL_EOD_OUTCOME_UNKNOWN",
   publicationAuthorized:null,retrySameNonceOnly:true},503);
  let rpcTimer:ReturnType<typeof setTimeout>|undefined;
  let outcome:{data:unknown;error:unknown};
  try{
   const reply=await Promise.race([
    Promise.resolve(adminClient().rpc(
     "qf_vox_ab7g_official_eod_publish_candidate_v1",{
      p_report:input.reportId,p_owner:ownerId,p_tl:input.teamLeaderId,
      p_nonce:input.nonce,p_source_digest:input.sourceDigest
     })).then(value=>({timedOut:false as const,value})),
    new Promise<{timedOut:true}>(resolve=>{
     rpcTimer=setTimeout(()=>resolve({timedOut:true}),EOD_PUBLISH_RPC_TIMEOUT_MS);
    })
   ]);
   if(reply.timedOut)return uncertain();
   outcome=reply.value;
  }catch{return uncertain();}
  finally{if(rpcTimer!==undefined)clearTimeout(rpcTimer);}
  const {data,error}=outcome;
  if(error||!Array.isArray(data)||data.length!==1)return uncertain();
  const receipt=data[0] as Record<string,unknown>;
  if(!receipt||Object.keys(receipt).sort().join("|")!==
    "publication_report_id|publication_state|receipt_nonce|source_sha256"||
    receipt.publication_report_id!==input.reportId||
    receipt.receipt_nonce!==input.nonce||
    receipt.source_sha256!==input.sourceDigest||
    receipt.publication_state!=="OFFICIALLY_RELEASED_BY_OWNER")
   return uncertain();
  return send({ok:true,reportId:input.reportId,
   state:"OFFICIALLY_RELEASED_BY_OWNER",nativeCoreLedger:true,
   externalMessagesSent:0},201);
 }catch{return send({ok:false,error:"EOD_RELEASE_UNAVAILABLE"},503);}
}
export function GET(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
