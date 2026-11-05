# Vendor private evidence: local ClamAV behavior precheck (5 Nov 2026)

**RELEASE HOLD.** No managed Staging/Production, no actual private documents, no public upload, no provider sends.

Vendor Draft [#484](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/484) includes a protected, disabled one-shot private evidence scanner. Draft [#487](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/487) independently bounds actual multipart upload bytes. The new safe local probe does not modify those runtime paths or enable flags.

## How to use the probe

Run from a JARVIS source worktree only when inspecting a **local** clamd daemon on `127.0.0.1:3310`: `node scripts/mvp/vendor/certify-vendor-clamav-local-behavior.mjs --probe-local-loopback`. It sends a benign clean-control buffer and the standard non-malicious EICAR antivirus test string **directly to local ClamAV INSTREAM** through the existing scanner transport, without writing files, creating vendors, uploading to Storage, invoking RPCs or touching real private case data. It accepts only clean `OK` for the clean control and `FOUND` for EICAR. All other results return `LOCAL_ENGINE_NOT_BEHAVIOR_CERTIFIED`, nonzero exit and release HOLD.

**Observed on JARVIS this batch:** both local scanner controls returned `unavailable`, so `behaviorObserved=false` and no real local ClamAV service was certified. Tests with an injected mock correctly prove the expected positive/negative logic (4/4 PASS), but mock tests are **not** proof that the engine is installed or currently scanning.

## Mandatory independent gates before any Staging activity

1. Locally install/provision a reviewed ClamAV engine and signature DB, attest their exact signed binary and signature update version, prove the private loopback topology and engine maintenance process. An arbitrary server mimicking clamd protocol is not authentic ClamAV.
2. Repeat clean/EICAR behavior against the actual managed-Staging scanner after separate Owner approval. Do not use real identity proofs or sensitive private vendor documents as a test file.
3. Confirm isolated private Storage bucket permissions, object download scope, ClamAV quarantine receipts, stale/unknown scan fail-closed behavior, immutable case version lock, owner-only AAL2 case review, no automatic vendor approval, and audit evidence.
4. Preserve hard-off `QF_VENDOR_PRIVATE_SCAN_MODE`, `QF_VENDOR_CLAMAV_ENGINE_CERTIFIED`, `QF_VENDOR_PRIVATE_BUCKET_CERTIFIED`, `QF_VENDOR_PRIVATE_SCAN_ONCE_APPROVED` until the above is independently certified and explicitly approved.

The probe deliberately returns `canEnablePrivateScan=false`, `canEnableEvidenceReview=false`, `releaseDecision=HOLD` **even if both local signatures are observed**. Real managed Staging and Production are untouched.
