import Link from "next/link";
import {VoxWorkspaceFrame} from "./components/VoxWorkspaceNav";
import {VoxRolePerspective} from "./components/VoxRolePerspective";
import "./mission.css";

export const dynamic = "force-dynamic";

const focusCards = [
  {label:"My assigned work",href:"/team/work-queue",symbol:"▦",hint:"Core-authorized assigned items"},
  {label:"Needs attention",href:"/team/attention",symbol:"!",hint:"Escalations and approval waits"},
  {label:"Client handovers",href:"/team/client-cases",symbol:"◇",hint:"Riya cases in permitted scope"},
  {label:"Unread notices",href:"/team/notifications",symbol:"◉",hint:"Internal persisted events only"},
] as const;

const operations = [
  {label:"Team Management",kind:"ADMIN",detail:"Staff directory, department responsibilities, team/city scope and approvals",href:"/preview/staff-management",symbol:"▣"},
  {label:"Client CRM & Riya",kind:"CLIENT SUCCESS",detail:"Verified client enquiries, assignments and human handovers",href:"/team/client-cases",symbol:"◇"},
  {label:"Vendor 360 & Anisha",kind:"VENDOR SUCCESS",detail:"Onboarding, support cases, vendor relationships and profile requests",href:"/vendor360",symbol:"▤"},
  {label:"Aarohi Acquisition",kind:"ACQUISITION",detail:"Assigned prospects, follow-ups and verified conversion",href:"/acquisition",symbol:"◎"},
  {label:"Chats & Service Desk",kind:"OPERATIONS",detail:"Staff conversations and Core-governed support queues",href:"/service-desk",symbol:"☰"},
  {label:"Daily Reports",kind:"TEAM WORK",detail:"Core activity records, source readiness and Team Leader review",href:"/team/daily-report",symbol:"▥"},
] as const;

function Locked() {
  return <main className="lockPage"><div className="lockCard"><span className="lockLogo">V</span>
    <p className="kicker">QUICKFURNO / INTERNAL OPERATIONS</p>
    <h1>VOX is being prepared.</h1>
    <p>Staff-only access remains disabled. Core-verified identity, multi-city permissions,
      staff MFA and origin security must pass certification before this application opens.</p>
    <p className="lockFoot">No vendor information or operational controls are exposed.</p>
  </div></main>;
}

