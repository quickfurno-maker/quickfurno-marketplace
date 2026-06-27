// ============================================================================
// QuickFurno AOS → CRM sync service (Phase 6 façade · Phase 7 real engines)
// Thin integration layer between the rule-based AOS engines and the CRM /
// Analytics UI. Still 100% safe: no real AI, no WhatsApp, no n8n, no credit
// deduction, no auto-assignment. When AI is enabled+configured server-side, the
// engines will become the fallback; today they are the only path.
// ============================================================================

import {
  runLeadFlow,
  runLeadLens,
  runMatchForge,
  runTrustShield,
  type LeadFlowResult,
  type LeadLensResult,
  type MatchForgeResult,
  type MatchForgeVendor,
  type TrustShieldResult,
} from "@/lib/aos/agents/engines";
import type { CRMLead } from "@/lib/crm/types";

// Standard labels reused across CRM / Analytics / AOS UI.
export const AOS_LABELS = {
  aiNotActive: "AI not active yet",
  placeholderDecision: "Placeholder decision",
  ruleBasedFallback: "Rule-based fallback",
  noWhatsApp: "No WhatsApp sent",
  noCredits: "No credits deducted",
  notActive: "not_active",
} as const;

export interface AosTimelineEntry {
  agent: string;
  action: string;
  decision: string;
  mode: string;
  label: string;
}

export interface LeadAosSnapshot {
  leadId: string;
  leadLens: LeadLensResult;
  trustShield: TrustShieldResult;
  matchForge: MatchForgeResult;
  leadFlow: LeadFlowResult;
  timeline: AosTimelineEntry[];
}

// Aggregate rule-based AOS snapshot for a lead. `vendors` powers MatchForge
// suggestions; omit it to skip vendor suggestions safely.
export function getLeadAosSnapshot(lead: CRMLead, vendors: MatchForgeVendor[] = []): LeadAosSnapshot {
  const leadLens = runLeadLens(lead);
  const trustShield = runTrustShield(lead);
  const matchForge = runMatchForge(lead, vendors);
  const leadFlow = runLeadFlow(lead, matchForge);

  const timeline: AosTimelineEntry[] = [
    { agent: leadLens.agent, action: "lead_quality_score", decision: `Score ${leadLens.lead_score} (${leadLens.lead_quality})`, mode: leadLens.mode, label: AOS_LABELS.ruleBasedFallback },
    { agent: trustShield.agent, action: "spam_duplicate_check", decision: `Spam ${trustShield.spam_risk} · Duplicate ${trustShield.duplicate_risk}${trustShield.review_recommended ? " · review recommended" : ""}`, mode: trustShield.mode, label: AOS_LABELS.ruleBasedFallback },
    { agent: matchForge.agent, action: "vendor_suggestion", decision: matchForge.reason, mode: matchForge.mode, label: AOS_LABELS.ruleBasedFallback },
    { agent: leadFlow.agent, action: "assignment_preview", decision: leadFlow.reason, mode: leadFlow.mode, label: AOS_LABELS.placeholderDecision },
  ];

  return { leadId: lead.id, leadLens, trustShield, matchForge, leadFlow, timeline };
}

// Re-export engine entry points for convenience.
export { runLeadLens, runTrustShield, runMatchForge, runLeadFlow };
export { runOpsBrief, type OpsBriefReport } from "@/lib/aos/agents/engines";
