import type { VendorProfileSummary } from "@/lib/types";
import { VendorPanel } from "./VendorPanel";
import { joinOrDash, textOrDash } from "./vendorOverviewModel";

/**
 * A compact identity strip — category, service area, visibility, verification.
 *
 * Deliberately NOT the profile editor: the full field list, the office address
 * and the map link belong on My Profile (QF-UI-V2-03), so the Overview keeps
 * only what confirms "the marketplace has me listed correctly".
 */
export function VendorBusinessSummary({ vendor }: { vendor: VendorProfileSummary }) {
  const category =
    textOrDash(vendor.selected_category) !== "—"
      ? textOrDash(vendor.selected_category)
      : joinOrDash(vendor.service_categories);

  const rows: { label: string; value: string }[] = [
    { label: "Category", value: category },
    { label: "City", value: textOrDash(vendor.city) },
    { label: "Service areas", value: joinOrDash(vendor.areas_covered) },
    { label: "Business type", value: textOrDash(vendor.business_type) },
  ];

  return (
    <VendorPanel
      title="Business profile"
      action={{ label: "Manage profile", href: "/vendor/dashboard/profile" }}
    >
      <dl className="qf-vendor-v2-summary">
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </VendorPanel>
  );
}
