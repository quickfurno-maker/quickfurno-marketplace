"use client";

import Image from "next/image";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { FreeVendorInterestButton } from "@/components/FreeVendorInterestButton";
import { CONTACT_TEL, whatsappLink } from "@/lib/config";
import { categoryImage } from "@/lib/images";
import {
  enquiryServiceForCategory,
  getVendorListingMeta,
  getVendorServiceChips,
  type Vendor,
} from "@/lib/quickfurno-data";

export function VendorDetailHeader({ vendor }: { vendor: Vendor }) {
  const meta = getVendorListingMeta(vendor);
  const enquiryService = enquiryServiceForCategory(vendor.category);
  // Paid/trial vendors keep the standard QuickFurno-brokered contact actions;
  // free/unpaid vendors only expose the gated interest capture (no direct/private
  // contact, no WhatsApp) — consistent with the profile side card + mobile CTA.
  const isPaidOrTrialEligible = vendor.activePaidPlan;

  // Real Supabase vendors must not show static/demo service chips or direct
  // Call/WhatsApp. They use real canonical services (if any) and route contact
  // through QuickFurno only.
  const isSupabaseVendor = vendor.source === "supabase";
  const showDirectContact = !isSupabaseVendor && isPaidOrTrialEligible;
  const thumbChips = isSupabaseVendor
    ? (vendor.serviceCategories ?? []).slice(0, 3)
    : getVendorServiceChips(vendor).slice(0, 3).map((service) => service.label);
  const isNewSupabaseVendor = isSupabaseVendor && vendor.reviews === 0;

  return (
    <section className="vendor-detail-header">
      <div className="vendor-detail-gallery">
        <div className="vendor-detail-main-img">
          <Image
            src={vendor.coverImageUrl ?? vendor.imageUrl ?? categoryImage(vendor.category)}
            alt={`${vendor.businessName} project preview`}
            fill
            sizes="(max-width: 760px) 100vw, 460px"
            priority
            className="vendor-detail-img"
          />
        </div>
        <div className="vendor-detail-thumbs" aria-hidden="true">
          {thumbChips.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>

      <div className="vendor-detail-summary">
        <div className="vendor-detail-badge-row">
          {vendor.verified ? <span className="qf-mini-badge qf-mini-badge--verified">Verified</span> : null}
          {vendor.activePaidPlan ? <span className="qf-mini-badge qf-mini-badge--premium">Premium</span> : null}
          {/* Response status is real only for static demo vendors; hide it for Supabase. */}
          {!isSupabaseVendor ? <span className="qf-mini-badge">{meta.openStatus}</span> : null}
        </div>

        <h1>{vendor.businessName}</h1>
        <p className="vendor-detail-subtitle">
          {isSupabaseVendor
            ? `${vendor.category} · ${meta.locality}`
            : `${vendor.category} · ${vendor.subCategory} · ${meta.locality}`}
        </p>

        <div className="vendor-detail-proof">
          {isNewSupabaseVendor ? (
            <span className="vendor-rating-pill">New on QuickFurno</span>
          ) : (
            <>
              <span className="vendor-rating-pill">
                {vendor.rating.toFixed(1)} <span aria-hidden="true">&#9733;</span>
              </span>
              <span>{vendor.reviews} reviews</span>
            </>
          )}
          <span>{vendor.experience} experience</span>
          <span>{meta.distance}</span>
        </div>

        <p className="vendor-detail-description">{vendor.description}</p>

        <div className="vendor-detail-actions">
          {isPaidOrTrialEligible ? (
            <>
              {showDirectContact ? (
                <>
                  <a className="qf-action-btn qf-action-btn--call" href={CONTACT_TEL}>
                    Call Now
                  </a>
                  <a
                    className="qf-action-btn qf-action-btn--whatsapp"
                    href={whatsappLink(`Hi QuickFurno, I want a quote from ${vendor.businessName}.`)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    WhatsApp
                  </a>
                </>
              ) : null}
              <EnquiryModalTrigger
                className="qf-action-btn qf-action-btn--enquiry"
                modalTitle={`Get quote from ${vendor.businessName}`}
                serviceCategory={enquiryService}
                city={vendor.city}
                area={meta.locality.split(",")[0]}
                requirement={`I want a quote from ${vendor.businessName} for ${vendor.category}.`}
                source={`Vendor profile enquiry: ${vendor.slug}`}
              >
                Send Enquiry
              </EnquiryModalTrigger>
            </>
          ) : (
            <FreeVendorInterestButton
              className="qf-action-btn qf-action-btn--enquiry"
              vendorId={vendor.slug}
              vendorName={vendor.businessName}
              city={vendor.city}
              area={meta.locality.split(",")[0]}
              category={vendor.category}
              subcategory={vendor.subCategory}
            >
              Request Callback
            </FreeVendorInterestButton>
          )}
        </div>
      </div>
    </section>
  );
}
