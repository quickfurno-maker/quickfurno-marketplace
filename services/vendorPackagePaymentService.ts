import { randomUUID } from "node:crypto";
import { adminClient } from "../lib/supabase";
import { AppError, fail, ok, type Result } from "../lib/errors";
import { requireVendorAccess } from "./vendorAccessService";
import {
  RAZORPAY_TEST_CURRENCY,
  RAZORPAY_TEST_PROVIDER,
  assertCapturedPayment,
  inrToSubunits,
  packageOrderReceipt,
  packageSnapshotMatches,
  requireRazorpayTestKeyId,
  requireSecret,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  type RazorpayCheckoutResponse,
  type RazorpayPaymentEntity,
} from "../lib/payments/vendorPackageRazorpay";

type PackageOrderRow = {
  id: string;
  vendor_id: string;
  package_id: string | null;
  package_name: string | null;
  package_price: number | null;
  package_currency: string | null;
  credits_included: number | null;
  validity_days: number | null;
  order_status: string | null;
  payment_status: string | null;
  payment_provider: string | null;
  payment_method: string | null;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  provider_amount_subunits: number | null;
  provider_receipt: string | null;
  activation_status: string | null;
};

type PackageRow = {
  id: string;
  name: string;
  lead_count: number;
  total_price: number;
  validity_days: number;
  is_active: boolean;
};

type RazorpayOrderEntity = {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: string;
};

export type VendorPackageCheckout = {
  localOrderId: string;
  providerOrderId: string;
  keyId: string;
  amount: number;
  currency: "INR";
  packageName: string;
};
function paymentError(code: string, message: string): AppError {
  return new AppError(code, message);
}

function config() {
  return {
    keyId: requireRazorpayTestKeyId(process.env.RAZORPAY_TEST_KEY_ID),
    keySecret: requireSecret("RAZORPAY_TEST_KEY_SECRET", process.env.RAZORPAY_TEST_KEY_SECRET),
    webhookSecret: process.env.RAZORPAY_TEST_WEBHOOK_SECRET?.trim() || null,
  };
}

function authHeader(keyId: string, keySecret: string): string {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`, "utf8").toString("base64")}`;
}

