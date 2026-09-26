import { NextResponse } from "next/server";
import { verifyVendorPackageRazorpayCheckout } from "@/services/vendorPackagePaymentService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const localOrderId = typeof body.localOrderId === "string" ? body.localOrderId.trim() : "";
    const paymentId = typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id.trim() : "";
    const providerOrderId = typeof body.razorpay_order_id === "string" ? body.razorpay_order_id.trim() : "";
    const signature = typeof body.razorpay_signature === "string" ? body.razorpay_signature.trim() : "";

    if (!localOrderId || !paymentId || !providerOrderId || !signature) {
      return NextResponse.json({ ok: false, code: "VALIDATION" }, { status: 400 });
    }

    const result = await verifyVendorPackageRazorpayCheckout(localOrderId, {
      razorpay_payment_id: paymentId,
      razorpay_order_id: providerOrderId,
      razorpay_signature: signature,
    });
    if (!result.ok) {
      const status = result.code === "UNAUTHORIZED" ? 401 : 400;
      return NextResponse.json({ ok: false, code: result.code }, { status });
    }

    return NextResponse.json({ ok: true, result: result.data }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false, code: "UNKNOWN" }, { status: 500 });
  }
}
