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
    <Drawer title={row.name} subtitle={`${row.service} · ${row.city}`} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <StatusBadge value={cap(row.priority)} tone={PRIORITY_TONE[row.priority]} />
          {row.qualityBadge ? <StatusBadge value={row.qualityBadge.label} tone={row.qualityBadge.tone} /> : null}
          <StatusBadge value={row.statusLabel} />
          {row.preferredBadge ? <StatusBadge value={row.preferredBadge.label} tone={row.preferredBadge.tone} /> : null}
          {row.phoneDigits ? (
            <>
              <a href={`tel:${row.phoneDigits}`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Call</a>
              <a href={`https://wa.me/${waNumber(row.phoneDigits)}`} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">WhatsApp</a>
            </>
          ) : null}
        </div>

        <DrawerSection title="Client details">
          <InfoGrid rows={[
            ["Name", row.name],
            ["Phone", row.phone || "Not set"],
            ["Email", lead.email || maskEmail(lead.email) || "Not set"],
            ["City / Area", [row.area, row.city].filter((v) => v && v !== "Not set").join(", ") || row.city],
          ]} />
        </DrawerSection>

        <DrawerSection title="Requirement">
          <InfoGrid rows={[
            ["Service", row.service],
            ["Subcategory", lead.subcategory || "Not set"],
            ["Budget", row.budget],
            ["Timeline", row.timeline],
            ["Property type", lead.property_type || "Not set"],
            ["Message", lead.message || "None"],
          ]} />
        </DrawerSection>

        <DrawerSection title="Lead quality">
          <InfoGrid rows={[
            ["Score", lead.lead_quality_score != null ? `${lead.lead_quality_score}/100` : "Not scored"],
            ["Class", lead.lead_quality_class || "Not scored"],
            ["Quality status", (lead.lead_quality_status || "Not set").replace(/_/g, " ")],
            ["Recommended action", (lead.lead_quality_recommended_action || "Not set").replace(/_/g, " ")],
            ["Hard block", (lead.lead_quality_hard_block_reason || "None").replace(/_/g, " ")],
            ["Checked at", lead.lead_quality_checked_at ? formatDate(lead.lead_quality_checked_at) : "Not checked"],
            // The row above mirrors the latest score summary carried on the lead
            // itself. The per-signal history lives in the restricted lead_scores
            // table, which the admin snapshot does not load — so we say that
            // plainly instead of rendering a developer TODO into the admin UI.
            // BACKEND_DEPENDENCY: lead_scores history is not exposed by
            // getSuperadminSnapshot; a detailed breakdown needs that read first.
            ["Breakdown", "Summary only — the per-signal history is not loaded in this view."],
          ]} />
        </DrawerSection>

        <DrawerSection title="WhatsApp Clarification">
          <div className="space-y-3">
            <InfoGrid rows={[
              ["Required", lead.clarification_required ? "Yes" : "No"],
              ["Status", clarificationLabel(row)],
              ["Missing fields", (lead.clarification_missing_fields ?? row.latestClarification?.missing_fields ?? []).join(", ") || "None"],
              ["Score before", row.latestClarification?.score_before != null ? `${row.latestClarification.score_before}/100` : "Not captured"],
              ["Class before", row.latestClarification?.score_class_before || "Not captured"],
              ["Parent category", row.latestClarification?.parent_category_group || "Not set"],
              ["Marketplace category", row.latestClarification?.marketplace_category || "Not set"],
              ["Service required", row.latestClarification?.service_required || "Not set"],
              ["Response status", row.latestClarification?.response_received_at ? "Response received" : "No response yet"],
            ]} />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onPrepareClarification(row.id)}
                disabled={isPending || Boolean(row.latestClarification)}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {row.latestClarification ? "Preview already prepared" : "Prepare clarification preview"}
              </button>
              <button
                type="button"
                disabled
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500 opacity-70"
              >
                Send WhatsApp disabled in this phase
              </button>
            </div>

            {row.latestClarification?.preview_message ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Preview message</p>
                <pre className="whitespace-pre-wrap text-xs leading-5 text-slate-700">{row.latestClarification.preview_message}</pre>
              </div>
            ) : (
              <EmptyState title="No clarification preview" message="Prepare a preview for B leads before any WhatsApp sending is enabled." compact />
            )}

            {row.latestClarification?.questions_json?.length ? (
              <div className="space-y-2">
                {row.latestClarification.questions_json.map((question, index) => (
                  <div key={String(question.key ?? index)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                    <p className="font-semibold text-slate-900">{index + 1}. {String(question.text ?? "Question")}</p>
                    <p className="mt-1 text-xs text-slate-500">Options: {questionOptions(question)}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Phase 1.6 — admin-only manual ingestion of the client's answers. */}
            {requestId ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Record Client Clarification Answers</p>
                  <StatusBadge value={clarify.label} tone={clarify.tone} />
                </div>
                <p className="mb-3 text-xs text-emerald-800/80">
                  Admin-only preview ingestion. Saving applies these answers to the lead and recalculates the quality score.
                  No WhatsApp is sent, no vendor is assigned, and no credits are deducted.
                </p>

                {questions.length ? (
                  <div className="space-y-3">
                    {questions.map((question, index) => (
                      <div key={question.key} className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-700">{index + 1}. {question.text}</label>
                        {question.type === "single_choice" && question.options.length ? (
                          <select
                            value={answers[question.key] ?? ""}
                            onChange={(event) => setAnswers((prev) => ({ ...prev, [question.key]: event.target.value }))}
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
                          >
                            <option value="">Select an answer…</option>
                            {question.options.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={answers[question.key] ?? ""}
                            onChange={(event) => setAnswers((prev) => ({ ...prev, [question.key]: event.target.value }))}
                            placeholder="Type the client's answer…"
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
                          />
                        )}
                      </div>
                    ))}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleSaveResponses}
                        disabled={saving}
                        className="rounded-lg border border-emerald-300 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {saving ? "Saving…" : "Save clarification answers & rescore"}
                      </button>
                      {saveResult ? (
                        <span className={`text-xs font-semibold ${saveResult.tone === "success" ? "text-emerald-700" : "text-rose-600"}`}>
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
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Saved clarification answers ({responses.length})</p>
                <div className="space-y-2">
                  {responses.map((response) => (
                    <div key={response.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                      <p className="font-semibold text-slate-900">{response.answer_label || response.answer_value}</p>
                      <p className="mt-0.5 text-slate-500">Question: {response.question_key}</p>
                      {response.mapped_field ? (
                        <p className="mt-0.5 text-slate-500">Mapped: {response.mapped_field} → {response.mapped_value || response.answer_value}</p>
                      ) : null}
                      <p className="mt-0.5 text-slate-400">{formatDate(response.created_at)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </DrawerSection>

        <DrawerSection title="Source & attribution">
          <InfoGrid rows={[
            ["Source", row.source],
            ["UTM source", lead.utm_source || "—"],
            ["UTM medium", lead.utm_medium || "—"],
            ["UTM campaign", lead.utm_campaign || "—"],
            ["Landing page", lead.page_url || "—"],
            ["Created", formatDate(row.createdAt)],
          ]} />
        </DrawerSection>

        {row.isPreferred ? (
          <DrawerSection title="Preferred vendor">
            <InfoGrid rows={[
              ["Intent", "Client selected a specific vendor"],
              ["Target vendor", lead.target_vendor_name || "—"],
              ["Category", lead.target_vendor_category || "—"],
              ["Preferred status", (lead.preferred_vendor_status || "—").replace(/_/g, " ")],
              ["Status reason", (lead.preferred_vendor_status_reason || "—").replace(/_/g, " ")],
            ]} />
          </DrawerSection>
        ) : null}

        <DrawerSection title={`Assigned vendors (${row.assignedCount}/3)`}>
          {row.assignments.length ? (
            <div className="space-y-2">
              {row.assignments.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{vendorsById.get(String(a.vendor_id ?? ""))?.business_name ?? String(a.vendor_id ?? "").slice(0, 8)}</p>
                    <p className="text-xs text-slate-500">{(a.assignment_type || "assigned").replace(/_/g, " ")} · {formatDate(a.assigned_at || a.created_at)}</p>
                  </div>
                  <StatusBadge value={a.vendor_status || "New"} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No vendors assigned" message="This lead has not been shared with any vendor yet." compact />
          )}
        </DrawerSection>

        <DrawerSection title={`Delivery logs (${deliveryLogs.length})`}>
          {deliveryLogs.length ? (
            <div className="space-y-2">
              {deliveryLogs.slice(0, 12).map((log) => (
                <div key={log.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge value={log.delivery_channel || "channel"} tone="slate" />
                    <StatusBadge value={log.delivery_status || "—"} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {vendorsById.get(String(log.vendor_id ?? ""))?.business_name ?? "Vendor"} · {formatDate(log.created_at)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No delivery logs" message="No dashboard or WhatsApp-preview deliveries recorded for this lead." compact />
          )}
        </DrawerSection>

        <DrawerSection title={`Client notifications (${notificationLogs.length})`}>
          {notificationLogs.length ? (
            <div className="space-y-2">
              {notificationLogs.slice(0, 12).map((log) => (
                <div key={log.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge value={log.notification_type || "notification"} tone="slate" />
                    <StatusBadge value={log.status || "—"} />
                  </div>
                  {log.message ? <p className="mt-1 text-xs text-slate-600">{log.message}</p> : null}
                  <p className="mt-1 text-xs text-slate-400">{formatDate(log.created_at)}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No client notifications" message="No client-facing notification previews recorded for this lead." compact />
          )}
        </DrawerSection>

        <DrawerSection title="Follow-up & notes">
          <InfoGrid rows={[
            ["Next follow-up", row.followUp ? formatDate(row.followUp) : "Not scheduled"],
            ["Verification", lead.verification_status || "—"],
            ["Admin notes", lead.internal_notes || "None"],
          ]} />
        </DrawerSection>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// small helpers / sub-components
// ---------------------------------------------------------------------------
