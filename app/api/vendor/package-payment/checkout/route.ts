import { NextResponse } from "next/server";
import { createVendorPackageRazorpayCheckout } from "@/services/vendorPackagePaymentService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as { orderId?: unknown };
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    if (!orderId) {
      return NextResponse.json({ ok: false, code: "VALIDATION" }, { status: 400 });
    }

    const result = await createVendorPackageRazorpayCheckout(orderId);
    if (!result.ok) {
      const status = result.code === "UNAUTHORIZED" ? 401 : 400;
      return NextResponse.json({ ok: false, code: result.code }, { status });
    }

    return NextResponse.json({ ok: true, checkout: result.data }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false, code: "UNKNOWN" }, { status: 500 });
  }
}
