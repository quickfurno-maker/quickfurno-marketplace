import Link from "next/link";
import {fetchScopedRiyaClientCases} from "../../../lib/clientSourceStatus";
import "../workflow.css";
export const dynamic="force-dynamic";
export default async function RiyaClientCases(){
 const r=await fetchScopedRiyaClientCases();
 return <main className="voxFlow">
  <nav className="voxFlowNav" aria-label="Breadcrumb"><Link href="/team/command-center">Command Center</Link>
   <span aria-hidden="true">/</span><span>Riya Client Cases</span></nav>
  <header className="voxFlowHero">
   <span className="voxFlowEyebrow">Core-verified client_success AAL2 · Read-only</span>
   <h1>Riya · Client Operations</h1>
   <p>Current city-scoped client-case metadata with independently reviewed
    department permission, exact case object grants and Google-verified locations.</p>
   <span className="voxFlowStatus">No transcript, reply or takeover authority</span>
  </header>
  {!r.ok?<section className="voxFlowCard" role="status">
   <h2>Client cases locked</h2>
   <p>Current Staff MFA, separately approved client-success department,
    Core conversation object grant and canonical project location are required.
    Protected staging may not yet have these approved grants.</p>
  </section>:<section className="voxFlowCard">
   <h2>My authorized client case window</h2>
   <p className="voxFlowMuted">Bounded preview only, not all client conversations.
    Current support assignment and Riya consent may change after this read.</p>
   {r.items.length===0?<p>No verified case metadata in this permitted window.</p>:
    <ul className="voxFlowList">{r.items.map(c=>
     <li key={c.conversationId} className="voxFlowRow">
      <div><strong>Case {c.conversationId.slice(0,8)}</strong>
       <p>{c.agent} · {c.caseState} · Revision {c.revision}</p>
       <small>Signed Jarvis pause and fresh consent required before actions.</small>
      </div>
      <time dateTime={c.lastUpdated}>{c.lastUpdated.slice(0,16)} UTC</time>
     </li>)}</ul>}
   <p className="voxFlowMuted">Outbound replies and human takeover disabled
    until atomic Core consent and signed Jarvis ACK certification.</p>
  </section>}
 </main>;
}
