import Link from "next/link";
import {fetchTeamLeaderReviewQueue} from "../../lib/core";
import {ReviewConsole,type PendingRequest} from "./ReviewConsole";
import "../operations/operations.css";
export const dynamic="force-dynamic";
export default async function StaffReviews(){
 const r=await fetchTeamLeaderReviewQueue();
 if(!r.ok)return <main className="hold"><section className="holdCard">
  <p className="kicker">VOX / STAFF IAM</p><h1>Review queue unavailable</h1>
  <p>Only a verified, MFA-enrolled Team Leader with an active assigned Core team can review staff access requests. The workflow is disabled until certified private Staging.</p>
  <Link href="/operations">Return to operations</Link></section></main>;
 const pending=r.pending.filter(p=>p.requestId&&p.targetId&&p.revision===0) as PendingRequest[];
 return <main className="voxOps"><header className="voxTop"><div className="voxLogo">V</div>
  <div><b>VOX / TEAM LEADER</b><small>Governed Core access review</small></div>
  <div className="voxSession">AAL2 · EXACT TEAM</div></header>
 <div className="voxHero"><p className="kicker">TWO-PERSON ACCESS CONTROL</p>
 <h1>Review with confidence.<br/><span>Never self-approve.</span></h1>
 <p>Only pending requests for your authorized Core team appear. A review cannot activate staff access by itself; an independently verified owner finalizes approved requests.</p></div>
 <ReviewConsole pending={pending}/>
 <div className="voxNotice"><b>Immutable identity</b><span>Permissions attach to the verified internal staff user ID, not the email address. Team Leader changes and emergency access revocation remain owner-governed.</span></div>
 <footer className="voxBottom"><Link href="/operations">Return to Mission Control</Link> · No unrestricted Superadmin delegation</footer></main>;
}
