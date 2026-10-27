import Link from "next/link";
import {fetchStaffSourceReadiness} from "../../../lib/clientSourceStatus";
import "../workflow.css";
export const dynamic="force-dynamic";
const label=(s:string)=>s.replaceAll("_"," ").toLowerCase();
export default async function EodSourceReadiness(){
 const r=await fetchStaffSourceReadiness();
 return <main className="voxFlow">
  <nav className="voxFlowNav"><Link href="/team/command-center">Command Center</Link>
   <span>/</span><span>EOD Sources</span></nav>
  <header className="voxFlowHero">
   <span className="voxFlowEyebrow">Four real Core source-existence checks</span>
   <h1>Daily Report · Source Readiness</h1>
   <p>Independent source availability is not verified employee performance.
    Actual CRM, support and Jarvis event watermarks remain uncertified.</p>
   <span className="voxFlowStatus">Final all-source total unavailable</span>
  </header>
  {!r.ok?<section role="status" className="voxFlowCard">
   <h2>Source status is locked</h2>
   <p>A current approved Staff MFA session and Core source permissions
    are required. No missing data is treated as zero.</p>
  </section>:<section className="voxFlowCard">
   <h2>Verified source objects vs. event evidence</h2>
   <ul className="voxFlowList">{r.sources.map(s=>
    <li className="voxFlowRow" key={s.source}>
     <div><strong>{label(s.source)}</strong>
      <p>Reader: {label(s.readiness)}</p>
      <small>Activity events: {label(s.eventProvenance)}</small>
     </div><span>{s.scoped?"Scoped Core read":"Not independently verified"}</span>
    </li>)}</ul>
   <p className="voxFlowMuted">Report submission, export and aggregate totals
    are disabled here. The separate Core-work-only EOD remains partial.</p>
  </section>}
 </main>;
}
