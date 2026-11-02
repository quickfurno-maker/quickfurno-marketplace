"use client";
import {useState} from "react";
type AssignedProspect={id:string;businessName:string};
export function AarohiFollowupProposal({prospects}:{prospects:readonly AssignedProspect[]}){
 const [targetId,setTargetId]=useState(prospects[0]?.id??"");
 const [rationale,setRationale]=useState("");
 const [nonce,setNonce]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [ack,setAck]=useState<string|null>(null);
 async function submit(){
  if(busy||!targetId||rationale.trim().length<12)return;
  const requestNonce=nonce??crypto.randomUUID();
  setNonce(requestNonce);setBusy(true);setMessage("");setAck(null);
  try{
   const result=await fetch("/api/followup-proposals",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({targetId,nonce:requestNonce,rationale:rationale.trim()})
   });
   const data=await result.json();
   if(!result.ok||data?.ok!==true||data?.state!=="PENDING"||data?.execution!=="NOT_AUTHORIZED"){
    setMessage("Core did not accept this proposal. Check assigned prospect, city and staff permissions.");
    return;
   }
   setAck(data.intentId);
   setMessage("Proposal pending owner approval. No task or message has been created.");
   setNonce(null);setRationale("");
  }catch{
   setMessage("Request outcome is unknown. Retrying keeps the same request ID to avoid duplicates.");
  }finally{setBusy(false);}
 }
 if(prospects.length===0)return null;
 return <section className="voxUnit" aria-label="Propose Aarohi internal follow-up">
  <div className="voxUnitTop"><div><p>AAROHI / GUARDED STAFF REQUEST</p>
   <h2>Request an internal follow-up</h2></div></div>
  <div className="voxQueueControls">
   <label>Assigned prospect
    <select value={targetId} onChange={e=>{setTargetId(e.target.value);setNonce(null);setAck(null);}}>
     {prospects.map(p=><option key={p.id} value={p.id}>{p.businessName}</option>)}
    </select>
   </label>
   <label>Reason for owner review
    <input value={rationale} maxLength={300}
     onChange={e=>{setRationale(e.target.value);setNonce(null);setAck(null);}}
     placeholder="Confirm pending vendor information internally"/>
   </label>
   <button type="button" disabled={busy||rationale.trim().length<12||!targetId}
     onClick={submit}>{busy?"Requesting…":"Submit for owner approval"}</button>
  </div>
  {message?<p role="status" style={{padding:"0 20px 12px"}}>{message}</p>:null}
  {ack?<p style={{padding:"0 20px 12px"}}>Proposal reference #{ack.slice(0,8)}</p>:null}
  <footer>Proposal only. Owner review and a separate approved Core execution are required. No WhatsApp or credit changes.</footer>
 </section>;
}
