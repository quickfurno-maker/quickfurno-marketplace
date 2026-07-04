// ============================================================================
// QuickFurno Lead Quality Engine - Phase 1 Hybrid Gate
// Rule-based scoring only. No OTP, AI, WhatsApp sending, n8n decisions, or
// vendor assignment happens here.
// ============================================================================
import { adminClient } from "../lib/supabase";

export type LeadScoreClass = "A+" | "A" | "B" | "C" | "D";

export type LeadQualityRecommendedAction =
  | "auto_distribute"
  | "clarification_required"
  | "nurture"
  | "reject_or_manual_review"
  | "duplicate_no_bill"
  | "consent_required_no_distribution"
  | "invalid_phone_no_distribution"
  | "manual_review_suspicious_name";

export type LeadQualityInput = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  area?: string | null;
  locality?: string | null;
  address?: string | null;
  // Structured Google/location evidence (Phase 1). Replaces the retired pincode
  // signal; used only to award the structured-location-detail location point.
  // NOTE: `area_normalized` is intentionally NOT a qualifying signal (it can be
  // set from manually typed area text); it is kept here only to accept the field.
  latitude?: number | null;
  longitude?: number | null;
  google_place_id?: string | null;
  formatted_address?: string | null;
  area_normalized?: string | null;
  sublocality?: string | null;
  neighborhood?: string | null;
  location_source?: string | null;
  service_required?: string | null;
  service_category?: string | null;
  serviceCategory?: string | null;
  category?: string | null;
  subcategory?: string | null;
  budget?: string | null;
  budget_range?: string | null;
  budgetRange?: string | null;
  property_type?: string | null;
  timeline?: string | null;
  message?: string | null;
  requirement?: string | null;
  share_consent?: boolean | null;
  location_consent?: boolean | null;
  is_duplicate?: boolean | null;
  lead_intent?: string | null;
  serviceable_city?: boolean | null;
};

export type LeadQualityScoreResult = {
  contact_score: number;
  location_score: number;
  requirement_score: number;
  intent_score: number;
  fraud_penalty: number;
  total_score: number;
  score_class: LeadScoreClass;
  hard_block_reason: string | null;
  recommended_action: LeadQualityRecommendedAction;
  score_breakdown: Record<string, unknown>;
};

export type LeadQualityDecision = {
  canAutoDistribute: boolean;
  leadQualityStatus: string;
  leadStatus: string;
  verificationStatus: "Quality Checked" | "Manual Review" | "Rejected Quality";
  recommendedAction: LeadQualityRecommendedAction;
  hardBlockReason: string | null;
};

const FAKE_NAME_RE = /\b(test|demo|abc|xyz|random|dummy|sample|asdf|qwerty|unknown)\b/i;
const SPAM_WORD_RE = /\b(lorem ipsum|asdf|qwerty|spam|fake lead|test lead|dummy|random text)\b/i;

export function classifyLeadScore(totalScore: number): LeadScoreClass {
  if (totalScore >= 85) return "A+";
  if (totalScore >= 70) return "A";
  if (totalScore >= 50) return "B";
  if (totalScore >= 30) return "C";
  return "D";
}

