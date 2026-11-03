import Link from "next/link";
import {fetchTeamAssignments} from "../../../lib/teamAssignments";
import {StaffSignInLink} from "../../components/StaffSignInLink";
import TeamAssignmentControl from "./TeamAssignmentControl";
import "./assignments.css";
export const dynamic="force-dynamic";
export default async function TeamAssignments(){
 const r=await fetchTeamAssignments();
 return <main className="voxTl">
  <nav className="voxTlNav"><Link href="/team">Team Operations</Link><span>/</span><span>Team Leader assignments</span></nav>
  <header className="voxTlHero"><span className="voxTlEyebrow">QuickFurno · Core-authorized Team Leader</span>
   <h1>Delegate team work</h1>
   <p>Only existing tasks within your verified team and city. No customer details or vendor lead-matching operations.</p></header>
  {!r.ok?<section className="voxTlCard" role="status">
   <h2>Delegation is locked</h2>
   <p>{r.status===401?"Staff MFA required.":r.status===403?"Current Team Leader scope denied.":
    "Managed Team Leader writer and protected Staging integration are not yet certified."}</p>
   <StaffSignInLink status={r.status} returnTo="/team/assignments"/>
   <Link href="/team">Return to Team Operations</Link>
  </section>:<>
   <section className="voxTlCard"><h2>Current authorized team window</h2>
    <div className="voxTlMetrics"><div><strong>{r.items.length}</strong><span>Unassigned task references</span></div>
    <div><strong>{r.staff.length}</strong><span>Staff references</span></div></div>
    <p>Bounded previews, not complete totals. Core SQL revalidates eligibility before any assignment.</p>
   </section>
   <TeamAssignmentControl items={r.items} staff={r.staff}/>
  </>}
  <footer className="voxTlFoot">Core AAL2 and original nonce required · No provider, marketplace lead or money mutation</footer>
 </main>;
}