function LocalPreview() {
  return <VoxWorkspaceFrame active="mission" title="Mission Control"
    eyebrow="QUICKFURNO / COMMAND CENTER" preview>
    <div className="voxMissionPage">
      <section className="voxMissionHero">
        <div>
          <p className="voxWorkspaceEyebrow">ONE STAFF WORKSPACE · GOVERNED OPERATIONS</p>
          <h1>Good work starts<br /><em>in one place.</em></h1>
          <p>Assignments, teams, clients and vendors together—without duplicating Core permissions or sending messages outside approved workflows.</p>
          <div className="voxMissionHeroActions">
            <Link className="voxMissionPrimaryAction" href="/preview/staff-management">Review Team Management <span aria-hidden="true">→</span></Link>
            <span className="voxMissionHeroCaption">This is a layout preview, not an active operator session</span>
          </div>
        </div>
        <div className="voxMissionHeroArt" aria-hidden="true"><span>V</span><small>OPERATIONS OS</small><i /></div>
      </section>

      <div className="voxWorkspacePreviewNotice" role="status">
        <span className="symbol" aria-hidden="true">i</span>
        <div><strong>Preview mode · no verified live data</strong>
          <p>Real counts, queues, alerts and Staff activity remain hidden until authenticated staging certification. No actions or provider sends are available here.</p>
        </div>
      </div>

      <VoxRolePerspective />

      <section aria-labelledby="mission-focus">
        <div className="voxWorkspaceSectionTitle">
          <h2 id="mission-focus">Today's work at a glance</h2>
          <p>Actual Core metrics require verified Staff MFA and grants</p>
        </div>
        <div className="voxMissionStats">
          {focusCards.map(card => <article key={card.label} className="voxMissionStat">
            <div className="voxMissionStatTop"><span className="voxMissionStatIcon" aria-hidden="true">{card.symbol}</span><span className="voxWorkspaceStatus">NOT CONNECTED</span></div>
            <div className="voxMissionStatValue" aria-label="Unavailable metric">—</div>
            <h3>{card.label}</h3>
            <p>{card.hint}</p>
          </article>)}
        </div>
      </section>

      <div className="voxMissionColumns">
        <section className="voxWorkspacePanel voxMissionQueue" aria-labelledby="mission-queue">
          <div className="voxMissionPanelHead"><div><p className="voxWorkspaceEyebrow">MY WORK</p><h2 id="mission-queue">Priority queue</h2></div><span className="voxWorkspaceStatus">CORE ACCESS REQUIRED</span></div>
          <div className="voxMissionEmpty">
            <span className="voxMissionEmptySymbol" aria-hidden="true">▦</span>
            <strong>Work items aren't connected yet</strong>
            <p>Only current, assigned Core work will appear here after Staff authentication. No tasks are fabricated for this preview.</p>
          </div>
          <div className="voxMissionPanelFooter"><span>Includes assignments, reviews and handovers</span><span>Read-only preview</span></div>
        </section>
        <section className="voxWorkspacePanel voxMissionReview" aria-labelledby="mission-review">
          <div className="voxMissionPanelHead"><div><p className="voxWorkspaceEyebrow">GOVERNED DECISIONS</p><h2 id="mission-review">Approvals & attention</h2></div></div>
          <div className="voxMissionReviewItem"><span className="voxMissionReviewIcon">01</span><div><strong>Staff & Team Leader review</strong><p>Independent authorization is required</p></div><span>Restricted</span></div>
          <div className="voxMissionReviewItem"><span className="voxMissionReviewIcon">02</span><div><strong>Vendor profile changes</strong><p>Core-controlled approval workflow</p></div><span>Restricted</span></div>
          <div className="voxMissionReviewItem"><span className="voxMissionReviewIcon">03</span><div><strong>Daily reports & source evidence</strong><p>No official EOD totals without sealed sources</p></div><span>Restricted</span></div>
          <p className="voxMissionReviewFoot">Workflow examples only; these are not pending approval records.</p>
        </section>
      </div>

      <section aria-labelledby="mission-modules">
        <div className="voxWorkspaceSectionTitle">
          <h2 id="mission-modules">Your workspaces</h2>
          <p>Routes remain independently protected</p>
        </div>
        <div className="voxMissionModules">
          {operations.map(item => <article key={item.label} className="voxMissionModule">
            <div className="voxMissionModuleTop"><span className="voxMissionModuleIcon" aria-hidden="true">{item.symbol}</span><span>{item.kind}</span></div>
            <h3>{item.label}</h3>
            <p>{item.detail}</p>
            {item.href === "/preview/staff-management"
              ? <Link href={item.href}>View UI preview <span aria-hidden="true">→</span></Link>
              : <span className="voxMissionModuleRestricted">Core authorization required <span aria-hidden="true">↗</span></span>}
          </article>)}
        </div>
      </section>

      <section className="voxMissionFoundation"><strong>GOVERNED BY DESIGN</strong>
        <span><b>CORE</b> · Identity, grants, vendors and assignments</span>
        <span><b>JARVIS</b> · Riya, Anisha and Aarohi agents</span>
        <span><b>AGNI</b> · Owner-only operational intelligence</span>
      </section>
      <p className="voxWorkspaceFootnote">VOX private UI preview · No live Staff data, approvals, credits, messaging or provider actions</p>
    </div>
  </VoxWorkspaceFrame>;
}

export default function Home() {
  const isLocalPreview=process.env.NODE_ENV==="development" && process.env.VOX_DEMO_PREVIEW==="local-only";
  return isLocalPreview ? <LocalPreview/> : <Locked/>;
}
