import type { Metadata } from "next";
import { PuneLaunchHomepage } from "@/components/home/PuneLaunchHomepage";

export const metadata: Metadata = {
  title: "QuickFurno | Verified Home-Service Professionals in Pune",
  description:
    "Find verified interior, carpentry, modular, painting, sofa and civil-work professionals in Pune with QuickFurno.",
  openGraph: {
    title: "QuickFurno | Pune's finest home professionals, one enquiry away",
    description:
      "Tell QuickFurno what your home needs and get matched with relevant verified professionals in Pune.",
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
