"use client";

import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { QFIcon } from "@/components/QuickFurnoIcons";

export function HomeMobileBottomNav() {
  return (
    <nav className="qfh-mobile-bottom" aria-label="Homepage mobile navigation">
      <Link href="/" className="qfh-mobile-item qfh-mobile-item--active" aria-current="page">
        <QFIcon name="home" />
        <span>Home</span>
      </Link>
      <Link href="#services" className="qfh-mobile-item">
        <QFIcon name="grid" />
        <span>Services</span>
      </Link>
      <EnquiryModalTrigger className="qfh-mobile-item qfh-mobile-quote" source="Homepage bottom navigation">
        <span className="qfh-mobile-quote-icon"><QFIcon name="request" /></span>
        <span>Quote</span>
      </EnquiryModalTrigger>
      <Link href="/vendors" className="qfh-mobile-item">
        <QFIcon name="user" />
        <span>Vendors</span>
      </Link>
      <Link href="#contact" className="qfh-mobile-item">
        <QFIcon name="grid" />
        <span>More</span>
      </Link>
    </nav>
  );
}
