import type { Metadata } from "next";
import { Fraunces, Raleway } from "next/font/google";
import { EnquiryModalProvider } from "@/components/ClientEnquiryModal";
import "./globals.css";

const raleway = Raleway({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-raleway",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-fraunces",
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${raleway.variable} ${fraunces.variable}`}>
      <body>
        <EnquiryModalProvider>{children}</EnquiryModalProvider>
      </body>
    </html>
  );
}
