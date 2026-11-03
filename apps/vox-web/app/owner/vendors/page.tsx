import Link from "next/link";
import {fetchScopedCrm} from "../../../lib/core";
import "../../operations/operations.css";

export const dynamic="force-dynamic";
export default async function OwnerVendorOperations(){
 const result=await fetchScopedCrm("vendor360");
 if(!result.ok)return <main className="hold"><section className="holdCard">
  <p className="kicker">VOX / VENDOR OPERATIONS</p><h1>Vendor workspace protected</h1>
  <p>{result.status===401?"Owner MFA session required.":"The private Core Vendor read integration has not been certified or enabled."}</p>
  <Link href={result.status===401?"/login":"/operations"}>{result.status===401?"Owner sign-in":"Owner Home"}</Link>
 </section></main>;
 const profiles=new Map(result.view.crm.map(c=>[c.vendorId,c]));
 return <main className="voxOps">
  <header className="voxTop"><div className="voxLogo">V</div><div><b>VENDOR OPERATIONS</b><small>QuickFurno Core · Owner-only read</small></div><div className="voxSession">READ ONLY · AAL2</div></header>
  <section className="voxHero"><p className="kicker">VOX / VENDOR OPERATIONS</p>
   <h1>Vendor relationships.<br/><span>One verified view.</span></h1>
   <p>Recent vendors and relationships from canonical Core records. Registration reviews, verification and approvals remain Core-controlled until their secure Owner actions are certified.</p>
  </section>
  <nav aria-label="Owner workspace navigation" style={{display:"flex",gap:16,marginBottom:22}}>
   <Link href="/operations">Owner Home</Link><Link href="/owner/clients">Client Operations</Link>
   <Link href="/acquisition">Aarohi overview</Link>
  </nav>
  <div className="voxPills"><div><strong>{result.view.vendors.length}</strong><span>Recent vendors shown</span></div>
   <div><strong>{result.view.crm.length}</strong><span>Linked CRM statuses</span></div>
   <div><strong>0</strong><span>Actions enabled</span></div></div>
  <section className="voxUnit"><div className="voxUnitTop"><div><p>RECENT VENDORS</p><h2>Read-only Core sample</h2></div><strong>{result.view.vendors.length}<small> recent</small></strong></div>
   {result.view.vendors.length===0?<div className="voxBlank">No recent vendors are available in this view.</div>:
    <div className="voxRows">{result.view.vendors.map(v=><div className="voxRow" key={v.vendorId}>
     <div className="voxRowIcon">V</div><div className="voxRowBody">
      <b>{v.businessName}</b><small>Verification: {v.verificationStatus} · Location: {v.locationVerification} · CRM: {profiles.get(v.vendorId)?.relationship??"No current CRM record"}</small>
     </div><span className="voxState">{v.status} · {v.active?"Active":"Inactive"}</span></div>)}</div>}
   <footer>Maximum 12 recent vendors · Not an exhaustive directory · No credits or private contact details exposed</footer>
  </section>
  <div className="voxNotice"><b>Approval gate remains closed</b>
   <span>Vendor KYC, status changes, login activation, packages, provider messaging and all credit mutations remain protected Core operations. No state changes can originate from this preview.</span></div>
  <footer className="voxBottom"><Link href="/operations">Return to Owner Home</Link> · Vendor Operations Preview</footer>
 </main>;
}
