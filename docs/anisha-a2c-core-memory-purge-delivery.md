# QuickFurno Core — Anisha Memory Purge Outbox and ACK (AN-A2c)

Date 12 October 2026 IST. Source implementation only. No migration deployed.

The AN-A2b purpose-specific vendor consent remains independent from WhatsApp consent. Its consent/outbox migration was amended to preserve purge tasks if the vendor record is deleted. A guarded Core trigger queues vendor_erasure and the outbox does not reference vendors with ON DELETE CASCADE.

The AN-A2c migration adds a 120-second, at-most-10-task leased claim function, and exact purge/vendor/lease ACK that lifts erase_pending only when all pending outbox tasks are acknowledged. Expired leases are retryable; no false ACK on a failed deletion. SQL definer functions are restricted to service_role, and HTTP CLAIM and ACK endpoints verify separate Ed25519 signing domains using the current Jarvis key infrastructure.

The Jarvis companion adds an independent stage-only worker and atomic Postgres erasure-fence-plus-delete transaction.

Local checks: 22/22 Core purpose consent tests, 27/27 Core purge contract checks, Core TypeScript PASS. Read-only connected QuickFurno staging inventory has no Anisha vendor memory consent/outbox tables as of the audit. SQL migrations are **NOT APPLIED**, not real SQL execution certified.

Required before stage activation: backed-up staging DB; migration review; exact function grants and ownership review; live DB claim/expiry/ACK drill; staging Core/Jarvis signed request verification; vendor privacy consent UI and per-vendor deletion receipts; controlled re-enrollment handshake after fence. Production remains unchanged.
