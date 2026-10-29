import {fetchStaffOverview} from "../../lib/core";
import Link from "next/link";
import "./operations.css";

export const dynamic="force-dynamic";

type RecordValue=Record<string,unknown>;
type DomainKind="acquisition"|"crm"|"support"|"human";

const safeText=(x:unknown,fallback="—")=>typeof x==="string"&&x.trim()?x.trim().slice(0,90):fallback;
const shortId=(x:unknown)=>typeof x==="string"&&x.length>8?"#"+x.slice(0,8):"—";
function when(x:unknown){
 const parsed=Date.parse(String(x??""));
 return Number.isFinite(parsed)?new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}).format(parsed):"—";
}
function stateClass(value:string){
 const s=value.toLowerCase();
 if(s.includes("hot")||s.includes("urgent")||s.includes("high"))return "is-hot";
 if(s.includes("active")||s.includes("open")||s.includes("approved")||s.includes("ready"))return "is-good";
 if(s.includes("warm")||s.includes("pending")||s.includes("follow"))return "is-warm";
 return "";
}

const nav=[
 {href:"/operations",label:"Overview",code:"01"},
 {href:"/acquisition",label:"Acquisition",code:"02"},
 {href:"/vendor360",label:"Vendor 360",code:"03"},
 {href:"/service-desk",label:"Service Desk",code:"04"},
 {href:"/intelligence",label:"Intelligence",code:"05"},
 {href:"/studio",label:"Automation Studio",code:"06"},
 {href:"/staff-reviews",label:"Staff Reviews",code:"07"},
 {href:"/approvals",label:"Owner Approvals",code:"08"},
];

const meta:Record<DomainKind,{name:string;kicker:string;letter:string;description:string}>={
 acquisition:{name:"Aarohi Acquisition",kicker:"PROSPECT PIPELINE",letter:"A",description:"Prospect momentum and next actions"},
 crm:{name:"Vendor 360",kicker:"VENDOR RELATIONSHIPS",letter:"V",description:"Onboarding and relationship health"},
 support:{name:"Service Cases",kicker:"SUPPORT BACKLOG",letter:"S",description:"Open support work requiring attention"},
 human:{name:"Human Desk",kicker:"GOVERNED WHATSAPP",letter:"H",description:"Bounded human handover visibility"},
};

function Domain({rows,kind}:{rows:RecordValue[];kind:DomainKind}){
 const m=meta[kind];
 return <section className="opsCard">
  <div className="opsCardHead">
   <div className="opsCardIdentity"><span className="opsCardIcon">{m.letter}</span><div><p>{m.kicker}</p><h2>{m.name}</h2><small>{m.description}</small></div></div>
   <div className="opsCount"><strong>{String(rows.length).padStart(2,"0")}</strong><span>recent</span></div>
  </div>
  {rows.length===0?<div className="opsEmpty"><span>0</span><div><b>No records in this bounded view</b><small>Core has not returned any current items for this workspace.</small></div></div>:
  <div className="opsRows">{rows.map((row,i)=>{
   const main=kind==="acquisition"?safeText(row.businessName,"Unnamed prospect"):
    kind==="crm"?shortId(row.vendorId):
    kind==="support"?shortId(row.threadId):safeText(row.subjectType,"Conversation");
   const state=kind==="acquisition"?safeText(row.stage):
    kind==="crm"?safeText(row.onboarding):
    kind==="support"?safeText(row.status):safeText(row.state);
   const detail=kind==="acquisition"?safeText(row.priority,"Unprioritized")+" · "+when(row.lastActivityAt):
    kind==="crm"?safeText(row.relationship)+" · follow-up "+when(row.nextFollowupAt):
    kind==="support"?safeText(row.priority)+" · "+when(row.updatedAt):
    "Revision "+String(row.revision??"—")+" · "+when(row.updatedAt);
   return <div className="opsRow" key={String(row.prospectId??row.vendorId??row.threadId??row.conversationId??i)}>
    <span className="opsRowMark">{String(i+1).padStart(2,"0")}</span>
    <div className="opsRowBody"><b>{main}</b><small>{detail}</small></div>
    <span className={"opsState "+stateClass(state)}>{state}</span>
   </div>;
  })}</div>}
  <footer><span>Read-only Core projection</span><b>Bounded</b></footer>
 </section>;
}

function Rail(){
 const owner=process.env.VOX_STAFF_VIEW_MODE==="owner";
 return <aside className="opsRail">
  <div className="opsBrand"><span>V</span><div><b>VOX</b><small>QuickFurno Operations</small></div></div>
  <p className="opsRailLabel">WORKSPACES</p>
  <nav>{nav.map(item=>{
   const locked=owner&&!["/operations","/acquisition","/vendor360","/service-desk"].includes(item.href)&&!(item.href==="/intelligence"&&process.env.VOX_INTELLIGENCE_VIEW_ENABLED==="staging");
   return locked?<span className="opsNavLocked" key={item.href} title="Pending Core certification and governed activation"><small>{item.code}</small><span>{item.label}</span><b>LOCKED</b></span>:
   <Link className={item.href==="/operations"?"active":""} href={item.href} key={item.href}><small>{item.code}</small><span>{item.label}{owner&&item.href!=="/operations"?" · Preview":""}</span></Link>;
  })}</nav>
  <div className="opsTrust"><span className="opsTrustDot"/><div><b>AAL2 session</b><small>Core verified · read-only</small></div></div>
 </aside>;
}

