// QuickFurno Automation Studio — safe visual control-plane contract.
// The UI may compose only registered blocks. Core business authorities stay locked.

export const AUTOMATION_STUDIO_WORKFLOW_KEYS = [
  "client_journey",
  "vendor_journey",
  "campaigns",
  "recovery",
  "orphan_cleanup",
  "stale_cleanup",
] as const;

export type AutomationStudioWorkflowKey =
  (typeof AUTOMATION_STUDIO_WORKFLOW_KEYS)[number];

export type AutomationStudioNodeKind =
  | "trigger"
  | "condition"
  | "core_action"
  | "whatsapp"
  | "wait"
  | "retry"
  | "branch"
  | "control"
  | "stop";

export type AutomationStudioAuthority = "locked_core" | "editable_policy";
export interface AutomationStudioNode {
  id: string;
  kind: AutomationStudioNodeKind;
  label: string;
  description: string;
  authority: AutomationStudioAuthority;
  capability?: string;
  actionType?: string;
  enabled: boolean;
  x: number;
  y: number;
  settings?: Record<string, string | number | boolean | null>;
}

export interface AutomationStudioEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  outcome?: "yes" | "no" | "success" | "failure" | "default";
}

export interface AutomationStudioDefinition {
  schemaVersion: 1;
  workflowKey: AutomationStudioWorkflowKey;
  name: string;
  description: string;
  nodes: AutomationStudioNode[];
  edges: AutomationStudioEdge[];
}

export interface AutomationStudioWorkflowMeta {
  key: AutomationStudioWorkflowKey;
  name: string;
  shortDescription: string;
  runtimeAdapter: string;
  accent: "violet" | "magenta" | "red" | "blue" | "green" | "amber";
}
export const AUTOMATION_STUDIO_WORKFLOWS: readonly AutomationStudioWorkflowMeta[] = [
  { key: "client_journey", name: "Client Journey", shortDescription: "Enquiry → Match → Notify", runtimeAdapter: "client_whatsapp", accent: "violet" },
  { key: "vendor_journey", name: "Vendor Journey", shortDescription: "Onboarding & engagement", runtimeAdapter: "vendor_whatsapp", accent: "magenta" },
  { key: "campaigns", name: "Campaigns", shortDescription: "Governed broadcast execution", runtimeAdapter: "campaign_execution", accent: "red" },
  { key: "recovery", name: "Recovery", shortDescription: "Retry failed automation", runtimeAdapter: "recover_v1 + reconcile_v1", accent: "blue" },
  { key: "orphan_cleanup", name: "Orphan Cleanup", shortDescription: "Cancel orphan jobs", runtimeAdapter: "cancel_orphan_v1", accent: "green" },
  { key: "stale_cleanup", name: "Stale Cleanup", shortDescription: "Cancel stale jobs", runtimeAdapter: "cancel_stale_v1", accent: "amber" },
] as const;

export const AUTOMATION_STUDIO_BLOCKS = [
  { kind: "trigger", label: "Trigger", description: "Start from a certified Core event" },
  { kind: "condition", label: "Condition", description: "Branch on Core-owned facts" },
  { kind: "core_action", label: "Core Action", description: "Run an approved QuickFurno authority" },
  { kind: "whatsapp", label: "WhatsApp", description: "Send an approved template" },
  { kind: "wait", label: "Wait / Delay", description: "Pause for a bounded duration" },
  { kind: "retry", label: "Retry", description: "Use the Core retry policy" },
  { kind: "branch", label: "Branch", description: "Split the flow safely" },
  { kind: "stop", label: "Stop", description: "End the workflow" },
] as const;

