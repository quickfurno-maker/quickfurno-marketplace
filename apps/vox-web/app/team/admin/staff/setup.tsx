"use client";

import {useState} from "react";
import {VoxWorkspaceFrame} from "../../../components/VoxWorkspaceNav";

type Pack={key:string;label:string};
type StaffTeamOption={teamId:string;cityId:string};
type StaffPreview={staffRef:string;teamRef:string;cityRef:string;role:string;
  state:"ACTIVE"|"SUSPENDED_OR_EXPIRED";expiresAt:string};

export function AdminStaffSetup({packs,roster,rosterVerified=false,teams=[],teamsVerified=false,preview=false}: {
  packs:readonly Pack[];
  roster:readonly StaffPreview[];
  rosterVerified?:boolean;
  teams?:readonly StaffTeamOption[];
  teamsVerified?:boolean;
  preview?:boolean;
}) {
  const [selected,setSelected]=useState<string[]>([]);
  const [filter,setFilter]=useState("");
  const [statusFilter,setStatusFilter]=useState<"ALL"|"ACTIVE"|"SUSPENDED_OR_EXPIRED">("ALL");
  const [departmentFilter,setDepartmentFilter]=useState("");
  const [teamId,setTeamId]=useState("");
  const selectedTeam=teams.find(t=>t.teamId===teamId);
  const list=roster.filter(r=>(r.staffRef+" "+r.teamRef+" "+r.cityRef+" "+r.role).toLowerCase().includes(filter.toLowerCase()) && (statusFilter==="ALL" || r.state===statusFilter));
  const visiblePacks=packs.filter(p=>(p.label+" "+p.key).toLowerCase().includes(departmentFilter.toLowerCase()));
  const toggle=(key:string,on:boolean)=>setSelected(prev=>on?[...new Set([...prev,key])]:prev.filter(x=>x!==key));
  const ordered=packs.filter(p=>selected.includes(p.key));

  return <VoxWorkspaceFrame active="staff" preview={preview} admin
    title="Team Management" eyebrow="QUICKFURNO / PEOPLE & ACCESS">
    <div className="staffSetup">
      <section className="staffSetupHero">
        <div>
          <p className="staffSetupEyebrow">ONE STAFF IDENTITY · MULTI-DEPARTMENT ACCESS</p>
          <h1>Team Management</h1>
          <p className="staffSetupIntro">Build your team with clear responsibilities, city and team scope, independent approvals and genuine MFA—without creating a second authentication system.</p>
        </div>
        <span className="staffSetupHeroLabel">{preview?"UI REVIEW · NO REAL STAFF DATA":"CORE-VERIFIED ADMIN VIEW"}</span>
      </section>

      {preview ? <div className="voxWorkspacePreviewNotice" role="status">
        <span className="symbol" aria-hidden="true">i</span>
        <div><strong>Design-only Staff Management preview</strong>
          <p>Department labels below are illustrative choices, not authorized Core grants. No employee accounts, directory entries, team memberships or invitations are generated.</p>
        </div>
      </div> : null}

      <section aria-label="Staff administration overview" className="staffOverviewStats">
        <article><span>Verified directory window</span><strong>{rosterVerified?String(roster.length):"—"}</strong><small>{rosterVerified?"Bounded Core records, not company total":"Requires Core authorization"}</small></article>
        <article><span>Available teams</span><strong>{teamsVerified?String(teams.length):"—"}</strong><small>{teamsVerified?"Current permitted team choices":"Protected team/city scope"}</small></article>
        <article><span>Department options</span><strong>{preview?"—":String(packs.length)}</strong><small>{preview?"Design examples only":"Current Core capability catalog"}</small></article>
        <article><span>Approval requirement</span><strong className="staffOverviewPending">Independent</strong><small>Team Leader / owner governance</small></article>
      </section>

      <div className="staffSetupGrid">
        <section className="staffSetupCard staffDirectory" aria-labelledby="roster-heading">
          <div className="staffSetupCardHeading">
            <div><p className="staffSetupEyebrow">DIRECTORY</p><h2 id="roster-heading">Staff members</h2></div>
            <span className="staffSetupPill">CORE-BOUND</span>
          </div>
          <p>View only the personnel permitted by current Core permissions. Email, private documents and contact details are intentionally excluded.</p>
          {!rosterVerified ? <div className="staffSetupEmpty" role="status">
            <span aria-hidden="true">▣</span>
            <strong>Staff directory not connected</strong>
            <p>Verified Staff identity, city/team permissions and protected staging must be enabled before actual members appear.</p>
          </div> : <>
            <label className="staffRosterSearch">Search permitted staff
              <input value={filter} onChange={e=>setFilter(e.target.value)} type="search"
                placeholder="Filter by reference, role, team or city" maxLength={80}/>
            </label>
            <div className="staffRosterControls">
              <label className="staffRosterSearch">Access state
                <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value as typeof statusFilter)}>
                  <option value="ALL">All visible states</option>
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED_OR_EXPIRED">Suspended or expired</option>
                </select>
              </label>
              <span className="staffRosterMeta" role="status">{list.length} of {roster.length} permitted records shown; never a company-wide count.</span>
            </div>
            {list.length===0?<p className="staffSetupEmpty" role="status">No matching staff in the permitted window.</p>:
              <div className="staffRosterList" role="list" aria-label="Authorized staff directory">
                {list.map((member,i)=><article key={member.staffRef+":"+i} role="listitem" className="staffRosterRow">
                  <div><strong>{member.staffRef}</strong><small>{member.role.replaceAll("_"," ")}</small></div>
                  <div><small>{member.teamRef} · {member.cityRef}</small>
                    <small>{member.state==="ACTIVE"?"Active":"Suspended / expired"} · Expires {new Date(member.expiresAt).toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata"})}</small>
                  </div>
                </article>)}
              </div>}
          </>}
          <div className="staffDirectoryBottom">
            <strong>Governed staff lifecycle</strong>
            <span>Request → independent review → activation → MFA → periodic access review</span>
          </div>
        </section>

        <section className="staffSetupCard staffSetupWizard" aria-labelledby="staff-create-heading">
          <div className="staffSetupCardHeading">
            <div><p className="staffSetupEyebrow">ONBOARDING</p><h2 id="staff-create-heading">Add Staff</h2></div>
            <span className="staffSetupPill">PLANNING ONLY</span>
          </div>
          <p>Prepare responsibilities for one Staff login. This form cannot create a user, issue an invitation or activate a grant.</p>
          <ol className="staffSetupSteps" aria-label="Staff onboarding steps">
            <li className="current"><b>01</b><span>Departments</span></li>
            <li><b>02</b><span>Identity & team</span></li>
            <li><b>03</b><span>Independent review</span></li>
            <li><b>04</b><span>MFA activation</span></li>
          </ol>
          <label className="staffRosterSearch staffDepartmentSearch">Find a department
            <input type="search" aria-label="Find department responsibilities" value={departmentFilter}
              onChange={e=>setDepartmentFilter(e.target.value)} maxLength={60}
              placeholder="Search approved responsibility packs"/>
          </label>
          <fieldset className="staffSetupPacks">
            <legend>Department responsibilities</legend>
            {packs.length===0 ? <p className="staffSetupNoPacks" role="status">No Core-approved capability catalog is available.</p> : visiblePacks.length===0 ? <p className="staffSetupNoPacks" role="status">No matching department responsibilities.</p> : visiblePacks.map(pack=><label key={pack.key} className="staffSetupPack">
              <input type="checkbox" checked={selected.includes(pack.key)} onChange={e=>toggle(pack.key,e.target.checked)}/>
              <span><strong>{pack.label}</strong><small>{preview?"Design selection only; does not grant access":"Object-level grants and verified membership required"}</small></span>
            </label>)}
          </fieldset>
          <aside className="staffSetupSummary" aria-live="polite">
            <div className="staffSetupSummaryTop">
              <strong>{ordered.length} responsibilities selected</strong>
              <button type="button" onClick={()=>setSelected([])} disabled={ordered.length===0}
                aria-label="Clear selected department responsibilities">Clear selection</button>
            </div>
            <p>{ordered.length?ordered.map(x=>x.label).join(" · "):"Select a department above to preview a future access request."}</p>
          </aside>
          <div className="staffSetupTeamBlock">
            <h3>Verified team & city</h3>
            {!teamsVerified?<p role="status">Protected team/city selection is unavailable. No team can be assigned.</p>:
              <label className="staffRosterSearch">Current permitted team
                <select value={teamId} onChange={e=>setTeamId(e.target.value)}>
                  <option value="">Select an eligible team</option>
                  {teams.map(t=><option key={t.teamId} value={t.teamId}>{"TEAM-"+t.teamId.slice(0,8)+" · CITY-"+t.cityId.slice(0,8)}</option>)}
                </select>
              </label>}
            <p role="status" className="staffSetupRequestState">Preview: {ordered.length} responsibilities · {selectedTeam?"Core team selected":"No verified team selected"} · Identity not verified · Review pending</p>
          </div>
          <button disabled type="button" className="staffSetupInvite" title="Staff invitations require approved Core workflow">
            Create &amp; invite Staff <span aria-hidden="true">→</span>
          </button>
          <p className="staffSetupNotice">Not available in preview. Staff identity, invitations, grants, payments, vendor access and approval decisions are never created by this screen.</p>
        </section>
      </div>

      <section className="staffLifecycle" aria-labelledby="staff-lifecycle-heading">
        <div className="voxWorkspaceSectionTitle">
          <h2 id="staff-lifecycle-heading">Staff lifecycle workflows</h2>
          <p>Planning and review only · No automatic changes</p>
        </div>
        <div className="staffLifecycleGrid">
          <article><span>JOINER</span><h3>Invite & onboard</h3><p>Core-approved identity → city/team and department grants → verified MFA</p><small>Requires identity and approved invitation handler</small></article>
          <article><span>MOVER</span><h3>Review role changes</h3><p>Approve new department or team scope only after revocation and reviewer checks.</p><small>No access granted from a UI selection</small></article>
          <article><span>LEAVER</span><h3>Suspend & offboard</h3><p>Review termination of sessions, grants, queues and handovers with audit evidence.</p><small>Owner-controlled revocation not yet activated</small></article>
        </div>
      </section>

      <section className="staffSetupGovernance" aria-labelledby="staff-governance-heading">
        <div><p className="staffSetupEyebrow">CONTROLLED ACCESS</p><h2 id="staff-governance-heading">Approval and security boundaries</h2></div>
        <article><strong>01 · Existing Core identity</strong><p>One Admin/Superadmin identity and one Staff account per employee. No parallel authentication store.</p></article>
        <article><strong>02 · Independent reviewer</strong><p>A Team Leader cannot approve their own requests. The first reviewer requires an approved bootstrap.</p></article>
        <article><strong>03 · Scope and expiry</strong><p>City, team, department and object grants are enforced server-side. MFA and revocation are mandatory.</p></article>
      </section>
      <p className="voxWorkspaceFootnote">VOX Team Management · No account creation, staff access mutation, invitation email or provider sends</p>
    </div>
  </VoxWorkspaceFrame>;
}
