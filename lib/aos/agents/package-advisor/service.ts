import type { FutureAgentResult } from "../../types";
import { packageAdvisorAgentConfig } from "./agent.config";
import type { PackageAdvisorInput, PackageAdvisorOutput } from "./schema";

// QF-AOS-PackageAdvisor — FUTURE INACTIVE placeholder service.
// SAFETY: This function performs NO real work. It does not call AI, does not
// read/write Supabase, does not send WhatsApp, does not call n8n, does not
// deduct credits, and does not change any lead/vendor/client data.
// TODO(activation): when this agent is activated in a future phase, implement
//   real logic behind feature flags + admin approval, AI optional with a
//   rule-based fallback, and never enable side effects by default.
export async function runPackageAdvisor(input: PackageAdvisorInput = {}): Promise<FutureAgentResult> {
  const output: PackageAdvisorOutput = {
    status: "future_inactive",
    message: "QF-AOS-PackageAdvisor is a future inactive placeholder. No action was taken.",
  };

  return {
    agentName: packageAdvisorAgentConfig.name,
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

export default runPackageAdvisor;
