import { NextResponse } from "next/server";
import { handleWhatsAppStatusUpdate } from "@/lib/aos/sync/n8nSyncService";
import { validateN8nSecret } from "@/lib/aos/tools/n8nTool";

export async function POST(request: Request) {
  const secret = validateN8nSecret(request);
  if (!secret.ok) {
    return NextResponse.json(
      {
        ok: false,
        status: "unauthorized",
        message: secret.message,
      },
      { status: secret.status },
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return NextResponse.json(
      {
        ok: false,
        status: "blocked",
        message: body.message,
      },
      { status: 400 },
    );
  }

  const result = await handleWhatsAppStatusUpdate(body.payload);

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
}

async function readJsonBody(request: Request): Promise<{ ok: true; payload: unknown } | { ok: false; message: string }> {
  try {
    return { ok: true, payload: await request.json() };
  } catch {
    return { ok: false, message: "Invalid JSON payload." };
  }
}
