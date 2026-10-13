# VOX-04 — Independent support + HUMAN WhatsApp read-model contract

**Status: SOURCE ONLY, not Staff Service Desk shipped.** Core already owns `vendor_support_threads` and `vendor_support_messages`; Core communication conversations and native worker own WhatsApp delivery. This code introduces a strict, narrower **view** contract only. Never create parallel tickets or message senders.

- Staff content is available only after VOX-03 context verification (Core Supabase Auth AAL2 + active internal team/member + object assignment + canonical city validation). This read adapter **cannot verify identity itself**. It refuses absent scopes, unassigned vendor/thread/conversation IDs, AI-owned/non-HUMAN conversations and Riya/client conversations.
- Separate Aarohi/prospect and Anisha/vendor lanes. No phone, encrypted destination, message body, private support subject, raw memory or financial data in the return shape.
- Case age bands reflect time since creation (not an invented SLA). `slaStatus=NOT_CONFIGURED` is deliberate, because Core vendor support rows contain no authoritative SLA deadline.
- All reply/takeover/assign/close functionality is disabled. A proposal for case reassignment explicitly returns `CORE_ATOMIC_APPROVAL_NOT_CONNECTED` until Core-side atomic acceptance, audit, revision and staff role checks exist.
- Negative-unit tests on wrong vendor, wrong prospect, wrong channel, unassigned cases, AI vs HUMAN state, closed service window, missing scope, confidentiality, false SLA and duplicate mutation path.
- This independent PR remains logically **stacked on VOX-03 Core permission authority** before an authenticated staff routing API can use it. No deploy, no DB change, no Meta sends.

Current code aligns with the declared reuse-first architecture; further integration is blocked by Staging permission-schema migration and signed Core/Jarvis route E2E.

## Integrated Core read route (stacked on VOX-03)
The integrated branch adds `GET /api/vox/v1/desk`: it verifies genuine Core AAL2 staff identity/membership, active canonical city/team, explicit vendor/prospect + thread/conversation scopes, enforces city↔zone against `vendors.service_zone_id`, then reads from existing Core `vendor_support_threads` and `communication_conversations` in bounded queries. `projectStaffServiceDesk` returns only safe metadata with no message content, no phone and no provider identifiers. All mutation HTTP methods return **405 CORE_APPROVAL_REQUIRED**. This implementation is real server code but **not deployed**, and a genuine signed Staging access test is still pending.

The joined-source security suite validates 28/28 service desk checks plus 33/33 staff grants tests; full TypeScript must pass before PR review. The migration remains source-only and uninstalled in Staging, so no delegated staff can yet use the route.
