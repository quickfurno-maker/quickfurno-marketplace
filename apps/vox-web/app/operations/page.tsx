import {fetchStaffOverview} from "../../lib/core";
import Link from "next/link";
import "./operations.css";
export const dynamic="force-dynamic";
type RecordValue=Record<string,unknown>;
function value(x:unknown,fallback="—"){return typeof x==="string"&&x.trim()?x.trim().slice(0,90):fallback;}
function when(x:unknown){const parsed=Date.parse(String(x??""));return Number.isFinite(parsed)?new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}).format(parsed):"—";}
const showShortId=(x:unknown)=>typeof x==="string"&&x.length>8?"#"+x.slice(0,8):"—";
function Domain({name,kicker,rows,kind}: {name:string;kicker:string;rows:RecordValue[];kind:"acquisition"|"crm"|"support"|"human"}){
 return <section className="voxUnit"><div className="voxUnitTop"><div><p>{kicker}</p><h2>{name}</h2></div><strong>{rows.length}<small> recent</small></strong></div>
 {rows.length===0?<div className="voxBlank">No records are currently available in this read model.</div>:
 <div className="voxRows">{rows.map((row,i)=>{
   const main=kind==="acquisition"?value(row.businessName,"Unnamed prospect"):
     kind==="crm"?showShortId(row.vendorId):
       kind==="support"?showShortId(row.threadId):value(row.subjectType,"Unknown conversation");
   const state=kind==="acquisition"?value(row.stage):
      kind==="crm"?value(row.onboarding):
      kind==="support"?value(row.status):value(row.state);
   const detail=kind==="acquisition"?value(row.priority,"Unprioritized")+" · "+when(row.lastActivityAt):
      kind==="crm"?value(row.relationship)+" · follow-up "+when(row.nextFollowupAt):
      kind==="support"?value(row.priority)+" · "+when(row.updatedAt):
      "Revision "+String(row.revision??"—")+" · "+when(row.updatedAt);
   return <div className="voxRow" key={String(row.prospectId??row.vendorId??row.threadId??row.conversationId??i)}>
     <div className="voxRowIcon">{kind==="acquisition"?"A":kind==="crm"?"V":kind==="support"?"S":"W"}</div>
     <div className="voxRowBody"><b>{main}</b><small>{detail}</small></div><span className="voxState">{state}</span>
   </div>;
 })}</div>}
 <footer>Read-only Core projection <span>↗</span></footer></section>;
}
export default async function Operations(){
 const result=await fetchStaffOverview();
 if(!result.ok)return <main className="hold"><section className="holdCard">
  <p className="kicker">VOX / ACCESS GATE</p><h1>Operations unavailable</h1>
  <p>{result.status===401?"Staff session or MFA is required.":"Core connection is not yet certified or enabled."}</p>
  {result.status===401?<Link href="/login">Staff sign-in</Link>:
    <p role="status">Access remains protected; retry after Core connectivity or authorization is restored.</p>}
  </section></main>;
 const views=[{name:"Aarohi Acquisition",kicker:"PROSPECT PIPELINE",rows:result.view.prospectPreview as RecordValue[],kind:"acquisition" as const},
  {name:"Vendor 360",kicker:"VENDOR RELATIONSHIPS",rows:result.view.vendorCrmPreview as RecordValue[],kind:"crm" as const},
  {name:"Service Cases",kicker:"SUPPORT BACKLOG",rows:result.view.supportPreview as RecordValue[],kind:"support" as const},
  {name:"Human Desk",kicker:"GOVERNED WHATSAPP",rows:result.view.humanDeskPreview as RecordValue[],kind:"human" as const}];
 const total=views.reduce((sum,x)=>sum+x.rows.length,0);
 return <main className="voxOps"><header className="voxTop"><div className="voxLogo">V</div><div><b>VOX OPERATIONS</b><small>QuickFurno · governed vendor services</small></div><div className="voxSession">CORE VERIFIED · AAL2</div></header>
 <div className="voxHero"><p className="kicker">STAFF COMMAND CENTER / READ-ONLY STAGING</p><h1>Everything that matters,<br/><span>in one operational view.</span></h1>
 <p>Trusted live projections from QuickFurno Core. Staff actions, payment decisions and outbound messaging remain disabled until full authorization.</p></div>
 <nav aria-label="VOX staff workspaces" style={{display:"flex",gap:12,flexWrap:"wrap",paddingBottom:20}}><Link href="/acquisition" style={{color:"#8feac3"}}>Aarohi Acquisition →</Link><Link href="/vendor360" style={{color:"#8feac3"}}>Vendor 360 →</Link><Link href="/service-desk" style={{color:"#8feac3"}}>Service Desk →</Link><Link href="/intelligence" style={{color:"#8feac3"}}>Owner Intelligence →</Link><Link href="/studio" style={{color:"#8feac3"}}>Automation Simulation →</Link><Link href="/staff-reviews" style={{color:"#8feac3"}}>Team Leader Reviews →</Link><Link href="/approvals" style={{color:"#8feac3"}}>Owner Approvals →</Link><Link href="/finance" style={{color:"#8feac3"}}>Finance Preview →</Link></nav><div className="voxPills"><div><strong>{total}</strong><span>Bounded records</span></div><div><strong>04</strong><span>Core domains</span></div><div><strong>0</strong><span>Direct actions</span></div><div><strong>≤8</strong><span>Rows per domain</span></div></div>
 <div className="voxSectionTitle"><p className="kicker">YOUR WORKSPACES</p><h2>Operational overview</h2></div>
 <div className="voxWorkspace">{views.map(v=><Domain key={v.kind} {...v}/>)}</div>
 <div className="voxNotice"><b>Operating boundary</b><span>Core owns vendor activation, payments, matching, consent and communication dispatch. Jarvis owns agent reasoning and memory. VOX displays only approved staff projections.</span></div>
 <footer className="voxBottom">VOX · QuickFurno Staff Operations · No provider send or vendor state mutation</footer></main>;
}
