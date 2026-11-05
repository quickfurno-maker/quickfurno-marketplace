import Link from "next/link";
import {verifiedMfaSession} from "../../../../lib/auth";
import {ownerVendorReviewReadEnabled,ownerVendorDecisionEnabled} from "../../../../lib/ownerVendorVerification";
import {withReturn} from "../../../lib/returnTo.mjs";
import OwnerReviewConsole from "./OwnerReviewConsole";
import "./owner-review.css";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const metadata={
 title:"Vendor Verification · VOX Owner",
 robots:{index:false,follow:false},
};
const home="/operations";
export default async function OwnerVendorVerification(){
 const enabled=ownerVendorReviewReadEnabled();
 const verified=enabled?await verifiedMfaSession():null;
 return <main className="ovr-shell">
  <nav className="ovr-nav" aria-label="Owner navigation">
   <Link href={home}>← Owner Operations</Link>
   <Link href="/vendor360">Vendor 360</Link>
   <span aria-current="page">Verification</span>
  </nav>
  <header className="ovr-hero">
   <p className="ovr-kicker">QUICKFURNO VOX / OWNER OPERATIONS</p>
   <h1>Vendor verification</h1>
   <p>One Owner interface connected to the existing QuickFurno Core approval engine.
    This workspace never stores documents or creates a parallel vendor database.</p>
  </header>
  {!enabled?<section className="ovr-hold" role="status">
    <h2>Private review is not activated</h2>
    <p>Owner verification requires separately certified Staging Core and VOX read gates.
     No case details or decision controls are accessible in the current environment.</p>
   </section>:!verified?<section className="ovr-hold" role="status">
    <h2>Verified Owner MFA is required</h2>
    <p>Sign in with your existing VOX Owner account and complete MFA. Core will
     independently revalidate active Superadmin authorization for each request.</p>
    <Link href={withReturn("/login","/owner/vendors/verification")}>VOX Owner sign-in</Link>
   </section>:<OwnerReviewConsole decisionEnabled={ownerVendorDecisionEnabled()}/>}
  <footer className="ovr-footer">Owner-only · Core-approved cases · Staging gated ·
   No staff management, Automation Studio, finance writes or provider messaging</footer>
 </main>;
}
