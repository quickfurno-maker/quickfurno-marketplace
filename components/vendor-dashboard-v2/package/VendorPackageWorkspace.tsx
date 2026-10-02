import Link from "next/link";
import { vendorCreatePackageOrder } from "@/app/actions";
import type { VendorProfileSummary } from "@/lib/types";
import type {
  VendorCurrentPackageSummary,
  VendorPackageOption,
  VendorPackageOrder,
} from "@/services/vendorPackageOrderService";
import type { VendorPackagePaymentAvailability } from "@/services/vendorPackagePaymentService";
import { VendorIcon } from "../icons";
import { VendorPackagePayButton } from "./VendorPackagePayButton";
import { VendorUtilityAlert, VendorUtilityEmpty, VendorUtilityHeader } from "../VendorUtilityChrome";
import {
  deriveCreditState,
  formatCount,
  formatDate,
  formatINR,
  isPackageActive,
  orderChips,
  packageStatusLabel,
  readableFailureReason,
  type PackageFeedback,
} from "./packageModel";

/**
 * Credits & Package.
 *
 * Package selection still creates an immutable local ORDER INTENT first. A
 * payable order then enters the hardened Razorpay authority: server-created
 * provider order -> verified/captured payment -> atomic package/credit activation.
 * The browser never marks an order paid and never grants credits.
 *
 * Shared with the visual-QA harness so screenshots cannot drift from what ships.
 */
