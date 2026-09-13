import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import { getAosV2AdminSnapshot } from "@/services/aosV2AdminService";
import {
  forceAosV2ActionProposalsOff,
  setAosV2IntelligenceEnabled,
} from "@/lib/aos/v2/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSession();
  if (!session.isSuperadmin) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 403 });
  }

  const snapshot = await getAosV2AdminSnapshot();
  return NextResponse.json({ ok: true, ...snapshot }, { status: 200 });
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session.isSuperadmin) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const record = isRecord(body) ? body : {};
  if (typeof record.enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "enabled must be boolean." }, { status: 400 });
  }

  const updatedBy = session.adminRole ?? "Superadmin";
  const result = await setAosV2IntelligenceEnabled({
    enabled: record.enabled,
    updatedBy,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  // Action proposals are intentionally NOT toggled from this control. The AOS
  // intelligence runtime can be active while all proposed side effects remain
  // independently locked off.
  await forceAosV2ActionProposalsOff({ updatedBy });

  const snapshot = await getAosV2AdminSnapshot();
  return NextResponse.json({ ok: true, ...snapshot }, { status: 200 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
