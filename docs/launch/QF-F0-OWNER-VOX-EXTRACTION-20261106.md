# F0 — Isolated VOX Owner source extraction (NO DEPLOY)

**Decision:** Draft source review only. No merge, image publication, Staging/Production deploy, feature activation, database write, provider send or Staff access authorization.

## Why

Inherited release PR #502 at `f7ffbc1dbf1f9165c7818d2cfb767be33e238c73` is stacked on approximately 1,258 commits and 1,545 changed paths relative to protected `main` `b9f8ada90283704c1841d4cd2572305550bca440`. A whole-stack merge is not a safe first-vendor launch. VOX is absent from protected main; copying the full standalone VOX app would incidentally bring Staff, Finance and Automation Studio pages into the release tree.

## Actual result

- Created separate clean worktree/branch `integration/qf-f0-owner-minimal-20261106` from protected main.
- Isolated **60** VOX files: 55 exact reused source files, four reproducible Owner-only page/BFF overlays, and one minimal root redirect to `/operations`. Source SHA, per-file SHA-256 and the four overlay source digests are recorded in `docs/launch/f0-owner-vox-file-manifest.json`.
- Included existing login, MFA, recovery, health, operations, Vendor 360, Owner vendor verification UI and corresponding read/decision BFF API paths.
- Excluded Staff/Team Leader pages, chat/presence/time, Finance, EOD, Automation Studio, acquisition and discretionary provider actions from this isolated VOX app's routable tree. Removed imported Staff action widgets and broken links to omitted workspaces; the Owner operations and Vendor 360 pages **and their read BFF routes** reject non-Owner view mode before Core projection reads. Shared auth library and Core integration clients remain true Owner dependencies; importing a shared type is not permission to activate a Staff lane.
- Enforced fail-closed manifest hash, no unreviewed route, prohibited Staff/Finance routes, no altered source bytes, no implicit Production authorization. Adversarial mutation tests cover Staff-route addition, modified Owner decision, forged release switch and missing Owner page.

## Evidence

- Local JARVIS `npm ci --offline --ignore-scripts`, `npm run typecheck`, production `npm run build`: PASS on the isolated VOX subset, with only explicit selected routes in compiled output.
- `python scripts/mvp/launch/verify-owner-vox-scope.py --repo .`: PASS, `deployment_authorized:false`.
- Seven local scoped-source/mutation tests: **7/7 PASS**, including dead-route/link and Staff action-surface checks.
- Existing full VO0–VO12 Staff test suite **173/173 PASS** and complete VOX TypeScript/build independently on the Staff-reactivation worktree; not included in this Owner extraction.
- CI to run on PR exact head, with read-only token and no deploy job.

## Not yet done

- This is a **VOX slice**, not the full Marketplace Core source release. Required new Core Owner queue/case and vendor registration/private-evidence routes, approved seven-SQL fingerprint bundle and provider/infrastructure integration must be independently extracted, reviewed and tested.
- Genuine protected Owner AAL2, signed Staging image pair, managed backup/restore and rollback, Google Places and Meta WhatsApp OTP delivery have **not** been certified by this isolated build.
- ClamAV and VPS upgrade remain deferred to F5; scan-dependent Owner approval stays OFF.
- This branch cannot be directly published using protected #502 Staging publisher. Combine only reviewed isolated components into a tested owner release candidate with a new exact manifest, then seek independent security and protected release approval.

**Release decision:** HOLD. This artifact reduces inherited source risk and supplies a reproducible Owner-only build for the next Core integration cut.
