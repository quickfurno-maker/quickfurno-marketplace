"use client";
import {useState} from "react";
type Factor={factorId:string;qrCode:string;secret:string};
export function TotpEnroll(){
 const [factor,setFactor]=useState<Factor|null>(null);
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 async function start(){
  setBusy(true);setError("");
  try{
   const r=await fetch("/api/auth/mfa/enroll",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
   if(!r.ok){setError("Enrollment unavailable. Confirm you are a verified owner and have no existing factor.");return;}
   const body=await r.json();
   if(typeof body.factorId!=="string"||typeof body.secret!=="string")throw new Error("invalid response");
   setFactor({factorId:body.factorId,qrCode:body.qrCode,secret:body.secret});
  }catch{setError("Could not start enrollment.");}finally{setBusy(false);}
 }
 return <div style={{display:"grid",gap:14,maxWidth:380,margin:"auto"}}>
  {!factor?<button type="button" onClick={start} disabled={busy}>{busy?"Preparing…":"Start TOTP enrollment"}</button>:<>
   <p style={{fontSize:12}}>Scan the QR code in your authenticator app or enter the one-time secret manually. Keep it private.</p>
   {factor.qrCode.startsWith("data:image/svg+xml")?<img src={factor.qrCode} alt="Temporary authenticator enrollment QR" width="190" height="190" style={{margin:"auto",background:"#fff",padding:8}}/>:null}
   <code style={{wordBreak:"break-all"}}>{factor.secret}</code>
   <form onSubmit={async e=>{
    e.preventDefault();setBusy(true);setError("");
    try{
     const code=String(new FormData(e.currentTarget).get("code")??"");
     const r=await fetch("/api/auth/mfa/confirm",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({factorId:factor.factorId,code})});
     if(r.ok){setFactor(null);window.location.assign("/operations");}
     else setError("Invalid or expired code. Retry from your authenticator.");
    }catch{setError("Could not verify code.");}finally{setBusy(false);}
   }} style={{display:"grid",gap:9}}>
    <input name="code" aria-label="Six-digit authenticator code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required/>
    <button disabled={busy} type="submit">{busy?"Verifying…":"Verify and activate MFA"}</button>
   </form>
  </>}
  {error?<p role="alert">{error}</p>:null}
 </div>;
}
