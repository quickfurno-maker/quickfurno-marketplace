import { NextResponse } from "next/server";
import { handleVendorPackageRazorpayWebhook } from "@/services/vendorPackagePaymentService";
import {journalRazorpayFinanceV2Receipt} from "@/services/financeV2WebhookJournal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("x-razorpay-signature")?.trim() ?? "";
  if (!signature) {
    return NextResponse.json({ ok: false, code: "PAYMENT_SIGNATURE_INVALID" }, { status: 401 });
  }

  const rawBody = await request.text();
  // Source-only PAY-3 dual-write receipt: OFF unless independently approved for Staging.
  // Never turn this on before the reviewed finance SQL and event-ID contract exist.
  // Original Core provider GET + atomic wallet authority remain exactly as before.
  if(process.env.FINANCE_V2_PAY3_WEBHOOK_RECEIPT_ENABLED==="staging"){
    const eventId=request.headers.get("x-razorpay-event-id")?.trim()??"";
    try{await journalRazorpayFinanceV2Receipt(rawBody,signature,eventId);}
    catch{return NextResponse.json({ok:false,code:"FINANCE_RECEIPT_UNAVAILABLE"},
      {status:503});}
  }
  const result = await handleVendorPackageRazorpayWebhook(rawBody, signature);
  if (!result.ok) {
    const status = result.code === "PAYMENT_SIGNATURE_INVALID" ? 401 : 500;
    return NextResponse.json({ ok: false, code: result.code }, { status });
  }

  return NextResponse.json({ ok: true, status: result.data.status }, { status: 200 });
}
