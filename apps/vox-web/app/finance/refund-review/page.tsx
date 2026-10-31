import Link from "next/link";
import {fetchOwnerRefundIntakePreview} from "../../../lib/core";
import {withReturn} from "../../../lib/returnTo.mjs";
import "../../operations/operations.css";
export const dynamic="force-dynamic";
/** Status-only. There is deliberately no form, button or client component:
 * Core's review writer is not installed, so no refund action can exist here. */
export default async function RefundReview(){
 const result=await fetchOwnerRefundIntakePreview();
 if(!result.ok){
  const needsLogin=result.error==="MFA_REQUIRED";
  const forbidden=result.status===403;
  return <main className="hold"><section className="holdCard">
   <p className="kicker">VOX / FINANCE · REFUND REVIEW</p>
   <h1>{needsLogin?"Verified Owner session required":
    forbidden?"Owner finance access required":"Refund review HOLD"}</h1>
   <p>{needsLogin
    ?"Sign in with verified Owner MFA to view the read-only refund intake status."
    :forbidden?"Core did not authorize this session to read refund intake."
    :"Refund intake review is not staged or Core is unavailable. HOLD: no refund, review or credit action can be performed from VOX."}</p>
   {needsLogin&&<><Link href={withReturn("/login","/finance/refund-review")}>Owner sign-in</Link>{" · "}</>}
   <Link href="/finance">Return to Finance</Link></section></main>;
 }
 const {events}=result;
 return <main className="voxOps">
  <header className="voxTop"><div className="voxLogo">V</div>
   <div><b>VOX / FINANCE</b><small>QuickFurno · refund intake status</small></div>
   <div className="voxSession">OWNER AAL2 · READ ONLY</div></header>
  <div className="voxHero"><p className="kicker">REFUND INTAKE / QUARANTINED</p>
   <h1>Refund events awaiting review.<br/><span>Status only.</span></h1>
   <p>Provider refund events held in Core quarantine. Review, refund and credit actions are not available from VOX.</p>
   <nav aria-label="Finance navigation"><Link href="/finance" style={{color:"#9decc8"}}>Finance overview</Link> · <Link href="/operations" style={{color:"#9decc8"}}>Mission Control</Link></nav></div>
  <div className="voxWorkspace"><section className="voxUnit">
   <div className="voxUnitTop"><div><p>NON-EXHAUSTIVE · MAX 20</p><h2>Quarantined refund events</h2></div>
    <strong>{events.length}<small> in bounded preview</small></strong></div>
   {events.length===0?<div className="voxBlank">No quarantined refund events returned by Core in this bounded preview.</div>:
    <div className="voxRows">{events.map(e=><div className="voxRow" key={e.eventRef+e.eventType}>
     <div className="voxRowIcon">₹</div><div className="voxRowBody">
      <b>{e.eventType}</b><small>Event {e.eventRef} · {e.providerMode} mode · awaiting review</small></div>
     <span className="voxState">QUARANTINED</span></div>)}</div>}
   <footer>Bounded preview, not complete history. Provider IDs, hashes and credits are never shown.</footer>
  </section></div>
  <div className="voxNotice"><b>Financial safety boundary</b>
   <span>This page cannot review, refund, revoke credits or contact a provider. The Core review writer is not installed.</span></div>
  <footer className="voxBottom">VOX Finance · Refund intake · Read-only · No money movement</footer>
 </main>;
}
