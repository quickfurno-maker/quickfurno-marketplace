"use client";

// ============================================================================
// QF-MVP-82A — one message in the unified timeline.
//
// Inbound sits left, outbound right, and outbound carries the delivery state the
// canonical lifecycle actually holds. Everything rendered here arrived as
// already-decided presentation text from the pure read model: this component
// never inspects a raw payload, never parses `content_minimized`, and never uses
// dangerouslySetInnerHTML — message text is a React text child, so a customer
// who sends markup sees their markup, not a rendered element.
// ============================================================================

import type { InboxEventView } from "@/lib/communication/whatsappInboxReadModel";
import { InboxDeliveryTone, InboxDirection } from "@/lib/communication/whatsappInboxReadModel";

const TONE_STYLE: Record<string, string> = {
  [InboxDeliveryTone.PENDING]: "text-slate-400",
  [InboxDeliveryTone.ACCEPTED]: "text-sky-300",
  [InboxDeliveryTone.SENT]: "text-sky-300",
  [InboxDeliveryTone.DELIVERED]: "text-emerald-300",
  [InboxDeliveryTone.READ]: "text-emerald-200",
  [InboxDeliveryTone.FAILED]: "text-rose-300",
  [InboxDeliveryTone.RETRY_PENDING]: "text-amber-300",
  [InboxDeliveryTone.CANCELLED]: "text-slate-400",
  [InboxDeliveryTone.UNKNOWN]: "text-slate-400",
};

/**
 * Ticks are a shorthand for the label beside them, never a replacement: the
 * label is always rendered, so the state is never carried by a glyph alone.
 * `delivered` and `read` are visibly different because they are different facts.
 */
const TONE_GLYPH: Record<string, string> = {
  [InboxDeliveryTone.PENDING]: "🕘",
  [InboxDeliveryTone.ACCEPTED]: "✓",
  [InboxDeliveryTone.SENT]: "✓",
  [InboxDeliveryTone.DELIVERED]: "✓✓",
  [InboxDeliveryTone.READ]: "✓✓",
  [InboxDeliveryTone.FAILED]: "!",
  [InboxDeliveryTone.RETRY_PENDING]: "↻",
  [InboxDeliveryTone.CANCELLED]: "—",
  [InboxDeliveryTone.UNKNOWN]: "·",
};

function clockTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString(undefined, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function WhatsAppMessageBubble({ event }: { event: InboxEventView }) {
  const inbound = event.direction === InboxDirection.INBOUND;
  const tone = event.deliveryTone;

  return (
    <li className={`flex w-full ${inbound ? "justify-start" : "justify-end"}`}>
      <div
        className={[
          "max-w-[min(36rem,85%)] rounded-2xl border px-3 py-2 text-sm shadow-sm",
          inbound
            ? "rounded-tl-sm border-white/10 bg-white/[0.06] text-slate-100"
            : "rounded-tr-sm border-emerald-500/25 bg-emerald-500/[0.12] text-emerald-50",
        ].join(" ")}
      >
        <p className="whitespace-pre-wrap break-words">
          {event.displayText ?? <span className="italic text-slate-400">No content recorded</span>}
        </p>

        {event.secondaryText !== null && (
          <p className="mt-1 break-words text-[12px] text-slate-300/80">{event.secondaryText}</p>
        )}

        {event.failureReasonSanitized !== null && (
          <p className="mt-1 break-words text-[12px] text-rose-200">{event.failureReasonSanitized}</p>
        )}

        <p className="mt-1.5 flex items-center justify-end gap-2 text-[11px] text-slate-400">
          <time dateTime={event.occurredAt}>{clockTime(event.occurredAt)}</time>
          {tone !== null && (
            <span className={`inline-flex items-center gap-1 ${TONE_STYLE[tone] ?? "text-slate-400"}`}>
              <span aria-hidden="true">{TONE_GLYPH[tone] ?? "·"}</span>
              <span>{event.deliveryLabel}</span>
            </span>
          )}
        </p>
      </div>
    </li>
  );
}