function Gate({status}:{status:number}){
 const auth=status===401;
 return <main className="opsGate">
  <div className="opsGateGlow"/>
  <section className="opsGateCard">
   <div className="opsGateTop"><span className="opsGateLogo">V</span><div><b>VOX</b><small>QUICKFURNO OPERATIONS</small></div></div>
   <span className="opsGateBadge">{auth?"IDENTITY CHECK":"CORE SAFETY GATE"}</span>
   <h1>{auth?"Session verification required":"Operations temporarily unavailable"}</h1>
   <p>{auth?"Your staff session must be authenticated with MFA before VOX can open the command center.":"VOX is protecting the workspace because the trusted Core read path is not available right now. No operational action has been exposed."}</p>
   <div className="opsGateStatus"><span className={auth?"warn":"hold"}/><div><b>{auth?"AAL2 required":"Fail-closed protection active"}</b><small>{auth?"Complete secure staff sign-in to continue.":"Your session remains protected while Core connectivity is unavailable."}</small></div></div>
   <div className="opsGateActions">
    <a className="primary" href={auth?"/login":"/operations"}>{auth?"Continue to staff sign-in":"Retry secure connection"}</a>
    {!auth?<a className="secondary" href="/login">Staff sign-in</a>:null}
   </div>
   <footer>Private staff surface · No provider send · No direct vendor mutation</footer>
  </section>
 </main>;
}

export default async function Operations(){
 const result=await fetchStaffOverview();
 if(!result.ok)return <Gate status={result.status}/>;

 const views=[
  {rows:result.view.prospectPreview as RecordValue[],kind:"acquisition" as const},
  {rows:result.view.vendorCrmPreview as RecordValue[],kind:"crm" as const},
  {rows:result.view.supportPreview as RecordValue[],kind:"support" as const},
  {rows:result.view.humanDeskPreview as RecordValue[],kind:"human" as const},
 ];
 const total=views.reduce((sum,x)=>sum+x.rows.length,0);

 return <div className="opsShell">
  <Rail/>
  <main className="opsMain">
   <header className="opsTopbar">
    <div><span className="opsEyebrow">OWNER COMMAND CENTER</span><b>Operations overview</b></div>
    <div className="opsTopStatus"><span/><div><b>Core verified</b><small>AAL2 · read-only staging</small></div></div>
   </header>

   <section className="opsHero">
    <div>
     <p className="opsKicker">QUICKFURNO / VERIFIED CORE OWNER PROJECTION</p>
     <h1>See the business clearly.<br/><em>Act only when authorized.</em></h1>
     <p className="opsLead">A clean owner view of acquisition, vendor relationships, service workload and governed human handovers. Every record is bounded by QuickFurno Core.</p>
    </div>
    <div className="opsHeroBadge"><span>CORE READ</span><strong>{String(total).padStart(2,"0")}</strong><small>recent bounded records</small></div>
   </section>

   <section className="opsMetrics" aria-label="Operational summary">
    <div><span>01</span><strong>{total}</strong><small>Visible records</small></div>
    <div><span>02</span><strong>04</strong><small>Core domains</small></div>
    <div><span>03</span><strong>AAL2</strong><small>Owner assurance</small></div>
    <div><span>04</span><strong>0</strong><small>Direct actions</small></div>
   </section>

   <section className="opsQuick">
    <div><p className="opsKicker">OWNER SHORTCUTS</p><h2>Move directly to the workspace you need.</h2></div>
    <div className="opsQuickLinks">
     {process.env.VOX_STAFF_VIEW_MODE==="owner"?<>
      <Link href="/vendor360">Vendor preview <span>›</span></Link>
      <Link href="/acquisition">Acquisition preview <span>›</span></Link>
      <Link href="/service-desk">Service preview <span>›</span></Link>
      {process.env.VOX_INTELLIGENCE_VIEW_ENABLED==="staging"?<Link href="/intelligence">Owner Intelligence <span>›</span></Link>:null}
     </>:<>
      <Link href="/approvals">Owner Approvals <span>›</span></Link>
      <Link href="/intelligence">Intelligence <span>›</span></Link>
      <Link href="/service-desk">Service Desk <span>›</span></Link>
      <Link href="/studio">Automation Studio <span>›</span></Link>
     </>}
    </div>
   </section>

   <div className="opsSectionHead"><div><p className="opsKicker">YOUR WORKSPACES</p><h2>Operational overview</h2></div><small>Latest bounded Core projections</small></div>
   <section className="opsGrid">{views.map(v=><Domain key={v.kind} {...v}/>)}</section>

   <section className="opsBoundary">
    <div><p className="opsKicker">OPERATING BOUNDARY</p><h2>VOX observes. Core authorizes.</h2></div>
    <p>Core owns vendor activation, payments, matching, consent and communication dispatch. Jarvis owns agent reasoning and memory. VOX displays only approved staff projections and remains fail-closed when trust cannot be established.</p>
    <span>READ ONLY</span>
   </section>

   <footer className="opsFooter">VOX · QuickFurno Staff Operations · Protected owner workspace</footer>
  </main>
 </div>;
}
