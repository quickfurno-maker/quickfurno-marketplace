import { AarohiBadge,AarohiMetric,AarohiPageHead,ProspectLink,formatWhen } from "@/components/admin/aarohi/AarohiPrimitives";
import { getAarohiDiscoverySummary } from "@/services/aarohiCrmService";
import { getAarohiPhase2Dashboard,listAarohiCityPolicies,listAarohiDiscoveryCandidates } from "@/services/aarohiPhase2AcquisitionService";
import { promoteDiscoveryCandidateAction,setAarohiDiscoveryConnectorStateAction,updateAarohiCityPolicyAction } from "../actions";

export const dynamic="force-dynamic";

function Bars({title,rows}:{title:string;rows:Record<string,number>}){
  const entries=Object.entries(rows).sort((a,b)=>b[1]-a[1]).slice(0,20);
  const max=Math.max(1,...entries.map(x=>x[1]));
  return <section className="qf-aarohi-panel">
    <div className="qf-aarohi-panel-head"><div><h2>{title}</h2></div></div>
    <div className="qf-aarohi-sourcebars">{entries.map(([name,count])=><div className="qf-aarohi-sourcebar" key={name}>
      <span>{name}</span><div className="qf-aarohi-funnel-track"><div className="qf-aarohi-funnel-fill" style={{width:`${count/max*100}%`}}/></div><b>{count}</b>
    </div>)}</div>
  </section>;
}

