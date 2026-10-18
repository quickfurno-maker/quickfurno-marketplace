import Link from "next/link";
import {fetchStaffEodPreview} from "../../../lib/eod";
import {fetchAb5SourceCheckpoints} from "../../../lib/ab5SourceCheckpoint";
import "./report.css";
export const dynamic="force-dynamic";
const metrics=[
 {key:"claims",title:"Claims"},
 {key:"starts",title:"Work started"},
 {key:"completions",title:"Completions"},
 {key:"blocks",title:"Blocks"},
 {key:"approvalRequests",title:"Approval requests"},
 {key:"externalWaits",title:"Waiting externally"},
 {key:"resumptions",title:"Resumptions"}
] as const;
/** Counts come only from Core verified Staff work events, never from VOX UI. */
export default async function MyDailyReport(){
 const [r,checkpoints]=await Promise.all([
  fetchStaffEodPreview(),fetchAb5SourceCheckpoints()
 ]);
 return <main className="voxReport">
  <nav className="voxReportBreadcrumb" aria-label="Breadcrumb">
   <Link href="/team">Team Operations</Link><span aria-hidden="true">/</span>
   <span>My Daily Activity</span>
  </nav>
  <header className="voxReportHero">
   <p className="voxReportEyebrow">Verified Core work events · India Standard Time</p>
   <h1>My Daily Activity</h1>
   <p>A private, read-only activity preview for your current business day.
    It is not a final daily report, a team total, or proof that messages were delivered.</p>
   <span className="voxReportBadge">Partial · not submitted</span>
  </header>
  {!r.ok?<section role="status" className="voxReportCard">
   <h2>Activity preview is locked</h2>
   <p>{r.status===401?"Sign in with your verified Staff MFA session.":
    r.status===403?"Your current Core Staff permissions do not allow this view.":
    "Protected VOX staging authorization or source evidence is unavailable."}</p>
   <p>No activity figures are shown when Core cannot verify the source.</p>
   <Link href="/team">Return to Team Operations</Link>
  </section>:<>
   <section aria-labelledby="activity-counts" className="voxReportCard">
    <div className="voxReportHeading"><h2 id="activity-counts">Current-day work activity</h2>
     <span className="voxReportTag">{r.businessDate} · IST</span></div>
    <p className="voxReportWarning" role="status">
     Partial Core work ledger only. CRM, service desk and agent activity are not
     certified as complete. Never use these numbers as official productivity totals.
    </p>
    <div className="voxReportGrid">
     {metrics.map(m=><article className="voxReportMetric" key={m.key}>
      <span className="voxReportMetricName">{m.title}</span>
      <strong>{r.counts[m.key]}</strong>
     </article>)}
    </div>
    <p className="voxReportSummary">Verified Core work transitions in this bounded preview:
     <strong> {r.eventsIncluded}</strong></p>
    <p className="voxReportRestriction">This preview cannot submit or acknowledge work. A separate staging-gated
     partial Core report workflow requires independent Team Leader review.
     Export and automated delivery are not enabled.</p>
   </section>
   <section aria-labelledby="next-actions" className="voxReportCard">
    <h2 id="next-actions">Follow up on current work</h2>
    <p>Review your authorized assignments or outstanding attention items.
     These links do not claim or change work on your behalf.</p>
    <div className="voxReportLinks">
     <Link href="/team/work-queue">My Work Queue</Link>
     <Link href="/team/attention">Needs Attention</Link>
     <Link href="/team/eod-submissions">Governed partial submissions</Link>
    </div>
   </section>
  </>}
  <section className="voxReportCard" aria-labelledby="ab5-sources-title">
   <h2 id="ab5-sources-title">Previous-day canonical source checkpoints</h2>
   <p>Separate from today's Core Work preview. Counts below are from an
    incomplete, read-only source checkpoint; they are not official Staff
    productivity, cryptographically verified EOD, or proof of sent messages.</p>
   {!checkpoints.ok?<p role="status">{checkpoints.status===401?
    "A verified Staff MFA session is required.":checkpoints.status===403?
    "Your current Core source permissions do not allow this view.":
    "Four-source checkpoint inventory is not enabled in protected staging."}</p>:
    <>
     <p className="voxReportWarning" role="status">Business day {checkpoints.businessDate} IST ·
      Not cryptographically certified · Cannot submit or approve</p>
     <div className="voxReportGrid">{checkpoints.checkpoints.map(row=><article
      className="voxReportMetric" key={row.source}>
       <span className="voxReportMetricName">{row.source.replaceAll("_"," ")}</span>
       <strong>{row.present?row.count:"Not recorded"}</strong>
      </article>)}</div>
    </>}
  </section>
 </main>;
}
