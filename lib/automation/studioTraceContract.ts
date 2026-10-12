// Read-only Automation Studio execution evidence. These are persisted facts,
// NOT a replay of a draft workflow or proof of external provider delivery.
export function isAutomationTraceJobId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export type AutomationTraceState = "observed" | "succeeded" | "failed" | "cancelled" | "waiting" | "unknown";
export type AutomationTraceSource = "core" | "queue" | "worker" | "transport";

export interface AutomationTraceEvent {
  readonly id: string;
  readonly at: string;
  readonly source: AutomationTraceSource;
  readonly title: string;
  readonly detail: string;
  readonly state: AutomationTraceState;
  readonly safeCode: string | null;
}

export interface AutomationStudioExecutionTrace {
  readonly ok: true;
  readonly jobId: string;
  readonly actionRequestId: string;
  readonly actionType: string;
  readonly workflowKey: string;
  readonly entityType: string;
  readonly correlationId: string | null;
  readonly jobStatus: string;
  readonly decisionStatus: string;
  readonly events: readonly AutomationTraceEvent[];
  readonly coverage: "core_queue" | "core_queue_worker" | "core_queue_transport" | "core_queue_worker_transport";
  readonly evidenceTruncated: boolean;
  readonly providerDeliveryVerified: false;
  readonly notice: string;
}

// The database returns arbitrary strings. Do not surface details that could
// contain user text or other untrusted provider payloads as trace labels.
export function safeTraceCode(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,100}$/.test(value)) return null;
  return value;
}

export function traceStateForStatus(value: unknown): AutomationTraceState {
  if (value === "authorized") return "observed";
  if (value === "succeeded" || value === "completed") return "succeeded";
  if (value === "failed" || value === "dead_letter" || value === "refused" || value === "denied") return "failed";
  if (value === "cancelled" || value === "canceled") return "cancelled";
  if (value === "uncertain") return "unknown";
  if (value === "processing" || value === "pending" || value === "retry_scheduled") return "waiting";
  return "unknown";
}

export function sortTraceEvents(events: readonly AutomationTraceEvent[]): AutomationTraceEvent[] {
  return [...events].sort((a, b) => {
    const time = Date.parse(a.at) - Date.parse(b.at);
    return time || a.id.localeCompare(b.id);
  });
}
