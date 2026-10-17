import Link from "next/link";
import {fetchStaffWorkQueuePreview} from "../../../lib/core";
import {fetchVerifiedUnifiedWorkspace} from "../../../lib/ui04Workspace";
import {fetchStaffNotifications} from "../../../lib/staffNotifications";
import {fetchStaffEodPreview} from "../../../lib/eod";
import {fetchScopedRiyaClientCases,fetchStaffSourceReadiness} from "../../../lib/clientSourceStatus";
import "../workflow.css";
import "./command-center.css";
export const dynamic="force-dynamic";
const modules=[
 ["My work & assignments","/team/work-queue","Only current Core-authorized work"],
 ["Needs attention","/team/attention","Core blockers and approval waits"],
 ["Internal team chat","/team/chat","Internal Staff-only conversation"],
 ["In-app notifications","/team/notifications","Persisted work events; not push delivery"],
 ["Daily activity","/team/daily-report","Core work ledger only; partial"],
 ["Four-source EOD readiness","/team/eod-sources","Real Core source objects, no fabricated event totals"],
 ["Riya client cases","/team/client-cases","Client-success grants and Google-verified read-only cases"],
 ["Governed EOD submission","/team/eod-submissions","Independent Team Leader review required"],
 ["Team Leader review","/team/eod-reviews","Never approve your own report"],
 ["Aarohi CRM","/acquisition","Authorized acquisition preview"],
 ["Vendor 360","/vendor360","Approved vendor-success scope"],
 ["Service Desk","/service-desk","Current support and handover metadata"]
] as const;
export default async function StaffCommandCenter(){
 const [work,notifications,eod,clientCases,sourceReadiness,unified]=await Promise.all([
  fetchStaffWorkQueuePreview(),fetchStaffNotifications(),fetchStaffEodPreview(),
  fetchScopedRiyaClientCases(),fetchStaffSourceReadiness(),fetchVerifiedUnifiedWorkspace()
 ]);
 const available=work.ok||notifications.ok||eod.ok||clientCases.ok||sourceReadiness.ok||unified.ok;
 return <main className="voxFlow voxCommandCenter">
  <nav className="voxFlowNav" aria-label="Breadcrumb">
   <Link href="/team">Team Operations</Link><span>/</span><span>Command Center</span>
  </nav>
  <header className="voxFlowHero">
   <span className="voxFlowEyebrow">One Staff login · Current Core grants</span>
   <h1>Staff Command Center</h1>
   <p>Assignments, queues, chats, daily activity and internal notifications.
    All panels are independently scoped; navigation never grants a new role.</p>
   <span className="voxFlowStatus">
    {available?"Bounded, partial Core source views":"Protected Staff workspace locked"}
   </span>
  </header>
  {!available?<section className="voxFlowCard" role="status">
   <h2>Operations data is locked</h2>
   <p>Use verified Staff MFA with approved Core team, city and subject grants.
    Unavailable data is not replaced by demonstration or synthetic metrics.</p>
  </section>:<section className="voxFlowCard" aria-labelledby="summary-title">
   <h2 id="summary-title">My authorized source windows</h2>
   <p className="voxFlowMuted">Individual bounded previews only; these are not
    company-wide totals or an official employee performance report.</p>
   <div className="voxCommandMetrics">
    <article><span>Work queue preview</span>
     <strong>{work.ok?String(work.items.length):"Locked"}</strong>
     <small>Current authorized items, not total workload</small></article>
    <article><span>In-app unread</span>
     <strong>{notifications.ok?String(notifications.unreadInWindow):"Locked"}</strong>
     <small>Bounded internal notifications, no push receipt</small></article>
    <article><span>Current Riya cases</span>
     <strong>{clientCases.ok?String(clientCases.items.length):"Locked"}</strong>
     <small>Scoped client metadata only · no replies</small></article>
    <article><span>Four-source report</span>
     <strong>{sourceReadiness.ok?"Incomplete":"Locked"}</strong>
     <small>No signed event watermarks or audited totals</small></article>
    <article><span>Today's Core work events</span>
     <strong>{eod.ok?String(eod.eventsIncluded):"Locked"}</strong>
     <small>Partial ledger only; CRM and agents not certified</small></article>
   </div>
  </section>}
  <section className="voxFlowCard" aria-labelledby="unified-workspace-title">
   <h2 id="unified-workspace-title">My unified Core work</h2>
   {!unified.ok?<p className="voxFlowMuted" role="status">
    {unified.status===401?"Verified Staff MFA required.":
     unified.status===403?"Current Core role or exact client grant does not permit this combined view.":
     "Combined Core work is not activated in protected staging."}
   </p>:<>
    <p className="voxFlowMuted">Read-only, bounded {unified.items.length}-item window.
     Separate Core authorization is enforced for each work item and client case.
     It is not the complete staff workload.</p>
    {unified.items.length===0?<p role="status">No authorized items in the current bounded window.</p>:
     <ul className="voxFlowList">{unified.items.map(item=><li key={item.referenceId} className="voxFlowRow">
       <div><span>{item.source==="CORE_CLIENT_RIYA"?"Riya client case":"Core work"}</span>
        <p>{item.subjectKind.replaceAll("_"," ")} · {item.state.replaceAll("_"," ")} · {item.referenceId.slice(0,8)}</p></div>
       <time dateTime={item.updatedAt}>{item.updatedAt.slice(0,16)} UTC</time>
      </li>)}</ul>}
   </>}
  </section>
  <section className="voxFlowCard" aria-labelledby="module-title">
   <h2 id="module-title">Department operations</h2>
   <div className="voxCommandModules">
    {modules.map(m=><article key={m[1]}>
     <h3>{m[0]}</h3><p>{m[2]}</p>
     <Link href={m[1]}>Open governed workspace <span aria-hidden="true">→</span></Link>
    </article>)}
    <article><h3>Riya · Client Support</h3>
     <p>Canonical client grants, signed Jarvis pause and consent-checked replies
      are still awaiting independent protected staging approval.</p>
     <span>Client handover actions disabled</span>
    </article>
   </div>
  </section>
  <footer className="voxFlowMuted">
   Core is authoritative. AGNI is advisory. No automatic privileges or provider replies.
  </footer>
 </main>;
}
