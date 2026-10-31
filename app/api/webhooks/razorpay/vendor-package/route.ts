import { NextResponse } from "next/server";
import { handleVendorPackageRazorpayWebhook } from "@/services/vendorPackagePaymentService";
import { readBoundedRazorpayWebhookBody } from "@/lib/payments/readBoundedRazorpayWebhookBody.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("x-razorpay-signature")?.trim() ?? "";
  if (!signature) {
    return NextResponse.json({ ok: false, code: "PAYMENT_SIGNATURE_INVALID" }, { status: 401 });
  }

  const bounded = await readBoundedRazorpayWebhookBody(request);
  if (!bounded.ok) {
    const status = bounded.code === "WEBHOOK_BODY_TOO_LARGE" ? 413 : 400;
    return NextResponse.json({ ok: false, code: bounded.code }, { status });
  }
  // Event id is not itself HMAC-signed; the durable ledger binds it to the
  // verified raw-body digest, and activation remains release-gated.
  const eventId = request.headers.get("x-razorpay-event-id");
  const result = await handleVendorPackageRazorpayWebhook(bounded.rawBody, signature, eventId ?? undefined);
  if (!result.ok) {
    const status = result.code === "PAYMENT_SIGNATURE_INVALID" ? 401 : 500;
    return NextResponse.json({ ok: false, code: result.code }, { status });
  }

  return NextResponse.json({ ok: true, status: result.data.status }, { status: 200 });
}
