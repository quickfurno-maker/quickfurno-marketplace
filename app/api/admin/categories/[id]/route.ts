// ============================================================================
// QuickFurno — Phase 14C governance: POST /api/admin/categories/[id]
// Edit a category/subcategory (rename / re-parent / sort). Superadmin only.
// No duplicate names. Soft delete only (see /active). No automation side effects.
// ============================================================================
import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import { updateCategory } from "@/services/categoryAdminService";

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
  const result = await updateCategory(params.id, {
    name: typeof record.name === "string" ? record.name : undefined,
    parentId: record.parentId === null || typeof record.parentId === "string" ? (record.parentId as string | null) : undefined,
    sortOrder: typeof record.sortOrder === "number" ? record.sortOrder : undefined,
    updatedBy: session.adminRole ?? "Superadmin",
  });
  if (!result.ok) {
    const status = result.code === "DUPLICATE" ? 409 : result.code === "NOT_FOUND" ? 404 : result.code === "VALIDATION" ? 400 : 500;
    return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status });
  }
  return NextResponse.json({ ok: true, category: result.data }, { status: 200 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
