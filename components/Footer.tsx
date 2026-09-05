"use client";

import { useState } from "react";
import Link from "next/link";
import { whatsappLink } from "@/lib/config";
import { categories, categorySlug, cities } from "@/lib/quickfurno-data";

type FooterLink = { label: string; href?: string; external?: boolean };
type FooterSection = { id: string; title: string; links: FooterLink[] };

const sections: FooterSection[] = [
  {
    id: "categories",
    title: "Categories",
    links: categories.map((category) => ({
      label: category.name,
      href: `/category/${categorySlug(category.name)}`,
    })),
  },
  {
    id: "cities",
    title: "Cities",
    // Plain labels — no city route exists, kept as-is to avoid routing changes.
    links: cities.map((city) => ({ label: city })),
  },
  {
    id: "company",
    title: "Company",
    links: [
      { label: "About", href: "/#why-quickfurno" },
      { label: "How It Works", href: "/#how-it-works" },
      { label: "Contact", href: "/#contact" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
  {
    id: "vendors",
    title: "For Vendors",
    links: [
      { label: "Vendor Portal", href: "/vendor" },
      { label: "Login as Vendor", href: "/vendor?mode=login" },
      { label: "Create Vendor Account", href: "/vendor?mode=signup" },
    ],
  },
  {
    id: "support",
    title: "Support",
    links: [
      { label: "WhatsApp Support", href: whatsappLink(), external: true },
      { label: "Help & Verification", href: "/#why-quickfurno" },
    ],
  },
];

function FooterLinks({ links }: { links: FooterLink[] }) {
  return (
    <ul className="qf-foot-links">
      {links.map((link) => (
        <li key={link.label}>
          {!link.href ? (
            <span>{link.label}</span>
          ) : link.external ? (
            <a href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>
          ) : (
            <Link href={link.href}>{link.label}</Link>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Footer() {
  const [open, setOpen] = useState<string | null>(null);

  // QF-UI-V2-14: id="contact" removed - FinalCTAV2 also carried it, so the
  // homepage shipped a duplicate element id. That section comes first in the
  // document, so "/#contact" already resolved there and this copy was
  // unreachable: dropping it changes no navigation behaviour.
  return (
    <footer className="qf-foot">
      <div className="qf-foot-inner">
        <div className="qf-foot-brand">
          <Link href="/" className="qf-foot-logo" aria-label="QuickFurno home">
            <span className="qf-foot-logo-q">Quick</span>
            <span className="qf-foot-logo-f">Furno</span>
          </Link>
          <p className="qf-foot-tagline">
            QuickFurno connects homeowners with verified interior, carpentry, modular, painting,
            sofa and civil-work vendors in Pune and Mumbai.
          </p>
        </div>

        <div className="qf-foot-sections">
          {sections.map((section) => {
            const isOpen = open === section.id;
            return (
              <div className={`qf-foot-acc${isOpen ? " is-open" : ""}`} key={section.id}>
                {/* QF-UI-V2-17: h2, not h3. These are the footer landmark's own
                    top-level groups, and on pages whose main content has no
                    visible h2 (/enquiry) an h3 here produced an h1 -> h3 jump.
                    All visual styling sits on .qf-foot-acc-btn, so the level
                    change is purely semantic. */}
                <h2 className="qf-foot-acc-head">
                  <button
                    type="button"
                    className="qf-foot-acc-btn"
                    aria-expanded={isOpen}
                    aria-controls={`qf-foot-panel-${section.id}`}
                    onClick={() => setOpen((current) => (current === section.id ? null : section.id))}
                  >
                    {section.title}
                    <span className="qf-foot-acc-chev" aria-hidden="true" />
                  </button>
                </h2>
                <div className="qf-foot-acc-panel" id={`qf-foot-panel-${section.id}`}>
                  <div className="qf-foot-acc-inner">
                    <FooterLinks links={section.links} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="qf-foot-bottom">
        <span>© 2026 QuickFurno · Pune &amp; Mumbai</span>
        <span>Verified vendors · Up to 3 matches · Free for homeowners</span>
      </div>
    </footer>
  );
}
