// ============================================================================
// QuickFurno — Phase 13B: POST /api/admin/vendors/[id]/package
// Superadmin-only. Assign / update the denormalized package fields used by the
// Phase 13 preview eligibility. Optional credit top-up (logged).
// NO WhatsApp, NO vendor notification, NO auto-deduction, NO n8n.
// ============================================================================
import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import {
  ALLOWED_PACKAGE_STATUSES,
  updateVendorPackage,
  type PackageStatus,
} from "@/services/vendorAdminService";

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
  const packageStatus = record.packageStatus;
  if (typeof packageStatus !== "string" || !ALLOWED_PACKAGE_STATUSES.includes(packageStatus as PackageStatus)) {
    return NextResponse.json(
      { ok: false, error: `packageStatus must be one of: ${ALLOWED_PACKAGE_STATUSES.join(", ")}.` },
      { status: 400 },
    );
  }

  const result = await updateVendorPackage(params.id, {
    packageName: typeof record.packageName === "string" ? record.packageName : null,
    packageStatus: packageStatus as PackageStatus,
    creditsToAdd: typeof record.creditsToAdd === "number" ? record.creditsToAdd : Number(record.creditsToAdd) || 0,
    packageExpiresAt: typeof record.packageExpiresAt === "string" ? record.packageExpiresAt : null,
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
