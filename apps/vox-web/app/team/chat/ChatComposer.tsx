"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {readPendingTeamChat,savePendingTeamChat,clearPendingTeamChat}
 from "../../../lib/vo01PendingTeamChat.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Pending={nonce:string;body:string};
const store=()=>{try{return window.sessionStorage;}catch{return null;}};
export default function ChatComposer(){
 const router=useRouter();
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 const [ready,setReady]=useState(false);
 const [available,setAvailable]=useState(false);
 const [result,setResult]=useState("");
 const [expired,setExpired]=useState(false);
 const pending=useRef<Pending|null>(null);
 useEffect(()=>{
  const saved=readPendingTeamChat(store());
  setAvailable(saved.available);pending.current=saved.pending;
  if(!saved.available){
   setResult("Chat recovery storage is unavailable or corrupt. No message can be sent.");
  }else if(saved.pending){
   setMessage(saved.pending.body);
   setResult("Unresolved original message restored. Retry only its exact text and nonce after Core reconciliation; editing is locked.");
  }
  setReady(true);
 },[]);
 async function send(event:React.FormEvent){
  event.preventDefault();
  const body=message.trim();
  if(!body||body.length>500||busy||!ready||!available)return;
  if(pending.current&&pending.current.body!==body){
   setResult("Original message unresolved. A different message cannot replace its nonce.");
   return;
  }
  const item:Pending=pending.current??{nonce:crypto.randomUUID(),body};
  // Persist original body and nonce BEFORE any transport attempt.
  if(!savePendingTeamChat(store(),item)){
   setResult("Could not preserve the original message checkpoint. No Core request sent.");
   return;
  }
  pending.current=item;
  setBusy(true);setResult("");setExpired(false);
  try{
   const res=await fetch("/api/team-chat",{method:"POST",credentials:"same-origin",
    headers:{"content-type":"application/json"},cache:"no-store",
    body:JSON.stringify(item)});
   if(res.status===401){
    setExpired(true);setResult("Verified session expired. Original message is locked; sign in to reconcile.");
    return;
   }
   const data:unknown=await res.json();
   if(!res.ok||!data||typeof data!=="object"||Array.isArray(data)||
      !("ok" in data)||data.ok!==true||
      !("effect" in data)||data.effect!=="INTERNAL_TEAM_MESSAGE_ONLY"||
      !("messageId" in data)||typeof data.messageId!=="string"||
      !UUID.test(data.messageId)){
    setResult("Core message outcome unverified. Preserve the original nonce; reconcile before any new message.");
    return;
   }
   if(!clearPendingTeamChat(store(),item)){
    setResult("Core confirmed the message, but checkpoint cleanup failed. Reconcile before further messages.");
    return;
   }
   pending.current=null;setMessage("");
   setResult("Core confirmed internal team message. No external message sent.");
   router.refresh();
  }catch{
   setResult("Delivery outcome unknown. Preserve original message and nonce for reconciliation.");
  }finally{setBusy(false);}
 }
 const locked=Boolean(pending.current);
 return <form className="voxFlowForm" onSubmit={send}>
  <label htmlFor="voxTeamMessage">Internal team message</label>
  <textarea id="voxTeamMessage" value={message} maxLength={500} required
   disabled={!ready||!available||locked}
   onChange={e=>setMessage(e.target.value)}
   placeholder="Write a short internal team update. Never include credentials or OTPs."/>
  <div className="voxFlowActions"><button className="voxFlowButton" type="submit"
   disabled={busy||!ready||!available||!message.trim()}>
   {busy?"Verifying Core...":locked?"Reconcile original message":"Send to my team"}
  </button><small>{message.length}/500 characters</small></div>
  {result?<p className="voxFlowError" role="status">{result}</p>:null}
  {expired?<Link href="/login">Staff sign-in</Link>:null}
 </form>;
}
