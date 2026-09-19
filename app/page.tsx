import type { Metadata } from "next";
import { FinalHomepage } from "@/components/home/FinalHomepage";

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

export default function HomePage() {
  return <FinalHomepage />;
}
