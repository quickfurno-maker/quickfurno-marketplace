// ============================================================================
// QuickFurno Lead Quality Engine V2 (backend-only)
// Hard eligibility gates → commercial quality score → SEPARATE location confidence.
// Rule-based scoring only. No OTP, AI, WhatsApp, n8n, or vendor assignment here.
//
// V2 rules:
//   • Contact&Trust 20 / Location 20 / Requirement 30 / Intent 30 (max 100).
//   • Email is NOT a scoring signal. Duplicate is a hard gate only (no
//     not_duplicate reward, no fraud penalty).
//   • Structured Google/GPS evidence feeds a SEPARATE location_confidence (0/4),
//     never total_score. location_consent is not a quality signal.
//   • Genuine client detail (+5) and explicit intent (+7) require a provably
//     client-authored field. The current backend contract has none (message is a
//     constructed metadata string), so both are awarded 0 in this pass.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { evaluateBudgetFit, resolveBudgetCategory } from "@/lib/lead-quality/budgetFit";

export type LeadScoreClass = "A+" | "A" | "B" | "C" | "D";

// Persisted in score_breakdown for historical auditability across model changes.
export const SCORE_MODEL_VERSION = "lead_quality_v2";

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
  // email is intentionally NOT part of the scoring input (V2). leadService passes
  // its lead object via spread, so the extra field is simply ignored here.
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
  assignment_intent?: string | null;
  serviceable_city?: boolean | null;
};

export type LeadQualityScoreResult = {
  contact_score: number;
  location_score: number;
  requirement_score: number;
  intent_score: number;
  fraud_penalty: number;
  total_score: number;
  // SEPARATE from total_score: 0 (manual) or 4 (trusted Google/GPS). Feeds Phase 2
  // distance-ranking confidence; never moves a lead across the quality threshold.
  location_confidence: number;
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
  // V2 bands: A+ 85–100, A 70–84, B 55–69, C 40–54, D 0–39.
  if (totalScore >= 85) return "A+";
  if (totalScore >= 70) return "A";
  if (totalScore >= 55) return "B";
  if (totalScore >= 40) return "C";
  return "D";
}

