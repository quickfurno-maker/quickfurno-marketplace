import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export const CONVERSATION_SEAL_PRIMARY_KEY_ID_ENV = "QF_CONVERSATION_SEAL_PRIMARY_KEY_ID";
export const CONVERSATION_SEAL_KEYS_ENV = "QF_CONVERSATION_SEAL_KEYS";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export type ConversationSealResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: "CONFIG_MISSING" | "CONFIG_INVALID" | "KEY_UNKNOWN" | "ENVELOPE_INVALID" | "AUTH_FAILED" };

export interface ConversationSealedValue {
  readonly ciphertext: string;
  readonly nonce: string;
  readonly authTag: string;
  readonly keyId: string;
}

type KeySet = { readonly primaryKeyId: string; readonly keys: ReadonlyMap<string, Buffer> };

function fail<T>(code: Exclude<ConversationSealResult<T>, { ok: true }>["code"]): ConversationSealResult<T> {
  return { ok: false, code };
}

function decode(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null;
  try { const b = Buffer.from(value, "base64url"); return b.length ? b : null; } catch { return null; }
}

export function loadConversationSealKeys(env: NodeJS.ProcessEnv = process.env): ConversationSealResult<KeySet> {
  const primaryKeyId = (env[CONVERSATION_SEAL_PRIMARY_KEY_ID_ENV] ?? "").trim();
  const raw = (env[CONVERSATION_SEAL_KEYS_ENV] ?? "").trim();
  if (!primaryKeyId || !raw) return fail("CONFIG_MISSING");
  if (!KEY_ID.test(primaryKeyId)) return fail("CONFIG_INVALID");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return fail("CONFIG_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("CONFIG_INVALID");
  const keys = new Map<string, Buffer>();
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!KEY_ID.test(id) || typeof value !== "string") return fail("CONFIG_INVALID");
    const key = decode(value);
    if (!key || key.length !== KEY_BYTES) return fail("CONFIG_INVALID");
    keys.set(id, key);
  }
  if (!keys.has(primaryKeyId)) return fail("CONFIG_INVALID");
  return { ok: true, value: { primaryKeyId, keys } };
}

export function sealConversationValue(
  plaintext: string,
  aad: string,
  env: NodeJS.ProcessEnv = process.env,
): ConversationSealResult<ConversationSealedValue> {
  if (!plaintext || !aad) return fail("ENVELOPE_INVALID");
  const loaded = loadConversationSealKeys(env);
  if (!loaded.ok) return loaded;
  const key = loaded.value.keys.get(loaded.value.primaryKeyId);
  if (!key) return fail("KEY_UNKNOWN");
  try {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
    return { ok: true, value: {
      ciphertext: ciphertext.toString("base64url"),
      nonce: nonce.toString("base64url"),
      authTag: cipher.getAuthTag().toString("base64url"),
      keyId: loaded.value.primaryKeyId,
    }};
  } catch { return fail("ENVELOPE_INVALID"); }
}

export function openConversationValue(
  sealed: ConversationSealedValue,
  aad: string,
  env: NodeJS.ProcessEnv = process.env,
): ConversationSealResult<string> {
  if (!sealed || !aad || !KEY_ID.test(sealed.keyId)) return fail("ENVELOPE_INVALID");
  const loaded = loadConversationSealKeys(env);
  if (!loaded.ok) return loaded;
  const key = loaded.value.keys.get(sealed.keyId);
  if (!key) return fail("KEY_UNKNOWN");
  const ciphertext = decode(sealed.ciphertext);
  const nonce = decode(sealed.nonce);
  const authTag = decode(sealed.authTag);
  if (!ciphertext || !nonce || !authTag || nonce.length !== NONCE_BYTES || authTag.length !== TAG_BYTES) {
    return fail("ENVELOPE_INVALID");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(authTag);
    return { ok: true, value: Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8") };
  } catch { return fail("AUTH_FAILED"); }
}
