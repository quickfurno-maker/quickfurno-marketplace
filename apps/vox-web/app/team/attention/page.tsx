import Link from "next/link";
import {fetchStaffWorkQueuePreview} from "../../../lib/core";
import {projectStaffAttention} from "../../../lib/attention";
import {StaffSignInLink} from "../../components/StaffSignInLink";
import "./attention.css";
export const dynamic="force-dynamic";
export default async function StaffAttention(){
 const queue=await fetchStaffWorkQueuePreview();
 const view=queue.ok?projectStaffAttention(queue.items):null;
 return <main className="voxAttention">
  <nav aria-label="Breadcrumb" className="voxAttentionTrail">
   <Link href="/team">Team Operations</Link><span aria-hidden="true">/</span>
   <span>Needs Attention</span></nav>
  <header className="voxAttentionHead">
   <span className="voxAttentionKicker">Core-authorized work · read-only</span>
   <h1>Needs Attention</h1>
   <p>Work items that may need your follow-up, derived only from your
    currently authorized bounded queue. These are <strong>not</strong> delivered
    notifications, messages, or complete team totals.</p>
  </header>
  {!queue.ok||!view?.ok?<section className="voxAttentionPanel" role="status">
   <h2>Attention view is unavailable</h2>
   <p>{queue.status===401?"Please sign in with verified Staff MFA.":
    queue.status===403?"Core has not authorized your current Staff scope.":
    "Protected queue access or its source evidence is unavailable."}</p>
   <StaffSignInLink status={queue.status}/>
   <Link href="/team">Return to Team Operations</Link>
  </section>:<section className="voxAttentionPanel" aria-labelledby="attentionTitle">
   <div className="voxAttentionTitle">
    <h2 id="attentionTitle">Items requiring review</h2>
    <span>Bounded preview · not a total</span></div>
   <p className="voxAttentionCaution">Nothing is automatically claimed,
    notified, approved or replied to. Your Core assignments remain unchanged.</p>
   {view.items.length===0?<p role="status">No attention items appear in your
    current bounded work preview.</p>:
    <ul className="voxAttentionList">
     {view.items.map(item=><li className="voxAttentionItem" key={item.workItemId}>
      <div><span className="voxAttentionStatus">{item.attentionType}</span>
       <h3>Work {item.workItemId.slice(0,8)}</h3>
       <p>{item.kind.replaceAll("_"," ")} · Revision {item.revision}</p></div>
      <div><span>{item.assignedToMe?"Assigned to me":"Unassigned eligible"}</span>
       <time dateTime={item.updatedAt}>{item.updatedAt.slice(0,10)} UTC</time></div>
     </li>)}
    </ul>}
   <div className="voxAttentionBottom">
    <Link href="/team/work-queue">Open My Work</Link>
    <Link href="/team/daily-report">My Daily Activity</Link>
   </div>
  </section>}
 </main>;
}
