"use client";

import { useState } from "react";
import { vendorUpdateLeadStatusFromForm } from "@/app/actions";
import { VendorIcon } from "../icons";
import { SETTABLE_LEAD_STATUSES } from "./leadsModel";

/**
 * Replaces the pre-V2 row of seven submit buttons with one select + one submit.
 *
 * The server contract is untouched: this is still a plain <form> posting
 * `assignmentId` and `status` to vendorUpdateLeadStatusFromForm, exactly the
 * fields the previous seven forms posted. No new action, no new field, no
 * client-side mutation.
 *
 * The select is a "change to…" control rather than a mirror of the current
 * status, which is displayed as a chip on the card. That also keeps legacy
 * "Won" rows honest: such a lead shows "Won" on its chip, while the dropdown
 * only ever offers the seven settable statuses.
 */
export function VendorLeadStatusControl({
  assignmentId,
  currentStatus,
}: {
  assignmentId: string;
  currentStatus: string;
}) {
  const [next, setNext] = useState("");
  const selectId = `qf-status-${assignmentId}`;

  return (
    <form action={vendorUpdateLeadStatusFromForm} className="qf-vendor-v2-leads-status-form">
      <input type="hidden" name="assignmentId" value={assignmentId} />

      <label className="qf-vendor-v2-leads-field">
        <span className="qf-vendor-v2-leads-field-label">Update status</span>
        <select
          id={selectId}
          name="status"
          required
          value={next}
          onChange={(event) => setNext(event.target.value)}
          className="qf-vendor-v2-leads-select"
        >
          <option value="" disabled>
            Choose a new status…
          </option>
          {SETTABLE_LEAD_STATUSES.map((status) => (
            <option key={status} value={status} disabled={status === currentStatus}>
              {status}
              {status === currentStatus ? " (current)" : ""}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        className="qf-vendor-v2-btn qf-vendor-v2-btn--primary"
        disabled={next === "" || next === currentStatus}
      >
        Save
      </button>

      {/* "Lost" looks destructive but is not: it is a CRM state only. Say so
          at the moment it is chosen, rather than warning about it up front. */}
      {next === "Lost" ? (
        <p className="qf-vendor-v2-leads-status-help" role="note">
          <VendorIcon name="alert" size={15} />
          Marks this lead as lost in your CRM. It does not refund lead credit, remove the
          assignment, or reassign the lead.
        </p>
      ) : null}
    </form>
  );
}
