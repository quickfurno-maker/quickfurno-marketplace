// ============================================================================
// QuickFurno final operating principle.
//
// QuickFurno is a lead-generation marketplace. It owns lead capture, quality,
// matching, assignment/delivery, credit correctness and lead-validity disputes.
// Its operational responsibility ends after a Core-approved quality lead is
// delivered plus the bounded connection-assurance loop defined below.
// ============================================================================

export const QUICKFURNO_LEAD_GENERATION_BOUNDARY = Object.freeze({
  responsibilityEndsAt: "delivery_plus_bounded_connection_assurance",
  postDeliveryCommercialManagement: false,
  quickFurnoOwns: Object.freeze([
    "lead_capture",
    "lead_validation",
    "consent_and_quality_gates",
    "clarification_for_quality",
    "vendor_matching_and_assignment",
    "verified_vendor_lead_delivery",
    "bounded_connection_assurance",
    "credit_correctness",
    "lead_validity_and_replacement_disputes",
    "platform_support_and_audit",
  ] as const),
  connectionAssurance: Object.freeze({
    vendorResponseWindowHours: 24,
    vendorOutcomeSet: Object.freeze(["responded", "no_response"] as const),
    maxClientAutomatedMessages: 5,
    clientReminderCadenceHours: 24,
    riyaEscalationAfterUnansweredMessages: 5,
    salesStageTracking: false,
  }),
  vendorClientOwns: Object.freeze([
    "commercial_follow_up",
    "site_visit",
    "quotation",
    "negotiation",
    "sale_or_conversion",
    "project_execution",
    "commercial_outcome",
    "client_vendor_payment",
  ] as const),
} as const);

export const LEGACY_POST_DELIVERY_COMMERCIAL_LEAD_STATUSES = Object.freeze([
  "Contacted",
  "Site Visit Scheduled",
  "Quotation Sent",
  "Converted",
  "Won",
  "Lost",
] as const);

export const LEGACY_VENDOR_SALES_STATUSES = Object.freeze([
  "Contacted",
  "Follow-up Needed",
  "Site Visit Scheduled",
  "Quotation Sent",
  "Converted",
  "Won",
  "Lost",
] as const);

const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();

export function isLegacyPostDeliveryCommercialLeadStatus(value: unknown): boolean {
  const candidate = normalize(value);
  return LEGACY_POST_DELIVERY_COMMERCIAL_LEAD_STATUSES.some(
    (status) => status.toLowerCase() === candidate,
  );
}

export function isLegacyVendorSalesStatus(value: unknown): boolean {
  const candidate = normalize(value);
  return LEGACY_VENDOR_SALES_STATUSES.some(
    (status) => status.toLowerCase() === candidate,
  );
}

export const QUICKFURNO_ACTIVE_ADMIN_LEAD_STATUSES = Object.freeze([
  "New",
  "Verified",
  "Quality Checked",
  "Clarification Required",
  "Hot Lead",
  "Nurture",
  "Rejected Quality",
  "Duplicate",
  "Bad Lead",
  "Assigned",
] as const);
