"use client";
import {useCallback,useState} from "react";
import type {OwnerCase,OwnerQueueRow,OwnerReviewAction} from "../../../../lib/ownerVendorVerification";

type QueueResponse={ok:boolean;schema?:string;pending?:OwnerQueueRow[];code?:string};
type CaseResponse={ok:boolean;schema?:string;case?:OwnerCase;code?:string};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{4}[0-9a-f]{8}$/i;
const REASON=/^[a-z][a-z0-9_]{2,63}$/;
const methods:[OwnerReviewAction,string][]=[
 ["request_documents","Request missing documents"],["request_correction","Request corrections"],
 ["reject","Reject case"],["approve","Approve verification case"],
];
const fetchOptions={cache:"no-store" as const,redirect:"error" as const,credentials:"same-origin" as const};
const columns=[
 ["Contact","contactStatus"],["Identity","identityStatus"],["Office","officeStatus"],
 ["Categories","categoryStatus"],["Zone","zoneStatus"],
] as const;
function friendly(value:string|null|undefined){
 return (value??"Not verified").replaceAll("_"," ");
}
export default function OwnerReviewConsole({decisionEnabled}:{decisionEnabled:boolean}){
 const [queue,setQueue]=useState<OwnerQueueRow[]>([]);
 const [selected,setSelected]=useState<OwnerCase|null>(null);
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 const [action,setAction]=useState<OwnerReviewAction>("request_documents");
 const [reason,setReason]=useState("");
 const [inFlight,setInFlight]=useState<"queue"|"case"|"decision"|null>(null);
 const approveEligible=Boolean(selected?.casePresent&&
  selected.caseState!== "approved"&&selected.caseState!=="rejected"&&
  selected.contactStatus==="verified"&&selected.identityStatus==="verified"&&
  selected.officeStatus==="verified"&&selected.categoryStatus==="verified"&&
  selected.zoneStatus==="verified"&&selected.consentValid&&
  selected.identityEvidenceVerified&&selected.officeEvidenceVerified);
 const loadQueue=useCallback(async()=>{
  setInFlight("queue");setMessage("");setQueue([]);setSelected(null);
  try{
   const r=await fetch("/api/owner/vendor-verification/queue",fetchOptions);
   const data=await r.json() as QueueResponse;
   if(!r.ok||data.ok!==true||data.schema!=="qf.vox.owner.vendor-review-bff.v1"||
      !Array.isArray(data.pending)||data.pending.length>20||
      data.pending.some(x=>!x||!UUID.test(x.vendorId)||!Number.isInteger(x.caseVersion))){
    setMessage(r.status===401||r.status===403?
     "Owner MFA or Core Superadmin permission is required.":
     r.status===503?"Owner review is unavailable until private Staging is certified.":
     "Queue response is unavailable. No vendor information was changed.");
    return;
   }
   setQueue(data.pending);
   if(data.pending.length===0)setMessage("No current pending vendor cases in this first 20-record window.");
  }catch{setMessage("Owner queue unavailable. Refresh the session and retry the read.");}
  finally{setInFlight(null);}
 },[]);
 const loadCase=useCallback(async(id:string)=>{
  if(!UUID.test(id)){setMessage("Invalid vendor reference.");return;}
  setInFlight("case");setMessage("");setSelected(null);
  try{
   const r=await fetch("/api/owner/vendor-verification/case?vendorId="+encodeURIComponent(id),fetchOptions);
   const data=await r.json() as CaseResponse;
   if(!r.ok||data.ok!==true||data.schema!=="qf.vox.owner.vendor-case-bff.v1"||
      !data.case||data.case.vendorId!==id){
    setMessage(r.status===401||r.status===403?
     "Owner MFA or Core Superadmin permission is required.":
     "The canonical Core case is unavailable. Do not make a decision.");
    return;
   }
   setSelected(data.case);
  }catch{setMessage("Case read is unavailable. No decision was recorded.");}
  finally{setInFlight(null);}
 },[]);
 async function submitDecision(){
  if(!decisionEnabled||!selected?.casePresent||
     !selected.caseVersion||!Number.isSafeInteger(selected.caseVersion)||
     !UUID.test(selected.vendorId)||!REASON.test(reason)||
     (action==="approve"&&!approveEligible)) {
    setMessage("Decision blocked: verify case, reason, current MFA and evidence readiness.");
    return;
  }
  setInFlight("decision");setMessage("");
  const id=selected.vendorId;
  try{
   const r=await fetch("/api/owner/vendor-verification/decision",{
    ...fetchOptions,method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({vendorId:id,caseVersion:selected.caseVersion,action,reasonCode:reason})
   });
   const data=await r.json() as {ok?:boolean;schema?:string;vendorId?:string;caseState?:string};
   if(!r.ok||data.ok!==true||data.schema!=="qf.vox.owner.vendor-decision-bff.v1"||
      data.vendorId!==id) {
    setMessage("Decision not confirmed. Reload the authoritative Core case before attempting any retry; the outcome may be uncertain.");
    setSelected(null);
    return;
   }
   setMessage("Core recorded the immutable case decision. Vendor activation, credits and lead eligibility remain separate.");
   setReason("");
   setSelected(null);
  }catch{
   setMessage("Decision outcome is uncertain. Reload the canonical case before attempting any retry.");
   setSelected(null);
  }finally{setInFlight(null);}
 }
 return <section className="ovr-root" aria-label="Owner vendor verification console">
  <header className="ovr-head">
   <div>
    <p className="ovr-kicker">VOX OWNER / VENDOR OPERATIONS</p>
    <h2>Verification queue</h2>
    <p>Core-controlled cases only. No identity images, personal documents, automatic credits, or lead activation.</p>
   </div>
   <button type="button" onClick={()=>void loadQueue()} disabled={Boolean(inFlight)}
     className="ovr-button"> {inFlight==="queue"?"Loading queue…":"Load pending cases"} </button>
  </header>
  {message?<p className="ovr-notice" role="status">{message}</p>:null}
  <div className="ovr-grid">
   <div className="ovr-panel">
    <h3>Pending applications</h3>
    <p className="ovr-sub">Oldest 20 current cases. No personal details.</p>
    {queue.length===0?<p className="ovr-empty">Load the queue to view current private case references.</p>:(
     <ul className="ovr-list">
      {queue.map(item=><li key={item.vendorId}>
       <button type="button" className="ovr-case-button" disabled={Boolean(inFlight)}
        aria-current={selected?.vendorId===item.vendorId?"true":undefined}
        onClick={()=>{setAction("request_documents");setReason("");void loadCase(item.vendorId);}}>
        <strong>{item.vendorId.slice(0,8)}…</strong>
        <span>{friendly(item.caseState)} · Version {item.caseVersion}</span>
        <small>{item.pendingScanCount} pending scans · {item.rejectedScanCount} rejected ·
         {item.consentValid?" Consent valid":" Consent not valid"}</small>
       </button>
      </li>)}
     </ul>
    )}
   </div>
   <div className="ovr-panel" aria-label="Selected vendor verification case">
    <h3>Case review</h3>
    {!selected?<p className="ovr-empty">Select a vendor reference to load its verified Core review snapshot.</p>:!selected.casePresent?(
     <p className="ovr-notice">No private verification case exists for this vendor.</p>
    ):<>
     <p className="ovr-sub">Vendor reference <code>{selected.vendorId.slice(0,8)}…</code> ·
      Case version {selected.caseVersion} · {friendly(selected.caseState)}</p>
     <dl className="ovr-facts">
      {columns.map(([label,key])=><div key={key}><dt>{label}</dt><dd>{friendly(selected[key])}</dd></div>)}
      <div><dt>Consent</dt><dd>{selected.consentValid?"Valid":"Required"}</dd></div>
      <div><dt>Identity evidence</dt><dd>{selected.identityEvidenceVerified?"Verified":"Pending"}</dd></div>
      <div><dt>Office evidence</dt><dd>{selected.officeEvidenceVerified?"Verified":"Pending"}</dd></div>
      <div><dt>Core approval ready</dt><dd>{selected.readyForCoreApproval?"Yes":"No"}</dd></div>
     </dl>
     {!approveEligible?<p className="ovr-warning" role="status">
      Approval requires all five verification stages, valid consent and independently
      verified identity and office evidence. Malware scan status alone is insufficient.
     </p>:null}
     <div className="ovr-decision">
      <label>Case decision
       <select value={action} disabled={!decisionEnabled||Boolean(inFlight)}
        onChange={e=>setAction(e.target.value as OwnerReviewAction)}>
        {methods.map(([value,label])=><option key={value} value={value}
         disabled={value==="approve"&&!approveEligible}>{label}</option>)}
       </select>
      </label>
      <label>Reason code
       <input value={reason} maxLength={64} autoComplete="off" spellCheck={false}
        onChange={e=>setReason(e.target.value)}
        placeholder="documents_requested" disabled={!decisionEnabled||Boolean(inFlight)}/>
      </label>
      <button type="button" className="ovr-button" onClick={()=>void submitDecision()}
       disabled={!decisionEnabled||Boolean(inFlight)||!REASON.test(reason)||
        (action==="approve"&&!approveEligible)}>
       {inFlight==="decision"?"Recording…":"Record Core decision"}
      </button>
      {!decisionEnabled?<p className="ovr-sub">Decisions are OFF until an independent
       Owner-approved Staging gate enables them. Queue and case access are read-only.</p>:null}
     </div>
    </>}
   </div>
  </div>
  <p className="ovr-foot">QuickFurno Core remains the single business authority.
   Approving a verification case does not approve the vendor business or assign any leads.</p>
 </section>;
}
