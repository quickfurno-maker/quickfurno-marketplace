export const dynamic="force-dynamic";
const WORKSPACES=[
  {name:"Acquisition",agent:"Aarohi",caption:"Prospects, scoring and Core-verified conversion",status:"Read-model contract"},
  {name:"Vendor 360",agent:"QuickFurno Core",caption:"Lifecycle, KYC, zones, credits, relationship",status:"Scope contract"},
  {name:"WhatsApp Desk",agent:"Aarohi + Anisha",caption:"Human handoff through governed Core outbox",status:"No direct outbound"},
  {name:"Automation Studio",agent:"Core + Jarvis",caption:"Native workflow and typed agent-flow governance",status:"Review-only"},
  {name:"Service Cases",agent:"Vendor Success",caption:"Staff assignments, SLA and exception resolution",status:"Schema review"},
  {name:"Operations",agent:"AOS + AGNI",caption:"Advisory insights and infrastructure evidence",status:"Read-only"},
];
function Locked(){
 return <main className="lockPage"><div className="lockCard"><span className="lockLogo">V</span>
   <p className="kicker">QUICKFURNO / INTERNAL OPERATIONS</p>
   <h1>VOX is being prepared.</h1>
   <p>Staff-only access remains disabled. Core-verified identity, multi-city permissions,
     staff MFA and origin security must pass certification before this application opens.</p>
   <p className="lockFoot">No vendor information or operational controls are exposed.</p>
 </div></main>;
}
function LocalPreview(){
 return <div className="shell"><aside className="sidebar">
   <div className="brand"><span className="mark">V</span><div><b>VOX</b><small>VENDOR OPERATIONS OS</small></div></div>
   <p className="sidetitle">OPERATIONS</p><nav aria-label="VOX preview navigation">
    {["Mission Control","Aarohi CRM","Vendor 360","WhatsApp Desk","Service Cases","Automation Studio","Agent Flows","System Health"].map((n,i)=>
       <span className={i===0?"nav active":"nav"} key={n}><i>{["◈","◎","▣","⌕","◷","✧","⬡","⚙"][i]}</i>{n}</span>)}
   </nav><div className="sidefooter"><span className="greenDot"/>Local design preview<br/>No live data connected</div>
 </aside><main className="main"><header className="top">
   <span>QUICKFURNO / <b>MISSION CONTROL</b></span><span className="tag">LOCAL PREVIEW ONLY</span>
 </header><div className="introBlock"><div><p className="kicker">ONE STAFF WORKSPACE · GOVERNED OPERATIONS</p>
   <h1>Vendor operations,<br/><em>finally connected.</em></h1>
   <p>Aarohi acquisition, Anisha vendor success, Core authority and automation—organized without duplicating existing systems.</p>
   <div className="chips"><span>STAFF-ONLY</span><span>CORE-AUTHORITATIVE</span><span>NO DIRECT OUTBOUND</span></div>
 </div><div className="orb"><b>VOX</b><small>OPERATIONS OS</small></div></div>
 <section className="spaceTitle"><div><p className="kicker">WORKSPACE OVERVIEW</p><h2>Operational workstreams</h2></div>
   <small>Live metrics disabled until staff authorization</small>
 </section><div className="cards">{WORKSPACES.map((w,i)=><article className="card" key={w.name}>
   <div className="cardTop"><small>0{i+1}</small><span>{w.status}</span></div>
   <p className="kicker">{w.agent}</p><h3>{w.name}</h3><p>{w.caption}</p>
   <div className="foot">SOURCE CONTRACT / WORK IN PROGRESS <b>↗</b></div></article>)}</div>
 <section className="boundary"><div><p className="kicker">AUTHORITY BOUNDARIES</p><h2>Governed by design</h2></div>
 <div><strong>CORE</strong><p>Registered vendors, payments, credits, matching, consent and native dispatch</p></div>
 <div><strong>JARVIS</strong><p>Agent models, prompts, memory, flow engine, signed agent context</p></div>
 <div><strong>VOX</strong><p>Scoped staff cases, views, governed requests and trace correlation</p></div></section>
 <footer>VOX source prototype · No operational access, no provider sends</footer>
 </main></div>;
}
export default function Home(){
 const isLocalPreview=process.env.NODE_ENV==="development" && process.env.VOX_DEMO_PREVIEW==="local-only";
 return isLocalPreview?<LocalPreview/>:<Locked/>;
}
