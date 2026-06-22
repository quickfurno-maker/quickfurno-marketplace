"use client";

import Image from "next/image";
import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { CONTACT_TEL, whatsappLink } from "@/lib/config";
import { categoryImage } from "@/lib/images";
import {
  enquiryServiceForCategory,
  getVendorListingMeta,
  getVendorServiceChips,
  type Vendor,
} from "@/lib/quickfurno-data";

export function VendorCompactCard({
  vendor,
  priority = false,
  showCategory = false,
}: {
  vendor: Vendor;
  priority?: boolean;
  showCategory?: boolean;
}) {
  const meta = getVendorListingMeta(vendor);
  const serviceChips = getVendorServiceChips(vendor);
  const visibleChips = serviceChips.slice(0, 3);
  const hiddenChipCount = Math.max(serviceChips.length - visibleChips.length, 0);
  const enquiryService = enquiryServiceForCategory(vendor.category);

  return (
    <article className={`vendor-compact-card ${vendor.activePaidPlan ? "vendor-compact-card--premium" : ""}`}>
      <Link className="vendor-compact-thumb" href={`/vendors/${vendor.slug}`} aria-label={`View ${vendor.businessName}`}>
        <Image
          src={vendor.imageUrl ?? categoryImage(vendor.category)}
          alt={`${vendor.businessName} project preview`}
          fill
          sizes="(max-width: 560px) 82px, 104px"
          className="vendor-compact-img"
          priority={priority}
        />
      </Link>

      <div className="vendor-compact-main">
        <div className="vendor-compact-heading">
          <div>
            <h3>
              <Link href={`/vendors/${vendor.slug}`}>{vendor.businessName}</Link>
            </h3>
            <p>
              {showCategory ? `${vendor.category} · ` : ""}
              {vendor.subCategory}
            </p>
          </div>
          <div className="vendor-compact-badges" aria-label="Vendor badges">
            {vendor.verified ? <span className="qf-mini-badge qf-mini-badge--verified">Verified</span> : null}
            {vendor.activePaidPlan ? <span className="qf-mini-badge qf-mini-badge--premium">Premium</span> : null}
          </div>
        </div>

        <div className="vendor-compact-proof">
          <span className="vendor-rating-pill">
            {vendor.rating > 0 ? (
              <>
                {vendor.rating.toFixed(1)} <span aria-hidden="true">&#9733;</span>
              </>
            ) : (
              "New"
            )}
          </span>
          <span>{vendor.reviews > 0 ? `${vendor.reviews} reviews` : "No reviews yet"}</span>
          <span>{meta.locality}</span>
          <span>{meta.distance}</span>
        </div>

        <p className="vendor-compact-status">{meta.openStatus}</p>

        <div className="vendor-compact-trust" aria-label="Quick trust indicators">
          {meta.trustSignals.slice(0, 4).map((signal) => (
            <span key={signal}>{signal}</span>
          ))}
        </div>

        <div className="vendor-service-chips" aria-label="Services and starting prices">
          {visibleChips.map((chip) => (
            <span key={`${chip.label}-${chip.price}`}>
              {chip.label} <strong>{chip.price}</strong>
            </span>
          ))}
          {hiddenChipCount > 0 ? <span>+{hiddenChipCount} more</span> : null}
        </div>

        <div className="vendor-compact-actions">
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
          {/* Lead routing hook: category enquiries should prefer eligible paid vendors by city/package,
             while free listed vendors stay visible and are not auto-assigned unless enabled later. */}
          <EnquiryModalTrigger
            className="qf-action-btn qf-action-btn--enquiry"
            modalTitle={`Get quote from ${vendor.businessName}`}
            serviceCategory={enquiryService}
            city={vendor.city}
            area={meta.locality.split(",")[0]}
            requirement={`I want a quote from ${vendor.businessName} for ${vendor.category}.`}
            source={`Vendor card enquiry: ${vendor.slug}`}
          >
            Send Enquiry
          </EnquiryModalTrigger>
        </div>
      </div>
    </article>
  );
}
