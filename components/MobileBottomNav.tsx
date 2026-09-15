"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { QFIcon } from "@/components/QuickFurnoIcons";

export function MobileBottomNav() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isServices = pathname.startsWith("/category");
  const isQuote = pathname === "/enquiry";
  const isVendors = pathname === "/vendors" || pathname.startsWith("/vendors/");

  return (
    <nav className="qf-bottom-nav qf-bottom-nav--five" aria-label="Mobile navigation">
      <Link href="/" className={`qf-bottom-nav-item${isHome ? " qf-bottom-nav-item--active" : ""}`} aria-current={isHome ? "page" : undefined}>
        <QFIcon name="home" /><span>Home</span>
      </Link>
      <Link href="/#services" className={`qf-bottom-nav-item${isServices ? " qf-bottom-nav-item--active" : ""}`} aria-current={isServices ? "page" : undefined}>
        <QFIcon name="grid" /><span>Services</span>
      </Link>
      <EnquiryModalTrigger className={`qf-bottom-nav-item qf-bottom-nav-item--quote${isQuote ? " qf-bottom-nav-item--active" : ""}`} aria-current={isQuote ? "page" : undefined} source="Public mobile nav">
        <span className="qf-bottom-nav-quote-icon"><QFIcon name="request" /></span><span>Quote</span>
      </EnquiryModalTrigger>
      <Link href="/vendors" className={`qf-bottom-nav-item${isVendors ? " qf-bottom-nav-item--active" : ""}`} aria-current={isVendors ? "page" : undefined}>
        <QFIcon name="briefcase" /><span>Vendors</span>
      </Link>
      <Link href="/#why-quickfurno" className="qf-bottom-nav-item">
        <QFIcon name="more" /><span>More</span>
      </Link>
    </nav>
  );
}
