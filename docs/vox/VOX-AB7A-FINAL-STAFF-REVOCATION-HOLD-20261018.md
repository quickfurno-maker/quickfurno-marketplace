# AB-7A Staff Core access-fence contract — source-only HOLD

- Source-level `executeReviewedStaffAccessFence` is disabled unless explicitly scoped to staging, distinct Owner AAL2, Team Leader AAL2 and neutral target, with independent signed immutable APPROVED decision, exact team/city/revision/nonce.
- Injected Core RPC (not registered or installed here) must recheck reviewers, revoke membership, department capabilities and exact object scopes together, consume one nonce and return exact trusted receipt. No fallback on any partial result.
- Even an accepted Core suspension is **not** Auth session invalidation: result remains `CORE_ACCESS_SUSPENDED_AUTH_RECONCILIATION_PENDING`; `authSessionsInvalidated:false`. Genuine GoTrue Auth session revoke and real active role changes require separate protected release work.
- Rejects forged/self-reviewed/expired/stale/incomplete receipts and production activation. No managed DB/real users touched. Cursor independent review deferred, not waived. Release HOLD.
