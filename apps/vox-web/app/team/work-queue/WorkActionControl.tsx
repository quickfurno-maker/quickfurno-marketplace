"use client";
import {useRef,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";

const actions=["CLAIM","START","WAIT_EXTERNAL","REQUEST_APPROVAL","BLOCK","RESUME","COMPLETE"] as const;
type WorkAction=typeof actions[number];
type Props={itemId:string;revision:number;state:string;assignedToMe:boolean};
/** UI is merely a client to Core's existing atomic, capacity- and scope-
 * checked RPC. A hidden button or client-side role is never authorization.
 */
export default function WorkActionControl({itemId,revision,state,assignedToMe}:Props){
 const router=useRouter();
 const candidates=state==="NEW"&&!assignedToMe?["CLAIM"]:
  state==="ASSIGNED"&&assignedToMe?["START","BLOCK"]:
  state==="IN_PROGRESS"&&assignedToMe?["WAIT_EXTERNAL","REQUEST_APPROVAL","BLOCK","COMPLETE"]:
  ["WAITING_EXTERNAL","BLOCKED"].includes(state)&&assignedToMe?["RESUME"]:[];
 const options=candidates.filter((name):name is WorkAction=>actions.includes(name as WorkAction));
 const [action,setAction]=useState<WorkAction>((options[0]??"CLAIM") as WorkAction);
 const [reason,setReason]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [expired,setExpired]=useState(false);
 const pending=useRef<{nonce:string;command:string}|null>(null);
 if(options.length===0)return <span>Current state has no permitted work command</span>;
 const needsReason=["BLOCK","REQUEST_APPROVAL","COMPLETE"].includes(action);
 const trimmed=reason.trim();
 const valid=!busy&&(!needsReason||trimmed.length>=12)&&
  (action!=="CLAIM"||trimmed==="")&&trimmed.length<=300;
 async function submit(event:React.FormEvent){
  event.preventDefault();
  if(!valid)return;
  const payload={action,itemId,expectedRevision:revision,reason:trimmed};
  const fingerprint=JSON.stringify(payload);
  if(!pending.current||pending.current.command!==fingerprint)
   pending.current={nonce:crypto.randomUUID(),command:fingerprint};
  setBusy(true);setMessage("");setExpired(false);
  try{
   const result=await fetch("/api/work-transitions",{
    method:"POST",credentials:"same-origin",
    headers:{"content-type":"application/json"},cache:"no-store",
    body:JSON.stringify({...payload,nonce:pending.current.nonce})});
   if(result.status===401){setExpired(true);setMessage("Your verified session ended. Sign in again, then retry this command.");return;}
   const body:unknown=await result.json();
   if(!result.ok||!body||typeof body!=="object"||Array.isArray(body)||
      !("ok" in body)||body.ok!==true||
      !("workItemId" in body)||body.workItemId!==itemId||
      !("revision" in body)||body.revision!==revision+1||
      !("providerMessagesSent" in body)||body.providerMessagesSent!==0){
    setMessage(result.status===409?
     "The Core revision changed. Refresh the queue before another action.":
     "Core did not confirm the command. Retry the identical command, or ask your Team Leader.");
    return;
   }
   pending.current=null;setReason("");
   setMessage("Core recorded this internal work transition; no external message sent.");
   router.refresh();
  }catch{
   setMessage("Core receipt unavailable. Do not change the command before retrying.");
  }finally{setBusy(false);}
 }
 return <form className="voxWorkActionForm" onSubmit={submit}>
  <label htmlFor={"action-"+itemId}>Governed action</label>
  <select id={"action-"+itemId} value={action} disabled={busy}
   onChange={event=>{setAction(event.target.value as WorkAction);pending.current=null;setReason("");}}>
   {options.map(option=><option key={option} value={option}>{option.replaceAll("_"," ")}</option>)}
  </select>
  {action!=="CLAIM"?<>
   <label htmlFor={"reason-"+itemId}>Reason {needsReason?"(12–300 characters)":"(optional)"}</label>
   <textarea id={"reason-"+itemId} rows={2} maxLength={300} value={reason}
    disabled={busy} placeholder={needsReason?"Explain the business justification":"Optional internal reason"}
    onChange={e=>{setReason(e.target.value);pending.current=null;}}/>
  </>:null}
  <button type="submit" disabled={!valid}>{busy?"Core checking…":"Request Core transition"}</button>
  {message?<p role="status" className="voxQueueCaution">{message}</p>:null}
  {expired?<Link href="/login">Staff sign-in</Link>:null}
 </form>;
}
