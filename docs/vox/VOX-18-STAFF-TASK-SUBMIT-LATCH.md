# VOX-18 staff internal task double-submit safety

Fixes a true race in the existing Vendor 360 staff-only task create UI: React `busy` and idempotency `nonce` state can lag behind a rapid second invocation before a rerender. Adds synchronous `useRef` in-flight latch and nonce reservation before the first network `await`. Retries of the unchanged draft keep the same nonce; edits or successful Core receipt rotate it, and all fields stay disabled while a request is in flight.

Uses existing Core scoped staff AAL2, city assignment, unique task idempotency and exact payload checks. **No provider send, wallet debit or profile mutation.** Existing 17/17 source checks and TypeScript must pass; still requires genuine authenticated staging before live feature activation. No deployment, no production flags changed.