export function calculateLeadQuality(input: LeadQualityInput): LeadQualityScoreResult {
  const name = firstText(input.name);
  const phone = firstText(input.phone);
  const email = firstText(input.email);
  const city = firstText(input.city);
  const area = firstText(input.area, input.locality);
  const service = firstText(input.service_required, input.service_category, input.serviceCategory, input.category);
  const subcategory = firstText(input.subcategory);
  const budget = firstText(input.budget, input.budget_range, input.budgetRange);
  const timeline = firstText(input.timeline);
  const message = firstText(input.message, input.requirement);
  // Structured, TRUSTWORTHY location evidence (Phase 1) — replaces the retired
  // pincode/free-text-address signal. Awarded ONLY for Google/GPS-backed data.
  // IMPORTANT: `area_normalized` is deliberately excluded — a manual area entry
  // sets it from the client's own typed text, which is NOT trustworthy evidence.
  // Qualifying signals: a Google place id, valid coordinates, a Google formatted
  // address, Google-derived sublocality/neighborhood, or a location_source that
  // is google_place / browser_gps. NOT pincode, NOT arbitrary text.
  const validLat = typeof input.latitude === "number" && Number.isFinite(input.latitude);
  const validLng = typeof input.longitude === "number" && Number.isFinite(input.longitude);
  const locationSource = String(input.location_source ?? "").trim().toLowerCase();
  const trustedLocationSource = locationSource === "google_place" || locationSource === "browser_gps";
  const structuredLocationDetail = Boolean(
    firstText(input.google_place_id) ||
      (validLat && validLng) ||
      firstText(input.formatted_address) ||
      firstText(input.sublocality) ||
      firstText(input.neighborhood) ||
      trustedLocationSource,
  );
  const isDuplicate = Boolean(input.is_duplicate);
  const shareConsent = input.share_consent === true;
  const locationConsent = input.location_consent === true;
  const validPhone = isValidIndianPhone(phone);
  const fakeName = looksFakeName(name);
  const genuineName = name.length >= 2 && !fakeName;
  const spamMessage = looksSpamMessage(message);
  const activeCityKnown = input.serviceable_city === true;
  const preferredVendorIntent = String(input.lead_intent ?? "").toLowerCase() === "preferred_vendor";

  const contactReasons: string[] = [];
  let contactScore = 0;
  if (validPhone) addScore("valid_10_digit_indian_phone", 10, contactReasons, (value) => { contactScore += value; });
  if (shareConsent) addScore("share_consent", 5, contactReasons, (value) => { contactScore += value; });
  if (genuineName) addScore("genuine_name", 3, contactReasons, (value) => { contactScore += value; });
  if (!isDuplicate) addScore("not_duplicate", 5, contactReasons, (value) => { contactScore += value; });
  if (email) addScore("email_provided", 2, contactReasons, (value) => { contactScore += value; });
  contactScore = Math.min(25, contactScore);

  const locationReasons: string[] = [];
  let locationScore = 0;
  if (city) addScore("city_present", 5, locationReasons, (value) => { locationScore += value; });
  if (activeCityKnown) addScore("serviceable_city", 5, locationReasons, (value) => { locationScore += value; });
  if (area) addScore("area_or_locality_present", 5, locationReasons, (value) => { locationScore += value; });
  if (structuredLocationDetail) addScore("structured_location_detail_present", 3, locationReasons, (value) => { locationScore += value; });
  if (locationConsent) addScore("location_consent", 2, locationReasons, (value) => { locationScore += value; });
  locationScore = Math.min(20, locationScore);

  const requirementReasons: string[] = [];
  let requirementScore = 0;
  if (service) addScore("service_present", 5, requirementReasons, (value) => { requirementScore += value; });
  if (subcategory) addScore("subcategory_present", 4, requirementReasons, (value) => { requirementScore += value; });
  if (budget) addScore("budget_present", 4, requirementReasons, (value) => { requirementScore += value; });
  if (timeline) addScore("timeline_present", 3, requirementReasons, (value) => { requirementScore += value; });
  if (message) addScore("requirement_details_present", 4, requirementReasons, (value) => { requirementScore += value; });
  requirementScore = Math.min(20, requirementScore);

  const intentReasons: string[] = [];
  let intentScore = 0;
  if (isUrgentTimeline(timeline, message)) addScore("urgent_within_7_days", 6, intentReasons, (value) => { intentScore += value; });
  else if (isTimelineWithin30Days(timeline)) addScore("timeline_within_30_days", 4, intentReasons, (value) => { intentScore += value; });
  if (hasRealisticBudget(budget)) addScore("realistic_budget", 4, intentReasons, (value) => { intentScore += value; });
  if (suggestsHighIntent(message)) addScore("site_visit_start_work_or_quote_intent", 4, intentReasons, (value) => { intentScore += value; });
  if (preferredVendorIntent) addScore("preferred_vendor_intent", 3, intentReasons, (value) => { intentScore += value; });
  intentScore = Math.min(20, intentScore);

  const fraudReasons: string[] = [];
  let fraudPenalty = 0;
  if (isDuplicate) addScore("duplicate_lead", 15, fraudReasons, (value) => { fraudPenalty += value; });
  if (fakeName) addScore("fake_or_test_name", 8, fraudReasons, (value) => { fraudPenalty += value; });
  if (!validPhone) addScore("invalid_phone", 15, fraudReasons, (value) => { fraudPenalty += value; });
  if (!city || !service) addScore("missing_city_or_service", 10, fraudReasons, (value) => { fraudPenalty += value; });
  if (spamMessage) addScore("spam_or_junk_message", 8, fraudReasons, (value) => { fraudPenalty += value; });
  fraudPenalty = Math.min(25, fraudPenalty);

  const totalScore = clamp(contactScore + locationScore + requirementScore + intentScore - fraudPenalty, 0, 100);
  const scoreClass = classifyLeadScore(totalScore);
  const hardBlockReason = getHardBlockReason({
    shareConsent,
    validPhone,
    isDuplicate,
    fakeName,
    city,
    service,
    totalScore,
    scoreClass,
  });
  const recommendedAction = getRecommendedAction({
    totalScore,
    isDuplicate,
    shareConsent,
    validPhone,
    fakeName,
  });

  return {
    contact_score: contactScore,
    location_score: locationScore,
    requirement_score: requirementScore,
    intent_score: intentScore,
    fraud_penalty: fraudPenalty,
    total_score: totalScore,
    score_class: scoreClass,
    hard_block_reason: hardBlockReason,
    recommended_action: recommendedAction,
    score_breakdown: {
      contact: contactReasons,
      location: locationReasons,
      requirement: requirementReasons,
      intent: intentReasons,
      fraud_penalty: fraudReasons,
      signals: {
        valid_phone: validPhone,
        share_consent: shareConsent,
        duplicate: isDuplicate,
        fake_name: fakeName,
        spam_message: spamMessage,
        serviceable_city_known: activeCityKnown,
      },
    },
  };
}

