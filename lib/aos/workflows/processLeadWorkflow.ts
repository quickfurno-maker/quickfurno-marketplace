// ============================================================================
// QuickFurno AOS — Phase 2: New Lead Intake (safe preview workflow)
//
// This module is the deterministic, side-effect-free brain that powers the
// POST /api/aos/process-lead endpoint. n8n calls that endpoint during the
// `lead.created` workflow. Here we only *score and preview* a lead.
//
// SAFETY (must remain true in this phase — see lib/aos/config/featureFlags.ts):
//   - No WhatsApp is sent.
//   - No vendor is notified.
//   - No vendor credits are deducted.
//   - No lead is auto-assigned.
//   - No external API is called.
//   - No database write happens (prefer no DB write in Phase 2).
//   - No secret is logged; client phone is masked in logs/responses.
//
// The output is intentionally deterministic so n8n preview branches and local
// PowerShell tests produce stable, reviewable results. Everything is modular
// and reversible: deleting this file plus the route restores Phase 1.
// ============================================================================

import {
  AOS_LEADLENS_ENABLED,
  AOS_OPSBRIEF_ENABLED,
  AOS_TRUSTSHIELD_ENABLED,
} from "@/lib/aos/config/featureFlags";
import { maskPhoneNumber } from "@/lib/aos/tools/whatsappTool";

export const PROCESS_LEAD_WORKFLOW_NAME = "QF-n8n-New-Lead-Intake";
export const PROCESS_LEAD_EVENT_TYPE = "lead.created";

export type LeadQuality = "hot" | "warm" | "cold";
export type SpamRisk = "low" | "medium" | "high";

/** Raw lead fields as sent by n8n / the website forms. All optional/untrusted. */
export interface ProcessLeadInputLead {
  name?: string;
  phone?: string;
  city?: string;
  category?: string;
  budget?: string;
  [key: string]: unknown;
}

/** Full inbound payload for POST /api/aos/process-lead. */
export interface ProcessLeadInput {
  event?: string;
  lead_id?: string;
  leadId?: string;
  source?: string;
  lead?: ProcessLeadInputLead;
  [key: string]: unknown;
}

export interface ProcessLeadAgentsReport {
  trustShield: { status: "accepted" | "review" | "blocked_preview"; spamRisk: SpamRisk };
  leadLens: { status: "scored"; quality: LeadQuality; score: number };
  matchForge: { status: "preview"; suggestions: never[] };
  leadFlow: { status: "preview_only"; assignmentReady: boolean };
  opsBrief: { status: "logged_preview" };
}

export interface ProcessLeadSideEffects {
  whatsappSent: false;
  vendorNotified: false;
  creditsDeducted: false;
  leadAutoAssigned: false;
  databaseWritten: false;
  externalApiCalled: false;
}

export interface ProcessLeadResult {
  ok: true;
  status: "processed_preview";
  eventType: typeof PROCESS_LEAD_EVENT_TYPE;
  workflowName: typeof PROCESS_LEAD_WORKFLOW_NAME;
  leadId: string;
  leadQuality: LeadQuality;
  spamRisk: SpamRisk;
  assignmentReady: false;
  matchedVendorsPreview: never[];
  agents: ProcessLeadAgentsReport;
  sideEffects: ProcessLeadSideEffects;
  message: string;
}

/** Validation outcome for an inbound payload. */
export type ProcessLeadValidation =
  | { ok: true; input: ProcessLeadInput }
  | { ok: false; reason: string };

const PROCESS_LEAD_MESSAGE =
  "Lead processed safely in AOS preview mode. No side effects executed.";

/**
 * Side effects are hard-coded to `false` and asserted against the safety flags
 * so a future accidental flag flip cannot silently turn an effect on here.
 */
