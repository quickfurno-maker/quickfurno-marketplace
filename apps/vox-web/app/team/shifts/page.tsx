import Link from "next/link";
import {fetchVerifiedTeamShifts} from "../../../lib/teamShifts";
import {fetchTeamTaskHistory} from "../../../lib/teamTaskHistory";
import TeamTaskHistory from "./TeamTaskHistory";
import {StaffSignInLink} from "../../components/StaffSignInLink";
import "../workflow.css";
export const dynamic="force-dynamic";
const duration=(ms:number)=>{const n=Math.floor(ms/60000);
 return Math.floor(n/60)+"h "+String(n%60).padStart(2,"0")+"m";};
export default async function TeamShiftReports(){
 const [r,taskHistory]=await Promise.all([
  fetchVerifiedTeamShifts(),fetchTeamTaskHistory()
 ]);
 return <main className="voxFlow">
  <nav className="voxFlowNav"><Link href="/team">Team Operations</Link>
   <span aria-hidden="true">/</span><span>Current Team Shifts</span></nav>
  <header className="voxFlowHero">
   <span className="voxFlowEyebrow">Current verified Core roster · Team Leader AAL2</span>
   <h1>Team Shift Overview</h1>
   <p>Only current-shift time confirmed by Core. No synthetic activity, complete EOD,
    payroll claims, webcam monitoring or inferred presence.</p>
   <span className="voxFlowStatus">Read-only · Staff scope</span>
  </header>
  {!r.ok?<section className="voxFlowCard" role="status">
    <h2>Verified team shifts unavailable</h2>
    <p className="voxFlowMuted">{r.status===401?"Verified Staff MFA required.":
     r.status===403?"Current Team Leader authorization denied.":
     "Current Core team shifts are not independently certified on managed Staging."}</p>
    <StaffSignInLink status={r.status} returnTo="/team/shifts"/>
    <Link href="/team">Return to Team Operations</Link>
   </section>:<>
    <section className="voxFlowCard" aria-labelledby="team-shift-summary">
     <h2 id="team-shift-summary">Current verified roster</h2>
     <p className="voxFlowMuted">{r.staffCount} verified Staff references in this bounded
      team window. This is neither a historical attendance total nor proof of online presence.</p>
     <ul className="voxFlowList">
      <li className="voxFlowRow"><strong>Elapsed attendance</strong><span>{duration(r.totals.attendanceMs)}</span></li>
      <li className="voxFlowRow"><strong>Break time</strong><span>{duration(r.totals.breakMs)}</span></li>
      <li className="voxFlowRow"><strong>Task time</strong><span>{duration(r.totals.taskMs)}</span></li>
      <li className="voxFlowRow"><strong>Unattributed current-shift time</strong><span>{duration(r.totals.unattributedMs)}</span></li>
     </ul>
     <p className="voxFlowMuted">As observed by Core at
      <time dateTime={r.asOf}> {r.asOf.slice(0,19)} UTC</time>.</p>
    </section>
    <section className="voxFlowCard" aria-labelledby="team-shift-staff">
     <h2 id="team-shift-staff">Current Staff references</h2>
     {r.staff.length===0?<p role="status">No verified Staff in this current window.</p>:
      <ul className="voxFlowList">{r.staff.map(item=>
       <li className="voxFlowRow" key={item.staffRef}>
        <div><strong>{item.staffRef}</strong><p>{item.status.replaceAll("_"," ")}</p></div>
        <div><p>Attendance: {duration(item.attendanceMs)}</p>
         <p>Tasks: {duration(item.taskMs)} · Breaks: {duration(item.breakMs)}</p></div>
       </li>)}</ul>}
    </section>
   </>}
  <TeamTaskHistory result={taskHistory}/>
  <p className="voxFlowMuted">These values never authorize payroll, official EOD,
   performance scoring or customer/vendor contact.</p>
 </main>;
}
