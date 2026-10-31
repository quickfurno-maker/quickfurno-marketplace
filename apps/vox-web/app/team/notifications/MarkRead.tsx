"use client";
import {useRef,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
/** A user receipt only. NOT a push-delivery or provider message receipt. */
export default function MarkRead({notificationId}:{notificationId:string}){
 const router=useRouter();
 const nonce=useRef<string|null>(null);
 const [pending,setPending]=useState(false);
 const [status,setStatus]=useState("");
 const [expired,setExpired]=useState(false);
 async function mark(){
  if(pending)return;
  nonce.current??=crypto.randomUUID();
  setPending(true);setStatus("");setExpired(false);
  try{
   const response=await fetch("/api/staff-notifications",{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({notificationId,nonce:nonce.current})
   });
   if(response.status===401){setExpired(true);setStatus("Your verified session ended. Sign in again to mark this as read.");return;}
   const result:unknown=await response.json();
   if(!response.ok||!result||typeof result!=="object"||
     !("ok" in result)||result.ok!==true||
     !("pushDeliveryNotClaimed" in result)||result.pushDeliveryNotClaimed!==true){
    setStatus("Core has not confirmed this read receipt. Retry without changing the request.");
    return;
   }
   nonce.current=null;setStatus("Core recorded the in-app read receipt.");
   router.refresh();
  }catch{setStatus("Could not verify Core receipt. Retry without changing the request.");}
  finally{setPending(false);}
 }
 return <div className="voxFlowActions">
  <button className="voxFlowButton" disabled={pending} type="button"
   onClick={mark}>{pending?"Checking Core...":"Mark as read"}</button>
  {status?<p role="status" className="voxFlowError">{status}</p>:null}
  {expired?<Link href="/login">Staff sign-in</Link>:null}
 </div>;
}
