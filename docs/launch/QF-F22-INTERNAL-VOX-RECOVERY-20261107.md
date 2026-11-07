# QuickFurno F22 — Restore historical VOX testing without mixing Owner-only and Staff hosts

**7 November 2026. Internal-first. NO DEPLOY. No live Meta/Supabase/VPS actions.**

## Business decision retained

VOX is QuickFurno's **current standalone Owner operating interface**. Full Staff presence, department collaboration, attendance, task assignments and time tracking belong to a **separate preserved Staff scope**, and must not be quietly merged into the Owner-only release merely to satisfy obsolete tests. Core remains the single business-authority service; the Owner VOX calls Core APIs. Riya client and Anisha vendor WhatsApp identities remain strictly separate, and no user-visible OTP is activated. ClamAV remains Owner-deferred with scan-dependent approval/lead assignment/credit operations fail-closed.

## Track A — 25 missing historical VOX test references: repaired scope / preserved source

F21 found that current `apps/vox-web/package.json` `npm test` referenced 25 absent historical script files, while `npm run test:internal` already executed **161 real VOX Owner/Staff source checks, six real-source synthetic Core AAL2 overview checks, and 23 real-source synthetic Owner vendor workflow checks**. The legacy package was written for the former full Staff VOX host, not the present Owner-only extraction.

F22 recovered **24 of 25** original tests byte-for-byte from the *actual repository branch* `origin/feat/vox-vo2-repo-staff-presence-20261103` at commit `015ad722c543b2106b0b46f3fc573e16c4edee63`. The final `validate-owner-vendor-verification.spec.mjs` had **no original file** at that branch. Its current Owner behavior is separately covered by F21's **23 passing actual-source synthetic cases** (not falsely claimed to be the missing historical test).

Recovered original files are in `docs/launch/archive/vox-staff-legacy-tests/` with all **24 SHA-256 pins, source Git commit and original paths** in `qf-f22-legacy-vox-archive-20261107.json`. No archived historical test was edited to force a pass. The archive is nonruntime and **not** present under the released Owner host's `apps/vox-web/scripts/`.

**Actual JARVIS separation test:** Running recovered scripts against the current Owner-only app yielded 2 passing / 18 incompatible with retired Staff/full-host interfaces / 4 requiring network-child review / 1 absent. Running against the exact original **detached Staff branch**, with synthetic credentials and file-only restricted Node permissions, yielded **20/20 source/VM scripts passed**. The remaining four were reviewed: one is a literal `fetch` source-contract check (no actual HTTP) and the others launch `next start` on **127.0.0.1 only**. The full historic Staff Webpack production build succeeded on JARVIS with synthetic environment; all **four additional tests passed**, including **5+6+8 = 19 actual compiled local HTTP cases** across three scripts, with 0 skips.

**Owner-host test repair:** In current `apps/vox-web/package.json`, **only** the obsolete default `test` command is set to `npm run test:internal`; this maintained command itself, all other scripts, dependencies and application files are unchanged. The original 25-script command SHA-256 `49f7777646476e1b9176dee70705b652df73b7f4f30f13e181b5a47e2cc980be` remains pinned, available in original F21 Git history. Current `npm test` PASS; it is deliberately *Owner-only testing*, not a promise that legacy Staff screens now exist.

## Track B — Current VOX compiled build + real local Owner HTTP

F22 current Owner-only standalone VOX **Webpack production build PASS** with fixture-only environment. Core and VOX full TypeScript **PASS**; Marketplace/assignment/communication suite **137/137 PASS**. Actual compiled Owner Next server bound to **127.0.0.1** and then removed: **6/6 HTTP checks PASS** — login 200, Owner verification page default HOLD 200, disabled queue 503, disabled case 503, Owner decision 403 (Origin guard), disabled Staff vendor360 503. This tests **negative activation safety**, not signed Owner activation, Meta OTP or real Supabase database.

A portable `f22_owner_compiled_local_http.py` performs the same local compiled verification and process cleanup on GitHub Linux and JARVIS Windows after a compiled build. No service credentials, outbound WhatsApp or managed Supabase client used.

## Track C — Cross-phase security and protected release governance

New `f22_verify_vox_test_scope.py` proves 24 restored archives equal their real historical Git bytes; the missing 25th is explicitly accounted for; the Owner-only `npm test` command is the only permitted package delta relative to exact F21 commit `4281e2b79e76ce12cdcfe2c376e40138fe09e1cb`. It **independently invokes the original F21 and F0 verifiers** and requires their exact known failures. All 13 historical protected F0/F1/F5/F6/F7 source/manifest paths remain unchanged; no source-hash waiver. **14/14 adversarial local tests PASS** against malicious archive hash/commit edits, fake GO, Staff activation and disabled tests.

F18 managed migration SQL-content parity remains 10/10, F20 private immutable scan + assignment guard remains valid, and current Marketplace tests remain 137/137. Historical protected F0/F1/F5/F6/F7 branch checks **remain red**; the newer F22 internal validation does not approve a merge or launch. The previously exposed Staging legacy Supabase service-role JWT and Meta bearer token remain unrotated (P0 incident); this is **explicitly deferred**, NOT waived, until the final external phase.

## Independent GitHub CI strategy

F22 independent CI has two real jobs: (1) build/current-owner `npm test` / strict source archive + 14 hostile tests / TypeScript / six compiled local HTTP and unchanged migration/scan rules; and (2) check out **only the historical Staff commit** in a disposable Git worktree, `npm ci` with no external credentials, compile locally, compare all archived test bytes, and execute all **24 genuine historical tests** including three loopback-only compiled HTTP files. Both jobs have read-only GitHub permissions, no secrets and no deployment commands.

**Internal pending after F22:** finalize formal protected F0/F1/F5/F6/F7 required-check policy review and integration acceptance; broader positive Staff attendance/task/time-tracking behavior on maintained current Core authority rather than activating legacy host; exact-image signing and reproducible rollback preparation. **External LAST:** compromised Staging credential rotation/revocation; registered vendor Meta callback + Supabase Auth Send SMS Hook; two separate sender secret paths; current managed DB/Auth/Storage object-byte recovery; Owner-approved signed Staging rollout and real consented WhatsApp OTP. Aadhaar mandatory vs alternative-document privacy/legal policy still requires review before public registration approvals. **Staging and Production unchanged.**
