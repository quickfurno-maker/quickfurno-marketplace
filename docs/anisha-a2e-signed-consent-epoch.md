# AN-A2e — Staging signed consent epoch and deployment preflight

Date 12 October 2026 IST. Not deployed.

The existing Core `qfj.anisha.memory-consent` read response now includes
`consentRevision`, `consentUpdatedAt` and `erasurePending` in addition to
strict vendor/conversation/expected-revision binding. The Jarvis companion
requires these fields, so **Core and Jarvis must be staged in the same
reviewed release**; don't mix an old Core response with the new Jarvis client.

This source is **purpose-specific** for derived language/reply-style preferences
and independent of WhatsApp messaging consent. Core continues to reject
a grant while physical erasure is pending. After Core has confirmed erasure and
the vendor explicitly regrants, an operator-controlled staging service may
clear the persistent Jarvis erasure fence only when the fresh Core grant time
is newer than the fence and belongs to the exact verified vendor.

Actual Core Ed25519 verifier exercised with ten passing signature positive/negative
checks: claim/consent domain and request schema, tampered payload rejection,
wrong domain and stale timestamp rejection. Core purpose/UI 27/27 and purge
contract 27/27 passing; Core TypeScript PASS.

**Not promoted:** The connected QuickFurno Staging DB does not yet have
Anisha consent/outbox tables; the connected QF-Jarvis DB is shared rather than
a dedicated Jarvis stage, and lacks the governed memory schema. No Supabase
branch exists for these projects. Isolated local PostgreSQL certification passed
independently; do not apply review-only migrations to a shared project.
Remote PR CI and owner-approved privacy notice must be certified before any
staging deployment.
