# AB-7E Internal notifications recovery triage — source-only HOLD

- New `prepareInternalRecoveryReview`: bounded 200 original Core jobs, fresh Owner AAL2 and verified source callbacks, rejects duplicate IDs, provider-bound or malformed jobs.
- Projects stalled leases, dead-letter and outcome-unknown *only* to manual Owner review with sanitized ID and reason. Explicit `mayDispatch:false`, `mayRetryAutomatically:false`, `externalMessagesSent:0`.
- Reuses existing notification outbox worker architecture; does not install a scheduler, claim jobs, change database retries, send push/WhatsApp or alter AGNI/AOS.
- Focused tests cover stale/unknown status, revoked Owner, malformed Core claims, provider-bound jobs and Core outages. Real worker registration, signed deployment, reviewer clearance and protected staging are pending. Release HOLD.
