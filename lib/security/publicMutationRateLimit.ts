import { createHash } from "node:crypto";
import { createRedisCoordinationFromEnv } from "@/lib/coordination/redisCoordination";

type LocalBucket = { count: number; expiresAt: number };

const localBuckets = new Map<string, LocalBucket>();
let shared = createRedisCoordinationFromEnv();

function identityDigest(scope: string, identity: string): string {
  return createHash("sha256")
    .update("qf-phase10:")
    .update(scope)
    .update(":")
    .update(identity.trim().toLowerCase())
    .digest("hex");
}

function localFallback(subject: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const current = localBuckets.get(subject);
  if (!current || current.expiresAt <= now) {
    localBuckets.set(subject, { count: 1, expiresAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

/**
 * Portable origin-side abuse control for unauthenticated business mutations.
 *
 * Redis/Valkey is the shared fast authority when available. If coordination is
 * unavailable, a process-local bucket still supplies a bounded fallback instead
 * of silently disabling the control. Business data is never stored in Redis.
 */
export async function allowPublicMutation(input: {
  scope: string;
  identity: string;
  limit: number;
  windowMs: number;
}): Promise<boolean> {
  const subject = identityDigest(input.scope, input.identity);
  const localKey = input.scope + ":" + subject;

  if (!shared) shared = createRedisCoordinationFromEnv();
  if (shared) {
    const decision = await shared.rateLimit({
      namespace: "public-mutation",
      subject: localKey,
      limit: input.limit,
      windowMs: input.windowMs,
    });
    if (decision.status === "ok") return decision.allowed;
  }

  return localFallback(localKey, input.limit, input.windowMs);
}
