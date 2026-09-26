"use client";

import { useState } from "react";

type Checkout = {
  localOrderId: string;
  providerOrderId: string;
  keyId: string;
  amount: number;
  currency: "INR";
  packageName: string;
};

type RazorpaySuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type RazorpayInstance = {
  open: () => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
};

type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}
function loadRazorpayCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-qf-razorpay="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("CHECKOUT_LOAD_FAILED")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.qfRazorpay = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("CHECKOUT_LOAD_FAILED"));
    document.head.appendChild(script);
  });
}

function friendlyError(code: string): string {
  const messages: Record<string, string> = {
    PACKAGE_NOT_ACTIVE: "This package is no longer available. Create a new order.",
    PACKAGE_SNAPSHOT_DRIFT: "This package changed before payment started. Create a new order.",
    PACKAGE_ORDER_CREATION_UNCERTAIN: "Payment setup needs review before you retry. No credits were activated.",
    PAYMENT_SIGNATURE_INVALID: "Payment verification failed. No credits were activated.",
    PAYMENT_NOT_CAPTURED: "Payment is still processing. Credits will activate only after capture.",
  };
  return messages[code] ?? "Payment could not be completed. Please try again or contact support.";
}
export function VendorPackagePayButton({ orderId }: { orderId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "verifying" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function verify(localOrderId: string, response: RazorpaySuccess) {
    setState("verifying");
    const verifyResponse = await fetch("/api/vendor/package-payment/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ localOrderId, ...response }),
    });
    const payload = (await verifyResponse.json().catch(() => ({}))) as { ok?: boolean; code?: string };
    if (!verifyResponse.ok || !payload.ok) {
      throw new Error(payload.code || "PAYMENT_VERIFY_FAILED");
    }
    window.location.assign("/vendor/dashboard/package?order=paid");
  }

  async function startCheckout() {
    setState("loading");
    setMessage(null);
    try {
      const response = await fetch("/api/vendor/package-payment/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        code?: string;
        checkout?: Checkout;
      };
      if (!response.ok || !payload.ok || !payload.checkout) {
        throw new Error(payload.code || "CHECKOUT_CREATE_FAILED");
      }
      await loadRazorpayCheckout();
      if (!window.Razorpay) throw new Error("CHECKOUT_LOAD_FAILED");

      const checkout = payload.checkout;
      const instance = new window.Razorpay({
        key: checkout.keyId,
        amount: checkout.amount,
        currency: checkout.currency,
        name: "QuickFurno",
        description: `${checkout.packageName} — TEST MODE`,
        order_id: checkout.providerOrderId,
        handler: (success: RazorpaySuccess) => {
          void verify(checkout.localOrderId, success).catch((error: Error) => {
            setState("error");
            setMessage(friendlyError(error.message));
          });
        },
        modal: {
          ondismiss: () => {
            setState((current) => current === "verifying" ? current : "idle");
          },
        },
      });

      instance.on("payment.failed", () => {
        setState("error");
        setMessage("The test payment failed. You can retry this order.");
      });
      setState("idle");
      instance.open();
    } catch (error) {
      const code = error instanceof Error ? error.message : "CHECKOUT_CREATE_FAILED";
      setState("error");
      setMessage(friendlyError(code));
    }
  }
  const busy = state === "loading" || state === "verifying";
  return (
    <div className="qf-vendor-v2-package-pay">
      <button
        type="button"
        className="qf-vendor-v2-btn qf-vendor-v2-btn--primary"
        disabled={busy}
        onClick={() => void startCheckout()}
      >
        {state === "loading" ? "Opening test checkout…" : state === "verifying" ? "Verifying payment…" : "Pay now · TEST MODE"}
      </button>
      {message ? <p className="qf-vendor-v2-package-pay-error" role="alert">{message}</p> : null}
    </div>
  );
}
