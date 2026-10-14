"use client";
import {useState} from "react";
export function TaskCreator({vendors}:{vendors:readonly {vendorId:string;businessName:string}[]}){
 const [vendorId,setVendorId]=useState(vendors[0]?.vendorId??"");
 const [title,setTitle]=useState("");
 const [dueAt,setDueAt]=useState("");
 const [taskType,setTaskType]=useState("general");
 const [priority,setPriority]=useState("medium");
 const [nonce,setNonce]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [feedback,setFeedback]=useState("");
 async function submit(){
  if(busy)return;
  setBusy(true);setFeedback("");
  try{
   // Preserve one idempotency nonce for an unchanged form after an ambiguous
   // network outcome. A new nonce is issued only when the draft changes or
   // Core confirms completion. No duplicates on timeout/retry.
   const requestNonce=nonce??crypto.randomUUID();
   setNonce(requestNonce);
   const r=await fetch("/api/vendor-task",{method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({vendorId,nonce:requestNonce,taskType,title,priority,
     dueAt:new Date(dueAt).toISOString()})});
   const body=await r.json();
   if(!r.ok||body?.ok!==true){setFeedback("Task was not accepted. Check your Core permissions and task details.");return;}
   setNonce(null);setTitle("");setDueAt("");setFeedback("Core confirmed internal Vendor CRM task. No provider message was sent.");
  }catch{setFeedback("Task outcome unknown. Retry this unchanged form to reuse the same request ID.");}
  finally{setBusy(false);}
 }
 if(!vendors.length)return null;
 return <section className="voxUnit" aria-label="Create assigned vendor follow-up"><div className="voxUnitTop">
  <div><p>INTERNAL CORE VENDOR CRM</p><h2>Create a follow-up task</h2></div></div>
  <div className="voxQueueControls">
   <label>Assigned vendor<select disabled={busy} value={vendorId} onChange={e=>{setVendorId(e.target.value);setNonce(null);}}>
    {vendors.map(v=><option key={v.vendorId} value={v.vendorId}>{v.businessName}</option>)}
   </select></label>
   <label>Task title<input disabled={busy} value={title} maxLength={120} onChange={e=>{setTitle(e.target.value);setNonce(null);}} placeholder="Call about site verification"/></label>
   <label>Category<select disabled={busy} value={taskType} onChange={e=>{setTaskType(e.target.value);setNonce(null);}}>
    <option value="general">General</option><option value="onboarding">Onboarding</option>
    <option value="documents">Documents</option><option value="verification">Verification</option>
    <option value="complaint">Complaint</option>
    <option value="campaign_response_followup">Campaign follow-up</option>
   </select></label>
   <label>Priority<select disabled={busy} value={priority} onChange={e=>{setPriority(e.target.value);setNonce(null);}}>
    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
   <label>Due date/time<input disabled={busy} type="datetime-local" value={dueAt} onChange={e=>{setDueAt(e.target.value);setNonce(null);}}/></label>
   <button type="button" disabled={busy||title.trim().length<8||!vendorId||!dueAt} onClick={submit}>
    {busy?"Submitting…":"Create internal task"}</button>
   <p role="status">{feedback}</p>
  </div><footer>Only internal, scoped Vendor CRM tasks · No wallet, KYC or WhatsApp actions</footer></section>;
}
