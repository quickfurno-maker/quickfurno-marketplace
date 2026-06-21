import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { StickyMobileCTA } from "@/components/StickyMobileCTA";
import { VendorCards } from "@/components/VendorCards";
import { categoryImage } from "@/lib/images";
import {
  activePaidVendors,
  categories,
  categorySlug,
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
  const description = `Compare verified ${category.name.toLowerCase()} on QuickFurno — ratings, transparent rates and free client enquiry across Pune & Mumbai.`;

  return {
    title,
    description,
    openGraph: { title, description, siteName: "QuickFurno", type: "website" },
  };
}

export default function CategoryPage({ params }: CategoryPageProps) {
  const category = getCategoryBySlug(params.slug);
  if (!category) notFound();

  const vendorCount = activePaidVendors.filter((vendor) => vendor.category === category.name).length;

  return (
    <>
      <Header />
      <main>
        <section className="category-hero">
          <div className="category-hero-media" aria-hidden="true">
            <Image
              src={categoryImage(category.name)}
              alt=""
              fill
              priority
              sizes="100vw"
              className="category-hero-img"
            />
            <span className="category-hero-shade" />
          </div>

          <div className="container category-hero-inner">
            <Link href="/#services" className="category-back category-back--light">
              ← All categories
            </Link>
            <span className="eyebrow eyebrow--light">Verified vendors</span>
            <h1 className="category-hero-title">
              {category.name} <span className="hl-light">near you</span>
            </h1>
            <p className="category-hero-sub">{category.description}</p>

            <div className="category-hero-chips">
              <span>
                {vendorCount > 0
                  ? `${vendorCount} verified vendor${vendorCount > 1 ? "s" : ""}`
                  : "Onboarding vendors"}
              </span>
              <span>Transparent rates</span>
              <span>Free client enquiry</span>
              <span>{category.startingPrice}</span>
            </div>

            <div className="hero-cta-row category-hero-cta">
              <EnquiryModalTrigger className="btn btn-primary btn-shine">
                Get Free Quotes
              </EnquiryModalTrigger>
              <Link href="/#services" className="btn btn-glass">
                Explore Other Categories
              </Link>
            </div>
          </div>
        </section>

        <section className="section-block">
          <div className="container section-heading" data-reveal>
            <span className="eyebrow">Compare vendors</span>
            <h2>
              {vendorCount > 0
                ? `Top verified ${category.name.toLowerCase()} for your project`
                : `Verified ${category.name.toLowerCase()} arriving soon`}
            </h2>
          </div>
          <div className="container">
            <VendorCards category={category.name} />
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
              <EnquiryModalTrigger className="btn btn-primary">
                Start Enquiry
              </EnquiryModalTrigger>
              <Link href="/#verified-vendors" className="btn btn-outline">
                See Featured Vendors
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
