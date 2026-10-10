import { z } from "zod";

export const AGNI_OWNER_SNAPSHOT_PATH="/api/internal/agni/owner-snapshot" as const;
export const AGNI_OWNER_SNAPSHOT_PROTOCOL="qf.agni.owner-snapshot.v1" as const;
export const AGNI_OWNER_SNAPSHOT_RESPONSE_PROTOCOL="qf.agni.owner-snapshot.response.v1" as const;
export const AGNI_PARENT_HEARTBEAT_PROTOCOL="qf.agni.parent-heartbeat.request.v1" as const;
export const AGNI_PARENT_HEARTBEAT_RESPONSE_PROTOCOL="qf.agni.parent-heartbeat.v1" as const;

export const AGNI_OWNER_APPROVAL_PATH="/api/internal/agni/owner-approval" as const;
export const AGNI_OWNER_APPROVAL_PROTOCOL="qf.agni.owner-approval.v1" as const;
export const AGNI_OWNER_APPROVAL_RESPONSE_PROTOCOL="qf.agni.owner-approval.response.v1" as const;

export const AGNI_OWNER_ACTOR="qf-agni-control-plane" as const;

const uuid=z.string().uuid();
const hex64=z.string().regex(/^[0-9a-f]{64}$/);

export const agniOwnerSnapshotRequestSchema=z.object({
  protocol:z.literal(AGNI_OWNER_SNAPSHOT_PROTOCOL),
}).strict();

export const agniParentHeartbeatRequestSchema=z.object({
  protocol:z.literal(AGNI_PARENT_HEARTBEAT_PROTOCOL),
  challenge:z.string().regex(/^[0-9a-f]{32}$/),
}).strict();

export function parseAgniParentHeartbeatRequest(value:unknown):string|null{
  const r=agniParentHeartbeatRequestSchema.safeParse(value);
  return r.success?r.data.challenge:null;
}

export const agniOwnerApprovalRequestSchema=z.object({
  protocol:z.literal(AGNI_OWNER_APPROVAL_PROTOCOL),
  decisionId:uuid,
  proposalId:uuid,
  actionFingerprint:hex64,
  decision:z.enum(["APPROVE","REJECT"]),
  ownerRef:z.string().min(1).max(96).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

export type AgniOwnerApprovalRequest=z.infer<typeof agniOwnerApprovalRequestSchema>;

export function parseAgniOwnerSnapshotRequest(value:unknown):boolean{
  return agniOwnerSnapshotRequestSchema.safeParse(value).success;
}

export function parseAgniOwnerApprovalRequest(value:unknown):AgniOwnerApprovalRequest|null{
  const parsed=agniOwnerApprovalRequestSchema.safeParse(value);
  return parsed.success?parsed.data:null;
}
