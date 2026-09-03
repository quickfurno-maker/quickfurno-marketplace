import { vendorCreateSupportThread } from "@/app/actions";
import type { VendorSupportThreadWithMessages } from "@/services/vendorSupportService";
import { VendorUtilityAlert, VendorUtilityEmpty, VendorUtilityHeader } from "../VendorUtilityChrome";
import { VendorSupportThreads } from "./VendorSupportThreads";
import { SUPPORT_LIMITS, SUPPORT_TOPICS, type SupportFeedback } from "./supportModel";

/**
 * Support conversation centre.
 *
 * Presentation only. Thread creation posts the existing `subject`, `topic` and
 * `message` fields to vendorCreateSupportThread; replies post `threadId` and
 * `message` to vendorSendSupportMessage. Both unchanged, with the server's own
 * 140 / 1200 limits mirrored as maxLength hints.
 *
 * Layout note: when threads already exist the conversation list comes FIRST and
 * the new-request form sits after it, so a returning vendor is not made to
 * scroll past an empty form to reach their reply. With no threads the form is
 * the whole page.
 *
 * Shared with the visual-QA harness so screenshots cannot drift from what ships.
 */
export function VendorSupportWorkspace({
  threads,
  feedback,
  loadError,
}: {
  threads: VendorSupportThreadWithMessages[];
  feedback: SupportFeedback | null;
  loadError: boolean;
}) {
  const hasThreads = threads.length > 0;

  return (
    <div className="qf-vendor-v2-support">
      <VendorUtilityHeader title="Support" subtitle="Get help from the QuickFurno team." />

      {feedback ? (
        <VendorUtilityAlert tone={feedback.tone}>{feedback.message}</VendorUtilityAlert>
      ) : null}

      {loadError ? (
        <VendorUtilityAlert tone="error">
          Your support conversations could not be loaded. Please refresh in a moment.
        </VendorUtilityAlert>
      ) : null}

      <div className="qf-vendor-v2-support-layout" data-has-threads={hasThreads ? "true" : undefined}>
        {hasThreads ? (
          <section className="qf-vendor-v2-support-conversations">
            <h2 className="qf-vendor-v2-support-sectiontitle">Your conversations</h2>
            <VendorSupportThreads threads={threads} initialOpenId={threads[0]?.id ?? null} />
          </section>
        ) : null}

        <section className="qf-vendor-v2-panel qf-vendor-v2-support-new">
          <header className="qf-vendor-v2-support-newhead">
            <h2 className="qf-vendor-v2-panel-title">
              {hasThreads ? "New request" : "Create a support request"}
            </h2>
            <p className="qf-vendor-v2-support-newhint">
              QuickFurno will reply in this support thread.
            </p>
          </header>

          {!hasThreads ? (
            <div className="qf-vendor-v2-support-emptynote">
              <VendorUtilityEmpty
                icon="support"
                title="No support conversations yet"
                message="Create a request whenever you need help with your profile, package or leads."
              />
            </div>
          ) : null}

          <form action={vendorCreateSupportThread} className="qf-vendor-v2-support-form">
            <label className="qf-vendor-v2-support-field">
              <span className="qf-vendor-v2-support-label">Subject</span>
              <input
                name="subject"
                type="text"
                required
                maxLength={SUPPORT_LIMITS.subject}
                placeholder="Example: Need help updating my portfolio"
                className="qf-vendor-v2-support-input"
              />
            </label>

            <label className="qf-vendor-v2-support-field">
              <span className="qf-vendor-v2-support-label">Topic</span>
              <select
                name="topic"
                defaultValue="general"
                className="qf-vendor-v2-support-input"
              >
                {SUPPORT_TOPICS.map((topic) => (
                  <option key={topic.value} value={topic.value}>
                    {topic.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="qf-vendor-v2-support-field qf-vendor-v2-support-field--wide">
              <span className="qf-vendor-v2-support-label">Message</span>
              <textarea
                name="message"
                required
                rows={5}
                maxLength={SUPPORT_LIMITS.message}
                placeholder="Share the issue or question for QuickFurno support."
                className="qf-vendor-v2-support-input qf-vendor-v2-support-textarea"
              />
            </label>

            <div className="qf-vendor-v2-support-submit">
              <button type="submit" className="qf-vendor-v2-btn qf-vendor-v2-btn--primary">
                Create support request
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
