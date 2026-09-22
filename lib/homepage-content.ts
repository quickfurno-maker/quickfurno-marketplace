// ============================================================================
// QuickFurno — lib/homepage-content.ts
//
// Launch-ready homepage content: verification steps, Pune areas, FAQ and
// homeowner testimonials. Kept in one file so copy edits never require
// touching component code.
//
// HONESTY RULES (same standard as QF-UI-V2):
//   • No invented statistics, ratings, review counts or vendor claims.
//   • TESTIMONIALS must only contain quotes from real homeowners. Do not add
//     fictional names or quotes. If there is only one real quote, the section
//     renders one.
// ============================================================================

export type VerifyStep = { icon: "shield" | "search" | "user" | "chat"; title: string; body: string };

export const VERIFY_STEPS: VerifyStep[] = [
  {
    icon: "user",
    title: "Business identity check",
    body: "Every vendor applies with their real business details, which the QuickFurno team reviews before the profile can appear publicly.",
  },
  {
    icon: "search",
    title: "Work profile review",
    body: "We look at the vendor's services, experience and work photos so their public profile reflects what they actually do.",
  },
  {
    icon: "shield",
    title: "Approved before listing",
    body: "Only approved, active vendors are shown. Pending, rejected or suspended vendors never appear in listings or matches.",
  },
  {
    icon: "chat",
    title: "Local support team",
    body: "A Pune-based team stays reachable on WhatsApp and email throughout your project.",
  },
];

// Localities QuickFurno serves across Pune & PCMC. Display text only.
export const PUNE_AREAS: string[] = [
  // First 11 are shown by default on the homepage (see PuneLaunchHomepage).
  "Kharadi",
  "Viman Nagar",
  "Koregaon Park",
  "Baner",
  "Wakad",
  "Hinjewadi",
  "Magarpatta",
  "Kothrud",
  "Aundh",
  "Hadapsar",
  "Pimpri-Chinchwad",
  "Kalyani Nagar",
  "Wagholi",
  "Pimple Saudagar",
  "Bavdhan",
  "Warje",
  "Sinhagad Road",
  "Undri",
  "NIBM",
  "Ravet",
];

export type FaqItem = { q: string; a: string };

export const HOME_FAQ: FaqItem[] = [
  {
    q: "Is QuickFurno really free for homeowners?",
    a: "Yes. Sending an enquiry and getting matched costs you nothing. You pay your chosen vendor directly for the work — QuickFurno does not add any charge on top.",
  },
  {
    q: "How does the matching work?",
    a: "You tell us your service, area and budget once. We connect you with up to 3 relevant verified professionals in Pune, and you compare their profiles and deal with them directly.",
  },
  {
    q: "How are vendors verified?",
    a: "Every vendor's business details and work profile are reviewed by the QuickFurno team, and only approved, active vendors appear publicly. Pending or suspended vendors are never shown.",
  },
  {
    q: "Which areas of Pune do you cover?",
    a: "QuickFurno covers localities across Pune and PCMC — including Kharadi, Baner, Wakad, Hinjewadi, Kothrud, Viman Nagar, Hadapsar and more.",
  },
  {
    q: "Am I obligated to hire someone after enquiring?",
    a: "No. You compare the matched profiles and quotes, and you decide. If none fits, you are free to walk away — there is no fee and no obligation.",
  },
  {
    q: "What kind of work can I get done?",
    a: "Complete home interiors, modular kitchens and wardrobes, custom carpentry, sofas and upholstery, painting, and civil or renovation work — all through verified Pune professionals.",
  },
];

export type Testimonial = { quote: string; name: string; detail: string };

// Real homeowner quotes only — see honesty rules above.
export const TESTIMONIALS: Testimonial[] = [
  {
    quote: "QuickFurno made it easy to compare relevant local professionals for our home project.",
    name: "Priya Singh",
    detail: "Homeowner · Megapolis, Hinjewadi, Pune",
  },
];
