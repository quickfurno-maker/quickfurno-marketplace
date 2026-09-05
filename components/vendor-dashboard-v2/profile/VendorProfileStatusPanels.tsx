import Link from "next/link";
import type { VendorProfileSummary } from "@/lib/types";
import { VendorIcon, type VendorIconName } from "../icons";
import {
  REQUEST_STATUS_LABEL,
  formatRequestDate,
  summarizeProposedChanges,
  type ProfileApprovalState,
  type ProfileApprovalTone,
  type ProfileCompletion,
} from "./profileModel";
import type { VendorProfileChangeRequest } from "@/services/vendorProfileChangeService";

const TONE_ICON: Record<ProfileApprovalTone, VendorIconName> = {
  live: "check",
  pending: "clock",
  rejected: "alert",
};

/**
 * Live / pending / rejected — the state of the REQUEST, never the vendor's
 * verification status. Tone drives colour, but the title always carries the
 * meaning in words, so nothing is communicated by colour alone.
 */
export function VendorProfileApprovalStatus({ state }: { state: ProfileApprovalState }) {
  const proposed = state.pending ? summarizeProposedChanges(state.pending.proposed_changes) : [];

  return (
    <section className="qf-vendor-v2-panel">
      <div className="qf-vendor-v2-profile-status" data-tone={state.tone}>
        <span className="qf-vendor-v2-profile-status-icon" aria-hidden="true">
          <VendorIcon name={TONE_ICON[state.tone]} size={18} />
        </span>
        <div>
          <p className="qf-vendor-v2-profile-status-title">{state.title}</p>
          <p className="qf-vendor-v2-profile-status-detail">{state.detail}</p>
        </div>
      </div>

      {state.pendingCount > 1 ? (
        <p className="qf-vendor-v2-profile-hint qf-vendor-v2-profile-status-note">
          {state.pendingCount} requests are waiting for review.
        </p>
      ) : null}

      {proposed.length > 0 ? (
        <>
          <p className="qf-vendor-v2-profile-sublabel">Awaiting review</p>
          <dl className="qf-vendor-v2-profile-proposed">
            {proposed.map((change) => (
              <div key={change.label}>
                <dt>{change.label}</dt>
                <dd>{change.value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      {state.tone === "rejected" ? (
        <p className="qf-vendor-v2-profile-hint qf-vendor-v2-profile-status-note">
          Update the details below and submit again.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Completion of the LIVE approved profile. UI-only and never persisted; it is
 * not verification status and not package eligibility.
 */
export function VendorProfileCompletion({ completion }: { completion: ProfileCompletion }) {
  return (
    <section className="qf-vendor-v2-panel">
      <h2 className="qf-vendor-v2-panel-title">Public profile completion</h2>

      <div className="qf-vendor-v2-profile-progress-head">
        <strong>{completion.percent}%</strong>
        <span>
          {completion.present} of {completion.total} details added
        </span>
      </div>

      <div
        className="qf-vendor-v2-progress-track"
        role="progressbar"
        aria-valuenow={completion.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Public profile completion"
      >
        <span className="qf-vendor-v2-progress-fill" style={{ width: `${completion.percent}%` }} />
      </div>

      {completion.complete ? (
        <p className="qf-vendor-v2-profile-complete">
          <VendorIcon name="check" size={16} />
          Your public profile has everything clients look for.
        </p>
      ) : (
        <>
          <p className="qf-vendor-v2-profile-sublabel">Still missing</p>
          <ul className="qf-vendor-v2-profile-missing">
            {completion.missing.slice(0, 5).map((item) => (
              <li key={item.key}>
                <VendorIcon name="alert" size={14} />
                {item.label}
              </li>
            ))}
          </ul>
          {completion.missing.length > 5 ? (
            <p className="qf-vendor-v2-profile-hint">
              and {completion.missing.length - 5} more below.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * Operational details that are NOT part of a public change request. Read-only
 * because no vendor-side authority exists to edit them.
 */
export function VendorProfileAccountDetails({ vendor }: { vendor: VendorProfileSummary }) {
  const rows: { label: string; value: string }[] = [
    { label: "Owner", value: vendor.owner_name || "—" },
    { label: "WhatsApp", value: vendor.whatsapp_number || vendor.phone || "—" },
    { label: "Email", value: vendor.email || "—" },
    { label: "Business city", value: vendor.city || "—" },
    { label: "Business type", value: vendor.business_type || "—" },
    {
      label: "Verification",
      value: vendor.verification_status || vendor.status || "Under review",
    },
    { label: "Account", value: vendor.is_active === false ? "Inactive" : "Active" },
  ];

  return (
    <section className="qf-vendor-v2-panel">
      <h2 className="qf-vendor-v2-panel-title">Account &amp; business details</h2>
      <dl className="qf-vendor-v2-profile-account">
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="qf-vendor-v2-profile-hint">
        These are not part of your public listing.{" "}
        <Link href="/vendor/dashboard/support">Contact QuickFurno support</Link> if they need
        correcting.
      </p>
    </section>
  );
}

/** Latest requests, from the list the page already loaded. No new query. */
export function VendorProfileRequestHistory({
  requests,
}: {
  requests: VendorProfileChangeRequest[];
}) {
  if (requests.length === 0) return null;

  return (
    <section className="qf-vendor-v2-panel">
      <h2 className="qf-vendor-v2-panel-title">Recent requests</h2>
      <ul className="qf-vendor-v2-profile-history">
        {requests.slice(0, 3).map((request) => (
          <li key={request.id}>
            <div className="qf-vendor-v2-profile-history-head">
              <span className="qf-vendor-v2-profile-history-date">
                {formatRequestDate(request.created_at)}
              </span>
              <span className="qf-vendor-v2-profile-history-status" data-status={request.status}>
                {REQUEST_STATUS_LABEL[request.status] ?? request.status}
              </span>
            </div>
            {request.reviewed_at ? (
              <p className="qf-vendor-v2-profile-history-meta">
                Reviewed {formatRequestDate(request.reviewed_at)}
              </p>
            ) : null}
            {request.status === "rejected" && request.rejection_reason ? (
              <p className="qf-vendor-v2-profile-history-reason">{request.rejection_reason}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {requests.length > 3 ? (
        <p className="qf-vendor-v2-profile-hint">
          Showing your 3 most recent requests of {requests.length}.
        </p>
      ) : null}
    </section>
  );
}
