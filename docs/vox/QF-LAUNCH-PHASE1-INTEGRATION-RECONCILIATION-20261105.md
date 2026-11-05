# QuickFurno Final Launch — Phase 1 integrated source candidate / Staging HOLD

**Date:** 5 November 2026. **Scope:** source integration only. **Release decision:** HOLD. **No managed databases, provider messaging, Finance/EOD, staff activation or public registration.**

## Single Owner-first launch architecture
QuickFurno Core remains the only authority for registrations, vendor identity, owner decisions, matching, credit outcomes and lead assignments. Native VOX Web Owner frontend and BFF delegate to the already-built Core APIs. Staff and Team Leader features remain frozen; Jarvis Automation Studio remains in Jarvis. No separate VOX vendor business logic is created.

## Graph and exact source parents
- VOX chain: [#482](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/482) → [#485](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/485) → [#486](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/486) → [#489](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/489), base commit `594c44ebd1802addb1eaea432e69d52acc5ac1ca`.
- Vendor governance: [#484](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/484) → [#488](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/488) → [#490](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/490), merged source head `02e7ec54495c8d586d7cffe9e30b6e6d032fcf44` (first merge commit `5ae05ca7c5d3e262db4551a3278e488d6cf66975`).
- Private upload and local ClamAV: [#484](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/484) → [#487](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/487) → [#491](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/491), source head `0866f302fe5dad8fd29aab11fe8f9dd96e751374` (second merge commit `818aa3f3d8ed0ead096b31f6da72015a00fcc985`).
- A clean JARVIS worktree `qf-launch-p1-integrated-20261105` is the **single QA reconciliation branch**, preserving the dirty main checkout and existing parallel worktrees.

## Actual resolution, without migration-history bypass
Initial uncommitted two-branch merge found four conflicts: Phase21/Phase22 generated callsite manifests, the G1 source validator, and the historical post-G1 source ledger. The **historic VOX** ledger and G1 validator were first preserved unchanged; Phase21/Phase22 were regenerated from the merged sources. Seven new November SQL source files were exactly pinned as a *new append-only*, source-pending extension without dropping Oct14's seven quarantined VOX records. Historical observed read-only snapshot `VOX-MANAGED-STAGING-MIGRATION-DRIFT-READONLY-20261031.json` and RC22 exact 162-file aggregate/RC24 capture SHA were **not changed**.

The old post-G1 extension's **first 51 entries** retain a pinned `JSON.stringify` SHA-256 `8a5364be05415b4e8b7a52a3114e6099783a3ecf63f2ca0fcdb9cbf94c21c01d`. Seven exact-hash vendor source-pending records were appended (58 total), all with `exactVersionPresence={staging:false,production:false}` and explicit `NO_REMOTE_APPLY` evidence. Historical G1 guard now rechecks all 58 and retains the full existing mutation suite. The RC22/RC23/RC24 and RC40 historical captured-source analyzers explicitly isolate the seven **raw-byte-pinned** new files from the unchanged 162-file 2026-10 snapshot; unknown/changed extras still fail closed. The RC35 test evaluates both snapshots separately: historical 162 at capture and current 169 pending managed reconciliation. No actual managed database was inspected, and **no staging install or automatic release was authorized**.

## Tests and pending proof
Local JARVIS root TypeScript passed; vendor targeted 55/55; VOX Owner+Core targeted 11/11; historical G1 **334/334 and 153/153 mutants rejected**; RC22–RC40 integration migration QA audited; additional addendum tests 4/4. Each test result represents local source/disposable harness evidence only. Exact-head GitHub CI must be checked after pushing; none of the existing drafts have been merged.

**Mandatory Phase 2–5 gates:** real read-only managed Staging migration/catalog inventory, owner-reviewed append-only migration ordering and recovery rehearsal, private bucket ACL+retention, authentic ClamAV engine signature/EICAR evidence (local probe returned unavailable), separate WhatsApp OTP provider approval and delivery test, Google Places billing/location, actual deployed VOX/Core image digests and verified Cloudflare Access + real TOTP AAL2, signed forward-fix/rollback, Staging E2E, separately explicit Production GO, controlled Pune/PCMC beta. No financial refunds; bad-lead resolution is one restored lead credit. Staff/Official EOD and provider sending stay off.

## Quality and explicit red lines
No historical SQL rewrite, no fake reconciliation or human DBA/AppSec signoff, no managed migration repair, no direct supersede of protected release manifest, no deployed image claim, no live phone/user/identity documents in tests, no new auto approvals or credit deductions, no production activation merely because CI is green.

Canonical Notion execution log: [Five-phase launch command page](https://app.notion.com/p/40f751ba167c819d8827cb89a5340dcc). Vendor audit: [Vendor Final Audit](https://app.notion.com/p/40e751ba167c811dac43f18682eb5f93). Owner architecture: [VOX Owner Plan](https://app.notion.com/p/40d751ba167c81f6bd24f0550c7abd08).
