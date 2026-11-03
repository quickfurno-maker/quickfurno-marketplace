import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {writeScopedTimeCommand} from "@/services/vox/virtualOfficeTimeWriter.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
/**
 * SOURCE-ONLY nondeployable Core boundary. This literal MUST remain false
 * until DB parity, reviewer certification, original-migration recovery,
 * Staff AAL2 UAT and explicit Owner staging go. Environment flags alone
 * must NEVER activate a candidate time writer.
 */
const VO3_MANAGED_TIME_WRITER_CERTIFIED=false as const;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actions=new Set(["CLOCK_IN","CLOCK_OUT","BREAK_START","BREAK_END",
 "TASK_START","TASK_PAUSE","TASK_RESUME","TASK_SWITCH","TASK_STOP"]);
const task=(action:string)=>action.startsWith("TASK_");
const unknown=()=>send({ok:false,error:"TIME_WRITE_OUTCOME_UNKNOWN",
 committed:null,retrySameNonceOnly:true},503);
const send=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"
}});
const same=(a:Record<string,unknown>,keys:string[])=>
 Object.keys(a).sort().join("|")===[...keys].sort().join("|");
/** Only current neutral Core Staff is trusted. The DB writer must independently
 * recheck its grants and assignment under a transaction/row lock.
 */
export async function POST(request:Request){
 if(!VO3_MANAGED_TIME_WRITER_CERTIFIED||
    process.env.VOX_VO3_TIME_WRITES_ENABLED!=="staging"||
    process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging")
  return send({ok:false,error:"STAFF_TIME_WRITER_NOT_CERTIFIED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return send({ok:false,error:"JSON_REQUIRED"},415);
 let command:Record<string,unknown>;
 try{
  const raw=await request.text();
  if(raw.length===0||raw.length>500)return send({ok:false,error:"INVALID_PAYLOAD_SIZE"},413);
  const parsed:unknown=JSON.parse(raw);
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))
   return send({ok:false,error:"INVALID_TIME_COMMAND"},400);
  command=parsed as Record<string,unknown>;
 }catch{return send({ok:false,error:"INVALID_TIME_JSON"},400);}
 if(typeof command.action!=="string"||!actions.has(command.action)||
    !same(command,task(command.action)?["action","nonce","expectedRevision","workItemId"]:
      ["action","nonce","expectedRevision"])||
    typeof command.nonce!=="string"||!UUID.test(command.nonce)||
    !Number.isSafeInteger(command.expectedRevision)||
    (command.expectedRevision as number)<0||
    (command.expectedRevision as number)>2147483646||
    (task(command.action)&&
      (typeof command.workItemId!=="string"||!UUID.test(command.workItemId))))
  return send({ok:false,error:"INVALID_TIME_COMMAND"},400);
 // A deadline after submission cannot prove rollback; preserve original nonce.
 let timeout:ReturnType<typeof setTimeout>|undefined;
 try{
  const result=await Promise.race([
   writeScopedTimeCommand(command,{
    environment:"staging",
    enabled:()=>process.env.VOX_VO3_TIME_WRITES_ENABLED==="staging",
    installed:()=>VO3_MANAGED_TIME_WRITER_CERTIFIED,
    currentScopedStaff:async()=>getVerifiedScopedStaff(request.headers.get("authorization")),
    currentTaskGrant:async(scope:unknown,workItemId:string)=>{
     if(!scope||typeof scope!=="object"||Array.isArray(scope))return false;
     const s=scope as Record<string,unknown>;
     if(typeof s.userId!=="string"||typeof s.teamId!=="string"||
        typeof s.cityId!=="string")return false;
     const row=await adminClient().from("vox_work_items_candidate_v1")
      .select("id,team_id,city_id,state,assignee_id")
      .eq("id",workItemId).maybeSingle();
     return !row.error&&row.data?.id===workItemId&&
      row.data.assignee_id===s.userId&&row.data.team_id===s.teamId&&
      row.data.city_id===s.cityId&&row.data.state==="IN_PROGRESS";
    },
    rpc:async(name:string,args:Record<string,unknown>)=>
     adminClient().rpc(name,args)
   }).then(value=>({timedOut:false as const,value})),
   new Promise<{timedOut:true}>(resolve=>{
    timeout=setTimeout(()=>resolve({timedOut:true}),9000);
   })
  ]);
  if(result.timedOut)return unknown();
  const outcome=result.value;
  if(!outcome.ok){
   if(outcome.reason==="TIME_WRITE_OUTCOME_UNKNOWN")return unknown();
   // A denied or stale request is never permission to change the nonce.
   return send({ok:false,error:outcome.reason,retrySameNonceOnly:true},403);
  }
  if(outcome.nonce!==command.nonce||
     outcome.revision!==(command.expectedRevision as number)+1)
   return unknown();
  return send({ok:true,schema:"qf.vox.staff.time.receipt.v1",
   nonce:outcome.nonce,eventId:outcome.eventId,revision:outcome.revision,
   occurredAt:outcome.occurredAt,providerMessagesSent:0,
   moneyMinorUnits:0,productionCertified:false},200);
 }catch{return unknown();}
 finally{if(timeout!==undefined)clearTimeout(timeout);}
}
export function GET(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
