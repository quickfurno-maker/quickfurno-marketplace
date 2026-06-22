import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { whatsappLink } from "@/lib/config";
import { categories } from "@/lib/quickfurno-data";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid" data-reveal>
        <div className="footer-brand">
          <Link href="/" className="brand-lockup" aria-label="QuickFurno home">
            <span className="brand-mark">
              <LogoMark />
            </span>
            <span className="brand-text">
              <span className="bw-quick">Quick</span>
              <span className="bw-furno">Furno</span>
            </span>
          </Link>
          <p>
            Client-first marketplace for verified interior, carpentry, modular, painting,
            sofa and civil-work vendors in Pune and Mumbai.
          </p>
          <a
            className="btn btn-secondary footer-whatsapp"
            href={whatsappLink()}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp QuickFurno
          </a>
        </div>

        <div>
          <h3>Categories</h3>
          <ul className="footer-links">
            {categories.map((category) => (
              <li key={category.name}>
                <Link href={`/#services`}>{category.name}</Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3>Cities</h3>
          <ul className="footer-links">
            <li>Pune</li>
            <li>Mumbai</li>
          </ul>
        </div>

        <div>
          <h3>Company</h3>
          <ul className="footer-links">
            <li>
              <Link href="/vendors">For Vendors</Link>
            </li>
            <li>
              <Link href="/#faq">Privacy Policy</Link>
            </li>
            <li>
              <Link href="/#faq">Terms</Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© 2026 QuickFurno. Pune & Mumbai.</span>
        <span>Verified vendors. Transparent rates. Fast response.</span>
      </div>
    </footer>
  );
}
