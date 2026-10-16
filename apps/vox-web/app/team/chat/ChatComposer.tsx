"use client";
import {useRef,useState} from "react";
import {useRouter} from "next/navigation";
export default function ChatComposer(){
 const router=useRouter();
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 const [result,setResult]=useState("");
 const retryNonce=useRef<string|null>(null);
 async function send(event:React.FormEvent){
  event.preventDefault();
  const body=message.trim();
  if(!body||body.length>500||busy)return;
  if(!retryNonce.current)retryNonce.current=crypto.randomUUID();
  setBusy(true);setResult("");
  try{
   const res=await fetch("/api/team-chat",{method:"POST",credentials:"same-origin",
    headers:{"content-type":"application/json"},cache:"no-store",
    body:JSON.stringify({body,nonce:retryNonce.current})});
   const data:unknown=await res.json();
   if(!res.ok||!data||typeof data!=="object"||
      !("ok" in data)||data.ok!==true||
      !("effect" in data)||data.effect!=="INTERNAL_TEAM_MESSAGE_ONLY"){
    setResult("Message not accepted. Retry with the same text, or ask your team administrator.");
    return;
   }
   retryNonce.current=null;setMessage("");
   setResult("Internal team message recorded. No external message was sent.");
   router.refresh();
  }catch{setResult("Delivery could not be verified. Retry without changing the text.");}
  finally{setBusy(false);}
 }
 return <form className="voxFlowForm" onSubmit={send}>
  <label htmlFor="voxTeamMessage">Internal team message</label>
  <textarea id="voxTeamMessage" value={message} maxLength={500} required
   onChange={e=>{retryNonce.current=null;setMessage(e.target.value);}}
   placeholder="Write a short internal team update. Do not include OTPs or customer credentials."/>
  <div className="voxFlowActions"><button className="voxFlowButton" type="submit"
   disabled={busy||!message.trim()}>{busy?"Checking Core...":"Send to my team"}</button>
   <small>{message.length}/500 characters</small></div>
  {result?<p className="voxFlowError" role="status">{result}</p>:null}
 </form>;
}