export async function scoreAndStoreLead(leadId: string, input: LeadQualityInput): Promise<LeadQualityScoreResult> {
  const serviceableCity = await isServiceableCity(input.city);
  const score = calculateLeadQuality({ ...input, serviceable_city: serviceableCity });
  const decision = getLeadQualityDecision(score);
  const db = adminClient();

  const { error: scoreError } = await db.from("lead_scores").insert({
    lead_id: leadId,
    contact_score: score.contact_score,
    location_score: score.location_score,
    requirement_score: score.requirement_score,
    intent_score: score.intent_score,
    fraud_penalty: score.fraud_penalty,
    total_score: score.total_score,
    score_class: score.score_class,
    hard_block_reason: score.hard_block_reason,
    recommended_action: score.recommended_action,
    score_breakdown: score.score_breakdown,
    created_by: "system",
  });
  if (scoreError) throw scoreError;

  const { error: updateError } = await db.from("leads").update({
    lead_quality_score: score.total_score,
    lead_quality_class: score.score_class,
    lead_quality_status: decision.leadQualityStatus,
    lead_quality_hard_block_reason: score.hard_block_reason,
    lead_quality_recommended_action: score.recommended_action,
    lead_quality_checked_at: new Date().toISOString(),
    verification_status: decision.verificationStatus,
    status: decision.leadStatus,
  }).eq("id", leadId);
  if (updateError) throw updateError;

  return score;
}

export function canAutoDistributeLead(scoreResult: LeadQualityScoreResult): boolean {
  return scoreResult.total_score >= 70
    && (scoreResult.score_class === "A" || scoreResult.score_class === "A+")
    && !scoreResult.hard_block_reason
    && scoreResult.recommended_action === "auto_distribute";
}

export function getLeadQualityDecision(scoreResult: LeadQualityScoreResult): LeadQualityDecision {
  const canAutoDistribute = canAutoDistributeLead(scoreResult);
  const action = scoreResult.recommended_action;

  let leadQualityStatus = "manual_review";
  if (canAutoDistribute) leadQualityStatus = "qualified";
  else if (action === "clarification_required") leadQualityStatus = "clarification_required";
  else if (action === "nurture") leadQualityStatus = "nurture";
  else if (action === "duplicate_no_bill") leadQualityStatus = "duplicate_no_bill";
  else if (action === "consent_required_no_distribution") leadQualityStatus = "consent_required";
  else if (action === "invalid_phone_no_distribution") leadQualityStatus = "invalid_phone";
  else if (scoreResult.score_class === "D") leadQualityStatus = "rejected_quality";

  let leadStatus = "Quality Checked";
  if (action === "duplicate_no_bill") leadStatus = "Duplicate";
  else if (canAutoDistribute) leadStatus = "Hot Lead";
  else if (action === "clarification_required") leadStatus = "Clarification Required";
  else if (action === "nurture") leadStatus = "Nurture";
  else if (scoreResult.score_class === "D" || action === "invalid_phone_no_distribution") leadStatus = "Rejected Quality";

  let verificationStatus: LeadQualityDecision["verificationStatus"] = "Quality Checked";
  if (scoreResult.score_class === "D" || action === "invalid_phone_no_distribution") {
    verificationStatus = "Rejected Quality";
  } else if (!canAutoDistribute && scoreResult.hard_block_reason) {
    verificationStatus = "Manual Review";
  }

  return {
    canAutoDistribute,
    leadQualityStatus,
    leadStatus,
    verificationStatus,
    recommendedAction: action,
    hardBlockReason: scoreResult.hard_block_reason,
  };
}

async function isServiceableCity(city?: string | null): Promise<boolean | null> {
  // Live public.cities contract is exactly: id, name, slug, is_active.
  // There is NO launch_status column — selecting it made PostgREST error and
  // return null, silently dropping serviceable_city:+5 for real active cities.
  const cityName = firstText(city); // firstText trims; "" when city is blank
  if (!cityName) return false;
  try {
    const { data, error } = await adminClient()
      .from("cities")
      .select("is_active")            // only existing required column
      .ilike("name", cityName)        // case-insensitive exact name match (no wildcards)
      .limit(1);
    if (error) return null;           // genuine query/system failure only
    const row = (data ?? [])[0] as { is_active?: boolean | null } | undefined;
    if (!row) return false;           // no such city → not serviceable (not a failure)
    return row.is_active === true;    // true only when the matched city is active
  } catch {
    return null;                      // genuine system failure only
  }
}

