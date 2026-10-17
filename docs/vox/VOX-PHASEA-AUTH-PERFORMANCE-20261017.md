# Phase A Core — Authorization, Team Leader internal chat, prepared cursor

**Status: INTERNAL SOURCE QA ONLY, RELEASE HOLD. No managed SQL or feature flag enabled.**

## Implemented
- `contracts/vox/teamChatEligibility.mjs`: explicit and separately gated `VOX_TL_INTERNAL_CHAT_ENABLED=staging` for an independently verified neutral `team_leader` without global customer/vendor `canReadContent`. Existing `getVerifiedScopedStaff` still enforces remote Supabase AAL2, current memberships, city/team and department policy. The existing candidate chat SQL verifies current TL, team, city and neutrally signed Auth principal; the route never exposes external conversation messages or provider sends. Default OFF. `staff-chat` route imports this narrow gate for GET+POST.
- `ui04RouteFusion.mjs` rereads current verified AAL2 scope after object verification, withholding the entire response when permission was revoked during the request; `ui04-workspace/route.ts` no longer calls the expensive `getVerifiedScopedStaff` inside every item. There remain three checks in the synthetic source test (route before, composer before, composer after), not per item. Current object grant/assignment/source revision/city location checks remain per item. **This reduces potential Auth query duplication, not yet a measured p95 improvement.**
- `phaseAScopedQueueCursor.mjs`: 5-minute HMAC keyset cursor bound to AAL2 Staff user/team/city, current verified grants hash, last source, last reference ID and timestamp; cross-role, stale, forged or altered tokens rejected. `mayReadNextPage:false` always: **not connected to DB keyset pagination**, so no page expansion before review.

## QA and remaining
- New Team Leader entitlement source tests, cursor forged-expiry tests and combined workspace scope checks pass locally; full source suite and CI required on exact head.
- Core TypeScript and production build were verified during this phase.
- Outstanding: actual protected staged TL AAL2 and chat SQL, perf benchmark with real PostgreSQL, batching of native per-object lookups and true keyset/city isolation, genuine linked UI; qualify DBA/AppSec/Owner GO before enabling flags.
