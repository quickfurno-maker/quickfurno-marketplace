import Link from "next/link";
import {fetchOwnerClientInbox} from "../../../lib/core";
import "../../operations/operations.css";

export const dynamic="force-dynamic";
function displayDate(value:string|null){
 if(!value)return "Date unavailable";
 return new Intl.DateTimeFormat("en-IN",{dateStyle:"medium",timeZone:"Asia/Kolkata"})
  .format(new Date(value));
}
export default async function OwnerClientOperations(){
 const result=await fetchOwnerClientInbox();
 if(!result.ok)return <main className="hold"><section className="holdCard">
  <p className="kicker">VOX / CLIENT OPERATIONS</p><h1>Client workspace protected</h1>
  <p>{result.status===401?"Owner MFA session required.":"The private Core Client read integration has not been certified or enabled."}</p>
  <Link href={result.status===401?"/login":"/operations"}>{result.status===401?"Owner sign-in":"Owner Home"}</Link>
 </section></main>;
 return <main className="voxOps">
  <header className="voxTop"><div className="voxLogo">V</div><div><b>CLIENT OPERATIONS</b><small>QuickFurno Core · Owner-only read</small></div><div className="voxSession">READ ONLY · AAL2</div></header>
  <section className="voxHero"><p className="kicker">VOX / CLIENT OPERATIONS</p>
   <h1>Client enquiries.<br/><span>One verified view.</span></h1>
   <p>A limited recent lead sample from canonical Core records. Full client CRM, qualification, matching and contact controls will be integrated after their secure Owner API contracts pass.</p>
  </section>
  <nav aria-label="Owner workspace navigation" style={{display:"flex",gap:16,marginBottom:22}}>
   <Link href="/operations">Owner Home</Link><Link href="/owner/vendors">Vendor Operations</Link>
  </nav>
  <div className="voxPills"><div><strong>{result.view.leads.length}</strong><span>Recent records shown</span></div>
   <div><strong>12</strong><span>Maximum sample</span></div>
   <div><strong>0</strong><span>Actions enabled</span></div></div>
  <section className="voxUnit"><div className="voxUnitTop"><div><p>RECENT CLIENT ENQUIRIES</p><h2>Read-only Core sample</h2></div><strong>{result.view.leads.length}<small> recent</small></strong></div>
   {result.view.leads.length===0?<div className="voxBlank">No recent client records are available in this view.</div>:
    <div className="voxRows">{result.view.leads.map(lead=><div className="voxRow" key={lead.leadId}>
     <div className="voxRowIcon">C</div><div className="voxRowBody"><b>{lead.category==="UNKNOWN"?"Unspecified service":lead.category}</b>
      <small>{lead.city} · {lead.source} · {displayDate(lead.createdAt)}</small></div>
     <span className="voxState">{lead.state}</span></div>)}</div>}
   <footer>Recent sample only · Total lead count is not known · No PII or assignments exposed</footer>
  </section>
  <div className="voxNotice"><b>Core is authoritative</b><span>Owner qualification, assignment and first-contact actions are intentionally disabled until separately validated. No automatic assignment or credit debit can occur here.</span></div>
  <footer className="voxBottom"><Link href="/operations">Return to Owner Home</Link> · Client Operations Preview</footer>
 </main>;
}
