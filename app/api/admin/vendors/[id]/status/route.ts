// ============================================================================
// QuickFurno — Phase 13B: POST /api/admin/vendors/[id]/status
// Superadmin-only. action: approve | reject | suspend | activate | deactivate.
// NO WhatsApp, NO vendor notification, NO credit change, NO n8n.
// ============================================================================
import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import { setVendorStatusAction, type VendorStatusAction } from "@/services/vendorAdminService";

export const dynamic = "force-dynamic";

const ALLOWED_ACTIONS: VendorStatusAction[] = ["approve", "reject", "suspend", "activate", "deactivate"];

export async function POST(request: Request, { params }: { params: { id: string } }) {
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

  const action = isRecord(body) ? body.action : undefined;
  if (typeof action !== "string" || !ALLOWED_ACTIONS.includes(action as VendorStatusAction)) {
    return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
  }

  const result = await setVendorStatusAction(params.id, action as VendorStatusAction, session.adminRole ?? "Superadmin");
  if (!result.ok) {
    const status = result.code === "VALIDATION" ? 400 : result.code === "NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  return NextResponse.json({ ok: true, vendor: result.data }, { status: 200 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
