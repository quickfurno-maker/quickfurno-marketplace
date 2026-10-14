"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
export type PendingRequest={requestId:string;targetId:string;kind:string;
 role:string|null;scopeKind:string|null;expiresAt:string|null;revision:0;state:"PENDING"};
export function ReviewConsole({pending}:{pending:readonly PendingRequest[]}){
 const router=useRouter();
 const [selected,setSelected]=useState<{id:string;decision:"APPROVE"|"REJECT"}|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [done,setDone]=useState("");
 async function confirm(){
  if(!selected||busy)return;
  setBusy(true);setError("");setDone("");
  try{
   const r=await fetch("/api/staff-reviews",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({requestId:selected.id,decision:selected.decision,expectedRevision:0})});
   if(!r.ok){setError(r.status===409?"Request was already reviewed or changed. Refresh and try again.":"Review not accepted; identity, team or Core availability may be invalid.");return;}
   const body=await r.json();
   if(body?.ok!==true){setError("Core acknowledgement was invalid.");return;}
   setDone("Review recorded. Owner activation is a separate, required step.");
   setSelected(null);router.refresh();
  }catch{setError("Could not reach the governed Core review service.");}
  finally{setBusy(false);}
 }
 return <section className="voxUnit"><div className="voxUnitTop"><div><p>STAFF PERMISSIONS / PENDING</p>
 <h2>Team review queue</h2></div><strong>{pending.length}<small> pending</small></strong></div>
 <div className="voxRows">{pending.length?pending.map(p=><div className="voxRow" key={p.requestId}>
  <div className="voxRowIcon">R</div><div className="voxRowBody">
   <b>{p.kind==="STAFF_MEMBERSHIP"?"Staff membership":"Exact record scope"} · {p.role??p.scopeKind??"Unknown scope"}</b>
   <small>Staff #{p.targetId.slice(0,8)} · Request #{p.requestId.slice(0,8)} · Expires: {p.expiresAt?.slice(0,10)??"Unknown"}</small>
  </div>
  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
   <button type="button" disabled={busy} onClick={()=>{setSelected({id:p.requestId,decision:"APPROVE"});setError("");}}>Review approve</button>
   <button type="button" disabled={busy} onClick={()=>{setSelected({id:p.requestId,decision:"REJECT"});setError("");}}>Review reject</button>
  </div>
 </div>):<div className="voxBlank">No assigned requests pending review.</div>}</div>
 {selected?<div style={{padding:18,borderTop:"1px solid #34564d"}} role="group" aria-label="Confirm review decision">
  <p><strong>Confirm {selected.decision==="APPROVE"?"approval":"rejection"}</strong> of request #{selected.id.slice(0,8)}?</p>
  <p>This is an auditable decision. It does not create a staff grant; the owner must independently finalize any approved request.</p>
  <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
   <button type="button" disabled={busy} onClick={confirm}>{busy?"Submitting…":"Confirm decision"}</button>
   <button type="button" disabled={busy} onClick={()=>setSelected(null)}>Cancel</button>
  </div></div>:null}
 {error?<p role="alert" style={{padding:16}}>{error}</p>:null}
 {done?<p role="status" style={{padding:16}}>{done}</p>:null}
 <footer>Core atomic review · Staging only · No self approval</footer></section>;
}
