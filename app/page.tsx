import type { Metadata } from "next";
import { FinalHomepage } from "@/components/home/FinalHomepage";
import { categories, type Vendor } from "@/lib/quickfurno-data";
import { getPublicVendorsForCategory } from "@/services/publicVendorService";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "QuickFurno | Verified Home-Service Professionals in Pune",
  description:
    "Find verified interior, carpentry, modular, painting, sofa and civil-work professionals in Pune with QuickFurno.",
  openGraph: {
    title: "QuickFurno | Find the Right Team for Your Home",
    description:
      "Tell QuickFurno what you're planning and get matched with up to 3 relevant home professionals in Pune.",
    url: "https://quickfurno.in",
    siteName: "QuickFurno",
    type: "website",
  },
};

async function loadFeaturedVendors(): Promise<Vendor[]> {
  const results = await Promise.all(
    categories.map((category) => getPublicVendorsForCategory(category.name)),
  );

  const seen = new Set<string>();
  const featured: Vendor[] = [];

  for (const group of results) {
    if (!Array.isArray(group)) continue;
    for (const vendor of group) {
      if (seen.has(vendor.slug)) continue;
      seen.add(vendor.slug);
      featured.push(vendor);
      if (featured.length >= 4) return featured;
    }
  }

  return featured;
}

export default async function HomePage() {
  const featuredVendors = await loadFeaturedVendors();
  return <FinalHomepage featuredVendors={featuredVendors} />;
}
