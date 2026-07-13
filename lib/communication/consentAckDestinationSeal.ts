// ============================================================================
// QuickFurno — lib/communication/consentAckDestinationSeal.ts   (Phase 5F-D4-C, server-only)
//
// AES-256-GCM sealing of the acknowledgement destination.
//
// WHY THIS EXISTS. D1-B stores ONLY sha256(sender) — "there is deliberately no phone_e164 column" — and
// communication_messages stores only a hash + mask. So when the Meta webhook returns, the plaintext number
// is GONE. An asynchronous worker therefore cannot address the acknowledgement at all unless the destination
// is carried forward. It is carried forward SEALED: encrypted under a Core-owned key, bound by AAD to the one
// intent it belongs to, expiring with that intent, and purged on every terminal transition.
//
// FAIL CLOSED, ALWAYS. Missing configuration, a missing primary key, an unknown key id, a wrong-length key,
// a malformed envelope, or an AEAD authentication failure ALL return a closed error. There is no fallback
// key, no default key, no test key in production code, and no unsealed path. A fail-OPEN decrypt would
// silently resurrect exactly the bypass D4-B was built to make unreachable.
//
// THE KEY MATERIAL NEVER LEAVES THIS MODULE. It is read from the environment, used, and never logged, never
// returned, never persisted, never placed in an error message.
// ============================================================================

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "crypto";

export const ACK_SEAL_PRIMARY_KEY_ID_ENV = "QF_CONSENT_ACK_DESTINATION_PRIMARY_KEY_ID";
export const ACK_SEAL_KEYS_ENV = "QF_CONSENT_ACK_DESTINATION_KEYS";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** A key id is a bounded, non-secret label (e.g. `ack-key-v1`). It is stored on the row; the key is not. */
const KEY_ID_SHAPE = /^[A-Za-z0-9._:-]{1,64}$/;

export type SealErrorCode =
  | "SEAL_CONFIG_MISSING"      // neither/one of the two env vars is set
  | "SEAL_CONFIG_MALFORMED"    // not JSON, not an object, empty, bad key id, bad base64url, wrong length
  | "SEAL_PRIMARY_KEY_MISSING" // the primary key id is not present in the key set
  | "SEAL_KEY_UNKNOWN"         // the row's encryption_key_id is not in the active key set
  | "SEAL_ENVELOPE_MALFORMED"  // ciphertext/nonce/tag missing or wrong size
  | "SEAL_AUTH_FAILED";        // AEAD open failed: wrong key, tampered ciphertext, or WRONG AAD

export type SealResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: SealErrorCode };

const fail = <T>(code: SealErrorCode): SealResult<T> => ({ ok: false, code });

export interface SealedDestination {
  readonly ciphertext: string; // base64url
  readonly nonce: string;      // base64url, 12 bytes
  readonly authTag: string;    // base64url, 16 bytes
  readonly keyId: string;
}

// ----------------------------------------------------------------------------
// Key-set parsing
// ----------------------------------------------------------------------------
interface KeySet {
  readonly primaryKeyId: string;
  readonly keys: ReadonlyMap<string, Buffer>;
}

function decodeBase64Url(v: string): Buffer | null {
  if (typeof v !== "string" || v === "") return null;
  // base64url only: no '+', no '/', padding optional.
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(v)) return null;
  try {
    const buf = Buffer.from(v, "base64url");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Parse the versioned key set.
 *   QF_CONSENT_ACK_DESTINATION_PRIMARY_KEY_ID = "ack-key-v1"
 *   QF_CONSENT_ACK_DESTINATION_KEYS           = {"ack-key-v1":"<base64url 32 bytes>"}
 *
 * Encryption uses the PRIMARY key. Decryption accepts ANY key in the active set, so a key may be rotated in
 * while intents sealed under the previous key are still openable. An old key MUST NOT be removed while an
 * unexpired non-terminal intent still references it — the intents expire in 15 minutes (STOP/START) or 24
 * hours (HELP), so retiring a key one day after it stops being primary is always safe.
 */
export function loadAckSealKeys(env: NodeJS.ProcessEnv = process.env): SealResult<KeySet> {
  const primaryKeyId = (env[ACK_SEAL_PRIMARY_KEY_ID_ENV] ?? "").trim();
  const rawKeys = (env[ACK_SEAL_KEYS_ENV] ?? "").trim();

  if (primaryKeyId === "" || rawKeys === "") return fail("SEAL_CONFIG_MISSING");
  if (!KEY_ID_SHAPE.test(primaryKeyId)) return fail("SEAL_CONFIG_MALFORMED");

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawKeys);
  } catch {
    return fail("SEAL_CONFIG_MALFORMED");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("SEAL_CONFIG_MALFORMED");

  const keys = new Map<string, Buffer>();
  for (const [keyId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!KEY_ID_SHAPE.test(keyId)) return fail("SEAL_CONFIG_MALFORMED");
    if (typeof value !== "string") return fail("SEAL_CONFIG_MALFORMED");
    const key = decodeBase64Url(value);
    if (!key) return fail("SEAL_CONFIG_MALFORMED");
    // AES-256 means EXACTLY 32 bytes. A short key is a weak key — it fails closed, it is never padded.
    if (key.length !== KEY_BYTES) return fail("SEAL_CONFIG_MALFORMED");
    keys.set(keyId, key);
  }

  if (keys.size === 0) return fail("SEAL_CONFIG_MALFORMED");
  if (!keys.has(primaryKeyId)) return fail("SEAL_PRIMARY_KEY_MISSING");

  return { ok: true, value: { primaryKeyId, keys } };
}

