"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {withReturn} from "../../../lib/returnTo.mjs";
import {loadPendingConversation,savePendingConversation,clearPendingConversation} from "../../../lib/pendingConversationRecovery";
type Action="PAUSE_AI"|"TAKEOVER";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default function ConversationControl(){
 const [conversationId,setConversationId]=useState("");
 const [revision,setRevision]=useState("");
 const [action,setAction]=useState<Action>("PAUSE_AI");
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [expired,setExpired]=useState(false);
 const [recoveryReady,setRecoveryReady]=useState(false);
 const pending=useRef<{command:string;nonce:string}|null>(null);
 // An HTTP failure may follow a committed SQL transaction; keep the same
 // pending nonce and freeze command edits until Core confirms its receipt.
 const [uncertain,setUncertain]=useState(false);
 const [choices,setChoices]=useState<Array<{id:string;revision:number;state:"OPEN"|"PAUSED";allowedActions:string[]}>>([]);
 const [choicesError,setChoicesError]=useState("");
 useEffect(()=>{
  const controller=new AbortController();
  (async()=>{
   try{
    const response=await fetch("/api/conversation-candidates",{credentials:"same-origin",
     cache:"no-store",signal:controller.signal});
    if(!response.ok){if(!controller.signal.aborted)setChoicesError("Assigned conversations unavailable; use a Core-authorized ID and revision.");return;}
    const data:unknown=await response.json();
    if(!data||typeof data!=="object"||Array.isArray(data))return;
    const result=data as Record<string,unknown>;
    if(result.ok===true&&result.mode==="READ_ONLY"&&result.actionsEnabled===false&&
       Array.isArray(result.conversations)&&result.conversations.length<=20)
      if(!controller.signal.aborted)setChoices(result.conversations.filter((r:unknown)=>
       !!r&&typeof r==="object"&&!Array.isArray(r)&&
       "id" in r&&typeof r.id==="string"&&UUID.test(r.id)&&
       "revision" in r&&Number.isSafeInteger(r.revision)&&
       "state" in r&&(r.state==="OPEN"||r.state==="PAUSED")) as typeof choices);
   }catch{if(!controller.signal.aborted)setChoicesError("Authorized conversation list unavailable.");}
  })();
  return ()=>controller.abort();
 },[]);
 // A page refresh must not silently manufacture a new nonce after an
 // uncertain Core transaction. Session-tab storage has no authority to grant.
 useEffect(()=>{
  const restored=loadPendingConversation(window.sessionStorage);
  if(restored){
   const {nonce,...cmd}=restored;
   pending.current={command:JSON.stringify(cmd),nonce};
   setConversationId(cmd.conversationId);
   setRevision(String(cmd.expectedRevision));
   setAction(cmd.action);
   setUncertain(true);
   setMessage("A previously submitted Core command is still pending confirmation. Its exact nonce was recovered from this tab. Verify with your Team Leader, then retry ONLY this unchanged command.");
  }
  setRecoveryReady(true);
 },[]);
 const valid=UUID.test(conversationId.trim())&&/^\d{1,10}$/.test(revision)&&
  Number.isSafeInteger(Number(revision))&&Number(revision)<=2147483646;
 const changed=()=>{if(uncertain)return;pending.current=null;setMessage("");setExpired(false);};
 async function submit(event:React.FormEvent){
  event.preventDefault();if(!recoveryReady||busy||!valid)return;
  const cmd={conversationId:conversationId.trim(),expectedRevision:Number(revision),action};
  const fingerprint=JSON.stringify(cmd);
  if(!pending.current||pending.current.command!==fingerprint)
   pending.current={command:fingerprint,nonce:crypto.randomUUID()};
  // Checkpoint BEFORE the HTTP call: even a refresh while SQL is running
  // must retain the same command and nonce for explicit reconciliation.
  if(!savePendingConversation(window.sessionStorage,{...cmd,nonce:pending.current.nonce})){
   setUncertain(true);
   setMessage("Cannot retain this command in the current tab. No Core request was sent. Enable session storage and reconcile before attempting another command.");
   return;
  }
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/conversation-control",{
    method:"POST",credentials:"same-origin",
    headers:{"content-type":"application/json"},cache:"no-store",
    body:JSON.stringify({...cmd,nonce:pending.current.nonce})});
   if(response.status===401){setExpired(true);setUncertain(true);
    setMessage("Verified Staff MFA expired. Keep this command and nonce locked while signing in; recheck its original Core outcome before another action.");return;}
   const v:unknown=await response.json();
   if(!response.ok&&v&&typeof v==="object"&&!Array.isArray(v)&&
      "error" in v&&v.error==="CORE_OUTCOME_UNKNOWN"){
    setUncertain(true);
    setMessage("Core SQL outcome is UNKNOWN. Do not change this command or nonce. Retry only the exact same request after reconciliation with your Team Leader.");
    return;
   }
   if(!response.ok||!v||typeof v!=="object"||Array.isArray(v)||
     !("ok" in v)||v.ok!==true||
     !("conversationId" in v)||v.conversationId!==cmd.conversationId||
     !("newRevision" in v)||v.newRevision!==cmd.expectedRevision+1||
     !("providerMessagesSent" in v)||v.providerMessagesSent!==0||
     !("nonce" in v)||v.nonce!==pending.current?.nonce||
     !("action" in v)||v.action!==cmd.action||
     !("state" in v)||v.state!==(cmd.action==="TAKEOVER"?"HUMAN":"PAUSED")||
     !("replayed" in v)||typeof v.replayed!=="boolean"||
     !("receiptSha256" in v)||typeof v.receiptSha256!=="string"||
     !/^[a-f0-9]{64}$/.test(v.receiptSha256)){
    // No authenticated canonical no-commit proof was returned. Lock the
    // command even for HTTP 409; never mint a new nonce from a rejected reply.
    setUncertain(true);
    setMessage(response.status===409?
     "Core reported a revision conflict. Keep this command and nonce locked until the original outcome is reconciled with your Team Leader.":
     "Core result could not be verified. Do not assume rollback. Keep the SAME nonce and reconcile with your Team Leader.");
    return;
   }
   if(!clearPendingConversation(window.sessionStorage)){
    setUncertain(true);
    setMessage("Core receipt verified, but local pending-command cleanup failed. Preserve the same nonce until this tab can be reconciled.");
    return;
   }
   pending.current=null;setUncertain(false);
   // An exact-nonce replay confirms an OLD receipt, not the CURRENT revision.
   // Only a fresh accepted atomic commit can advance this local revision hint.
   if(!v.replayed)setRevision(String(v.newRevision));
   setMessage(v.replayed?
    "Previously confirmed receipt "+v.receiptSha256.slice(0,16)+
    ". No new control action occurred. Verify the current Core revision before another command.":
    "Core confirmed "+v.state+" at revision "+v.newRevision+
    ". Receipt "+v.receiptSha256.slice(0,16)+
    ". Zero provider messages. Core will recheck revision for any future action.");
  }catch{setUncertain(true);
   setMessage("Core outcome UNKNOWN. Keep the exact same command and nonce; reconcile with your Team Leader before further actions.");}
  finally{setBusy(false);}
 }
 return <form className="voxWorkActionForm" onSubmit={submit}>
  <label htmlFor="convo-choice">My Core-authorized conversations (read-only selection)</label>
  <select id="convo-choice" disabled={busy||uncertain} value={choices.some(x=>x.id===conversationId)?conversationId:""}
   onChange={e=>{
    const selected=choices.find(x=>x.id===e.target.value);if(!selected)return;
    setConversationId(selected.id);setRevision(String(selected.revision));
    if(selected.state==="PAUSED")setAction("TAKEOVER");
    changed();
   }}>
   <option value="">Enter ID manually or choose an assigned conversation</option>
   {choices.map(x=><option key={x.id} value={x.id}>{x.id.slice(0,8)} · {x.state} · revision {x.revision}</option>)}
  </select>
  {choicesError?<p role="status">{choicesError}</p>:null}
  <p>Selection is only a current Core hint. Atomic authority rechecks Staff grants, consent and revision.</p>
  <label htmlFor="convo-id">Core-authorized conversation ID</label>
  <input id="convo-id" value={conversationId} maxLength={36}
   placeholder="Conversation UUID from your assigned Core record" disabled={busy||uncertain}
   onChange={e=>{setConversationId(e.target.value);changed();}} required/>
  <label htmlFor="convo-revision">Current Core revision</label>
  <input id="convo-revision" type="number" min="0" max="2147483646"
   value={revision} disabled={busy||uncertain}
   onChange={e=>{setRevision(e.target.value);changed();}} required/>
  <label htmlFor="convo-action">Governed action</label>
  <select id="convo-action" value={action} disabled={busy||uncertain}
   onChange={e=>{setAction(e.target.value as Action);changed();}}>
   <option value="PAUSE_AI">Pause AI</option>
   <option value="TAKEOVER">Human takeover</option>
  </select>
  <p>Only an assigned Operations Manager with a current object grant can commit.
   This form cannot grant itself access. No outbound message is generated.</p>
  <button type="submit" disabled={!recoveryReady||busy||!valid}>
   {busy?"Checking native Core…":"Submit atomic control"}</button>
  {uncertain?<p role="alert">A pending command is locked to its original nonce in this tab until a verified Core receipt is returned. Do not open a new tab or submit a new command for the same conversation until it is reconciled.</p>:null}
  {message?<p role="status">{message}</p>:null}
  {expired?<Link href={withReturn("/login","/team/conversation-control")}>Staff sign-in</Link>:null}
 </form>;
}
