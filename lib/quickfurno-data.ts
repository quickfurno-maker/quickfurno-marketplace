export type QuickFurnoCategory =
  | "Interior Designers"
  | "Carpenters"
  | "Modular Factory"
  | "Premium Interiors"
  | "Sofa"
  | "Painter"
  | "Civil Work";

export type QualityLevel = "Budget" | "Standard" | "Premium";

export type Vendor = {
  slug: string;
  businessName: string;
  city: "Pune" | "Mumbai";
  category: QuickFurnoCategory;
  subCategory: string;
  rating: number;
  reviews: number;
  rate: string;
  experience: string;
  responseTime: string;
  activePaidPlan: boolean;
  verified: boolean;
  featured?: boolean;
  status?: "active" | "inactive" | "disabled";
  planPriority?: number;
  responseScore?: number;
  description: string;
  imageTone: string;
  /** Vendor-uploaded logo/profile image; when absent the card shows an initials avatar. */
  imageUrl?: string;
  /** Approved cover/hero image for the public profile, if provided. */
  coverImageUrl?: string;
  /** Origin of this record. "supabase" = real vendor row; "static"/undefined = demo catalog.
   *  The profile page uses this to avoid showing static/demo content for real vendors. */
  source?: "supabase" | "static";
  /** Real, canonical public service categories the vendor provides (Supabase only; may be []). */
  serviceCategories?: string[];
  /** Approved public business hours (Supabase only; optional). */
  businessHours?: string | null;
  /** Approved public service area summary (Supabase only; optional). */
  serviceAreaSummary?: string | null;
  /** Real vendor-uploaded portfolio image URLs (Supabase only; may be []). */
  portfolioImages?: string[];
};

export type VendorServiceChip = {
  label: string;
  price: string;
};

export const brandName = "QuickFurno";

export const cities = ["Pune", "Mumbai"] as const;

export const categories: Array<{
  name: QuickFurnoCategory;
  icon: string;
  description: string;
  startingPrice: string;
}> = [
  {
    name: "Interior Designers",
    icon: "ID",
    description: "Complete home interiors, space planning and execution support.",
    startingPrice: "Starting ₹1,499/sq.ft",
  },
  {
    name: "Carpenters",
    icon: "CP",
    description: "Custom furniture, wardrobes, storage and on-site woodwork.",
    startingPrice: "Starting ₹450/sq.ft",
  },
  {
    name: "Modular Factory",
    icon: "MF",
    description: "Machine-finish kitchens, wardrobes and factory-made furniture.",
    startingPrice: "Starting ₹1,250/sq.ft",
  },
  {
    name: "Premium Interiors",
    icon: "PI",
    description: "High-end materials, premium finish and managed execution.",
    startingPrice: "Starting ₹2,499/sq.ft",
  },
  {
    name: "Sofa",
    icon: "SF",
    description: "Custom sofa makers, recliners and upholstery vendors.",
    startingPrice: "Starting ₹18,000",
  },
  {
    name: "Painter",
    icon: "PT",
    description: "Interior painting, texture walls and waterproofing support.",
    startingPrice: "Starting ₹12/sq.ft",
  },
  {
    name: "Civil Work",
    icon: "CW",
    description: "Renovation, false ceiling, POP, tiling and repair work.",
    startingPrice: "Starting site inspection",
  },
];

export const vendorFilterCategories = ["All", ...categories.map((category) => category.name)] as const;

/** URL-safe slug for a category name, e.g. "Interior Designers" -> "interior-designers". */
export function categorySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getCategoryBySlug(slug: string) {
  return categories.find((category) => categorySlug(category.name) === slug);
}