/** True when a key id is still present in the active set — used to refuse retiring a key still in use. */
export function ackSealKeyIsActive(keyId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const loaded = loadAckSealKeys(env);
  return loaded.ok && loaded.value.keys.has(keyId);
}

// ----------------------------------------------------------------------------
// Seal / open
// ----------------------------------------------------------------------------
/**
 * Seal a canonical E.164 destination under the PRIMARY key, bound to `aad`.
 * A fresh random 12-byte nonce per call — never derived, never reused, never a counter.
 */
export function sealAckDestination(
  plaintextE164: string,
  aad: string,
  env: NodeJS.ProcessEnv = process.env
): SealResult<SealedDestination> {
  if (typeof plaintextE164 !== "string" || plaintextE164 === "") return fail("SEAL_ENVELOPE_MALFORMED");
  if (typeof aad !== "string" || aad === "") return fail("SEAL_ENVELOPE_MALFORMED");

  const loaded = loadAckSealKeys(env);
  if (!loaded.ok) return fail(loaded.code);
  const { primaryKeyId, keys } = loaded.value;
  const key = keys.get(primaryKeyId);
  if (!key) return fail("SEAL_PRIMARY_KEY_MISSING");

  try {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintextE164, "utf8")), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      ok: true,
      value: {
        ciphertext: ciphertext.toString("base64url"),
        nonce: nonce.toString("base64url"),
        authTag: authTag.toString("base64url"),
        keyId: primaryKeyId,
      },
    };
  } catch {
    return fail("SEAL_ENVELOPE_MALFORMED");
  }
}

/**
 * Open a sealed destination. The AAD must be byte-identical to the one used at seal time: change the intent
 * id, receipt id, inbound id, provider-message hash, destination hash, acknowledgement type or expiry and
 * this returns SEAL_AUTH_FAILED. There is no way to open a ciphertext into a different binding.
 */
export function openAckDestination(
  sealed: SealedDestination,
  aad: string,
  env: NodeJS.ProcessEnv = process.env
): SealResult<string> {
  if (!sealed || typeof sealed !== "object") return fail("SEAL_ENVELOPE_MALFORMED");
  if (typeof aad !== "string" || aad === "") return fail("SEAL_ENVELOPE_MALFORMED");
  if (typeof sealed.keyId !== "string" || !KEY_ID_SHAPE.test(sealed.keyId)) return fail("SEAL_ENVELOPE_MALFORMED");

  const loaded = loadAckSealKeys(env);
  if (!loaded.ok) return fail(loaded.code);

  // UNKNOWN KEY ID → fail closed. It is never "tried anyway" against the primary key.
  const key = loaded.value.keys.get(sealed.keyId);
  if (!key) return fail("SEAL_KEY_UNKNOWN");

  const ciphertext = decodeBase64Url(sealed.ciphertext);
  const nonce = decodeBase64Url(sealed.nonce);
  const authTag = decodeBase64Url(sealed.authTag);
  if (!ciphertext || !nonce || !authTag) return fail("SEAL_ENVELOPE_MALFORMED");
  if (nonce.length !== NONCE_BYTES) return fail("SEAL_ENVELOPE_MALFORMED");
  if (authTag.length !== TAG_BYTES) return fail("SEAL_ENVELOPE_MALFORMED");

  try {
    const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const value = plaintext.toString("utf8");
    if (value === "") return fail("SEAL_AUTH_FAILED");
    return { ok: true, value };
  } catch {
    // Wrong key, tampered ciphertext, or a DIFFERENT AAD. Indistinguishable by design — and all fatal.
    return fail("SEAL_AUTH_FAILED");
  }
}

/** Constant-time equality for the two hex hashes the worker compares. Never short-circuits on content. */
export function hashesEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
