"use client";

import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";

export function StickyMobileCTA() {
  function trackCtaClick(label: string) {
    // Future integration: save click events to website_events table for analytics and daily AI agent report.
    console.info(`QuickFurno sticky CTA clicked: ${label}`);
  }

  return (
    <div className="sticky-mobile-cta" aria-label="QuickFurno contact actions">
      <a href="tel:+919999999999" onClick={() => trackCtaClick("Sticky Call")}>
        Call
      </a>
      <a href="https://wa.me/91XXXXXXXXXX" onClick={() => trackCtaClick("Sticky WhatsApp")}>
        WhatsApp
      </a>
      <EnquiryModalTrigger
        onClick={() => trackCtaClick("Sticky Get Quotes")}
      >
        Get Quotes
      </EnquiryModalTrigger>
    </div>
  );
}
