import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { PortfolioGallery } from "@/components/PortfolioGallery";
import { VendorCards } from "@/components/VendorCards";
import { VendorDetailHeader } from "@/components/VendorDetailHeader";
import { CONTACT_TEL, whatsappLink } from "@/lib/config";
import {
  enquiryServiceForCategory,
  getVendorBySlug,
  getVendorListingMeta,
  getVendorServiceChips,
  visibleVendors,
} from "@/lib/quickfurno-data";

type VendorPageProps = { params: { id: string } };

export function generateStaticParams() {
  return visibleVendors.map((vendor) => ({ id: vendor.slug }));
}

export function generateMetadata({ params }: VendorPageProps): Metadata {
  const vendor = getVendorBySlug(params.id);
  if (!vendor) return { title: "Vendor not found | QuickFurno" };

  const title = `${vendor.businessName} | QuickFurno Verified Vendor`;
  const description = `View ${vendor.businessName} profile, pricing, services, reviews and contact actions on QuickFurno.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `https://quickfurno.in/vendors/${vendor.slug}`,
      siteName: "QuickFurno",
      type: "profile",
    },
  };
}

const reviewNames = ["Aarav Joshi", "Meera Deshpande", "Sanjay Kulkarni"];
const faqItems = [
  ["How quickly can I get a quote?", "Most vendors respond the same day after QuickFurno receives your requirement."],
  ["Can I compare this vendor with others?", "Yes. QuickFurno can match you with up to 3 suitable vendors for comparison."],
  ["Is the enquiry free?", "Yes. Client enquiries are free and routed only to relevant vendor matches."],
];

