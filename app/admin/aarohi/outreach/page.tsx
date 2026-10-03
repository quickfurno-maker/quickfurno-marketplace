import { AarohiBadge,AarohiMetric,AarohiPageHead,ProspectLink,formatWhen } from "@/components/admin/aarohi/AarohiPrimitives";
import { getAarohiPhase2Dashboard,listAarohiMemorySnapshots,listAarohiOutreachJobs } from "@/services/aarohiPhase2AcquisitionService";

export const dynamic="force-dynamic";

export default async function AarohiOutreachPage(){
  const [dashboard,jobs,memory]=await Promise.all([
    getAarohiPhase2Dashboard(),
    listAarohiOutreachJobs(),
    listAarohiMemorySnapshots(30),
  ]);
  const state=(name:string)=>Number((dashboard.outreachStates as Record<string,number>)[name]??0);
  return <>
    <AarohiPageHead
      title="Outreach control"
      description="Governed acquisition queue. Cold social initiation, Core authorization and provider dispatch remain separate authorities."
    />
    <div className="qf-aarohi-metrics">
      <AarohiMetric label="Needs human first contact" value={state("NEEDS_HUMAN_REVIEW")}/>
      <AarohiMetric label="Needs Core authorization" value={state("NEEDS_CORE_AUTHORIZATION")}/>
      <AarohiMetric label="Authorized" value={state("AUTHORIZED")}/>
      <AarohiMetric label="Waiting reply" value={state("WAITING_REPLY")}/>
      <AarohiMetric label="Memory snapshots" value={dashboard.memorySnapshots}/>
    </div>
    <section className="qf-aarohi-panel">
      <div className="qf-aarohi-panel-head">
        <div><h2>Acquisition work queue</h2><p>No row on this page is itself permission to send.</p></div>
      </div>
      <div className="qf-aarohi-table-wrap"><table className="qf-aarohi-table">
        <thead><tr><th>Prospect</th><th>Channel</th><th>Initiation</th><th>State</th><th>Priority</th><th>Authorization</th><th>Updated</th></tr></thead>
        <tbody>{jobs.map((row:any)=><tr key={row.id}>
          <td><ProspectLink id={row.prospect_id}>{row.aarohi_prospects?.business_name||row.prospect_id}</ProspectLink></td>
          <td><AarohiBadge>{row.channel}</AarohiBadge></td>
          <td>{row.initiation_mode}</td>
          <td><AarohiBadge tone={row.state==="BLOCKED"||row.state==="CANCELLED"?"hot":row.state==="AUTHORIZED"?"good":"warn"}>{row.state}</AarohiBadge></td>
          <td>{row.priority}</td>
          <td>{row.core_authorization_ref?<AarohiBadge tone="good">CORE BOUND</AarohiBadge>:<AarohiBadge tone="warn">REQUIRED</AarohiBadge>}</td>
          <td>{formatWhen(row.updated_at)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
    <section className="qf-aarohi-panel" style={{marginTop:14}}>
      <div className="qf-aarohi-panel-head"><div><h2>Unified memory</h2><p>Content-minimized context only; never a business authority source.</p></div></div>
      <div className="qf-aarohi-table-wrap"><table className="qf-aarohi-table">
        <thead><tr><th>Prospect</th><th>Version</th><th>Last channel</th><th>Safe context</th><th>Updated</th></tr></thead>
        <tbody>{memory.map((row:any)=><tr key={row.prospect_id}>
          <td><ProspectLink id={row.prospect_id}>{row.aarohi_prospects?.business_name||row.prospect_id}</ProspectLink></td>
          <td>v{row.version}</td><td>{row.last_channel||"—"}</td>
          <td style={{maxWidth:540}}>{row.safe_summary||"—"}</td><td>{formatWhen(row.updated_at)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
    <p className="qf-aarohi-note">Instagram/Facebook cold starts remain human-assisted. X and WhatsApp still require Core authorization before any provider action.</p>
  </>;
}
