// ============================================================================
// QuickFurno — central config
// Edit the values in this file to change site-wide content. No other file
// needs touching for these.
// ============================================================================

// NOTE: WhatsApp links now derive from CONTACT.phone below (see whatsappLink()).
// This constant is kept for backwards-compat; editing it has no effect — change
// CONTACT.phone instead.
export const WHATSAPP_NUMBER = "91XXXXXXXXXX"; // deprecated, unused
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

// Derived, ready-to-use contact links so Call / WhatsApp buttons never ship a
// placeholder number. Edit CONTACT.phone above and these update everywhere.
export const CONTACT_PHONE_DIGITS = CONTACT.phone.replace(/\D/g, ""); // e.g. "917720000553"
export const CONTACT_TEL = `tel:+${CONTACT_PHONE_DIGITS}`;
export function whatsappLink(message: string = WHATSAPP_DEFAULT_MSG) {
  return `https://wa.me/${CONTACT_PHONE_DIGITS}?text=${encodeURIComponent(message)}`;
}

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

// Organised service picker for the homeowner enquiry popup — grouped by the
// marketplace categories shown across the site. Option values stay aligned with
// SERVICES above (plus two natural additions) so lead↔vendor matching keeps working.
export const ENQUIRY_SERVICE_GROUPS: { category: string; options: string[] }[] = [
  { category: "Interior Designers", options: ["Full Home Interior", "False Ceiling"] },
  { category: "Premium Interiors", options: ["Premium Interior Design"] },
  { category: "Modular Factory", options: ["Modular Kitchen", "Wardrobe"] },
  { category: "Carpenters", options: ["Carpentry", "Custom Furniture"] },
  { category: "Sofa", options: ["Custom Sofa & Upholstery"] },
  { category: "Painter", options: ["Painting"] },
  { category: "Civil Work", options: ["Home Renovation"] },
];

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

// ---- Lead distribution model ------------------------------------------------
// One client lead is shared with at most this many vendors. The authoritative
// value at the DB level lives in app_settings.max_vendors_per_lead (configurable
// by admin); these constants keep the app + comparison UI in sync with it.
export const MAX_VENDORS_PER_LEAD = 3;
export const MAX_COMPARE_VENDORS = 3;

// ---- Phase 26A-2C manual assignment limits ---------------------------------
// Auto matching NEVER exceeds NORMAL_PRIMARY_VENDOR_LIMIT. Only admin manual
// recovery mode may add vendors beyond the primary limit, up to the total cap.
export const NORMAL_PRIMARY_VENDOR_LIMIT = 3;
export const ADMIN_MANUAL_TOTAL_VENDOR_LIMIT = 9;
// Temporary startup fallback so interior leads are not stranded when exact
// subcategory vendors are scarce. Disable once supply per subcategory is deep.
export const MANUAL_INTERIOR_FALLBACK_ENABLED = true;

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
