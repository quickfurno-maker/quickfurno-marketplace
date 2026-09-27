// ============================================================================
// QuickFurno — Client Journey V2 / Phase 1 qualification contract
// Pure Core rules only: no database, provider, automation or assignment calls.
// ============================================================================

import type { CreateLeadInput } from "../types";

export type QualificationFieldState =
  | "missing"
  | "unknown"
  | "undecided"
  | "confirmed";

export type LeadCompletenessStatus =
  | "incomplete"
  | "enrichment_required"
  | "complete";

export type LeadMatchReadinessStatus =
  | "not_ready"
  | "needs_enrichment"
  | "ready"
  | "ready_partial"
  | "blocked";

export type LeadJourneyState =
  | "captured"
  | "duplicate"
  | "enrichment_required"
  | "awaiting_client"
  | "ready_for_qualification"
  | "match_ready"
  | "matching"
  | "partially_matched"
  | "matched"
  | "waiting_for_supply"
  | "nurture"
  | "manual_review"
  | "cancelled"
  | "closed";

export type LeadReachabilityStatus =
  | "unverified"
  | "reachable"
  | "unreachable"
  | "unknown";

export type LeadFraudStatus =
  | "unchecked"
  | "clear"
  | "suspicious"
  | "blocked";

export type QualificationImportance =
  | "capture_critical"
  | "match_critical"
  | "ranking_useful"
  | "optional";

export type QualificationFieldKey =
  | "name"
  | "phone"
  | "city"
  | "area"
  | "service"
  | "share_consent"
  | "budget"
  | "timeline"
  | "property_type";

export interface QualificationFieldRule {
  readonly key: QualificationFieldKey;
  readonly importance: QualificationImportance;
  readonly label: string;
}

export interface CategoryQualificationSchema {
  readonly category: string;
  readonly fields: readonly QualificationFieldRule[];
}

/**
 * Phase 1 starts with one safe baseline. Category-specific overrides plug into
 * this contract later without changing capture, CRM, automation or MatchCore.
 *
 * The first five facts + consent are intentionally the only capture-critical
 * facts. Budget/timeline/property context improve vendor usefulness, but missing
 * data is enrichment work — never proof of a bad lead.
 */
export const BASE_QUALIFICATION_SCHEMA = {
  category: "*",
  fields: [
    { key: "name", importance: "capture_critical", label: "Name" },
    { key: "phone", importance: "capture_critical", label: "WhatsApp number" },
    { key: "city", importance: "capture_critical", label: "City" },
    { key: "area", importance: "capture_critical", label: "Area / locality" },
    { key: "service", importance: "capture_critical", label: "Service" },
    { key: "share_consent", importance: "capture_critical", label: "Consent" },
    { key: "budget", importance: "ranking_useful", label: "Budget" },
    { key: "timeline", importance: "ranking_useful", label: "Timeline" },
    // Category-specific schemas may promote property_type to match-critical or
    // ranking-useful later. The universal baseline must not overfit all trades.
    { key: "property_type", importance: "optional", label: "Property type" },
  ],
} as const satisfies CategoryQualificationSchema;

const CATEGORY_SCHEMAS: Readonly<Record<string, CategoryQualificationSchema>> =
  Object.freeze({});

export interface LeadQualificationSnapshot {
  readonly journeyState: LeadJourneyState;
  readonly completenessStatus: LeadCompletenessStatus;
  readonly completenessPercent: number;
  readonly missingFields: readonly QualificationFieldKey[];
  readonly enrichmentMissingFields: readonly QualificationFieldKey[];
  readonly matchReadinessStatus: LeadMatchReadinessStatus;
  readonly fieldStates: Readonly<Record<QualificationFieldKey, QualificationFieldState>>;
}

export function resolveQualificationSchema(
  category?: string | null,
): CategoryQualificationSchema {
  const normalized = normalize(category);
  return (normalized && CATEGORY_SCHEMAS[normalized]) || BASE_QUALIFICATION_SCHEMA;
}

export function evaluateLeadQualification(
  input: Pick<
    CreateLeadInput,
    | "name"
    | "phone"
    | "city"
    | "area"
    | "service_required"
    | "service_category"
    | "serviceCategory"
    | "budget"
    | "budget_range"
    | "budgetRange"
    | "timeline"
    | "property_type"
    | "share_consent"
  >,
): LeadQualificationSnapshot {
  const service = firstText(
    input.service_required,
    input.service_category,
    input.serviceCategory,
  );
  const schema = resolveQualificationSchema(service);
  const fieldStates = {
    name: textState(input.name),
    phone: textState(input.phone),
    city: textState(input.city),
    area: textState(input.area),
    service: textState(service),
    share_consent: input.share_consent === true ? "confirmed" : "missing",
    budget: answerState(firstText(input.budget, input.budget_range, input.budgetRange)),
    timeline: answerState(input.timeline),
    property_type: answerState(input.property_type),
  } satisfies Record<QualificationFieldKey, QualificationFieldState>;
  const captureCritical = schema.fields.filter(
    (field) => field.importance === "capture_critical",
  );
  const enrichment = schema.fields.filter(
    (field) =>
      field.importance === "match_critical" ||
      field.importance === "ranking_useful",
  );

  const missingCapture = captureCritical
    .filter((field) => fieldStates[field.key] !== "confirmed")
    .map((field) => field.key);
  const enrichmentMissing = enrichment
    .filter((field) => fieldStates[field.key] === "missing")
    .map((field) => field.key);

  const considered = schema.fields.filter(
    (field) => field.importance !== "optional",
  );
  const completed = considered.filter(
    (field) =>
      fieldStates[field.key] === "confirmed" ||
      fieldStates[field.key] === "undecided",
  ).length;
  const completenessPercent = considered.length
    ? Math.round((completed / considered.length) * 100)
    : 100;

  if (missingCapture.length > 0) {
    return {
      journeyState: "captured",
      completenessStatus: "incomplete",
      completenessPercent,
      missingFields: unique([...missingCapture, ...enrichmentMissing]),
      enrichmentMissingFields: enrichmentMissing,
      matchReadinessStatus: "not_ready",
      fieldStates,
    };
  }

  if (enrichmentMissing.length > 0) {
    return {
      journeyState: "enrichment_required",
      completenessStatus: "enrichment_required",
      completenessPercent,
      missingFields: enrichmentMissing,
      enrichmentMissingFields: enrichmentMissing,
      matchReadinessStatus: "needs_enrichment",
      fieldStates,
    };
  }

  return {
    journeyState: "ready_for_qualification",
    completenessStatus: "complete",
    completenessPercent: 100,
    missingFields: [],
    enrichmentMissingFields: [],
    // Data completeness alone never authorizes vendor distribution. Quality,
    // fraud, duplicate, serviceability and consent gates still belong to Core.
    matchReadinessStatus: "not_ready",
    fieldStates,
  };
}

function answerState(value?: string | null): QualificationFieldState {
  const normalized = normalize(value);
  if (!normalized) return "missing";
  if (
    normalized === "not sure yet" ||
    normalized === "not sure" ||
    normalized === "undecided" ||
    normalized === "flexible"
  ) {
    return "undecided";
  }
  if (normalized === "unknown") return "unknown";
  return "confirmed";
}

function textState(value?: string | null): QualificationFieldState {
  return normalize(value) ? "confirmed" : "missing";
}

function firstText(...values: Array<string | null | undefined>): string {
  return values.map((value) => value?.trim()).find(Boolean) ?? "";
}

function normalize(value?: string | null): string {
  return String(value ?? "").trim().toLowerCase();
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
