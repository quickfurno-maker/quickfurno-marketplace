import Link from "next/link";
import {fetchOwnerFinanceOrderDetail,fetchOwnerFinanceAttemptEvidence} from "../../../lib/core";
import "../../operations/operations.css";
export const dynamic="force-dynamic";
const currency=(n:number|null)=>n===null?"Not recorded":
 new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"}).format(n);
export default async function FinanceOrder({
 params}:{params:Promise<{orderId:string}>}){
 const {orderId}=await params;
 const response=await fetchOwnerFinanceOrderDetail(orderId);
 if(!response.ok)return <main className="hold"><section className="holdCard">
  <p className="kicker">VOX / FINANCE</p><h1>Order details unavailable</h1>
  <p>Owner MFA, exact Core order ID and separately approved read-only Staging feature gates are required. No financial action has been performed.</p>
  <Link href="/finance">Return to Finance</Link></section></main>;
 const {order,ledger}=response;
 const attempts=await fetchOwnerFinanceAttemptEvidence(orderId);
 return <main className="voxOps">
  <header className="voxTop"><div className="voxLogo">V</div>
   <div><b>VOX / FINANCE</b><small>QuickFurno · source-record comparison</small></div>
   <div className="voxSession">OWNER AAL2 · READ ONLY</div></header>
  <div className="voxHero"><p className="kicker">FINANCE / ORDER RECORD</p>
   <h1>One order.<br/><span>Two Core records.</span></h1>
   <p>This is a read-only comparison of the package order and its correlated Core payment record. It cannot independently confirm settlement, credit issuance or provider delivery.</p>
   <nav><Link href="/finance" style={{color:"#9decc8"}}>Finance overview</Link> · <Link href="/operations" style={{color:"#9decc8"}}>Mission Control</Link></nav>
  </div>
  <div className="voxWorkspace">
   <section className="voxUnit">
    <div className="voxUnitTop"><div><p>ORDER SNAPSHOT</p><h2>{order.vendorRef}</h2></div>
     <strong>{currency(order.recordedOrderAmount)}</strong></div>
    <div className="voxRows">
     <div className="voxRow"><div className="voxRowBody"><b>Order ID</b><small>{order.orderId}</small></div></div>
     <div className="voxRow"><div className="voxRowBody"><b>Order state</b><small>{order.orderStatus}</small></div></div>
     <div className="voxRow"><div className="voxRowBody"><b>Recorded payment state</b><small>{order.paymentStatus}</small></div></div>
     <div className="voxRow"><div className="voxRowBody"><b>Recorded package activation</b><small>{order.activationStatus}</small></div></div>
    </div>
   </section>
   <section className="voxUnit">
    <div className="voxUnitTop"><div><p>CORE PAYMENTS TABLE</p><h2>Linked payment record</h2></div></div>
    {ledger?<div className="voxRows">
     <div className="voxRow"><div className="voxRowBody"><b>{currency(ledger.recordedAmount)}</b>
      <small>Recorded payment row amount · not provider confirmation</small></div></div>
     <div className="voxRow"><div className="voxRowBody"><b>{ledger.recordedStatus}</b>
      <small>{ledger.recordedPaymentId}</small></div></div></div>:
     <div className="voxBlank">There is no correlated Core payment record. This does not establish that a payment was or was not attempted.</div>}
    <footer>{response.ledgerStatus.replaceAll("_"," ")} · Provider status not independently reconciled</footer>
   </section>
  </div>
  <section className="voxUnit" style={{marginTop:24}}>
   <div className="voxUnitTop"><div><p>FINANCE EVIDENCE</p>
    <h2>Payment attempt events</h2></div></div>
   {attempts.ok?<div className="voxRows">
    {attempts.events.length===0?<div className="voxBlank">
     No attempt events recorded in the bounded evidence view. This is not proof
     that no external payment attempt occurred.</div>:attempts.events.map((event,index)=>
     <div className="voxRow" key={event.attemptRef+"-"+event.sequence+"-"+index}>
      <div className="voxRowBody"><b>{event.eventKind.replaceAll("_"," ")}</b>
       <small>{event.attemptRef} · {event.environment} · Event {event.sequence}</small>
       <small>{event.origin.replaceAll("_"," ")} · {event.recordedAt}</small>
      </div></div>)}
    </div>:<div className="voxBlank">
      Attempt-event history is not enabled or not available from approved
      Core evidence. No settlement conclusion can be drawn.
    </div>}
   <footer>Audit observations only · Not complete provider attempt history
    · No independent settlement confirmation</footer>
  </section>
  <div className="voxNotice"><b>Protected financial boundary</b>
   <span>Provider IDs, UTR, bank details and transaction secrets are not displayed. Payment-attempt history is incomplete; actions such as refunds, capture, reconciliation and credit issuance remain disabled.</span></div>
  <footer className="voxBottom">VOX Finance · Governed Core records · No money movement</footer>
 </main>;
}
