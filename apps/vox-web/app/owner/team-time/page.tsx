import Link from "next/link";
import {fetchOwnerTeamTime} from "../../../lib/ownerTeamTime";
import {StaffSignInLink} from "../../components/StaffSignInLink";
import "../../team/workflow.css";
export const dynamic="force-dynamic";
const duration=(ms:number)=>{
 const m=Math.floor(ms/60000);return Math.floor(m/60)+"h "+String(m%60).padStart(2,"0")+"m";
};
export default async function OwnerTeamTime(){
 const r=await fetchOwnerTeamTime();
 return <main className="voxFlow">
  <nav className="voxFlowNav" aria-label="Breadcrumb"><Link href="/operations">Operations</Link>
   <span aria-hidden="true">/</span><span>Owner Team Time</span></nav>
  <header className="voxFlowHero">
   <span className="voxFlowEyebrow">Owner AAL2 • Current Core time</span>
   <h1>Virtual Office — Team Time</h1>
   <p>Current attendance and task-time references across a bounded Staff window.
    No webcam, keyboard monitoring, inferred availability, salary calculation or automated performance scoring.</p>
   <span className="voxFlowStatus">Owner-only • Read-only • Staging gated</span>
  </header>
  {!r.ok?<section className="voxFlowCard" role="status">
    <h2>Team-time source unavailable</h2>
    <p>{r.status===401?"Verified Owner MFA is required.":
      r.status===403?"Core denied current Owner authorization.":
       "The managed time source and Owner review are not yet certified for Staging."}</p>
    <StaffSignInLink status={r.status} returnTo="/owner/team-time"/>
    <Link href="/operations">Return to Operations</Link>
   </section>:<>
   <section className="voxFlowCard" aria-labelledby="owner-time-window">
    <h2 id="owner-time-window">Verified current snapshot</h2>
    <p className="voxFlowMuted">{r.staffCount} Staff references in this first bounded window
     {r.hasMore?". More eligible staff exist outside this window.":"."}
     These are not company-wide totals or all-shift history.</p>
    <ul className="voxFlowList">
     <li className="voxFlowRow"><strong>Elapsed attendance</strong><span>{duration(r.attendanceMs)}</span></li>
     <li className="voxFlowRow"><strong>Recorded task time</strong><span>{duration(r.taskMs)}</span></li>
     <li className="voxFlowRow"><strong>Recorded breaks</strong><span>{duration(r.breakMs)}</span></li>
     <li className="voxFlowRow"><strong>Unattributed time</strong><span>{duration(r.unattributedMs)}</span></li>
    </ul>
   </section>
   <section className="voxFlowCard" aria-labelledby="owner-time-staff">
    <h2 id="owner-time-staff">Current Staff references</h2>
    {r.staff.length===0?<p role="status">No eligible Staff in this verified window.</p>:
     <ul className="voxFlowList">{r.staff.map(item=>
      <li className="voxFlowRow" key={item.staffRef}>
       <div><strong>{item.staffRef}</strong><p>{item.teamRef} · {item.status.replaceAll("_"," ")}</p></div>
       <div><p>Attendance {duration(item.attendanceMs)}</p>
        <p>Tasks {duration(item.taskMs)} · Breaks {duration(item.breakMs)}</p></div>
      </li>
     )}</ul>}
    <p className="voxFlowMuted">Snapshot taken at
     <time dateTime={r.asOf}> {new Date(r.asOf).toISOString().slice(0,19)} UTC</time>.
     Staff status is a timekeeping state, never proof of online presence.</p>
   </section>
  </>}
  <footer className="voxFlowMuted">Core-verified current shift only. No payroll,
   official EOD, workforce surveillance, staff impersonation or customer contact.</footer>
 </main>;
}
