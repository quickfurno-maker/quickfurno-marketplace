import Link from "next/link";
import {fetchOwnerOperationalIntents} from "../../lib/core";
import {OwnerApprovals,type ApprovalRow} from "./OwnerApprovals";
import "../operations/operations.css";
export const dynamic="force-dynamic";
export default async function OwnerReview(){
 const r=await fetchOwnerOperationalIntents();
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
 <div className="voxNotice"><b>No automatic execution</b><span>Each future operational action still needs its own guarded, consent-aware Core execution contract and separate launch certification.</span></div>
 <footer className="voxBottom"><Link href="/operations">Back to Mission Control</Link></footer></main>;
}
