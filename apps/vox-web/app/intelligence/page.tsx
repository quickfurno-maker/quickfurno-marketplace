import Link from "next/link";
import {fetchOwnerAosHealth} from "../../lib/core";
import "../operations/operations.css";
export const dynamic="force-dynamic";
export default async function Intelligence(){
 const r=await fetchOwnerAosHealth();
 if(!r.ok)return <main className="hold"><section className="holdCard">
  <p className="kicker">VOX / OWNER INTELLIGENCE</p><h1>Intelligence access unavailable</h1>
  <p>This is restricted to a verified Superadmin AAL2 session and an explicitly authorized private Staging Core.</p>
  <Link href="/operations">Return to operations</Link></section></main>;
 const metrics=[
  {name:"AOS Agents",value:r.view.agentCount},
  {name:"Operational agents",value:r.view.operationalAgentCount},
  {name:"Runs (24h)",value:r.view.runs24h},
  {name:"Completed (24h)",value:r.view.completed24h},
  {name:"Failed (24h)",value:r.view.failed24h},
  {name:"Recommendations (24h)",value:r.view.recommendations24h},
 ];
 return <main className="voxOps">
 <header className="voxTop"><div className="voxLogo">V</div><div><b>VOX / INTELLIGENCE</b>
  <small>Canonical Core AOS V2 · Owner only</small></div><div className="voxSession">AAL2 · READ ONLY</div></header>
 <div className="voxHero"><p className="kicker">AOS V2 / REAL CORE OBSERVATION</p><h1>Operational intelligence,<br/><span>without autonomous actions.</span></h1>
 <p>These values come from the existing AOS V2 Core service. Unavailable persistence is shown as unavailable, never zero. No private records, model reasoning or vendor identities are exposed.</p>
 <p style={{color:"#9eeac9"}}>AOS state: {r.view.runtime} · Data: {r.view.observation}</p></div>
 <div className="voxPills" style={{gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))"}}>
 {metrics.map(m=><div key={m.name}><strong>{m.value??"—"}</strong><span>{m.name}</span></div>)}</div>
 <div className="voxNotice"><b>AGNI not connected</b><span>AGNI and Jarvis runtime are not verified through this view. AOS remains advisory: VOX cannot publish automation, approve matching overrides or trigger provider sends.</span></div>
 <footer className="voxBottom"><Link href="/operations">Return to Mission Control</Link> · No AOS actions enabled</footer></main>;
}
