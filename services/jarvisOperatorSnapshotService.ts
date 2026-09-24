import "server-only";

import { adminClient } from "@/lib/supabase";
import {
  QFJ_OPERATOR_SNAPSHOT_PROTOCOL,
  parseQfjOperatorSnapshot,
  type QfjOperatorSnapshot,
} from "@/lib/jarvis/operatorSnapshotContract";

const APPROVAL_LIMIT = 100;
const CONVERSATION_LIMIT = 100;
const ACTIVITY_HOURS = 24;

function safeLabel(value: unknown, fallback = "—"): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return (text || fallback).slice(0, 160);
}

function approvalRisk(action: string):
  "informational"|"low-risk-reversible"|"client-or-vendor-facing"|"money-related"|"high-risk" {
  const value = action.toLowerCase();
  if (/(payment|refund|credit|package|price|billing)/.test(value)) return "money-related";
  if (/(delete|suppress|ban|disable|identity|merge)/.test(value)) return "high-risk";
  if (/(whatsapp|message|notify|reminder|outreach|vendor|client)/.test(value)) {
    return "client-or-vendor-facing";
  }
  return "low-risk-reversible";
}

type CountFilter =
  | readonly ["eq", string, unknown]
  | readonly ["gte", string, string]
  | readonly ["lt", string, string]
  | readonly ["in", string, readonly unknown[]];

async function countRows(table: string, filters: readonly CountFilter[] = []): Promise<number> {
  let query: any = adminClient().from(table).select("id", { count: "exact", head: true });
  for (const [kind, column, value] of filters) {
    if (kind === "eq") query = query.eq(column, value);
    else if (kind === "gte") query = query.gte(column, value);
    else if (kind === "lt") query = query.lt(column, value);
    else query = query.in(column, value);
  }
  const result = await query;
  if (result.error) throw result.error;
  return Math.max(0, Number(result.count ?? 0));
}

async function conversationSeries(now: Date) {
  const buckets = Array.from({ length: ACTIVITY_HOURS }, (_, index) => {
    const hoursAgo = ACTIVITY_HOURS - 1 - index;
    const start = new Date(now.getTime() - hoursAgo * 3_600_000);
    start.setUTCMinutes(0, 0, 0);
    return { start, end: new Date(start.getTime() + 3_600_000) };
  });
  const counts = await Promise.all(
    buckets.map(({ start, end }) =>
      countRows("communication_inbound_messages", [
        ["gte", "received_at", start.toISOString()],
        ["lt", "received_at", end.toISOString()],
      ]),
    ),
  );
  return buckets.map(({ start }, index) => ({
    label: start.toISOString().slice(11, 16),
    value: counts[index] ?? 0,
  }));
}

export async function readJarvisOperatorSnapshot(): Promise<QfjOperatorSnapshot> {
  const db = adminClient();
  const now = new Date();
  const since24h = new Date(now.getTime() - 86_400_000).toISOString();

  const [
    approvals,
    conversations,
    requested,
    authorized,
    rejected,
    riya,
    anisha,
    aarohi,
    human,
    prospects,
    activeVendors,
    humanTakeovers,
    jobsPending,
    jobsProcessing,
    jobsSucceeded,
    jobsFailed,
    jobsUncertain,
    activity,
  ] = await Promise.all([
    db.from("automation_action_requests")
      .select("id,action_type,entity_type,source,decision_status,requested_at")
      .order("requested_at", { ascending: false }).limit(APPROVAL_LIMIT),
    db.from("communication_conversations")
      .select("id,destination_masked,subject_type,assigned_actor,state,human_takeover,revision,updated_at")
      .order("updated_at", { ascending: false }).limit(CONVERSATION_LIMIT),
    countRows("automation_action_requests", [["eq", "decision_status", "requested"]]),
    countRows("automation_action_requests", [["eq", "decision_status", "authorized"]]),
    countRows("automation_action_requests", [["eq", "decision_status", "rejected"]]),
    countRows("communication_conversations", [["eq", "assigned_actor", "RIYA"]]),
    countRows("communication_conversations", [["eq", "assigned_actor", "ANISHA"]]),
    countRows("communication_conversations", [["eq", "assigned_actor", "AAROHI"]]),
    countRows("communication_conversations", [["eq", "assigned_actor", "HUMAN"]]),
    countRows("aarohi_prospects"),
    countRows("vendors", [["eq", "is_active", true]]),
    countRows("communication_conversations", [["eq", "human_takeover", true]]),
    countRows("automation_jobs", [["in", "status", ["pending", "retry_scheduled"]]]),
    countRows("automation_jobs", [["eq", "status", "processing"]]),
    countRows("automation_jobs", [["eq", "status", "succeeded"], ["gte", "updated_at", since24h]]),
    countRows("automation_jobs", [
      ["in", "status", ["failed", "dead_letter", "cancelled"]],
      ["gte", "updated_at", since24h],
    ]),
    countRows("automation_jobs", [["eq", "status", "uncertain"], ["gte", "updated_at", since24h]]),
    conversationSeries(now),
  ]);

  if (approvals.error) throw approvals.error;
  if (conversations.error) throw conversations.error;

  const snapshot = {
    protocol: QFJ_OPERATOR_SNAPSHOT_PROTOCOL,
    emittedAt: now.toISOString(),
    approvalQueue: (approvals.data ?? []).map((row: any) => ({
      id: String(row.id),
      requestedAction: safeLabel(row.action_type),
      risk: approvalRisk(String(row.action_type ?? "")),
      requestedAuthority: "QuickFurno Core",
      sourceAgent: safeLabel(row.source, "system"),
      subject: safeLabel(row.entity_type, "entity"),
      state: row.decision_status === "requested" ? "awaiting-operator" as const : "answered" as const,
    })),
    approvalBreakdown: [
      { id: "requested", label: "Awaiting decision", value: requested },
      { id: "authorized", label: "Authorized", value: authorized },
      { id: "rejected", label: "Rejected", value: rejected },
    ],
    conversationControl: (conversations.data ?? []).map((row: any) => ({
      id: String(row.id),
      subject: safeLabel(row.destination_masked, safeLabel(row.subject_type, "conversation")),
      agent: safeLabel(row.assigned_actor, "UNASSIGNED"),
      humanTakeover: row.human_takeover === true || row.state === "HUMAN",
      aiPaused: row.state === "PAUSED",
      revision: Math.max(0, Number(row.revision ?? 0)),
    })),
    conversationActivity: activity,
    agentWorkload: [
      { id: "riya", label: "Riya", value: riya },
      { id: "anisha", label: "Anisha", value: anisha },
      { id: "aarohi", label: "Aarohi", value: aarohi },
      { id: "human", label: "Human", value: human },
    ],
    businessAnalytics: [
      { id: "aarohi-prospects", label: "Aarohi prospects", value: prospects },
      { id: "active-vendors", label: "Active vendors", value: activeVendors },
      { id: "human-takeovers", label: "Human takeovers", value: humanTakeovers },
    ],
    coreAutomationExecution: [
      { id: "pending", label: "Pending / retry", value: jobsPending },
      { id: "processing", label: "Processing", value: jobsProcessing },
      { id: "succeeded-24h", label: "Succeeded 24h", value: jobsSucceeded },
      { id: "failed-24h", label: "Failed 24h", value: jobsFailed },
      { id: "uncertain-24h", label: "Uncertain 24h", value: jobsUncertain },
    ],
  };

  const parsed = parseQfjOperatorSnapshot(snapshot);
  if (!parsed) throw new Error("JARVIS_OPERATOR_SNAPSHOT_INVALID");
  return parsed;
}
