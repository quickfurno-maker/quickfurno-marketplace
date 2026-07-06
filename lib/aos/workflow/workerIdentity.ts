export function normalizeWorkerId(workerId: unknown): string {
  if (typeof workerId !== "string") {
    throw new Error("WORKER_ID_REQUIRED");
  }

  const normalized = workerId.trim();
  if (!normalized) {
    throw new Error("WORKER_ID_REQUIRED");
  }

  return normalized;
}
