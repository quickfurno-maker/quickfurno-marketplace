import "server-only";
// RC42 real Data API orchestration of the UNINSTALLED RC41 native atomic RPC.
// Does not use direct-table mutation, pg.Pool, provider outbox or fallback.
// This source is hard OFF until a human-reviewed managed Staging installation.
export type Rc42Actor=Readonly<{userId:string;aal:"aal2";expiresAtMs:number;teamId:string;cityId:string}>;
type Command={conversationId:string;nonce:string;expectedRevision:number;action:"PAUSE_AI"|"TAKEOVER"};
type Deps={
 enabled:()=>boolean;installed:()=>boolean;now?:()=>number;rpcTimeoutMs?:number;recheckTimeoutMs?:number;
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
// After invoking a DB RPC, even an HTTP error cannot establish rollback.
// Reconcile the SAME idempotency nonce against the canonical database before retry.
const uncertain=(error:string,code:number)=>send({ok:false,error,committed:null,
 commitState:"unknown",retrySameNonceOnly:true,providerMessagesSent:0},code);
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
  let rpcTimer:ReturnType<typeof setTimeout>|undefined;
  try{
   const rpcCall=deps.rpc(FN,{
    p_actor:actor.userId,p_aal:"aal2",
    p_aal_expires_at:new Date(actor.expiresAtMs).toISOString(),
    p_conversation:value.conversationId,p_nonce:value.nonce,
    p_expected_revision:value.expectedRevision,p_action:value.action
   });
   // The native transaction may commit even if the HTTP response gets lost.
   // Bounded waiting returns an explicit UNKNOWN outcome, never a false
   // rollback claim or an automatic new-nonce retry.
   const configured=deps.rpcTimeoutMs;
   const timeoutMs=Number.isSafeInteger(configured)&&
    Number(configured)>=25&&Number(configured)<=5000?Number(configured):3500;
   const result=await Promise.race([
    rpcCall.then(value=>({timedOut:false as const,value})),
    new Promise<{timedOut:true}>(resolve=>{
     rpcTimer=setTimeout(()=>resolve({timedOut:true}),timeoutMs);
    })
   ]);
   if(result.timedOut)return uncertain("ATOMIC_RPC_OUTCOME_UNKNOWN",504);
   const {data,error}=result.value;
   if(error||!Array.isArray(data)||data.length!==1)return uncertain("ATOMIC_RPC_UNAVAILABLE",503);
   const row=data[0] as Record<string,unknown>;
   // Session authority must still be current when a network-delayed SQL
   // receipt arrives; never certify a late result using expired AAL2.
   if(actor.expiresAtMs<=(deps.now??Date.now)())
    return uncertain("STAFF_AAL2_EXPIRED_DURING_RPC",403);
   if(!row||typeof row!=="object"||row.nonce!==value.nonce||
      row.conversation_id!==value.conversationId||row.action!==value.action||
      row.previous_revision!==value.expectedRevision||
      row.new_revision!==value.expectedRevision+1||
      row.provider_messages_sent!==0||typeof row.replayed!=="boolean"||
      row.state!==(value.action==="TAKEOVER"?"HUMAN":"PAUSED")||
      typeof row.event_id!=="string"||!UUID.test(row.event_id)||
      row.consent_policy_version!=="qf-consent-v1"||
      !["transactional_no_consent_objection",
        "preference_transactional_no_objection",
        "preference_policy_version_mismatch_no_objection"].includes(String(row.consent_reason))||
      typeof row.receipt_sha256!=="string"||!/^[a-f0-9]{64}$/.test(row.receipt_sha256)||
      row.consent_scope!=="transactional")
    return uncertain("ATOMIC_RECEIPT_INVALID",503);
   // SQL may have committed while the request was in flight. Never claim
   // operator authority is still current unless live GoTrue + Staff scope
   // verifies again after the atomic receipt. This is NOT a rollback claim.
   let current:Rc42Actor|null;
   let verifyTimer:ReturnType<typeof setTimeout>|undefined;
   try{
    const configuredRecheck=deps.recheckTimeoutMs;
    // Bounded after-RPC verification is vital: the SQL may already have
    // committed, and a hanging GoTrue recheck cannot hold HTTP indefinitely.
    const recheckMs=Number.isSafeInteger(configuredRecheck)&&
     Number(configuredRecheck)>=25&&Number(configuredRecheck)<=2500?
      Number(configuredRecheck):1250;
    const rechecked=await Promise.race([
     deps.verify(b).then(value=>({timedOut:false as const,value})),
     new Promise<{timedOut:true}>(resolve=>{
      verifyTimer=setTimeout(()=>resolve({timedOut:true}),recheckMs);
     })
    ]);
    if(rechecked.timedOut)return uncertain("STAFF_AUTH_RECHECK_TIMEOUT",503);
    current=rechecked.value;
   }catch{return uncertain("STAFF_AUTH_RECHECK_UNAVAILABLE",503);}
   finally{if(verifyTimer!==undefined)clearTimeout(verifyTimer);}
   if(!current||current.aal!=="aal2"||current.userId!==actor.userId||
      current.teamId!==actor.teamId||current.cityId!==actor.cityId||
      !Number.isSafeInteger(current.expiresAtMs)||
      current.expiresAtMs<=(deps.now??Date.now)())
    return uncertain("STAFF_SCOPE_REVOKED_DURING_RPC",403);
   return send({ok:true,state:row.state,action:row.action,nonce:row.nonce,
    conversationId:row.conversation_id,previousRevision:row.previous_revision,
    newRevision:row.new_revision,replayed:row.replayed,receiptSha256:row.receipt_sha256,
    providerMessagesSent:0,mode:"ATOMIC_NO_PROVIDER_SEND"},200);
  }catch{return uncertain("ATOMIC_RPC_UNAVAILABLE",503);}
  finally{if(rpcTimer!==undefined)clearTimeout(rpcTimer);}
 };
}
