"use client";
import {useRef,useState} from "react";
import {useRouter} from "next/navigation";
export default function SubmitPartial(){
 const router=useRouter();
 const nonce=useRef<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [state,setState]=useState("");
 async function submit(){
  if(busy)return;
  nonce.current??=crypto.randomUUID();
  setBusy(true);setState("");
  try{
   const res=await fetch("/api/eod-submissions",{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({nonce:nonce.current})
   });
   const data:unknown=await res.json();
   if(!res.ok||!data||typeof data!=="object"||
    !("ok" in data)||data.ok!==true||
    !("completeness" in data)||data.completeness!=="PARTIAL_UNVERIFIED_TOTAL"){
    setState("Core did not confirm the submission. The same nonce is retained for safe retry.");
    return;
   }
   nonce.current=null;
   setState("Core-only partial EOD recorded for independent Team Leader review. This is not a complete report.");
   router.refresh();
  }catch{setState("Unable to confirm Core status. Retry to avoid creating a second request.");}
  finally{setBusy(false);}
 }
 return <div className="voxFlowForm">
  <p className="voxFlowMuted">This submits only a bounded Core work-event snapshot.
   CRM, agents, chats and provider metrics are not certified. A different current
   Team Leader must independently review it.</p>
  <button className="voxFlowButton" type="button" onClick={submit} disabled={busy}>
   {busy?"Verifying current Core activity...":"Submit Core-only partial report"}
  </button>
  {state?<p role="status" className="voxFlowError">{state}</p>:null}
 </div>;
}
