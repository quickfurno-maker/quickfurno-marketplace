import { AarohiBadge,AarohiMetric,AarohiPageHead,ProspectLink,formatWhen } from "@/components/admin/aarohi/AarohiPrimitives";
import { getAarohiPhase2Dashboard,listAarohiCapacitySnapshots,listAarohiFollowupPolicies,listAarohiMemorySnapshots,listAarohiOutreachJobs } from "@/services/aarohiPhase2AcquisitionService";
import { markAarohiAssistedFirstContactJobAction,recordAarohiCapacitySnapshotAction,upsertAarohiFollowupPolicyAction } from "../actions";

export const dynamic="force-dynamic";

export default async function AarohiOutreachPage(){
  const [dashboard,jobs,memory,capacity,followupPolicies]=await Promise.all([
    getAarohiPhase2Dashboard(),
    listAarohiOutreachJobs(),
    listAarohiMemorySnapshots(30),
    listAarohiCapacitySnapshots(24),
    listAarohiFollowupPolicies(),
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
        <thead><tr><th>Prospect</th><th>Channel</th><th>Initiation</th><th>State</th><th>Priority</th><th>Authorization</th><th>Blocked reason</th><th>Operator action</th><th>Updated</th></tr></thead>
        <tbody>{jobs.map((row:any)=><tr key={row.id}>
          <td><ProspectLink id={row.prospect_id}>{row.aarohi_prospects?.business_name||row.prospect_id}</ProspectLink></td>
          <td><AarohiBadge>{row.channel}</AarohiBadge></td>
          <td>{row.initiation_mode}</td>
          <td><AarohiBadge tone={row.state==="BLOCKED"||row.state==="CANCELLED"?"hot":row.state==="AUTHORIZED"?"good":"warn"}>{row.state}</AarohiBadge></td>
          <td>{row.priority}</td>
          <td>{row.core_authorization_ref?<AarohiBadge tone="good">CORE BOUND</AarohiBadge>:<AarohiBadge tone="warn">REQUIRED</AarohiBadge>}</td>
          <td>{row.last_error_code||"—"}</td>
          <td>{row.state==="NEEDS_HUMAN_REVIEW"&&["INSTAGRAM","FACEBOOK"].includes(row.channel)
            ?<form action={markAarohiAssistedFirstContactJobAction.bind(null,row.id)} style={{display:"flex",gap:6}}>
              <input className="qf-aarohi-input" name="external_reference" placeholder="optional message ref"/>
              <button className="qf-aarohi-btn">Mark DM sent</button>
            </form>:"—"}</td>
          <td>{formatWhen(row.updated_at)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
    <div className="qf-aarohi-grid2" style={{marginTop:14}}>
      <section className="qf-aarohi-panel">
        <div className="qf-aarohi-panel-head"><div><h2>Provider capacity evidence</h2><p>Short-lived evidence only. Missing/expired/RED capacity blocks automated authorization.</p></div></div>
        <form action={recordAarohiCapacitySnapshotAction} className="qf-aarohi-formgrid">
          <label>Channel<select name="channel" className="qf-aarohi-select"><option>WHATSAPP</option><option>INSTAGRAM</option><option>FACEBOOK</option><option>X</option></select></label>
          <label>State<select name="state" className="qf-aarohi-select"><option>UNKNOWN</option><option>GREEN</option><option>YELLOW</option><option>RED</option></select></label>
          <label>Provider key<input name="provider_key" required className="qf-aarohi-input" placeholder="meta_whatsapp_cloud"/></label>
          <label>Provider account id<input name="provider_account_id" className="qf-aarohi-input"/></label>
          <label>Daily limit<input name="daily_limit" type="number" min="0" className="qf-aarohi-input"/></label>
          <label>Used today<input name="used_today" type="number" min="0" defaultValue="0" className="qf-aarohi-input"/></label>
          <label>Main reserve<input name="reserved_for_main" type="number" min="0" defaultValue="0" className="qf-aarohi-input"/></label>
          <label>Acquisition available<input name="acquisition_available" type="number" min="0" defaultValue="0" className="qf-aarohi-input"/></label>
          <label>TTL minutes<input name="ttl_minutes" type="number" min="5" max="1440" defaultValue="60" className="qf-aarohi-input"/></label>
          <label>Reason<input name="reason_code" className="qf-aarohi-input"/></label>
          <button className="qf-aarohi-btn" data-tone="primary">Record evidence</button>
        </form>
        <div className="qf-aarohi-stack" style={{marginTop:10}}>{capacity.slice(0,8).map((c:any)=><div key={c.id} className="qf-aarohi-listrow">
          <div><b>{c.channel} · {c.provider_key}</b><br/><small>{c.reason_code||"—"} · expires {formatWhen(c.expires_at)}</small></div>
          <AarohiBadge tone={c.state==="GREEN"?"good":c.state==="RED"?"hot":"warn"}>{c.state} · {c.acquisition_available} available</AarohiBadge>
        </div>)}</div>
      </section>
      <section className="qf-aarohi-panel">
        <div className="qf-aarohi-panel-head"><div><h2>Follow-up policies</h2><p>No enabled policy means no automatic follow-up.</p></div></div>
        <form action={upsertAarohiFollowupPolicyAction} className="qf-aarohi-formgrid">
          <label>Channel<select name="channel" className="qf-aarohi-select"><option>WHATSAPP</option><option>INSTAGRAM</option><option>FACEBOOK</option><option>X</option></select></label>
          <label>Trigger stage<input name="trigger_stage" required className="qf-aarohi-input" placeholder="REPLIED or *"/></label>
          <label>Delay minutes<input name="delay_minutes" type="number" min="60" max="43200" defaultValue="1440" className="qf-aarohi-input"/></label>
          <label>Max attempts<input name="max_attempts" type="number" min="1" max="10" defaultValue="1" className="qf-aarohi-input"/></label>
          <label><input type="checkbox" name="enabled"/> enabled</label>
          <button className="qf-aarohi-btn">Save policy</button>
        </form>
        <div className="qf-aarohi-stack" style={{marginTop:10}}>{followupPolicies.map((p:any)=><div key={p.id} className="qf-aarohi-listrow">
          <div><b>{p.channel} · {p.trigger_stage}</b><br/><small>{p.delay_minutes} min · max {p.max_attempts}</small></div>
          <AarohiBadge tone={p.enabled?"good":"neutral"}>{p.enabled?"ENABLED":"OFF"}</AarohiBadge>
        </div>)}</div>
      </section>
    </div>
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
