# Step 3B-6F — Razorpay TEST + VOX Finance operational acceptance package
This is a review/QA plan only. No provider network call, TEST capture, LIVE charge, refund, webhook delivery or wallet credit was initiated.
## Identity and uniqueness contract
- Distinct internal payment attempt ID, order ID, Razorpay payment ID, provider refund ID (as applicable), and idempotency/event IDs. Do not substitute UTR for provider transaction ID.
- Normalize manual UTR at one canonical boundary. Enforce unique constraints scoped to appropriate payment intent / environment; forbid collision across multiple live payments while allowing separate recorded attempts.
- TEST and LIVE identifiers/records must not be intermixed in staff views or ledgers. Server secret and webhook signing key never enter VOX frontend.
## End-to-end staff trace
Core intent -> provider order -> attempt(s) -> success/failure/partial update -> verified webhook journal -> idempotent ledger event -> vendor/customer balance movement -> refund/dispute -> VOX scoped finance history with actor, timestamps, audit correlation and export permissions. Enforce least privilege and immutable history.
## Synthetic negative scenarios (no provider actions)
Forged webhook signature, duplicate event, reordered settled-before-created event, incorrect amount or currency, retry after partial failure, refund repeated, TEST-to-LIVE crossover, manual UTR duplicate, missing order reference, unauthorized Staff access, history tampering and stale session.
## Required later genuine TEST certification
Independent signed release + managed staging permitted; webhook signature from configured Razorpay TEST endpoint, delivery retry verification, real TEST order/payment/refund per provider rules, database reconciled finance trace, VOX Staff read-only and case-review authorization, zero LIVE activity.
Existing source `runPay4c4OfflineProviderSuite()` is synthetic and reports nine proof cases with zero network/currency movement; success is NOT real Razorpay TEST certification.
Status: TEST acceptance plan ready, managed/provider execution NOT AUTHORIZED, release HOLD.
