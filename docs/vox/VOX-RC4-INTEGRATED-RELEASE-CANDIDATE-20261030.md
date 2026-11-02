# QuickFurno VOX RC4 — Six-Track Internal Release-Candidate Evidence

**30 October 2026 | SOURCE-ONLY / RELEASE HOLD | protected DRAFT, never managed Staging or Production GO**

## Exact basis and change control

RC4 branch `feat/vox-rc4-integrated-20261030`, from protected RC3 PR #446 source `f5dd7e4824f66e6b28039606e055ae3e2ca7cfb6`. Six isolated worktrees were developed in parallel and source-only changes combined via cherry-pick into this branch. Existing Active checkout and unrelated user changes were preserved. The new capabilities are deliberately fail-closed pending genuine auth/recovery and independent qualified human approvals.

## Workstreams and results

| Track | Code / artifact | Local evidence | Remaining release boundary |
|---|---|---|---|
| A P0 — Conversation | `contracts/vox/rc4ConversationAuthorization.mjs`, unit suite | 16/16 decision/TOCTOU/replay/rollback source tests | Core consent writer must serialize with the Staff DB transaction and verified actor/city/team resolver; `CORE_CONVERSATION` SQL CHECK remains hard-off |
| B P0 — Approval | `contracts/vox/rc4ApprovalPipeline.mjs`, disposable approval nonce ledger and verifier SQL | 14/14 Ed25519/actor/replay tests; **actual separate network-isolated PG17** ledger installation and verification SQL exit 0 (includes replay, expiry, immutable ledger, revocations) | No human-enrolled signer keys or independent approved writer; official EOD and operator actions remain hard-off |
| C P0 — Recovery | `rc4-recovery-lib.mjs`, read-only schema/ACL/PITR preflight and evidence evaluator | 36/36 negative/forged-evidence tests | No current managed full-fidelity Auth/Storage/Vault/PITR backup + isolated recovery; raw RC3 two-path ACL divergence awaits qualified human DBA adjudication |
| D — Staff | `rc4StaffAuthorization.mjs` + typed `.d.mts` and hard-off server adapter | 17/17 Auth AAL2/IDOR/revocation/role/city/team tests; TypeScript PASS | Genuine verified Owner/neutral Team Leader MFA and revocation/authorization-epoch backends not yet supplied; live Staging Staff tables absent |
| E — Migrations | `rc4ReleasePins.mjs`, `rc4ReleasePlan.mjs`, `rc4ReleaseGates.mjs`, plan-only CLI | 31/31 planning/forged-GO tests; source-only dry-run HOLD | P0-6 and overlay exact bytes unpinned by design; no qualified DBA/AppSec or approved Staging recovery |
| F — QA | `rc4-qa-orchestrator.mjs`, `rc4-qa-lib.mjs`, source-only GitHub Actions workflow | 19/19 unit tests; **integrated 102 source suites, 702/702 tests PASS**, report SHA256 `bfe8aedd1c0d76d45049ea67de35ef377c6cc79946c8ea3eaedd8949358fbbbe` | Real local GoTrue+PostgREST positive Owner/TL/Staff HTTP E2E and managed Staging 401/403/200 acceptance not demonstrated in RC4 |

**Combined direct focused suites A–F: 133/133 PASS**, zero failures. Full Next.js production build and TypeScript compile both exited 0. The integrated QA orchestrator returned `RC4_QA_OVERALL=SOURCE_PASS exit=0 releaseDecision=HOLD` with five source steps PASS and two deliberately BLOCKED integration steps (PG17 full 30-file certification and genuine local identity E2E not invoked by that source-only run). The separate Track B standalone PG17 approval SQL verification was operator-executed, not a comprehensive managed Staging recovery.

## Security / release classification

- Keep protected P0-6 PR #435 and the AB7K source stack #379 → RC2 #445 → RC3 #446 in their protected states. RC4 is another **draft source candidate**, not a DBA-reviewed migration.
- Managed Staging project `uckafzuochmbvtiodmcl`, last read-only snapshot: 86 migration records, 0 VOX Staff tables, one verified MFA principal. That is historical pre-RC4 evidence, not a new live signed inspection. Production project identity differs; **neither managed environment was modified**.
- RC3 isolated PG17 previously showed `PROVISIONAL_SEMANTIC_PARITY` with two retained raw owner-only/default ACL divergences. RC4 C checks that no provisional/local result is mislabeled as managed restoration.
- No new user accounts, signers or credentials; no feature flags enabled, payments, providers, messaging, production releases or marketplace activation. No SQL applied to managed Staging or Production.
- Current decision **HOLD**: actual in-transaction consent writer, reviewed Staff role policy, human Owner/TL AAL2, independently approved Ed25519 signer+durable verified approval writer, genuine managed compatible PITR/roles/ACL/Storage/Auth restore, independent qualified human DBA/AppSec review, signed Staging application and three-role positive E2E, Owner/operator GO remain missing.

## Review and next execution gates

1. Qualified product/Owner + AppSec approve canonical Staff consent/role and team/city semantics; build and prove the same-transaction SQL writer and D2-C/D2-D shared consent lock.
2. Enroll two real independent humans via verified AAL2, pin public signing keys with approved fingerprints, and independently certify the nonce-ledger writer and cryptographic verification.
3. Capture fresh current managed Staging read-only ledger/roles/ACL/extension/Auth/Storage inventory; rehearse full-fidelity restore/PITR, approved P0-6 then exactly 7+23 plus overlays, non-superuser RLS, rollback. Sign explicit qualified DBA/AppSec decision.
4. Only after these gates, Owner may authorize a **Staging-only** controlled migration, signed Core/VOX Web deployment, real cross-role UI/API E2E, selective feature activation and separate Production GO.

Master: [RC4 issue #447](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/447), [security blockers #444](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/444), [launch gate #420](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/420), and [Notion VOX tracker](https://app.notion.com/p/3f9751ba167c81dd8b62df1b38562715).
