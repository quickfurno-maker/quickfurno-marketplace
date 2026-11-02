"use client";
import {useRouter} from "next/navigation";
import {useState} from "react";
export type FollowupRow={intentId:string;prospectId:string;requesterId:string;
 cityId:string;expiresAt:string|null;revision:1};
export function ApprovedFollowups({rows}:{rows:readonly FollowupRow[]}){
 const router=useRouter(),[selected,setSelected]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[status,setStatus]=useState("");
 async function execute(){
  if(!selected||busy)return;
  setBusy(true);setStatus("");
  try{
   const r=await fetch("/api/approved-followups",{method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({intentId:selected,expectedRevision:1})});
   const res=await r.json();
   if(!r.ok||res?.ok!==true||res.effect!=="INTERNAL_FOLLOW_UP_ONLY"){
    setStatus("Follow-up not created. Core approval, scope or expiry may have changed.");return;}
   setStatus("Native Aarohi internal follow-up task created. No message was sent.");
   setSelected(null);router.refresh();
  }catch{setStatus("Core execution was not confirmed. Do not retry without checking the task receipt.");}
  finally{setBusy(false);}
 }
 return <section className="voxUnit" aria-label="Approved internal follow-ups">
  <div className="voxUnitTop"><div><p>OWNER / EXACTLY ONCE / CORE AAROHI CRM</p>
   <h2>Approved follow-ups</h2></div><strong>{rows.length}<small> eligible</small></strong></div>
  <div className="voxRows">{rows.length?rows.map(row=><div key={row.intentId} className="voxRow">
   <div className="voxRowIcon">A</div><div className="voxRowBody">
   <b>Internal follow-up · Prospect #{row.prospectId.slice(0,8)}</b>
   <small>Reviewed intent #{row.intentId.slice(0,8)} · Assigned staff #{row.requesterId.slice(0,8)}</small>
   </div><button type="button" disabled={busy} onClick={()=>setSelected(row.intentId)}>
    Prepare task execution</button></div>):<div className="voxBlank">No approved internal follow-ups eligible for execution.</div>}</div>
   {selected?<div style={{padding:18,borderTop:"1px solid #34564d"}} role="group" aria-label="Confirm exactly-once task">
    <p><strong>Confirm internal task creation</strong> for approval #{selected.slice(0,8)}?</p>
    <p>Creates one staff-assigned task in the existing Aarohi CRM. This does not send WhatsApp, contact a prospect or change vendor finances.</p>
    <button disabled={busy} type="button" onClick={execute}>{busy?"Working…":"Confirm create task"}</button>
    <button disabled={busy} type="button" onClick={()=>setSelected(null)}>Cancel</button>
   </div>:null}
   {status?<p role="status" style={{padding:16}}>{status}</p>:null}
   <footer>Core owner AAL2 · current staff+prospect scope · idempotent native transaction</footer>
 </section>;
}
