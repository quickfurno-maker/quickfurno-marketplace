import Link from "next/link";
import {fetchScopedCrm} from "../../lib/core";
import {ScopedQueue} from "../components/ScopedQueue";
import {StaffProposalForm} from "../components/StaffProposalForm";
import {AarohiFollowupProposal} from "./components/AarohiFollowupProposal";
import "../components/scoped-queue.css";
import "../operations/operations.css";
import {OwnerPreview} from "../components/OwnerPreview";
export const dynamic="force-dynamic";
export default async function Acquisition(){
 if(process.env.VOX_STAFF_VIEW_MODE==="owner")return <OwnerPreview kind="acquisition"/>;
 const r=await fetchScopedCrm("acquisition");
 if(!r.ok||r.kind!=="acquisition")return <main className="hold"><section className="holdCard">
 <p className="kicker">STAFF CORE AUTHORIZATION</p><h1>Acquisition unavailable</h1>
 <p>Verified staff MFA and an explicit Core city/prospect assignment are required.</p><Link href="/login">Staff sign-in</Link></section></main>;
 const prospects=r.view.prospects.map(p=>({id:p.id??"",title:p.businessName,
  detail:"Priority "+p.priority+" · Next "+p.nextAction,
  state:p.doNotContact?"DO NOT CONTACT":p.humanTakeover?"HUMAN":p.stage,
  attention:p.humanTakeover||p.doNotContact}));
 const tasks=r.view.tasks.map(t=>({id:t.id??"",title:t.type,detail:"Due "+(t.dueAt??"Not scheduled"),
   state:t.status,attention:t.status.toLowerCase()==="overdue"}));
 return <main className="voxOps"><header className="voxTop"><div className="voxLogo">V</div><div><b>VOX / AAROHI ACQUISITION</b>
  <small>Existing Aarohi CRM — QuickFurno Core scoped</small></div><div className="voxSession">VERIFIED · READ ONLY</div></header>
 <div className="voxHero"><p className="kicker">AAROHI / EXISTING ACQUISITION CRM</p><h1>Prospects and follow-ups,<br/><span>in one workspace.</span></h1>
 <p>Search only your assigned city/prospect records. Do-not-contact and human takeover are shown without sending WhatsApp messages or changing conversion status.</p>
 <nav aria-label="Staff workspaces"><Link href="/operations" style={{color:"#9decc8"}}>Mission Control</Link> · <Link href="/vendor360" style={{color:"#9decc8"}}>Vendor 360</Link> · <Link href="/service-desk" style={{color:"#9decc8"}}>Service Desk</Link></nav></div>
 <div className="voxWorkspace">
 <ScopedQueue kicker="PROSPECTS" title="Assigned prospects" rows={prospects} emptyLabel="No prospects assigned."/>
 <ScopedQueue kicker="FOLLOW-UPS" title="Aarohi tasks" rows={tasks} emptyLabel="No follow-ups assigned."/>
 </div>
 {process.env.VOX_OPERATIONAL_PROPOSAL_UI_ENABLED==="staging"&&process.env.VOX_FOLLOWUP_PROPOSALS_WEB_ENABLED!=="staging"?<StaffProposalForm kind="AAROHI_FOLLOWUP" targets={r.view.prospects.filter(p=>p.id&&!p.doNotContact&&!p.humanTakeover).map(p=>({id:p.id!,title:p.businessName}))}/>:null}
 {process.env.VOX_FOLLOWUP_PROPOSALS_WEB_ENABLED==="staging"?
 <AarohiFollowupProposal prospects={r.view.prospects.filter(p=>p.id&&!p.doNotContact&&!p.humanTakeover)
  .map(p=>({id:p.id!,businessName:p.businessName}))}/>:null}
 <div className="voxNotice"><b>Core conversion boundary</b><span>Existing Aarohi CRM owns acquisition. Registration intent, KYC, vendor activation, staff edits and provider messages require governed Core validation. This screen cannot approve them.</span></div>
 <footer className="voxBottom">QuickFurno VOX · Scoped acquisition queue · Staging gated</footer></main>;
}
