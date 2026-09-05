import Link from "next/link";
import { VendorProfileImage } from "./VendorProfileMedia";
import {
  profileQuickFacts,
  type ProfileSectionId,
  type VendorPublicProfileView,
} from "./profileModel";

/**
 * Public vendor profile sections (QF-UI-V2-07). Server components — only the
 * media fallback and the action card need the client.
 *
 * Every value rendered here comes from the truth-first profileModel, so nothing
 * defaulted or invented can reach the page: no rating, no review count, no
 * response time, no distance, no years of experience, no invented business hours
 * and no invented service areas. A section with nothing published is either
 * hidden or reduced to a single honest line.
 */

/** Hero: identity, verification, published quick facts. */
export function VendorProfileHero({ vendor }: { vendor: VendorPublicProfileView }) {
  const facts = profileQuickFacts(vendor);

  return (
    <header className="qf-vprofile-hero">
      <div className="qf-vprofile-cover">
        {vendor.coverImage ? (
          <VendorProfileImage
            src={vendor.coverImage}
            alt={`${vendor.businessName} cover image`}
            className="qf-vprofile-cover-img"
            fallbackLabel={vendor.initials}
            eager
          />
        ) : (
          // A neutral branded surface — never a stock interior presented as this
          // vendor's own project work.
          <span className="qf-vprofile-cover-blank" aria-hidden="true" />
        )}
      </div>

      <div className="qf-vprofile-identity">
        <div className="qf-vprofile-avatar">
          {vendor.profileImage ? (
            <VendorProfileImage
              src={vendor.profileImage}
              alt={`${vendor.businessName} logo`}
              className="qf-vprofile-avatar-img"
              fallbackLabel={vendor.initials}
              eager
            />
          ) : (
            <span className="qf-vprofile-avatar-initials" aria-hidden="true">
              {vendor.initials}
            </span>
          )}
        </div>

        <div className="qf-vprofile-identity-text">
          {vendor.verified ? (
            <p className="qf-vprofile-verified">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <path
                  d="M8 1.4l1.8 1.1 2.1-.2.6 2 1.7 1.2-.9 1.9.3 2.1-2 .7-1.3 1.7-2-.6-2 .6-1.3-1.7-2-.7.3-2.1-.9-1.9L2.1 4.3l.6-2 2.1.2L8 1.4z"
                  fill="currentColor"
                />
                <path d="M5.6 8.1l1.6 1.6 3.2-3.4" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Verified
              <span className="qf-vprofile-verified-note">Profile reviewed by QuickFurno</span>
            </p>
          ) : null}

          <h1 className="qf-vprofile-name">{vendor.businessName}</h1>
          <p className="qf-vprofile-meta">
            {vendor.category} · {vendor.serviceAreaSummary ?? vendor.city}
          </p>
        </div>
      </div>

      {facts.length > 0 ? (
        <dl className="qf-vprofile-facts">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  );
}

/** Compact anchor nav. Empty sections are already filtered out upstream. */
export function VendorProfileSectionNav({
  sections,
}: {
  sections: { id: ProfileSectionId; label: string }[];
}) {
  if (sections.length < 2) return null;
  return (
    <nav className="qf-vprofile-nav" aria-label="Vendor profile sections">
      {sections.map((section) => (
        <a key={section.id} href={`#${section.id}`}>
          {section.label}
        </a>
      ))}
    </nav>
  );
}

/** About — the vendor's own published description only. */
export function VendorProfileOverview({ vendor }: { vendor: VendorPublicProfileView }) {
  return (
    <section id="overview" className="qf-vprofile-section">
      <h2>About {vendor.businessName}</h2>
      <p className="qf-vprofile-about">{vendor.description}</p>
    </section>
  );
}

/** Services — real canonical service categories only. */
export function VendorProfileServices({ vendor }: { vendor: VendorPublicProfileView }) {
  if (!vendor.hasServices) return null;
  return (
    <section id="services" className="qf-vprofile-section">
      <h2>Services</h2>
      <ul className="qf-vprofile-services">
        {vendor.services.map((service) => (
          <li key={service}>{service}</li>
        ))}
      </ul>
    </section>
  );
}

/** Portfolio — the vendor's own approved photos only. */
export function VendorProfilePortfolio({ vendor }: { vendor: VendorPublicProfileView }) {
  if (!vendor.hasPortfolio) return null;
  const single = vendor.portfolio.length === 1;

  return (
    <section id="portfolio" className="qf-vprofile-section">
      <h2>Project photos</h2>
      <div className={`qf-vprofile-portfolio${single ? " qf-vprofile-portfolio--single" : ""}`}>
        {vendor.portfolio.map((src, index) => (
          <figure key={src} className="qf-vprofile-shot">
            <VendorProfileImage
              src={src}
              alt={`${vendor.businessName} project photo ${index + 1}`}
              className="qf-vprofile-shot-img"
              fallbackLabel="Photo unavailable"
              eager={index === 0}
            />
          </figure>
        ))}
      </div>
      <p className="qf-vprofile-note">Photos are published by the vendor.</p>
    </section>
  );
}

/** Details — price, hours and service areas, each only when published. */
export function VendorProfileDetails({ vendor }: { vendor: VendorPublicProfileView }) {
  const hasAny = vendor.hasStartingPrice || vendor.hasBusinessHours || vendor.hasServiceArea;
  if (!hasAny) return null;

  return (
    <section id="details" className="qf-vprofile-section">
      <h2>Business details</h2>
      <dl className="qf-vprofile-details">
        {vendor.hasStartingPrice ? (
          <div>
            <dt>Starting from</dt>
            <dd>
              {vendor.startingPrice}
              <span className="qf-vprofile-note">
                Final quote depends on project scope, materials, measurements and site conditions.
              </span>
            </dd>
          </div>
        ) : null}

        {vendor.hasServiceArea ? (
          <div>
            <dt>Service areas</dt>
            <dd>
              <ul className="qf-vprofile-areas">
                {vendor.serviceAreas.map((area) => (
                  <li key={area}>{area}</li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}

        {vendor.hasBusinessHours ? (
          <div>
            <dt>Business hours</dt>
            <dd>{vendor.businessHours}</dd>
          </div>
        ) : null}

        <div>
          <dt>City</dt>
          <dd>{vendor.city}</dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * FAQ — QuickFurno process only, and only claims the product actually makes.
 * The previous "Most vendors respond the same day" promise is gone: nothing in
 * the product measures or guarantees vendor response time.
 */
export function VendorProfileFaq() {
  const items: [string, string][] = [
    ["Is sending an enquiry free?", "Yes. Homeowner enquiries on QuickFurno are free."],
    [
      "What happens when I choose this vendor?",
      "QuickFurno prioritises your selected vendor first. Depending on eligibility and your selection window, QuickFurno may also match suitable verified vendors up to the current lead limit.",
    ],
    [
      "Can I compare other vendors?",
      "Yes. Return to the category listing to compare available verified vendor profiles.",
    ],
  ];

  return (
    <section className="qf-vprofile-section">
      <h2>Common questions</h2>
      <dl className="qf-vprofile-faq">
        {items.map(([question, answer]) => (
          <div key={question}>
            <dt>{question}</dt>
            <dd>{answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * End-of-profile CTA. Replaces the old "Similar vendors coming soon" panel with
 * a real navigation path back to the category listing.
 */
export function VendorProfileCompareMore({
  vendor,
  categoryHref,
}: {
  vendor: VendorPublicProfileView;
  categoryHref: string;
}) {
  return (
    <section className="qf-vprofile-comparemore">
      <h2>Want to compare more {vendor.category.toLowerCase()}?</h2>
      <p>Browse every verified vendor published in this category.</p>
      <Link href={categoryHref} className="qf-pub-btn qf-pub-btn--secondary">
        Back to {vendor.category}
      </Link>
    </section>
  );
}
