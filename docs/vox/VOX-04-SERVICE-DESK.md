# VOX-04 — Independent support + HUMAN WhatsApp read-model contract

**Status: SOURCE ONLY, not Staff Service Desk shipped.** Core already owns `vendor_support_threads` and `vendor_support_messages`; Core communication conversations and native worker own WhatsApp delivery. This code introduces a strict, narrower **view** contract only. Never create parallel tickets or message senders.

- Staff content is available only after VOX-03 context verification (Core Supabase Auth AAL2 + active internal team/member + object assignment + canonical city validation). This read adapter **cannot verify identity itself**. It refuses absent scopes, unassigned vendor/thread/conversation IDs, AI-owned/non-HUMAN conversations and Riya/client conversations.
- Separate Aarohi/prospect and Anisha/vendor lanes. No phone, encrypted destination, message body, private support subject, raw memory or financial data in the return shape.
- Case age bands reflect time since creation (not an invented SLA). `slaStatus=NOT_CONFIGURED` is deliberate, because Core vendor support rows contain no authoritative SLA deadline.
- All reply/takeover/assign/close functionality is disabled. A proposal for case reassignment explicitly returns `CORE_ATOMIC_APPROVAL_NOT_CONNECTED` until Core-side atomic acceptance, audit, revision and staff role checks exist.
- Negative-unit tests on wrong vendor, wrong prospect, wrong channel, unassigned cases, AI vs HUMAN state, closed service window, missing scope, confidentiality, false SLA and duplicate mutation path.
- This independent PR remains logically **stacked on VOX-03 Core permission authority** before an authenticated staff routing API can use it. No deploy, no DB change, no Meta sends.

Current code aligns with the declared reuse-first architecture; further integration is blocked by Staging permission-schema migration and signed Core/Jarvis route E2E.
