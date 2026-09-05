import Link from "next/link";
import type { VendorContactAccessEligibility } from "@/lib/vendors/vendorEligibility";
import type { VendorProfileSummary } from "@/lib/types";
import { VendorIcon } from "../icons";

/**
 * Why client contact is hidden, and where to go about it.
 *
 * The reason ladder is carried over verbatim from the pre-V2 LeadAccessNotice:
 * it only READS the eligibility result the page already computed with
 * evaluateVendorContactAccessEligibility(). It re-derives nothing, so there is
 * no second implementation of eligibility to drift out of step with the first.
 */
export function VendorLeadAccessNotice({
  vendor,
  contactAccess,
}: {
  vendor: VendorProfileSummary;
  contactAccess: VendorContactAccessEligibility;
}) {
  const approved = String(vendor.status ?? "").toLowerCase() === "approved";
  const active = vendor.is_active !== false;
  const hasPaidAccess = contactAccess.visibilityType === "paid" || contactAccess.visibilityType === "trial";

  const message = !approved
    ? "Your vendor profile must be approved before client contact is visible."
    : !active
      ? "Your vendor account is inactive. Contact QuickFurno support to restore lead access."
      : !hasPaidAccess
        ? "Activate a package to view assigned lead contact details."
        : contactAccess.credits <= 0
          ? "Recharge your lead credits to view assigned lead contact details."
          : "Lead contact access is currently restricted.";

  const action = !approved
    ? { label: "Review my profile", href: "/vendor/dashboard/profile" }
    : !active
      ? { label: "Contact support", href: "/vendor/dashboard/support" }
      : !hasPaidAccess
        ? { label: "Activate package", href: "/vendor/dashboard/package" }
        : contactAccess.credits <= 0
          ? { label: "Recharge credits", href: "/vendor/dashboard/package" }
          : { label: "Contact support", href: "/vendor/dashboard/support" };

  return (
    <div className="qf-vendor-v2-leads-alert" data-tone="warn">
      <span className="qf-vendor-v2-leads-alert-icon" aria-hidden="true">
        <VendorIcon name="lock" size={18} />
      </span>
      <div className="qf-vendor-v2-leads-alert-body">
        <p className="qf-vendor-v2-leads-alert-title">Client contact is hidden</p>
        <p className="qf-vendor-v2-leads-alert-text">{message}</p>
      </div>
      <Link href={action.href} className="qf-vendor-v2-btn qf-vendor-v2-btn--primary">
        {action.label}
      </Link>
    </div>
  );
}
