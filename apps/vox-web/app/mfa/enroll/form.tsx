"use client";
import {useState} from "react";
type Factor={factorId:string;qrCode:string;secret:string};
export function TotpEnroll(){
  const [factor,setFactor]=useState<Factor|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [showSecret,setShowSecret]=useState(false);

  async function start(){
    if(busy||factor)return;
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/auth/mfa/enroll",{
        method:"POST",headers:{"content-type":"application/json"},body:"{}"
      });
      if(!response.ok){
        setError("Authenticator enrollment isn't enabled for this account yet. Your Owner or staff identity must first be approved.");return;
      }
      const data:unknown=await response.json();
      if(!data||typeof data!=="object")throw new Error("invalid response");
      const entry=data as Record<string,unknown>;
      if(typeof entry.factorId!=="string"||typeof entry.secret!=="string"||
         typeof entry.qrCode!=="string"||!entry.qrCode.startsWith("data:image/svg+xml"))
        throw new Error("invalid response");
      setFactor({factorId:entry.factorId,qrCode:entry.qrCode,secret:entry.secret});
    }catch{
      setError("Unable to start authenticator setup. Please try again later.");
    }finally{setBusy(false);}
  }

  return <div className="voxMfaSetupStack">
    {!factor?<><div className="voxAuthFlowNote">
      <span className="voxAuthFlowNoteMark" aria-hidden="true">i</span>
      <span>Only approved, email-verified identities may enroll. This step never grants Owner or staff permissions.</span>
    </div>
    <button className="voxAuthSubmit" type="button" disabled={busy} onClick={start}>
      <span>{busy?"Checking eligibility…":"Start secure setup"}</span>
      <span className="voxAuthArrow" aria-hidden="true">→</span>
    </button></>:<>
      <p className="voxMfaGuide">1. Open your authenticator app and scan the private setup QR code.</p>
      <div className="voxMfaQrWrap">
        <img src={factor.qrCode} alt="Private one-time authenticator setup QR code"
          width={192} height={192}/>
        <button type="button" className="voxMfaSecondary"
          onClick={()=>setShowSecret(v=>!v)}>
          {showSecret?"Hide manual setup key":"Show manual setup key"}
        </button>
        {showSecret?<code className="voxMfaSecret">{factor.secret}</code>:null}
      </div>
      <p className="voxMfaGuide">2. Enter the latest six-digit code from your app to confirm enrollment.</p>
      <form className="voxAuthForm" onSubmit={async event=>{
        event.preventDefault();
        if(busy)return;
        const code=String(new FormData(event.currentTarget).get("code")??"");
        if(!/^[0-9]{6}$/.test(code)){
          setError("Enter a valid six-digit code.");return;
        }
        setBusy(true);setError("");
        try{
          const response=await fetch("/api/auth/mfa/confirm",{
            method:"POST",headers:{"content-type":"application/json"},
            body:JSON.stringify({factorId:factor.factorId,code})
          });
          if(response.ok){setFactor(null);setShowSecret(false);window.location.assign("/operations");}
          else setError("This code was not verified. Use a fresh authenticator code.");
        }catch{setError("Could not confirm your authenticator. Please try again.");}
        finally{setBusy(false);}
      }}>
        <div className="voxAuthField">
          <label htmlFor="vox-enroll-code">Six-digit authenticator code</label>
          <input id="vox-enroll-code" name="code" className="voxMfaInput"
            type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
            autoComplete="one-time-code" spellCheck={false}
            placeholder="••••••" disabled={busy} required/>
        </div>
        <button className="voxAuthSubmit" type="submit" disabled={busy}>
          <span>{busy?"Verifying…":"Activate authenticator"}</span>
          <span className="voxAuthArrow" aria-hidden="true">→</span>
        </button>
      </form>
      <p className="voxAuthFlowHint">Never share your QR code, manual setup key or verification codes.</p>
    </>}
    {error?<div className="voxAuthFlowMessage" data-error="true" role="alert">
      <strong>Setup not completed</strong>{error}
    </div>:null}
  </div>;
}
