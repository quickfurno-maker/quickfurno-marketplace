// ============================================================================
// QuickFurno — Phase 14C governance: POST /api/admin/categories/[id]/active
// Activate / deactivate (SOFT delete) a category. Superadmin only.
//
// body: { isActive: boolean, force?: boolean }
//   - Deactivating a parent that still has active subcategories returns 409 with
//     code HAS_ACTIVE_SUBCATEGORIES until the caller retries with force=true.
//
// SOFT delete only — categories are never hard-deleted (old leads/vendors may
// reference them). No WhatsApp / vendor notify / credits / auto-assign / n8n.
// ============================================================================
import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import { setCategoryActive } from "@/services/categoryAdminService";

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
  const isActive = record.isActive === true;
  const force = record.force === true;

  const result = await setCategoryActive(params.id, isActive, session.adminRole ?? "Superadmin", { force });
  if (!result.ok) {
    const status =
      result.code === "HAS_ACTIVE_SUBCATEGORIES" ? 409 : result.code === "NOT_FOUND" ? 404 : result.code === "VALIDATION" ? 400 : 500;
    return NextResponse.json({ ok: false, error: result.error, code: result.code, meta: result.meta }, { status });
  }
  return NextResponse.json({ ok: true, category: result.data }, { status: 200 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
