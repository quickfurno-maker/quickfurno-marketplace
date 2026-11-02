"use client";

import {useState} from "react";
import "./vox-role-perspective.css";

type Role="admin"|"leader"|"staff";

const roleViews: Record<Role,{
  label:string;
  title:string;
  summary:string;
  featured:readonly {title:string;detail:string;category:string}[];
  boundary:string;
}>={
  admin:{
    label:"Admin / Superadmin",
    title:"Owner's operational overview",
    summary:"Prioritize staff access, approvals and marketplace oversight across approved cities. Core remains the decision authority.",
    featured:[
      {title:"Staff access reviews",detail:"Review scoped departments, expiring grants and access exceptions",category:"GOVERNANCE"},
      {title:"Pending approvals",detail:"Inspect distinct-reviewer decisions and signed Core receipts",category:"APPROVALS"},
      {title:"City & supply health",detail:"Read only advisory marketplace and AGNI evidence",category:"INTELLIGENCE"},
    ],
    boundary:"Only the genuine Core Superadmin can operate this view. Preview selection never grants Admin access."
  },
  leader:{
    label:"Team Leader",
    title:"Team workload & escalations",
    summary:"See assigned team cases, SLA exceptions and source-backed reports, within the Leader's verified current team.",
    featured:[
      {title:"Team assignments",detail:"Track current Core team queues without cross-team visibility",category:"WORKLOAD"},
      {title:"SLA escalations",detail:"Review aging support and client handover signals",category:"ATTENTION"},
      {title:"EOD acknowledgments",detail:"Independently review signed source windows; no self-approval",category:"REPORTS"},
    ],
    boundary:"Team Leader scope needs independently approved bootstrap, verified AAL2 and live grants."
  },
  staff:{
    label:"Staff Member",
    title:"My focused workday",
    summary:"Act on assigned client, vendor or acquisition work and submit personal activity evidence for independent review.",
    featured:[
      {title:"Assigned cases",detail:"Only your currently assigned Core work queue",category:"MY WORK"},
      {title:"Follow-ups & handovers",detail:"Authorized Riya, Anisha, Aarohi or Service Desk requests",category:"FOLLOW-UPS"},
      {title:"Today's activity",detail:"Review recorded work events, not invented performance totals",category:"EOD"},
    ],
    boundary:"Actual Staff access requires a current signed-in identity, AAL2 and object-level Core grants."
  }
};

const roles:readonly Role[]=["admin","leader","staff"];

export function VoxRolePerspective(){
  const [selected,setSelected]=useState<Role>("admin");
  const current=roleViews[selected];
  return <section className="voxPerspective" aria-labelledby="perspective-heading">
    <div className="voxPerspectiveHeader">
      <div>
        <p className="voxWorkspaceEyebrow">ROLE-BASED EXPERIENCE · DESIGN PREVIEW</p>
        <h2 id="perspective-heading">One platform. Three focused views.</h2>
      </div>
      <span className="voxPerspectivePreviewLabel">NO PERMISSION CHANGES</span>
    </div>
    <div className="voxPerspectiveRolePicker" role="group" aria-label="Preview a VOX dashboard perspective">
      {roles.map(role=><button type="button" key={role} aria-pressed={selected===role}
        className={selected===role?"voxPerspectiveRoleActive":""}
        onClick={()=>setSelected(role)}>{roleViews[role].label}</button>)}
    </div>
    <div className="voxPerspectiveBody" aria-live="polite">
      <div className="voxPerspectiveText">
        <p className="voxWorkspaceEyebrow">{current.label.toUpperCase()} WORKSPACE</p>
        <h3>{current.title}</h3>
        <p>{current.summary}</p>
        <div className="voxPerspectiveBoundary"><span aria-hidden="true">◆</span>{current.boundary}</div>
      </div>
      <div className="voxPerspectiveTasks" aria-label={current.label+" interface modules"}>
        {current.featured.map(item=><article key={item.title}>
          <div><span>{item.category}</span><span className="voxPerspectiveInactive">NOT CONNECTED</span></div>
          <strong>{item.title}</strong>
          <p>{item.detail}</p>
        </article>)}
      </div>
    </div>
  </section>;
}
