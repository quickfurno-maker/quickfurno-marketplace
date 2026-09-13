import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      status: "retired",
      code: "AOS_LEGACY_DIRECT_N8N_ROUTE_RETIRED",
      message: "This legacy AOS/n8n preview route is retired. AOS V2 is advisory and uses the Core-governed automation boundary.",
    },
    { status: 410 },
  );
}
