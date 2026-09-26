"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { QFIcon } from "@/components/QuickFurnoIcons";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { Wordmark } from "@/components/Wordmark";

// Single source of truth for the unified public-site navigation.
// Anchor links (e.g. /#categories) resolve to homepage sections; on other
// pages Next.js navigates home first, then scrolls to the anchor.
const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Services", href: "/#services" },
  { label: "How It Works", href: "/#how-it-works" },
  { label: "For Vendors", href: "/vendors" },
  { label: "About", href: "/#why-quickfurno" },
];

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeHref, setActiveHref] = useState("/");

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

  // Desktop orientation: keep one nav item visibly active. On the homepage
  // this follows the section currently under the sticky header; on routed
  // public pages it maps the page back to its parent navigation section.
  useEffect(() => {
    if (pathname !== "/") {
      if (pathname === "/vendors" || pathname.startsWith("/vendors/")) {
        setActiveHref("/vendors");
      } else if (pathname.startsWith("/category/")) {
        setActiveHref("/#services");
      } else {
        setActiveHref("");
      }
      return;
    }

    let raf = 0;
    const sections = [
      { id: "services", href: "/#services" },
      { id: "how-it-works", href: "/#how-it-works" },
      { id: "why-quickfurno", href: "/#why-quickfurno" },
    ] as const;

    const updateActiveSection = () => {
      const threshold = Math.min(180, window.innerHeight * 0.28);
      let nextHref = "/";
      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= threshold) {
          nextHref = section.href;
        }
      }
      setActiveHref((current) => (current === nextHref ? current : nextHref));
      raf = 0;
    };

    const onViewportChange = () => {
      if (!raf) raf = window.requestAnimationFrame(updateActiveSection);
    };

    updateActiveSection();
    window.addEventListener("scroll", onViewportChange, { passive: true });
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("scroll", onViewportChange);
      window.removeEventListener("resize", onViewportChange);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [pathname]);

  return (
    <header className={`qf-site-header${scrolled ? " qf-site-header--scrolled" : ""}`}>
      <div className="qf-header-shell">
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
        {/* The approved QuickFurno mark, from <Wordmark /> so the header and
            the footer can never drift apart. This used to be a CSS text
            wordmark (.qfp-logo) because the logo file the site had was an
            older mark with different lettering; that file is now replaced. */}
        <Link href="/" className="qf-brand" aria-label="QuickFurno home" onClick={() => setOpen(false)}>
          <Wordmark height={24} priority />
        </Link>

        <nav className="qf-nav" aria-label="Primary navigation">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="qf-nav-link"
              aria-current={activeHref === link.href ? "page" : undefined}
              data-active={activeHref === link.href ? "true" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="qf-header-actions">
          <span className="qf-location-pill"><QFIcon name="pin" /> Pune</span>
          <EnquiryModalTrigger className="qf-header-cta" source="Global public header">
            Get up to 3 matches
          </EnquiryModalTrigger>

        </div>
      </div>

      {open ? (
        <nav className="qf-mobile-nav" id="qf-mobile-menu" aria-label="Mobile menu">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="qf-mobile-nav-link"
              aria-current={activeHref === link.href ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <EnquiryModalTrigger
            className="qf-header-cta qf-header-cta--block"
            source="Global public mobile menu"
            onClick={() => setOpen(false)}
          >
            Get up to 3 matches
          </EnquiryModalTrigger>
        </nav>
      ) : null}
    </header>
  );
}
