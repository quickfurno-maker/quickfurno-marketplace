"use client";
import {useState} from "react";
import Link from "next/link";

type Pack={key:string;label:string};
type StaffTeamOption={teamId:string;cityId:string};
type StaffPreview={staffRef:string;teamRef:string;cityRef:string;role:string;
 state:"ACTIVE"|"SUSPENDED_OR_EXPIRED";expiresAt:string};
export function AdminStaffSetup({packs,roster,rosterVerified=false,teams=[],teamsVerified=false}:{
 packs:readonly Pack[];roster:readonly StaffPreview[];rosterVerified?:boolean;
 teams?:readonly StaffTeamOption[];teamsVerified?:boolean
}){
 const [selected,setSelected]=useState<string[]>([]);
 const [filter,setFilter]=useState("");
 const [teamId,setTeamId]=useState("");
 const selectedTeam=teams.find(t=>t.teamId===teamId);
 const list=roster.filter(r=>(r.staffRef+" "+r.teamRef+" "+r.cityRef+" "+r.role).toLowerCase().includes(filter.toLowerCase()));
 const toggle=(key:string,on:boolean)=>setSelected(prev=>on?[...new Set([...prev,key])]:prev.filter(x=>x!==key));
 const ordered=packs.filter(p=>selected.includes(p.key));
 return <main className="staffSetup">
  <header className="staffSetupTop"><Link href="/team">← Team Operations</Link>
   <span>ADMIN · CORE VERIFIED · PLANNING ONLY</span></header>
  <div className="staffSetupContent">
   <p className="staffSetupEyebrow">STAFF MANAGEMENT / MULTI-DEPARTMENT ACCESS</p>
   <h1>Add Staff</h1>
   <p className="staffSetupIntro">One staff account may have several department responsibilities. Each request still needs verified city/team scope, a distinct reviewer and Core approval. This is a non-saving preview.</p>
   <div className="staffSetupSteps" aria-label="Staff setup steps">
    <span className="current">1 · Responsibilities</span>
    <span>2 · Identity &amp; team</span>
    <span>3 · Independent review</span>
    <span>4 · Activation &amp; MFA</span>
   </div>
   <section className="staffSetupCard" aria-labelledby="department-heading">
    <h2 id="department-heading">Select department responsibilities</h2>
    <p>Choose any combination. Selection alone never gives access to clients, vendors, conversations or financial controls.</p>
    <fieldset className="staffSetupPacks"><legend>Available department packs</legend>
     {packs.map(pack=><label key={pack.key} className="staffSetupPack">
      <input type="checkbox" checked={selected.includes(pack.key)}
       onChange={e=>toggle(pack.key,e.target.checked)}/>
      <span><strong>{pack.label}</strong><small>Requires separate object-level grants and current Core membership.</small></span>
     </label>)}
    </fieldset>
    <aside className="staffSetupSummary" aria-live="polite">
     <strong>Selected responsibilities: {ordered.length}</strong>
     <p>{ordered.length?ordered.map(x=>x.label).join(" · "):"Choose at least one department to preview a future staff request."}</p>
    </aside>
   </section>
   <section className="staffSetupCard" aria-labelledby="roster-heading">
    <h2 id="roster-heading">Existing Staff · Core-authorized preview</h2>
    {!rosterVerified?<p role="status">Staff directory is unavailable or not independently enabled. No personnel information is displayed.</p>:<>
     <p>{roster.length} records in a bounded preview, not the total employee count. No contact details or staff access changes are available.</p>
     <label className="staffRosterSearch">Filter permitted preview
      <input value={filter} onChange={e=>setFilter(e.target.value)} type="search"
        placeholder="Staff, role, team or city" maxLength={80}/></label>
     {list.length===0?<p role="status">No matching staff in this bounded preview.</p>:
      <div className="staffRosterList" role="list" aria-label="Existing staff directory preview">
       {list.map((member,i)=><article key={member.staffRef+":"+i} role="listitem" className="staffRosterRow">
        <div><strong>{member.staffRef}</strong><small>{member.role.replaceAll("_"," ")}</small></div>
        <div><small>{member.teamRef} · {member.cityRef}</small>
         <small>{member.state==="ACTIVE"?"Active":"Suspended / expired"} · Expires {new Date(member.expiresAt).toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata"})}</small></div>
       </article>)}
      </div>}
    </>}
   </section>
   <section className="staffSetupCard">
    <h2>Next: Verified identity and city/team</h2>
    <p>Only existing active teams in Core verified cities are eligible for future onboarding. This selection stays in your browser and cannot create an invitation.</p>
    {!teamsVerified?<p role="status">The protected team/city selector is disabled or unavailable. No city or team can be selected.</p>:
     <label className="staffRosterSearch">Core-verified team and city
      <select value={teamId} onChange={e=>setTeamId(e.target.value)}>
       <option value="">Select an eligible team</option>
       {teams.map(t=><option key={t.teamId} value={t.teamId}>
        {"TEAM-"+t.teamId.slice(0,8)+" · CITY-"+t.cityId.slice(0,8)}
       </option>)}
      </select>
     </label>}
    <p role="status">Request preview: {ordered.length} department responsibilities · {selectedTeam?"Core team/city selected":"Team/city not selected"} · Staff identity unverified · Independent review pending.</p>
    <p>Invitation email and staff identity will be handled only through the future approved Core onboarding workflow. This page collects neither credentials nor personal identifiers.</p>
    <button disabled type="button" title="Core governed invitation not implemented">
     Create &amp; invite staff — unavailable until certified
    </button>
    <p className="staffSetupNotice">No user account, staff grant, password, invitation email, team transfer or approval is created by this screen. Admin cannot bypass the independent Team Leader review.</p>
   </section>
  </div>
 </main>;
}
