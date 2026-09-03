import Link from "next/link";
import type { VendorProfileSummary } from "@/lib/types";
import { VendorIcon } from "./icons";
import { VendorStatusPill } from "./VendorPanel";
import { isVendorVerified } from "./vendorOverviewModel";

/**
 * Overview greeting. Answers "who am I and what is my standing" in one glance.
 *
 * NOTE: there is deliberately NO "Accepting leads" toggle here. No authorised
 * vendor-side mutation exists for is_active / public_visibility, so a switch
 * would be a control that silently does nothing. Standing is reported, not
 * offered as a setting.
 */
export function VendorOverviewHeader({ vendor }: { vendor: VendorProfileSummary }) {
  const verified = isVendorVerified(vendor);
  // Only offered when the profile is actually reachable by a client: the public
  // vendor route resolves by id, and public_visibility is the existing gate.
  const publicProfileHref = vendor.public_visibility ? `/vendors/${vendor.id}` : null;

  return (
    <header className="qf-vendor-v2-overview-head">
      <div className="qf-vendor-v2-overview-headtext">
        <h1 className="qf-vendor-v2-greeting">
          Welcome back, <span>{vendor.business_name}</span>
        </h1>
        <p className="qf-vendor-v2-greeting-sub">
          Manage your leads, profile and QuickFurno credits from one place.
        </p>
      </div>

      <div className="qf-vendor-v2-overview-headmeta">
        <VendorStatusPill tone={verified ? "ok" : "pending"} icon={verified ? "shield" : "clock"}>
          {verified ? "Verified vendor" : "Profile under review"}
        </VendorStatusPill>
        {publicProfileHref ? (
          <Link
            href={publicProfileHref}
            className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet"
            target="_blank"
            rel="noopener noreferrer"
          >
            View public profile
            <VendorIcon name="external" size={16} />
          </Link>
        ) : null}
      </div>
    </header>
  );
}
