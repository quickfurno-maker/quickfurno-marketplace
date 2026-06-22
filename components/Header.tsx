"use client";

import Link from "next/link";
import { LogoMark } from "@/components/Logo";

export function Header() {
  return (
    <header className="qf-site-header">
      <div className="qf-header-shell">
        <Link href="/" className="qf-brand" aria-label="QuickFurno home">
          <span className="qf-brand-mark">
            <LogoMark />
          </span>
          <span className="qf-brand-text">QuickFurno</span>
        </Link>

        <div className="qf-header-actions" aria-label="QuickFurno quick actions">
          <Link className="qf-list-business-link" href="/vendors">
            List Your Business
          </Link>
        </div>
      </div>
    </header>
  );
}
