import Link from "next/link";
import {fetchStaffWorkQueuePreview} from "../../../lib/core";
import {fetchAb3DomainWindow} from "../../../lib/ab3Domain";
import {StaffSignInLink} from "../../components/StaffSignInLink";
import WorkActionControl from "./WorkActionControl";
import "./queue.css";
export const dynamic="force-dynamic";
/** Existing one Staff login and current Core object/city/team grants.
 * Queue is bounded and current; UI forms never grant a work transition.
 */
export default async function VoxMyWorkQueue(){
 const [result,department]=await Promise.all([
  fetchStaffWorkQueuePreview(),fetchAb3DomainWindow()
 ]);
 const actionUiEnabled=process.env.VOX_WORK_ACTIONS_UI_ENABLED==="staging"&&
  process.env.VOX_WORK_ACTIONS_ENABLED==="staging"&&
  process.env.VOX_STAFF_PORTAL_ENABLED==="staging"&&
  process.env.VOX_TEAM_WORKSPACE_ENABLED==="staging"&&
  ["scoped","dual"].includes(String(process.env.VOX_STAFF_VIEW_MODE));
 return <main className="voxQueueRoot">
  <nav className="voxQueueNav" aria-label="Workspace breadcrumb">
   <Link href="/team">VOX Team Operations</Link>
   <span aria-hidden="true">/</span><span>My Work</span>
  </nav>
  <header className="voxQueueHero">
   <p className="voxQueueEyebrow">ONE STAFF LOGIN · CURRENT CORE PERMISSIONS</p>
   <h1>My Work Queue</h1>
   <p>Core-scoped work metadata. Atomic claim, start, block, wait, resume,
    approval request and completion are available only when independently
    certified in protected staging. Client replies and Team Leader
    approvals remain separate governed flows.</p>
  </header>
  <section className="voxQueueCard" aria-labelledby="ab3-domain-window-title">
   <h2 id="ab3-domain-window-title">My verified department lane</h2>
   {!department.ok?<p role="status">{department.status===401?
    "Verified Staff MFA required.":department.status===403?
    "Current Core department or item grants do not permit this lane.":
    "Department-only Core work is not activated in protected staging."}</p>:
    <>
     <p className="voxQueueCaution">Read-only, bounded {department.items.length} items
      for {department.department.replaceAll("_"," ")}. Not a workload total or
      an authorization to send messages, claim work or open the next page.</p>
     {department.items.length===0?<p role="status">No authorized work in this bounded lane.</p>:
      <ul className="voxQueueList">{department.items.map(item=><li className="voxQueueItem" key={item.id}>
       <div><span className="voxQueueKind">{item.kind.replaceAll("_"," ")}</span>
        <h3>Work {item.id.slice(0,8)}</h3>
        <p>{item.state.replaceAll("_"," ")}</p></div>
       <time dateTime={item.updatedAt}>{item.updatedAt.slice(0,16)} UTC</time>
      </li>)}</ul>}
    </>}
  </section>
  {!result.ok?
   <section className="voxQueueCard" role="status">
    <h2>My Work is currently locked</h2>
    <p>{result.status===401?
      "Use your existing verified MFA Staff sign-in.":
      result.status===403?
      "Your current Core Staff permissions do not allow this view.":
      "This workspace requires protected Core authorization and an approved staging release."}</p>
    <StaffSignInLink status={result.status}/>
    <Link href="/team">Return to Team Operations</Link>
   </section>:
   <section className="voxQueueCard" aria-labelledby="voxQueueListTitle">
    <div className="voxQueueTitle">
     <h2 id="voxQueueListTitle">Current authorized work</h2>
     <span className="voxQueueTag">Core-scoped · bounded preview</span>
    </div>
    <p className="voxQueueCaution">
     Only currently permitted tasks are shown, never team-wide totals or
     an official daily performance report.</p>
    {result.items.length===0?
     <p role="status">No currently authorized work in this bounded preview.</p>:
     <ul className="voxQueueList">{result.items.map(item=>
      <li className="voxQueueItem" key={item.workItemId}>
       <div>
        <span className="voxQueueKind">{item.kind.replaceAll("_"," ")}</span>
        <h3>Work item {item.workItemId.slice(0,8)}</h3>
        <p>{item.state.replaceAll("_"," ")} · Revision {item.revision}</p>
       </div>
       <div className="voxQueueSide">
        <span>{item.assignedToMe?"Assigned to me":"Unassigned eligible"}</span>
        <time dateTime={item.updatedAt}>{item.updatedAt.slice(0,10)} UTC</time>
        {actionUiEnabled?
         <WorkActionControl itemId={item.workItemId} revision={item.revision}
          state={item.state} assignedToMe={item.assignedToMe}/>:
         <button type="button" disabled aria-label="Actions not independently activated">
          Actions locked</button>}
       </div>
      </li>)}</ul>}
   </section>}
 </main>;
}
