import Link from "next/link";
import {fetchStaffWorkQueuePreview} from "../../../lib/core";
import "./queue.css";
export const dynamic="force-dynamic";
/** Every item is masked Core-reconciled metadata. No browser Auth, client IDs
 * or staff-to-agent messaging is ever exposed by this page.
 */
export default async function VoxMyWorkQueue(){
 const result=await fetchStaffWorkQueuePreview();
 return <main className="voxQueueRoot">
  <nav aria-label="Workspace breadcrumb" className="voxQueueNav">
   <Link href="/team">VOX Team Operations</Link><span aria-hidden="true">/</span>
   <span>My Work</span>
  </nav>
  <header className="voxQueueHero">
   <p className="voxQueueEyebrow">ONE STAFF LOGIN · CURRENT CORE PERMISSIONS</p>
   <h1>My Work Queue</h1>
   <p>Private, read-only task preview. Assignment, reply and approval actions remain disabled until independently certified.</p>
  </header>
  {!result.ok?
   <section role="status" className="voxQueueCard">
    <h2>My Work is currently locked</h2>
    <p>{result.status===401?"Use your existing verified MFA Staff sign-in.":
      result.status===403?"Your current Core Staff permissions do not allow this view.":
      "This workspace requires protected Core authorization and an approved staging release."}</p>
    <Link href="/team">Return to Team Operations</Link>
   </section>:
   <section className="voxQueueCard" aria-labelledby="voxQueueListTitle">
    <div className="voxQueueTitle">
     <h2 id="voxQueueListTitle">Current authorized work</h2>
     <span className="voxQueueTag">Read-only · bounded preview</span>
    </div>
    <p className="voxQueueCaution">
     Only currently permitted tasks are shown. This is not a total team or daily workload count.
    </p>
    {result.items.length===0?<p role="status">No currently authorized tasks appear in this bounded preview.</p>:
     <ul className="voxQueueList">
      {result.items.map(item=><li key={item.workItemId} className="voxQueueItem">
       <div><span className="voxQueueKind">{item.kind.replaceAll("_"," ")}</span>
        <h3>Work item {item.workItemId.slice(0,8)}</h3>
        <p>{item.state.replaceAll("_"," ")} · Revision {item.revision}</p>
       </div>
       <div className="voxQueueSide">
        <span>{item.assignedToMe?"Assigned to me":"Unassigned eligible"}</span>
        <time dateTime={item.updatedAt}>{item.updatedAt.slice(0,10)} UTC</time>
        <button type="button" disabled aria-label="Actions not enabled">Actions locked</button>
       </div>
      </li>)}
     </ul>}
   </section>}
 </main>;
