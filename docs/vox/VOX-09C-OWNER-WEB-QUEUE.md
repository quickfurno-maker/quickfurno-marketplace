# VOX-09C — Owner review queue, non-executing and staging gated

New `/approvals` owner page and `/api/action-intents` same-origin BFF with a second-click confirmation for APPROVED or REJECTED. Both call canonical Core `/api/vox/v1/action-intents` only via a fresh server-side verified Owner Superadmin AAL2 session, pinned HTTPS Core Staging URL and `VOX_OPERATIONAL_REVIEW_UI_ENABLED=staging`. Core returns a bounded, no-PII queue of PENDING requests; BFF checks schema and bounds again and never exposes the Core bearer to browser. On POST, same Origin, strict UUID/decision/revision and JSON max-size enforce input. Core independently revalidates current grant, team, city, nonce and fresh active reviewer before atomic audit.

**APPROVED is NOT EXECUTED**: the owner queue cannot send WhatsApp, update a vendor or trigger an agent. This stage is only an approval gate for future separately governed actions. This workbench has no role in existing staff access-review; that's a distinct existing Team Leader queue.

Source only, no Staging migrations/account activation/real approval issued and no deployment. Signed private Staging positive+negative AAL2 tests and rollout are still required.
