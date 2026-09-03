import Link from "next/link";
import { vendorMarkAllNotificationsRead, vendorMarkNotificationRead } from "@/app/actions";
import type { VendorNotification } from "@/services/vendorNotificationService";
import { VendorIcon } from "../icons";
import { VendorUtilityAlert, VendorUtilityEmpty, VendorUtilityHeader } from "../VendorUtilityChrome";
import {
  formatNotificationTime,
  internalCtaHref,
  isHighPriority,
  notificationIcon,
  notificationTypeLabel,
  unreadCount,
  type NoticeFeedback,
} from "./notificationsModel";

/**
 * Notifications inbox.
 *
 * Presentation only. Both actions are the existing ones with their existing
 * fields: vendorMarkNotificationRead (`notificationId`) and
 * vendorMarkAllNotificationsRead (no fields). Filtering is still the server's
 * all/unread query via the ?filter= param — no client-side filter was added, so
 * the semantics are exactly as before.
 *
 * Shared with the visual-QA harness so screenshots cannot drift from what ships.
 */
export function VendorNotificationsWorkspace({
  notifications,
  filter,
  feedback,
  loadError,
}: {
  notifications: VendorNotification[];
  filter: "all" | "unread";
  feedback: NoticeFeedback | null;
  loadError: boolean;
}) {
  // Counted from the CURRENT result set only. On the unread filter that is by
  // definition every row; on "all" it is the true unread count of what loaded.
  // No global unread total is claimed, because no query returns one.
  const unread = unreadCount(notifications);

  return (
    <div className="qf-vendor-v2-notice">
      <VendorUtilityHeader
        title="Notifications"
        subtitle="QuickFurno updates about leads, profile reviews, support and your account."
        action={
          <form action={vendorMarkAllNotificationsRead}>
            <button
              type="submit"
              className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet"
              disabled={unread === 0}
            >
              Mark all read
            </button>
          </form>
        }
      />

      {feedback ? (
        <VendorUtilityAlert tone={feedback.tone}>{feedback.message}</VendorUtilityAlert>
      ) : null}

      {loadError ? (
        <VendorUtilityAlert tone="error">
          Notifications could not be loaded. Please refresh in a moment.
        </VendorUtilityAlert>
      ) : null}

      {/* Server-driven filter, unchanged: two links, one query param. */}
      <nav className="qf-vendor-v2-notice-filters" aria-label="Filter notifications">
        <Link
          href="/vendor/dashboard/notifications"
          className="qf-vendor-v2-notice-tab"
          data-active={filter === "all" ? "true" : undefined}
          aria-current={filter === "all" ? "page" : undefined}
        >
          All
        </Link>
        <Link
          href="/vendor/dashboard/notifications?filter=unread"
          className="qf-vendor-v2-notice-tab"
          data-active={filter === "unread" ? "true" : undefined}
          aria-current={filter === "unread" ? "page" : undefined}
        >
          Unread
          {filter === "all" && unread > 0 ? (
            <span className="qf-vendor-v2-notice-tab-count">{unread}</span>
          ) : null}
        </Link>
      </nav>

      {notifications.length === 0 ? (
        <div className="qf-vendor-v2-panel">
          {filter === "unread" ? (
            <VendorUtilityEmpty
              icon="check"
              title="No unread notifications"
              message="Everything here has been read. Switch to All to see your full history."
              action={{ label: "View all", href: "/vendor/dashboard/notifications" }}
            />
          ) : (
            <VendorUtilityEmpty
              icon="bell"
              title="You’re all caught up"
              message="QuickFurno updates will appear here."
            />
          )}
        </div>
      ) : (
        <ul className="qf-vendor-v2-notice-list">
          {notifications.map((notification) => (
            <NotificationRow key={notification.id} notification={notification} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationRow({ notification }: { notification: VendorNotification }) {
  const isUnread = !notification.is_read;
  const href = internalCtaHref(notification.cta_url);
  const ctaLabel = (notification.cta_label ?? "").trim();
  const high = isHighPriority(notification.priority);

  return (
    <li className="qf-vendor-v2-notice-item" data-unread={isUnread ? "true" : undefined}>
      <span className="qf-vendor-v2-notice-icon" aria-hidden="true">
        <VendorIcon name={notificationIcon(notification.type)} size={17} />
      </span>

      <div className="qf-vendor-v2-notice-body">
        <div className="qf-vendor-v2-notice-kicker">
          <span className="qf-vendor-v2-notice-type">{notificationTypeLabel(notification.type)}</span>
          {high ? <span className="qf-vendor-v2-notice-priority">High priority</span> : null}
          {/* Unread is stated in words, not only by weight or colour. */}
          {isUnread ? <span className="qf-vendor-v2-notice-unread">Unread</span> : null}
          <span className="qf-vendor-v2-notice-time">
            {formatNotificationTime(notification.created_at)}
          </span>
        </div>

        <h2 className="qf-vendor-v2-notice-title">{notification.title}</h2>
        <p className="qf-vendor-v2-notice-message">{notification.message}</p>

        <div className="qf-vendor-v2-notice-actions">
          {href && ctaLabel ? (
            <Link href={href} className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet">
              {ctaLabel}
              <VendorIcon name="arrow-right" size={15} />
            </Link>
          ) : null}

          {isUnread ? (
            <form action={vendorMarkNotificationRead}>
              <input type="hidden" name="notificationId" value={notification.id} />
              <button type="submit" className="qf-vendor-v2-notice-markread">
                Mark read
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </li>
  );
}
