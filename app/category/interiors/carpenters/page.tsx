import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { whatsappLink } from "@/lib/config";
import styles from "./vendor-listing.module.css";

export const metadata: Metadata = {
  title: "Verified Carpenters in Pune | QuickFurno",
  description:
    "Compare verified carpenters for modular furniture, wardrobes, kitchens, TV units and more in Pune.",
  openGraph: {
    title: "Verified Carpenters in Pune | QuickFurno",
    description:
      "Compare verified carpenters for modular furniture, wardrobes, kitchens, TV units and more.",
    siteName: "QuickFurno",
    type: "website",
  },
};

type VendorBadge = "Verified" | "Premium" | "Top Rated" | "Direct Factory";

type ListingVendor = {
  name: string;
  slug: string;
  logo: string;
  thumbnail: string;
  badges: VendorBadge[];
  rating: number;
  reviews: number;
  location: string;
  serviceLine: string;
  experience: string;
  tags: string[];
  price: string;
  note: string;
  contactAction: "whatsapp" | "callback";
};

const quickFilters = [
  {
    label: "Verified",
    icon: "/assets/quickfurno/icons/trust/verified-vendors.svg",
  },
  {
    label: "Top Rated",
    icon: "/assets/quickfurno/icons/actions/star-rating.svg",
  },
  {
    label: "Budget Friendly",
    icon: "/assets/quickfurno/icons/actions/rupee.svg",
  },
  {
    label: "Premium",
    icon: "/assets/quickfurno/icons/actions/crown-premium.svg",
  },
  {
    label: "Direct Factory",
    icon: "/assets/quickfurno/icons/trust/direct-factory.svg",
  },
];

const vendors: ListingVendor[] = [
  {
    name: "ModuCraft Interiors",
    slug: "moducraft-interiors",
    logo: "/assets/quickfurno/images/vendors/moducraft-logo.svg",
    thumbnail: "/assets/quickfurno/images/vendors/modular-kitchen.svg",
    badges: ["Verified", "Premium"],
    rating: 4.8,
    reviews: 310,
    location: "Pune",
    serviceLine: "Modular Factory",
    experience: "8+ Years",
    tags: ["Modular Factory", "Machine Finish", "Premium Interiors"],
    price: "\u20b91,250 / sq ft",
    note: "Factory-made modular furniture with machine-finish precision.",
    contactAction: "whatsapp",
  },
  {
    name: "WoodNest Interiors",
    slug: "woodnest-interiors",
    logo: "/assets/quickfurno/images/vendors/woodnest-logo.svg",
    thumbnail: "/assets/quickfurno/images/vendors/wardrobe-interior.svg",
    badges: ["Verified", "Top Rated"],
    rating: 4.7,
    reviews: 235,
    location: "Pune",
    serviceLine: "On-site Carpentry",
    experience: "6+ Years",
    tags: ["On-site Carpentry", "Custom Design", "Timely Delivery"],
    price: "\u20b9950 / sq ft",
    note: "Custom carpentry with flawless finishing and timely delivery.",
    contactAction: "whatsapp",
  },
  {
    name: "Urban Wood Studio",
    slug: "urban-wood-studio",
    logo: "/assets/quickfurno/images/vendors/urbanwood-logo.svg",
    thumbnail: "/assets/quickfurno/images/vendors/premium-living-room.svg",
    badges: ["Verified", "Direct Factory"],
    rating: 4.6,
    reviews: 198,
    location: "Pune",
    serviceLine: "Modular Factory",
    experience: "10+ Years",
    tags: ["Direct Factory", "Modular Furniture", "Best Price"],
    price: "\u20b91,150 / sq ft",
    note: "Direct factory pricing for modular furniture and custom units.",
    contactAction: "whatsapp",
  },
  {
    name: "Prism Interiors",
    slug: "prism-interiors",
    logo: "/assets/quickfurno/images/vendors/prism-logo.svg",
    thumbnail: "/assets/quickfurno/images/vendors/office-interior.svg",
    badges: ["Verified", "Premium"],
    rating: 4.6,
    reviews: 420,
    location: "Pune",
    serviceLine: "Modular Factory",
    experience: "12+ Years",
    tags: ["Luxury Interiors", "Modular Factory", "10 Yr Warranty"],
    price: "\u20b91,600 / sq ft",
    note: "Luxury modular interiors with extended warranty support.",
    contactAction: "callback",
  },
];

function badgeClass(badge: VendorBadge) {
  if (badge === "Verified") return styles.badgeVerified;
  if (badge === "Premium") return styles.badgePremium;
  if (badge === "Top Rated") return styles.badgeTopRated;
  return styles.badgeFactory;
}