const node = (
  id: string,
  kind: AutomationStudioNodeKind,
  label: string,
  description: string,
  authority: AutomationStudioAuthority,
  x: number,
  y: number,
  extras: Partial<AutomationStudioNode> = {},
): AutomationStudioNode => ({ id, kind, label, description, authority, enabled: true, x, y, ...extras });
const clientJourney: AutomationStudioDefinition = {
  schemaVersion: 1,
  workflowKey: "client_journey",
  name: "Client Journey",
  description: "From a new Pune enquiry through quality, matching and vendor delivery.",
  nodes: [
    node("client-trigger", "trigger", "Client Enquiry Received", "New website or WhatsApp enquiry", "locked_core", 300, 24, { capability: "lead_intake" }),
    node("client-validate", "core_action", "Validate Pune + Consent", "Check city, consent and duplicate rules", "locked_core", 300, 98, { capability: "lead_validation" }),
    node("client-quality", "core_action", "Quality Check", "Score and verify the requirement", "locked_core", 300, 172, { capability: "lead_quality" }),
    node("client-clarify", "condition", "Needs Clarification?", "Use Core quality evidence", "locked_core", 300, 246, { capability: "clarification_decision" }),
    node("client-ask", "whatsapp", "Ask Client for More Details", "Send approved clarification message", "editable_policy", 62, 334, { actionType: "client.requirement_collection", settings: { enabled: true } }),
    node("client-wait", "wait", "Wait for Client Response", "Bounded response window", "editable_policy", 62, 408, { settings: { durationMinutes: 1440 } }),
    node("client-resume", "control", "Resume Flow", "Continue after verified response", "locked_core", 62, 482, { capability: "clarification_resume" }),
    node("client-match", "core_action", "Run MatchCore", "Find the best eligible Pune vendors", "locked_core", 538, 334, { capability: "matchcore" }),
    node("client-assign", "core_action", "Assign Vendors", "Canonical assignment authority", "locked_core", 538, 408, { capability: "canonical_assignment", settings: { maxRecipients: 3 } }),
    node("client-credit", "core_action", "Deduct Credits", "Charge one credit per successful assignment", "locked_core", 538, 482, { capability: "credit_wallet" }),
    node("client-notify", "whatsapp", "Notify Vendors", "Send the approved Client Match alert", "editable_policy", 538, 556, { actionType: "vendor.lead_offer", settings: { retryAttempts: 3, retryDelaySeconds: 60, timeoutSeconds: 10 } }),
    node("client-track", "control", "Track Vendor Delivery", "Observe provider and vendor delivery evidence", "locked_core", 300, 646, { capability: "delivery_tracking" }),
  ],
  edges: [
    { id: "c1", from: "client-trigger", to: "client-validate" },
    { id: "c2", from: "client-validate", to: "client-quality" },
    { id: "c3", from: "client-quality", to: "client-clarify" },
    { id: "c4", from: "client-clarify", to: "client-ask", label: "Yes", outcome: "yes" },
    { id: "c5", from: "client-clarify", to: "client-match", label: "No", outcome: "no" },
    { id: "c6", from: "client-ask", to: "client-wait" },
    { id: "c7", from: "client-wait", to: "client-resume" },
    { id: "c8", from: "client-resume", to: "client-track" },
    { id: "c9", from: "client-match", to: "client-assign" },
    { id: "c10", from: "client-assign", to: "client-credit" },
    { id: "c11", from: "client-credit", to: "client-notify" },
    { id: "c12", from: "client-notify", to: "client-track" },
  ],
};
const vendorJourney: AutomationStudioDefinition = {
  schemaVersion: 1,
  workflowKey: "vendor_journey",
  name: "Vendor Journey",
  description: "Vendor onboarding, readiness and governed Client Match notifications.",
  nodes: [
    node("vendor-trigger", "trigger", "Vendor Registered", "New vendor account created", "locked_core", 300, 30, { capability: "vendor_registration" }),
    node("vendor-verify", "core_action", "Verify Vendor", "Admin verification and activation gate", "locked_core", 300, 118, { capability: "vendor_verification" }),
    node("vendor-ready", "condition", "Package + Credits Ready?", "Check active package and available credits", "locked_core", 300, 206, { capability: "vendor_eligibility" }),
    node("vendor-onboard", "whatsapp", "Onboarding Reminder", "Send approved onboarding reminder", "editable_policy", 62, 304, { actionType: "vendor.onboarding_reminder", settings: { enabled: true } }),
    node("vendor-offer", "whatsapp", "Client Match Alert", "Notify vendor about a canonical assignment", "editable_policy", 538, 304, { actionType: "vendor.lead_offer", settings: { retryAttempts: 3, timeoutSeconds: 10 } }),
    node("vendor-expiry", "whatsapp", "Package Expiry Warning", "Warn before package expiry", "editable_policy", 538, 392, { actionType: "vendor.package_expiry_warning", settings: { enabled: true } }),
    node("vendor-credit", "whatsapp", "Low Credit Warning", "Warn when the Core threshold is crossed", "editable_policy", 538, 480, { actionType: "vendor.low_credit_warning", settings: { enabled: true } }),
    node("vendor-stop", "stop", "Stop Safely", "No send when Core eligibility fails", "locked_core", 62, 392, { capability: "fail_closed" }),
  ],
  edges: [
    { id: "v1", from: "vendor-trigger", to: "vendor-verify" },
    { id: "v2", from: "vendor-verify", to: "vendor-ready" },
    { id: "v3", from: "vendor-ready", to: "vendor-offer", label: "Ready", outcome: "yes" },
    { id: "v4", from: "vendor-ready", to: "vendor-onboard", label: "Not ready", outcome: "no" },
    { id: "v5", from: "vendor-onboard", to: "vendor-stop" },
    { id: "v6", from: "vendor-offer", to: "vendor-expiry" },
    { id: "v7", from: "vendor-expiry", to: "vendor-credit" },
  ],
};

