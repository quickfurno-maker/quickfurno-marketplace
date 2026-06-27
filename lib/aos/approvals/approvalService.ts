import type { ApprovalRequest } from "../types";

export function markApprovalPending(request: ApprovalRequest): ApprovalRequest {
  return {
    ...request,
    status: "pending",
  };
}

