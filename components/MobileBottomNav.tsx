"use client";

import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { QFIcon } from "@/components/QuickFurnoIcons";

export function MobileBottomNav() {
  return (
    <nav className="qf-bottom-nav" aria-label="Mobile navigation">
      <Link href="/" className="qf-bottom-nav-item qf-bottom-nav-item--active">
        <QFIcon name="home" />
        <span>Home</span>
      </Link>
      <Link href="/#services" className="qf-bottom-nav-item">
        <QFIcon name="grid" />
        <span>Categories</span>
      </Link>
      <EnquiryModalTrigger className="qf-bottom-nav-item">
        <QFIcon name="chat" />
        <span>Enquiry</span>
      </EnquiryModalTrigger>
      <Link href="/vendors" className="qf-bottom-nav-item">
        <QFIcon name="briefcase" />
        <span>Vendors</span>
      </Link>
      <Link href="/#faq" className="qf-bottom-nav-item">
        <QFIcon name="more" />
        <span>More</span>
      </Link>
    </nav>
  );
}