function buildSafeSideEffects(): ProcessLeadSideEffects {
  return {
    whatsappSent: false,
    vendorNotified: false,
    creditsDeducted: false,
    leadAutoAssigned: false,
    databaseWritten: false,
    externalApiCalled: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Validate an unknown body into a ProcessLeadInput. We are lenient about the
 * exact event name (n8n may send variants) but require an object with a lead
 * object or a lead id so we never "process" obviously empty/garbage payloads.
 */
export function validateProcessLeadInput(body: unknown): ProcessLeadValidation {
  if (!isRecord(body)) {
    return { ok: false, reason: "Payload must be a JSON object." };
  }

  const lead = isRecord(body.lead) ? (body.lead as ProcessLeadInputLead) : undefined;
  const leadId = asTrimmedString(body.lead_id) || asTrimmedString(body.leadId);

  if (!lead && !leadId) {
    return { ok: false, reason: "Payload must include a `lead` object or a `lead_id`." };
  }

  return {
    ok: true,
    input: {
      event: asTrimmedString(body.event) || PROCESS_LEAD_EVENT_TYPE,
      lead_id: leadId || undefined,
      source: asTrimmedString(body.source) || "n8n-new-lead-intake",
      lead: lead ?? {},
    },
  };
}

function resolveLeadId(input: ProcessLeadInput): string {
  return input.lead_id || input.leadId || "UNKNOWN-LEAD";
}

/**
 * TrustShield preview — deterministic spam-risk heuristic.
 * Rule-based and read-only: it only inspects the supplied lead fields.
 */
function previewSpamRisk(lead: ProcessLeadInputLead): SpamRisk {
  const digits = String(lead.phone ?? "").replace(/\D/g, "");
  const name = asTrimmedString(lead.name);

  // Obviously invalid phone or empty name → higher risk (still no blocking action).
  if (digits.length > 0 && digits.length < 10) return "high";
  if (/^(\d)\1{9,}$/.test(digits)) return "high"; // e.g. 0000000000 / 9999999999 repeated
  if (!name && digits.length === 0) return "high";
  if (!name || digits.length < 10) return "medium";
  return "low";
}

/**
 * LeadLens preview — deterministic quality score (0-100) and label.
 * Pure scoring; nothing is persisted.
 */
function previewLeadScore(lead: ProcessLeadInputLead): { score: number; quality: LeadQuality } {
  let score = 40;

  if (asTrimmedString(lead.name)) score += 10;
  if (String(lead.phone ?? "").replace(/\D/g, "").length >= 10) score += 15;
  if (asTrimmedString(lead.city)) score += 10;
  if (asTrimmedString(lead.category)) score += 10;

  const budget = asTrimmedString(lead.budget).toLowerCase();
  if (budget) {
    score += 5;
    // Heuristic budget boost — larger stated budgets look warmer.
    if (/(10|15|20|25|30|lakh|crore|\+)/.test(budget)) score += 10;
  }

  score = Math.max(0, Math.min(100, score));

  let quality: LeadQuality = "cold";
  if (score >= 80) quality = "hot";
  else if (score >= 60) quality = "warm";

  return { score, quality };
}

/**
 * Run the safe New Lead Intake preview. Deterministic, no side effects.
 * `assignmentReady` is always false in Phase 2 (LeadFlow is preview-only).
 */
export function runProcessLeadPreview(input: ProcessLeadInput): ProcessLeadResult {
  const lead = input.lead ?? {};
  const leadId = resolveLeadId(input);

  const spamRisk = AOS_TRUSTSHIELD_ENABLED ? previewSpamRisk(lead) : "low";
  const { score, quality } = AOS_LEADLENS_ENABLED
    ? previewLeadScore(lead)
    : { score: 0, quality: "cold" as LeadQuality };

  const trustStatus: ProcessLeadAgentsReport["trustShield"]["status"] =
    spamRisk === "high" ? "review" : "accepted";

  return {
    ok: true,
    status: "processed_preview",
    eventType: PROCESS_LEAD_EVENT_TYPE,
    workflowName: PROCESS_LEAD_WORKFLOW_NAME,
    leadId,
    leadQuality: quality,
    spamRisk,
    assignmentReady: false,
    matchedVendorsPreview: [],
    agents: {
      trustShield: { status: trustStatus, spamRisk },
      leadLens: { status: "scored", quality, score },
      // MatchForge only ever suggests in preview; never auto-assigns.
      matchForge: { status: "preview", suggestions: [] },
      // LeadFlow stays preview-only: assignmentReady must remain false here.
      leadFlow: { status: "preview_only", assignmentReady: false },
      opsBrief: { status: "logged_preview" },
    },
    sideEffects: buildSafeSideEffects(),
    message: PROCESS_LEAD_MESSAGE,
  };
}

/**
 * Build a log-safe summary of a lead. Phone is masked; no secrets included.
 * Used for console diagnostics only — never persisted in Phase 2.
 */
export function buildLeadLogSummary(input: ProcessLeadInput): Record<string, unknown> {
  const lead = input.lead ?? {};
  void AOS_OPSBRIEF_ENABLED; // OpsBrief is preview-only; this is the read it would log.
  return {
    leadId: resolveLeadId(input),
    source: input.source ?? "unknown",
    name: asTrimmedString(lead.name) || "unknown",
    maskedPhone: lead.phone ? maskPhoneNumber(lead.phone) : null,
    city: asTrimmedString(lead.city) || "unknown",
    category: asTrimmedString(lead.category) || "unknown",
  };
}
