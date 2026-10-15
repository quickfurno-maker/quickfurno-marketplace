import Link from "next/link";
import {fetchOwnerOperationalIntents,fetchApprovedNativeFollowups} from "../../lib/core";
import {ApprovedFollowups,type FollowupRow} from "./ApprovedFollowups";
import {OwnerApprovals,type ApprovalRow} from "./OwnerApprovals";
import "../operations/operations.css";
export const dynamic="force-dynamic";
export default async function OwnerReview(){
 const [r,approved]=await Promise.all([fetchOwnerOperationalIntents(),fetchApprovedNativeFollowups()]);
 if(!r.ok)return <main className="hold"><section className="holdCard">
  <p className="kicker">VOX / GOVERNANCE</p><h1>Owner / Admin approval queue unavailable</h1>
  <p>Requires a verified Superadmin MFA session, the private Core API and explicitly enabled private Staging. No actions or approvals can be executed.</p>
  <Link href="/operations">Mission Control</Link></section></main>;
 const rows=r.pending.filter(x=>x.id&&x.revision===0) as ApprovalRow[];
 return <main className="voxOps"><header className="voxTop"><div className="voxLogo">V</div>
 <div><b>VOX / OWNER / ADMIN</b><small>Single governed administrative console · Core approval decisions</small></div>
 <div className="voxSession">OWNER / ADMIN · CORE SUPERADMIN AAL2</div></header>
 <div className="voxHero"><p className="kicker">REVIEW / SAFETY FIRST</p>
 <h1>Approve the intent.<br/><span>Never bypass Core.</span></h1>
 <p>Staff proposals require independent review. Approval creates a Core audit decision, not a support message, vendor profile change, WhatsApp send or automatic follow-up.</p></div>
 <OwnerApprovals rows={rows}/>
 {approved.ok?<ApprovedFollowups rows={approved.pending.filter(x=>x.intentId&&x.revision===1) as FollowupRow[]}/>:null}
 <div className="voxNotice"><b>No automatic execution</b><span>Each future operational action still needs its own guarded, consent-aware Core execution contract and separate launch certification.</span></div>
 <footer className="voxBottom"><Link href="/operations">Back to Mission Control</Link></footer></main>;
}