export const vendors: Vendor[] = [
  {
    slug: "raj-premium-interiors",
    businessName: "Raj Premium Interiors",
    city: "Pune",
    category: "Interior Designers",
    subCategory: "Premium Interiors",
    rating: 4.8,
    reviews: 118,
    rate: "₹1,450/sq.ft",
    experience: "8 years",
    responseTime: "15 min",
    activePaidPlan: true,
    verified: true,
    featured: true,
    description: "Premium design execution for elegant homes, kitchens and wardrobes.",
    imageTone: "warm-suite",
  },
  {
    slug: "kharadi-modular-factory",
    businessName: "Kharadi Modular Factory",
    city: "Pune",
    category: "Modular Factory",
    subCategory: "Kitchen & Wardrobe",
    rating: 4.7,
    reviews: 96,
    rate: "₹1,250/sq.ft",
    experience: "10 years",
    responseTime: "20 min",
    activePaidPlan: true,
    verified: true,
    featured: true,
    description: "Factory-made modular kitchens and wardrobes with clean installation.",
    imageTone: "kitchen-line",
  },
  {
    slug: "mumbai-carpenter-pro",
    businessName: "Mumbai Carpenter Pro",
    city: "Mumbai",
    category: "Carpenters",
    subCategory: "Custom Woodwork",
    rating: 4.6,
    reviews: 82,
    rate: "₹950/sq.ft",
    experience: "7 years",
    responseTime: "30 min",
    activePaidPlan: true,
    verified: true,
    description: "On-site carpentry, wardrobes, storage and custom woodwork.",
    imageTone: "wood-craft",
  },
  {
    slug: "elite-sofa-works",
    businessName: "Elite Sofa Works",
    city: "Pune",
    category: "Sofa",
    subCategory: "Custom Sofa & Recliner",
    rating: 4.5,
    reviews: 64,
    rate: "Custom pricing",
    experience: "9 years",
    responseTime: "1 hr",
    activePaidPlan: true,
    verified: true,
    description: "Custom sofas, recliners, fabric selection and upholstery repair.",
    imageTone: "sofa-studio",
  },
  {
    slug: "perfect-paint-studio",
    businessName: "Perfect Paint Studio",
    city: "Mumbai",
    category: "Painter",
    subCategory: "Premium Painting",
    rating: 4.7,
    reviews: 103,
    rate: "₹22/sq.ft",
    experience: "6 years",
    responseTime: "25 min",
    activePaidPlan: true,
    verified: true,
    description: "Premium wall finishes, textures, repainting and managed painting work.",
    imageTone: "paint-finish",
  },
  {
    slug: "buildright-civil-works",
    businessName: "BuildRight Civil Works",
    city: "Pune",
    category: "Civil Work",
    subCategory: "Renovation & Repair",
    rating: 4.6,
    reviews: 71,
    rate: "Project based",
    experience: "12 years",
    responseTime: "1 hr",
    activePaidPlan: true,
    verified: true,
    description: "Civil renovation, tiling, masonry, breaking and repair execution.",
    imageTone: "civil-reno",
  },
  {
    slug: "pune-civil-repair-co",
    businessName: "Pune Civil Repair Co.",
    city: "Pune",
    category: "Civil Work",
    subCategory: "Renovation Repair",
    rating: 4.2,
    reviews: 18,
    rate: "Project based",
    experience: "5 years",
    responseTime: "2 hr",
    activePaidPlan: false,
    verified: true,
    description: "Civil repair, waterproofing, tiles and compact renovation work.",
    imageTone: "civil-reno",
  },
  {
    slug: "baner-home-interiors",
    businessName: "Baner Home Interiors",
    city: "Pune",
    category: "Interior Designers",
    subCategory: "Budget Interiors",
    rating: 4.3,
    reviews: 24,
    rate: "Price on request",
    experience: "4 years",
    responseTime: "3 hr",
    activePaidPlan: false,
    verified: true,
    description: "Practical home interiors, storage planning and phased execution support.",
    imageTone: "warm-suite",
  },
  {
    slug: "thane-woodcraft-studio",
    businessName: "Thane Woodcraft Studio",
    city: "Mumbai",
    category: "Carpenters",
    subCategory: "Wardrobe & Storage",
    rating: 4.1,
    reviews: 15,
    rate: "Price on request",
    experience: "6 years",
    responseTime: "4 hr",
    activePaidPlan: false,
    verified: true,
    description: "Custom wardrobes, TV units and repair carpentry for apartments.",
    imageTone: "wood-craft",
  },
];

const vendorListingMeta: Record<
  string,
  { locality: string; distance: string; openStatus: string; trustSignals: string[] }
