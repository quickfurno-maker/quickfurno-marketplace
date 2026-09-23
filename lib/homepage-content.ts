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
    q: "Is it free to send an enquiry?",
    a: "Yes. QuickFurno does not charge a homeowner fee to submit an enquiry.",
  },
  {
    q: "How does the matching work?",
    a: "QuickFurno can assign up to 3 active pros at a time. Category eligibility comes first; approved ranking signals such as geography and fairness determine order when authoritative data is available.",
  },
  {
    q: "Which vendors appear publicly?",
    a: "Only approved, active vendors that pass QuickFurno's public-listing controls appear as active listings. Pending, rejected, suspended or hidden profiles are not shown as active public vendors.",
  },
  {
    q: "Which Pune localities can I select?",
    a: "The launch surface lists common Pune-area localities for enquiry context. A listed locality is not a guarantee of matching supply.",
  },
  {
    q: "Am I obligated to hire someone after enquiring?",
    a: "No. You can review any profiles or quotes you receive and decide whether to proceed. Submitting an enquiry does not obligate you to hire.",
  },
  {
    q: "What kind of work can I enquire about?",
    a: "QuickFurno's launch categories include interiors, modular work, carpentry, sofas and upholstery, painting, civil work and false ceilings. Availability varies by marketplace supply and eligibility.",
  },
];

export type Testimonial = { quote: string; name: string; detail: string };

// Real homeowner quotes only — see honesty rules above.
export const TESTIMONIALS: Testimonial[] = [];
