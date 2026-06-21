import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { EnquiryModalProvider } from "@/components/ClientEnquiryModal";
import { ScrollReveal } from "@/components/ScrollReveal";
import "./globals.css";

// One premium type family across the whole site, with weight variation for hierarchy.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "QuickFurno | Verified Home-Service Marketplace",
  description:
    "QuickFurno helps clients in Pune and Mumbai compare verified interior designers, carpenters, modular factories, painters, sofa and civil-work vendors.",
  metadataBase: new URL("https://quickfurno.com"),
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
    { media: "(prefers-color-scheme: light)", color: "#f4f1ea" },
    { media: "(prefers-color-scheme: dark)", color: "#06251d" },
  ],
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body>
        <ScrollReveal />
        <EnquiryModalProvider>{children}</EnquiryModalProvider>
      </body>
    </html>
  );
}
