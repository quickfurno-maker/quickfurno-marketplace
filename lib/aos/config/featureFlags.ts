// ============================================================================
// QuickFurno AOS feature flags (Phase 7)
// Central, safe-by-default switches for gradually activating AOS agents.
//
// SAFETY DEFAULTS (do not flip without an explicit, reviewed phase):
//   - AI is OFF until configured server-side → rule-based fallback is used.
//   - WhatsApp sending is OFF.
//   - Credit deduction is OFF.
//   - Auto lead assignment is OFF (MatchForge only suggests).
//
// These are plain constants so they are safe to import from both server and
// client code. They expose NO secrets. The presence/absence of a real AI key is
// checked server-side only (see isAiConfigured) and never shipped to the client.
// ============================================================================

// --- Per-agent activation (first 5 agents, activated one by one) ---
export const AOS_LEADLENS_ENABLED = true;
export const AOS_TRUSTSHIELD_ENABLED = true;
export const AOS_MATCHFORGE_ENABLED = true;
export const AOS_LEADFLOW_ENABLED = true; // preparation / preview mode only
export const AOS_OPSBRIEF_ENABLED = true;

// --- Global execution mode ---
export const AOS_AI_ENABLED = false; // real AI stays OFF until explicitly configured
export const AOS_RULE_BASED_FALLBACK_ENABLED = true;

// --- Hard safety switches (must remain false in this phase) ---
export const N8N_ENABLED = false;
export const N8N_OUTBOUND_WEBHOOK_ENABLED = false;
export const WHATSAPP_SENDING_ENABLED = false;
export const CREDIT_DEDUCTION_ENABLED = false;
export const AUTO_ASSIGNMENT_ENABLED = false;

export const AOS_WHATSAPP_SENDING_ENABLED = WHATSAPP_SENDING_ENABLED;
export const AOS_CREDIT_DEDUCTION_ENABLED = CREDIT_DEDUCTION_ENABLED;
export const AOS_AUTO_ASSIGNMENT_ENABLED = AUTO_ASSIGNMENT_ENABLED;

export type AosAgentMode = "ai" | "rule_based" | "disabled";

// Resolve the runtime mode for an agent given its enable flag.
// AI is only used when both the agent and AI are enabled; otherwise we fall back
// to deterministic rule-based logic when the fallback flag is on.
export function agentRuntimeMode(enabled: boolean): AosAgentMode {
  if (!enabled) return "disabled";
  if (AOS_AI_ENABLED && isAiConfigured()) return "ai";
  if (AOS_RULE_BASED_FALLBACK_ENABLED) return "rule_based";
  return "disabled";
}

// Server-only check for an AI provider key. Returns false on the client and
// whenever no key is present, so no key is ever exposed to the browser.
// TODO(aos-ai): when enabling real AI, read the key here on the server only and
// call the provider from a server action — never from the frontend.
export function isAiConfigured(): boolean {
  if (typeof window !== "undefined") return false; // never on the client
  const key = process.env.AOS_AI_PROVIDER_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  return Boolean(key && key.trim().length > 0);
}

// Human-readable status label for an agent, for the AOS control center.
export function agentStatusLabel(enabled: boolean, preview = false): string {
  const mode = agentRuntimeMode(enabled);
  if (mode === "disabled") return "Disabled";
  if (preview) return "Preview only (rule-based)";
  return mode === "ai" ? "Active (AI)" : "Active (rule-based fallback)";
}

// Snapshot of all flags for display in the AOS control center.
export const AOS_FEATURE_FLAGS: Array<{ key: string; value: boolean; note: string }> = [
  { key: "AOS_LEADLENS_ENABLED", value: AOS_LEADLENS_ENABLED, note: "Lead scoring (rule-based)" },
  { key: "AOS_TRUSTSHIELD_ENABLED", value: AOS_TRUSTSHIELD_ENABLED, note: "Spam/duplicate risk (rule-based)" },
  { key: "AOS_MATCHFORGE_ENABLED", value: AOS_MATCHFORGE_ENABLED, note: "Vendor suggestions only (no assignment)" },
  { key: "AOS_LEADFLOW_ENABLED", value: AOS_LEADFLOW_ENABLED, note: "Preview only (no side effects)" },
  { key: "AOS_OPSBRIEF_ENABLED", value: AOS_OPSBRIEF_ENABLED, note: "Read-only daily report" },
  { key: "AOS_AI_ENABLED", value: AOS_AI_ENABLED, note: "Real AI off until configured" },
  { key: "AOS_RULE_BASED_FALLBACK_ENABLED", value: AOS_RULE_BASED_FALLBACK_ENABLED, note: "Deterministic fallback" },
  { key: "N8N_ENABLED", value: N8N_ENABLED, note: "Disabled - foundation only" },
  { key: "N8N_OUTBOUND_WEBHOOK_ENABLED", value: N8N_OUTBOUND_WEBHOOK_ENABLED, note: "Disabled - no webhook calls" },
  { key: "WHATSAPP_SENDING_ENABLED", value: WHATSAPP_SENDING_ENABLED, note: "Disabled - no messages" },
  { key: "CREDIT_DEDUCTION_ENABLED", value: CREDIT_DEDUCTION_ENABLED, note: "Disabled - no charges" },
  { key: "AUTO_ASSIGNMENT_ENABLED", value: AUTO_ASSIGNMENT_ENABLED, note: "Disabled - suggestions only" },
  { key: "AOS_WHATSAPP_SENDING_ENABLED", value: AOS_WHATSAPP_SENDING_ENABLED, note: "Disabled — no messages" },
  { key: "AOS_CREDIT_DEDUCTION_ENABLED", value: AOS_CREDIT_DEDUCTION_ENABLED, note: "Disabled — no charges" },
  { key: "AOS_AUTO_ASSIGNMENT_ENABLED", value: AOS_AUTO_ASSIGNMENT_ENABLED, note: "Disabled — suggestions only" },
];
