"use client";
import {useState} from "react";
import Link from "next/link";

export type TeamPreview={
 kind:"Acquisition"|"Vendor"|"Support"|"Human desk";
 reference:string;
 state:string;
};
const TABS=["Overview","My Work","Queues","Inbox","Team","Reports","Approvals"] as const;
type Tab=(typeof TABS)[number];
const LINKS=[
 {label:"Aarohi Acquisition",href:"/acquisition"},
 {label:"Vendor 360",href:"/vendor360"},
 {label:"Service Desk",href:"/service-desk"},
 {label:"Staff access reviews",href:"/staff-reviews"},
 {label:"Owner approvals",href:"/approvals"}
];
const SECTION_DESCRIPTION:Record<Tab,string>={
 Overview:"An authenticated view of bounded recent Core records. These are not complete work queues or operational totals.",
 "My Work":"Individual task acceptance, ownership and transitions require the future governed Core work-item contract.",
 Queues:"Queue claim, assignment, transfer, SLA timers and escalation remain disabled until atomic Core certification.",
 Inbox:"External conversation sends stay disabled until Core consent, DNC and human handover are certified.",
 Team:"Team directory, staff transfer and grants will reuse Core team membership and two-person approvals.",
 Reports:"Daily reports will derive immutable operational counts from Core events; no employee performance claims are generated.",
 Approvals:"Owner / Admin uses one governed approval center. Existing Core Superadmin authorization and independent reviewer requirements still apply."
};

export function TeamBoard({rows,adminStaffSetupAvailable=false}:{rows:readonly TeamPreview[];adminStaffSetupAvailable?:boolean}){
 const [current,setCurrent]=useState<Tab>("Overview");
 const counts={Acquisition:0,Vendor:0,Support:0,"Human desk":0};
 for(const row of rows)counts[row.kind]++;
 return <main className="teamShell">
  <header className="teamHeader">
   <div className="teamBrand"><span aria-hidden="true">V</span>
    <div><strong>VOX / TEAM OPERATIONS</strong><small>QuickFurno · Controlled staff workspace</small></div>
   </div>
   <span className="teamReadonly">CORE AUTHORIZED · READ ONLY</span>
  </header>
  <div className="teamLayout">
   <nav className="teamRail" aria-label="Team Operations sections">
    {TABS.map(t=><button type="button" key={t} onClick={()=>setCurrent(t)}
     className={current===t?"teamNavItem selected":"teamNavItem"} aria-current={current===t?"page":undefined}>
     {t}</button>)}
    <div className="teamRailNote">No assignments, outbound messages, permission grants or report submissions are enabled.</div>
   </nav>
   <section className="teamContent">
    <div className="teamIntro">
     <p className="teamEyebrow">STAGING · AUTHENTICATED PREVIEW</p>
     <h1>{current==="Overview"?"Your team, one workspace.":current}</h1>
     <p>{SECTION_DESCRIPTION[current]}</p>
    </div>
    {current==="Overview"?<>
     <section className="teamStats" aria-label="Bounded recent Core previews">
      {Object.entries(counts).map(([name,count])=>
       <article className="teamStat" key={name}>
        <span>{name}</span><strong>{count}</strong><small>Recent visible preview{count===1?"":"s"} · not total</small>
       </article>)}
     </section>
     <section className="teamPanel"><h2>Recently visible Core records</h2>
      <PreviewRows rows={rows}/>
     </section>
    </>:current==="Queues"||current==="My Work"||current==="Inbox"?<>
     <section className="teamPanel"><h2>{current==="Inbox"?"Conversation references":"Source references"}</h2>
      <PreviewRows rows={current==="Inbox"?rows.filter(r=>r.kind==="Human desk"):
       current==="My Work"?[]:rows}/>
      <p className="teamWarning">These records are not actionable queues, assignments or message bodies.</p>
     </section>
    </>:current==="Team"?<section className="teamPanel">
     <h2>Governed team management</h2>
     <p>Core owns the authoritative member directory, role, city, team and object-scoped permissions. Member and transfer actions are deliberately unavailable.</p>
     <p>Team Leader review remains a separate permission-checked workflow.</p>
     {adminStaffSetupAvailable?<p><Link href="/team/admin/staff">Admin · Preview staff department setup →</Link></p>:null}
     <Link href="/staff-reviews">Open Team Leader reviews →</Link>
    </section>:current==="Reports"?<section className="teamPanel">
     <h2>Daily reports — not configured</h2>
     <p>Work events, shift rules, end-of-day rollups and staff check-ins need source-backed Core contracts. No counts or scheduled reports are fabricated here.</p>
    </section>:<section className="teamPanel">
     <h2>Owner / Admin · Governed approvals</h2>
     <p>One Owner / Admin workspace. The existing Core Superadmin identity alone controls owner-only decisions. Operations Managers, Team Leaders and Staff do not inherit this authority. Separate review and activation remain mandatory.</p>
     <div className="teamLinks"><Link href="/staff-reviews">Team Leader queue →</Link>
      <Link href="/approvals">Owner / Admin approvals →</Link></div>
    </section>}
    <section className="teamPanel">
     <h2>Existing guarded workspaces</h2>
     <div className="teamLinks">{LINKS.map(link=><Link key={link.href} href={link.href}>{link.label} →</Link>)}</div>
    </section>
    <p className="teamFoot">TO-01 source candidate · No provider sends · No live team counts · No cross-city permissions</p>
   </section>
  </div>
  <nav className="teamMobileNav" aria-label="Mobile Team Operations sections">
   {(["My Work","Queues","Inbox","Team","Reports"] as const).map(t=><button type="button" key={t}
    aria-current={current===t?"page":undefined} className={current===t?"active":""}
    onClick={()=>setCurrent(t)}>{t==="My Work"?"Today":t}</button>)}
  </nav>
 </main>;
}
function PreviewRows({rows}:{rows:readonly TeamPreview[]}){
 if(!rows.length)return <p className="teamEmpty">No Core records available in this bounded preview. Actual queues are not enabled.</p>;
 return <div className="teamRows">{rows.map((r,i)=>
  <div className="teamRow" key={r.kind+":"+r.reference+":"+i}>
   <div><strong>{r.kind}</strong><small>{r.reference}</small></div><span>{r.state}</span>
  </div>)}</div>;
}
