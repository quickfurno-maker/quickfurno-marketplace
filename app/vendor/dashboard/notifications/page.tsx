import Link from "next/link";
import { getMyVendor, vendorMarkAllNotificationsRead, vendorMarkNotificationRead } from "@/app/actions";
import { VendorNoProfileFallback } from "@/app/vendor/dashboard/_components/VendorNoProfileFallback";
import { listVendorNotifications } from "@/services/vendorNotificationService";

export const metadata = { title: "Vendor notifications - QuickFurno" };
export const dynamic = "force-dynamic";

type NotificationsPageProps = {
  searchParams?: {
    filter?: string;
    notice?: string;
  };
};

export default async function VendorNotificationsPage({ searchParams }: NotificationsPageProps) {
  const me = await getMyVendor();
  const vendor = me.ok ? me.data : null;

  if (!vendor) {
    return <VendorNoProfileFallback />;
  }

  const filter = searchParams?.filter === "unread" ? "unread" : "all";
  const notificationsResult = await listVendorNotifications(vendor.id, filter);
  const notifications = notificationsResult.ok ? notificationsResult.data : [];
  const unreadCount = notifications.filter((notification) => !notification.is_read).length;

  return (
    <section className="qf-vd-page">
      <div className="qf-vd-card">
        <div className="qf-vd-section-head">
          <div>
            <h1 className="qf-vd-card-title">Notifications</h1>
            <p className="qf-vd-muted">QuickFurno updates for profile reviews, support replies, and account activity.</p>
          </div>
          <form action={vendorMarkAllNotificationsRead}>
            <button className="qf-vd-btn qf-vd-btn--ghost" type="submit" disabled={unreadCount === 0}>
              Mark all read
            </button>
          </form>
        </div>

        {searchParams?.notice === "read" ? <p className="qf-vd-success">Notification marked as read.</p> : null}
        {searchParams?.notice === "all-read" ? <p className="qf-vd-success">All notifications marked as read.</p> : null}
        {searchParams?.notice === "failed" ? <p className="qf-vd-error">Notification update failed. Please try again.</p> : null}
        {!notificationsResult.ok ? <p className="qf-vd-error">Notifications are not available yet.</p> : null}

        <div className="qf-vd-filter-tabs" aria-label="Notification filters">
          <Link className={filter === "all" ? "qf-vd-filter-tab is-active" : "qf-vd-filter-tab"} href="/vendor/dashboard/notifications">
            All
          </Link>
          <Link className={filter === "unread" ? "qf-vd-filter-tab is-active" : "qf-vd-filter-tab"} href="/vendor/dashboard/notifications?filter=unread">
            Unread
          </Link>
        </div>

        {notifications.length === 0 ? (
          <div className="qf-vd-empty">
            <p>{filter === "unread" ? "No unread notifications." : "Your vendor notifications will appear here."}</p>
          </div>
        ) : (
          <div className="qf-vd-list">
            {notifications.map((notification) => (
              <article key={notification.id} className={notification.is_read ? "qf-vd-list-item" : "qf-vd-list-item is-unread"}>
                <div>
                  <div className="qf-vd-list-kicker">
                    <span>{notification.type || "general"}</span>
                    <span>{notification.priority || "normal"}</span>
                    <span>{formatDate(notification.created_at)}</span>
                  </div>
                  <h2>{notification.title}</h2>
                  <p>{notification.message}</p>
                  {notification.cta_url && notification.cta_label ? (
                    <Link className="qf-vd-inline-link" href={notification.cta_url}>
                      {notification.cta_label}
                    </Link>
                  ) : null}
                </div>
                <div className="qf-vd-list-actions">
                  <span className={notification.is_read ? "qf-vd-pill" : "qf-vd-pill qf-vd-pill--strong"}>
                    {notification.is_read ? "Read" : "Unread"}
                  </span>
                  {!notification.is_read ? (
                    <form action={vendorMarkNotificationRead}>
                      <input type="hidden" name="notificationId" value={notification.id} />
                      <button className="qf-vd-btn qf-vd-btn--ghost" type="submit">
                        Mark read
                      </button>
                    </form>
                  ) : null}
                </div>
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
