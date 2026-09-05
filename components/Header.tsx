"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";

// Single source of truth for the unified public-site navigation.
// Anchor links (e.g. /#categories) resolve to homepage sections; on other
// pages Next.js navigates home first, then scrolls to the anchor.
const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Services", href: "/#categories" },
  { label: "How It Works", href: "/#how-it-works" },
  { label: "For Professionals", href: "/vendors" },
  { label: "Resources", href: "/#why-quickfurno" },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  /**
   * QF-UI-V2-14: Escape did not dismiss the mobile menu. This is a disclosure
   * menu, not a modal - it deliberately does not trap focus or lock scroll, and
   * that architecture is kept - but Escape must still close it. Bound only
   * while open, so the closed header adds no global key listener.
   */
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Lightweight, rAF-throttled scroll listener that elevates the header once
  // the page is scrolled. Transform/opacity/shadow only — no layout work.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      setScrolled(window.scrollY > 8);
      raf = 0;
    };
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <header className={`qf-site-header${scrolled ? " qf-site-header--scrolled" : ""}`}>
      <div className="qf-header-shell">
        <Link href="/" className="qf-brand" aria-label="QuickFurno home" onClick={() => setOpen(false)}>
          <span className="qf-brand-lockup">
            <span className="qf-brand-text">
              <span className="qf-bw-quick">Quick</span>
              <span className="qf-bw-furno">Furno</span>
            </span>
            <span className="qf-brand-tagline">Your Home, Our Priority.</span>
          </span>
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
            Get Free Team Matches
          </EnquiryModalTrigger>
          <button
            type="button"
            className="qf-nav-toggle"
            aria-label="Toggle navigation menu"
            aria-expanded={open}
            aria-controls="qf-mobile-menu"
            onClick={() => setOpen((value) => !value)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      {open ? (
        <nav className="qf-mobile-nav" id="qf-mobile-menu" aria-label="Mobile menu">
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
            Get Free Team Matches
          </EnquiryModalTrigger>
        </nav>
      ) : null}
    </header>
  );
}
