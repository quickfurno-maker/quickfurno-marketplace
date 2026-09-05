import Link from "next/link";
import type { VendorProfileSummary } from "@/lib/types";
import { VendorIcon } from "../icons";

/**
 * Why EVERY lead's contact is hidden at once, and where to go about it.
 *
 * QF-MVP-80.15C narrowed this notice to the only condition that still blocks the
 * whole page: an account that is not approved, or is inactive. It no longer
 * mentions packages or credits, because those cannot hide an assignment the
 * canonical authority already charged for — telling a vendor to recharge in
 * order to read a lead they have already paid for was the false part of the old
 * copy. Per-assignment reasons now live on the individual card.
 *
 * It re-derives nothing: the caller decides with isVendorAccountContactEligible()
 * and renders this only when that is false.
 */
export function VendorLeadAccessNotice({ vendor }: { vendor: VendorProfileSummary }) {
  const approved = String(vendor.status ?? "").toLowerCase() === "approved";

  const message = !approved
    ? "Your vendor profile must be approved before client contact is visible."
    : "Your vendor account is inactive. Contact QuickFurno support to restore lead access.";

  const action = !approved
    ? { label: "Review my profile", href: "/vendor/dashboard/profile" }
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
