import { NextResponse } from "next/server";
import {
  formatN8nApiResponse,
  formatN8nBlockedApiResponse,
  queueEventForN8n,
} from "@/lib/aos/sync/n8nSyncService";
import { createSafeN8nWebhookFailureResult, validateN8nSecret } from "@/lib/aos/tools/n8nTool";

export async function POST(request: Request) {
  try {
    const secret = validateN8nSecret(request);
    if (!secret.ok) {
      return NextResponse.json(formatN8nBlockedApiResponse(secret), { status: secret.status });
    }

    const body = await readJsonBody(request);
    if (!body.ok) {
      return safeFallbackResponse({ eventType: "aos.failure" });
    }

    const result = await queueEventForN8n(normalizeAosEventPayload(body.payload));

    return NextResponse.json(formatN8nApiResponse(result, secret), { status: 200 });
  } catch {
    return safeFallbackResponse({ eventType: "aos.failure" });
  }
}

async function readJsonBody(request: Request): Promise<{ ok: true; payload: unknown } | { ok: false; message: string }> {
  try {
    return { ok: true, payload: await request.json() };
  } catch {
    return { ok: false, message: "Invalid JSON payload." };
  }
}

function normalizeAosEventPayload(payload: unknown): Record<string, unknown> {
  const record = isRecord(payload) ? payload : {};
  const eventType = firstString(record.event, record.eventType, record.event_type, record.type) ?? "aos.failure";

  return {
    ...record,
    eventType,
  };
}

function safeFallbackResponse(payload: Record<string, unknown>) {
  const result = createSafeN8nWebhookFailureResult(normalizeAosEventPayload(payload));
  return NextResponse.json(
    formatN8nApiResponse(result, {
      mode: "safe_fallback",
      message: "n8n error handled safely.",
    }),
    { status: 200 },
  );
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
