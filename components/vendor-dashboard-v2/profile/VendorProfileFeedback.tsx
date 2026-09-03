"use client";

import { useRouter } from "next/navigation";
import { VendorIcon } from "../icons";
import type { ProfileFeedback } from "./profileModel";

/**
 * Result banner for the existing ?request= contract, which
 * vendorSubmitProfileChangeRequest still drives. Dismissing strips the param
 * from the URL so the banner cannot survive a refresh; nothing server-side
 * changes. role="status" announces the outcome when it mounts after the
 * action's redirect.
 */
export function VendorProfileFeedback({ feedback }: { feedback: ProfileFeedback }) {
  const router = useRouter();

  return (
    <div className="qf-vendor-v2-profile-alert" data-tone={feedback.tone} role="status">
      <span className="qf-vendor-v2-profile-alert-icon" aria-hidden="true">
        <VendorIcon name={feedback.tone === "ok" ? "check" : "alert"} size={18} />
      </span>
      <p className="qf-vendor-v2-profile-alert-text">{feedback.message}</p>
      <button
        type="button"
        className="qf-vendor-v2-iconbtn"
        aria-label="Dismiss message"
        onClick={() => router.replace("/vendor/dashboard/profile")}
      >
        <VendorIcon name="close" size={16} />
      </button>
    </div>
  );
}
