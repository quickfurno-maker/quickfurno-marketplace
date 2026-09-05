import Link from "next/link";
import type { VendorDashboardStats, VendorProfileSummary } from "@/lib/types";
import { VendorAccessStatus } from "./VendorAccessStatus";
import { VendorAttentionLeads } from "./VendorAttentionLeads";
import { VendorBusinessSummary } from "./VendorBusinessSummary";
import { VendorMetricGrid, type VendorMetric } from "./VendorMetricCard";
import { VendorOverviewHeader } from "./VendorOverviewHeader";
import { VendorProfileProgress } from "./VendorProfileProgress";
import {
  LOW_CREDIT_THRESHOLD,
  countActiveLeads,
  evaluateProfileCompletion,
  type VendorOverviewLead,
} from "./vendorOverviewModel";

/**
 * Vendor Overview (QF-UI-V2-01).
 *
 * Server component end to end — nothing here needs interactivity, so the whole
 * Overview stays off the client bundle. The only client code in the portal is
 * the shell's active-nav state and the mobile "More" drawer.
 *
 * Four KPIs, no more. "Response Rate" was REMOVED rather than restyled: its
 * formula, (total_leads - in_progress) / total_leads, measured how many
 * assignments had left the in-progress bucket, which is CRM progress, not
 * responsiveness. No honest replacement exists from loaded data.
 */
export function VendorOverview({
  vendor,
  stats,
  leads,
}: {
  vendor: VendorProfileSummary;
  stats: VendorDashboardStats;
  leads: VendorOverviewLead[];
}) {
  const activeLeads = countActiveLeads(leads);
  const completion = evaluateProfileCompletion(vendor);
  const credits = stats.remaining_credits;

  const metrics: VendorMetric[] = [
    {
      key: "assigned",
      label: "Assigned leads",
      value: String(stats.total_leads),
      caption: "Enquiries matched to you in total",
      icon: "leads",
      href: "/vendor/dashboard/leads",
    },
    {
      key: "active",
      label: "Needs follow-up",
      value: String(activeLeads),
      caption: "Open leads not yet converted or closed",
      icon: "clock",
      href: "/vendor/dashboard/leads",
    },
    {
      key: "credits",
      label: "Lead credits",
      value: String(credits),
      caption: credits <= 0 ? "Recharge to receive new enquiries" : "Remaining on your package",
      icon: "credits",
      tone: credits <= LOW_CREDIT_THRESHOLD ? "warn" : "default",
      href: "/vendor/dashboard/package",
    },
    {
      key: "profile",
      label: "Profile completion",
      value: `${completion.percent}%`,
      caption: completion.complete
        ? "All profile details added"
        : `${completion.missing.length} detail${completion.missing.length === 1 ? "" : "s"} still missing`,
      icon: "profile",
      tone: completion.complete ? "ok" : "default",
      href: "/vendor/dashboard/profile",
    },
  ];

  return (
    <div className="qf-vendor-v2-overview">
      <VendorOverviewHeader vendor={vendor} />

      <VendorMetricGrid metrics={metrics} />

      <div className="qf-vendor-v2-columns">
        <div className="qf-vendor-v2-col qf-vendor-v2-col--main">
          <VendorAttentionLeads vendor={vendor} leads={leads} />
        </div>
        <div className="qf-vendor-v2-col qf-vendor-v2-col--side">
          <VendorAccessStatus vendor={vendor} remainingCredits={credits} />
          {/* QF-UI-V2-01R: at 100% the panel would only restate the KPI above
              it, so it is not rendered at all. Below 100% it is the actionable
              half of the pair — the KPI gives the number, this gives the list
              of what is missing. */}
          {completion.complete ? null : <VendorProfileProgress vendor={vendor} />}
          {completion.complete ? <VendorBusinessSummary vendor={vendor} variant="column" /> : null}
        </div>
      </div>

      {/* Identity summary. Normally a full-width strip below the two columns, so
          the left column does not run short of the taller status column. When
          the completion panel is absent the right column would instead run
          short, so the summary moves into it and keeps both columns balanced. */}
      {completion.complete ? null : <VendorBusinessSummary vendor={vendor} variant="strip" />}

      <p className="qf-vendor-v2-overview-foot">
        Need a hand with a lead or your package?{" "}
        <Link href="/vendor/dashboard/support">Contact QuickFurno support</Link>.
      </p>
    </div>
  );
}
