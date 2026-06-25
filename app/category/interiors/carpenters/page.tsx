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

type VendorBadge =
  | "Verified"
  | "Premium"
  | "Top Rated"
  | "Direct Factory"
  | "Subscription Active"
  | "Priority";

type ListingVendor = {
  name: string;
  slug: string;
  logo: string;
  thumbnail: string;
  professionalLabel: string;
  experience: string;
  badges: VendorBadge[];
  isSubscribed: boolean;
  priorityRank: number;
  rating: number;
  reviews: number;
  location: string;
  tags: string[];
  price: string;
  usp: string;
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

const filterSections = [
  {
    title: "Ratings",
    options: ["4.5 & above", "4.0 & above", "3.5 & above", "All Ratings"],
    checked: ["4.5 & above"],
  },
  {
    title: "Service Type",
    options: ["Modular Factory", "On-site Carpentry", "Customization Experts", "Design + Build"],
    checked: ["Modular Factory"],
  },
  {
    title: "City",
    options: ["Pune", "PCMC", "Baner", "Kharadi", "Hinjewadi"],
    checked: ["Pune"],
  },
  {
    title: "Response Time",
    options: ["Within 30 mins", "Within 1 hour", "Within 2 hours", "Anytime"],
    checked: ["Within 30 mins"],
  },
];

const unsortedVendors: ListingVendor[] = [
  {
    name: "ModuCraft Interiors",
    slug: "moducraft-interiors",
    logo: "/assets/quickfurno/images/vendors/moducraft-logo.svg",
    thumbnail: "/assets/quickfurno/images/vendors/modular-kitchen.svg",
    professionalLabel: "Modular Factory",
    experience: "8+ Years",
    badges: ["Verified", "Premium", "Subscription Active", "Priority"],
    isSubscribed: true,
    priorityRank: 1,
    rating: 4.8,
    reviews: 310,
    location: "Pune",
    tags: ["Modular Factory", "Machine Finish", "Premium Interiors"],
    price: "\u20b91,250 / sq ft",
    usp: "Factory-made modular furniture with machine-finish precision.",
  },
  {
    name: "WoodNest Interiors",
    slug: "woodnest-interiors",
    logo: "/assets/quickfurno/images/vendors/woodnest-logo.svg",
    thumbnail: "/assets/quickfurno/images/vendors/wardrobe-interior.svg",
    professionalLabel: "On-site Carpentry",
    experience: "6+ Years",
    badges: ["Verified", "Top Rated", "Subscription Active"],
    isSubscribed: true,
    priorityRank: 2,
    rating: 4.7,
    reviews: 235,
    location: "Pune",
    tags: ["On-site Carpentry", "Custom Design", "Timely Delivery"],
    price: "\u20b9950 / sq ft",
    usp: "Custom carpentry with flawless finishing and timely delivery.",
  },
  {
    name: "Urban Wood Studio",
    slug: "urban-wood-studio",
    logo: "/assets/quickfurno/images/vendors/urbanwood-logo.svg",
    thumbnail: "/assets/quickfurno/images/vendors/premium-living-room.svg",
    professionalLabel: "Modular Factory",
    experience: "10+ Years",
    badges: ["Verified", "Direct Factory", "Subscription Active"],
    isSubscribed: true,
    priorityRank: 3,
    rating: 4.6,
    reviews: 198,
    location: "Pune",
    tags: ["Direct Factory", "Modular Furniture", "Best Price"],
    price: "\u20b91,150 / sq ft",
    usp: "Direct factory pricing for modular furniture and custom units.",
  },
  {
    name: "FineLine Carpentry",
    slug: "fineline-carpentry",
    logo: "/assets/quickfurno/images/vendors/fineline-logo.svg",
    thumbnail: "/assets/quickfurno/images/vendors/wood-shelving.svg",
    professionalLabel: "On-site Carpentry",
    experience: "5+ Years",
    badges: ["Verified"],
    isSubscribed: false,
    priorityRank: 20,
    rating: 4.4,
    reviews: 164,
    location: "Pune",
    tags: ["Custom Design", "Civil Carpentry", "Furniture Repair"],
    price: "\u20b9800 / sq ft",
    usp: "Fast response with expert on-site carpentry solutions.",
  },
  {
    name: "Prism Interiors",
    slug: "prism-interiors",
    logo: "/assets/quickfurno/images/vendors/prism-logo.svg",
    thumbnail: "/assets/quickfurno/images/vendors/office-interior.svg",
    professionalLabel: "Modular Factory",
    experience: "12+ Years",
    badges: ["Verified", "Premium", "Subscription Active"],
    isSubscribed: true,
    priorityRank: 4,
    rating: 4.6,
    reviews: 420,
    location: "Pune",
    tags: ["Luxury Interiors", "Modular Factory", "10 Yr Warranty"],
    price: "\u20b91,600 / sq ft",
    usp: "Luxury modular interiors with extended warranty support.",
  },
  {
    name: "CraftEdge Solutions",
    slug: "craftedge-solutions",
    logo: "/assets/quickfurno/images/vendors/craftedge-logo.svg",
    thumbnail: "/assets/quickfurno/images/vendors/wardrobe-interior.svg",
    professionalLabel: "On-site Carpentry",
    experience: "7+ Years",
    badges: ["Verified"],
    isSubscribed: false,
    priorityRank: 21,
    rating: 4.4,
    reviews: 122,
    location: "Pune",
    tags: ["On-site Carpentry", "Interiors Fit-Out", "Budget Friendly"],
    price: "\u20b9650 / sq ft",
    usp: "Budget-friendly solutions with quality workmanship.",
  },
];

const vendors = [...unsortedVendors].sort((a, b) => {
  if (Number(b.isSubscribed) !== Number(a.isSubscribed)) {
    return Number(b.isSubscribed) - Number(a.isSubscribed);
  }
  if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
  return b.rating - a.rating;
});

function badgeClass(badge: VendorBadge) {
  if (badge === "Verified") return styles.badgeVerified;
  if (badge === "Premium") return styles.badgePremium;
  if (badge === "Top Rated") return styles.badgeTopRated;
  if (badge === "Direct Factory") return styles.badgeFactory;
  if (badge === "Subscription Active") return styles.badgeSubscription;
  return styles.badgePriority;
}

function VendorListingCard({ vendor, priority }: { vendor: ListingVendor; priority?: boolean }) {
  const enquiryRequirement = `I want a quote from ${vendor.name} for carpentry work in Pune.`;

  return (
    <article className={`${styles.vendorCard} ${vendor.isSubscribed ? styles.vendorCardPriority : ""}`}>
      <div className={styles.logoWrap}>
        <Image src={vendor.logo} width={92} height={92} alt={`${vendor.name} logo`} priority={priority} />
      </div>

      <div className={styles.vendorBody}>
        <div className={styles.badgeRow} aria-label={`${vendor.name} trust and priority badges`}>
          {vendor.badges.map((badge) => (
            <span className={`${styles.badge} ${badgeClass(badge)}`} key={badge}>
              {badge}
            </span>
          ))}
        </div>

        <div>
          <h2>{vendor.name}</h2>
          <p className={styles.vendorMeta}>
            <span>{vendor.professionalLabel}</span>
            <span aria-hidden="true">.</span>
            <span>{vendor.experience}</span>
          </p>
        </div>

        <div className={styles.proofRow}>
          <Image
            src="/assets/quickfurno/icons/actions/star-rating.svg"
            width={16}
            height={16}
            alt=""
            aria-hidden="true"
          />
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

        <p className={styles.vendorUsp}>{vendor.usp}</p>
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
            sizes="(max-width: 760px) 36vw, 160px"
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
            requirement={enquiryRequirement}
            source={`Phase 3B listing quote: ${vendor.slug}`}
          >
            Get Quote
          </EnquiryModalTrigger>
        </div>

        {vendor.isSubscribed ? (
          <a
            className={styles.whatsappAction}
            href={whatsappLink(`Hi QuickFurno, I want to contact ${vendor.name} for carpentry work in Pune.`)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image
              src="/assets/quickfurno/icons/actions/whatsapp.svg"
              width={15}
              height={15}
              alt=""
              aria-hidden="true"
            />
            Chat on WhatsApp
          </a>
        ) : (
          <EnquiryModalTrigger
            className={`${styles.whatsappAction} ${styles.callbackAction}`}
            modalTitle={`Ask ${vendor.name} to contact me`}
            serviceCategory="Carpentry"
            city="Pune"
            requirement={`Please ask ${vendor.name} to contact me for carpentry work in Pune.`}
            source={`Phase 3B listing callback: ${vendor.slug}`}
          >
            Ask Vendor to Contact
          </EnquiryModalTrigger>
        )}
      </div>
    </article>
  );
}

function FilterCheckboxGroup({
  title,
  options,
  checked,
}: {
  title: string;
  options: string[];
  checked: string[];
}) {
  return (
    <div className={styles.filterGroup}>
      <h3>{title}</h3>
      <div className={styles.checkboxGrid}>
        {options.map((option) => (
          <label key={option}>
            <input type="checkbox" defaultChecked={checked.includes(option)} />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </div>
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
            <div className={styles.heroTrust} aria-label="Listing summary">
              <span>Verified vendors</span>
              <span>Quick response expected</span>
            </div>
          </section>

          <section className={styles.searchPanel} aria-label="Search and listing filters">
            <label className={styles.selectBox}>
              <span>City</span>
              <select defaultValue="Pune, Maharashtra" aria-label="City">
                <option>Pune, Maharashtra</option>
              </select>
            </label>
            <label className={styles.selectBox}>
              <span>Category</span>
              <select defaultValue="Interiors" aria-label="Category">
                <option>Interiors</option>
              </select>
            </label>
            <label className={styles.selectBox}>
              <span>Subcategory</span>
              <select defaultValue="Carpenters" aria-label="Subcategory">
                <option>Carpenters</option>
              </select>
            </label>
            <button className={styles.searchButton} type="button">
              <Image src="/assets/quickfurno/icons/actions/search.svg" width={18} height={18} alt="" aria-hidden="true" />
              Search
            </button>
          </section>

          <section className={styles.mobileTools} aria-label="Mobile listing controls">
            <button type="button">
              <Image src="/assets/quickfurno/icons/actions/filter.svg" width={17} height={17} alt="" aria-hidden="true" />
              Filters
            </button>
            <label>
              <span>Sort by:</span>
              <select defaultValue="Relevance" aria-label="Sort vendors">
                <option>Relevance</option>
                <option>Top Rated</option>
                <option>Budget Friendly</option>
              </select>
            </label>
          </section>

          <section className={styles.quickFilters} aria-label="Quick filters">
            <span>Quick filters:</span>
            <div>
              {quickFilters.map((filter, index) => (
                <button className={index === 0 ? styles.activeFilterChip : ""} type="button" key={filter.label}>
                  <Image src={filter.icon} width={18} height={18} alt="" aria-hidden="true" />
                  {filter.label}
                </button>
              ))}
            </div>
          </section>

          <section className={styles.layout} aria-label="Carpenter vendor listings">
            <aside className={styles.filterSidebar} aria-label="Listing filters">
              <div className={styles.sidebarHeader}>
                <h2>Filters</h2>
                <button type="button">Reset All</button>
              </div>

              <div className={styles.filterGroup}>
                <h3>Category</h3>
                <select defaultValue="Interiors > Carpenters" aria-label="Filter category">
                  <option>Interiors &gt; Carpenters</option>
                </select>
                <div className={styles.pillList}>
                  <button type="button">Modular Furniture</button>
                  <button type="button">Wardrobes</button>
                  <button type="button">TV Units</button>
                  <button type="button">Kitchen Cabinets</button>
                  <button type="button">Office Furniture</button>
                </div>
              </div>

              <div className={styles.filterGroup}>
                <h3>Budget range</h3>
                <div className={styles.rangeLine} aria-hidden="true">
                  <i />
                  <b />
                </div>
                <div className={styles.rangeLabels}>
                  <span>Rs 500</span>
                  <span>Rs 5,000+</span>
                </div>
                <div className={styles.budgetInputs}>
                  <span>Rs 500</span>
                  <span>Rs 5,000+</span>
                </div>
              </div>

              {filterSections.map((section) => (
                <FilterCheckboxGroup
                  title={section.title}
                  options={section.options}
                  checked={section.checked}
                  key={section.title}
                />
              ))}

              <button className={styles.applyButton} type="button">
                Apply Filters
              </button>
              <button className={styles.clearButton} type="button">
                Clear Filters
              </button>
            </aside>

            <div className={styles.resultsArea}>
              <div className={styles.resultsHeader}>
                <div>
                  <h2>Verified Carpenters in Pune</h2>
                  <p>
                    Compare verified carpenters for modular furniture, wardrobes, kitchens, TV units &amp; more.
                  </p>
                </div>
                <div className={styles.resultsTools}>
                  <span>{vendors.length} shown</span>
                  <label>
                    <span>Sort by:</span>
                    <select defaultValue="Relevance" aria-label="Sort listing">
                      <option>Relevance</option>
                      <option>Highest Rated</option>
                      <option>Budget First</option>
                    </select>
                  </label>
                </div>
              </div>


              <div className={styles.vendorStack}>
                {vendors.map((vendor, index) => (
                  <VendorListingCard vendor={vendor} priority={index < 2} key={vendor.slug} />
                ))}
              </div>

              <div className={styles.pagination} aria-label="Pagination placeholder">
                <button type="button" aria-label="Previous page">
                  &lt;
                </button>
                <button className={styles.activePage} type="button">
                  1
                </button>
                <button type="button">2</button>
                <button type="button">3</button>
                <span>...</span>
                <button type="button">13</button>
                <button type="button" aria-label="Next page">
                  &gt;
                </button>
                <button className={styles.loadMoreButton} type="button">
                  Load More
                </button>
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
                <Link href="/#why-quickfurno">Learn how we verify vendors</Link>
              </div>
            </div>

            <aside className={styles.matchCard} aria-label="Lead matching card">
              <div className={styles.matchIllustration}>
                <Image
                  src="/assets/quickfurno/icons/process/matched-vendors.svg"
                  width={132}
                  height={132}
                  alt=""
                  aria-hidden="true"
                />
              </div>
              <h2>Let us match you with top carpenters</h2>
              <p>Share your requirements and get matched with the best verified vendors.</p>

              <ul className={styles.benefitList}>
                <li>
                  <Image src="/assets/quickfurno/icons/trust/best-price.svg" width={22} height={22} alt="" aria-hidden="true" />
                  <span>
                    <strong>100% Free</strong>
                    No hidden charges
                  </span>
                </li>
                <li>
                  <Image src="/assets/quickfurno/icons/trust/fast-response.svg" width={22} height={22} alt="" aria-hidden="true" />
                  <span>
                    <strong>Quick &amp; Easy</strong>
                    Takes less than 2 mins
                  </span>
                </li>
                <li>
                  <Image
                    src="/assets/quickfurno/icons/trust/location-matching.svg"
                    width={22}
                    height={22}
                    alt=""
                    aria-hidden="true"
                  />
                  <span>
                    <strong>Personalized Matches</strong>
                    Only relevant vendors
                  </span>
                </li>
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
                  <span>Enter Location</span>
                  <input defaultValue="Pune, Maharashtra" />
                </label>
                <label>
                  <span>Describe Requirement</span>
                  <textarea placeholder="e.g. Modular kitchen for 2BHK apartment, modern design..." rows={4} />
                </label>
              </div>

              <EnquiryModalTrigger
                className={styles.matchButton}
                modalTitle="Get matched with verified carpenters"
                serviceCategory="Carpentry"
                city="Pune"
                source="Phase 3B right match card"
              >
                Get Matched Now
              </EnquiryModalTrigger>

              <div className={styles.matchRating}>
                <span>Trusted by homeowners across Pune</span>
                <strong>Verified vendors</strong>
              </div>
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
            source="Phase 3B mobile sticky match CTA"
          >
            Get Matched Now
          </EnquiryModalTrigger>
        </div>
      </main>
      <Footer />
    </>
  );
}
