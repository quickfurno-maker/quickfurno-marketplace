import Link from "next/link";
import {ownerAdminHref} from "../../lib/ownerAdminLinks";
import {fetchOwnerOperationalIntents,fetchApprovedNativeFollowups} from "../../lib/core";
import {ApprovedFollowups,type FollowupRow} from "./ApprovedFollowups";
import {OwnerApprovals,type ApprovalRow} from "./OwnerApprovals";
import "../operations/operations.css";
export const dynamic="force-dynamic";
export default async function OwnerReview(){
 if(process.env.VOX_STAFF_VIEW_MODE==="owner"){
  const approvals=ownerAdminHref("/admin/vendor-approvals");
  const leads=ownerAdminHref("/admin/lead-distribution");
  return <main className="voxOps"><div className="voxHero"><p className="kicker">OWNER / CORE APPROVALS</p><h1>Operate through existing QuickFurno Admin.</h1><p>The VOX operational-proposal queue belongs to frozen Staff work. Vendor approvals and lead assignments already use canonical Superadmin controls.</p></div><div className="voxNotice"><b>Owner action surfaces</b>{approvals?<a href={approvals}>Open Vendor Approvals</a>:null}{leads?<a href={leads}>Open Lead Distribution</a>:null}<Link href="/operations">Return to Mission Control</Link></div></main>;
 }
 const [r,approved]=await Promise.all([fetchOwnerOperationalIntents(),fetchApprovedNativeFollowups()]);
 if(!r.ok)return <main className="hold"><section className="holdCard">
  <p className="kicker">VOX / GOVERNANCE</p><h1>Owner approval queue unavailable</h1>
  <p>Requires a verified Superadmin MFA session, the private Core API and explicitly enabled private Staging. No actions or approvals can be executed.</p>
  <Link href="/operations">Mission Control</Link></section></main>;
 const rows=r.pending.filter(x=>x.id&&x.revision===0) as ApprovalRow[];
 return <main className="voxOps"><header className="voxTop"><div className="voxLogo">V</div>
 <div><b>VOX / OPERATIONAL GOVERNANCE</b><small>Core approval decisions</small></div>
 <div className="voxSession">OWNER AAL2 · NOT EXECUTING</div></header>
 <div className="voxHero"><p className="kicker">REVIEW / SAFETY FIRST</p>
 <h1>Approve the intent.<br/><span>Never bypass Core.</span></h1>
 <p>Staff proposals require independent review. Approval creates a Core audit decision, not a support message, vendor profile change, WhatsApp send or automatic follow-up.</p></div>
 <OwnerApprovals rows={rows}/>
 {approved.ok?<ApprovedFollowups rows={approved.pending.filter(x=>x.intentId&&x.revision===1) as FollowupRow[]}/>:null}
 <div className="voxNotice"><b>No automatic execution</b><span>Each future operational action still needs its own guarded, consent-aware Core execution contract and separate launch certification.</span></div>
 <footer className="voxBottom"><Link href="/operations">Back to Mission Control</Link></footer></main>;
}
