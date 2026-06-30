// ============================================================================
// QuickFurno — Phase 14C governance: /api/admin/categories
//   GET  → list ALL categories (active + inactive) for the admin manager.
//   POST → create a category or subcategory (body: { name, parentId? }).
//
// SAFETY: Superadmin only (else 403). Service-role key never exposed. Soft
// delete only — there is no delete endpoint. No WhatsApp / vendor notify /
// credits / auto-assign / n8n.
// ============================================================================
import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import { createCategory, listAllCategories } from "@/services/categoryAdminService";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSession();
  if (!session.isSuperadmin) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 403 });
  }
  const result = await listAllCategories();
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, categories: result.data }, { status: 200 });
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
  const name = typeof record.name === "string" ? record.name : "";
  const parentId = typeof record.parentId === "string" ? record.parentId : null;

  const result = await createCategory({ name, parentId, updatedBy: session.adminRole ?? "Superadmin" });
  if (!result.ok) {
    const status = result.code === "DUPLICATE" ? 409 : result.code === "VALIDATION" ? 400 : 500;
    return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status });
  }
  return NextResponse.json({ ok: true, category: result.data }, { status: 200 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
