import { recordAarohiAcquisitionCostAction } from "@/app/admin/aarohi/actions";
import {
  AarohiBadge,
  AarohiMetric,
  AarohiPageHead,
} from "@/components/admin/aarohi/AarohiPrimitives";
import {
  getAarohiAnalytics,
  listActiveAarohiCities,
  listAarohiCampaigns,
} from "@/services/aarohiCrmService";
import {
  getAarohiPhase2AttributionAnalytics,
  listAarohiAcquisitionCosts,
} from "@/services/aarohiPhase2OpsService";

export const dynamic = "force-dynamic";

function money(minor: number | null) {
  if (minor == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(minor / 100);
}
function rows(input: Record<string, { prospects: number; activated: number }>) {
  return Object.entries(input).sort((a, b) => b[1].prospects - a[1].prospects);
}

export default async function AnalyticsPage() {
  const [crm, phase2, costs, cities, campaigns] = await Promise.all([
    getAarohiAnalytics(),
    getAarohiPhase2AttributionAnalytics(),
    listAarohiAcquisitionCosts(50),
    listActiveAarohiCities(),
    listAarohiCampaigns(),
  ]);
  const max = Math.max(1, ...crm.funnel.map((x) => x.count));
  const metric = (name: string) => crm.eventCounts[name] ?? 0;
  return (
    <>
      <AarohiPageHead
        title="Acquisition analytics"
        description="Descriptive source, channel, city and cost attribution from stored Core/CRM evidence. No opaque conversion prediction or inferred ROI."
      />
      <div className="qf-aarohi-metrics">
        <AarohiMetric label="Prospects" value={phase2.totals.prospects} />
        <AarohiMetric
          label="Activated vendors"
          value={phase2.totals.activated}
        />
        <AarohiMetric
          label="Social replies"
          value={phase2.totals.socialReplies}
        />
        <AarohiMetric
          label="Social → WhatsApp"
          value={phase2.totals.whatsappContinuations}
        />
        <AarohiMetric
          label="Recorded spend"
          value={money(phase2.totals.recordedSpendMinorInr)}
        />
        <AarohiMetric
          label="Cost / activated vendor"
          value={money(phase2.totals.costPerActivatedVendorMinorInr)}
        />
      </div>
      <div className="qf-aarohi-grid2">
        <section className="qf-aarohi-panel">
          <div className="qf-aarohi-panel-head">
            <div>
              <h2>Source attribution</h2>
              <p>First observed acquisition source per canonical prospect.</p>
            </div>
          </div>
          <div className="qf-aarohi-table-wrap">
            <table className="qf-aarohi-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Prospects</th>
                  <th>Activated</th>
                  <th>Observed rate</th>
                </tr>
              </thead>
              <tbody>
                {rows(phase2.bySource).map(([name, v]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{v.prospects}</td>
                    <td>{v.activated}</td>
                    <td>
                      {v.prospects
                        ? Math.round((v.activated / v.prospects) * 100) + "%"
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="qf-aarohi-panel">
          <div className="qf-aarohi-panel-head">
            <div>
              <h2>Channel execution</h2>
              <p>Queue/provider facts, not estimated performance.</p>
            </div>
          </div>
          <div className="qf-aarohi-table-wrap">
            <table className="qf-aarohi-table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Jobs</th>
                  <th>Provider accepted</th>
                  <th>Waiting reply</th>
                  <th>Blocked</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(phase2.outreachByChannel).map(([name, v]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{v.jobs}</td>
                    <td>{v.accepted}</td>
                    <td>{v.waitingReply}</td>
                    <td>{v.blocked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <div className="qf-aarohi-grid2" style={{ marginTop: 14 }}>
        <section className="qf-aarohi-panel">
          <div className="qf-aarohi-panel-head">
            <div>
              <h2>City conversion</h2>
              <p>Canonical city attribution.</p>
            </div>
          </div>
          <div className="qf-aarohi-table-wrap">
            <table className="qf-aarohi-table">
              <thead>
                <tr>
                  <th>City</th>
                  <th>Prospects</th>
                  <th>Activated</th>
                </tr>
              </thead>
              <tbody>
                {rows(phase2.byCity).map(([name, v]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{v.prospects}</td>
                    <td>{v.activated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="qf-aarohi-panel">
          <div className="qf-aarohi-panel-head">
            <div>
              <h2>Category conversion</h2>
              <p>No ranking; descriptive counts only.</p>
            </div>
          </div>
          <div className="qf-aarohi-table-wrap">
            <table className="qf-aarohi-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Prospects</th>
                  <th>Activated</th>
                </tr>
              </thead>
              <tbody>
                {rows(phase2.byCategory)
                  .slice(0, 30)
                  .map(([name, v]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{v.prospects}</td>
                      <td>{v.activated}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <section className="qf-aarohi-panel" style={{ marginTop: 14 }}>
        <div className="qf-aarohi-panel-head">
          <div>
            <h2>Acquisition cost evidence</h2>
            <p>
              Record actual external spend. Cost-per-activation stays blank
              until both spend and activated-vendor evidence exist.
            </p>
          </div>
        </div>
        <form
          action={recordAarohiAcquisitionCostAction}
          className="qf-aarohi-formgrid"
        >
          <label>
            Date
            <input
              name="occurred_on"
              type="date"
              required
              className="qf-aarohi-input"
            />
          </label>
          <label>
            Amount ₹
            <input
              name="amount_rupees"
              type="number"
              min="0"
              step="0.01"
              required
              className="qf-aarohi-input"
            />
          </label>
          <label>
            Channel
            <select name="channel" className="qf-aarohi-select">
              <option value="">Unattributed</option>
              {[
                "INSTAGRAM",
                "FACEBOOK",
                "X",
                "WHATSAPP",
                "WEBSITE",
                "GOOGLE",
                "JUSTDIAL",
                "INDIAMART",
                "OTHER",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Source
            <input
              name="source_type"
              className="qf-aarohi-input"
              placeholder="optional source"
            />
          </label>
          <label>
            City
            <select name="city_id" className="qf-aarohi-select">
              <option value="">All / unknown</option>
              {cities.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Campaign
            <select name="campaign_id" className="qf-aarohi-select">
              <option value="">None</option>
              {(campaigns as any[]).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Source reference
            <input
              name="source_reference"
              required
              className="qf-aarohi-input"
              placeholder="invoice/ad-platform reference"
            />
          </label>
          <label className="wide">
            Note
            <input name="note" className="qf-aarohi-input" />
          </label>
          <button className="qf-aarohi-btn" data-tone="primary">
            Record cost evidence
          </button>
        </form>
        <div className="qf-aarohi-table-wrap" style={{ marginTop: 12 }}>
          <table className="qf-aarohi-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Channel/source</th>
                <th>City</th>
                <th>Campaign</th>
                <th>Amount</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {costs.map((c: any) => (
                <tr key={c.id}>
                  <td>{c.occurred_on}</td>
                  <td>{c.channel || c.source_type || "—"}</td>
                  <td>{c.cities?.name || "—"}</td>
                  <td>{c.aarohi_campaigns?.name || "—"}</td>
                  <td>
                    {c.currency === "INR"
                      ? money(Number(c.amount_minor))
                      : c.amount_minor + " " + c.currency}
                  </td>
                  <td>{c.source_reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="qf-aarohi-panel" style={{ marginTop: 14 }}>
        <div className="qf-aarohi-panel-head">
          <div>
            <h2>Lifecycle funnel</h2>
            <p>Stored CRM stage/event truth.</p>
          </div>
        </div>
        <div className="qf-aarohi-funnel">
          {crm.funnel.map((r, i) => {
            const prev = i ? crm.funnel[i - 1].count : 0;
            return (
              <div className="qf-aarohi-funnel-row" key={r.stage}>
                <span>{r.stage}</span>
                <div className="qf-aarohi-funnel-track">
                  <div
                    className="qf-aarohi-funnel-fill"
                    style={{ width: `${Math.max(2, (r.count / max) * 100)}%` }}
                  />
                </div>
                <b>
                  {r.count}
                  {prev ? ` · ${Math.round((r.count / prev) * 100)}%` : ""}
                </b>
              </div>
            );
          })}
        </div>
        <div className="qf-aarohi-cardmeta" style={{ marginTop: 12 }}>
          <AarohiBadge>
            Conversations {metric("conversation.started")}
          </AarohiBadge>
          <AarohiBadge>
            Registrations {metric("registration.completed")}
          </AarohiBadge>
          <AarohiBadge>Payments {metric("payment.confirmed")}</AarohiBadge>
        </div>
      </section>
    </>
  );
}
