import {fetchScopedServiceDesk} from "../../lib/core";
import "../operations/operations.css";
export const dynamic="force-dynamic";
export default async function ServiceDesk(){
 const result=await fetchScopedServiceDesk();
 if(!result.ok)return <main className="hold"><section className="holdCard">
  <p className="kicker">VOX / STAFF AUTHORIZATION</p><h1>Service Desk unavailable</h1>
  <p>Verified staff MFA, city/team assignment and explicit Core case access are required. This workspace remains locked until the Staging permissions are certified.</p>
  <a href="/operations">Back to operations</a>
 </section></main>;
 return <main className="voxOps">
  <header className="voxTop"><div className="voxLogo">V</div><div><b>VOX · SERVICE DESK</b><small>Core-owned vendor support and HUMAN conversations</small></div><div className="voxSession">READ ONLY · VERIFIED SCOPE</div></header>
  <div className="voxHero"><p className="kicker">STAFF SERVICE / ASSIGNED WORK ONLY</p><h1>Support that is<br/><span>governed end to end.</span></h1><p>Cases and staff-owned human handovers are selected by verified Core permissions. No raw conversations or direct provider sends are accessible here.</p>
  <a href="/operations" style={{color:"#8ee9c7"}}>← Back to Mission Control</a></div>
  <div className="voxWorkspace">
   <section className="voxUnit"><div className="voxUnitTop"><div><p>CORE VENDOR SUPPORT</p><h2>Assigned cases</h2></div><strong>{result.view.support.length}<small> recent</small></strong></div>
    <div className="voxRows">{result.view.support.length?result.view.support.map((c,i)=>
     <div key={c.threadId??i} className="voxRow"><div className="voxRowIcon">S</div><div className="voxRowBody">
      <b>Case {typeof c.threadId==="string"?c.threadId.slice(0,8):"unknown"}</b>
      <small>Priority: {c.priority} · Age: {c.ageBand} · SLA not configured</small>
     </div><span className="voxState">{c.state}</span></div>
    ):<div className="voxBlank">No assigned vendor support cases.</div>}</div><footer>CORE: no case mutation available</footer>
   </section>
   <section className="voxUnit"><div className="voxUnitTop"><div><p>GOVERNED WHATSAPP HUMAN DESK</p><h2>Aarohi and Anisha</h2></div><strong>{result.view.humanInbox.length}<small> recent</small></strong></div>
    <div className="voxRows">{result.view.humanInbox.length?result.view.humanInbox.map((c,i)=>
     <div key={c.conversationId??i} className="voxRow"><div className="voxRowIcon">W</div><div className="voxRowBody">
      <b>{c.lane} · {typeof c.conversationId==="string"?c.conversationId.slice(0,8):"unknown"}</b>
      <small>Service window: {c.serviceWindow} · Core HUMAN takeover</small>
     </div><span className="voxState">{c.state}</span></div>
    ):<div className="voxBlank">No assigned HUMAN conversations.</div>}</div><footer>CORE: provider sends unavailable; agent autonomy unchanged</footer>
   </section>
  </div>
  <div className="voxNotice"><b>Atomic Core governance</b><span>Case ownership changes, human replies and agent takeover require explicit Core-side approval, fresh consent, expected revision and audited delivery. None is enabled from this read-only page.</span></div>
  <footer className="voxBottom">QuickFurno VOX · Staff-only staging preview · No live WhatsApp control</footer>
 </main>;
}
