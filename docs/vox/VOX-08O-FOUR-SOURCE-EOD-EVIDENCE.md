# VOX-08O — Four-source Staff EOD evidence reconciliation

**16 October 2026. Source-only; NO managed Staging/Production activation.** Stacked on QuickFurno Core VOX-08N draft PR #311. Reuse `contracts/vox/unifiedDeskAndEod.mjs` and Core staff restrictions; this is a **stricter V2 projection**, not a new reporting service or producer.

## Contract
`contracts/vox/allSourceEodEvidence.mjs` combines only four existing source categories: Core work ledger, Aarohi CRM, Support Desk and Core Conversation. Each source has an explicit bounded event window, current Staff/team/city/subject proof, timestamped Core-only reader identity, and optional source watermark. Exact external source authoritativeness, producer signatures, completeness and final report approvals are **NOT** established by this pure projector. Missing source, late/incomplete watermark, unsupported subject, extra PII or duplicate/replayed revision fails closed. When coverage is incomplete, combined totals are NULL; no fake business productivity totals.

Even when all four provenance assertions are present, the result says **COVERAGE_ASSERTED_NOT_AUDITED**. It always returns `canSubmit=false`, `canApproveFinalBusinessReport=false`, `providerMessagesSent=0` and no transcript, contact details or staff export.

## Verified isolated tests
`node --test scripts/mvp/vox/validate-to08o-eod-reconciliation.test.mjs`: **12/12 PASS**; four-source asserts, missing watermark, unsupported/delayed source, cross-role/cross-city/object revocation, duplicate source/event/revision, EOD IST business-day validation, no PII and bounded 100-event window. Entire Core VOX test suite on this branch **216/216 PASS**, including pre-existing 204. No real EOD source readers were queried.

## Still not implemented
Actual signed/current Core source readers for all four systems, conversation source permissions for Riya clients, canonical agent event reconciler, ingestion watermarks, retained immutable report submission and independent TL acknowledgment of **all-source** evidence; real staging AAL2 and human-signed DBA/security approval. The existing 08J partial EOD is a **Core work-only** report, not this V2 output.
All source flags OFF. Source-only default, draft review required.
