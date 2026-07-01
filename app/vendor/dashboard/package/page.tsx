import { vendorCreatePackageOrder } from "@/app/actions";
import { VendorNoProfileFallback } from "@/app/vendor/dashboard/_components/VendorNoProfileFallback";
import {
  getVendorCurrentPackageSummary,
  listAvailableVendorPackages,
  listVendorPackageOrders,
  type VendorPackageOption,
  type VendorPackageOrder,
} from "@/services/vendorPackageOrderService";
import { getMyVendor } from "@/app/actions";

export const metadata = { title: "Vendor package - QuickFurno" };
export const dynamic = "force-dynamic";

type VendorPackagePageProps = {
  searchParams?: {
    order?: string;
    code?: string;
  };
};

export default async function VendorPackagePage({ searchParams }: VendorPackagePageProps) {
  const me = await getMyVendor();
  const vendor = me.ok ? me.data : null;

  if (!vendor) {
    return <VendorNoProfileFallback />;
  }

  const [summaryRes, packagesRes, ordersRes] = await Promise.all([
    getVendorCurrentPackageSummary(vendor.id),
    listAvailableVendorPackages(),
    listVendorPackageOrders(vendor.id),
  ]);

  const summary = summaryRes.ok ? summaryRes.data : null;
  const packages = packagesRes.ok ? packagesRes.data : [];
  const orders = ordersRes.ok ? ordersRes.data : [];
  const loadError = [summaryRes, packagesRes, ordersRes].find((result) => !result.ok);

  return (
    <section className="qf-vd-page">
      {searchParams?.order === "created" ? (
        <div className="qf-vd-card qf-vd-note--pending">
          Package order created. Online payment will be enabled soon. Your package will activate only after verified payment.
        </div>
      ) : null}

      {searchParams?.order === "failed" ? (
        <div className="qf-vd-card qf-vd-note--pending">
          Package order could not be created. Please try again or contact QuickFurno support.
        </div>
      ) : null}

      {loadError && !loadError.ok ? (
        <div className="qf-vd-card qf-vd-note--pending">{loadError.error}</div>
      ) : null}

      <div className="qf-vd-card qf-vd-welcome">
        <div>
          <h1>Package / Recharge</h1>
          <p>
            Create a package order intent for your vendor account. Payment and activation
            remain disabled until QuickFurno connects verified online payment.
          </p>
        </div>
      </div>

      <div className="qf-vd-card">
        <h2 className="qf-vd-card-title">Current package summary</h2>
        <div className="qf-vd-stat-grid">
          <SummaryTile label="Remaining credits" value={summary?.remaining_credits ?? vendor.remaining_credits ?? 0} />
          <SummaryTile label="Total credits" value={summary?.total_credits ?? vendor.total_credits ?? 0} />
          <SummaryTile label="Package" value={summary?.package_name || "Not active"} />
          <SummaryTile label="Status" value={summary?.package_status || "not_activated"} />
        </div>
      </div>

      <div className="qf-vd-card">
        <h2 className="qf-vd-card-title">Available active packages</h2>
        {packages.length ? (
          <div className="qf-vd-package-grid">
            {packages.map((item) => (
              <PackageCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="qf-vd-empty">
            <p>No active packages are available right now.</p>
          </div>
        )}
      </div>

      <div className="qf-vd-card">
        <h2 className="qf-vd-card-title">Package order history</h2>
        {orders.length ? (
          <div className="qf-vd-order-list">
            {orders.map((order) => (
              <OrderRow key={order.id} order={order} />
            ))}
          </div>
        ) : (
          <div className="qf-vd-empty">
            <p>No package orders yet. Your created orders will appear here without activating credits until payment is verified.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function PackageCard({ item }: { item: VendorPackageOption }) {
  return (
    <article className="qf-vd-package-card">
      <div>
        <h3>{item.name}</h3>
        <p>{formatNumber(item.lead_count)} credits included</p>
      </div>
      <strong>{formatINR(item.total_price || item.display_price)}</strong>
      <p>{formatNumber(item.validity_days)} day validity</p>
      <form action={vendorCreatePackageOrder}>
        <input type="hidden" name="packageId" value={item.id} />
        <button type="submit" className="qf-vd-btn qf-vd-btn--primary qf-vd-btn--full">
          Buy Package / Recharge
        </button>
      </form>
    </article>
  );
}

function SummaryTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{typeof value === "number" ? formatNumber(value) : value}</strong>
    </div>
  );
}

function OrderRow({ order }: { order: VendorPackageOrder }) {
  return (
    <article className="qf-vd-order-row">
      <div>
        <strong>{order.package_name || "Package order"}</strong>
        <span>{formatDate(order.created_at)}</span>
      </div>
      <div>
        <span>{formatINR(order.package_price)}</span>
        <em>{order.payment_status || "not_started"}</em>
        <em>{order.activation_status || "not_activated"}</em>
      </div>
    </article>
  );
}

function formatINR(value: unknown) {
  const amount = Number(value ?? 0);
  return amount ? `INR ${amount.toLocaleString("en-IN")}` : "INR 0";
}

function formatNumber(value: unknown) {
  return Number(value ?? 0).toLocaleString("en-IN");
}

function formatDate(value?: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
