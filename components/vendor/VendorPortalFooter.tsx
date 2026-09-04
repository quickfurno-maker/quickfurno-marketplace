import Link from "next/link";
import { whatsappLink } from "@/lib/config";

/**
 * QF-UI-V2-12 — VENDOR PORTAL CONTEXTUAL CHROME
 *
 * A minimal footer for the vendor auth/onboarding surface. The shared public
 * Footer stays approved and untouched; it is simply the wrong content here —
 * it lists homeowner service categories and cities and closes with
 * "Verified vendors · Up to 3 matches · Free for homeowners", which speaks to
 * clients, not to a vendor signing up.
 *
 * Support reuses the SAME destination the public footer already uses
 * (whatsappLink() from lib/config) rather than inventing a new one. Only the
 * prefilled message differs: the no-argument default is the homeowner one
 * ("...getting quotes for my home project"), which would be the wrong opening
 * line for a vendor asking about their account.
 */
export function VendorPortalFooter() {
  return (
    <footer className="qf-vauth-footer">
      <div className="qf-vauth-footer-inner">
        <span className="qf-vauth-footer-copy">© 2026 QuickFurno</span>

        <nav className="qf-vauth-footer-links" aria-label="Vendor portal footer">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms</Link>
          <a
            href={whatsappLink("Hi QuickFurno, I need help with my vendor account.")}
            target="_blank"
            rel="noopener noreferrer"
          >
            Support
          </a>
          <Link href="/">Back to QuickFurno</Link>
        </nav>
      </div>
    </footer>
  );
}