const campaigns: AutomationStudioDefinition = {
  schemaVersion: 1,
  workflowKey: "campaigns",
  name: "Campaigns",
  description: "Approved audience execution with consent, suppression and frequency gates.",
  nodes: [
    node("campaign-trigger", "trigger", "Approved Campaign", "Founder/admin approved campaign handoff", "locked_core", 300, 40, { capability: "campaign_approval" }),
    node("campaign-audience", "core_action", "Freeze Audience", "Use the approved evidence snapshot", "locked_core", 300, 132, { capability: "campaign_audience" }),
    node("campaign-policy", "condition", "Policy Allows Send?", "Consent, suppression and frequency recheck", "locked_core", 300, 224, { capability: "campaign_policy" }),
    node("campaign-send", "whatsapp", "Execute Recipient", "Provider-neutral governed recipient execution", "editable_policy", 538, 320, { actionType: "campaign.execute_recipient", settings: { enabled: true } }),
    node("campaign-stop", "stop", "Skip Recipient", "Stop without provider execution", "locked_core", 62, 320, { capability: "campaign_refusal" }),
    node("campaign-track", "control", "Track Delivery", "Observe message lifecycle and completion", "locked_core", 538, 412, { capability: "delivery_tracking" }),
  ],
  edges: [
    { id: "m1", from: "campaign-trigger", to: "campaign-audience" },
    { id: "m2", from: "campaign-audience", to: "campaign-policy" },
    { id: "m3", from: "campaign-policy", to: "campaign-send", label: "Allowed", outcome: "yes" },
    { id: "m4", from: "campaign-policy", to: "campaign-stop", label: "Blocked", outcome: "no" },
    { id: "m5", from: "campaign-send", to: "campaign-track" },
  ],
};
const recovery: AutomationStudioDefinition = {
  schemaVersion: 1,
  workflowKey: "recovery",
  name: "Recovery",
  description: "Recover retryable jobs and reconcile uncertain attempts without business decisions.",
  nodes: [
    node("recovery-trigger", "trigger", "Recovery Tick", "One-minute supervisor cadence", "editable_policy", 300, 48, { settings: { intervalMinutes: 1 } }),
    node("recovery-recover", "core_action", "Recover Eligible Jobs", "Core selects due retry work", "locked_core", 300, 146, { capability: "recover_v1" }),
    node("recovery-condition", "condition", "Reconcile Due?", "Five-minute reconciliation cadence", "editable_policy", 300, 244, { settings: { intervalMinutes: 5 } }),
    node("recovery-reconcile", "core_action", "Reconcile Attempts", "Core resolves stale attempt state", "locked_core", 538, 342, { capability: "reconcile_v1" }),
    node("recovery-stop", "stop", "Cycle Complete", "No additional authority in n8n", "locked_core", 300, 446, { capability: "stop" }),
  ],
  edges: [
    { id: "r1", from: "recovery-trigger", to: "recovery-recover" },
    { id: "r2", from: "recovery-recover", to: "recovery-condition" },
    { id: "r3", from: "recovery-condition", to: "recovery-reconcile", label: "Due", outcome: "yes" },
    { id: "r4", from: "recovery-condition", to: "recovery-stop", label: "Not due", outcome: "no" },
    { id: "r5", from: "recovery-reconcile", to: "recovery-stop" },
  ],
};

