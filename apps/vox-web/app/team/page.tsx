import Link from "next/link";
import {fetchStaffOverview,fetchAdminStaffCapabilityCatalog} from "../../lib/core";
import {StaffSignInLink} from "../components/StaffSignInLink";
import "./team.css";
export const dynamic="force-dynamic";

const workstreams=[
 {name:"Staff Command Center",status:"Unified view",detail:"Current Core-authorized queue, internal notices and partial EOD with department navigation",href:"/team/command-center"},
 {name:"My Work",status:"Read-only",detail:"Only your current Core-authorized tasks",href:"/team/work-queue"},
 {name:"Needs Attention",status:"Read-only",detail:"Bounded Core work blockers and approval waits; no push sends",href:"/team/attention"},
 {name:"Work Notifications",status:"In-app only",detail:"Current Core work-event notices and read receipts; no push-delivery claim",href:"/team/notifications"},
 {name:"Internal Team Chat",status:"Staging gated",detail:"Current-team internal messages; no customer or WhatsApp sends",href:"/team/chat"},
 {name:"Aarohi Acquisition",status:"Read-only",detail:"Core-scoped acquisition pipeline; no direct send",href:"/acquisition"},
 {name:"Anisha Vendor Success",status:"Read-only",detail:"Core-scoped Vendor 360, support and verified zones",href:"/vendor360"},
 {name:"Service Desk / Human Inbox",status:"Read-only",detail:"Authorized support and handover metadata only; replies disabled",href:"/service-desk"},
 {name:"Riya Client Success",status:"Not activated",detail:"Client access and handover await Core subject grants"},
 {name:"Daily Operations",status:"Partial preview",detail:"Only your current-day verified Core work events; not submitted",href:"/team/daily-report"},
 {name:"Partial EOD Submission",status:"Staging gated",detail:"Submit only Core work-event evidence for independent review",href:"/team/eod-submissions"},
 {name:"Team Leader EOD Review",status:"Staging gated",detail:"Separate verified Team Leader acknowledgment; no self-review",href:"/team/eod-reviews"},
 {name:"AGNI / AOS",status:"Advisory",detail:"Diagnostics and suggestions never grant Core authority"}
] as const;

export default async function TeamOperationsHome(){
 const [overview,admin]=await Promise.all([
  fetchStaffOverview(),fetchAdminStaffCapabilityCatalog()
 ]);
 if(!overview.ok)return <main className="voxTeamGate">
  <section className="voxTeamGateCard" role="status">
   <span className="voxTeamEyebrow">QUICKFURNO · STAFF OPERATIONS</span>
   <h1>Team workspace is locked</h1>
   <p>{overview.status===401?"Use your existing Supabase sign-in with verified MFA.":
      "This workspace needs current Core Staff authorization and protected VOX staging activation."}</p>
   <StaffSignInLink status={overview.status}/>
   <Link href="/">Return to VOX</Link>
  </section>
 </main>;
 return <main className="voxTeamShell">
  <header className="voxTeamTop">
   <Link href="/" aria-label="Return to VOX home">VOX</Link>
   <span>INTERNAL · CORE-VERIFIED SESSION</span>
  </header>
  <section className="voxTeamHero">
   <p className="voxTeamEyebrow">ONE STAFF ACCOUNT · SEPARATELY GOVERNED DEPARTMENTS</p>
   <h1>Team Operations</h1>
   <p>One workspace for acquisition, vendors, client support and Staff work.
     Current Core permissions determine access—not navigation, AI or inbox labels.</p>
   <span className="voxTeamChip">READ-ONLY WORKSPACE</span>
  </section>
  <section className="voxTeamSection" aria-labelledby="workspace-heading">
   <h2 id="workspace-heading">Workspaces</h2>
   <p>No synthetic metrics or conversations are displayed here.
      Messages, approvals and task transitions require separate Core authorization.</p>
   <div className="voxTeamGrid">{workstreams.map(w=>
    <article className="voxTeamCard" key={w.name}>
     <div className="voxTeamCardHeading">
      <h3>{w.name}</h3>
      <span>{w.status}</span>
     </div>
     <p>{w.detail}</p>
     {"href" in w
       ? <Link href={w.href}>Open authorized preview <span aria-hidden="true">→</span></Link>
       : <span className="voxTeamUnavailable">Actions disabled pending certification</span>}
    </article>)}
   </div>
  </section>
  {admin.ok?<section className="voxTeamOwner" aria-labelledby="admin-heading">
    <h2 id="admin-heading">Owner / Admin</h2>
    <p>Only the existing verified Core Superadmin can access Staff setup.
       Invitations and grant activations are not enabled here.</p>
    <Link href="/team/admin/staff">Review Staff setup <span aria-hidden="true">→</span></Link>
  </section>:null}
  <footer>Core remains authoritative · No provider messages · No automated privileges</footer>
 </main>;
}