export function calculateLeadQuality(input: LeadQualityInput): LeadQualityScoreResult {
  const name = firstText(input.name);
  const phone = firstText(input.phone);
  const city = firstText(input.city);
  const area = firstText(input.area, input.locality);
  const service = firstText(input.service_required, input.service_category, input.serviceCategory, input.category);
  const subcategory = firstText(input.subcategory);
  const budget = firstText(input.budget, input.budget_range, input.budgetRange);
  const timeline = firstText(input.timeline);
  const message = firstText(input.message, input.requirement);

  // Trusted structured location evidence → separate location_confidence (0/4),
  // NOT total_score. area_normalized excluded (can be manual text); location_consent
  // excluded (permission state ≠ quality).
  const validLat = typeof input.latitude === "number" && Number.isFinite(input.latitude);
  const validLng = typeof input.longitude === "number" && Number.isFinite(input.longitude);
  const locationSource = String(input.location_source ?? "").trim().toLowerCase();
  const trustedLocationSource = locationSource === "google_place" || locationSource === "browser_gps";
  const structuredLocationEvidence = Boolean(
    firstText(input.google_place_id) ||
      (validLat && validLng) ||
      firstText(input.formatted_address) ||
      firstText(input.sublocality) ||
      firstText(input.neighborhood) ||
      trustedLocationSource,
  );
  const locationConfidence = structuredLocationEvidence ? 4 : 0;

  const isDuplicate = Boolean(input.is_duplicate);
  const shareConsent = input.share_consent === true;
  const validPhone = isValidIndianPhone(phone);
  const fakeName = looksFakeName(name);
  const genuineName = name.length >= 2 && !fakeName;
  const spamMessage = looksSpamMessage(message);
  // Serviceability is an ELIGIBILITY gate: true (active), false (known inactive),
  // null (lookup failure/unknown), undefined (not evaluated → no gate).
  const cityServiceability = input.serviceable_city;
  const activeCityKnown = cityServiceability === true;
  const preferredOrSelected =
    String(input.lead_intent ?? "").toLowerCase() === "preferred_vendor" ||
    String(input.assignment_intent ?? "").toLowerCase() === "client_selected_vendor";
  const hasSpecificCategory =
    Boolean(subcategory) || resolveBudgetCategory({ service, category: input.category, subcategory }) !== null;
  const budgetFit = evaluateBudgetFit(budget, { service, category: input.category, subcategory });

  // Genuine client detail (+5) and explicit-intent (+7) require a provably client-
  // authored field. The current backend contract exposes none (message is a system-
  // constructed metadata string), so BOTH are awarded 0 in this backend-only pass.
  const genuineClientDetail = false;
  const explicitClientIntent = false;

  // ── CONTACT & TRUST (max 20): no email, no not_duplicate ──────────────────
  const contactReasons: string[] = [];
  let contactScore = 0;
  if (validPhone) addScore("valid_mobile_number", 10, contactReasons, (v) => { contactScore += v; });
  if (genuineName) addScore("genuine_plausible_name", 5, contactReasons, (v) => { contactScore += v; });
  if (shareConsent) addScore("share_consent", 5, contactReasons, (v) => { contactScore += v; });
  contactScore = Math.min(20, contactScore);

  // ── LOCATION USABILITY (max 20): active city 10 + area 10 ─────────────────
  const locationReasons: string[] = [];
  let locationScore = 0;
  if (activeCityKnown) addScore("active_service_city", 10, locationReasons, (v) => { locationScore += v; });
  if (area) addScore("area_or_locality_present", 10, locationReasons, (v) => { locationScore += v; });
  locationScore = Math.min(20, locationScore);

  // ── REQUIREMENT COMPLETENESS (max 30) ─────────────────────────────────────
  const requirementReasons: string[] = [];
  let requirementScore = 0;
  if (service) addScore("service_selected", 6, requirementReasons, (v) => { requirementScore += v; });
  if (hasSpecificCategory) addScore("specific_category_or_subcategory", 6, requirementReasons, (v) => { requirementScore += v; });
  if (budgetFit.hasBudget) addScore("budget_selected", 5, requirementReasons, (v) => { requirementScore += v; });
  if (timeline) addScore("timeline_selected", 4, requirementReasons, (v) => { requirementScore += v; });
  if (firstText(input.property_type)) addScore("project_or_property_context", 4, requirementReasons, (v) => { requirementScore += v; });
  if (genuineClientDetail) addScore("real_client_provided_detail", 5, requirementReasons, (v) => { requirementScore += v; });
  requirementScore = Math.min(30, requirementScore);

  // ── COMMERCIAL INTENT (max 30) ────────────────────────────────────────────
  const intentReasons: string[] = [];
  let intentScore = 0;
  const timelineReadiness = timelineReadinessScore(timeline);
  if (timelineReadiness.score > 0) addScore(timelineReadiness.reason, timelineReadiness.score, intentReasons, (v) => { intentScore += v; });
  if (budgetFit.points > 0) addScore(`category_fit_budget_${budgetFit.tier}`, budgetFit.points, intentReasons, (v) => { intentScore += v; });
  if (explicitClientIntent) addScore("explicit_quote_site_visit_or_start", 7, intentReasons, (v) => { intentScore += v; });
  if (preferredOrSelected) addScore("preferred_or_client_selected_vendor", 5, intentReasons, (v) => { intentScore += v; });
  intentScore = Math.min(30, intentScore);

  // Duplicate/fake/spam/invalid-phone are HARD GATES, not point loss. fraud_penalty
  // stays 0 for backward-compatible lead_scores storage.
  const fraudPenalty = 0;

  const totalScore = clamp(contactScore + locationScore + requirementScore + intentScore, 0, 100);
  const scoreClass = classifyLeadScore(totalScore);
  const hardBlockReason = getHardBlockReason({
    shareConsent, validPhone, isDuplicate, fakeName, spamMessage, city, service, cityServiceability, scoreClass,
  });
  const recommendedAction = getRecommendedAction({
    scoreClass, isDuplicate, shareConsent, validPhone, fakeName, spamMessage, city, service, cityServiceability,
  });

  return {
    contact_score: contactScore,
    location_score: locationScore,
    requirement_score: requirementScore,
    intent_score: intentScore,
    fraud_penalty: fraudPenalty,
    total_score: totalScore,
    location_confidence: locationConfidence,
    score_class: scoreClass,
    hard_block_reason: hardBlockReason,
    recommended_action: recommendedAction,
    score_breakdown: {
      score_model_version: SCORE_MODEL_VERSION,
      contact: contactReasons,
      location: locationReasons,
      requirement: requirementReasons,
      intent: intentReasons,
      location_confidence: {
        score: locationConfidence,
        structured_google_gps_evidence: structuredLocationEvidence,
      },
      budget_fit: {
        resolved_category: budgetFit.category,
        configured_floor_inr: budgetFit.categoryMin,
        parsed_budget_max_inr: budgetFit.maxRupees,
        ratio: budgetFit.ratio,
        tier: budgetFit.tier,
        points: budgetFit.points,
      },
      hard_gates: {
        valid_phone: validPhone,
        share_consent: shareConsent,
        duplicate: isDuplicate,
        fake_name: fakeName,
        spam_message: spamMessage,
        missing_city_or_service: !city || !service,
        city_serviceability: cityServiceability === true ? "active" : cityServiceability === false ? "inactive" : cityServiceability === null ? "unknown" : "not_evaluated",
      },
      signals: {
        genuine_client_detail_awarded: genuineClientDetail,
        explicit_client_intent_awarded: explicitClientIntent,
        active_service_city: activeCityKnown,
        structured_location_evidence: structuredLocationEvidence,
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

// Hard gates block auto-distribution regardless of numeric score. Fake and spam
// keep DISTINCT reason codes (shared manual-review action).
function getHardBlockReason(input: {
  shareConsent: boolean;
  validPhone: boolean;
  isDuplicate: boolean;
  fakeName: boolean;
  spamMessage: boolean;
  city: string;
  service: string;
  cityServiceability: boolean | null | undefined;
  scoreClass: LeadScoreClass;
}): string | null {
  if (input.isDuplicate) return "duplicate_lead";
  if (!input.shareConsent) return "missing_share_consent";
  if (!input.validPhone) return "invalid_phone";
  if (input.fakeName) return "fake_or_test_name";
  if (input.spamMessage) return "spam_or_junk_message";
  if (!input.city) return "missing_city";
  if (!input.service) return "missing_service";
  if (input.cityServiceability === false) return "city_not_serviceable";
  if (input.cityServiceability === null) return "city_serviceability_unknown";
  if (input.scoreClass !== "A" && input.scoreClass !== "A+") {
    return "score_below_auto_distribution_threshold";
  }
  return null;
}

// Deterministic precedence: duplicate → consent → phone → fake → spam → missing
// city/service → inactive city → city-unknown → then A+/A auto, B clarify, C
// nurture, D reject. (Fake/spam share the manual-review action; hard_block_reason
// preserves the distinct reason so spam is never mislabelled as a name issue.)
function getRecommendedAction(input: {
  scoreClass: LeadScoreClass;
  isDuplicate: boolean;
  shareConsent: boolean;
  validPhone: boolean;
  fakeName: boolean;
  spamMessage: boolean;
  city: string;
  service: string;
  cityServiceability: boolean | null | undefined;
}): LeadQualityRecommendedAction {
  if (input.isDuplicate) return "duplicate_no_bill";
  if (!input.shareConsent) return "consent_required_no_distribution";
  if (!input.validPhone) return "invalid_phone_no_distribution";
  if (input.fakeName || input.spamMessage) return "manual_review_suspicious_name";
  if (!input.city || !input.service) return "clarification_required";
  if (input.cityServiceability === false) return "nurture";
  if (input.cityServiceability === null) return "reject_or_manual_review";
  if (input.scoreClass === "A+" || input.scoreClass === "A") return "auto_distribute";
  if (input.scoreClass === "B") return "clarification_required";
  if (input.scoreClass === "C") return "nurture";
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

/** Lowercase, collapse whitespace, and fold every dash/hyphen variant to a space. */
function normalizeTimelineText(value: string): string {
  return value
    .toLowerCase()
    // hyphen-minus (U+002D) + Unicode hyphens/dashes (U+2010–U+2015) + minus (U+2212)
    .replace(/[-‐-―−]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Commercial-intent timeline readiness (max +10) from the STRUCTURED timeline only
 * (no free-text provenance needed). Recognizes the exact UI labels robustly and
 * never misclassifies "One–Two Months" as within one month (anchored on "within").
 *   within 7 days +10 · within one month +7 · 1–2 months +5 · 2–3 months +3 · after 3 months +1
 */
function timelineReadinessScore(timeline: string): { score: number; reason: string } {
  const t = normalizeTimelineText(timeline);
  if (!t) return { score: 0, reason: "timeline_none" };
  if (/\b(urgent|asap|immediate|immediately|today|tomorrow|this week|within 7|7 days|start now)\b/.test(t)) {
    return { score: 10, reason: "timeline_within_7_days" };
  }
  if (/\bwithin 15 days\b|\b15 days\b|\bwithin (one|1) month\b|\bthis month\b|\bwithin 30\b|\b30 days\b|\b(2|3|4) weeks\b/.test(t)) {
    return { score: 7, reason: "timeline_within_one_month" };
  }
  if (/\bone two months?\b|\b1 2 months?\b/.test(t)) return { score: 5, reason: "timeline_1_2_months" };
  if (/\btwo three months?\b|\b2 3 months?\b/.test(t)) return { score: 3, reason: "timeline_2_3_months" };
  if (/\bafter (three|3) months?\b/.test(t)) return { score: 1, reason: "timeline_after_3_months" };
  const days = extractDays(t);
  if (days !== null) {
    if (days <= 7) return { score: 10, reason: "timeline_within_7_days" };
    if (days <= 30) return { score: 7, reason: "timeline_within_one_month" };
    if (days <= 60) return { score: 5, reason: "timeline_1_2_months" };
    if (days <= 90) return { score: 3, reason: "timeline_2_3_months" };
    return { score: 1, reason: "timeline_after_3_months" };
  }
  if (/\bexplor|just looking|browsing\b/.test(t)) return { score: 1, reason: "timeline_exploring" };
  return { score: 1, reason: "timeline_unspecified_low" };
}

function extractDays(value: string): number | null {
  const match = value.match(/\b(\d{1,3})\s*(day|days)\b/i);
  if (!match) return null;
  const days = Number(match[1]);
  return Number.isFinite(days) ? days : null;
}
