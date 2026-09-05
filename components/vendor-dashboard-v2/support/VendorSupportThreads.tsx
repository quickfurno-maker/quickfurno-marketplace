"use client";

import { useState } from "react";
import { vendorSendSupportMessage } from "@/app/actions";
import type { VendorSupportThreadWithMessages } from "@/services/vendorSupportService";
import { VendorIcon } from "../icons";
import {
  SUPPORT_LIMITS,
  formatSupportTime,
  isAdminMessage,
  messagePreview,
  senderLabel,
  summarizeThread,
  supportStatusOf,
  supportTopicLabel,
} from "./supportModel";

/**
 * The conversation list.
 *
 * Threads render collapsed by default — the pre-V2 page opened every full
 * history at once, which buried the newest reply. Expanding is local state
 * only; the messages are already loaded with the thread, so opening one costs
 * no request.
 *
 * The reply form is the existing one: `threadId` + `message` posted to
 * vendorSendSupportMessage, unchanged. Replying is offered on every thread
 * regardless of status, because the server does not forbid it — inventing a
 * "closed threads are read-only" rule here would be UI-only authority.
 */
export function VendorSupportThreads({
  threads,
  initialOpenId,
}: {
  threads: VendorSupportThreadWithMessages[];
  initialOpenId?: string | null;
}) {
  // Newest thread opens by default so the latest conversation is one tap away.
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);

  return (
    <ul className="qf-vendor-v2-support-list">
      {threads.map((thread) => {
        const open = openId === thread.id;
        const status = supportStatusOf(thread.status);
        const summary = summarizeThread(thread);
        const preview = messagePreview(summary.latest);
        const panelId = `qf-thread-${thread.id}`;

        return (
          <li key={thread.id} className="qf-vendor-v2-support-thread" data-open={open ? "true" : undefined}>
            <div className="qf-vendor-v2-support-thread-head">
              <div className="qf-vendor-v2-support-thread-main">
                <div className="qf-vendor-v2-support-thread-kicker">
                  <span className="qf-vendor-v2-support-topic">{supportTopicLabel(thread.topic)}</span>
                  <span className="qf-vendor-v2-support-status" data-tone={status.tone}>
                    {status.label}
                  </span>
                  <span className="qf-vendor-v2-support-time">
                    {formatSupportTime(thread.updated_at)}
                  </span>
                </div>

                <h3 className="qf-vendor-v2-support-subject">{thread.subject}</h3>

                {!open && preview ? (
                  <p className="qf-vendor-v2-support-preview">
                    <span>{senderLabel(summary.latest?.sender_type)}:</span> {preview}
                  </p>
                ) : null}

                <p className="qf-vendor-v2-support-count">
                  {summary.messageCount} message{summary.messageCount === 1 ? "" : "s"}
                  {summary.awaitingQuickFurno ? " · waiting for QuickFurno" : ""}
                </p>
              </div>

              <button
                type="button"
                className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet qf-vendor-v2-support-toggle"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenId((current) => (current === thread.id ? null : thread.id))}
              >
                {open ? "Close" : "Open"}
                <VendorIcon name={open ? "close" : "arrow-right"} size={15} />
              </button>
            </div>

            {open ? (
              <div className="qf-vendor-v2-support-conversation" id={panelId}>
                <ol className="qf-vendor-v2-support-messages">
                  {thread.messages.map((message) => {
                    const admin = isAdminMessage(message.sender_type);
                    return (
                      <li
                        key={message.id}
                        className="qf-vendor-v2-support-message"
                        data-side={admin ? "admin" : "vendor"}
                      >
                        <p className="qf-vendor-v2-support-message-meta">
                          <span>{senderLabel(message.sender_type)}</span>
                          <span>{formatSupportTime(message.created_at)}</span>
                        </p>
                        {/* Plain text. No markup, no auto-linking. */}
                        <p className="qf-vendor-v2-support-message-body">{message.message}</p>
                      </li>
                    );
                  })}
                </ol>

                <form action={vendorSendSupportMessage} className="qf-vendor-v2-support-reply">
                  <input type="hidden" name="threadId" value={thread.id} />
                  <label className="qf-vendor-v2-support-field">
                    <span className="qf-vendor-v2-sr-only">Reply to this support thread</span>
                    <textarea
                      name="message"
                      required
                      rows={3}
                      maxLength={SUPPORT_LIMITS.message}
                      placeholder="Write a reply…"
                      className="qf-vendor-v2-support-input"
                    />
                  </label>
                  <button type="submit" className="qf-vendor-v2-btn qf-vendor-v2-btn--primary">
                    Send message
                  </button>
                </form>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
