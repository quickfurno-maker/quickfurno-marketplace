import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { EnquiryModalProvider } from "@/components/ClientEnquiryModal";
import { ProjectLocationProvider } from "@/components/location/ProjectLocationProvider";
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
// QF-UI-V2-11 — vendor auth + onboarding (/vendor login & signup,
// /vendor/set-password). Scoped qf-vauth-* / qf-vrf-* / qf-vendor-* only.
import "./vendor-auth-v2.css";
// Final locked homepage visual system; selectors are qfh-* scoped and do not restyle vendor/public utility pages.
import "./home-final.css";
// Pune launch homepage (approved Desktop 1440 / Mobile 390 mockup). qfp-* scoped
// only; loaded last so it wins over home-final.css on the homepage.
import "./home-pune-launch.css";
// Design tokens from the approved canvases — the system the four legacy token
// layers above are being replaced by. Variables only (--qfd-*), so importing it
// changes nothing on its own; a page moves over when its stylesheet starts
// referencing them. Loaded last so a migrated page always reads these values.
import "./qf-tokens.css";
// Shared primitives built on those tokens: buttons, chips, fields, cards,
// pills, gradient sections. qfd-* scoped; nothing here styles a bare element.
import "./qf-primitives.css";
// The public token layer for the canvas-built surfaces, and the site footer
// that now uses it. Loaded here because <Footer /> renders on every page.
import "./qv-tokens.css";
import "./footer-v2.css";

// SCALE-P02: one self-hosted variable face owns the primary sans contract.
// The previous Poppins / Playfair Display / Caveat next/font/google imports
// made clean container builds depend on Google font resolution. The CSS keeps
// the legacy semantic variable names, so this reliability fix does not require
// a broad component/style rewrite.
const primarySans = localFont({
  src: "./fonts/plus-jakarta-sans-latin-wght-normal.woff2",
  weight: "200 800",
  style: "normal",
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "QuickFurno | Verified Home-Service Marketplace",
  description:
    "QuickFurno helps clients in Pune compare verified interior designers, carpenters, modular factories, painters, sofa, civil-work and false ceiling vendors.",
  metadataBase: new URL("https://quickfurno.in"),
  openGraph: {
    title: "QuickFurno | Verified Home-Service Marketplace",
    description:
      "Get connected with verified home-service vendors in Pune.",
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
    <html lang="en" className={primarySans.variable}>
      <body>
        <ScrollProgress />
        <ScrollReveal />
        <ProjectLocationProvider>
          <EnquiryModalProvider>{children}</EnquiryModalProvider>
        </ProjectLocationProvider>
      </body>
    </html>
  );
}