export function VendorPackageWorkspace({
  vendor,
  summary,
  packages,
  orders,
  feedback,
  paymentAvailability,
  loadError,
}: {
  vendor: VendorProfileSummary;
  summary: VendorCurrentPackageSummary | null;
  packages: VendorPackageOption[];
  orders: VendorPackageOrder[];
  feedback: PackageFeedback | null;
  paymentAvailability: VendorPackagePaymentAvailability;
  loadError: boolean;
}) {
  const credits = deriveCreditState(summary, {
    remaining: vendor.remaining_credits ?? 0,
    total: vendor.total_credits ?? 0,
  });
  const active = isPackageActive(summary);
  const expiry = summary?.package_expires_at ?? null;

  return (
    <div className="qf-vendor-v2-package">
      <VendorUtilityHeader
        title="Credits & Package"
        subtitle="Manage your matching credits and QuickFurno package."
        action={
          <Link href="/vendor/dashboard/support" className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet">
            Support
          </Link>
        }
      />

      {feedback ? (
        <VendorUtilityAlert tone={feedback.tone}>{feedback.message}</VendorUtilityAlert>
      ) : null}

      {loadError ? (
        <VendorUtilityAlert tone="error">
          Some package information could not be loaded. Please refresh in a moment.
        </VendorUtilityAlert>
      ) : null}

      {/* Balance first: the number a vendor opens this page for. */}
      <section className="qf-vendor-v2-panel qf-vendor-v2-package-balance">
        <div className="qf-vendor-v2-package-balance-main">
          <p className="qf-vendor-v2-package-balance-label">Remaining matching credits</p>
          <strong className="qf-vendor-v2-package-balance-value" data-tone={credits.tone}>
            {formatCount(credits.remaining)}
          </strong>
          <p className="qf-vendor-v2-package-balance-of">
            {credits.total > 0
              ? `${formatCount(credits.remaining)} of ${formatCount(credits.total)} matching credits remaining`
              : "No package credits recorded yet"}
          </p>

          {/* Only drawn when total > 0 — a bar from a zero denominator says nothing. */}
          {credits.percent !== null ? (
            <div
              className="qf-vendor-v2-progress-track qf-vendor-v2-package-bar"
              role="progressbar"
              aria-valuenow={credits.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Matching credits remaining"
            >
              <span
                className="qf-vendor-v2-progress-fill"
                data-tone={credits.tone}
                style={{ width: `${credits.percent}%` }}
              />
            </div>
          ) : null}

          <p className="qf-vendor-v2-package-balance-state" data-tone={credits.tone}>
            <VendorIcon name={credits.tone === "ok" ? "check" : "alert"} size={15} />
            {credits.headline}. {credits.detail}
          </p>
        </div>

        <dl className="qf-vendor-v2-package-facts">
          <div>
            <dt>Package</dt>
            <dd>{summary?.package_name || "Not active"}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd data-tone={active ? "ok" : "pending"}>{packageStatusLabel(summary)}</dd>
          </div>
          <div>
            <dt>Total credits</dt>
            <dd>{formatCount(credits.total)}</dd>
          </div>
          {expiry ? (
            <div>
              <dt>Valid until</dt>
              <dd>{formatDate(expiry)}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {/* Available packages */}
      <section className="qf-vendor-v2-panel">
        <header className="qf-vendor-v2-package-sectionhead">
          <div>
            <h2 className="qf-vendor-v2-panel-title">Available packages</h2>
            <p className="qf-vendor-v2-package-sectionhint">
              Creating an order tells QuickFurno which package you want.
            </p>
          </div>
        </header>

        <VendorUtilityAlert tone={paymentAvailability.enabled ? "info" : "error"} icon="lock">
          {paymentAvailability.enabled
            ? paymentAvailability.mode === "test"
              ? "Razorpay TEST mode is active. Create an order, then use its Pay button below to run a sandbox payment."
              : "Secure Razorpay payment is active. Create an order, then pay it from Order history. Credits activate only after captured payment is verified."
            : paymentAvailability.reason === "invalid_config"
              ? "Online payment is configured but not ready. QuickFurno support must complete the Razorpay credentials before payment can start."
              : "Online package payment is currently disabled. You can create an order without being charged."}
        </VendorUtilityAlert>

        {packages.length === 0 ? (
          <VendorUtilityEmpty
            icon="credits"
            title="No packages available"
            message="No packages are available right now. Contact support if you were expecting one."
            action={{ label: "Contact support", href: "/vendor/dashboard/support" }}
          />
        ) : (
          <ul className="qf-vendor-v2-package-grid">
            {packages.map((item) => (
              <li key={item.id} className="qf-vendor-v2-package-card">
                <div className="qf-vendor-v2-package-card-body">
                  <h3>{item.name}</h3>
                  <p className="qf-vendor-v2-package-price">
                    {formatINR(item.total_price || item.display_price)}
                  </p>
                  <ul className="qf-vendor-v2-package-card-facts">
                    <li>
                      <VendorIcon name="leads" size={14} />
                      {formatCount(item.lead_count)} matching credits
                    </li>
                    <li>
                      <VendorIcon name="clock" size={14} />
                      {formatCount(item.validity_days)} day validity
                    </li>
                  </ul>
                </div>

                {/* Unchanged action, unchanged field. "Create order", never "Buy". */}
                <form action={vendorCreatePackageOrder}>
                  <input type="hidden" name="packageId" value={item.id} />
                  <button type="submit" className="qf-vendor-v2-btn qf-vendor-v2-btn--primary">
                    Create order
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Order history */}
      <section className="qf-vendor-v2-panel">
        <header className="qf-vendor-v2-package-sectionhead">
          <div>
            <h2 className="qf-vendor-v2-panel-title">Order history</h2>
            <p className="qf-vendor-v2-package-sectionhint">
              Orders stay unactivated until QuickFurno verifies payment.
            </p>
          </div>
        </header>

        {orders.length === 0 ? (
          <VendorUtilityEmpty
            icon="inbox"
            title="No package orders yet"
            message="Orders you create will appear here with their payment and activation status."
          />
        ) : (
          <ul className="qf-vendor-v2-package-orders">
            {orders.map((order) => {
              const reason = readableFailureReason(order);
              return (
                <li key={order.id} className="qf-vendor-v2-package-order">
                  <div className="qf-vendor-v2-package-order-head">
                    <div>
                      <strong>{order.package_name || "Package order"}</strong>
                      <span className="qf-vendor-v2-package-order-meta">
                        {formatDate(order.created_at)}
                        {order.credits_included
                          ? ` · ${formatCount(order.credits_included)} credits`
                          : ""}
                      </span>
                    </div>
                    <span className="qf-vendor-v2-package-order-price">
                      {formatINR(order.package_price)}
                    </span>
                  </div>

                  <dl className="qf-vendor-v2-package-order-chips">
                    {orderChips(order).map((chip) => (
                      <div key={chip.label}>
                        <dt>{chip.label}</dt>
                        <dd data-tone={chip.tone}>{chip.value}</dd>
                      </div>
                    ))}
                  </dl>

                  {reason ? (
                    <p className="qf-vendor-v2-package-order-reason">
                      <VendorIcon name="alert" size={14} />
                      {reason}
                    </p>
                  ) : null}

                  {paymentAvailability.enabled
                    && paymentAvailability.mode
                    && order.activation_status !== "activated"
                    && order.order_status !== "completed" ? (
                      <VendorPackagePayButton orderId={order.id} mode={paymentAvailability.mode} />
                    ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
