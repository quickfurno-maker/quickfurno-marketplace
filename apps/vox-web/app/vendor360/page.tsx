import Link from "next/link";
import {fetchScopedCrm} from "../../lib/core";
import {withReturn} from "../../lib/returnTo.mjs";
import {ownerAdminHref} from "../../lib/ownerAdminLinks";
import {ScopedQueue} from "../components/ScopedQueue";
import "../components/scoped-queue.css";
import "../operations/operations.css";
export const dynamic="force-dynamic";
export default async function Vendor360(){
 const ownerMode=process.env.VOX_STAFF_VIEW_MODE==="owner";
 if(!ownerMode)return <main className="hold"><section className="holdCard"><h1>Owner Vendor 360 is not enabled</h1><p>Staff activation requires a separate release approval.</p></section></main>;
 const ownerVerificationVisible=ownerMode&&process.env.VOX_STAFF_PORTAL_ENABLED==="staging"&&
  process.env.VOX_OWNER_VENDOR_REVIEW_ENABLED==="staging";
 const r=await fetchScopedCrm("vendor360");
 if(!r.ok||r.kind!=="vendor360")return <main className="hold"><section className="holdCard">
 <p className="kicker">{ownerMode?"OWNER CORE AUTHORIZATION":"STAFF CORE AUTHORIZATION"}</p><h1>Vendor 360 unavailable</h1>
 <p>{ownerMode&&r.status===403?"Owner Core authorization was denied.":ownerMode&&r.status===401?"Owner MFA is required.":
 r.status===401?"Verified Staff MFA is required.":r.status===403?
 "Your current Staff assignment does not authorize this vendor workspace.":
 "The protected Vendor 360 Core projection is currently unavailable. No vendor state was modified."}</p>
 <Link href={r.status===401?withReturn("/login","/vendor360"):"/operations"}>
 {r.status===401?"Owner sign-in":"Back to Mission Control"}</Link></section></main>;
 const vendors=r.view.vendors.map(v=>({id:v.vendorId??"",title:v.businessName,
  detail:"Core verification "+v.verificationStatus+" · Google location "+v.locationVerification,
  state:v.status,attention:!v.active||v.verificationStatus.toLowerCase()!=="verified"}));
 const crm=r.view.crm.map(c=>({id:c.vendorId??"",title:c.onboarding,
   detail:c.vendorId?"Vendor #"+c.vendorId.slice(0,8):"Unlinked record",state:c.relationship}));
 // The Core projection already supplies bounded, scoped tasks. They must be
 // visible to Staff; displaying them does not grant execution privileges.
 const taskRows=r.view.tasks.map(t=>({id:t.id??"",title:t.title,
  detail:t.vendorId?"Assigned vendor #"+t.vendorId.slice(0,8):"Unlinked Core task",
  state:t.status,attention:!["done","closed","completed"].includes(t.status.toLowerCase())}));
 return <main className="voxOps"><header className="voxTop"><div className="voxLogo">V</div><div><b>VOX / VENDOR 360</b>
 <small>Canonical QuickFurno Vendor CRM</small></div><div className="voxSession">{ownerMode?"OWNER AAL2 - READ ONLY":"CITY VERIFIED - READ ONLY"}</div></header>
 <div className="voxHero"><p className="kicker">VENDOR RELATIONSHIPS / VERIFIED LOCATIONS</p><h1>The complete context,<br/><span>without privileged shortcuts.</span></h1>
 <p>Search assigned Core vendor profiles and relationships. KYC, Aadhaar, Google-verified locations, credits and approvals remain under their existing Core authorities.</p>
 <nav aria-label="Owner workspaces"><Link href="/operations" style={{color:"#9decc8"}}>Owner Operations</Link></nav></div>
 {ownerMode?<div className="voxNotice"><b>Owner actions — canonical QuickFurno Core</b>{ownerVerificationVisible?<Link href="/owner/vendors/verification">Open native Owner Vendor Verification</Link>:null}<span>VOX is a read-only overview. All operational changes stay in the existing authorized Core Admin.</span>{ownerAdminHref("/admin/vendor-crm")?<a href={ownerAdminHref("/admin/vendor-crm")!}>Open Vendor CRM</a>:null}{" | "}{ownerAdminHref("/admin/vendor-approvals")?<a href={ownerAdminHref("/admin/vendor-approvals")!}>Vendor approvals</a>:null}</div>:null}
 <div className="voxWorkspace">
  <ScopedQueue kicker="VENDORS" title="Assigned Core vendors" rows={vendors} emptyLabel="No vendors assigned."/>
  <ScopedQueue kicker="CRM" title="Vendor relationships" rows={crm} emptyLabel="No vendor CRM records."/>
  <ScopedQueue kicker="TASKS" title="Assigned vendor follow-ups" rows={taskRows} emptyLabel="No scoped vendor follow-up tasks."/>
 </div>
 <div className="voxNotice"><b>Atomic approvals</b><span>Vendor profile, verification, service-area changes and any financial or lead-assignment actions require the existing Core approval workflow. VOX cannot make direct edits.</span></div>
 <footer className="voxBottom">QuickFurno VOX · Owner Vendor 360 · Staging gated</footer></main>;
}
