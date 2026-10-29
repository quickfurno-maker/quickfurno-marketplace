import Link from "next/link";
import {fetchStaffOverview} from "../../lib/core";
import "../operations/operations.css";
import "./owner-preview.css";

export type PreviewKind="acquisition"|"vendor360"|"service-desk";

const configs={
 acquisition:{title:"Acquisition",kicker:"AAROHI / OWNER OVERVIEW",description:"Recent prospect signals from the verified Owner Core projection. This is not the assigned staff CRM or an actionable prospect list.",field:"prospectPreview" as const},
 vendor360:{title:"Vendor 360",kicker:"VENDOR RELATIONSHIPS / OWNER OVERVIEW",description:"Recent vendor relationship statuses from the verified Owner Core projection. Profile details and vendor changes require separately certified access.",field:"vendorCrmPreview" as const},
 "service-desk":{title:"Service Desk",kicker:"SERVICE OPERATIONS / OWNER OVERVIEW",description:"Recent support and human-handover signals from verified Owner Core. Full conversations, replies, assignments and case actions are unavailable.",field:"supportPreview" as const},
};

const text=(value:unknown,max=64)=>{
 if(typeof value!=="string")return "—";
 const safe=value.replace(/[\u0000-\u001f]/g," ").trim().slice(0,max);
 return safe||"—";
};
const shortId=(value:unknown)=>typeof value==="string"&&value.length>=8?"#"+value.slice(0,8):"Unlinked";
const date=(value:unknown)=>{
 if(typeof value!=="string")return "Not scheduled";
 const n=Date.parse(value);
 return Number.isFinite(n)?new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}).format(n):"Not scheduled";
};
type Entry={name:string;detail:string;state:string};
function project(row:unknown,kind:PreviewKind):Entry{
 const p=row&&typeof row==="object"&&!Array.isArray(row)?row as Record<string,unknown>:{};
 if(kind==="acquisition")return {name:text(p.businessName),detail:"Priority "+text(p.priority)+" · Last activity "+date(p.lastActivityAt),state:text(p.stage)};
 if(kind==="vendor360")return {name:shortId(p.vendorId),detail:"Relationship "+text(p.relationship)+" · Follow-up "+date(p.nextFollowupAt),state:text(p.onboarding)};
 return {name:shortId(p.threadId),detail:"Priority "+text(p.priority)+" · Updated "+date(p.updatedAt),state:text(p.status)};
}
function Restricted(){
 return <main className="ownerPreviewGate">
  <span className="ownerPreviewFlag">CORE ACCESS REQUIRED</span>
  <h1>Owner preview unavailable</h1>
  <p>VOX cannot validate its read-only Core overview in this session. No data or actions have been exposed. Your MFA enrollment is not necessarily the cause.</p>
  <Link href="/operations">Return to Operations</Link>
 </main>;
}
export async function OwnerPreview({kind}:{kind:PreviewKind}){
 const config=configs[kind];
 const result=await fetchStaffOverview();
 if(!result.ok)return <Restricted/>;
 const data=result.view[config.field];
 const entries=(Array.isArray(data)?data:[]).slice(0,8).map((row:unknown)=>project(row,kind));
 const human=(kind==="service-desk" && Array.isArray(result.view.humanDeskPreview))?result.view.humanDeskPreview.length:0;
 return <main className="ownerPreview">
  <header className="ownerPreviewTop"><Link href="/operations">← Operations</Link><span><i/> OWNER AAL2 · CORE READ-ONLY</span></header>
  <section className="ownerPreviewHero">
   <p>{config.kicker}</p>
   <h1>{config.title}</h1>
   <p className="ownerPreviewDescription">{config.description}</p>
   <div className="ownerPreviewNote"><b>Owner preview</b><span>This page shows only the already-authorized bounded overview projection—not the full staff workspace. It does not grant staff access or allow any changes.</span></div>
  </section>
  <div className="ownerPreviewHeading"><h2>{kind==="service-desk"?"Recent support cases":"Recent Core records"}</h2><span>{entries.length} / 8 maximum displayed</span></div>
  <section className="ownerPreviewList" aria-label="Owner read-only recent records">
   {entries.length===0?<div className="ownerPreviewEmpty"><b>No recent records</b><p>The certified Core overview has no items for this category.</p></div>:entries.map((e,i)=><div className="ownerPreviewRow" key={i}><span className="ownerPreviewIndex">{String(i+1).padStart(2,"0")}</span><div><b>{e.name}</b><small>{e.detail}</small></div><span className="ownerPreviewState">{e.state}</span></div>)}
  </section>
  {kind==="service-desk"?<p className="ownerPreviewFootnote">{human} bounded human-handover record(s) are visible in the Owner Overview. Conversation content and actions are not shown here.</p>:null}
  <div className="ownerPreviewBottom"><span><b>Not activated:</b> Staff assignments, editing, outbound messages and protected workflows require their own Core authorization and certification.</span><Link href="/operations">Back to command center</Link></div>
 </main>;
}
