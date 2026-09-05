import Link from "next/link";
import type { VendorProfileSummary } from "@/lib/types";
import type {
  VendorApprovedProfileSummary,
  VendorProfileChangeRequest,
} from "@/services/vendorProfileChangeService";
import { VendorIcon } from "../icons";
import { VendorProfileEditor } from "./VendorProfileEditor";
import { VendorProfileFeedback } from "./VendorProfileFeedback";
import {
  VendorProfileAccountDetails,
  VendorProfileApprovalStatus,
  VendorProfileCompletion,
  VendorProfileRequestHistory,
} from "./VendorProfileStatusPanels";
import {
  deriveApprovalState,
  evaluatePublicProfileCompletion,
  readApprovedProfile,
  type ProfileFeedback,
} from "./profileModel";

/**
 * The whole My Profile surface, given already-loaded data.
 *
 * Data loading stays in page.tsx; this component only presents. Keeping the
 * entire body here means the visual-QA harness renders the exact markup that
 * ships, instead of a copy that can drift away from it.
 */
export function VendorProfileWorkspace({
  vendor,
  summary,
  requests,
  feedback,
  loadError,
}: {
  vendor: VendorProfileSummary;
  summary: VendorApprovedProfileSummary | null;
  requests: VendorProfileChangeRequest[];
  feedback: ProfileFeedback | null;
  loadError: boolean;
}) {
  // The APPROVED values — what clients see now, and what the editor starts from.
  const current = readApprovedProfile(summary, vendor);
  const completion = evaluatePublicProfileCompletion(current);
  const approval = deriveApprovalState(requests);

  // The public vendor route resolves by slug OR id; no slug exists on the
  // summary, so the id is the safe fallback. Only offered when the profile is
  // actually reachable — public_visibility is the existing gate.
  const publicProfileHref = vendor.public_visibility ? `/vendors/${vendor.id}` : null;

  return (
    <div className="qf-vendor-v2-profile">
      <header className="qf-vendor-v2-profile-head">
        <div>
          <h1 className="qf-vendor-v2-profile-title">My Profile</h1>
          <p className="qf-vendor-v2-profile-sub">
            Manage the information clients see on your QuickFurno profile.
          </p>
        </div>
        <div className="qf-vendor-v2-profile-headactions">
          {publicProfileHref ? (
            <Link
              href={publicProfileHref}
              className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet"
              target="_blank"
              rel="noopener noreferrer"
            >
              View public profile
              <VendorIcon name="external" size={16} />
            </Link>
          ) : (
            <span className="qf-vendor-v2-profile-hiddenchip">
              <VendorIcon name="lock" size={14} />
              Hidden from clients
            </span>
          )}
        </div>
      </header>

      {feedback ? <VendorProfileFeedback feedback={feedback} /> : null}

      {loadError ? (
        <div className="qf-vendor-v2-profile-alert" data-tone="error" role="status">
          <span className="qf-vendor-v2-profile-alert-icon" aria-hidden="true">
            <VendorIcon name="alert" size={18} />
          </span>
          <p className="qf-vendor-v2-profile-alert-text">
            Some profile information could not be loaded. Please refresh in a moment.
          </p>
        </div>
      ) : null}

      <div className="qf-vendor-v2-profile-layout">
        {/*
          Rail first in the DOM, so a phone reads the approval state and the
          completion score before reaching the form. On desktop it becomes the
          sticky right-hand column.

          Account details and request history sit at the END of the main column
          rather than in the rail: they are reference material, and a rail tall
          enough to hold them left a large empty gap beside the form.
        */}
        <div className="qf-vendor-v2-profile-rail">
          <VendorProfileApprovalStatus state={approval} />
          <VendorProfileCompletion completion={completion} />
        </div>

        <div className="qf-vendor-v2-profile-main">
          <VendorProfileEditor current={current} />
          <VendorProfileAccountDetails vendor={vendor} />
          <VendorProfileRequestHistory requests={requests} />
        </div>
      </div>
    </div>
  );
}
