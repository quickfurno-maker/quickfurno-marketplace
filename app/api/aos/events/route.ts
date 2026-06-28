import { NextResponse } from "next/server";
import {
  formatN8nApiResponse,
  formatN8nBlockedApiResponse,
  handleIncomingN8nEvent,
} from "@/lib/aos/sync/n8nSyncService";
import { validateN8nSecret } from "@/lib/aos/tools/n8nTool";

export async function POST(request: Request) {
  const secret = validateN8nSecret(request);
  if (!secret.ok) {
    return NextResponse.json(formatN8nBlockedApiResponse(secret), { status: secret.status });
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return NextResponse.json(formatN8nBlockedApiResponse(secret), { status: 400 });
  }

  const result = await handleIncomingN8nEvent(body.payload);

  return NextResponse.json(formatN8nApiResponse(result, secret), { status: result.ok ? 200 : 400 });
}

async function readJsonBody(request: Request): Promise<{ ok: true; payload: unknown } | { ok: false; message: string }> {
  try {
    return { ok: true, payload: await request.json() };
  } catch {
    return { ok: false, message: "Invalid JSON payload." };
  }
}
