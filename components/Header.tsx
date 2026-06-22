"use client";

import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { LogoMark } from "@/components/Logo";
import Link from "next/link";
import { useEffect, useState } from "react";

const navItems = [
  { label: "Home", href: "/" },
  { label: "Categories", href: "/#services" },
  { label: "Vendors", href: "/#verified-vendors" },
  { label: "How it Works", href: "/#how-it-works" },
  { label: "Vendor Plans", href: "/vendors" },
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;

    const update = () => {
      const y = window.scrollY;
      setScrolled(y > 8);
      // App-like auto-hide: hide when scrolling down past the hero, reveal on scroll up.
      if (y > lastY + 6 && y > 220) {
        setHidden(true);
      } else if (y < lastY - 6) {
        setHidden(false);
      }
      lastY = y;
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Never hide the header while the mobile menu is open.
  const headerHidden = hidden && !menuOpen;

  function trackCtaClick(label: string) {
    // Future integration: save click events to website_events table for analytics and daily AI agent report.
    console.info(`QuickFurno CTA clicked: ${label}`);
  }

  return (
    <header
      className={`site-header ${scrolled ? "site-header--scrolled" : ""} ${
        headerHidden ? "site-header--hidden" : ""
      }`}
    >
      <div className="container header-shell">
        <Link href="/" className="brand-lockup" aria-label="QuickFurno home">
          <span className="brand-mark">
            <LogoMark />
          </span>
          <span className="brand-text">
            <span className="bw-quick">Quick</span>
            <span className="bw-furno">Furno</span>
          </span>
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
