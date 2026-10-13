import {fetchStaffOverview} from "../../lib/core";
export const dynamic="force-dynamic";
export default async function Operations(){
 const result=await fetchStaffOverview();
 if(!result.ok)return <main className="hold"><section className="holdCard">
  <p className="kicker">VOX / ACCESS GATE</p><h1>Operations unavailable</h1>
  <p>{result.status===401?"Staff session or MFA is required.":"Core connection is not yet certified or enabled."}</p>
  <a href="/login">Staff sign-in</a>
 </section></main>;
 const sections=[["Acquisition",result.view.prospectPreview],["Vendor CRM",result.view.vendorCrmPreview],
  ["Support",result.view.supportPreview],["Human Desk",result.view.humanDeskPreview]] as const;
 return <main style={{maxWidth:1080,margin:"auto",padding:32}}>
  <p className="kicker">QUICKFURNO / VERIFIED STAFF</p><h1>VOX Operations</h1>
  <p>Bounded Core live read models. Sensitive actions remain disabled.</p>
  <div className="cards">{sections.map(([label,rows])=><section className="card" key={label}>
   <h2>{label}</h2><p>{rows.length} recent records</p>
   {rows.map((row,i)=><pre key={i} style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontSize:10}}>{JSON.stringify(row,null,2)}</pre>)}
  </section>)}</div>
 </main>;
}
