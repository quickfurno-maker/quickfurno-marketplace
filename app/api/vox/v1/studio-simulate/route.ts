import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {
 cloneAutomationStudioDefinition,isAutomationStudioWorkflowKey,
 simulateAutomationStudioDefinition
} from "@/lib/automation/studioContract";
export const runtime="nodejs";export const dynamic="force-dynamic";
const reply=(x:unknown,status:number)=>Response.json(x,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization","x-content-type-options":"nosniff"}});
/** Dry-run simulation of an actual native Core workflow definition.
 * Never evaluates automation jobs, draft writes, provider sends or publish. */
export async function GET(request:Request){
 if(process.env.VOX_STUDIO_SIMULATION_ENABLED!=="staging")
  return reply({ok:false,error:"STUDIO_SIMULATION_DISABLED"},503);
 try{
  const staff=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!staff||!["operations_manager","auditor"].includes(staff.role))
   return reply({ok:false,error:"STAFF_STUDIO_SCOPE_DENIED"},403);
  const u=new URL(request.url);
  if([...u.searchParams.keys()].some(k=>k!=="workflowKey")||
     u.searchParams.getAll("workflowKey").length!==1)
   return reply({ok:false,error:"WORKFLOW_KEY_REQUIRED"},400);
  const workflowKey=u.searchParams.get("workflowKey");
  if(!isAutomationStudioWorkflowKey(workflowKey))
   return reply({ok:false,error:"INVALID_WORKFLOW_KEY"},400);
  const native=cloneAutomationStudioDefinition(workflowKey);
  const simulated=simulateAutomationStudioDefinition(native);
  if(!simulated.ok)return reply({ok:false,error:"INVALID_NATIVE_DEFINITION"},503);
  const visited=simulated.visited.slice(0,50).map(n=>({
   kind:n.kind,authority:n.authority,label:n.label.slice(0,80),
  }));
  return reply({ok:true,schema:"qf.vox.studio.simulation.v1",
   owner:"quickfurno-core",source:"NATIVE_DEFAULT_DEFINITION",
   mode:"DRY_RUN_ONLY",workflowKey:simulated.workflowKey,
   visited,notes:simulated.notes.slice(0,20).map(n=>n.slice(0,180)),
   runtimeState:"NOT_QUERIED",providerSends:0,creditsChanged:0,
   published:false,canPublish:false,canExecute:false},200);
 }catch{return reply({ok:false,error:"SIMULATION_UNAVAILABLE"},503);}
}
export function POST(){return reply({ok:false,error:"CORE_STUDIO_APPROVAL_REQUIRED"},405);}
export function PATCH(){return reply({ok:false,error:"CORE_STUDIO_APPROVAL_REQUIRED"},405);}
export function DELETE(){return reply({ok:false,error:"CORE_STUDIO_APPROVAL_REQUIRED"},405);}
