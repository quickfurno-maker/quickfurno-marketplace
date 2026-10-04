import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  // Readiness deliberately does not call Supabase, Jarvis, Meta, Google, OpenAI
  // or a payment provider. An upstream outage must not cause every healthy web
  // replica to remove itself from service. Dependency health is observed
  // separately; readiness answers whether this application instance can serve.
  return NextResponse.json(
    {
      ok: true,
      status: "ready",
      revision: process.env.QF_RELEASE_SHA ?? "unknown",
    },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
