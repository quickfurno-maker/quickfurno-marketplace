import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {projectVerifiedTaskIntervals} from "@/contracts/vox/virtualOfficeTimeHistory.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// Review-only VO7 table is absent from managed migrations. No env switch alone
// may activate this route; independent restore, DBA/AppSec and AAL2 still gate it.
const VO9_MANAGED_INTERVAL_HISTORY_CERTIFIED=false as const;
const responseHeaders={"cache-control":"private, no-store, max-age=0",
 "vary":"Authorization","x-content-type-options":"nosniff"};
const send=(body:unknown,status:number)=>Response.json(body,{status,headers:responseHeaders});
type Scope=NonNullable<Awaited<ReturnType<typeof getVerifiedScopedStaff>>>;
const sameScope=(a:Scope,b:Scope):boolean=>{
 if(a.userId!==b.userId||a.teamId!==b.teamId||a.cityId!==b.cityId||
   a.role!==b.role||a.canReadContent!==b.canReadContent||
   a.canMutate!==b.canMutate)return false;
 const keys=["prospectIds","vendorIds","supportThreadIds","conversationIds",
  "verifiedDepartments"] as const;
 for(const key of keys){
  const left=[...(a[key]??[])].sort(),right=[...(b[key]??[])].sort();
  if(left.length!==right.length||left.some((x,i)=>x!==right[i]))return false;
 }
 return true;
};
export async function GET(request:Request){
 if(!VO9_MANAGED_INTERVAL_HISTORY_CERTIFIED||
    process.env.VOX_VO9_TIME_HISTORY_READ_ENABLED!=="staging"||
    process.env.VOX_VO4_TIME_READ_ENABLED!=="staging"||
    process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging")
  return send({ok:false,error:"TASK_HISTORY_NOT_CERTIFIED"},503);
 if(new URL(request.url).search||new URL(request.url).hash)
  return send({ok:false,error:"FILTER_DENIED"},400);
 const header=request.headers.get("authorization");
 let actor:Scope|null;
 try{actor=await getVerifiedScopedStaff(header);}
 catch{return send({ok:false,error:"CURRENT_STAFF_UNAVAILABLE"},503);}
 if(!actor||actor.canMutate!==false||actor.canReadContent!==true||
   ["team_leader","auditor"].includes(actor.role))
  return send({ok:false,error:"CURRENT_STAFF_AAL2_REQUIRED"},403);
 try{
  const rows=await adminClient().from("vox_vo7_staff_task_intervals_candidate_v1")
   .select("closed_by_event_nonce,staff_id,team_id,city_id,work_item_id,started_at,ended_at,elapsed_ms,state_revision,closing_action")
   .eq("staff_id",actor.userId)
   .eq("team_id",actor.teamId).eq("city_id",actor.cityId)
   .order("ended_at",{ascending:false})
   .order("closed_by_event_nonce",{ascending:false}).limit(21);
  if(rows.error||!Array.isArray(rows.data))
   return send({ok:false,error:"TASK_HISTORY_SOURCE_UNAVAILABLE"},503);
  const latest=await getVerifiedScopedStaff(header);
  if(!latest||!sameScope(actor,latest))
   return send({ok:false,error:"STAFF_SCOPE_CHANGED"},403);
  const projection=projectVerifiedTaskIntervals(rows.data,{
   staffId:actor.userId,teamId:actor.teamId,cityId:actor.cityId,
   serverNowMs:Date.now(),sourceVerified:true
  });
  if(projection.ok!==true)
   return send({ok:false,error:"TASK_HISTORY_INTEGRITY_UNVERIFIED"},503);
  return send(projection,200);
 }catch{return send({ok:false,error:"TASK_HISTORY_SOURCE_UNAVAILABLE"},503);}
}
export function POST(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
