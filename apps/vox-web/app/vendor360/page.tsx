import Link from "next/link";
import {fetchScopedCrm} from "../../lib/core";
import {withReturn} from "../../lib/returnTo.mjs";
import {ScopedQueue} from "../components/ScopedQueue";
import {TaskCreator} from "./components/TaskCreator";
import {ProfileReviewQueue} from "./components/ProfileReviewQueue";
import {StaffProposalForm} from "../components/StaffProposalForm";
import "../components/scoped-queue.css";
import "../operations/operations.css";
export const dynamic="force-dynamic";
export default async function Vendor360(){
 const r=await fetchScopedCrm("vendor360");
 if(!r.ok||r.kind!=="vendor360")return <main className="hold"><section className="holdCard">
 <p className="kicker">STAFF CORE AUTHORIZATION</p><h1>Vendor 360 unavailable</h1>
 <p>{r.status===401?"Verified Staff MFA is required.":r.status===403?
 "Your current Staff assignment does not authorize this vendor workspace.":
 "The protected Vendor 360 Core projection is currently unavailable. No vendor state was modified."}</p>
 <Link href={r.status===401?withReturn("/login","/vendor360"):"/operations"}>
 {r.status===401?"Staff sign-in":"Back to Mission Control"}</Link></section></main>;
 const vendors=r.view.vendors.map(v=>({id:v.vendorId??"",title:v.businessName,
  detail:"Core verification "+v.verificationStatus+" · Google location "+v.locationVerification,
  state:v.status,attention:!v.active||v.verificationStatus.toLowerCase()!=="verified"}));
 const crm=r.view.crm.map(c=>({id:c.vendorId??"",title:c.onboarding,
   detail:c.vendorId?"Vendor #"+c.vendorId.slice(0,8):"Unlinked record",state:c.relationship}));
 return <main className="voxOps"><header className="voxTop"><div className="voxLogo">V</div><div><b>VOX / VENDOR 360</b>
 <small>Canonical QuickFurno Vendor CRM</small></div><div className="voxSession">CITY VERIFIED · READ ONLY</div></header>
 <div className="voxHero"><p className="kicker">VENDOR RELATIONSHIPS / VERIFIED LOCATIONS</p><h1>The complete context,<br/><span>without privileged shortcuts.</span></h1>
 <p>Search assigned Core vendor profiles and relationships. KYC, Aadhaar, Google-verified locations, credits and approvals remain under their existing Core authorities.</p>
 <nav aria-label="Staff workspaces"><Link href="/operations" style={{color:"#9decc8"}}>Mission Control</Link> · <Link href="/acquisition" style={{color:"#9decc8"}}>Aarohi CRM</Link> · <Link href="/service-desk" style={{color:"#9decc8"}}>Service Desk</Link></nav></div>
 <div className="voxWorkspace">
  <ScopedQueue kicker="VENDORS" title="Assigned Core vendors" rows={vendors} emptyLabel="No vendors assigned."/>
  <ScopedQueue kicker="CRM" title="Vendor relationships" rows={crm} emptyLabel="No vendor CRM records."/>
 </div>
 {process.env.VOX_VENDOR_TASK_UI_ENABLED==="staging"?<TaskCreator vendors={r.view.vendors.filter(v=>v.vendorId).map(v=>({vendorId:v.vendorId!,businessName:v.businessName}))}/>:null}
 {process.env.VOX_OPERATIONAL_PROPOSAL_UI_ENABLED==="staging"?<StaffProposalForm kind="VENDOR_PROFILE_CHANGE" targets={r.view.vendors.filter(v=>v.vendorId).map(v=>({id:v.vendorId!,title:v.businessName}))}/>:null}
 {process.env.VOX_VENDOR_PROFILE_REVIEW_UI_ENABLED==="staging"?<ProfileReviewQueue vendors={r.view.vendors.filter(v=>v.vendorId).map(v=>({vendorId:v.vendorId!,businessName:v.businessName}))}/>:null}
 <div className="voxNotice"><b>Atomic approvals</b><span>Vendor profile, verification, service-area changes and any financial or lead-assignment actions require the existing Core approval workflow. VOX cannot make direct edits.</span></div>
 <footer className="voxBottom">QuickFurno VOX · Staff Vendor 360 · Staging gated</footer></main>;
}
