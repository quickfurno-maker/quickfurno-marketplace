import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { VendorCards } from "@/components/VendorCards";
import {
  categories,
  categorySlug,
  enquiryServiceForCategory,
  getCategoryBySlug,
} from "@/lib/quickfurno-data";

type CategoryPageProps = { params: { slug: string } };

export function generateStaticParams() {
  return categories.map((category) => ({ slug: categorySlug(category.name) }));
}

export function generateMetadata({ params }: CategoryPageProps): Metadata {
  const category = getCategoryBySlug(params.slug);
  if (!category) return { title: "Category not found | QuickFurno" };

  const title = `${category.name} in Pune & Mumbai | QuickFurno`;
  const description = `Compare verified ${category.name.toLowerCase()} on QuickFurno - ratings, transparent rates and free client enquiry across Pune & Mumbai.`;

  return {
    title,
    description,
    openGraph: { title, description, siteName: "QuickFurno", type: "website" },
  };
}

export default function CategoryPage({ params }: CategoryPageProps) {
  const category = getCategoryBySlug(params.slug);
  if (!category) notFound();

  const enquiryService = enquiryServiceForCategory(category.name);

  return (
    <>
      <Header />
      <main className="category-market-page">
        <section className="category-market-intro section-pad-top">
          <div className="container category-market-intro-grid">
            <div>
              <Link href="/#categories" className="category-back">
                Back to all categories
              </Link>
              <p className="category-market-copy">{category.description}</p>
            </div>
            <div className="category-market-stats" aria-label={`${category.name} listing summary`}>
              <span>
                <strong>Verified</strong>
                vendor profiles
              </span>
              <span>
                <strong>Up to 3</strong>
                vendor matches
              </span>
              <span>
                <strong>Free</strong>
                client enquiry
              </span>
            </div>
          </div>
        </section>

        <section className="category-listing-section">
          <div className="container category-listing-layout">
            <aside className="listing-refine-panel" aria-label="Listing refinement summary">
              <h2>Refine search</h2>
              <p>Use the sticky filters to compare by rating, response speed, plan and availability.</p>
              <div className="listing-refine-group">
                <span>Popular areas</span>
                <button type="button">Kharadi</button>
                <button type="button">Baner</button>
                <button type="button">Andheri</button>
                <button type="button">Thane</button>
              </div>
              <div className="listing-refine-group">
                <span>Trust filters</span>
                <button type="button">Verified</button>
                <button type="button">Top rated</button>
                <button type="button">Quick response</button>
              </div>
            </aside>

            <div className="listing-results-panel">
              <VendorCards category={category.name} mode="listing" />
            </div>

            <aside className="listing-assist-card" aria-label="QuickFurno assistance">
              <h2>Get matched faster</h2>
              <p>
                Tell QuickFurno your requirement and we will connect you with suitable{" "}
                {category.name.toLowerCase()} near you.
              </p>
              <EnquiryModalTrigger
                className="btn btn-primary"
                modalTitle={`Get quotes from verified ${category.name}`}
                serviceCategory={enquiryService}
                source={`Category assistance: ${category.name}`}
              >
                Get Free Assistance
              </EnquiryModalTrigger>
              <ul>
                <li>Up to 3 relevant vendor matches</li>
                <li>100% verified local experts</li>
                <li>Free service, no hidden charges</li>
              </ul>
            </aside>
          </div>
        </section>

        <section className="final-cta">
          <div className="container final-cta-card" data-reveal>
            <span className="eyebrow">Ready to start?</span>
            <h2>Get matched with verified {category.name.toLowerCase()}.</h2>
            <p>
              Tell QuickFurno your requirement and get matched with verified vendors in Pune or Mumbai.
            </p>
            <div className="hero-cta-row">
              <EnquiryModalTrigger
                className="btn btn-primary"
                modalTitle={`Get quotes from verified ${category.name}`}
                serviceCategory={enquiryService}
                source={`Category final CTA: ${category.name}`}
              >
                Start Enquiry
              </EnquiryModalTrigger>
              <Link href="/#categories" className="btn btn-outline">
                Browse All Services
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
