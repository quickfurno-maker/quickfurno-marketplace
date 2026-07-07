import { createClarificationRequestForLead } from "../../../../../services/leadClarificationService";
import type {
  LeadLifecycleClarificationMetadata,
  LeadLifecycleClarificationPort,
} from "./leadLifecycleServicePorts";

export class LeadClarificationServiceAdapter implements LeadLifecycleClarificationPort {
  async prepareClarification(leadId: string): Promise<LeadLifecycleClarificationMetadata> {
    const result = await createClarificationRequestForLead(leadId);
    if (!result.ok) throw new Error(result.code);

    const request = result.data;
    return {
      requestId: request.id,
      status: request.status ?? null,
      missingFields: request.missing_fields ?? [],
      questionsCount: request.questions_json?.length ?? 0,
    };
  }
}
