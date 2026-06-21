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
  description: string;
  imageTone: string;
  /** Vendor-uploaded logo/profile image; when absent the card shows an initials avatar. */
  imageUrl?: string;
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
    description: "Full home interiors, kitchen, wardrobe and premium design execution.",
    startingPrice: "Starting ₹1,250/sq.ft",
  },
  {
    name: "Carpenters",
    icon: "CP",
    description: "Custom furniture, wardrobes, repairs and on-site woodwork.",
    startingPrice: "Starting ₹250/sq.ft",
  },
  {
    name: "Modular Factory",
    icon: "MF",
    description: "Factory-made kitchen, wardrobes and modular furniture.",
    startingPrice: "Starting ₹1,250/sq.ft",
  },
  {
    name: "Premium Interiors",
    icon: "PI",
    description: "Luxury design, premium materials and managed execution.",
    startingPrice: "Starting ₹1,450/sq.ft",
  },
  {
    name: "Sofa",
    icon: "SF",
    description: "Custom sofas, recliners, repairs and upholstery.",
    startingPrice: "Custom pricing",
  },
  {
    name: "Painter",
    icon: "PT",
    description: "Home painting, texture walls and premium finish work.",
    startingPrice: "Starting ₹22/sq.ft",
  },
  {
    name: "Civil Work",
    icon: "CW",
    description: "Renovation, breaking, masonry, tiling and repair work.",
    startingPrice: "Project based",
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
    slug: "hidden-test-vendor",
    businessName: "Hidden Test Vendor",
    city: "Pune",
    category: "Civil Work",
    subCategory: "Test Vendor",
    rating: 3.8,
    reviews: 4,
    rate: "Project based",
    experience: "1 year",
    responseTime: "2 hr",
    activePaidPlan: false,
    verified: false,
    description: "This vendor is intentionally hidden because the paid plan is inactive.",
    imageTone: "civil-reno",
  },
];

export const activePaidVendors = vendors.filter((vendor) => vendor.activePaidPlan);

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

export const whyChooseQuickFurno = [
  "Verified vendors only",
  "Compare transparent rates",
  "View real project images",
  "Get fast response",
  "No obligation",
  "Support after enquiry",
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
    answer: "QuickFurno is designed to match you with up to 4 relevant verified vendors, so you can compare without getting spammed.",
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
    answer: "Client enquiries are shared with a limited set of relevant paid vendors, with the client experience capped around 4 vendor matches.",
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
