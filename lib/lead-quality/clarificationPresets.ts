import { BUDGETS, TIMELINES } from "@/lib/config";
import { mainCategories } from "@/lib/categories";
import { enquiryServiceForCategory, type QuickFurnoCategory } from "@/lib/quickfurno-data";

export type ClarificationQuestionType = "single_choice" | "free_text_later";

export type ClarificationOption = {
  value: string;
  label: string;
};

export type ClarificationQuestion = {
  key: string;
  text: string;
  type: ClarificationQuestionType;
  options?: ClarificationOption[];
  mapped_field?: string;
};

export type ClarificationLeadLike = {
  name?: string | null;
  city?: string | null;
  area?: string | null;
  locality?: string | null;
  service_required?: string | null;
  service_category?: string | null;
  serviceCategory?: string | null;
  category?: string | null;
  subcategory?: string | null;
  budget?: string | null;
  budget_range?: string | null;
  budgetRange?: string | null;
  timeline?: string | null;
  property_type?: string | null;
  project_size?: string | null;
  parent_category_group?: string | null;
  target_vendor_category?: string | null;
  target_vendor_subcategory?: string | null;
  selected_vendor_name?: string | null;
  message?: string | null;
  requirement?: string | null;
};

export type ClarificationPreset = {
  parentCategoryGroup: string | null;
  marketplaceCategory: QuickFurnoCategory | null;
  serviceRequired: string | null;
  subcategory: string | null;
  missingFields: string[];
  questions: ClarificationQuestion[];
  previewMessage: string;
};

const CANONICAL_CATEGORIES = new Set<QuickFurnoCategory>([
  "Interior Designers",
  "Carpenters",
  "Modular Factory",
  "Premium Interiors",
  "Sofa",
  "Painter",
  "Civil Work",
]);

const INTERIOR_LEAVES: QuickFurnoCategory[] = mainCategories
  .find((category) => category.id === "interior")
  ?.subcategories.map((item) => item.category) ?? [
    "Interior Designers",
    "Carpenters",
    "Modular Factory",
    "Premium Interiors",
  ];

export function getClarificationPresetForLead(lead: ClarificationLeadLike): ClarificationPreset {
  const marketplaceCategory = resolveMarketplaceCategoryFromLead(lead);
  const serviceRequired = marketplaceCategory ? resolveServiceRequiredFromMarketplaceCategory(marketplaceCategory) : text(lead.service_required);
  const parentCategoryGroup = resolveParentCategoryGroup(marketplaceCategory, lead);
  const subcategory = text(lead.subcategory, lead.target_vendor_subcategory);
  const missingFields = detectMissingClarificationFields(lead);
  const questions = buildClarificationQuestions(lead);
  const previewMessage = buildClarificationPreviewMessage(lead, questions);

  return {
    parentCategoryGroup,
    marketplaceCategory,
    serviceRequired,
    subcategory,
    missingFields,
    questions,
    previewMessage,
  };
}

export function detectMissingClarificationFields(lead: ClarificationLeadLike): string[] {
  const missing: string[] = [];
  const category = resolveMarketplaceCategoryFromLead(lead);
  const parent = resolveParentCategoryGroup(category, lead);
  const subcategory = text(lead.subcategory, lead.target_vendor_subcategory);

  if (!category) missing.push("marketplace_category");
  if (parent === "Interior" && (!category || !INTERIOR_LEAVES.includes(category) || weakInteriorLeaf(subcategory))) {
    missing.push("interior_leaf_category");
  }
  if (category === "Sofa" && !subcategory) missing.push("sofa_work_type");
  if (category === "Painter" && !subcategory) missing.push("painting_work_type");
  if (category === "Civil Work" && !subcategory) missing.push("civil_work_type");
  if (!text(lead.budget, lead.budget_range, lead.budgetRange)) missing.push("budget");
  if (!text(lead.timeline)) missing.push("timeline");
  // Location clarity asks for area/locality only (never pincode). Uses the new
  // `area_location` key; no dependency on lead.pincode or 6-digit message text.
  if (!text(lead.area, lead.locality)) missing.push("area_location");

  if ((parent === "Interior" || category === "Painter") && !text(lead.property_type, lead.project_size)) {
    missing.push(category === "Painter" ? "property_size" : "property_type");
  }
  if ((category === "Sofa" || category === "Civil Work") && !mentionsPhoto(text(lead.message, lead.requirement))) {
    missing.push("photo_available");
  }
  if (category === "Sofa" && !/\b(1 seater|2 seater|3 seater|l-shape|l shape|custom size)\b/i.test(text(lead.message, lead.requirement))) {
    missing.push("sofa_size");
  }
  if (category === "Civil Work" && !text(lead.property_type)) missing.push("site_type");

  return dedupe(missing);
}

