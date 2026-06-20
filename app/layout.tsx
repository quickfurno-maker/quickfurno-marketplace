import type { Metadata } from "next";
import { Raleway, Fraunces } from "next/font/google";
import "./globals.css";

const raleway = Raleway({
  subsets: ["latin"],
  weight: ["200", "300", "400", "500", "600", "700", "800"],
  variable: "--font-raleway",
  display: "swap",
});
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: "QuickFurno — Verified interior & carpentry leads",
  description:
    "Homeowners get matched to up to 4 verified interior and carpentry studios. Vendors buy prepaid lead packs and only pay for real, exclusive enquiries.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${raleway.variable} ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  );
}
