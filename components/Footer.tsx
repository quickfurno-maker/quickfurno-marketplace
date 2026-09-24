// =============================================================================
// QuickFurno site footer, built from the approved canvas board.
//
// This is shared chrome: every public page renders it, so the copy lives here
// rather than in any one page's content module. Categories and cities come
// from the canonical registry, so adding a category adds a footer link with no
// change to this file.
//
// No hooks and no state — the board's footer is a plain grid, not an
// accordion, so this renders on the server and ships no JavaScript.
// =============================================================================

import Link from "next/link";
import { Icon } from "@/components/qf-icon";
import { whatsappLink } from "@/lib/config";
import { categories, categorySlug, cities } from "@/lib/quickfurno-data";

type FooterLink = { label: string; href: string; external?: boolean };

const CTAS = [
  {
    icon: "people",
    eye: "FOR HOMEOWNERS",
    head: ["Find trusted ", "home service", " professionals"] as const,
    body:
      "Get approved pros for interiors, carpentry, modular, painting, sofa, civil work and false " +
      "ceiling in Pune.",
    btn: "Start a Project",
    href: "/",
    primary: false,
  },
  {
    icon: "home_",
    eye: "FOR VENDORS",
    head: ["Grow ", "your business", " with QuickFurno"] as const,
    body: "Get quality-checked enquiries, showcase your work and connect with homeowners in Pune.",
    btn: "Become a Vendor",
    href: "/vendor?mode=signup",
    primary: true,
  },
];

const TRUST = [
  ["shield", "Approved", "Professionals"],
  ["people", "Quality", "Enquiries"],
  ["bars", "Growing", "Local Businesses"],
] as const;

const SOCIALS = [
  ["Instagram", "people"],
  ["Facebook", "chat"],
  ["YouTube", "arrow"],
  ["LinkedIn", "doc"],
  ["WhatsApp", "chat"],
] as const;

const CATEGORY_LINKS: FooterLink[] = categories.map((category) => ({
  label: category.name,
  href: `/category/${categorySlug(category.name)}`,
}));

// Plain labels: no city route exists yet, so these are not links.
const CITY_LABELS = [...cities];

const COMPANY: FooterLink[] = [
  { label: "About", href: "/#why-quickfurno" },
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Contact", href: "/#contact" },
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

const FOR_VENDORS: FooterLink[] = [
  { label: "Become a Vendor", href: "/vendors" },
  { label: "Vendor Login", href: "/vendor?mode=login" },
  { label: "Create Vendor Account", href: "/vendor?mode=signup" },
];

const SUPPORT: FooterLink[] = [
  { label: "WhatsApp Support", href: whatsappLink(), external: true },
  { label: "Help & Verification", href: "/#why-quickfurno" },
  { label: "FAQs", href: "/vendors#faq" },
];

function Group({
  title,
  links,
  labels,
  two,
}: {
  title: string;
  links?: FooterLink[];
  labels?: string[];
  two?: boolean;
}) {
  const slug = title.toLowerCase().replace(/[^a-z]/g, "");
  return (
    <div className={`qv-foot-group qv-foot-g-${slug}`}>
      {/* h2, not h3: on pages whose main content has no visible h2 (/enquiry)
          an h3 here would jump the outline h1 -> h3. */}
      <h2 className="qv-foot-group-t">{title.toUpperCase()}</h2>
      <div className={two ? "qv-foot-cols2" : undefined}>
        {labels
          ? labels.map((label) => (
              <span key={label}>
                {label}
                <Icon name="chev" className="qv-ico qv-foot-chev" sw={2.2} />
              </span>
            ))
          : links!.map((link) =>
              link.external ? (
                <a href={link.href} target="_blank" rel="noopener noreferrer" key={link.label}>
                  {link.label}
                  <Icon name="chev" className="qv-ico qv-foot-chev" sw={2.2} />
                </a>
              ) : (
                <Link href={link.href} key={link.label}>
                  {link.label}
                  <Icon name="chev" className="qv-ico qv-foot-chev" sw={2.2} />
                </Link>
              ),
            )}
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="qv qv-sec qv-foot">
      <div className="qv-shell">
        <div className="qv-foot-ctas">
          {CTAS.map((cta) => (
            <div className="qv-foot-cta" key={cta.eye}>
              <span
                className="qv-foot-cta-ico"
                style={{ backgroundColor: cta.primary ? "#E0611E" : "rgba(224, 97, 30, 0.85)" }}
              >
                <Icon name={cta.icon} sw={2} />
              </span>
              <div className="qv-foot-cta-body">
                <span className="qv-foot-cta-eye">{cta.eye}</span>
                <h2 className="qv-foot-cta-h">
                  {cta.head[0]}
                  <span className="qv-hl">{cta.head[1]}</span>
                  {cta.head[2]}
                </h2>
                <p>{cta.body}</p>
                <Link
                  className="qv-foot-cta-btn"
                  href={cta.href}
                  style={{
                    backgroundColor: cta.primary ? "#E0611E" : "#FFFFFF",
                    color: cta.primary ? "#FFFFFF" : "#14110D",
                  }}
                >
                  {cta.btn}
                  <Icon name="arrow" sw={2.1} />
                </Link>
              </div>
            </div>
          ))}
        </div>

        <div className="qv-foot-main">
          <div className="qv-foot-brand">
            <Link href="/" className="qv-foot-brand-name" aria-label="QuickFurno home">
              Quick<span className="qv-hl">Furno</span>
            </Link>
            <p className="qv-foot-blurb">
              QuickFurno helps homeowners discover approved, active interior, carpentry, modular,
              painting, sofa, civil-work and false ceiling vendors in Pune.
            </p>
            <div className="qv-foot-social">
              {SOCIALS.map(([name, icon]) => (
                <a href={whatsappLink()} aria-label={name} key={name}>
                  <Icon name={icon} />
                </a>
              ))}
            </div>
            <div className="qv-foot-trust">
              {TRUST.map(([icon, a, b]) => (
                <div className="qv-foot-trust-col" key={a}>
                  <Icon name={icon} sw={2} />
                  <span>
                    {a}
                    <br />
                    {b}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="qv-foot-links">
            <Group title="Categories" links={CATEGORY_LINKS} two />
            <div className="qv-foot-rest">
              <Group title="Company" links={COMPANY} />
              <Group title="For Vendors" links={FOR_VENDORS} />
              <Group title="Support" links={SUPPORT} />
              <Group title="Cities" labels={CITY_LABELS} />
            </div>
          </div>
        </div>

        <div className="qv-foot-sky">
          <span className="qv-script">Proud to support Pune&rsquo;s local talent</span>
          <img
            src="/assets/quickfurno/images/vendors/v2/foot-skyline.webp"
            alt="The Pune skyline"
            loading="lazy"
            decoding="async"
          />
        </div>

        <div className="qv-foot-legal">
          <span>© 2026 QuickFurno · Pune</span>
          <span>Approved active vendors · Up to 3 active matches · Free to enquire</span>
        </div>
      </div>
    </footer>
  );
}
