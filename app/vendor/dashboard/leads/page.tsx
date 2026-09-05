import Link from "next/link";
import { getMyVendor, vendorLeads } from "@/app/actions";
import { VendorNoProfileFallback } from "@/app/vendor/dashboard/_components/VendorNoProfileFallback";
import { VendorIcon } from "@/components/vendor-dashboard-v2/icons";
import { VendorLeadAccessNotice } from "@/components/vendor-dashboard-v2/leads/VendorLeadAccessNotice";
import { VendorLeadsBoard } from "@/components/vendor-dashboard-v2/leads/VendorLeadsBoard";
import { VendorLeadsFeedback } from "@/components/vendor-dashboard-v2/leads/VendorLeadsFeedback";
import {
  buildVendorLeadViews,
  readLeadFeedback,
  type VendorLeadRawRow,
} from "@/components/vendor-dashboard-v2/leads/leadsModel";
import { isVendorAccountContactEligible } from "@/lib/vendors/assignedLeadContactAccess";
import "./vendor-leads-v2.css";

export const metadata = { title: "Vendor leads - QuickFurno" };
export const dynamic = "force-dynamic";

type VendorLeadsPageProps = {
  searchParams?: {
    lead?: string;
    code?: string;
  };
};

export default async function VendorLeadsPage({ searchParams }: VendorLeadsPageProps) {
  const me = await getMyVendor();
  const vendor = me.ok ? me.data : null;

  if (!vendor) {
    return <VendorNoProfileFallback />;
  }

  // QF-MVP-80.15C — contact access is decided PER ASSIGNMENT inside
  // getVendorAssignedLeads(), which already stripped the phone from every row it
  // did not entitle. The page no longer re-derives a second vendor-wide verdict:
  // doing so was the bug, because it let a lapsed package or a wallet drained to
  // zero hide a lead the vendor had already been charged for.
  const leadsResult = await vendorLeads(vendor.id);
  const rows = leadsResult.ok ? (leadsResult.data as VendorLeadRawRow[]) : [];

  // Account-level notice only. This decides NOTHING about the rows; it explains
  // the one case that still blocks every lead at once — an account that is not
  // approved, or is inactive.
  const accountBlocked = !isVendorAccountContactEligible(vendor as unknown as Record<string, unknown>);

  // THE BOUNDARY. The board is a client component, so anything handed to it is
  // serialized into the page. buildVendorLeadViews copies fields explicitly,
  // never spreads the raw row, drops email unconditionally, and includes the
  // client's phone only when `contactAllowed` is true. A blocked vendor's
  // payload therefore contains no client contact detail to leak — not in
  // markup, not in an attribute, not in the flight data.
  const leads = buildVendorLeadViews(rows);

  const feedback = readLeadFeedback(searchParams?.lead);

  return (
    <div className="qf-vendor-v2-leads">
      <header className="qf-vendor-v2-leads-head">
        <div>
          <h1 className="qf-vendor-v2-leads-title">Leads</h1>
          <p className="qf-vendor-v2-leads-sub">Manage enquiries assigned to your business.</p>
        </div>
        <Link href="/vendor/dashboard/package" className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet">
          {/* Shortened on phones so the header action never wraps to two lines. */}
          Credits<span className="qf-vendor-v2-leads-head-more">&nbsp;&amp; package</span>
        </Link>
      </header>

      {feedback ? <VendorLeadsFeedback feedback={feedback} /> : null}

      {!leadsResult.ok ? (
        <div className="qf-vendor-v2-leads-alert" data-tone="error" role="status">
          <span className="qf-vendor-v2-leads-alert-icon" aria-hidden="true">
            <VendorIcon name="alert" size={18} />
          </span>
          <p className="qf-vendor-v2-leads-alert-text">
            Assigned leads are not available right now. Please refresh in a moment.
          </p>
        </div>
      ) : null}

      {accountBlocked ? <VendorLeadAccessNotice vendor={vendor} /> : null}

      {rows.length === 0 ? (
        <div className="qf-vendor-v2-panel">
          <div className="qf-vendor-v2-empty">
            <span className="qf-vendor-v2-empty-icon" aria-hidden="true">
              <VendorIcon name="inbox" size={22} />
            </span>
            <p className="qf-vendor-v2-empty-title">No leads yet</p>
            <p className="qf-vendor-v2-empty-message">
              {accountBlocked
                ? "Matched enquiries will appear here once your vendor account is active."
                : "Matched enquiries will appear here as soon as they are assigned to your business."}
            </p>
            {accountBlocked ? (
              <Link
                href="/vendor/dashboard/support"
                className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet"
              >
                Contact support
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <VendorLeadsBoard leads={leads} vendorId={vendor.id} />
      )}
    </div>
  );
}
