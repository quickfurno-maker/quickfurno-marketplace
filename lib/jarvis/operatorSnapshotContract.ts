import { z } from "zod";

export const QFJ_OPERATOR_SNAPSHOT_REQUEST_PROTOCOL = "qfj.quickfurno-operator-snapshot.request.v1" as const;
export const QFJ_OPERATOR_SNAPSHOT_PROTOCOL = "qfj.quickfurno-operator-observation.v1" as const;
export const QFJ_OPERATOR_SNAPSHOT_PATH = "/api/internal/jarvis/operator-snapshot" as const;
export const QFJ_OPERATOR_SNAPSHOT_SIGNING_DOMAIN = "qfj.jarvis-os.operator-snapshot.http.sig.v1" as const;
export const QFJ_OPERATOR_SNAPSHOT_CALLER = "qf-jarvis-os" as const;
export const QFJ_OPERATOR_SNAPSHOT_AUDIENCE = "quickfurno-core" as const;
export const QFJ_OPERATOR_SNAPSHOT_FRESHNESS_MS = 60_000;

const instant = z.string().datetime({ offset: false });
const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const label = z.string().min(1).max(160);
const bounded = z.number().int().nonnegative().max(1_000_000_000);

export const qfjOperatorSnapshotRequestSchema = z.object({
  protocol: z.literal(QFJ_OPERATOR_SNAPSHOT_REQUEST_PROTOCOL),
  requestId: z.string().uuid(),
  issuedAt: instant,
}).strict();

const approvalSchema = z.object({
  id: identifier,
  requestedAction: label,
  risk: z.enum(["informational","low-risk-reversible","client-or-vendor-facing","money-related","high-risk"]),
  requestedAuthority: label,
  sourceAgent: label,
  subject: label,
  state: z.enum(["awaiting-core","awaiting-operator","answered"]),
}).strict();

const conversationSchema = z.object({
  id: z.string().uuid(),
  subject: label,
  agent: label,
  humanTakeover: z.boolean(),
  aiPaused: z.boolean(),
  revision: z.number().int().nonnegative().max(1_000_000),
}).strict();

const sliceSchema = z.object({ id: identifier, label, value: bounded }).strict();
const pointSchema = z.object({ label: z.string().min(1).max(16), value: bounded }).strict();

export const qfjOperatorSnapshotSchema = z.object({
  protocol: z.literal(QFJ_OPERATOR_SNAPSHOT_PROTOCOL),
  emittedAt: instant,
  approvalQueue: z.array(approvalSchema).max(100),
  approvalBreakdown: z.array(sliceSchema).max(12),
  conversationControl: z.array(conversationSchema).max(100),
  conversationActivity: z.array(pointSchema).max(48),
  agentWorkload: z.array(sliceSchema).max(12),
  businessAnalytics: z.array(sliceSchema).max(24),
  coreAutomationExecution: z.array(sliceSchema).max(24),
}).strict();

export type QfjOperatorSnapshotRequestV1 = z.infer<typeof qfjOperatorSnapshotRequestSchema>;
export type QfjOperatorSnapshot = z.infer<typeof qfjOperatorSnapshotSchema>;

export function parseQfjOperatorSnapshotRequest(value: unknown): QfjOperatorSnapshotRequestV1 | null {
  const parsed = qfjOperatorSnapshotRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseQfjOperatorSnapshot(value: unknown): QfjOperatorSnapshot | null {
  const parsed = qfjOperatorSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
