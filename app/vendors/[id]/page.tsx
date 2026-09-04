import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { StickyMobileCTA } from "@/components/StickyMobileCTA";
import { VendorProfileActionCard } from "@/components/public-vendor/VendorProfileActions";
import {
  VendorProfileCompareMore,
  VendorProfileDetails,
  VendorProfileFaq,
  VendorProfileHero,
  VendorProfileOverview,
  VendorProfilePortfolio,
  VendorProfileSectionNav,
  VendorProfileServices,
} from "@/components/public-vendor/VendorProfileSections";
import { profileSections, toProfileView } from "@/components/public-vendor/profileModel";
import { loadMarketplaceRuntimeSettings } from "@/lib/lead-assignment/runtimeSettings";
import { getParentCategoryGroup } from "@/lib/vendors/categoryMatching";
import { getPublicVendorProfileBySlugOrId } from "@/services/publicVendorService";
import { categorySlug, enquiryServiceForCategory } from "@/lib/quickfurno-data";
import "../vendor-profile-v2.css";

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

  const view = toProfileView(vendor);

  // Title intent, OG shape and URL are unchanged. The description no longer
  // promises "pricing ... reviews": QuickFurno has no public review system, and
  // pricing is only mentioned when the vendor actually published a rate.
  const title = `${vendor.businessName} | QuickFurno Verified Vendor`;
  const description = view.hasStartingPrice
    ? `View ${vendor.businessName} services, service areas, starting price, portfolio and enquiry options on QuickFurno.`
    : `View ${vendor.businessName} services, service areas, portfolio and enquiry options on QuickFurno.`;

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

export default async function VendorProfilePage({ params }: VendorPageProps) {
  // Supabase-only resolution. A hidden vendor, an unknown id and a read failure
  // all return null and 404 here — the static demo catalog is no longer a
  // fallback, so a fictional vendor can never be served as a real profile.
  const { vendor } = await loadVendorProfile(params.id);
  if (!vendor) notFound();

  const view = toProfileView(vendor);
  const sections = profileSections(view);
  const enquiryService = enquiryServiceForCategory(vendor.category);
  const parentCategoryGroup = getParentCategoryGroup(enquiryService);
  const categoryHref = `/category/${categorySlug(vendor.category)}`;

  return (
    <>
      <Header />

      <main className="qf-vprofile-page">
        <div className="qf-pub-container">
          <nav className="qf-vprofile-breadcrumb" aria-label="Breadcrumb">
            <Link href={categoryHref}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back to {vendor.category}
            </Link>
          </nav>

          <VendorProfileHero vendor={view} />

          <div className="qf-vprofile-layout">
            {/*
              One action card in the DOM. CSS orders it directly under the hero on
              phones (primary action above the fold) and turns it into the sticky
              right rail from 1024px.
            */}
            <aside className="qf-vprofile-aside" aria-label={`Enquire about ${vendor.businessName}`}>
              <VendorProfileActionCard
                vendor={view}
                enquiryService={enquiryService}
                parentCategoryGroup={parentCategoryGroup}
              />
            </aside>

            <div className="qf-vprofile-main">
              <VendorProfileSectionNav sections={sections} />
              <VendorProfileOverview vendor={view} />
              <VendorProfileServices vendor={view} />
              <VendorProfilePortfolio vendor={view} />
              <VendorProfileDetails vendor={view} />
              <VendorProfileFaq />
              <VendorProfileCompareMore vendor={view} categoryHref={categoryHref} />
            </div>
          </div>
        </div>
      </main>

      <Footer />
      <StickyMobileCTA />
    </>
  );
}
