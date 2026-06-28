import { NextResponse } from "next/server";
import { runSafeAgentEventPipeline } from "@/lib/aos/events/safeAgentEventPipeline";
import { formatN8nBlockedApiResponse } from "@/lib/aos/sync/n8nSyncService";
import { validateN8nSecret } from "@/lib/aos/tools/n8nTool";

export async function POST(request: Request) {
  try {
    const secret = validateN8nSecret(request);
    if (!secret.ok) {
      return NextResponse.json(formatN8nBlockedApiResponse(secret), { status: secret.status });
    }

    const body = await readJsonBody(request);
    const result = await runSafeAgentEventPipeline(body.ok ? body.payload : {
      event: "aos.failure",
      source: "quickfurno-invalid-json",
    });

    return NextResponse.json(
      {
        ...result,
        security: {
          mode: secret.mode,
          message: secret.message,
        },
      },
      { status: 200 },
    );
  } catch {
    const result = await runSafeAgentEventPipeline({
      event: "aos.failure",
      source: "quickfurno-route-fallback",
    });
    return NextResponse.json(result, { status: 200 });
  }
}

async function readJsonBody(request: Request): Promise<{ ok: true; payload: unknown } | { ok: false; message: string }> {
  try {
    return { ok: true, payload: await request.json() };
  } catch {
    return { ok: false, message: "Invalid JSON payload." };
  }
}