function VendorListingCard({ vendor, priority }: { vendor: ListingVendor; priority?: boolean }) {
  return (
    <article className={styles.vendorCard}>
      <div className={styles.logoWrap}>
        <Image src={vendor.logo} width={92} height={92} alt={`${vendor.name} logo`} priority={priority} />
      </div>

      <div className={styles.vendorBody}>
        <div className={styles.badgeRow} aria-label={`${vendor.name} badges`}>
          {vendor.badges.map((badge) => (
            <span className={`${styles.badge} ${badgeClass(badge)}`} key={badge}>
              {badge}
            </span>
          ))}
        </div>

        <div>
          <h2>{vendor.name}</h2>
          <p className={styles.vendorMeta}>
            {vendor.serviceLine}
            <span aria-hidden="true">.</span>
            {vendor.experience}
          </p>
        </div>

        <div className={styles.proofRow}>
          <span className={styles.ratingStar} aria-hidden="true">
            *
          </span>
          <strong>{vendor.rating.toFixed(1)}</strong>
          <span>({vendor.reviews} reviews)</span>
          <span aria-hidden="true">.</span>
          <span>{vendor.location}</span>
        </div>

        <div className={styles.tagRow} aria-label={`${vendor.name} services`}>
          {vendor.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>

        <p className={styles.vendorNote}>{vendor.note}</p>
      </div>

      <div className={styles.vendorAside}>
        <div className={styles.priceBlock}>
          <strong>{vendor.price}</strong>
          <span>Starts at</span>
        </div>

        <div className={styles.thumbnailWrap}>
          <Image
            src={vendor.thumbnail}
            alt={`${vendor.name} project thumbnail`}
            fill
            sizes="(max-width: 760px) 33vw, 160px"
            priority={priority}
          />
        </div>

        <div className={styles.cardActions}>
          <button className={styles.outlineButton} type="button">
            View Profile
          </button>
          <EnquiryModalTrigger
            className={styles.goldButton}
            modalTitle={`Get quote from ${vendor.name}`}
            serviceCategory="Carpentry"
            city="Pune"
            requirement={`I want a quote from ${vendor.name} for carpentry work.`}
            source={`Phase 3A listing quote: ${vendor.slug}`}
          >
            Get Quote
          </EnquiryModalTrigger>
        </div>

        {vendor.contactAction === "whatsapp" ? (
          <a
            className={styles.whatsappAction}
            href={whatsappLink(`Hi QuickFurno, I want to contact ${vendor.name} for carpentry work in Pune.`)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Chat on WhatsApp
          </a>
        ) : (
          <EnquiryModalTrigger
            className={styles.whatsappAction}
            modalTitle={`Ask ${vendor.name} to contact me`}
            serviceCategory="Carpentry"
            city="Pune"
            requirement={`Please ask ${vendor.name} to contact me for carpentry work.`}
            source={`Phase 3A listing callback: ${vendor.slug}`}
          >
            Ask Vendor to Contact
          </EnquiryModalTrigger>
        )}
      </div>
    </article>
  );
}

export default function CarpentersListingPage() {
  return (
    <>
      <Header />
      <main className={styles.page}>
        <div className={styles.shell}>
          <nav className={styles.breadcrumb} aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span aria-hidden="true">&gt;</span>
            <Link href="/#categories">Interiors</Link>
            <span aria-hidden="true">&gt;</span>
            <span>Carpenters</span>
          </nav>

          <section className={styles.heroSection} aria-labelledby="listing-title">
            <div>
              <h1 id="listing-title">Verified Carpenters in Pune</h1>
              <p>Compare verified carpenters for modular furniture, wardrobes, kitchens, TV units &amp; more.</p>
            </div>
            <div className={styles.heroTrust}>
              <span>128 vendors found</span>
              <span>Background checked</span>
            </div>
          </section>

          <section className={styles.searchPanel} aria-label="Search and listing filters">
            <div className={styles.selectBox}>
              <span>City</span>
              <select defaultValue="Pune, Maharashtra" aria-label="City">
                <option>Pune, Maharashtra</option>
              </select>
            </div>
            <div className={styles.selectBox}>
              <span>Category</span>
              <select defaultValue="Interiors" aria-label="Category">
                <option>Interiors</option>
              </select>
            </div>
            <div className={styles.selectBox}>
              <span>Subcategory</span>
              <select defaultValue="Carpenters" aria-label="Subcategory">
                <option>Carpenters</option>
              </select>
            </div>
            <button className={styles.searchButton} type="button">
              Search
            </button>
          </section>

          <section className={styles.mobileTools} aria-label="Mobile listing controls">
            <button type="button">Filters</button>
            <label>
              <span>Sort by:</span>
              <select defaultValue="Relevance" aria-label="Sort vendors">
                <option>Relevance</option>
                <option>Rating</option>
                <option>Price</option>
              </select>
            </label>
          </section>

          <section className={styles.quickFilters} aria-label="Quick filters">
            <span>Quick filters:</span>
            <div>
              {quickFilters.map((filter) => (
                <button type="button" key={filter.label}>
                  <Image src={filter.icon} width={18} height={18} alt="" aria-hidden="true" />
                  {filter.label}
                </button>
              ))}
            </div>
          </section>

          <section className={styles.layout} aria-label="Carpenter vendor listings">
            <aside className={styles.filterSidebar} aria-label="Filter sidebar placeholder">
              <div className={styles.sidebarHeader}>
                <h2>Filters</h2>
                <button type="button">Reset All</button>
              </div>

              <div className={styles.filterGroup}>
                <h3>Category</h3>
                <select defaultValue="Interiors > Carpenters" aria-label="Filter category">
                  <option>Interiors &gt; Carpenters</option>
                </select>
                <span>Modular Furniture</span>
                <span>Wardrobes</span>
                <span>TV Units</span>
                <span>Kitchen Cabinets</span>
              </div>

              <div className={styles.filterGroup}>
                <h3>Budget (per sq ft)</h3>
                <div className={styles.rangeLine} aria-hidden="true">
                  <i />
                </div>
                <div className={styles.rangeLabels}>
                  <span>Rs 500</span>
                  <span>Rs 5,000+</span>
                </div>
              </div>

              <div className={styles.filterGroup}>
                <h3>Ratings</h3>
                <label>
                  <input type="checkbox" defaultChecked /> 4.5 &amp; above
                </label>
                <label>
                  <input type="checkbox" /> 4.0 &amp; above
                </label>
              </div>

              <div className={styles.filterGroup}>
                <h3>Service Type</h3>
                <label>
                  <input type="checkbox" defaultChecked /> Modular Factory
                </label>
                <label>
                  <input type="checkbox" /> On-site Carpentry
                </label>
                <label>
                  <input type="checkbox" /> Design + Build
                </label>
              </div>

              <div className={styles.filterGroup}>
                <h3>City</h3>
                <label>
                  <input type="checkbox" defaultChecked /> Pune
                </label>
                <label>
                  <input type="checkbox" /> PCMC
                </label>
                <label>
                  <input type="checkbox" /> Baner
                </label>
              </div>

              <button className={styles.applyButton} type="button">
                Apply Filters
              </button>
            </aside>

            <div className={styles.resultsArea}>
              <div className={styles.resultsHeader}>
                <div>
                  <h2>Verified Carpenters in Pune</h2>
                  <p>Compare verified carpenters for modular furniture, wardrobes, kitchens, TV units &amp; more.</p>
                </div>
                <label>
                  <span>Sort by:</span>
                  <select defaultValue="Relevance" aria-label="Sort listing">
                    <option>Relevance</option>
                    <option>Highest Rated</option>
                    <option>Budget First</option>
                  </select>
                </label>
              </div>

              <div className={styles.vendorStack}>
                {vendors.map((vendor, index) => (
                  <VendorListingCard vendor={vendor} priority={index < 2} key={vendor.slug} />
                ))}
              </div>

              <div className={styles.safetyNote}>
                <Image
                  src="/assets/quickfurno/icons/trust/verified-vendors.svg"
                  width={24}
                  height={24}
                  alt=""
                  aria-hidden="true"
                />
                <div>
                  <strong>All vendors are background-checked &amp; verified</strong>
                  <span>Your project is in safe hands.</span>
                </div>
              </div>
            </div>

            <aside className={styles.matchCard} aria-label="Lead matching card placeholder">
              <div className={styles.matchIllustration}>
                <Image
                  src="/assets/quickfurno/icons/process/matched-vendors.svg"
                  width={128}
                  height={128}
                  alt=""
                  aria-hidden="true"
                />
              </div>
              <h2>Let us match you with top carpenters</h2>
              <p>Share your requirements and get matched with the best verified vendors.</p>

              <ul>
                <li>100% free for clients</li>
                <li>Quick matches in under 2 mins</li>
                <li>Only relevant vendors</li>
              </ul>

              <div className={styles.matchFields}>
                <label>
                  <span>Select Category</span>
                  <select defaultValue="Carpenters">
                    <option>Carpenters</option>
                  </select>
                </label>
                <label>
                  <span>Select Service</span>
                  <select defaultValue="Modular Furniture">
                    <option>Modular Furniture</option>
                  </select>
                </label>
                <label>
                  <span>Enter your location</span>
                  <input defaultValue="Pune, Maharashtra" />
                </label>
                <label>
                  <span>Describe your requirement</span>
                  <textarea placeholder="e.g. Modular kitchen, wardrobe, TV unit..." rows={4} />
                </label>
              </div>

              <EnquiryModalTrigger
                className={styles.matchButton}
                modalTitle="Get matched with verified carpenters"
                serviceCategory="Carpentry"
                city="Pune"
                source="Phase 3A right match card"
              >
                Get Matched Now
              </EnquiryModalTrigger>
            </aside>
          </section>
        </div>

        <div className={styles.mobileMatchBar}>
          <div>
            <strong>Let us match you with top carpenters</strong>
            <span>Share your requirements &amp; get matched vendors.</span>
          </div>
          <EnquiryModalTrigger
            className={styles.matchButton}
            modalTitle="Get matched with verified carpenters"
            serviceCategory="Carpentry"
            city="Pune"
            source="Phase 3A mobile sticky match CTA"
          >
            Get Matched Now
          </EnquiryModalTrigger>
        </div>
      </main>
      <Footer />
    </>
  );
}
