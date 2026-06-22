"use client";

import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { CONTACT_TEL, whatsappLink } from "@/lib/config";

export function StickyMobileCTA() {
  function trackCtaClick(label: string) {
    // Future integration: save click events to website_events table for analytics and daily AI agent report.
    console.info(`QuickFurno sticky CTA clicked: ${label}`);
  }

  return (
    <div className="sticky-mobile-cta" aria-label="QuickFurno contact actions">
      <a className="smc-call" href={CONTACT_TEL} onClick={() => trackCtaClick("Sticky Call")}>
        <span aria-hidden="true">📞</span>
        Call
      </a>
      <a
        className="smc-wa"
        href={whatsappLink("Hi QuickFurno, I'd like free quotes for my home project.")}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackCtaClick("Sticky WhatsApp")}
      >
        <span aria-hidden="true">💬</span>
        WhatsApp
      </a>
      <EnquiryModalTrigger className="smc-quotes" onClick={() => trackCtaClick("Sticky Get Quotes")}>
        Get Quotes
      </EnquiryModalTrigger>
    </div>
  );
}
