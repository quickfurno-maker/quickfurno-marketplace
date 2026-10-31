import Link from "next/link";
import {fetchMyEodSubmissions} from "../../../lib/teamWorkflow";
import {StaffSignInLink} from "../../components/StaffSignInLink";
import SubmitPartial from "./SubmitPartial";
import "../workflow.css";
export const dynamic="force-dynamic";
export default async function MyEodSubmissions(){
 const r=await fetchMyEodSubmissions();
 return <main className="voxFlow">
  <nav className="voxFlowNav" aria-label="Breadcrumb">
   <Link href="/team">Team Operations</Link><span aria-hidden="true">/</span>
   <span>My Report Submissions</span></nav>
  <header className="voxFlowHero"><span className="voxFlowEyebrow">
   Current-day verified Core ledger · independent reviewer required</span>
   <h1>My Report Submissions</h1>
   <p>Submit the partial Core work activity snapshot for a separate authorized
    Team Leader to acknowledge or reject. These are not complete daily reports.</p>
   <span className="voxFlowStatus">Partial source · governed review</span></header>
  {!r.ok?<section className="voxFlowCard" role="status">
   <h2>Submission is locked</h2>
   <p className="voxFlowMuted">{r.status===401?"A verified Staff MFA session is required.":
    r.status===403?"Core denied your current Staff scope.":
    "Human-reviewed staging activation and current Core source are required."}</p>
   <StaffSignInLink status={r.status}/>
   <Link href="/team/daily-report">View read-only activity preview</Link>
  </section>:<>
   <section className="voxFlowCard" aria-labelledby="submitHeading">
    <h2 id="submitHeading">Submit today's partial Core work</h2>
    <SubmitPartial/>
   </section>
   <section className="voxFlowCard" aria-labelledby="historyHeading">
    <h2 id="historyHeading">Recent submissions</h2>
    <p className="voxFlowMuted">Current Core authorization only; at most 16.
     No complete-history, final-report or all-source totals are implied.</p>
    {r.records.length===0?<p role="status">No reports in the authorized window.</p>:
     <ul className="voxFlowList">{r.records.map(item=>
      <li key={item.reportId} className="voxFlowRow">
       <div><span>{item.businessDate} · Core-only partial</span>
        <p>Work events: {item.eventCount} · {item.state.replaceAll("_"," ")}</p></div>
       <span>Revision {item.revision}</span>
      </li>)}</ul>}
   </section>
  </>}
 </main>;
}
