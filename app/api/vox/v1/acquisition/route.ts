import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {readScopedAarohi} from "@/services/vox/crmScopedReads";
export const runtime="nodejs";export const dynamic="force-dynamic";
const json=(v:unknown,s:number)=>Response.json(v,{status:s,headers:{"cache-control":"private, no-store, max-age=0","vary":"Authorization"}});
export async function GET(request:Request){
 try{
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope||!["acquisition_agent","operations_manager","auditor"].includes(scope.role))return json({ok:false,error:"SCOPE_DENIED"},403);
  return json({ok:true,view:await readScopedAarohi(scope)},200);
 }catch{return json({ok:false,error:"CRM_UNAVAILABLE"},503)}
}
export function POST(){return json({ok:false,error:"CORE_APPROVAL_REQUIRED"},405)}
export function PATCH(){return json({ok:false,error:"CORE_APPROVAL_REQUIRED"},405)}
export function DELETE(){return json({ok:false,error:"CORE_APPROVAL_REQUIRED"},405)}