> = {
  "raj-premium-interiors": {
    locality: "Kharadi, Pune",
    distance: "2.4 km",
    openStatus: "Open till 9:00 pm",
    trustSignals: ["Verified", "Top rated", "High response", "Background checked"],
  },
  "kharadi-modular-factory": {
    locality: "Kharadi, Pune",
    distance: "3.1 km",
    openStatus: "Responds in 20 min",
    trustSignals: ["Verified", "Factory finish", "High response"],
  },
  "mumbai-carpenter-pro": {
    locality: "Andheri, Mumbai",
    distance: "4.8 km",
    openStatus: "Responds in 30 min",
    trustSignals: ["Verified", "Top rated", "High response"],
  },
  "elite-sofa-works": {
    locality: "Wakad, Pune",
    distance: "5.2 km",
    openStatus: "Available today",
    trustSignals: ["Verified", "Custom work", "High response"],
  },
  "perfect-paint-studio": {
    locality: "Borivali, Mumbai",
    distance: "6.0 km",
    openStatus: "Open till 8:30 pm",
    trustSignals: ["Verified", "Top rated", "Site visit"],
  },
  "buildright-civil-works": {
    locality: "Baner, Pune",
    distance: "4.1 km",
    openStatus: "Responds in 1 hr",
    trustSignals: ["Verified", "Background checked", "Site visit"],
  },
  "pune-civil-repair-co": {
    locality: "Hadapsar, Pune",
    distance: "7.3 km",
    openStatus: "Available today",
    trustSignals: ["Verified", "Budget friendly", "Site visit"],
  },
  "baner-home-interiors": {
    locality: "Baner, Pune",
    distance: "4.4 km",
    openStatus: "Responds in 3 hr",
    trustSignals: ["Verified", "Budget friendly", "Local team"],
  },
  "thane-woodcraft-studio": {
    locality: "Thane, Mumbai",
    distance: "8.2 km",
    openStatus: "Available tomorrow",
    trustSignals: ["Verified", "Budget friendly", "Local team"],
  },
};

const serviceChipMap: Record<QuickFurnoCategory, VendorServiceChip[]> = {
  "Interior Designers": [
    { label: "Modular Kitchen", price: "Rs.1,500/sq.ft" },
    { label: "Wardrobe", price: "Rs.1,200/sq.ft" },
    { label: "Interior Design", price: "Consultation" },
    { label: "False Ceiling", price: "Rs.140/sq.ft" },
  ],
  Carpenters: [
    { label: "Wardrobe", price: "Rs.950/sq.ft" },
    { label: "TV Unit", price: "Price on request" },
    { label: "Custom Furniture", price: "Site based" },
    { label: "Repair Work", price: "Visit based" },
  ],
  "Modular Factory": [
    { label: "Modular Kitchen", price: "Rs.1,250/sq.ft" },
    { label: "Wardrobe", price: "Rs.1,100/sq.ft" },
    { label: "Factory Finish", price: "Premium" },
  ],
  "Premium Interiors": [
    { label: "Full Home", price: "Rs.2,499/sq.ft" },
    { label: "Luxury Kitchen", price: "Premium" },
    { label: "Designer Wardrobe", price: "Premium" },
  ],
  Sofa: [
    { label: "Custom Sofa", price: "Rs.18,000 onwards" },
    { label: "Recliner", price: "Price on request" },
    { label: "Upholstery", price: "Visit based" },
  ],
  Painter: [
    { label: "Interior Painting", price: "Rs.22/sq.ft" },
    { label: "Texture Wall", price: "Price on request" },
    { label: "Waterproofing", price: "Site based" },
  ],
  "Civil Work": [
    { label: "Home Renovation", price: "Project based" },
    { label: "Tiling", price: "Site based" },
    { label: "Waterproofing", price: "Visit based" },
    { label: "False Ceiling", price: "Price on request" },
  ],
};

export function isVendorVisible(vendor: Vendor) {
  return vendor.status !== "inactive" && vendor.status !== "disabled";
}

export function isVendorPubliclyVisible(
  vendor: Vendor,
  options: { showFreeVendorsPublicly?: boolean } = {},
) {
  if (!isVendorVisible(vendor)) return false;
  if (vendor.activePaidPlan) return true;
  return options.showFreeVendorsPublicly !== false;
}

export function vendorResponseScore(vendor: Vendor) {
  if (typeof vendor.responseScore === "number") return vendor.responseScore;
  const hours = /(\d+)\s*hr/i.exec(vendor.responseTime)?.[1];
  const minutes = /(\d+)\s*min/i.exec(vendor.responseTime)?.[1];
  if (minutes) return Math.max(60, 100 - Number(minutes));
  if (hours) return Math.max(20, 70 - Number(hours) * 10);
  return 55;
}

