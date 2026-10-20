import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {unchangedNotificationScope} from "@/contracts/vox/rc1CurrentStaffScope.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId=(v:unknown):v is string=>typeof v==="string"&&UUID.test(v);
const allowedKinds=new Set(["CLAIM","START","COMPLETE","BLOCK",
 "REQUEST_APPROVAL","WAIT_EXTERNAL","RESUME"]);
const send=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"
}});
const enabled=()=>process.env.VOX_STAFF_GRANTS_ENABLED==="staging"&&
 process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED==="staging"&&
 process.env.VOX_STAFF_WORK_NOTIFICATIONS_ENABLED==="staging";
const permitted=(s:Awaited<ReturnType<typeof getVerifiedScopedStaff>>)=>{
 return !!s&&s.canReadContent===true&&s.canMutate===false&&
 ["operations_manager","acquisition_agent","vendor_success_agent",
  "support_agent","team_leader"].includes(s.role);
};
/** An in-app work-event inbox receipt, never evidence of external push,
 * WhatsApp, SMS, email, customer or vendor delivery. No browser subjects. */
export async function GET(request:Request){
 if(!enabled())return send({ok:false,error:"STAFF_NOTIFICATIONS_DISABLED"},503);
 if(new URL(request.url).search)return send({ok:false,error:"FILTER_NOT_ALLOWED"},400);
 try{
  const staff=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!permitted(staff))return send({ok:false,error:"CURRENT_AAL2_STAFF_REQUIRED"},403);
  const {data,error}=await adminClient().rpc("qf_vox_staff_notification_inbox_v1",{
   p_actor:staff!.userId
  });
  if(error||!Array.isArray(data)||data.length>25)
   return send({ok:false,error:"INBOX_WINDOW_UNVERIFIED"},503);
  const seen=new Set<string>();
  const records:Array<{notificationId:string;eventKind:string;revision:number;
   createdAt:string;read:boolean}>=[];
  for(const item of data){
   if(!item||typeof item!=="object"||Array.isArray(item))
    return send({ok:false,error:"INBOX_PROOF_INVALID"},503);
   const n=item as Record<string,unknown>;
   if(!isId(n.notification_id)||seen.has(n.notification_id)||
      !allowedKinds.has(String(n.event_kind))||
      ![0,1].includes(n.revision as number)||
      typeof n.created_time!=="string"||
      !Number.isFinite(Date.parse(n.created_time)))
    return send({ok:false,error:"INBOX_PROOF_INVALID"},503);
   seen.add(n.notification_id);
   records.push({notificationId:n.notification_id,eventKind:String(n.event_kind),
    revision:n.revision as number,createdAt:n.created_time,
    read:n.revision===1});
  }
  const unreadInWindow=records.filter(x=>!x.read).length;
  const refreshed=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!permitted(refreshed)||!unchangedNotificationScope(staff,refreshed))
   return send({ok:false,error:"NOTIFICATION_SCOPE_REVOKED_DURING_READ"},403);
  return send({ok:true,schema:"qf.vox.staff.work-notifications.inbox.v1",
   mode:"READ_ONLY",origin:"CORE_PERSISTED_WORK_EVENTS",
   boundedWindow:true,totalKnown:false,unreadTotalKnown:false,
   pushDeliveriesVerified:0,providerMessagesSent:0,unreadInWindow,
   records},200);
 }catch{return send({ok:false,error:"INBOX_UNAVAILABLE"},503);}
}
export async function POST(request:Request){
 if(!enabled())return send({ok:false,error:"STAFF_NOTIFICATIONS_DISABLED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return send({ok:false,error:"JSON_REQUIRED"},415);
 let parsed:Record<string,unknown>;
 try{
  const raw=await request.text();
  if(!raw||raw.length>180)return send({ok:false,error:"BAD_PAYLOAD_SIZE"},413);
  const value:unknown=JSON.parse(raw);
  if(!value||typeof value!=="object"||Array.isArray(value))
   return send({ok:false,error:"INVALID_PAYLOAD"},400);
  parsed=value as Record<string,unknown>;
 }catch{return send({ok:false,error:"INVALID_JSON"},400);}
 if(Object.keys(parsed).sort().join("|")!=="expectedRevision|nonce|notificationId"||
   !isId(parsed.notificationId)||!isId(parsed.nonce)||
   parsed.expectedRevision!==0)
  return send({ok:false,error:"INVALID_READ_RECEIPT_COMMAND"},400);
 try{
  const staff=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!permitted(staff))return send({ok:false,error:"CURRENT_AAL2_STAFF_REQUIRED"},403);
  const {data,error}=await adminClient().rpc("qf_vox_staff_notification_mark_read_v1",{
   p_actor:staff!.userId,p_notification:parsed.notificationId,
   p_nonce:parsed.nonce,p_expected_revision:0
  });
  if(error||!Array.isArray(data)||data.length!==1)
   return send({ok:false,error:"READ_RECEIPT_DENIED_OR_STALE"},409);
  const n:unknown=data[0];
  if(!n||typeof n!=="object"||Array.isArray(n))
   return send({ok:false,error:"READ_RECEIPT_PROOF_INVALID"},503);
  const rec=n as Record<string,unknown>;
  if(rec.notification_id!==parsed.notificationId||rec.new_revision!==1||
   typeof rec.read_time!=="string"||!Number.isFinite(Date.parse(rec.read_time)))
   return send({ok:false,error:"READ_RECEIPT_PROOF_INVALID"},503);
  return send({ok:true,schema:"qf.vox.staff.work-notifications.read-receipt.v1",
   notificationId:rec.notification_id,revision:1,readAt:rec.read_time,
   providerMessagesSent:0,pushDeliveryNotClaimed:true,
   staffPrivilegesChanged:false},200);
 }catch{return send({ok:false,error:"READ_RECEIPT_UNAVAILABLE"},503);}
}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
