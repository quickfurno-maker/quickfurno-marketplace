import type { FutureAgentResult } from "../../types";
import { seoScoutAgentConfig } from "./agent.config";
import type { SeoScoutInput, SeoScoutOutput } from "./schema";

// QF-AOS-SEOScout — FUTURE INACTIVE placeholder service.
// SAFETY: This function performs NO real work. It does not call AI, does not
// read/write Supabase, does not send WhatsApp, does not call n8n, does not
// deduct credits, and does not change any lead/vendor/client data.
// TODO(activation): when this agent is activated in a future phase, implement
//   real logic behind feature flags + admin approval, AI optional with a
//   rule-based fallback, and never enable side effects by default.
export async function runSeoScout(input: SeoScoutInput = {}): Promise<FutureAgentResult> {
  const output: SeoScoutOutput = {
    status: "future_inactive",
    message: "QF-AOS-SEOScout is a future inactive placeholder. No action was taken.",
  };

  return {
    agentName: seoScoutAgentConfig.name,
    status: "future_inactive",
    mode: "placeholder",
    summary: output.message,
    data: { input, output },
    warnings: ["Agent is inactive (Phase 1D). Activation requires a future phase and admin approval."],
    executedSideEffects: false,
    requiresAdminApproval: true,
    createdAt: new Date().toISOString(),
  };
}

export default runSeoScout;
