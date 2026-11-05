"use client";

import { useState } from "react";

type IdentityMethod="aadhaar_offline"|"passport"|"driving_licence"|"voter_id";
type EvidenceKind="office_proof"|"category_proof";
const METHODS:{value:IdentityMethod;label:string}[]=[
 {value:"aadhaar_offline",label:"Aadhaar offline verification (consent required; do not upload the Aadhaar card)"},
 {value:"passport",label:"Passport, reviewed independently"},
 {value:"driving_licence",label:"Driving licence, reviewed independently"},
 {value:"voter_id",label:"Voter ID, reviewed independently"},
];
/**
 * Minimal private file intake for a verified, Pending vendor. Uploads no raw
 * Aadhaar/PAN numbers or Aadhaar image. Documents remain pending virus scan
 * and independent Owner review and are never published as portfolio images.
 */
export function VendorPrivateEvidenceForm({vendorId}:{vendorId:string}){
 const [method,setMethod]=useState<IdentityMethod>("aadhaar_offline");
 const [kind,setKind]=useState<EvidenceKind>("office_proof");
 const [consent,setConsent]=useState(false);
 const [file,setFile]=useState<File|null>(null);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 async function upload(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();setMessage("");
  if(!consent||!file||file.size<8||file.size>5*1024*1024){
   setMessage("Consent and an office/category document of up to 5 MB are required.");return;
  }
  setBusy(true);
  try{
   const body=new FormData();
   body.append("vendorId",vendorId);body.append("identityMethod",method);
   body.append("identityConsent","true");body.append("evidenceType",kind);
   body.append("file",file);
   const response=await fetch("/api/vendor/private-evidence",{
    method:"POST",cache:"no-store",body,
   });
   if(!response.ok){
    setMessage(response.status===503
      ?"Secure evidence intake is not yet available. Your file has not been submitted."
      :"Evidence was not accepted. Check your signed-in vendor session, proof type and file.");
    return;
   }
   setFile(null);
   setMessage("Document received privately. Virus scanning and Owner review are required; approval is not automatic.");
  }catch{setMessage("Private upload unavailable. Do not send documents through public chat.");}
  finally{setBusy(false);}
 }
 return (
  <form onSubmit={event=>void upload(event)} className="mt-6 rounded-xl border border-slate-200 bg-white p-4" aria-label="Private vendor document submission">
   <h3 className="text-lg font-bold">Submit verification documents privately</h3>
   <p className="mb-3 text-sm text-slate-600">Only office and category evidence can be uploaded here. Identity verification is handled separately with explicit consent. Do not upload Aadhaar or PAN card images.</p>
   <div className="grid gap-3">
    <label className="text-sm font-semibold">Identity verification method
     <select value={method} onChange={e=>setMethod(e.target.value as IdentityMethod)}
      className="mt-1 w-full rounded-lg border p-2">
      {METHODS.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
     </select>
    </label>
    <label className="text-sm font-semibold">Document category
     <select value={kind} onChange={e=>{setKind(e.target.value as EvidenceKind);setFile(null);}}
      className="mt-1 w-full rounded-lg border p-2">
      <option value="office_proof">Office address / business premises proof</option>
      <option value="category_proof">Service or category qualification proof</option>
     </select>
    </label>
    <label className="text-sm font-semibold">PDF, PNG or JPEG (maximum 5 MB)
     <input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
      className="mt-1 block w-full text-sm" onChange={e=>setFile(e.target.files?.[0]??null)}/>
    </label>
    <label className="flex items-start gap-2 text-sm">
     <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}
      className="mt-1" />
     <span>I consent to private processing of this verification evidence for QuickFurno vendor review. I understand that the document is not public and that independent review is required.</span>
    </label>
   </div>
   {message?<p role="status" className="my-3 text-sm">{message}</p>:null}
   <button type="submit" disabled={busy||!consent||!file}
    className="mt-3 rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
    {busy?"Uploading privately…":"Submit private document"}
   </button>
  </form>
 );
}