async function razorpayFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { keyId, keySecret } = config();
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(keyId, keySecret),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw paymentError("RAZORPAY_TEST_HTTP_REJECTED", `Razorpay TEST request failed with HTTP ${response.status}.`);
  }
  return response.json() as Promise<T>;
}
async function loadOrder(orderId: string, vendorId?: string): Promise<PackageOrderRow> {
  let query = adminClient()
    .from("vendor_package_orders")
    .select("id, vendor_id, package_id, package_name, package_price, package_currency, credits_included, validity_days, order_status, payment_status, payment_provider, payment_method, provider_order_id, provider_payment_id, provider_amount_subunits, provider_receipt, activation_status")
    .eq("id", orderId);
  if (vendorId) query = query.eq("vendor_id", vendorId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw paymentError("PACKAGE_ORDER_NOT_FOUND", "Package order not found.");
  return data as PackageOrderRow;
}

async function loadCurrentPackage(packageId: string): Promise<PackageRow> {
  const { data, error } = await adminClient()
    .from("packages")
    .select("id, name, lead_count, total_price, validity_days, is_active")
    .eq("id", packageId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw paymentError("PACKAGE_NOT_FOUND", "Package not found.");
  return data as PackageRow;
}

function checkoutFromStoredOrder(order: PackageOrderRow, keyId: string): VendorPackageCheckout {
  if (!order.provider_order_id || !order.provider_amount_subunits || order.package_currency !== RAZORPAY_TEST_CURRENCY) {
    throw paymentError("PACKAGE_ORDER_NOT_BOUND", "Package order is not ready for payment.");
  }
  return {
    localOrderId: order.id,
    providerOrderId: order.provider_order_id,
    keyId,
    amount: Number(order.provider_amount_subunits),
    currency: RAZORPAY_TEST_CURRENCY,
    packageName: order.package_name || "QuickFurno package",
  };
}
export async function createVendorPackageRazorpayCheckout(orderId: string): Promise<Result<VendorPackageCheckout>> {
  try {
    const access = await requireVendorAccess();
    if (!access.ok) return access;
    const { keyId } = config();
    let order = await loadOrder(orderId, access.data.vendorId);

    if (order.activation_status === "activated") {
      throw paymentError("PACKAGE_ORDER_ALREADY_ACTIVATED", "This package order is already activated.");
    }

    if (order.provider_order_id) {
      if (order.payment_provider !== RAZORPAY_TEST_PROVIDER) {
        throw paymentError("PACKAGE_ORDER_PROVIDER_MISMATCH", "Package order is bound to another payment provider.");
      }
      const expected = inrToSubunits(order.package_price);
      if (Number(order.provider_amount_subunits) !== expected) {
        throw paymentError("PACKAGE_ORDER_AMOUNT_DRIFT", "Stored payment amount does not match the package snapshot.");
      }
      return ok(checkoutFromStoredOrder(order, keyId));
    }

    if (!order.package_id) throw paymentError("PACKAGE_NOT_FOUND", "Package not found.");
    const pkg = await loadCurrentPackage(order.package_id);
    if (!pkg.is_active) throw paymentError("PACKAGE_NOT_ACTIVE", "This package is no longer available.");
    if (!packageSnapshotMatches(order, pkg)) {
      throw paymentError("PACKAGE_SNAPSHOT_DRIFT", "Package changed before payment started. Create a new order.");
    }
    const amount = inrToSubunits(order.package_price);
    const receipt = packageOrderReceipt(order.id);
    const requestToken = randomUUID();
    const { data: claim, error: claimError } = await adminClient().rpc(
      "qf_claim_vendor_package_razorpay_order_v1",
      { p_order_id: order.id, p_request_token: requestToken }
    );
    if (claimError) throw claimError;
    if ((claim as { status?: string } | null)?.status === "already_bound") {
      order = await loadOrder(order.id, access.data.vendorId);
      return ok(checkoutFromStoredOrder(order, keyId));
    }

    let providerOrder: RazorpayOrderEntity;
    try {
      providerOrder = await razorpayFetch<RazorpayOrderEntity>("/orders", {
        method: "POST",
        body: JSON.stringify({
          amount,
          currency: RAZORPAY_TEST_CURRENCY,
          receipt,
          notes: { quickfurno_package_order_id: order.id },
        }),
      });
    } catch (error) {
      if (error instanceof AppError && error.code === "RAZORPAY_TEST_HTTP_REJECTED") {
        await adminClient().rpc("qf_release_vendor_package_razorpay_order_claim_v1", {
          p_order_id: order.id,
          p_request_token: requestToken,
        });
        throw error;
      }
      throw paymentError(
        "PACKAGE_ORDER_CREATION_UNCERTAIN",
        "Razorpay may have created the test order, but QuickFurno did not receive a reliable response. Do not retry automatically."
      );
    }

    if (!providerOrder.id
      || providerOrder.amount !== amount
      || providerOrder.currency !== RAZORPAY_TEST_CURRENCY
      || providerOrder.receipt !== receipt) {
      throw paymentError("RAZORPAY_ORDER_MISMATCH", "Razorpay TEST order did not match the QuickFurno order.");
    }

    const { error: bindError } = await adminClient().rpc("qf_bind_vendor_package_razorpay_order_v1", {
      p_order_id: order.id,
      p_provider_order_id: providerOrder.id,
      p_amount_subunits: amount,
      p_receipt: receipt,
      p_request_token: requestToken,
    });
    if (bindError) throw bindError;
    order = await loadOrder(order.id, access.data.vendorId);
    return ok(checkoutFromStoredOrder(order, keyId));
  } catch (error) {
    return fail(error);
  }
}
async function activateCapturedPayment(order: PackageOrderRow, payment: RazorpayPaymentEntity) {
  if (!order.provider_order_id || order.payment_provider !== RAZORPAY_TEST_PROVIDER) {
    throw paymentError("PACKAGE_ORDER_NOT_BOUND", "Package order is not bound to Razorpay TEST.");
  }
  const amount = Number(order.provider_amount_subunits ?? inrToSubunits(order.package_price));
  assertCapturedPayment(payment, {
    paymentId: payment.id,
    providerOrderId: order.provider_order_id,
    amount,
    currency: RAZORPAY_TEST_CURRENCY,
  });

  const { data, error } = await adminClient().rpc("qf_activate_vendor_package_order_v1", {
    p_order_id: order.id,
    p_provider_payment_id: payment.id,
  });
  if (error) throw error;
  return data as { status?: string; credits_added?: number; expires_at?: string } | null;
}

export async function verifyVendorPackageRazorpayCheckout(
  orderId: string,
  response: RazorpayCheckoutResponse
): Promise<Result<{ status: string }>> {
  try {
    const access = await requireVendorAccess();
    if (!access.ok) return access;
    const { keySecret } = config();
    const order = await loadOrder(orderId, access.data.vendorId);

    if (!order.provider_order_id) throw paymentError("PACKAGE_ORDER_NOT_BOUND", "Package order is not ready.");
    if (response.razorpay_order_id !== order.provider_order_id) {
      throw paymentError("PAYMENT_ORDER_MISMATCH", "Payment order mismatch.");
    }
    if (!verifyCheckoutSignature({
      storedOrderId: order.provider_order_id,
      paymentId: response.razorpay_payment_id,
      signature: response.razorpay_signature,
      keySecret,
    })) {
      throw paymentError("PAYMENT_SIGNATURE_INVALID", "Payment signature verification failed.");
    }

    const payment = await razorpayFetch<RazorpayPaymentEntity>(
      `/payments/${encodeURIComponent(response.razorpay_payment_id)}`
    );
    await activateCapturedPayment(order, payment);
    return ok({ status: "activated" });
  } catch (error) {
    return fail(error);
  }
}

type RazorpayWebhook = {
  event?: string;
  payload?: {
    payment?: { entity?: RazorpayPaymentEntity };
    order?: { entity?: { id?: string } };
  };
};

async function loadOrderByProviderOrderId(providerOrderId: string): Promise<PackageOrderRow> {
  const { data, error } = await adminClient()
    .from("vendor_package_orders")
    .select("id, vendor_id, package_id, package_name, package_price, package_currency, credits_included, validity_days, order_status, payment_status, payment_provider, payment_method, provider_order_id, provider_payment_id, provider_amount_subunits, provider_receipt, activation_status")
    .eq("provider_order_id", providerOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw paymentError("PACKAGE_ORDER_NOT_FOUND", "Package order not found.");
  return data as PackageOrderRow;
}

async function markTestPaymentFailed(order: PackageOrderRow, paymentId: string | null): Promise<void> {
  const { error } = await adminClient().rpc("qf_mark_vendor_package_payment_failed_v1", {
    p_order_id: order.id,
    p_provider_payment_id: paymentId ?? "",
  });
  if (error) throw error;
}

export async function handleVendorPackageRazorpayWebhook(
  rawBody: string,
  signature: string
): Promise<Result<{ status: string }>> {
  try {
    const { webhookSecret } = config();
    if (!webhookSecret) {
      throw paymentError("RAZORPAY_TEST_WEBHOOK_SECRET_MISSING", "Razorpay TEST webhook secret is not configured.");
    }
    if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      throw paymentError("PAYMENT_SIGNATURE_INVALID", "Webhook signature verification failed.");
    }

    let event: RazorpayWebhook;
    try {
      event = JSON.parse(rawBody) as RazorpayWebhook;
    } catch {
      throw paymentError("RAZORPAY_WEBHOOK_INVALID", "Webhook body is not valid JSON.");
    }

    const payment = event.payload?.payment?.entity;
    if (!payment?.id || !payment.order_id) {
      return ok({ status: "ignored" });
    }

    const order = await loadOrderByProviderOrderId(payment.order_id);
    if (event.event === "payment.captured") {
      const canonicalPayment = await razorpayFetch<RazorpayPaymentEntity>(
        "/payments/" + encodeURIComponent(payment.id)
      );
      await activateCapturedPayment(order, canonicalPayment);
      return ok({ status: "activated" });
    }

    if (event.event === "payment.failed") {
      await markTestPaymentFailed(order, payment.id);
      return ok({ status: "failed_recorded" });
    }

    return ok({ status: "ignored" });
  } catch (error) {
    return fail(error);
  }
}
