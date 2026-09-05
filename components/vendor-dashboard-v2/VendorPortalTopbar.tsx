"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { VendorIcon } from "./icons";
import { VendorPortalBrand } from "./VendorPortalBrand";
import { vendorPageTitle } from "./navigation";

/**
 * Compact topbar. On desktop it carries only page context on the left and the
 * notification + account controls on the right — the wordmark lives in the
 * sidebar, so it is NOT repeated here. Below the desktop breakpoint the
 * wordmark reappears, because there is no sidebar to hold it.
 */
export function VendorPortalTopbar({
  businessName,
  verified,
}: {
  businessName: string | null;
  verified: boolean;
}) {
  const pathname = usePathname();
  const title = vendorPageTitle(pathname);
  const initial = businessName?.trim().charAt(0).toUpperCase() || "V";

  return (
    <header className="qf-vendor-v2-topbar">
      <div className="qf-vendor-v2-topbar-lead">
        <span className="qf-vendor-v2-topbar-brand">
          <VendorPortalBrand size="sm" />
        </span>
        <span className="qf-vendor-v2-topbar-context">
          <span className="qf-vendor-v2-topbar-eyebrow">Vendor Portal</span>
          <h2 className="qf-vendor-v2-topbar-title">{title}</h2>
        </span>
      </div>

      <div className="qf-vendor-v2-topbar-actions">
        <Link
          href="/vendor/dashboard/notifications"
          className="qf-vendor-v2-iconbtn"
          aria-label="Notifications"
          title="Notifications"
        >
          <VendorIcon name="bell" size={19} />
        </Link>

        {businessName ? (
          <Link href="/vendor/dashboard/profile" className="qf-vendor-v2-account" title="My profile">
            <span className="qf-vendor-v2-account-avatar" aria-hidden="true">
              {initial}
            </span>
            <span className="qf-vendor-v2-account-text">
              <span className="qf-vendor-v2-account-name">{businessName}</span>
              <span className="qf-vendor-v2-account-meta">
                {verified ? "Verified vendor" : "Under review"}
              </span>
            </span>
          </Link>
        ) : null}
      </div>
    </header>
  );
}
