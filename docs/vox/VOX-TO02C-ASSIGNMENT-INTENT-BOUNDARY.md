# VOX TO-02C — work-item transition INTENT, non-executable

**SOURCE-ONLY — RELEASE HOLD.** Stacked on TO-01 Core queue projection PR #262. One Core-owned work item represents an operational staff assignment, independent from QuickFurno's 3-vendor lead matching.

`contracts/vox/workIntentPreparation.mjs` defines pure bounded transition preparation for CLAIM, START, WAIT_EXTERNAL, REQUEST_APPROVAL, BLOCK, ESCALATE, RESUME and COMPLETE. It validates request/input shape, exact current city/team, actor/assignee, version/nonce, reasons, and safe state transitions. Every positive result retains `executionAuthorized:false`, `requiresDatabaseAtomicity:true`, `requiresFreshSubjectGrant:true` and `providerMessagesSent:0`.

This cannot be used to mutate any Core object. The `coreVerified` and role fields are not cryptographic proof; a future Core authenticated server adapter MUST derive them from current Supabase AAL2, fresh membership/record grants and approved team/city. The function must never be wired directly to user-supplied input or used as a substitute for authorization.

**Incomplete:** no persistent work-item schema, concurrency-safe SQL claim, agent handover, client conversation/send broker, assignment notification, inbox delivery, SLA timer or daily-worker execution. Build those in separate governed PRs after source schema and independent review. State machine intent is NOT a proof of at-most-once claim or idempotent DB transaction.

CI uses Node 20 offline synthetic tests with negative role/city/revision/claim/agent-command cases; no production keys, provider sends, VPS, managed staging or SQL migration. The other parallel lanes are TO-02B staff capabilities and Admin roster PRs #265/#266. Merge only after human review and actual stage QA.