const orphanCleanup: AutomationStudioDefinition = {
  schemaVersion: 1,
  workflowKey: "orphan_cleanup",
  name: "Orphan Cleanup",
  description: "Cancel due jobs whose mapped business entity no longer exists.",
  nodes: [
    node("orphan-trigger", "trigger", "Orphan Sweep Tick", "Five-minute supervisor cadence", "editable_policy", 300, 54, { settings: { intervalMinutes: 5 } }),
    node("orphan-select", "core_action", "Select One Orphan", "Core-only entity existence proof", "locked_core", 300, 158, { capability: "cancel_orphan_v1" }),
    node("orphan-cancel", "core_action", "Cancel Safely", "Terminalize without provider execution", "locked_core", 300, 262, { capability: "orphan_cancellation" }),
    node("orphan-stop", "stop", "Cycle Complete", "No business row is changed", "locked_core", 300, 366, { capability: "stop" }),
  ],
  edges: [
    { id: "o1", from: "orphan-trigger", to: "orphan-select" },
    { id: "o2", from: "orphan-select", to: "orphan-cancel" },
    { id: "o3", from: "orphan-cancel", to: "orphan-stop" },
  ],
};

const staleCleanup: AutomationStudioDefinition = {
  schemaVersion: 1,
  workflowKey: "stale_cleanup",
  name: "Stale Cleanup",
  description: "Terminalize provably stale pre-execution business jobs under locked evidence.",
  nodes: [
    node("stale-trigger", "trigger", "Stale Sweep Tick", "Five-minute supervisor cadence", "editable_policy", 300, 54, { settings: { intervalMinutes: 5 } }),
    node("stale-proof", "core_action", "Prove Business State", "Lock, prove and recheck current business facts", "locked_core", 300, 158, { capability: "stale_business_proof" }),
    node("stale-cancel", "core_action", "Terminalize Stale Job", "Core writes the governed cancellation", "locked_core", 300, 262, { capability: "cancel_stale_v1" }),
    node("stale-stop", "stop", "Cycle Complete", "No provider call or attempt is opened", "locked_core", 300, 366, { capability: "stop" }),
  ],
  edges: [
    { id: "s1", from: "stale-trigger", to: "stale-proof" },
    { id: "s2", from: "stale-proof", to: "stale-cancel" },
    { id: "s3", from: "stale-cancel", to: "stale-stop" },
  ],
};
export const DEFAULT_AUTOMATION_STUDIO_DEFINITIONS: Readonly<Record<AutomationStudioWorkflowKey, AutomationStudioDefinition>> = Object.freeze({
  client_journey: clientJourney,
  vendor_journey: vendorJourney,
  campaigns,
  recovery,
  orphan_cleanup: orphanCleanup,
  stale_cleanup: staleCleanup,
});

export function cloneAutomationStudioDefinition(
  workflowKey: AutomationStudioWorkflowKey,
): AutomationStudioDefinition {
  return JSON.parse(JSON.stringify(DEFAULT_AUTOMATION_STUDIO_DEFINITIONS[workflowKey])) as AutomationStudioDefinition;
}

