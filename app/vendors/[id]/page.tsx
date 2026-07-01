import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { Footer } from "@/components/Footer";
import { FreeVendorInterestButton } from "@/components/FreeVendorInterestButton";
import { Header } from "@/components/Header";
import { PortfolioGallery } from "@/components/PortfolioGallery";
import { VendorCards } from "@/components/VendorCards";
import { VendorDetailHeader } from "@/components/VendorDetailHeader";
import { CONTACT_TEL, whatsappLink } from "@/lib/config";
import { loadMarketplaceRuntimeSettings } from "@/lib/lead-assignment/runtimeSettings";
import { getPublicVendorProfileBySlugOrId } from "@/services/publicVendorService";
import {
  enquiryServiceForCategory,
  getVendorListingMeta,
  getVendorServiceChips,
} from "@/lib/quickfurno-data";

type VendorPageProps = { params: { id: string } };

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Resolve the profile + runtime settings once per request (shared by metadata + page). */
const loadVendorProfile = cache(async (slugOrId: string) => {
  const settings = await loadMarketplaceRuntimeSettings();
  const vendor = await getPublicVendorProfileBySlugOrId(slugOrId, settings);
  return { vendor, settings };
});

export async function generateMetadata({ params }: VendorPageProps): Promise<Metadata> {
  const { vendor } = await loadVendorProfile(params.id);
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

export default async function VendorProfilePage({ params }: VendorPageProps) {
  const { vendor, settings } = await loadVendorProfile(params.id);
  if (!vendor) notFound();
  const showFreeVendorsPublicly = settings.show_free_vendors_publicly;

  const meta = getVendorListingMeta(vendor);
  const enquiryService = enquiryServiceForCategory(vendor.category);
  const serviceAreas = [meta.locality, vendor.city === "Pune" ? "Baner" : "Andheri", vendor.city === "Pune" ? "Wakad" : "Thane"];
  const isPaidOrTrialEligible = vendor.activePaidPlan;

  // Real Supabase vendors must not borrow static demo content (services, prices,
  // portfolio, reviews, similar vendors, or direct Call/WhatsApp). Static demo
  // vendors keep the original rich sections.
  const isRealSupabaseVendor = vendor.source === "supabase";
  const services = isRealSupabaseVendor ? [] : getVendorServiceChips(vendor);
  const supabaseServices = vendor.serviceCategories ?? [];
  const supabasePortfolio = vendor.portfolioImages ?? [];
  const hasRealRate = Boolean(vendor.rate) && !/price on request/i.test(vendor.rate);
  // Direct Call/WhatsApp is only ever offered for static demo vendors on a paid
  // plan. Supabase vendors always route through QuickFurno (no phone reveal yet).
  const showDirectContact = !isRealSupabaseVendor && isPaidOrTrialEligible;

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
                {isRealSupabaseVendor ? (
                  supabaseServices.length > 0 ? (
                    <div className="vendor-service-grid-v2">
                      {supabaseServices.map((label) => (
                        <article key={label}>
                          <h3>{label}</h3>
                          <p>Verified service</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="vendor-empty-v2">
                      <h3>Services will be updated soon</h3>
                      <p>
                        This vendor has completed basic verification. Detailed service offerings will be
                        added after profile review.
                      </p>
                    </div>
                  )
                ) : (
                  <div className="vendor-service-grid-v2">
                    {services.map((service) => (
                      <article key={`${service.label}-${service.price}`}>
                        <h3>{service.label}</h3>
                        <p>{service.price}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section id="prices" className="vendor-detail-panel">
                <h2>Starting Prices</h2>
                {isRealSupabaseVendor ? (
                  hasRealRate ? (
                    <>
                      <div className="vendor-price-list">
                        <div>
                          <span>{vendor.category}</span>
                          <strong>{vendor.rate}</strong>
                        </div>
                      </div>
                      <p className="vendor-detail-note">
                        Final quote depends on site visit, scope, materials and measurements.
                      </p>
                    </>
                  ) : (
                    <div className="vendor-empty-v2">
                      <h3>Pricing will be updated soon</h3>
                      <p>Final quote depends on site visit, scope, materials and measurements.</p>
                    </div>
                  )
                ) : (
                  <>
                    <div className="vendor-price-list">
                      {services.slice(0, 4).map((service) => (
                        <div key={service.label}>
                          <span>{service.label}</span>
                          <strong>{service.price || "Price on request"}</strong>
                        </div>
                      ))}
                    </div>
                    <p className="vendor-detail-note">Final quote depends on scope, measurements, material grade and site conditions.</p>
                  </>
                )}
              </section>

              <section id="portfolio" className="vendor-detail-panel">
                <h2>Portfolio Images</h2>
                {isRealSupabaseVendor ? (
                  supabasePortfolio.length > 0 ? (
                    <div className="vendor-portfolio-grid">
                      {supabasePortfolio.map((src, index) => (
                        // eslint-disable-next-line @next/next/no-img-element -- vendor-uploaded URLs from arbitrary hosts; plain img avoids next/image host allowlist.
                        <img
                          key={src}
                          src={src}
                          alt={`${vendor.businessName} project ${index + 1}`}
                          loading="lazy"
                          className="vendor-portfolio-img"
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="vendor-empty-v2">
                      <h3>Portfolio coming soon</h3>
                      <p>This vendor has not uploaded project photos yet.</p>
                    </div>
                  )
                ) : (
                  <PortfolioGallery limit={6} />
                )}
              </section>

              <section id="reviews" className="vendor-detail-panel">
                <h2>Reviews</h2>
                {isRealSupabaseVendor ? (
                  <div className="vendor-empty-v2">
                    <h3>Reviews coming soon</h3>
                    <p>Client reviews will appear here after completed QuickFurno enquiries.</p>
                  </div>
                ) : (
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
                )}
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
                {isRealSupabaseVendor ? (
                  <div className="vendor-empty-v2">
                    <h3>Similar vendors coming soon</h3>
                    <p>QuickFurno will surface comparable verified vendors near you shortly.</p>
                  </div>
                ) : (
                  <VendorCards compact category={vendor.category} excludeSlug={vendor.slug} limit={3} showFreeVendorsPublicly={showFreeVendorsPublicly} />
                )}
              </section>
            </div>

            <aside className="vendor-detail-side-card" aria-label={`Contact ${vendor.businessName}`}>
              <span className="qf-mini-badge qf-mini-badge--verified">QuickFurno assist</span>
              <h2>{isPaidOrTrialEligible ? "Request a verified quote" : "Contact through QuickFurno"}</h2>
              <p>Compare this vendor with suitable options near {vendor.city} before you finalise.</p>
              {isPaidOrTrialEligible ? (
                <>
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
                  {showDirectContact ? (
                    <>
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
                    </>
                  ) : null}
                </>
              ) : (
                <FreeVendorInterestButton
                  className="btn btn-primary"
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
            </aside>
          </div>
        </section>
      </main>
      <Footer />
      <div className="vendor-detail-mobile-cta" aria-label="Vendor profile contact actions">
        {isPaidOrTrialEligible ? (
          <>
            {showDirectContact ? (
              <>
                <a href={CONTACT_TEL}>Call Now</a>
                <a href={whatsappLink(`Hi QuickFurno, I want a quote from ${vendor.businessName}.`)}>WhatsApp</a>
              </>
            ) : null}
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
          </>
        ) : (
          <>
            <FreeVendorInterestButton
              vendorId={vendor.slug}
              vendorName={vendor.businessName}
              city={vendor.city}
              area={meta.locality.split(",")[0]}
              category={vendor.category}
              subcategory={vendor.subCategory}
            >
              Request Callback
            </FreeVendorInterestButton>
            <FreeVendorInterestButton
              vendorId={vendor.slug}
              vendorName={vendor.businessName}
              city={vendor.city}
              area={meta.locality.split(",")[0]}
              category={vendor.category}
              subcategory={vendor.subCategory}
            >
              Contact through QuickFurno
            </FreeVendorInterestButton>
            <a href="/#categories">Compare Options</a>
          </>
        )}
      </div>
    </>
  );
}