export function buildClarificationQuestions(lead: ClarificationLeadLike): ClarificationQuestion[] {
  const category = resolveMarketplaceCategoryFromLead(lead);
  const parent = resolveParentCategoryGroup(category, lead);
  const missing = detectMissingClarificationFields(lead);
  const questions: ClarificationQuestion[] = [];

  if (missing.includes("marketplace_category") || missing.includes("interior_leaf_category")) {
    questions.push({
      key: "interior_leaf_category",
      text: "Which interior service do you need?",
      type: "single_choice",
      mapped_field: "service_required",
      options: INTERIOR_LEAVES.map(option),
    });
  } else if (category === "Sofa" && missing.includes("sofa_work_type")) {
    questions.push(choice("sofa_work_type", "What sofa work do you need?", [
      "Custom Sofa",
      "New Sofa",
      "Sofa Repair",
      "Fabric Change / Upholstery",
      "Cushion Repair",
      "Recliner",
    ], "subcategory"));
  } else if (category === "Painter" && missing.includes("painting_work_type")) {
    questions.push(choice("painting_work_type", "What painting work do you need?", [
      "Interior Painting",
      "Exterior Painting",
      "Full Home Painting",
      "Single Room Painting",
      "Repaint",
      "Texture Wall",
      "Waterproofing",
    ], "subcategory"));
  } else if (category === "Civil Work" && missing.includes("civil_work_type")) {
    questions.push(choice("civil_work_type", "What civil work do you need?", [
      "Home Renovation",
      "Tiling",
      "Waterproofing",
      "False Ceiling",
      "Bathroom Work",
      "Wall Breaking",
      "Flooring",
      "Repair Work",
      "Other Civil Work",
    ], "subcategory"));
  }

  if (parent === "Interior" && missing.includes("property_type")) {
    questions.push(choice("property_type", "Property type?", ["1 BHK", "2 BHK", "3 BHK", "Villa / bungalow", "Commercial"], "property_type"));
  }
  if (category === "Painter" && missing.includes("property_size")) {
    questions.push(choice("property_size", "Property size?", ["1 BHK", "2 BHK", "3 BHK", "Office / shop", "Large site"], "property_type"));
  }
  if (category === "Civil Work" && missing.includes("site_type")) {
    questions.push(choice("site_type", "Site type?", ["Residential", "Commercial", "Under construction", "Repair work"], "property_type"));
  }
  if (category === "Sofa" && missing.includes("sofa_size")) {
    questions.push(choice("sofa_size", "Sofa size?", ["1 seater", "2 seater", "3 seater", "L-shape", "Custom"], "message"));
  }
  if ((category === "Sofa" || category === "Civil Work") && missing.includes("photo_available")) {
    questions.push(choice("photo_available", category === "Civil Work" ? "Photo/video available?" : "Do you have a sofa/site photo?", ["Yes", "No"], "message"));
  }
  if (missing.includes("budget")) {
    questions.push(choice("budget", "Budget range?", category === "Painter" ? ["Basic", "Standard", "Premium", "Need estimate"] : [...BUDGETS], "budget"));
  }
  if (missing.includes("timeline")) {
    questions.push(choice("timeline", "Timeline?", [...TIMELINES], "timeline"));
  }
  if (missing.includes("area_location")) {
    questions.push({
      key: "area_location",
      text: "Please share your area / locality",
      type: "free_text_later",
      mapped_field: "area",
    });
  }

  return dedupeQuestions(questions).slice(0, 5);
}

export function buildClarificationPreviewMessage(lead: ClarificationLeadLike, questions: ClarificationQuestion[]): string {
  const clientName = text(lead.name) || "there";
  const body = questions.map((question, index) => {
    const options = question.options?.map((item) => item.label).join(", ") || "Free text";
    return `${index + 1}. ${question.text}\nOptions: ${options}`;
  }).join("\n\n");

  return [
    `Hi ${clientName}, thanks for contacting QuickFurno.`,
    "",
    "To connect you with the right verified vendor, please complete these details:",
    "",
    body || "1. Please share a few more details about your requirement.\nOptions: Free text",
    "",
    "After this, QuickFurno will verify your requirement and connect you with suitable vendors.",
    "",
    "This is preview only. Do not send automatically yet.",
  ].join("\n");
}

export function mapClarificationAnswerToLeadField(questionKey: string, answerValue: string) {
  const value = answerValue.trim();
  if (!value) return null;

  if (questionKey === "interior_leaf_category") {
    const category = normalizeClarificationCategory(value);
    if (!category || !INTERIOR_LEAVES.includes(category)) return null;
    return {
      mapped_field: "service_required",
      mapped_value: resolveServiceRequiredFromMarketplaceCategory(category),
      lead_patch: {
        parent_category_group: "Interior",
        category,
        service_required: resolveServiceRequiredFromMarketplaceCategory(category),
        subcategory: category,
      },
    };
  }

  if (questionKey === "sofa_work_type") return categoryWorkTypePatch("Sofa", value);
  if (questionKey === "painting_work_type") return categoryWorkTypePatch("Painter", value);
  if (questionKey === "civil_work_type") return categoryWorkTypePatch("Civil Work", value);
  if (questionKey === "budget") return simplePatch("budget", value);
  if (questionKey === "timeline") return simplePatch("timeline", value);
  if (questionKey === "property_type" || questionKey === "property_size" || questionKey === "site_type") return simplePatch("property_type", value);
  // New location clarification key → always maps to the lead's area.
  if (questionKey === "area_location") return simplePatch("area", value);
  // BACKWARD-COMPATIBILITY ALIAS: already-persisted `area_pincode` clarification
  // records (pre-Phase 1) must remain ingestable. No NEW request uses this key;
  // its answer is mapped exactly as before so historical records reproduce.
  if (questionKey === "area_pincode") return simplePatch(hasPincode(value) ? "message" : "area", value);
  if (questionKey === "sofa_size" || questionKey === "photo_available") return detailPatch(questionKey, value);
  return detailPatch(questionKey, value);
}

