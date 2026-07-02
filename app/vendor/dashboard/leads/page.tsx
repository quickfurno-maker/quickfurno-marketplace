import Link from "next/link";
import { getMyVendor, vendorLeads, vendorUpdateLeadStatusFromForm } from "@/app/actions";
import { VendorNoProfileFallback } from "@/app/vendor/dashboard/_components/VendorNoProfileFallback";
import { VendorLeadReportForm } from "@/components/vendors/VendorLeadReportForm";
import type { VendorLeadStatus, VendorProfileSummary } from "@/lib/types";

export const metadata = { title: "Vendor leads - QuickFurno" };
export const dynamic = "force-dynamic";

// CRM statuses only. "Lost" is a CRM state — it never refunds credit, removes
// the assignment, or triggers reassignment. Vendors cannot accept/reject/decline
// an assigned lead; issues are raised via the structured Report lead issue form.
const statuses: VendorLeadStatus[] = ["New", "Contacted", "Follow-up Needed", "Site Visit Scheduled", "Quotation Sent", "Converted", "Lost"];

type VendorLeadsPageProps = {
  searchParams?: {
    lead?: string;
    code?: string;
  };
};

type VendorLeadRow = {
  id: string;
  assigned_at: string | null;
  assignment_type: string | null;
  vendor_status: VendorLeadStatus;
  is_bad_lead_reported: boolean | null;
  lead: {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    city: string;
    area: string | null;
    service_required: string;
    budget: string | null;
    property_type: string | null;
    timeline: string | null;
    message: string | null;
    created_at: string | null;
  } | null;
};

export default async function VendorLeadsPage({ searchParams }: VendorLeadsPageProps) {
  const me = await getMyVendor();
  const vendor = me.ok ? me.data : null;

  if (!vendor) {
    return <VendorNoProfileFallback />;
  }

  const eligible = canViewClientContact(vendor);
  const leadsResult = await vendorLeads(vendor.id);
  const leads = leadsResult.ok ? (leadsResult.data as VendorLeadRow[]) : [];

  return (
    <section className="qf-vd-page">
      <div className="qf-vd-card">
        <div className="qf-vd-section-head">
          <div>
            <h1 className="qf-vd-card-title">Assigned leads</h1>
            <p className="qf-vd-muted">
              Review QuickFurno leads assigned to your business. Client contact is shown only after your vendor account is approved, active, and paid.
            </p>
          </div>
          <Link className="qf-vd-btn qf-vd-btn--ghost" href="/vendor/dashboard/package">
            Package / Recharge
          </Link>
        </div>

        {searchParams?.lead === "status-updated" ? <p className="qf-vd-success">Lead status updated.</p> : null}
        {searchParams?.lead === "bad-lead-submitted" ? (
          <p className="qf-vd-success">
            Bad lead report submitted. QuickFurno admin will review your reason. Credit is not refunded automatically.
          </p>
        ) : null}
        {searchParams?.lead === "failed" || searchParams?.lead === "report-failed" ? (
          <p className="qf-vd-error">Lead action failed. Please check the required fields and try again.</p>
        ) : null}
        {!leadsResult.ok ? <p className="qf-vd-error">Assigned leads are not available right now.</p> : null}

        {!eligible ? <LeadAccessNotice vendor={vendor} /> : null}

        {leads.length === 0 ? (
          <div className="qf-vd-empty">
            <p>Your assigned QuickFurno leads will appear here after your package is active.</p>
          </div>
        ) : (
          <div className="qf-vd-leads">
            {leads.map((assignment) => {
              const lead = assignment.lead;
              if (!lead) return null;
              return (
                <article key={assignment.id} className="qf-vd-lead">
                  <div className="qf-vd-lead-head">
                    <div>
                      <strong>{lead.name || "Client"}</strong>
                      <span>{lead.service_required || "Requirement"}</span>
                    </div>
                    <span className="qf-vd-lead-status" data-status={assignment.vendor_status}>
                      {assignment.vendor_status || "New"}
                    </span>
                  </div>

                  <dl className="qf-vd-lead-meta">
                    <div><dt>Contact</dt><dd>{eligible && lead.phone ? lead.phone : "Hidden until eligible"}</dd></div>
                    <div><dt>City / Area</dt><dd>{[lead.area, lead.city].filter(Boolean).join(", ") || "Not set"}</dd></div>
                    <div><dt>Category</dt><dd>{lead.service_required || "Not set"}</dd></div>
                    <div><dt>Budget</dt><dd>{lead.budget || "Not set"}</dd></div>
                    <div><dt>Timeline</dt><dd>{lead.timeline || "Not set"}</dd></div>
                  </dl>

                  {lead.message ? <p className="qf-vd-lead-msg">{lead.message}</p> : null}

                  {eligible ? (
                    <div className="qf-vd-lead-foot">
                      <span className="qf-vd-mini-label">Update status</span>
                      <div className="qf-vd-pills">
                        {statuses.map((status) => (
                          <form key={status} action={vendorUpdateLeadStatusFromForm}>
                            <input type="hidden" name="assignmentId" value={assignment.id} />
                            <input type="hidden" name="status" value={status} />
                            <button className={`qf-vd-pill${assignment.vendor_status === status ? " is-on" : ""}`} type="submit">
                              {status}
                            </button>
                          </form>
                        ))}
                      </div>

                      <div className="qf-vd-report">
                        {assignment.is_bad_lead_reported ? (
                          <span className="qf-vd-report-done">
                            Your report has been submitted for admin review. Reporting a lead does not automatically reverse lead credit.
                          </span>
                        ) : (
                          <VendorLeadReportForm vendorId={vendor.id} assignmentId={assignment.id} />
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="qf-vd-lead-foot">
                      <p className="qf-vd-note">
                        Contact details, status updates, and bad-lead reports unlock after approval and active paid access.
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function LeadAccessNotice({ vendor }: { vendor: VendorProfileSummary }) {
  const approved = String(vendor.status ?? "").toLowerCase() === "approved";
  const active = vendor.is_active !== false;
  const paid = String(vendor.paid_status ?? "").toLowerCase() === "paid";
  const message = !approved
    ? "Your vendor profile must be approved before client contact is visible."
    : !active
      ? "Your vendor account is inactive. Contact QuickFurno support to restore lead access."
      : !paid
        ? "Activate a package to view assigned lead contact details."
        : "Lead contact access is currently restricted.";

  return (
    <div className="qf-vd-access-lock">
      <div>
        <strong>Lead contact is hidden</strong>
        <p>{message}</p>
      </div>
      {!paid ? (
        <Link className="qf-vd-btn qf-vd-btn--primary" href="/vendor/dashboard/package">
          Activate package
        </Link>
      ) : null}
    </div>
  );
}

function canViewClientContact(vendor: VendorProfileSummary) {
  return String(vendor.status ?? "").toLowerCase() === "approved"
    && vendor.is_active !== false
    && String(vendor.paid_status ?? "").toLowerCase() === "paid";
}
