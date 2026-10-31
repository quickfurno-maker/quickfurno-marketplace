"use client";
import {useState} from "react";
import {safeReturnPath} from "../../lib/returnTo.mjs";
export function MfaForm({next=null}:{next?:string|null}){
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 return <form style={{display:"grid",gap:12}} onSubmit={async e=>{
  e.preventDefault();setError("");setBusy(true);
  const code=String(new FormData(e.currentTarget).get("code")||"");
  try{
   const r=await fetch("/api/auth/mfa",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code})});
   if(r.ok)window.location.assign(safeReturnPath(next)??"/operations");
   else setError("Verification denied. Confirm your authenticator is enrolled.");
  }catch{setError("Authenticator unavailable.");}finally{setBusy(false);}
 }}>
  <input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" aria-label="Six-digit authenticator code" required/>
  {error?<p role="alert">{error}</p>:null}<button type="submit" disabled={busy}>{busy?"Checking…":"Verify"}</button>
 </form>;
}
