// ============================================================================
// VOX P0-3 — test-only RFC 6238 TOTP generator.
//
// Used ONLY by validate-vox-03-real-local-gotrue-auth.harness.mjs to complete
// a genuine local GoTrue MFA challenge (the harness enrolls a real TOTP factor
// against the disposable local GoTrue instance; GoTrue returns the base32
// secret; this file computes the same 6-digit code a real authenticator app
// would, so the harness can pass GoTrue's real server-side verification).
// It never bypasses or substitutes for GoTrue's own verification.
// ============================================================================
import { createHmac } from "node:crypto";

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/=+$/, "").replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const idx = B32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** Generates the RFC 6238 TOTP code for a base32 secret at a given instant. */
export function generateTotp(secretBase32, { step = 30, digits = 6, at = Date.now() } = {}) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(at / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter % 2 ** 32, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** digits).padStart(digits, "0");
}
