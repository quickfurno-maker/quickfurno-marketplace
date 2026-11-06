"use client";
import {useRef,useState} from "react";
type Kind="AAROHI_FOLLOWUP"|"VENDOR_PROFILE_CHANGE"|"SUPPORT_REPLY";
type Reason="INTERNAL_FOLLOWUP"|"PROFILE_REVIEW"|"SUPPORT_REVIEW";
export function StaffProposalForm({kind,targets}:{kind:Kind;targets:readonly {id:string;title:string}[]}){
 const [targetId,setTargetId]=useState(targets[0]?.id??"");
 const [busy,setBusy]=useState(false),[status,setStatus]=useState("");
 // Retain nonce across retry, so response loss doesn't duplicate a request.
 const nonce=useRef<string|null>(null);
 const labels:Record<Kind,string>={
  AAROHI_FOLLOWUP:"Request internal Aarohi follow-up",
  VENDOR_PROFILE_CHANGE:"Request vendor profile review",
  SUPPORT_REPLY:"Request vendor support response review",
 };
 const reasons:Record<Kind,Reason>={
  AAROHI_FOLLOWUP:"INTERNAL_FOLLOWUP",
  VENDOR_PROFILE_CHANGE:"PROFILE_REVIEW",
  SUPPORT_REPLY:"SUPPORT_REVIEW",
 };
 async function submit(){
  if(busy||!targetId)return;
  setBusy(true);setStatus("");
  try{
   nonce.current??=crypto.randomUUID();
   const res=await fetch("/api/propose-action",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({actionKind:kind,targetId,reasonCode:reasons[kind],nonce:nonce.current}),
   });
   const ack=await res.json();
   if(!res.ok||ack?.ok!==true||ack.state!=="PENDING"||ack.execution!=="NOT_AUTHORIZED"){
    setStatus("Proposal not accepted or already pending. No action was performed.");
    return;
   }
   nonce.current=null;
   setStatus("Proposal recorded for independent owner review. No operation or message was executed.");
  }catch{setStatus("Review service unavailable. Check for an existing proposal before retrying.");}
  finally{setBusy(false);}
 }
 if(!targets.length)return null;
 return <section className="voxUnit" aria-label="Create governed Core proposal">
  <div className="voxUnitTop"><div><p>CORE / STAFF PROPOSAL / REVIEW REQUIRED</p>
   <h2>{labels[kind]}</h2></div></div>
  <div className="voxQueueControls">
   <label>Assigned Core record
    <select value={targetId} onChange={e=>{setTargetId(e.target.value);nonce.current=null;setStatus("");}}>
     {targets.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
    </select>
   </label>
   <button type="button" disabled={busy||!targetId} onClick={submit}>
    {busy?"Submitting…":"Request owner review"}</button>
   <p role="status">{status}</p>
  </div>
  <footer>Request only — no WhatsApp send, profile update, credit change or automatic execution</footer>
 </section>;
}
