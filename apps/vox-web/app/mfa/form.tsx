"use client";
import {useState} from "react";
import {safeReturnPath} from "../../lib/returnTo.mjs";

export function MfaForm({next=null}:{next?:string|null}){
 const [code,setCode]=useState("");
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 const complete=/^[0-9]{6}$/.test(code);
 return <form className="voxAuthForm voxMfaForm" onSubmit={async event=>{
  event.preventDefault();
  if(busy||!complete)return;
  setError("");
  setBusy(true);
  try{
   const response=await fetch("/api/auth/mfa",{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({code})
   });
   if(response.ok){
    window.location.assign(safeReturnPath(next)??"/operations");
    return;
   }
   // Never reveal whether the factor, account or session was rejected.
   setCode("");
   setError("We couldn't verify that code. Check your authenticator and try the current six-digit code.");
  }catch{
   setCode("");
   setError("Verification is temporarily unavailable. Please try again.");
  }finally{setBusy(false);}
 }}>
  <div className="voxAuthField voxMfaCodeField">
   <label htmlFor="vox-mfa-code">Authenticator code</label>
   <input id="vox-mfa-code" name="code" type="text"
    autoComplete="one-time-code" inputMode="numeric"
    pattern="[0-9]{6}" minLength={6} maxLength={6}
    value={code} onChange={e=>{setCode(e.target.value.replace(/\D/g,"").slice(0,6));if(error)setError("");}}
    placeholder="000000" aria-describedby="vox-mfa-hint"
    aria-invalid={Boolean(error)} required disabled={busy} autoFocus/>
   <p className="voxMfaHint" id="vox-mfa-hint">Six digits · Codes refresh automatically in your authenticator app</p>
  </div>
  {error?<p className="voxAuthError voxMfaError" role="alert">{error}</p>:null}
  <button className="voxAuthSubmit" disabled={busy||!complete} type="submit">
   <span>{busy?"Verifying securely…":"Verify and continue"}</span>
   <span className="voxAuthArrow" aria-hidden="true">→</span>
  </button>
 </form>;
}
