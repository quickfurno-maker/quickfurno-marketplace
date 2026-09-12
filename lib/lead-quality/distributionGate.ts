// QuickFurno canonical lead-distribution gate.
// Pure and I/O-free so Core services and offline certification use one rule.
export interface LeadDistributionGateInput {
  total_score: number;
  score_class: string;
  hard_block_reason: string | null;
  recommended_action: string;
}

export function canAutoDistributeLead(
  scoreResult: LeadDistributionGateInput,
): boolean {
  return scoreResult.total_score >= 70
    && (scoreResult.score_class === "A" || scoreResult.score_class === "A+")
    && !scoreResult.hard_block_reason
    && scoreResult.recommended_action === "auto_distribute";
}
