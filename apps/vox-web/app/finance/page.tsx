import Link from "next/link";
import {fetchOwnerFinanceHistory} from "../../lib/finance";
import {FinanceTimeline} from "./FinanceTimeline";
import {FinanceCaseDesk} from "./FinanceCaseDesk";
import {FinanceOrderSearch} from "./FinanceOrderSearch";
import "../operations/operations.css";
export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default async function Finance({searchParams}:{
 searchParams:Promise<{orderId?:string|string[]}>}){
 const params=await searchParams;
 const id=typeof params.orderId==="string"&&UUID.test(params.orderId)?params.orderId:null;
 const result=id?await fetchOwnerFinanceHistory(id):null;
 return <main className="voxOps">
  <header className="voxTop"><div className="voxLogo">V</div><div><b>VOX / FINANCE 360</b>
   <small>Owner AAL2 · Canonical QuickFurno Core</small></div>
   <div className="voxSession">FINANCE V2 · RELEASE HOLD</div></header>
  <div className="voxHero"><p className="kicker">PAY-3 / FINANCIAL RECORDS</p>
   <h1>Trace every transaction,<br/><span>without moving money.</span></h1>
   <p>Search an exact local order UUID. This interface is unavailable until
    reviewed Finance V2 history tables, explicit feature flags and Owner MFA are certified.
    Finance Staff access requires current Core MFA, vendor scope, a separately approved
    finance read grant and Staging feature gates. Refund execution remains disabled.</p></div>
  <section className="voxNotice"><b>Canonical order lookup</b>
   <form action="/finance" method="get" style={{display:"flex",flexWrap:"wrap",gap:12}}>
    <label htmlFor="finance-order-id">Order UUID</label>
    <input id="finance-order-id" name="orderId" type="text" required maxLength={36}
     pattern="[0-9a-fA-F-]{36}" defaultValue={id??""}
     placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
     style={{minWidth:300,padding:10,borderRadius:8}}/>
    <button type="submit" style={{padding:"10px 18px",borderRadius:8}}>Lookup</button>
   </form>
  </section>
  {params.orderId&&!id?<div className="voxNotice" role="alert">
   <b>Invalid reference</b><span>An exact local UUID is required. No unrestricted financial search.</span>
  </div>:null}
  {id&&!result?.ok?<div className="voxNotice" role="status"><b>History unavailable</b>
   <span>Owner AAL2, reviewed SQL and explicit finance-read activation required.
    Missing financial data is never displayed as zero.</span></div>:null}
  {result?.ok?<div className="voxWorkspace">
   <section className="voxNotice"><b>Order {result.orderId}</b><span>
    Mode: {result.providerMode.toUpperCase()} · Provider: {result.providerStatus} ·
    Activation: {result.activationStatus} · NOT CERTIFIED · READ ONLY</span></section>
   <FinanceTimeline events={result.timeline} mode={result.providerMode}/>
  </div>:null}
  <FinanceOrderSearch enabled={process.env.VOX_FINANCE_PAY4B_SEARCH_UI_ENABLED==="staging"&&process.env.VOX_STAFF_PORTAL_ENABLED==="staging"}/>
  <FinanceCaseDesk enabled={process.env.VOX_FINANCE_PAY4A_CASE_UI_ENABLED==="staging"&&process.env.VOX_STAFF_PORTAL_ENABLED==="staging"}/>
  <div className="voxWorkspace">
    <section className="voxNotice"><b>Bank / UTR verification</b><span>
     Bank transfer references require a verified matching bank statement and independent reviewer.
     No manual Paid-state update is available in VOX during release HOLD.</span></section>
    <section className="voxNotice"><b>Refund approvals</b><span>
     Refunds require separate requester and approver, provider capture evidence, atomic
     cumulative reservation and explicit consumed-credit policy. Provider refund execution is disabled.</span></section>
    <section className="voxNotice"><b>Settlement reconciliation</b><span>
     Provider settlement, signed financial lines and independent bank deposit must agree.
     Arithmetic agreement alone is not accounting or GST certification.</span></section>
  </div>
  <div className="voxNotice"><b>Financial separation</b><span>
   Captures, wallet credits, refunds, recognized revenue and bank settlement are separate.
   No financial action is available in this source-only candidate.</span></div>
  <footer className="voxBottom"><Link href="/team">Team Operations</Link> · Owner read-only preview</footer>
 </main>;
}
