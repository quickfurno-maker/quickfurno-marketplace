"use client";

import { useCallback, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Reusable VOX Owner panel; can be mounted by the Owner web shell without
 * duplicating Core verification state or using admin-cookie authorization.
 * Every request receives a verified Supabase Auth AAL2 bearer; a missing,
 * expired, lower-AAL, or non-Superadmin session fails at the API boundary.
 * Never keeps bearer in component state, storage, analytics or URLs.
 */
type ReviewSnapshot={
  ok:boolean;code?:string;vendorId?:string;casePresent?:boolean;
  caseVersion?:number|null;caseState?:string|null;
  contactStatus?:string|null;identityStatus?:string|null;
  officeStatus?:string|null;categoryStatus?:string|null;
  zoneStatus?:string|null;consentValid?:boolean;
  identityEvidenceVerified?:boolean;officeEvidenceVerified?:boolean;
  readyForCoreApproval?:boolean;requiresSeparateCoreVendorApproval?:boolean;
};
type ReviewAction="request_documents"|"request_correction"|"approve"|"reject";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASON=/^[a-z][a-z0-9_]{2,63}$/;
const OPTIONS:{action:ReviewAction;label:string}[]=[
 {action:"request_documents",label:"Request documents"},
 {action:"request_correction",label:"Request corrections"},
 {action:"approve",label:"Approve evidence case"},
 {action:"reject",label:"Reject evidence case"},
];
const NO_CACHE={cache:"no-store" as const};
async function ownerBearer():Promise<string|null>{
 try{
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key)return null;
  const supabase=createBrowserClient(url,key);
  const {data,error}=await supabase.auth.getSession();
  return error?null:data.session?.access_token??null;
 }catch{return null;}
}
export function OwnerVendorVerificationDashboard(){
 const [vendorId,setVendorId]=useState("");
 const [caseData,setCaseData]=useState<ReviewSnapshot|null>(null);
 const [action,setAction]=useState<ReviewAction>("request_documents");
 const [reason,setReason]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");

 const load=useCallback(async (id:string)=>{
  setCaseData(null);setMessage("");
  if(!UUID.test(id)){setMessage("Enter a valid vendor ID.");return;}
  setBusy(true);
  try{
   const bearer=await ownerBearer();
   if(!bearer){setMessage("Sign in with your VOX Owner Supabase session and complete MFA.");return;}
   const result=await fetch(
    `/api/vox/v1/owner-vendor-verification-case?vendorId=${encodeURIComponent(id)}`,{
     ...NO_CACHE,headers:{Authorization:`Bearer ${bearer}`},
   });
   const data:ReviewSnapshot=await result.json();
   if(!result.ok||data.ok!==true){
    setMessage(result.status===503
      ?"Owner case review is disabled until approved Staging."
      :result.status===403
      ?"Owner MFA/AAL2 session required. No case details were disclosed."
      :"Verification status could not be loaded.");
    return;
   }
   setCaseData(data);
  }catch{setMessage("Verification status is unavailable.");}
  finally{setBusy(false);}
 },[]);

 async function submit(){
  if(!caseData?.casePresent||!Number.isInteger(caseData.caseVersion)||
     (caseData.caseVersion??0)<1 || !REASON.test(reason)){
   setMessage("Load an existing case and enter a reason code (lowercase with underscores).");
   return;
  }
  setBusy(true);setMessage("");
  try{
   const bearer=await ownerBearer();
   if(!bearer){setMessage("Owner MFA/AAL2 session required.");return;}
   const result=await fetch("/api/vox/v1/owner-vendor-verification-case",{
    method:"POST",cache:"no-store",
    headers:{"content-type":"application/json",Authorization:`Bearer ${bearer}`},
    body:JSON.stringify({vendorId:caseData.vendorId,
      caseVersion:caseData.caseVersion,action,reasonCode:reason}),
   });
   if(!result.ok){
    setMessage(result.status===409
      ?"Decision refused: evidence, case version, or review state is no longer valid. Reload the latest case."
      :"Owner decision was not recorded. Check MFA and Staging readiness.");
    return;
   }
   setMessage("Private case decision recorded. Vendor business approval and lead activation remain separate.");
   setReason("");
   await load(vendorId);
  }catch{setMessage("Review write unavailable; confirm status before retrying.");}
  finally{setBusy(false);}
 }
 return (
  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="VOX Owner vendor verification">
   <div className="mb-4">
    <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">QuickFurno Core · Owner AAL2</p>
    <h2 className="text-xl font-bold text-slate-900">Vendor verification review</h2>
    <p className="text-sm text-slate-600">Read a private case summary and record an audited Owner decision. No private documents, identity numbers, credits, or lead actions are exposed here.</p>
   </div>
   <form className="mb-4 flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();void load(vendorId);}}>
    <label className="flex-1 text-sm font-semibold text-slate-700">
     Vendor ID
     <input className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-mono text-sm" value={vendorId}
      placeholder="UUID" onChange={event=>{setVendorId(event.target.value.trim());setCaseData(null);}}
      autoComplete="off" aria-label="Vendor UUID" />
    </label>
    <button type="submit" disabled={busy} className="self-end rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-50">
      {busy?"Checking…":"Load case"}
    </button>
   </form>
   {message?<p role="status" className="mb-3 rounded-lg bg-slate-100 p-3 text-sm">{message}</p>:null}
   {caseData ? (
    <div className="space-y-4">
     {caseData.casePresent===false ? (
      <p className="rounded-lg border p-3 text-sm">No private verification case exists yet. Vendor document intake must create one before review.</p>
     ):(
      <>
       <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-3">
        {([
         ["Case version",String(caseData.caseVersion??"—")],
         ["Case state",caseData.caseState??"—"],
         ["Contact",caseData.contactStatus??"—"],
         ["Identity",caseData.identityStatus??"—"],
         ["Office",caseData.officeStatus??"—"],
         ["Categories",caseData.categoryStatus??"—"],
         ["Service zones",caseData.zoneStatus??"—"],
         ["Consent",caseData.consentValid?"Valid":"Required"],
         ["Identity evidence",caseData.identityEvidenceVerified?"Verified":"Pending"],
         ["Office evidence",caseData.officeEvidenceVerified?"Verified":"Pending"],
         ["Core approval ready",caseData.readyForCoreApproval?"Yes":"No"],
        ] as const).map(([label,value])=>(
         <div key={label}><p className="text-xs text-slate-500">{label}</p><p className="font-semibold text-slate-800">{value}</p></div>
        ))}
       </div>
       <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">Owner action
         <select className="mt-1 w-full rounded-lg border p-2" value={action}
          onChange={event=>setAction(event.target.value as ReviewAction)}>
           {OPTIONS.map(item=><option key={item.action} value={item.action}>{item.label}</option>)}
         </select>
        </label>
        <label className="text-sm font-semibold">Reason code
         <input className="mt-1 w-full rounded-lg border p-2" value={reason}
          onChange={event=>setReason(event.target.value.slice(0,64))}
          placeholder="office_proof_incomplete" autoComplete="off"/>
        </label>
       </div>
       <button type="button" disabled={busy||!REASON.test(reason)}
        onClick={()=>void submit()}
        className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
        {busy?"Recording…":"Record Owner decision"}
       </button>
      </>
     )}
    </div>
   ):null}
   <p className="mt-5 text-xs text-slate-500">
    No vendor is approved, activated, made visible or assigned leads from this panel.
    Approval of the private evidence case is separate from Core vendor status approval.
   </p>
  </section>
 );
}
