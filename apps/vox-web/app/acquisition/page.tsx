import Link from "next/link";
import {fetchScopedCrm} from "../../lib/core";
import "../operations/operations.css";
export const dynamic="force-dynamic";
export default async function Acquisition(){
 const r=await fetchScopedCrm("acquisition");
 if(!r.ok||r.kind!=="acquisition")return <main className="hold"><div className="holdCard"><h1>Acquisition unavailable</h1><p>Staff authentication and city-scoped Core permissions are required.</p><Link href="/login">Secure staff sign-in</Link></div></main>;
 return <main className="voxOps"><header className="voxTop"><div className="voxLogo">V</div><div><b>VOX / AAROHI</b><small>Existing QuickFurno acquisition CRM</small></div><div className="voxSession">READ ONLY · STAFF SCOPED</div></header>
 <div className="voxHero"><p className="kicker">AAROHI / ACQUISITION CRM</p><h1>One prospect pipeline.<br/><span>One source of truth.</span></h1>
 <p>Existing Aarohi prospects and tasks, filtered by approved staff city and exact assignments. No duplicated CRM, registration authority or WhatsApp sender.</p></div>
 <div className="voxWorkspace"><section className="voxUnit"><div className="voxUnitTop"><h2>Assigned prospects</h2><strong>{r.view.prospects.length}</strong></div>
 <div className="voxRows">{r.view.prospects.length?r.view.prospects.map((p,i)=><div className="voxRow" key={p.id??i}><div className="voxRowIcon">A</div>
 <div className="voxRowBody"><b>{p.businessName}</b><small>Priority {p.priority} · Next {p.nextAction}</small></div>
 <span className="voxState">{p.doNotContact?"DO NOT CONTACT":p.humanTakeover?"HUMAN":p.stage}</span></div>):<div className="voxBlank">No assigned prospects.</div>}</div><footer>No direct outreach or activation</footer></section>
 <section className="voxUnit"><div className="voxUnitTop"><h2>Follow-up tasks</h2><strong>{r.view.tasks.length}</strong></div><div className="voxRows">{r.view.tasks.length?r.view.tasks.map((t,i)=>
 <div className="voxRow" key={t.id??i}><div className="voxRowIcon">T</div><div className="voxRowBody"><b>{t.type}</b><small>Due: {t.dueAt??"Not scheduled"}</small></div><span className="voxState">{t.status}</span></div>
 ):<div className="voxBlank">No assigned follow-up tasks.</div>}</div><footer>Assignments governed by Core</footer></section></div>
 <div className="voxNotice"><b>Aarohi is canonical</b><span>Prospect conversion requires existing Core registration intent, signed verified vendor activation and audited handoff to Anisha.</span></div>
 <footer className="voxBottom"><Link href="/operations">← Mission Control</Link> · VOX Acquisition · Source-only staging implementation</footer></main>;
}
