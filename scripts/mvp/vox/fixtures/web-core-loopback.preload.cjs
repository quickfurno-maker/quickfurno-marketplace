// ============================================================================
// QA-only `node --require` preload for the compiled VOX Web server.
//
// The compiled Web hard-pins its Core origin to https://staging-core.quickfurno.in
// (apps/vox-web/lib/core.ts). A QA run must NEVER reach that managed host, so
// this preload rewrites ONLY that exact origin to a loopback Core listener
// started by the QA harness (which serves the REAL Core route handlers).
//
// It is inert unless VOX_QA_CORE_LOOPBACK is exactly http://127.0.0.1:<port>.
// No production source is modified; headers/method/body pass through untouched.
// ============================================================================
"use strict";
const PINNED = "https://staging-core.quickfurno.in";
const loop = process.env.VOX_QA_CORE_LOOPBACK;
if (loop && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(loop)) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = function qaLoopbackFetch(input, init) {
    try {
      if (typeof input === "string" && input.startsWith(PINNED + "/")) {
        return realFetch(loop + input.slice(PINNED.length), init);
      }
      if (input instanceof URL && input.origin === PINNED) {
        return realFetch(loop + input.pathname + input.search, init);
      }
    } catch {}
    return realFetch(input, init);
  };
}
