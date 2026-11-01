import "server-only";
// RC42 real Data API orchestration of the UNINSTALLED RC41 native atomic RPC.
// Does not use direct-table mutation, pg.Pool, provider outbox or fallback.
// This source is hard OFF until a human-reviewed managed Staging installation.
export type Rc42Actor=Readonly<{userId:string;aal:"aal2";expiresAtMs:number;teamId:string;cityId:string}>;
type Command={conversationId:string;nonce:string;expectedRevision:number;action:"PAUSE_AI"|"TAKEOVER"};
type Deps={
 enabled:()=>boolean;installed:()=>boolean;now?:()=>number;
 verify:(bearer:string|null)=>Promise<Rc42Actor|null>;
 rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>
};
const FN="qf_vox_rc41_core_conversation_operator_atomic_candidate_v1";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS="action|conversationId|expectedRevision|nonce";
const send=(payload:unknown,status:number)=>Response.json(payload,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization","x-content-type-options":"nosniff"}});
function valid(x:unknown):x is Command{
 if(!x||typeof x!=="object"||Array.isArray(x))return false;
 const o=x as Record<string,unknown>;
 return Object.keys(o).sort().join("|")===KEYS&&
  typeof o.conversationId==="string"&&UUID.test(o.conversationId)&&
  typeof o.nonce==="string"&&UUID.test(o.nonce)&&
  Number.isSafeInteger(o.expectedRevision)&&Number(o.expectedRevision)>=0&&
  Number(o.expectedRevision)<=2147483646&&
  (o.action==="PAUSE_AI"||o.action==="TAKEOVER");
}
const status=(error:string,code:number)=>send({ok:false,error,committed:false,providerMessagesSent:0},code);
export function createRc42AtomicConversationHandler(deps:Deps){
 return async function handle(request:Request):Promise<Response>{
  if(!deps.enabled()||!deps.installed())return status("CORE_CONVERSATION_ATOMIC_NOT_INSTALLED",503);
  if(request.method!=="POST")return status("METHOD_NOT_ALLOWED",405);
  if(request.headers.get("content-type")?.split(";")[0].trim()!=="application/json")
   return status("JSON_REQUIRED",415);
  const len=request.headers.get("content-length");
  if(len!==null&&(!/^\d+$/.test(len)||Number(len)>1024))return status("COMMAND_TOO_LARGE",413);
  let value:unknown;
  try{const raw=await request.text();if(Buffer.byteLength(raw,"utf8")>1024)
   return status("COMMAND_TOO_LARGE",413);value=JSON.parse(raw);}
  catch{return status("INVALID_JSON",400);}
  if(!valid(value))return status("INVALID_COMMAND",400);
  const b=request.headers.get("authorization");
  let actor:Rc42Actor|null;
  try{actor=await deps.verify(b);}catch{return status("STAFF_AUTH_UNAVAILABLE",503);}
  if(!actor||actor.aal!=="aal2"||!UUID.test(actor.userId)||!UUID.test(actor.teamId)||
     !UUID.test(actor.cityId)||!Number.isSafeInteger(actor.expiresAtMs)||
     actor.expiresAtMs<=(deps.now??Date.now)())return status("STAFF_AAL2_REQUIRED",403);
  try{
   const {data,error}=await deps.rpc(FN,{
    p_actor:actor.userId,p_aal:"aal2",
    p_aal_expires_at:new Date(actor.expiresAtMs).toISOString(),
    p_conversation:value.conversationId,p_nonce:value.nonce,
    p_expected_revision:value.expectedRevision,p_action:value.action
   });
   if(error||!Array.isArray(data)||data.length!==1)return status("ATOMIC_RPC_UNAVAILABLE",503);
   const row=data[0] as Record<string,unknown>;
   if(!row||typeof row!=="object"||row.nonce!==value.nonce||
      row.conversation_id!==value.conversationId||row.action!==value.action||
      row.previous_revision!==value.expectedRevision||
      row.new_revision!==value.expectedRevision+1||
      row.provider_messages_sent!==0||typeof row.replayed!=="boolean"||
      typeof row.receipt_sha256!=="string"||!/^[a-f0-9]{64}$/.test(row.receipt_sha256)||
      !["transactional"].includes(String(row.consent_scope)))
    return status("ATOMIC_RECEIPT_INVALID",503);
   return send({ok:true,state:row.state,action:row.action,nonce:row.nonce,
    conversationId:row.conversation_id,previousRevision:row.previous_revision,
    newRevision:row.new_revision,replayed:row.replayed,receiptSha256:row.receipt_sha256,
    providerMessagesSent:0,mode:"ATOMIC_NO_PROVIDER_SEND"},200);
  }catch{return status("ATOMIC_RPC_UNAVAILABLE",503);}
 };
}