export function rankVendors(vendorList: Vendor[], options: { showFreeVendorsPublicly?: boolean } = {}) {
  return [...vendorList].filter((vendor) => isVendorPubliclyVisible(vendor, options)).sort((a, b) => {
    if (Number(b.activePaidPlan) !== Number(a.activePaidPlan)) {
      return Number(b.activePaidPlan) - Number(a.activePaidPlan);
    }
    const planDelta = (b.planPriority ?? (b.featured ? 30 : 20)) - (a.planPriority ?? (a.featured ? 30 : 20));
    if (planDelta !== 0) return planDelta;
    if (b.rating !== a.rating) return b.rating - a.rating;
    const responseDelta = vendorResponseScore(b) - vendorResponseScore(a);
    if (responseDelta !== 0) return responseDelta;
    return b.reviews - a.reviews;
  });
}

export function getVisibleVendors(options: { showFreeVendorsPublicly?: boolean } = {}) {
  return rankVendors(vendors, options);
}

export const visibleVendors = getVisibleVendors();
export const activePaidVendors = visibleVendors.filter((vendor) => vendor.activePaidPlan);

export function getVendorBySlug(slug: string, options: { showFreeVendorsPublicly?: boolean } = {}) {
  return getVisibleVendors(options).find((vendor) => vendor.slug === slug);
}

export function getVendorsByCategory(category?: QuickFurnoCategory, options: { showFreeVendorsPublicly?: boolean } = {}) {
  return rankVendors(category ? vendors.filter((vendor) => vendor.category === category) : vendors, options);
}

export function getVendorListingMeta(vendor: Vendor) {
  return vendorListingMeta[vendor.slug] ?? {
    locality: vendor.city,
    distance: "Nearby",
    openStatus: `Responds in ${vendor.responseTime}`,
    trustSignals: vendor.verified ? ["Verified", "Local team"] : ["Local team"],
  };
}

export function getVendorServiceChips(vendor: Vendor) {
  const chips = serviceChipMap[vendor.category] ?? [];
  if (!chips.some((chip) => chip.price === vendor.rate)) {
    return [{ label: vendor.subCategory, price: vendor.rate }, ...chips];
  }
  return chips;
}

// ---------------------------------------------------------------------------
// Scannable vendor card support — portfolio imagery + safe trust fallbacks.
// All images are existing LOCAL assets under /public (no external URLs).
// No database changes: derived display values only.
// ---------------------------------------------------------------------------
const VENDOR_IMG = "/assets/quickfurno/images/vendors";

const portfolioByCategory: Record<QuickFurnoCategory, string[]> = {
  "Interior Designers": [`${VENDOR_IMG}/premium-living-room.svg`, `${VENDOR_IMG}/office-interior.svg`, `${VENDOR_IMG}/modular-kitchen.svg`],
  "Premium Interiors": [`${VENDOR_IMG}/premium-living-room.svg`, `${VENDOR_IMG}/office-interior.svg`, `${VENDOR_IMG}/wardrobe-interior.svg`],
  "Modular Factory": [`${VENDOR_IMG}/modular-kitchen.svg`, `${VENDOR_IMG}/wardrobe-interior.svg`, `${VENDOR_IMG}/wood-shelving.svg`],
  Carpenters: [`${VENDOR_IMG}/wood-shelving.svg`, `${VENDOR_IMG}/wardrobe-interior.svg`, `${VENDOR_IMG}/modular-kitchen.svg`],
  Sofa: [`${VENDOR_IMG}/premium-living-room.svg`, `${VENDOR_IMG}/office-interior.svg`, `${VENDOR_IMG}/wardrobe-interior.svg`],
  Painter: [`${VENDOR_IMG}/premium-living-room.svg`, `${VENDOR_IMG}/office-interior.svg`, `${VENDOR_IMG}/civil-work-site.svg`],
  "Civil Work": [`${VENDOR_IMG}/civil-work-site.svg`, `${VENDOR_IMG}/modular-kitchen.svg`, `${VENDOR_IMG}/wood-shelving.svg`],
};

/** Up to 3 local portfolio thumbnails for a vendor's category (safe fallback: []). */
export function getVendorPortfolio(vendor: Vendor): string[] {
  return portfolioByCategory[vendor.category] ?? [];
}

export type VendorTrust = {
  rating: number;
  ratingLabel: string;
  responseLabel: string;
  responseScore: number;
  experienceLabel: string;
  warrantyLabel: string;
  warrantyYears: number;
  startingPrice: string;
  /** Numeric starting price for comparison, or null when "Price on request". */
  priceValue: number | null;
};

