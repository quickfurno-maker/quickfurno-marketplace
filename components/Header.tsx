"use client";

import { useState } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";

// Single source of truth for the unified public-site navigation.
// Anchor links (e.g. /#categories) resolve to homepage sections; on other
// pages Next.js navigates home first, then scrolls to the anchor.
const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Categories", href: "/#categories" },
  { label: "How It Works", href: "/#how-it-works" },
  { label: "For Vendors", href: "/vendors" },
  { label: "About", href: "/#why-quickfurno" },
  { label: "Contact", href: "/#contact" },
];

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="qf-site-header">
      <div className="qf-header-shell">
        <Link href="/" className="qf-brand" aria-label="QuickFurno home" onClick={() => setOpen(false)}>
          <span className="qf-brand-mark">
            <LogoMark />
          </span>
          <span className="qf-brand-text">QuickFurno</span>
        </Link>

        <nav className="qf-nav" aria-label="Primary navigation">
          {NAV_LINKS.map((link) => (
            <Link key={link.label} href={link.href} className="qf-nav-link">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="qf-header-actions">
          <EnquiryModalTrigger className="qf-header-cta" source="Header CTA">
            Get Free Vendor Matches
          </EnquiryModalTrigger>
          <button
            type="button"
            className="qf-nav-toggle"
            aria-label="Toggle navigation menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      {open ? (
        <nav className="qf-mobile-nav" aria-label="Mobile navigation">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="qf-mobile-nav-link"
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <EnquiryModalTrigger
            className="qf-header-cta qf-header-cta--block"
            source="Header CTA"
            onClick={() => setOpen(false)}
          >
            Get Free Vendor Matches
          </EnquiryModalTrigger>
        </nav>
      ) : null}
    </header>
  );
}
