import type { VendorProfileSummary } from "@/lib/types";
import { VendorIcon } from "./icons";
import { VendorPanel } from "./VendorPanel";
import { evaluateProfileCompletion } from "./vendorOverviewModel";

/**
 * Deterministic profile completion.
 *
 * The percentage is present / total over the fixed field list in
 * vendorOverviewModel.VENDOR_PROFILE_FIELDS — no weighting, no scoring model,
 * and it is NEVER written back to the database. The missing-field checklist is
 * the actionable part; the number is only a summary of it.
 */
export function VendorProfileProgress({ vendor }: { vendor: VendorProfileSummary }) {
  const completion = evaluateProfileCompletion(vendor);

  return (
    <VendorPanel
      title="Profile completion"
      action={{ label: "Manage profile", href: "/vendor/dashboard/profile" }}
    >
      <div className="qf-vendor-v2-progress-head">
        <strong className="qf-vendor-v2-progress-value">{completion.percent}%</strong>
        <span className="qf-vendor-v2-progress-count">
          {completion.present} of {completion.total} details added
        </span>
      </div>

      <div
        className="qf-vendor-v2-progress-track"
        role="progressbar"
        aria-valuenow={completion.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Profile completion"
      >
        <span className="qf-vendor-v2-progress-fill" style={{ width: `${completion.percent}%` }} />
      </div>

      {completion.complete ? (
        <p className="qf-vendor-v2-progress-done">
          <VendorIcon name="check" size={16} />
          All profile details are filled in.
        </p>
      ) : (
        <>
          <p className="qf-vendor-v2-progress-label">Still missing</p>
          <ul className="qf-vendor-v2-checklist">
            {completion.missing.map((field) => (
              <li key={field.key}>
                <VendorIcon name="alert" size={15} />
                {field.label}
              </li>
            ))}
          </ul>
        </>
      )}
    </VendorPanel>
  );
}
