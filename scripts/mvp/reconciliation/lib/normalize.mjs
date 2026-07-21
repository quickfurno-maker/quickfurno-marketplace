// ============================================================================
// QF-MVP-10.7 — Deterministic serialization + output-safety guard.
// Ensures generated JSON is byte-stable and contains no connection URL / secret.
// ============================================================================

export function stableJson(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

/**
 * Throw if the serialized output appears to contain a connection URL or an
 * obvious credential. Metadata queries never select PII, but this is a final
 * fence before writing to disk.
 */
export function assertNoLeak(serialized) {
  const patterns = [
    /postgres(ql)?:\/\/[^\s"'\\]*[:@]/i, // a URI with credentials/host
    /"PGPASSWORD"/i,
    /BEGIN [A-Z ]*PRIVATE KEY/i,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
    /\bsk-[A-Za-z0-9]{16,}/, // API key
  ];
  for (const re of patterns) {
    if (re.test(serialized)) {
      throw new Error(`[reconcile] refusing to write output: possible secret/URL leak (${re})`);
    }
  }
  return serialized;
}
