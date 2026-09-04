"use client";

import { ClientSelectedVendorEnquiry } from "@/components/vendors/ClientSelectedVendorEnquiry";
import { FreeVendorInterestButton } from "@/components/FreeVendorInterestButton";
import { CONTACT_TEL } from "@/lib/config";
import type { VendorPublicProfileView } from "./profileModel";

/**
 * The ONE canonical profile action (QF-UI-V2-07).
 *
 * Before this phase the profile had three CTAs with two different meanings:
 *   - desktop side card -> ClientSelectedVendorEnquiry  (specific-vendor intent)
 *   - hero              -> generic EnquiryModalTrigger  (NO targeting)
 *   - mobile fixed bar  -> generic EnquiryModalTrigger  (NO targeting)
 * So "Send Enquiry" on a specific vendor's profile silently lost that vendor on
 * the two most-used surfaces.
 *
 * There is now exactly ONE action, and it is ClientSelectedVendorEnquiry — the
 * purpose-built profile authority (Phase 26A-2E). The vendor's city / category /
 * subcategory / parent group are locked as hidden context and it calls
 * sendClientSelectedVendorEnquiry, which sets assignment_intent
 * "client_selected_vendor" and applies the 1-hour recharge window. Nothing about
 * that backend behaviour is changed here: the drifting hero and mobile CTAs were
 * removed rather than the correct one being replaced.
 *
 * Free / unpaid vendors keep the gated FreeVendorInterestButton and never get a
 * selected-vendor enquiry. No surface renders a vendor's own phone, WhatsApp or
 * email; the only tel: link is QuickFurno's own switchboard.
 */
export function VendorPrimaryAction({
  vendor,
  enquiryService,
  parentCategoryGroup,
  className,
  freeLabel = "Request callback",
}: {
  vendor: VendorPublicProfileView;
  enquiryService: string;
  parentCategoryGroup?: string;
  className?: string;
  freeLabel?: string;
}) {
  if (vendor.activePaidPlan) {
    return (
      <ClientSelectedVendorEnquiry
        className={className}
        vendorId={vendor.id}
        vendorName={vendor.businessName}
        city={vendor.city}
        area={vendor.serviceAreas[0]}
        serviceCategory={enquiryService}
        subcategory={vendor.services[0] ?? vendor.category}
        parentCategoryGroup={parentCategoryGroup}
      />
    );
  }

  return (
    <FreeVendorInterestButton
      className={className}
      vendorId={vendor.id}
      vendorName={vendor.businessName}
      city={vendor.city}
      area={vendor.serviceAreas[0] ?? null}
      category={vendor.category}
      subcategory={vendor.services[0] ?? vendor.category}
    >
      {freeLabel}
    </FreeVendorInterestButton>
  );
}

/**
 * The single action card.
 *
 * Rendered ONCE in the DOM. CSS places it immediately after the hero on phones
 * (so the primary action is above the fold) and as the sticky right rail from
 * 1024px. There is deliberately no second fixed mobile bar: the canonical action
 * is ClientSelectedVendorEnquiry, which expands into a seven-field form inline
 * and cannot live inside a fixed bar, and stacking another fixed bar above the
 * public bottom nav would duplicate the action and crowd the viewport (§26's
 * stated alternative). Measured: the card's primary button is above the fold at
 * 360, 390 and 430 wide.
 */
export function VendorProfileActionCard({
  vendor,
  enquiryService,
  parentCategoryGroup,
}: {
  vendor: VendorPublicProfileView;
  enquiryService: string;
  parentCategoryGroup?: string;
}) {
  return (
    <div className="qf-vprofile-actioncard">
      <span className="qf-pub-eyebrow">Interested in this vendor?</span>
      <h2>{vendor.businessName}</h2>
      <p>
        {vendor.activePaidPlan
          ? "Send your requirement. QuickFurno will prioritise this vendor first."
          : "Send your details and QuickFurno will arrange a callback about this vendor."}
      </p>

      <VendorPrimaryAction
        vendor={vendor}
        enquiryService={enquiryService}
        parentCategoryGroup={parentCategoryGroup}
        className="qf-pub-btn qf-pub-btn--primary qf-pub-btn--block"
      />

      {/* QuickFurno's own switchboard — never the vendor's number. */}
      <a className="qf-vprofile-actioncard-tel" href={CONTACT_TEL}>
        Call QuickFurno
      </a>

      <ul className="qf-vprofile-actioncard-points">
        <li>Free for homeowners</li>
        <li>Your contact details are shared only through the enquiry process</li>
        <li>QuickFurno may match up to 3 relevant verified vendors</li>
      </ul>
    </div>
  );
}
