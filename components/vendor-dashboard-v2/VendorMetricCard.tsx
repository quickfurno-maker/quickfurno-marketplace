import Link from "next/link";
import { VendorIcon, type VendorIconName } from "./icons";

export interface VendorMetric {
  key: string;
  label: string;
  value: string;
  /** One short line explaining exactly what the number counts. */
  caption: string;
  icon: VendorIconName;
  tone?: "default" | "warn" | "ok";
  href?: string;
}

/**
 * One KPI. Four of these sit above the fold; there is no fifth, and no metric
 * appears here that is not directly derived from a loaded row.
 */
export function VendorMetricCard({ metric }: { metric: VendorMetric }) {
  const body = (
    <>
      <span className="qf-vendor-v2-metric-top">
        <span className="qf-vendor-v2-metric-icon" aria-hidden="true">
          <VendorIcon name={metric.icon} size={18} />
        </span>
        <span className="qf-vendor-v2-metric-label">{metric.label}</span>
      </span>
      <strong className="qf-vendor-v2-metric-value">{metric.value}</strong>
      <span className="qf-vendor-v2-metric-caption">{metric.caption}</span>
    </>
  );

  if (metric.href) {
    return (
      <Link href={metric.href} className="qf-vendor-v2-metric" data-tone={metric.tone ?? "default"}>
        {body}
      </Link>
    );
  }

  return (
    <div className="qf-vendor-v2-metric" data-tone={metric.tone ?? "default"}>
      {body}
    </div>
  );
}

export function VendorMetricGrid({ metrics }: { metrics: VendorMetric[] }) {
  return (
    <div className="qf-vendor-v2-metric-grid">
      {metrics.map((metric) => (
        <VendorMetricCard key={metric.key} metric={metric} />
      ))}
    </div>
  );
}
