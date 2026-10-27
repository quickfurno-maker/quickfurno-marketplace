import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS=new Set(["CLAIM","START","WAIT_EXTERNAL","REQUEST_APPROVAL","BLOCK","RESUME","COMPLETE"]);
const EXACT_FIELDS=["action","itemId","expectedRevision","nonce","reason"];
const id=(x:unknown):x is string=>typeof x==="string"&&UUID.test(x);
const send=(data:unknown,status:number)=>Response.json(data,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"
}});
/** A deliberately disabled-by-default Core-only HTTP bridge for a
 * NONDEPLOYABLE database candidate. The Auth server verifies AAL2 first.
 * The RPC rechecks current membership, exact subject, lease and role in SQL.
 * This route cannot perform a real action without independently reviewed
 * SQL and all three explicitly activated staging feature flags.
 */
export async function POST(request:Request){
 if(process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging"||
    process.env.VOX_WORK_ACTIONS_ENABLED!=="staging")
  return send({ok:false,error:"VOX_WORK_WRITES_DISABLED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return send({ok:false,error:"JSON_REQUIRED"},415);
 let data:Record<string,unknown>;
 try{
  const raw=await request.text();
  if(raw.length===0||raw.length>900)return send({ok:false,error:"INVALID_SIZE"},413);
  const parsed:unknown=JSON.parse(raw);
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))
   return send({ok:false,error:"INVALID_BODY"},400);
  data=parsed as Record<string,unknown>;
 }catch{return send({ok:false,error:"INVALID_JSON"},400);}
 const fields=Object.keys(data).sort();
 if(fields.length!==EXACT_FIELDS.length||
    fields.some((x,i)=>x!==[...EXACT_FIELDS].sort()[i]))
  return send({ok:false,error:"UNKNOWN_OR_MISSING_FIELDS"},400);
 if(!ACTIONS.has(String(data.action))||!id(data.itemId)||!id(data.nonce)||
    !Number.isSafeInteger(data.expectedRevision)||
    (data.expectedRevision as number)<0||
    typeof data.reason!=="string"||data.reason.length>300||
    data.reason!==data.reason.trim()||
    (data.action==="CLAIM"&&data.reason!=="")||
    (["BLOCK","REQUEST_APPROVAL","COMPLETE"].includes(String(data.action))&&
     data.reason.length<12))
  return send({ok:false,error:"INVALID_WORK_COMMAND"},400);
 try{
  const scoped=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scoped||scoped.canMutate!==false||
    ["team_leader","auditor"].includes(scoped.role))
   return send({ok:false,error:"CURRENT_NEUTRAL_STAFF_AAL2_REQUIRED"},403);
  // Do not read or trust any actor, role, department, city or team from JSON.
  const {data:rpc,error}=await adminClient().rpc("qf_vox_work_transition_candidate_v1",{
   p_actor:scoped.userId,p_item:data.itemId,
   p_expected_revision:data.expectedRevision,p_nonce:data.nonce,
   p_action:data.action,p_reason:data.reason
  });
  if(error||!Array.isArray(rpc)||rpc.length!==1)return send({
   ok:false,error:"WORK_TRANSITION_DENIED_OR_STALE"},409);
  const item:unknown=rpc[0];
  if(!item||typeof item!=="object"||Array.isArray(item))
   return send({ok:false,error:"INVALID_CORE_RECEIPT"},503);
  const receipt=item as Record<string,unknown>;
  if(receipt.work_item_id!==data.itemId||![
   "ASSIGNED","IN_PROGRESS","WAITING_EXTERNAL","WAITING_APPROVAL","BLOCKED","DONE"
  ].includes(String(receipt.new_state))||
     !Number.isSafeInteger(receipt.new_revision)||
     receipt.new_revision!==(data.expectedRevision as number)+1)
   return send({ok:false,error:"INVALID_CORE_RECEIPT"},503);
  return send({ok:true,schema:"qf.vox.work.transaction.receipt.v1",
   workItemId:receipt.work_item_id,newState:receipt.new_state,
   revision:receipt.new_revision,providerMessagesSent:0,
   affectsVendorLeadMatching:false},200);
 }catch{return send({ok:false,error:"WORK_CORE_UNAVAILABLE"},503);}
}
export function GET(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