function getHardBlockReason(input: {
  shareConsent: boolean;
  validPhone: boolean;
  isDuplicate: boolean;
  fakeName: boolean;
  city: string;
  service: string;
  totalScore: number;
  scoreClass: LeadScoreClass;
}): string | null {
  if (!input.shareConsent) return "missing_share_consent";
  if (!input.validPhone) return "invalid_phone";
  if (input.isDuplicate) return "duplicate_lead";
  if (input.fakeName) return "fake_or_test_name";
  if (!input.city) return "missing_city";
  if (!input.service) return "missing_service";
  if (input.totalScore < 70 || input.scoreClass === "B" || input.scoreClass === "C" || input.scoreClass === "D") {
    return "score_below_auto_distribution_threshold";
  }
  return null;
}

function getRecommendedAction(input: {
  totalScore: number;
  isDuplicate: boolean;
  shareConsent: boolean;
  validPhone: boolean;
  fakeName: boolean;
}): LeadQualityRecommendedAction {
  if (input.isDuplicate) return "duplicate_no_bill";
  if (!input.shareConsent) return "consent_required_no_distribution";
  if (!input.validPhone) return "invalid_phone_no_distribution";
  if (input.fakeName) return "manual_review_suspicious_name";
  if (input.totalScore >= 70) return "auto_distribute";
  if (input.totalScore >= 50) return "clarification_required";
  if (input.totalScore >= 30) return "nurture";
  return "reject_or_manual_review";
}

function firstText(...values: Array<string | null | undefined>): string {
  return values.map((value) => value?.trim()).find(Boolean) ?? "";
}

function addScore(reason: string, score: number, reasons: string[], add: (score: number) => void) {
  add(score);
  reasons.push(`${reason}:+${score}`);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isValidIndianPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return true;
  return /^91[6-9]\d{9}$/.test(digits);
}

function looksFakeName(value: string): boolean {
  const name = value.trim();
  if (!name) return false;
  if (FAKE_NAME_RE.test(name)) return true;
  if (/^(.)\1{2,}$/i.test(name.replace(/\s/g, ""))) return true;
  return name.replace(/[^a-z]/gi, "").length <= 1;
}

function looksSpamMessage(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (SPAM_WORD_RE.test(text)) return true;
  if (/https?:\/\/|www\./i.test(text) && text.length < 80) return true;
  if (/^(.)\1{6,}$/i.test(text.replace(/\s/g, ""))) return true;
  return false;
}

function isUrgentTimeline(timeline: string, message: string): boolean {
  const text = `${timeline} ${message}`.toLowerCase();
  if (/\b(urgent|asap|immediate|today|tomorrow|this week|within 7|7 days|start now)\b/.test(text)) return true;
  const days = extractDays(text);
  return days !== null && days <= 7;
}

/** Lowercase, collapse whitespace, and fold every dash/hyphen variant to a space. */
function normalizeTimelineText(value: string): string {
  return value
    .toLowerCase()
    // hyphen-minus (U+002D) + Unicode hyphens/dashes (U+2010–U+2015) + minus (U+2212)
    .replace(/[-‐-―−]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTimelineWithin30Days(timeline: string): boolean {
  const text = normalizeTimelineText(timeline);
  if (!text) return false;
  // Current client label "Within One Month" (and "within 1 month"). Anchored on
  // "within … month" so it never matches "One–Two/Two–Three/After Three Months".
  if (/\bwithin (one|1) month\b/.test(text)) return true;
  if (/\b(this month|within 30|30 days|2 weeks|3 weeks|4 weeks|15 days)\b/.test(text)) return true;
  const days = extractDays(text);
  return days !== null && days <= 30;
}

function extractDays(value: string): number | null {
  const match = value.match(/\b(\d{1,3})\s*(day|days)\b/i);
  if (!match) return null;
  const days = Number(match[1]);
  return Number.isFinite(days) ? days : null;
}

function hasRealisticBudget(value: string): boolean {
  const text = value.toLowerCase().trim();
  if (!text || /\b(not sure|unknown|na|n\/a|free)\b/.test(text)) return false;
  const numbers = text.match(/\d[\d,]*/g)?.map((n) => Number(n.replace(/,/g, ""))).filter(Number.isFinite) ?? [];
  if (numbers.length === 0) return true;
  return Math.max(...numbers) >= 1000;
}

function suggestsHighIntent(value: string): boolean {
  return /\b(site visit|visit|quotation|quote|estimate|start work|start|inspection|measurement|call back|callback|finalize)\b/i.test(value);
}
