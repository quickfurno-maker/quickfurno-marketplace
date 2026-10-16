import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=(v:unknown):v is string=>typeof v==="string"&&UUID.test(v);
const send=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"
}});
const enabled=()=>process.env.VOX_STAFF_GRANTS_ENABLED==="staging"&&
 process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED==="staging"&&
 process.env.VOX_STAFF_TEAM_CHAT_ENABLED==="staging";
const canChat=(s:Awaited<ReturnType<typeof getVerifiedScopedStaff>>)=>{
 return !!s&&s.canMutate===false&&s.canReadContent===true&&
 ["operations_manager","acquisition_agent","vendor_success_agent",
  "support_agent","team_leader"].includes(s.role);
};
/** Team-scoped private internal chat, NOT a Core conversation with customers,
 * vendor/provider delivery, WhatsApp, or agent human-handover. */
export async function GET(request:Request){
 if(!enabled())return send({ok:false,error:"STAFF_TEAM_CHAT_DISABLED"},503);
 if(new URL(request.url).search)return send({ok:false,error:"UNSUPPORTED_CHAT_FILTER"},400);
 try{
  const s=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!canChat(s))return send({ok:false,error:"CURRENT_STAFF_AAL2_REQUIRED"},403);
  const result=await adminClient().from("vox_staff_team_messages_candidate_v1")
   .select("id,team_id,city_id,sender_id,body,created_at")
   .eq("team_id",s!.teamId).eq("city_id",s!.cityId)
   .order("created_at",{ascending:false}).limit(26);
  if(result.error||!result.data||result.data.length>25)
   return send({ok:false,error:"CHAT_WINDOW_UNAVAILABLE"},503);
  const messages=[];
  const seen=new Set<string>();
  for(const row of result.data){
   if(!id(row.id)||seen.has(row.id)||row.team_id!==s!.teamId||
      row.city_id!==s!.cityId||!id(row.sender_id)||
      typeof row.body!=="string"||row.body.length<1||row.body.length>500||
      row.body!==row.body.trim()||/[\u0000-\u001f\u007f]/.test(row.body)||
      typeof row.created_at!=="string"||!Number.isFinite(Date.parse(row.created_at)))
    return send({ok:false,error:"CHAT_MESSAGE_PROOF_INVALID"},503);
   seen.add(row.id);
   messages.push({messageId:row.id,staffRef:"STAFF-"+row.sender_id.slice(0,8),
    isMine:row.sender_id===s!.userId,body:row.body,createdAt:row.created_at});
  }
  return send({ok:true,schema:"qf.vox.staff.team.chat.preview.v1",
   mode:"INTERNAL_ONLY",boundedWindow:true,totalKnown:false,
   externalMessagesSent:0,messages},200);
 }catch{return send({ok:false,error:"CHAT_CORE_UNAVAILABLE"},503);}
}
export async function POST(request:Request){
 if(!enabled())return send({ok:false,error:"STAFF_TEAM_CHAT_DISABLED"},503);
 if(!request.headers.get("content-type")?.startsWith("application/json"))
  return send({ok:false,error:"JSON_REQUIRED"},415);
 let body:Record<string,unknown>;
 try{
  const raw=await request.text();
  if(!raw||raw.length>1200)return send({ok:false,error:"CHAT_PAYLOAD_TOO_LARGE"},413);
  const parsed:unknown=JSON.parse(raw);
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))
   return send({ok:false,error:"INVALID_CHAT_PAYLOAD"},400);
  body=parsed as Record<string,unknown>;
 }catch{return send({ok:false,error:"INVALID_CHAT_JSON"},400);}
 if(Object.keys(body).sort().join("|")!=="body|nonce"||
   !id(body.nonce)||typeof body.body!=="string"||
   body.body.length<1||body.body.length>500||
   body.body!==body.body.trim()||/[\u0000-\u001f\u007f]/.test(body.body))
  return send({ok:false,error:"INVALID_INTERNAL_MESSAGE"},400);
 try{
  const s=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!canChat(s))return send({ok:false,error:"CURRENT_STAFF_AAL2_REQUIRED"},403);
  // The server binds actor and team. Browser-supplied recipient, vendor,
  // customer, sender or channel are not accepted and cannot trigger sends.
  const {data,error}=await adminClient().rpc("qf_vox_staff_team_chat_send_candidate_v1",{
   p_actor:s!.userId,p_team:s!.teamId,p_nonce:body.nonce,p_body:body.body
  });
  if(error||!Array.isArray(data)||data.length!==1)
   return send({ok:false,error:"CHAT_POST_DENIED_OR_STALE"},409);
  const raw:unknown=data[0];
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
   return send({ok:false,error:"CHAT_RECEIPT_INVALID"},503);
  const r=raw as Record<string,unknown>;
  if(!id(r.message_id)||typeof r.created_time!=="string"||
    !Number.isFinite(Date.parse(r.created_time)))
   return send({ok:false,error:"CHAT_RECEIPT_INVALID"},503);
  return send({ok:true,schema:"qf.vox.staff.team.chat.receipt.v1",
    messageId:r.message_id,createdAt:r.created_time,
    effect:"INTERNAL_TEAM_MESSAGE_ONLY",externalMessagesSent:0,
    agentConversationChanged:false,staffPrivilegesChanged:false},201);
 }catch{return send({ok:false,error:"CHAT_CORE_UNAVAILABLE"},503);}
}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
