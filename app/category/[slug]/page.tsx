import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { StickyMobileCTA } from "@/components/StickyMobileCTA";
import { CategoryHero } from "@/components/category/CategoryHero";
import { CategoryListing } from "@/components/category/CategoryListing";
import { IconArrow, IconCheck } from "@/components/category/icons";
import { loadMarketplaceRuntimeSettings } from "@/lib/lead-assignment/runtimeSettings";
import { getPublicVendorsForCategory } from "@/services/publicVendorService";
import {
  categories,
  categorySlug,
  enquiryServiceForCategory,
  getCategoryBySlug,
} from "@/lib/quickfurno-data";
import "../category-v3.css";

type CategoryPageProps = { params: { slug: string } };

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function generateMetadata({ params }: CategoryPageProps): Metadata {
  const category = getCategoryBySlug(params.slug);
  if (!category) return { title: "Category not found | QuickFurno" };

  // No "ratings" or "transparent rates" claims: there is no review system and
  // vendors are not required to publish a rate.
  const title = `${category.name} in Pune | QuickFurno`;
  const description = `Find verified ${category.name.toLowerCase()} in Pune on QuickFurno. Browse vendor profiles or send one free enquiry and get matched with up to 3 relevant vendors.`;

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
  // vendor is publicly visible in this category. These stay distinct: a read
  // failure must never render as "no vendors", and must never fall back to the
  // static demo catalogue, which would publish fictional businesses as live
  // verified ones.
  const publicVendors = await getPublicVendorsForCategory(category.name, settings);
  const listingUnavailable = publicVendors === null;
  const vendors = publicVendors ?? [];

  // Areas that a LISTED vendor actually covers. The hero's area select is
  // built from this rather than from every Pune locality, so choosing one
  // always leads somewhere.
  const areas = [...new Set(vendors.flatMap((v) => v.areas ?? []))].sort();

  const otherTrades = categories.filter((c) => c.name !== category.name).slice(0, 7);

  return (
    <>
      <Header />

      <main className="qfc-page">
        <CategoryHero
          categoryName={category.name}
          description={category.description}
          enquiryService={enquiryService}
          vendorCount={vendors.length}
          areas={areas}
        />

        <section className="qfc-body" aria-label={`${category.name} in Pune`}>
          <span className="qfd-glow qfd-glow--tr" aria-hidden="true" />
          <span className="qfd-glow qfd-glow--amber qfd-glow--bl" aria-hidden="true" />

          <div className="qfd-wrap qfc-layout">
            <div>
              {listingUnavailable ? (
                <div className="qfc-empty qfd-card" role="status">
                  <h2 className="qfd-h2">Listings are temporarily unavailable</h2>
                  <p className="qfd-lede">
                    We could not load vendor profiles just now. You can still tell QuickFurno what
                    you need and we will match you with up to 3 relevant verified vendors.
                  </p>
                  <EnquiryModalTrigger
                    className="qfd-btn qfd-btn--primary qfd-btn--lg"
                    modalTitle={`Get matched with verified ${category.name}`}
                    serviceCategory={enquiryService}
                    source={`Category listing unavailable: ${category.name}`}
                  >
                    Get matched free
                  </EnquiryModalTrigger>
                </div>
              ) : (
                <CategoryListing
                  vendors={vendors}
                  categoryName={category.name}
                  enquiryService={enquiryService}
                />
              )}
            </div>

            <aside className="qfc-rail" aria-label="QuickFurno assistance">
              <div className="qfd-card qfc-rail-card">
                <h2 className="qfd-h3">Let QuickFurno match you</h2>
                <p className="qfd-lede">
                  Tell us what your home needs and we will line up at most 3 verified{" "}
                  {category.name.toLowerCase()} near you.
                </p>
                <EnquiryModalTrigger
                  className="qfd-btn qfd-btn--primary qfd-btn--block"
                  modalTitle={`Get matched with verified ${category.name}`}
                  serviceCategory={enquiryService}
                  source={`Category rail: ${category.name}`}
                >
                  Get matched free
                  <IconArrow size={17} width={2.5} />
                </EnquiryModalTrigger>
                <ul className="qfc-rail-list">
                  <li><IconCheck size={14} width={3} /> At most 3 relevant businesses</li>
                  <li><IconCheck size={14} width={3} /> Checked before anyone is matched</li>
                  <li><IconCheck size={14} width={3} /> Shared only with those 3</li>
                  <li><IconCheck size={14} width={3} /> Free, with no obligation</li>
                </ul>
              </div>

              <div className="qfd-card qfc-rail-card">
                <h2 className="qfd-h3">Other trades in Pune</h2>
                <p className="qfd-lede">
                  Only need one part of the job? The same matching rules apply on every one of these.
                </p>
                <nav className="qfc-trades" aria-label="Other service categories">
                  {otherTrades.map((trade) => (
                    <Link key={trade.name} href={`/category/${categorySlug(trade.name)}`} className="qfc-trade">
                      <span>
                        <span className="qfc-trade-name">{trade.name}</span>
                        <span className="qfc-trade-note">{trade.description}</span>
                      </span>
                      <span className="qfc-trade-go" aria-hidden="true"><IconArrow size={16} width={2.4} /></span>
                    </Link>
                  ))}
                </nav>
              </div>
            </aside>
          </div>
        </section>

        <section className="qfd-section qfd-section--cta qfc-cta">
          <span className="qfd-glow qfd-glow--tr" aria-hidden="true" />
          <div className="qfd-wrap">
            <p className="qfd-kicker">Ready to start?</p>
            <h2 className="qfd-h1">Get matched with verified {category.name.toLowerCase()}.</h2>
            <p className="qfd-lede">One free enquiry, up to 3 relevant businesses in Pune.</p>
            <div className="qfc-cta-actions">
              <EnquiryModalTrigger
                className="qfd-btn qfd-btn--primary qfd-btn--lg"
                modalTitle={`Get matched with verified ${category.name}`}
                serviceCategory={enquiryService}
                source={`Category final CTA: ${category.name}`}
              >
                Get matched free
                <IconArrow size={17} width={2.5} />
              </EnquiryModalTrigger>
              <Link href="/#services" className="qfd-btn qfd-btn--ghost qfd-btn--lg">
                Browse all services
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
