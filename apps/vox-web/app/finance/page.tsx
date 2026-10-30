import Link from "next/link";
import {fetchOwnerFinancePreview} from "../../lib/core";
import {indiaOrderMonth,selectBoundedFinanceMonth} from "../../lib/financeMonth.mjs";
import "../operations/operations.css";
export const dynamic="force-dynamic";
const amount=(n:number|null)=>n===null?"Not recorded":
 new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(n);
const when=(date:string)=>new Intl.DateTimeFormat("en-IN",{
 timeZone:"Asia/Kolkata",day:"2-digit",month:"short",year:"numeric"}).format(new Date(date));
type FinanceProps={searchParams:Promise<{state?:string|string[];month?:string|string[]}>};
const financeHref=(state:string,month:string|null)=>{
 const p=new URLSearchParams();
 if(state!=="all")p.set("state",state);
 if(month)p.set("month",month);
 return "/finance"+(p.size?"?"+p.toString():"");
};
const STATES=["all","paid","pending","failed","refunded"] as const;
type FinanceState=(typeof STATES)[number];
export default async function Finance({searchParams}:FinanceProps){
 const params=await searchParams;
 const raw=params.state;
 const requested=typeof raw==="string"?raw.toLowerCase():"all";
 const selected:FinanceState=STATES.includes(requested as FinanceState)
  ?requested as FinanceState:"all";
 const result=await fetchOwnerFinancePreview();
 if(!result.ok)return <main className="hold"><section className="holdCard">
  <p className="kicker">VOX / FINANCE ACCESS</p><h1>Finance preview unavailable</h1>
  <p>Verified Owner MFA, an authorized Core order read, and separately reviewed Staging feature gates are required.</p>
  <Link href="/login">Owner sign-in</Link></section></main>;
 const months=[...new Set(result.orders.map(o=>indiaOrderMonth(o.createdAt)))].filter(
  (m):m is string=>typeof m==="string").sort().reverse().slice(0,12);
 const selectedMonth=selectBoundedFinanceMonth(params.month,months);
 const visible=result.orders.filter(o=>(selected==="all"||
  o.paymentStatus.toLowerCase()===selected)&&
  (!selectedMonth||indiaOrderMonth(o.createdAt)===selectedMonth));
 // These counts describe the bounded Core snapshot only. They are not a
 // reconciliation queue, settled revenue, or an authority to retry payments.
 const attention=result.orders.reduce((n,o)=>n+
  (["pending","failed"].includes(o.paymentStatus.toLowerCase())?1:0),0);
 return <main className="voxOps">
  <header className="voxTop"><div className="voxLogo">V</div>
   <div><b>VOX / FINANCE</b><small>QuickFurno · vendor package order records</small></div>
   <div className="voxSession">OWNER AAL2 · READ ONLY</div></header>
  <div className="voxHero"><p className="kicker">PAYMENT RECORDS / GOVERNED</p>
   <h1>Financial visibility.<br/><span>Without payment authority.</span></h1>
   <p>A bounded preview of Core package orders. Recorded payment status is not independent confirmation of settlement, refund, credit issuance or reconciliation.</p>
   <nav aria-label="VOX staff workspaces"><Link href="/operations" style={{color:"#9decc8"}}>Mission Control</Link> · <Link href="/vendor360" style={{color:"#9decc8"}}>Vendor 360</Link> · <Link href="/approvals" style={{color:"#9decc8"}}>Owner Approvals</Link></nav>
  </div>
  <div className="voxSectionTitle"><p className="kicker">RECENT CORE RECORDS</p><h2>Order preview</h2>
   <p>{attention===0?"No pending or failed statuses in the returned snapshot.":
    attention+" of "+result.orders.length+" returned records have pending or failed status; reconciliation needs separate verified provider evidence."}</p>
  </div>
  <div className="voxWorkspace"><section className="voxUnit">
   <div className="voxUnitTop"><div><p>NON-EXHAUSTIVE</p><h2>Recent orders</h2></div>
    <strong>{visible.length}<small> of {result.orders.length} recent records</small></strong></div>
   <nav aria-label="Filter recent payment records" style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16}}>
    {STATES.map(state=><Link key={state} href={financeHref(state,selectedMonth)}
     aria-current={selected===state?"page":undefined}
     style={{padding:"7px 12px",borderRadius:8,border:"1px solid #516471",
      color:selected===state?"#9decc8":"#d0d9e0",fontWeight:selected===state?700:500}}>
     {state==="all"?"All recent":state.charAt(0).toUpperCase()+state.slice(1)}
    </Link>)}
   </nav>
   <nav aria-label="Filter recent records by India month" style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16}}>
    <Link href={financeHref(selected,null)} aria-current={!selectedMonth?"page":undefined}
     style={{color:!selectedMonth?"#9decc8":"#d0d9e0"}}>All returned months</Link>
    {months.map(month=><Link key={month} href={financeHref(selected,month)}
     aria-current={selectedMonth===month?"page":undefined}
     style={{color:selectedMonth===month?"#9decc8":"#d0d9e0"}}>{month}</Link>)}
   </nav>
   {visible.length===0?<div className="voxBlank">
    {result.orders.length===0?"No recent order records returned by Core.":"No matching records in this bounded Core preview."}
   </div>:
    <div className="voxRows">{visible.map(o=><div className="voxRow" key={o.orderId}>
      <div className="voxRowIcon">₹</div><div className="voxRowBody">
       <b><Link href={"/finance/"+o.orderId} style={{color:"#9decc8"}}>{amount(o.recordedOrderAmount)} · {o.vendorRef}</Link></b>
       <small>Order #{o.orderId.slice(0,8)} · {when(o.createdAt)} · {o.creditsIncluded??"—"} package credits recorded</small></div>
      <span className="voxState">{o.paymentStatus} / {o.activationStatus}</span></div>)}</div>}
   <footer>Filters apply only to the bounded Core preview, not complete payment history. Recorded status is not independently verified settlement.</footer>
  </section></div>
  <div className="voxNotice"><b>Financial safety boundary</b>
   <span>Provider IDs, UTR, banking data and payment secrets are never exposed. This page cannot refund, capture, reconcile, grant credits or activate packages. Finance operations stay with QuickFurno Core and require an independent release review.</span></div>
  <footer className="voxBottom">VOX Finance · Read-only Staging candidate · No money movement</footer>
 </main>;
}
