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
import { Wordmark } from "@/components/Wordmark";
import { CONTACT, whatsappLink } from "@/lib/config";
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

// Real brand marks, carried over from the homepage footer this one replaces.
// Filled paths, not the stroked line set, so they keep their own component.
const SOCIAL_MARKS: Record<string, string> = {
  facebook:
    "M13.5 22v-8h2.7l.4-3.1h-3.1V8.9c0-.9.25-1.5 1.55-1.5h1.65V4.6A22 22 0 0 0 14.3 4.5c-2.4 0-4 1.45-4 4.1v2.3H7.6V14h2.7v8z",
  instagram:
    "M12 2.2c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9s.68.82.9 1.38c.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38s-.82.68-1.38.9c-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.8 3.8 0 0 1-1.38-.9 3.8 3.8 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.21 15.58 2.2 15.2 2.2 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38s.82-.68 1.38-.9c.42-.16 1.06-.36 2.23-.41C8.42 2.21 8.8 2.2 12 2.2m0 2.16c-3.15 0-3.5.01-4.74.07-1.14.05-1.76.24-2.17.4-.55.21-.94.47-1.35.88s-.67.8-.88 1.35c-.16.41-.35 1.03-.4 2.17-.06 1.24-.07 1.6-.07 4.74s.01 3.5.07 4.74c.05 1.14.24 1.76.4 2.17.21.55.47.94.88 1.35s.8.67 1.35.88c.41.16 1.03.35 2.17.4 1.24.06 1.6.07 4.74.07s3.5-.01 4.74-.07c1.14-.05 1.76-.24 2.17-.4.55-.21.94-.47 1.35-.88s.67-.8.88-1.35c.16-.41.35-1.03.4-2.17.06-1.24.07-1.6.07-4.74s-.01-3.5-.07-4.74c-.05-1.14-.24-1.76-.4-2.17a3.6 3.6 0 0 0-.88-1.35 3.6 3.6 0 0 0-1.35-.88c-.41-.16-1.03-.35-2.17-.4-1.24-.06-1.6-.07-4.74-.07m0 3.67a5.97 5.97 0 1 1 0 11.94 5.97 5.97 0 0 1 0-11.94m0 9.85a3.88 3.88 0 1 0 0-7.76 3.88 3.88 0 0 0 0 7.76m7.6-10.08a1.4 1.4 0 1 1-2.79 0 1.4 1.4 0 0 1 2.79 0",
  youtube:
    "M21.6 7.2a2.5 2.5 0 0 0-1.76-1.77C18.27 5 12 5 12 5s-6.27 0-7.84.43A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.76 1.77C5.73 19 12 19 12 19s6.27 0 7.84-.43a2.5 2.5 0 0 0 1.76-1.77A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8M10 15.1V8.9l5.2 3.1z",
  linkedin:
    "M6.94 5.5a1.94 1.94 0 1 1-3.88 0 1.94 1.94 0 0 1 3.88 0M3.3 20h3.4V9.2H3.3zm6 0h3.36v-5.7c0-1.5.29-2.96 2.16-2.96 1.84 0 1.86 1.72 1.86 3.05V20h3.37v-6.3c0-2.93-.63-5.18-4.05-5.18-1.64 0-2.75.9-3.2 1.76h-.05V9.2H9.3z",
};

const SOCIALS = [
  { name: "Facebook", icon: "facebook", href: "https://www.facebook.com/quickfurno" },
  { name: "Instagram", icon: "instagram", href: "https://www.instagram.com/quickfurno" },
  { name: "YouTube", icon: "youtube", href: "https://www.youtube.com/@quickfurno" },
  { name: "LinkedIn", icon: "linkedin", href: "https://www.linkedin.com/company/quickfurno" },
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
            {/* The white-lettering cut of the same mark the header uses — the
                footer panel is dark, so the dark artwork would disappear. */}
            <Link href="/" className="qv-foot-brand-name" aria-label="QuickFurno home">
              <Wordmark height={28} light />
            </Link>
            <p className="qv-foot-blurb">
              QuickFurno helps homeowners discover approved, active interior, carpentry, modular,
              painting, sofa, civil-work and false ceiling vendors in Pune.
            </p>
            <div className="qv-foot-social">
              {SOCIALS.map((social) => (
                <a
                  href={social.href}
                  aria-label={social.name}
                  target="_blank"
                  rel="noopener noreferrer"
                  key={social.name}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d={SOCIAL_MARKS[social.icon]} />
                  </svg>
                </a>
              ))}
            </div>

            {/* Carried over from the homepage footer this replaces, so no page
                loses the way to reach a human. */}
            <ul className="qv-foot-contact">
              <li>
                <a href={whatsappLink()} target="_blank" rel="noopener noreferrer">
                  <Icon name="chat" sw={2} />
                  WhatsApp us
                </a>
              </li>
              <li>
                <a href={`mailto:${CONTACT.email}`}>
                  <Icon name="doc" sw={2} />
                  {CONTACT.email}
                </a>
              </li>
              <li>
                <span>
                  <Icon name="pin_" sw={2} />
                  Kharadi, Pune, Maharashtra
                </span>
              </li>
            </ul>
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