export default function VendorProfilePage({ params }: VendorPageProps) {
  const vendor = getVendorBySlug(params.id);
  if (!vendor) notFound();

  const meta = getVendorListingMeta(vendor);
  const services = getVendorServiceChips(vendor);
  const enquiryService = enquiryServiceForCategory(vendor.category);
  const serviceAreas = [meta.locality, vendor.city === "Pune" ? "Baner" : "Andheri", vendor.city === "Pune" ? "Wakad" : "Thane"];

  return (
    <>
      <Header />
      <main className="vendor-detail-page">
        <section className="vendor-detail-hero section-pad-top">
          <div className="container">
            <VendorDetailHeader vendor={vendor} />
          </div>
        </section>

        <section className="vendor-detail-content">
          <div className="container vendor-detail-layout">
            <div className="vendor-detail-main">
              <nav className="vendor-detail-tabs" aria-label="Vendor profile sections">
                {["Overview", "Services", "Prices", "Portfolio", "Reviews", "Hours", "Areas", "About", "FAQs"].map((item) => (
                  <a key={item} href={`#${item.toLowerCase()}`}>
                    {item}
                  </a>
                ))}
              </nav>

              <section id="overview" className="vendor-detail-panel">
                <h2>Overview</h2>
                <p>{vendor.description}</p>
                <div className="vendor-overview-grid">
                  <span>
                    <strong>{vendor.rating.toFixed(1)}/5</strong>
                    rating
                  </span>
                  <span>
                    <strong>{vendor.reviews}</strong>
                    reviews
                  </span>
                  <span>
                    <strong>{vendor.experience}</strong>
                    experience
                  </span>
                  <span>
                    <strong>{vendor.responseTime}</strong>
                    response
                  </span>
                </div>
              </section>

              <section id="services" className="vendor-detail-panel">
                <h2>Services Offered</h2>
                <div className="vendor-service-grid-v2">
                  {services.map((service) => (
                    <article key={`${service.label}-${service.price}`}>
                      <h3>{service.label}</h3>
                      <p>{service.price}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section id="prices" className="vendor-detail-panel">
                <h2>Starting Prices</h2>
                <div className="vendor-price-list">
                  {services.slice(0, 4).map((service) => (
                    <div key={service.label}>
                      <span>{service.label}</span>
                      <strong>{service.price || "Price on request"}</strong>
                    </div>
                  ))}
                </div>
                <p className="vendor-detail-note">Final quote depends on scope, measurements, material grade and site conditions.</p>
              </section>

              <section id="portfolio" className="vendor-detail-panel">
                <h2>Portfolio Images</h2>
                <PortfolioGallery limit={6} />
              </section>

              <section id="reviews" className="vendor-detail-panel">
                <h2>Reviews</h2>
                <div className="vendor-review-list">
                  {reviewNames.map((name, index) => (
                    <article key={name}>
                      <div className="stars" aria-label="5 star review">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
                      <p>
                        {index === 0
                          ? "Professional process, clear rates and quick coordination after the first enquiry."
                          : index === 1
                            ? "The team explained the work scope well and shared practical options for our budget."
                            : "Helpful profile details made it easier to shortlist before speaking on call."}
                      </p>
                      <strong>{name}</strong>
                    </article>
                  ))}
                </div>
              </section>

              <section id="hours" className="vendor-detail-panel">
                <h2>Business Hours</h2>
                <p>Mon - Sun, 10:00 am - 9:00 pm</p>
                <span className="vendor-detail-note">{meta.openStatus}</span>
              </section>

              <section id="areas" className="vendor-detail-panel">
                <h2>Service Areas</h2>
                <div className="vendor-area-tags">
                  {serviceAreas.map((area) => (
                    <span key={area}>{area}</span>
                  ))}
                </div>
              </section>

              <section id="about" className="vendor-detail-panel">
                <h2>About Vendor</h2>
                <p>
                  {vendor.businessName} is listed on QuickFurno for {vendor.category.toLowerCase()} projects in{" "}
                  {vendor.city}. The profile highlights starting rates, response quality and service fit so homeowners
                  can compare before sharing detailed requirements.
                </p>
              </section>

              <section id="faqs" className="vendor-detail-panel">
                <h2>FAQs</h2>
                <div className="vendor-faq-list">
                  {faqItems.map(([question, answer]) => (
                    <article key={question}>
                      <h3>{question}</h3>
                      <p>{answer}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="vendor-detail-panel">
                <h2>Similar Vendors</h2>
                <VendorCards compact category={vendor.category} excludeSlug={vendor.slug} limit={3} />
              </section>
            </div>

            <aside className="vendor-detail-side-card" aria-label={`Contact ${vendor.businessName}`}>
              <span className="qf-mini-badge qf-mini-badge--verified">QuickFurno assist</span>
              <h2>Request a verified quote</h2>
              <p>Compare this vendor with suitable options near {vendor.city} before you finalise.</p>
              <EnquiryModalTrigger
                className="btn btn-primary"
                modalTitle={`Get quote from ${vendor.businessName}`}
                serviceCategory={enquiryService}
                city={vendor.city}
                area={meta.locality.split(",")[0]}
                requirement={`I want a quote from ${vendor.businessName} for ${vendor.category}.`}
                source={`Vendor side card: ${vendor.slug}`}
              >
                Send Enquiry
              </EnquiryModalTrigger>
              <a className="btn btn-secondary" href={CONTACT_TEL}>
                Call Now
              </a>
              <a
                className="btn btn-outline"
                href={whatsappLink(`Hi QuickFurno, I want a quote from ${vendor.businessName}.`)}
                target="_blank"
                rel="noopener noreferrer"
              >
                WhatsApp
              </a>
            </aside>
          </div>
        </section>
      </main>
      <Footer />
      <div className="vendor-detail-mobile-cta" aria-label="Vendor profile contact actions">
        <a href={CONTACT_TEL}>Call Now</a>
        <a href={whatsappLink(`Hi QuickFurno, I want a quote from ${vendor.businessName}.`)}>WhatsApp</a>
        <EnquiryModalTrigger
          modalTitle={`Get quote from ${vendor.businessName}`}
          serviceCategory={enquiryService}
          city={vendor.city}
          area={meta.locality.split(",")[0]}
          requirement={`I want a quote from ${vendor.businessName} for ${vendor.category}.`}
          source={`Vendor mobile CTA: ${vendor.slug}`}
        >
          Send Enquiry
        </EnquiryModalTrigger>
      </div>
    </>
  );
}
