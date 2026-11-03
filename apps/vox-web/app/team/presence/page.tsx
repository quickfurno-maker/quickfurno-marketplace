import Link from "next/link";
import {fetchVerifiedTeamPresence} from "../../../lib/teamPresence";
import {StaffSignInLink} from "../../components/StaffSignInLink";
import "../workflow.css";
export const dynamic="force-dynamic";
export default async function TeamPresence(){
 const result=await fetchVerifiedTeamPresence();
 return <main className="voxFlow">
  <nav className="voxFlowNav" aria-label="Breadcrumb">
   <Link href="/team">Team Operations</Link><span aria-hidden="true">/</span>
   <span>Team Presence</span>
  </nav>
  <header className="voxFlowHero">
   <span className="voxFlowEyebrow">QuickFurno · Private current team scope</span>
   <h1>Team Presence</h1>
   <p>Ephemeral connection hints from verified Core observations. No browser
    activity monitoring, online-time billing, attendance inference or payroll.</p>
   <span className="voxFlowStatus">Read-only · not Realtime connected</span>
  </header>
  {!result.ok?<section className="voxFlowCard" role="status">
   <h2>Presence source is locked</h2>
   <p>{result.status===401?"Verified Staff MFA is required.":
    result.status===403?"Current Team Leader or Staff scope is denied.":
    "The private Core presence source is not independently certified for protected Staging."}</p>
   <StaffSignInLink status={result.status} returnTo="/team/presence"/>
   <Link href="/team">Return to Team Operations</Link>
  </section>:<>
   <section className="voxFlowCard">
    <h2>Current verified roster</h2>
    <p className="voxFlowMuted">Snapshot observed at
     <time dateTime={result.asOf}> {result.asOf.slice(0,19)} UTC</time>.
     This is not a live subscription or an attendance report.</p>
    <p className="voxFlowMuted">{result.unknownStaffCount} unobserved Staff.
     Unobserved never means offline.</p>
    {result.entries.length===0?<p role="status">No verified Staff in this current window.</p>:
     <ul className="voxFlowList">{result.entries.map(entry=>
      <li className="voxFlowRow" key={entry.staffRef}>
       <strong>{entry.staffRef}</strong><span>{entry.state.replaceAll("_"," ")}</span>
      </li>)}</ul>}
   </section>
  </>}
  <p className="voxFlowMuted">Presence does not indicate hours worked,
   task completion, Google Meet attendance, EOD or staff productivity.</p>
 </main>;
}
