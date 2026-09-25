import type { Metadata } from "next";
import { PuneLaunchHomepage } from "@/components/home/PuneLaunchHomepage";

export const metadata: Metadata = {
  title: "QuickFurno | Pune Home-Service Marketplace",
  description:
    "Explore home-service professionals and categories in Pune. Submit a free enquiry for Client Matching, subject to marketplace eligibility and availability.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "QuickFurno | Pune home services, one enquiry away",
    description:
      "Tell QuickFurno what your home needs. Up to 3 active pros can be assigned at a time under the marketplace eligibility and matching rules.",
    url: "https://quickfurno.in",
    siteName: "QuickFurno",
    type: "website",
  },
};

// The service cards now read live public vendor counts from Supabase, so this
// page is no longer purely static. 300s means a newly approved vendor shows up
// on the homepage within five minutes without a deploy. Drop it to 0 (or use
// force-dynamic) only if the count ever has to be exact to the second — that
// costs the static render on every visit.
export const revalidate = 300;

export default function HomePage() {
  return <PuneLaunchHomepage />;
}
