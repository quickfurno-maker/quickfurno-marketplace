// ============================================================================
// QuickFurno — lib/communication/channelDispatchGuard.ts   (Phase 5F-A)
//
// PURE runtime channel-safety guards for CommunicationService.
//
// These are IDENTITY CHECKS, not a router. Nothing here selects a provider,
// chooses a channel, translates a message onto another channel, or falls back.
// Each predicate only compares a message/intent/template channel against the
// ACTIVE provider's channel and reports whether dispatch may proceed.
//
// Phase 5F-A keeps CommunicationService WhatsApp-only: the generic channel
// vocabulary is whatsapp/sms/rcs (foundation), but the only channel actually
// dispatched is whatsapp. An sms/rcs message/intent/template is therefore
// REFUSED here — it is never silently rewritten to whatsapp, never rerouted to an
// SMS/RCS provider (there is none active), and never faked.
// ============================================================================

import type { CommunicationChannel } from "./types";

/**
 * Ledger-safe error codes for a refused channel. Both are non-secret identifier
 * sentences suitable for the communication ledger and admin surfaces.
 */
export const CHANNEL_DISPATCH_ERROR = {
  /** The message/intent channel is not the active provider's channel. */
  UNSUPPORTED_DISPATCH_CHANNEL: "UNSUPPORTED_DISPATCH_CHANNEL",
  /** A template's channel does not match the intent channel. */
  TEMPLATE_CHANNEL_MISMATCH: "TEMPLATE_CHANNEL_MISMATCH",
} as const;

export type ChannelDispatchErrorCode =
  (typeof CHANNEL_DISPATCH_ERROR)[keyof typeof CHANNEL_DISPATCH_ERROR];

/**
 * True ONLY when a message/intent channel is EXACTLY the active provider's
 * channel. No coercion, no fallback, no rewrite. This is the single predicate the
 * initial-send guard, the persisted-message dispatch guard, the provider-identity
 * check, and the webhook channel fence all share, so "dispatchable on this
 * provider" means exactly one thing across CommunicationService.
 */
export function isChannelDispatchable(
  channel: CommunicationChannel,
  providerChannel: CommunicationChannel
): boolean {
  return channel === providerChannel;
}

/**
 * True ONLY when a template's channel EXACTLY matches the intent channel. A
 * mismatch (e.g. a WhatsApp intent pointed at an SMS template, or an SMS intent
 * pointed at a WhatsApp template) must fail closed — the template is never
 * rewritten onto, or delivered over, another channel.
 */
export function isTemplateChannelConsistent(
  templateChannel: CommunicationChannel,
  intentChannel: CommunicationChannel
): boolean {
  return templateChannel === intentChannel;
}