/** Display-ready trust snippets with safe fallbacks (PART 4 of the redesign brief). */
export function getVendorTrust(vendor: Vendor): VendorTrust {
  const rating = vendor.rating > 0 ? vendor.rating : 4.7;
  const responseTime = vendor.responseTime?.trim();
  const responseLabel = responseTime ? `Responds in ${responseTime}` : "Responds in 15 min";
  const expNum = /(\d+)/.exec(vendor.experience ?? "")?.[1];
  const experienceLabel = expNum ? `${expNum}+ years` : "5+ years";
  const warrantyYears = vendor.activePaidPlan ? 10 : 0;
  const warrantyLabel = vendor.activePaidPlan ? "Up to 10 years warranty" : "Warranty available";

  const rate = vendor.rate?.trim() ?? "";
  const hasPrice = /\d/.test(rate) && !/request/i.test(rate);
  const startingPrice = hasPrice ? `Starting at ${rate.startsWith("₹") ? rate : `₹${rate}`}` : "Price on request";
  const parsed = hasPrice ? Number(rate.replace(/[^\d.]/g, "")) : NaN;
  const priceValue = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

  return {
    rating,
    ratingLabel: rating.toFixed(1),
    responseLabel,
    responseScore: vendorResponseScore(vendor),
    experienceLabel,
    warrantyLabel,
    warrantyYears,
    startingPrice,
    priceValue,
  };
}

export function enquiryServiceForCategory(category: QuickFurnoCategory) {
  const map: Record<QuickFurnoCategory, string> = {
    "Interior Designers": "Full Home Interior",
    Carpenters: "Carpentry",
    "Modular Factory": "Modular Kitchen",
    "Premium Interiors": "Premium Interior Design",
    Sofa: "Custom Sofa & Upholstery",
    Painter: "Painting",
    "Civil Work": "Home Renovation",
  };
  return map[category];
}

export const pricingMatrix: Record<Exclude<QuickFurnoCategory, "Sofa">, Record<QualityLevel, number>> = {
  "Interior Designers": { Budget: 950, Standard: 1250, Premium: 1800 },
  Carpenters: { Budget: 750, Standard: 950, Premium: 1300 },
  "Modular Factory": { Budget: 1000, Standard: 1250, Premium: 1650 },
  "Premium Interiors": { Budget: 1500, Standard: 1800, Premium: 2400 },
  Painter: { Budget: 18, Standard: 22, Premium: 35 },
  "Civil Work": { Budget: 800, Standard: 1100, Premium: 1500 },
};

export const portfolioProjects = [
  ["Warm Living Room Interior", "Raj Premium Interiors", "Interior Designers", "Pune"],
  ["Minimal Modular Kitchen", "Kharadi Modular Factory", "Modular Factory", "Pune"],
  ["Custom Wardrobe Wall", "Mumbai Carpenter Pro", "Carpenters", "Mumbai"],
  ["Premium Bedroom Suite", "Raj Premium Interiors", "Premium Interiors", "Pune"],
  ["Soft Neutral Sofa Set", "Elite Sofa Works", "Sofa", "Pune"],
  ["Texture Wall Makeover", "Perfect Paint Studio", "Painter", "Mumbai"],
  ["Civil Renovation Work", "BuildRight Civil Works", "Civil Work", "Pune"],
  ["Compact Kitchen Upgrade", "Kharadi Modular Factory", "Modular Factory", "Pune"],
  ["False Ceiling Detail", "Raj Premium Interiors", "Interior Designers", "Pune"],
  ["Family Lounge Sofa", "Elite Sofa Works", "Sofa", "Pune"],
  ["Full Home Turnkey", "Raj Premium Interiors", "Premium Interiors", "Pune"],
  ["Wood Panel Storage", "Mumbai Carpenter Pro", "Carpenters", "Mumbai"],
  ["Dining Wall Finish", "Perfect Paint Studio", "Painter", "Mumbai"],
  ["Bathroom Civil Repair", "BuildRight Civil Works", "Civil Work", "Pune"],
  ["Luxury Kitchen Island", "Kharadi Modular Factory", "Modular Factory", "Pune"],
  ["Kids Room Wardrobe", "Mumbai Carpenter Pro", "Carpenters", "Mumbai"],
  ["Premium TV Unit", "Raj Premium Interiors", "Interior Designers", "Pune"],
  ["Elegant Recliner Set", "Elite Sofa Works", "Sofa", "Pune"],
  ["Exterior Repaint", "Perfect Paint Studio", "Painter", "Mumbai"],
  ["Home Renovation Shell", "BuildRight Civil Works", "Civil Work", "Pune"],
].map(([title, vendorName, category, city], index) => ({
  id: index + 1,
  title,
  vendorName,
  category: category as QuickFurnoCategory,
  city,
  imageTone: ["warm-suite", "kitchen-line", "wood-craft", "sofa-studio", "paint-finish", "civil-reno"][index % 6],
}));

