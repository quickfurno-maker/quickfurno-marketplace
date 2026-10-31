import Link from "next/link";
import {fetchTlEodQueue} from "../../../lib/teamWorkflow";
import {StaffSignInLink} from "../../components/StaffSignInLink";
import ReviewDecision from "./ReviewDecision";
import "../workflow.css";
export const dynamic="force-dynamic";
export default async function TeamLeaderPartialEodReview(){
 const r=await fetchTlEodQueue();
 return <main className="voxFlow">
  <nav className="voxFlowNav" aria-label="Breadcrumb"><Link href="/team">
   Team Operations</Link><span aria-hidden="true">/</span><span>Team Leader EOD Reviews</span></nav>
  <header className="voxFlowHero"><span className="voxFlowEyebrow">
   Independently reviewed Core work only</span>
   <h1>Team Leader EOD Reviews</h1>
   <p>Review exact-team Staff partial Core work reports.
    A report's author cannot review their own submission. Acknowledgment
    does not certify external messaging, CRM or agent productivity.</p>
   <span className="voxFlowStatus">Staff Team Leader AAL2 only</span>
  </header>
  {!r.ok?<section className="voxFlowCard" role="status">
   <h2>Independent reviewer authorization required</h2>
   <p className="voxFlowMuted">{r.status===401?"Use your verified MFA session.":
    r.status===403?"Only a different current Core Team Leader can review.":
    "Protected Core review approvals and eligible reports are unavailable."}</p>
   <StaffSignInLink status={r.status}/>
   <Link href="/team">Return to Team Operations</Link>
  </section>:<section className="voxFlowCard" aria-labelledby="reviewListTitle">
   <h2 id="reviewListTitle">Pending Core-only reports</h2>
   <p className="voxFlowMuted">A bounded 16-item view, not a complete team total.
    Decisions are checked again atomically by Core.</p>
   {r.pending.length===0?<p role="status">No current team reports pending review.</p>:
    <ul className="voxFlowList">{r.pending.map(item=>
     <li key={item.reportId} className="voxFlowRow">
      <div><span>{item.staffRef} · {item.businessDate}</span>
       <p>{item.eventCount} Core work events · Partial only · Revision {item.revision}</p>
       <ReviewDecision reportId={item.reportId}/></div>
     </li>)}</ul>}
  </section>}
 </main>;
}
