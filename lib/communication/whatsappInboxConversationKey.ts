// ============================================================================
// QuickFurno — lib/communication/whatsappInboxConversationKey.ts   (SERVER SIDE)
//
// QF-MVP-82A — the conversation key derivation, kept apart from the rest of the
// read model on purpose.
//
// It needs a hash, and therefore a Node builtin, so importing it from a client
// component would drag `node:crypto` into the browser bundle. That separation is
// not merely a bundling detail: the browser has no business deriving a
// conversation key at all. It receives an opaque id and hands it back, and the
// raw contact hash never leaves the server.
//
// PURE: no database, no network, no I/O.
// ============================================================================

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Conversation identity
// ---------------------------------------------------------------------------

/**
 * Domain separator for the opaque conversation id. It is deliberately a stable
 * constant, not a secret: the id must survive restarts and deploys so a URL
 * keeps working, and the real access control is the Superadmin session.
 */
const CONVERSATION_ID_DOMAIN = "qf-mvp-82a:whatsapp-conversation:v1";

/** A conversation namespace, so one contact on two accounts is two conversations. */
export function whatsappConversationNamespace(input: {
  readonly providerAccountId: string | null | undefined;
  readonly provider: string | null | undefined;
}): string {
  const accountId = typeof input?.providerAccountId === "string" ? input.providerAccountId.trim() : "";
  if (accountId !== "") return `acct:${accountId}`;
  // LEGACY rows predate provider-account binding. They get their own namespace
  // per provider and are NEVER merged into a bound account merely because the
  // contact hash matches — that would silently reassign ownership.
  const provider = typeof input?.provider === "string" ? input.provider.trim() : "";
  return `legacy:${provider === "" ? "unknown" : provider}`;
}

/** Opaque, deterministic, and never the raw contact hash. */
export function whatsappConversationId(input: {
  readonly providerAccountId: string | null | undefined;
  readonly provider: string | null | undefined;
  readonly contactHash: string | null | undefined;
}): string | null {
  const hash = typeof input?.contactHash === "string" ? input.contactHash.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const namespace = whatsappConversationNamespace(input);
  return createHash("sha256").update(`${CONVERSATION_ID_DOMAIN}|${namespace}|${hash}`).digest("hex");
}
