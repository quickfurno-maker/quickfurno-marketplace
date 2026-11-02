import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxOperationsStaffBearer} from "@/services/vox/verifiedStaffBearer";
import {createRc42AtomicConversationHandler} from "@/services/vox/rc42AtomicConversationHandler";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// Review-only candidate, not installed. Staging flag ALONE cannot activate it.
export const RC42_ATOMIC_CONVERSATION_RPC_INSTALLED=false as const;
const handle=createRc42AtomicConversationHandler({
 enabled:()=>process.env.VOX_RC42_CORE_CONVERSATION_OPERATOR_ENABLED==="staging"&&
  process.env.VOX_STAFF_GRANTS_ENABLED==="staging"&&
  process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED==="staging",
 installed:()=>RC42_ATOMIC_CONVERSATION_RPC_INSTALLED,
 verify:verifyVoxOperationsStaffBearer,
 rpc:rc42ReviewedDataApiRpc
});
export async function POST(request:Request){
 // Independent GoTrue AAL2 preflight at the actual Core route boundary.
 // The handler checks again, and the atomic SQL independently locks Staff
 // grants, city, consent, revision and original conversation.
 if(!RC42_ATOMIC_CONVERSATION_RPC_INSTALLED||
    process.env.VOX_RC42_CORE_CONVERSATION_OPERATOR_ENABLED!=="staging")
  return handle(request);
 let preflightTimer:ReturnType<typeof setTimeout>|undefined;
 try{
  // The real route boundary checks identity before any mutating SQL call.
  // Its own GoTrue timeout must be smaller than the downstream Web deadline.
  // Explicit real awaited verifier is also part of the protected Core route
  // contract; timeout still contains a hung GoTrue request before any SQL.
  const verifyCurrentStaff=async()=>await verifyVoxOperationsStaffBearer(
   request.headers.get("authorization"));
  const v=await Promise.race([
   verifyCurrentStaff().then(actor=>({timeout:false as const,actor})),
   new Promise<{timeout:true}>(resolve=>{
    preflightTimer=setTimeout(()=>resolve({timeout:true}),1500);
   })
  ]);
  if(v.timeout)return Response.json({ok:false,error:"CURRENT_STAFF_AUTH_TIMEOUT"},
   {status:503,headers:{"cache-control":"private, no-store, max-age=0"}});
  if(!v.actor)return Response.json({ok:false,error:"CURRENT_STAFF_AAL2_REQUIRED"},
   {status:403,headers:{"cache-control":"private, no-store, max-age=0"}});
 }catch{return Response.json({ok:false,error:"CURRENT_STAFF_AUTH_UNAVAILABLE"},{status:503,
  headers:{"cache-control":"private, no-store, max-age=0"}});}
 finally{if(preflightTimer!==undefined)clearTimeout(preflightTimer);}
 return handle(request);
}
const denied=()=>Response.json({ok:false,error:"METHOD_NOT_ALLOWED"},{status:405,
 headers:{"cache-control":"private, no-store, max-age=0","allow":"POST"}});
export const GET=denied;
export const PUT=denied;
export const PATCH=denied;
export const DELETE=denied;

// Kept after the immutable runtime gate: no Data API call can execute
// until the reviewed installation and actual AAL2 checks succeed.
async function rc42ReviewedDataApiRpc(fn:string,args:Record<string,unknown>){
 return adminClient().rpc(fn,args);
}
