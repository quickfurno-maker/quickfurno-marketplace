"use client";

import {useRef,useState} from "react";
import {
 confirmedPrivateEvidencePendingAck,validateVendorPrivateEvidenceSelection,
} from "@/lib/vendors/vendorSignupUi";

type IdentityMethod="aadhaar_offline"|"passport"|"driving_licence"|"voter_id";
type EvidenceKind="office_proof"|"category_proof";
const METHODS:{value:IdentityMethod;label:string}[]=[
 {value:"aadhaar_offline",label:"Aadhaar offline verification (separate consent; never upload card)"},
 {value:"passport",label:"Passport (independent review)"},
 {value:"driving_licence",label:"Driving licence (independent review)"},
 {value:"voter_id",label:"Voter ID (independent review)"},
];

/**
 * No direct public document URLs or automatic verification. This form runs
 * only after a Pending registration; private ownership and valid Auth are
 * independently enforced in the Core RPC. File validation here is a hint;
 * Core MIME magic bytes, size, scanner and Owner review remain authoritative.
 */
export function VendorPrivateEvidenceForm({vendorId}:{vendorId:string}){
 const [method,setMethod]=useState<IdentityMethod|"">("");
 const [kind,setKind]=useState<EvidenceKind>("office_proof");
 const [consent,setConsent]=useState(false);
 const [file,setFile]=useState<File|null>(null);
 const fileInput=useRef<HTMLInputElement|null>(null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState<{kind:"error"|"status";text:string}|null>(null);

 function chooseFile(next:File|null){
  const valid=validateVendorPrivateEvidenceSelection(next);
  if(!valid.ok){
   setFile(null);
   if(fileInput.current)fileInput.current.value="";
   setMessage(next?{kind:"error",text:valid.message}:null);
   return;
  }
  setMessage(null);
  setFile(next);
 }

 async function upload(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(busy)return;
  setMessage(null);
  const selected=validateVendorPrivateEvidenceSelection(file);
  if(!method||!consent||!selected.ok||!file){
   setMessage({kind:"error",text:
    !method?"Choose an identity verification method before submitting.":
    !consent?"Consent is required before private evidence processing.":selected.message});
   return;
  }
  setBusy(true);
  try{
   const body=new FormData();
   body.append("vendorId",vendorId);
   body.append("identityMethod",method);
   body.append("identityConsent","true");
   body.append("evidenceType",kind);
   body.append("file",file);
   const response=await fetch("/api/vendor/private-evidence",{
    method:"POST",cache:"no-store",body,
   });
   const payload:unknown=await response.json().catch(()=>null);
   if(!confirmedPrivateEvidencePendingAck(response.status,payload)){
    setMessage({kind:"error",text:response.status===503
     ?"Private document intake is not available. Keep the file securely and try after QuickFurno confirms availability."
     :"Document submission was not confirmed. Please contact QuickFurno before retrying."});
    return;
   }
   setFile(null);
   if(fileInput.current)fileInput.current.value="";
   setMessage({kind:"status",text:
    "Document received privately and marked pending. Virus scanning and independent Owner review are required. Your vendor is not approved or active."});
  }catch{
   setMessage({kind:"error",text:
    "Submission could not be confirmed. Keep your file private and contact QuickFurno before retrying."});
  }finally{setBusy(false);}
 }
 return (
  <form onSubmit={event=>void upload(event)}
    className="mt-6 rounded-xl border border-slate-200 bg-white p-4"
    aria-label="Private vendor document submission">
   <h3 className="text-lg font-bold">Submit verification documents privately</h3>
   <p className="mb-3 text-sm text-slate-600">
    Only office and category evidence can be uploaded here. Identity verification is
    handled separately with explicit consent. Do not upload Aadhaar or PAN card images.
    Your vendor stays Pending until independent review.
   </p>
   <div className="grid gap-3">
    <label className="text-sm font-semibold">Identity verification method
     <select value={method} required disabled={busy}
       onChange={e=>setMethod(e.target.value as IdentityMethod|"")}
       className="mt-1 w-full rounded-lg border p-2">
      <option value="">Choose identity verification method</option>
      {METHODS.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
     </select>
    </label>
    <label className="text-sm font-semibold">Document category
     <select value={kind} disabled={busy}
      onChange={e=>{
       setKind(e.target.value as EvidenceKind);setFile(null);setMessage(null);
       if(fileInput.current)fileInput.current.value="";
      }} className="mt-1 w-full rounded-lg border p-2">
      <option value="office_proof">Office address / business premises proof</option>
      <option value="category_proof">Service or category qualification proof</option>
     </select>
    </label>
    <label className="text-sm font-semibold">PDF, PNG or JPEG (maximum 5 MB)
     <input ref={fileInput} type="file" required disabled={busy}
      accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
      className="mt-1 block w-full text-sm"
      onChange={e=>chooseFile(e.target.files?.[0]??null)}/>
    </label>
    <label className="flex items-start gap-2 text-sm">
     <input type="checkbox" checked={consent} disabled={busy}
      onChange={e=>setConsent(e.target.checked)}
      className="mt-1"/>
     <span>I consent to private processing of this verification evidence for QuickFurno
       vendor review. I understand it is not public and does not automatically approve my business.</span>
    </label>
   </div>
   {message?<p role={message.kind==="error"?"alert":"status"} aria-live="polite"
     className="my-3 text-sm">{message.text}</p>:null}
   <button type="submit" disabled={busy||!consent||!method||!file}
    className="mt-3 rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
    {busy?"Submitting privately…":"Submit private document"}
   </button>
  </form>
 );
}
