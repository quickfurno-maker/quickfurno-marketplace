import Link from "next/link";
import {fetchOwnerFinancePreview} from "../../lib/core";
import "../operations/operations.css";
export const dynamic="force-dynamic";
const amount=(n:number|null)=>n===null?"Not recorded":
 new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(n);
const when=(date:string)=>new Intl.DateTimeFormat("en-IN",{
 timeZone:"Asia/Kolkata",day:"2-digit",month:"short",year:"numeric"}).format(new Date(date));
export default async function Finance(){
 const result=await fetchOwnerFinancePreview();
 if(!result.ok)return <main className="hold"><section className="holdCard">
  <p className="kicker">VOX / FINANCE ACCESS</p><h1>Finance preview unavailable</h1>
  <p>Verified Owner MFA, an authorized Core order read, and separately reviewed Staging feature gates are required.</p>
  <Link href="/login">Owner sign-in</Link></section></main>;
 return <main className="voxOps">
  <header className="voxTop"><div className="voxLogo">V</div>
   <div><b>VOX / FINANCE</b><small>QuickFurno · vendor package order records</small></div>
   <div className="voxSession">OWNER AAL2 · READ ONLY</div></header>
  <div className="voxHero"><p className="kicker">PAYMENT RECORDS / GOVERNED</p>
   <h1>Financial visibility.<br/><span>Without payment authority.</span></h1>
   <p>A bounded preview of Core package orders. Recorded payment status is not independent confirmation of settlement, refund, credit issuance or reconciliation.</p>
   <nav aria-label="VOX staff workspaces"><Link href="/operations" style={{color:"#9decc8"}}>Mission Control</Link> · <Link href="/vendor360" style={{color:"#9decc8"}}>Vendor 360</Link> · <Link href="/approvals" style={{color:"#9decc8"}}>Owner Approvals</Link></nav>
  </div>
  <div className="voxSectionTitle"><p className="kicker">RECENT CORE RECORDS</p><h2>Order preview</h2></div>
  <div className="voxWorkspace"><section className="voxUnit">
   <div className="voxUnitTop"><div><p>NON-EXHAUSTIVE</p><h2>Recent orders</h2></div>
    <strong>{result.orders.length}<small> records</small></strong></div>
   {result.orders.length===0?<div className="voxBlank">No order records returned by Core.</div>:
    <div className="voxRows">{result.orders.map(o=><div className="voxRow" key={o.orderId}>
      <div className="voxRowIcon">₹</div><div className="voxRowBody">
       <b>{amount(o.recordedOrderAmount)} · {o.vendorRef}</b>
       <small>Order #{o.orderId.slice(0,8)} · {when(o.createdAt)} · {o.creditsIncluded??"—"} package credits recorded</small></div>
      <span className="voxState">{o.paymentStatus} / {o.activationStatus}</span></div>)}</div>}
   <footer>Core order snapshot · Not a settlement ledger</footer>
  </section></div>
  <div className="voxNotice"><b>Financial safety boundary</b>
   <span>Provider IDs, UTR, banking data and payment secrets are never exposed. This page cannot refund, capture, reconcile, grant credits or activate packages. Finance operations stay with QuickFurno Core and require an independent release review.</span></div>
  <footer className="voxBottom">VOX Finance · Read-only Staging candidate · No money movement</footer>
 </main>;
}
