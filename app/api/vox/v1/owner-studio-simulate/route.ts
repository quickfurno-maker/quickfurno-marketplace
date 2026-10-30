import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {cloneAutomationStudioDefinition,isAutomationStudioWorkflowKey,simulateAutomationStudioDefinition} from "@/lib/automation/studioContract";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(value:unknown,status:number)=>Response.json(value,{status,headers:{
 "cache-control":"private, no-store, max-age=0",
 "vary":"Authorization","x-content-type-options":"nosniff"
}});
/** Owner-only, bounded, pure simulation of native defaults. Never invokes workers or providers. */
export async function GET(request:Request){
 if(process.env.VOX_OWNER_STUDIO_SIMULATION_ENABLED!=="staging")
  return reply({ok:false,error:"OWNER_STUDIO_DISABLED"},503);
 try {
  const actor=await verifyVoxOwnerBearer(request.headers.get("authorization"));
  if(!actor)return reply({ok:false,error:"OWNER_AAL2_REQUIRED"},403);
  const params=new URL(request.url).searchParams;
  if([...params.keys()].some(k=>k!=="workflowKey")||params.getAll("workflowKey").length!==1)
   return reply({ok:false,error:"WORKFLOW_KEY_REQUIRED"},400);
  const key=params.get("workflowKey");
  if(!isAutomationStudioWorkflowKey(key))
   return reply({ok:false,error:"INVALID_WORKFLOW_KEY"},400);
  const definition=cloneAutomationStudioDefinition(key);
  const simulated=simulateAutomationStudioDefinition(definition);
  if(!simulated.ok)return reply({ok:false,error:"SIMULATION_UNAVAILABLE"},503);
  return reply({ok:true,schema:"qf.vox.studio.simulation.v1",
   owner:"quickfurno-core",source:"NATIVE_DEFAULT_DEFINITION",
   mode:"DRY_RUN_ONLY",workflowKey:key,
   visited:simulated.visited.slice(0,50).map(n=>({kind:n.kind,authority:n.authority,label:n.label.slice(0,80)})),
   notes:simulated.notes.slice(0,20).map(n=>n.slice(0,180)),
   runtimeState:"NOT_QUERIED",providerSends:0,creditsChanged:0,
   published:false,canPublish:false,canExecute:false},200);
 }catch{return reply({ok:false,error:"SIMULATION_UNAVAILABLE"},503);}
}
export function POST(){return reply({ok:false,error:"READ_ONLY"},405);}
export function PUT(){return reply({ok:false,error:"READ_ONLY"},405);}
export function PATCH(){return reply({ok:false,error:"READ_ONLY"},405);}
export function DELETE(){return reply({ok:false,error:"READ_ONLY"},405);}
