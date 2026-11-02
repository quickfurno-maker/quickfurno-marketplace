"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {withReturn} from "../../../lib/returnTo.mjs";
import {readPendingWork,savePendingWork,clearPendingWork} from "../../../lib/rc66PendingWorkTransition";
import {isVerifiedWorkReceipt} from "../../../lib/rc69VerifiedWorkReceipt";

const actions=["CLAIM","START","WAIT_EXTERNAL","REQUEST_APPROVAL","BLOCK","RESUME","COMPLETE"] as const;
type WorkAction=typeof actions[number];
type Props={itemId:string;revision:number;state:string;assignedToMe:boolean};
const tabStore=()=>{try{return window.sessionStorage;}catch{return null;}};
/** UI is merely a client to Core's existing atomic, capacity- and scope-
 * checked RPC. A hidden button or client-side role is never authorization.
 */
export default function WorkActionControl({itemId,revision,state,assignedToMe}:Props){
 const router=useRouter();
 const candidates=state==="NEW"&&!assignedToMe?["CLAIM"]:
  state==="ASSIGNED"&&assignedToMe?["START","BLOCK"]:
  state==="IN_PROGRESS"&&assignedToMe?["WAIT_EXTERNAL","REQUEST_APPROVAL","BLOCK","COMPLETE"]:
  ["WAITING_EXTERNAL","BLOCKED"].includes(state)&&assignedToMe?["RESUME"]:[];
 const options=candidates.filter((name):name is WorkAction=>actions.includes(name as WorkAction));
 const [action,setAction]=useState<WorkAction>((options[0]??"CLAIM") as WorkAction);
 const [reason,setReason]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [expired,setExpired]=useState(false);
 const [uncertain,setUncertain]=useState(false);
 const [recoveryReady,setRecoveryReady]=useState(false);
 const [storageAvailable,setStorageAvailable]=useState(false);
 const pending=useRef<{nonce:string;command:string}|null>(null);
 useEffect(()=>{
  const saved=readPendingWork(tabStore());
  setStorageAvailable(saved.available);
  const old=saved.records.find(x=>x.itemId===itemId);
  if(old){
   const {nonce,...payload}=old;
   pending.current={nonce,command:JSON.stringify(payload)};
   setAction(old.action);setReason(old.reason);
   setUncertain(true);
   setMessage(old.expectedRevision===revision?
    "Pending work command restored in this tab. Reconcile it with Core using the SAME nonce; do not change its fields.":
    "A pending work command exists for an earlier revision. Do not submit a new command until a Team Leader reconciles the original receipt.");
  }
  setRecoveryReady(true);
 },[itemId,revision]);
 // A Core transition may already be committed while its HTTP receipt was
 // lost. A completed/terminal item has no actionable options, but the original
 // nonce MUST remain visible for human reconciliation after a page refresh.
 if(options.length===0)return <div className="voxQueueCaution" role="status">
  <p>Current Core state has no permitted work command.</p>
  {!storageAvailable&&recoveryReady?<p>Pending command storage unavailable. Do not issue another transition.</p>:null}
  {message?<p>{message}</p>:null}
  {uncertain?<p>The original same-tab nonce remains locked; a Team Leader must reconcile its Core receipt. No new command was sent.</p>:null}
  {expired?<Link href={withReturn("/login","/team/work-queue")}>Staff sign-in</Link>:null}
 </div>;
 const needsReason=["BLOCK","REQUEST_APPROVAL","COMPLETE"].includes(action);
 const trimmed=reason.trim();
 const valid=recoveryReady&&storageAvailable&&!busy&&options.includes(action)&&(!needsReason||trimmed.length>=12)&&
  (action!=="CLAIM"||trimmed==="")&&trimmed.length<=300;
 async function submit(event:React.FormEvent){
  event.preventDefault();
  if(!valid)return;
  const payload={action,itemId,expectedRevision:revision,reason:trimmed};
  const fingerprint=JSON.stringify(payload);
  if(pending.current&&pending.current.command!==fingerprint){
   setUncertain(true);setMessage("Original work command is unresolved; changing it would mint an unsafe new nonce.");
   return;
  }
  if(!pending.current)pending.current={nonce:crypto.randomUUID(),command:fingerprint};
  // Persist BEFORE Core HTTP. A refresh, MFA expiry or lost receipt must not
  // make this tab silently issue a conflicting work transition.
  if(!savePendingWork(tabStore(),{...payload,nonce:pending.current.nonce})){
   setUncertain(true);
   setMessage("Pending work checkpoint unavailable or conflicted. No Core request was sent.");
   return;
  }
  setBusy(true);setMessage("");setExpired(false);
  try{
   const result=await fetch("/api/work-transitions",{
    method:"POST",credentials:"same-origin",
    headers:{"content-type":"application/json"},cache:"no-store",
    body:JSON.stringify({...payload,nonce:pending.current.nonce})});
   if(result.status===401){
    setExpired(true);setUncertain(true);
    setMessage("Verified Staff session ended. The original work command is locked; sign in then reconcile the SAME nonce.");
    return;
   }
   const body:unknown=await result.json();
   if(!result.ok||!isVerifiedWorkReceipt(body,{action,itemId,expectedRevision:revision})){
    setUncertain(true);
    setMessage(result.status===409?
     "Core revision changed or its receipt was lost. Do not create a new nonce; reconcile the original command with your Team Leader.":
     "Core did not confirm the work transition. Keep this command and nonce unchanged until reconciliation.");
    return;
   }
   if(!clearPendingWork(tabStore(),itemId,pending.current.nonce)){
    setUncertain(true);
    setMessage("Core receipt verified but pending checkpoint cleanup failed. Do not make another decision until reconciled.");
    return;
   }
   pending.current=null;setUncertain(false);setReason("");
   setMessage("Core recorded this internal work transition; no external message sent.");
   router.refresh();
  }catch{
   setUncertain(true);
   setMessage("Core outcome unknown. Do not change the work command or nonce before reconciliation.");
  }finally{setBusy(false);}
 }
 return <form className="voxWorkActionForm" onSubmit={submit}>
  <label htmlFor={"action-"+itemId}>Governed action</label>
  <select id={"action-"+itemId} value={action} disabled={busy||uncertain||!recoveryReady}
   onChange={event=>{if(!uncertain){setAction(event.target.value as WorkAction);setReason("");}}}>
   {options.map(option=><option key={option} value={option}>{option.replaceAll("_"," ")}</option>)}
  </select>
  {!options.includes(action)?<p role="status" className="voxQueueCaution">The originally selected action is no longer permitted by the current Core state. Refresh and reconcile the original nonce; no new action is authorized.</p>:null}
  {action!=="CLAIM"?<>
   <label htmlFor={"reason-"+itemId}>Reason {needsReason?"(12–300 characters)":"(optional)"}</label>
   <textarea id={"reason-"+itemId} rows={2} maxLength={300} value={reason}
    disabled={busy||uncertain||!recoveryReady} placeholder={needsReason?"Explain the business justification":"Optional internal reason"}
    onChange={e=>{if(!uncertain)setReason(e.target.value);}}/>
  </>:null}
  <button type="submit" disabled={!valid}>{busy?"Core checking…":"Request Core transition"}</button>
  {message?<p role="status" className="voxQueueCaution">{message}</p>:null}
  {expired?<Link href={withReturn("/login","/team/work-queue")}>Staff sign-in</Link>:null}
 </form>;
}
