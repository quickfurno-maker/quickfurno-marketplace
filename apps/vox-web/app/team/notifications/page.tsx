import Link from "next/link";
import {fetchStaffNotifications} from "../../../lib/staffNotifications";
import MarkRead from "./MarkRead";
import "../workflow.css";
export const dynamic="force-dynamic";
const descriptions:Record<string,string>={
 CLAIM:"Core work claimed",START:"Core work started",
 COMPLETE:"Core work completed",BLOCK:"Core work blocked",
 REQUEST_APPROVAL:"Core approval requested",WAIT_EXTERNAL:"Core work waiting externally",
 RESUME:"Core work resumed"
};
export default async function StaffNotifications(){
 const state=await fetchStaffNotifications();
 return <main className="voxFlow">
  <nav className="voxFlowNav" aria-label="Breadcrumb">
   <Link href="/team">Team Operations</Link><span aria-hidden="true">/</span>
   <span>Work Notifications</span>
  </nav>
  <header className="voxFlowHero">
   <span className="voxFlowEyebrow">Core persisted events · internal inbox</span>
   <h1>Work Notifications</h1>
   <p>Only work events from your currently authorized team and source-object grants.
    These are <strong>not</strong> mobile push deliveries, WhatsApp messages,
    customer messages or a complete notification history.</p>
   <span className="voxFlowStatus">In-app only · current Staff scope</span>
  </header>
  {!state.ok?<section className="voxFlowCard" role="status">
   <h2>Notification inbox is locked</h2>
   <p className="voxFlowMuted">{state.status===401?
    "Sign in using verified Staff MFA.":state.status===403?
    "Core has denied the current Staff team/subject scope.":
    "Independent protected staging approval and Core event evidence are required."}</p>
   <Link href="/team/attention">Back to Needs Attention</Link>
  </section>:<section className="voxFlowCard" aria-labelledby="inboxTitle">
   <h2 id="inboxTitle">Recent authorized work events</h2>
   <p className="voxFlowMuted">Unread within this bounded window:
    <strong> {state.unreadInWindow}</strong>. This is not the total unread
    notification count. Automatic notifications and push delivery are not certified.</p>
   {state.records.length===0?<p role="status">No persisted notifications
    appear in this authorized window.</p>:<ul className="voxFlowList">
     {state.records.map(n=><li className="voxFlowRow" key={n.notificationId}>
      <div><span>{n.read?"Read":"Unread"} · Internal Core event</span>
       <p>{descriptions[n.eventKind]??"Core work-event update"}</p>
       <time dateTime={n.createdAt}>{n.createdAt.slice(0,16)} UTC</time>
      </div>
      {!n.read?<MarkRead notificationId={n.notificationId}/>:null}
     </li>)}
    </ul>}
   <div className="voxFlowLinks">
    <Link href="/team/work-queue">Open Work Queue</Link>
    <Link href="/team/attention">Needs Attention</Link>
   </div>
  </section>}
 </main>;
}
