import { getMyVendor, vendorCreateSupportThread, vendorSendSupportMessage } from "@/app/actions";
import { VendorNoProfileFallback } from "@/app/vendor/dashboard/_components/VendorNoProfileFallback";
import { listVendorSupportThreads } from "@/services/vendorSupportService";

export const metadata = { title: "Vendor support - QuickFurno" };
export const dynamic = "force-dynamic";

type VendorSupportPageProps = {
  searchParams?: {
    support?: string;
  };
};

const supportTopics = [
  ["general", "General"],
  ["profile", "Profile"],
  ["package", "Package / recharge"],
  ["leads", "Leads"],
  ["billing", "Billing"],
];

export default async function VendorSupportPage({ searchParams }: VendorSupportPageProps) {
  const me = await getMyVendor();
  const vendor = me.ok ? me.data : null;

  if (!vendor) {
    return <VendorNoProfileFallback />;
  }

  const threadsResult = await listVendorSupportThreads(vendor.id);
  const threads = threadsResult.ok ? threadsResult.data : [];

  return (
    <section className="qf-vd-page">
      <div className="qf-vd-card">
        <div className="qf-vd-section-head">
          <div>
            <h1 className="qf-vd-card-title">Support</h1>
            <p className="qf-vd-muted">Create a support thread and continue the conversation with QuickFurno admin.</p>
          </div>
        </div>

        {searchParams?.support === "created" ? <p className="qf-vd-success">Support thread created.</p> : null}
        {searchParams?.support === "sent" ? <p className="qf-vd-success">Message sent.</p> : null}
        {searchParams?.support === "failed" ? <p className="qf-vd-error">Support request failed. Please check the fields and try again.</p> : null}
        {!threadsResult.ok ? <p className="qf-vd-error">Support inbox is not available yet.</p> : null}

        <form action={vendorCreateSupportThread} className="qf-vd-profile-form">
          <div className="qf-vd-form-grid">
            <label>
              Subject
              <input name="subject" required maxLength={140} placeholder="Example: Need help updating portfolio" />
            </label>
            <label>
              Topic
              <select name="topic" defaultValue="general">
                {supportTopics.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Message
            <textarea name="message" required maxLength={1200} rows={4} placeholder="Share the issue or question for QuickFurno support." />
          </label>
          <button className="qf-vd-btn qf-vd-btn--primary" type="submit">
            Create support thread
          </button>
        </form>
      </div>

      <div className="qf-vd-card">
        <h2 className="qf-vd-card-title">Your support threads</h2>
        {threads.length === 0 ? (
          <div className="qf-vd-empty">
            <p>Vendor support center is ready. Your support conversations will appear here.</p>
          </div>
        ) : (
          <div className="qf-vd-thread-list">
            {threads.map((thread) => (
              <article key={thread.id} className="qf-vd-thread">
                <div className="qf-vd-section-head">
                  <div>
                    <p className="qf-vd-list-kicker">
                      <span>{thread.topic || "general"}</span>
                      <span>{thread.status || "open"}</span>
                      <span>{formatDate(thread.updated_at)}</span>
                    </p>
                    <h3>{thread.subject}</h3>
                  </div>
                </div>

                <div className="qf-vd-message-list">
                  {thread.messages.map((message) => (
                    <div key={message.id} className={message.sender_type === "admin" ? "qf-vd-message is-admin" : "qf-vd-message"}>
                      <p className="qf-vd-message-meta">
                        {message.sender_type === "admin" ? "QuickFurno admin" : "You"} - {formatDate(message.created_at)}
                      </p>
                      <p>{message.message}</p>
                    </div>
                  ))}
                </div>

                <form action={vendorSendSupportMessage} className="qf-vd-reply-form">
                  <input type="hidden" name="threadId" value={thread.id} />
                  <textarea name="message" required maxLength={1200} rows={3} placeholder="Write a reply..." />
                  <button className="qf-vd-btn qf-vd-btn--ghost" type="submit">
                    Send message
                  </button>
                </form>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function formatDate(value: string | null) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
