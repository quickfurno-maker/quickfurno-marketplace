import Link from "next/link";
import type { VendorProfileSummary } from "@/lib/types";
import { VendorIcon } from "./icons";
import { VendorEmptyState, VendorPanel } from "./VendorPanel";
import {
  canViewClientContact,
  formatAssignedAgo,
  isVendorPaid,
  isVendorVerified,
  selectAttentionLeads,
  type VendorOverviewLead,
} from "./vendorOverviewModel";

const LEADS_HREF = "/vendor/dashboard/leads";

/**
 * "Needs your attention" — a SHORTLIST, not the CRM.
 *
 * Deliberately absent, because they belong on the Leads page: the seven status
 * buttons, the bad-lead report form, the full enquiry message. This section
 * offers at most two actions per lead — call (only where the existing contact
 * rule already allows it) and open the full Leads page.
 */
export function VendorAttentionLeads({
  vendor,
  leads,
}: {
  vendor: VendorProfileSummary;
  leads: VendorOverviewLead[];
}) {
  const shortlist = selectAttentionLeads(leads);
  const contactAllowed = canViewClientContact(vendor);
  const verified = isVendorVerified(vendor);

  return (
    <VendorPanel
      title="Needs your attention"
      hint="Open enquiries, most urgent first."
      action={leads.length > 0 ? { label: "All leads", href: LEADS_HREF } : undefined}
    >
      {shortlist.length === 0 ? (
        <VendorEmptyState
          icon="inbox"
          title={leads.length === 0 ? "No leads assigned yet" : "Nothing needs attention"}
          message={
            leads.length === 0
              ? verified
                ? "Matched client enquiries will appear here as soon as they are assigned to you."
                : "Client enquiries will start arriving once your profile is verified and lead access is active."
              : "Every assigned enquiry is marked converted or closed. New matches will show up here."
          }
          action={leads.length === 0 ? undefined : { label: "Open Leads", href: LEADS_HREF }}
        />
      ) : (
        <>
          <ul className="qf-vendor-v2-leadlist">
            {shortlist.map((assignment) => {
              const lead = assignment.lead;
              if (!lead) return null;
              const place = [lead.area, lead.city].filter(Boolean).join(", ") || lead.city;
              const assignedAgo = formatAssignedAgo(assignment.assigned_at);
              const showCall = contactAllowed && Boolean(lead.phone);

              return (
                <li key={assignment.id} className="qf-vendor-v2-leadrow">
                  <div className="qf-vendor-v2-leadrow-main">
                    <div className="qf-vendor-v2-leadrow-title">
                      <strong>{lead.name}</strong>
                      <span
                        className="qf-vendor-v2-leadstatus"
                        data-status={assignment.vendor_status}
                      >
                        {assignment.vendor_status}
                      </span>
                    </div>
                    <p className="qf-vendor-v2-leadrow-service">{lead.service_required}</p>
                    <ul className="qf-vendor-v2-leadrow-meta">
                      <li>
                        <VendorIcon name="pin" size={14} />
                        {place}
                      </li>
                      {lead.budget ? <li>Budget {lead.budget}</li> : null}
                      {assignedAgo ? (
                        <li>
                          <VendorIcon name="clock" size={14} />
                          {assignedAgo}
                        </li>
                      ) : null}
                    </ul>
                  </div>

                  <div className="qf-vendor-v2-leadrow-actions">
                    {showCall ? (
                      <a className="qf-vendor-v2-btn qf-vendor-v2-btn--primary" href={`tel:${lead.phone}`}>
                        <VendorIcon name="phone" size={16} />
                        Call client
                      </a>
                    ) : (
                      <span className="qf-vendor-v2-locked">
                        <VendorIcon name="lock" size={14} />
                        {contactAllowed
                          ? "No contact number on this enquiry"
                          : isVendorPaid(vendor)
                            ? "Contact hidden until your account is active"
                            : "Contact details unlock with an active package"}
                      </span>
                    )}
                    {/* Quiet text link, not a second button: one solid action
                        per row keeps the list from reading as a wall of CTAs. */}
                    <Link href={LEADS_HREF} className="qf-vendor-v2-leadlink">
                      Open lead
                      <VendorIcon name="arrow-right" size={15} />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>

          <Link href={LEADS_HREF} className="qf-vendor-v2-panel-foot-link">
            View all leads and update statuses
            <VendorIcon name="arrow-right" size={16} />
          </Link>
        </>
      )}
    </VendorPanel>
  );
}