export type AutomationStudioValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

const ALLOWED_ACTIONS_BY_WORKFLOW: Readonly<Record<AutomationStudioWorkflowKey, readonly string[]>> = Object.freeze({
  client_journey: [
    "client.lead_confirmation",
    "client.requirement_collection",
    "client.missing_information_reminder",
    "client.matching_update",
    "client.lead_status_update",
    "client.transactional_followup",
    "vendor.lead_offer",
  ],
  vendor_journey: [
    "vendor.lead_offer",
    "vendor.onboarding_reminder",
    "vendor.document_reminder",
    "vendor.package_expiry_warning",
    "vendor.low_credit_warning",
  ],
  campaigns: ["campaign.execute_batch", "campaign.execute_recipient"],
  recovery: [],
  orphan_cleanup: [],
  stale_cleanup: [],
});

const PROTECTED_DOMINANCE_PAIRS: Readonly<Record<AutomationStudioWorkflowKey, readonly (readonly [string, string])[]>> = Object.freeze({
  client_journey: [
    ["client-validate", "client-quality"],
    ["client-quality", "client-clarify"],
    ["client-clarify", "client-match"],
    ["client-match", "client-assign"],
    ["client-assign", "client-credit"],
    ["client-clarify", "client-track"],
  ],
  vendor_journey: [["vendor-verify", "vendor-ready"]],
  campaigns: [["campaign-audience", "campaign-policy"], ["campaign-policy", "campaign-track"]],
  recovery: [["recovery-recover", "recovery-reconcile"]],
  orphan_cleanup: [["orphan-select", "orphan-cancel"], ["orphan-cancel", "orphan-stop"]],
  stale_cleanup: [["stale-proof", "stale-cancel"], ["stale-cancel", "stale-stop"]],
});

function reachable(
  definition: AutomationStudioDefinition,
  startId: string,
  targetId: string,
  skipId?: string,
): boolean {
  if (startId === skipId) return false;
  const queue = [startId];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (current === skipId || seen.has(current)) continue;
    if (current === targetId) return true;
    seen.add(current);
    for (const edge of definition.edges) {
      if (edge.from === current && edge.to !== skipId) queue.push(edge.to);
    }
  }
  return false;
}

