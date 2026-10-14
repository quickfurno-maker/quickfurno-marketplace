import Link from "next/link";
import {fetchScopedServiceDesk} from "../../lib/core";
import {ScopedQueue} from "../components/ScopedQueue";
import {StaffProposalForm} from "../components/StaffProposalForm";
import {SupportFollowup} from "./components/SupportFollowup";
import "../components/scoped-queue.css";
import "../operations/operations.css";
export const dynamic="force-dynamic";
export default async function ServiceDesk(){
 const r=await fetchScopedServiceDesk();
 if(!r.ok)return <main className="hold"><section className="holdCard">
 <p className="kicker">VOX / HUMAN DESK</p><h1>Service Desk unavailable</h1>
 <p>AAL2 staff sign-in, an assigned Core vendor/case, and a current conversation grant are required.</p><Link href="/login">Staff sign-in</Link></section></main>;
 const cases=r.view.support.map(c=>({id:c.threadId??"",title:"Case "+(c.threadId?.slice(0,8)??"unknown"),
  detail:"Priority "+c.priority+" · Age "+c.ageBand+" · SLA not configured",
  state:c.state,attention:["high","urgent"].includes(c.priority.toLowerCase())}));
 const human=r.view.humanInbox.map(c=>({id:c.conversationId??"",title:c.lane+" HUMAN handover",
  detail:"Conversation #"+(c.conversationId?.slice(0,8)??"unknown")+" · Service window: "+c.serviceWindow,
  state:c.state,attention:c.serviceWindow==="OPEN"}));
 return <main className="voxOps"><header className="voxTop"><div className="voxLogo">V</div><div><b>VOX / SERVICE DESK</b>
  <small>Native Core support and governed HUMAN WhatsApp</small></div><div className="voxSession">ASSIGNED ONLY · READ ONLY</div></header>
 <div className="voxHero"><p className="kicker">SERVICE CASES / AAROHI + ANISHA</p>
  <h1>Resolve with context.<br/><span>Act only with approval.</span></h1>
 <p>Search assigned support cases and Core HUMAN conversation metadata. Client/Riya conversations and AI-owned threads are excluded. No raw messages or direct provider sends.</p>
 <nav aria-label="Staff workspaces"><Link href="/operations" style={{color:"#9decc8"}}>Mission Control</Link> · <Link href="/acquisition" style={{color:"#9decc8"}}>Aarohi CRM</Link> · <Link href="/vendor360" style={{color:"#9decc8"}}>Vendor 360</Link></nav></div>
 <div className="voxWorkspace">
  <ScopedQueue kicker="SUPPORT" title="Assigned service cases" rows={cases} emptyLabel="No service cases assigned."/>
  <ScopedQueue kicker="HUMAN" title="Aarohi and Anisha handovers" rows={human} emptyLabel="No assigned HUMAN handovers."/>
 </div>
 {process.env.VOX_OPERATIONAL_PROPOSAL_UI_ENABLED==="staging"?<StaffProposalForm kind="SUPPORT_REPLY" targets={r.view.support.filter(c=>c.threadId).map(c=>({id:c.threadId!,title:"Case "+c.threadId!.slice(0,8)}))}/>:null}
 {process.env.VOX_SUPPORT_TASK_UI_ENABLED==="staging"?<SupportFollowup cases={r.view.support.filter(c=>c.threadId).map(c=>({id:c.threadId!,title:"Case "+c.threadId!.slice(0,8)}))}/>:null}
 <div className="voxNotice"><b>Core service boundary</b><span>Replies, handover, case close, assignment and SLA actions remain disabled pending native Core atomic approval, conversation revision and provider delivery certification.</span></div>
 <footer className="voxBottom">QuickFurno VOX · Staff operations · No direct WhatsApp sends</footer></main>;
}
