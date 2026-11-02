# VOX-12B — Aarohi staff follow-up proposals (source only)

Builds on the existing VOX acquisition SSR read workbench, owner operational review (#221/#222) and exactly-once Core internal follow-up executor (#224/#225). Adds an explicit **staff proposer** UI, completing the source-level three-person-step flow:

1. Scoped acquisition staff selects an already Core-authorized assigned prospect and records a rationale. Do-not-contact and human-takeover records are excluded from this UI's options; the underlying Core API remains independently authoritative for city/object grants.
2. The same-origin `POST /api/followup-proposals` checks Origin, UUID, JSON size, strict request keys, and uses the existing HttpOnly, verified AAL2 server session to call Core `POST /api/vox/v1/action-intents` with actionKind fixed `AAROHI_FOLLOWUP`. It accepts only `PENDING` + `execution=NOT_AUTHORIZED`; no task is created during this step. An opaque UUID nonce is **reused** after network uncertainty to avoid duplicate proposals.
3. The independent Owner reviews through the existing `/approvals` UI and owner-only atomic Core RPC. The Owner may then separately execute one **internal** Aarohi task from the owner-approved queue. None of these screens sends WhatsApp, affects credits, registers vendors or enables automation.

The new `VOX_FOLLOWUP_PROPOSALS_WEB_ENABLED` defaults to **disabled**, independently of Core `VOX_OPERATIONAL_INTENTS_ENABLED`, the owner review flag and the approved internal task execution flag. No Core service_role credentials are sent to the browser. All changes are source-only; no Staging database / real identity / production deployment / provider send.

Release HOLD: genuine staff Supabase MFA, positive/negative cross-city/IDOR and do-not-contact backend checks, actual Core Staging proposal→review→execution (including interrupted responses/concurrency/rollback), signed private deploy and owner approval. This does not finish broader CRM or WhatsApp operations.


## CSRF / Origin interoperability correction

The first real Next.js standalone loopback test exposed a false rejection: Next internally normalized `Request.url` to `http://localhost:<port>` while the real request carried the correct pinned Host and browser Origin. The original shared `allowedOrigin` used the rewritten `request.url`, incorrectly returning 403 for valid requests.

Fixed the common VOX server-side Origin checker to require **both exact browser Origin and exact Host** to match `VOX_EXPECTED_ORIGIN`, rejecting malformed configured origins, userinfo, unexpected path/query/fragment, foreign origins and host mismatch. It does not trust client-controlled `x-forwarded-host`, and server-side MFA authorization remains separate. All existing VOX POST BFF endpoints benefit from this shared fix. Local debug response fields were removed before commit.

**Real Next.js standalone HTTP proof:** configured local expected origin; correctly pinned request with the feature flag OFF now returns **503** (request passes CSRF, fails closed on disabled action), foreign Origin **403**, unexpected Host **403**, missing Origin **403**, locked acquisition page **200**. Dedicated 14/14 pinned-Origin source regression assertions pass along with the complete Web test suite, TypeScript and production build. This is **local loopback verification only**. Production/staging reverse-proxy Host handling and accepted HTTPS browser traffic must still be separately certified before enabling operational POSTs.

## Repeatable real-HTTP Origin regression in PR CI

`apps/vox-web/scripts/smoke-standalone-origin-12b.mjs` boots the **actual built Next.js standalone server** with every VOX action flag OFF on a disposable loopback port. It verifies six actual HTTP outcomes: valid Origin+Host reaches disabled action (503), foreign Origin (403), forged Host (403), missing Origin (403), Acquisition HOLD page (200), and proposal GET denied (405). The Node process is terminated in a `finally` block. The dedicated PR GitHub workflow now runs this executable smoke test **after production build**, not merely source-pattern checks. Local runner **6/6 PASS**. The test uses only synthetic UUIDs and never calls live Staging or provider systems.
