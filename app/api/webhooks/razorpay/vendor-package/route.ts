import { NextResponse } from "next/server";
import { handleVendorPackageRazorpayWebhook } from "@/services/vendorPackagePaymentService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("x-razorpay-signature")?.trim() ?? "";
  if (!signature) {
    return NextResponse.json({ ok: false, code: "PAYMENT_SIGNATURE_INVALID" }, { status: 401 });
  }

  const rawBody = await request.text();
  const result = await handleVendorPackageRazorpayWebhook(rawBody, signature);
  if (!result.ok) {
    const status = result.code === "PAYMENT_SIGNATURE_INVALID" ? 401 : 500;
    return NextResponse.json({ ok: false, code: result.code }, { status });
  }

  return NextResponse.json({ ok: true, status: result.data.status }, { status: 200 });
}
