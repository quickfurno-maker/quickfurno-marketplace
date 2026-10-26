"use client";
import {useRef,useState} from "react";
import {useRouter} from "next/navigation";
export default function ReviewDecision({reportId}:{reportId:string}){
 const router=useRouter();
 const nonce=useRef<{decision:string;value:string}|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function decide(decision:"ACKNOWLEDGED"|"REJECTED"){
  if(busy)return;
  if(!nonce.current||nonce.current.decision!==decision){
   nonce.current={decision,value:crypto.randomUUID()};
  }
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/eod-reviews",{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({reportId,nonce:nonce.current.value,decision})
   });
   const doc:unknown=await response.json();
   if(!response.ok||!doc||typeof doc!=="object"||
    !("ok" in doc)||doc.ok!==true||
    !("state" in doc)||doc.state!==decision){
    setMessage("Core did not accept this review. Do not treat the report as approved.");
    return;
   }
   nonce.current=null;
   setMessage("Core recorded the independent "+decision.toLowerCase()+" decision.");
   router.refresh();
  }catch{setMessage("Could not verify the review result. Recheck Core before retrying.");}
  finally{setBusy(false);}
 }
 return <div>
  <div className="voxFlowActions">
   <button className="voxFlowButton" type="button" disabled={busy}
    onClick={()=>decide("ACKNOWLEDGED")}>Acknowledge partial report</button>
   <button className="voxFlowButton" type="button" disabled={busy}
    onClick={()=>decide("REJECTED")}>Reject partial report</button>
  </div>
  {message?<p role="status" className="voxFlowError">{message}</p>:null}
 </div>;
}
