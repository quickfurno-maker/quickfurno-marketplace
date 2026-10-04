import "server-only";

import { createHash } from "node:crypto";
import { hostname } from "node:os";

import { adminClient } from "@/lib/supabase";

const SAFE_WORKER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SAFE_ROLE = /^[a-z][a-z0-9:_-]{1,63}$/;
const SAFE_SCHEDULER = /^[a-z][a-z0-9:_-]{1,95}$/;
const SAFE_OCCURRENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export type ScaleWorkerState =
  | "starting"
  | "running"
  | "idle"
  | "degraded"
  | "draining"
  | "stopped";

export type ScaleSchedulerClaim =
  | {
      status: "acquired";
      leaseToken: string;
      fence: number;
      attemptCount: number;
      leaseExpiresAt: string;
    }
  | {
      status: "busy" | "completed";
      fence: number;
      attemptCount: number;
      leaseExpiresAt: string;
    };

function safeToken(value: string, pattern: RegExp, label: string): string {
  const trimmed = value.trim();
  if (!pattern.test(trimmed)) throw new Error(`${label}_INVALID`);
  return trimmed;
}

export function scaleWorkerId(
  role: string,
  explicit = process.env.QF_SCALE_WORKER_ID,
): string {
  const normalizedRole = safeToken(role, SAFE_ROLE, "SCALE_WORKER_ROLE");
  const candidate = explicit?.trim();
  if (candidate && SAFE_WORKER.test(candidate)) return candidate;
  const host = hostname().replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 120);
  const raw = `${normalizedRole}:${host || "host"}:${process.pid}`;
  if (SAFE_WORKER.test(raw)) return raw;
  return `${normalizedRole}:${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}

export async function writeScaleWorkerHeartbeat(input: {
  role: string;
  workerId: string;
  state: ScaleWorkerState;
  acceptingWork: boolean;
  inFlight?: number;
  startedAt: string;
  drainStartedAt?: string | null;
  lastSafeCode?: string | null;
}): Promise<void> {
  safeToken(input.role, SAFE_ROLE, "SCALE_WORKER_ROLE");
  safeToken(input.workerId, SAFE_WORKER, "SCALE_WORKER_ID");
  const { error } = await adminClient().rpc("qf_scale_worker_heartbeat_v1", {
    p_worker_role: input.role,
    p_worker_id: input.workerId,
    p_state: input.state,
    p_accepting_work: input.acceptingWork,
    p_in_flight: Math.max(0, Math.min(100000, Math.trunc(input.inFlight ?? 0))),
    p_started_at: input.startedAt,
    p_drain_started_at: input.drainStartedAt ?? null,
    p_last_safe_code: input.lastSafeCode?.trim().slice(0, 200) || null,
  });
  if (error) throw error;
}

export async function claimScaleSchedulerOccurrence(input: {
  schedulerKey: string;
  occurrenceKey: string;
  workerId: string;
  leaseSeconds: number;
}): Promise<ScaleSchedulerClaim> {
  safeToken(input.schedulerKey, SAFE_SCHEDULER, "SCALE_SCHEDULER_KEY");
  safeToken(input.occurrenceKey, SAFE_OCCURRENCE, "SCALE_OCCURRENCE_KEY");
  safeToken(input.workerId, SAFE_WORKER, "SCALE_WORKER_ID");
  const { data, error } = await adminClient().rpc(
    "qf_claim_scale_scheduler_occurrence_v1",
    {
      p_scheduler_key: input.schedulerKey,
      p_occurrence_key: input.occurrenceKey,
      p_worker_id: input.workerId,
      p_lease_seconds: Math.max(30, Math.min(3600, Math.trunc(input.leaseSeconds))),
    },
  );
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const statusRaw = String(row?.claim_status ?? "");
  const fence = Number(row?.fence);
  const attemptCount = Number(row?.attempt_count);
  const leaseExpiresAt = String(row?.lease_expires_at ?? "");
  if (
    !["acquired", "busy", "completed"].includes(statusRaw) ||
    !Number.isSafeInteger(fence) ||
    fence < 1 ||
    !Number.isSafeInteger(attemptCount) ||
    attemptCount < 1 ||
    !Number.isFinite(Date.parse(leaseExpiresAt))
  ) {
    throw new Error("SCALE_SCHEDULER_CLAIM_INVALID");
  }
  const status = statusRaw as "acquired" | "busy" | "completed";
  if (status === "acquired") {
    const leaseToken = String(row?.lease_token ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(leaseToken)) {
      throw new Error("SCALE_SCHEDULER_LEASE_TOKEN_INVALID");
    }
    return { status, leaseToken, fence, attemptCount, leaseExpiresAt };
  }
  return { status, fence, attemptCount, leaseExpiresAt };
}

export async function completeScaleSchedulerOccurrence(input: {
  schedulerKey: string;
  occurrenceKey: string;
  workerId: string;
  leaseToken: string;
  fence: number;
  safeCode?: string;
}): Promise<boolean> {
  const { data, error } = await adminClient().rpc(
    "qf_complete_scale_scheduler_occurrence_v1",
    {
      p_scheduler_key: safeToken(input.schedulerKey, SAFE_SCHEDULER, "SCALE_SCHEDULER_KEY"),
      p_occurrence_key: safeToken(input.occurrenceKey, SAFE_OCCURRENCE, "SCALE_OCCURRENCE_KEY"),
      p_worker_id: safeToken(input.workerId, SAFE_WORKER, "SCALE_WORKER_ID"),
      p_lease_token: input.leaseToken,
      p_fence: input.fence,
      p_safe_code: input.safeCode?.trim().slice(0, 200) || "COMPLETED",
    },
  );
  if (error) throw error;
  return data === true;
}

export async function readScaleQueueHealth(): Promise<Record<string, unknown>> {
  const { data, error } = await adminClient().rpc("qf_scale_queue_health_v1");
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("SCALE_QUEUE_HEALTH_INVALID");
  }
  return data as Record<string, unknown>;
}
