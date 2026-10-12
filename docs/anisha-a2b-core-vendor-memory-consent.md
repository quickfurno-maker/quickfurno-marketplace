# QuickFurno Core — Anisha Purpose Memory Consent (A2b)

**Internal implementation; no migration applied or live activation.**

The consent table is specifically for `anisha_derived_preferences_v1`, **not** communication delivery, marketing, or generic agent processing consent. A vendor authenticated through the canonical dashboard membership resolver can grant/revoke in staging; no request can select another vendor ID.

A signed, purpose-specific `/api/internal/jarvis/anisha-memory-consent` contract binds the exact vendor ID, conversation ID and expected Core revision, and checks Core conversation state, ANISHA assignment and vendor-specific authority before exposing a yes/no/unknown decision. Stage policy requires `QF_DEPLOYMENT_ENV=staging` and `QF_ANISHA_MEMORY_CONSENT_MODE=STAGING_ONLY`.

The review-only migration adds durable consent state and a pending purge outbox. On revocation, consent is denied immediately; the outbox is a **request to delete**, not proof of physical deletion. A pending erase blocks regrant. The implementation intentionally has no feature enabling it in production and no live migration has been run.

**Required before staging completion:** transactional outbox consumer, physical Jarvis delete receipt, Core acknowledgement, retry/replay drills, vendor notice and interface, actual staging database migration/certification. Never consider WhatsApp consent sufficient or infer a granted decision from a missing/corrupt row.
