"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabaseBrowser";

type AAL = "aal1" | "aal2" | "unknown";

/**
 * Real Supabase TOTP enrollment/challenge for existing Core Superadmin.
 * Never stores MFA secret, TOTP code, recovery material or service role on
 * the server, in URL params, persistent storage, logs or Notion.
 */
export function OwnerMfaSetup({ expectedOwnerId }: { expectedOwnerId: string }) {
  const router = useRouter();
  const [factorId,setFactorId] = useState<string | null>(null);
  const [qrCode,setQrCode] = useState<string | null>(null);
  const [verifiedFactorId,setVerifiedFactorId] = useState<string | null>(null);
  const [aal,setAal] = useState<AAL>("unknown");
  const [code,setCode] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [authenticated,setAuthenticated] = useState(false);
  const [ready,setReady] = useState(false);

  useEffect(() => {
    let active=true;
    const sb=browserClient();
    (async()=>{
      const {data:identity,error:userError}=await sb.auth.getUser();
      if (!active) return;
      if(userError || identity.user?.id!==expectedOwnerId ||
         identity.user.app_metadata?.admin_role!=="Superadmin"){
        setError("Your authenticated Owner session could not be verified. Sign in again.");
        setReady(true);return;
      }
      const [factors,level]=await Promise.all([
        sb.auth.mfa.listFactors(),sb.auth.mfa.getAuthenticatorAssuranceLevel()
      ]);
      if(!active)return;
      if(factors.error||level.error){
        setError("Could not verify MFA status from Supabase Auth.");
        setReady(true);return;
      }
      setVerifiedFactorId(factors.data?.totp.find(x=>x.status==="verified")?.id??null);
      setAal(level.data?.currentLevel==="aal2"?"aal2":"aal1");
      setAuthenticated(true);setReady(true);
    })().catch(()=>{
      if(active){setError("Supabase Auth is unavailable.");setReady(true);}
    });
    return ()=>{active=false};
  },[expectedOwnerId]);

  async function enroll() {
    if(!authenticated||busy||verifiedFactorId||factorId)return;
    setBusy(true);setError(null);
    try{
      const sb=browserClient();
      const identity=await sb.auth.getUser();
      if(identity.error||identity.data.user?.id!==expectedOwnerId)
        throw new Error("CURRENT_OWNER_SESSION_MISMATCH");
      const enrollment=await sb.auth.mfa.enroll({
        factorType:"totp",friendlyName:"QuickFurno Owner MFA"
      });
      if(enrollment.error||!enrollment.data?.totp?.qr_code)
        throw new Error("SUPABASE_MFA_ENROLL_FAILED");
      setFactorId(enrollment.data.id);
      setQrCode(enrollment.data.totp.qr_code);
    }catch{
      setError("Enrollment could not start. Re-authenticate and check Auth MFA settings.");
    }finally{setBusy(false)}
  }

  async function verify() {
    if(busy||!authenticated||!/^[0-9]{6}$/.test(code))return;
    const target=factorId??verifiedFactorId;
    if(!target)return;
    setBusy(true);setError(null);
    try{
      const sb=browserClient();
      const identity=await sb.auth.getUser();
      if(identity.error||identity.data.user?.id!==expectedOwnerId)
        throw new Error("CURRENT_OWNER_SESSION_MISMATCH");
      const verified=await sb.auth.mfa.challengeAndVerify({factorId:target,code});
      if(verified.error)throw new Error("MFA_CODE_REJECTED");
      const [aalResult,factors]=await Promise.all([
        sb.auth.mfa.getAuthenticatorAssuranceLevel(),sb.auth.mfa.listFactors()
      ]);
      if(aalResult.error||aalResult.data?.currentLevel!=="aal2"||
         factors.error||!factors.data?.totp.some(x=>x.id===target&&x.status==="verified"))
        throw new Error("CURRENT_AAL2_NOT_VERIFIED");
      setAal("aal2");
      setVerifiedFactorId(target);
      setFactorId(null);setQrCode(null);
      setCode("");
      router.refresh();
    }catch{
      // Never echo the code or the factor secret, even in a server error.
      setCode("");
      setError("MFA verification failed. Check the authenticator code and retry.");
    }finally{setBusy(false)}
  }

  return <main className="mx-auto min-h-screen max-w-xl px-5 py-12 text-slate-900">
    <h1 className="text-2xl font-semibold">QuickFurno Owner MFA</h1>
    <p className="mt-3 text-sm text-slate-600">
      Use your existing Superadmin login to register or verify a TOTP factor.
      This does not create Staff accounts or authorize VOX Staging migrations.
    </p>
    {!ready ? <p role="status" className="mt-5">Checking current session…</p>
      : !authenticated ? <p role="alert" className="mt-5 text-red-700">{error}</p>
      : <section className="mt-6 space-y-4 rounded-xl border p-5">
        <p role="status">Current verified Auth level: <strong>{aal}</strong></p>
        {aal==="aal2" ? <p>MFA verified for your current Owner session.</p> :
          <>
            {!verifiedFactorId && !factorId &&
              <button type="button" disabled={busy} onClick={enroll}
                className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
                Start TOTP enrollment
              </button>}
            {factorId && qrCode &&
              <div className="space-y-2">
                <p>Scan this QR code with your authenticator app. Do not share the code.</p>
                {/* Generated by Supabase Auth for this user's active session only. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrCode} width={220} height={220} alt="Owner MFA authenticator QR code" />
              </div>}
            {(factorId||verifiedFactorId)&&
              <form onSubmit={e=>{e.preventDefault();void verify();}} className="space-y-3">
                <label className="block text-sm font-medium" htmlFor="owner-mfa-totp">
                  6-digit authenticator code
                </label>
                <input id="owner-mfa-totp" value={code}
                  onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))}
                  inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
                  required maxLength={6} className="block w-full rounded border p-2" />
                <button type="submit" disabled={busy||code.length!==6}
                  className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
                  Verify with Supabase Auth
                </button>
              </form>}
          </>}
        {error&&<p role="alert" className="text-red-700">{error}</p>}
        <p className="text-xs text-slate-500">
          Factor enrollment requires your real authenticator. No backup codes
          or MFA secrets are saved by QuickFurno. Complete Staff and Team Leader
          enrollment only through their own approved accounts.
        </p>
      </section>}
  </main>;
}
