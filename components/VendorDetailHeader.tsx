"use client";

import Image from "next/image";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
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
  const services = getVendorServiceChips(vendor).slice(0, 3);
  const enquiryService = enquiryServiceForCategory(vendor.category);

  return (
    <section className="vendor-detail-header">
      <div className="vendor-detail-gallery">
        <div className="vendor-detail-main-img">
          <Image
            src={vendor.imageUrl ?? categoryImage(vendor.category)}
            alt={`${vendor.businessName} project preview`}
            fill
            sizes="(max-width: 760px) 100vw, 460px"
            priority
            className="vendor-detail-img"
          />
        </div>
        <div className="vendor-detail-thumbs" aria-hidden="true">
          {services.map((service) => (
            <span key={service.label}>{service.label}</span>
          ))}
        </div>
      </div>

      <div className="vendor-detail-summary">
        <div className="vendor-detail-badge-row">
          {vendor.verified ? <span className="qf-mini-badge qf-mini-badge--verified">Verified</span> : null}
          {vendor.activePaidPlan ? <span className="qf-mini-badge qf-mini-badge--premium">Premium</span> : null}
          <span className="qf-mini-badge">{meta.openStatus}</span>
        </div>

        <h1>{vendor.businessName}</h1>
        <p className="vendor-detail-subtitle">
          {vendor.category} · {vendor.subCategory} · {meta.locality}
        </p>

        <div className="vendor-detail-proof">
          <span className="vendor-rating-pill">
            {vendor.rating.toFixed(1)} <span aria-hidden="true">&#9733;</span>
          </span>
          <span>{vendor.reviews} reviews</span>
          <span>{vendor.experience} experience</span>
          <span>{meta.distance}</span>
        </div>

        <p className="vendor-detail-description">{vendor.description}</p>

        <div className="vendor-detail-actions">
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
        </div>
      </div>
    </section>
  );
}
