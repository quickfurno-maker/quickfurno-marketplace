import Link from "next/link";

/**
 * QF-UI-V2-12 — VENDOR PORTAL CONTEXTUAL CHROME
 *
 * A dedicated, deliberately quiet header for the vendor auth/onboarding surface
 * (/vendor). It exists so the shared public Header can stay byte-for-byte
 * approved: that component is a homeowner primitive and carries a primary nav
 * (Home / Services / How It Works / For Professionals / Resources), a
 * "Get Free Team Matches" EnquiryModalTrigger and a hamburger that opens the
 * homeowner menu. All three are the wrong context for someone creating a vendor
 * account, and the enquiry trigger in particular could open a CLIENT enquiry
 * modal in the middle of a vendor application.
 *
 * Nothing here is route-aware and no global chrome was modified — the isolation
 * is pure page composition in app/vendor/page.tsx.
 *
 * Server component: it renders links only, so it adds no client JavaScript.
 */
export function VendorPortalHeader() {
  return (
    <header className="qf-vauth-header">
      <div className="qf-vauth-header-inner">
        <Link href="/" className="qf-vauth-brand-link" aria-label="QuickFurno home">
          <span className="qf-vauth-brand-text">
            <span className="qf-vauth-bw-quick">Quick</span>
            <span className="qf-vauth-bw-furno">Furno</span>
          </span>
          <span className="qf-vauth-brand-tagline">Your Home, Our Priority.</span>
        </Link>

        <div className="qf-vauth-header-right">
          {/* Readable text, not an image, so the context is announced too. */}
          <span className="qf-vauth-context">Vendor Portal</span>
          {/* Hidden on phones, where the brand lockup already routes home. */}
          <Link href="/" className="qf-vauth-back">
            Back to QuickFurno
          </Link>
        </div>
      </div>
    </header>
  );
}