export function validateAutomationStudioDefinition(
  input: AutomationStudioDefinition,
): AutomationStudioValidationResult {
  const errors: string[] = [];
  if (input.schemaVersion !== 1) errors.push("Unsupported workflow schema version.");
  if (!AUTOMATION_STUDIO_WORKFLOW_KEYS.includes(input.workflowKey)) errors.push("Unknown workflow key.");
  if (!Array.isArray(input.nodes) || input.nodes.length < 2) errors.push("A workflow needs at least two nodes.");
  if (!Array.isArray(input.edges)) errors.push("Workflow edges are required.");

  const ids = new Set<string>();
  const edgeIds = new Set<string>();
  for (const workflowNode of input.nodes ?? []) {
    if (!workflowNode.id || ids.has(workflowNode.id)) errors.push(`Duplicate or missing node id: ${workflowNode.id || "<empty>"}.`);
    ids.add(workflowNode.id);
    if (!workflowNode.label?.trim()) errors.push(`Node ${workflowNode.id} needs a label.`);
    if (workflowNode.authority === "locked_core" && workflowNode.enabled === false) {
      errors.push(`Locked Core node ${workflowNode.label} cannot be disabled.`);
    }
    if (workflowNode.kind === "whatsapp") {
      if (!workflowNode.actionType) errors.push(`WhatsApp step ${workflowNode.label} needs a certified Core action.`);
      else if (!ALLOWED_ACTIONS_BY_WORKFLOW[input.workflowKey]?.includes(workflowNode.actionType)) {
        errors.push(`Action ${workflowNode.actionType} is not allowed in ${input.workflowKey}.`);
      }
    }
  }

  for (const edge of input.edges ?? []) {
    if (!edge.id || edgeIds.has(edge.id)) errors.push(`Duplicate or missing edge id: ${edge.id || "<empty>"}.`);
    edgeIds.add(edge.id);
    if (!ids.has(edge.from) || !ids.has(edge.to)) errors.push(`Edge ${edge.id} references a missing node.`);
    if (edge.from === edge.to) errors.push(`Edge ${edge.id} cannot loop to itself.`);
  }

  const canonical = DEFAULT_AUTOMATION_STUDIO_DEFINITIONS[input.workflowKey];
  if (canonical) {
    const canonicalLocked = canonical.nodes.filter((item) => item.authority === "locked_core");
    const lockedIds = new Set(canonicalLocked.map((item) => item.id));
    for (const required of canonicalLocked) {
      const actual = input.nodes.find((item) => item.id === required.id);
      if (!actual) {
        errors.push(`Required Core step ${required.label} is missing.`);
        continue;
      }
      if (
        actual.authority !== "locked_core" ||
        actual.kind !== required.kind ||
        actual.label !== required.label ||
        actual.description !== required.description ||
        actual.capability !== required.capability ||
        actual.actionType !== required.actionType ||
        actual.enabled !== true
      ) {
        errors.push(`Locked Core step ${required.label} was modified outside its safe layout fields.`);
      }
    }
    for (const actual of input.nodes.filter((item) => item.authority === "locked_core")) {
      if (!lockedIds.has(actual.id)) errors.push(`Unregistered locked Core step ${actual.label} is not permitted.`);
    }
  }

  const triggers = input.nodes.filter((item) => item.kind === "trigger");
  if (triggers.length !== 1) errors.push("A workflow must contain exactly one trigger.");
  const trigger = triggers[0];
  if (!input.nodes.some((item) => item.kind === "stop" || item.kind === "control")) {
    errors.push("A workflow needs a terminal or tracking node.");
  }

  if (trigger) {
    for (const workflowNode of input.nodes) {
      if (!reachable(input, trigger.id, workflowNode.id)) errors.push(`Step ${workflowNode.label} is not reachable from the trigger.`);
      if (workflowNode.kind !== "stop" && workflowNode.kind !== "control") {
        const outgoing = input.edges.filter((edge) => edge.from === workflowNode.id);
        if ((workflowNode.kind === "condition" || workflowNode.kind === "branch") && workflowNode.authority === "editable_policy") {
          if (!outgoing.some((edge) => edge.outcome === "yes") || !outgoing.some((edge) => edge.outcome === "no")) {
            errors.push(`Branch step ${workflowNode.label} needs both Yes and No paths.`);
          }
        }
      }
    }

    for (const [dominantId, protectedId] of PROTECTED_DOMINANCE_PAIRS[input.workflowKey] ?? []) {
      if (!ids.has(dominantId) || !ids.has(protectedId)) continue;
      if (!reachable(input, trigger.id, protectedId)) continue;
      if (reachable(input, trigger.id, protectedId, dominantId)) {
        const dominant = input.nodes.find((item) => item.id === dominantId)?.label ?? dominantId;
        const protectedNode = input.nodes.find((item) => item.id === protectedId)?.label ?? protectedId;
        errors.push(`${protectedNode} cannot bypass required Core step ${dominant}.`);
      }
    }

    const actionDominators: Array<[string, string]> = input.workflowKey === "client_journey"
      ? [["vendor.lead_offer", "client-credit"], ["client.requirement_collection", "client-clarify"]]
      : input.workflowKey === "vendor_journey"
        ? [["vendor.lead_offer", "vendor-ready"]]
        : input.workflowKey === "campaigns"
          ? [["campaign.execute_batch", "campaign-policy"], ["campaign.execute_recipient", "campaign-policy"]]
          : [];
    for (const [actionType, dominantId] of actionDominators) {
      for (const actionNode of input.nodes.filter((item) => item.actionType === actionType)) {
        if (ids.has(dominantId) && reachable(input, trigger.id, actionNode.id, dominantId)) {
          const dominant = input.nodes.find((item) => item.id === dominantId)?.label ?? dominantId;
          errors.push(`${actionNode.label} cannot execute before required Core step ${dominant}.`);
        }
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const hasCycle = (nodeId: string): boolean => {
      if (visiting.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;
      visiting.add(nodeId);
      for (const edge of input.edges.filter((item) => item.from === nodeId)) {
        if (hasCycle(edge.to)) return true;
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    };
    if (hasCycle(trigger.id)) errors.push("Published workflows cannot contain cycles. Use Retry or Wait policy blocks instead.");
  }

  return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true };
}
export interface AutomationStudioVersionSummary {
  version: number;
  publishedAt: string;
  publishedBy: string;
  changeSummary: string;
  definition: AutomationStudioDefinition;
}

export interface AutomationStudioWorkflowRuntime {
  key: AutomationStudioWorkflowKey;
  name: string;
  shortDescription: string;
  runtimeAdapter: string;
  accent: AutomationStudioWorkflowMeta["accent"];
  enabled: boolean;
  health: "healthy" | "paused" | "unknown" | "degraded";
  queue: number;
  successRate24h: number | null;
  completed24h: number;
  failed24h: number;
  lastRunAt: string | null;
  currentVersion: number;
  draftDefinition: AutomationStudioDefinition;
  publishedDefinition: AutomationStudioDefinition;
  versions: AutomationStudioVersionSummary[];
}

export interface AutomationStudioExecutionRow {
  id: string;
  workflowKey: AutomationStudioWorkflowKey | "unknown";
  actionType: string | null;
  status: string;
  currentStep: string;
  startedAt: string;
  updatedAt: string;
  attemptCount: number;
}

export interface AutomationStudioOverview {
  ok: true;
  globalEnabled: boolean;
  transport: {
    mode: "off" | "staging" | "production" | "invalid";
    healthy: boolean;
    workerId: string | null;
    lastSeenAt: string | null;
    routeCalls30m: number;
  };
  workflows: AutomationStudioWorkflowRuntime[];
  executions: AutomationStudioExecutionRow[];
  queueTotal: number;
  generatedAt: string;
}
export function isAutomationStudioWorkflowKey(value: unknown): value is AutomationStudioWorkflowKey {
  return typeof value === "string" && (AUTOMATION_STUDIO_WORKFLOW_KEYS as readonly string[]).includes(value);
}

export interface AutomationStudioSimulationResult {
  ok: true;
  workflowKey: AutomationStudioWorkflowKey;
  visited: Array<{ nodeId: string; label: string; kind: AutomationStudioNodeKind; authority: AutomationStudioAuthority }>;
  notes: string[];
}

export function simulateAutomationStudioDefinition(
  definition: AutomationStudioDefinition,
): AutomationStudioSimulationResult | { ok: false; errors: string[] } {
  const validation = validateAutomationStudioDefinition(definition);
  if (!validation.ok) return validation;
  const trigger = definition.nodes.find((item) => item.kind === "trigger")!;
  const byId = new Map(definition.nodes.map((item) => [item.id, item]));
  const visited: AutomationStudioSimulationResult["visited"] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  let current: AutomationStudioNode | undefined = trigger;
  while (current && !seen.has(current.id) && visited.length < 50) {
    seen.add(current.id);
    visited.push({ nodeId: current.id, label: current.label, kind: current.kind, authority: current.authority });
    if (current.authority === "locked_core") notes.push(`${current.label}: Core authority remains locked.`);
    const outgoing = definition.edges.filter((edge) => edge.from === current!.id);
    if (!outgoing.length) break;
    const nextEdge = outgoing.find((edge) => edge.outcome === "no" || edge.outcome === "success" || edge.outcome === "default") ?? outgoing[0];
    current = byId.get(nextEdge.to);
  }
  if (current && seen.has(current.id)) notes.push("Simulation stopped before a cycle could repeat.");
  notes.push("Simulation performs no database mutation, provider send, assignment or credit change.");
  return { ok: true, workflowKey: definition.workflowKey, visited, notes };
}
