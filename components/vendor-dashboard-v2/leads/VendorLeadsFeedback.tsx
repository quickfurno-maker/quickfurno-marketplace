"use client";

import { useRouter } from "next/navigation";
import { VendorIcon } from "../icons";
import type { VendorLeadFeedback } from "./leadsModel";

/**
 * Result banner for the existing ?lead= search-param contract, which the server
 * actions still drive. Dismissing strips the param from the URL so the banner
 * cannot reappear on refresh — it changes nothing on the server.
 *
 * role="status" so the outcome of a status update or a report submission is
 * announced when the banner mounts after the action's redirect.
 */
export function VendorLeadsFeedback({ feedback }: { feedback: VendorLeadFeedback }) {
  const router = useRouter();

  return (
    <div className="qf-vendor-v2-leads-alert" data-tone={feedback.tone} role="status">
      <span className="qf-vendor-v2-leads-alert-icon" aria-hidden="true">
        <VendorIcon name={feedback.tone === "ok" ? "check" : "alert"} size={18} />
      </span>
      <p className="qf-vendor-v2-leads-alert-text">{feedback.message}</p>
      <button
        type="button"
        className="qf-vendor-v2-iconbtn"
        aria-label="Dismiss message"
        onClick={() => router.replace("/vendor/dashboard/leads")}
      >
        <VendorIcon name="close" size={16} />
      </button>
    </div>
  );
}
