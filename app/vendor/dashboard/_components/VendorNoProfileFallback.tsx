import Link from "next/link";
import { VendorIcon } from "@/components/vendor-dashboard-v2/icons";

/**
 * Shown when a signed-in account has no linked vendor row. QF-UI-V2-01 restyles
 * this state only — the destination and the flow it points at are unchanged.
 */
export function VendorNoProfileFallback() {
  return (
    <div className="qf-vendor-v2-standalone">
      <div className="qf-vendor-v2-panel qf-vendor-v2-standalone-panel">
        <span className="qf-vendor-v2-empty-icon" aria-hidden="true">
          <VendorIcon name="profile" size={22} />
        </span>
        <h1 className="qf-vendor-v2-standalone-title">No vendor profile yet</h1>
        <p className="qf-vendor-v2-standalone-text">
          Your account isn&apos;t linked to a vendor profile yet. Complete your application to get
          started — our team will verify your details and enable dashboard access.
        </p>
        <Link href="/vendor?mode=signup" className="qf-vendor-v2-btn qf-vendor-v2-btn--primary">
          Complete application
          <VendorIcon name="arrow-right" size={16} />
        </Link>
      </div>
    </div>
  );
}
