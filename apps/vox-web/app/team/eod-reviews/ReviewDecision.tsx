"use client";
import {useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {readPendingTlReviews,savePendingTlReview,clearPendingTlReview} from "../../../lib/rc70PendingTlReview.mjs";
type Decision="ACKNOWLEDGED"|"REJECTED";
type Record={reportId:string;decision:Decision;nonce:string};
const store=()=>{try{return window.sessionStorage;}catch{return null;}};
export default function ReviewDecision({reportId}:{reportId:string}){
 const router=useRouter();
 const pending=useRef<Record|null>(null);
 const [ready,setReady]=useState(false);
 const [available,setAvailable]=useState(false);
 const [lockedDecision,setLockedDecision]=useState<Decision|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 useEffect(()=>{
  const prior=readPendingTlReviews(store());
  setAvailable(prior.available);
  const saved=prior.records.find((x:Record)=>x.reportId===reportId)??null;
  pending.current=saved;
  if(saved){
   setLockedDecision(saved.decision);
   setMessage("Unresolved "+saved.decision.toLowerCase()+" decision restored for this report. Only the ORIGINAL decision and nonce may be retried after checking Core.");
  }else if(!prior.available){
   setMessage("Review checkpoint is unavailable or corrupt. No decision may be sent.");
  }
  setReady(true);
 },[reportId]);
 async function decide(decision:Decision){
  if(busy||!ready||!available)return;
  if(pending.current&&pending.current.decision!==decision){
   setMessage("The original review decision is unresolved. A contrary decision cannot mint a new nonce.");
   return;
  }
  const record:Record=pending.current??{reportId,decision,nonce:crypto.randomUUID()};
  if(!savePendingTlReview(store(),record)){
   setMessage("Could not preserve the exact review decision before HTTP. No request was sent.");
   return;
  }
  pending.current=record;
  setLockedDecision(record.decision);
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/eod-reviews",{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(record)
   });
   const doc:unknown=await response.json();
   if(!response.ok||!doc||typeof doc!=="object"||Array.isArray(doc)||
    Object.keys(doc).sort().join("|")!=="ok|reportId|revision|state|status"||
    !("ok" in doc)||doc.ok!==true||
    !("status" in doc)||doc.status!==200||
    !("reportId" in doc)||doc.reportId!==reportId||
    !("state" in doc)||doc.state!==decision||
    !("revision" in doc)||doc.revision!==1){
    setMessage("Core review outcome is not verified. Keep the original "+decision.toLowerCase()+" nonce; reconcile before any different decision.");
    return;
   }
   if(!clearPendingTlReview(store(),record)){
    setMessage("Core receipt verified but local checkpoint cleanup failed. Reconcile before issuing another decision.");
    return;
   }
   pending.current=null;setLockedDecision(null);
   setMessage("Core confirmed independent "+decision.toLowerCase()+" decision. This is a partial EOD review, not official EOD publication.");
   router.refresh();
  }catch{setMessage("Core outcome unknown. Only retry the exact same decision and nonce after reconciliation.");}
  finally{setBusy(false);}
 }
 return <div>
  <div className="voxFlowActions">
   <button className="voxFlowButton" type="button"
    disabled={busy||!ready||!available||(lockedDecision!==null&&lockedDecision!=="ACKNOWLEDGED")}
    onClick={()=>decide("ACKNOWLEDGED")}>Acknowledge partial report</button>
   <button className="voxFlowButton" type="button"
    disabled={busy||!ready||!available||(lockedDecision!==null&&lockedDecision!=="REJECTED")}
    onClick={()=>decide("REJECTED")}>Reject partial report</button>
  </div>
  {message?<p role="status" className="voxFlowError">{message}</p>:null}
 </div>;
}
