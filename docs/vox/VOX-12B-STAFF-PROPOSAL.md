# VOX-12B — Aarohi staff follow-up proposals (source only)

Builds on the existing VOX acquisition SSR read workbench, owner operational review (#221/#222) and exactly-once Core internal follow-up executor (#224/#225). Adds an explicit **staff proposer** UI, completing the source-level three-person-step flow:

1. Scoped acquisition staff selects an already Core-authorized assigned prospect and records a rationale. Do-not-contact and human-takeover records are excluded from this UI's options; the underlying Core API remains independently authoritative for city/object grants.
2. The same-origin `POST /api/followup-proposals` checks Origin, UUID, JSON size, strict request keys, and uses the existing HttpOnly, verified AAL2 server session to call Core `POST /api/vox/v1/action-intents` with actionKind fixed `AAROHI_FOLLOWUP`. It accepts only `PENDING` + `execution=NOT_AUTHORIZED`; no task is created during this step. An opaque UUID nonce is **reused** after network uncertainty to avoid duplicate proposals.
3. The independent Owner reviews through the existing `/approvals` UI and owner-only atomic Core RPC. The Owner may then separately execute one **internal** Aarohi task from the owner-approved queue. None of these screens sends WhatsApp, affects credits, registers vendors or enables automation.

The new `VOX_FOLLOWUP_PROPOSALS_WEB_ENABLED` defaults to **disabled**, independently of Core `VOX_OPERATIONAL_INTENTS_ENABLED`, the owner review flag and the approved internal task execution flag. No Core service_role credentials are sent to the browser. All changes are source-only; no Staging database / real identity / production deployment / provider send.

Release HOLD: genuine staff Supabase MFA, positive/negative cross-city/IDOR and do-not-contact backend checks, actual Core Staging proposal→review→execution (including interrupted responses/concurrency/rollback), signed private deploy and owner approval. This does not finish broader CRM or WhatsApp operations.
