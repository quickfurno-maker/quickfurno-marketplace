"use client";
import {useState} from "react";
type FinanceKind="order"|"attempt"|"capture"|"refund"|"credit"|"settlement"|"audit";
type Entry={kind:FinanceKind;reference:string;occurredAt:string;
 amountSubunits:number|null;mode:"test"|"live"};
const kinds=[{key:"all",label:"All events"},{key:"attempt",label:"Attempts"},
 {key:"capture",label:"Captures"},{key:"refund",label:"Refunds"},
 {key:"audit",label:"Audit"}] as const;
const rupee=new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"});
export function FinanceTimeline({events,mode}:{events:Entry[];mode:"test"|"live"}){
 const [filter,setFilter]=useState<(typeof kinds)[number]["key"]>("all");
 const visible=events.filter(e=>filter==="all"||e.kind===filter);
 return <section className="voxNotice" aria-labelledby="finance-events-heading">
  <h2 id="finance-events-heading">Financial evidence timeline</h2>
  <p>Immutable provider and Core references only. Provider capture, bank settlement and vendor credits
    are separate events. This view does not authorize payment changes.</p>
  <div role="group" aria-label="Filter finance event type" style={{
    display:"flex",flexWrap:"wrap",gap:8,margin:"16px 0"}}>
   {kinds.map(k=><button key={k.key} type="button" aria-pressed={filter===k.key}
     onClick={()=>setFilter(k.key)} style={{padding:"8px 12px",borderRadius:8,
      border:"1px solid currentColor",fontWeight:filter===k.key?700:400}}>
     {k.label} ({k.key==="all"?events.length:events.filter(e=>e.kind===k.key).length})
   </button>)}
  </div>
  {events.length===0?<p>No financial history has been recorded. This does not prove payment was never made.</p>:
   visible.length===0?<p role="status">No recorded events in this category.</p>:
   <div style={{overflowX:"auto"}}>
    <table style={{width:"100%",borderCollapse:"collapse",minWidth:560}}>
     <caption style={{textAlign:"left",padding:"8px 0"}}>{visible.length} verified history references shown.
      Mode: {mode.toUpperCase()}</caption>
     <thead><tr><th scope="col">Recorded at</th><th scope="col">Event</th>
      <th scope="col">Reference ID</th><th scope="col">Amount</th></tr></thead>
     <tbody>{visible.map((e,i)=><tr key={e.reference+":"+i}>
      <td style={{padding:"10px 6px"}}>{new Date(e.occurredAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})}</td>
      <td style={{padding:"10px 6px"}}>{e.kind.toUpperCase()}</td>
      <td style={{padding:"10px 6px",wordBreak:"break-all"}}><code>{e.reference}</code></td>
      <td style={{padding:"10px 6px"}}>{e.amountSubunits===null?"Not recorded":rupee.format(e.amountSubunits/100)}</td>
     </tr>)}</tbody>
    </table>
   </div>}
 </section>;
}
