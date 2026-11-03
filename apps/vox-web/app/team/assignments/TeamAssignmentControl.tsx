"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {loadPendingTl,savePendingTl,clearPendingTl} from "../../../lib/vo05PendingTlAssignment.mjs";
import type {TlAssignmentIntent} from "../../../lib/vo05PendingTlAssignment.mjs";
type Item={itemId:string;revision:number;kind:string;state:"NEW"};
type Staff={staffId:string;ref:string};
const store=()=>{try{return window.sessionStorage;}catch{return null;}};
export default function TeamAssignmentControl({items,staff}:{
 items:Item[];staff:Staff[];
}){
 const router=useRouter();
 const [ready,setReady]=useState(false),[available,setAvailable]=useState(false);
 const [pending,setPending]=useState<TlAssignmentIntent|null>(null);
 const [itemId,setItemId]=useState(items[0]?.itemId??"");
 const [staffId,setStaffId]=useState(staff[0]?.staffId??"");
 const [reason,setReason]=useState("");
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 useEffect(()=>{
  const saved=loadPendingTl(store());
  setAvailable(saved.available);setPending(saved.pending);setReady(true);
  if(!saved.available)setNotice("Private recovery storage is unavailable. No assignments can be sent.");
  else if(saved.pending)setNotice("An original assignment command is unresolved. Retry that exact command only.");
 },[]);
 const selected=items.find(x=>x.itemId===itemId);
 const canSubmit=ready&&available&&!busy&&!!selected&&staff.some(x=>x.staffId===staffId)&&
  reason===reason.trim()&&reason.length<=200;
 async function submit(){
  if(!ready||!available||busy)return;
  let cmd:TlAssignmentIntent;
  if(pending)cmd=pending;
  else{
   if(!canSubmit||!selected)return;
   try{cmd={itemId:selected.itemId,targetStaffId:staffId,
    nonce:crypto.randomUUID(),expectedRevision:selected.revision,reason};}
   catch{setNotice("Unable to generate a unique nonce. Nothing was submitted.");return;}
  }
  if(!savePendingTl(store(),cmd)){
   setNotice("Original assignment command was not durably checkpointed. Nothing was submitted.");
   return;
  }
  setPending(cmd);setBusy(true);setNotice("Checking original assignment with Core.");
  try{
   const response=await fetch("/api/tl-assignments",{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"content-type":"application/json"},body:JSON.stringify(cmd)
   });
   if(response.status===401){
    setNotice("Staff MFA expired. Keep the original command and sign in again.");
    return;
   }
   const raw:unknown=await response.json();
   if(!response.ok||!clearPendingTl(store(),cmd,raw)){
    setNotice("Outcome unknown or denied. Keep this nonce and reconcile; no new assignment is allowed.");
    return;
   }
   setPending(null);
   setNotice("Core receipt verified. Refreshing current team items.");
   router.refresh();
  }catch{setNotice("Transport outcome unknown. Do not create a new nonce or reassign the work item.");}
  finally{setBusy(false);}
 }
 return <section className="voxTlCard" aria-labelledby="vox-tl-manage">
  <h2 id="vox-tl-manage">Assign an existing team task</h2>
  <p>Choose one Core task and a current team member. Core decides eligibility and grants;
   this screen cannot assign leads, modify credits or approve its own permissions.</p>
  {pending?<div className="voxTlPending" role="status">
   <strong>Original assignment is unresolved</strong>
   <p>Task {pending.itemId.slice(0,8)} · Staff {pending.targetStaffId.slice(0,8)} ·
    revision {pending.expectedRevision}. All other commands are locked.</p>
   <button type="button" disabled={!available||busy} onClick={submit}>
    {busy?"Checking Core…":"Retry exact original nonce"}</button>
  </div>:<div className="voxTlForm">
   <label htmlFor="vox-tl-work">Unassigned team task</label>
   <select id="vox-tl-work" value={itemId} onChange={e=>setItemId(e.target.value)}
    disabled={!ready||!available||busy}>
    {items.map(item=><option key={item.itemId} value={item.itemId}>
     {item.kind.replaceAll("_"," ")} · {item.itemId.slice(0,8)} · rev {item.revision}</option>)}
   </select>
   <label htmlFor="vox-tl-staff">Current team member</label>
   <select id="vox-tl-staff" value={staffId} onChange={e=>setStaffId(e.target.value)}
    disabled={!ready||!available||busy}>
    {staff.map(person=><option key={person.staffId} value={person.staffId}>{person.ref}</option>)}
   </select>
   <label htmlFor="vox-tl-reason">Internal assignment note (optional)</label>
   <textarea id="vox-tl-reason" value={reason} maxLength={200} rows={3}
    disabled={!ready||!available||busy}
    onChange={e=>setReason(e.target.value.replace(/[\u0000-\u001f\u007f]/g,""))}/>
   <button type="button" disabled={!canSubmit} onClick={submit}>
    {busy?"Checking Core…":"Request Core assignment"}</button>
  </div>}
  {items.length===0?<p role="status">No unassigned tasks in the current bounded team window.</p>:null}
  {staff.length===0?<p role="status">No verified Staff targets available in this window.</p>:null}
  {notice?<p className="voxTlNotice" role="status">{notice}</p>:null}
 </section>;
}
