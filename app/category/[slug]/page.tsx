import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { StickyMobileCTA } from "@/components/StickyMobileCTA";
import { categoryArtwork } from "@/components/public-listing/categoryArtwork";
import { VendorDiscovery } from "@/components/public-listing/VendorDiscovery";
import { loadMarketplaceRuntimeSettings } from "@/lib/lead-assignment/runtimeSettings";
import { getPublicVendorsForCategory } from "@/services/publicVendorService";
import {
  enquiryServiceForCategory,
  getCategoryBySlug,
} from "@/lib/quickfurno-data";
import "../vendor-listing-v2.css";

type CategoryPageProps = { params: { slug: string } };

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function generateMetadata({ params }: CategoryPageProps): Metadata {
  const category = getCategoryBySlug(params.slug);
  if (!category) return { title: "Category not found | QuickFurno" };

  // Same SEO intent and title shape as before. The old description promised
  // "ratings" and "transparent rates" — QuickFurno has no review system and
  // vendors are not required to publish rates, so both claims are removed.
  const title = `${category.name} in Pune & Mumbai | QuickFurno`;
  const description = `Find verified ${category.name.toLowerCase()} in Pune & Mumbai on QuickFurno. Browse vendor profiles or send one free enquiry and get matched with up to 3 relevant vendors.`;

  return {
    title,
    description,
    openGraph: { title, description, siteName: "QuickFurno", type: "website" },
  };
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const category = getCategoryBySlug(params.slug);
  if (!category) notFound();

  const settings = await loadMarketplaceRuntimeSettings();
  const enquiryService = enquiryServiceForCategory(category.name);

  // `null` = the vendors table could not be read. `[]` = read succeeded and no
  // vendor is publicly visible in this category.
  //
  // QF-UI-V2-06: these two are now told apart. Previously both collapsed into
  // `publicVendors ?? undefined`, which made <VendorCards /> fall back to the
  // STATIC DEMO CATALOG — so a database outage silently published fictional
  // vendors with invented ratings, distances and prices as if they were live
  // verified businesses. A read failure now shows an honest unavailable state.
  const publicVendors = await getPublicVendorsForCategory(category.name, settings);
  const listingUnavailable = publicVendors === null;
  // QF-UI-V2-16: neutral SERVICE artwork for this category. Decorative only
  // (aria-hidden, alt="") and never attached to a vendor, so it cannot read
  // as any vendor's project. null when the category has no artwork.
  const artwork = categoryArtwork(category.name);

  return (
    <>
      <Header />

      <main className="qf-category-page">
        <section className="qf-cat-intro">
          <div className="qf-pub-container qf-cat-intro-shell">
            <div className="qf-cat-intro-copy">
              <Link href="/#categories" className="qf-cat-back">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                  <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back to services
              </Link>

              <h1 className="qf-cat-title">{category.name} in Pune &amp; Mumbai</h1>
              <p className="qf-cat-copy">{category.description}</p>

              <ul className="qf-cat-truths">
                <li>Verified public vendor profiles</li>
                <li>Up to 3 matched vendors through one enquiry</li>
                <li>Free for homeowners</li>
              </ul>
            </div>

            {artwork ? (
              <div className="qf-cat-art" aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element -- local decorative SVG, sized by its slot. */}
                <img src={artwork} alt="" loading="lazy" />
              </div>
            ) : null}
          </div>
        </section>

        <section className="qf-cat-listing" aria-label={`${category.name} vendors`}>
          <div className="qf-pub-container qf-cat-layout">
            <div className="qf-cat-results">
              {/* No artwork in this state on purpose: the page header already
                  carries this category's visual, and repeating it stacked two
                  identical illustrations into one viewport on phones. */}
              {listingUnavailable ? (
                <div className="qf-vl-empty" role="status">
                  <h2>Vendor listings are temporarily unavailable.</h2>
                  <p>
                    We could not load vendor profiles just now. You can still tell QuickFurno what you
                    need and we will match you with up to 3 relevant verified vendors.
                  </p>
                  <div className="qf-vl-empty-actions">
                    <EnquiryModalTrigger
                      className="qf-pub-btn qf-pub-btn--primary"
                      modalTitle={`Get matched with verified ${category.name}`}
                      serviceCategory={enquiryService}
                      source={`Category listing unavailable: ${category.name}`}
                    >
                      Get Free Team Matches
                    </EnquiryModalTrigger>
                    <Link href="/#categories" className="qf-pub-btn qf-pub-btn--secondary">
                      Browse services
                    </Link>
                  </div>
                </div>
              ) : (
                <VendorDiscovery
                  vendors={publicVendors}
                  categoryName={category.name}
                  enquiryService={enquiryService}
                />
              )}
            </div>

            {/* The single assistance surface on this page. The old build had two
                (a sticky rail card AND an inline banner injected between cards). */}
            <aside className="qf-cat-assist" aria-label="QuickFurno assistance">
              <div className="qf-cat-assist-card">
                <span className="qf-pub-eyebrow">Not sure who to pick?</span>
                <h2>Let QuickFurno match you</h2>
                <p>
                  Tell QuickFurno what you need and get matched with up to 3 relevant verified vendors.
                </p>
                <EnquiryModalTrigger
                  className="qf-pub-btn qf-pub-btn--primary qf-pub-btn--block"
                  modalTitle={`Get matched with verified ${category.name}`}
                  serviceCategory={enquiryService}
                  source={`Category assistance: ${category.name}`}
                >
                  Get Free Team Matches
                </EnquiryModalTrigger>
                <ul>
                  <li>Free for homeowners</li>
                  <li>Up to 3 relevant vendors</li>
                  <li>Your details stay private</li>
                </ul>
              </div>
            </aside>
          </div>
        </section>

        <section className="qf-final-cta">
          <div className="qf-pub-container">
            <span className="qf-pub-eyebrow">Ready to start?</span>
            <h2>Get matched with verified {category.name.toLowerCase()}.</h2>
            <p>One free enquiry, up to 3 relevant vendors in Pune &amp; Mumbai.</p>
            <div className="qf-final-cta-actions">
              <EnquiryModalTrigger
                className="qf-pub-btn qf-pub-btn--primary"
                modalTitle={`Get matched with verified ${category.name}`}
                serviceCategory={enquiryService}
                source={`Category final CTA: ${category.name}`}
              >
                Get Free Team Matches
              </EnquiryModalTrigger>
              <Link href="/#categories" className="qf-pub-btn qf-pub-btn--secondary">
                Browse services
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
      <StickyMobileCTA />
    </>
  );
}
