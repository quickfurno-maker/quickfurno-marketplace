import type { VendorProfileSummary } from "@/lib/types";
import { vendorSubmitGovernedChangeRequest } from "@/app/actions";
import { ALLOWED_PROFILE_CATEGORIES } from "./profileModel";

/**
 * Vendor OS V3 — sensitive information is REQUEST-ONLY. No editable
 * verification, matching, credits, owner identity or Auth controls exist here.
 * Server Core independently validates vendor ownership and validates fields.
 */
export function VendorGovernedChangeRequestForms({ vendor, pendingKinds }: {
  vendor: VendorProfileSummary;
  pendingKinds: readonly string[];
}) {
  const contactPending = pendingKinds.includes("owner_contact_change");
  const coveragePending = pendingKinds.includes("service_coverage_change");
  return (
    <>
      <section className="qf-vendor-v2-panel qf-vendor-v2-profile-section">
        <header className="qf-vendor-v2-profile-section-head">
          <h2 className="qf-vendor-v2-panel-title">Owner &amp; contact change request</h2>
          <p className="qf-vendor-v2-profile-section-hint">
            These are sensitive identity details. Submit the corrected values for QuickFurno
            verification. Your login, phone and approved account details will not change automatically.
          </p>
        </header>
        <div className="qf-vendor-v2-profile-section-body">
          <p className="qf-vendor-v2-profile-hint">
            Current owner: {vendor.owner_name || "Not set"} · Email: {vendor.email || "Not set"} · Contact: {vendor.phone || "Not set"}
          </p>
          <form action={vendorSubmitGovernedChangeRequest} className="qf-vendor-v2-profile-editor">
            <input type="hidden" name="request_family" value="owner_contact_change" />
            <label className="qf-vendor-v2-profile-field">
              <span className="qf-vendor-v2-profile-label">New owner name</span>
              <input name="owner_name" maxLength={100} placeholder="Only if changing" className="qf-vendor-v2-profile-input" autoComplete="off" disabled={contactPending} />
            </label>
            <label className="qf-vendor-v2-profile-field">
              <span className="qf-vendor-v2-profile-label">New email</span>
              <input name="email" type="email" maxLength={254} placeholder="Only if changing" className="qf-vendor-v2-profile-input" autoComplete="off" disabled={contactPending} />
            </label>
            <label className="qf-vendor-v2-profile-field">
              <span className="qf-vendor-v2-profile-label">New phone (international format)</span>
              <input name="phone" type="tel" maxLength={16} placeholder="+919876543210" className="qf-vendor-v2-profile-input" autoComplete="off" disabled={contactPending} />
            </label>
            <button type="submit" disabled={contactPending} className="qf-vendor-v2-btn qf-vendor-v2-btn--primary">
              {contactPending ? "Contact change awaiting review" : "Request contact verification"}
            </button>
          </form>
          <p className="qf-vendor-v2-profile-hint">
            Approval requires separate identity and contact verification by QuickFurno; submission alone grants no authority.
          </p>
        </div>
      </section>
      <section className="qf-vendor-v2-panel qf-vendor-v2-profile-section">
        <header className="qf-vendor-v2-profile-section-head">
          <h2 className="qf-vendor-v2-panel-title">Service city &amp; category request</h2>
          <p className="qf-vendor-v2-profile-section-hint">
            Request changes to service coverage; these do not change Google-verified location,
            matching eligibility, service zones or lead assignment before independent approval.
          </p>
        </header>
        <div className="qf-vendor-v2-profile-section-body">
          <p className="qf-vendor-v2-profile-hint">
            Current approved city: {vendor.city || "Not set"}
          </p>
          <form action={vendorSubmitGovernedChangeRequest} className="qf-vendor-v2-profile-editor">
            <input type="hidden" name="request_family" value="service_coverage_change" />
            <label className="qf-vendor-v2-profile-field">
              <span className="qf-vendor-v2-profile-label">Requested city (review only)</span>
              <input name="requested_city" maxLength={100} required defaultValue={vendor.city || ""} disabled={coveragePending} className="qf-vendor-v2-profile-input" />
            </label>
            <fieldset disabled={coveragePending} className="qf-vendor-v2-profile-field">
              <legend className="qf-vendor-v2-profile-label">Requested service categories</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ALLOWED_PROFILE_CATEGORIES.map(category => (
                  <label key={category} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="requested_categories" value={category}
                      defaultChecked={Boolean(vendor.service_categories?.includes(category))} />
                    <span>{category}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button type="submit" disabled={coveragePending} className="qf-vendor-v2-btn qf-vendor-v2-btn--primary">
              {coveragePending ? "Coverage change awaiting review" : "Request service coverage review"}
            </button>
          </form>
          <p className="qf-vendor-v2-profile-hint">
            City text is NOT a verified Google location. Matching remains unchanged until Core verifies and activates the approved service zone.
          </p>
        </div>
      </section>
    </>
  );
}
