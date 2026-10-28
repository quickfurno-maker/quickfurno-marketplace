"use client";
import {useState} from "react";
export function MfaForm() {
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  return <form className="voxAuthForm" onSubmit={async event=>{
    event.preventDefault();
    if(busy)return;
    const form=event.currentTarget;
    const code=String(new FormData(form).get("code")??"").trim();
    setError("");
    if(!/^[0-9]{6}$/.test(code)){
      setError("Enter a six-digit code from your authenticator.");return;
    }
    setBusy(true);
    try{
      const response=await fetch("/api/auth/mfa",{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code})
      });
      form.reset();
      if(response.ok)window.location.assign("/operations");
      else setError("Verification wasn't accepted. Use a fresh code from your enrolled authenticator. If this is your first time, complete enrollment.");
    }catch{
      setError("Authenticator verification is temporarily unavailable.");
    }finally{setBusy(false);}
  }}>
    <div className="voxAuthField">
      <label htmlFor="vox-mfa-code">Authenticator code</label>
      <input id="vox-mfa-code" name="code" className="voxMfaInput"
        type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
        autoComplete="one-time-code" spellCheck={false} autoCapitalize="none"
        aria-describedby="vox-mfa-help" placeholder="••••••" required disabled={busy}/>
      <p className="voxAuthFlowHint" id="vox-mfa-help">
        Enter all six digits. Codes refresh automatically in your authenticator app.
      </p>
    </div>
    {error?<div className="voxAuthFlowMessage" data-error="true" role="alert">
      <strong>Unable to verify</strong>{error}
    </div>:null}
    <button className="voxAuthSubmit" type="submit" disabled={busy}>
      <span>{busy?"Verifying securely…":"Verify and continue"}</span>
      <span className="voxAuthArrow" aria-hidden="true">→</span>
    </button>
  </form>;
}
