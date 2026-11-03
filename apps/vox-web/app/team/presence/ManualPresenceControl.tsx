"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
type State="ONLINE"|"AWAY"|"BUSY"|"IN_MEETING"|"ON_BREAK";
const states:State[]=["ONLINE","AWAY","BUSY","IN_MEETING","ON_BREAK"];
export default function ManualPresenceControl(){
 const router=useRouter();
 const [state,setState]=useState<State>("ONLINE");
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState("");
 async function submit(){
  if(busy)return;
  setBusy(true);setNotice("");
  try{
   const res=await fetch("/api/team-presence",{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({state})
   });
   const raw:unknown=await res.json();
   if(!res.ok||!raw||typeof raw!=="object"||Array.isArray(raw)){
    setNotice("Core did not confirm the status. This voluntary signal may not have applied.");
    return;
   }
   const x=raw as Record<string,unknown>;
   if(Object.keys(x).sort().join("|")!==
    "attendanceVerified|moneyMinorUnits|observedAt|ok|providerMessagesSent|schema|source|staffRef|state"||
    x.ok!==true||x.schema!=="qf.vox.presence.signal.receipt.v1"||
    x.state!==state||typeof x.staffRef!=="string"||
    !/^STAFF-[0-9A-F]{8}$/.test(x.staffRef)||
    typeof x.observedAt!=="string"||!Number.isFinite(Date.parse(x.observedAt))||
    x.source!=="EPHEMERAL_ONLY"||x.attendanceVerified!==false||
    x.providerMessagesSent!==0||x.moneyMinorUnits!==0){
    setNotice("The Core status receipt is inconsistent. No confirmed change.");
    return;
   }
   setNotice("Core confirmed this voluntary status at "+x.observedAt+". It expires unless explicitly refreshed.");
   router.refresh();
  }catch{
   setNotice("Transport outcome unknown. You may retry the same status; no work hours were recorded.");
  }finally{setBusy(false);}
 }
 return <section className="voxFlowCard" aria-labelledby="presence-choice">
  <h2 id="presence-choice">Share a voluntary status</h2>
  <p className="voxFlowMuted">Only your chosen status is signaled to Core.
   No automatic heartbeats, GPS, keyboard monitoring, camera or inferred attendance.
   The observation becomes stale after 90 seconds unless you explicitly update it.</p>
  <div className="voxFlowForm">
   <label htmlFor="voxPresenceStatus">My ephemeral status</label>
   <select id="voxPresenceStatus" value={state} disabled={busy}
    onChange={e=>setState(e.target.value as State)}>
    {states.map(s=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}
   </select>
   <button className="voxFlowButton" type="button" onClick={submit}
    disabled={busy}>{busy?"Confirming with Core…":"Set my temporary status"}</button>
  </div>
  {notice?<p role="status" className="voxFlowMuted">{notice}</p>:null}
 </section>;
}
