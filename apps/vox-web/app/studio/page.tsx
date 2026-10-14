import Link from "next/link";
import {fetchScopedStudioSimulation} from "../../lib/core";
import "../operations/operations.css";
export const dynamic="force-dynamic";
const keys=["vendor_journey","client_journey","campaigns","recovery","orphan_cleanup","stale_cleanup"];
export default async function Studio({searchParams}:{searchParams:Promise<{workflowKey?:string}>}){
 const params=await searchParams;
 const key=typeof params.workflowKey==="string"?params.workflowKey:"vendor_journey";
 const r=await fetchScopedStudioSimulation(key);
 if(!r.ok)return <main className="hold"><section className="holdCard">
  <p className="kicker">VOX / AUTOMATION WORKSHOP</p><h1>Simulation unavailable</h1>
  <p>Staff AAL2 authorization, the exact Core workflow role, and approved private Staging are required. No simulations or live actions have run here.</p>
  <Link href="/operations">Mission Control</Link></section></main>;
 return <main className="voxOps"><header className="voxTop"><div className="voxLogo">V</div><div>
  <b>VOX / NATIVE AUTOMATION STUDIO</b><small>Existing Core simulator · Read only</small></div>
  <div className="voxSession">DRY RUN · AAL2</div></header>
  <div className="voxHero"><p className="kicker">AUTOMATION WORKSHOP / SOURCE DEFAULT</p>
  <h1>Simulate safely.<br/><span>Never publish accidentally.</span></h1>
  <p>Shows the native Core default workflow traversal. This is not the currently published production definition or worker health.</p>
  <nav aria-label="Automation workflows" style={{display:"flex",gap:12,flexWrap:"wrap"}}>
   {keys.map(k=><Link key={k} href={"/studio?workflowKey="+k} style={{color:"#8eecc6"}}>{k.replaceAll("_"," ")}</Link>)}
  </nav></div>
  <section className="voxUnit"><div className="voxUnitTop"><h2>{r.view.workflowKey.replaceAll("_"," ")} simulation</h2>
   <strong>{r.view.nodes.length}<small> nodes</small></strong></div>
  <div className="voxRows">{r.view.nodes.map((node,i)=><div className="voxRow" key={i}>
   <div className="voxRowIcon">{i+1}</div><div className="voxRowBody"><b>{node.label}</b>
    <small>Type: {node.kind}</small></div><span className="voxState">{node.authority}</span></div>)}</div>
   <footer>Definition: {r.view.source} · Runtime: {r.view.runtime} · Publish unavailable</footer></section>
  <div className="voxNotice"><b>Core governance</b><span>This view cannot send WhatsApp messages, grant credits, mutate vendors, activate an agent, execute or publish a workflow.</span></div>
  <footer className="voxBottom"><Link href="/operations">Return to Mission Control</Link> · Dry-run only</footer></main>;
}
