"use client";
import {useState} from "react";
type Case={id:string;orderId:string;caseKind:string;amountSubunits:number;createdAt:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function FinanceCaseDesk({enabled}:{enabled:boolean}){
 const [order,setOrder]=useState(""),[amount,setAmount]=useState(""),
  [hash,setHash]=useState(""),[kind,setKind]=useState("MANUAL_RECEIPT_REVIEW"),
  [cases,setCases]=useState<Case[]>([]),[review,setReview]=useState(""),
  [status,setStatus]=useState("No financial actions enabled.");
 const [busy,setBusy]=useState(false);
 async function submit(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();if(!enabled||busy)return;
  const amountValid=/^\d+(?:\.\d{1,2})?$/.test(amount);
  const [rupees,decimals=""]=amount.split(".");
  const paise=amountValid?Number(rupees)*100+Number(decimals.padEnd(2,"0")):NaN;
  if(!uuid.test(order)||!Number.isSafeInteger(paise)||paise<=0||
   !/^[a-f0-9]{64}$/.test(hash)){setStatus("Valid order UUID, paise amount and SHA-256 evidence hash required.");return;}
  setBusy(true);try{
   const result=await fetch("/api/finance-case",{method:"POST",
    headers:{"content-type":"application/json"},cache:"no-store",
    body:JSON.stringify({orderId:order,requestedAmountSubunits:paise,
     clientRequestId:crypto.randomUUID(),caseKind:kind,evidenceSha256:hash})});
   const x=await result.json();
   setStatus(result.ok&&x.ok?"Evidence-only case requested. ID "+x.caseId:
    "Request unavailable or unauthorized. No payment changes made.");
  }catch{setStatus("Request unavailable. No payment changes made.");}
  finally{setBusy(false);}
 }
 async function loadReviews(){
  if(!enabled||busy)return;setBusy(true);
  try{const response=await fetch("/api/finance-case-review",{cache:"no-store"});
   const x=await response.json();setCases(response.ok&&x.ok?x.cases:[]);
   setStatus(response.ok&&x.ok?"Owner review inbox loaded; approvals never execute money.":
    "Owner AAL2 approval inbox unavailable.");
  }catch{setStatus("Owner review inbox unavailable.");}finally{setBusy(false);}
 }
 async function decide(id:string,decision:"APPROVED_FOR_FURTHER_CHECKS"|"REJECTED"){
  if(!enabled||busy)return;setBusy(true);
  try{const r=await fetch("/api/finance-case-review",{method:"POST",
   headers:{"content-type":"application/json"},cache:"no-store",
   body:JSON.stringify({caseId:id,decision,reviewReference:crypto.randomUUID(),
    reasonCode:decision==="REJECTED"?"REVIEW_REJECTED":"FURTHER_CHECKS_REQUIRED"})});
   const x=await r.json();setReview(r.ok&&x.ok?
    "Independent decision recorded. No refund or Paid-status change.":"Review refused or unavailable.");
  }catch{setReview("Review unavailable.");}finally{setBusy(false);}
 }
 return <section className="voxNotice" aria-label="Finance case request and review">
  <h2>Finance evidence & refund-review requests</h2>
  <p>Requests and Owner decisions are records only. No actual UTR verification,
   payment settlement, vendor credit, or Razorpay refund happens here.</p>
  {!enabled?<p role="status"><strong>RELEASE HOLD.</strong> Staff case writing and Owner decisions are
   disabled until separately reviewed PAY-4A Staging authorization.</p>:null}
  <form onSubmit={submit} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:12}}>
   <label>Canonical order UUID
    <input value={order} onChange={e=>setOrder(e.target.value.trim())}
     maxLength={36} required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"/></label>
   <label>Case type
    <select value={kind} onChange={e=>setKind(e.target.value)}>
     <option value="MANUAL_RECEIPT_REVIEW">Bank / UTR receipt review</option>
     <option value="REFUND_POLICY_REVIEW">Refund policy review</option>
    </select></label>
   <label>Requested amount (INR)
    <input value={amount} onChange={e=>setAmount(e.target.value)}
     inputMode="decimal" placeholder="1000.00" required/></label>
   <label>SHA-256 evidence fingerprint
    <input value={hash} onChange={e=>setHash(e.target.value.toLowerCase().trim())}
     maxLength={64} required placeholder="64-character SHA-256"/></label>
   <button disabled={!enabled||busy} type="submit">Submit evidence-only request</button>
  </form>
  <p role="status">{status}</p>
  <hr/>
  <h3>Owner independent-review inbox</h3>
  <button disabled={!enabled||busy} type="button" onClick={loadReviews}>
   Load last 20 cases (Owner AAL2)</button>
  {cases.length>0?<ul>{cases.map(c=><li key={c.id}>
   <strong>{c.caseKind}</strong> · {c.orderId} · ₹{(c.amountSubunits/100).toFixed(2)}
   <button disabled={busy} onClick={()=>decide(c.id,"APPROVED_FOR_FURTHER_CHECKS")}>
    Approve for further checks</button>
   <button disabled={busy} onClick={()=>decide(c.id,"REJECTED")}>Reject</button>
  </li>)}</ul>:null}
  {review?<p role="status">{review}</p>:null}
 </section>;
}
