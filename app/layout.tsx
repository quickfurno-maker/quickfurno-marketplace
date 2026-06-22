import type { Metadata, Viewport } from "next";
import { Manrope, Playfair_Display } from "next/font/google";
import { EnquiryModalProvider } from "@/components/ClientEnquiryModal";
import { ScrollProgress } from "@/components/ScrollProgress";
import { ScrollReveal } from "@/components/ScrollReveal";
import "./globals.css";

// Editorial type system: Playfair Display for premium headlines/section titles
// and brand accent; Manrope for clean body, UI and forms.
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
  display: "swap",
});

export const metadata: Metadata = {
  title: "QuickFurno | Verified Home-Service Marketplace",
  description:
    "QuickFurno helps clients in Pune and Mumbai compare verified interior designers, carpenters, modular factories, painters, sofa and civil-work vendors.",
  metadataBase: new URL("https://quickfurno.in"),
  openGraph: {
    title: "QuickFurno | Verified Home-Service Marketplace",
    description:
      "Get connected with verified home-service vendors in Pune and Mumbai.",
    siteName: "QuickFurno",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F1E8" },
    { media: "(prefers-color-scheme: dark)", color: "#1F1A14" },
  ],
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${playfair.variable}`}>
      <body>
        <ScrollProgress />
        <ScrollReveal />
        <EnquiryModalProvider>{children}</EnquiryModalProvider>
      </body>
    </html>
  );
}
