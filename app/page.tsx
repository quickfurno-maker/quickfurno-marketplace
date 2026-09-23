import type { Metadata } from "next";
import { PuneLaunchHomepage } from "@/components/home/PuneLaunchHomepage";

export const metadata: Metadata = {
  title: "QuickFurno | Pune Home-Service Marketplace",
  description:
    "Explore home-service professionals and categories in Pune. Submit a free enquiry for Client Matching, subject to marketplace eligibility and availability.",
  openGraph: {
    title: "QuickFurno | Pune home services, one enquiry away",
    description:
      "Tell QuickFurno what your home needs. Up to 3 active pros can be assigned at a time under the marketplace eligibility and matching rules.",
    url: "https://quickfurno.in",
    siteName: "QuickFurno",
    type: "website",
  },
};

// The launch homepage is fully static (no per-request data); keep a periodic
// revalidation so any future server-side content refreshes without a deploy.
export const revalidate = 300;

export default function HomePage() {
  return <PuneLaunchHomepage />;
}
