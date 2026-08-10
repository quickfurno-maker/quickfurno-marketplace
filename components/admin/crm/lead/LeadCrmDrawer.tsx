"use client";

import { useEffect, useState } from "react";
import {
  adminGetLeadClarificationResponses,
  adminSaveLeadClarificationResponses,
} from "@/app/actions";
import {
  Drawer,
  EmptyState,
  InfoGrid,
  StatusBadge,
} from "../../AdminPrimitives";
import {
  type ClientNotificationLog,
  type Lead,
  type LeadClarificationResponseRow,
  type LeadDeliveryLog,
  type Vendor,
} from "../../adminTypes";
import {
  formatDate,
  maskEmail,
} from "../../adminUtils";
import { PRIORITY_TONE, type CrmRow } from "./leadCrmTypes";
import {
  waNumber,
  preferredBadge,
  clarificationLabel,
  clarificationBadge,
  questionOptions,
  normalizeClarificationQuestions,
  cap,
} from "./leadCrmUtils";
import { DrawerSection } from "./leadCrmShared";

export function LeadDrawer({
  row,
  vendorsById,
  deliveryLogs,
  notificationLogs,
  onPrepareClarification,
  onRefresh,
  notify,
  isPending,
  onClose,
}: {
  row: CrmRow;
  vendorsById: Map<string, Vendor>;
  deliveryLogs: LeadDeliveryLog[];
  notificationLogs: ClientNotificationLog[];
  onPrepareClarification: (leadId: string) => void;
  onRefresh: () => void;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
  isPending: boolean;
  onClose: () => void;
}) {
  const lead = row.lead;

  // Phase 1.6 — admin-entered clarification answers (preview ingestion).
  const requestId = row.latestClarification?.id ?? null;
  const questions = normalizeClarificationQuestions(row.latestClarification?.questions_json);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [responses, setResponses] = useState<LeadClarificationResponseRow[]>([]);
  const clarify = clarificationBadge(row);

  useEffect(() => {
    let active = true;
    setAnswers({});
    setSaveResult(null);
    if (!row.id || !requestId) {
      setResponses([]);
      return;
    }
    adminGetLeadClarificationResponses(row.id, requestId)
      .then((result) => { if (active) setResponses(result.ok ? result.data : []); })
      .catch(() => { if (active) setResponses([]); });
    return () => { active = false; };
  }, [row.id, requestId]);

  function handleSaveResponses() {
    if (!requestId) return;
    const payload = questions
      .map((question) => {
        const value = (answers[question.key] ?? "").trim();
        if (!value) return null;
        const label = question.options.find((option) => option.value === value)?.label ?? value;
        return { question_key: question.key, answer_value: value, answer_label: label };
      })
      .filter((entry): entry is { question_key: string; answer_value: string; answer_label: string } => entry !== null);

    if (payload.length === 0) {
      setSaveResult({ tone: "error", message: "Select or enter at least one answer before saving." });
      return;
    }

    setSaving(true);
    setSaveResult(null);
    adminSaveLeadClarificationResponses(row.id, requestId, payload)
      .then((result) => {
        if (!result.ok) {
          const message = result.error ?? "Could not save clarification answers.";
          setSaveResult({ tone: "error", message });
          notify(message, "error");
          return;
        }
        const { score, status } = result.data;
        const upgraded = status === "completed_upgraded";
        setSaveResult({
          tone: "success",
          message: `Saved. New score ${score.total_score}/100 (class ${score.score_class}). ${upgraded ? "Lead upgraded to Manual Review." : "Still incomplete — clarification still required."}`,
        });
        notify(upgraded ? "Clarification saved — lead upgraded to Manual Review." : "Clarification saved — lead still incomplete.", "success");
        setAnswers({});
        adminGetLeadClarificationResponses(row.id, requestId)
          .then((refetch) => { if (refetch.ok) setResponses(refetch.data); })
          .catch(() => {});
        onRefresh();
      })
      .catch(() => {
        setSaveResult({ tone: "error", message: "Could not save clarification answers." });
        notify("Could not save clarification answers.", "error");
      })
      .finally(() => setSaving(false));
  }

  return (
    <Drawer
      title={row.name}
      subtitle={`${row.service} · ${row.city}`}
      onClose={onClose}
      width="2xl"
      /* Identity, state and the two contact affordances live in fixed drawer
         chrome so they stay visible while the body scrolls. */
      header={
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge value={row.statusLabel} />
          <StatusBadge value={cap(row.priority)} tone={PRIORITY_TONE[row.priority]} />
          {row.qualityBadge ? <StatusBadge value={row.qualityBadge.label} tone={row.qualityBadge.tone} /> : null}
          <StatusBadge value={row.source} tone="slate" />
          {row.preferredBadge ? <StatusBadge value={row.preferredBadge.label} tone={row.preferredBadge.tone} /> : null}
          {row.phoneDigits ? (
            <span className="ml-auto flex shrink-0 gap-1.5">
              <a
                href={`tel:${row.phoneDigits}`}
                aria-label={`Call ${row.name}`}
                className="qfa-focus inline-flex h-8 items-center rounded-[var(--qfa-radius-sm)] border border-[color:var(--qfa-line)] bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Call
              </a>
              <a
                href={`https://wa.me/${waNumber(row.phoneDigits)}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open WhatsApp chat with ${row.name}`}
                className="qfa-focus inline-flex h-8 items-center rounded-[var(--qfa-radius-sm)] border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                WhatsApp
              </a>
            </span>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        <DrawerSection title="Client & source">
          <InfoGrid rows={[
            ["Phone", row.phone || "Not set"],
            ["Email", lead.email || maskEmail(lead.email) || "Not set"],
            ["City / Area", [row.area, row.city].filter((v) => v && v !== "Not set").join(", ") || row.city],
            ["Source", row.source],
            ["UTM source", lead.utm_source || "—"],
            ["UTM medium", lead.utm_medium || "—"],
            ["UTM campaign", lead.utm_campaign || "—"],
            ["Landing page", lead.page_url || "—"],
            ["Created", formatDate(row.createdAt)],
          ]} />
        </DrawerSection>

        <DrawerSection title="Requirement">
          <InfoGrid rows={[
            ["Service", row.service],
            ["Subcategory", lead.subcategory || "Not set"],
            ["Budget", row.budget],
            ["Timeline", row.timeline],
            ["Property type", lead.property_type || "Not set"],
          ]} />
          {lead.message ? (
            <p className="mt-2 whitespace-pre-wrap rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line-soft)] bg-white px-3 py-2 text-[13px] leading-5 text-slate-700">
              {lead.message}
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-slate-500">No requirement message was submitted.</p>
          )}
        </DrawerSection>

        <DrawerSection title="Readiness">
          <InfoGrid rows={[
            ["Score", lead.lead_quality_score != null ? `${lead.lead_quality_score}/100` : "Not scored"],
            ["Class", lead.lead_quality_class || "Not scored"],
            ["Quality status", (lead.lead_quality_status || "Not set").replace(/_/g, " ")],
            ["Recommended action", (lead.lead_quality_recommended_action || "Not set").replace(/_/g, " ")],
            ["Hard block", (lead.lead_quality_hard_block_reason || "None").replace(/_/g, " ")],
            ["Clarification required", lead.clarification_required ? "Yes" : "No"],
            ["Clarification status", clarificationLabel(row)],
            ["Missing fields", (lead.clarification_missing_fields ?? row.latestClarification?.missing_fields ?? []).join(", ") || "None"],
            ["Verification", lead.verification_status || "—"],
            ["Checked at", lead.lead_quality_checked_at ? formatDate(lead.lead_quality_checked_at) : "Not checked"],
            // The rows above mirror the latest score summary carried on the lead
            // itself. The per-signal history lives in the restricted lead_scores
            // table, which the admin snapshot does not load — so we say that
            // plainly instead of rendering a developer TODO into the admin UI.
            // BACKEND_DEPENDENCY: lead_scores history is not exposed by
            // getSuperadminSnapshot; a detailed breakdown needs that read first.
            ["Breakdown", "Summary only — the per-signal history is not loaded in this view."],
          ]} />
        </DrawerSection>

        <DrawerSection title="WhatsApp clarification">
          <div className="space-y-3">
            {/* Required / status / missing fields moved up into Readiness so
                this section is purely the clarification workflow. */}
            <InfoGrid rows={[
              ["Score before", row.latestClarification?.score_before != null ? `${row.latestClarification.score_before}/100` : "Not captured"],
              ["Class before", row.latestClarification?.score_class_before || "Not captured"],
              ["Parent category", row.latestClarification?.parent_category_group || "Not set"],
              ["Marketplace category", row.latestClarification?.marketplace_category || "Not set"],
              ["Service required", row.latestClarification?.service_required || "Not set"],
              ["Response status", row.latestClarification?.response_received_at ? "Response received" : "No response yet"],
            ]} />

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => onPrepareClarification(row.id)}
                disabled={isPending || Boolean(row.latestClarification)}
                className="qfa-focus inline-flex h-8 items-center rounded-[var(--qfa-radius-sm)] border border-amber-200 bg-amber-50 px-2.5 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-amber-50"
              >
                {row.latestClarification ? "Preview already prepared" : "Prepare clarification preview"}
              </button>
              <span className="inline-flex h-8 items-center rounded-[var(--qfa-radius-sm)] border border-dashed border-[color:var(--qfa-line-strong)] px-2.5 text-xs font-medium text-slate-500">
                WhatsApp sending is off in this phase
              </span>
            </div>

            {row.latestClarification?.preview_message ? (
              <div className="rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line-soft)] bg-white p-3">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Preview message</p>
                <pre className="whitespace-pre-wrap text-xs leading-5 text-slate-700">{row.latestClarification.preview_message}</pre>
              </div>
            ) : (
              <EmptyState title="No clarification preview" message="Prepare a preview for B leads before any WhatsApp sending is enabled." compact />
            )}

            {row.latestClarification?.questions_json?.length ? (
              <ol className="divide-y divide-[color:var(--qfa-line-soft)] rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line-soft)] bg-white">
                {row.latestClarification.questions_json.map((question, index) => (
                  <li key={String(question.key ?? index)} className="px-3 py-2">
                    <p className="text-[13px] font-semibold text-slate-900">{index + 1}. {String(question.text ?? "Question")}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">Options: {questionOptions(question)}</p>
                  </li>
                ))}
              </ol>
            ) : null}

            {/* Phase 1.6 — admin-only manual ingestion of the client's answers. */}
            {requestId ? (
              <div className="rounded-[var(--qfa-radius)] border border-emerald-200 bg-emerald-50/60 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-800">Record client clarification answers</p>
                  <StatusBadge value={clarify.label} tone={clarify.tone} />
                </div>
                <p className="mb-2.5 text-[11px] leading-4 text-emerald-900/75">
                  Admin-only preview ingestion. Saving applies these answers to the lead and recalculates the quality score.
                  No WhatsApp is sent, no vendor is assigned, and no credits are deducted.
                </p>

                {questions.length ? (
                  <div className="space-y-2.5">
                    {questions.map((question, index) => (
                      <div key={question.key} className="space-y-1">
                        <label htmlFor={`clarify-${question.key}`} className="block text-[11px] font-semibold text-slate-700">
                          {index + 1}. {question.text}
                        </label>
                        {question.type === "single_choice" && question.options.length ? (
                          <select
                            id={`clarify-${question.key}`}
                            value={answers[question.key] ?? ""}
                            onChange={(event) => setAnswers((prev) => ({ ...prev, [question.key]: event.target.value }))}
                            className="qfa-control qfa-select w-full px-2.5"
                          >
                            <option value="">Select an answer…</option>
                            {question.options.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={`clarify-${question.key}`}
                            type="text"
                            value={answers[question.key] ?? ""}
                            onChange={(event) => setAnswers((prev) => ({ ...prev, [question.key]: event.target.value }))}
                            placeholder="Type the client's answer…"
                            className="qfa-control w-full px-2.5 outline-none"
                          />
                        )}
                      </div>
                    ))}

                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={handleSaveResponses}
                        disabled={saving}
                        className="qfa-focus inline-flex h-8 items-center rounded-[var(--qfa-radius-sm)] bg-emerald-600 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        {saving ? "Saving…" : "Save answers & rescore"}
                      </button>
                      {saveResult ? (
                        <span
                          role="status"
                          className={`text-[11px] font-semibold ${saveResult.tone === "success" ? "text-emerald-800" : "text-rose-700"}`}
                        >
                          {saveResult.message}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <EmptyState title="No structured questions" message="This preview has no structured questions to answer." compact />
                )}
              </div>
            ) : null}

            {/* Phase 1.6 — saved answer history from lead_clarification_responses. */}
            {responses.length ? (
              <div className="rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line-soft)] bg-white">
                <p className="border-b border-[color:var(--qfa-line-soft)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Saved clarification answers ({responses.length})
                </p>
                <ul className="divide-y divide-[color:var(--qfa-line-soft)]">
                  {responses.map((response) => (
                    <li key={response.id} className="px-3 py-2">
                      <p className="text-[13px] font-semibold text-slate-900">{response.answer_label || response.answer_value}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {response.question_key}
                        {response.mapped_field ? ` · mapped to ${response.mapped_field} = ${response.mapped_value || response.answer_value}` : ""}
                        {` · ${formatDate(response.created_at)}`}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </DrawerSection>

        <DrawerSection title={`Assignment (${row.assignedCount}/3 vendors)`}>
          <div className="space-y-2">
            {row.isPreferred ? (
              <InfoGrid rows={[
                ["Intent", "Client selected a specific vendor"],
                ["Target vendor", lead.target_vendor_name || "—"],
                ["Category", lead.target_vendor_category || "—"],
                ["Preferred status", (lead.preferred_vendor_status || "—").replace(/_/g, " ")],
                ["Status reason", (lead.preferred_vendor_status_reason || "—").replace(/_/g, " ")],
              ]} />
            ) : null}

            {row.assignments.length ? (
              <ul className="divide-y divide-[color:var(--qfa-line-soft)] rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line-soft)] bg-white">
                {row.assignments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-slate-900">
                        {vendorsById.get(String(a.vendor_id ?? ""))?.business_name ?? String(a.vendor_id ?? "").slice(0, 8)}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">
                        {(a.assignment_type || "assigned").replace(/_/g, " ")} · {formatDate(a.assigned_at || a.created_at)}
                      </p>
                    </div>
                    {/* vendor_status is the vendor's PROGRESS on an assigned
                        lead, not a response to an offer. Vendors never accept
                        or reject in QuickFurno. */}
                    <StatusBadge value={a.vendor_status || "New"} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No vendors assigned" message="This lead has not been shared with any vendor yet." compact />
            )}
          </div>
        </DrawerSection>

        <DrawerSection title="Delivery record">
          {/* Vendor deliveries and client notifications are one story — what
              actually left the system for this lead — so they share a section
              instead of two near-identical log lists. */}
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-[11px] font-medium text-slate-500">
                Vendor deliveries ({deliveryLogs.length})
                {deliveryLogs.length > 12 ? " — showing the 12 most recent" : ""}
              </p>
              {deliveryLogs.length ? (
                <ul className="divide-y divide-[color:var(--qfa-line-soft)] rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line-soft)] bg-white">
                  {deliveryLogs.slice(0, 12).map((log) => (
                    <li key={log.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span className="min-w-0 truncate text-[13px] text-slate-700">
                        {vendorsById.get(String(log.vendor_id ?? ""))?.business_name ?? "Vendor"}
                        <span className="text-slate-400"> · {formatDate(log.created_at)}</span>
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <StatusBadge value={log.delivery_channel || "channel"} tone="slate" />
                        <StatusBadge value={log.delivery_status || "—"} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-slate-500">No dashboard or WhatsApp-preview deliveries recorded.</p>
              )}
            </div>

            <div>
              <p className="mb-1 text-[11px] font-medium text-slate-500">
                Client notifications ({notificationLogs.length})
                {notificationLogs.length > 12 ? " — showing the 12 most recent" : ""}
              </p>
              {notificationLogs.length ? (
                <ul className="divide-y divide-[color:var(--qfa-line-soft)] rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line-soft)] bg-white">
                  {notificationLogs.slice(0, 12).map((log) => (
                    <li key={log.id} className="px-3 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[13px] text-slate-700">
                          {(log.notification_type || "notification").replace(/_/g, " ")}
                          <span className="text-slate-400"> · {formatDate(log.created_at)}</span>
                        </span>
                        <StatusBadge value={log.status || "—"} />
                      </div>
                      {log.message ? <p className="mt-0.5 text-[11px] text-slate-600">{log.message}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-slate-500">No client-facing notification previews recorded.</p>
              )}
            </div>
          </div>
        </DrawerSection>

        <DrawerSection title="Follow-up & notes">
          <InfoGrid rows={[
            ["Next follow-up", row.followUp ? formatDate(row.followUp) : "Not scheduled"],
            ["Admin notes", lead.internal_notes || "None"],
          ]} />
          {/* Scheduling a follow-up is not a capability this phase has, and the
              status actions live in the Lead Inbox row menu. Nothing inert is
              rendered here to imply otherwise. */}
          <p className="mt-1.5 text-[11px] text-slate-500">
            Follow-up dates are set upstream. Stage changes are available from the Lead Inbox row actions.
          </p>
        </DrawerSection>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// small helpers / sub-components
// ---------------------------------------------------------------------------
