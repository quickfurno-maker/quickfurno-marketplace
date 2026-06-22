"use client";

import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { QFIcon } from "@/components/QuickFurnoIcons";

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
          <button className="qf-location-pill" type="button" aria-label="Selected city Pune">
            <QFIcon name="pin" />
            Pune
            <span aria-hidden="true">⌄</span>
          </button>
          <Link className="qf-header-icon-link" href="/#services" aria-label="Search services">
            <QFIcon name="search" />
          </Link>
          <Link className="qf-list-business-link" href="/vendors">
            List Your Business
          </Link>
          <Link className="qf-header-icon-link" href="/login" aria-label="Login">
            <QFIcon name="user" />
          </Link>
        </div>
      </div>
    </header>
  );
}
