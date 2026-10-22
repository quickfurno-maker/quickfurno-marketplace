# QuickFurno Finance V2 — PAY-3 parallel source implementation (HOLD)
Date: 22 October 2026. Parent exact commit: `0226e220201848c224d1d5a24959432505d93061`.
Parent: [draft PAY1/PAY2 PR #385](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/385). Source only: no auth, provider, staging, production or financial writes.

## Tracks
- **PAY-3A** Owner AAL2 read-only Finance 360 source surface and future staff departmental permission boundary. No Finance Staff access until explicit finance-grant + independent review.
- **PAY-3B** Deterministic verified capture intake projection built on PAY-2 signed raw-body verifier, exact expected provider order, merchant, mode, currency and integer paise. Decision always `JOURNAL_AND_VERIFY_WITH_PROVIDER`; not a live processor, no credit calls. Durable inbox and retry worker require reviewed install and PAY-4.
- **PAY-3C** Pure partial refund evaluation: independent AAL2 reviewer, pending+processed reserved amounts, mode/merchant/payment match, safe integer caps. No provider request, wallet reversal or atomic reservation yet.
- **PAY-3D** Pure paise settlement calculator for gross, refunds, fees, tax-on-fees, adjustments vs bank deposit, with explicit `AMOUNT_MATCH_ONLY` rather than bank-confirmed success. Candidate append-only settlement evidence SQL intentionally uninstalled.
- **PAY-3E** Continuous offline Node and native PostgreSQL regressions; releases still require true Razorpay TEST refund/retry, DB/AppSec and Owner approval.

## Correctness boundaries
1. Preserve current tested checkout and atomic one-per-order credit activation exactly.
2. Finance Staff must not inherit acquisition, auditor or support roles as monetary read permission; create explicit independently approved Finance capability first.
3. Enforce durable webhook uniqueness at SQL `(provider,mode,merchant,event)`; ordering, replay and retries are pending implementation and certification.
4. An approved refund proposal is NOT an authorized gateway execution; enforce cumulative cap transactionally before processing, with real captured truth and handling for consumed credits.
5. Never conflate captured gross, bank settlements, recognized revenue, wallet credits or TEST-mode amounts.
6. All SQL outside normal migrations; all PAY3 feature flags OFF unless explicitly reviewed; live payment API untouched.

**RELEASE HOLD: neither PAY-3 nor PAY-4 production ready.**


## Initial integrated source QA verified on JARVIS (22 October 2026)
- Feature-gated Owner AAL2 read-only Core API `/api/vox/v1/finance-history` and VOX `/finance` page; exact local UUID lookup, no browser service-role access, financial staff permissions denied pending explicit capability. Double Owner authorization recheck before response, no mutation verbs. Flags `FINANCE_V2_PAY3_READ_ENABLED` and `VOX_FINANCE_PAY3_UI_ENABLED` default OFF.
- PAY3 deterministic policies in `lib/payments/financeV2Pay3.mjs`: verified capture journal-only, independent approval and pending-refund cap assessment, settlement discrepancy comparison, strict mode-safe event timeline. All policies are source-only, not real provider orchestration.
- Quarantined `ops/finance/sql-candidates/20261022120100_finance_v2_pay3_evidence_candidate.sql`: finance_settlements, finance_settlement_lines, finance_manual_receipt_evidence, finance_event_processing_evidence. No managed migration run.
- Local offline Node PAY1/PAY2/PAY3 focused suite **17/17 passed**; legacy Razorpay source validation **51/51 passed**; native isolated Docker PostgreSQL17 PAY3 **8/8 FORCE RLS, zero browser access, duplicate and immutable controls, restore baseline PASS**; Core TypeScript and Next production build PASS; VOX TypeScript and Next production build PASS. VOX build initially lacked local Next dependency; `npm ci --ignore-scripts` restored pinned dependencies and rerun PASS. No real provider or protected DB touched.
- Three-job GitHub source-only workflow added for Core, VOX and PG17. Await exact-head CI before calling verified GitHub success.

## Functional gaps deliberately NOT closed by initial PAY3 source candidate
- No live durable webhook processor/queue, replay-safe claim worker, provider GET verification or switch into existing atomic credit activation. PAY2 webhook remains original.
- No AAL2 Finance Staff grant policy, Finance Lead dual-control UI, fully indexed transaction search, settlement-to-transaction database projection, genuine bank statement integration, manual Paid workflow changes, executable refunds, atomic refund reservations or consumed-credit reversal policy.
- No genuine Razorpay TEST payments/refunds/replays, no independent DBA/AppSec, no staging install, no Owner GO. Continue PAY3 follow-up implementation and PAY4 certification under RELEASE HOLD.
