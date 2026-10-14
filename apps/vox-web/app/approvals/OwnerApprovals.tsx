"use client";
import {useRouter} from "next/navigation";
import {useState} from "react";
export type ApprovalRow={id:string;actionKind:string;targetKind:string;targetId:string;
 requesterId:string;teamId:string;cityId:string;revision:0;state:"PENDING"};
export function OwnerApprovals({rows}:{rows:readonly ApprovalRow[]}){
 const router=useRouter();const [pending,setPending]=useState<{id:string;decision:"APPROVED"|"REJECTED"}|null>(null);
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
 async function confirm(){
  if(!pending||busy)return;setBusy(true);setMessage("");
  try{
   const res=await fetch("/api/action-intents",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({id:pending.id,decision:pending.decision,expectedRevision:0})});
   const body=await res.json();
   if(!res.ok||body?.ok!==true||body?.execution!=="NOT_AUTHORIZED")
    {setMessage("Decision not accepted or request changed. Refresh and retry.");return;}
   setMessage("Review recorded. No operational action has been executed.");
   setPending(null);router.refresh();
  }catch{setMessage("Core review unavailable. No decision is confirmed.");}
  finally{setBusy(false);}
 }
 return <section className="voxUnit" aria-label="Core approval review queue">
 <div className="voxUnitTop"><div><p>OWNER / PENDING / ATOMIC AUDIT</p><h2>Operational proposals</h2></div>
 <strong>{rows.length}<small> pending</small></strong></div>
 <div className="voxRows">{rows.length?rows.map(row=><div key={row.id} className="voxRow">
  <div className="voxRowIcon">R</div><div className="voxRowBody">
   <b>{row.actionKind.replaceAll("_"," ")}</b>
   <small>Target {row.targetKind} #{row.targetId.slice(0,8)} · Staff #{row.requesterId.slice(0,8)} · Team #{row.teamId.slice(0,8)}</small>
  </div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
   <button type="button" disabled={busy} onClick={()=>setPending({id:row.id,decision:"APPROVED"})}>Review approve</button>
   <button type="button" disabled={busy} onClick={()=>setPending({id:row.id,decision:"REJECTED"})}>Review reject</button>
  </div>
 </div>):<div className="voxBlank">No pending proposals in the Core review queue.</div>}</div>
 {pending?<div style={{padding:18,borderTop:"1px solid #34564d"}} role="group" aria-label="Confirm reviewed decision">
  <p><strong>Confirm {pending.decision.toLowerCase()}</strong> for #{pending.id.slice(0,8)}?</p>
  <p>Review updates the Core audit ledger, but cannot send WhatsApp messages, change profiles, or execute any task.</p>
  <div style={{display:"flex",gap:12}}><button type="button" disabled={busy} onClick={confirm}>
  {busy?"Recording…":"Confirm review"}</button>
  <button type="button" disabled={busy} onClick={()=>setPending(null)}>Cancel</button></div></div>:null}
 {message?<p role="status" style={{padding:16}}>{message}</p>:null}
 <footer>Verified Owner AAL2 · Current Core scope rechecked · No execution</footer>
 </section>;
}