export const whyChooseQuickFurno: { title: string; body: string }[] = [
  {
    title: "Verified vendors only",
    body: "Every listed vendor is checked for service category, location, response quality and profile completeness.",
  },
  {
    title: "Maximum 3 quotes",
    body: "We do not send your number to 20 vendors. You get a limited set of relevant verified vendors.",
  },
  {
    title: "Transparent rates",
    body: "View starting rates before speaking to vendors, so you can compare with confidence.",
  },
  {
    title: "No spam promise",
    body: "Your enquiry is shared only with selected vendors matching your city and requirement.",
  },
  {
    title: "Local network",
    body: "Start with Pune and Mumbai vendors who understand local pricing and execution.",
  },
  {
    title: "Better comparison",
    body: "Compare rates, ratings, response time, service areas and experience in one place.",
  },
];

export const clientTestimonials = [
  {
    quote: "QuickFurno helped us shortlist interior teams quickly. We compared rates and picked a vendor with confidence.",
    name: "Ananya Kulkarni",
    detail: "Full home interior client, Pune",
  },
  {
    quote: "I needed carpentry work for wardrobes. The response was fast and the profiles were much clearer than random calls.",
    name: "Rohit Mehta",
    detail: "Carpentry client, Mumbai",
  },
  {
    quote: "The painting quote process was simple. I could understand per sq.ft rates before speaking to the vendor.",
    name: "Priya Shah",
    detail: "Painting client, Mumbai",
  },
  {
    quote: "We received modular kitchen options in a day and could see project examples before deciding.",
    name: "Saurabh Patil",
    detail: "Modular kitchen client, Pune",
  },
];

export const clientFaqs = [
  {
    question: "Is QuickFurno free for clients?",
    answer: "Yes. Clients can submit requirements and get matched with verified vendors without paying QuickFurno.",
  },
  {
    question: "How many vendors will contact me?",
    answer: "QuickFurno is designed to match you with up to 3 relevant verified vendors, so you can compare without getting spammed.",
  },
  {
    question: "Are vendors verified?",
    answer: "Vendors are reviewed for business details, category fit, project work and response quality before they are shown to clients.",
  },
  {
    question: "Can I compare per sq.ft rates?",
    answer: "Yes. Vendor cards show starting rates wherever available, along with ratings, reviews, city and experience.",
  },
  {
    question: "Which cities are available?",
    answer: "QuickFurno is focused on Pune and Mumbai for the MVP launch.",
  },
  {
    question: "Can I book interior designer and carpenter separately?",
    answer: "Yes. You can choose individual categories such as Interior Designers, Carpenters, Modular Factory, Painter, Sofa and Civil Work.",
  },
];

export const vendorFaqs = [
  {
    question: "How much does one lead cost?",
    answer: "The MVP Starter Plan is structured at ₹250 per lead with a 5 lead package for ₹1,250.",
  },
  {
    question: "How many vendors receive one lead?",
    answer: "Client enquiries are shared with a limited set of relevant paid vendors, with the client experience capped at 3 vendor matches.",
  },
  {
    question: "How do I receive leads?",
    answer: "Lead alerts are planned through WhatsApp and the vendor dashboard, with call and WhatsApp actions available for each assigned lead.",
  },
  {
    question: "Can I upload project images?",
    answer: "Yes. The profile structure is prepared for project galleries and future Supabase Storage image uploads.",
  },
  {
    question: "How do I renew package?",
    answer: "The vendor dashboard preview includes package status and renewal actions for the future vendor app flow.",
  },
  {
    question: "Can I choose city and category?",
    answer: "Yes. Vendor onboarding captures city, service category, sub-category, rate and experience.",
  },
];
