import type { Metadata } from "next";
import { FinalHomepage } from "@/components/home/FinalHomepage";

export const metadata: Metadata = {
  title: "QuickFurno | Verified Home-Service Professionals in Pune",
  description:
    "Find verified interior, carpentry, modular, painting, sofa and civil-work professionals in Pune with QuickFurno.",
  openGraph: {
    title: "QuickFurno | Better Spaces, Happier Lives",
    description:
      "Tell QuickFurno what your home needs and get matched with relevant verified professionals in Pune.",
    url: "https://quickfurno.in",
    siteName: "QuickFurno",
    type: "website",
  },
};

// Featured vendors are fetched server-side; refresh the static homepage every
// 5 minutes instead of forcing a dynamic render on every request.
export const revalidate = 300;

export default function HomePage() {
  return <FinalHomepage />;
}
