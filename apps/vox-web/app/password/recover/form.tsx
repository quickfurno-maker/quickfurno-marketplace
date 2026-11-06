"use client";
import {useState} from "react";
export function RecoveryRequestForm(){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 return <form style={{display:"grid",gap:12,textAlign:"left"}} onSubmit={async e=>{
  e.preventDefault();setBusy(true);setNotice("");
  try{
   const data=new FormData(e.currentTarget);
   const r=await fetch("/api/auth/recovery/request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:data.get("email")})});
   setNotice(r.ok?"If the account is eligible, check your mailbox.":"Recovery is unavailable. Contact your administrator.");
  }catch{setNotice("Recovery is unavailable. Contact your administrator.");}
  finally{setBusy(false);}
 }}>
  <label>Work email<input name="email" type="email" autoComplete="email" maxLength={254} required/></label>
  <button type="submit" disabled={busy}>{busy?"Checking…":"Request recovery link"}</button>
  {notice?<p role="status">{notice}</p>:null}
 </form>;
}
