import type { VendorProfileSummary } from "@/lib/types";
import { VendorPanel } from "./VendorPanel";
import { joinOrDash, textOrDash } from "./vendorOverviewModel";

/**
 * A compact identity strip — category, city, service area, business type.
 *
 * Deliberately NOT the profile editor: the full field list, the office address
 * and the map link belong on My Profile (QF-UI-V2-03), so the Overview keeps
 * only what confirms "the marketplace has me listed correctly".
 *
 * `variant` controls placement, not content:
 *   "strip"  — full width below the two columns, labels/values four-up.
 *   "column" — inside the right column, stacked label/value rows. Used when the
 *              Profile completion panel is absent (100% complete) so the right
 *              column still balances the taller attention list.
 */
export function VendorBusinessSummary({
  vendor,
  variant = "strip",
}: {
  vendor: VendorProfileSummary;
  variant?: "strip" | "column";
}) {
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
      className={variant === "strip" ? "qf-vendor-v2-panel--strip" : undefined}
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
