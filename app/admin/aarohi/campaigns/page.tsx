import { AarohiBadge,AarohiPageHead,formatWhen } from "@/components/admin/aarohi/AarohiPrimitives";
import { listAarohiCampaigns } from "@/services/aarohiCrmService";
import { listAarohiBroadcastBatches } from "@/services/aarohiPhase2AcquisitionService";
import { createCampaignAction,planWhatsAppBroadcastAction } from "../actions";

export const dynamic="force-dynamic";

export default async function CampaignsPage(){
  const [rows,batches]=await Promise.all([listAarohiCampaigns(),listAarohiBroadcastBatches()]);
  return <>
    <AarohiPageHead title="Campaigns" description="Segmentation, planning and governed broadcast preparation. Campaign membership never grants communication authorization." action={
      <details><summary className="qf-aarohi-btn" data-tone="primary">New campaign</summary>
        <form action={createCampaignAction} className="qf-aarohi-panel" style={{position:"absolute",right:28,zIndex:10,width:420,marginTop:8}}>
          <label>Name<input name="name" required className="qf-aarohi-input"/></label>
          <label>Description<textarea name="description" className="qf-aarohi-textarea"/></label>
          <button className="qf-aarohi-btn" data-tone="primary">Create grouping</button>
        </form>
      </details>
    }/>
    <section className="qf-aarohi-panel">
      <div className="qf-aarohi-panel-head"><div><h2>Campaign groups</h2><p>Plan WhatsApp batches only from campaign membership; each prospect still passes suppression and Core authorization.</p></div></div>
      <div className="qf-aarohi-table-wrap"><table className="qf-aarohi-table">
        <thead><tr><th>Campaign</th><th>Status</th><th>Prospects</th><th>Created</th><th>WhatsApp batch planning</th></tr></thead>
        <tbody>{(rows as any[]).map((c:any)=><tr key={c.id}>
          <td><b>{c.name}</b><br/><small>{c.description||"—"}</small></td>
          <td><AarohiBadge>{c.status}</AarohiBadge></td>
          <td>{c.aarohi_campaign_members?.[0]?.count??0}</td>
          <td>{formatWhen(c.created_at)}</td>
          <td><form action={planWhatsAppBroadcastAction.bind(null,c.id)} style={{display:"flex",gap:8,alignItems:"end",flexWrap:"wrap"}}>
            <label style={{minWidth:190}}>Approved template<input className="qf-aarohi-input" name="template_name" required placeholder="template_name"/></label>
            <label style={{width:110}}>Daily cap<input className="qf-aarohi-input" name="daily_cap" type="number" min="1" max="10000" defaultValue="1000"/></label>
            <button className="qf-aarohi-btn">Plan batch</button>
          </form></td>
        </tr>)}</tbody>
      </table></div>
    </section>
    <section className="qf-aarohi-panel" style={{marginTop:14}}>
      <div className="qf-aarohi-panel-head"><div><h2>WhatsApp broadcast batches</h2><p>Planning is not sending. Provider execution remains deployment-gated.</p></div></div>
      <div className="qf-aarohi-table-wrap"><table className="qf-aarohi-table">
        <thead><tr><th>Campaign</th><th>Template</th><th>State</th><th>Target</th><th>Authorized</th><th>Dispatched</th><th>Failed</th><th>Cap</th><th>Created</th></tr></thead>
        <tbody>{batches.map((b:any)=><tr key={b.id}>
          <td>{b.aarohi_campaigns?.name||b.campaign_id}</td><td>{b.template_name}</td>
          <td><AarohiBadge tone={b.state==="BLOCKED"?"hot":b.state==="COMPLETED"?"good":"warn"}>{b.state}</AarohiBadge></td>
          <td>{b.target_count}</td><td>{b.authorized_count}</td><td>{b.dispatched_count}</td><td>{b.failed_count}</td><td>{b.daily_cap}</td><td>{formatWhen(b.created_at)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
    <p className="qf-aarohi-note">There is intentionally no direct “blast” control. A batch becomes executable only after the final provider deployment and per-recipient Core authorization path are live.</p>
  </>;
}