export default async function DiscoveryPage(){
  const [d,p2,candidates,cityPolicies]=await Promise.all([
    getAarohiDiscoverySummary(),getAarohiPhase2Dashboard(),listAarohiDiscoveryCandidates(),listAarohiCityPolicies(),
  ]);
  return <>
    <AarohiPageHead title="Discovery" description="Structured multi-channel discovery queue. Connectors are server-side, explicitly enabled and provider-ready before work may run."/>
    <div className="qf-aarohi-metrics">
      <AarohiMetric label="Raw discovered" value={d.rawDiscovered}/>
      <AarohiMetric label="Unique prospects" value={d.uniqueProspects}/>
      <AarohiMetric label="Candidate NEW" value={Number((p2.candidateStates as any).NEW??0)}/>
      <AarohiMetric label="Needs review" value={Number((p2.candidateStates as any).REVIEW??0)}/>
      <AarohiMetric label="Qualified" value={d.qualified}/>
    </div>
    <section className="qf-aarohi-panel">
      <div className="qf-aarohi-panel-head"><div><h2>Connector readiness</h2><p>Credentials stay outside CRM. Disabled means no discovery calls.</p></div></div>
      <div className="qf-aarohi-table-wrap"><table className="qf-aarohi-table">
        <thead><tr><th>Channel</th><th>Provider</th><th>Enabled</th><th>Provider ready</th><th>Last status</th><th>Next run</th><th>Control</th></tr></thead>
        <tbody>{(p2.connectors as any[]).map((c:any)=><tr key={c.id}>
          <td><AarohiBadge>{c.channel}</AarohiBadge></td><td>{c.provider_key}</td>
          <td><AarohiBadge tone={c.enabled?"good":"neutral"}>{c.enabled?"ENABLED":"OFF"}</AarohiBadge></td>
          <td><AarohiBadge tone={c.provider_ready?"good":"warn"}>{c.provider_ready?"READY":"NOT READY"}</AarohiBadge></td>
          <td>{c.last_status||"—"}</td><td>{formatWhen(c.next_run_at)}</td>
          <td><form action={setAarohiDiscoveryConnectorStateAction.bind(null,c.id)} style={{display:"flex",gap:6,alignItems:"center"}}>
            <label><input type="checkbox" name="provider_ready" defaultChecked={c.provider_ready}/> ready</label>
            <label><input type="checkbox" name="enabled" defaultChecked={c.enabled}/> enabled</label>
            <button className="qf-aarohi-btn">Save</button>
          </form></td>
        </tr>)}</tbody>
      </table></div>
    </section>
    <section className="qf-aarohi-panel" style={{marginTop:14}}>
      <div className="qf-aarohi-panel-head"><div><h2>City acquisition policies</h2><p>Every city is independently disabled/enabled. Quiet hours and caps apply before automated authorization.</p></div></div>
      <div className="qf-aarohi-table-wrap"><table className="qf-aarohi-table">
        <thead><tr><th>City</th><th>Modes</th><th>Quiet hours</th><th>Caps</th><th>Autonomy</th><th>Categories</th><th>Save</th></tr></thead>
        <tbody>{cityPolicies.map((p:any)=><tr key={p.id}>
          <td><b>{p.cities?.name||p.city_id}</b><br/><small>{p.cities?.is_active?"ACTIVE":"INACTIVE"}</small></td>
          <td><form id={`city-policy-${p.id}`} action={updateAarohiCityPolicyAction.bind(null,p.city_id)}>
            <label><input type="checkbox" name="enabled" defaultChecked={p.enabled}/> master</label><br/>
            <label><input type="checkbox" name="discovery_enabled" defaultChecked={p.discovery_enabled}/> discovery</label><br/>
            <label><input type="checkbox" name="outreach_enabled" defaultChecked={p.outreach_enabled}/> outreach</label><br/>
            <label><input type="checkbox" name="broadcasts_enabled" defaultChecked={p.broadcasts_enabled}/> broadcasts</label>
          </form></td>
          <td><input form={`city-policy-${p.id}`} className="qf-aarohi-input" name="quiet_start" type="time" defaultValue={String(p.quiet_start).slice(0,5)}/><br/>
              <input form={`city-policy-${p.id}`} className="qf-aarohi-input" name="quiet_end" type="time" defaultValue={String(p.quiet_end).slice(0,5)}/></td>
          <td><label>Discovery<input form={`city-policy-${p.id}`} className="qf-aarohi-input" name="daily_discovery_cap" type="number" min="1" max="5000" defaultValue={p.daily_discovery_cap}/></label>
              <label>Outreach<input form={`city-policy-${p.id}`} className="qf-aarohi-input" name="daily_outreach_cap" type="number" min="1" max="5000" defaultValue={p.daily_outreach_cap}/></label></td>
          <td><input form={`city-policy-${p.id}`} className="qf-aarohi-input" name="autonomy_level" type="number" min="0" max="4" defaultValue={p.autonomy_level}/></td>
          <td><input form={`city-policy-${p.id}`} className="qf-aarohi-input" name="categories" defaultValue={Array.isArray(p.categories)?p.categories.join(", "):""} placeholder="Interior Design, Painting"/></td>
          <td><button form={`city-policy-${p.id}`} className="qf-aarohi-btn">Save</button></td>
        </tr>)}</tbody>
      </table></div>
    </section>
    <section className="qf-aarohi-panel" style={{marginTop:14}}>
      <div className="qf-aarohi-panel-head"><div><h2>Discovery candidates</h2><p>Promotion creates or links an Aarohi prospect only; it never creates a Core vendor.</p></div></div>
      <div className="qf-aarohi-table-wrap"><table className="qf-aarohi-table">
        <thead><tr><th>Business</th><th>Source</th><th>City</th><th>Category</th><th>Confidence</th><th>State</th><th>Prospect</th><th>Action</th></tr></thead>
        <tbody>{candidates.map((c:any)=><tr key={c.id}>
          <td><b>{c.business_name}</b><br/><small>{c.profile_url||c.website||c.external_reference}</small></td>
          <td><AarohiBadge>{c.source_type}</AarohiBadge></td><td>{c.city_hint||"—"}</td><td>{c.category_hint||"—"}</td>
          <td>{c.confidence}</td><td><AarohiBadge tone={c.state==="PROMOTED"?"good":c.state==="REVIEW"?"warn":"neutral"}>{c.state}</AarohiBadge></td>
          <td>{c.prospect_id?<ProspectLink id={c.prospect_id}>Open</ProspectLink>:"—"}</td>
          <td>{["NEW","REVIEW"].includes(c.state)?<form action={promoteDiscoveryCandidateAction.bind(null,c.id)}><button className="qf-aarohi-btn">Promote</button></form>:"—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
    <div className="qf-aarohi-grid2" style={{marginTop:14}}><Bars title="By source" rows={d.bySource}/><Bars title="By category" rows={d.byCategory}/></div>
    <p className="qf-aarohi-note" style={{marginTop:12}}>Instagram/Facebook arbitrary browser cold-DM automation is structurally disabled. Social discovery may be automated; first contact follows the channel policy.</p>
  </>;
}
