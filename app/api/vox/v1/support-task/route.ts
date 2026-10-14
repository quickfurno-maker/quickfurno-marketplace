import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {adminClient} from "@/lib/supabase";
import {createVendorTask} from "@/services/vendorCrmService";
import {normalizeScopedSupportTask} from "@/contracts/vox/supportTaskInput.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";
const respond=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization","x-content-type-options":"nosniff"}});
export async function POST(request:Request){
 // Only an internal, idempotent native Vendor CRM task. Never send a reply,
 // provider event, vendor notification, wallet adjustment or close a case.
 if(process.env.VOX_SUPPORT_INTERNAL_TASKS_ENABLED!=="staging")
  return respond({ok:false,error:"SUPPORT_TASK_DISABLED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return respond({ok:false,error:"CONTENT_TYPE_DENIED"},415);
 try{
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope||!["support_agent","vendor_success_agent","operations_manager"].includes(scope.role))
   return respond({ok:false,error:"STAFF_SCOPE_DENIED"},403);
  const raw=await request.text();if(raw.length>320)return respond({ok:false,error:"BODY_TOO_LARGE"},413);
  const input:unknown=JSON.parse(raw);
  const task=normalizeScopedSupportTask(input,scope);
  if(!task)return respond({ok:false,error:"ASSIGNMENT_OR_TASK_DENIED"},400);
  const db=adminClient();
  // Recheck actual thread ownership before using the privileged native CRM writer.
  const caseRow=await db.from("vendor_support_threads").select("id,vendor_id,status")
   .eq("id",task.threadId).maybeSingle();
  if(caseRow.error||!caseRow.data)return respond({ok:false,error:"CASE_SCOPE_DENIED"},403);
  if(!["open","vendor_replied","admin_replied"].includes(caseRow.data.status))
   return respond({ok:false,error:"CASE_CLOSED_OR_UNKNOWN"},409);
  const vendorId=caseRow.data.vendor_id as string;
  const vendor=await db.from("vendors").select("id,service_zone_id").eq("id",vendorId).maybeSingle();
  if(vendor.error||!vendor.data?.service_zone_id)return respond({ok:false,error:"VENDOR_DENIED"},403);
  const zone=await db.from("marketplace_service_zones").select("city_id,is_active")
   .eq("id",vendor.data.service_zone_id).maybeSingle();
  if(zone.error||zone.data?.city_id!==scope.cityId||zone.data?.is_active!==true)
   return respond({ok:false,error:"CROSS_CITY_DENIED"},403);
  const result=await createVendorTask(vendorId,{
   task_type:task.task_type,title:task.title,priority:task.priority,
   due_at:task.due_at,idempotency_key:task.idempotency_key},scope.userId);
  return respond({ok:true,taskId:result.id,threadId:task.threadId,
   created:result.idempotent!==true,authority:"quickfurno-core-vendor-crm",
   effect:"INTERNAL_SUPPORT_TASK_ONLY",providerMessagesSent:0},201);
 }catch{return respond({ok:false,error:"SUPPORT_TASK_UNAVAILABLE"},503);}
}
export function GET(){return respond({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return respond({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return respond({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
