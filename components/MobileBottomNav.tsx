"use client";

import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { QFIcon } from "@/components/QuickFurnoIcons";
import { whatsappLink } from "@/lib/config";

function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.250-.12-1.5-.74-1.7-.82-.23-.08-.4-.12-.56.12-.16.25-.64.82-.79.99-.14.16-.29.18-.54.06a6.7 6.7 0 0 1-2-1.23 7.4 7.4 0 0 1-1.36-1.7c-.14-.25 0-.38.11-.5.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.42h-.48c-.16 0-.43.06-.65.31-.22.25-.85.83-.85 2.02 0 1.19.87 2.34.99 2.5.12.16 1.7 2.6 4.13 3.64.58.25 1.03.4 1.38.51.58.19 1.11.16 1.53.1.47-.07 1.5-.61 1.71-1.2.21-.59.21-1.1.15-1.2-.06-.11-.22-.17-.47-.29Z"
      />
    </svg>
  );
}

export function MobileBottomNav() {
  return (
    <nav className="qf-bottom-nav" aria-label="Mobile navigation">
      <Link href="/" className="qf-bottom-nav-item qf-bottom-nav-item--active">
        <QFIcon name="home" />
        <span>Home</span>
      </Link>
      <Link href="/#categories" className="qf-bottom-nav-item">
        <QFIcon name="grid" />
        <span>Categories</span>
      </Link>
      <EnquiryModalTrigger className="qf-bottom-nav-item">
        <QFIcon name="request" />
        <span>Fill Form</span>
      </EnquiryModalTrigger>
      <a
        href={whatsappLink()}
        target="_blank"
        rel="noopener noreferrer"
        className="qf-bottom-nav-item qf-bottom-nav-item--whatsapp"
      >
        <WhatsAppGlyph />
        <span>WhatsApp</span>
      </a>
    </nav>
  );
}
