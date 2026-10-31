import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {AUTOMATION_STUDIO_WORKFLOWS} from "@/lib/automation/studioContract";
export const runtime="nodejs";export const dynamic="force-dynamic";
const json=(v:unknown,s:number)=>Response.json(v,{status:s,headers:{"cache-control":"private, no-store, max-age=0","vary":"Authorization"}});
export async function GET(request:Request){
 try{
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope||!["operations_manager","auditor"].includes(scope.role))
   return json({ok:false,error:"SCOPE_DENIED"},403);
  // This is a catalog of ACTUAL Core authored workflow types, not a duplicate
  // workflow engine and not a read of live runtime enablement or production status.
  const workflows=AUTOMATION_STUDIO_WORKFLOWS.map(x=>({
    key:x.key,name:x.name,description:x.shortDescription,owner:"quickfurno-core",
    engineLane:x.engineLane,canPublish:false,canExecute:false,runtimeStatus:"NOT_QUERIED"}));
  return json({ok:true,schema:"qf.vox.studio.catalog.v1",mode:"READ_ONLY",workflows,
   agentFlows:[{agent:"AAROHI",owner:"qf-jarvis",status:"NOT_CONNECTED",canEdit:false},
               {agent:"ANISHA",owner:"qf-jarvis",status:"NOT_CONNECTED",canEdit:false}],
   intelligence:[{engine:"AOS",status:"NOT_CONNECTED",readOnly:true},
                 {engine:"AGNI",status:"NOT_CONNECTED",readOnly:true}],
   note:"Studio workflow types originate in QuickFurno Core; no live runtime values were requested."},200);
 }catch{return json({ok:false,error:"STUDIO_UNAVAILABLE"},503);}
}
export function POST(){return json({ok:false,error:"CORE_APPROVAL_REQUIRED"},405);}
export function PATCH(){return json({ok:false,error:"CORE_APPROVAL_REQUIRED"},405);}
export function DELETE(){return json({ok:false,error:"CORE_APPROVAL_REQUIRED"},405);}