export function normalizeClarificationCategory(value: string | null | undefined): QuickFurnoCategory | null {
  const raw = text(value).toLowerCase();
  if (!raw) return null;
  for (const category of CANONICAL_CATEGORIES) {
    if (category.toLowerCase() === raw) return category;
  }
  if (/modular|kitchen/.test(raw)) return "Modular Factory";
  if (/carpentry|carpenter|custom furniture|wardrobe/.test(raw) && !/modular/.test(raw)) return "Carpenters";
  if (/premium interior|luxury/.test(raw)) return "Premium Interiors";
  if (/full home interior|interior design|false ceiling|interior/.test(raw)) return "Interior Designers";
  if (/sofa|upholstery|recliner/.test(raw)) return "Sofa";
  if (/paint|painting|repaint|texture/.test(raw)) return "Painter";
  if (/renovation|civil|tiling|waterproofing|masonry|flooring|bathroom|wall breaking/.test(raw)) return "Civil Work";
  return null;
}

export function resolveMarketplaceCategoryFromLead(lead: ClarificationLeadLike): QuickFurnoCategory | null {
  const direct = normalizeClarificationCategory(text(lead.category, lead.target_vendor_category));
  if (direct) return direct;

  const service = text(lead.service_required, lead.service_category, lead.serviceCategory);
  const fromService = normalizeClarificationCategory(service);
  if (fromService) return fromService;

  const subcategory = normalizeClarificationCategory(text(lead.subcategory, lead.target_vendor_subcategory));
  if (subcategory) return subcategory;

  const combined = text(lead.message, lead.requirement, lead.selected_vendor_name, lead.parent_category_group);
  const fromText = normalizeClarificationCategory(combined);
  if (fromText) return fromText;

  return null;
}

export function resolveServiceRequiredFromMarketplaceCategory(category: QuickFurnoCategory | null): string | null {
  return category ? enquiryServiceForCategory(category) : null;
}

function categoryWorkTypePatch(category: QuickFurnoCategory, value: string) {
  return {
    mapped_field: "subcategory",
    mapped_value: value,
    lead_patch: {
      parent_category_group: category,
      category,
      service_required: resolveServiceRequiredFromMarketplaceCategory(category),
      subcategory: value,
    },
  };
}

function simplePatch(field: string, value: string) {
  return {
    mapped_field: field,
    mapped_value: value,
    lead_patch: { [field]: value },
  };
}

function detailPatch(questionKey: string, value: string) {
  return {
    mapped_field: "message",
    mapped_value: `${questionKey}: ${value}`,
    lead_patch: { message_append: `${questionKey}: ${value}` },
  };
}

function choice(key: string, textValue: string, labels: string[], mappedField: string): ClarificationQuestion {
  return {
    key,
    text: textValue,
    type: "single_choice",
    mapped_field: mappedField,
    options: labels.map(option),
  };
}

function option(value: string): ClarificationOption {
  return { value, label: value };
}

function resolveParentCategoryGroup(category: QuickFurnoCategory | null, lead: ClarificationLeadLike): string | null {
  if (category && INTERIOR_LEAVES.includes(category)) return "Interior";
  if (category) return category;
  const parent = text(lead.parent_category_group);
  return parent || null;
}

function weakInteriorLeaf(value: string) {
  const normalized = value.toLowerCase();
  return !normalized || normalized === "interior" || normalized === "interiors" || normalized === "home interior";
}

function text(...values: Array<string | null | undefined>): string {
  return values.map((value) => value?.trim()).find(Boolean) ?? "";
}

// Retained ONLY for the legacy `area_pincode` answer-mapping alias above, to keep
// already-persisted clarification records ingestable. Not used by any new
// clarification question or any missing-field / scoring / matching decision.
function hasPincode(value: string): boolean {
  return /\b\d{6}\b/.test(value);
}

function mentionsPhoto(value: string): boolean {
  return /\b(photo|video|image|picture|yes photo|no photo)\b/i.test(value);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeQuestions(questions: ClarificationQuestion[]): ClarificationQuestion[] {
  const seen = new Set<string>();
  return questions.filter((question) => {
    if (seen.has(question.key)) return false;
    seen.add(question.key);
    return true;
  });
}
