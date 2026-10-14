"use client";
import {useState} from "react";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Item={id:string;title:string};
export function SupportFollowup({cases}: {cases:Item[]}){
 const options=cases.filter(x=>UUID.test(x.id)).slice(0,12);
 const [threadId,setThreadId]=useState(options[0]?.id??"");
 const [priority,setPriority]=useState("medium");
 const [dueAt,setDueAt]=useState("");
 const [nonce,setNonce]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("No vendor message will be sent.");
 async function submit(){
  if(busy||!options.some(x=>x.id===threadId)||!dueAt)return;
  setBusy(true);
  const requestNonce=nonce??crypto.randomUUID();
  setNonce(requestNonce);
  try{
   const response=await fetch("/api/support-task",{method:"POST",credentials:"same-origin",
    headers:{"content-type":"application/json"},cache:"no-store",
    body:JSON.stringify({threadId,nonce:requestNonce,priority,dueAt:new Date(dueAt).toISOString()})});
   const body:unknown=await response.json();
   if(!response.ok||!body||typeof body!=="object"||!("ok" in body)||body.ok!==true){
    setMessage("No task confirmation. Retry uses the same request ID.");return;
   }
   if(!("taskId" in body)||typeof body.taskId!=="string"||!UUID.test(body.taskId)){
    setMessage("Invalid Core acknowledgement. No task confirmation.");return;
   }
   setMessage("Core confirmed internal support task. No reply was sent.");
   setNonce(null);
  }catch{setMessage("Network outcome unknown. Retry safely with the same request ID.");}
  finally{setBusy(false);}
 }
 if(!options.length)return null;
 return <section className="voxNotice" aria-label="Create internal case follow-up">
  <b>Internal Service Desk follow-up</b>
  <p>Creates a Core CRM task only. No WhatsApp, vendor-facing message, case closure or financial change.</p>
  <label>Assigned case <select value={threadId} onChange={e=>{setThreadId(e.target.value);setNonce(null);}}>
   {options.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></label>
  <label>Priority <select value={priority} onChange={e=>{setPriority(e.target.value);setNonce(null);}}>
   <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
  </select></label>
  <label>Due date/time <input type="datetime-local" value={dueAt} onChange={e=>{setDueAt(e.target.value);setNonce(null);}}/></label>
  <button type="button" disabled={busy||!dueAt} onClick={submit}>{busy?"Submitting":"Create internal task"}</button>
  <p role="status">{message}</p>
 </section>;
}
