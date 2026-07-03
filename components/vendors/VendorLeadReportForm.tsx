"use client";

// ============================================================================
// QuickFurno — Phase 26A-2C structured vendor lead-issue report.
// Replaces the old free-text prompt: fixed machine-readable reasons + a
// conditionally-required comment (min 20 chars). Reporting never refunds
// credit, never removes the assignment, and never sends WhatsApp.
// ============================================================================
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { vendorSubmitLeadReport } from "@/app/actions";

// Mirrors services/vendorService.ts LEAD_REPORT_REASONS (client-safe copy).
const REASONS = [
  { code: "client_not_reachable", label: "Client not reachable after multiple attempts", commentRequired: false },
  { code: "requirement_already_closed", label: "Client says requirement is already closed", commentRequired: false },
  { code: "service_mismatch", label: "Client requirement does not match selected service", commentRequired: true },
  { code: "outside_service_area", label: "Client location is outside my service area", commentRequired: true },
  { code: "invalid_wrong_phone", label: "Invalid or wrong phone number", commentRequired: true },
  { code: "other", label: "Other reason", commentRequired: true },
] as const;

const COMMENT_MIN = 20;

export function VendorLeadReportForm({ vendorId, assignmentId }: { vendorId: string; assignmentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  const reason = REASONS.find((r) => r.code === reasonCode);
  const commentRequired = reason?.commentRequired ?? false;

  function submit() {
    setError(null);
    if (!reason) { setError("Please choose a reason."); return; }
    const trimmed = comment.trim();
    if (commentRequired && trimmed.length < COMMENT_MIN) {
      setError(`Please add at least ${COMMENT_MIN} characters explaining the issue.`);
      return;
    }
    startTransition(async () => {
      const res = await vendorSubmitLeadReport(vendorId, assignmentId, reason.code, trimmed || undefined);
      if (!res.ok) { setError(res.error ?? "Could not submit the report."); return; }
      setDone(true);
      router.refresh();
    });
  }

  if (done) {
    return (
      <p className="qf-vd-report-done">
        Your report has been submitted for admin review. Reporting a lead does not automatically reverse lead credit.
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className="qf-vd-link" onClick={() => setOpen(true)}>
        Report lead issue
      </button>
    );
  }

  return (
    <div className="qf-vd-bad-lead-form">
      <label>
        Reason
        <select value={reasonCode} onChange={(e) => { setReasonCode(e.target.value); setError(null); }}>
          <option value="" disabled>Select a reason</option>
          {REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
      </label>
      {reason ? (
        <label>
          Comment {commentRequired ? "(required, min 20 characters)" : "(optional)"}
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={700}
            rows={3}
            placeholder={commentRequired ? "Explain the issue for admin review." : "Optional details for admin review."}
          />
        </label>
      ) : null}
      {error ? <p className="qf-vd-error">{error}</p> : null}
      <div className="qf-vd-pills">
        <button type="button" className="qf-vd-btn qf-vd-btn--ghost" disabled={isPending} onClick={submit}>
          {isPending ? "Submitting…" : "Submit report"}
        </button>
        <button type="button" className="qf-vd-link" onClick={() => { setOpen(false); setError(null); }}>cancel</button>
      </div>
      <p className="qf-vd-note">Reporting a lead does not automatically reverse lead credit. An admin will review your report.</p>
    </div>
  );
}
