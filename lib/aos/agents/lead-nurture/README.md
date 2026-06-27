# QF-AOS-LeadNurture

**Agent number:** 16 (Phase 1D — future inactive)

## Purpose
Long-term lead nurturing, follow-up scheduling, custom nurture dates, future reactivation.

## Future responsibilities
- Schedule long-term nurture follow-ups (including custom dates beyond two months)
- Recommend reactivation of dormant leads
- Coordinate nurture stages with the CRM nurture queue

## Current status
- **Status:** future / inactive
- **Mode:** placeholder
- **Version:** v0.1-future
- This agent is NOT activated and performs no real actions.

## Activation prerequisites
- A dedicated activation phase with explicit approval.
- Feature flag enablement (per-agent).
- Required Supabase tables/permissions reviewed and applied.
- AI optional with a rule-based fallback; secrets read server-side only.
- Admin approval for any side-effecting action.

## Safety restrictions
- No real AI calls.
- No WhatsApp sending.
- No n8n connection.
- No live lead distribution.
- No credit deduction.
- No database writes.
- No changes to existing lead/vendor/client data or business logic.

## Files controlling this agent
- `agent.config.ts` — configuration and safety flags
- `schema.ts` — placeholder input/output types
- `service.ts` — safe placeholder service (returns `future_inactive`)
- `prompt.md` — future placeholder prompt
- `README.md` — this document
