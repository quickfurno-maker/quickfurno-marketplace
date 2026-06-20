// ============================================================================
// QuickFurno — central config
// Edit the values in this file to change site-wide content. No other file
// needs touching for these.
// ============================================================================

// ---- CHANGE ME: WhatsApp business number (digits only, country code, no +) --
export const WHATSAPP_NUMBER = "91XXXXXXXXXX"; // e.g. "917720000553"
export const WHATSAPP_DEFAULT_MSG =
  "Hi QuickFurno, I'd like to know more about getting quotes for my home project.";

// ---- CHANGE ME: primary city -----------------------------------------------
export const CITY = "Pune";

// ---- CHANGE ME: contact details (footer) -----------------------------------
export const CONTACT = {
  phone: "+91 77200 00553",
  email: "quickfurno@gmail.com",
  address: "Kharadi Annex, Pune, Maharashtra 411014",
};

// ---- Canonical services -----------------------------------------------------
// These power BOTH the homeowner enquiry dropdown and the vendor "services
// offered" picker. The strings must stay identical on both sides so lead↔vendor
// matching works. If you edit a name here, run the service-categories migration
// (supabase/migrations/..._homepage_alignment.sql) to keep the DB in sync.
export const SERVICES = [
  "Full Home Interior",
  "Modular Kitchen",
  "Wardrobe",
  "Carpentry",
  "False Ceiling",
  "Painting",
  "Home Renovation",
  "Custom Furniture",
] as const;

// homeowner dropdown adds a catch-all (vendors never pick "Other")
export const ENQUIRY_SERVICES = [...SERVICES, "Other"] as const;

// ---- Budget & timeline options (stored as text on the lead) ----------------
export const BUDGETS = [
  "Below ₹1 lakh",
  "₹1–3 lakh",
  "₹3–7 lakh",
  "₹7–15 lakh",
  "₹15 lakh+",
] as const;

export const TIMELINES = [
  "Immediately",
  "Within 15 days",
  "Within 1 month",
  "Just exploring",
] as const;

// ---- Service category cards (homepage) -------------------------------------
export const SERVICE_CARDS: { name: string; blurb: string }[] = [
  { name: "Full Home Interior", blurb: "End-to-end design and execution for your whole home." },
  { name: "Modular Kitchen", blurb: "Smart, durable kitchens built to your layout and budget." },
  { name: "Wardrobe", blurb: "Custom wardrobes that fit your space and storage needs." },
  { name: "Carpentry", blurb: "Skilled on-site and bespoke woodwork you can trust." },
  { name: "False Ceiling", blurb: "Clean ceiling designs with concealed lighting options." },
  { name: "Painting", blurb: "Neat, lasting finishes from vetted painting crews." },
  { name: "Home Renovation", blurb: "Refresh or remodel — managed by verified local pros." },
  { name: "Custom Furniture", blurb: "Sofas, beds and units made to your exact taste." },
];

// ---- CHANGE ME: lead-pack pricing preview (marketing display) --------------
// NOTE: these are the marketing preview prices shown on the homepage. The real
// purchasable packs live in the Supabase `packages` table (shown on /pricing).
// Keep them aligned, or update the packages table from admin to match.
export const PACKAGES_PREVIEW: { name: string; price: number; leads: number; tag?: string }[] = [
  { name: "Starter", price: 999, leads: 10 },
  { name: "Growth", price: 2499, leads: 30, tag: "Popular" },
  { name: "Pro", price: 4999, leads: 75 },
];

// ---- Admin lead workflow statuses ------------------------------------------
export const LEAD_STATUSES = [
  "New",
  "Verified",
  "Assigned",
  "Contacted",
  "Converted",
  "Bad Lead",
] as const;
export type LeadWorkflowStatus = (typeof LEAD_STATUSES)[number];

// ---- Analytics hook (wire GA/Meta Pixel here later) ------------------------
export function trackEvent(name: string, props: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  // Placeholder: push to dataLayer so GTM/GA4 can pick it up when added.
  (window as any).dataLayer = (window as any).dataLayer || [];
  (window as any).dataLayer.push({ event: name, ...props });
}
