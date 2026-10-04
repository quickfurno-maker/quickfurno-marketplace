import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      ok: true,
      status: "alive",
      revision: process.env.QF_RELEASE_SHA ?? "unknown",
    },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
