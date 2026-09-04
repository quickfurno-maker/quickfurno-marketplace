import type { Metadata, Viewport } from "next";
import { Poppins, Playfair_Display } from "next/font/google";
import { EnquiryModalProvider } from "@/components/ClientEnquiryModal";
import { ScrollProgress } from "@/components/ScrollProgress";
import { ScrollReveal } from "@/components/ScrollReveal";
import "./globals.css";
import "./vendor-discovery.css";
import "./qf-redesign.css";
// QF-UI-V2-05 — public design system. Loaded LAST so its scoped public rules
// (.qf-site-header / .qf-home-page / .qf-foot / .qf-bottom-nav / .qf-pub-*)
// win over the legacy styling for those surfaces without deleting legacy
// selectors that the not-yet-redesigned pages still rely on.
import "./qf-public-v2.css";
// QF-UI-V2-08 — client enquiry / callback / inline-enquiry utilities. Loaded
// after the public system so its scoped .qf-rf-* / .qf-free-interest-* /
// .qf-cs-enquiry-* rules win over the legacy cream-copper modal styling without
// deleting selectors other surfaces still use.
import "./client-enquiry-v2.css";
// QF-UI-V2-09 — standalone enquiry route + legal pages. Scoped qf-legal-* /
// qf-enqpage-* only; no global form-control or element rules.
import "./public-utility-v2.css";

// Type system: Poppins (geometric sans) for the logo, headlines, body and UI;
// Playfair Display italic only for the gold accent words.
// NOTE: Poppins is exposed under the legacy `--font-manrope` variable name so
// every existing `var(--font-manrope)` reference resolves to it with no churn.
const poppins = Poppins({
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
    { media: "(prefers-color-scheme: light)", color: "#F8F4EA" },
    { media: "(prefers-color-scheme: dark)", color: "#03424B" },
  ],
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${poppins.variable} ${playfair.variable}`}>
      <body>
        <ScrollProgress />
        <ScrollReveal />
        <EnquiryModalProvider>{children}</EnquiryModalProvider>
      </body>
    </html>
  );
}
