// ============================================================================
// QuickFurno — Phase 13B: POST /api/admin/vendors/[id]/credits
// Superadmin-only. Manual credit add / set. Writes a vendor_credit_logs row.
// NEVER auto-deducts. NO WhatsApp, NO vendor notification, NO n8n.
// ============================================================================
import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import { updateVendorCredits } from "@/services/vendorAdminService";

export const dynamic = "force-dynamic";

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

  const record = isRecord(body) ? body : {};
  const mode = record.mode === "set" ? "set" : "add";
  const amount = Number(record.amount);
  if (!Number.isFinite(amount)) {
    return NextResponse.json({ ok: false, error: "amount must be a number." }, { status: 400 });
  }
  const reason = typeof record.reason === "string" ? record.reason : null;

  const result = await updateVendorCredits(params.id, {
    mode,
    amount,
    reason,
    updatedBy: session.adminRole ?? "Superadmin",
  });
  if (!result.ok) {
    const status = result.code === "VALIDATION" ? 400 : result.code === "NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  return NextResponse.json({ ok: true, vendor: result.data }, { status: 200 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
