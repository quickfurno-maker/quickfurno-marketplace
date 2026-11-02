"use client";
import {useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {indiaBusinessDate,readPendingEodSubmission,
 savePendingEodSubmission,clearPendingEodSubmission} from "../../../lib/rc70PendingEodSubmission.mjs";
type Pending={nonce:string;businessDate:string};
const store=()=>{try{return window.sessionStorage;}catch{return null;}};
export default function SubmitPartial(){
 const router=useRouter();
 const pending=useRef<Pending|null>(null);
 const [ready,setReady]=useState(false),[available,setAvailable]=useState(false);
 const [busy,setBusy]=useState(false),[state,setState]=useState("");
 useEffect(()=>{
  const previous=readPendingEodSubmission(store());
  setAvailable(previous.available);pending.current=previous.pending;
  if(!previous.available)setState("Partial EOD checkpoint unavailable or corrupt. Do not submit another report.");
  else if(previous.pending)setState(previous.pending.businessDate===indiaBusinessDate()
   ?"Original partial EOD nonce restored in this tab. Retry ONLY the same request after checking Core."
   :"A partial EOD from an earlier India business date remains unresolved. Reconcile that exact Core report; do not submit another date in this tab.");
  setReady(true);
 },[]);
 async function submit(){
  if(busy||!ready||!available)return;
  const businessDate=indiaBusinessDate();
  if(pending.current&&pending.current.businessDate!==businessDate){
   setState("An earlier date's partial EOD remains unresolved. Check Core; never reuse a nonce for a different business date.");
   return;
  }
  const item:Pending=pending.current??{nonce:crypto.randomUUID(),businessDate};
  // Persist BEFORE HTTP. Never mint a second nonce after an uncertain outcome.
  if(!savePendingEodSubmission(store(),item)){
   setState("Cannot preserve the original report nonce. No Core request sent.");
   return;
  }
  pending.current=item;setBusy(true);setState("");
  try{
   const res=await fetch("/api/eod-submissions",{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({nonce:item.nonce})
   });
   const data:unknown=await res.json();
   if(!res.ok||!data||typeof data!=="object"||Array.isArray(data)||
    Object.keys(data).sort().join("|")!=="completeness|eventCount|ok|reportId|revision|state|status"||
    !("ok" in data)||data.ok!==true||
    !("status" in data)||data.status!==200||
    !("completeness" in data)||data.completeness!=="PARTIAL_UNVERIFIED_TOTAL"||
    !("reportId" in data)||typeof data.reportId!=="string"||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.reportId)||
    !("state" in data)||!["PENDING_REVIEW","ACKNOWLEDGED","REJECTED"].includes(String(data.state))||
    !("revision" in data)||!(data.revision===0||data.revision===1)||
    (data.state==="PENDING_REVIEW"&&data.revision!==0)||
    (data.state!=="PENDING_REVIEW"&&data.revision!==1)||
    !("eventCount" in data)||typeof data.eventCount!=="number"||
    !Number.isSafeInteger(data.eventCount)||data.eventCount<0||data.eventCount>100){
    setState("Core receipt unverified. The original nonce remains locked for reconciliation.");
    return;
   }
   if(!clearPendingEodSubmission(store(),item)){
    setState("Verified Core receipt but could not clear local pending checkpoint. Reconcile the original submission.");
    return;
   }
   pending.current=null;
   setState("Core-only partial EOD recorded for independent Team Leader review. This is not official EOD.");
   router.refresh();
  }catch{setState("Core submission outcome unknown. Preserve the original nonce and verify Core before retrying.");}
  finally{setBusy(false);}
 }
 const crossDate=pending.current!==null&&pending.current.businessDate!==indiaBusinessDate();
 return <div className="voxFlowForm">
  <p className="voxFlowMuted">This submits only a bounded Core work-event snapshot.
   CRM, agents, chats and provider metrics are not certified. A different current
   Team Leader must independently review it.</p>
  <button className="voxFlowButton" type="button" onClick={submit}
   disabled={busy||!ready||!available||crossDate}>
   {busy?"Verifying current Core activity...":"Submit Core-only partial report"}
  </button>
  {state?<p role="status" className="voxFlowError">{state}</p>:null}
 </div>;
}
