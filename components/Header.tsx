"use client";

import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import Link from "next/link";
import { useEffect, useState } from "react";

const navItems = [
  { label: "Services", href: "/#services" },
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Verified Vendors", href: "/#verified-vendors" },
  { label: "Pricing Estimate", href: "/#pricing-estimate" },
  { label: "Reviews", href: "/#reviews" },
  { label: "For Vendors", href: "/vendors" },
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function trackCtaClick(label: string) {
    // Future integration: save click events to website_events table for analytics and daily AI agent report.
    console.info(`QuickFurno CTA clicked: ${label}`);
  }

  return (
    <header className={`site-header ${scrolled ? "site-header--scrolled" : ""}`}>
      <div className="container header-shell">
        <Link href="/" className="brand-lockup" aria-label="QuickFurno home">
          <span className="brand-mark">QF</span>
          <span className="brand-text">QuickFurno</span>
        </Link>

        <nav className="desktop-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <EnquiryModalTrigger
            className="btn btn-primary header-quote"
            onClick={() => trackCtaClick("Get 4 Verified Quotes - Header")}
          >
            Get Free Quotes
          </EnquiryModalTrigger>
          <Link href="/vendors" className="btn btn-text">
            Vendor Login / Register
          </Link>
          <button
            type="button"
            className="mobile-menu-button"
            aria-label="Toggle navigation menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      <div className={`mobile-nav ${menuOpen ? "mobile-nav--open" : ""}`}>
        <nav className="container mobile-nav-panel" aria-label="Mobile navigation">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>
              {item.label}
            </Link>
          ))}
          <EnquiryModalTrigger
            className="btn btn-primary"
            onClick={() => {
              setMenuOpen(false);
              trackCtaClick("Get 4 Verified Quotes - Mobile Menu");
            }}
          >
            Get Free Quotes
          </EnquiryModalTrigger>
        </nav>
      </div>
    </header>
  );
}
